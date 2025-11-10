import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SessionExpiredModalService } from '../services/session-expired-modal.service';
import { AuthService } from '../services/auth.service';

export const sessionExpiredInterceptor: HttpInterceptorFn = (req, next) => {
  const modalService = inject(SessionExpiredModalService);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Detecta erro 401 (Unauthorized) - sessão expirada
      if (error.status === 401) {
        // Limpa dados de autenticação
        authService.logout();
        
        // Mostra modal de sessão expirada
        modalService.showModal();
      }
      
      return throwError(() => error);
    })
  );
};

