import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AuthResponse,
  CpfLookupResponse,
  FaceEnrollmentRequest,
  FaceEnrollmentResponse,
  FaceLoginRequest,
  FaceLoginResponse,
  RefreshTokenRequest,
  UserProfile
} from '../../shared/models/auth.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = environment.apiUrl;
  private readonly storageAccessKey = 'access_token';
  private readonly storageRefreshKey = 'refresh_token';
  private readonly storageUserKey = 'user_id';

  private currentUserSubject = new BehaviorSubject<UserProfile | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  public isAuthenticated = signal(false);

  constructor(private readonly http: HttpClient) {
    // Atrasa a inicialização para evitar dependência circular com o interceptor
    setTimeout(() => this.loadStoredAuth(), 0);
  }

  checkCpf(cpf: string): Observable<CpfLookupResponse> {
    const sanitized = this.sanitizeCpf(cpf);
    return this.http.get<CpfLookupResponse>(`${this.API_URL}/usuario/${sanitized}`);
  }

  registerFace(payload: FaceEnrollmentRequest): Observable<FaceEnrollmentResponse> {
    const body: FaceEnrollmentRequest = {
      ...payload,
      cpf: this.sanitizeCpf(payload.cpf)
    };

    return this.http.post<FaceEnrollmentResponse>(`${this.API_URL}/auth/cadastro-facial`, body)
      .pipe(
        tap((response) => {
          this.handleAuthResponse(response.tokens);
        })
      );
  }

  loginWithFace(payload: FaceLoginRequest): Observable<FaceLoginResponse> {
    const body: FaceLoginRequest = {
      ...payload,
      cpf: this.sanitizeCpf(payload.cpf)
    };

    console.log('[AuthService] Login facial - Payload:', body);

    return this.http.post<FaceLoginResponse>(`${this.API_URL}/auth/validar-face`, body, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
      .pipe(
        tap((response) => {
          console.log('[AuthService] ==================== RESPOSTA DA API ====================');
          console.log('[AuthService] Resposta COMPLETA (stringify):', JSON.stringify(response, null, 2));
          console.log('[AuthService] response:', response);
          console.log('[AuthService] response.user:', response.user);
          console.log('[AuthService] response.user?.name:', response.user?.name);
          console.log('[AuthService] Object.keys(response):', Object.keys(response));
          console.log('[AuthService] ====================================================');
          if (response.success) {
            this.handleAuthResponse(response.tokens);
          }
        })
      );
  }

  refreshSession(request: RefreshTokenRequest): Observable<AuthResponse> {
    const body: RefreshTokenRequest = {
      ...request,
      cpf: this.sanitizeCpf(request.cpf)
    };

    return this.http.post<AuthResponse>(`${this.API_URL}/auth/refresh`, body)
      .pipe(
        tap((tokens) => this.handleAuthResponse(tokens))
      );
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.API_URL}/auth/logout`, {})
      .pipe(
        tap(() => {
          this.clearAuth();
          this.isAuthenticated.set(false);
        })
      );
  }

  getCurrentUser(): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.API_URL}/auth/me`);
  }

  getToken(): string | null {
    return localStorage.getItem(this.storageAccessKey);
  }

  /**
   * Verifica se o usuário atual é Admin
   */
  isAdmin(): boolean {
    const user = this.currentUserSubject.value;
    return user?.role === 'Admin' || user?.Role === 'Admin';
  }

  /**
   * Verifica se o usuário atual está aprovado
   */
  isUserApproved(): boolean {
    const user = this.currentUserSubject.value;
    return user?.isApproved === true || user?.IsApproved === true;
  }

  /**
   * Obtém a role do usuário atual
   */
  getUserRole(): string {
    const user = this.currentUserSubject.value;
    return user?.role || user?.Role || 'User';
  }

  private handleAuthResponse(tokens: AuthResponse): void {
    this.storeAuth(tokens);
    this.isAuthenticated.set(true);
    this.fetchCurrentUser();
  }

  private fetchCurrentUser(): void {
    console.log('[AuthService] Buscando dados do usuário atual...');
    this.getCurrentUser().subscribe({
      next: (user) => {
        console.log('[AuthService] Usuário recebido do backend:', user);
        this.currentUserSubject.next(user);
      },
      error: (error) => {
        console.error('[AuthService] Falha ao obter usuário atual:', error);
        if (error?.status === 401) {
          console.warn('[AuthService] Token inválido, limpando autenticação');
          this.clearAuth();
          this.isAuthenticated.set(false);
        }
        this.currentUserSubject.next(null);
      }
    });
  }

  private storeAuth(tokens: AuthResponse): void {
    localStorage.setItem(this.storageAccessKey, tokens.accessToken);
    localStorage.setItem(this.storageRefreshKey, tokens.refreshToken);
    localStorage.setItem(this.storageUserKey, tokens.userId);
  }

  private clearAuth(): void {
    // Limpa TODOS os dados do localStorage e sessionStorage
    localStorage.clear();
    sessionStorage.clear();
    this.currentUserSubject.next(null);
  }

  private loadStoredAuth(): void {
    const token = this.getToken();
    console.log('[AuthService] Verificando token armazenado:', token ? 'Token encontrado' : 'Nenhum token');
    
    if (!token) {
      console.log('[AuthService] Nenhum token encontrado, usuário não autenticado');
      this.isAuthenticated.set(false);
      this.currentUserSubject.next(null);
      return;
    }

    console.log('[AuthService] Token encontrado, buscando dados do usuário');
    this.isAuthenticated.set(true);
    this.fetchCurrentUser();
  }

  private sanitizeCpf(cpf: string): string {
    return cpf.replace(/\D/g, '');
  }
}
