import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

const API_URL_STORAGE_KEY = 'cmdr.api.baseUrl';
const LWL_TOKEN_STORAGE_KEY = 'cmdr.auth.lwl.accessToken';
const LWL_USER_STORAGE_KEY = 'cmdr.auth.lwl.userName';
const API_URL_FALLBACKS = [
  typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8080` : '',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
].filter(Boolean);

type AuthMode = 'lwl';

type AuthStatusResponse = {
  enabled: boolean;
  mode?: AuthMode;
};

function getApiBaseCandidates(): string[] {
  const candidates: string[] = [];
  try {
    const stored = localStorage.getItem(API_URL_STORAGE_KEY);
    if (stored) candidates.push(stored.replace(/\/+$/, ''));
  } catch {
    // localStorage unavailable (SSR / private mode edge case)
  }
  candidates.push(...API_URL_FALLBACKS.map((url) => url.replace(/\/+$/, '')));
  return Array.from(new Set(candidates.filter(Boolean)));
}

function resolveApiBaseUrl(): string {
  return getApiBaseCandidates()[0] ?? 'http://localhost:8080';
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);

  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly REFRESH_BEFORE_EXPIRY_S = 5 * 60;

  readonly authRequired = signal<boolean>(true);
  readonly authMode = signal<AuthMode | null>(null);
  readonly authEndpointError = signal<string | null>(null);
  readonly tokenRefreshCount = signal<number>(0);
  readonly nextTokenRefreshAtMs = signal<number | null>(null);

  async initialize(): Promise<void> {
    let statusResolved = false;
    let attemptedEndpoint: string | null = null;
    this.authEndpointError.set(null);
    try {
      for (const apiBase of getApiBaseCandidates()) {
        attemptedEndpoint = apiBase;
        try {
          const resp = await fetch(`${apiBase}/auth/status`, {
            signal: AbortSignal.timeout(3000),
          });
          if (!resp.ok) continue;
          const data = (await resp.json()) as AuthStatusResponse;
          try {
            localStorage.setItem(API_URL_STORAGE_KEY, apiBase);
          } catch {
            // ignore storage failures
          }
          if (!data.enabled) {
            this.authRequired.set(false);
            this.authMode.set(null);
            this.nextTokenRefreshAtMs.set(null);
            this.tokenRefreshCount.set(0);
            return;
          }
          this.authRequired.set(true);
          const mode = (data.mode ?? 'lwl') as AuthMode;
          this.authMode.set(mode);
          statusResolved = true;

          if (!this.isLwlSessionValid()) {
            this.clearLwlSession();
          } else {
            const existing = localStorage.getItem(LWL_TOKEN_STORAGE_KEY);
            if (existing) this.scheduleTokenRefresh(existing);
          }
          return;
        } catch {
          // try next candidate
        }
      }
    } catch {
      // handled below
    }

    if (!statusResolved) {
      // When API status probing fails, keep the local LWL form visible.
      this.authRequired.set(true);
      this.authMode.set('lwl');
      if (!this.isLwlSessionValid()) this.clearLwlSession();
      const endpointLabel = attemptedEndpoint ?? resolveApiBaseUrl();
      this.authEndpointError.set(`API endpoint unavailable: ${endpointLabel}`);
      return;
    }
  }

  get isLoggedIn(): boolean {
    if (!this.authRequired()) return true;
    return this.isLwlSessionValid();
  }

  login(): void {
    if (!this.authRequired()) return;
    void this.router.navigate(['/'], { replaceUrl: true });
  }

  async loginWithPassword(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.authRequired()) return { ok: true };
    if (this.authMode() !== 'lwl') return { ok: false, error: 'LWL login not enabled' };

    const bases = getApiBaseCandidates();
    let lastError = 'Login failed';
    let sawTransportError = false;
    let lastAttemptedBase: string | null = null;
    this.authEndpointError.set(null);
    for (const apiBase of bases) {
      lastAttemptedBase = apiBase;
      let resp: Response;
      try {
        resp = await fetch(`${apiBase}/auth/lwl-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        sawTransportError = true;
        continue;
      }
      if (!resp.ok) {
        let detail = '';
        try {
          const payload = await resp.json() as { detail?: string };
          detail = (payload.detail ?? '').trim();
        } catch {
          const raw = (await resp.text()).trim();
          const looksLikeHtml = /<!doctype|<html/i.test(raw);
          detail = looksLikeHtml ? '' : raw;
        }
        lastError = detail || `Login failed (${resp.status})`;
        // On auth failure, don't keep trying other hosts.
        if (resp.status === 401 || resp.status === 403) {
          this.authEndpointError.set(null);
          return { ok: false, error: lastError };
        }
        const endpointError = `LWL login endpoint failed (${resp.status}): ${apiBase}/auth/lwl-login`;
        this.authEndpointError.set(endpointError);
        lastError = endpointError;
        continue;
      }

      const data = await resp.json() as { access_token?: string; user_name?: string };
      const token = (data.access_token ?? '').trim();
      const userName = (data.user_name ?? username).trim();
      if (!token) return { ok: false, error: 'Login response missing token' };
      localStorage.setItem(LWL_TOKEN_STORAGE_KEY, token);
      localStorage.setItem(LWL_USER_STORAGE_KEY, userName);
      this.tokenRefreshCount.set(0);
      this.authEndpointError.set(null);
      try {
        localStorage.setItem(API_URL_STORAGE_KEY, apiBase);
      } catch {
        // ignore storage failures
      }
      this.scheduleTokenRefresh(token);
      return { ok: true };
    }
    if (sawTransportError) {
      const endpointLabel = `${lastAttemptedBase ?? resolveApiBaseUrl()}/auth/lwl-login`;
      const endpointError = `LWL login endpoint unavailable: ${endpointLabel}`;
      this.authEndpointError.set(endpointError);
      lastError = endpointError;
    }
    return { ok: false, error: lastError };
  }

  logout(): void {
    this.clearLwlSession();
    void this.router.navigate(['/'], { replaceUrl: true });
  }

  get accessToken(): string | null {
    const token = localStorage.getItem(LWL_TOKEN_STORAGE_KEY);
    if (!token) return null;
    if (!this.isLwlTokenValid(token)) {
      this.clearLwlSession();
      return null;
    }
    return token;
  }

  get userName(): string | null {
    const cached = localStorage.getItem(LWL_USER_STORAGE_KEY);
    if (cached) return cached;
    const token = localStorage.getItem(LWL_TOKEN_STORAGE_KEY);
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    return (payload?.['preferred_username'] ?? payload?.['sub'] ?? null) as string | null;
  }

  handleUnauthorized(): void {
    if (!this.authRequired()) return;
    this.clearLwlSession();
    void this.router.navigate(['/'], { replaceUrl: true });
  }

  private isLwlSessionValid(): boolean {
    const token = localStorage.getItem(LWL_TOKEN_STORAGE_KEY);
    if (!token) return false;
    return this.isLwlTokenValid(token);
  }

  private isLwlTokenValid(token: string): boolean {
    const payload = decodeJwtPayload(token);
    if (!payload) return false;
    const exp = Number(payload['exp'] ?? 0);
    if (!Number.isFinite(exp) || exp <= 0) return false;
    return exp > Math.floor(Date.now() / 1000);
  }

  private scheduleTokenRefresh(token: string): void {
    const payload = decodeJwtPayload(token);
    if (!payload) {
      this.nextTokenRefreshAtMs.set(null);
      return;
    }
    const exp = Number(payload['exp'] ?? 0);
    if (!Number.isFinite(exp) || exp <= 0) {
      this.nextTokenRefreshAtMs.set(null);
      return;
    }
    const fireInMs = (exp - Math.floor(Date.now() / 1000) - AuthService.REFRESH_BEFORE_EXPIRY_S) * 1000;
    if (fireInMs <= 0) {
      this.nextTokenRefreshAtMs.set(null);
      return;
    }
    if (this._refreshTimer !== null) clearTimeout(this._refreshTimer);
    this.nextTokenRefreshAtMs.set(Date.now() + fireInMs);
    this._refreshTimer = setTimeout(() => void this.silentRefresh(), fireInMs);
  }

  private async silentRefresh(): Promise<void> {
    this._refreshTimer = null;
    this.nextTokenRefreshAtMs.set(null);
    const token = localStorage.getItem(LWL_TOKEN_STORAGE_KEY);
    if (!token || !this.isLwlTokenValid(token)) return;
    const apiBase = resolveApiBaseUrl();
    try {
      const resp = await fetch(`${apiBase}/auth/lwl-refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        console.warn('[AuthService] Silent token refresh failed:', resp.status);
        return;
      }
      const data = await resp.json() as { access_token?: string };
      const newToken = (data.access_token ?? '').trim();
      if (!newToken) return;
      localStorage.setItem(LWL_TOKEN_STORAGE_KEY, newToken);
      this.tokenRefreshCount.update((count) => count + 1);
      this.scheduleTokenRefresh(newToken);
    } catch (err) {
      console.warn('[AuthService] Silent token refresh error:', err);
    }
  }

  private clearLwlSession(): void {
    if (this._refreshTimer !== null) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    this.nextTokenRefreshAtMs.set(null);
    this.tokenRefreshCount.set(0);
    localStorage.removeItem(LWL_TOKEN_STORAGE_KEY);
    localStorage.removeItem(LWL_USER_STORAGE_KEY);
  }
}
