export type VerificationStatus = 'APPROVED' | 'REJECTED' | 'REVIEW_REQUIRED';

export interface VerificationAnalysis {
  sessionId: string;
  userId: string;
  status: VerificationStatus;
  matchScore?: number | null;
  livenessScore?: number | null;
  fraudScore?: number | null;
  autoObservations: string[];
  manualObservation?: string | null;
  selfieSignedUrl?: string | null;
  documentSignedUrl?: string | null;
  createdAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export interface VerificationMetrics {
  total: number;
  approved: number;
  rejected: number;
  reviewRequired: number;
  avgMatchScore?: number | null;
  avgLivenessScore?: number | null;
  avgFraudScore?: number | null;
  topRejectionReasons: ReasonCount[];
}

export interface ReasonCount {
  reason: string;
  count: number;
}

