import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly loginError = signal<string | null>(null);
  protected readonly isSubmitting = signal(false);

  ngOnInit(): void {
    // If auth is not required or user is already logged in, go straight to the app.
    if (!this.authService.authRequired() || this.authService.isLoggedIn) {
      this.router.navigate(['/commander'], { replaceUrl: true });
    }
  }

  protected async onLoginClick(): Promise<void> {
    this.loginError.set(null);
    if (this.authService.authMode() === 'lwl') {
      this.isSubmitting.set(true);
      try {
        const result = await this.authService.loginWithPassword(this.username().trim(), this.password());
        if (!result.ok) {
          this.loginError.set(result.error ?? 'Login failed');
          return;
        }
        this.password.set('');
        await this.router.navigate(['/commander'], { replaceUrl: true });
      } finally {
        this.isSubmitting.set(false);
      }
      return;
    }

    this.authService.login();
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.update((current) => !current);
  }
}
