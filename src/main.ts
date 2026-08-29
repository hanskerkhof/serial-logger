import { APP_INITIALIZER, isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { provideMarkdown } from 'ngx-markdown';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { AuthService } from './app/auth/auth.service';
import { authHttpInterceptor } from './app/auth/auth-http-interceptor';

declare global {
  interface Window {
    __hideStartupSplash?: () => void;
    __setStartupSplashError?: (message?: string) => void;
  }
}

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimations(),
    provideRouter(routes),
    provideHttpClient(withXhr(), withInterceptors([authHttpInterceptor])),
    {
      provide: APP_INITIALIZER,
      useFactory: (auth: AuthService) => () => auth.initialize(),
      deps: [AuthService],
      multi: true,
    },
    providePrimeNG({
      license:
        'eyJpZCI6ImFhNzFkYTAxLTY2MjgtNDljOC04YmJkLWU4YjZjZmM5NDg4YiIsInByb2R1Y3QiOiJwcmltZXVpIiwidGllciI6ImNvbW11bml0eSIsInR5cGUiOiJkZXYiLCJpYXQiOjE3ODc5OTU2NzksImV4cCI6MTgxOTUzMTY3OX0.K1HUKZPQAvOvhifhnxC_81pJlXujfamjx5_BH_KqMdb779dC9Y79RjRS0oHtniWEEUp5vQs5ARZq-4-oN-QTBg',
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '.p-dark',
        },
      },
    }),
    provideMarkdown(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
})
  .then(() => {
    // Let Angular paint once before removing the static startup splash.
    requestAnimationFrame(() => {
      window.__hideStartupSplash?.();
    });
  })
  .catch((err) => {
    window.__setStartupSplashError?.('Startup failed. Please reload.');
    console.error(err);
  });
