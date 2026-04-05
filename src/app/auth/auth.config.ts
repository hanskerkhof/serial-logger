import { AuthConfig } from 'angular-oauth2-oidc';

/**
 * Derive Zitadel issuer from the current origin:
 *   - Local dev (localhost:4210 or localhost:8080): http://localhost:8088
 *   - Tailscale HTTPS (bklk-cmdr-2-studio.tailad320e.ts.net): same host on port 8443
 *
 * Adjust LOCAL_ZITADEL_PORT / REMOTE_ZITADEL_PORT if your setup differs.
 */
function resolveIssuer(): string {
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8088';
  }
  return `${protocol}//${hostname}:8443`;
}

export const authConfig: AuthConfig = {
  issuer: resolveIssuer(),
  redirectUri: window.location.origin,
  clientId: '367239044884677686',
  responseType: 'code',
  // offline_access is required for refresh tokens; openid + profile + email for identity claims.
  scope: 'openid profile email offline_access',
  useSilentRefresh: false,
  showDebugInformation: false,
  clearHashAfterLogin: true,
  // Strict validation
  requireHttps: window.location.protocol === 'https:',
  // Store tokens in session storage (cleared on tab close) rather than localStorage
  sessionChecksEnabled: false,
};
