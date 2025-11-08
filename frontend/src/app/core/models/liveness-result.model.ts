export interface LivenessCaptureSummary {
  position: string;
  confidence: number;
  s3Key: string;
  previewUrl: string;
}

export interface LivenessSummary {
  isLive: boolean;
  livenessScore: number;
  faceMatchScore?: number;
  status: 'Aprovado' | 'Rejeitado' | 'Revisar';
  captures: LivenessCaptureSummary[];
  documentKey?: string;
  documentName?: string;
}

