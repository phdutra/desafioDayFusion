export interface Transaction {
  id: string;
  userId: string;
  selfieUrl: string;
  documentUrl: string;
  similarityScore?: number;
  livenessScore?: number;
  documentScore?: number;  // 0-100 (análise de autenticidade do documento)
  identityScore?: number;   // 0.0-1.0 (score final combinado)
  observacao?: string;     // Observação automática gerada
  status: TransactionStatus;
  reviewNotes?: string;
  reviewedBy?: string;
  createdAt: string;
  processedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  
  // Anti-Deepfake Layer
  deepfakeScore?: number;  // 0.0 - 1.0
  blinkPattern?: string;   // "natural" | "anomalous" | "error"
  audioSync?: string;      // "ok" | "lag" | "mismatch" | "error"
  detectedArtifacts?: string[];
  videoKey?: string;
  modelVersion?: string;
  deviceInfo?: string;
  videoExpiresAt?: string;
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
  documentKey?: string;  // Chave S3 do documento (opcional, para análise completa)
  selfieKey?: string;    // Chave S3 da selfie de referência (opcional)
  localLivenessScore?: number;  // Score de liveness calculado localmente pelo frontend (0-100)
  videoKey?: string;     // Chave S3 do vídeo gravado durante a captura (opcional)
}

export interface LivenessResultResponse {
  sessionId: string;
  status: string; // SUCCEEDED, FAILED, APPROVED, REJECTED, REVIEW, etc
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
  
  // Campos adicionais para análise completa
  observacao?: string; // Observação da análise
  documentScore?: number; // Score do documento (0-100)
  identityScore?: number; // Score de identidade completo (0-1.0, será convertido para 0-100 no frontend)
  matchScore?: number; // Score de match de faces (0-100)
  qualityAssessment?: string; // Avaliação da qualidade (EXCELLENT, GOOD, FAIR, POOR)
}

// Anti-Deepfake Models
export interface AntiDeepfakeAnalysisRequest {
  videoKey: string;
  sessionId?: string;
}

export interface AntiDeepfakeResult {
  deepfakeScore: number;      // 0.0 - 1.0
  blinkRate: number;          // piscadas/min
  blinkPattern: string;       // "natural" | "anomalous" | "error"
  audioSync: string;          // "ok" | "lag" | "mismatch" | "error"
  detectedArtifacts: string[];
  modelVersion: string;
}

export interface VerifyWithAntiDeepfakeRequest {
  selfieKey: string;
  documentKey: string;
  videoKey?: string;  // opcional
  transactionId?: string;
}

export interface VerifyWithAntiDeepfakeResponse {
  transactionId: string;
  similarityScore: number;
  status: TransactionStatus;
  message: string;
  liveness?: {
    decision: string;
    confidence: number;
  };
  antiDeepfake?: AntiDeepfakeResult;
}

// Document Validation Models
export interface IdentityRequest {
  bucket: string;
  fileName: string;
  livenessScore?: number;
  matchScore?: number;
  transactionId?: string;
}

export interface IdentityResponse {
  transactionId: string;
  livenessScore?: number;
  matchScore?: number;
  documentScore: number;
  identityScore: number;
  observacao: string;
  status: TransactionStatus;
}
