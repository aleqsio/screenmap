import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { DetailsComponent } from './details';
import { SettingsComponent } from '~/app/settings/settings.component';
import { Screens, SETTINGS_PATH } from './common/screens.enum';
import { AuthGuard } from './common/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'home',
    loadChildren: () => import('./home/home.routes').then(m => m.routes),
    canActivate: [() => inject(AuthGuard).canActivate()]
  },
  // Detail screens take the item id in the URL.
  {
    path: 'details/:id',
    component: DetailsComponent
  },
  { path: SETTINGS_PATH, component: SettingsComponent },
  {
    path: 'account',
    redirectTo: 'settings',
    pathMatch: 'full'
  },
  {
    path: Screens.Compose,
    loadComponent: () => import('./compose/compose.component').then((m) => m.ComposeComponent)
  },
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found.component').then(m => m.NotFoundComponent)
  }
];
