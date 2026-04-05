import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const oauthService = inject(OAuthService);
  const router = inject(Router);

  // API says auth is disabled — pass through unconditionally.
  if (!authService.authRequired()) {
    return true;
  }

  if (oauthService.hasValidAccessToken()) {
    return true;
  }

  // Not logged in — send to the home page where the login prompt is shown.
  return router.createUrlTree(['/']);
};
