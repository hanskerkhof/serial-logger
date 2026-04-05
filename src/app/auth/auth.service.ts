import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { authConfig } from './auth.config';

const API_URL_STORAGE_KEY = 'cmdr.api.baseUrl';
const LWL_TOKEN_STORAGE_KEY = 'cmdr.auth.lwl.accessToken';
const LWL_USER_STORAGE_KEY = 'cmdr.auth.lwl.userName';
const API_URL_FALLBACKS = [
  typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8080` : '',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
].filter(Boolean);

type AuthMode = 'zitadel' | 'lwl';

type AuthStatusResponse = {
  enabled: boolean;
  mode?: AuthMode;
  issuer?: string;
  client_id?: string;
};

function resolveApiBaseUrl(): string {
  try {
    const stored = localStorage.getItem(API_URL_STORAGE_KEY);
    if (stored) return stored.replace(/\/+$/, '');
  } catch {
    // localStorage unavailable (SSR / private mode edge case)
  }
  return API_URL_FALLBACKS[0] ?? 'http://localhost:8080';
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
  private readonly oauthService = inject(OAuthService);
  private readonly router = inject(Router);

  readonly authRequired = signal<boolean>(true);
  readonly authMode = signal<AuthMode | null>(null);

  async initialize(): Promise<void> {
    let oidcConfig = { ...authConfig };
    try {
      const apiBase = resolveApiBaseUrl();
      const resp = await fetch(`${apiBase}/auth/status`);
      if (resp.ok) {
        const data = (await resp.json()) as AuthStatusResponse;
        if (!data.enabled) {
          this.authRequired.set(false);
          this.authMode.set(null);
          return;
        }
        this.authRequired.set(true);
        const mode = (data.mode ?? 'zitadel') as AuthMode;
        this.authMode.set(mode);

        if (mode === 'lwl') {
          // Keep Light Weight Login token flow local, no OIDC bootstrap needed.
          if (!this.isLwlSessionValid()) this.clearLwlSession();
          return;
        }

        if (data.issuer) oidcConfig = { ...oidcConfig, issuer: data.issuer };
        if (data.client_id) oidcConfig = { ...oidcConfig, clientId: data.client_id };
      }
    } catch {
      // API unreachable at startup — preserve historical behavior.
      this.authMode.set('zitadel');
    }

    this.oauthService.configure(oidcConfig);
    try {
      await this.oauthService.loadDiscoveryDocumentAndTryLogin();
    } catch {
      console.warn('[AuthService] Could not reach OIDC discovery endpoint — Zitadel not running?');
      return;
    }
    this.oauthService.setupAutomaticSilentRefresh();
  }

  get isLoggedIn(): boolean {
    if (!this.authRequired()) return true;
    if (this.authMode() === 'lwl') return this.isLwlSessionValid();
    return this.oauthService.hasValidAccessToken();
  }

  login(): void {
    if (!this.authRequired()) return;
    if (this.authMode() === 'lwl') {
      void this.router.navigate(['/'], { replaceUrl: true });
      return;
    }
    this.oauthService.initCodeFlow();
  }

  async loginWithPassword(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.authRequired()) return { ok: true };
    if (this.authMode() !== 'lwl') return { ok: false, error: 'LWL login not enabled' };

    const apiBase = resolveApiBaseUrl();
    const resp = await fetch(`${apiBase}/auth/lwl-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      let detail = '';
      try {
        const payload = await resp.json() as { detail?: string };
        detail = (payload.detail ?? '').trim();
      } catch {
        const raw = (await resp.text()).trim();
        detail = raw;
      }
      return { ok: false, error: detail || `Login failed (${resp.status})` };
    }

    const data = await resp.json() as { access_token?: string; user_name?: string };
    const token = (data.access_token ?? '').trim();
    const userName = (data.user_name ?? username).trim();
    if (!token) return { ok: false, error: 'Login response missing token' };

    localStorage.setItem(LWL_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(LWL_USER_STORAGE_KEY, userName);
    return { ok: true };
  }

  logout(): void {
    if (this.authMode() === 'lwl') {
      this.clearLwlSession();
      void this.router.navigate(['/'], { replaceUrl: true });
      return;
    }
    this.oauthService.logOut();
  }

  get accessToken(): string | null {
    if (this.authMode() === 'lwl') {
      const token = localStorage.getItem(LWL_TOKEN_STORAGE_KEY);
      if (!token) return null;
      if (!this.isLwlTokenValid(token)) {
        this.clearLwlSession();
        return null;
      }
      return token;
    }
    return this.oauthService.getAccessToken() || null;
  }

  get userName(): string | null {
    if (this.authMode() === 'lwl') {
      const cached = localStorage.getItem(LWL_USER_STORAGE_KEY);
      if (cached) return cached;
      const token = localStorage.getItem(LWL_TOKEN_STORAGE_KEY);
      if (!token) return null;
      const payload = decodeJwtPayload(token);
      return (payload?.['preferred_username'] ?? payload?.['sub'] ?? null) as string | null;
    }
    const claims = this.oauthService.getIdentityClaims() as Record<string, unknown> | null;
    if (!claims) return null;
    return (claims['preferred_username'] ?? claims['email'] ?? claims['name'] ?? null) as string | null;
  }

  handleUnauthorized(): void {
    if (!this.authRequired()) return;
    if (this.authMode() === 'lwl') {
      this.clearLwlSession();
      void this.router.navigate(['/'], { replaceUrl: true });
      return;
    }
    this.login();
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

  private clearLwlSession(): void {
    localStorage.removeItem(LWL_TOKEN_STORAGE_KEY);
    localStorage.removeItem(LWL_USER_STORAGE_KEY);
  }
}
