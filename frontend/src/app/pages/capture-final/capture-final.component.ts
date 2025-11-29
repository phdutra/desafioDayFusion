import { Component, OnInit, signal, ViewChild, AfterViewInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { LivenessModalFinalComponent, LivenessResult } from './liveness-modal-final.component';
import { S3Service } from '../../core/aws/s3.service';
import { CompressionService } from '../../core/services/compression.service';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';
import { firstValueFrom, from } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-capture-final',
  standalone: true,
  imports: [CommonModule, LivenessModalFinalComponent],
  templateUrl: './capture-final.component.html',
  styleUrls: ['./capture-final.component.scss']
})
export class CaptureFinalComponent implements OnInit, AfterViewInit {
  @ViewChild(LivenessModalFinalComponent) livenessModal?: LivenessModalFinalComponent;

  private readonly s3Service = inject(S3Service);
  private readonly compressionService = inject(CompressionService);
  private readonly faceService = inject(FaceRecognitionService);

  // Estado do componente
  readonly isModalOpen = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly livenessResult = signal<LivenessResult | null>(null);
  
  // Estado do documento
  readonly isUploadingDocument = signal<boolean>(false);
  readonly documentFile = signal<File | null>(null);
  readonly documentS3Path = signal<string | null>(null);
  readonly documentUrl = signal<string | null>(null);
  readonly documentKey = signal<string | null>(null);
  readonly documentScore = signal<number | null>(null);
  readonly documentAnalysis = signal<any | null>(null);
  readonly isDocumentValid = signal<boolean | null>(null);
  readonly documentValidationMessage = signal<string | null>(null);
  readonly compressionInfo = signal<{ original: string; compressed: string; reduction: string } | null>(null);
  
  readonly documentInfo = computed(() => {
    const file = this.documentFile();
    if (!file) return null;
    return {
      name: file.name,
      sizeKb: file.size / 1024
    };
  });
  
  private shouldStartLiveness = false;

  constructor(private readonly router: Router) {}

  ngOnInit(): void {
    console.log('[Capture Final] Componente inicializado');
    // Garantir que o modal está fechado ao inicializar
    this.isModalOpen.set(false);
    this.errorMessage.set(null);
    this.livenessResult.set(null);
  }

  ngAfterViewInit(): void {
    // Se já foi solicitado o início, iniciar agora
    if (this.shouldStartLiveness && this.livenessModal) {
      setTimeout(() => {
        this.livenessModal?.startLiveness();
        this.shouldStartLiveness = false;
      }, 100);
    }
  }

  /**
   * Inicia o processo de verificação facial (sem contagem regressiva)
   */
  startVerification(): void {
    console.log('[Capture Final] Iniciando verificação...');
    
    // Resetar estados
    this.errorMessage.set(null);
    this.livenessResult.set(null);
    
    // Abrir modal primeiro
    this.isModalOpen.set(true);
    console.log('[Capture Final] Modal aberto:', this.isModalOpen());
    
    // Aguardar um pouco para o modal renderizar antes de iniciar o liveness
    setTimeout(() => {
      if (this.livenessModal) {
        console.log('[Capture Final] Iniciando liveness...');
        this.livenessModal.startLiveness();
      } else {
        console.warn('[Capture Final] Modal não disponível ainda, marcando para iniciar depois...');
        this.shouldStartLiveness = true;
      }
    }, 300);
  }

  /**
   * Callback quando a verificação é completa
   */
  onLivenessComplete(result: LivenessResult): void {
    console.log('[Capture Final] Verificação completa:', result);
    this.livenessResult.set(result);
    this.isModalOpen.set(false);
  }

  /**
   * Callback quando ocorre erro
   */
  onLivenessError(error: string): void {
    console.error('[Capture Final] Erro na verificação:', error);
    this.errorMessage.set(error);
    this.isModalOpen.set(false);
  }

  /**
   * Fecha o modal de verificação
   */
  closeModal(): void {
    this.isModalOpen.set(false);
  }

  /**
   * Navega para o histórico
   */
  goToHistory(): void {
    this.router.navigate(['/history']);
  }

  /**
   * Determina a cor do status
   */
  getStatusColor(status: 'LIVE' | 'FAKE'): string {
    return status === 'LIVE' ? 'success' : 'danger';
  }

  /**
   * Determina o ícone do status
   */
  getStatusIcon(status: 'LIVE' | 'FAKE'): string {
    return status === 'LIVE' ? '✅' : '❌';
  }

  /**
   * Determina o texto do status
   */
  getStatusText(status: 'LIVE' | 'FAKE'): string {
    return status === 'LIVE' ? 'Pessoa Real Detectada' : 'Possível Fraude Detectada';
  }

  /**
   * Handler para seleção de documento
   */
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
        console.log('[Capture Final] 📸 Comprimindo documento antes do upload...');
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
        } catch (compressionError) {
          console.warn('[Capture Final] ⚠️ Erro ao comprimir documento, usando original:', compressionError);
          this.compressionInfo.set(null);
        }
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
            .catch(() => console.warn('[Capture Final] Não foi possível gerar URL assinada'));
        }

        // Validar documento
        this.validateDocument(uploadResult.key).catch(error => {
          console.error('[Capture Final] Erro na validação do documento:', error);
        });
      }
    } catch (error: any) {
      console.error('Erro ao enviar documento:', error);
      this.errorMessage.set('Erro ao enviar documento. Tente novamente.');
      this.isDocumentValid.set(false);
    } finally {
      this.isUploadingDocument.set(false);
    }
  }

  /**
   * Limpa o documento selecionado
   */
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

  /**
   * Valida o documento
   */
  private async validateDocument(documentKey: string): Promise<void> {
    try {
      this.isDocumentValid.set(null);
      this.documentValidationMessage.set(null);

      const bucket = environment.aws?.bucket || 'dayfusion-docs';
      const keyOnly = documentKey.includes('/') ? documentKey.split('/').pop() : documentKey;

      if (!keyOnly) {
        this.isDocumentValid.set(false);
        this.documentValidationMessage.set('Erro ao processar documento');
        return;
      }

      const validationResult = await firstValueFrom(
        this.faceService.validateDocument(keyOnly, bucket).pipe(timeout(30000))
      );

      if (validationResult) {
        this.documentScore.set(validationResult.documentScore);
        this.isDocumentValid.set(validationResult.isValid);

        if (!validationResult.isValid) {
          this.documentValidationMessage.set(validationResult.observacao || 'Documento inválido');
        }
      } else {
        this.isDocumentValid.set(false);
        this.documentValidationMessage.set('Erro ao validar documento');
      }
    } catch (error: any) {
      console.error('[Capture Final] Erro ao validar documento:', error);
      this.isDocumentValid.set(false);
      this.documentValidationMessage.set('Erro ao validar documento');
    }
  }

  /**
   * Handler para erro ao carregar imagem do documento
   */
  onDocumentImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    console.warn('[Capture Final] Erro ao carregar imagem do documento:', img.src);
    if (this.documentS3Path()) {
      img.src = `/api/media/document?path=${encodeURIComponent(this.documentS3Path()!)}`;
    }
  }
}

