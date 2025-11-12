import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { VerificationAnalysis, VerificationMetrics, VerificationStatus } from '../models/verification-analysis.model';

interface SaveObservationPayload {
  manualObservation: string;
}

interface UpdateStatusPayload {
  status: VerificationStatus;
  manualObservation?: string;
}

@Injectable({
  providedIn: 'root'
})
export class VerificationAdminService {
  private readonly baseUrl = `${environment.apiUrl}/verifications`;

  constructor(private readonly http: HttpClient) {}

  list(limit = 50): Observable<VerificationAnalysis[]> {
    return this.http.get<VerificationAnalysis[]>(`${this.baseUrl}`, {
      params: { limit }
    });
  }

  get(sessionId: string): Observable<VerificationAnalysis> {
    return this.http.get<VerificationAnalysis>(`${this.baseUrl}/${sessionId}`);
  }

  saveObservation(sessionId: string, manualObservation: string): Observable<void> {
    const payload: SaveObservationPayload = { manualObservation };
    return this.http.post<void>(`${this.baseUrl}/${sessionId}/observation`, payload);
  }

  updateStatus(sessionId: string, status: VerificationStatus, manualObservation?: string): Observable<void> {
    const payload: UpdateStatusPayload = { status };
    if (manualObservation?.trim()) {
      payload.manualObservation = manualObservation.trim();
    }
    return this.http.patch<void>(`${this.baseUrl}/${sessionId}/status`, payload);
  }

  metrics(limit = 200): Observable<VerificationMetrics> {
    return this.http.get<VerificationMetrics>(`${this.baseUrl}/metrics`, {
      params: { limit }
    });
  }
}

