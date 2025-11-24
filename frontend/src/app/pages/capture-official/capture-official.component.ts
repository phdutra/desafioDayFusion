import { CommonModule } from '@angular/common';
import { Component, computed, HostListener, inject, signal, ViewChild, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { LivenessService } from '../../services/liveness.service';
import { S3Service } from '../../core/aws/s3.service';
import { LivenessHistoryService } from '../../core/services/liveness-history.service';
import { FaceMatchService } from '../../core/services/face-match.service';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';
import { CustomReviewStepComponent, LivenessResult } from '../../components/custom-review-step/custom-review-step.component';
import { LivenessSummary } from '../../core/models/liveness-result.model';
import { firstValueFrom, from } from 'rxjs';
import { environment } from '../../../environments/environment';

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

  @ViewChild(CustomReviewStepComponent) reviewStep?: CustomReviewStepComponent;

  // Estados
  readonly isModalOpen = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly statusMessage = signal<string>('');
  readonly documentFile = signal<File | null>(null);
  readonly documentS3Path = signal<string | null>(null);
  readonly documentUrl = signal<string | null>(null);
  readonly documentKey = signal<string | null>(null); // Chave S3 do documento (sem s3://)
  readonly documentScore = signal<number | null>(null); // Score de validação do documento
  readonly documentAnalysis = signal<any | null>(null); // Análise completa do documento
  readonly showReviewStep = signal<boolean>(false);
  readonly livenessResult = signal<LivenessResult | null>(null);
  readonly lastSummary = signal<LivenessSummary | null>(null);
  readonly countdown = signal<number | null>(null);
  readonly showCountdown = signal<boolean>(false);

  // AWS Widget
  private widgetInstance: any = null;
  private ovalObserverInterval: any = null;
  private sessionId: string = '';
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
      this.isLoading.set(true);
      this.statusMessage.set('Enviando documento...');
      
      const uploadResult = await firstValueFrom(
        this.s3Service.uploadDocument(file)
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
          console.log('[Capture Official] URL assinada do documento salva:', uploadResult.url);
        } else {
          // Se não tiver URL, tentar gerar uma
          try {
            const signedUrl = await firstValueFrom(
              from(this.s3Service.getSignedUrl(uploadResult.key))
            );
            this.documentUrl.set(signedUrl);
            console.log('[Capture Official] URL assinada gerada:', signedUrl);
          } catch (error) {
            console.warn('[Capture Official] Não foi possível gerar URL assinada:', error);
          }
        }
        
        // Validar documento após upload (igual captura 3D)
        this.statusMessage.set('Validando documento...');
        await this.validateDocument(uploadResult.key);
        
        this.statusMessage.set('Documento enviado com sucesso!');
      }
    } catch (error: any) {
      console.error('Erro ao enviar documento:', error);
      this.errorMessage.set('Erro ao enviar documento. Tente novamente.');
    } finally {
      this.isLoading.set(false);
    }
  }

  clearDocument(): void {
    this.documentFile.set(null);
    this.documentS3Path.set(null);
    this.documentUrl.set(null);
    this.documentKey.set(null);
    this.documentScore.set(null);
    this.documentAnalysis.set(null);
  }

  private async validateDocument(documentKey: string): Promise<void> {
    try {
      // Chamar backend para análise completa do documento (igual captura 3D)
      // Usar endpoint que faz análise de documento + match (se tiver selfie)
      // Por enquanto, apenas validar documento
      const bucket = environment.aws?.bucket || 'dayfusion-docs';
      
      // Extrair apenas a key (sem prefixo s3://)
      const keyOnly = documentKey.includes('/') ? documentKey.split('/').pop() : documentKey;
      
      if (!keyOnly) {
        console.warn('[Capture Official] Não foi possível extrair key do documento');
        return;
      }

      // Chamar endpoint de análise de documento via face-recognition
      // O backend vai analisar o documento e retornar documentScore
      // Por enquanto, vamos fazer uma chamada simples para validar
      // (a análise completa será feita quando tiver liveness + match)
      
      console.log('[Capture Official] Validando documento:', keyOnly);
      
      // Nota: A validação completa do documento será feita quando chamar getLivenessResult
      // após completar o liveness, similar ao que é feito na captura 3D
      
    } catch (error: any) {
      console.error('[Capture Official] Erro ao validar documento:', error);
      // Não bloquear o fluxo se validação falhar
    }
  }

  openModal(): void {
    if (!this.documentFile() || !this.documentS3Path()) {
      this.errorMessage.set('Por favor, anexe um documento antes de iniciar a verificação.');
      return;
    }

    this.errorMessage.set(null);
    this.isModalOpen.set(true);
    this.showReviewStep.set(false);
    setTimeout(() => this.startSession(), 150);
  }

  closeModal(): void {
    this.destroyWidget();
    this.isModalOpen.set(false);
    this.showReviewStep.set(false);
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
  }

  private startOvalObserver(): void {
    // Limpar intervalo anterior se existir
    if (this.ovalObserverInterval) {
      clearInterval(this.ovalObserverInterval);
    }

    // Monitorar e remover elipse continuamente (mais agressivo durante gravação)
    this.ovalObserverInterval = setInterval(() => {
      this.hideOvalElements();
    }, 50); // Verificar a cada 50ms para remoção mais rápida
  }

  private hideOvalElements(): void {
    const container = document.getElementById('liveness-container-official');
    if (!container) return;

    // Remover completamente todos os elementos relacionados à elipse do DOM
    const selectors = [
      '[class*="amplify-liveness-oval"]',
      '[class*="amplify-liveness-oval-canvas"]',
      '[class*="liveness-oval"]',
      '[class*="liveness-oval-canvas"]',
      'canvas[class*="oval"]',
      'canvas[class*="canvas"]'
    ];

    selectors.forEach(selector => {
      const elements = container.querySelectorAll(selector);
      elements.forEach(el => {
        // Remover do DOM completamente
        try {
          el.remove();
        } catch (error) {
          // Se não conseguir remover, ocultar como fallback
          const htmlEl = el as HTMLElement;
          htmlEl.style.display = 'none';
          htmlEl.style.visibility = 'hidden';
          htmlEl.style.opacity = '0';
          htmlEl.style.pointerEvents = 'none';
        }
      });
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

    // Aplicar estilos diretamente via JavaScript para garantir
    const style = document.createElement('style');
    style.id = 'capture-official-widget-override';
    style.textContent = `
      #liveness-container-official {
        margin-top: -2rem !important;
        transform: translateY(-20px) !important;
      }
      
      #liveness-container-official video {
        margin-top: -2rem !important;
        transform: translateY(-20px) !important;
        object-position: center center !important;
      }
      
      #liveness-container-official canvas {
        margin-top: -2rem !important;
        transform: translateY(-20px) !important;
        object-position: center center !important;
      }
      
      /* Container do vídeo - garantir posicionamento relativo */
      #liveness-container-official [class*="amplify-liveness-video-anchor"],
      #liveness-container-official [class*="liveness-video-anchor"] {
        position: relative !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      /* Remover elipse/oval - específico para amplify */
      #liveness-container-official [class*="amplify-liveness-oval"],
      #liveness-container-official [class*="amplify-liveness-oval-canvas"],
      #liveness-container-official [class*="liveness-oval"],
      #liveness-container-official [class*="liveness-oval-canvas"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        position: absolute !important;
        left: -9999px !important;
        width: 0 !important;
        height: 0 !important;
      }
      
      /* Remover canvas dentro do container da elipse */
      #liveness-container-official [class*="amplify-liveness-oval-canvas"] canvas,
      #liveness-container-official [class*="liveness-oval-canvas"] canvas,
      #liveness-container-official canvas[class*="oval"],
      #liveness-container-official canvas[class*="canvas"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        position: absolute !important;
        left: -9999px !important;
        width: 0 !important;
        height: 0 !important;
      }

      /* Outros elementos de elipse */
      #liveness-container-official svg,
      #liveness-container-official [class*="ellipse"],
      #liveness-container-official [class*="Ellipse"],
      #liveness-container-official [class*="oval"]:not([class*="amplify"]):not([class*="liveness"]),
      #liveness-container-official [class*="Oval"],
      #liveness-container-official [class*="guide"],
      #liveness-container-official [class*="Guide"] {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        z-index: 1000 !important;
        pointer-events: none !important;
        margin: 0 !important;
      }
      
      /* Centralizar e destacar textos */
      #liveness-container-official p,
      #liveness-container-official span,
      #liveness-container-official div:not(video):not(canvas):not(svg):not([class*="ellipse"]):not([class*="oval"]):not([class*="guide"]) {
        text-align: center !important;
        position: absolute !important;
        top: 5% !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: rgba(0, 0, 0, 0.85) !important;
        padding: 1.2rem 2rem !important;
        border-radius: 16px !important;
        backdrop-filter: blur(12px) !important;
        z-index: 10000 !important;
        font-size: 1.4rem !important;
        font-weight: 800 !important;
        color: #ffffff !important;
        border: 2px solid rgba(99, 102, 241, 0.6) !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6) !important;
        max-width: 85% !important;
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
        (video as HTMLElement).style.transform = 'translateY(-20px)';
        (video as HTMLElement).style.objectPosition = 'center center';
      });

      const canvases = container.querySelectorAll('canvas');
      canvases.forEach(canvas => {
        (canvas as HTMLElement).style.marginTop = '-2rem';
        (canvas as HTMLElement).style.transform = 'translateY(-20px)';
        (canvas as HTMLElement).style.objectPosition = 'center center';
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

      // Remover elipse/oval do amplify (chamada inicial)
      this.hideOvalElements();
      
      // Também remover após um delay para garantir
      setTimeout(() => {
        this.hideOvalElements();
      }, 2000);

      // Centralizar elipse/oval/SVG com a câmera
      const svgs = container.querySelectorAll('svg');
      svgs.forEach(svg => {
        const htmlEl = svg as unknown as HTMLElement;
        htmlEl.style.position = 'absolute';
        htmlEl.style.top = '50%';
        htmlEl.style.left = '50%';
        htmlEl.style.transform = 'translate(-50%, -50%)';
        htmlEl.style.zIndex = '1000';
        htmlEl.style.pointerEvents = 'none';
        htmlEl.style.margin = '0';
      });

      // Centralizar elementos com classes relacionadas a elipse/oval
      const ellipseElements = container.querySelectorAll('[class*="ellipse"], [class*="Ellipse"], [class*="oval"], [class*="Oval"], [class*="guide"], [class*="Guide"]');
      ellipseElements.forEach(el => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.position = 'absolute';
        htmlEl.style.top = '50%';
        htmlEl.style.left = '50%';
        htmlEl.style.transform = 'translate(-50%, -50%)';
        htmlEl.style.zIndex = '1000';
        htmlEl.style.pointerEvents = 'none';
        htmlEl.style.margin = '0';
      });

      // Centralizar textos
      const textElements = container.querySelectorAll('p, span, div');
      textElements.forEach(el => {
        if (el.tagName !== 'VIDEO' && el.tagName !== 'CANVAS' && el.tagName !== 'SVG' && 
            !el.classList.toString().includes('ellipse') && 
            !el.classList.toString().includes('oval') &&
            !el.classList.toString().includes('guide')) {
          const htmlEl = el as HTMLElement;
          if (htmlEl.textContent && htmlEl.textContent.trim().length > 0) {
            htmlEl.style.textAlign = 'center';
            htmlEl.style.position = 'absolute';
            htmlEl.style.top = '5%';
            htmlEl.style.left = '50%';
            htmlEl.style.transform = 'translateX(-50%)';
            htmlEl.style.background = 'rgba(0, 0, 0, 0.85)';
            htmlEl.style.padding = '1.2rem 2rem';
            htmlEl.style.borderRadius = '16px';
            htmlEl.style.zIndex = '10000';
            htmlEl.style.fontSize = '1.4rem';
            htmlEl.style.fontWeight = '800';
            htmlEl.style.color = '#ffffff';
            htmlEl.style.maxWidth = '85%';
          }
        }
      });
    }, 500);
  }

  private async initLocalWidget(sessionId: string): Promise<void> {
    const container = document.getElementById('liveness-container-official');
    if (!container) {
      throw new Error('Container do widget não encontrado.');
    }

    // Limpar container
    container.innerHTML = '';

    // Criar elemento do widget local
    const widgetElement = document.createElement('face-liveness-widget');
    widgetElement.setAttribute('session-id', sessionId);
    widgetElement.setAttribute('region', this.awsRegion);
    widgetElement.setAttribute('create-session-url', this.createSessionUrl);
    widgetElement.setAttribute('results-url', this.resultsUrl);
    
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
    this.statusMessage.set('Verificação concluída. Processando resultados...');

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
          localLivenessScore: livenessResult.confidenceScore
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
          observacao: backendAnalysis.observacao
        });
      }

      // 3. Fazer match adicional com todas as audit images
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

  handleReviewFinished(): void {
    // Salvar no histórico e fechar
    const result = this.livenessResult();
    if (result) {
      const backendAnalysis = result.raw?.backendAnalysis;
      const documentScore = this.documentScore() || backendAnalysis?.documentScore || null;
      
      const summary: LivenessSummary = {
        sessionId: result.sessionId,
        createdAt: new Date().toISOString(),
        isLive: result.confidenceScore >= 70,
        livenessScore: result.confidenceScore,
        faceMatchScore: result.raw?.matchResult?.bestMatchScore,
        status: this.determineStatus(result),
        documentKey: this.documentKey() || undefined, // Salvar documentKey para histórico
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
          ...(backendAnalysis ? { backendAnalysis: JSON.stringify(backendAnalysis) } : {}) // Salvar análise apenas se existir
        },
        backendAnalysis: backendAnalysis ? {
          documentScore: documentScore || undefined,
          matchScore: backendAnalysis.matchScore || undefined,
          identityScore: backendAnalysis.identityScore || undefined,
          observacao: backendAnalysis.observacao || undefined,
          message: backendAnalysis.message || undefined,
          status: backendAnalysis.status || undefined
        } : undefined
      };

      this.lastSummary.set(summary);
      this.historyService.addEntry(summary);
    }

    this.closeModal();
  }

  private determineStatus(result: LivenessResult): 'Aprovado' | 'Rejeitado' | 'Revisar' {
    const livenessScore = result.confidenceScore;
    const matchScore = result.raw?.matchResult?.bestMatchScore || 0;
    const finalScore = result.raw?.matchResult?.finalScore || livenessScore;

    if (livenessScore >= 90 && matchScore >= 80 && finalScore >= 85) {
      return 'Aprovado';
    } else if (livenessScore < 70 || matchScore < 50 || finalScore < 60) {
      return 'Rejeitado';
    } else {
      return 'Revisar';
    }
  }

  private destroyWidget(): void {
    // Parar observer da elipse
    this.stopOvalObserver();

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
  }
}

