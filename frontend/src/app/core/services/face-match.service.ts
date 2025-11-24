import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AuditImageInfo {
  bucket: string;
  key: string;
  url?: string;
}

export interface MatchWithDocumentRequest {
  documentImageS3Path: string; // ex.: s3://dayfusion-docs/cliente123/frente.jpg
  sessionId: string;
  auditImages: { bucket: string; key: string }[];
}

export interface MatchWithDocumentResponse {
  sessionId: string;
  livenessScore: number;
  bestMatchScore: number;
  bestMatchImageKey?: string;
  matches: {
    imageKey: string;
    similarity: number;
    confidence: number;
  }[];
  finalScore: number;
}

@Injectable({ providedIn: 'root' })
export class FaceMatchService {
  private baseUrl = `${environment.apiUrl}/face`;

  constructor(private http: HttpClient) {}

  matchLivenessWithDocument(
    sessionId: string,
    documentImageS3Path: string,
    auditImages: AuditImageInfo[]
  ): Observable<MatchWithDocumentResponse> {
    const payload: MatchWithDocumentRequest = {
      documentImageS3Path,
      sessionId,
      auditImages: auditImages.map(a => ({
        bucket: a.bucket,
        key: a.key
      }))
    };

    return this.http.post<MatchWithDocumentResponse>(
      `${this.baseUrl}/match-from-liveness`,
      payload
    );
  }
}

