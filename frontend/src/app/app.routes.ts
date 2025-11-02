import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/home',
    pathMatch: 'full'
  },
  {
    path: 'home',
    loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'capture2d',
    loadComponent: () => import('./pages/capture2d/capture2d.component').then(m => m.Capture2dComponent)
  },
  {
    path: 'capture3d',
    loadComponent: () => import('./pages/capture3d/capture3d.component').then(m => m.Capture3dComponent)
  },
  {
    path: 'capture',
    loadComponent: () => import('./pages/capture/capture.component').then(m => m.CaptureComponent)
  },
  {
    path: 'review',
    loadComponent: () => import('./pages/review/review.component').then(m => m.ReviewComponent)
  },
  {
    path: 'transactions',
    loadComponent: () => import('./pages/transactions/transactions.component').then(m => m.TransactionsComponent)
  },
  {
    path: 'result/:id',
    loadComponent: () => import('./pages/result/result.component').then(m => m.ResultComponent)
  },
  {
    path: '**',
    redirectTo: '/home'
  }
];
