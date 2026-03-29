import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { CommanderApiService, CommanderHealthResponse } from './commander-api.service';

@Injectable({ providedIn: 'root' })
export class HealthPollService {
  private static readonly HEALTH_POLL_MS = 30_000;
  private static readonly HEALTH_INITIAL_RETRY_MS = 3_000;
  private static readonly HEALTH_MAX_RETRY_MS = 30_000;

  private readonly commanderApi = inject(CommanderApiService);

  // Internal writable signals — only service methods call .set()
  private readonly _health = signal<CommanderHealthResponse | null>(null);
  private readonly _healthRefreshing = signal(false);
  private readonly _healthError = signal<string | null>(null);
  private readonly _nextHealthPollAt = signal(Date.now() + HealthPollService.HEALTH_POLL_MS);
  private readonly _lastHealthAt = signal<number | null>(null);
  private readonly _now = signal(Date.now());

  // Public read-only interface — components alias these rather than their own signals
  readonly health: Signal<CommanderHealthResponse | null> = this._health.asReadonly();
  readonly healthRefreshing: Signal<boolean> = this._healthRefreshing.asReadonly();
  readonly healthError: Signal<string | null> = this._healthError.asReadonly();
  readonly nextHealthPollAt: Signal<number> = this._nextHealthPollAt.asReadonly();

  /** Seconds until next scheduled poll. */
  readonly nextHealthPollCountdown = computed(() =>
    Math.max(0, Math.round((this._nextHealthPollAt() - this._now()) / 1000)),
  );

  /** Seconds since the last successful health response, or null before the first success. */
  readonly secondsSinceHealthCheck = computed<number | null>(() => {
    const last = this._lastHealthAt();
    if (last === null) return null;
    return Math.floor((this._now() - last) / 1000);
  });

  // Observable hooks — let components react to health lifecycle events without
  // the service needing to know about component-specific concerns (loading state,
  // auto-discovery, recovery callbacks, SW update checks).
  /** Emits on every successful health response; includes whether previous state was offline. */
  readonly healthSuccess$ = new Subject<{ result: CommanderHealthResponse; wasOffline: boolean }>();
  /** Emits on every failed health request. */
  readonly healthFailed$ = new Subject<void>();
  /** Emits just before each timer-triggered poll cycle (not on manual refresh calls). */
  readonly pollCycle$ = new Subject<void>();

  private healthPollTimer: ReturnType<typeof setTimeout> | null = null;
  private healthRetryDelayMs = HealthPollService.HEALTH_INITIAL_RETRY_MS;
  private _started = false;

  constructor() {
    // Single 1 s clock ticker drives both nextHealthPollCountdown and secondsSinceHealthCheck.
    // Services are root singletons — the timer runs for the app lifetime.
    setInterval(() => this._now.set(Date.now()), 1000);
  }

  /**
   * Trigger the first health fetch and start the 30 s poll cycle.
   * Call exactly once (from AppComponent constructor). Subsequent calls are no-ops.
   */
  startPolling(): void {
    if (this._started) return;
    this._started = true;
    this.loadHealth();
  }

  /** Cancel the pending timer and immediately fire a refresh (keeps existing data visible). */
  refresh(): void {
    this.cancelHealthPollTimer();
    this.loadHealth();
  }

  /**
   * Reset exponential backoff, clear stale data, and fire an immediate reload.
   * Use when the API URL changes or the user retries after a prolonged outage.
   */
  retryHealth(): void {
    this.healthRetryDelayMs = HealthPollService.HEALTH_INITIAL_RETRY_MS;
    this._health.set(null);
    this._healthError.set(null);
    this.cancelHealthPollTimer();
    this.loadHealth();
  }

  private loadHealth(): void {
    this._healthRefreshing.set(true);
    const wasOffline = this._healthError() !== null;

    this.commanderApi.getHealth().subscribe({
      next: (result) => {
        this._health.set(result);
        this._healthError.set(null);
        this._healthRefreshing.set(false);
        this._lastHealthAt.set(Date.now());
        this.healthRetryDelayMs = HealthPollService.HEALTH_INITIAL_RETRY_MS;
        this.startHealthPollTimer();
        this.healthSuccess$.next({ result, wasOffline });
      },
      error: () => {
        this._healthError.set('API unreachable');
        this._healthRefreshing.set(false);
        this.startHealthPollTimer(this.healthRetryDelayMs);
        this.healthRetryDelayMs = Math.min(
          this.healthRetryDelayMs * 2,
          HealthPollService.HEALTH_MAX_RETRY_MS,
        );
        this.healthFailed$.next();
      },
    });
  }

  private startHealthPollTimer(delayMs = HealthPollService.HEALTH_POLL_MS): void {
    this.cancelHealthPollTimer();
    this._nextHealthPollAt.set(Date.now() + delayMs);
    this.healthPollTimer = setTimeout(() => {
      this.healthPollTimer = null;
      if (!this._healthRefreshing()) {
        this.pollCycle$.next();
        this.loadHealth();
      }
    }, delayMs);
  }

  private cancelHealthPollTimer(): void {
    if (this.healthPollTimer !== null) {
      clearTimeout(this.healthPollTimer);
      this.healthPollTimer = null;
    }
  }
}
