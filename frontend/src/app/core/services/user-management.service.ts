import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { 
  UserManagement, 
  ApproveUserRequest, 
  UpdateRoleRequest 
} from '../../shared/models/user-management.model';

@Injectable({
  providedIn: 'root'
})
export class UserManagementService {
  private readonly API_URL = `${environment.apiUrl}/UserManagement`;

  constructor(private readonly http: HttpClient) {}

  /**
   * Lista todos os usuários cadastrados (apenas Admin)
   */
  getAllUsers(): Observable<UserManagement[]> {
    return this.http.get<UserManagement[]>(`${this.API_URL}/users`);
  }

  /**
   * Lista apenas usuários pendentes de aprovação (apenas Admin)
   */
  getPendingUsers(): Observable<UserManagement[]> {
    return this.http.get<UserManagement[]>(`${this.API_URL}/users/pending`);
  }

  /**
   * Aprova um usuário (apenas Admin)
   */
  approveUser(cpf: string): Observable<{ message: string }> {
    const sanitized = this.sanitizeCpf(cpf);
    const request: ApproveUserRequest = { cpf: sanitized, approve: true };
    return this.http.put<{ message: string }>(
      `${this.API_URL}/users/${sanitized}/approve`,
      request
    );
  }

  /**
   * Rejeita um usuário (apenas Admin)
   */
  rejectUser(cpf: string): Observable<{ message: string }> {
    const sanitized = this.sanitizeCpf(cpf);
    const request: ApproveUserRequest = { cpf: sanitized, approve: false };
    return this.http.put<{ message: string }>(
      `${this.API_URL}/users/${sanitized}/approve`,
      request
    );
  }

  /**
   * Atualiza a role de um usuário (apenas Admin)
   */
  updateUserRole(cpf: string, role: 'Admin' | 'User'): Observable<{ message: string }> {
    const sanitized = this.sanitizeCpf(cpf);
    const request: UpdateRoleRequest = { cpf: sanitized, role };
    return this.http.put<{ message: string }>(
      `${this.API_URL}/users/${sanitized}/role`,
      request
    );
  }

  /**
   * Exclui um usuário definitivamente (apenas Admin)
   */
  deleteUser(cpf: string): Observable<{ message: string }> {
    const sanitized = this.sanitizeCpf(cpf);
    return this.http.delete<{ message: string }>(
      `${this.API_URL}/users/${sanitized}`
    );
  }

  private sanitizeCpf(cpf: string): string {
    const digits = cpf.replace(/\D/g, '');
    return digits.length === 11 ? digits : cpf;
  }
}

