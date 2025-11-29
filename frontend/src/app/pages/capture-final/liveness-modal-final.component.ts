import { Component, EventEmitter, Output, Input, signal, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LivenessService } from '../../services/liveness.service';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Amplify } from 'aws-amplify';
import awsExports from '../../../aws-exports';

// Declaração do widget AWS Face Liveness (conforme aws-widget.component.ts)
declare var AwsLiveness: any;
declare const FaceLiveness: any; // Fallback para V2

// Configurar Amplify
if (typeof Amplify !== 'undefined') {
  try {
    Amplify.configure(awsExports);
  } catch (error) {
    console.warn('[Liveness Modal Final] Amplify já configurado:', error);
  }
}

export interface LivenessResult {
  sessionId: string;
  confidence: number;
  status: 'LIVE' | 'FAKE';
  auditImages?: Array<{ bucket: string; key: string; url?: string }>;
}

@Component({
  selector: 'app-liveness-modal-final',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './liveness-modal-final.component.html',
  styleUrls: ['./liveness-modal-final.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class LivenessModalFinalComponent implements OnDestroy, OnChanges {
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() complete = new EventEmitter<LivenessResult>();
  @Output() error = new EventEmitter<string>();

  readonly isLoading = signal<boolean>(false);
  readonly statusMessage = signal<string>('');
  readonly errorMessage = signal<string | null>(null);
  readonly useLocalWidget = signal(false);
  
  // Sinais para controle de proximidade e instruções
  readonly proximityLevel = signal<number>(50);
  readonly proximityMessage = signal<string>('Posicione seu rosto');
  readonly instructionMessage = signal<string>('Centralize seu rosto na elipse');
  readonly instructionIcon = signal<string>('👤');
  private proximityMonitorInterval: any = null;
  private readonly PROXIMITY_CHECK_INTERVAL = 300; // ms
  
  // Sinais para arquitetura híbrida (flash e oval custom)
  readonly isFlashActive = signal<boolean>(false);
  readonly isOvalVisible = signal<boolean>(false);
  private flashTimeout: any = null;

  private widgetInstance: any = null;
  private localWidgetListeners: { onComplete?: (e: Event) => void; onError?: (e: Event) => void } = {};
  private videoObserver: MutationObserver | null = null;
  private overlayObserver: MutationObserver | null = null;
  private awsWidgetObserver: MutationObserver | null = null;
  sessionId = '';
  readonly awsRegion = environment.aws?.region || 'us-east-1';
  readonly createSessionUrl: string = `${environment.apiUrl}/liveness/start`;
  readonly resultsUrl: string = `${environment.apiUrl}/liveness/results`;
  readonly identityPoolId: string = environment.aws?.identityPoolId || '';

  constructor(private readonly livenessService: LivenessService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      this.toggleBodyOverflow(this.isOpen);
    }
  }

  private overlayElement: HTMLElement | null = null;

  ngAfterViewInit(): void {
    // Se já foi solicitado o início, iniciar agora
    // ...
    
    // Mover overlay para o body para garantir z-index máximo
    // Usar setTimeout para garantir que o DOM foi renderizado
    setTimeout(() => {
      this.moveOverlayToBody();
      this.ensureOverlayVisible();
    }, 100);
    
    // Observer para detectar quando o overlay é adicionado ao DOM
    this.setupOverlayObserver();
    
    // Verificar periodicamente se o overlay foi renderizado
    const checkInterval = setInterval(() => {
      const overlay = document.querySelector('.aws-liveness-overlay');
      if (overlay) {
        this.moveOverlayToBody();
        this.ensureOverlayVisible();
        clearInterval(checkInterval);
      }
    }, 200);
    
    // Limpar intervalo após 5 segundos
    setTimeout(() => clearInterval(checkInterval), 5000);
  }
  
  private setupOverlayObserver(): void {
    // Observar mudanças no DOM para detectar quando o overlay é adicionado
    this.overlayObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            // Verificar se o nó adicionado é o overlay ou contém o overlay
            if (element.classList?.contains('aws-liveness-overlay')) {
              setTimeout(() => {
                this.moveOverlayToBody();
                this.ensureOverlayVisible();
              }, 50);
            } else {
              // Verificar se algum filho é o overlay
              const overlay = element.querySelector?.('.aws-liveness-overlay');
              if (overlay) {
                setTimeout(() => {
                  this.moveOverlayToBody();
                  this.ensureOverlayVisible();
                }, 50);
              }
            }
          }
        });
      });
    });
    
    // Observar o modal-content onde o overlay é renderizado
    const modalContent = document.querySelector('.modal-content');
    if (modalContent) {
      this.overlayObserver.observe(modalContent, {
        childList: true,
        subtree: true
      });
    }
    
    // Também observar o body caso o overlay seja adicionado diretamente
    this.overlayObserver.observe(document.body, {
      childList: true,
      subtree: false
    });
  }

  ngOnDestroy(): void {
    this.toggleBodyOverflow(false);
    this.stopProximityMonitoring();
    this.removeOverlayFromBody();
    this.cleanup();
    this.removeLocalWidgetListeners();
    if (this.videoObserver) {
      this.videoObserver.disconnect();
      this.videoObserver = null;
    }
    if (this.overlayObserver) {
      this.overlayObserver.disconnect();
      this.overlayObserver = null;
    }
    if (this.awsWidgetObserver) {
      this.awsWidgetObserver.disconnect();
      this.awsWidgetObserver = null;
    }
  }

  private moveOverlayToBody(): void {
    const overlay = document.querySelector('.aws-liveness-overlay') as HTMLElement;
    if (overlay) {
      if (overlay.parentElement !== document.body) {
        this.overlayElement = overlay;
        document.body.appendChild(this.overlayElement);
        console.log('[Liveness Modal Final] ✅ Overlay movido para o body');
      }
      // Garantir que está visível mesmo se já estiver no body
      this.ensureOverlayVisible();
    } else {
      console.warn('[Liveness Modal Final] ⚠️ Overlay não encontrado para mover para o body');
    }
  }

  private removeOverlayFromBody(): void {
    if (this.overlayElement && document.body.contains(this.overlayElement)) {
      document.body.removeChild(this.overlayElement);
      this.overlayElement = null;
    } else {
      // Fallback caso a referência tenha sido perdida
      const overlays = document.querySelectorAll('body > .aws-liveness-overlay');
      overlays.forEach(el => el.remove());
    }
  }

  /**
   * Controla overflow do body - permite scroll
   */
  private toggleBodyOverflow(open: boolean): void {
    if (typeof document !== 'undefined') {
      // Permite scroll na modal
      document.body.style.overflow = '';
    }
  }

  /**
   * Inicia o processo de liveness (direto para widget)
   */
  async startLiveness(): Promise<void> {
    await this.initializeWidget();
  }

  /**
   * Inicializa o widget AWS Face Liveness conforme guia aws-widget.component.ts
   */
  private async initializeWidget(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.errorMessage.set(null);
      this.statusMessage.set('Criando sessão...');

      // Criar sessão no backend diretamente
      let sessionResponse: any;
      try {
        sessionResponse = await firstValueFrom(this.livenessService.createSession());
      } catch (httpError: any) {
        console.error('[Liveness Modal Final] Erro HTTP ao criar sessão:', httpError);
        
        if (httpError?.status === 404) {
          throw new Error(
            `Endpoint não encontrado (404).\n\n` +
            `URL tentada: ${environment.apiUrl}/liveness/start\n\n` +
            `Verifique:\n` +
            `1. Backend está rodando em ${environment.apiUrl}?\n` +
            `2. O controller LivenessController está registrado?\n` +
            `3. Reinicie o backend se necessário`
          );
        } else if (httpError?.status === 0) {
          throw new Error(
            `Não foi possível conectar ao backend.\n\n` +
            `URL: ${environment.apiUrl}\n\n` +
            `Possíveis causas:\n` +
            `1. Backend não está rodando\n` +
            `2. CORS não está configurado\n` +
            `3. Certificado SSL inválido (se usar HTTPS)`
          );
        } else {
          throw new Error(`Erro ao criar sessão: ${httpError?.message || httpError?.error?.message || 'Erro desconhecido'} (Status: ${httpError?.status || 'N/A'})`);
        }
      }

      if (!sessionResponse?.sessionId) {
        throw new Error('Falha ao criar sessão AWS Liveness: sessionId não retornado');
      }

      this.sessionId = sessionResponse.sessionId;
      this.statusMessage.set('Sessão criada. Carregando widget...');
      
      // Aguardar renderização do overlay e movê-lo para o body
      setTimeout(() => {
        this.moveOverlayToBody();
        this.ensureOverlayVisible();
      }, 100);

      // Aguardar widget estar disponível
      let attempts = 0;
      const maxAttempts = 10;
      const checkInterval = 200;
      while (typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        attempts++;
        if (attempts % 3 === 0) {
          this.statusMessage.set(`Aguardando widget carregar... (${attempts}/${maxAttempts})`);
        }
      }

      // Tentar carregar widget local se os externos falharam
      if (typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') {
        this.statusMessage.set('Tentando carregar widget local...');
        await this.loadLocalWidget();
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      if (typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') {
        // Tentar usar widget local como fallback
        this.statusMessage.set('Usando widget local...');
        this.useLocalWidget.set(true);
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verificar se widget custom está disponível
        const customWidgetAvailable = customElements.get('face-liveness-widget') !== undefined;
        
        if (!customWidgetAvailable) {
          await this.loadLocalWidget();
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        if (!customElements.get('face-liveness-widget')) {
          console.warn('[Liveness Modal Final] Widget local não encontrado, mas continuando...');
        }
      }

      // Inicializar widget (só se não estiver usando widget local)
      if (!this.useLocalWidget()) {
        await this.initWidget(this.sessionId);
      } else {
        // Verificar se Identity Pool ID está configurado
        if (!this.identityPoolId) {
          throw new Error(
            'Identity Pool ID não está configurado.\n\n' +
            'Configure o Identity Pool ID em environment.ts:\n' +
            'aws: { identityPoolId: "seu-identity-pool-id" }'
          );
        }

        // Garantir que AWS SDK está disponível
        const awsSdk = (window as any).AWS;
        if (!awsSdk) {
          throw new Error(
            'AWS SDK não está disponível.\n\n' +
            'Verifique se o script aws-sdk está carregado no index.html'
          );
        }

        // Garantir que Amplify está disponível no window
        try {
          const windowAmplify = (window as any).Amplify || (globalThis as any).Amplify;
          
          if (!windowAmplify) {
            if (typeof Amplify !== 'undefined') {
              (window as any).Amplify = Amplify;
              (globalThis as any).Amplify = Amplify;
              console.log('[Liveness Modal Final] Amplify exportado para window');
            } else {
              throw new Error('Amplify não está disponível. Verifique se aws-amplify está instalado.');
            }
          }

          const amplifyToUse = windowAmplify || Amplify;
          
          try {
            amplifyToUse.configure({
              Auth: {
                Cognito: {
                  identityPoolId: this.identityPoolId,
                  allowGuestAccess: true,
                }
              }
            });
            console.log('[Liveness Modal Final] Amplify configurado para widget local');
          } catch (configError: any) {
            if (configError?.message?.includes('already configured')) {
              console.log('[Liveness Modal Final] Amplify já estava configurado');
            } else {
              console.warn('[Liveness Modal Final] Erro ao configurar Amplify:', configError);
            }
          }
        } catch (amplifyError: any) {
          throw new Error(
            'Erro ao configurar AWS Amplify.\n\n' +
            `Detalhes: ${amplifyError?.message || 'Erro desconhecido'}\n\n` +
            'Verifique:\n' +
            '1. Se aws-amplify está instalado (npm install aws-amplify)\n' +
            '2. Se o Identity Pool ID está correto\n' +
            '3. Se as permissões IAM estão configuradas corretamente'
          );
        }

        this.statusMessage.set('Widget local carregado. Aguardando verificação...');
        
        // Log das URLs configuradas para debug
        console.log('[Liveness Modal Final] URLs configuradas para widget local:', {
          createSessionUrl: this.createSessionUrl,
          resultsUrl: this.resultsUrl,
          sessionId: this.sessionId,
          identityPoolId: this.identityPoolId
        });
        
        this.setupLocalWidgetListeners();
        
        setTimeout(() => {
          this.applyVideoMirror();
        }, 500);
      }

      this.statusMessage.set('Widget carregado. Aguardando verificação...');
      this.isLoading.set(false);

      // Verificar periodicamente se o widget iniciou automaticamente
      this.checkWidgetStatus();
      
      // Iniciar monitoramento de proximidade
      this.startProximityMonitoring();
    } catch (error: any) {
      console.error('[Liveness Modal Final] Erro ao inicializar:', error);
      const errorMsg = error?.message || error?.error?.message || 'Erro ao inicializar widget AWS';
      this.errorMessage.set(errorMsg);
      this.statusMessage.set('Erro ao inicializar');
      this.isLoading.set(false);
      this.error.emit(errorMsg);
    }
  }

  /**
   * Inicializa o widget oficial AWS Face Liveness V2 no container
   * Arquitetura Híbrida: widget no container invisível, eventos replicados na UI custom
   */
  private async initWidget(sessionId: string): Promise<void> {
    // Container invisível para o widget AWS (arquitetura híbrida)
    const hiddenContainer = document.getElementById('aws-liveness-hidden');
    const visibleContainer = document.getElementById('aws-liveness-container-final');
    
    if (!hiddenContainer) {
      throw new Error('Container invisível do widget não encontrado.');
    }
    
    if (!visibleContainer) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const containerRetry = document.getElementById('aws-liveness-container-final');
      if (!containerRetry) {
        throw new Error('Container visível do widget não encontrado.');
      }
    }

    // Limpar widget anterior se existir
    this.destroyWidget();

    try {
      // Inicializar widget conforme aws-widget.component.ts
      const WidgetClass = typeof AwsLiveness !== 'undefined' ? AwsLiveness : FaceLiveness;
      
      if (!WidgetClass) {
        throw new Error('Classe do widget não encontrada');
      }

      this.widgetInstance = new WidgetClass({
        sessionId,
        region: environment.aws?.region || 'us-east-1',
        preset: typeof FaceLiveness !== 'undefined' ? 'faceMovementAndLight' : undefined,
        onError: (err: any) => {
          console.error('[Liveness Modal Final] Erro no widget:', err);
          this.errorMessage.set(err?.message || 'Erro no widget AWS');
          this.statusMessage.set('Erro durante a verificação');
          this.error.emit(err?.message || 'Erro no widget AWS');
        },
        onComplete: async (result: any) => {
          console.log('[Liveness Modal Final] Resultado do widget:', result);
          this.statusMessage.set('Processando resultado...');
          await this.handleComplete(result);
        },
        onUserCancellation: () => {
          console.log('[Liveness Modal Final] Usuário cancelou');
          this.statusMessage.set('Verificação cancelada pelo usuário');
          this.handleCancel();
        },
        onAnalysisComplete: (data: any) => {
          console.log('[Liveness Modal Final] Análise completa:', data);
        }
      });
      
      // Arquitetura Híbrida: observar DOM do widget AWS para detectar flash e estados
      this.setupAWSWidgetObserver();

      // Renderizar no container visível (widget AWS precisa de container visível)
      // Mas a UI custom fica por cima através do z-index
      const visibleContainer = document.getElementById('aws-liveness-container-final');
      if (typeof AwsLiveness !== 'undefined') {
        console.log('[Liveness Modal Final] Renderizando widget AwsLiveness no container visível');
        this.widgetInstance.render('#aws-liveness-container-final');
      } else {
        console.log('[Liveness Modal Final] Renderizando widget FaceLiveness V2 no container visível');
        this.widgetInstance.render(visibleContainer);
      }

      // Aplicar transformação de espelhamento nos vídeos
      this.applyVideoMirror();
      this.ensureOverlayVisible();
      this.checkAndStartWidget();
      
      setTimeout(() => {
        this.applyVideoMirror();
        this.ensureOverlayVisible();
        this.checkAndStartWidget();
      }, 500);
      setTimeout(() => {
        this.applyVideoMirror();
        this.ensureOverlayVisible();
        this.checkAndStartWidget();
      }, 1000);
      setTimeout(() => {
        this.applyVideoMirror();
        this.ensureOverlayVisible();
        this.checkAndStartWidget();
      }, 2000);

      // Tentar clicar no botão interno do widget após carregar
      setTimeout(() => {
        this.clickWidgetStartButton();
        this.ensureOverlayVisible();
        this.checkAndStartWidget();
      }, 1000);
      setTimeout(() => {
        this.clickWidgetStartButton();
        this.ensureOverlayVisible();
        this.checkAndStartWidget();
      }, 2500);
      setTimeout(() => {
        this.clickWidgetStartButton();
        this.ensureOverlayVisible();
        this.checkAndStartWidget();
      }, 4000);
    } catch (err: any) {
      console.error('[Liveness Modal Final] Erro ao renderizar widget:', err);
      throw new Error(`Erro ao renderizar widget: ${err?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Garante que o overlay com flash (gradientes) esteja visível
   */
  private ensureOverlayVisible(): void {
    // Buscar overlay (agora está fora do modal, no mesmo nível ou no body)
    let overlay = document.querySelector('.aws-liveness-overlay') as HTMLElement;
    
    // Se não encontrar, garantir que todos os elementos do widget AWS tenham z-index menor
    if (overlay) {
      // Mover para o body se não estiver lá
      if (overlay.parentElement !== document.body) {
        document.body.appendChild(overlay);
        this.overlayElement = overlay;
      }

      // Forçar overlay para ficar acima de tudo
      overlay.style.setProperty('position', 'fixed', 'important');
      overlay.style.setProperty('z-index', '2147483647', 'important');
      overlay.style.setProperty('top', '0', 'important');
      overlay.style.setProperty('left', '0', 'important');
      overlay.style.setProperty('width', '100vw', 'important');
      overlay.style.setProperty('height', '100vh', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
      overlay.style.setProperty('isolation', 'auto', 'important');
      
      // Garantir que todos os elementos do widget AWS tenham z-index menor
      const container = document.getElementById('aws-liveness-container-final');
      if (container) {
        const allElements = container.querySelectorAll('*');
        allElements.forEach((el: any) => {
          if (el !== overlay && !overlay.contains(el)) {
            const currentZ = window.getComputedStyle(el).zIndex;
            if (currentZ && parseInt(currentZ) > 10000) {
              (el as HTMLElement).style.setProperty('z-index', '5000', 'important');
            }
          }
        });
      }
    }
    
    if (overlay) {
      overlay.style.setProperty('display', 'block', 'important');
      overlay.style.setProperty('visibility', 'visible', 'important');
      overlay.style.setProperty('opacity', '1', 'important');
      overlay.style.setProperty('z-index', '2147483647', 'important'); // Z-index MÁXIMO do CSS (2^31-1)
      overlay.style.setProperty('position', 'fixed', 'important'); // Fixed para cobrir tudo
      overlay.style.setProperty('top', '0', 'important');
      overlay.style.setProperty('left', '0', 'important');
      overlay.style.setProperty('width', '100vw', 'important');
      overlay.style.setProperty('height', '100vh', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
      overlay.style.setProperty('isolation', 'auto', 'important'); // Não criar contexto isolado
      
      const leftGradient = overlay.querySelector('.left-gradient') as HTMLElement;
      const rightGradient = overlay.querySelector('.right-gradient') as HTMLElement;
      
      if (leftGradient) {
        leftGradient.style.setProperty('display', 'block', 'important');
        leftGradient.style.setProperty('visibility', 'visible', 'important');
        leftGradient.style.setProperty('opacity', '1'); // Opacidade controlada pela cor rgba
        leftGradient.style.setProperty('z-index', '2147483647', 'important'); // Z-index MÁXIMO
        leftGradient.style.setProperty('position', 'absolute', 'important');
        leftGradient.style.setProperty('left', '0', 'important');
        leftGradient.style.setProperty('top', '0', 'important');
        leftGradient.style.setProperty('width', '50%', 'important');
        leftGradient.style.setProperty('height', '100%', 'important');
        leftGradient.style.setProperty('background', 'linear-gradient(to bottom, rgba(255, 0, 255, 0.6), rgba(255, 0, 102, 0.6))', 'important');
        leftGradient.style.setProperty('mix-blend-mode', 'normal', 'important'); // Normal para aparecer sobre branco
        leftGradient.style.setProperty('animation', 'flashPulse 2s ease-in-out infinite', 'important');
      }
      
      if (rightGradient) {
        rightGradient.style.setProperty('display', 'block', 'important');
        rightGradient.style.setProperty('visibility', 'visible', 'important');
        rightGradient.style.setProperty('opacity', '1'); // Opacidade controlada pela cor rgba
        rightGradient.style.setProperty('z-index', '2147483647', 'important'); // Z-index MÁXIMO
        rightGradient.style.setProperty('position', 'absolute', 'important');
        rightGradient.style.setProperty('right', '0', 'important');
        rightGradient.style.setProperty('top', '0', 'important');
        rightGradient.style.setProperty('width', '50%', 'important');
        rightGradient.style.setProperty('height', '100%', 'important');
        rightGradient.style.setProperty('background', 'linear-gradient(to bottom, rgba(255, 204, 0, 0.6), rgba(255, 0, 0, 0.6))', 'important');
        rightGradient.style.setProperty('mix-blend-mode', 'normal', 'important'); // Normal para aparecer sobre branco
        rightGradient.style.setProperty('animation', 'flashPulse 2s ease-in-out infinite', 'important');
      }
      
      console.log('[Liveness Modal Final] ✅ Overlay do flash configurado e visível');
    } else {
      console.warn('[Liveness Modal Final] ⚠️ Overlay do flash não encontrado');
    }
  }

  /**
   * Aplica espelhamento nos vídeos do widget (corrigir inversão da câmera)
   * E garante que a elipse fique na frente do vídeo
   */
  private applyVideoMirror(): void {
    let container = document.getElementById('aws-liveness-container-final');
    
    if (!container) {
      container = document.querySelector('.local-widget-container') as HTMLElement;
    }
    
    if (!container) {
      const widget = document.querySelector('face-liveness-widget');
      if (widget && widget.parentElement) {
        container = widget.parentElement as HTMLElement;
      }
    }
    
    if (!container) {
      console.warn('[Liveness Modal Final] Container não encontrado para aplicar espelhamento');
      return;
    }

    const applyMirrorToVideos = () => {
      // Encontrar todos os vídeos dentro do container
      const allVideos = container.querySelectorAll('video');
      allVideos.forEach((element) => {
        const video = element as HTMLVideoElement;
        if (video && video instanceof HTMLVideoElement) {
          // Centralizar e espelhar vídeo
          video.style.setProperty('position', 'absolute', 'important');
          video.style.setProperty('top', '50%', 'important');
          video.style.setProperty('left', '50%', 'important');
          video.style.setProperty('transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          video.style.setProperty('-webkit-transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          video.style.setProperty('width', '100%', 'important');
          video.style.setProperty('height', '100%', 'important');
          video.style.setProperty('object-fit', 'cover', 'important');
          video.style.setProperty('object-position', 'center', 'important');
          video.style.setProperty('z-index', '1', 'important');
          video.setAttribute('data-mirrored', 'true');
        }
      });

      // Também aplicar em canvas se houver
      const allCanvases = container.querySelectorAll('canvas');
      allCanvases.forEach((element) => {
        const canvas = element as HTMLCanvasElement;
        if (canvas && canvas instanceof HTMLCanvasElement) {
          canvas.style.setProperty('position', 'absolute', 'important');
          canvas.style.setProperty('top', '50%', 'important');
          canvas.style.setProperty('left', '50%', 'important');
          canvas.style.setProperty('transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          canvas.style.setProperty('z-index', '1', 'important');
          canvas.setAttribute('data-mirrored', 'true');
        }
      });

      // Garantir que SVG (elipse) fique centralizado e na frente (z-index máximo)
      const allSvgs = container.querySelectorAll('svg');
      allSvgs.forEach((svg) => {
        const svgStyle = window.getComputedStyle(svg);
        const svgFill = svgStyle.fill || '';
        const svgStroke = svgStyle.stroke || '';
        const svgContent = svg.innerHTML || '';
        
        // Ocultar SVGs pretos (máscaras de elipse preto)
        if (svgFill === 'rgb(0, 0, 0)' || 
            svgFill === '#000000' || 
            svgFill === 'black' ||
            svgStroke === 'rgb(0, 0, 0)' ||
            svgContent.includes('fill="#000') ||
            svgContent.includes('fill="black')) {
          svg.style.setProperty('display', 'none', 'important');
          svg.style.setProperty('opacity', '0', 'important');
          svg.style.setProperty('visibility', 'hidden', 'important');
          return;
        }
        
        svg.style.setProperty('position', 'absolute', 'important');
        svg.style.setProperty('top', '50%', 'important');
        svg.style.setProperty('left', '50%', 'important');
        svg.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
        svg.style.setProperty('z-index', '1000', 'important');
        svg.style.setProperty('pointer-events', 'none', 'important');
      });
    };

    // Aplicar imediatamente
    applyMirrorToVideos();

    // Aplicar novamente após delays
    setTimeout(applyMirrorToVideos, 500);
    setTimeout(applyMirrorToVideos, 1000);

    // Observar mudanças no DOM
    if (this.videoObserver) {
      this.videoObserver.disconnect();
    }
    
    let clickAttempts = 0;
    const maxClickAttempts = 10;
    
    this.videoObserver = new MutationObserver(() => {
      applyMirrorToVideos();
      this.ensureOverlayVisible(); // Garantir que overlay apareça
      
      if (clickAttempts < maxClickAttempts) {
        clickAttempts++;
        setTimeout(() => {
          this.clickWidgetStartButton();
        }, 200);
      }
    });

    this.videoObserver.observe(container, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Verifica o status do widget periodicamente
   */
  private checkWidgetStatus(): void {
    const checkInterval = setInterval(() => {
      let container = document.getElementById('aws-liveness-container-final');
      if (!container) {
        container = document.querySelector('.local-widget-container') as HTMLElement;
      }
      
      if (!container) {
        return;
      }
      
      // Garantir que overlay apareça
      this.ensureOverlayVisible();

      // Verificar se há vídeo rodando
      const videos = container.querySelectorAll('video');
      if (videos.length > 0) {
        const video = videos[0] as HTMLVideoElement;
        if (video && !video.paused && video.readyState >= 2) {
          console.log('[Liveness Modal Final] ✅ Widget iniciou automaticamente - vídeo está rodando');
          this.statusMessage.set('Verificação em andamento. Siga as instruções na tela.');
          this.ensureOverlayVisible(); // Garantir overlay quando vídeo iniciar
          clearInterval(checkInterval);
          return;
        }
      }

      // Verificar se há botão disponível
      const buttons = container.querySelectorAll('button');
      if (buttons.length > 0) {
        this.clickWidgetStartButton();
        this.ensureOverlayVisible(); // Garantir overlay quando botão aparecer
      }
    }, 1000);

    // Limpar após 20 segundos
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 20000);
  }

  /**
   * Verifica se o widget tem método de início e tenta iniciar
   */
  private checkAndStartWidget(): void {
    try {
      if (!this.widgetInstance) {
        return;
      }

      const methods = ['start', 'begin', 'init', 'run', 'execute'];
      for (const method of methods) {
        if (typeof (this.widgetInstance as any)[method] === 'function') {
          console.log(`[Liveness Modal Final] Tentando iniciar widget com método: ${method}`);
          try {
            (this.widgetInstance as any)[method]();
            this.statusMessage.set('Verificação iniciada.');
            return;
          } catch (err) {
            console.warn(`[Liveness Modal Final] Método ${method} falhou:`, err);
          }
        }
      }
    } catch (error: any) {
      console.warn('[Liveness Modal Final] Erro ao verificar métodos do widget:', error);
    }
  }

  /**
   * Clica no botão interno do widget AWS para iniciar a verificação
   */
  clickWidgetStartButton(): void {
    try {
      let container = document.getElementById('aws-liveness-container-final');
      if (!container) {
        container = document.querySelector('.local-widget-container') as HTMLElement;
      }
      
      if (!container) {
        return;
      }

      // Tentar encontrar widget local primeiro
      const localWidget = document.querySelector('face-liveness-widget') as any;
      if (localWidget) {
        const shadowRoot = localWidget.shadowRoot;
        if (shadowRoot) {
          const buttons = shadowRoot.querySelectorAll('button');
          
          const startButton = Array.from(buttons).find((btn: any) => {
            const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            
            const isCancelButton = text.includes('cancel') || 
                                  text.includes('cancelar') ||
                                  text.includes('close') ||
                                  text.includes('fechar');
            
            if (isCancelButton) return false;
            
            return text.includes('iniciar') || 
                   text.includes('start') ||
                   text.includes('verificação') ||
                   ariaLabel.includes('start');
          }) as HTMLButtonElement | undefined;

          if (startButton && !startButton.disabled) {
            startButton.click();
            this.statusMessage.set('Verificação iniciada. Siga as instruções na tela.');
            return;
          }
        }
      }

      // Tentar encontrar botão no container do widget oficial AWS
      const buttons = container.querySelectorAll('button');
      const startButton = Array.from(buttons).find((btn: any) => {
        const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        
        const isCancelButton = text.includes('cancel') || 
                              text.includes('cancelar') ||
                              text.includes('close');
        
        if (isCancelButton) return false;
        
        return text.includes('iniciar') || 
               text.includes('start') ||
               text.includes('verificação') ||
               ariaLabel.includes('start');
      }) as HTMLButtonElement | undefined;

      if (startButton && !startButton.disabled) {
        startButton.click();
        this.statusMessage.set('Verificação iniciada. Siga as instruções na tela.');
        return;
      }

      // Verificar se o widget já iniciou automaticamente
    const videos = container.querySelectorAll('video');
      if (videos.length > 0) {
        const video = videos[0] as HTMLVideoElement;
        if (video && !video.paused) {
          this.statusMessage.set('Verificação em andamento. Siga as instruções na tela.');
          return;
        }
      }
    } catch (error: any) {
      console.warn('[Liveness Modal Final] Erro ao tentar clicar no botão do widget:', error);
    }
  }

  /**
   * Callback quando o widget completa a verificação
   */
  private async handleComplete(result: any): Promise<void> {
    console.log('[Liveness Modal Final] Widget completo:', result);
    this.statusMessage.set('Processando resultados...');

    try {
      const awsResults = await firstValueFrom(this.livenessService.getResult(this.sessionId));
      
      if (!awsResults) {
        throw new Error('Resultados não disponíveis');
      }

      const livenessResult: LivenessResult = {
        sessionId: this.sessionId,
        confidence: (awsResults.confidence || 0) * 100,
        status: awsResults.livenessDecision === 'LIVE' ? 'LIVE' : 'FAKE',
        auditImages: []
      };

      if (awsResults.auditImageUrls && Array.isArray(awsResults.auditImageUrls)) {
        const bucket = environment.aws?.bucket || 'dayfusion-docs';
        awsResults.auditImageUrls.forEach((url: string, index: number) => {
          const key = `liveness/${this.sessionId}/audit_${index}.jpg`;
          livenessResult.auditImages?.push({ bucket, key, url });
        });
      }

      this.complete.emit(livenessResult);
      this.cleanup();

    } catch (err: any) {
      console.error('[Liveness Modal Final] Erro ao processar resultados:', err);
      this.errorMessage.set('Erro ao processar resultados');
      this.error.emit('Erro ao processar resultados');
    }
  }

  /**
   * Callback quando ocorre erro no widget
   */
  private handleError(err: any): void {
    console.error('[Liveness Modal Final] Erro no widget:', err);
    this.errorMessage.set(err?.message || 'Erro durante verificação');
    this.error.emit(err?.message || 'Erro durante verificação');
  }

  /**
   * Callback quando usuário cancela
   */
  private handleCancel(): void {
    console.log('[Liveness Modal Final] Usuário cancelou');
    this.closeModal();
  }

  /**
   * Fecha o modal
   */
  closeModal(): void {
    this.close.emit();
    this.cleanup();
  }

  /**
   * Tenta carregar o widget local
   */
  private async loadLocalWidget(): Promise<void> {
    try {
      if (document.querySelector('script[src="/assets/liveness/widget.js"]')) {
        return;
      }

      const script = document.createElement('script');
      script.src = '/assets/liveness/widget.js';
      script.type = 'text/javascript';
      script.async = true;
      
      await new Promise<void>((resolve, reject) => {
        script.onload = () => {
          console.log('[Liveness Modal Final] Widget local carregado com sucesso');
          resolve();
        };
        script.onerror = () => {
          console.warn('[Liveness Modal Final] Falha ao carregar widget local');
          reject(new Error('Widget local não encontrado'));
        };
        document.head.appendChild(script);
      });
    } catch (error) {
      console.warn('[Liveness Modal Final] Erro ao carregar widget local:', error);
    }
  }

  /**
   * Configura listeners para eventos do widget local
   */
  private setupLocalWidgetListeners(): void {
    const onLivenessComplete = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('[Liveness Modal Final] Widget local completou:', customEvent.detail);
      
      if (this.sessionId) {
        this.handleComplete(customEvent.detail);
      }
    };

    const onLivenessError = (event: Event) => {
      const customEvent = event as CustomEvent;
      const errorDetail = customEvent.detail;
      
      console.error('[Liveness Modal Final] Erro no widget local:', errorDetail);
      
      // Extrair mensagem de erro de forma mais robusta
      let errorMessage = 'Erro no widget local';
      
      if (errorDetail) {
        if (typeof errorDetail === 'string') {
          errorMessage = errorDetail;
        } else if (errorDetail.message) {
          errorMessage = errorDetail.message;
        } else if (errorDetail.error) {
          errorMessage = errorDetail.error;
        } else if (errorDetail.status === 404) {
          errorMessage = 'Endpoint não encontrado (404). Verifique se o backend está rodando e se a URL está correta.';
        } else if (errorDetail.status) {
          errorMessage = `Erro HTTP ${errorDetail.status}: ${errorDetail.message || 'Erro desconhecido'}`;
        } else {
          // Tentar serializar o objeto para ver o que tem dentro
          try {
            errorMessage = JSON.stringify(errorDetail);
          } catch {
            errorMessage = 'Erro desconhecido no widget local';
          }
        }
      }
      
      this.errorMessage.set(errorMessage);
      this.statusMessage.set('Erro durante a verificação');
      this.error.emit(errorMessage);
    };

    document.addEventListener('liveness-complete', onLivenessComplete);
    document.addEventListener('liveness-error', onLivenessError);

    this.localWidgetListeners = { onComplete: onLivenessComplete, onError: onLivenessError };
  }

  /**
   * Remove listeners do widget local
   */
  private removeLocalWidgetListeners(): void {
    if (this.localWidgetListeners.onComplete) {
      document.removeEventListener('liveness-complete', this.localWidgetListeners.onComplete);
    }
    if (this.localWidgetListeners.onError) {
      document.removeEventListener('liveness-error', this.localWidgetListeners.onError);
    }
    this.localWidgetListeners = {};
  }

  /**
   * Destrói o widget
   */
  private destroyWidget(): void {
    if (this.widgetInstance && typeof this.widgetInstance.destroy === 'function') {
      try {
        this.widgetInstance.destroy();
      } catch (err) {
        console.error('[Liveness Modal Final] Erro ao destruir widget:', err);
      }
    }
    this.widgetInstance = null;
  }

  /**
   * Inicia o monitoramento de proximidade do rosto
   */
  private startProximityMonitoring(): void {
    this.stopProximityMonitoring();
    
    this.proximityMonitorInterval = setInterval(() => {
      this.checkFaceProximity();
    }, this.PROXIMITY_CHECK_INTERVAL);
  }

  /**
   * Para o monitoramento de proximidade
   */
  private stopProximityMonitoring(): void {
    if (this.proximityMonitorInterval) {
      clearInterval(this.proximityMonitorInterval);
      this.proximityMonitorInterval = null;
    }
  }

  /**
   * Verifica a proximidade do rosto através da elipse do widget
   */
  private checkFaceProximity(): void {
    let container = document.getElementById('aws-liveness-container-final');
    if (!container) {
      container = document.querySelector('.local-widget-container') as HTMLElement;
    }
    
    if (!container) return;

    // Método 1: Buscar elipse SVG diretamente
    const directEllipses = container.querySelectorAll('svg ellipse, svg circle');
    if (directEllipses.length > 0) {
      const ellipse = directEllipses[0] as SVGEllipseElement | SVGCircleElement;
      this.updateProximityFromEllipse(ellipse, container);
      return;
    }

    // Método 2: Buscar dentro de todos os SVGs
    const svgs = container.querySelectorAll('svg');
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i];
      const ellipse = svg.querySelector('ellipse, circle') as SVGEllipseElement | SVGCircleElement;
      if (ellipse) {
        this.updateProximityFromEllipse(ellipse, container);
        return;
      }
    }

    // Método 3: Buscar por classes do Amplify
    const amplifyEllipses = container.querySelectorAll('.amplify-liveness-ellipse, [class*="ellipse"], [class*="circle"]');
    if (amplifyEllipses.length > 0) {
      const element = amplifyEllipses[0] as HTMLElement;
      const rect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const widthPercent = (rect.width / containerRect.width) * 100;
        const heightPercent = (rect.height / containerRect.height) * 100;
        this.updateProximityFromPercent((widthPercent + heightPercent) / 2);
        return;
      }
    }

    // Método 4: Fallback - estimativa através do vídeo
    this.estimateProximityFromVideo(container);
  }

  /**
   * Atualiza a proximidade baseado na elipse SVG
   */
  private updateProximityFromEllipse(ellipse: SVGEllipseElement | SVGCircleElement, container: HTMLElement): void {
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    let ellipseWidth = 0;
    let ellipseHeight = 0;
    
    if (ellipse instanceof SVGEllipseElement) {
      const rx = ellipse.rx?.baseVal?.value || 0;
      const ry = ellipse.ry?.baseVal?.value || 0;
      ellipseWidth = rx * 2;
      ellipseHeight = ry * 2;
    } else if (ellipse instanceof SVGCircleElement) {
      const radius = ellipse.r?.baseVal?.value || 0;
      ellipseWidth = radius * 2;
      ellipseHeight = radius * 2;
    }
    
    // Se não conseguir obter valores do SVG, tentar pelo bounding box
    if (ellipseWidth === 0 || ellipseHeight === 0) {
      const ellipseRect = ellipse.getBoundingClientRect();
      ellipseWidth = ellipseRect.width;
      ellipseHeight = ellipseRect.height;
    }
    
    // Calcular porcentagem do container ocupada pela elipse
    const widthPercent = containerWidth > 0 ? (ellipseWidth / containerWidth) * 100 : 0;
    const heightPercent = containerHeight > 0 ? (ellipseHeight / containerHeight) * 100 : 0;
    const avgPercent = (widthPercent + heightPercent) / 2;
    
    this.updateProximityFromPercent(avgPercent);
  }

  /**
   * Atualiza a proximidade baseado em uma porcentagem
   */
  private updateProximityFromPercent(avgPercent: number): void {
    // Níveis de referência (ajustar conforme necessário)
    const PERFECT_MIN = 35;
    const PERFECT_MAX = 55;
    const TOO_CLOSE_THRESHOLD = 60;
    const TOO_FAR_THRESHOLD = 25;
    
    this.proximityLevel.set(Math.min(100, Math.max(0, avgPercent)));
    
    if (avgPercent > TOO_CLOSE_THRESHOLD) {
      this.proximityMessage.set('Afastar');
      this.instructionMessage.set('Muito próximo! Afaste-se um pouco');
      this.instructionIcon.set('⬆️');
    } else if (avgPercent < TOO_FAR_THRESHOLD) {
      this.proximityMessage.set('Aproximar');
      this.instructionMessage.set('Aproxime-se mais da câmera');
      this.instructionIcon.set('⬇️');
    } else if (avgPercent >= PERFECT_MIN && avgPercent <= PERFECT_MAX) {
      this.proximityMessage.set('Perfeito!');
      this.instructionMessage.set('Posição perfeita! Mantenha-se assim');
      this.instructionIcon.set('✅');
    } else {
      this.proximityMessage.set('Ajustando...');
      this.instructionMessage.set('Centralize seu rosto na elipse');
      this.instructionIcon.set('👤');
    }
  }

  /**
   * Estima proximidade através do vídeo (fallback)
   */
  private estimateProximityFromVideo(container: HTMLElement): void {
    const videos = container.querySelectorAll('video');
    if (videos.length === 0) {
      this.proximityMessage.set('Aguardando...');
      this.instructionMessage.set('Aguardando câmera...');
      return;
    }
    
    // Se houver vídeo mas não elipse, usar método alternativo
    // (pode ser expandido com detecção de face via canvas/ML)
    this.proximityMessage.set('Posicione seu rosto');
    this.instructionMessage.set('Centralize seu rosto na área indicada');
  }

  /**
   * Verifica se está muito próximo
   */
  isTooClose(): boolean {
    return this.proximityLevel() > 65;
  }

  /**
   * Verifica se está muito longe
   */
  isTooFar(): boolean {
    return this.proximityLevel() < 30;
  }

  /**
   * Verifica se está na distância perfeita
   */
  isPerfectDistance(): boolean {
    const level = this.proximityLevel();
    return level >= 40 && level <= 60;
  }

  /**
   * Retorna mensagem de distância
   */
  distanceMessage(): string {
    if (this.isTooClose()) return 'Afastar';
    if (this.isTooFar()) return 'Aproximar';
    return 'Ajustar posição';
  }

  /**
   * Configura observer para detectar mudanças no widget AWS e replicar na UI custom
   * Arquitetura Híbrida: detecta flash, oval e estados através do DOM
   */
  private setupAWSWidgetObserver(): void {
    const visibleContainer = document.getElementById('aws-liveness-container-final');
    if (!visibleContainer) {
      console.warn('[Liveness Modal Final] Container visível não encontrado para observer');
      return;
    }

    // Limpar observer anterior se existir
    if (this.awsWidgetObserver) {
      this.awsWidgetObserver.disconnect();
    }

    let lastFlashState = false;
    let lastOvalVisible = false;
    let flashCheckInterval: any = null;

    // Função para verificar flash do AWS
    const checkFlash = () => {
      // Detectar flash do AWS através do overlay (pode estar no body ou no container)
      const awsOverlay = document.querySelector('.aws-liveness-overlay, .awsui-liveness-flash-overlay') as HTMLElement;
      const hasFlash = !!(awsOverlay && (
        awsOverlay.classList.contains('active') ||
        window.getComputedStyle(awsOverlay).opacity !== '0' ||
        (awsOverlay.querySelector('.left-gradient, .right-gradient') && 
         window.getComputedStyle(awsOverlay.querySelector('.left-gradient') as HTMLElement).opacity !== '0')
      ));

      if (hasFlash !== lastFlashState) {
        lastFlashState = hasFlash;
        if (hasFlash) {
          console.log('[Liveness Modal Final] Flash detectado - replicando na UI custom');
          this.showFlashEffect();
        }
      }
    };

    this.awsWidgetObserver = new MutationObserver(() => {
      // Verificar flash periodicamente (pode aparecer/desaparecer rapidamente)
      if (!flashCheckInterval) {
        flashCheckInterval = setInterval(checkFlash, 100);
        setTimeout(() => {
          if (flashCheckInterval) {
            clearInterval(flashCheckInterval);
            flashCheckInterval = null;
          }
        }, 10000); // Verificar por 10 segundos
      }

      // Detectar oval/elipse do AWS
      const awsOval = visibleContainer.querySelector('svg ellipse, svg circle, .amplify-liveness-oval-canvas');
      const ovalVisible = awsOval !== null && 
        window.getComputedStyle(awsOval as HTMLElement).display !== 'none' &&
        window.getComputedStyle(awsOval as HTMLElement).opacity !== '0';

      if (ovalVisible !== lastOvalVisible) {
        lastOvalVisible = ovalVisible;
        this.isOvalVisible.set(ovalVisible);
        if (ovalVisible) {
          this.statusMessage.set('Rosto detectado! Mantenha a posição');
        }
      }

      // Detectar vídeo rodando (widget iniciado)
      const video = visibleContainer.querySelector('video');
      if (video && !video.paused && video.readyState >= 2) {
        this.isOvalVisible.set(true);
        if (!this.statusMessage().includes('Verificação em andamento')) {
          this.statusMessage.set('Verificação em andamento. Siga as instruções na tela.');
        }
      }
    });

    // Observar mudanças no container visível
    this.awsWidgetObserver.observe(visibleContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'opacity', 'display']
    });

    // Também observar o body para detectar overlay do AWS que pode ser movido
    this.awsWidgetObserver.observe(document.body, {
      childList: true,
      subtree: false
    });
    
    // Verificar flash imediatamente
    checkFlash();
  }

  /**
   * Atualiza a UI custom baseado nos eventos do AWS (Arquitetura Híbrida)
   */
  private updateUI(state: string): void {
    switch (state) {
      case 'ready':
        this.statusMessage.set('Widget pronto. Aguardando verificação...');
        this.isOvalVisible.set(true);
        break;
        
      case 'lightChallenge':
      case 'flash':
        // Flash do AWS - replicar visualmente
        this.showFlashEffect();
        break;
        
      case 'faceInOval':
      case 'faceDetected':
        // Rosto na oval - mostrar oval custom
        this.isOvalVisible.set(true);
        this.instructionMessage.set('Rosto detectado! Mantenha a posição');
        this.instructionIcon.set('✅');
        break;
        
      case 'moveCloser':
        this.proximityMessage.set('Aproximar');
        this.instructionMessage.set('Aproxime-se da câmera');
        this.instructionIcon.set('⬇️');
        break;
        
      case 'moveAway':
        this.proximityMessage.set('Afastar');
        this.instructionMessage.set('Afastar um pouco');
        this.instructionIcon.set('⬆️');
        break;
        
      case 'centerFace':
        this.instructionMessage.set('Centralize seu rosto');
        this.instructionIcon.set('👤');
        break;
        
      case 'analyzing':
        this.statusMessage.set('Analisando...');
        break;
        
      default:
        console.log('[Liveness Modal Final] Estado não tratado:', state);
    }
  }

  /**
   * Mostra o efeito de flash custom (replicado do AWS)
   */
  private showFlashEffect(): void {
    // Ativar flash
    this.isFlashActive.set(true);
    
    // Limpar timeout anterior se existir
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
    }
    
    // Desativar após 300ms (duração do flash)
    this.flashTimeout = setTimeout(() => {
      this.isFlashActive.set(false);
    }, 300);
  }

  /**
   * Limpa recursos
   */
  private cleanup(): void {
    this.stopProximityMonitoring();
    this.destroyWidget();
    
    // Limpar timeout do flash
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }

    const container = document.getElementById('aws-liveness-container-final');
    if (container) {
      container.innerHTML = '';
    }
    
    const hiddenContainer = document.getElementById('aws-liveness-hidden');
    if (hiddenContainer) {
      hiddenContainer.innerHTML = '';
    }

    this.sessionId = '';
    this.statusMessage.set('');
    this.errorMessage.set(null);
    this.proximityLevel.set(50);
    this.proximityMessage.set('Posicione seu rosto');
    this.instructionMessage.set('Centralize seu rosto na elipse');
    this.isFlashActive.set(false);
    this.isOvalVisible.set(false);
  }
}

