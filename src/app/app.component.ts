import { Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { ToolbarModule } from 'primeng/toolbar';
import { filter } from 'rxjs';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { APP_VERSION, BUILD_DATE } from './build-info';
import { CommanderApiService } from './commander-api.service';
import { SerialService } from './serial.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabsModule, ToolbarModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  @ViewChild('updateDialog') private updateDialogRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('releaseNoticeDialog') private releaseNoticeDialogRef!: ElementRef<HTMLDialogElement>;

  private readonly router = inject(Router);
  private readonly commanderApi = inject(CommanderApiService);
  private readonly serialService = inject(SerialService);
  protected readonly activeMode = signal<'direct' | 'commander'>(this.modeFromUrl(this.router.url));
  protected readonly appVersion = APP_VERSION;
  protected readonly buildDate = BUILD_DATE;
  protected readonly apiVersion = signal<string | null>(null);
  protected readonly apiBuildDate = signal<string | null>(null);
  protected readonly isSerialSupported = this.serialService.isSupported;

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
      next: (health) => {
        const releaseVersion = health.api?.release_version ?? health.release_version ?? null;
        const releaseBuildDate = health.api?.build_date ?? health.build_date ?? null;
        if (releaseVersion) this.apiVersion.set(releaseVersion);
        if (releaseBuildDate) this.apiBuildDate.set(this.formatApiDate(releaseBuildDate));
        this.refreshReleaseNotice(releaseVersion, releaseBuildDate);
      },
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
    if (!this.releaseNoticeAvailable()) return;
    this.showReleaseNoticeDialog.set(true);
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
