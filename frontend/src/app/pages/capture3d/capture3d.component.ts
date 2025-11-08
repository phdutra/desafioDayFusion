import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, CUSTOM_ELEMENTS_SCHEMA, ChangeDetectorRef } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { StartLivenessRequest, LivenessSessionResponse, GetLivenessResultRequest, LivenessResultResponse } from '../../shared/models/transaction.model'
import { CameraModalComponent } from '../../shared/components/camera-modal/camera-modal.component'
import { environment } from '../../../environments/environment'
import awsmobile from '../../../aws-exports'
import { Amplify } from 'aws-amplify'

@Component({
  selector: 'app-capture3d',
  standalone: true,
  imports: [CommonModule, FormsModule, CameraModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './capture3d.component.html',
  styleUrls: ['./capture3d.component.scss']
})
export class Capture3dComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(CameraModalComponent) cameraModal?: CameraModalComponent

  livenessLoading = false
  livenessError: string | null = null
  livenessResult: LivenessResultResponse | null = null
  sessionActive = false
  processingResults = false
  processingProgress = 0
  
  // Modal state
  showCameraModal = false
  
  // Widget AWS Face Liveness (Web Component)
  showLivenessWidget = false
  // O widget espera URLs completas com http:// ou https://
  livenessSessionUrl = `${environment.apiUrl}/liveness/session`
  livenessResultsUrl = `${environment.apiUrl}/liveness/results`
  awsRegion = awsmobile.aws_project_region || environment.aws?.region || 'us-east-1'
  identityPoolId = awsmobile.aws_cognito_identity_pool_id || environment.aws?.identityPoolId || ''
  
  // Flag para rastrear se o widget foi inicializado
  widgetInitialized = false
  
  livenessSession?: LivenessSessionResponse
  private sessionExpiryTimer?: number
  private widgetEventListeners: { type: string; handler: (e: any) => void }[] = []
  private awsConfigured = false
  private widgetTimeoutTimer?: number // Timeout de segurança para widget não responder

  // Declaração de tipo para AWS SDK global
  private get AWS(): any {
    return (window as any).AWS
  }

  constructor(
    private faceService: FaceRecognitionService,
    private cdr: ChangeDetectorRef
  ) {
    // Não configurar AWS no construtor - aguardar ngAfterViewInit
  }

  ngOnInit(): void {
    // CORREÇÃO CRÍTICA: Registrar listeners ANTES de qualquer renderização
    // Conforme AWS_FaceLiveness_WidgetTimeout.md: eventos do Shadow DOM precisam ser capturados
    // no nível window ANTES do widget ser renderizado
    // Isso garante que eventos emitidos do Shadow DOM fechado sejam capturados
    console.log('🔧 Configurando listeners globais ANTES da renderização do widget...')
    this.setupWidgetEventListeners()
    console.log('✅ Listeners globais configurados no window e document')
  }

  /**
   * Garante a ordem correta de execução:
   * 1. checkWebRTC - verifica suporte WebRTC e HTTPS
   * 2. setupAWS - carrega Amplify + Identity Pool
   * 3. ensureCredentialsReady - aguarda credenciais Cognito estarem prontas
   * 4. renderWidget - só aqui renderiza o widget (após AWS.config.credentials estar fully resolved)
   */
  async ngAfterViewInit(): Promise<void> {
    try {
      await this.checkWebRTC()
      await this.setupAWS() // carrega Amplify + Identity Pool
      await this.ensureCredentialsReady() // aguarda credenciais Cognito estarem prontas
      // Widget será renderizado quando showLivenessWidget for true (via onLivenessStart)
      // Não renderizar automaticamente aqui - apenas quando usuário clicar em "Iniciar Verificação 3D"
      console.log('✅ Inicialização do componente concluída - widget pronto para renderizar')
    } catch (error: any) {
      console.error('❌ Erro na inicialização do componente:', error)
      this.livenessError = `Erro na inicialização: ${error?.message || 'Erro desconhecido'}`
    }
  }

  ngOnDestroy(): void {
    // CORREÇÃO: Limpar todos os timers e listeners antes de destruir componente
    this.cleanup()
    this.removeWidgetEventListeners()
    this.clearWidgetTimeoutSafety()
  }

  /**
   * Carrega o AWS SDK dinamicamente se não estiver disponível
   */
  private async loadAWSSDK(): Promise<void> {
    // Se já está disponível, retornar imediatamente
    if (this.AWS) {
      return Promise.resolve()
    }

    // Tentar carregar dinamicamente
    return new Promise<void>((resolve, reject) => {
      let checkCount = 0
      const maxChecks = 50 // 5 segundos (50 * 100ms)
      
      // Verificar periodicamente se o script do index.html carregou
      const checkInterval = setInterval(() => {
        checkCount++
        if (this.AWS) {
          clearInterval(checkInterval)
          console.log('✅ AWS SDK encontrado após', checkCount * 100, 'ms')
          resolve()
          return
        }
        
        // Se não encontrou após várias tentativas, tentar carregar dinamicamente
        if (checkCount >= 20 && !document.querySelector('script[src*="aws-sdk"]')) {
          clearInterval(checkInterval)
          console.log('⚠️ AWS SDK não encontrado. Carregando dinamicamente...')
          
          // Tentar carregar via script dinâmico
          const script = document.createElement('script')
          script.src = 'https://sdk.amazonaws.com/js/aws-sdk-2.1000.0.min.js'
          script.async = false // Não async para garantir ordem
          script.onload = () => {
            // Aguardar um pouco para o SDK estar disponível
            setTimeout(() => {
              if (this.AWS) {
                console.log('✅ AWS SDK carregado dinamicamente com sucesso')
                resolve()
              } else {
                reject(new Error('AWS SDK carregado mas não está disponível globalmente como window.AWS'))
              }
            }, 100)
          }
          script.onerror = () => {
            reject(new Error('Erro ao carregar AWS SDK. Verifique sua conexão com a internet e se a URL está acessível.'))
          }
          document.head.appendChild(script)
        }
        
        // Timeout final
        if (checkCount >= maxChecks) {
          clearInterval(checkInterval)
          reject(new Error('Timeout ao aguardar AWS SDK. O script pode não estar carregando corretamente.'))
        }
      }, 100) // Verificar a cada 100ms
    })
  }

  /**
   * Verifica suporte WebRTC no navegador e HTTPS obrigatório
   * Face Liveness não funciona via http://localhost - precisa HTTPS
   */
  private async checkWebRTC(): Promise<void> {
    console.log('🔍 Verificando suporte WebRTC...')
    
    // Verificar APIs WebRTC necessárias
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('WebRTC não suportado neste navegador. Use um navegador moderno com suporte a WebRTC.')
    }
    
    if (!window.RTCPeerConnection) {
      throw new Error('RTCPeerConnection não disponível. WebRTC não está totalmente suportado.')
    }
    
    console.log('✅ WebRTC suportado')
    
    // Verificar HTTPS obrigatório (Face Liveness requer HTTPS)
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    const isHttps = location.protocol === 'https:'
    
    if (!isHttps && !isLocalhost) {
      throw new Error('Face Liveness requer HTTPS. Acesse via https://localhost:4200 ou use um domínio HTTPS. HTTP não é suportado.')
    }
    
    if (isLocalhost && !isHttps) {
      console.warn('⚠️ Face Liveness requer HTTPS mesmo em localhost. Use https://localhost:4200')
      console.warn('💡 Se o certificado estiver autoassinado, permita no navegador')
      // Não lançar erro aqui - permitir continuar mas alertar
    } else {
      console.log('✅ HTTPS/SSL configurado corretamente')
    }
  }

  /**
   * Configura AWS Amplify e SDK com Cognito Identity Pool para o widget Face Liveness
   * O widget AWS Face Liveness precisa que o Amplify Auth esteja configurado
   * Usando apenas Identity Pool (sem login de usuário) conforme aws-exports.ts
   * Refatorado para ser chamado no setupAWS()
   */
  private async setupAWS(): Promise<void> {
    if (this.awsConfigured) {
      return
    }

    try {
      // Usar configuração do aws-exports.ts
      const identityPoolId = awsmobile.aws_cognito_identity_pool_id || this.identityPoolId
      const region = awsmobile.aws_project_region || this.awsRegion
      
      if (!identityPoolId) {
        throw new Error('Identity Pool ID não configurado. Verifique aws-exports.ts ou environment.')
      }

      // Configurar Amplify usando awsExports completo (conforme recomendação)
      // IMPORTANTE: Verificar se identityPoolId não está vazio
      if (!identityPoolId || identityPoolId.trim() === '') {
        throw new Error('Identity Pool ID está vazio. Verifique aws-exports.ts. Se estiver vazio, o Amplify não autentica e o widget não consegue pegar os tokens temporários.')
      }

      try {
        // Configurar Amplify usando awsExports completo (melhor prática)
        Amplify.configure(awsmobile)
        
        // Garantir que Amplify está disponível globalmente
        if (!(window as any).Amplify) {
          (window as any).Amplify = Amplify
        }
        
        console.log('✅ Amplify configurado com awsExports completo', {
          region: awsmobile.aws_project_region,
          identityPoolId: awsmobile.aws_cognito_identity_pool_id ? '***' : 'NÃO CONFIGURADO',
          cognitoRegion: awsmobile.aws_cognito_region
        })
      } catch (amplifyError: any) {
        console.error('❌ Erro ao configurar Amplify:', amplifyError?.message || amplifyError)
        throw new Error(`Erro ao configurar Amplify: ${amplifyError?.message || 'Verifique aws-exports.ts'}`)
      }

      // Tentar carregar o AWS SDK se não estiver disponível
      try {
        await this.loadAWSSDK()
      } catch (loadError: any) {
        console.warn('⚠️ Erro ao carregar AWS SDK:', loadError?.message || loadError)
        throw new Error(`AWS SDK não está disponível: ${loadError?.message || 'Erro desconhecido'}`)
      }

      // Verificar se AWS SDK está disponível após carregamento
      if (!this.AWS) {
        throw new Error('AWS SDK não está disponível após tentativa de carregamento.')
      }

      // Configurar AWS SDK com Cognito Identity Pool
      // O widget AWS Face Liveness usa o AWS SDK configurado globalmente
      this.AWS.config.region = region
      
      // Configurar credenciais usando Cognito Identity Pool (acesso anônimo)
      // O widget irá usar essas credenciais para autenticar com o serviço Face Liveness
      this.AWS.config.credentials = new this.AWS.CognitoIdentityCredentials({
        IdentityPoolId: identityPoolId
      })

      // NÃO obter credenciais aqui - será feito em validateCredentials()
      // Isso garante que as credenciais sejam obtidas apenas quando necessário
      this.awsConfigured = true
      console.log('✅ AWS SDK configurado (credenciais serão validadas posteriormente)')
    } catch (error: any) {
      console.error('❌ Erro ao configurar AWS SDK:', error)
      this.livenessError = `Erro ao configurar AWS: ${error?.message || error}. Verifique aws-exports.ts e o Identity Pool ID.`
      throw error // Re-throw para ngAfterViewInit tratar
    }
  }

  /**
   * Aguarda até que as credenciais Cognito estejam prontas
   * O widget precisa ser inicializado somente após as credenciais Cognito estarem prontas
   * Se você renderiza o widget antes de AWS.config.credentials estar pronto → o shadowRoot do widget falha em conectar o WebRTC
   */
  private async ensureCredentialsReady(): Promise<void> {
    console.log('🔍 Aguardando credenciais Cognito estarem prontas...')
    
    if (!this.AWS || !this.AWS.config.credentials) {
      throw new Error('AWS SDK não está configurado. Verifique se o AWS SDK foi carregado.')
    }

    return new Promise<void>((resolve, reject) => {
      const maxWaitTime: number = 30000 // 30 segundos máximo
      const checkInterval: number = 500 // Verificar a cada 500ms
      const credentialCheckStartTime: number = Date.now()
      
      const check = () => {
        // Obter credenciais temporárias usando get() (AWS SDK v2)
        (this.AWS.config.credentials as any).get((err: any) => {
          const currentElapsed: number = Date.now() - credentialCheckStartTime
          
          if (err) {
            // Se erro, verificar se é temporário ou permanente
            if (currentElapsed < maxWaitTime) {
              console.warn(`⚠️ Erro ao obter credenciais (tentativa após ${currentElapsed}ms):`, err?.message || err)
              setTimeout(check, checkInterval)
            } else {
              console.error('❌ Erro ao obter credenciais Cognito após timeout:', err)
              console.error('💡 Verifique se o Identity Pool permite acesso anônimo (unauthenticated access)')
              console.error('💡 Verifique se o Identity Pool tem permissões para Rekognition Face Liveness')
              reject(new Error(`Credenciais Cognito não disponíveis: ${err?.message || 'Erro desconhecido'}`))
            }
            return
          }
          
          // Verificar se as credenciais têm os campos necessários
          const creds = this.AWS.config.credentials
          if (creds && creds.accessKeyId && creds.secretAccessKey) {
            console.log('✅ Credenciais Cognito prontas:', {
              hasAccessKey: !!creds.accessKeyId,
              hasSecretKey: !!creds.secretAccessKey,
              hasSessionToken: !!(creds as any).sessionToken,
              elapsedTime: `${currentElapsed}ms`
            })
            resolve()
            return
          } else {
            // Credenciais incompletas, continuar aguardando
            if (currentElapsed < maxWaitTime) {
              setTimeout(check, checkInterval)
            } else {
              reject(new Error('Timeout ao aguardar credenciais Cognito. Verifique o Identity Pool ID e as permissões.'))
            }
          }
        })
      }
      
      // Iniciar verificação
      check()
    })
  }

  /**
   * Verifica se o Shadow DOM foi criado após renderização do widget
   * Conforme AWS_FaceLiveness_WidgetAccessError.md: o widget precisa criar ShadowRoot para funcionar
   * Se o ShadowRoot não for criado, o widget falha silenciosamente e não consegue conectar WebRTC
   */
  private verifyShadowDOMCreated(widgetElement: HTMLElement): void {
    console.log('🔍 Verificando se Shadow DOM foi criado...')
    
    // Aguardar um pouco para o widget inicializar
    setTimeout(() => {
      const widget = widgetElement as any
      
      // Verificar se shadowRoot existe
      if (widget.shadowRoot) {
        console.log('✅ Shadow DOM criado com sucesso!')
        console.log('📊 Detalhes do Shadow DOM:', {
          hasShadowRoot: true,
          mode: widget.shadowRoot.mode || 'unknown',
          childCount: widget.shadowRoot.children.length
        })
      } else {
        // Tentar verificar novamente após mais tempo (pode levar alguns segundos)
        setTimeout(() => {
          if (widget.shadowRoot) {
            console.log('✅ Shadow DOM criado (verificação tardia)')
          } else {
            console.error('❌ Shadow DOM não encontrado no widget')
            console.error('💡 Possíveis causas:')
            console.error('   1. Widget foi renderizado antes das credenciais Cognito estarem prontas')
            console.error('   2. Atributo use-direct-aws-connection está presente (deve ser removido)')
            console.error('   3. Permissões de câmera bloqueadas ou HTTPS ausente')
            console.error('   4. Content Security Policy (CSP) bloqueando scripts/blob')
            console.error('   5. Widget duplicado causando conflito de inicialização')
            
            // Exibir erro ao usuário
            this.livenessError = 'Não foi possível acessar o widget. Tente recarregar.'
            this.livenessLoading = false
            this.showLivenessWidget = false
          }
        }, 2000) // Verificar novamente após 2 segundos
      }
    }, 500) // Primeira verificação após 500ms
  }

  /**
   * Renderiza o FaceLivenessDetector conectando diretamente à AWS via WebRTC
   * Conforme AWS_FaceLiveness_SessionExpired.md: widget deve criar a sessão apenas quando
   * o usuário clicar no botão "Iniciar Verificação" dentro do widget.
   * Isso garante que o timer de 3 minutos só comece quando o usuário realmente interagir.
   */
  private async renderWidget(): Promise<void> {
    console.log('🎨 Renderizando widget com conexão direta AWS...')
    console.log('💡 IMPORTANTE: Sessão será criada apenas quando usuário clicar no botão "Iniciar Verificação" dentro do widget')

    // Garante que credenciais Cognito estão disponíveis
    const creds = this.AWS.config.credentials
    if (!creds) throw new Error('Credenciais AWS não disponíveis.')
    
    // Aguardar credenciais estarem fully resolved
    await creds.getPromise()

    // CORREÇÃO: NÃO criar sessão aqui!
    // O widget AWS deve criar a sessão via create-session-url quando o usuário clicar
    // no botão "Iniciar Verificação" dentro do widget.
    // Isso garante que o timer de 3 minutos só comece quando o usuário realmente interagir.
    console.log('📋 Widget será configurado para criar sessão via create-session-url quando usuário clicar no botão interno')

    // IMPORTANTE: Primeiro definir showLivenessWidget para que o container seja renderizado no DOM
    // Depois aguardar o Angular renderizar antes de buscar o container
    this.showLivenessWidget = true
    // NÃO definir sessionActive como true ainda - só será true quando widget criar sessão (após clique do usuário)
    this.livenessLoading = false
    
    // Forçar detecção de mudanças para garantir que o Angular renderizou o DOM
    this.cdr.detectChanges()
    
    // Aguardar um frame para garantir que o DOM foi atualizado
    await new Promise(resolve => setTimeout(resolve, 0))

    // Agora buscar o container (já deve existir no DOM)
    let container = document.getElementById('liveness-container')
    
    // Se ainda não existe, aguardar um pouco mais (pode levar alguns milissegundos)
    if (!container) {
      console.log('⏳ Aguardando container aparecer no DOM...')
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        container = document.getElementById('liveness-container')
        if (container) break
      }
    }
    
    if (!container) {
      throw new Error('Container do widget não encontrado após aguardar renderização.')
    }

    // CORREÇÃO: Conforme AWS_FaceLiveness_WidgetAccessError.md
    // Remover qualquer widget existente antes de criar um novo
    // Isso impede múltiplas instâncias de WebRTC simultâneas
    const existingWidget = document.querySelector('face-liveness-widget')
    if (existingWidget) {
      console.log('🧹 Removendo widget existente antes de criar novo...')
      existingWidget.remove()
    }

    container.innerHTML = '' // limpa o container

    // CORREÇÃO: Conforme AWS_FaceLiveness_SessionExpired.md
    // O widget deve criar a sessão apenas quando o usuário clicar no botão "Iniciar Verificação"
    // Por isso NÃO passamos session-id pré-criado, apenas create-session-url
    // O widget vai criar a sessão quando o usuário clicar no botão interno
    try {
      console.log('📦 Configurando widget para criar sessão apenas quando usuário clicar no botão...')
      console.log('💡 O widget vai chamar create-session-url quando usuário clicar em "Iniciar Verificação"')
      
      // Widget customizado configurado para:
      // 1. NÃO usar session-id pré-criado (deixar widget criar quando usuário clicar)
      // 2. Conectar diretamente à AWS via WebRTC usando credenciais Cognito
      // 3. create-session-url será chamado quando usuário clicar no botão "Iniciar Verificação"
      const widgetElement = document.createElement('face-liveness-widget')
      widgetElement.setAttribute('region', this.awsRegion)
      
      // IMPORTANTE: NÃO passar session-id pré-criado!
      // O widget deve usar create-session-url para criar a sessão quando o usuário clicar
      // no botão "Iniciar Verificação" dentro do widget.
      // Isso garante que o timer de 3 minutos só comece quando o usuário realmente interagir.
      widgetElement.setAttribute('identity-pool-id', this.identityPoolId)
      
      // URLs do backend - create-session-url será chamado quando usuário clicar no botão interno
      widgetElement.setAttribute('create-session-url', this.livenessSessionUrl)
      widgetElement.setAttribute('results-url', this.livenessResultsUrl)
      
      // CORREÇÃO: Removido 'use-direct-aws-connection' para ativar Shadow DOM
      // O Shadow DOM isola os elementos internos do widget e previne que o botão apareça no DOM Angular
      // Conforme AWS_FaceLiveness_ButtonVisible.md
      
      container.appendChild(widgetElement)
      
      // CORREÇÃO: Registrar listeners diretamente no elemento widget após criação
      // Isso adiciona uma camada extra de captura de eventos do Shadow DOM
      // O widget pode emitir eventos que não propagam para window/document
      this.attachWidgetElementListeners(widgetElement)
      
      console.log('✅ Widget configurado (sem session-id pré-criado):', {
        region: this.awsRegion,
        createSessionUrl: this.livenessSessionUrl,
        resultsUrl: this.livenessResultsUrl,
        identityPoolId: this.identityPoolId ? '***' : 'NÃO CONFIGURADO',
        hasCredentials: !!creds.accessKeyId,
        hasSecretKey: !!creds.secretAccessKey,
        hasSessionToken: !!(creds as any).sessionToken,
        connectionType: 'WebRTC direto para AWS Rekognition',
        note: 'Sessão será criada quando usuário clicar no botão "Iniciar Verificação" dentro do widget',
        shadowDOM: 'ATIVO - Elementos internos isolados (botão não aparece no DOM Angular)',
        viewEncapsulation: 'ViewEncapsulation.Emulated aplicado no camera-modal'
      })
      
      // Aguardar widget montar e inicializar
      setTimeout(() => {
        // CORREÇÃO: Conforme AWS_FaceLiveness_WidgetAccessError.md
        // Verificar se Shadow DOM foi criado após renderização
        this.verifyShadowDOMCreated(widgetElement)
        
        this.initializeWidget()
        
        // CORREÇÃO: Executar debug agressivo para encontrar o botão
        setTimeout(() => {
          console.log('🔍 [DEBUG] Executando busca agressiva do botão...')
          this.findWidgetButtonAggressively()
        }, 2000)
        
        // CORREÇÃO: Configurar timeout de segurança após widget estar pronto
        // O timeout será iniciado apenas quando o botão do widget estiver visível
        this.setupWidgetTimeoutSafety()
        
        // Verificar se o botão "Iniciar Verificação" aparece após widget inicializar
        // Múltiplas verificações para garantir que detecta o botão quando aparecer
        setTimeout(() => {
          this.checkWidgetButtonAfterRender()
        }, 1000) // Verificar após 1 segundo
        
        setTimeout(() => {
          this.checkWidgetButtonAfterRender()
        }, 3000) // Verificar novamente após 3 segundos
        
        setTimeout(() => {
          this.checkWidgetButtonAfterRender()
        }, 5000) // Verificar novamente após 5 segundos
      }, 500)
      
    } catch (error: any) {
      console.error('❌ Erro ao renderizar widget:', error)
      this.livenessError = `Erro ao renderizar widget: ${error?.message || 'Erro desconhecido'}`
      this.livenessLoading = false
    }
  }

  private setupWidgetEventListeners(): void {
    // CORREÇÃO: Registrar listeners no window globalmente ANTES da renderização
    // Isso garante que eventos emitidos do Shadow DOM sejam capturados
    // Conforme AWS_FaceLiveness_WidgetTimeout.md: eventos do Shadow DOM precisam ser capturados no nível window
    
    // Evento quando a sessão é criada pelo widget (após usuário clicar no botão "Iniciar Verificação")
    // IMPORTANTE: Este evento só é disparado quando o usuário clica no botão interno do widget
    // Por isso o timer de 3 minutos só começa AGORA, não quando o widget foi renderizado
    const sessionHandler = (e: Event) => {
      const customEvent = e as CustomEvent
      console.log('✅ Widget: Sessão criada (usuário clicou no botão "Iniciar Verificação")', customEvent.detail)
      const sessionData = customEvent.detail as any
      
      if (sessionData?.sessionId) {
        this.livenessSession = {
          sessionId: sessionData.sessionId,
          streamingUrl: sessionData.streamingUrl || '',
          transactionId: sessionData.transactionId || crypto.randomUUID() || Date.now().toString(),
          expiresAt: sessionData.expiresAt || new Date(Date.now() + 3 * 60 * 1000).toISOString()
        }
        
        // Configurar timer de expiração (agora sim, porque sessão foi criada após clique do usuário)
        this.setupSessionExpiry(sessionData.sessionId)
        
        // Marcar sessão como ativa (agora que foi criada pelo widget após clique do usuário)
        this.sessionActive = true
        
        console.log('✅ Sessão configurada e timer iniciado:', {
          sessionId: this.livenessSession.sessionId,
          expiresAt: this.livenessSession.expiresAt,
          note: 'Timer de 3 minutos iniciado apenas agora (após clique do usuário)'
        })
      }
    }
    
    // Evento quando liveness é concluído
    const completeHandler = async (e: Event) => {
      const customEvent = e as CustomEvent
      console.log('✅ Widget: Liveness completado', customEvent.detail)
      
      // CORREÇÃO: Cancelar timeout de segurança quando evento é recebido
      this.clearWidgetTimeoutSafety()
      
      const result = customEvent.detail as any
      
      // IMPORTANTE: Se o widget finalizou, buscar resultados do backend para garantir score correto
      // O widget pode não enviar todos os dados corretamente
      if (this.livenessSession?.sessionId) {
        console.log('📡 Buscando resultados do backend após widget finalizar...')
        
        // Mostrar tela de processamento
        this.processingResults = true
        this.processingProgress = 10
        this.sessionActive = false
        this.showLivenessWidget = false
        this.livenessLoading = false
        
        // Buscar resultados do backend (que tem o score correto)
        try {
          const resultRequest: GetLivenessResultRequest = {
            sessionId: this.livenessSession.sessionId,
            transactionId: this.livenessSession.transactionId
          }
          
          // IMPORTANTE: Quando o widget dispara liveness-complete, pode ser que o status ainda esteja IN_PROGRESS
          // Aguardar mais tempo para o backend processar completamente antes de buscar resultados
          console.log('⏳ Aguardando 5 segundos antes de buscar resultados (tempo para widget finalizar processamento)...')
          await new Promise(resolve => setTimeout(resolve, 5000))
          
          const backendResult = await this.pollForResults(resultRequest)
          
          if (backendResult) {
            this.livenessResult = backendResult
            console.log('✅ Resultado do backend recebido:', {
              status: this.livenessResult.status,
              confidence: this.livenessResult.confidence,
              confidencePercent: (this.livenessResult.confidence * 100).toFixed(1) + '%',
              hasImages: !!this.livenessResult.referenceImageUrl || (this.livenessResult.auditImageUrls?.length || 0) > 0
            })
          } else {
            // Se não conseguiu do backend, usar dados do widget (mesmo que incompletos)
            console.warn('⚠️ Não foi possível obter resultado do backend, usando dados do widget')
            this.livenessResult = {
              sessionId: result.sessionId || this.livenessSession?.sessionId || '',
              status: result.status || '',
              livenessDecision: result.livenessDecision || '',
              confidence: result.confidence || 0,
              transactionId: this.livenessSession?.transactionId || '',
              message: result.message || '',
              referenceImageUrl: result.referenceImageUrl || null,
              auditImageUrls: result.auditImageUrls || [],
              lowScoreReasons: result.lowScoreReasons || [],
              recommendations: result.recommendations || [],
              qualityScore: result.qualityScore || null,
              qualityAssessment: result.qualityAssessment || null
            }
          }
        } catch (err: any) {
          console.error('❌ Erro ao buscar resultado do backend:', err)
          // Usar dados do widget mesmo com erro
          this.livenessResult = {
            sessionId: result.sessionId || this.livenessSession?.sessionId || '',
            status: result.status || '',
            livenessDecision: result.livenessDecision || '',
            confidence: result.confidence || 0,
            transactionId: this.livenessSession?.transactionId || '',
            message: result.message || 'Erro ao obter resultado completo',
            referenceImageUrl: result.referenceImageUrl || null,
            auditImageUrls: result.auditImageUrls || [],
            lowScoreReasons: result.lowScoreReasons || [],
            recommendations: result.recommendations || [],
            qualityScore: result.qualityScore || null,
            qualityAssessment: result.qualityAssessment || null
          }
        } finally {
          this.processingResults = false
          this.processingProgress = 0
          this.closeCameraModal()
        }
      } else {
        // Se não tem sessão, usar dados do widget diretamente
        console.warn('⚠️ Sessão não configurada, usando dados do widget diretamente')
        this.livenessResult = {
          sessionId: result.sessionId || '',
          status: result.status || '',
          livenessDecision: result.livenessDecision || '',
          confidence: result.confidence || 0,
          transactionId: '',
          message: result.message || '',
          referenceImageUrl: result.referenceImageUrl || null,
          auditImageUrls: result.auditImageUrls || [],
          lowScoreReasons: result.lowScoreReasons || [],
          recommendations: result.recommendations || [],
          qualityScore: result.qualityScore || null,
          qualityAssessment: result.qualityAssessment || null
        }
        
        this.sessionActive = false
        this.showLivenessWidget = false
        this.livenessLoading = false
        this.closeCameraModal()
      }
    }

    // Evento quando ocorre erro
    const errorHandler = (e: Event) => {
      const customEvent = e as CustomEvent
      console.error('❌ Widget: Erro no liveness', customEvent.detail)
      
      // CORREÇÃO: Cancelar timeout de segurança quando erro ocorre
      this.clearWidgetTimeoutSafety()
      
      this.livenessError = customEvent.detail?.message || 'Erro no widget de liveness'
      this.livenessLoading = false
      this.showLivenessWidget = false
      this.sessionActive = false
    }
    
    // Evento de progresso
    const progressHandler = (e: Event) => {
      const customEvent = e as CustomEvent
      console.log('📊 Widget: Progresso', customEvent.detail)
      // Pode usar para atualizar barra de progresso se necessário
    }
    
    // Evento quando usuário inicia a verificação (clica no botão dentro do widget)
    // IMPORTANTE: Este evento é disparado quando o usuário clica no botão "Iniciar Verificação"
    // dentro do widget AWS. Apenas AGORA é que podemos iniciar a voz e sequência de liveness.
    const userActivityHandler = (e: Event) => {
      const customEvent = e as CustomEvent
      console.log('✅ Widget: Usuário iniciou verificação (clicou no botão "Iniciar Verificação")', customEvent.detail)
      console.log('🎤 AGORA sim podemos iniciar a voz e sequência de liveness')
      
      this.widgetInitialized = true
      this.livenessError = null // Limpar erro quando usuário inicia
      
      // Marcar que o widget está realmente ativo (sessão foi criada após clique do usuário)
      this.sessionActive = true
      
      // CORREÇÃO: Reiniciar timeout de segurança após usuário iniciar (agora temos atividade)
      // Dar mais 120 segundos (2 minutos) para o processo completo terminar
      this.clearWidgetTimeoutSafety()
      this.startWidgetTimeoutSafety(120000) // 2 minutos para widget processar completamente
      
      // CORREÇÃO: Notificar camera-modal para iniciar voz DEPOIS que usuário clicou no botão do widget
      // Usar ViewChild para acessar o componente diretamente
      if (this.cameraModal) {
        console.log('📢 Notificando camera-modal para iniciar voz e sequência...')
        this.cameraModal.startLivenessSequenceAfterWidgetButton()
      } else {
        console.warn('⚠️ camera-modal não disponível ainda, aguardando...')
        // Aguardar um pouco e tentar novamente
        setTimeout(() => {
          if (this.cameraModal) {
            this.cameraModal.startLivenessSequenceAfterWidgetButton()
          }
        }, 500)
      }
    }

    // CORREÇÃO CRÍTICA: Registrar listeners no window globalmente ANTES da renderização
    // Conforme AWS_FaceLiveness_WidgetTimeout.md linhas 21-27:
    // - Shadow DOM fechado isola eventos do contexto Angular
    // - Angular não consegue ouvir eventos emitidos de dentro do Shadow DOM
    // - Solução: Capturar eventos no nível window global ANTES da renderização
    
    // Estratégia múltipla: registrar em window, document E elemento widget (quando disponível)
    // Isso garante máxima compatibilidade mesmo com Shadow DOM fechado
    const registerListener = (eventName: string, handler: (e: Event) => void) => {
      // 1. Window (global) - captura eventos que "escapam" do Shadow DOM
      window.addEventListener(eventName, handler, { capture: true, passive: true })
      // 2. Document - fallback para eventos propagados
      document.addEventListener(eventName, handler, { capture: true, passive: true })
      
      console.log(`📡 Listener registrado para '${eventName}' no window e document (capture mode)`)
      
      // 3. Tentar registrar no elemento widget se já existir (pouco provável neste momento)
      // Mas será feito em renderWidget() após o widget ser criado
    }
    
    // Escutar eventos do widget (registrados no window E document)
    registerListener('liveness-complete', completeHandler)
    registerListener('liveness-error', errorHandler)
    registerListener('liveness-session', sessionHandler)
    registerListener('liveness-progress', progressHandler)
    registerListener('user-activity-started', userActivityHandler)
    registerListener('liveness-started', userActivityHandler)
    registerListener('recording-started', userActivityHandler)
    
    // Eventos alternativos que o widget pode disparar
    registerListener('session-created', sessionHandler)
    registerListener('session-ready', sessionHandler)

    this.widgetEventListeners = [
      { type: 'liveness-complete', handler: completeHandler },
      { type: 'liveness-error', handler: errorHandler },
      { type: 'liveness-session', handler: sessionHandler },
      { type: 'liveness-progress', handler: progressHandler },
      { type: 'user-activity-started', handler: userActivityHandler },
      { type: 'liveness-started', handler: userActivityHandler },
      { type: 'recording-started', handler: userActivityHandler },
      { type: 'session-created', handler: sessionHandler },
      { type: 'session-ready', handler: sessionHandler }
    ]
  }

  private removeWidgetEventListeners(): void {
    // CORREÇÃO: Remover listeners tanto do window quanto do document
    // E também do elemento widget se existir
    this.widgetEventListeners.forEach(({ type, handler }) => {
      window.removeEventListener(type, handler, { capture: true } as any)
      document.removeEventListener(type, handler, { capture: true } as any)
      
      // Tentar remover do elemento widget também
      const widget = document.querySelector('face-liveness-widget')
      if (widget) {
        try {
          widget.removeEventListener(type, handler, { capture: true } as any)
        } catch (e) {
          // Widget pode não ter listeners ou já foi removido
        }
      }
    })
    this.widgetEventListeners = []
    console.log('✅ Listeners removidos de window, document e elemento widget')
  }

  openCameraModal(): void {
    this.resetResult() // Limpar resultado anterior
    this.showCameraModal = true
    // CORREÇÃO: Iniciar widget automaticamente quando modal abrir
    // Isso garante que o widget apareça com seu botão interno visível
    setTimeout(() => {
      this.onLivenessStart()
    }, 500) // Aguardar modal abrir primeiro
  }

  closeCameraModal(): void {
    console.log('🚪 Fechando modal da câmera...')
    console.log('📊 Estado antes de fechar:', {
      showCameraModal: this.showCameraModal,
      processingResults: this.processingResults,
      sessionActive: this.sessionActive,
      showLivenessWidget: this.showLivenessWidget
    })
    
    // Forçar fechamento do modal
    this.showCameraModal = false
    this.showLivenessWidget = false
    this.sessionActive = false
    
    // IMPORTANTE: Não limpar sessão aqui se estiver processando resultados
    // A sessão é necessária para buscar resultados do backend
    if (!this.processingResults) {
      this.cleanup()
    } else {
      console.log('📊 Processamento em andamento, mantendo sessão ativa')
    }
    
    // Forçar detecção de mudanças para garantir que o modal feche
    this.cdr.detectChanges()
    
    console.log('✅ Modal fechado. Estado após:', {
      showCameraModal: this.showCameraModal,
      processingResults: this.processingResults
    })
  }

  async onLivenessStart(): Promise<void> {
    // IMPORTANTE: Conforme AWS_FaceLiveness_SessionExpired.md
    // O widget só deve ser renderizado quando o usuário clicar no botão "Iniciar Verificação"
    // dentro do widget. Isso evita que o timer de 3 minutos comece antes do usuário interagir.
    // 
    // Fluxo correto:
    // 1. Usuário clica em "Iniciar Verificação 3D" na página → abre modal
    // 2. Modal valida posição facial → mostra botão "Iniciar Verificação 3D" no modal
    // 3. Usuário clica no botão do modal → chama startLiveness3D() → emite livenessStart
    // 4. AQUI: renderizar widget apenas quando receber evento de que usuário clicou no botão interno
    // 
    // Mas o problema é que o widget AWS tem seu próprio botão "Iniciar Verificação" interno.
    // Então precisamos renderizar o widget AGORA, mas garantir que o timer só comece quando
    // o usuário clicar no botão interno do widget.
    
    // SOLUÇÃO: Renderizar widget apenas quando receber evento de que usuário está pronto
    // O widget será renderizado, mas o timer de 3 minutos só começa quando o usuário clicar
    // no botão "Iniciar Verificação" dentro do widget AWS.
    
    this.livenessLoading = true
    this.livenessError = null

    try {
      // Garantir que AWS Amplify está configurado antes de inicializar o widget
      if (!this.awsConfigured) {
        console.log('⚠️ AWS não configurado, executando setup...')
        await this.checkWebRTC()
        await this.setupAWS()
        await this.ensureCredentialsReady()
      } else {
        // Revalidar credenciais antes de renderizar (podem ter expirado)
        console.log('🔍 Revalidando credenciais antes de renderizar widget...')
        await this.ensureCredentialsReady()
      }
      
      console.log('📋 Preparando widget Face Liveness...')
      console.log('📋 URLs configuradas:', {
        createSessionUrl: this.livenessSessionUrl,
        resultsUrl: this.livenessResultsUrl,
        identityPoolId: this.identityPoolId ? '***' : 'NÃO CONFIGURADO'
      })
      
      // IMPORTANTE: Renderizar widget AGORA, mas o timer de 3 minutos só começa quando
      // o usuário clicar no botão "Iniciar Verificação" dentro do widget AWS.
      // O widget AWS tem uma tela inicial com instruções e um botão que o usuário precisa clicar.
      await this.renderWidget()
      
      // Limpar loading após widget renderizar (mas antes do usuário clicar no botão interno)
      this.livenessLoading = false
      
      console.log('✅ Widget renderizado. Aguardando usuário clicar no botão "Iniciar Verificação" dentro do widget...')
      
    } catch (err: any) {
      console.error('❌ Erro ao iniciar liveness:', err)
      this.livenessError = err.message || 'Erro ao iniciar verificação 3D.'
      this.livenessLoading = false
      this.showLivenessWidget = false
      this.sessionActive = false
    }
  }

  /**
   * Configura timer de expiração da sessão (3 minutos conforme AWS)
   * Conforme README_AWS_Liveness_WebRTC_Fix.md: "Face Liveness sessions are valid for 3 minutes"
   */
  private setupSessionExpiry(sessionId: string): void {
    if (this.sessionExpiryTimer) {
      clearTimeout(this.sessionExpiryTimer)
    }

    // Limpar timer após 3 minutos (180000ms)
    this.sessionExpiryTimer = window.setTimeout(() => {
      console.warn('⏰ Sessão expirada após 3 minutos. Recrie a sessão.')
      if (this.sessionActive && this.livenessSession?.sessionId === sessionId) {
        this.livenessError = 'Sessão expirada. Por favor, inicie uma nova verificação.'
        this.sessionActive = false
        this.cleanup()
      }
    }, 180000) // 3 minutos
  }

  async onLivenessComplete(event: any): Promise<void> {
    console.log('📥 onLivenessComplete chamado com evento:', event)
    console.log('📊 Estado atual:', {
      hasSession: !!this.livenessSession,
      sessionId: this.livenessSession?.sessionId,
      sessionActive: this.sessionActive,
      showCameraModal: this.showCameraModal,
      showLivenessWidget: this.showLivenessWidget,
      widgetInitialized: this.widgetInitialized,
      isTimeout: event?.timeout
    })
    
    // Se foi timeout de segurança, logar informação adicional
    if (event?.timeout) {
      console.warn('⚠️ Finalização via timeout de segurança - widget AWS não respondeu')
      console.warn('📋 Tentando buscar resultados do backend mesmo sem evento do widget')
    }
    
    // VERIFICAÇÃO CRÍTICA: Se o widget não foi inicializado (usuário não clicou no botão),
    // não fechar o modal e mostrar erro
    if (!this.widgetInitialized && event?.autoFinalized) {
      console.error('❌ Widget não foi inicializado - usuário não clicou no botão "Iniciar Verificação"')
      console.error('⚠️ Modal NÃO será fechado para dar oportunidade ao usuário clicar no botão')
      this.livenessError = '⚠️ Por favor, clique no botão "Iniciar Verificação" dentro do widget para começar a gravação. O widget não funciona automaticamente.'
      // NÃO fechar o modal - deixar usuário tentar novamente
      return
    }
    
    // PRIORIDADE 1: Se foi finalização automática ou manual, SEMPRE buscar resultados do backend
    if (event?.autoFinalized || event?.manualStop) {
      console.log('🔄 Finalização automática/manual detectada, buscando resultados...')
      
      // Verificar se temos sessão - se não tiver, pode ser que o widget ainda não criou
      if (!this.livenessSession?.sessionId) {
        console.warn('⚠️ Sessão não encontrada imediatamente, aguardando 1 segundo...')
        // Aguardar mais tempo - o widget pode estar criando a sessão
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Verificar novamente após aguardar
        if (!this.livenessSession?.sessionId) {
          console.error('❌ Sessão ainda não disponível após aguardar. Verificando múltiplas fontes...')
          
          // Tentar buscar sessão do widget se disponível
          const widget = document.querySelector('face-liveness-widget') as any
          if (widget) {
            // Tentar diferentes formas de obter sessionId do widget
            const widgetSessionId = widget.getAttribute('session-id') 
              || widget.getAttribute('sessionId')
              || widget.sessionId
              || (widget as any).sessionId
              || widget.shadowRoot?.querySelector('[data-session-id]')?.getAttribute('data-session-id')
            
            if (widgetSessionId) {
              console.log('✅ Sessão encontrada no widget:', widgetSessionId)
              // Criar sessão temporária se não existir
              if (!this.livenessSession) {
                this.livenessSession = {
                  sessionId: widgetSessionId,
                  streamingUrl: '',
                  transactionId: crypto.randomUUID(),
                  expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString()
                }
                console.log('✅ Sessão criada a partir do widget:', this.livenessSession)
              } else {
                this.livenessSession.sessionId = widgetSessionId
                console.log('✅ Sessão atualizada com sessionId do widget')
              }
            } else {
              console.warn('⚠️ Widget encontrado mas não tem sessionId visível')
            }
          } else {
            console.warn('⚠️ Widget não encontrado no DOM')
          }
          
          // Se ainda não encontrou, verificar eventos anteriores que podem ter criado sessão
          // Mas se não encontrou até agora, provavelmente não há sessão real
          if (!this.livenessSession?.sessionId) {
            console.error('❌ Não foi possível encontrar sessão em nenhuma fonte')
          }
        }
      }
      
      if (this.livenessSession?.sessionId) {
        console.log('✅ Sessão disponível, iniciando busca de resultados...')
        await this.fetchResultsAutomatically()
      } else {
        // Se não encontrou sessão, pode ser que seja simulação (useRealWidget = false)
        // Nesse caso, criar uma sessão no backend AGORA para poder buscar resultados
        console.warn('⚠️ Sessão não encontrada. Tentando criar sessão no backend...')
        
        try {
          const sessionRequest: StartLivenessRequest = {
            transactionId: crypto.randomUUID()
          }
          
          const sessionResponse = await this.faceService.startLivenessSession(sessionRequest).toPromise()
          
          if (sessionResponse?.sessionId) {
            console.log('✅ Sessão criada no backend:', sessionResponse.sessionId)
            this.livenessSession = {
              sessionId: sessionResponse.sessionId,
              streamingUrl: sessionResponse.streamingUrl || '',
              transactionId: sessionResponse.transactionId || crypto.randomUUID(),
              expiresAt: sessionResponse.expiresAt || new Date(Date.now() + 3 * 60 * 1000).toISOString()
            }
            
            // Configurar timer de expiração
            this.setupSessionExpiry(sessionResponse.sessionId)
            
            // Agora buscar resultados (mesmo que seja uma sessão nova, pode ter dados se o widget já processou)
            console.log('📡 Buscando resultados com sessão recém-criada...')
            await this.fetchResultsAutomatically()
          } else {
            throw new Error('Sessão criada mas sem sessionId')
          }
        } catch (createError: any) {
          console.error('❌ Erro ao criar sessão no backend:', createError)
          // Mesmo sem sessão, fechar modal e limpar estado
          this.sessionActive = false
          this.processingResults = false
          this.livenessError = 'Não foi possível obter sessão para buscar resultados. Por favor, tente novamente.'
          this.closeCameraModal()
        }
      }
      return // IMPORTANTE: retornar aqui para não continuar processamento
    }
    
    // PRIORIDADE 2: Se o evento tem sessionId (resultado completo do widget)
    if (event && event.sessionId) {
      console.log('📡 Resultado com sessionId recebido, verificando se precisa buscar do backend...')
      
      // Se o confidence está zerado ou não tem imagens, buscar do backend
      if ((!event.confidence || event.confidence === 0) || (!event.referenceImageUrl && (!event.auditImageUrls || event.auditImageUrls.length === 0))) {
        console.log('⚠️ Resultado incompleto detectado, buscando do backend...')
        if (this.livenessSession?.sessionId) {
          await this.fetchResultsAutomatically()
        } else {
          // Usar resultado recebido mesmo que incompleto
          console.warn('⚠️ Sessão não disponível, usando resultado incompleto do widget')
          this.livenessResult = event
          this.sessionActive = false
          this.closeCameraModal()
        }
      } else {
        // Resultado completo, usar diretamente
        console.log('✅ Resultado completo recebido, usando diretamente')
        this.livenessResult = event
        this.sessionActive = false
        this.closeCameraModal()
      }
      return
    }
    
    // PRIORIDADE 3: Evento sem dados específicos, mas pode ter sessão ativa
    console.warn('⚠️ Evento sem dados específicos detectado:', event)
    if (this.livenessSession?.sessionId) {
      console.log('🔄 Tentando buscar resultados do backend mesmo sem evento específico...')
      await this.fetchResultsAutomatically()
    } else {
      console.error('❌ Não há sessão disponível e evento não contém dados úteis')
      this.sessionActive = false
      this.processingResults = false
      this.closeCameraModal()
    }
  }

  private async fetchResultsAutomatically(): Promise<void> {
    if (!this.livenessSession?.sessionId) {
      console.warn('⚠️ fetchResultsAutomatically: Sessão não disponível')
      return
    }

    console.log('🔄 fetchResultsAutomatically iniciado para sessão:', this.livenessSession.sessionId)
    console.log('📊 Estado antes de buscar resultados:', {
      showCameraModal: this.showCameraModal,
      processingResults: this.processingResults,
      sessionActive: this.sessionActive
    })
    
    // IMPORTANTE: Mostrar tela de processamento ANTES de fechar o modal
    this.livenessLoading = true
    this.processingResults = true
    this.processingProgress = 0
    
    // Fechar modal IMEDIATAMENTE após iniciar processamento para garantir que a tela seja mostrada
    // O modal deve fechar ANTES de iniciar o polling
    if (this.showCameraModal) {
      console.log('🚪 Fechando modal antes de buscar resultados...')
      this.closeCameraModal()
      // Aguardar um frame para garantir que o Angular processe a mudança
      await new Promise(resolve => setTimeout(resolve, 0))
    } else {
      console.log('ℹ️ Modal já está fechado')
    }
    
    try {
      const resultRequest: GetLivenessResultRequest = {
        sessionId: this.livenessSession.sessionId,
        transactionId: this.livenessSession.transactionId
      }
      
      console.log('📡 Buscando resultados do backend...', resultRequest)
      
      // Fazer polling para aguardar processamento completo
      const result = await this.pollForResults(resultRequest)
      
      if (result) {
        console.log('✅ Resultado recebido do backend:', {
          sessionId: result.sessionId,
          status: result.status,
          confidence: result.confidence,
          hasReferenceImage: !!result.referenceImageUrl,
          auditImagesCount: result.auditImageUrls?.length || 0
        })
        
        this.livenessResult = result
        
        // Se ainda está CREATED ou sem imagens, fazer retry imediato
        if (result.status === 'CREATED' || (!result.referenceImageUrl && result.auditImageUrls?.length === 0)) {
          console.log('⚠️ Status CREATED ou sem imagens, fazendo retry...')
          console.log('⚠️ Se o status continuar CREATED, significa que o widget não iniciou a transmissão')
          console.log('⚠️ O usuário precisa clicar no botão "Iniciar Verificação" dentro do widget')
          
          // Aguardar apenas 1 segundo antes do retry (tempo para backend processar)
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          const retryResult = await this.faceService.getLivenessResult(resultRequest).toPromise()
          if (retryResult) {
            console.log('✅ Resultado do retry recebido:', retryResult)
            
            // Se ainda está CREATED após retry, o widget realmente não iniciou
            if (retryResult.status === 'CREATED') {
              console.error('❌ Status ainda CREATED após retry - widget não iniciou a transmissão')
              console.error('💡 O usuário precisa clicar no botão "Iniciar Verificação" dentro do widget')
              this.livenessError = '⚠️ Widget não iniciou a gravação. Por favor, clique no botão "Iniciar Verificação" dentro do widget e tente novamente.'
              // Não fechar modal se ainda está CREATED
              this.processingResults = false
              this.processingProgress = 0
              this.showCameraModal = true // Reabrir modal para usuário tentar novamente
              this.showLivenessWidget = true
              return
            }
            
            this.livenessResult = retryResult
          } else {
            console.warn('⚠️ Retry não retornou resultado')
          }
        }
      } else {
        console.error('❌ Não foi possível obter resultado da verificação')
        this.livenessError = 'Não foi possível obter resultado da verificação.'
      }
    } catch (err: any) {
      console.error('❌ Erro ao buscar resultado automaticamente:', err)
      this.livenessError = err.message || 'Erro ao obter resultado da verificação.'
    } finally {
      this.livenessLoading = false
      this.processingResults = false
      this.processingProgress = 0
      this.sessionActive = false
      
      // IMPORTANTE: Garantir que modal feche após resultado estar pronto
      // Verificar se a fala terminou antes de fechar
      this.waitForSpeechToFinishAndCloseModal()
    }
  }
  
  // Aguarda a fala terminar antes de fechar o modal
  private waitForSpeechToFinishAndCloseModal(): void {
    const maxWaitTime = 5000 // 5 segundos máximo
    const checkInterval = 500 // Verificar a cada 500ms
    let elapsedTime = 0
    
    const checkSpeech = setInterval(() => {
      elapsedTime += checkInterval
      const speechSynthesis = window.speechSynthesis
      const isSpeaking = speechSynthesis?.speaking || speechSynthesis?.pending
      
      if (!isSpeaking || elapsedTime >= maxWaitTime) {
        clearInterval(checkSpeech)
        if (this.showCameraModal) {
          console.log('🚪 Fechando modal após resultado estar pronto e fala terminar')
          console.log('📊 Estado da fala:', {
            speaking: speechSynthesis?.speaking,
            pending: speechSynthesis?.pending,
            elapsedTime,
            maxWaitTime
          })
          this.closeCameraModal()
        }
      } else if (elapsedTime % 2000 === 0) {
        // Log a cada 2 segundos
        console.log(`⏳ Aguardando fala terminar... (${elapsedTime}ms/${maxWaitTime}ms)`)
      }
    }, checkInterval)
  }

  // Polling para aguardar resultados prontos
  // Aumentado para aguardar mais tempo quando status é IN_PROGRESS (widget está processando)
  private async pollForResults(request: GetLivenessResultRequest, maxAttempts: number = 30, interval: number = 2000): Promise<LivenessResultResponse | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Atualizar progresso (começa em 10%, vai até 90% durante o polling)
        const baseProgress = 10
        const maxProgress = 90
        this.processingProgress = baseProgress + Math.floor((attempt / maxAttempts) * (maxProgress - baseProgress))
        
        const result = await this.faceService.getLivenessResult(request).toPromise()
        
        if (result) {
          // Log detalhado do resultado recebido
          console.log(`📊 [Polling #${attempt + 1}] Resultado recebido:`, {
            sessionId: result.sessionId,
            status: result.status,
            confidence: result.confidence,
            confidenceType: typeof result.confidence,
            livenessDecision: result.livenessDecision,
            hasReferenceImage: !!result.referenceImageUrl,
            auditImagesCount: result.auditImageUrls?.length || 0,
            fullResult: result
          })
          
          // Garantir que confidence seja número (pode vir como null, undefined, ou string)
          if (result.confidence === null || result.confidence === undefined) {
            console.warn(`⚠️ [Polling #${attempt + 1}] Confidence é null/undefined, tentando extrair do backend...`)
            // Se confidence não veio, pode estar em outro campo ou precisar recalcular
            // O backend sempre retorna confidence, então isso não deveria acontecer
          } else if (typeof result.confidence === 'string') {
            // Se vier como string, converter para número
            result.confidence = parseFloat(result.confidence) || 0
            console.log(`🔄 [Polling #${attempt + 1}] Confidence convertido de string para número:`, result.confidence)
          } else if (typeof result.confidence !== 'number') {
            console.warn(`⚠️ [Polling #${attempt + 1}] Confidence não é número válido:`, result.confidence, 'tipo:', typeof result.confidence)
            result.confidence = 0
          }
          
          // Garantir que status seja string (pode vir como objeto)
          let statusStr: string
          if (typeof result.status === 'string') {
            statusStr = result.status
          } else if (result.status && typeof result.status === 'object') {
            // Se for objeto, tentar extrair valor ou stringificar
            statusStr = (result.status as any)?.value || JSON.stringify(result.status) || 'UNKNOWN'
          } else {
            statusStr = String(result.status || 'UNKNOWN')
          }
          
          // Log do score final
          console.log(`📈 [Polling #${attempt + 1}] Score final: ${(result.confidence * 100).toFixed(1)}% (${result.confidence}), Status: ${statusStr}`)
          
          // Se status é SUCCEEDED ou FAILED, retornar imediatamente
          if (statusStr === 'SUCCEEDED' || statusStr === 'FAILED' || statusStr === 'EXPIRED') {
            this.processingProgress = 100
            // Normalizar status antes de retornar
            result.status = statusStr
            console.log(`✅ [Polling #${attempt + 1}] Resultado final obtido:`, {
              status: statusStr,
              confidence: result.confidence,
              confidencePercent: (result.confidence * 100).toFixed(1) + '%'
            })
            return result
          }
          
          // Se status é IN_PROGRESS, o vídeo está sendo transmitido - continuar polling com mais tempo
          if (statusStr === 'IN_PROGRESS') {
            console.log(`✅ [Polling #${attempt + 1}] Status IN_PROGRESS detectado - vídeo está sendo transmitido e processado!`)
            console.log(`⏳ Aguardando processamento completo (pode levar até 2 minutos)...`)
            // Continuar polling - não retornar ainda, aguardar SUCCEEDED ou FAILED
            // Aumentar intervalo quando IN_PROGRESS para dar mais tempo ao backend processar
            if (attempt < maxAttempts - 1) {
              await new Promise(resolve => setTimeout(resolve, interval * 1.5)) // 3 segundos em vez de 2
            }
            continue // Continuar loop sem incrementar tentativa aqui (já incrementa no for)
          }
          
          // Log de debug se status for CREATED
          if (statusStr === 'CREATED') {
            console.warn(`⚠️ Status ainda CREATED após ${attempt + 1} tentativas. Widget pode não ter transmitido vídeo via WebRTC.`)
            console.warn('🔍 Verificar: Widget inicializado? WebRTC conectou? Cognito configurado?')
            console.warn('💡 IMPORTANTE: O widget AWS Face Liveness REQUER que você clique no botão "Iniciar Verificação" dentro do widget!')
            
            // Se já passou 5 tentativas (10 segundos) e ainda está CREATED, pode ser que o widget não iniciou
            if (attempt >= 5) {
              console.error('❌ Widget não iniciou transmissão após 10 segundos. Provável causa: usuário não clicou no botão "Iniciar Verificação"')
            }
          }
          
          // Se tem imagens mesmo com status CREATED, pode ser que esteja processando ainda
          if (result.referenceImageUrl || (result.auditImageUrls && result.auditImageUrls.length > 0)) {
            this.processingProgress = 100
            console.log(`✅ [Polling #${attempt + 1}] Resultado com imagens retornado (mesmo com status ${statusStr})`)
            return result
          }
          
          // Se é a última tentativa, retornar resultado mesmo sem imagens
          if (attempt === maxAttempts - 1) {
            console.log(`⚠️ [Polling #${attempt + 1}] Última tentativa - retornando resultado mesmo sem imagens`)
            this.processingProgress = 100
            result.status = statusStr
            return result
          }
        }
        
        // Aguardar antes da próxima tentativa (exceto na última)
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, interval))
        }
      } catch (err) {
        console.error(`❌ Erro na tentativa ${attempt + 1}:`, err)
        // Continuar tentando mesmo com erro
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, interval))
        }
      }
    }
    
    // Se chegou aqui, fazer tentativas adicionais com intervalo maior para status IN_PROGRESS
    // Pode ser que o processamento esteja demorando mais que o esperado
    console.log('🔄 Tentativas padrão esgotadas, fazendo tentativas adicionais com intervalo maior...')
    
    // Tentativas adicionais com intervalo maior (5 segundos) para aguardar processamento completo
    for (let extraAttempt = 0; extraAttempt < 20; extraAttempt++) {
      try {
        await new Promise(resolve => setTimeout(resolve, 5000)) // 5 segundos entre tentativas
        
        const finalResult = await this.faceService.getLivenessResult(request).toPromise()
        if (finalResult) {
          // Validar confidence
          if (finalResult.confidence === null || finalResult.confidence === undefined) {
            console.warn(`⚠️ [Extra Attempt #${extraAttempt + 1}] Confidence é null/undefined`)
          } else if (typeof finalResult.confidence === 'string') {
            finalResult.confidence = parseFloat(finalResult.confidence) || 0
          } else if (typeof finalResult.confidence !== 'number') {
            finalResult.confidence = 0
          }
          
          // Normalizar status
          let statusStr: string
          if (typeof finalResult.status === 'string') {
            statusStr = finalResult.status
          } else if (finalResult.status && typeof finalResult.status === 'object') {
            statusStr = (finalResult.status as any)?.value || JSON.stringify(finalResult.status) || 'UNKNOWN'
          } else {
            statusStr = String(finalResult.status || 'UNKNOWN')
          }
          
          finalResult.status = statusStr
          
          console.log(`📊 [Extra Attempt #${extraAttempt + 1}] Resultado:`, {
            status: statusStr,
            confidence: finalResult.confidence,
            confidencePercent: (finalResult.confidence * 100).toFixed(1) + '%',
            hasImages: !!finalResult.referenceImageUrl || (finalResult.auditImageUrls?.length || 0) > 0
          })
          
          // Se status é SUCCEEDED ou FAILED, retornar imediatamente
          if (statusStr === 'SUCCEEDED' || statusStr === 'FAILED') {
            console.log(`✅ [Extra Attempt #${extraAttempt + 1}] Status final obtido: ${statusStr}`)
            this.processingProgress = 100
            return finalResult
          }
          
          // Se ainda está IN_PROGRESS, continuar tentando
          if (statusStr === 'IN_PROGRESS') {
            console.log(`⏳ [Extra Attempt #${extraAttempt + 1}] Ainda IN_PROGRESS, continuando aguardar...`)
            continue
          }
          
          // Se expirou, retornar mesmo assim
          if (statusStr === 'EXPIRED') {
            console.warn(`⚠️ [Extra Attempt #${extraAttempt + 1}] Sessão expirada`)
            this.processingProgress = 100
            return finalResult
          }
        }
      } catch (err) {
        console.error(`❌ Erro na tentativa extra ${extraAttempt + 1}:`, err)
        // Continuar tentando
      }
    }
    
    // Se chegou aqui, fazer uma última tentativa
    console.log('🔄 Fazendo última tentativa final de busca de resultados...')
    try {
      const finalResult = await this.faceService.getLivenessResult(request).toPromise()
      if (finalResult) {
        // Validar confidence na última tentativa
        if (finalResult.confidence === null || finalResult.confidence === undefined) {
          console.warn('⚠️ Confidence é null/undefined na última tentativa')
        } else if (typeof finalResult.confidence === 'string') {
          finalResult.confidence = parseFloat(finalResult.confidence) || 0
        } else if (typeof finalResult.confidence !== 'number') {
          finalResult.confidence = 0
        }
        
        console.log('📊 Última tentativa final - resultado:', {
          status: finalResult.status,
          confidence: finalResult.confidence,
          confidencePercent: (finalResult.confidence * 100).toFixed(1) + '%'
        })
        
        return finalResult
      }
      return null
    } catch (err) {
      console.error('❌ Erro na última tentativa:', err)
      return null
    }
  }

  async stopSession(): Promise<void> {
    if (this.livenessSession) {
      this.livenessLoading = true
      try {
        // Buscar resultados do liveness conforme README: GET /api/liveness/results?sessionId=xxx
        const resultRequest: GetLivenessResultRequest = {
          sessionId: this.livenessSession.sessionId,
          transactionId: this.livenessSession.transactionId
        }
        
        const result = await this.faceService.getLivenessResult(resultRequest).toPromise()
        if (result) {
          this.livenessResult = result
        } else {
          this.livenessError = 'Não foi possível obter resultado da verificação.'
        }
      } catch (err: any) {
        console.error('Erro ao buscar resultado:', err)
        this.livenessError = err.message || 'Erro ao obter resultado da verificação.'
      } finally {
        this.livenessLoading = false
      }
    }

    this.cleanup()
    this.sessionActive = false
    this.closeCameraModal()
  }

  resetResult(): void {
    this.livenessResult = null
    this.livenessError = null
  }

  getStatusString(): string {
    if (!this.livenessResult?.status) return 'UNKNOWN'
    if (typeof this.livenessResult.status === 'string') {
      return this.livenessResult.status
    }
    if (typeof this.livenessResult.status === 'object') {
      return JSON.stringify(this.livenessResult.status)
    }
    return String(this.livenessResult.status)
  }

  handleImageError(event: Event): void {
    const target = event.target as HTMLImageElement
    if (target) {
      target.style.display = 'none'
    }
  }

  private cleanup(): void {
    if (this.sessionExpiryTimer) {
      clearTimeout(this.sessionExpiryTimer)
      this.sessionExpiryTimer = undefined
    }
    this.clearWidgetTimeoutSafety()
    this.widgetInitialized = false
  }

  /**
   * Configura timeout de segurança conforme AWS_FaceLiveness_WidgetTimeout.md
   * CORREÇÃO: Timeout aumentado para 120 segundos (2 minutos) para dar tempo ao usuário:
   * - Widget renderizar (5-10s)
   * - Botão aparecer (5-10s)
   * - Usuário ver e clicar no botão (até 60s)
   * - Widget processar e disparar evento (10-30s)
   */
  private setupWidgetTimeoutSafety(): void {
    // Limpar timeout anterior se existir
    this.clearWidgetTimeoutSafety()
    
    // CORREÇÃO: Não iniciar timeout imediatamente - aguardar widget estar pronto
    // Timeout só começa após detectar que o botão do widget está visível
    console.log('⏰ Timeout de segurança será configurado após widget estar pronto (botão visível)')
    
    // Aguardar widget estar pronto antes de iniciar timeout
    this.waitForWidgetReady()
  }

  /**
   * CORREÇÃO: Aguarda widget estar pronto (botão visível) antes de iniciar timeout
   */
  private waitForWidgetReady(): void {
    let checkCount = 0
    const maxChecks = 20 // 10 segundos (20 * 500ms) para widget aparecer
    
    const checkInterval = setInterval(() => {
      checkCount++
      
      const widget = document.querySelector('face-liveness-widget') as any
      if (!widget) {
        if (checkCount >= maxChecks) {
          clearInterval(checkInterval)
          // Widget não apareceu, configurar timeout de qualquer forma
          this.startWidgetTimeoutSafety(120000) // 2 minutos
        }
        return
      }
      
      // Verificar se botão do widget está visível
      try {
        const shadowRoot = widget.shadowRoot || widget
        const buttons = shadowRoot.querySelectorAll('button')
        
        // CORREÇÃO: Logar todos os botões para debug
        if (buttons.length > 0) {
          console.log(`🔍 [waitForWidgetReady] Encontrados ${buttons.length} botões no widget`)
          Array.from(buttons).forEach((btn: any, index: number) => {
            const text = (btn.textContent || btn.innerText || '').trim()
            console.log(`  Botão ${index + 1}: "${text}" (disabled: ${btn.disabled || btn.hasAttribute('disabled')})`)
          })
        }
        
        // CORREÇÃO: Buscar botão com padrões expandidos e excluir cancel/fechar
        const startButton = Array.from(buttons).find((btn: any) => {
          const text = (btn.textContent || btn.innerText || '').toLowerCase().trim()
          const isCancel = text.includes('cancel') || text.includes('close') || text.includes('×') || text.includes('x')
          
          if (isCancel) return false
          
          return text.includes('iniciar') || 
                 text.includes('start') || 
                 text.includes('begin') ||
                 text.includes('continue') ||
                 text.includes('proceed') ||
                 // Se for o primeiro botão habilitado, considerar como botão de início
                 (!btn.disabled && !btn.hasAttribute('disabled') && Array.from(buttons).indexOf(btn) === 0)
        })
        
        if (startButton) {
          clearInterval(checkInterval)
          console.log('✅ Widget pronto! Botão encontrado. Iniciando timeout de 120 segundos...')
          // Widget está pronto, configurar timeout de 120 segundos
          this.startWidgetTimeoutSafety(120000) // 2 minutos para usuário clicar e widget processar
        } else if (checkCount >= maxChecks) {
          clearInterval(checkInterval)
          console.warn('⚠️ Widget encontrado mas botão não apareceu após 10 segundos')
          // Mesmo sem botão, configurar timeout
          this.startWidgetTimeoutSafety(120000)
        }
      } catch (e) {
        // Shadow DOM fechado ou erro ao acessar
        if (checkCount >= maxChecks) {
          clearInterval(checkInterval)
          console.warn('⚠️ Não foi possível verificar botão do widget, configurando timeout de qualquer forma')
          this.startWidgetTimeoutSafety(120000)
        }
      }
    }, 500) // Verificar a cada 500ms
  }

  /**
   * Inicia o timeout de segurança com o tempo especificado
   */
  private startWidgetTimeoutSafety(timeoutMs: number): void {
    this.clearWidgetTimeoutSafety()
    
    const timeoutSeconds = timeoutMs / 1000
    console.log(`⏰ Configurando timeout de segurança: ${timeoutSeconds} segundos para widget responder`)
    
    this.widgetTimeoutTimer = window.setTimeout(() => {
      console.warn(`⚠️ TIMEOUT DE SEGURANÇA: Widget AWS não disparou evento após ${timeoutSeconds} segundos`)
      
      // Se o widget não respondeu, mas temos uma sessão, tentar buscar resultados do backend
      if (this.livenessSession?.sessionId) {
        console.log('📡 Widget não respondeu, mas temos sessão. Buscando resultados do backend...')
        this.onLivenessComplete({
          autoFinalized: true,
          timeout: true,
          message: 'Widget não respondeu — finalização forçada por timeout'
        })
      } else {
        // Se não temos sessão, pode ser que o usuário não clicou no botão
        console.error('❌ Timeout e sem sessão. Widget pode não ter sido inicializado pelo usuário.')
        this.livenessError = `⚠️ Widget não respondeu após ${timeoutSeconds} segundos. Por favor, clique no botão "Iniciar Verificação" dentro do widget e tente novamente.`
        this.livenessLoading = false
      }
      
      // Limpar timer
      this.widgetTimeoutTimer = undefined
    }, timeoutMs)
  }

  /**
   * Limpa o timeout de segurança do widget
   */
  private clearWidgetTimeoutSafety(): void {
    if (this.widgetTimeoutTimer) {
      clearTimeout(this.widgetTimeoutTimer)
      this.widgetTimeoutTimer = undefined
      console.log('✅ Timeout de segurança do widget cancelado (evento recebido)')
    }
  }

  /**
   * CORREÇÃO: Anexa listeners diretamente no elemento widget após criação
   * Isso adiciona uma camada extra de captura de eventos do Shadow DOM
   * Conforme AWS_FaceLiveness_WidgetTimeout.md: Shadow DOM isola eventos do Angular
   * 
   * Estratégia: Tentar capturar eventos em múltiplos níveis:
   * 1. Window (global) - já registrado em setupWidgetEventListeners()
   * 2. Document - já registrado em setupWidgetEventListeners()
   * 3. Elemento widget - registrado aqui (pode ajudar se o widget emite eventos no próprio elemento)
   */
  private attachWidgetElementListeners(widgetElement: HTMLElement): void {
    console.log('🔧 Anexando listeners adicionais diretamente no elemento widget...')
    
    // Lista de eventos que o widget pode emitir
    const widgetEvents = [
      'liveness-complete',
      'liveness-error',
      'liveness-session',
      'liveness-progress',
      'user-activity-started',
      'liveness-started',
      'recording-started',
      'session-created',
      'session-ready'
    ]
    
    // Buscar handlers já registrados em setupWidgetEventListeners
    widgetEvents.forEach(eventName => {
      const listenerInfo = this.widgetEventListeners.find(l => l.type === eventName)
      if (listenerInfo) {
        // Registrar no elemento widget também (capture mode para pegar eventos do Shadow DOM)
        widgetElement.addEventListener(eventName, listenerInfo.handler, { capture: true, passive: true })
        console.log(`📡 Listener adicional anexado ao elemento widget para '${eventName}'`)
      }
    })
    
    // CORREÇÃO: Tentar acessar ShadowRoot e registrar listeners lá também (se não for fechado)
    try {
      const shadowRoot = (widgetElement as any).shadowRoot
      if (shadowRoot) {
        console.log('✅ ShadowRoot encontrado no widget')
        
        // Se o ShadowRoot não for fechado (mode: 'open'), podemos registrar listeners
        // Mas geralmente é 'closed', então isso provavelmente falhará
        // Tentar mesmo assim para debug
        widgetEvents.forEach(eventName => {
          const listenerInfo = this.widgetEventListeners.find(l => l.type === eventName)
          if (listenerInfo) {
            try {
              shadowRoot.addEventListener(eventName, listenerInfo.handler, { capture: true, passive: true })
              console.log(`📡 Listener registrado no ShadowRoot para '${eventName}'`)
            } catch (shadowError) {
              // Shadow DOM fechado não permite acesso - isso é esperado
              console.log(`ℹ️ ShadowRoot fechado para '${eventName}' (isso é normal - eventos serão capturados no window)`)
            }
          }
        })
      } else {
        console.log('ℹ️ ShadowRoot não disponível ou ainda não criado')
      }
    } catch (error) {
      // Shadow DOM fechado - isso é esperado e normal
      console.log('ℹ️ Não foi possível acessar ShadowRoot (fechado) - eventos serão capturados no window global')
    }
    
    console.log('✅ Listeners adicionais anexados ao elemento widget')
  }

  /**
   * CORREÇÃO: Destaca o botão do widget em amarelo para facilitar identificação
   * Tenta aplicar estilos diretamente no botão (funciona mesmo com Shadow DOM em alguns casos)
   */
  private highlightWidgetButton(button: HTMLButtonElement | HTMLElement): void {
    try {
      // CORREÇÃO: Verificar se botão está sem texto e adicionar "[Widget]"
      const currentText = (button.textContent || button.innerText || '').trim()
      if (!currentText || currentText === '') {
        console.log('📝 Botão sem texto detectado. Adicionando texto "[Widget]"...')
        
        // Tentar adicionar texto de diferentes formas
        try {
          if (button.textContent !== undefined) {
            button.textContent = '[Widget]'
          } else if ((button as any).innerText !== undefined) {
            (button as any).innerText = '[Widget]'
          } else {
            // Criar um span dentro do botão
            const span = document.createElement('span')
            span.textContent = '[Widget]'
            button.appendChild(span)
          }
          
          // Tentar adicionar aria-label também
          button.setAttribute('aria-label', 'Iniciar Verificação Widget')
          button.setAttribute('title', 'Clique para iniciar verificação 3D')
          
          console.log('✅ Texto "[Widget]" adicionado ao botão')
        } catch (textError) {
          console.warn('⚠️ Não foi possível adicionar texto ao botão:', textError)
        }
      } else {
        console.log('ℹ️ Botão já possui texto:', currentText)
      }
      
      // Estilos amarelos para destacar o botão
      const yellowStyles: Partial<CSSStyleDeclaration> = {
        backgroundColor: '#fbbf24',
        background: '#fbbf24',
        borderColor: '#f59e0b',
        color: '#000000',
        fontWeight: '700',
        boxShadow: '0 0 20px rgba(251, 191, 36, 0.6)',
        transition: 'all 0.3s ease',
        animation: 'yellowPulse 2s infinite'
      }
      
      // Aplicar estilos diretamente no botão
      Object.keys(yellowStyles).forEach(key => {
        try {
          (button as any).style[key] = yellowStyles[key as keyof CSSStyleDeclaration]
        } catch (e) {
          // Alguns estilos podem falhar, continuar
        }
      })
      
      // Adicionar classe customizada se possível
      if (button.classList) {
        button.classList.add('widget-start-button-highlighted')
      }
      
      // Adicionar atributo data para identificação
      button.setAttribute('data-widget-start-button', 'true')
      
      const finalText = (button.textContent || button.innerText || '').trim()
      console.log('🎨 Botão do widget destacado em AMARELO:', {
        text: finalText || '[Widget]',
        styles: 'Aplicados diretamente no elemento'
      })
    } catch (error) {
      console.warn('⚠️ Não foi possível destacar botão do widget:', error)
    }
  }

  /**
   * CORREÇÃO: Cria um indicador visual EXTERNO ao widget para destacar onde está o botão
   * Como o Shadow DOM pode ocultar estilos, criamos um overlay visual que aponta para o botão
   */
  private createWidgetButtonIndicator(button: HTMLElement): void {
    try {
      // Remover indicador anterior se existir
      const existingIndicator = document.getElementById('widget-button-indicator')
      if (existingIndicator) {
        existingIndicator.remove()
      }

      // Obter posição do botão dentro do widget
      const widget = document.querySelector('face-liveness-widget') as any
      if (!widget) {
        console.warn('⚠️ Widget não encontrado para criar indicador')
        return
      }

      // Obter posição do widget
      const widgetRect = widget.getBoundingClientRect()
      let buttonRect: DOMRect

      try {
        // Tentar obter posição do botão (pode falhar se estiver no Shadow DOM)
        buttonRect = button.getBoundingClientRect()
      } catch (e) {
        // Se não conseguir, estimar posição na parte inferior do widget
        buttonRect = {
          ...widgetRect,
          top: widgetRect.bottom - 80,
          height: 50,
          left: widgetRect.left + (widgetRect.width / 2) - 100,
          width: 200
        } as DOMRect
      }

      // CORREÇÃO: Criar indicador visual MUITO MAIS VISÍVEL (overlay amarelo grande e pulsante)
      const indicator = document.createElement('div')
      indicator.id = 'widget-button-indicator'
      indicator.innerHTML = `
        <div class="widget-indicator-content">
          <div class="widget-indicator-arrow">⬇⬇⬇</div>
          <div class="widget-indicator-text-large">👆 CLIQUE AQUI PARA INICIAR</div>
          <div class="widget-indicator-text">[Widget]</div>
          <div class="widget-indicator-hint">Procure o botão na parte inferior do círculo verde</div>
        </div>
      `
      
      // CORREÇÃO: Posicionar na parte inferior do widget (onde geralmente fica o botão)
      const estimatedButtonTop = widgetRect.bottom - 100 // Estimativa: botão fica ~100px acima da parte inferior
      const estimatedButtonLeft = widgetRect.left + (widgetRect.width / 2) - 150 // Centralizado
      
      // Estilos inline MUITO MAIS VISÍVEIS
      Object.assign(indicator.style, {
        position: 'fixed',
        top: `${estimatedButtonTop - 120}px`, // 120px acima da posição estimada do botão
        left: `${estimatedButtonLeft}px`,
        width: '300px',
        zIndex: '99999', // Z-index MUITO ALTO para garantir que apareça
        pointerEvents: 'none', // Não bloquear cliques
        animation: 'widgetIndicatorPulse 1.5s infinite',
        transform: 'translateX(-50%)', // Centralizar
        marginLeft: '150px' // Compensar transform
      })

      // Adicionar ao body
      document.body.appendChild(indicator)

      console.log('✅ Indicador visual do botão criado:', {
        position: { top: buttonRect.top, left: buttonRect.left },
        widgetSize: { width: widgetRect.width, height: widgetRect.height }
      })

      // Remover indicador após 30 segundos ou quando usuário clicar
      setTimeout(() => {
        const indicatorToRemove = document.getElementById('widget-button-indicator')
        if (indicatorToRemove) {
          indicatorToRemove.remove()
        }
      }, 30000)

    } catch (error) {
      console.warn('⚠️ Não foi possível criar indicador visual do botão:', error)
    }
  }

  /**
   * CORREÇÃO: Função de debug agressiva para encontrar o botão do widget
   * Tenta múltiplas estratégias para acessar o Shadow DOM e encontrar o botão
   */
  private findWidgetButtonAggressively(): HTMLElement | null {
    const widget = document.querySelector('face-liveness-widget') as any
    if (!widget) {
      console.warn('⚠️ Widget não encontrado')
      return null
    }

    console.log('🔍 [DEBUG AGRESSIVO] Procurando botão do widget com múltiplas estratégias...')
    
    // Estratégia 1: Tentar acessar shadowRoot diretamente
    try {
      const shadowRoot = widget.shadowRoot
      if (shadowRoot) {
        console.log('✅ ShadowRoot encontrado! Buscando botões...')
        const buttons = shadowRoot.querySelectorAll('button')
        console.log(`📋 Encontrados ${buttons.length} botões no ShadowRoot`)
        
        Array.from(buttons).forEach((btn: any, index: number) => {
          const text = (btn.textContent || btn.innerText || '').trim()
          const ariaLabel = btn.getAttribute('aria-label') || ''
          const rect = btn.getBoundingClientRect()
          
          console.log(`  Botão ${index + 1} (ShadowRoot):`, {
            text: text || '(sem texto)',
            ariaLabel: ariaLabel || '(sem aria-label)',
            visible: rect.width > 0 && rect.height > 0,
            position: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            className: btn.className || '(sem classe)'
          })
          
          // Se não for botão de cancelar, retornar
          if (!text.toLowerCase().includes('cancel') && 
              !ariaLabel.toLowerCase().includes('cancel') &&
              rect.width > 0 && rect.height > 0) {
            console.log(`✅ Botão candidato encontrado no ShadowRoot: Botão ${index + 1}`)
            return btn
          }
        })
      }
    } catch (e) {
      console.warn('⚠️ Não foi possível acessar ShadowRoot:', e)
    }

    // Estratégia 2: Tentar acessar via _shadowRoot (alguns browsers)
    try {
      const shadowRoot = (widget as any)._shadowRoot
      if (shadowRoot) {
        console.log('✅ _shadowRoot encontrado!')
        const buttons = shadowRoot.querySelectorAll('button')
        Array.from(buttons).forEach((btn: any, index: number) => {
          console.log(`  Botão ${index + 1} (_shadowRoot):`, {
            text: (btn.textContent || btn.innerText || '').trim(),
            visible: btn.offsetWidth > 0 && btn.offsetHeight > 0
          })
        })
      }
    } catch (e) {
      console.log('ℹ️ _shadowRoot não disponível')
    }

    // Estratégia 3: Buscar todos os elementos dentro do widget
    try {
      const allElements = widget.querySelectorAll('*')
      console.log(`📋 Total de elementos dentro do widget: ${allElements.length}`)
      
      const buttons = Array.from(allElements).filter((el: any) => 
        el.tagName === 'BUTTON' || 
        el.getAttribute('role') === 'button' ||
        el.onclick !== null ||
        (el.className && el.className.includes('button'))
      )
      
      console.log(`📋 Botões encontrados (querySelectorAll): ${buttons.length}`)
      buttons.forEach((btn: any, index: number) => {
        console.log(`  Botão ${index + 1}:`, {
          text: (btn.textContent || btn.innerText || '').trim(),
          tagName: btn.tagName,
          className: btn.className || '(sem classe)'
        })
      })
    } catch (e) {
      console.warn('⚠️ Erro ao buscar elementos:', e)
    }

    // Estratégia 4: Tentar acessar via getRootNode()
    try {
      const rootNode = widget.getRootNode()
      if (rootNode && rootNode !== document) {
        console.log('✅ RootNode diferente do document encontrado!')
        const buttons = (rootNode as any).querySelectorAll('button')
        console.log(`📋 Botões no RootNode: ${buttons.length}`)
      }
    } catch (e) {
      console.log('ℹ️ RootNode não disponível ou é document')
    }

    // Estratégia 5: Buscar por iframes dentro do widget
    try {
      const iframes = widget.querySelectorAll('iframe')
      console.log(`📋 Iframes encontrados: ${iframes.length}`)
      iframes.forEach((iframe: any, index: number) => {
        console.log(`  Iframe ${index + 1}:`, {
          src: iframe.src || '(sem src)',
          width: iframe.offsetWidth,
          height: iframe.offsetHeight
        })
      })
    } catch (e) {
      console.log('ℹ️ Nenhum iframe encontrado')
    }

    return null
  }

  /**
   * Verifica se o botão "Iniciar Verificação" aparece dentro do widget após renderização
   */
  private checkWidgetButtonAfterRender(): void {
    const widget = document.querySelector('face-liveness-widget') as any
    if (!widget) {
      console.warn('⚠️ Widget não encontrado após renderização')
      return
    }
    
    console.log('🔍 Verificando botão "Iniciar Verificação" após renderização do widget...')
    
    let details: any = {
      widgetExists: true,
      widgetVisible: window.getComputedStyle(widget).display !== 'none',
      hasShadowRoot: !!widget.shadowRoot,
      buttonFound: false,
      buttonText: null,
      buttonVisible: false,
      videoElements: 0
    }
    
    // Tentar acessar shadowRoot se disponível
    const widgetElement = widget.shadowRoot || widget
    
    // Procurar botões dentro do widget
    let buttons: NodeListOf<HTMLElement> | HTMLElement[] = []
    try {
      buttons = widgetElement.querySelectorAll('button')
      if (buttons.length === 0 && widget.shadowRoot) {
        buttons = widget.shadowRoot.querySelectorAll('button')
      }
      details.totalButtons = buttons.length
    } catch (e) {
      console.warn('⚠️ Erro ao buscar botões do widget:', e)
    }
    
    // CORREÇÃO: Logar todos os botões para debug
    console.log(`🔍 Encontrados ${buttons.length} botões no widget. Analisando cada um...`)
    Array.from(buttons).forEach((btn: any, index: number) => {
      const text = (btn.textContent || btn.innerText || '').trim()
      const ariaLabel = btn.getAttribute('aria-label') || ''
      const title = btn.getAttribute('title') || ''
      const className = btn.className || ''
      const isDisabled = btn.disabled || btn.hasAttribute('disabled')
      
      console.log(`  Botão ${index + 1}:`, {
        text: text || '(sem texto)',
        ariaLabel: ariaLabel || '(sem aria-label)',
        title: title || '(sem title)',
        className: className || '(sem classe)',
        disabled: isDisabled,
        visible: window.getComputedStyle(btn).display !== 'none'
      })
    })
    
    // CORREÇÃO: Buscar botão "Iniciar Verificação" com padrões expandidos
    const startButton = Array.from(buttons).find((btn: any) => {
      const text = (btn.textContent || btn.innerText || '').toLowerCase().trim()
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase()
      const title = (btn.getAttribute('title') || '').toLowerCase()
      const className = (btn.className || '').toLowerCase()
      
      // Excluir botões de cancelar/fechar
      const isCancelButton = text.includes('cancel') || 
                            text.includes('cancelar') ||
                            text.includes('close') ||
                            text.includes('fechar') ||
                            text.includes('×') ||
                            text.includes('x') ||
                            className.includes('cancel') ||
                            className.includes('close')
      
      if (isCancelButton) {
        return false
      }
      
      // Padrões de busca expandidos
      return text.includes('iniciar') || 
             text.includes('start') ||
             text.includes('verificação') ||
             text.includes('verification') ||
             text.includes('begin') ||
             text.includes('começar') ||
             text.includes('continue') ||
             text.includes('continuar') ||
             text.includes('proceed') ||
             text.includes('prosseguir') ||
             ariaLabel.includes('start') ||
             ariaLabel.includes('iniciar') ||
             ariaLabel.includes('begin') ||
             title.includes('start') ||
             title.includes('iniciar') ||
             className.includes('start') ||
             className.includes('begin') ||
             // Se não encontrou padrão mas é o primeiro botão habilitado, considerar como botão de início
             (!btn.disabled && !btn.hasAttribute('disabled') && Array.from(buttons).indexOf(btn) === 0)
    }) as HTMLButtonElement | undefined
    
    if (startButton) {
      details.buttonFound = true
      details.buttonText = startButton.textContent || startButton.innerText
      details.buttonVisible = window.getComputedStyle(startButton).display !== 'none'
      details.buttonDisabled = (startButton as HTMLButtonElement).disabled || startButton.hasAttribute('disabled')
      
      // CORREÇÃO: Pintar botão de amarelo para facilitar identificação
      this.highlightWidgetButton(startButton)
      
      // Destacar o container do widget também
      const container = document.getElementById('liveness-container')
      if (container) {
        container.classList.add('widget-button-ready')
      }
      
      // CORREÇÃO: Criar indicador visual EXTERNO ao widget para destacar o botão
      // Como o botão está no Shadow DOM, vamos criar um overlay/indicador visual
      this.createWidgetButtonIndicator(startButton)
      
      console.log('✅ Botão "Iniciar Verificação" ENCONTRADO após renderização!')
      console.log('📋 Detalhes do botão:', {
        text: details.buttonText,
        visible: details.buttonVisible,
        disabled: details.buttonDisabled,
        totalButtons: details.totalButtons,
        highlighted: 'Botão será destacado em AMARELO'
      })
    } else {
      console.warn('⚠️ Botão "Iniciar Verificação" NÃO encontrado após renderização')
      console.warn('📋 Detalhes do widget:', {
        totalButtons: details.totalButtons,
        widgetVisible: details.widgetVisible,
        hasShadowRoot: details.hasShadowRoot
      })
      console.warn('💡 Possíveis causas:')
      console.warn('   1. Widget ainda está carregando (aguarde mais alguns segundos)')
      console.warn('   2. Widget não criou sessão ainda (sessionId não disponível)')
      console.warn('   3. Widget está em Shadow DOM e não está acessível')
      console.warn('   4. Widget customizado não está funcionando corretamente')
    }
    
    // Verificar vídeos
    let videoElements: NodeListOf<HTMLVideoElement> | HTMLVideoElement[] = []
    try {
      videoElements = widgetElement.querySelectorAll('video')
      if (videoElements.length === 0 && widget.shadowRoot) {
        videoElements = widget.shadowRoot.querySelectorAll('video')
      }
      details.videoElements = videoElements.length
    } catch (e) {
      console.warn('⚠️ Erro ao buscar vídeos do widget:', e)
    }
    
    console.log('📊 Estado completo do widget após renderização:', details)
  }

  /**
   * Inicializa e verifica o widget AWS Face Liveness
   */
  private async initializeWidget(): Promise<void> {
    const widget = document.querySelector('face-liveness-widget') as any
    
    if (!widget) {
      console.error('❌ Widget não encontrado no DOM após 500ms')
      this.livenessError = 'Widget não foi carregado corretamente. Verifique se o arquivo widget.js está presente em /assets/liveness/'
      return
    }

    console.log('✅ Widget encontrado no DOM:', widget)

    // Verificar se AWS SDK está configurado globalmente
    try {
      const awsConfig = (window as any).AWS?.config
      if (!awsConfig) {
        console.warn('⚠️ AWS SDK não encontrado. Tentando carregar...')
        await this.loadAWSSDK()
      }

      if (!awsConfig?.credentials || !this.awsConfigured) {
        console.warn('⚠️ Credenciais AWS não configuradas. Tentando configurar...')
        await this.setupAWS()
        await this.ensureCredentialsReady()
      } else {
        // Revalidar credenciais (podem ter expirado)
        await this.ensureCredentialsReady()
      }

      // Verificar credenciais após configuração
      const finalAwsConfig = (window as any).AWS?.config
      if (finalAwsConfig?.credentials && finalAwsConfig.credentials.accessKeyId) {
        console.log('✅ AWS SDK configurado e credenciais disponíveis')
      } else {
        console.error('❌ AWS SDK ainda não configurado após tentativas')
        this.livenessError = 'Erro ao configurar AWS SDK. Verifique o Cognito Identity Pool ID e as credenciais.'
        return
      }
    } catch (e: any) {
      console.error('❌ Erro ao verificar/configurar AWS SDK:', e)
      this.livenessError = `Erro ao configurar AWS: ${e?.message || 'Erro desconhecido'}`
      return
    }

    // Verificar se o widget está inicializado corretamente
    // O widget AWS Face Liveness deve ter certos atributos/estados
    try {
      // Verificar se o widget tem os atributos necessários
      const region = widget.getAttribute('region') || this.awsRegion
      const createSessionUrl = widget.getAttribute('create-session-url') || this.livenessSessionUrl
      const resultsUrl = widget.getAttribute('results-url') || this.livenessResultsUrl
      const identityPoolId = widget.getAttribute('identity-pool-id') || this.identityPoolId

      console.log('📋 Configuração do widget:', {
        region,
        createSessionUrl,
        resultsUrl,
        identityPoolId: identityPoolId ? '***' : 'NÃO CONFIGURADO'
      })

      if (!identityPoolId || identityPoolId.trim() === '') {
        console.error('❌ Identity Pool ID não configurado!')
        this.livenessError = 'Identity Pool ID não configurado. Verifique aws-exports.ts'
        return
      }

      // Verificar se o widget está pronto (ele pode ter um método ou evento)
      // O widget AWS dispara eventos quando está pronto
      let widgetReady = false
      const readyTimeout = setTimeout(() => {
        // Silencioso: não poluir console; erros reais já são tratados abaixo
      }, 5000)

      // Escutar evento de ready do widget (se existir)
      const readyHandler = () => {
        widgetReady = true
        clearTimeout(readyTimeout)
        // Widget pronto
        this.widgetInitialized = true
      }

      widget.addEventListener('ready', readyHandler)
      widget.addEventListener('liveness-ready', readyHandler)
      widget.addEventListener('session-ready', readyHandler)

      // Verificação periódica de WebRTC e transmissão de vídeo
      let checkCount = 0
      const maxChecks = 30 // 30 segundos (1 segundo cada) - mais tempo para usuário clicar
      let userNotifiedToClick = false
      
      const checkWebRTC = setInterval(() => {
        checkCount++
        
        // Verificar se há elementos de vídeo dentro do widget
        const widget = document.querySelector('face-liveness-widget') as any
        if (widget) {
          // IMPORTANTE: Widget AWS Face Liveness usa Shadow DOM
          // Tentar acessar shadowRoot se disponível
          const shadowRoot = widget.shadowRoot || widget.shadowRootElement
          const widgetElement = shadowRoot || widget
          
          // Verificar se há botão "Iniciar Verificação" visível (widget ainda não iniciou)
          let buttons: NodeListOf<HTMLElement> | HTMLElement[] = []
          try {
            // Tentar querySelector normal primeiro
            buttons = widgetElement.querySelectorAll('button')
            
            // Se não encontrou e tem shadowRoot, tentar dentro do shadow
            if (buttons.length === 0 && shadowRoot) {
              buttons = shadowRoot.querySelectorAll('button')
            }
          } catch (e) {
            console.warn('⚠️ Erro ao acessar botões do widget (pode estar em Shadow DOM):', e)
          }
          
          const startButton = Array.from(buttons).find((btn: any) => {
            const text = btn.textContent?.toLowerCase() || btn.innerText?.toLowerCase() || ''
            return text.includes('iniciar') || 
                   text.includes('start') ||
                   text.includes('verificação') ||
                   text.includes('verification') ||
                   text.includes('begin') ||
                   text.includes('começar')
          })
          
          // CORREÇÃO: Pintar botão de amarelo quando encontrado
          if (startButton) {
            this.highlightWidgetButton(startButton as HTMLButtonElement)
            
            // Destacar container do widget
            const container = document.getElementById('liveness-container')
            if (container) {
              container.classList.add('widget-button-ready')
            }
          }
          
          if (startButton && !userNotifiedToClick && checkCount >= 3) {
            // Notificar usuário após 3 segundos se botão ainda estiver visível
            console.warn('⚠️ [Widget] Botão "Iniciar Verificação" ainda visível. Aguardando usuário clicar...')
            console.warn('📋 Texto do botão encontrado:', startButton.textContent || startButton.innerText)
            this.livenessError = 'Por favor, clique no botão "Iniciar Verificação" dentro do widget abaixo para começar a gravação.'
            userNotifiedToClick = true
          }
          
          // Buscar vídeos dentro do widget (incluindo shadow DOM)
          let videoElements: NodeListOf<HTMLVideoElement> | HTMLVideoElement[] = []
          try {
            videoElements = widgetElement.querySelectorAll('video')
            
            // Se não encontrou e tem shadowRoot, tentar dentro do shadow
            if (videoElements.length === 0 && shadowRoot) {
              videoElements = shadowRoot.querySelectorAll('video')
            }
          } catch (e) {
            console.warn('⚠️ Erro ao acessar vídeos do widget (pode estar em Shadow DOM):', e)
          }
          let hasActiveVideo = false
          let hasWebRTCConnection = false
          let hasLiveTracks = false
          
          videoElements.forEach((video: HTMLVideoElement) => {
            if (video.srcObject && !video.paused && video.readyState >= 2) {
              hasActiveVideo = true
            }
            // Verificar se há MediaStream (WebRTC)
            if (video.srcObject instanceof MediaStream) {
              hasWebRTCConnection = true
              const tracks = video.srcObject.getTracks()
              const videoTracks = tracks.filter(track => track.kind === 'video')
              if (videoTracks.length > 0 && videoTracks[0].readyState === 'live') {
                hasLiveTracks = true
                if (checkCount % 5 === 0) {
                  console.log(`✅ [WebRTC Check #${checkCount}] Vídeo detectado com WebRTC ativo:`, {
                    videoTracks: videoTracks.length,
                    trackState: videoTracks[0].readyState
                  })
                }
              }
            }
          })
          
          if (hasActiveVideo && hasWebRTCConnection && hasLiveTracks) {
            console.log(`✅ [WebRTC Check #${checkCount}] Widget está transmitindo vídeo via WebRTC`)
            clearInterval(checkWebRTC)
            this.widgetInitialized = true
            this.livenessError = null // Limpar erro quando detectar transmissão
          } else if (checkCount % 5 === 0) {
            // Log a cada 5 segundos
            console.warn(`⚠️ [WebRTC Check #${checkCount}] Widget ainda não está transmitindo vídeo:`, {
              hasActiveVideo,
              hasWebRTCConnection,
              hasLiveTracks,
              videoElementsCount: videoElements.length,
              startButtonVisible: !!startButton,
              widgetVisible: window.getComputedStyle(widget).display !== 'none',
              widgetInDOM: widget.isConnected,
              hasShadowRoot: !!widget.shadowRoot
            })
            
            // Se passou 10 segundos e ainda não iniciou, alertar mais fortemente
            if (checkCount >= 10 && startButton) {
              this.livenessError = '⚠️ IMPORTANTE: Clique no botão "Iniciar Verificação" dentro do widget para começar a gravação! O widget não funciona automaticamente.'
            } else if (checkCount >= 15 && !hasWebRTCConnection) {
              // Se passou 15 segundos e não há conexão WebRTC, pode ser problema de configuração
              this.livenessError = '⚠️ Widget não está conectando via WebRTC. Verifique: 1) HTTPS ou localhost, 2) Permissões do Cognito, 3) Clique no botão do widget.'
            }
          }
        }
        
        // Parar após maxChecks
        if (checkCount >= maxChecks) {
          clearInterval(checkWebRTC)
          if (!this.widgetInitialized) {
            console.error('❌ Widget não iniciou transmissão de vídeo após 30 segundos')
            console.error('🔍 Diagnóstico:')
            console.error('   1. O widget AWS Face Liveness REQUER que o usuário clique em "Iniciar Verificação"')
            console.error('   2. Verifique se está usando HTTPS ou localhost')
            console.error('   3. Verifique se o Cognito Identity Pool tem permissões para Rekognition Face Liveness')
            console.error('   4. Verifique se o widget tem acesso à câmera (permissões do navegador)')
            console.error('   5. O widget pode estar dentro de um Shadow DOM - verifique se está visível')
            this.livenessError = 'Widget não iniciou gravação. Por favor, clique no botão "Iniciar Verificação" dentro do widget e tente novamente.'
          }
        }
      }, 1000) // Verificar a cada 1 segundo

    } catch (e: any) {
      console.error('❌ Erro ao inicializar widget:', e)
      this.livenessError = `Erro ao inicializar widget: ${e?.message || 'Erro desconhecido'}`
    }
  }
}
