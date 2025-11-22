import { CommonModule } from '@angular/common';
import { Component, OnDestroy, AfterViewInit, signal, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { LivenessService } from '../../services/liveness.service';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Amplify } from 'aws-amplify';
import awsExports from '../../../aws-exports';

// Declaração do widget AWS Face Liveness (conforme aws_widget_angular19.md)
declare var AwsLiveness: any;
declare const FaceLiveness: any; // Fallback para V2

@Component({
  selector: 'app-aws-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './aws-widget.component.html',
  styleUrls: ['./aws-widget.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class AwsWidgetComponent implements AfterViewInit, OnDestroy {
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly statusMessage = signal<string>('Inicializando...');
  readonly result = signal<any>(null);
  readonly useLocalWidget = signal(false);
  readonly isModalOpen = signal(false);
  readonly isWaitingResult = signal(false);
  readonly resultWaitSeconds = signal(0);
  private resultWaitInterval: any = null;

  private widgetInstance: any = null;
  private localWidgetListeners: { onComplete?: (e: Event) => void; onError?: (e: Event) => void } = {};
  private videoObserver: MutationObserver | null = null;
  sessionId: string = '';
  readonly awsRegion: string = environment.aws?.region || 'us-east-1';
  readonly createSessionUrl: string = `${environment.apiUrl}/liveness/start`;
  readonly resultsUrl: string = `${environment.apiUrl}/liveness/results`;
  readonly identityPoolId: string = environment.aws?.identityPoolId || '';

  constructor(private readonly livenessService: LivenessService) {}

  async ngAfterViewInit(): Promise<void> {
    // DOM já está pronto no AfterViewInit, não precisa aguardar
    // Não inicializar automaticamente - aguardar usuário clicar no botão
  }

  /**
   * Abre o modal do widget e inicia verificação automaticamente
   */
  async openModal(): Promise<void> {
    this.isModalOpen.set(true);
    // Aguardar um pouco para o modal renderizar e então iniciar verificação
    await new Promise(resolve => setTimeout(resolve, 100));
    await this.startVerification();
  }

  /**
   * Fecha o modal do widget
   */
  closeModal(): void {
    this.isModalOpen.set(false);
    // Limpar estado ao fechar
    this.destroyWidget();
    this.result.set(null);
    this.errorMessage.set(null);
    this.statusMessage.set('Inicializando...');
    this.sessionId = '';
    this.stopResultWait(); // Parar contador
  }

  /**
   * Inicia a verificação (cria sessão e inicializa widget)
   */
  async startVerification(): Promise<void> {
    await this.initializeWidget();
  }

  ngOnDestroy(): void {
    this.destroyWidget();
    this.removeLocalWidgetListeners();
    this.stopResultWait(); // Limpar contador
    // Limpar observers se houver
    if (this.videoObserver) {
      this.videoObserver.disconnect();
      this.videoObserver = null;
    }
  }

  /**
   * Inicializa o widget AWS Face Liveness conforme guia aws_widget_angular19.md
   */
  private async initializeWidget(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.errorMessage.set(null);
      this.statusMessage.set('Criando sessão...');

      // Criar sessão no backend diretamente (sem ping para ser mais rápido)
      let sessionResponse: any;
      try {
        sessionResponse = await firstValueFrom(this.livenessService.createSession());
      } catch (httpError: any) {
        console.error('[AWS Widget] Erro HTTP ao criar sessão:', httpError);
        
        // Se for 404, o endpoint pode não estar disponível - mas /start deve funcionar
        // O serviço já usa /start como padrão, então isso não deveria acontecer
        if (httpError?.status === 404) {
          throw new Error(
            `Endpoint não encontrado (404).\n\n` +
            `URL tentada: ${environment.apiUrl}/liveness/start\n\n` +
            `Verifique:\n` +
            `1. Backend está rodando em ${environment.apiUrl}?\n` +
            `2. O controller LivenessController está registrado?\n` +
            `3. Reinicie o backend se necessário\n` +
            `4. Verifique os logs do backend para mais detalhes`
          );
        } else if (httpError?.status === 0) {
          // Erro de conexão (CORS, rede, etc)
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

      // Passo 3: Aguardar widget estar disponível (reduzido delay para ser mais rápido)
      let attempts = 0;
      const maxAttempts = 10; // Reduzido de 15 para 10
      const checkInterval = 200; // Reduzido de 500ms para 200ms
      while (typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        attempts++;
        if (attempts % 3 === 0) { // Só atualizar mensagem a cada 3 tentativas para não poluir
          this.statusMessage.set(`Aguardando widget carregar... (${attempts}/${maxAttempts})`);
        }
      }

      // Tentar carregar widget local se os externos falharam
      if (typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') {
        this.statusMessage.set('Tentando carregar widget local...');
        await this.loadLocalWidget();
        
        // Aguardar menos tempo após tentar carregar local (reduzido de 1000ms para 300ms)
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      if (typeof AwsLiveness === 'undefined' && typeof FaceLiveness === 'undefined') {
        // Tentar usar widget local como fallback
        this.statusMessage.set('Usando widget local...');
        this.useLocalWidget.set(true);
        
        // Aguardar menos tempo para o web component ser registrado (reduzido de 500ms para 200ms)
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verificar se widget custom está disponível
        const customWidgetAvailable = customElements.get('face-liveness-widget') !== undefined;
        
        if (!customWidgetAvailable) {
          // Tentar carregar widget local dinamicamente
          await this.loadLocalWidget();
          await new Promise(resolve => setTimeout(resolve, 300)); // Reduzido de 1000ms para 300ms
        }
        
        // Se ainda não disponível, mostrar mensagem mas continuar (pode funcionar mesmo assim)
        if (!customElements.get('face-liveness-widget')) {
          console.warn('[AWS Widget] Widget local não encontrado, mas continuando...');
        }
      }

      // Passo 4: Inicializar widget (só se não estiver usando widget local)
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

        // Garantir que AWS SDK está disponível (necessário para widget local)
        const awsSdk = (window as any).AWS;
        if (!awsSdk) {
          throw new Error(
            'AWS SDK não está disponível.\n\n' +
            'Verifique se o script aws-sdk está carregado no index.html'
          );
        }

        console.log('[AWS Widget] AWS SDK disponível:', !!awsSdk);

        // Garantir que Amplify está disponível no window (necessário para widget local)
        try {
          // Verificar se Amplify está disponível no window (exportado pelo main.ts)
          const windowAmplify = (window as any).Amplify || (globalThis as any).Amplify;
          
          if (!windowAmplify) {
            // Tentar usar o Amplify importado diretamente
            if (typeof Amplify !== 'undefined') {
              // Exportar para window se ainda não estiver
              (window as any).Amplify = Amplify;
              (globalThis as any).Amplify = Amplify;
              console.log('[AWS Widget] Amplify exportado para window');
            } else {
              throw new Error('Amplify não está disponível. Verifique se aws-amplify está instalado.');
            }
          }

          // Verificar se Amplify já está configurado
          const amplifyToUse = windowAmplify || Amplify;
          
          // Tentar configurar Amplify se ainda não estiver configurado
          try {
            // Configuração do Amplify v6 (sintaxe correta)
            amplifyToUse.configure({
              Auth: {
                Cognito: {
                  identityPoolId: this.identityPoolId,
                  allowGuestAccess: true,
                }
              }
            });
            console.log('[AWS Widget] Amplify configurado para widget local');
          } catch (configError: any) {
            // Se já estiver configurado, isso é normal
            if (configError?.message?.includes('already configured')) {
              console.log('[AWS Widget] Amplify já estava configurado');
            } else {
              console.warn('[AWS Widget] Erro ao configurar Amplify:', configError);
            }
          }
        } catch (amplifyError: any) {
          throw new Error(
            'Erro ao configurar AWS Amplify.\n\n' +
            `Detalhes: ${amplifyError?.message || 'Erro desconhecido'}\n\n` +
            'Verifique:\n' +
            '1. Se aws-amplify está instalado (npm install aws-amplify)\n' +
            '2. Se o Identity Pool ID está correto\n' +
            '3. Se as permissões IAM estão configuradas corretamente\n' +
            '4. Recarregue a página após limpar o cache'
          );
        }

        // Widget local será renderizado via template
        this.statusMessage.set('Widget local carregado. Aguardando verificação...');
        
        // Configurar listeners para eventos do widget local
        this.setupLocalWidgetListeners();
        
        // Aplicar espelhamento no widget local também
        setTimeout(() => {
          this.applyVideoMirror();
        }, 500);

      }

      this.statusMessage.set('Widget carregado. Aguardando verificação...');
      this.isLoading.set(false);

      // Verificar periodicamente se o widget iniciou automaticamente
      this.checkWidgetStatus();
    } catch (error: any) {
      console.error('[AWS Widget] Erro ao inicializar:', error);
      const errorMsg = error?.message || error?.error?.message || 'Erro ao inicializar widget AWS';
      this.errorMessage.set(errorMsg);
      this.statusMessage.set('Erro ao inicializar');
      this.isLoading.set(false);
    }
  }

  /**
   * Inicializa o widget oficial AWS Face Liveness V2 no container
   */
  private async initWidget(sessionId: string): Promise<void> {
    // Usar container da página (widget usa sua própria interface nativa)
    const container = document.getElementById('liveness-container');
    
    // Se não encontrou, aguardar menos tempo (reduzido de 200ms para 100ms)
    if (!container) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const containerRetry = document.getElementById('liveness-container');
      if (!containerRetry) {
        throw new Error('Container do widget não encontrado.');
      }
    }

    // Limpar widget anterior se existir
    this.destroyWidget();

    try {
      // Inicializar widget conforme guia aws_widget_angular19.md
      // Tenta usar AwsLiveness primeiro (conforme guia), depois FaceLiveness (V2)
      const WidgetClass = typeof AwsLiveness !== 'undefined' ? AwsLiveness : FaceLiveness;
      
      if (!WidgetClass) {
        throw new Error('Classe do widget não encontrada');
      }

      this.widgetInstance = new WidgetClass({
        sessionId,
        region: environment.aws?.region || 'us-east-1',
        preset: typeof FaceLiveness !== 'undefined' ? 'faceMovementAndLight' : undefined, // V2 usa preset
        onError: (err: any) => {
          console.error('[AWS Widget] Erro no widget:', err);
          this.errorMessage.set(err?.message || 'Erro no widget AWS');
          this.statusMessage.set('Erro durante a verificação');
        },
        onComplete: async (result: any) => {
          console.log('[AWS Widget] Resultado do widget:', result);
          this.statusMessage.set('Processando resultado...');
          
          // Iniciar contador e loading enquanto busca resultado
          this.startResultWait();
          
          // Buscar resultado final do backend
          await this.fetchFinalResult(sessionId);
        },
        // Callbacks adicionais para debug
        onUserCancellation: () => {
          console.log('[AWS Widget] Usuário cancelou');
          this.statusMessage.set('Verificação cancelada pelo usuário');
        },
        onAnalysisComplete: (data: any) => {
          console.log('[AWS Widget] Análise completa:', data);
        }
      });

      // Renderizar: AwsLiveness usa seletor string, FaceLiveness usa elemento
      if (typeof AwsLiveness !== 'undefined') {
        console.log('[AWS Widget] Renderizando widget AwsLiveness no seletor: #liveness-container');
        this.widgetInstance.render('#liveness-container');
      } else {
        console.log('[AWS Widget] Renderizando widget FaceLiveness V2 no elemento:', container);
        this.widgetInstance.render(container);
      }

      // Log do widget instance para debug
      console.log('[AWS Widget] Widget instance criada:', {
        hasRender: typeof this.widgetInstance.render === 'function',
        hasStart: typeof (this.widgetInstance as any).start === 'function',
        hasBegin: typeof (this.widgetInstance as any).begin === 'function',
        methods: Object.keys(this.widgetInstance || {})
      });

      // Aplicar transformação de espelhamento nos vídeos imediatamente e depois com delays menores
      this.applyVideoMirror();
      this.checkAndStartWidget();
      
      // Aplicar novamente com delays reduzidos (500ms, 1000ms, 2000ms em vez de 500ms, 1500ms, 3000ms)
      setTimeout(() => {
        this.applyVideoMirror();
        this.checkAndStartWidget();
      }, 500);
      setTimeout(() => {
        this.applyVideoMirror();
        this.checkAndStartWidget();
      }, 1000);
      setTimeout(() => {
        this.applyVideoMirror();
        this.checkAndStartWidget();
      }, 2000);

      // Tentar clicar no botão interno do widget após carregar (delays reduzidos)
      setTimeout(() => {
        this.clickWidgetStartButton();
        this.checkAndStartWidget();
      }, 1000); // Reduzido de 3000ms para 1000ms
      setTimeout(() => {
        this.clickWidgetStartButton();
        this.checkAndStartWidget();
      }, 2500); // Reduzido de 6000ms para 2500ms
      setTimeout(() => {
        this.clickWidgetStartButton();
        this.checkAndStartWidget();
      }, 4000); // Reduzido de 10000ms para 4000ms
      } catch (err: any) {
      console.error('[AWS Widget] Erro ao renderizar widget:', err);
      throw new Error(`Erro ao renderizar widget: ${err?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Aplica espelhamento nos vídeos do widget (corrigir inversão da câmera)
   * E garante que a elipse fique na frente do vídeo
   */
  private applyVideoMirror(): void {
    // Tentar encontrar container da página (oficial primeiro, depois local)
    let container = document.getElementById('liveness-container');
    
    // Se não encontrou, tentar encontrar container do widget local
    if (!container) {
      container = document.querySelector('.local-widget-container') as HTMLElement;
    }
    
    // Se ainda não encontrou, tentar encontrar o widget diretamente
    if (!container) {
      const widget = document.querySelector('face-liveness-widget');
      if (widget && widget.parentElement) {
        container = widget.parentElement as HTMLElement;
      }
    }
    
    if (!container) {
      console.warn('[AWS Widget] Container não encontrado para aplicar espelhamento');
      return;
    }

    const applyMirrorToVideos = () => {
      // Encontrar todos os vídeos dentro do container (mesmo os já marcados, para reaplicar)
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
          video.style.setProperty('-moz-transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          video.style.setProperty('-ms-transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          video.style.setProperty('width', '100%', 'important');
          video.style.setProperty('height', '100%', 'important');
          video.style.setProperty('object-fit', 'cover', 'important');
          video.style.setProperty('object-position', 'center', 'important');
          video.style.setProperty('z-index', '1', 'important');
          video.setAttribute('data-mirrored', 'true');
          console.log('[AWS Widget] Vídeo centralizado e espelhado aplicado');
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
          canvas.style.setProperty('-webkit-transform', 'translate(-50%, -50%) scaleX(-1)', 'important');
          canvas.style.setProperty('z-index', '1', 'important');
          canvas.setAttribute('data-mirrored', 'true');
        }
      });

      // Garantir que SVG (elipse) fique centralizado e na frente (z-index máximo)
      // Mas ocultar SVGs pretos (máscaras)
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
            svgContent.includes('fill="black') ||
            svgContent.includes('fill:#000')) {
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

      // Garantir que divs com overlay/guide/gradient fiquem centralizados e na frente
      const allDivs = container.querySelectorAll('div');
      allDivs.forEach((div) => {
        const style = window.getComputedStyle(div);
        const className = div.className || '';
        const id = div.id || '';
        const bgColor = style.backgroundColor || '';
        const bgImage = style.backgroundImage || '';
        
        // Overlay customizado - z-index muito alto (acima de tudo)
        if (className.includes('aws-liveness-overlay') || className.includes('left-gradient') || className.includes('right-gradient')) {
          div.style.setProperty('z-index', '50000', 'important');
          div.style.setProperty('pointer-events', 'none', 'important');
          return;
        }
        
        // Ocultar máscaras pretas (elipse preto)
        if (className.includes('mask') || 
            id.includes('mask') ||
            bgColor === 'rgb(0, 0, 0)' ||
            bgColor === '#000000' ||
            bgImage.includes('radial-gradient') && (bgImage.includes('black') || bgImage.includes('#000'))) {
          div.style.setProperty('display', 'none', 'important');
          div.style.setProperty('opacity', '0', 'important');
          div.style.setProperty('visibility', 'hidden', 'important');
          return;
        }
        
        // Verificar se é um elemento visual (overlay, guide, gradient, etc)
        const isVisualElement = className.includes('guide') || 
            className.includes('ellipse') || 
            className.includes('overlay') || 
            className.includes('oval') ||
            className.includes('gradient') ||
            className.includes('effect') ||
            className.includes('violet') ||
            className.includes('purple') ||
            id.includes('guide') ||
            id.includes('ellipse') ||
            id.includes('overlay') ||
            (bgImage.includes('gradient') && !bgImage.includes('black') && !bgImage.includes('#000')) ||
            (bgColor.includes('rgba') && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'rgba(0, 0, 0, 1)') ||
            (style.position === 'absolute' && (bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent' && bgColor !== 'rgb(0, 0, 0)' && bgColor !== '#000000'));
        
        if (isVisualElement) {
          // Se já não estiver centralizado, centralizar
          if (style.position === 'absolute' && (!style.top.includes('50%') || !style.left.includes('50%'))) {
            div.style.setProperty('top', '50%', 'important');
            div.style.setProperty('left', '50%', 'important');
            const currentTransform = style.transform || '';
            if (!currentTransform.includes('translate(-50%, -50%)')) {
              div.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
            }
          }
          // Garantir z-index alto para overlays e efeitos visuais (mas menor que nosso overlay)
          div.style.setProperty('z-index', '1000', 'important');
          div.style.setProperty('pointer-events', 'none', 'important');
        }
      });

      // Garantir que elementos com background/gradient também fiquem na frente (z-index máximo)
      const elementsWithBg = container.querySelectorAll('[style*="background"], [class*="gradient"], [style*="rgba"], [style*="rgb"]');
      elementsWithBg.forEach((el: any) => {
        if (el.tagName !== 'VIDEO' && el.tagName !== 'CANVAS') {
          const className = (el.className || '').toString();
          // Overlay customizado - z-index muito alto (acima de tudo)
          if (className.includes('aws-liveness-overlay') || className.includes('left-gradient') || className.includes('right-gradient')) {
            el.style.setProperty('z-index', '50000', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
            return;
          }
          
          const style = window.getComputedStyle(el);
          const bgColor = style.backgroundColor || '';
          const bgImage = style.backgroundImage || '';
          
          // Se tem background color ou gradient, aplicar z-index alto (mas menor que nosso overlay)
          if (bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent' || bgImage.includes('gradient')) {
            el.style.setProperty('z-index', '1000', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
          }
        }
      });

      // Garantir que todos os elementos posicionados absolutamente com cores fiquem na frente
      const allElements = container.querySelectorAll('*');
      allElements.forEach((el: any) => {
        if (el.tagName === 'VIDEO' || el.tagName === 'CANVAS') {
          return; // Pular vídeo e canvas
        }
        
        const className = (el.className || '').toString();
        // Overlay customizado - z-index muito alto (acima de tudo)
        if (className.includes('aws-liveness-overlay') || className.includes('left-gradient') || className.includes('right-gradient')) {
          el.style.setProperty('z-index', '50000', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
          return;
        }
        
        const style = window.getComputedStyle(el);
        const bgColor = style.backgroundColor || '';
        const bgImage = style.backgroundImage || '';
        const position = style.position || '';
        
        // Se é elemento posicionado com background/gradient, aplicar z-index alto (mas menor que nosso overlay)
        if (position === 'absolute' || position === 'fixed') {
          if (bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent' || 
              bgImage.includes('gradient') || 
              bgImage.includes('rgba') ||
              bgColor.includes('rgba') ||
              bgColor.includes('rgb')) {
            el.style.setProperty('z-index', '1000', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
          }
        }
      });
    };

    // Aplicar imediatamente
    applyMirrorToVideos();

    // Aplicar novamente após delays reduzidos (500ms e 1000ms em vez de 1000ms e 2000ms)
    setTimeout(applyMirrorToVideos, 500);
    setTimeout(applyMirrorToVideos, 1000);

    // Observar mudanças no DOM para aplicar em vídeos que forem adicionados depois
    // E também tentar clicar no botão quando aparecer
    if (this.videoObserver) {
      this.videoObserver.disconnect();
    }
    
    let clickAttempts = 0;
    const maxClickAttempts = 10;
    
    this.videoObserver = new MutationObserver(() => {
      applyMirrorToVideos();
      
      // Tentar clicar no botão quando detectar mudanças (botão pode aparecer depois)
      // Delay reduzido de 500ms para 200ms
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
   * Verifica o status do widget periodicamente (intervalo reduzido para ser mais rápido)
   */
  private checkWidgetStatus(): void {
    const checkInterval = setInterval(() => {
      // Buscar container considerando widget oficial e local
      let container = document.getElementById('liveness-container');
      if (!container) {
        container = document.querySelector('.local-widget-container') as HTMLElement;
      }
      
      if (!container) {
        return;
      }

      // Verificar se há vídeo rodando
      const videos = container.querySelectorAll('video');
      if (videos.length > 0) {
        const video = videos[0] as HTMLVideoElement;
        if (video && !video.paused && video.readyState >= 2) {
          console.log('[AWS Widget] ✅ Widget iniciou automaticamente - vídeo está rodando');
          this.statusMessage.set('Verificação em andamento. Siga as instruções na tela.');
          clearInterval(checkInterval);
          return;
        }
      }

      // Verificar se há botão disponível
      const buttons = container.querySelectorAll('button');
      if (buttons.length > 0) {
        console.log(`[AWS Widget] ${buttons.length} botões encontrados - tentando clicar...`);
        this.clickWidgetStartButton();
      }
    }, 1000); // Reduzido de 2000ms para 1000ms para verificar mais rápido

    // Limpar após 20 segundos (reduzido de 30s para 20s)
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

      // Tentar métodos comuns de início
      const methods = ['start', 'begin', 'init', 'run', 'execute'];
      for (const method of methods) {
        if (typeof (this.widgetInstance as any)[method] === 'function') {
          console.log(`[AWS Widget] Tentando iniciar widget com método: ${method}`);
          try {
            (this.widgetInstance as any)[method]();
            this.statusMessage.set('Verificação iniciada.');
            return;
          } catch (err) {
            console.warn(`[AWS Widget] Método ${method} falhou:`, err);
          }
        }
      }

      // Verificar se há propriedade que indica que está pronto
      if ((this.widgetInstance as any).ready === true || (this.widgetInstance as any).isReady === true) {
        console.log('[AWS Widget] Widget está pronto, mas sem método de início explícito');
      }
    } catch (error: any) {
      console.warn('[AWS Widget] Erro ao verificar métodos do widget:', error);
    }
  }

  /**
   * Clica no botão interno do widget AWS para iniciar a verificação
   * Método público para ser usado no template
   */
  clickWidgetStartButton(): void {
    try {
      // Buscar container considerando widget oficial e local
      let container = document.getElementById('liveness-container');
      if (!container) {
        container = document.querySelector('.local-widget-container') as HTMLElement;
      }
      
      if (!container) {
        console.log('[AWS Widget] Container não encontrado (nem oficial nem local)');
        return;
      }

      // Log detalhado do que está dentro do container
      console.log('[AWS Widget] Conteúdo do container:', {
        children: container.children.length,
        innerHTML: container.innerHTML.substring(0, 500),
        buttons: container.querySelectorAll('button').length,
        videos: container.querySelectorAll('video').length,
        svgs: container.querySelectorAll('svg').length,
        divs: container.querySelectorAll('div').length
      });

      // Tentar encontrar widget local primeiro (prioridade)
      const localWidget = document.querySelector('face-liveness-widget') as any;
      if (localWidget) {
        console.log('[AWS Widget] Widget local encontrado');
        const shadowRoot = localWidget.shadowRoot;
        if (shadowRoot) {
          const buttons = shadowRoot.querySelectorAll('button');
          console.log(`[AWS Widget] ${buttons.length} botões encontrados no Shadow DOM do widget local`);
          
          // Log de todos os botões para debug
          buttons.forEach((btn: any, index: number) => {
            const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            console.log(`[AWS Widget] Botão ${index}:`, { 
              text, 
              ariaLabel, 
              disabled: btn.disabled,
              className: btn.className,
              id: btn.id
            });
          });
          
          // Tentar encontrar botão de início de várias formas
          let startButton: HTMLButtonElement | undefined;
          
          // Estratégia 1: Buscar por texto específico
          startButton = Array.from(buttons).find((btn: any) => {
            const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            
            const isCancelButton = text.includes('cancel') || 
                                  text.includes('cancelar') ||
                                  text.includes('close') ||
                                  text.includes('fechar') ||
                                  text.includes('×') ||
                                  text.includes('x');
            
            if (isCancelButton) return false;
            
            return text.includes('iniciar') || 
                   text.includes('start') ||
                   text.includes('verificação') ||
                   text.includes('verification') ||
                   text.includes('begin') ||
                   ariaLabel.includes('start') ||
                   ariaLabel.includes('iniciar');
          }) as HTMLButtonElement | undefined;

          // Estratégia 2: Se não encontrou, buscar primeiro botão não cancelar que não está desabilitado
          if (!startButton) {
            startButton = Array.from(buttons).find((btn: any) => {
              const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
              const className = (btn.className || '').toLowerCase();
              
              const isCancelButton = text.includes('cancel') || 
                                    text.includes('cancelar') ||
                                    text.includes('close') ||
                                    text.includes('fechar') ||
                                    text.includes('×') ||
                                    text.includes('x');
              
              if (isCancelButton) return false;
              
              // Buscar botão que não está desabilitado e tem classe de ação
              return !btn.disabled && 
                     (className.includes('start') ||
                      className.includes('begin') ||
                      className.includes('primary') ||
                      className.includes('action') ||
                      text.length > 0);
            }) as HTMLButtonElement | undefined;
          }

          // Estratégia 3: Se ainda não encontrou, pegar o primeiro botão não cancelar
          if (!startButton) {
            startButton = Array.from(buttons).find((btn: any) => {
              const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
              return !text.includes('cancel') && 
                     !text.includes('cancelar') &&
                     !text.includes('close') &&
                     !text.includes('fechar');
            }) as HTMLButtonElement | undefined;
          }

          if (startButton) {
            const text = (startButton.textContent || startButton.innerText || '').toLowerCase().trim();
            console.log('[AWS Widget] Botão candidato encontrado:', { 
              text, 
              disabled: startButton.disabled,
              className: startButton.className 
            });
            
            if (startButton.disabled || startButton.hasAttribute('disabled')) {
              console.log('[AWS Widget] Botão encontrado mas desabilitado, aguardando...');
              // Aguardar um pouco e tentar novamente
              setTimeout(() => {
                this.clickWidgetStartButton();
              }, 1000);
              return;
            }

            console.log('[AWS Widget] ✅ Clicando no botão do widget local');
            // Múltiplas tentativas de clique
            startButton.click();
            startButton.focus();
            
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              detail: 1
            });
            startButton.dispatchEvent(clickEvent);
            
            // Também tentar mousedown e mouseup
            startButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            startButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            
            this.statusMessage.set('Verificação iniciada. Siga as instruções na tela.');
            console.log('[AWS Widget] ✅ Botão de início clicado no widget local');
            return;
          } else {
            console.log('[AWS Widget] Nenhum botão de início encontrado no Shadow DOM');
          }
        } else {
          console.log('[AWS Widget] Shadow DOM não disponível no widget local');
        }
      }

      // Tentar encontrar botão no container do widget oficial AWS
      const buttons = container.querySelectorAll('button');
      console.log(`[AWS Widget] ${buttons.length} botões encontrados no container oficial`);
      
      buttons.forEach((btn, index) => {
        const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        console.log(`[AWS Widget] Botão ${index}:`, { text, ariaLabel, disabled: btn.disabled, className: btn.className });
      });

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
               text.includes('verification') ||
               text.includes('begin') ||
               ariaLabel.includes('start') ||
               ariaLabel.includes('iniciar');
      }) as HTMLButtonElement | undefined;

      if (startButton) {
        if (startButton.disabled || startButton.hasAttribute('disabled')) {
          console.log('[AWS Widget] Botão encontrado mas desabilitado, tentando novamente...');
          return;
        }

        console.log('[AWS Widget] Clicando no botão do widget oficial');
        startButton.click();
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        startButton.dispatchEvent(clickEvent);
        
        this.statusMessage.set('Verificação iniciada. Siga as instruções na tela.');
        console.log('[AWS Widget] ✅ Botão de início clicado no widget oficial');
        return;
      }

      // Se não encontrou botão, verificar se o widget já iniciou automaticamente
      const videos = container.querySelectorAll('video');
      if (videos.length > 0) {
        const video = videos[0] as HTMLVideoElement;
        if (video && !video.paused) {
          console.log('[AWS Widget] ✅ Vídeo está rodando - widget pode ter iniciado automaticamente');
          this.statusMessage.set('Verificação em andamento. Siga as instruções na tela.');
          return;
        }
      }

      // Se não encontrou botão, apenas logar (não é erro, pode estar ainda carregando)
      console.log('[AWS Widget] ⚠️ Botão de início ainda não encontrado. Widget pode estar carregando ou iniciar automaticamente...');
      
    } catch (error: any) {
      console.warn('[AWS Widget] Erro ao tentar clicar no botão do widget:', error);
      // Não definir erro aqui, pois pode ser que o botão ainda não exista
    }
  }

  /**
   * Inicia contador enquanto aguarda resultado
   */
  private startResultWait(): void {
    this.isWaitingResult.set(true);
    this.resultWaitSeconds.set(0);
    
    // Limpar intervalo anterior se existir
    if (this.resultWaitInterval) {
      clearInterval(this.resultWaitInterval);
    }
    
    // Incrementar contador a cada segundo
    this.resultWaitInterval = setInterval(() => {
      this.resultWaitSeconds.set(this.resultWaitSeconds() + 1);
    }, 1000);
  }

  /**
   * Para contador de espera
   */
  private stopResultWait(): void {
    this.isWaitingResult.set(false);
    if (this.resultWaitInterval) {
      clearInterval(this.resultWaitInterval);
      this.resultWaitInterval = null;
    }
  }

  /**
   * Busca resultado final do backend
   */
  private async fetchFinalResult(sessionId: string): Promise<void> {
    try {
      const result = await firstValueFrom(this.livenessService.getResult(sessionId));
      
      console.log('[AWS Widget] Resultado final do backend:', result);
      
      // Parar contador
      this.stopResultWait();
      
      const confidence = result.confidence ?? 0;
      const decision = result.livenessDecision || result.decision || 'UNKNOWN';
      const status = result.status || 'UNKNOWN';

      this.result.set({
        sessionId,
        confidence: (confidence * 100).toFixed(2),
        decision,
        status,
        referenceImageUrl: result.referenceImageUrl,
        auditImageUrls: result.auditImageUrls || [],
        raw: result
      });

      if (decision === 'LIVE' && confidence >= 0.7) {
        this.statusMessage.set(`Verificação concluída com sucesso! Confiança: ${(confidence * 100).toFixed(2)}%`);
      } else {
        this.statusMessage.set(`Verificação concluída. Confiança: ${(confidence * 100).toFixed(2)}%`);
      }
    } catch (err: any) {
      console.error('[AWS Widget] Erro ao buscar resultado:', err);
      // Parar contador mesmo em erro
      this.stopResultWait();
      this.errorMessage.set('Erro ao obter resultado da verificação');
      this.statusMessage.set('Erro ao processar resultado');
    }
  }

  /**
   * Destrói o widget
   */
  private destroyWidget(): void {
    if (this.widgetInstance && typeof this.widgetInstance.destroy === 'function') {
      try {
        this.widgetInstance.destroy();
      } catch (err) {
        console.error('[AWS Widget] Erro ao destruir widget:', err);
      }
    }
    this.widgetInstance = null;
  }

  /**
   * Tenta carregar o widget local
   */
  private async loadLocalWidget(): Promise<void> {
    try {
      // Verificar se o script já foi carregado
      if (document.querySelector('script[src="/assets/liveness/widget.js"]')) {
        return;
      }

      // Carregar script local dinamicamente
      const script = document.createElement('script');
      script.src = '/assets/liveness/widget.js';
      script.type = 'text/javascript';
      script.async = true;
      
      await new Promise<void>((resolve, reject) => {
        script.onload = () => {
          console.log('[AWS Widget] Widget local carregado com sucesso');
          resolve();
        };
        script.onerror = () => {
          console.warn('[AWS Widget] Falha ao carregar widget local');
          reject(new Error('Widget local não encontrado'));
        };
        document.head.appendChild(script);
      });
    } catch (error) {
      console.warn('[AWS Widget] Erro ao carregar widget local:', error);
      // Não lançar erro, apenas logar
    }
  }

  /**
   * Configura listeners para eventos do widget local
   */
  private setupLocalWidgetListeners(): void {
    // Listener para quando o widget local completar
    const onLivenessComplete = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('[AWS Widget] Widget local completou:', customEvent.detail);
      
      if (this.sessionId) {
        // Iniciar contador e loading enquanto busca resultado
        this.startResultWait();
        this.fetchFinalResult(this.sessionId);
      }
    };

    // Listener para erros do widget local
    const onLivenessError = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.error('[AWS Widget] Erro no widget local:', customEvent.detail);
      this.errorMessage.set(customEvent.detail?.message || 'Erro no widget local');
      this.statusMessage.set('Erro durante a verificação');
    };

    document.addEventListener('liveness-complete', onLivenessComplete);
    document.addEventListener('liveness-error', onLivenessError);

    // Guardar referências para limpar depois
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
   * Reinicia o widget
   */
  async restart(): Promise<void> {
    this.destroyWidget();
    this.result.set(null);
    this.errorMessage.set(null);
    this.sessionId = '';
    // Aguardar menos tempo antes de reiniciar (reduzido de 300ms para 100ms)
    await new Promise(resolve => setTimeout(resolve, 100));
    await this.startVerification();
  }

}

