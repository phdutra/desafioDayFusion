export interface LivenessCaptureSummary {
  position: string;
  confidence: number;
  s3Key: string;
  previewUrl: string;
}

export interface LivenessVideoSummary {
  s3Key: string;
  url?: string;
  mimeType: string;
  size: number;
  durationMs: number;
}

export interface LivenessSummary {
  isLive: boolean;
  livenessScore: number;
  faceMatchScore?: number;
  status: 'Aprovado' | 'Rejeitado' | 'Revisar';
  captures: LivenessCaptureSummary[];
  video?: LivenessVideoSummary;
  documentKey?: string;
  documentName?: string;
}

