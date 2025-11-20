import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'cadastro-facial',
    loadComponent: () => import('./pages/face-enrollment/face-enrollment.component').then(m => m.FaceEnrollmentComponent)
  },
  {
    path: 'autenticacao-facial',
    loadComponent: () => import('./pages/face-auth/face-auth.component').then(m => m.FaceAuthComponent)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent)
  },
  {
    path: 'history',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/history/history.component').then(m => m.HistoryComponent)
  },
  {
    path: 'perfil',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent)
  },
  {
    path: 'capture3d',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/capture3d/capture3d.component').then(m => m.Capture3dComponent)
  },
  {
    path: 'help',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/help/help.component').then(m => m.HelpComponent)
  },
  {
    path: 'logs',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/logs/logs.component').then(m => m.LogsComponent)
  },
  {
    path: 'user-management',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/user-management/user-management.component').then(m => m.UserManagementComponent)
  },
  {
    path: 'verifications',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/verifications/verifications-list.component').then(m => m.VerificationsListComponent)
  },
  {
    path: 'verifications/:sessionId',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/verifications/verification-detail.component').then(m => m.VerificationDetailComponent)
  },
  {
    path: 'apresentacao',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/presentation/presentation.component').then(m => m.PresentationComponent)
  },
  {
    path: '**',
    redirectTo: '/login'
  }
];
