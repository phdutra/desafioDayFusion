export interface Transaction {
  id: string;
  userId: string;
  selfieUrl: string;
  documentUrl: string;
  similarityScore?: number;
  status: TransactionStatus;
  reviewNotes?: string;
  reviewedBy?: string;
  createdAt: string;
  processedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
}

export enum TransactionStatus {
  Pending = 'Pending',
  Processing = 'Processing',
  Approved = 'Approved',
  Rejected = 'Rejected',
  ManualReview = 'ManualReview',
  Error = 'Error'
}

export interface PresignedUrlRequest {
  fileName: string;
  contentType: string;
  transactionId?: string;
}

export interface PresignedUrlResponse {
  url: string;
  key: string;
  expiresAt: string;
}

export interface PresignedGetRequest {
  key: string;
  expiryMinutes?: number;
}

export interface DetectFaceRequest {
  imageKey: string;
}

export interface FaceComparisonRequest {
  selfieKey: string;
  documentKey: string;
  transactionId?: string;
}

export interface FaceComparisonResponse {
  similarityScore: number;
  status: TransactionStatus;
  message?: string;
  transactionId: string;
}

export interface ReviewRequest {
  transactionId: string;
  status: TransactionStatus;
  notes?: string;
}

export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
}

export interface User {
  userId: string;
  username: string;
  claims: Array<{ type: string; value: string }>;
}

// Face Liveness 3D Models
export interface StartLivenessRequest {
  transactionId?: string;
}

export interface LivenessSessionResponse {
  sessionId: string;
  streamingUrl: string;
  transactionId: string;
  expiresAt: string;
}

export interface GetLivenessResultRequest {
  sessionId: string;
  transactionId?: string;
}

export interface LivenessResultResponse {
  sessionId: string;
  status: string; // SUCCEEDED, FAILED, etc
  livenessDecision: string; // LIVE, SPOOF, etc
  confidence: number;
  transactionId: string;
  message: string;
  referenceImageUrl?: string; // URL da imagem de referência
  auditImageUrls: string[]; // URLs das imagens de auditoria
  // Informações detalhadas sobre score baixo
  lowScoreReasons?: string[]; // Razões para score baixo
  recommendations?: string[]; // Recomendações para melhorar
  qualityScore?: number; // Score de qualidade da imagem (0-100)
  qualityAssessment?: string; // Avaliação da qualidade (EXCELLENT, GOOD, FAIR, POOR)
}
