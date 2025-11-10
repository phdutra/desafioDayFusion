export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
}

export interface UserProfile {
  cpf: string;
  name: string;
  role: string;
  isApproved: boolean;
  faceImageKey?: string;
  faceImageUrl?: string;
  hasFaceId?: boolean;
  claims: Array<{ type: string; value: string }>;
  // Backend response uses PascalCase, so we need to handle both
  Cpf?: string;
  Name?: string;
  Role?: string;
  IsApproved?: boolean;
  FaceImageKey?: string;
  FaceImageUrl?: string;
  HasFaceId?: boolean;
}

export interface CpfLookupResponse {
  cpf: string;
  exists: boolean;
  hasFaceId: boolean;
  name?: string;
  faceId?: string;
  faceImageUrl?: string;
  faceImageKey?: string;
}

export interface FaceEnrollmentRequest {
  cpf: string;
  name: string;
  imageKey: string;
}

export interface FaceEnrollmentResponse {
  cpf: string;
  name: string;
  faceId: string;
  faceImageUrl: string;
  faceImageKey: string;
  tokens: AuthResponse;
}

export interface FaceLoginRequest {
  cpf: string;
  imageKey: string;
}

export interface FaceLoginResponse {
  success: boolean;
  similarityScore: number;
  message: string;
  tokens: AuthResponse;
  user?: {
    cpf?: string;
    name?: string;
    role?: string;
    isApproved?: boolean;
  };
}

export interface RefreshTokenRequest {
  cpf: string;
  refreshToken?: string;
}

