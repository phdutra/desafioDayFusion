import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LivenessService {
  private baseUrl = `${environment.apiUrl}/liveness`;

  constructor(private http: HttpClient) {}

  /**
   * Cria uma sessão de Face Liveness 3D
   * Conforme guia: POST /api/liveness/start (endpoint principal)
   * Fallback: /api/liveness/create-session ou /api/liveness/session
   */
  createSession(): Observable<{ sessionId: string }> {
    // Usar /start como padrão (endpoint que está funcionando)
    return this.http.post<{ sessionId: string }>(`${this.baseUrl}/start`, {});
  }

  /**
   * Obtém resultado da sessão de liveness
   * Conforme guia: GET /api/liveness/result/{sessionId}
   * Backend atual usa: GET /api/liveness/results?sessionId={sessionId}
   */
  getResult(sessionId: string): Observable<any> {
    // Usar endpoint do backend atual
    return this.http.get<any>(`${this.baseUrl}/results?sessionId=${sessionId}`);
  }
}

