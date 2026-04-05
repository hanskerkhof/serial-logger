import { Injectable, inject, signal } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';
import { authConfig } from './auth.config';

const API_URL_STORAGE_KEY = 'cmdr.api.baseUrl';
const API_URL_FALLBACKS = [
  // Same-origin first (when FE is served by the API on port 8080)
  typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8080` : '',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
].filter(Boolean);

function resolveApiBaseUrl(): string {
  try {
    const stored = localStorage.getItem(API_URL_STORAGE_KEY);
    if (stored) return stored.replace(/\/+$/, '');
  } catch {
    // localStorage unavailable (SSR / private mode edge case)
  }
  return API_URL_FALLBACKS[0] ?? 'http://localhost:8080';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly oauthService = inject(OAuthService);

  /** True when the API has auth enforcement enabled. Starts optimistic (true) until confirmed. */
  readonly authRequired = signal<boolean>(true);

  /**
   * Called once at app startup (APP_INITIALIZER).
   * 1. Checks /auth/status on the API — if disabled, skips OIDC entirely.
   * 2. Otherwise loads discovery doc, restores session, and sets up silent refresh.
   */
  async initialize(): Promise<void> {
    // --- Step 1: check whether the API requires auth ---
    try {
      const apiBase = resolveApiBaseUrl();
      const resp = await fetch(`${apiBase}/auth/status`);
      if (resp.ok) {
        const data = await resp.json() as { enabled: boolean };
        if (!data.enabled) {
          this.authRequired.set(false);
          return; // Auth disabled on the API — skip OIDC entirely.
        }
      }
    } catch {
      // API unreachable at startup — proceed with OIDC (auth guard will handle token state).
    }

    // --- Step 2: OIDC init ---
    this.oauthService.configure(authConfig);

    try {
      await this.oauthService.loadDiscoveryDocumentAndTryLogin();
    } catch {
      // Zitadel not reachable — app continues without auth.
      console.warn('[AuthService] Could not reach OIDC discovery endpoint — Zitadel not running?');
      return;
    }

    // Set up silent token refresh using the refresh token (requires offline_access scope).
    this.oauthService.setupAutomaticSilentRefresh();
  }

  get isLoggedIn(): boolean {
    return this.oauthService.hasValidAccessToken();
  }

  login(): void {
    this.oauthService.initCodeFlow();
  }

  logout(): void {
    this.oauthService.logOut();
  }

  get accessToken(): string | null {
    return this.oauthService.getAccessToken() || null;
  }

  get userName(): string | null {
    const claims = this.oauthService.getIdentityClaims() as Record<string, unknown> | null;
    if (!claims) return null;
    return (claims['preferred_username'] ?? claims['email'] ?? claims['name'] ?? null) as string | null;
  }
}
