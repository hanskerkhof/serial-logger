import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // API says auth is disabled — pass through unconditionally.
  if (!authService.authRequired()) {
    return true;
  }

  if (authService.isLoggedIn) {
    return true;
  }

  // Not logged in — send to the home page where the login prompt is shown.
  return router.createUrlTree(['/']);
};
