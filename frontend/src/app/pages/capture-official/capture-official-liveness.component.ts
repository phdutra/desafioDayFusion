import { CommonModule } from '@angular/common';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  HostListener,
  Input,
  Signal,
  WritableSignal,
  inject,
  signal,
  AfterViewInit,
  OnDestroy
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
import { Amplify } from 'aws-amplify';
import awsExports from '../../../aws-exports';

// Garantir que Amplify está configurado
if (typeof Amplify !== 'undefined') {
  try {
    Amplify.configure(awsExports);
  } catch (error) {
    console.warn('[Liveness] Amplify já configurado ou erro na configuração:', error);
  }
}

// Declaração do widget oficial AWS Face Liveness
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
export class CaptureOfficialLivenessComponent implements AfterViewInit, OnDestroy {
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
  readonly isClosing = signal<boolean>(false);
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

  private livenessDetector: any = null;

  isMobile(): boolean {
    return window.innerWidth <= 768;
  }
  private verifyingObserverInterval: any = null;
  private sessionId = '';
  private videoRecorder: MediaRecorderController | null = null;
  private videoStream: MediaStream | null = null;
  private recordedVideo: RecordedMedia | null = null;
  private videoMirrorObserver: MutationObserver | null = null;

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

    this.isClosing.set(true);
    // Aguardar animação de fadeout antes de fechar completamente
    setTimeout(() => {
      this.isModalOpen.set(false);
      this.isClosing.set(false);
      this.destroyWidget();
      this.showReviewStep.set(false);
      this.showPreparationScreen.set(false);
      this.preparationCountdown.set(5);
    }, 400); // Tempo da animação CSS
    this.livenessResult.set(null);
    this.sessionId = '';
  }

  retry(): void {
    this.errorMessageSignal.set(null);
    this.preparationCountdown.set(5);
    this.showPreparationScreen.set(true);
    this.destroyWidget();
    
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

  ngAfterViewInit(): void {
    // Não inicializar automaticamente - aguardar usuário abrir modal
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
      this.statusMessage.set('Carregando widget...');

      // Aguardar um pouco para garantir que o DOM está pronto
      await new Promise(resolve => setTimeout(resolve, 300));

      await this.initAmplifyLiveness(this.sessionId);
      this.isLoading.set(false);
      this.setupWidgetListeners();
      
      // Status será atualizado pelo autoStartWidget quando a elipse aparecer
    } catch (error: any) {
      console.error('[Liveness] Erro ao iniciar sessão:', error);
      this.errorMessageSignal.set(error?.message || 'Erro ao iniciar verificação.');
      this.statusMessage.set('Erro ao inicializar');
      this.isLoading.set(false);
    }
  }

  private async initAmplifyLiveness(sessionId: string): Promise<void> {
    const container = document.getElementById('aws-liveness-container');
    if (!container) {
      throw new Error('Container do widget não encontrado.');
    }

    // Limpar container
    container.innerHTML = '';

    try {
      // Aguardar widget oficial AWS estar disponível
      let attempts = 0;
      const maxAttempts = 30;
      const checkInterval = 200;

      while ((typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        attempts++;
      }

      // Tentar usar widget oficial AWS primeiro
      if (typeof AwsLiveness !== 'undefined') {
        console.log('[Liveness] ✅ Usando widget oficial AwsLiveness');
        this.livenessDetector = new AwsLiveness({
          sessionId: sessionId,
          region: this.awsRegion,
          onComplete: (result: any) => {
            console.log('[Liveness] Widget completo:', result);
            this.handleWidgetComplete(result);
          },
          onError: (error: any) => {
            console.error('[Liveness] Erro no widget:', error);
            this.handleWidgetError(error);
          }
        });
        
        // Montar widget usando mount (seguindo guia)
        if (this.livenessDetector && typeof this.livenessDetector.mount === 'function') {
          console.log('[Liveness] Montando widget AwsLiveness usando mount()');
          this.livenessDetector.mount('#aws-liveness-container');
          
          // Aplicar espelhamento no vídeo após widget montar
          setTimeout(() => this.applyVideoMirror(), 500);
        }
      } else if (typeof FaceLiveness !== 'undefined') {
        console.log('[Liveness] ✅ Usando widget oficial FaceLiveness V2');
        
        // Obter a classe do widget (seguindo padrão do aws-widget.component.ts)
        const WidgetClass = (FaceLiveness as any).default || FaceLiveness;
        
        if (typeof WidgetClass !== 'function') {
          throw new Error('FaceLiveness não é uma classe válida');
        }
        
        // Configurar widget com preset faceMovementAndLight para elipse e flash colorido
        this.livenessDetector = new WidgetClass({
          sessionId: sessionId,
          region: this.awsRegion,
          preset: 'faceMovementAndLight', // ESSENCIAL: permite elipse e flash colorido
          onComplete: (result: any) => {
            console.log('[Liveness] Widget completo:', result);
            this.handleWidgetComplete(result);
          },
          onError: (error: any) => {
            console.error('[Liveness] Erro no widget:', error);
            this.handleWidgetError(error);
          },
          onUserCancellation: () => {
            console.log('[Liveness] Usuário cancelou verificação');
            this.closeModal();
          }
        });
        
        // Renderizar widget no container (seguindo guia: usar mount)
        if (this.livenessDetector) {
          if (typeof this.livenessDetector.mount === 'function') {
            console.log('[Liveness] Montando widget FaceLiveness V2 usando mount()');
            this.livenessDetector.mount('#aws-liveness-container');
          } else if (typeof this.livenessDetector.render === 'function') {
            console.log('[Liveness] Renderizando widget FaceLiveness V2 usando render()');
            this.livenessDetector.render(container);
          } else {
            console.warn('[Liveness] Widget não possui método mount ou render');
          }
          
          // Aguardar widget renderizar completamente
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Aplicar espelhamento no vídeo após widget renderizar
          setTimeout(() => this.applyVideoMirror(), 500);
        }
      } else {
        // Fallback: usar widget local se oficial não estiver disponível
        console.warn('[Liveness] ⚠️ Widget oficial AWS não disponível, usando widget local como fallback');
        await this.initLocalWidget(sessionId);
        return; // Retornar aqui pois initLocalWidget já configura tudo
      }

      // Aguardar widget oficial inicializar completamente
      this.statusMessage.set('Widget carregado. Aguardando inicialização...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verificar se widget está pronto antes de iniciar
      const widgetReady = this.checkWidgetReady();
      if (!widgetReady) {
        console.warn('[Liveness] Widget pode não estar totalmente pronto, mas continuando...');
      }
      
      // Iniciar captura automaticamente (clicar no botão Start do widget)
      // Isso fará a elipse aparecer
      this.statusMessage.set('Iniciando verificação...');
      await this.autoStartWidget();
      
      // Configurar observadores após widget iniciar
      this.startVerifyingObserver();
      this.startVideoRecordingFromWidget();
    } catch (error: any) {
      console.error('[Liveness] Erro ao inicializar widget:', error);
      throw new Error(`Erro ao inicializar verificação: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  private async initLocalWidget(sessionId: string): Promise<void> {
    const container = document.getElementById('aws-liveness-container');
    if (!container) {
      throw new Error('Container do widget não encontrado.');
    }

    // Limpar container
    container.innerHTML = '';

    try {
      // Usar widget local (web component) como fallback
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

      // Aguardar widget estar disponível
      let attempts = 0;
      const maxAttempts = 20;
      while (!customElements.get('face-liveness-widget') && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 200));
        attempts++;
      }

      if (!customElements.get('face-liveness-widget')) {
        throw new Error('Widget local não está disponível. Verifique se o script está carregado.');
      }

      // Configurar listeners para eventos do widget
      const onComplete = (event: Event) => {
        const customEvent = event as CustomEvent;
        console.log('[Liveness] Widget local completo:', customEvent.detail);
        this.handleWidgetComplete(customEvent.detail);
      };

      const onError = (event: Event) => {
        const customEvent = event as CustomEvent;
        console.error('[Liveness] Erro no widget local:', customEvent.detail);
        this.handleWidgetError(customEvent.detail);
      };

      document.addEventListener('liveness-complete', onComplete);
      document.addEventListener('liveness-error', onError);

      // Armazenar listeners para limpeza
      (this as any)._localWidgetListeners = { onComplete, onError };

      // Aguardar widget inicializar
      this.statusMessage.set('Widget local carregado. Iniciando captura...');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Iniciar captura automaticamente
      await this.autoStartWidget();
      
      // Configurar observadores após widget iniciar
      this.startVerifyingObserver();
      this.startVideoRecordingFromWidget();
    } catch (error: any) {
      console.error('[Liveness] Erro ao inicializar widget local:', error);
      throw new Error(`Erro ao inicializar verificação: ${error?.message || 'Erro desconhecido'}`);
    }
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
    const container = document.getElementById('aws-liveness-container');
    if (!container) return;

    const allText = container.innerText || container.textContent || '';
    const textLower = allText.toLowerCase();
    const verifyingKeywords = ['verifying', 'verificando', 'check complete', 'complete'];
    const hasVerifying = verifyingKeywords.some(keyword => textLower.includes(keyword));

    if (hasVerifying && !this.isVerifying()) {
      this.isVerifying.set(true);
      // Widget AWS gerencia flash colorido internamente - não interferir
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



  private async autoStartWidget(): Promise<void> {
    const container = document.getElementById('aws-liveness-container');
    if (!container) {
      console.warn('[Liveness] Container não encontrado para auto-start');
      return;
    }

    // Aguardar widget estar totalmente carregado
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Tentar múltiplas vezes (widget pode demorar para carregar)
    const maxAttempts = 15;
    let attempts = 0;

    const tryStart = async (): Promise<void> => {
      attempts++;
      console.log(`[Liveness] Tentativa ${attempts}/${maxAttempts} de iniciar widget...`);

      // Primeiro, verificar se é widget local (com Shadow DOM)
      const widgetElement = container.querySelector('face-liveness-widget') as any;
      if (widgetElement) {
        const shadowRoot = widgetElement.shadowRoot;
        if (shadowRoot) {
          console.log('[Liveness] Widget local encontrado (Shadow DOM), procurando botão...');
          const buttons = shadowRoot.querySelectorAll('button');
          
          for (const btn of Array.from(buttons) as HTMLElement[]) {
            const buttonElement = btn as HTMLButtonElement;
            const text = (buttonElement.textContent || buttonElement.innerText || '').toLowerCase().trim();
            const ariaLabel = (buttonElement.getAttribute('aria-label') || '').toLowerCase();
            
            if (
              (text.includes('start') || text.includes('iniciar') || text.includes('começar') || text === 'ok' || text === '') &&
              !buttonElement.disabled &&
              buttonElement.offsetParent !== null
            ) {
              console.log('[Liveness] ✅ Botão encontrado no widget local (Shadow DOM), clicando...');
              // Widget AWS gerencia flash colorido internamente
              buttonElement.click();
              
              const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
              });
              buttonElement.dispatchEvent(clickEvent);
              
              await new Promise(resolve => setTimeout(resolve, 1000));
              await this.checkElipseVisible();
              return;
            }
          }
        }
      }

      // Widget oficial AWS renderiza diretamente no container (não usa Shadow DOM)
      const buttonSelectors = [
        'button[data-testid="start-button"]',
        'button[aria-label*="Start"]',
        'button[aria-label*="Iniciar"]',
        'button[aria-label*="Começar"]',
        '.amplify-button--primary',
        'button'
      ];

      let button: HTMLElement | null = null;

      // Procurar botão no container
      for (const selector of buttonSelectors) {
        try {
          const elements = container.querySelectorAll(selector);
          for (const el of Array.from(elements)) {
            const text = (el.textContent || '').toLowerCase().trim();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            
            console.log(`[Liveness] Verificando botão: text="${text}", aria-label="${ariaLabel}", disabled=${(el as HTMLButtonElement).disabled}, visible=${(el as HTMLElement).offsetParent !== null}`);
            
            // Verificar se é botão de início
            if (
              (text.includes('start') || text.includes('iniciar') || text.includes('começar') || text === 'ok' || text === '') &&
              !(el as HTMLButtonElement).disabled &&
              (el as HTMLElement).offsetParent !== null
            ) {
              button = el as HTMLElement;
              console.log('[Liveness] ✅ Botão de início encontrado!');
              break;
            }
          }
          if (button) break;
        } catch (e) {
          // Ignorar erros de seletor
        }
      }

      // Se não encontrou por texto, pegar primeiro botão visível e habilitado
      if (!button) {
        const buttons = container.querySelectorAll('button');
        console.log(`[Liveness] Encontrados ${buttons.length} botões no container`);
        for (const btn of Array.from(buttons)) {
          const btnElement = btn as HTMLButtonElement;
          if (
            btnElement.offsetParent !== null &&
            btnElement.style.display !== 'none' &&
            !btnElement.disabled
          ) {
            button = btnElement;
            console.log('[Liveness] Usando primeiro botão visível encontrado');
            break;
          }
        }
      }

      if (button) {
        console.log('[Liveness] ✅ Clicando no botão para iniciar widget...');
        // Widget AWS gerencia flash colorido internamente
        
        // Clicar no botão
        (button as HTMLElement).click();
        
        // Também disparar evento de mouse para garantir
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        (button as HTMLElement).dispatchEvent(clickEvent);
        
        // Aguardar widget iniciar e elipse aparecer
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verificar se elipse apareceu
        await this.checkElipseVisible();
      } else if (attempts < maxAttempts) {
        // Tentar novamente após um delay
        console.log(`[Liveness] Botão não encontrado, tentando novamente em 500ms...`);
        setTimeout(tryStart, 500);
      } else {
        console.warn('[Liveness] ❌ Não foi possível encontrar botão de início após múltiplas tentativas');
        this.statusMessage.set('Clique no botão "Start" para iniciar a verificação');
      }
    };

    await tryStart();
  }

  private checkWidgetReady(): boolean {
    const container = document.getElementById('aws-liveness-container');
    if (!container) return false;
    
    // Verificar se há elementos do widget renderizados
    const hasVideo = container.querySelectorAll('video').length > 0;
    const hasCanvas = container.querySelectorAll('canvas').length > 0;
    const hasIframe = container.querySelectorAll('iframe').length > 0;
    const hasWidgetElements = container.children.length > 0;
    
    const isReady = hasVideo || hasCanvas || hasIframe || hasWidgetElements;
    console.log('[Liveness] Widget pronto?', { hasVideo, hasCanvas, hasIframe, hasWidgetElements, isReady });
    
    return isReady;
  }

  private async checkElipseVisible(): Promise<void> {
    const container = document.getElementById('aws-liveness-container');
    if (!container) return;

    const maxCheckAttempts = 8;
    let checkAttempts = 0;
    
    while (checkAttempts < maxCheckAttempts) {
      // Verificar no container principal (widget oficial AWS)
      const videoElements = container.querySelectorAll('video');
      const canvasElements = container.querySelectorAll('canvas');
      const ovalElements = container.querySelectorAll('[class*="oval"], [class*="Oval"], [class*="liveness-oval"]');
      
      // Verificar também no Shadow DOM do widget local
      const widgetElement = container.querySelector('face-liveness-widget') as any;
      let shadowVideoElements: NodeListOf<HTMLVideoElement> | [] = [];
      let shadowCanvasElements: NodeListOf<HTMLCanvasElement> | [] = [];
      let shadowOvalElements: NodeListOf<HTMLElement> | [] = [];
      
      if (widgetElement?.shadowRoot) {
        shadowVideoElements = widgetElement.shadowRoot.querySelectorAll('video');
        shadowCanvasElements = widgetElement.shadowRoot.querySelectorAll('canvas');
        shadowOvalElements = widgetElement.shadowRoot.querySelectorAll('[class*="oval"], [class*="Oval"], [class*="liveness-oval"]');
      }
      
      const totalVideos = videoElements.length + shadowVideoElements.length;
      const totalCanvases = canvasElements.length + shadowCanvasElements.length;
      const totalOvals = ovalElements.length + shadowOvalElements.length;
      
      console.log(`[Liveness] Verificando elipse: Vídeos=${totalVideos}, Canvas=${totalCanvases}, Ovals=${totalOvals}`);
      
      if (totalVideos > 0 || totalCanvases > 0 || totalOvals > 0) {
        console.log('[Liveness] ✅ Elipse visível! Vídeos:', totalVideos, 'Canvas:', totalCanvases, 'Ovals:', totalOvals);
        this.statusMessage.set('Centralize seu rosto na elipse');
        return;
      }
      
      checkAttempts++;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.warn('[Liveness] Elipse pode não estar visível ainda');
    this.statusMessage.set('Aguardando câmera iniciar...');
  }

  private setupWidgetListeners(): void {
    // Observar mudanças no container para detectar eventos do widget
    const container = document.getElementById('aws-liveness-container');
    if (!container) return;

    // Aplicar espelhamento no vídeo (sem afetar elipse e flash)
    this.applyVideoMirror();

    // Observer para detectar quando o widget muda de estado
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'attributes') {
          // Verificar se há mudanças que indicam início de captura
          const videoElements = container.querySelectorAll('video');
          if (videoElements.length > 0) {
            const video = videoElements[0] as HTMLVideoElement;
            if (video.readyState >= 2 && !this.isRecordingVideo()) {
              // Widget AWS gerencia flash colorido internamente
            }
          }
          
          // Reaplicar espelhamento se novos vídeos forem adicionados
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            this.applyVideoMirror();
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

  /**
   * Aplica espelhamento e posicionamento nos vídeos (seguindo padrão AWS Amplify)
   * O CSS já aplica o espelhamento ANTES do vídeo carregar, mas este método
   * garante que vídeos adicionados dinamicamente também sejam ajustados
   */
  private applyVideoMirror(): void {
    const container = document.getElementById('aws-liveness-container');
    if (!container) return;

    const applyMirrorToVideos = () => {
      // Encontrar APENAS elementos <video> (não canvas, não SVG)
      const allVideos = container.querySelectorAll('video');
      
      allVideos.forEach((element) => {
        const video = element as HTMLVideoElement;
        if (video && video instanceof HTMLVideoElement && !video.hasAttribute('data-mirrored')) {
          // Aplicar espelhamento e centralização seguindo padrão AWS Amplify
          // O CSS já faz isso, mas garantimos via JS para vídeos dinâmicos
          video.style.setProperty('position', 'absolute', 'important');
          video.style.setProperty('top', '50%', 'important');
          video.style.setProperty('left', '50%', 'important');
          video.style.setProperty('transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          video.style.setProperty('-webkit-transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          video.style.setProperty('-moz-transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          video.style.setProperty('-ms-transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          video.style.setProperty('width', '100%', 'important');
          video.style.setProperty('height', '100%', 'important');
          video.style.setProperty('object-fit', 'cover', 'important');
          video.style.setProperty('object-position', 'center', 'important');
          video.style.setProperty('z-index', '1', 'important');
          
          video.setAttribute('data-mirrored', 'true');
          console.log('[Liveness] ✅ Vídeo centralizado e espelhado (padrão AWS Amplify)');
        }
      });
    };

    // Aplicar imediatamente
    applyMirrorToVideos();

    // Observer para aplicar quando novos vídeos forem adicionados
    if (this.videoMirrorObserver) {
      this.videoMirrorObserver.disconnect();
    }

    this.videoMirrorObserver = new MutationObserver(() => {
      applyMirrorToVideos();
    });

    this.videoMirrorObserver.observe(container, {
      childList: true,
      subtree: true
    });
  }

  private async handleWidgetComplete(result: any): Promise<void> {
    console.log('[Liveness] Widget completo:', result);
    this.isVerifying.set(true); // Manter verifying ativo durante processamento
    this.statusMessage.set('Verificando...');

    // Widget AWS gerencia flash colorido internamente

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
        this.isVerifying.set(true); // Manter verifying ativo durante análise
        this.statusMessage.set('Verificando...');
        await this.performCompleteAnalysis(livenessResult);
      } else {
        this.isVerifying.set(false);
        this.statusMessage.set(''); // Limpar status
        // Não mostrar review step - resultados aparecerão na página principal
        await this.finalizeAndClose();
      }
    } catch (error: any) {
      console.error('[Liveness] Erro ao processar resultados:', error);
      this.errorMessageSignal.set('Erro ao processar resultados da verificação.');
    }
  }

  private async performCompleteAnalysis(livenessResult: LivenessResult): Promise<void> {
    if (!this.documentKey || !livenessResult.auditImages?.length) {
      this.isVerifying.set(false);
      this.statusMessage.set('');
      // No mobile, fechar modal antes de mostrar review (mesmo padrão da web)
      if (this.isMobile()) {
        this.closeModal();
        // Aguardar modal fechar antes de mostrar review
        setTimeout(() => {
          this.showReviewStep.set(true);
        }, 500);
      } else {
        this.showReviewStep.set(true);
      }
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
          this.isVerifying.set(false);
          this.statusMessage.set('Análise completa - Documento rejeitado');
          // No mobile, fechar modal antes de mostrar review (mesmo padrão da web)
          if (this.isMobile()) {
            this.closeModal();
            setTimeout(() => {
              this.showReviewStep.set(true);
            }, 500);
          } else {
            this.showReviewStep.set(true);
          }
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
      this.isVerifying.set(false); // Desativar verifying após análise completa
      this.statusMessage.set(''); // Limpar status
      // Não mostrar review step - resultados aparecerão na página principal
      await this.finalizeAndClose();
    } catch (error: any) {
      console.error('[Liveness] Erro ao fazer análise completa:', error);
      this.statusMessage.set(''); // Limpar status mesmo em erro
      // Mesmo em erro, finalizar e mostrar resultados na página principal
      await this.finalizeAndClose();
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
    
    // Fechar modal com fadeout suave
    this.closeModal();
    
    // Aguardar fadeout e então scrollar para resultados
    setTimeout(() => {
      this.scrollToResults();
    }, 500); // Aguardar fadeout + pequeno delay
    
    // Não mostrar review step - resultados aparecerão na página principal
    this.showReviewStep.set(false);
  }

  /**
   * Scrolla suavemente para a seção de resultados na página principal
   */
  private scrollToResults(): void {
    // Aguardar um pouco para garantir que o DOM foi atualizado
    setTimeout(() => {
      const resultSection = document.querySelector('.result-section');
      if (resultSection) {
        resultSection.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start',
          inline: 'nearest'
        });
      } else {
        // Fallback: scrollar para o final da página
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100);
  }

  private async finalizeAndClose(): Promise<void> {
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

    const finalObservacao = backendAnalysis?.observacao || backendAnalysis?.message || null;

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
    
    // Fechar modal com fadeout suave
    this.closeModal();
    
    // Aguardar fadeout e então scrollar para resultados
    setTimeout(() => {
      this.scrollToResults();
    }, 500); // Aguardar fadeout + pequeno delay
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
      const container = document.getElementById('aws-liveness-container');
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
              
              // Widget AWS gerencia flash colorido internamente
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
    // Limpar observer de espelhamento
    if (this.videoMirrorObserver) {
      this.videoMirrorObserver.disconnect();
      this.videoMirrorObserver = null;
    }
    
    this.stopVerifyingObserver();
    this.isVerifying.set(false);
    this.statusMessage.set('');
    void this.stopVideoRecording();

    // Limpar observer de mutação
    const mutationObserver = (this as any)._widgetMutationObserver;
    if (mutationObserver) {
      mutationObserver.disconnect();
      (this as any)._widgetMutationObserver = null;
    }


    // Limpar listeners do widget local
    const listeners = (this as any)._localWidgetListeners;
    if (listeners) {
      document.removeEventListener('liveness-complete', listeners.onComplete);
      document.removeEventListener('liveness-error', listeners.onError);
      (this as any)._localWidgetListeners = null;
    }

    if (this.livenessDetector) {
      try {
        if (typeof this.livenessDetector.destroy === 'function') {
          this.livenessDetector.destroy();
        }
      } catch (error) {
        console.warn('[Liveness] Erro ao destruir detector:', error);
      }
      this.livenessDetector = null;
    }

    const container = document.getElementById('aws-liveness-container');
    if (container) {
      container.innerHTML = '';
    }

    (this as any)._videoKey = null;
    this.recordedVideo = null;
  }

  ngOnDestroy(): void {
    this.destroyWidget();
  }

  /**
   * REMOVIDO: triggerCustomFlash
   * 
   * O widget AWS Face Liveness gerencia o flash colorido internamente.
   * Não devemos interferir com overlays customizados, pois isso pode
   * quebrar a funcionalidade da elipse e do flash colorido do widget.
   * 
   * O flash colorido do widget AWS aparece automaticamente durante
   * o liveness check (Face Movement and Light Challenge).
   */
}
