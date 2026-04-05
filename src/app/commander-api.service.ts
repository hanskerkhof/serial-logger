import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
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
  CmdrMessagesResponse,
  CmdrFixtureDocsListResponse,
  CmdrFixturePlanStatusResponse,
} from './api/cmdr-models';
import { AuthService } from './auth/auth.service';
import { SKIP_AUTH_HEADER } from './auth/auth-http-interceptor';

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
  private readonly authService = inject(AuthService);

  readonly targets: readonly CommanderApiTarget[] = [
    { id: 'macbook', label: 'MacBook', url: 'http://100.88.15.68:8080' },
    { id: 'pi', label: 'Raspberry Pi', url: 'http://100.78.180.13:8080' },
  ];

  readonly apiBaseUrl = signal<string>(this.getInitialApiBaseUrl());

  private getRequestBaseUrl(explicitBaseUrl?: string): string {
    const rawBaseUrl = explicitBaseUrl ?? this.apiBaseUrl();
    if (typeof window === 'undefined' || window.location.protocol !== 'https:') return rawBaseUrl;

    try {
      const parsed = new URL(rawBaseUrl);
      if (parsed.protocol === 'http:') parsed.protocol = 'https:';
      const pathname = parsed.pathname.replace(/\/+$/, '');
      return `${parsed.protocol}//${parsed.host}${pathname}`;
    } catch {
      return rawBaseUrl;
    }
  }

  getHealth(): Observable<CmdrHealthResponse> {
    return this.http.get<CmdrHealthResponse>(`${this.getRequestBaseUrl()}/health`);
  }

  /** Open the /health/ws WebSocket. HealthPollService owns the lifetime. */
  openHealthWebSocket(): WebSocket {
    const base = this.getRequestBaseUrl().replace(/^http/i, 'ws');
    return new WebSocket(`${base}/health/ws`);
  }

  getFixtureVersion(
    fixtureName: string,
    options?: { preferQueryTokenAuth?: boolean },
  ): Observable<CmdrVersionsResponse> {
    const baseUrl = `${this.getRequestBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/version`;
    const preferQueryTokenAuth = options?.preferQueryTokenAuth === true;
    const token = preferQueryTokenAuth ? this.authService.accessToken : null;
    if (preferQueryTokenAuth && token) {
      const url = `${baseUrl}?token=${encodeURIComponent(token)}`;
      return this.http.get<CmdrVersionsResponse>(url, {
        context: new HttpContext().set(SKIP_AUTH_HEADER, true),
      });
    }
    return this.http.get<CmdrVersionsResponse>(baseUrl);
  }

  getFixturePlanStatus(
    fixtureName: string,
    options?: { preferQueryTokenAuth?: boolean },
  ): Observable<CmdrFixturePlanStatusResponse> {
    const baseUrl = `${this.getRequestBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/plan-status`;
    const preferQueryTokenAuth = options?.preferQueryTokenAuth === true;
    const token = preferQueryTokenAuth ? this.authService.accessToken : null;
    if (preferQueryTokenAuth && token) {
      const url = `${baseUrl}?token=${encodeURIComponent(token)}`;
      return this.http.get<CmdrFixturePlanStatusResponse>(url, {
        context: new HttpContext().set(SKIP_AUTH_HEADER, true),
      });
    }
    return this.http.get<CmdrFixturePlanStatusResponse>(baseUrl);
  }

  getFixtureDiscovery(listenSeconds = 60): Observable<CmdrDiscoveryResponse> {
    return this.http.get<CmdrDiscoveryResponse>(
      `${this.getRequestBaseUrl()}/fixtures/discovery?listen_seconds=${encodeURIComponent(String(listenSeconds))}`,
    );
  }

  startFixtureDiscoveryWs(listenSeconds = 60): Observable<{ ok: boolean; status: string; mode: string; session_id: string; listen_seconds: number }> {
    return this.http.post<{ ok: boolean; status: string; mode: string; session_id: string; listen_seconds: number }>(
      `${this.getRequestBaseUrl()}/fixtures/discovery/ws-start?listen_seconds=${encodeURIComponent(String(listenSeconds))}`,
      {},
    );
  }

  getPlanVersions(planName: string): Observable<CmdrVersionsResponse> {
    return this.http.get<CmdrVersionsResponse>(
      `${this.getRequestBaseUrl()}/plans/${encodeURIComponent(planName)}/versions`,
    );
  }

  getExposedPlans(): Observable<CmdrPlansResponse> {
    return this.http.get<CmdrPlansResponse>(`${this.getRequestBaseUrl()}/plans`);
  }

  getLanGroups(): Observable<CmdrPlanGroupsResponse> {
    return this.http.get<CmdrPlanGroupsResponse>(`${this.getRequestBaseUrl()}/plan-groups`);
  }

  getPlanGroupVersions(planGroup: string): Observable<CmdrVersionsResponse> {
    return this.http.get<CmdrVersionsResponse>(
      `${this.getRequestBaseUrl()}/plan-groups/${encodeURIComponent(planGroup)}/versions`,
    );
  }

  getPlanPlayerTracks(planName: string): Observable<{ plan_name: string; tracks: { index: number; name: string; duration_ms: number }[] }> {
    return this.http.get<{ plan_name: string; tracks: { index: number; name: string; duration_ms: number }[] }>(
      `${this.getRequestBaseUrl()}/plans/${encodeURIComponent(planName)}/player/tracks`,
    );
  }

  runFixtureCommand(
    fixtureName: string,
    command: string,
  ): Observable<CmdrFixtureCommandResponse> {
    return this.http.post<CmdrFixtureCommandResponse>(
      `${this.getRequestBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/cmd`,
      { command },
    );
  }

  postOtaUpdate(fixtureName: string): Observable<{ ok: boolean; fixture_name: string; status: string }> {
    return this.http.post<{ ok: boolean; fixture_name: string; status: string }>(
      `${this.getRequestBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/ota-update`,
      {},
    );
  }

  postFixtureRssiSession(
    fixtureName: string,
    durationMs = 60000,
  ): Observable<CmdrFixtureCommandResponse> {
    return this.http.post<CmdrFixtureCommandResponse>(
      `${this.getRequestBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/rssi-session?duration_ms=${durationMs}`,
      {},
    );
  }

  postRawCommand(command: string, listenSeconds = 3.0): Observable<CmdrRawResponse> {
    return this.http.post<CmdrRawResponse>(`${this.getRequestBaseUrl()}/commander/raw`, {
      command,
      listen_seconds: listenSeconds,
    });
  }

  getReleaseNotes(limit = 10, offset = 0): Observable<CmdrMessagesResponse> {
    return this.http.get<CmdrMessagesResponse>(
      `${this.getRequestBaseUrl()}/messages/release-notes?limit=${limit}&offset=${offset}`,
    );
  }

  getFixtureDocs(fixtureName: string): Observable<CmdrFixtureDocsListResponse> {
    return this.http.get<CmdrFixtureDocsListResponse>(
      `${this.getRequestBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/docs`,
    );
  }

  getFixtureDocContent(fixtureName: string, filename: string): Observable<string> {
    return this.http.get(
      `${this.getRequestBaseUrl()}/fixtures/${encodeURIComponent(fixtureName)}/docs/${encodeURIComponent(filename)}`,
      { responseType: 'text' },
    );
  }

  openCommanderStream(
    apiBaseUrl: string,
    handlers: CommanderStreamHandlers,
  ): () => void {
    const accessToken = this.authService.accessToken;
    const streamUrl = `${this.getRequestBaseUrl(apiBaseUrl)}/commander/stream${accessToken ? `?token=${encodeURIComponent(accessToken)}` : ''}`;
    const source = new EventSource(streamUrl);

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

  /** Returns `?token=<encoded>` when a valid access token exists, otherwise `''`. */
  tokenQueryParam(): string {
    const token = this.authService.accessToken;
    return token ? `?token=${encodeURIComponent(token)}` : '';
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
