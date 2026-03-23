import { Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { ToolbarModule } from 'primeng/toolbar';
import { PopoverModule } from 'primeng/popover';
import { Popover } from 'primeng/popover';
import { filter } from 'rxjs';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { APP_VERSION, BUILD_DATE } from './build-info';
import { CommanderApiService } from './commander-api.service';
import { SerialService } from './serial.service';
import { CmdrMessage, CmdrHealthResponse } from './api/cmdr-models';
import { ReleaseNotesComponent } from './shared/release-notes/release-notes.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabsModule, ToolbarModule, PopoverModule, ReleaseNotesComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  @ViewChild('updateDialog') private updateDialogRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('releaseNoticeDialog') private releaseNoticeDialogRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('healthPopover') protected healthPopoverRef!: Popover;

  private readonly router = inject(Router);
  private readonly commanderApi = inject(CommanderApiService);
  private readonly serialService = inject(SerialService);
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
  protected readonly secondsSinceHealthCheck = signal<number | null>(null);
  private healthTickTimer: ReturnType<typeof setInterval> | null = null;
  protected readonly heartbeatState = computed<'healthy' | 'degraded' | 'offline'>(() => {
    if (this.apiConnected() !== 'ok') return 'offline';
    return this.healthSummary()?.detected ? 'healthy' : 'degraded';
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

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.healthTickTimer !== null) clearInterval(this.healthTickTimer);
    });

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

    this.commanderApi.getHealth().subscribe({
      next:  (h) => this.processHealth(h),
      error: () => this.apiConnected.set('error'),
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

  protected refreshHealth(): void {
    this.commanderApi.getHealth().subscribe({
      next:  (h) => this.processHealth(h),
      error: () => this.apiConnected.set('error'),
    });
  }

  protected openReleaseNoticeDialog(): void {
    this.showReleaseNoticeDialog.set(true);
    this.releaseMessagesLoading.set(true);
    this.commanderApi.getReleaseNotes(10, 0).subscribe({
      next: (resp) => {
        this.releaseMessages.set(resp.messages ?? []);
        this.releaseMessagesLoading.set(false);
      },
      error: () => {
        this.releaseMessagesLoading.set(false);
      },
    });
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
    // Reset + restart the "X seconds ago" counter.
    if (this.healthTickTimer !== null) clearInterval(this.healthTickTimer);
    this.secondsSinceHealthCheck.set(0);
    this.healthTickTimer = setInterval(
      () => this.secondsSinceHealthCheck.update((s) => (s ?? 0) + 1),
      1000,
    );
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
