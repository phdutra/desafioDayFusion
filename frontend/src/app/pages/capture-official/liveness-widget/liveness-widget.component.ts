import { CommonModule } from '@angular/common';
import { Component, EventEmitter, inject, Input, OnDestroy, Output, signal, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { LivenessService } from '../../../services/liveness.service';
import { S3Service } from '../../../core/aws/s3.service';
import { FaceMatchService } from '../../../core/services/face-match.service';
import { FaceRecognitionService } from '../../../core/services/face-recognition.service';
import { LivenessResult } from '../../../components/custom-review-step/custom-review-step.component';
import { firstValueFrom, from } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  startVideoRecording,
  MediaRecorderController,
  RecordedMedia,
  stopMediaStream
} from '../../../core/utils/media-recorder.util';

declare var AwsLiveness: any;
declare const FaceLiveness: any;
declare const customElements: CustomElementRegistry;

@Component({
  selector: 'app-liveness-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './liveness-widget.component.html',
  styleUrls: ['./liveness-widget.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class LivenessWidgetComponent implements OnDestroy {
  private readonly livenessService = inject(LivenessService);
  private readonly s3Service = inject(S3Service);
  private readonly faceMatchService = inject(FaceMatchService);
  private readonly faceService = inject(FaceRecognitionService);

  @Input() documentKey: string | null = null;
  @Input() documentS3Path: string | null = null;
  @Output() livenessComplete = new EventEmitter<LivenessResult>();
  @Output() error = new EventEmitter<string>();
  @Output() statusChange = new EventEmitter<string>();

  // Estados
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly statusMessage = signal<string>('');
  readonly showReviewStep = signal<boolean>(false);
  readonly livenessResult = signal<LivenessResult | null>(null);
  readonly countdown = signal<number | null>(null);
  readonly showCountdown = signal<boolean>(false);
  readonly isVerifying = signal<boolean>(false);
  readonly showPreparationScreen = signal<boolean>(false);
  readonly preparationCountdown = signal<number>(5);
  readonly isRecordingVideo = signal<boolean>(false);

  // AWS Widget
  private widgetInstance: any = null;
  private verifyingObserverInterval: any = null;
  private sessionId: string = '';
  private videoRecorder: MediaRecorderController | null = null;
  private videoStream: MediaStream | null = null;
  private recordedVideo: RecordedMedia | null = null;
  readonly awsRegion: string = environment.aws?.region || 'us-east-1';
  readonly createSessionUrl: string = `${environment.apiUrl}/liveness/start`;
  readonly resultsUrl: string = `${environment.apiUrl}/liveness/results`;

  ngOnDestroy(): void {
    this.destroyWidget();
  }

  startVerification(): void {
    this.errorMessage.set(null);
    this.showReviewStep.set(false);
    this.showPreparationScreen.set(true);
    this.isRecordingVideo.set(false);
    this.recordedVideo = null;
    (this as any)._videoKey = null;
    
    // Iniciar contagem regressiva na tela de preparação (5 segundos)
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
    
    // Limpar intervalo se componente for destruído
    (this as any)._preparationCountdownInterval = countdownInterval;
  }

  private startVerificationAfterPreparation(): void {
    console.log('[Liveness Widget] Iniciando verificação após preparação...');
    this.showPreparationScreen.set(false);
    this.errorMessage.set(null);
    this.statusMessage.set('Preparando verificação...');
    this.statusChange.emit('Preparando verificação...');
    setTimeout(() => {
      this.startSession();
    }, 150);
  }

  stop(): void {
    // Limpar intervalo de contagem regressiva da preparação
    if ((this as any)._preparationCountdownInterval) {
      clearInterval((this as any)._preparationCountdownInterval);
      (this as any)._preparationCountdownInterval = null;
    }
    
    this.destroyWidget();
    this.showReviewStep.set(false);
    this.showPreparationScreen.set(false);
    this.preparationCountdown.set(5);
    this.livenessResult.set(null);
    this.sessionId = '';
  }

  async startSession(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.errorMessage.set(null);
      this.statusMessage.set('Criando sessão AWS...');
      this.statusChange.emit('Criando sessão AWS...');

      // Criar sessão no backend
      const sessionResponse = await firstValueFrom(this.livenessService.createSession());
      if (!sessionResponse?.sessionId) {
        throw new Error('Falha ao criar sessão: sessionId não retornado');
      }

      this.sessionId = sessionResponse.sessionId;
      this.statusMessage.set('Sessão criada. Carregando widget...');
      this.statusChange.emit('Sessão criada. Carregando widget...');

      // Aguardar widget estar disponível (oficial ou local)
      let attempts = 0;
      const maxAttempts = 15;
      const checkInterval = 200;
      
      while ((typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        attempts++;
      }

      // Tentar carregar widget local se os externos falharam
      let useLocalWidget = false;
      if (typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') {
        this.statusMessage.set('Widgets externos não disponíveis. Tentando widget local...');
        this.statusChange.emit('Widgets externos não disponíveis. Tentando widget local...');
        
        const customWidgetAvailable = customElements.get('face-liveness-widget') !== undefined;
        
        if (!customWidgetAvailable) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        if (customElements.get('face-liveness-widget')) {
          useLocalWidget = true;
          this.statusMessage.set('Usando widget local...');
          this.statusChange.emit('Usando widget local...');
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

      // Inicializar widget
      if (useLocalWidget) {
        await this.initLocalWidget(this.sessionId);
      } else {
        await this.initWidget(this.sessionId);
      }
      
      this.isLoading.set(false);
      
      // Iniciar contagem regressiva antes de começar
      await this.startCountdown();
      
      // Auto-iniciar widget após contagem
      await this.autoStartWidget();

      // Configurar listeners
      this.setupWidgetListeners();
    } catch (error: any) {
      console.error('[Liveness Widget] Erro ao iniciar sessão:', error);
      const errorMsg = error?.message || 'Erro ao iniciar verificação.';
      this.errorMessage.set(errorMsg);
      this.error.emit(errorMsg);
      this.statusMessage.set('Erro ao inicializar');
      this.statusChange.emit('Erro ao inicializar');
      this.isLoading.set(false);
    }
  }

  private async initWidget(sessionId: string): Promise<void> {
    const container = document.getElementById('liveness-container-official');
    if (!container) {
      throw new Error('Container do widget não encontrado.');
    }

    container.innerHTML = '';

    // Inicializar widget oficial AWS
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
      console.log('[Liveness Widget] Detectado "Verifying..." - ativando loading');
      this.isVerifying.set(true);
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
        // Ignorar erros de seletor
      }
    }

    if (!button) {
      const buttons = container.querySelectorAll('button');
      for (const btn of Array.from(buttons)) {
        if (btn.offsetParent !== null) {
          button = btn;
          break;
        }
      }
    }

    if (button) {
      console.log('[Liveness Widget] Clicando no botão de iniciar automaticamente');
      button.click();
    } else {
      console.warn('[Liveness Widget] Botão de iniciar não encontrado, usuário precisará clicar manualmente');
    }
  }

  private setupWidgetListeners(): void {
    // Listeners já configurados no initWidget ou initLocalWidget
  }

  private async handleWidgetComplete(result: any): Promise<void> {
    console.log('[Liveness Widget] Widget completo:', result);
    this.isVerifying.set(false);
    this.statusMessage.set('Verificação concluída. Processando resultados...');
    this.statusChange.emit('Verificação concluída. Processando resultados...');

    await this.stopVideoRecording();

    try {
      const results = await firstValueFrom(
        this.livenessService.getResult(this.sessionId)
      );

      if (!results) {
        throw new Error('Resultados não disponíveis');
      }

      const auditImages: { bucket: string; key: string; url?: string }[] = [];
      if (results.auditImageUrls && Array.isArray(results.auditImageUrls)) {
        const bucket = environment.aws?.bucket || 'dayfusion-docs';
        results.auditImageUrls.forEach((url: string, index: number) => {
          const key = `liveness/${this.sessionId}/audit_${index}.jpg`;
          auditImages.push({
            bucket,
            key,
            url
          });
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

      // Upload do vídeo gravado
      if (this.recordedVideo && this.recordedVideo.blob.size > 0) {
        try {
          this.statusMessage.set('📤 Enviando vídeo ao S3...');
          this.statusChange.emit('📤 Enviando vídeo ao S3...');
          const uploadResult = await firstValueFrom(
            from(this.s3Service.uploadLivenessVideo(this.sessionId, this.recordedVideo.blob, this.recordedVideo.mimeType))
          );
          console.log('[Liveness Widget] ✅ Vídeo enviado ao S3 com sucesso!', {
            key: uploadResult.key,
            size: `${(this.recordedVideo.blob.size / 1024 / 1024).toFixed(2)} MB`
          });
          (this as any)._videoKey = uploadResult.key;
        } catch (videoError) {
          console.error('[Liveness Widget] ❌ Erro ao enviar vídeo:', videoError);
        }
      }

      // Se temos documento, fazer análise completa
      if (this.documentKey && auditImages.length > 0) {
        this.statusMessage.set('Analisando documento e comparando faces...');
        this.statusChange.emit('Analisando documento e comparando faces...');
        await this.performCompleteAnalysis(livenessResult);
      } else {
        // Emitir resultado mesmo sem documento
        this.livenessComplete.emit(livenessResult);
      }
    } catch (error: any) {
      console.error('[Liveness Widget] Erro ao processar resultados:', error);
      const errorMsg = 'Erro ao processar resultados da verificação.';
      this.errorMessage.set(errorMsg);
      this.error.emit(errorMsg);
    }
  }

  private async performCompleteAnalysis(livenessResult: LivenessResult): Promise<void> {
    if (!this.documentKey || !livenessResult.auditImages?.length) {
      this.livenessComplete.emit(livenessResult);
      return;
    }

    try {
      const firstAuditImage = livenessResult.auditImages[0];
      if (!firstAuditImage?.key) {
        console.warn('[Liveness Widget] Não foi possível obter selfie de referência');
        this.livenessComplete.emit(livenessResult);
        return;
      }

      this.statusMessage.set('Analisando documento e comparando faces...');
      this.statusChange.emit('Analisando documento e comparando faces...');
      
      const backendAnalysis = await firstValueFrom(
        this.faceService.getLivenessResult({
          sessionId: this.sessionId,
          documentKey: this.documentKey,
          selfieKey: firstAuditImage.key,
          localLivenessScore: livenessResult.confidenceScore,
          videoKey: (this as any)._videoKey
        })
      );

      // Fazer match adicional se documento for válido
      let matchResult = null;
      if (this.documentS3Path) {
        this.statusMessage.set('Comparando com todas as imagens de liveness...');
        this.statusChange.emit('Comparando com todas as imagens de liveness...');
        
        matchResult = await firstValueFrom(
          this.faceMatchService.matchLivenessWithDocument(
            this.sessionId,
            this.documentS3Path,
            livenessResult.auditImages
          )
        );
      }

      const updatedResult: LivenessResult = {
        ...livenessResult,
        raw: {
          ...livenessResult.raw,
          matchResult,
          backendAnalysis,
          documentScore: backendAnalysis?.documentScore,
          documentAnalysis: backendAnalysis
        }
      };

      this.livenessResult.set(updatedResult);
      this.livenessComplete.emit(updatedResult);
      this.statusMessage.set('Análise completa!');
      this.statusChange.emit('Análise completa!');
    } catch (error: any) {
      console.error('[Liveness Widget] Erro ao fazer análise completa:', error);
      // Emitir resultado mesmo se análise falhar
      this.livenessComplete.emit(livenessResult);
    }
  }

  private handleWidgetError(error: any): void {
    console.error('[Liveness Widget] Erro no widget:', error);
    const errorMsg = error?.message || 'Erro durante verificação.';
    this.errorMessage.set(errorMsg);
    this.error.emit(errorMsg);
    this.statusMessage.set('Erro na verificação');
    this.statusChange.emit('Erro na verificação');
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
            console.log('[Liveness Widget] 🎥 Stream de vídeo encontrado, iniciando gravação...');
            this.videoStream = stream;
            try {
              this.videoRecorder = startVideoRecording(stream);
              this.isRecordingVideo.set(true);
              console.log('[Liveness Widget] ✅ Gravação de vídeo INICIADA com sucesso!');
              this.statusMessage.set('🎥 Gravando vídeo da sessão...');
              this.statusChange.emit('🎥 Gravando vídeo da sessão...');
              return;
            } catch (error) {
              console.error('[Liveness Widget] ❌ Erro ao iniciar gravação:', error);
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
        console.log('[Liveness Widget] 🛑 Parando gravação de vídeo...');
        this.isRecordingVideo.set(false);
        this.recordedVideo = await this.videoRecorder.stopRecording();
        this.videoRecorder = null;
        console.log('[Liveness Widget] ✅ Vídeo gravado com sucesso!', {
          size: `${(this.recordedVideo.blob.size / 1024 / 1024).toFixed(2)} MB`,
          duration: `${(this.recordedVideo.durationMs / 1000).toFixed(2)} segundos`,
          mimeType: this.recordedVideo.mimeType
        });
      } catch (error) {
        console.error('[Liveness Widget] ❌ Erro ao parar gravação:', error);
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
    
    const existingStyle = document.getElementById('capture-official-widget-override');
    if (existingStyle) {
      existingStyle.remove();
    }

    void this.stopVideoRecording();

    if (this.widgetInstance) {
      try {
        if (typeof this.widgetInstance.destroy === 'function') {
          this.widgetInstance.destroy();
        }
      } catch (error) {
        console.warn('[Liveness Widget] Erro ao destruir widget:', error);
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
}

