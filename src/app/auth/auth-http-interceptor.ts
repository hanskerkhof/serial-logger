import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Attaches a Bearer token to outgoing requests that target any configured CMDR API origin.
 * Also catches 401 responses and redirects to Zitadel login when auth is required,
 * so users see a login page rather than a confusing error message.
 */
export const authHttpInterceptor: HttpInterceptorFn = (req, next) => {
  const oauthService = inject(OAuthService);
  const authService = inject(AuthService);
  const token = oauthService.getAccessToken();

  const outgoing = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(outgoing).pipe(
    catchError((err) => {
      if (err.status === 401 && authService.authRequired()) {
        // Token missing or expired — redirect to Zitadel login.
        authService.login();
      }
      return throwError(() => err);
    }),
  );
};
