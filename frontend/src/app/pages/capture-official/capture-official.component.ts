import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { S3Service } from '../../core/aws/s3.service';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';
import { CompressionService } from '../../core/services/compression.service';
import { LivenessSummary } from '../../core/models/liveness-result.model';
import { firstValueFrom, from } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { CaptureOfficialLivenessComponent } from './capture-official-liveness.component';

@Component({
  selector: 'app-capture-official',
  standalone: true,
  imports: [CommonModule, CaptureOfficialLivenessComponent],
  templateUrl: './capture-official.component.html',
  styleUrls: ['./capture-official.component.scss']
})
export class CaptureOfficialComponent {
  private readonly s3Service = inject(S3Service);
  private readonly faceService = inject(FaceRecognitionService);
  private readonly router = inject(Router);
  private readonly compressionService = inject(CompressionService);

  @ViewChild('livenessComponent') livenessComponent?: CaptureOfficialLivenessComponent;

  readonly isUploadingDocument = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly documentFile = signal<File | null>(null);
  readonly documentS3Path = signal<string | null>(null);
  readonly documentUrl = signal<string | null>(null);
  readonly documentKey = signal<string | null>(null);
  readonly documentScore = signal<number | null>(null);
  readonly documentAnalysis = signal<any | null>(null);
  readonly isDocumentValid = signal<boolean | null>(null);
  readonly documentValidationMessage = signal<string | null>(null);
  readonly compressionInfo = signal<{ original: string; compressed: string; reduction: string } | null>(null);
  readonly lastSummary = signal<LivenessSummary | null>(null);

  readonly documentInfo = computed(() => {
    const file = this.documentFile();
    if (!file) return null;
    return {
      name: file.name,
      sizeKb: file.size / 1024
    };
  });

  readonly statusSummary = computed(() => {
    const summary = this.lastSummary();
    if (!summary) return null;
    return {
      status: summary.status,
      livenessScore: summary.livenessScore,
      faceMatchScore: summary.faceMatchScore ?? null,
      sessionId: summary.sessionId,
      createdAt: summary.createdAt
    };
  });

  async onDocumentSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;

    this.documentFile.set(file);
    input.value = '';

    try {
      this.isUploadingDocument.set(true);
      this.errorMessage.set(null);

      let fileToUpload = file;
      const originalSizeKB = (file.size / 1024).toFixed(2);

      if (file.type.startsWith('image/')) {
        console.log('[Capture Official] 📸 Comprimindo documento antes do upload...');
        console.log(`[Capture Official] Tamanho original: ${originalSizeKB} KB`);
        console.log(`[Capture Official] Tipo: ${file.type}`);

        try {
          const compressedFile = await this.compressionService.compressImage(file);
          fileToUpload = compressedFile;

          const compressedSizeKB = (compressedFile.size / 1024).toFixed(2);
          const reduction = ((1 - compressedFile.size / file.size) * 100).toFixed(1);

          this.compressionInfo.set({
            original: originalSizeKB,
            compressed: compressedSizeKB,
            reduction
          });

          console.log('[Capture Official] ✅ Documento comprimido:', {
            original: `${originalSizeKB} KB`,
            compressed: `${compressedSizeKB} KB`,
            reduction: `${reduction}%`
          });
        } catch (compressionError) {
          console.warn('[Capture Official] ⚠️ Erro ao comprimir documento, usando original:', compressionError);
          this.compressionInfo.set(null);
        }
      } else {
        console.log(`[Capture Official] ⚠️ Arquivo não é imagem, upload sem compressão (tamanho: ${originalSizeKB} KB)`);
        this.compressionInfo.set(null);
      }

      const uploadResult = await firstValueFrom(this.s3Service.uploadDocument(fileToUpload));

      if (uploadResult?.key) {
        const bucket = environment.aws?.bucket || 'dayfusion-docs';
        const s3Path = `s3://${bucket}/${uploadResult.key}`;
        this.documentS3Path.set(s3Path);
        this.documentKey.set(uploadResult.key);

        if (uploadResult.url) {
          this.documentUrl.set(uploadResult.url);
        } else {
          firstValueFrom(from(this.s3Service.getSignedUrl(uploadResult.key)))
            .then(url => this.documentUrl.set(url))
            .catch(() => console.warn('[Capture Official] Não foi possível gerar URL assinada'));
        }

        this.validateDocument(uploadResult.key).catch(error => {
          console.error('[Capture Official] Erro na validação do documento:', error);
        });
      }
    } catch (error: any) {
      console.error('Erro ao enviar documento:', error);
      
      // Verificar se é erro de conexão (backend não está rodando)
      if (error?.status === 0 || error?.message?.includes('ERR_CONNECTION_REFUSED')) {
        this.errorMessage.set('Backend não está disponível. Verifique se o servidor está rodando na porta 7197.');
      } else {
        this.errorMessage.set('Erro ao enviar documento. Tente novamente.');
      }
      
      this.isDocumentValid.set(false);
    } finally {
      this.isUploadingDocument.set(false);
    }
  }

  clearDocument(): void {
    this.documentFile.set(null);
    this.documentS3Path.set(null);
    this.documentUrl.set(null);
    this.documentKey.set(null);
    this.documentScore.set(null);
    this.documentAnalysis.set(null);
    this.isDocumentValid.set(null);
    this.documentValidationMessage.set(null);
    this.compressionInfo.set(null);
  }

  private async validateDocument(documentKey: string): Promise<void> {
    try {
      this.isDocumentValid.set(null);
      this.documentValidationMessage.set(null);

      const bucket = environment.aws?.bucket || 'dayfusion-docs';
      const keyOnly = documentKey.includes('/') ? documentKey.split('/').pop() : documentKey;

      if (!keyOnly) {
        console.warn('[Capture Official] Não foi possível extrair key do documento');
        this.isDocumentValid.set(false);
        this.documentValidationMessage.set('Erro ao processar documento');
        return;
      }

      console.log('[Capture Official] Validando documento como RG/CNH:', keyOnly);

      const validationResult = await firstValueFrom(
        this.faceService.validateDocument(keyOnly, bucket).pipe(timeout(30000))
      );

      if (validationResult) {
        this.documentScore.set(validationResult.documentScore);
        this.isDocumentValid.set(validationResult.isValid);

        console.log('[Capture Official] Resultado da validação:', validationResult);

        if (!validationResult.isValid) {
          this.documentValidationMessage.set(validationResult.observacao || 'Documento inválido');
          this.errorMessage.set('Documento não é um RG ou CNH válido. Por favor, envie um documento válido.');
        } else {
          this.documentValidationMessage.set(null);
          this.errorMessage.set(null);
        }
      } else {
        this.isDocumentValid.set(false);
        this.documentValidationMessage.set('Erro ao validar documento');
        this.errorMessage.set('Erro ao validar documento. Tente novamente.');
      }
    } catch (error: any) {
      console.error('[Capture Official] Erro ao validar documento:', error);
      this.isDocumentValid.set(false);
      this.documentValidationMessage.set('Erro ao validar documento');

      // Verificar se é erro de conexão (backend não está rodando)
      if (error?.status === 0 || error?.message?.includes('ERR_CONNECTION_REFUSED')) {
        this.errorMessage.set('Backend não está disponível. Verifique se o servidor está rodando na porta 7197.');
      } else if (error?.name === 'TimeoutError') {
        this.errorMessage.set('Timeout ao validar documento. Verifique sua conexão e tente novamente.');
      } else {
        this.errorMessage.set(error?.message || 'Erro ao validar documento. Verifique sua conexão e tente novamente.');
      }
    }
  }

  startLivenessVerification(): void {
    this.livenessComponent?.openModal();
  }

  goToHistory(): void {
    this.router.navigate(['/history']);
  }

  onDocumentImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    console.warn('[Capture Official] Erro ao carregar imagem do documento:', img.src);
    // Tentar usar o S3 path se disponível
    if (this.documentS3Path()) {
      img.src = `/api/media/document?path=${encodeURIComponent(this.documentS3Path()!)}`;
    }
  }

  onThumbImageError(event: Event, s3Key: string): void {
    const img = event.target as HTMLImageElement;
    if (img && s3Key) {
      img.src = `/api/media/liveness-frame?bucket=dayfusion-docs&key=${encodeURIComponent(s3Key)}`;
    }
  }
}
