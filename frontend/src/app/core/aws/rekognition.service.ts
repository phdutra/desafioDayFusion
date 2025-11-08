import { Injectable } from '@angular/core';
import { RekognitionClient, CompareFacesCommand, DetectFacesCommand } from '@aws-sdk/client-rekognition';
import { CognitoService } from './cognito.service';
import { environment } from '../../../environments/environment';

export interface CompareFacesResult {
  similarity: number;
  matched: boolean;
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

    console.info('[RekognitionService] Enviando CompareFacesCommand.', {
      sourceBytesLength: sourceBytes.length,
      targetBytesLength: targetBytes.length,
      similarityThreshold
    });

    try {
      const response = await this.client.send(command);
      const match = response.FaceMatches?.[0];

      console.info('[RekognitionService] CompareFacesCommand concluído.', {
        matches: response.FaceMatches?.length ?? 0,
        similarity: match?.Similarity ?? null
      });

      return {
        similarity: match?.Similarity ?? 0,
        matched: Boolean(match && (match.Similarity ?? 0) >= similarityThreshold)
      };
    } catch (error) {
      console.error('[RekognitionService] CompareFacesCommand falhou.', error);
      throw error;
    }
  }

  async detectFaceConfidence(imageBytes: Uint8Array): Promise<number> {
    const command = new DetectFacesCommand({
      Image: { Bytes: imageBytes },
      Attributes: ['DEFAULT']
    });

    console.info('[RekognitionService] Enviando DetectFacesCommand.', {
      imageBytesLength: imageBytes.length
    });

    try {
      const response = await this.client.send(command);
      const detail = response.FaceDetails?.[0];

      console.info('[RekognitionService] DetectFacesCommand concluído.', {
        faces: response.FaceDetails?.length ?? 0,
        confidence: detail?.Confidence ?? null
      });

      return detail?.Confidence ?? 0;
    } catch (error) {
      console.error('[RekognitionService] DetectFacesCommand falhou.', error);
      throw error;
    }
  }
}

