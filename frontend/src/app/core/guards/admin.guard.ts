import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guard para proteger rotas administrativas
 * Apenas usuários com role "Admin" podem acessar
 */
export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  console.log('[AdminGuard] Verificando permissões de acesso');
  console.log('[AdminGuard] Usuário autenticado:', authService.isAuthenticated());
  console.log('[AdminGuard] É admin:', authService.isAdmin());

  if (!authService.isAuthenticated()) {
    console.warn('[AdminGuard] Usuário não autenticado, redirecionando para login');
    router.navigate(['/login']);
    return false;
  }

  if (!authService.isAdmin()) {
    console.warn('[AdminGuard] Usuário sem permissões de admin, redirecionando para dashboard');
    router.navigate(['/dashboard']);
    return false;
  }

  console.log('[AdminGuard] Acesso autorizado');
  return true;
};

