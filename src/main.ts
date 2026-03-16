import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimationsAsync(),
    provideRouter(routes),
    provideHttpClient(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '.p-dark',
        },
      },
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
}).catch((err) => console.error(err));
