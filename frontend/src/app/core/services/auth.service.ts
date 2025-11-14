import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
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
  
  // Flag para indicar se o logout foi voluntário (clique no botão Sair)
  private isVoluntaryLogout = false;

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router
  ) {
    // Atrasa a inicialização para evitar dependência circular com o interceptor
    setTimeout(() => this.loadStoredAuth(), 0);
  }

  /**
   * Verifica se o logout atual é voluntário (usuário clicou em Sair)
   */
  isLogoutVoluntary(): boolean {
    return this.isVoluntaryLogout;
  }

  /**
   * Marca o início de um logout voluntário
   */
  private markVoluntaryLogout(): void {
    this.isVoluntaryLogout = true;
  }

  /**
   * Reseta a flag de logout voluntário
   */
  private resetVoluntaryLogout(): void {
    this.isVoluntaryLogout = false;
  }

  checkCpf(cpf: string): Observable<CpfLookupResponse> {
    const sanitized = this.sanitizeCpf(cpf);
    return this.http.get<CpfLookupResponse>(`${this.API_URL}/usuario/${sanitized}`);
  }

  registerFace(
    payload: FaceEnrollmentRequest,
    options?: { autoLogin?: boolean }
  ): Observable<FaceEnrollmentResponse> {
    const body: FaceEnrollmentRequest = {
      ...payload,
      cpf: this.sanitizeCpf(payload.cpf)
    };

    const shouldAutoLogin = options?.autoLogin ?? true;

    return this.http.post<FaceEnrollmentResponse>(`${this.API_URL}/auth/cadastro-facial`, body)
      .pipe(
        tap((response) => {
          if (shouldAutoLogin) {
            this.handleAuthResponse(response.tokens);
          }
        })
      );
  }

  loginWithFace(payload: FaceLoginRequest): Observable<FaceLoginResponse> {
    const body: FaceLoginRequest = {
      ...payload,
      cpf: this.sanitizeCpf(payload.cpf)
    };

    return this.http.post<FaceLoginResponse>(`${this.API_URL}/auth/validar-face`, body, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
      .pipe(
        tap((response) => {
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
    // Marca como logout voluntário antes de fazer a requisição
    this.markVoluntaryLogout();
    
    return this.http.post(`${this.API_URL}/auth/logout`, {})
      .pipe(
        tap(() => {
          this.executeLocalLogout();
          // Reseta a flag após 500ms (tempo suficiente para o interceptor verificar)
          setTimeout(() => this.resetVoluntaryLogout(), 500);
        })
      );
  }

  /**
   * Executa o fluxo de logout local sem chamar a API
   */
  forceLogout(): void {
    this.executeLocalLogout();
    this.resetVoluntaryLogout();
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
    this.getCurrentUser().subscribe({
      next: (user) => {
        this.currentUserSubject.next(user);
      },
      error: (error) => {
        if (error?.status === 401) {
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
    localStorage.removeItem(this.storageAccessKey);
    localStorage.removeItem(this.storageRefreshKey);
    localStorage.removeItem(this.storageUserKey);
    this.currentUserSubject.next(null);
  }

  private executeLocalLogout(): void {
    this.clearAuth();
    this.isAuthenticated.set(false);
    this.navigateToLogin();
  }

  private loadStoredAuth(): void {
    const token = this.getToken();
    
    if (!token) {
      this.isAuthenticated.set(false);
      this.currentUserSubject.next(null);
      return;
    }

    this.isAuthenticated.set(true);
    this.fetchCurrentUser();
  }

  private sanitizeCpf(cpf: string): string {
    return cpf.replace(/\D/g, '');
  }

  private navigateToLogin(): void {
    const currentUrl = this.router.url.split('?')[0];
    if (currentUrl === '/login') {
      return;
    }

    setTimeout(() => {
      if (this.router.url.split('?')[0] !== '/login') {
        void this.router.navigate(['/login']);
      }
    }, 0);
  }
}
