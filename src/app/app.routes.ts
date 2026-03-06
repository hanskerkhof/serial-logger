import { Routes } from '@angular/router';
import { DirectComponent } from './features/direct/direct.component';
import { CommanderComponent } from './features/commander/commander.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'commander' },
  { path: 'direct', component: DirectComponent },
  { path: 'commander', component: CommanderComponent },
  { path: '**', redirectTo: 'commander' },
];
