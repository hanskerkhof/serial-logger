import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CommanderHealthResponse {
  ok: boolean;
  service: string;
  utc: string;
  commander?: {
    expected_fixture_name?: string;
    detected?: boolean;
    detected_fixture_name?: string | null;
    resolver_source?: string;
    probe_elapsed_ms?: number;
    port?: string | null;
    baud?: number | null;
    candidate_ports?: string[];
    proxy?: {
      active?: boolean;
      port?: string | null;
      baud?: number | null;
      event_buffer_size?: number;
      last_event_type?: string | null;
      last_event_at_utc?: string | null;
    };
  };
}

export interface CommanderApiTarget {
  id: string;
  label: string;
  url: string;
}

export interface CommanderQueryResponse {
  ok: boolean;
  [key: string]: unknown;
}

export interface CommanderExposedPlan {
  plan_name: string;
  plan_group: string;
  fixture_count: number;
}

export interface CommanderPlanListResponse {
  ok: boolean;
  service: string;
  count: number;
  plans: CommanderExposedPlan[];
}

export interface CommanderLanGroup {
  plan_group: string;
  universe: number | null;
  universe_count: number;
  fixture_count: number;
  plan_count: number;
  plans: string[];
  fixtures: string[];
}

export interface CommanderLanGroupListResponse {
  ok: boolean;
  service: string;
  count: number;
  lan_groups: CommanderLanGroup[];
}

export interface FixturePlanActionResponse {
  ok: boolean;
  fixture_name: string;
  [key: string]: unknown;
}

export interface RawCommandResponse {
  ok: boolean;
  command_result: {
    command: string;
    request_id: string;
    accepted: boolean;
    serial_error: string | null;
    raw_output: string;
    timing: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface CommanderStreamEvent {
  ts: number;
  type: string;
  seq?: number;
  line?: string;
  request_id?: string;
  port?: string;
  baud?: number;
  [key: string]: unknown;
}

export interface CommanderStreamHandlers {
  onOpen?: () => void;
  onEvent: (event: CommanderStreamEvent) => void;
  onError?: (message: string) => void;
}

const commanderApiUrlStorageKey = 'cmdr.api.baseUrl';
const legacyCommanderApiDefault = 'http://100.88.15.68:8080';
const localhostHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

@Injectable({ providedIn: 'root' })
export class CommanderApiService {
  private readonly http = inject(HttpClient);

  readonly targets: readonly CommanderApiTarget[] = [
    { id: 'macbook', label: 'MacBook', url: 'http://100.88.15.68:8080' },
    { id: 'pi', label: 'Raspberry Pi', url: 'http://100.78.180.13:8080' },
  ];

  readonly apiBaseUrl = signal<string>(this.getInitialApiBaseUrl());

  getHealth(): Observable<CommanderHealthResponse> {
    return this.http.get<CommanderHealthResponse>(`${this.apiBaseUrl()}/health`);
  }

  getFixtureVersion(fixtureName: string): Observable<CommanderQueryResponse> {
    return this.http.get<CommanderQueryResponse>(
      `${this.apiBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/version`,
    );
  }

  getFixtureDiscovery(listenSeconds = 45): Observable<CommanderQueryResponse> {
    return this.http.get<CommanderQueryResponse>(
      `${this.apiBaseUrl()}/fixtures/discovery?listen_seconds=${encodeURIComponent(String(listenSeconds))}`,
    );
  }

  getPlanVersions(planName: string): Observable<CommanderQueryResponse> {
    return this.http.get<CommanderQueryResponse>(
      `${this.apiBaseUrl()}/plans/${encodeURIComponent(planName)}/versions`,
    );
  }

  getExposedPlans(): Observable<CommanderPlanListResponse> {
    return this.http.get<CommanderPlanListResponse>(`${this.apiBaseUrl()}/plans`);
  }

  getLanGroups(): Observable<CommanderLanGroupListResponse> {
    return this.http.get<CommanderLanGroupListResponse>(`${this.apiBaseUrl()}/lan-groups`);
  }

  getPlanGroupVersions(planGroup: string): Observable<CommanderQueryResponse> {
    return this.http.get<CommanderQueryResponse>(
      `${this.apiBaseUrl()}/plan-groups/${encodeURIComponent(planGroup)}/versions`,
    );
  }

  runFixtureCommand(
    fixtureName: string,
    command: string,
  ): Observable<FixturePlanActionResponse> {
    return this.http.post<FixturePlanActionResponse>(
      `${this.apiBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/cmd`,
      { command },
    );
  }

  postRawCommand(command: string, listenSeconds = 3.0): Observable<RawCommandResponse> {
    return this.http.post<RawCommandResponse>(`${this.apiBaseUrl()}/commander/raw`, {
      command,
      listen_seconds: listenSeconds,
    });
  }

  openCommanderStream(
    apiBaseUrl: string,
    handlers: CommanderStreamHandlers,
  ): () => void {
    const source = new EventSource(`${apiBaseUrl}/commander/stream`);

    const handleMessage = (event: MessageEvent, forcedType?: string) => {
      try {
        const parsed = JSON.parse(String(event.data ?? '{}')) as CommanderStreamEvent;
        if (forcedType && !parsed.type) parsed.type = forcedType;
        handlers.onEvent(parsed);
      } catch {
        handlers.onError?.('Invalid SSE payload from commander stream');
      }
    };

    source.onopen = () => handlers.onOpen?.();
    source.onerror = () => handlers.onError?.('Commander stream disconnected');

    const eventTypes = [
      'connected',
      'heartbeat',
      'serial_open',
      'serial_close',
      'command_start',
      'command_done',
      'command_error',
      'tx_line',
      'rx_line',
    ] as const;

    for (const eventType of eventTypes) {
      source.addEventListener(eventType, (event) =>
        handleMessage(event as MessageEvent, eventType),
      );
    }

    source.onmessage = (event) => handleMessage(event);

    return () => source.close();
  }

  setApiBaseUrl(value: string): boolean {
    const normalized = this.normalizeApiBaseUrl(value);
    if (!normalized) return false;

    this.apiBaseUrl.set(normalized);
    this.persistApiBaseUrl(normalized);

    return true;
  }

  private getInitialApiBaseUrl(): string {
    const sameHostDefault = this.getSameHostApiBaseUrl();
    const presetDefault = this.targets[0]?.url ?? legacyCommanderApiDefault;
    const fallbackDefault = sameHostDefault ?? presetDefault;

    try {
      const stored = localStorage.getItem(commanderApiUrlStorageKey);
      const normalizedStored = this.normalizeApiBaseUrl(stored);
      if (normalizedStored) {
        // Migrate old persisted default from earlier builds to same-host API
        // when app is served by CMDR API (Pi/Mac over :8080).
        if (
          normalizedStored === legacyCommanderApiDefault &&
          sameHostDefault &&
          sameHostDefault !== legacyCommanderApiDefault
        ) {
          this.persistApiBaseUrl(sameHostDefault);
          return sameHostDefault;
        }
        return normalizedStored;
      }
    } catch {
      // localStorage unavailable; use runtime default below.
    }

    this.persistApiBaseUrl(fallbackDefault);
    return fallbackDefault;
  }

  private getSameHostApiBaseUrl(): string | null {
    if (typeof window === 'undefined') return null;

    const host = (window.location.hostname || '').toLowerCase();
    if (localhostHosts.has(host)) return null;

    return this.normalizeApiBaseUrl(window.location.origin);
  }

  private persistApiBaseUrl(value: string): void {
    try {
      localStorage.setItem(commanderApiUrlStorageKey, value);
    } catch {
      // Persistence is optional.
    }
  }

  private normalizeApiBaseUrl(value: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    let candidate = trimmed;
    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `http://${candidate}`;
    }

    try {
      const parsed = new URL(candidate);
      if (!/^https?:$/i.test(parsed.protocol)) return null;

      const pathname = parsed.pathname.replace(/\/+$/, '');
      return `${parsed.protocol}//${parsed.host}${pathname}`;
    } catch {
      return null;
    }
  }
}
