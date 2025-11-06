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
    // Escutar eventos customizados do widget
    this.setupWidgetEventListeners()
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
    this.cleanup()
    this.removeWidgetEventListeners()
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
      
      // Garantir que o widget saiba que deve usar conexão direta AWS
      // O widget customizado deve usar AWS SDK configurado globalmente para WebRTC
      widgetElement.setAttribute('use-direct-aws-connection', 'true')
      
      container.appendChild(widgetElement)
      
      console.log('✅ Widget configurado (sem session-id pré-criado):', {
        region: this.awsRegion,
        createSessionUrl: this.livenessSessionUrl,
        resultsUrl: this.livenessResultsUrl,
        identityPoolId: this.identityPoolId ? '***' : 'NÃO CONFIGURADO',
        hasCredentials: !!creds.accessKeyId,
        hasSecretKey: !!creds.secretAccessKey,
        hasSessionToken: !!(creds as any).sessionToken,
        connectionType: 'WebRTC direto para AWS Rekognition',
        note: 'Sessão será criada quando usuário clicar no botão "Iniciar Verificação" dentro do widget'
      })
      
      // Aguardar widget montar e inicializar
      setTimeout(() => {
        this.initializeWidget()
        
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
      
      // IMPORTANTE: Iniciar sequência de liveness apenas AGORA, após usuário clicar no botão interno
      // Notificar o componente camera-modal para iniciar voz e sequência
      // O camera-modal está escutando eventos ou podemos usar um método direto
      // Por enquanto, vamos apenas marcar que está pronto - o camera-modal vai detectar via polling
    }

    // Escutar eventos do widget
    document.addEventListener('liveness-complete', completeHandler)
    document.addEventListener('liveness-error', errorHandler)
    document.addEventListener('liveness-session', sessionHandler)
    document.addEventListener('liveness-progress', progressHandler)
    document.addEventListener('user-activity-started', userActivityHandler)
    document.addEventListener('liveness-started', userActivityHandler)
    document.addEventListener('recording-started', userActivityHandler)
    
    // Eventos alternativos que o widget pode disparar
    document.addEventListener('session-created', sessionHandler)
    document.addEventListener('session-ready', sessionHandler)

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
    this.widgetEventListeners.forEach(({ type, handler }) => {
      document.removeEventListener(type, handler)
    })
    this.widgetEventListeners = []
  }

  openCameraModal(): void {
    this.resetResult() // Limpar resultado anterior
    this.showCameraModal = true
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
    this.widgetInitialized = false
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
    
    // Procurar botão "Iniciar Verificação"
    const startButton = Array.from(buttons).find((btn: any) => {
      const text = (btn.textContent || btn.innerText || '').toLowerCase()
      return text.includes('iniciar') || 
             text.includes('start') ||
             text.includes('verificação') ||
             text.includes('verification') ||
             text.includes('begin') ||
             text.includes('começar')
    }) as HTMLButtonElement | undefined
    
    if (startButton) {
      details.buttonFound = true
      details.buttonText = startButton.textContent || startButton.innerText
      details.buttonVisible = window.getComputedStyle(startButton).display !== 'none'
      details.buttonDisabled = (startButton as HTMLButtonElement).disabled || startButton.hasAttribute('disabled')
      
      console.log('✅ Botão "Iniciar Verificação" ENCONTRADO após renderização!')
      console.log('📋 Detalhes do botão:', {
        text: details.buttonText,
        visible: details.buttonVisible,
        disabled: details.buttonDisabled,
        totalButtons: details.totalButtons
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
