import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { ToolbarModule } from 'primeng/toolbar';
import { filter } from 'rxjs';
import { APP_VERSION, BUILD_DATE } from './build-info';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabsModule, ToolbarModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  private readonly router = inject(Router);
  protected readonly activeMode = signal<'direct' | 'commander'>(this.modeFromUrl(this.router.url));
  protected readonly appVersion = APP_VERSION;
  protected readonly buildDate = BUILD_DATE;

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.activeMode.set(this.modeFromUrl(this.router.url));
    });
  }

  protected onModeChange(mode: string | number | undefined): void {
    const nextMode = mode === 'direct' ? 'direct' : 'commander';
    this.router.navigateByUrl(`/${nextMode}`);
  }

  private modeFromUrl(url: string): 'direct' | 'commander' {
    return url.startsWith('/direct') ? 'direct' : 'commander';
  }
}
