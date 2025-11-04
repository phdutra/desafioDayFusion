import { Component, OnInit, OnDestroy, ViewChild, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core'
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
export class Capture3dComponent implements OnInit, OnDestroy {
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
  
  private livenessSession?: LivenessSessionResponse
  private sessionExpiryTimer?: number
  private widgetEventListeners: { type: string; handler: (e: any) => void }[] = []
  private awsConfigured = false

  // Declaração de tipo para AWS SDK global
  private get AWS(): any {
    return (window as any).AWS
  }

  constructor(
    private faceService: FaceRecognitionService
  ) {
    // Configurar AWS Amplify na inicialização do componente
    this.configureAWS()
  }

  ngOnInit(): void {
    // Escutar eventos customizados do widget
    this.setupWidgetEventListeners()
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
   * Configura AWS Amplify e SDK com Cognito Identity Pool para o widget Face Liveness
   * O widget AWS Face Liveness precisa que o Amplify Auth esteja configurado
   * Usando apenas Identity Pool (sem login de usuário) conforme aws-exports.ts
   */
  private async configureAWS(): Promise<void> {
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

      // Configurar Amplify com Identity Pool (autenticação anônima)
      // O widget precisa do Amplify configurado para funcionar
      try {
        Amplify.configure({
          Auth: {
            Cognito: {
              identityPoolId: identityPoolId
            }
          }
        })
        
        // Garantir que Amplify está disponível globalmente
        if (!(window as any).Amplify) {
          (window as any).Amplify = Amplify
        }
        
        // Criar stub do Auth para o widget (usando apenas Identity Pool, sem login de usuário)
        // O widget tenta chamar Auth.loginWith(), mas não precisamos de login de usuário
        // O stub será atualizado após o AWS SDK ser configurado
        if (!(window as any).Auth) {
          (window as any).Auth = {
            loginWith: async () => {
              // Para Identity Pool, não precisamos de login de usuário
              // Retornar uma Promise resolvida (o widget precisa disso)
              return Promise.resolve({})
            },
            currentCredentials: async () => {
              // Retornar credenciais atuais do Identity Pool quando disponíveis
              const aws = (window as any).AWS
              if (aws?.config?.credentials) {
                return Promise.resolve(aws.config.credentials)
              }
              return Promise.resolve(null)
            },
            currentUserInfo: async () => {
              // Para Identity Pool anônimo, não há usuário
              return Promise.resolve(null)
            }
          }
        }
        
        console.log('✅ Amplify configurado com Identity Pool')
      } catch (amplifyError: any) {
        console.warn('⚠️ Erro ao configurar Amplify:', amplifyError?.message || amplifyError)
        // Continuar para configurar AWS SDK também
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

      // Obter credenciais temporárias (necessário para autenticação)
      try {
        await new Promise<void>((resolve, reject) => {
          (this.AWS.config.credentials as any).get((err: any) => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          })
        })
        
        this.awsConfigured = true
        console.log('✅ AWS SDK configurado com sucesso usando Cognito Identity Pool')
      } catch (credentialsError: any) {
        console.warn('⚠️ Erro ao obter credenciais do Identity Pool:', credentialsError?.message || credentialsError)
        console.warn('💡 Verifique se o Identity Pool permite acesso anônimo (unauthenticated access)')
        // Continuar mesmo assim - o widget pode tentar obter credenciais depois
        this.awsConfigured = true
      }
    } catch (error: any) {
      console.error('❌ Erro ao configurar AWS SDK:', error)
      this.livenessError = `Erro ao configurar AWS: ${error?.message || error}. Verifique aws-exports.ts e o Identity Pool ID.`
      // Não marcar como configurado para tentar novamente
    }
  }

  private setupWidgetEventListeners(): void {
    // Evento quando a sessão é criada pelo widget
    const sessionHandler = (e: CustomEvent) => {
      console.log('✅ Widget: Sessão criada', e.detail)
      const sessionData = e.detail as any
      
      if (sessionData?.sessionId) {
        this.livenessSession = {
          sessionId: sessionData.sessionId,
          streamingUrl: sessionData.streamingUrl || '',
          transactionId: sessionData.transactionId || crypto.randomUUID() || Date.now().toString(),
          expiresAt: sessionData.expiresAt || new Date(Date.now() + 3 * 60 * 1000).toISOString()
        }
        
        // Configurar timer de expiração
        this.setupSessionExpiry(sessionData.sessionId)
        console.log('✅ Sessão configurada:', this.livenessSession)
      }
    }
    
    // Evento quando liveness é concluído
    const completeHandler = (e: CustomEvent) => {
      console.log('✅ Widget: Liveness completado', e.detail)
      const result = e.detail as any
      
      // Converter resposta do widget para LivenessResultResponse
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
      
      console.log('✅ Resultado do liveness:', this.livenessResult)
      
      this.sessionActive = false
      this.showLivenessWidget = false
      this.livenessLoading = false
    }

    // Evento quando ocorre erro
    const errorHandler = (e: CustomEvent) => {
      console.error('❌ Widget: Erro no liveness', e.detail)
      this.livenessError = e.detail?.message || 'Erro no widget de liveness'
      this.livenessLoading = false
      this.showLivenessWidget = false
      this.sessionActive = false
    }
    
    // Evento de progresso
    const progressHandler = (e: CustomEvent) => {
      console.log('📊 Widget: Progresso', e.detail)
      // Pode usar para atualizar barra de progresso se necessário
    }

    // Escutar eventos do widget
    document.addEventListener('liveness-complete', completeHandler as EventListener)
    document.addEventListener('liveness-error', errorHandler as EventListener)
    document.addEventListener('liveness-session', sessionHandler as EventListener)
    document.addEventListener('liveness-progress', progressHandler as EventListener)
    
    // Eventos alternativos que o widget pode disparar
    document.addEventListener('session-created', sessionHandler as EventListener)
    document.addEventListener('session-ready', sessionHandler as EventListener)

    this.widgetEventListeners = [
      { type: 'liveness-complete', handler: completeHandler as EventListener },
      { type: 'liveness-error', handler: errorHandler as EventListener },
      { type: 'liveness-session', handler: sessionHandler as EventListener },
      { type: 'liveness-progress', handler: progressHandler as EventListener },
      { type: 'session-created', handler: sessionHandler as EventListener },
      { type: 'session-ready', handler: sessionHandler as EventListener }
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
    this.showCameraModal = false
    this.showLivenessWidget = false
    this.cleanup()
  }

  async onLivenessStart(): Promise<void> {
    this.livenessLoading = true
    this.livenessError = null

    try {
      // Garantir que AWS Amplify está configurado antes de inicializar o widget
      if (!this.awsConfigured) {
        await this.configureAWS()
        // Aguardar um pouco para garantir que a configuração foi aplicada
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      
      // IMPORTANTE: O widget AWS Face Liveness deve criar a sessão sozinho
      // Não criar sessão manualmente - deixar o widget fazer isso via create-session-url
      // Isso garante que o widget tenha controle total do ciclo de vida da sessão
      
      console.log('📋 Iniciando widget Face Liveness...')
      console.log('📋 URLs configuradas:', {
        createSessionUrl: this.livenessSessionUrl,
        resultsUrl: this.livenessResultsUrl,
        identityPoolId: this.identityPoolId ? '***' : 'NÃO CONFIGURADO'
      })
      
      // Mostrar o widget - ele criará a sessão automaticamente via create-session-url
      this.showLivenessWidget = true
      this.sessionActive = true
      this.livenessLoading = false
      
      // Aguardar widget montar e inicializar
      setTimeout(() => {
        this.initializeWidget()
      }, 500)
      
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
    // Se foi finalização automática, buscar resultados
    if (event?.autoFinalized && this.livenessSession) {
      await this.fetchResultsAutomatically()
    } else if (event?.manualStop && this.livenessSession) {
      // Se foi parada manual, também buscar resultados
      await this.fetchResultsAutomatically()
    } else if (event) {
      // Se o resultado já veio completo
      this.livenessResult = event
      this.sessionActive = false
      this.closeCameraModal()
    }
  }

  private async fetchResultsAutomatically(): Promise<void> {
    if (!this.livenessSession?.sessionId) return

    this.livenessLoading = true
    this.processingResults = true
    this.processingProgress = 0
    try {
      const resultRequest: GetLivenessResultRequest = {
        sessionId: this.livenessSession.sessionId,
        transactionId: this.livenessSession.transactionId
      }
      
      // Fazer polling para aguardar processamento completo
      const result = await this.pollForResults(resultRequest)
      
      if (result) {
        this.livenessResult = result
        
        // Se ainda está CREATED ou sem imagens, fazer retry imediato
        if (result.status === 'CREATED' || (!result.referenceImageUrl && result.auditImageUrls?.length === 0)) {
          // Aguardar apenas 1 segundo antes do retry (tempo para backend processar)
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          const retryResult = await this.faceService.getLivenessResult(resultRequest).toPromise()
          if (retryResult) {
            this.livenessResult = retryResult
          }
        }
      } else {
        this.livenessError = 'Não foi possível obter resultado da verificação.'
      }
    } catch (err: any) {
      console.error('Erro ao buscar resultado automaticamente:', err)
      this.livenessError = err.message || 'Erro ao obter resultado da verificação.'
    } finally {
      this.livenessLoading = false
      this.processingResults = false
      this.processingProgress = 0
      this.sessionActive = false
      this.closeCameraModal()
    }
  }

  // Polling para aguardar resultados prontos
  private async pollForResults(request: GetLivenessResultRequest, maxAttempts: number = 15, interval: number = 2000): Promise<LivenessResultResponse | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Atualizar progresso (começa em 10%, vai até 90% durante o polling)
        const baseProgress = 10
        const maxProgress = 90
        this.processingProgress = baseProgress + Math.floor((attempt / maxAttempts) * (maxProgress - baseProgress))
        
        const result = await this.faceService.getLivenessResult(request).toPromise()
        
        if (result) {
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
          
          // Se status é SUCCEEDED ou FAILED, retornar imediatamente
          if (statusStr === 'SUCCEEDED' || statusStr === 'FAILED' || statusStr === 'EXPIRED') {
            this.processingProgress = 100
            // Normalizar status antes de retornar
            result.status = statusStr
            return result
          }
          
          // Log de debug se status for CREATED
          if (statusStr === 'CREATED') {
            console.warn(`⚠️ Status ainda CREATED após ${attempt + 1} tentativas. Widget pode não ter transmitido vídeo via WebRTC.`)
            console.warn('🔍 Verificar: Widget inicializado? WebRTC conectou? Cognito configurado?')
          }
          
          // Se tem imagens mesmo com status CREATED, pode ser que esteja processando ainda
          if (result.referenceImageUrl || (result.auditImageUrls && result.auditImageUrls.length > 0)) {
            this.processingProgress = 100
            return result
          }
        }
        
        // Aguardar antes da próxima tentativa (exceto na última)
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, interval))
        }
      } catch (err) {
        console.error(`Erro na tentativa ${attempt + 1}:`, err)
        // Continuar tentando mesmo com erro
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, interval))
        }
      }
    }
    
    // Se chegou aqui, tentar uma última vez
    try {
      return await this.faceService.getLivenessResult(request).toPromise() || null
    } catch {
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

      if (!awsConfig?.credentials) {
        console.warn('⚠️ Credenciais AWS não configuradas. Tentando configurar...')
        await this.configureAWS()
      }

      // Aguardar um pouco para garantir que as credenciais foram obtidas
      await new Promise(resolve => setTimeout(resolve, 1000))

      const finalAwsConfig = (window as any).AWS?.config
      if (finalAwsConfig?.credentials) {
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
        if (!widgetReady) {
          console.warn('⚠️ Widget não sinalizou que está pronto após 5 segundos')
          console.warn('🔍 Possíveis problemas:')
          console.warn('   1. Widget não conseguiu inicializar')
          console.warn('   2. WebRTC não está disponível (requer HTTPS ou localhost)')
          console.warn('   3. Cognito Identity Pool não tem permissões para Face Liveness')
          console.warn('   4. URL de criação de sessão não está acessível ou formato incorreto')
        }
      }, 5000)

      // Escutar evento de ready do widget (se existir)
      const readyHandler = () => {
        widgetReady = true
        clearTimeout(readyTimeout)
        console.log('✅ Widget sinalizou que está pronto')
        this.widgetInitialized = true
      }

      widget.addEventListener('ready', readyHandler)
      widget.addEventListener('liveness-ready', readyHandler)
      widget.addEventListener('session-ready', readyHandler)

      // Timeout adicional para verificar se o widget está transmitindo vídeo
      setTimeout(() => {
        if (this.sessionActive && !this.widgetInitialized) {
          console.warn('⚠️ Widget pode não estar transmitindo vídeo via WebRTC')
          console.warn('🔍 Verificar no console do navegador erros relacionados a WebRTC ou Cognito')
        }
      }, 10000)

    } catch (e: any) {
      console.error('❌ Erro ao inicializar widget:', e)
      this.livenessError = `Erro ao inicializar widget: ${e?.message || 'Erro desconhecido'}`
    }
  }
}
