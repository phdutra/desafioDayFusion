import { CommonModule } from '@angular/common';
import { Component, computed, HostListener, inject, signal, ViewChild, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { LivenessService } from '../../services/liveness.service';
import { S3Service } from '../../core/aws/s3.service';
import { LivenessHistoryService } from '../../core/services/liveness-history.service';
import { FaceMatchService } from '../../core/services/face-match.service';
import { FaceRecognitionService, DocumentValidateResponse } from '../../core/services/face-recognition.service';
import { CompressionService } from '../../core/services/compression.service';
import { CustomReviewStepComponent, LivenessResult } from '../../components/custom-review-step/custom-review-step.component';
import { LivenessSummary } from '../../core/models/liveness-result.model';
import { firstValueFrom, from } from 'rxjs';
import { timeout } from 'rxjs/operators';
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
  selector: 'app-capture-official',
  standalone: true,
  imports: [CommonModule, CustomReviewStepComponent],
  templateUrl: './capture-official.component.html',
  styleUrls: ['./capture-official.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class CaptureOfficialComponent {
  private readonly livenessService = inject(LivenessService);
  private readonly s3Service = inject(S3Service);
  private readonly historyService = inject(LivenessHistoryService);
  private readonly faceMatchService = inject(FaceMatchService);
  private readonly faceService = inject(FaceRecognitionService);
  private readonly router = inject(Router);
  private readonly compressionService = inject(CompressionService);

  @ViewChild(CustomReviewStepComponent) reviewStep?: CustomReviewStepComponent;

  // Estados
  readonly isModalOpen = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly isUploadingDocument = signal<boolean>(false); // Flag específica para upload de documento
  readonly errorMessage = signal<string | null>(null);
  readonly statusMessage = signal<string>('');
  readonly documentFile = signal<File | null>(null);
  readonly documentS3Path = signal<string | null>(null);
  readonly documentUrl = signal<string | null>(null);
  readonly documentKey = signal<string | null>(null); // Chave S3 do documento (sem s3://)
  readonly documentScore = signal<number | null>(null); // Score de validação do documento
  readonly documentAnalysis = signal<any | null>(null); // Análise completa do documento
  readonly isDocumentValid = signal<boolean | null>(null); // Flag: documento é RG/CNH válido
  readonly documentValidationMessage = signal<string | null>(null); // Mensagem de validação
  readonly compressionInfo = signal<{ original: string; compressed: string; reduction: string } | null>(null); // Info de compressão
  readonly showReviewStep = signal<boolean>(false);
  readonly livenessResult = signal<LivenessResult | null>(null);
  readonly lastSummary = signal<LivenessSummary | null>(null);
  readonly countdown = signal<number | null>(null);
  readonly showCountdown = signal<boolean>(false);
  readonly isVerifying = signal<boolean>(false); // Flag para fase de verificação
  readonly showPreparationScreen = signal<boolean>(false); // Tela de preparação com instruções
  readonly preparationCountdown = signal<number>(5); // Contador para início automático

  // AWS Widget
  private widgetInstance: any = null;
  private ovalObserverInterval: any = null;
  private verifyingObserverInterval: any = null;
  private sessionId: string = '';
  private videoRecorder: MediaRecorderController | null = null;
  private videoStream: MediaStream | null = null;
  private recordedVideo: RecordedMedia | null = null;
  readonly isRecordingVideo = signal<boolean>(false);
  readonly awsRegion: string = environment.aws?.region || 'us-east-1';
  readonly createSessionUrl: string = `${environment.apiUrl}/liveness/start`;
  readonly resultsUrl: string = `${environment.apiUrl}/liveness/results`;

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

  @HostListener('window:keydown.escape', ['$event'])
  handleEscapeKey(event: KeyboardEvent): void {
    if (this.isModalOpen()) {
      event.preventDefault();
      this.closeModal();
    }
  }

  async onDocumentSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;

    this.documentFile.set(file);
    input.value = '';

    // Upload do documento para S3
    try {
      this.isUploadingDocument.set(true);
      this.errorMessage.set(null);
      
      // Comprimir documento antes do upload (apenas imagens)
      let fileToUpload = file;
      const originalSizeKB = (file.size / 1024).toFixed(2);
      
      if (file.type.startsWith('image/')) {
        console.log(`[Capture Official] 📸 Comprimindo documento antes do upload...`);
        console.log(`[Capture Official] Tamanho original: ${originalSizeKB} KB`);
        console.log(`[Capture Official] Tipo: ${file.type}`);
        
        this.statusMessage.set(`Comprimindo documento... (${originalSizeKB} KB)`);
        
        try {
          const compressedFile = await this.compressionService.compressImage(file);
          fileToUpload = compressedFile;
          
          const compressedSizeKB = (compressedFile.size / 1024).toFixed(2);
          const reduction = ((1 - compressedFile.size / file.size) * 100).toFixed(1);
          
          // Armazenar info de compressão para exibir na interface
          this.compressionInfo.set({
            original: originalSizeKB,
            compressed: compressedSizeKB,
            reduction: reduction
          });
          
          console.log(`[Capture Official] ✅ Documento comprimido:`);
          console.log(`[Capture Official] - Tamanho original: ${originalSizeKB} KB`);
          console.log(`[Capture Official] - Tamanho comprimido: ${compressedSizeKB} KB`);
          console.log(`[Capture Official] - Redução: ${reduction}%`);
          
          this.statusMessage.set(`Enviando documento comprimido...`);
        } catch (compressionError) {
          console.warn('[Capture Official] ⚠️ Erro ao comprimir documento, usando original:', compressionError);
          this.compressionInfo.set(null);
          // Continua com arquivo original se compressão falhar
        }
      } else {
        console.log(`[Capture Official] ⚠️ Arquivo não é imagem, upload sem compressão`);
        console.log(`[Capture Official] Tamanho: ${originalSizeKB} KB, Tipo: ${file.type}`);
        this.compressionInfo.set(null);
      }
      
      const uploadResult = await firstValueFrom(
        this.s3Service.uploadDocument(fileToUpload)
      );
      
      if (uploadResult?.key) {
        // Formato: s3://bucket/key
        const bucket = environment.aws?.bucket || 'dayfusion-docs';
        const s3Path = `s3://${bucket}/${uploadResult.key}`;
        this.documentS3Path.set(s3Path);
        this.documentKey.set(uploadResult.key); // Salvar chave S3
        
        // Guardar URL assinada no signal
        if (uploadResult.url) {
          this.documentUrl.set(uploadResult.url);
        } else {
          // Gerar URL assinada em background (não bloquear)
          firstValueFrom(from(this.s3Service.getSignedUrl(uploadResult.key)))
            .then(url => this.documentUrl.set(url))
            .catch(() => console.warn('[Capture Official] Não foi possível gerar URL assinada'));
        }
        
        // Validar documento em background (não bloqueia o botão)
        this.validateDocument(uploadResult.key).catch(error => {
          console.error('[Capture Official] Erro na validação do documento:', error);
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
      
      // Extrair apenas a key (sem prefixo s3://)
      const keyOnly = documentKey.includes('/') ? documentKey.split('/').pop() : documentKey;
      
      if (!keyOnly) {
        console.warn('[Capture Official] Não foi possível extrair key do documento');
        this.isDocumentValid.set(false);
        this.documentValidationMessage.set('Erro ao processar documento');
        return;
      }

      console.log('[Capture Official] Validando documento como RG/CNH:', keyOnly);
      
      // Chamar endpoint de validação de documento (RG/CNH) - timeout mais curto para ser mais rápido
      const validationResult = await firstValueFrom(
        this.faceService.validateDocument(keyOnly, bucket).pipe(
          // Timeout de 30 segundos (mais rápido que o padrão)
          timeout(30000)
        )
      );

      if (validationResult) {
        this.documentScore.set(validationResult.documentScore);
        this.isDocumentValid.set(validationResult.isValid);
      
        console.log('[Capture Official] Resultado da validação:', {
          isValid: validationResult.isValid,
          score: validationResult.documentScore,
          observacao: validationResult.observacao,
          flags: validationResult.flags
        });

        // Só mostrar mensagem se documento for INVÁLIDO
        if (!validationResult.isValid) {
          this.documentValidationMessage.set(validationResult.observacao || 'Documento inválido');
          this.errorMessage.set('Documento não é um RG ou CNH válido. Por favor, envie um documento válido.');
        } else {
          // Documento válido: limpar mensagens
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
      
      if (error?.name === 'TimeoutError') {
        this.errorMessage.set('Timeout ao validar documento. Verifique sua conexão e tente novamente.');
      } else {
        this.errorMessage.set(error?.message || 'Erro ao validar documento. Verifique sua conexão e tente novamente.');
      }
    }
  }

  openModal(): void {
    if (!this.documentFile() || !this.documentS3Path()) {
      this.errorMessage.set('Por favor, anexe um documento antes de iniciar a verificação.');
      return;
    }

    // Validar se documento é válido (RG/CNH) antes de permitir iniciar
    if (this.isDocumentValid() === false) {
      this.errorMessage.set('Documento inválido. Por favor, envie um RG ou CNH válido antes de iniciar a verificação.');
      return;
    }

    // Se ainda não foi validado, bloquear
    if (this.isDocumentValid() === null) {
      this.errorMessage.set('Aguarde a validação do documento antes de iniciar a verificação.');
      return;
    }

    this.errorMessage.set(null);
    this.isModalOpen.set(true);
    this.showReviewStep.set(false);
    this.showPreparationScreen.set(true); // Mostrar tela de preparação primeiro
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
    
    // Limpar intervalo se modal for fechado
    (this as any)._preparationCountdownInterval = countdownInterval;
  }

  startVerificationAfterPreparation(): void {
    console.log('[Capture Official] Iniciando verificação após preparação...');
    // Fechar tela de preparação e iniciar sessão
    this.showPreparationScreen.set(false);
    this.errorMessage.set(null);
    this.statusMessage.set('Preparando verificação...');
    setTimeout(() => {
      console.log('[Capture Official] Chamando startSession...');
      this.startSession();
    }, 150);
  }

  closeModal(): void {
    // Limpar intervalo de contagem regressiva da preparação
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

  async startSession(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.errorMessage.set(null);
      this.statusMessage.set('Criando sessão AWS...');

      // Criar sessão no backend
      const sessionResponse = await firstValueFrom(this.livenessService.createSession());
      if (!sessionResponse?.sessionId) {
        throw new Error('Falha ao criar sessão: sessionId não retornado');
      }

      this.sessionId = sessionResponse.sessionId;
      this.statusMessage.set('Sessão criada. Carregando widget...');

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
        
        // Verificar se widget local está disponível
        const customWidgetAvailable = customElements.get('face-liveness-widget') !== undefined;
        
        if (!customWidgetAvailable) {
          // Aguardar um pouco mais para widget local carregar
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
      console.error('[Capture Official] Erro ao iniciar sessão:', error);
      this.errorMessage.set(error?.message || 'Erro ao iniciar verificação.');
      this.statusMessage.set('Erro ao inicializar');
      this.isLoading.set(false);
    }
  }

  private async initWidget(sessionId: string): Promise<void> {
    const container = document.getElementById('liveness-container-official');
    if (!container) {
      throw new Error('Container do widget não encontrado.');
    }

    // Limpar container
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
      // Fallback para V2
      this.widgetInstance = FaceLiveness.create({
        sessionId,
        region: this.awsRegion,
        onComplete: (result: any) => this.handleWidgetComplete(result),
        onError: (error: any) => this.handleWidgetError(error)
      });
    } else {
      throw new Error('Widget AWS não disponível');
    }

      // Aguardar widget renderizar e aplicar estilos forçados
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.applyWidgetStyles();
      this.startOvalObserver();
      
      // Iniciar observador para detectar "Verifying..." e mostrar loading
      this.startVerifyingObserver();
      
      // Iniciar gravação de vídeo quando widget começar
      this.startVideoRecordingFromWidget();
  }

  private startOvalObserver(): void {
    // Limpar intervalo anterior se existir
    if (this.ovalObserverInterval) {
      clearInterval(this.ovalObserverInterval);
    }

    // Garantir que a elipse está visível, funcionando corretamente e removida do escopo do flex
    this.ovalObserverInterval = setInterval(() => {
      this.removeOvalFromFlexScope();
      this.ensureOvalVisible();
    }, 100); // Verificar a cada 100ms para garantir visibilidade e posicionamento
  }

  private startVerifyingObserver(): void {
    // Limpar intervalo anterior se existir
    if (this.verifyingObserverInterval) {
      clearInterval(this.verifyingObserverInterval);
    }

    // Monitorar DOM do widget para detectar "Verifying..." ou "Check complete"
    this.verifyingObserverInterval = setInterval(() => {
      this.checkForVerifyingMessage();
    }, 200); // Verificar a cada 200ms
  }

  private checkForVerifyingMessage(): void {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Buscar por texto "Verifying", "Verificando", "Check complete" em qualquer elemento
    const allText = container.innerText || container.textContent || '';
    const textLower = allText.toLowerCase();
    
    const verifyingKeywords = ['verifying', 'verificando', 'check complete'];
    const hasVerifying = verifyingKeywords.some(keyword => textLower.includes(keyword));
    
    if (hasVerifying && !this.isVerifying()) {
      console.log('[Capture Official] Detectado "Verifying..." - ativando loading');
      this.isVerifying.set(true);
    } else if (!hasVerifying && this.isVerifying() && !this.showReviewStep()) {
      // Desativar apenas se não estiver na etapa de review
      // O loading será desativado quando entrar na etapa de review ou quando houver erro
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

  /**
   * Remove o elemento da elipse do escopo do flex e posiciona de forma independente
   */
  private removeOvalFromFlexScope(): void {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Encontrar o elemento específico: div.amplify-liveness-oval-canvas
    const ovalCanvasDiv = container.querySelector('.amplify-liveness-oval-canvas') as HTMLElement;
    if (!ovalCanvasDiv) return;

    // Remover do escopo do flex - posicionar de forma absoluta
    ovalCanvasDiv.style.position = 'absolute';
    ovalCanvasDiv.style.top = '50%';
    ovalCanvasDiv.style.left = '50%';
    ovalCanvasDiv.style.transform = 'translate(-50%, -50%)';
    ovalCanvasDiv.style.zIndex = '1000';
    ovalCanvasDiv.style.margin = '0';
    ovalCanvasDiv.style.padding = '0';
    ovalCanvasDiv.style.display = 'block';
    ovalCanvasDiv.style.visibility = 'visible';
    ovalCanvasDiv.style.opacity = '1';
    ovalCanvasDiv.style.pointerEvents = 'auto';
    
    // Remover classes do Amplify que podem interferir no posicionamento
    // Não remover completamente, mas sobrescrever comportamentos
    ovalCanvasDiv.style.flex = 'none';
    ovalCanvasDiv.style.alignSelf = 'auto';
    ovalCanvasDiv.style.justifySelf = 'auto';

    // Se estiver dentro de um container flex, remover da hierarquia do flex
    const parent = ovalCanvasDiv.parentElement;
    if (parent && parent.classList.contains('amplify-liveness-video-anchor')) {
      // Garantir que o parent não force posicionamento relativo na elipse
      parent.style.position = 'relative';
    }

    // Ajustar o canvas dentro do div
    const canvas = ovalCanvasDiv.querySelector('canvas');
    if (canvas) {
      const canvasEl = canvas as HTMLElement;
      canvasEl.style.position = 'absolute';
      canvasEl.style.top = '50%';
      canvasEl.style.left = '50%';
      canvasEl.style.transform = 'translate(-50%, -50%)';
      canvasEl.style.margin = '0';
      canvasEl.style.padding = '0';
      canvasEl.style.display = 'block';
      canvasEl.style.visibility = 'visible';
      canvasEl.style.opacity = '1';
    }

    console.log('[Capture Official] Elipse removida do escopo do flex e posicionada independentemente');
  }

  private ensureOvalVisible(): void {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Garantir que todos os elementos relacionados à elipse estão visíveis e CENTRALIZADOS VERTICALMENTE
    const selectors = [
      '[class*="amplify-liveness-oval"]',
      '[class*="amplify-liveness-oval-canvas"]',
      '[class*="liveness-oval"]',
      '[class*="liveness-oval-canvas"]',
      'canvas[class*="oval"]',
      'canvas[aria-label*="oval"]',
      'canvas[aria-label*="Oval"]',
      'canvas[aria-label*="ellipse"]',
      'canvas[aria-label*="Ellipse"]',
      '[class*="ellipse"]',
      '[class*="Ellipse"]',
      '[class*="oval"]:not([class*="video"]):not([class*="Video"])',
      '[class*="Oval"]:not([class*="video"]):not([class*="Video"])'
    ];

    selectors.forEach(selector => {
      const elements = container.querySelectorAll(selector);
      elements.forEach(el => {
        const htmlEl = el as HTMLElement;
        // Garantir que a elipse está visível E CENTRALIZADA VERTICALMENTE
        htmlEl.style.display = 'block';
        htmlEl.style.visibility = 'visible';
        htmlEl.style.opacity = '1';
        htmlEl.style.pointerEvents = 'auto';
        htmlEl.style.position = 'absolute';
        htmlEl.style.top = '50%';
        htmlEl.style.left = '50%';
        htmlEl.style.transform = 'translate(-50%, -50%)';
        htmlEl.style.zIndex = '1000';
        htmlEl.style.margin = '0';
        htmlEl.style.padding = '0';
        // Não remover width e height para manter tamanho correto
      });
    });

    // Também garantir que SVGs da elipse estão centralizados
    const svgs = container.querySelectorAll('svg');
    svgs.forEach(svg => {
      const htmlEl = svg as unknown as HTMLElement;
      // Verificar se é uma elipse/oval pelo contexto ou atributos
      const parentClass = svg.parentElement?.className || '';
      const svgClass = svg.className?.baseVal || '';
      if (parentClass.includes('oval') || parentClass.includes('ellipse') || 
          svgClass.includes('oval') || svgClass.includes('ellipse') ||
          svg.getAttribute('aria-label')?.toLowerCase().includes('oval') ||
          svg.getAttribute('aria-label')?.toLowerCase().includes('ellipse')) {
        htmlEl.style.position = 'absolute';
        htmlEl.style.top = '50%';
        htmlEl.style.left = '50%';
        htmlEl.style.transform = 'translate(-50%, -50%)';
        htmlEl.style.zIndex = '1000';
        htmlEl.style.display = 'block';
        htmlEl.style.visibility = 'visible';
        htmlEl.style.opacity = '1';
        htmlEl.style.margin = '0';
        htmlEl.style.padding = '0';
      }
    });
  }

  private stopOvalObserver(): void {
    if (this.ovalObserverInterval) {
      clearInterval(this.ovalObserverInterval);
      this.ovalObserverInterval = null;
    }
  }

  private applyWidgetStyles(): void {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Aplicar estilos conforme configuração recomendada (DayFusion-AWS-Liveness-Config-Completa.md)
    const style = document.createElement('style');
    style.id = 'capture-official-widget-override';
    style.textContent = `
      /* Wrapper AWS - garantir layout correto */
      .aws-widget-wrapper {
        width: 100% !important;
        max-width: 420px !important;
        height: 580px !important;
        margin: 0 auto !important;
        position: relative !important;
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        overflow: hidden !important;
        background: #14163e !important;
        border-radius: 20px !important;
      }

      #liveness-container-official {
        width: 100% !important;
        height: 100% !important;
        margin-top: 0 !important;
        transform: none !important;
        padding: 0 !important;
        background: transparent !important;
      }
      
      /* Vídeo centralizado e alinhado */
      #liveness-container-official video {
        width: 100% !important;
        height: auto !important;
        max-width: 100% !important;
        object-fit: contain !important;
        object-position: center center !important;
        margin-top: 0 !important;
        transform: scaleX(-1) !important; /* Espelhar horizontalmente */
        position: relative !important;
      }
      
      /* Canvas centralizado */
      #liveness-container-official canvas {
        margin-top: 0 !important;
        transform: none !important;
        object-position: center center !important;
      }
      
      /* Container do vídeo - garantir posicionamento relativo, mas não afetar elipse */
      #liveness-container-official [class*="amplify-liveness-video-anchor"],
      #liveness-container-official [class*="liveness-video-anchor"] {
        position: relative !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      /* Garantir que elipse dentro do video-anchor não é afetada pelo flex */
      #liveness-container-official [class*="amplify-liveness-video-anchor"] .amplify-liveness-oval-canvas,
      #liveness-container-official [class*="liveness-video-anchor"] .amplify-liveness-oval-canvas {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        flex: none !important;
        align-self: auto !important;
        order: 9999 !important;
      }

      /* REMOVER ELIPSE DO ESCOPO DO FLEX - posicionamento independente */
      #liveness-container-official .amplify-liveness-oval-canvas,
      #liveness-container-official [class*="amplify-liveness-oval-canvas"] {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        z-index: 1000 !important;
        margin: 0 !important;
        padding: 0 !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        flex: none !important;
        align-self: auto !important;
        justify-self: auto !important;
      }

      /* Garantir que a elipse está visível e centralizada VERTICALMENTE */
      #liveness-container-official [class*="amplify-liveness-oval"],
      #liveness-container-official [class*="liveness-oval"],
      #liveness-container-official [class*="liveness-oval-canvas"],
      #liveness-container-official [class*="amplify-liveness-oval-canvas"] > * {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        z-index: 1000 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      
      /* Garantir que canvas da elipse está visível e centralizado VERTICALMENTE */
      #liveness-container-official [class*="amplify-liveness-oval-canvas"] canvas,
      #liveness-container-official [class*="liveness-oval-canvas"] canvas,
      #liveness-container-official canvas[class*="oval"],
      #liveness-container-official canvas[aria-label*="oval"],
      #liveness-container-official canvas[aria-label*="Oval"],
      #liveness-container-official canvas[aria-label*="ellipse"],
      #liveness-container-official canvas[aria-label*="Ellipse"] {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* SVG da elipse - centralizar verticalmente */
      #liveness-container-official svg[class*="oval"],
      #liveness-container-official svg[class*="Oval"],
      #liveness-container-official svg[class*="ellipse"],
      #liveness-container-official svg[class*="Ellipse"],
      #liveness-container-official [class*="amplify-liveness-oval"] svg,
      #liveness-container-official [class*="liveness-oval"] svg {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        z-index: 1000 !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      /* Garantir que elementos de guia (elipse) estão visíveis e centralizados VERTICALMENTE */
      #liveness-container-official [class*="ellipse"],
      #liveness-container-official [class*="Ellipse"],
      #liveness-container-official [class*="oval"]:not([class*="amplify"]):not([class*="liveness"]),
      #liveness-container-official [class*="Oval"],
      #liveness-container-official [class*="guide"],
      #liveness-container-official [class*="Guide"],
      #liveness-container-official div[class*="oval-canvas"],
      #liveness-container-official div[class*="Oval-canvas"] {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        z-index: 1000 !important;
        pointer-events: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      /* Forçar centralização vertical de qualquer elemento relacionado à elipse */
      #liveness-container-official *[class*="oval"]:not([class*="video"]),
      #liveness-container-official *[class*="Oval"]:not([class*="video"]),
      #liveness-container-official *[class*="ellipse"]:not([class*="video"]),
      #liveness-container-official *[class*="Ellipse"]:not([class*="video"]) {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        z-index: 1000 !important;
      }
      
      /* Centralizar e destacar textos de orientação facial */
      #liveness-container-official p,
      #liveness-container-official span,
      #liveness-container-official div:not(video):not(canvas):not(svg):not([class*="ellipse"]):not([class*="oval"]):not([class*="guide"]) {
        text-align: center !important;
        position: absolute !important;
        top: 5% !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: rgba(0, 0, 0, 0.9) !important;
        padding: 1.4rem 2.5rem !important;
        border-radius: 18px !important;
        backdrop-filter: blur(16px) !important;
        z-index: 10000 !important;
        font-size: 1.5rem !important;
        font-weight: 900 !important;
        color: #ffffff !important;
        border: 3px solid rgba(99, 102, 241, 0.8) !important;
        box-shadow: 
          0 10px 30px rgba(0, 0, 0, 0.8),
          0 0 40px rgba(99, 102, 241, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
        max-width: 90% !important;
        text-shadow: 
          0 2px 8px rgba(0, 0, 0, 0.9),
          0 0 20px rgba(99, 102, 241, 0.6) !important;
        letter-spacing: 0.8px !important;
        line-height: 1.4 !important;
        animation: fadeInText 0.3s ease-in-out !important;
      }
      
      /* Mensagens específicas de orientação facial - mais destacadas */
      #liveness-container-official [class*="instruction"],
      #liveness-container-official [class*="Instruction"],
      #liveness-container-official [class*="message"],
      #liveness-container-official [class*="Message"],
      #liveness-container-official [class*="prompt"],
      #liveness-container-official [class*="Prompt"],
      #liveness-container-official [class*="guidance"],
      #liveness-container-official [class*="Guidance"] {
        position: absolute !important;
        top: 8% !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(34, 211, 238, 0.9)) !important;
        padding: 1.5rem 2.5rem !important;
        border-radius: 20px !important;
        backdrop-filter: blur(20px) !important;
        z-index: 10001 !important;
        max-width: 90% !important;
        text-align: center !important;
        font-size: 1.6rem !important;
        font-weight: 900 !important;
        color: #ffffff !important;
        border: 3px solid rgba(255, 255, 255, 0.3) !important;
        box-shadow: 
          0 12px 40px rgba(0, 0, 0, 0.9),
          0 0 50px rgba(99, 102, 241, 0.7),
          inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
        text-shadow: 
          0 3px 10px rgba(0, 0, 0, 1),
          0 0 25px rgba(255, 255, 255, 0.3) !important;
        letter-spacing: 1px !important;
        line-height: 1.5 !important;
        animation: pulseText 2s ease-in-out infinite !important;
      }
      
      @keyframes fadeInText {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
      
      @keyframes pulseText {
        0%, 100% {
          transform: translateX(-50%) scale(1);
          box-shadow: 
            0 12px 40px rgba(0, 0, 0, 0.9),
            0 0 50px rgba(99, 102, 241, 0.7);
        }
        50% {
          transform: translateX(-50%) scale(1.02);
          box-shadow: 
            0 15px 50px rgba(0, 0, 0, 1),
            0 0 60px rgba(99, 102, 241, 0.9);
        }
      }

      /* Ajustes para mobile */
      @media (max-width: 480px) {
        .aws-widget-wrapper {
          max-width: 100% !important;
          height: calc(100vh - 40px) !important;
        }
      }
    `;
    
    // Remover estilo anterior se existir
    const existingStyle = document.getElementById('capture-official-widget-override');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    document.head.appendChild(style);

    // Aplicar estilos inline nos elementos encontrados
    setTimeout(() => {
      const videos = container.querySelectorAll('video');
      videos.forEach(video => {
        (video as HTMLElement).style.marginTop = '-2rem';
        (video as HTMLElement).style.transform = 'translateY(-20px) scaleX(-1)';
        (video as HTMLElement).style.objectPosition = 'center center';
      });

      // Ajustar canvas - mas NÃO aplicar margens negativas se for elipse
      const canvases = container.querySelectorAll('canvas');
      canvases.forEach(canvas => {
        const htmlEl = canvas as HTMLElement;
        const isOval = htmlEl.className?.includes('oval') || 
                      htmlEl.className?.includes('Oval') ||
                      htmlEl.className?.includes('ellipse') ||
                      htmlEl.className?.includes('Ellipse') ||
                      htmlEl.getAttribute('aria-label')?.toLowerCase().includes('oval') ||
                      htmlEl.getAttribute('aria-label')?.toLowerCase().includes('ellipse');
        
        if (isOval) {
          // Elipse: centralizar verticalmente SEM margens negativas
          htmlEl.style.position = 'absolute';
          htmlEl.style.top = '50%';
          htmlEl.style.left = '50%';
          htmlEl.style.transform = 'translate(-50%, -50%)';
          htmlEl.style.zIndex = '1000';
          htmlEl.style.margin = '0';
          htmlEl.style.padding = '0';
        } else {
          // Outros canvas: manter comportamento anterior
          htmlEl.style.marginTop = '-2rem';
          htmlEl.style.transform = 'translateY(-20px)';
          htmlEl.style.objectPosition = 'center center';
        }
      });

      // Ajustar container do vídeo para posicionamento relativo
      const videoAnchors = container.querySelectorAll('[class*="amplify-liveness-video-anchor"], [class*="liveness-video-anchor"]');
      videoAnchors.forEach(el => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.position = 'relative';
        htmlEl.style.display = 'flex';
        htmlEl.style.alignItems = 'center';
        htmlEl.style.justifyContent = 'center';
      });

      // Remover elipse do escopo do flex e posicionar de forma independente
      this.removeOvalFromFlexScope();
      
      // Garantir que a elipse está visível (chamada inicial)
      this.ensureOvalVisible();
      
      // Também garantir após um delay para garantir
      setTimeout(() => {
        this.removeOvalFromFlexScope();
        this.ensureOvalVisible();
      }, 1000);

      // Centralizar SVG (guia) com a câmera e garantir visibilidade
      const svgs = container.querySelectorAll('svg');
      svgs.forEach(svg => {
        const htmlEl = svg as unknown as HTMLElement;
        htmlEl.style.position = 'absolute';
        htmlEl.style.top = '50%';
        htmlEl.style.left = '50%';
        htmlEl.style.transform = 'translate(-50%, -50%)';
        htmlEl.style.zIndex = '1000';
        htmlEl.style.pointerEvents = 'auto';
        htmlEl.style.margin = '0';
        htmlEl.style.display = 'block';
        htmlEl.style.visibility = 'visible';
        htmlEl.style.opacity = '1';
      });

      // Centralizar elementos com classes relacionadas a elipse/oval e garantir visibilidade
      const ellipseElements = container.querySelectorAll('[class*="ellipse"], [class*="Ellipse"], [class*="oval"], [class*="Oval"], [class*="guide"], [class*="Guide"]');
      ellipseElements.forEach(el => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.position = 'absolute';
        htmlEl.style.top = '50%';
        htmlEl.style.left = '50%';
        htmlEl.style.transform = 'translate(-50%, -50%)';
        htmlEl.style.zIndex = '1000';
        htmlEl.style.pointerEvents = 'auto';
        htmlEl.style.margin = '0';
        htmlEl.style.display = 'block';
        htmlEl.style.visibility = 'visible';
        htmlEl.style.opacity = '1';
      });

      // Centralizar e destacar textos de orientação facial
      const textElements = container.querySelectorAll('p, span, div');
      textElements.forEach(el => {
        if (el.tagName !== 'VIDEO' && el.tagName !== 'CANVAS' && el.tagName !== 'SVG' && 
            !el.classList.toString().includes('ellipse') && 
            !el.classList.toString().includes('oval') &&
            !el.classList.toString().includes('guide')) {
          const htmlEl = el as HTMLElement;
          const textContent = htmlEl.textContent?.trim() || '';
          
          if (textContent.length > 0) {
            // Verificar se é mensagem de orientação facial
            const isFaceGuidance = this.isFaceGuidanceMessage(textContent);
            
            if (isFaceGuidance) {
              // Estilo especial para mensagens de orientação facial
              htmlEl.style.textAlign = 'center';
              htmlEl.style.position = 'absolute';
              htmlEl.style.top = '8%';
              htmlEl.style.left = '50%';
              htmlEl.style.transform = 'translateX(-50%)';
              htmlEl.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(34, 211, 238, 0.9))';
              htmlEl.style.padding = '1.5rem 2.5rem';
              htmlEl.style.borderRadius = '20px';
              htmlEl.style.zIndex = '10001';
              htmlEl.style.fontSize = '1.6rem';
              htmlEl.style.fontWeight = '900';
              htmlEl.style.color = '#ffffff';
              htmlEl.style.maxWidth = '90%';
              htmlEl.style.border = '3px solid rgba(255, 255, 255, 0.3)';
              htmlEl.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.9), 0 0 50px rgba(99, 102, 241, 0.7)';
              htmlEl.style.textShadow = '0 3px 10px rgba(0, 0, 0, 1), 0 0 25px rgba(255, 255, 255, 0.3)';
              htmlEl.style.letterSpacing = '1px';
              htmlEl.style.lineHeight = '1.5';
              htmlEl.style.backdropFilter = 'blur(20px)';
            } else {
              // Estilo padrão para outros textos
              htmlEl.style.textAlign = 'center';
              htmlEl.style.position = 'absolute';
              htmlEl.style.top = '5%';
              htmlEl.style.left = '50%';
              htmlEl.style.transform = 'translateX(-50%)';
              htmlEl.style.background = 'rgba(0, 0, 0, 0.9)';
              htmlEl.style.padding = '1.4rem 2.5rem';
              htmlEl.style.borderRadius = '18px';
              htmlEl.style.zIndex = '10000';
              htmlEl.style.fontSize = '1.5rem';
              htmlEl.style.fontWeight = '900';
              htmlEl.style.color = '#ffffff';
              htmlEl.style.maxWidth = '90%';
              htmlEl.style.border = '3px solid rgba(99, 102, 241, 0.8)';
              htmlEl.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.5)';
              htmlEl.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.9), 0 0 20px rgba(99, 102, 241, 0.6)';
              htmlEl.style.letterSpacing = '0.8px';
              htmlEl.style.lineHeight = '1.4';
              htmlEl.style.backdropFilter = 'blur(16px)';
            }
          }
        }
      });
      
      // Iniciar observer para mensagens de orientação facial
      this.startFaceGuidanceObserver();
    }, 500);
  }

  /**
   * Verifica se o texto é uma mensagem de orientação facial
   */
  private isFaceGuidanceMessage(text: string): boolean {
    const guidanceKeywords = [
      'aproxim', 'muito longe', 'muito perto', 'too far', 'too close', 'move closer',
      'move away', 'afaste', 'perto', 'longe', 'centralize', 'center', 'centro',
      'esquerda', 'direita', 'left', 'right', 'cima', 'baixo', 'up', 'down',
      'olhe', 'look', 'face', 'rosto', 'posição', 'position', 'ajuste', 'adjust',
      'mantenha', 'keep', 'segure', 'hold', 'aguarde', 'wait', 'pronto', 'ready',
      'closer', 'further', 'back', 'forward', 'turn', 'gire', 'vire', 'rotate',
      'straight', 'reto', 'alinh', 'align', 'level', 'nível', 'tilt', 'inclin'
    ];
    
    const textLower = text.toLowerCase().trim();
    
    // Se o texto tem mais de 3 caracteres e menos de 100, pode ser uma mensagem de orientação
    if (textLower.length < 3 || textLower.length > 100) {
      return false;
    }
    
    // Verificar se contém palavras-chave
    if (guidanceKeywords.some(keyword => textLower.includes(keyword))) {
      return true;
    }
    
    // Se não contém palavras comuns de interface (botões, etc), pode ser orientação
    const uiKeywords = ['button', 'click', 'start', 'begin', 'iniciar', 'começar', 'ok', 'cancel', 'close'];
    if (!uiKeywords.some(keyword => textLower.includes(keyword))) {
      // Se é um texto curto e não é um comando de UI, pode ser orientação
      return textLower.length < 50;
    }
    
    return false;
  }

  /**
   * Aplica estilos destacados em mensagens de orientação facial
   */
  private applyFaceGuidanceStyles(element: HTMLElement): void {
    element.style.textAlign = 'center';
    element.style.position = 'absolute';
    element.style.top = '8%';
    element.style.left = '50%';
    element.style.transform = 'translateX(-50%)';
    element.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(34, 211, 238, 0.9))';
    element.style.padding = '1.5rem 2.5rem';
    element.style.borderRadius = '20px';
    element.style.zIndex = '10001';
    element.style.fontSize = '1.6rem';
    element.style.fontWeight = '900';
    element.style.color = '#ffffff';
    element.style.maxWidth = '90%';
    element.style.border = '3px solid rgba(255, 255, 255, 0.3)';
    element.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.9), 0 0 50px rgba(99, 102, 241, 0.7)';
    element.style.textShadow = '0 3px 10px rgba(0, 0, 0, 1), 0 0 25px rgba(255, 255, 255, 0.3)';
    element.style.letterSpacing = '1px';
    element.style.lineHeight = '1.5';
    element.style.backdropFilter = 'blur(20px)';
    element.style.display = 'block';
    element.style.visibility = 'visible';
    element.style.opacity = '1';
    element.style.pointerEvents = 'none';
  }

  /**
   * Verifica e destaca mensagens de orientação facial no container
   */
  private checkAndHighlightFaceGuidance(): void {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Buscar todos os elementos de texto
    const allElements = container.querySelectorAll('*');
    
    allElements.forEach(el => {
      // Ignorar elementos específicos
      if (el.tagName === 'VIDEO' || el.tagName === 'CANVAS' || el.tagName === 'SVG') {
        return;
      }
      
      const htmlEl = el as HTMLElement;
      const classList = htmlEl.classList.toString();
      
      // Ignorar elementos relacionados à elipse
      if (classList.includes('ellipse') || 
          classList.includes('oval') || 
          classList.includes('guide') ||
          classList.includes('amplify-liveness-oval')) {
        return;
      }
      
      // Verificar se tem texto visível
      const textContent = htmlEl.textContent?.trim() || '';
      const innerText = htmlEl.innerText?.trim() || '';
      const finalText = textContent || innerText;
      
      if (finalText.length > 0 && this.isFaceGuidanceMessage(finalText)) {
        // Verificar se já foi estilizado (evitar reaplicar)
        if (!htmlEl.hasAttribute('data-face-guidance-styled')) {
          console.log('[Capture Official] 📢 Mensagem de orientação detectada:', finalText);
          this.applyFaceGuidanceStyles(htmlEl);
          htmlEl.setAttribute('data-face-guidance-styled', 'true');
        }
      }
    });
  }

  /**
   * Observer para destacar mensagens de orientação facial em tempo real
   */
  private startFaceGuidanceObserver(): void {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Verificar imediatamente
    this.checkAndHighlightFaceGuidance();

    // Observer para mudanças no DOM
    const observer = new MutationObserver(() => {
      this.checkAndHighlightFaceGuidance();
    });

    // Observar mudanças no container
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false
    });

    // Guardar observer para limpeza
    (this as any)._faceGuidanceObserver = observer;

    // Também verificar periodicamente (backup caso o observer não capture)
    const intervalId = setInterval(() => {
      this.checkAndHighlightFaceGuidance();
    }, 500);

    // Guardar intervalo para limpeza
    (this as any)._faceGuidanceInterval = intervalId;
  }

  private stopFaceGuidanceObserver(): void {
    if ((this as any)._faceGuidanceObserver) {
      (this as any)._faceGuidanceObserver.disconnect();
      (this as any)._faceGuidanceObserver = null;
    }
    if ((this as any)._faceGuidanceInterval) {
      clearInterval((this as any)._faceGuidanceInterval);
      (this as any)._faceGuidanceInterval = null;
    }
  }

  private async initLocalWidget(sessionId: string): Promise<void> {
    const container = document.getElementById('liveness-container-official');
    if (!container) {
      throw new Error('Container do widget não encontrado.');
    }

    // Limpar container
    container.innerHTML = '';

    // Criar elemento do widget local com atributos obrigatórios conforme guia
    // DayFusion-AWS-Lighting-and-Stability-Guide.md
    const widgetElement = document.createElement('face-liveness-widget');
    widgetElement.setAttribute('session-id', sessionId);
    widgetElement.setAttribute('region', this.awsRegion);
    widgetElement.setAttribute('create-session-url', this.createSessionUrl);
    widgetElement.setAttribute('results-url', this.resultsUrl);
    
    // Atributos obrigatórios conforme guia para evitar fallback e desalinhamento
    widgetElement.setAttribute('preset', 'face-liveness');
    widgetElement.setAttribute('challenge-versions', '1.5.0');
    widgetElement.setAttribute('video-normalization', 'on');
    widgetElement.setAttribute('dark-environment-boost', 'on');
    widgetElement.setAttribute('max-video-duration', '8000');
    
    if (environment.aws?.identityPoolId) {
      widgetElement.setAttribute('identity-pool-id', environment.aws.identityPoolId);
    }

    container.appendChild(widgetElement);

    // Configurar listeners para eventos do widget local
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

    // Guardar listeners para limpeza
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
    // Tentar encontrar e clicar no botão de iniciar do widget
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Aguardar widget renderizar
    await new Promise(resolve => setTimeout(resolve, 500));

    // Tentar encontrar botão de iniciar (vários seletores possíveis)
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

    // Se não encontrou por texto, tentar o primeiro botão visível
    if (!button) {
      const buttons = container.querySelectorAll('button');
      for (const btn of Array.from(buttons)) {
        if (btn.offsetParent !== null) { // Botão visível
          button = btn;
          break;
        }
      }
    }

    if (button) {
      console.log('[Capture Official] Clicando no botão de iniciar automaticamente');
      button.click();
    } else {
      console.warn('[Capture Official] Botão de iniciar não encontrado, usuário precisará clicar manualmente');
    }
  }

  private setupWidgetListeners(): void {
    // Listeners já configurados no initWidget ou initLocalWidget
  }

  private async handleWidgetComplete(result: any): Promise<void> {
    console.log('[Capture Official] Widget completo:', result);
    this.isVerifying.set(false); // Desativar loading quando widget completa
    this.statusMessage.set('Verificação concluída. Processando resultados...');

    // Parar gravação de vídeo
    await this.stopVideoRecording();

    try {
      // Obter resultados completos do backend
      const results = await firstValueFrom(
        this.livenessService.getResult(this.sessionId)
      );

      if (!results) {
        throw new Error('Resultados não disponíveis');
      }

      // Extrair audit images do resultado
      const auditImages: { bucket: string; key: string; url?: string }[] = [];
      if (results.auditImageUrls && Array.isArray(results.auditImageUrls)) {
        const bucket = environment.aws?.bucket || 'dayfusion-docs';
        results.auditImageUrls.forEach((url: string, index: number) => {
          // Extrair key da URL ou usar padrão
          const key = `liveness/${this.sessionId}/audit_${index}.jpg`;
          auditImages.push({
            bucket,
            key,
            url
          });
        });
      }

                  // Criar LivenessResult
                  const livenessResult: LivenessResult = {
                    sessionId: this.sessionId,
                    confidenceScore: (results.confidence || 0) * 100,
                    fraudScore: results.livenessDecision === 'SPOOF' ? 100 : 0,
                    auditImages,
                    raw: results
                  };

                  this.livenessResult.set(livenessResult);

                  // Upload do vídeo gravado ANTES de fazer análise completa (para ter videoKey disponível)
                  if (this.recordedVideo && this.recordedVideo.blob.size > 0) {
                    try {
                      this.statusMessage.set('📤 Enviando vídeo ao S3...');
                      const uploadResult = await firstValueFrom(
                        from(this.s3Service.uploadLivenessVideo(this.sessionId, this.recordedVideo.blob, this.recordedVideo.mimeType))
                      );
                      console.log('[Capture Official] ✅ Vídeo enviado ao S3 com sucesso!', {
                        key: uploadResult.key,
                        size: `${(this.recordedVideo.blob.size / 1024 / 1024).toFixed(2)} MB`
                      });
                      // Salvar chave do vídeo para usar depois
                      (this as any)._videoKey = uploadResult.key;
                    } catch (videoError) {
                      console.error('[Capture Official] ❌ Erro ao enviar vídeo:', videoError);
                    }
                  } else {
                    console.warn('[Capture Official] ⚠️ Nenhum vídeo gravado para enviar');
                  }

                  // Se temos documento, fazer análise completa (validação + match)
                  if (this.documentKey() && auditImages.length > 0) {
                    this.statusMessage.set('Analisando documento e comparando faces...');
                    await this.performCompleteAnalysis(livenessResult);
                  } else {
                    // Ir direto para review step mesmo sem match
                    this.showReviewStep.set(true);
                  }
    } catch (error: any) {
      console.error('[Capture Official] Erro ao processar resultados:', error);
      this.errorMessage.set('Erro ao processar resultados da verificação.');
    }
  }

  private async performCompleteAnalysis(livenessResult: LivenessResult): Promise<void> {
    if (!this.documentKey() || !livenessResult.auditImages?.length) {
      this.showReviewStep.set(true);
      return;
    }

    try {
      // 1. Obter selfie de referência (primeira audit image)
      const firstAuditImage = livenessResult.auditImages[0];
      if (!firstAuditImage?.key) {
        console.warn('[Capture Official] Não foi possível obter selfie de referência');
        this.showReviewStep.set(true);
        return;
      }

      // 2. Chamar backend para análise completa (igual captura 3D)
      // Isso vai fazer: validação de documento + match de faces
      this.statusMessage.set('Analisando documento e comparando faces...');
      
      const backendAnalysis = await firstValueFrom(
        this.faceService.getLivenessResult({
          sessionId: this.sessionId,
          documentKey: this.documentKey()!,
          selfieKey: firstAuditImage.key,
          localLivenessScore: livenessResult.confidenceScore,
          videoKey: (this as any)._videoKey  // Enviar chave do vídeo gravado
        })
      );

      // Salvar análise do documento
      if (backendAnalysis) {
        this.documentScore.set(backendAnalysis.documentScore || null);
        this.documentAnalysis.set(backendAnalysis);
        
        console.log('[Capture Official] Análise completa do backend:', {
          documentScore: backendAnalysis.documentScore,
          matchScore: backendAnalysis.matchScore,
          identityScore: backendAnalysis.identityScore,
          observacao: backendAnalysis.observacao,
          status: backendAnalysis.status
        });

        // CRÍTICO: Se documento foi rejeitado após liveness, bloquear aprovação
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
          console.warn('[Capture Official] 🚨 Documento rejeitado após liveness. Status:', status, 'Score:', docScore, 'Observação:', observacaoText);
          
          // Atualizar resultado com status rejeitado
          const rejectedResult: LivenessResult = {
            ...livenessResult,
            raw: {
              ...livenessResult.raw,
              backendAnalysis,
              documentScore: docScore,
              documentAnalysis: this.documentAnalysis()
            }
          };
          this.livenessResult.set(rejectedResult);
          
          // Mostrar tela de resumo mesmo quando rejeitado (igual aprovado)
          this.showReviewStep.set(true);
          this.statusMessage.set('Análise completa - Documento rejeitado');
          return; // SAIR - não fazer match adicional se documento inválido
        }
      }

      // 3. Só fazer match adicional se documento for válido
      this.statusMessage.set('Comparando com todas as imagens de liveness...');
      
      const matchResult = await firstValueFrom(
        this.faceMatchService.matchLivenessWithDocument(
          this.sessionId,
          this.documentS3Path()!,
          livenessResult.auditImages
        )
      );

      // Atualizar livenessResult com match e análise
      const updatedResult: LivenessResult = {
        ...livenessResult,
        // Adicionar informações de match e análise ao raw
        raw: {
          ...livenessResult.raw,
          matchResult,
          backendAnalysis,
          documentScore: backendAnalysis?.documentScore,
          documentAnalysis: this.documentAnalysis()
        }
      };

      this.livenessResult.set(updatedResult);
      this.showReviewStep.set(true);
      this.statusMessage.set('Análise completa!');
    } catch (error: any) {
      console.error('[Capture Official] Erro ao fazer análise completa:', error);
      // Continuar mesmo se análise falhar
      this.showReviewStep.set(true);
    }
  }

  private handleWidgetError(error: any): void {
    console.error('[Capture Official] Erro no widget:', error);
    this.errorMessage.set(error?.message || 'Erro durante verificação.');
    this.statusMessage.set('Erro na verificação');
  }

  async handleReviewFinished(userObservation: string | null): Promise<void> {
    // Salvar no histórico e fechar
    const result = this.livenessResult();
    if (result) {
      const backendAnalysis = result.raw?.backendAnalysis;
      const documentScore = this.documentScore() || backendAnalysis?.documentScore || null;
      
      // Preparar informações do vídeo para o histórico
      let videoSummary: LivenessSummary['video'] | undefined;
      if (this.recordedVideo && (this as any)._videoKey) {
        try {
          const videoUrl = await firstValueFrom(
            from(this.s3Service.getSignedUrl((this as any)._videoKey))
          );
          videoSummary = {
            s3Key: (this as any)._videoKey,
            url: videoUrl,
            mimeType: this.recordedVideo.mimeType,
            size: this.recordedVideo.blob.size,
            durationMs: this.recordedVideo.durationMs
          };
        } catch (error) {
          console.warn('[Capture Official] Erro ao gerar URL do vídeo:', error);
        }
      }

      // Priorizar observação do usuário sobre observação do backend
      const finalObservacao = userObservation?.trim() || backendAnalysis?.observacao || backendAnalysis?.message || null;

      const summary: LivenessSummary = {
        sessionId: result.sessionId,
        createdAt: new Date().toISOString(),
        isLive: result.confidenceScore >= 70,
        livenessScore: result.confidenceScore,
        faceMatchScore: result.raw?.matchResult?.bestMatchScore,
        status: this.determineStatus(result),
        documentKey: this.documentKey() || undefined, // Salvar documentKey para histórico
        video: videoSummary, // Adicionar vídeo ao histórico
        captures: result.auditImages?.map((img, idx) => ({
          position: `audit_${idx}`,
          confidence: result.confidenceScore,
          s3Key: img.key,
          previewUrl: img.url || ''
        })) || [],
        metadata: {
          documentS3Path: this.documentS3Path() || '',
          documentKey: this.documentKey() || '', // Salvar também no metadata
          documentUrl: this.documentUrl() || '', // Salvar URL assinada
          ...(documentScore ? { documentScore: String(documentScore) } : {}), // Salvar score do documento apenas se existir
          matchResult: JSON.stringify(result.raw?.matchResult || {}),
          ...(backendAnalysis ? { backendAnalysis: JSON.stringify(backendAnalysis) } : {}), // Salvar análise apenas se existir
          ...(finalObservacao ? { observacao: finalObservacao } : {}) // Salvar observação do usuário ou backend
        },
        backendAnalysis: backendAnalysis ? {
          documentScore: documentScore || undefined,
          matchScore: backendAnalysis.matchScore || undefined,
          identityScore: backendAnalysis.identityScore || undefined,
          observacao: finalObservacao || undefined, // Usar observação final (usuário ou backend)
          message: backendAnalysis.message || undefined,
          status: backendAnalysis.status || undefined
        } : undefined
      };

      this.lastSummary.set(summary);
      this.historyService.addEntry(summary);
    }

    this.closeModal();
  }

  private async saveRejectedToHistory(result: LivenessResult, observacao: string): Promise<void> {
    try {
      this.statusMessage.set('Salvando resultado rejeitado no histórico...');
      
      const backendAnalysis = result.raw?.backendAnalysis;
      const documentScore = this.documentScore() ?? backendAnalysis?.documentScore ?? 0;
      
      // Preparar informações do vídeo para o histórico
      let videoSummary: LivenessSummary['video'] | undefined;
      if (this.recordedVideo && (this as any)._videoKey) {
        try {
          const videoUrl = await firstValueFrom(
            from(this.s3Service.getSignedUrl((this as any)._videoKey))
          );
          videoSummary = {
            s3Key: (this as any)._videoKey,
            url: videoUrl,
            mimeType: this.recordedVideo.mimeType,
            size: this.recordedVideo.blob.size,
            durationMs: this.recordedVideo.durationMs
          };
        } catch (error) {
          console.warn('[Capture Official] Erro ao gerar URL do vídeo:', error);
        }
      }

      const summary: LivenessSummary = {
        sessionId: result.sessionId,
        createdAt: new Date().toISOString(),
        isLive: result.confidenceScore >= 70,
        livenessScore: result.confidenceScore,
        faceMatchScore: undefined, // Sem match porque documento foi rejeitado
        status: 'Rejeitado', // Status fixo como REJEITADO
        documentKey: this.documentKey() || undefined,
        video: videoSummary,
        captures: result.auditImages?.map((img, idx) => ({
          position: `audit_${idx}`,
          confidence: result.confidenceScore,
          s3Key: img.key,
          previewUrl: img.url || ''
        })) || [],
        metadata: {
          documentS3Path: this.documentS3Path() || '',
          documentKey: this.documentKey() || '',
          documentUrl: this.documentUrl() || '',
          documentScore: String(documentScore),
          ...(backendAnalysis ? { backendAnalysis: JSON.stringify(backendAnalysis) } : {}),
          observacao: observacao || 'Documento rejeitado: não é RG ou CNH válido'
        },
        backendAnalysis: backendAnalysis ? {
          documentScore: documentScore || undefined,
          matchScore: backendAnalysis.matchScore || undefined,
          identityScore: backendAnalysis.identityScore || undefined,
          observacao: observacao || undefined,
          message: backendAnalysis.message || undefined,
          status: 'REJECTED'
        } : {
          documentScore: documentScore || undefined,
          observacao: observacao || 'Documento rejeitado: não é RG ou CNH válido',
          status: 'REJECTED'
        }
      };

      this.lastSummary.set(summary);
      this.historyService.addEntry(summary);
      
      console.log('[Capture Official] ✅ Resultado REJEITADO salvo no histórico:', summary);
      this.statusMessage.set('Resultado salvo no histórico como Rejeitado');
      
      // Fechar modal após salvar
      setTimeout(() => {
        this.closeModal();
      }, 1500);
    } catch (error) {
      console.error('[Capture Official] Erro ao salvar resultado rejeitado no histórico:', error);
      this.errorMessage.set('Erro ao salvar no histórico. Tente novamente.');
      setTimeout(() => {
        this.closeModal();
      }, 2000);
    }
  }

  private determineStatus(result: LivenessResult): 'Aprovado' | 'Rejeitado' | 'Revisar' {
    // ============================================================
    // REGRA CRÍTICA: Validar documento DEPOIS do liveness
    // Se documento não for válido (RG/CNH), SEMPRE rejeitar
    // ============================================================
    
    // CRÍTICO: Verificar documento primeiro - se inválido, rejeitar independente de tudo
    const documentScore = this.documentScore() ?? result.raw?.backendAnalysis?.documentScore ?? 0;
    const backendAnalysis = result.raw?.backendAnalysis;
    
    // Verificar flags do documento se disponíveis
    const documentFlags = backendAnalysis?.observacao || '';
    const hasInvalidFlags = documentFlags.includes('não é RG') || 
                           documentFlags.includes('não é CNH') ||
                           documentFlags.includes('Documento rejeitado') ||
                           documentFlags.includes('inválido');
    
    // CRÍTICO: Se documento tem score 0 ou muito baixo (< 50), ou flags de invalidez, REJEITAR
    if (documentScore <= 0 || documentScore < 50 || hasInvalidFlags) {
      console.warn('[Capture Official] 🚨 Documento inválido detectado. Score:', documentScore, 'Flags:', hasInvalidFlags);
      return 'Rejeitado';
    }
    
    // Priorizar status do backend se disponível (decisão final após análise completa)
    const backendStatus = backendAnalysis?.status;
    if (backendStatus) {
      const statusUpper = backendStatus.toUpperCase();
      if (statusUpper === 'APPROVED' || statusUpper === 'APROVADO') {
        // Mas verificar novamente se documento é válido antes de aprovar
        if (documentScore >= 85 && !hasInvalidFlags) {
          return 'Aprovado';
        } else {
          console.warn('[Capture Official] ⚠️ Backend aprovou, mas documento não é válido (score:', documentScore, ') - REJEITANDO');
          return 'Rejeitado';
        }
      } else if (statusUpper === 'REJECTED' || statusUpper === 'REJEITADO') {
        console.log('[Capture Official] 🚨 Status REJEITADO pelo backend:', backendAnalysis);
        return 'Rejeitado';
      } else if (statusUpper === 'REVIEW' || statusUpper === 'REVISAR') {
        return 'Revisar';
      }
    }

    // Fallback: determinar status baseado nos scores locais
    const livenessScore = result.confidenceScore;
    const matchScore = result.raw?.matchResult?.bestMatchScore || 0;
    const finalScore = result.raw?.matchResult?.finalScore || livenessScore;
    const identityScore = result.raw?.backendAnalysis?.identityScore;

    // Se tem identityScore do backend, usar ele como critério principal
    // MAS SEMPRE verificar se documento é válido primeiro
    if (identityScore !== undefined && identityScore !== null) {
      // CRÍTICO: Documento válido é obrigatório para aprovação
      if (documentScore < 85 || hasInvalidFlags) {
        console.warn('[Capture Official] 🚨 Documento não é válido (score:', documentScore, ') - REJEITANDO mesmo com identityScore:', identityScore);
        return 'Rejeitado';
      }
      
      if (identityScore >= 0.85 && documentScore >= 85) {
      return 'Aprovado';
      } else if (identityScore < 0.50 || documentScore < 50) {
        return 'Rejeitado';
      } else {
        return 'Revisar';
      }
    }

    // Lógica antiga como fallback - MAS SEMPRE verificar documento primeiro
    if (documentScore < 85 || hasInvalidFlags) {
      console.warn('[Capture Official] 🚨 Documento não é válido (score:', documentScore, ') - REJEITANDO');
      return 'Rejeitado';
    }
    
    if (livenessScore >= 90 && matchScore >= 80 && finalScore >= 85 && documentScore >= 85) {
      return 'Aprovado';
    } else if (livenessScore < 70 || matchScore < 50 || finalScore < 60 || documentScore < 50) {
      return 'Rejeitado';
    } else {
      return 'Revisar';
    }
  }

  private async startVideoRecordingFromWidget(): Promise<void> {
    // Aguardar widget iniciar e encontrar elemento de vídeo
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
            console.log('[Capture Official] 🎥 Stream de vídeo encontrado, iniciando gravação...');
            this.videoStream = stream;
            try {
              this.videoRecorder = startVideoRecording(stream);
              this.isRecordingVideo.set(true);
              console.log('[Capture Official] ✅ Gravação de vídeo INICIADA com sucesso!');
              this.statusMessage.set('🎥 Gravando vídeo da sessão...');
              return;
            } catch (error) {
              console.error('[Capture Official] ❌ Erro ao iniciar gravação:', error);
              this.isRecordingVideo.set(false);
            }
          }
        }
      }

      // Tentar novamente se não encontrou
      if (attempts < maxAttempts) {
        attempts++;
        setTimeout(findAndRecordVideo, 500);
      }
    };

    // Aguardar um pouco antes de começar a procurar
    setTimeout(findAndRecordVideo, 1000);
  }

  private async stopVideoRecording(): Promise<void> {
    if (this.videoRecorder) {
      try {
        console.log('[Capture Official] 🛑 Parando gravação de vídeo...');
        this.isRecordingVideo.set(false);
        this.recordedVideo = await this.videoRecorder.stopRecording();
        this.videoRecorder = null;
        console.log('[Capture Official] ✅ Vídeo gravado com sucesso!', {
          size: `${(this.recordedVideo.blob.size / 1024 / 1024).toFixed(2)} MB`,
          duration: `${(this.recordedVideo.durationMs / 1000).toFixed(2)} segundos`,
          mimeType: this.recordedVideo.mimeType
        });
      } catch (error) {
        console.error('[Capture Official] ❌ Erro ao parar gravação:', error);
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
    // Parar observer da elipse
    this.stopOvalObserver();
    // Parar observer de verificação
    this.stopVerifyingObserver();
    // Parar observer de orientação facial
    this.stopFaceGuidanceObserver();
    this.isVerifying.set(false);

    // Parar gravação de vídeo se ainda estiver ativa (sem await - não bloquear)
    void this.stopVideoRecording();

    if (this.widgetInstance) {
      try {
        if (typeof this.widgetInstance.destroy === 'function') {
          this.widgetInstance.destroy();
        }
      } catch (error) {
        console.warn('Erro ao destruir widget:', error);
      }
      this.widgetInstance = null;
    }

    // Limpar listeners do widget local
    const listeners = (this as any)._localWidgetListeners;
    if (listeners) {
      document.removeEventListener('liveness-complete', listeners.onComplete);
      document.removeEventListener('liveness-error', listeners.onError);
      (this as any)._localWidgetListeners = null;
    }

    // Limpar container
    const container = document.getElementById('liveness-container-official');
    if (container) {
      container.innerHTML = '';
    }

    // Limpar variáveis de vídeo
    (this as any)._videoKey = null;
    this.recordedVideo = null;
  }

  /**
   * Navega para a página de histórico
   */
  goToHistory(): void {
    this.router.navigate(['/history']);
  }
}

