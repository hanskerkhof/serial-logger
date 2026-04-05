import { Routes } from '@angular/router';
import { DirectComponent } from './features/direct/direct.component';
import { CommanderComponent } from './features/commander/commander.component';
import { HomeComponent } from './features/home/home.component';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'direct', component: DirectComponent, canActivate: [authGuard] },
  { path: 'commander', component: CommanderComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
