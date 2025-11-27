import { CommonModule } from '@angular/common';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  HostListener,
  Input,
  Signal,
  WritableSignal,
  inject,
  signal
} from '@angular/core';
import { LivenessService } from '../../services/liveness.service';
import { S3Service } from '../../core/aws/s3.service';
import { LivenessHistoryService } from '../../core/services/liveness-history.service';
import { FaceMatchService } from '../../core/services/face-match.service';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';
import { CustomReviewStepComponent, LivenessResult } from '../../components/custom-review-step/custom-review-step.component';
import { LivenessSummary } from '../../core/models/liveness-result.model';
import { firstValueFrom, from } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  startVideoRecording,
  MediaRecorderController,
  RecordedMedia,
  stopMediaStream
} from '../../core/utils/media-recorder.util';

declare var AwsLiveness: any;
declare const FaceLiveness: any;
declare const customElements: CustomElementRegistry;

@Component({
  selector: 'app-capture-official-liveness',
  standalone: true,
  imports: [CommonModule, CustomReviewStepComponent],
  templateUrl: './capture-official-liveness.component.html',
  styleUrls: ['./capture-official-liveness.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class CaptureOfficialLivenessComponent {
  private readonly livenessService = inject(LivenessService);
  private readonly s3Service = inject(S3Service);
  private readonly historyService = inject(LivenessHistoryService);
  private readonly faceMatchService = inject(FaceMatchService);
  private readonly faceService = inject(FaceRecognitionService);

  @Input({ required: true }) documentFileSignal!: Signal<File | null>;
  @Input({ required: true }) documentS3PathSignal!: Signal<string | null>;
  @Input({ required: true }) documentUrlSignal!: Signal<string | null>;
  @Input({ required: true }) documentKeySignal!: Signal<string | null>;
  @Input({ required: true }) documentScoreSignal!: WritableSignal<number | null>;
  @Input({ required: true }) documentAnalysisSignal!: WritableSignal<any | null>;
  @Input({ required: true }) isDocumentValidSignal!: WritableSignal<boolean | null>;
  @Input({ required: true }) documentValidationMessageSignal!: WritableSignal<string | null>;
  @Input({ required: true }) lastSummarySignal!: WritableSignal<LivenessSummary | null>;
  @Input({ required: true }) errorMessageSignal!: WritableSignal<string | null>;

  readonly isModalOpen = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly statusMessage = signal<string>('');
  readonly showReviewStep = signal<boolean>(false);
  readonly livenessResult = signal<LivenessResult | null>(null);
  readonly countdown = signal<number | null>(null);
  readonly showCountdown = signal<boolean>(false);
  readonly isVerifying = signal<boolean>(false);
  readonly showPreparationScreen = signal<boolean>(false);
  readonly preparationCountdown = signal<number>(5);
  readonly isRecordingVideo = signal<boolean>(false);
  readonly showCustomFlash = signal<boolean>(false);

  private widgetInstance: any = null;
  private verifyingObserverInterval: any = null;
  private sessionId = '';
  private videoRecorder: MediaRecorderController | null = null;
  private videoStream: MediaStream | null = null;
  private recordedVideo: RecordedMedia | null = null;

  readonly awsRegion: string = environment.aws?.region || 'us-east-1';
  readonly createSessionUrl: string = `${environment.apiUrl}/liveness/start`;
  readonly resultsUrl: string = `${environment.apiUrl}/liveness/results`;

  private get documentFile(): File | null {
    return this.documentFileSignal?.() ?? null;
  }

  private get documentS3Path(): string | null {
    return this.documentS3PathSignal?.() ?? null;
  }

  private get documentUrl(): string | null {
    return this.documentUrlSignal?.() ?? null;
  }

  private get documentKey(): string | null {
    return this.documentKeySignal?.() ?? null;
  }

  @HostListener('window:keydown.escape', ['$event'])
  handleEscape(event: KeyboardEvent): void {
    if (this.isModalOpen()) {
      event.preventDefault();
      this.closeModal();
    }
  }

  openModal(): void {
    if (!this.documentFile || !this.documentS3Path) {
      this.errorMessageSignal.set('Por favor, anexe um documento antes de iniciar a verificação.');
      return;
    }

    if (this.isDocumentValidSignal() === false) {
      this.errorMessageSignal.set('Documento inválido. Por favor, envie um RG ou CNH válido antes de iniciar a verificação.');
      return;
    }

    if (this.isDocumentValidSignal() === null) {
      this.errorMessageSignal.set('Aguarde a validação do documento antes de iniciar a verificação.');
      return;
    }

    this.errorMessageSignal.set(null);
    this.isModalOpen.set(true);
    this.showReviewStep.set(false);
    this.showPreparationScreen.set(true);
    this.isRecordingVideo.set(false);
    this.recordedVideo = null;
    (this as any)._videoKey = null;

    this.preparationCountdown.set(5);
    const countdownInterval = setInterval(() => {
      const current = this.preparationCountdown();
      if (current > 1) {
        this.preparationCountdown.set(current - 1);
      } else {
        clearInterval(countdownInterval);
        this.startVerificationAfterPreparation();
      }
    }, 1000);

    (this as any)._preparationCountdownInterval = countdownInterval;
  }

  private startVerificationAfterPreparation(): void {
    this.showPreparationScreen.set(false);
    this.errorMessageSignal.set(null);
    this.statusMessage.set('Preparando verificação...');
    setTimeout(() => {
      this.startSession();
    }, 150);
  }

  closeModal(): void {
    if ((this as any)._preparationCountdownInterval) {
      clearInterval((this as any)._preparationCountdownInterval);
      (this as any)._preparationCountdownInterval = null;
    }

    this.destroyWidget();
    this.isModalOpen.set(false);
    this.showReviewStep.set(false);
    this.showPreparationScreen.set(false);
    this.preparationCountdown.set(5);
    this.livenessResult.set(null);
    this.sessionId = '';
  }

  private async startSession(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.errorMessageSignal.set(null);
      this.statusMessage.set('Criando sessão AWS...');

      const sessionResponse = await firstValueFrom(this.livenessService.createSession());
      if (!sessionResponse?.sessionId) {
        throw new Error('Falha ao criar sessão: sessionId não retornado');
      }

      this.sessionId = sessionResponse.sessionId;
      this.statusMessage.set('Sessão criada. Carregando widget...');

      let attempts = 0;
      const maxAttempts = 15;
      const checkInterval = 200;

      while ((typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        attempts++;
      }

      let useLocalWidget = false;
      if (typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') {
        this.statusMessage.set('Widgets externos não disponíveis. Tentando widget local...');

        const customWidgetAvailable = customElements.get('face-liveness-widget') !== undefined;
        if (!customWidgetAvailable) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (customElements.get('face-liveness-widget')) {
          useLocalWidget = true;
          this.statusMessage.set('Usando widget local...');
        } else {
          throw new Error(
            'Widget AWS não está disponível.\n\n' +
            'Verifique:\n' +
            '1. Conexão com internet (scripts externos não carregaram)\n' +
            '2. Se o widget local está em /assets/liveness/widget.js\n' +
            '3. Recarregue a página após verificar'
          );
        }
      }

      if (useLocalWidget) {
        await this.initLocalWidget(this.sessionId);
      } else {
        await this.initWidget(this.sessionId);
      }

      this.isLoading.set(false);
      await this.startCountdown();
      await this.autoStartWidget();
      this.setupWidgetListeners();
    } catch (error: any) {
      console.error('[Liveness] Erro ao iniciar sessão:', error);
      this.errorMessageSignal.set(error?.message || 'Erro ao iniciar verificação.');
      this.statusMessage.set('Erro ao inicializar');
      this.isLoading.set(false);
    }
  }

  private async initWidget(sessionId: string): Promise<void> {
    const container = document.getElementById('liveness-container-official');
    if (!container) {
      throw new Error('Container do widget não encontrado.');
    }

    container.innerHTML = '';

    if (typeof AwsLiveness !== 'undefined') {
      this.widgetInstance = new AwsLiveness({
        sessionId,
        region: this.awsRegion,
        containerId: 'liveness-container-official',
        onComplete: (result: any) => this.handleWidgetComplete(result),
        onError: (error: any) => this.handleWidgetError(error)
      });
    } else if (typeof FaceLiveness !== 'undefined') {
      this.widgetInstance = FaceLiveness.create({
        sessionId,
        region: this.awsRegion,
        onComplete: (result: any) => this.handleWidgetComplete(result),
        onError: (error: any) => this.handleWidgetError(error)
      });
    } else {
      throw new Error('Widget AWS não disponível');
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    this.startVerifyingObserver();
    this.startVideoRecordingFromWidget();
  }

  private startVerifyingObserver(): void {
    if (this.verifyingObserverInterval) {
      clearInterval(this.verifyingObserverInterval);
    }

    this.verifyingObserverInterval = setInterval(() => {
      this.checkForVerifyingMessage();
    }, 200);
  }

  private checkForVerifyingMessage(): void {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    const allText = container.innerText || container.textContent || '';
    const textLower = allText.toLowerCase();
    const verifyingKeywords = ['verifying', 'verificando', 'check complete'];
    const hasVerifying = verifyingKeywords.some(keyword => textLower.includes(keyword));

    if (hasVerifying && !this.isVerifying()) {
      this.isVerifying.set(true);
      // Flash customizado ao iniciar verificação
      this.triggerCustomFlash(250);
    } else if (!hasVerifying && this.isVerifying() && !this.showReviewStep()) {
      const isProcessing = textLower.includes('processando') ||
        textLower.includes('processing') ||
        textLower.includes('analisando') ||
        textLower.includes('analyzing');
      if (!isProcessing) {
        this.isVerifying.set(false);
      }
    }
  }

  private stopVerifyingObserver(): void {
    if (this.verifyingObserverInterval) {
      clearInterval(this.verifyingObserverInterval);
      this.verifyingObserverInterval = null;
    }
  }

  private async initLocalWidget(sessionId: string): Promise<void> {
    const container = document.getElementById('liveness-container-official');
    if (!container) {
      throw new Error('Container do widget não encontrado.');
    }

    container.innerHTML = '';

    const widgetElement = document.createElement('face-liveness-widget');
    widgetElement.setAttribute('session-id', sessionId);
    widgetElement.setAttribute('region', this.awsRegion);
    widgetElement.setAttribute('create-session-url', this.createSessionUrl);
    widgetElement.setAttribute('results-url', this.resultsUrl);
    widgetElement.setAttribute('preset', 'face-liveness');
    widgetElement.setAttribute('challenge-versions', '1.5.0');
    widgetElement.setAttribute('video-normalization', 'on');
    widgetElement.setAttribute('dark-environment-boost', 'on');
    widgetElement.setAttribute('max-video-duration', '8000');

    if (environment.aws?.identityPoolId) {
      widgetElement.setAttribute('identity-pool-id', environment.aws.identityPoolId);
    }

    container.appendChild(widgetElement);

    const onComplete = (event: Event) => {
      const customEvent = event as CustomEvent;
      this.handleWidgetComplete(customEvent.detail);
    };

    const onError = (event: Event) => {
      const customEvent = event as CustomEvent;
      this.handleWidgetError(customEvent.detail);
    };

    document.addEventListener('liveness-complete', onComplete);
    document.addEventListener('liveness-error', onError);

    (this as any)._localWidgetListeners = { onComplete, onError };
  }

  private async startCountdown(): Promise<void> {
    this.showCountdown.set(true);
    this.countdown.set(3);
    this.statusMessage.set('');

    for (let i = 3; i > 0; i--) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.countdown.set(i - 1);
    }

    this.statusMessage.set('');
    await new Promise(resolve => setTimeout(resolve, 500));
    this.showCountdown.set(false);
    this.countdown.set(null);
    
    // Flash customizado ao finalizar countdown
    this.triggerCustomFlash();
  }

  private async autoStartWidget(): Promise<void> {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    await new Promise(resolve => setTimeout(resolve, 500));

    const buttonSelectors = [
      'button[data-testid="start-button"]',
      'button:contains("Iniciar")',
      'button:contains("Start")',
      'button:contains("Começar")',
      '.start-button',
      '[role="button"]',
      'button'
    ];

    let button: HTMLElement | null = null;
    for (const selector of buttonSelectors) {
      try {
        const elements = container.querySelectorAll(selector);
        for (const el of Array.from(elements)) {
          const text = el.textContent?.toLowerCase() || '';
          if (text.includes('iniciar') || text.includes('start') || text.includes('começar') || text.includes('ok')) {
            button = el as HTMLElement;
            break;
          }
        }
        if (button) break;
      } catch (e) {
        // ignore
      }
    }

    if (!button) {
      const buttons = container.querySelectorAll('button');
      for (const btn of Array.from(buttons)) {
        if (btn.offsetParent !== null) {
          button = btn as HTMLElement;
          break;
        }
      }
    }

    if (button) {
      // Flash customizado ao iniciar widget
      this.triggerCustomFlash(150);
      button.click();
    }
  }

  private setupWidgetListeners(): void {
    // Observar mudanças no container para detectar eventos do widget
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Observer para detectar quando o widget muda de estado
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'attributes') {
          // Verificar se há mudanças que indicam início de captura
          const videoElements = container.querySelectorAll('video');
          if (videoElements.length > 0) {
            const video = videoElements[0] as HTMLVideoElement;
            if (video.readyState >= 2 && !this.isRecordingVideo()) {
              // Flash quando vídeo está pronto para reprodução
              setTimeout(() => this.triggerCustomFlash(180), 300);
            }
          }
        }
      });
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    // Armazenar observer para limpeza
    (this as any)._widgetMutationObserver = observer;
  }

  private async handleWidgetComplete(result: any): Promise<void> {
    console.log('[Liveness] Widget completo:', result);
    this.isVerifying.set(false);
    this.statusMessage.set('Verificação concluída. Processando resultados...');

    // Flash customizado ao completar verificação
    this.triggerCustomFlash(300);

    await this.stopVideoRecording();

    try {
      const results = await firstValueFrom(this.livenessService.getResult(this.sessionId));
      if (!results) {
        throw new Error('Resultados não disponíveis');
      }

      const auditImages: { bucket: string; key: string; url?: string }[] = [];
      if (results.auditImageUrls && Array.isArray(results.auditImageUrls)) {
        const bucket = environment.aws?.bucket || 'dayfusion-docs';
        results.auditImageUrls.forEach((url: string, index: number) => {
          const key = `liveness/${this.sessionId}/audit_${index}.jpg`;
          auditImages.push({ bucket, key, url });
        });
      }

      const livenessResult: LivenessResult = {
        sessionId: this.sessionId,
        confidenceScore: (results.confidence || 0) * 100,
        fraudScore: results.livenessDecision === 'SPOOF' ? 100 : 0,
        auditImages,
        raw: results
      };

      this.livenessResult.set(livenessResult);

      if (this.recordedVideo && this.recordedVideo.blob.size > 0) {
        try {
          this.statusMessage.set('📤 Enviando vídeo ao S3...');
          const uploadResult = await firstValueFrom(
            from(this.s3Service.uploadLivenessVideo(this.sessionId, this.recordedVideo.blob, this.recordedVideo.mimeType))
          );
          (this as any)._videoKey = uploadResult.key;
        } catch (videoError) {
          console.error('[Liveness] Erro ao enviar vídeo:', videoError);
        }
      } else {
        console.warn('[Liveness] Nenhum vídeo gravado para enviar');
      }

      if (this.documentKey && auditImages.length > 0) {
        this.statusMessage.set('Analisando documento e comparando faces...');
        await this.performCompleteAnalysis(livenessResult);
      } else {
        this.showReviewStep.set(true);
      }
    } catch (error: any) {
      console.error('[Liveness] Erro ao processar resultados:', error);
      this.errorMessageSignal.set('Erro ao processar resultados da verificação.');
    }
  }

  private async performCompleteAnalysis(livenessResult: LivenessResult): Promise<void> {
    if (!this.documentKey || !livenessResult.auditImages?.length) {
      this.showReviewStep.set(true);
      return;
    }

    try {
      const firstAuditImage = livenessResult.auditImages[0];
      if (!firstAuditImage?.key) {
        console.warn('[Liveness] Não foi possível obter selfie de referência');
        this.showReviewStep.set(true);
        return;
      }

      const backendAnalysis = await firstValueFrom(
        this.faceService.getLivenessResult({
          sessionId: this.sessionId,
          documentKey: this.documentKey,
          selfieKey: firstAuditImage.key,
          localLivenessScore: livenessResult.confidenceScore,
          videoKey: (this as any)._videoKey
        })
      );

      if (backendAnalysis) {
        this.documentScoreSignal.set(backendAnalysis.documentScore || null);
        this.documentAnalysisSignal.set(backendAnalysis);

        const status = backendAnalysis.status?.toUpperCase();
        const docScore = backendAnalysis.documentScore ?? 0;
        const observacaoText = backendAnalysis.observacao || '';
        const isDocumentInvalid = docScore <= 0 ||
          docScore < 50 ||
          observacaoText.includes('Documento rejeitado') ||
          observacaoText.includes('não é RG') ||
          observacaoText.includes('não é CNH') ||
          observacaoText.includes('inválido') ||
          status === 'REJECTED';

        if (isDocumentInvalid) {
          const rejectedResult: LivenessResult = {
            ...livenessResult,
            raw: {
              ...livenessResult.raw,
              backendAnalysis,
              documentScore: docScore,
              documentAnalysis: backendAnalysis
            }
          };
          this.livenessResult.set(rejectedResult);
          this.showReviewStep.set(true);
          this.statusMessage.set('Análise completa - Documento rejeitado');
          return;
        }
      }

      this.statusMessage.set('Comparando com todas as imagens de liveness...');

      const matchResult = await firstValueFrom(
        this.faceMatchService.matchLivenessWithDocument(
          this.sessionId,
          this.documentS3Path!,
          livenessResult.auditImages
        )
      );

      const updatedResult: LivenessResult = {
        ...livenessResult,
        raw: {
          ...livenessResult.raw,
          matchResult,
          backendAnalysis: this.documentAnalysisSignal(),
          documentScore: this.documentScoreSignal()
        }
      };

      this.livenessResult.set(updatedResult);
      this.showReviewStep.set(true);
      this.statusMessage.set('Análise completa!');
    } catch (error: any) {
      console.error('[Liveness] Erro ao fazer análise completa:', error);
      this.showReviewStep.set(true);
    }
  }

  private handleWidgetError(error: any): void {
    console.error('[Liveness] Erro no widget:', error);
    this.errorMessageSignal.set(error?.message || 'Erro durante verificação.');
    this.statusMessage.set('Erro na verificação');
  }

  async handleReviewFinished(userObservation: string | null): Promise<void> {
    const result = this.livenessResult();
    if (!result) {
      this.closeModal();
      return;
    }

    const backendAnalysis = result.raw?.backendAnalysis;
    const documentScore = this.documentScoreSignal() || backendAnalysis?.documentScore || null;

    let videoSummary: LivenessSummary['video'] | undefined;
    if (this.recordedVideo && (this as any)._videoKey) {
      try {
        const videoUrl = await firstValueFrom(from(this.s3Service.getSignedUrl((this as any)._videoKey)));
        videoSummary = {
          s3Key: (this as any)._videoKey,
          url: videoUrl,
          mimeType: this.recordedVideo.mimeType,
          size: this.recordedVideo.blob.size,
          durationMs: this.recordedVideo.durationMs
        };
      } catch (error) {
        console.warn('[Liveness] Erro ao gerar URL do vídeo:', error);
      }
    }

    const finalObservacao = userObservation?.trim() || backendAnalysis?.observacao || backendAnalysis?.message || null;

    const summary: LivenessSummary = {
      sessionId: result.sessionId,
      createdAt: new Date().toISOString(),
      isLive: result.confidenceScore >= 70,
      livenessScore: result.confidenceScore,
      faceMatchScore: result.raw?.matchResult?.bestMatchScore,
      status: this.determineStatus(result),
      documentKey: this.documentKey || undefined,
      video: videoSummary,
      captures: result.auditImages?.map((img, idx) => ({
        position: `audit_${idx}`,
        confidence: result.confidenceScore,
        s3Key: img.key,
        previewUrl: img.url || ''
      })) || [],
      metadata: {
        documentS3Path: this.documentS3Path || '',
        documentKey: this.documentKey || '',
        documentUrl: this.documentUrl || '',
        ...(documentScore ? { documentScore: String(documentScore) } : {}),
        matchResult: JSON.stringify(result.raw?.matchResult || {}),
        ...(backendAnalysis ? { backendAnalysis: JSON.stringify(backendAnalysis) } : {}),
        ...(finalObservacao ? { observacao: finalObservacao } : {})
      },
      backendAnalysis: backendAnalysis ? {
        documentScore: documentScore || undefined,
        matchScore: backendAnalysis.matchScore || undefined,
        identityScore: backendAnalysis.identityScore || undefined,
        observacao: finalObservacao || undefined,
        message: backendAnalysis.message || undefined,
        status: backendAnalysis.status || undefined
      } : undefined
    };

    this.lastSummarySignal.set(summary);
    this.historyService.addEntry(summary);
    this.closeModal();
  }

  private determineStatus(result: LivenessResult): 'Aprovado' | 'Rejeitado' | 'Revisar' {
    const documentScore = this.documentScoreSignal() ?? result.raw?.backendAnalysis?.documentScore ?? 0;
    const backendAnalysis = result.raw?.backendAnalysis;
    const documentFlags = backendAnalysis?.observacao || '';
    const hasInvalidFlags = documentFlags.includes('não é RG') ||
      documentFlags.includes('não é CNH') ||
      documentFlags.includes('Documento rejeitado') ||
      documentFlags.includes('inválido');

    if (documentScore <= 0 || documentScore < 50 || hasInvalidFlags) {
      return 'Rejeitado';
    }

    const backendStatus = backendAnalysis?.status;
    if (backendStatus) {
      const statusUpper = backendStatus.toUpperCase();
      if (statusUpper === 'APPROVED' || statusUpper === 'APROVADO') {
        if (documentScore >= 85 && !hasInvalidFlags) {
          return 'Aprovado';
        }
        return 'Rejeitado';
      }
      if (statusUpper === 'REJECTED' || statusUpper === 'REJEITADO') {
        return 'Rejeitado';
      }
      if (statusUpper === 'REVIEW' || statusUpper === 'REVISAR') {
        return 'Revisar';
      }
    }

    const livenessScore = result.confidenceScore;
    const matchScore = result.raw?.matchResult?.bestMatchScore || 0;
    const finalScore = result.raw?.matchResult?.finalScore || livenessScore;
    const identityScore = result.raw?.backendAnalysis?.identityScore;

    if (identityScore !== undefined && identityScore !== null) {
      if (documentScore < 85 || hasInvalidFlags) {
        return 'Rejeitado';
      }
      if (identityScore >= 0.85 && documentScore >= 85) {
        return 'Aprovado';
      } else if (identityScore < 0.5 || documentScore < 50) {
        return 'Rejeitado';
      }
      return 'Revisar';
    }

    if (documentScore < 85 || hasInvalidFlags) {
      return 'Rejeitado';
    }

    if (livenessScore >= 90 && matchScore >= 80 && finalScore >= 85 && documentScore >= 85) {
      return 'Aprovado';
    } else if (livenessScore < 70 || matchScore < 50 || finalScore < 60 || documentScore < 50) {
      return 'Rejeitado';
    }
    return 'Revisar';
  }

  private async startVideoRecordingFromWidget(): Promise<void> {
    const maxAttempts = 30;
    let attempts = 0;

    const findAndRecordVideo = async (): Promise<void> => {
      const container = document.getElementById('liveness-container-official');
      if (!container) {
        if (attempts < maxAttempts) {
          attempts++;
          setTimeout(findAndRecordVideo, 500);
        }
        return;
      }

      const videoElements = container.querySelectorAll('video');
      for (const videoEl of Array.from(videoElements)) {
        const video = videoEl as HTMLVideoElement;
        if (video.srcObject && video.srcObject instanceof MediaStream) {
          const stream = video.srcObject as MediaStream;
          const videoTracks = stream.getVideoTracks();

          if (videoTracks.length > 0 && videoTracks[0].readyState === 'live') {
            try {
              this.videoStream = stream;
              this.videoRecorder = startVideoRecording(stream);
              this.isRecordingVideo.set(true);
              this.statusMessage.set('🎥 Gravando vídeo da sessão...');
              
              // Flash customizado ao iniciar gravação
              this.triggerCustomFlash();
              return;
            } catch (error) {
              console.error('[Liveness] Erro ao iniciar gravação:', error);
              this.isRecordingVideo.set(false);
            }
          }
        }
      }

      if (attempts < maxAttempts) {
        attempts++;
        setTimeout(findAndRecordVideo, 500);
      }
    };

    setTimeout(findAndRecordVideo, 1000);
  }

  private async stopVideoRecording(): Promise<void> {
    if (this.videoRecorder) {
      try {
        this.isRecordingVideo.set(false);
        this.recordedVideo = await this.videoRecorder.stopRecording();
        this.videoRecorder = null;
      } catch (error) {
        console.error('[Liveness] Erro ao parar gravação:', error);
        this.recordedVideo = null;
        this.isRecordingVideo.set(false);
      }
    }

    if (this.videoStream) {
      stopMediaStream(this.videoStream);
      this.videoStream = null;
    }
  }

  private destroyWidget(): void {
    this.stopVerifyingObserver();
    this.isVerifying.set(false);
    this.statusMessage.set('');
    this.showCustomFlash.set(false);
    void this.stopVideoRecording();

    // Limpar observer de mutação
    const mutationObserver = (this as any)._widgetMutationObserver;
    if (mutationObserver) {
      mutationObserver.disconnect();
      (this as any)._widgetMutationObserver = null;
    }

    if (this.widgetInstance) {
      try {
        if (typeof this.widgetInstance.destroy === 'function') {
          this.widgetInstance.destroy();
        }
      } catch (error) {
        console.warn('[Liveness] Erro ao destruir widget:', error);
      }
      this.widgetInstance = null;
    }

    const listeners = (this as any)._localWidgetListeners;
    if (listeners) {
      document.removeEventListener('liveness-complete', listeners.onComplete);
      document.removeEventListener('liveness-error', listeners.onError);
      (this as any)._localWidgetListeners = null;
    }

    const container = document.getElementById('liveness-container-official');
    if (container) {
      container.innerHTML = '';
    }

    (this as any)._videoKey = null;
    this.recordedVideo = null;
  }

  /**
   * Dispara o flash customizado por um breve período
   * 
   * O flash customizado é um overlay branco translúcido que aparece em momentos
   * específicos da verificação para fornecer feedback visual ao usuário, sem
   * interferir no widget AWS. Ele segue as diretrizes do documento de correção
   * que especifica usar apenas cores translúcidas (não cores berrantes).
   * 
   * @param duration Duração em milissegundos (padrão: 200ms)
   */
  triggerCustomFlash(duration: number = 200): void {
    if (!this.isModalOpen()) {
      return; // Não disparar flash se modal não estiver aberto
    }
    
    this.showCustomFlash.set(true);
    setTimeout(() => {
      this.showCustomFlash.set(false);
    }, duration);
  }
}
