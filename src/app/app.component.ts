import { Component, ElementRef, ViewChild, computed, effect, inject, isDevMode, signal } from '@angular/core';
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

  /** DEV ONLY — toggle to open the update dialog without a real SW update. */
  protected readonly isDevMode = isDevMode();

  // --- Update notification state ---
  // Adjust GRACE_PERIOD_MINUTES to change how long the user can defer an update.
  protected readonly GRACE_PERIOD_MINUTES = 2;
  private readonly MAX_LATER_COUNT = 3;
  protected readonly updateAvailable = signal(false);
  protected readonly showUpdateDialog = signal(false);
  protected readonly newVersion = signal<string | null>(null);
  private readonly laterCount = signal(0);
  /** How many times the user can still press "Later" before the update is forced. */
  protected readonly remainingLaters = computed(() => this.MAX_LATER_COUNT - this.laterCount());
  private reminderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Drive the native <dialog> via showModal/close so it enters the top layer
    // and always renders above other showModal dialogs.
    effect(() => {
      // Read the signal first so it is always tracked as a dependency,
      // even on the initial run when @ViewChild may not be resolved yet.
      const show = this.showUpdateDialog();
      const el = this.updateDialogRef?.nativeElement;
      if (!el) return;
      if (show) {
        if (!el.open) el.showModal();
      } else {
        if (el.open) el.close();
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
        if (health.release_version) this.apiVersion.set(health.release_version);
        if (health.build_date) this.apiBuildDate.set(this.formatApiDate(health.build_date));
      },
    });
  }

  private onUpdateReady(version: string | null): void {
    this.newVersion.set(version);
    this.updateAvailable.set(true);
    this.showUpdateDialog.set(true);
  }

  /** DEV ONLY — simulate an update being ready for style testing. */
  protected devTriggerUpdateDialog(): void {
    this.onUpdateReady('DEV-TEST');
  }

  protected onUpdateNow(): void {
    document.location.reload();
  }

  protected onUpdateLater(): void {
    this.showUpdateDialog.set(false);
    this.laterCount.update((n) => n + 1);

    if (this.reminderTimer !== null) clearTimeout(this.reminderTimer);
    this.reminderTimer = setTimeout(() => {
      this.reminderTimer = null;
      // All postpones used up → silently reload; otherwise remind again.
      if (this.laterCount() >= this.MAX_LATER_COUNT) {
        document.location.reload();
      } else {
        this.showUpdateDialog.set(true);
      }
    }, this.GRACE_PERIOD_MINUTES * 60 * 1000);
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
