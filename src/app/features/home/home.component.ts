import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    // If auth is not required or user is already logged in, go straight to the app.
    if (!this.authService.authRequired() || this.authService.isLoggedIn) {
      this.router.navigate(['/commander'], { replaceUrl: true });
    }
  }
}
