import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CommanderHealthResponse {
  ok: boolean;
  service: string;
  utc: string;
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

const commanderApiUrlStorageKey = 'cmdr.api.baseUrl';
const defaultCommanderApiUrl = 'http://100.88.15.68:8080';

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

  setApiBaseUrl(value: string): boolean {
    const normalized = this.normalizeApiBaseUrl(value);
    if (!normalized) return false;

    this.apiBaseUrl.set(normalized);

    try {
      localStorage.setItem(commanderApiUrlStorageKey, normalized);
    } catch {
      // Keep runtime value even if persistence is unavailable.
    }

    return true;
  }

  private getInitialApiBaseUrl(): string {
    try {
      const stored = localStorage.getItem(commanderApiUrlStorageKey);
      return this.normalizeApiBaseUrl(stored) ?? defaultCommanderApiUrl;
    } catch {
      return defaultCommanderApiUrl;
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
