import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  CmdrHealthResponse,
  CmdrExposedPlan,
  CmdrPlansResponse,
  CmdrLanGroup,
  CmdrPlanGroupsResponse,
  CmdrFixtureCommandResponse,
  CmdrRawResponse,
  CmdrVersionsResponse,
  CmdrDiscoveryResponse,
  CmdrQueryResponse,
} from './api/cmdr-models';

// Re-export generated-type aliases under legacy names so existing component imports are unchanged.
export type CommanderHealthResponse       = CmdrHealthResponse;
export type CommanderExposedPlan          = CmdrExposedPlan;
export type CommanderPlanListResponse     = CmdrPlansResponse;
export type CommanderLanGroup             = CmdrLanGroup;
export type CommanderLanGroupListResponse = CmdrPlanGroupsResponse;
export type FixturePlanActionResponse     = CmdrFixtureCommandResponse;
export type RawCommandResponse            = CmdrRawResponse;
/** Union of VersionsResponse | DiscoveryResponse — covers all query endpoints. */
export type CommanderQueryResponse        = CmdrQueryResponse;

// --- SSE types (not in OpenAPI — kept manual) ---

export interface CommanderApiTarget {
  id: string;
  label: string;
  url: string;
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

// OTA update stream events — pushed to /commander/stream by the API background task
export interface OtaStreamEvent {
  step: 'compiling' | 'uploading' | 'verifying' | 'complete' | 'error';
  fixture_name: string;
  message?: string;
  fw_version?: string; // present on 'complete'
  error?: string;      // present on 'error'
}

export interface CommanderStreamHandlers {
  onOpen?: () => void;
  onEvent: (event: CommanderStreamEvent) => void;
  onError?: (message: string) => void;
  ota_progress?: (event: OtaStreamEvent) => void;
  ota_complete?: (event: OtaStreamEvent) => void;
  ota_error?: (event: OtaStreamEvent) => void;
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

  getHealth(): Observable<CmdrHealthResponse> {
    return this.http.get<CmdrHealthResponse>(`${this.apiBaseUrl()}/health`);
  }

  getFixtureVersion(fixtureName: string): Observable<CmdrVersionsResponse> {
    return this.http.get<CmdrVersionsResponse>(
      `${this.apiBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/version`,
    );
  }

  getFixtureDiscovery(listenSeconds = 60): Observable<CmdrDiscoveryResponse> {
    return this.http.get<CmdrDiscoveryResponse>(
      `${this.apiBaseUrl()}/fixtures/discovery?listen_seconds=${encodeURIComponent(String(listenSeconds))}`,
    );
  }

  getPlanVersions(planName: string): Observable<CmdrVersionsResponse> {
    return this.http.get<CmdrVersionsResponse>(
      `${this.apiBaseUrl()}/plans/${encodeURIComponent(planName)}/versions`,
    );
  }

  getExposedPlans(): Observable<CmdrPlansResponse> {
    return this.http.get<CmdrPlansResponse>(`${this.apiBaseUrl()}/plans`);
  }

  getLanGroups(): Observable<CmdrPlanGroupsResponse> {
    return this.http.get<CmdrPlanGroupsResponse>(`${this.apiBaseUrl()}/plan-groups`);
  }

  getPlanGroupVersions(planGroup: string): Observable<CmdrVersionsResponse> {
    return this.http.get<CmdrVersionsResponse>(
      `${this.apiBaseUrl()}/plan-groups/${encodeURIComponent(planGroup)}/versions`,
    );
  }

  runFixtureCommand(
    fixtureName: string,
    command: string,
  ): Observable<CmdrFixtureCommandResponse> {
    return this.http.post<CmdrFixtureCommandResponse>(
      `${this.apiBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/cmd`,
      { command },
    );
  }

  postOtaUpdate(fixtureName: string): Observable<{ ok: boolean; fixture_name: string; status: string }> {
    return this.http.post<{ ok: boolean; fixture_name: string; status: string }>(
      `${this.apiBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/ota-update`,
      {},
    );
  }

  postFixtureRssiSession(
    fixtureName: string,
    durationMs = 60000,
  ): Observable<CmdrFixtureCommandResponse> {
    return this.http.post<CmdrFixtureCommandResponse>(
      `${this.apiBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/rssi-session?duration_ms=${durationMs}`,
      {},
    );
  }

  postRawCommand(command: string, listenSeconds = 3.0): Observable<CmdrRawResponse> {
    return this.http.post<CmdrRawResponse>(`${this.apiBaseUrl()}/commander/raw`, {
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
      'commander_state',
      'commander_online',
      'commander_offline',
      'commander_probing',
      'commander_reconnecting',
      'commander_invalid_device',
      'commander_port_changed',
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

    // OTA update events — pushed by background task into the commander stream
    const parseOtaEvent = (event: Event): OtaStreamEvent | null => {
      try {
        return JSON.parse(String((event as MessageEvent).data ?? '{}')) as OtaStreamEvent;
      } catch {
        return null;
      }
    };
    if (handlers.ota_progress) {
      const h = handlers.ota_progress;
      source.addEventListener('ota_progress', (e) => { const d = parseOtaEvent(e); if (d) h(d); });
    }
    if (handlers.ota_complete) {
      const h = handlers.ota_complete;
      source.addEventListener('ota_complete', (e) => { const d = parseOtaEvent(e); if (d) h(d); });
    }
    if (handlers.ota_error) {
      const h = handlers.ota_error;
      source.addEventListener('ota_error', (e) => { const d = parseOtaEvent(e); if (d) h(d); });
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
