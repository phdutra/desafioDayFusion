import { Injectable } from '@angular/core';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CognitoService } from './cognito.service';
import { environment } from '../../../environments/environment';

interface UploadResult {
  key: string;
  url?: string;
  mimeType: string;
  size: number;
}

@Injectable({
  providedIn: 'root'
})
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly cognitoService: CognitoService) {
    const region = environment.aws?.region;
    const bucket = environment.aws?.bucket;

    if (!region || !bucket) {
      throw new Error('Configuração S3 ausente: verifique environment.aws.region e environment.aws.bucket.');
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      credentials: this.cognitoService.getCredentialsProvider()
    });

    this.client.middlewareStack.add(
      (next, context) => async (args) => {
        const request: any = args.request;
        if (request?.body) {
          const body = request.body;
          console.info('[S3Service][Middleware] Request body antes do envio.', {
            type: typeof body,
            constructorName: body?.constructor?.name,
            hasGetReader: typeof body?.getReader === 'function',
            hasStream: typeof body?.stream === 'function'
          });

          if (typeof body?.getReader !== 'function' && typeof body?.stream === 'function') {
            try {
              const streamResult = body.stream();
              console.info('[S3Service][Middleware] Resultado de body.stream().', {
                constructorName: streamResult?.constructor?.name,
                hasGetReader: typeof streamResult?.getReader === 'function'
              });
            } catch (streamError) {
              console.warn('[S3Service][Middleware] Falha ao executar body.stream().', streamError);
            }
          }
        } else {
          console.info('[S3Service][Middleware] Request sem body.');
        }

        return next(args);
      },
      {
        step: 'build',
        name: 's3BodyInspectorMiddleware'
      }
    );
  }

  async uploadLivenessAsset(sessionId: string, position: string, blob: Blob): Promise<UploadResult> {
    const extension = this.resolveExtension(blob.type, 'jpg');
    const key = `liveness/${sessionId}/${Date.now()}-${position}.${extension}`;
    return this.uploadBlobToS3(key, blob);
  }

  async uploadLivenessVideo(sessionId: string, blob: Blob, mimeType: string): Promise<UploadResult> {
    const extension = this.resolveExtension(mimeType || blob.type, 'webm');
    const key = `liveness/${sessionId}/session-video.${extension}`;
    return this.uploadBlobToS3(key, blob, { resourceType: 'video' });
  }

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    console.info('[S3Service] Gerando URL assinada.', {
      bucket: this.bucket,
      key,
      expiresInSeconds
    });

    try {
      const url = await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
      console.info('[S3Service] URL assinada gerada.', { key });
      return url;
    } catch (error) {
      console.error('[S3Service] Falha ao gerar URL assinada.', error);
      throw error;
    }
  }

  private resolveExtension(mimeType: string | undefined, fallback: string): string {
    if (!mimeType) {
      return fallback;
    }

    if (mimeType.includes('png')) {
      return 'png';
    }

    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      return 'jpg';
    }

    if (mimeType.includes('webm')) {
      return 'webm';
    }

    if (mimeType.includes('mp4')) {
      return 'mp4';
    }

    if (mimeType.includes('mov')) {
      return 'mov';
    }

    return fallback;
  }

  private async uploadBlobToS3(key: string, blob: Blob, metadata: Record<string, unknown> = {}): Promise<UploadResult> {
    const arrayBuffer = await blob.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);
    const mimeType = blob.type || 'application/octet-stream';

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType
    });

    console.info('[S3Service] Enviando PutObjectCommand.', {
      bucket: this.bucket,
      key,
      contentType: mimeType,
      size: blob.size,
      bodyType: body.constructor.name,
      ...metadata
    });

    try {
      await this.client.send(command);
      console.info('[S3Service] Upload concluído com sucesso.', { key });
    } catch (error: any) {
      console.error('[S3Service] PutObjectCommand falhou.', error);
      if (error?.name === 'TypeError' && typeof error?.message === 'string' && error.message.includes('getReader')) {
        console.warn('[S3Service] getReader indisponível no Blob original. Upload refeito usando ArrayBuffer.');
      } else if (error?.$metadata?.httpStatusCode === 403) {
        console.error('[S3Service] Acesso negado ao bucket. Verifique permissões IAM da identity pool.');
      }
      throw error;
    }

    const url = await this.getSignedUrl(key);

    return {
      key,
      url,
      mimeType,
      size: blob.size
    };
  }
}

