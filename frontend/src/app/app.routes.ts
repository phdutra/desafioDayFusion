import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full'
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'history',
    loadComponent: () => import('./pages/history/history.component').then(m => m.HistoryComponent)
  },
  {
    path: 'capture3d',
    loadComponent: () => import('./pages/capture3d/capture3d.component').then(m => m.Capture3dComponent)
  },
  {
    path: '**',
    redirectTo: '/dashboard'
  }
];
