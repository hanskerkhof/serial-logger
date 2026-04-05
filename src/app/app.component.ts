import { Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { ToolbarModule } from 'primeng/toolbar';
import { PopoverModule } from 'primeng/popover';
import { Popover } from 'primeng/popover';
import { ButtonModule } from 'primeng/button';
import { filter } from 'rxjs';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { APP_VERSION, BUILD_DATE } from './build-info';
import { CommanderApiService } from './commander-api.service';
import { SerialService } from './serial.service';
import { CmdrMessage, CmdrHealthResponse } from './api/cmdr-models';
import { HealthPollService } from './health-poll.service';
import { ReleaseNotesComponent } from './shared/release-notes/release-notes.component';
import { QrScannerDemoComponent } from './shared/qr-scanner-demo/qr-scanner-demo.component';
import { QrScannedCommandService } from './shared/qr-scanner-demo/qr-scanned-command.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabsModule, ToolbarModule, PopoverModule, ButtonModule, ReleaseNotesComponent, QrScannerDemoComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  private static readonly RELEASE_NOTES_PAGE_SIZE = 10;

  @ViewChild('updateDialog') private updateDialogRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('releaseNoticeDialog') private releaseNoticeDialogRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('qrScannerDialog') private qrScannerDialogRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('healthPopover') protected healthPopoverRef!: Popover;
  @ViewChild('wsPopover') protected wsPopoverRef!: Popover;

  private readonly router = inject(Router);
  private readonly commanderApi = inject(CommanderApiService);
  private readonly serialService = inject(SerialService);
  private readonly qrScannedCommandService = inject(QrScannedCommandService);
  protected readonly activeMode = signal<'direct' | 'commander'>(this.modeFromUrl(this.router.url));
  protected readonly appVersion = APP_VERSION;
  protected readonly buildDate = BUILD_DATE;
  protected readonly apiVersion = signal<string | null>(null);
  protected readonly apiBuildDate = signal<string | null>(null);
  protected readonly isSerialSupported = this.serialService.isSupported;
  protected readonly apiConnected = signal<'unknown' | 'ok' | 'error'>('unknown');
  protected readonly healthSummary = signal<{
    apiVersion: string | null;
    apiBuildDate: string | null;
    fwVersion: string | null;
    port: string | null;
    fixtureName: string | null;
    detected: boolean | null;
    degradedReason: string | null;
  } | null>(null);
  protected readonly healthService = inject(HealthPollService);
  protected readonly secondsSinceHealthCheck = this.healthService.secondsSinceHealthCheck;
  protected readonly nextHealthPollCountdown = this.healthService.nextHealthPollCountdown;
  protected readonly heartbeatState = computed<'healthy' | 'degraded' | 'offline'>(() => {
    if (this.apiConnected() !== 'ok') return 'offline';
    return this.healthSummary()?.detected ? 'healthy' : 'degraded';
  });
  protected readonly wsConnectionState = computed<'connected' | 'connecting' | 'disconnected'>(() => {
    if (this.healthService.healthRefreshing()) return 'connecting';
    if (this.healthService.healthError()) return 'disconnected';
    return 'connected';
  });

  private readonly isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  private readonly isStandalone = ('standalone' in navigator) && !!(navigator as any).standalone;
  private readonly bannerDismissed = localStorage.getItem('pwa.installBannerDismissed') === '1';
  protected readonly showInstallBanner = signal(this.isIos && !this.isStandalone && !this.bannerDismissed);

  // --- Update notification state ---
  // Deferral schedule per "Later" press: 2m, then 30m, then 6h.
  // After the third deferral, "Later" disappears and update is required.
  private readonly LATER_REMINDER_MINUTES = [2, 30, 360] as const;
  private readonly MAX_LATER_COUNT = this.LATER_REMINDER_MINUTES.length;
  protected readonly updateAvailable = signal(false);
  protected readonly showUpdateDialog = signal(false);
  protected readonly newVersion = signal<string | null>(null);
  private readonly laterCount = signal(0);
  /** How many times the user can still press "Later" before the update is forced. */
  protected readonly remainingLaters = computed(() => this.MAX_LATER_COUNT - this.laterCount());
  protected readonly nextLaterDelayMinutes = computed<number | null>(() => {
    const index = this.laterCount();
    return index < this.LATER_REMINDER_MINUTES.length ? this.LATER_REMINDER_MINUTES[index] : null;
  });
  protected readonly nextLaterDelayLabel = computed(() => {
    const minutes = this.nextLaterDelayMinutes();
    if (minutes === null) return null;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes} min`;
  });
  private reminderTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Runtime release notice state (FW/API release metadata from /health) ---
  private static readonly RELEASE_NOTICE_ACK_KEY = 'studio.releaseNotice.lastAcknowledgedVersion';
  private readonly acknowledgedReleaseVersion = signal<string | null>(
    localStorage.getItem(AppComponent.RELEASE_NOTICE_ACK_KEY),
  );
  protected readonly releaseNoticeAvailable = signal(false);
  protected readonly releaseNoticeVersion = signal<string | null>(null);
  protected readonly releaseNoticeBuildDate = signal<string | null>(null);
  protected readonly showReleaseNoticeDialog = signal(false);
  protected readonly releaseMessages = signal<CmdrMessage[]>([]);
  protected readonly releaseMessagesLoading = signal(false);
  protected readonly releaseMessagesOffset = signal(0);
  protected readonly releaseMessagesTotal = signal(0);
  protected readonly showQrScannerDialog = signal(false);

  constructor() {

    // Drive native <dialog> elements via showModal/close so they enter the top layer.
    effect(() => {
      const show = this.showUpdateDialog();
      const el = this.updateDialogRef?.nativeElement;
      if (!el) return;
      if (show) {
        if (!el.open) el.showModal();
      } else if (el.open) {
        el.close();
      }
    });

    effect(() => {
      const show = this.showReleaseNoticeDialog();
      const el = this.releaseNoticeDialogRef?.nativeElement;
      if (!el) return;
      if (show) {
        if (!el.open) el.showModal();
      } else if (el.open) {
        el.close();
      }
    });

    effect(() => {
      const show = this.showQrScannerDialog();
      const el = this.qrScannerDialogRef?.nativeElement;
      if (!el) return;
      if (show) {
        if (!el.open) el.showModal();
      } else if (el.open) {
        el.close();
      }
    });

    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.activeMode.set(this.modeFromUrl(this.router.url));
    });

    const swUpdate = inject(SwUpdate);
    if (swUpdate.isEnabled) {
      swUpdate.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe((e) => {
          const appData = e.latestVersion.appData as { version?: string } | undefined;
          this.onUpdateReady(appData?.version ?? null);
        });
    }

    if (!this.serialService.isSupported && this.router.url.startsWith('/direct')) {
      this.router.navigateByUrl('/commander');
    }

    // Start the shared health poll (30 s cycle). Effects below react to updates.
    this.healthService.startPolling();
    effect(() => {
      const h = this.healthService.health();
      if (h) this.processHealth(h);
    });
    effect(() => {
      if (!this.healthService.health() && this.healthService.healthError()) {
        this.apiConnected.set('error');
      }
    });
  }

  private onUpdateReady(version: string | null): void {
    if (this.reminderTimer !== null) {
      clearTimeout(this.reminderTimer);
      this.reminderTimer = null;
    }
    this.laterCount.set(0);
    this.newVersion.set(version);
    this.updateAvailable.set(true);
    this.showUpdateDialog.set(true);
  }

  protected onUpdateNow(): void {
    document.location.reload();
  }

  protected onUpdateLater(): void {
    const delayMinutes = this.nextLaterDelayMinutes();
    if (delayMinutes === null) {
      this.showUpdateDialog.set(true);
      return;
    }

    this.showUpdateDialog.set(false);
    this.laterCount.update((n) => n + 1);

    if (this.reminderTimer !== null) clearTimeout(this.reminderTimer);
    this.reminderTimer = setTimeout(() => {
      this.reminderTimer = null;
      // Always show the dialog again — if no laters remain the template
      // hides the Later button, leaving only "Update Now".
      this.showUpdateDialog.set(true);
    }, delayMinutes * 60 * 1000);
  }

  protected openReleaseNoticeDialog(): void {
    this.showReleaseNoticeDialog.set(true);
    this.loadReleaseNotesPage(0);
  }

  protected openQrScannerDialog(): void {
    this.showQrScannerDialog.set(true);
  }

  protected closeQrScannerDialog(): void {
    this.showQrScannerDialog.set(false);
  }

  protected onQrValueDetected(value: string): void {
    const parsed = this.qrScannedCommandService.parse(value);
    if (parsed) {
      this.qrScannedCommandService.publish(parsed);
      this.closeQrScannerDialog();
      return;
    }

    const externalUrl = this.parseExternalHttpUrl(value);
    if (!externalUrl) return;
    window.open(externalUrl, '_blank', 'noopener,noreferrer');
    this.closeQrScannerDialog();
  }

  private parseExternalHttpUrl(rawValue: string): string | null {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  protected loadOlderReleaseNotesPage(): void {
    const nextOffset = this.releaseMessagesOffset() + AppComponent.RELEASE_NOTES_PAGE_SIZE;
    if (nextOffset >= this.releaseMessagesTotal()) return;
    this.loadReleaseNotesPage(nextOffset);
  }

  protected loadNewerReleaseNotesPage(): void {
    const nextOffset = Math.max(0, this.releaseMessagesOffset() - AppComponent.RELEASE_NOTES_PAGE_SIZE);
    if (nextOffset === this.releaseMessagesOffset()) return;
    this.loadReleaseNotesPage(nextOffset);
  }

  protected acknowledgeReleaseNotice(): void {
    const version = this.releaseNoticeVersion();
    if (version) {
      localStorage.setItem(AppComponent.RELEASE_NOTICE_ACK_KEY, version);
      this.acknowledgedReleaseVersion.set(version);
    }
    this.showReleaseNoticeDialog.set(false);
    this.releaseNoticeAvailable.set(false);
  }

  private processHealth(health: CmdrHealthResponse): void {
    const releaseVersion   = health.api?.release_version ?? health.release_version ?? null;
    const releaseBuildDate = health.api?.build_date ?? health.build_date ?? null;
    if (releaseVersion)    this.apiVersion.set(releaseVersion);
    if (releaseBuildDate)  this.apiBuildDate.set(this.formatApiDate(releaseBuildDate));
    this.refreshReleaseNotice(releaseVersion, releaseBuildDate);
    this.apiConnected.set('ok');
    const cmdr = (health as any).commander ?? {};
    const detected: boolean | null = cmdr.detected ?? null;
    this.healthSummary.set({
      apiVersion:    releaseVersion,
      apiBuildDate:  releaseBuildDate ? this.formatApiDate(releaseBuildDate) : null,
      fwVersion:     cmdr.fw_version ?? null,
      port:          cmdr.port ?? null,
      fixtureName:   cmdr.detected_fixture_name ?? null,
      detected,
      degradedReason: detected === false
        ? (cmdr.last_transition_reason ?? 'Commander disconnected')
        : null,
    });
  }

  private refreshReleaseNotice(releaseVersion: string | null, releaseBuildDate: string | null): void {
    if (!releaseVersion) {
      this.releaseNoticeAvailable.set(false);
      return;
    }

    this.releaseNoticeVersion.set(releaseVersion);
    this.releaseNoticeBuildDate.set(releaseBuildDate ? this.formatApiDate(releaseBuildDate) : null);

    const acked = this.acknowledgedReleaseVersion();
    const isNewRelease = acked !== releaseVersion;
    this.releaseNoticeAvailable.set(isNewRelease);
    if (!isNewRelease) this.showReleaseNoticeDialog.set(false);
  }

  private loadReleaseNotesPage(offset: number): void {
    const normalizedOffset = Math.max(0, offset);
    this.releaseMessagesLoading.set(true);
    this.commanderApi.getReleaseNotes(AppComponent.RELEASE_NOTES_PAGE_SIZE, normalizedOffset).subscribe({
      next: (resp) => {
        this.releaseMessages.set(resp.messages ?? []);
        this.releaseMessagesTotal.set(Math.max(0, resp.total ?? 0));
        this.releaseMessagesOffset.set(normalizedOffset);
        this.releaseMessagesLoading.set(false);
      },
      error: () => {
        this.releaseMessagesLoading.set(false);
      },
    });
  }

  private formatApiDate(isoDate: string): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const [, month, day] = isoDate.split('-').map(Number);
    const year = isoDate.slice(0, 4);
    return `${day} ${months[month - 1]} ${year}`;
  }

  protected dismissInstallBanner(): void {
    localStorage.setItem('pwa.installBannerDismissed', '1');
    this.showInstallBanner.set(false);
  }

  protected onModeChange(mode: string | number | undefined): void {
    const nextMode = mode === 'direct' ? 'direct' : 'commander';
    this.router.navigateByUrl(`/${nextMode}`);
  }

  private modeFromUrl(url: string): 'direct' | 'commander' {
    return url.startsWith('/direct') ? 'direct' : 'commander';
  }
}
