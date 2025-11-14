import { Injectable } from '@angular/core';
import { RekognitionClient, CompareFacesCommand, DetectFacesCommand } from '@aws-sdk/client-rekognition';
import { CognitoService } from './cognito.service';
import { environment } from '../../../environments/environment';

export interface CompareFacesResult {
  similarity: number;
  matched: boolean;
  reason?: 'NO_FACE_DETECTED' | 'ERROR';
}

@Injectable({
  providedIn: 'root'
})
export class RekognitionService {
  private readonly client: RekognitionClient;

  constructor(private readonly cognitoService: CognitoService) {
    const region = environment.aws?.region;

    if (!region) {
      throw new Error('Configuração Rekognition ausente: defina environment.aws.region.');
    }

    this.client = new RekognitionClient({
      region,
      credentials: this.cognitoService.getCredentialsProvider()
    });
  }

  async compareFaces(sourceBytes: Uint8Array, targetBytes: Uint8Array, similarityThreshold = 80): Promise<CompareFacesResult> {
    const command = new CompareFacesCommand({
      SourceImage: { Bytes: sourceBytes },
      TargetImage: { Bytes: targetBytes },
      SimilarityThreshold: similarityThreshold
    });


    try {
      const response = await this.client.send(command);
      const match = response.FaceMatches?.[0];


      return {
        similarity: match?.Similarity ?? 0,
        matched: Boolean(match && (match.Similarity ?? 0) >= similarityThreshold)
      };
    } catch (error: any) {
      const name = error?.name ?? error?.__type ?? 'UnknownError';
      const message = error?.message ?? error?.Message ?? 'Unexpected error';

      if (name === 'InvalidParameterException' && message.includes('invalid parameters')) {
        return {
          similarity: 0,
          matched: false,
          reason: 'NO_FACE_DETECTED'
        };
      }

      return {
        similarity: 0,
        matched: false,
        reason: 'ERROR'
      };
    }
  }

  async detectFaceConfidence(imageBytes: Uint8Array): Promise<number> {
    const command = new DetectFacesCommand({
      Image: { Bytes: imageBytes },
      Attributes: ['DEFAULT']
    });


    try {
      const response = await this.client.send(command);
      const detail = response.FaceDetails?.[0];


      return detail?.Confidence ?? 0;
    } catch (error) {
      throw error;
    }
  }
}

