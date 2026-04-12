import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { CommanderApiService, CommanderHealthResponse } from './commander-api.service';

export interface PlanStateWsMessage {
  type: 'plan_state';
  fixture_name: string;
  plan_state?: unknown;
  state?: unknown;
  received_at?: string;
  summary?: {
    fixture_name?: string;
    plan_state?: unknown;
    source?: string;
    fsps?: unknown;
  };
  timing?: unknown;
  interval_ms?: number;
  utc?: string;
}

export interface PlanStateWsErrorMessage {
  type: 'plan_state_error';
  reason: string;
  detail?: string;
  fixture_name?: string;
  active_subscribers?: number;
  max_subscribers?: number;
  utc?: string;
}

export interface DiscoveryWsMessage {
  type:
    | 'discovery_started'
    | 'discovery_fixture_upsert'
    | 'discovery_progress'
    | 'discovery_completed'
    | 'discovery_failed'
    | 'discovery_rejected'
    | 'discovery_cancel_requested'
    | 'discovery_cancelled';
  [key: string]: unknown;
}

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
  private readonly _nextHealthPollAt = signal(0);
  private readonly _lastHealthAt = signal<number | null>(null);
  private readonly _now = signal(Date.now());

  // Public read-only interface — components alias these rather than their own signals
  readonly health: Signal<CommanderHealthResponse | null> = this._health.asReadonly();
  readonly healthRefreshing: Signal<boolean> = this._healthRefreshing.asReadonly();
  readonly healthError: Signal<string | null> = this._healthError.asReadonly();
  readonly nextHealthPollAt: Signal<number> = this._nextHealthPollAt.asReadonly();

  /**
   * Seconds until next reconnect attempt (counts down when offline/reconnecting).
   * Returns 0 when the WebSocket is connected and health is live.
   */
  readonly nextHealthPollCountdown = computed(() =>
    Math.max(0, Math.ceil((this._nextHealthPollAt() - this._now()) / 1000)),
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
  /** Emits on every failed health request / WebSocket disconnect. */
  readonly healthFailed$ = new Subject<void>();
  /** Emits every 30 s for SW update checks (independent of WS state). */
  readonly pollCycle$ = new Subject<void>();
  /** Emits live fixture plan-state updates pushed over /health/ws. */
  readonly planState$ = new Subject<PlanStateWsMessage>();
  /** Emits backend push errors for plan-state subscriptions (e.g. overload). */
  readonly planStateError$ = new Subject<PlanStateWsErrorMessage>();
  /** Emits live discovery events pushed over /health/ws. */
  readonly discovery$ = new Subject<DiscoveryWsMessage>();

  private _ws: WebSocket | null = null;
  private _wsRetryDelayMs = HealthPollService.HEALTH_INITIAL_RETRY_MS;
  private _wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private _started = false;
  private _planStateFixtureName: string | null = null;
  private _planStateIntervalMs: number | null = null;
  private _planStateSubscribedFixtureName: string | null = null;
  private _planStateSubscribedIntervalMs: number | null = null;

  constructor() {
    // Single 1 s clock ticker drives both nextHealthPollCountdown and secondsSinceHealthCheck.
    setInterval(() => this._now.set(Date.now()), 1000);
  }

  /**
   * Open the WebSocket connection and start the 30 s pollCycle$ interval for SW update checks.
   * Call exactly once (from AppComponent constructor). Subsequent calls are no-ops.
   */
  startPolling(): void {
    if (this._started) return;
    this._started = true;
    this._connect();
    // Keep pollCycle$ firing every 30 s for SW update checks regardless of WS state.
    setInterval(() => this.pollCycle$.next(), HealthPollService.HEALTH_POLL_MS);
  }

  /**
   * Send a ping over the open WebSocket — server responds with a fresh health payload.
   * No-op when the socket is not open (offline state is already shown in the UI).
   */
  refresh(): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._healthRefreshing.set(true);
      this._ws.send(JSON.stringify({ type: 'ping' }));
    }
  }

  subscribePlanState(fixtureName: string, intervalMs?: number | null): void {
    const normalized = String(fixtureName || '').trim();
    if (!normalized) return;
    const normalizedInterval =
      typeof intervalMs === 'number' && Number.isFinite(intervalMs) && intervalMs >= 25
        ? Math.round(intervalMs)
        : null;
    if (
      this._planStateFixtureName === normalized &&
      this._planStateSubscribedFixtureName === normalized &&
      this._planStateIntervalMs === normalizedInterval &&
      this._planStateSubscribedIntervalMs === normalizedInterval
    ) {
      return;
    }
    this._planStateFixtureName = normalized;
    this._planStateIntervalMs = normalizedInterval;
    this._sendPlanStateSubscribe();
  }

  unsubscribePlanState(): void {
    if (!this._planStateFixtureName && !this._planStateSubscribedFixtureName) return;
    this._planStateFixtureName = null;
    this._planStateIntervalMs = null;
    this._planStateSubscribedFixtureName = null;
    this._planStateSubscribedIntervalMs = null;
    this._sendWsMessage({ type: 'plan_state_unsubscribe' });
  }

  /**
   * Reset exponential backoff, clear stale data, and reconnect immediately.
   * Use when the API URL changes or the user retries after a prolonged outage.
   */
  retryHealth(): void {
    this._wsRetryDelayMs = HealthPollService.HEALTH_INITIAL_RETRY_MS;
    this._health.set(null);
    this._healthError.set(null);
    if (this._ws) {
      this._ws.onclose = null; // suppress the scheduled reconnect from the old socket
      this._ws.close();
      this._ws = null;
    }
    if (this._wsRetryTimer !== null) {
      clearTimeout(this._wsRetryTimer);
      this._wsRetryTimer = null;
    }
    this._connect();
  }

  private _connect(): void {
    this._healthRefreshing.set(true);
    const ws = this.commanderApi.openHealthWebSocket();
    this._ws = ws;

    ws.onopen = () => {
      if (ws !== this._ws) return; // stale socket — a newer connection superseded this one
      // Reset backoff on successful connection; payload arrives via onmessage.
      this._wsRetryDelayMs = HealthPollService.HEALTH_INITIAL_RETRY_MS;
      this._nextHealthPollAt.set(0); // no pending reconnect countdown
      this._planStateSubscribedFixtureName = null;
      this._planStateSubscribedIntervalMs = null;
      this._sendPlanStateSubscribe();
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (ws !== this._ws) return; // stale socket
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data as string) as Record<string, unknown>;
      } catch {
        return;
      }
      if (data?.['type'] === 'heartbeat') {
        // Heartbeat keeps "X s ago" counter fresh — no UI state change needed.
        this._lastHealthAt.set(Date.now());
        return;
      }
      const hasFlattenedPlanStateShape =
        typeof data?.['fixture_name'] === 'string' &&
        (Object.prototype.hasOwnProperty.call(data, 'plan_state') || Object.prototype.hasOwnProperty.call(data, 'state'));
      if (data?.['type'] === 'plan_state' || hasFlattenedPlanStateShape) {
        this.planState$.next(data as unknown as PlanStateWsMessage);
        return;
      }
      if (data?.['type'] === 'plan_state_error') {
        this.planStateError$.next(data as unknown as PlanStateWsErrorMessage);
        return;
      }
      if (data?.['type'] === 'plan_state_subscribed' || data?.['type'] === 'plan_state_unsubscribed') {
        return;
      }
      if (typeof data?.['type'] === 'string' && data['type'].startsWith('discovery_')) {
        this.discovery$.next(data as DiscoveryWsMessage);
        return;
      }
      const wasOffline = this._healthError() !== null;
      this._health.set(data as unknown as CommanderHealthResponse);
      this._healthError.set(null);
      this._healthRefreshing.set(false);
      this._lastHealthAt.set(Date.now());
      this.healthSuccess$.next({ result: data as unknown as CommanderHealthResponse, wasOffline });
    };

    ws.onerror = () => {
      // All error states are handled in onclose which always fires after onerror.
    };

    ws.onclose = () => {
      if (ws !== this._ws) return; // stale socket — don't overwrite healthy state
      this._ws = null;
      this._planStateSubscribedFixtureName = null;
      this._healthRefreshing.set(false);
      this._healthError.set('API unreachable');
      this.healthFailed$.next();
      this._scheduleReconnect();
    };
  }

  private _scheduleReconnect(): void {
    if (this._wsRetryTimer !== null) clearTimeout(this._wsRetryTimer);
    this._nextHealthPollAt.set(Date.now() + this._wsRetryDelayMs);
    this._wsRetryTimer = setTimeout(() => {
      this._wsRetryTimer = null;
      this._connect();
    }, this._wsRetryDelayMs);
    this._wsRetryDelayMs = Math.min(
      this._wsRetryDelayMs * 2,
      HealthPollService.HEALTH_MAX_RETRY_MS,
    );
  }

  private _sendPlanStateSubscribe(): void {
    const fixture = this._planStateFixtureName;
    if (!fixture) return;
    if (
      this._planStateSubscribedFixtureName === fixture &&
      this._planStateSubscribedIntervalMs === this._planStateIntervalMs &&
      this._ws?.readyState === WebSocket.OPEN
    ) {
      return;
    }
    const payload: Record<string, unknown> = {
      type: 'plan_state_subscribe',
      fixture_name: fixture,
    };
    if (this._planStateIntervalMs !== null) {
      payload['interval_ms'] = this._planStateIntervalMs;
    }
    this._sendWsMessage(payload);
    this._planStateSubscribedFixtureName = fixture;
    this._planStateSubscribedIntervalMs = this._planStateIntervalMs;
  }

  private _sendWsMessage(payload: unknown): void {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    try {
      this._ws.send(JSON.stringify(payload));
    } catch {
      // best effort only
    }
  }
}
