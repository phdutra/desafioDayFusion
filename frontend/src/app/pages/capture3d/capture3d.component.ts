import { Component, OnInit, OnDestroy, ViewChild, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { StartLivenessRequest, LivenessSessionResponse, GetLivenessResultRequest, LivenessResultResponse } from '../../shared/models/transaction.model'
import { CameraModalComponent } from '../../shared/components/camera-modal/camera-modal.component'
import { environment } from '../../../environments/environment'

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
  livenessSessionUrl = `${environment.apiUrl}/liveness/session`
  livenessResultsUrl = `${environment.apiUrl}/liveness/results`
  awsRegion = environment.aws?.region || 'us-east-1'
  identityPoolId = environment.aws?.identityPoolId || ''
  
  private livenessSession?: LivenessSessionResponse
  private sessionExpiryTimer?: number
  private widgetEventListeners: { type: string; handler: (e: any) => void }[] = []

  constructor(
    private faceService: FaceRecognitionService
  ) {}

  ngOnInit(): void {
    // Escutar eventos customizados do widget
    this.setupWidgetEventListeners()
  }

  ngOnDestroy(): void {
    this.cleanup()
    this.removeWidgetEventListeners()
  }

  private setupWidgetEventListeners(): void {
    // Evento quando liveness é concluído
    const completeHandler = (e: CustomEvent) => {
      console.log('✅ Widget: Liveness completo', e.detail)
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
    }
    
    // Eventos adicionais para debug
    const sessionHandler = (e: CustomEvent) => {
      console.log('📡 Widget: Sessão criada/atualizada', e.detail)
    }
    
    const progressHandler = (e: CustomEvent) => {
      console.log('📊 Widget: Progresso', e.detail)
    }

    document.addEventListener('liveness-complete', completeHandler as EventListener)
    document.addEventListener('liveness-error', errorHandler as EventListener)
    document.addEventListener('liveness-session', sessionHandler as EventListener)
    document.addEventListener('liveness-progress', progressHandler as EventListener)

    this.widgetEventListeners = [
      { type: 'liveness-complete', handler: completeHandler as EventListener },
      { type: 'liveness-error', handler: errorHandler as EventListener },
      { type: 'liveness-session', handler: sessionHandler as EventListener },
      { type: 'liveness-progress', handler: progressHandler as EventListener }
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
      console.log('🔄 Criando sessão de liveness antes de inicializar widget...')
      
      // Criar sessão explicitamente antes de mostrar o widget
      const sessionRequest: StartLivenessRequest = {}
      const sessionResponse = await this.faceService.startLivenessSession(sessionRequest).toPromise()
      
      if (sessionResponse) {
        this.livenessSession = sessionResponse
        console.log('✅ Sessão criada:', sessionResponse.sessionId)
        
        // Configurar timer de expiração
        this.setupSessionExpiry(sessionResponse.sessionId)
        
        // Agora mostrar o widget - ele usará a sessão via create-session-url
        this.showLivenessWidget = true
        this.sessionActive = true
        this.livenessLoading = false
        
        console.log('✅ Widget AWS Face Liveness iniciado. WebRTC será gerenciado automaticamente pelo widget.')
        console.log('📋 SessionId:', sessionResponse.sessionId)
        console.log('🌐 Session URL:', this.livenessSessionUrl)
        console.log('📊 Results URL:', this.livenessResultsUrl)
        
        // Aguardar widget montar e verificar se está funcionando
        setTimeout(() => {
          const widget = document.querySelector('face-liveness-widget')
          if (widget) {
            console.log('✅ Widget encontrado no DOM:', widget)
            console.log('🔍 Widget attributes:', {
              region: widget.getAttribute('region'),
              createSessionUrl: widget.getAttribute('create-session-url'),
              resultsUrl: widget.getAttribute('results-url')
            })
          } else {
            console.warn('⚠️ Widget não encontrado no DOM após 500ms')
          }
        }, 500)
      } else {
        throw new Error('Falha ao criar sessão de liveness')
      }
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
      console.log('🔄 Buscando resultados automaticamente...')
      await this.fetchResultsAutomatically()
    } else if (event?.manualStop && this.livenessSession) {
      // Se foi parada manual, também buscar resultados
      console.log('🔄 Buscando resultados após parada manual...')
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
      
      // Iniciar polling imediatamente sem delay
      console.log('🔄 Iniciando busca de resultados imediatamente...')
      
      // Fazer polling para aguardar processamento completo
      const result = await this.pollForResults(resultRequest)
      
      if (result) {
        this.livenessResult = result
        console.log('✅ Resultado obtido automaticamente:', result)
        
        // Se ainda está CREATED ou sem imagens, fazer retry imediato
        if (result.status === 'CREATED' || (!result.referenceImageUrl && result.auditImageUrls?.length === 0)) {
          console.log('⚠️ Status ainda CREATED ou sem imagens. Fazendo retry imediato...')
          
          // Aguardar apenas 1 segundo antes do retry (tempo para backend processar)
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          const retryResult = await this.faceService.getLivenessResult(resultRequest).toPromise()
          if (retryResult) {
            this.livenessResult = retryResult
            console.log('✅ Resultado após retry:', retryResult)
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
          console.log(`📊 Tentativa ${attempt + 1}/${maxAttempts}: Status=${result.status}, Confiança=${result.confidence}, HasImages=${!!(result.referenceImageUrl || result.auditImageUrls?.length)}`)
          
          // Se status é SUCCEEDED ou FAILED, retornar imediatamente
          if (result.status === 'SUCCEEDED' || result.status === 'FAILED' || result.status === 'EXPIRED') {
            this.processingProgress = 100
            return result
          }
          
          // Se tem imagens mesmo com status CREATED, pode ser que esteja processando ainda
          if (result.referenceImageUrl || (result.auditImageUrls && result.auditImageUrls.length > 0)) {
            console.log('✅ Imagens disponíveis, retornando resultado mesmo com status CREATED')
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
          console.log('✅ Resultado obtido:', result)
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
  }
}
