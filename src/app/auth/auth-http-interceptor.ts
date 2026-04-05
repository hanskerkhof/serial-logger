import { HttpContextToken, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Per-request flag to skip Authorization header injection by this interceptor.
 * Used by fast-path requests that carry auth via `?token=...` query param.
 */
export const SKIP_AUTH_HEADER = new HttpContextToken<boolean>(() => false);

/**
 * Attaches a Bearer token to outgoing requests that target any configured CMDR API origin.
 * Also catches 401 responses and redirects to Zitadel login when auth is required,
 * so users see a login page rather than a confusing error message.
 */
export const authHttpInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.accessToken;
  const skipAuthHeader = req.context.get(SKIP_AUTH_HEADER);

  const outgoing = token && !skipAuthHeader
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(outgoing).pipe(
    catchError((err) => {
      if (err.status === 401 && authService.authRequired()) {
        authService.handleUnauthorized();
      }
      return throwError(() => err);
    }),
  );
};
