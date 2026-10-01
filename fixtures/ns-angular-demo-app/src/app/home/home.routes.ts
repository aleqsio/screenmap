import { Routes } from '@angular/router';
import { HomeComponent } from './home.component';
import { Screens } from '~/app/common/screens.enum';

export const routes: Routes = [
  {
    path: '',
    component: HomeComponent,
    children: [
      {
        path: '',
        redirectTo: 'feed',
        pathMatch: 'full'
      },
      {
        path: 'feed',
        outlet: 'feedTab',
        loadComponent: () => import('./feed/feed.component').then(m => m.FeedComponent)
      },
      {
        path: Screens.Search,
        outlet: 'searchTab',
        loadComponent: () => import('./search/search.component').then(m => m.SearchComponent)
      }
    ]
  }
];
