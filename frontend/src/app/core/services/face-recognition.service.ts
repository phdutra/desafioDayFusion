import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { 
  DetectFaceRequest,
  FaceComparisonRequest, 
  FaceComparisonResponse, 
  PresignedUrlRequest, 
  PresignedUrlResponse,
  PresignedGetRequest,
  Transaction,
  ReviewRequest,
  StartLivenessRequest,
  LivenessSessionResponse,
  GetLivenessResultRequest,
  LivenessResultResponse
} from '../../shared/models/transaction.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FaceRecognitionService {
  private readonly API_URL = environment.apiUrl;

  constructor(private http: HttpClient) {}

  generatePresignedUrl(request: PresignedUrlRequest): Observable<PresignedUrlResponse> {
    return this.http.post<PresignedUrlResponse>(`${this.API_URL}/storage/presigned-url`, request);
  }

  // Generate a temporary GET URL to view/download an object (POST body)
  generateDownloadUrl(key: string, expiryMinutes = 60): Observable<PresignedUrlResponse> {
    const body: PresignedGetRequest = { key, expiryMinutes };
    return this.http.post<PresignedUrlResponse>(`${this.API_URL}/storage/presigned-url/get`, body);
  }

  compareFaces(request: FaceComparisonRequest): Observable<FaceComparisonResponse> {
    return this.http.post<FaceComparisonResponse>(`${this.API_URL}/facerecognition/compare`, request);
  }

  detectFaces(imageKey: string): Observable<boolean> {
    // Usar DTO no body ao invés de query string ou path parameter
    const request: DetectFaceRequest = { imageKey };
    // API usa lowercase URLs, então usar facerecognition (minúsculas)
    return this.http.post<boolean>(`${this.API_URL}/facerecognition/detect`, request);
  }

  getFaceSimilarity(request: FaceComparisonRequest): Observable<number> {
    return this.http.post<number>(`${this.API_URL}/facerecognition/similarity`, request);
  }

  uploadFileToS3(presignedUrl: string, file: File): Observable<any> {
    // The Content-Type header MUST match the one used to sign the URL
    const contentType = file.type || 'application/octet-stream';
    return this.http.put(presignedUrl, file, {
      headers: {
        'Content-Type': contentType
      }
    });
  }

  // New: upload through backend API (multipart/form-data)
  uploadViaApi(file: File, transactionId?: string): Observable<PresignedUrlResponse> {
    const form = new FormData();
    form.append('file', file);
    if (transactionId) form.append('transactionId', transactionId);
    // Backend aceita ambos, mas padronizamos para /upload
    return this.http.post<PresignedUrlResponse>(`${this.API_URL}/storage/upload`, form);
  }

  getTransactions(): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(`${this.API_URL}/transactions`);
  }

  getTransaction(id: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${this.API_URL}/transactions/${id}`);
  }

  getTransactionsForReview(): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(`${this.API_URL}/transactions/review`);
  }

  reviewTransaction(request: ReviewRequest): Observable<Transaction> {
    return this.http.put<Transaction>(`${this.API_URL}/transactions/${request.transactionId}/review`, request);
  }

  deleteTransaction(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/transactions/${id}`);
  }

  // Face Liveness 3D
  startLivenessSession(request: StartLivenessRequest): Observable<LivenessSessionResponse> {
    return this.http.post<LivenessSessionResponse>(`${this.API_URL}/facerecognition/liveness/start`, request);
  }

  getLivenessResult(request: GetLivenessResultRequest): Observable<LivenessResultResponse> {
    return this.http.post<LivenessResultResponse>(`${this.API_URL}/facerecognition/liveness/result`, request);
  }
}
