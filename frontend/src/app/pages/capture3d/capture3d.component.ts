import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { StartLivenessRequest, LivenessSessionResponse, GetLivenessResultRequest, LivenessResultResponse } from '../../shared/models/transaction.model'
import { CameraModalComponent } from '../../shared/components/camera-modal/camera-modal.component'
import 'webrtc-adapter'

@Component({
  selector: 'app-capture3d',
  standalone: true,
  imports: [CommonModule, FormsModule, CameraModalComponent],
  templateUrl: './capture3d.component.html',
  styleUrls: ['./capture3d.component.scss']
})
export class Capture3dComponent implements OnInit, OnDestroy {
  @ViewChild(CameraModalComponent) cameraModal?: CameraModalComponent

  livenessLoading = false
  livenessError: string | null = null
  livenessResult: LivenessResultResponse | null = null
  sessionActive = false
  
  // Modal state
  showCameraModal = false
  
  private peerConnection?: RTCPeerConnection
  private livenessSession?: LivenessSessionResponse

  constructor(
    private faceService: FaceRecognitionService
  ) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.cleanup()
  }

  openCameraModal(): void {
    this.resetResult() // Limpar resultado anterior
    this.showCameraModal = true
  }

  closeCameraModal(): void {
    this.showCameraModal = false
    this.cleanup()
  }

  async onLivenessStart(): Promise<void> {
    this.livenessLoading = true
    this.livenessError = null

    try {
      // 1. Criar sessão no backend conforme README: POST /api/liveness/start
      const request: StartLivenessRequest = {}
      const session = await this.faceService.startLivenessSession(request).toPromise()
      if (!session || !session.sessionId) {
        throw new Error('Falha ao criar sessão de liveness')
      }

      this.livenessSession = session
      console.log('✅ Sessão criada:', session.sessionId)

      // 2. Tentar iniciar WebRTC com stream do modal (se disponível)
      // Nota: Para WebRTC completo com AWS Rekognition, é necessário:
      // - Obter streaming URL do backend ou usar AWS Amplify UI
      // - Fazer handshake WebRTC com os servidores da AWS
      // Por enquanto, o backend faz polling e consegue obter resultados mesmo sem WebRTC completo
      const stream = this.cameraModal?.getStream()
      if (stream) {
        try {
          await this.startWebRTCSession(stream)
        } catch (webrtcError) {
          console.warn('⚠️ WebRTC não pôde ser iniciado completamente:', webrtcError)
          // Continuar mesmo sem WebRTC completo - backend fará polling
        }
      }

      this.sessionActive = true
      this.livenessLoading = false
      console.log('✅ Sessão iniciada (backend fará polling para obter resultados)')
    } catch (err: any) {
      console.error('Erro ao iniciar liveness:', err)
      this.livenessError = err.message || 'Erro ao iniciar verificação 3D.'
      this.livenessLoading = false
    }
  }

  private async startWebRTCSession(stream: MediaStream): Promise<void> {
    try {
      // Criar conexão WebRTC
      this.peerConnection = new RTCPeerConnection({
        iceServers: [] // AWS Rekognition fornece seus próprios servidores
      })

      // Adicionar trilha de vídeo
      stream.getTracks().forEach(track => {
        this.peerConnection!.addTrack(track, stream)
      })

      // Criar oferta SDP
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      })

      await this.peerConnection.setLocalDescription(offer)
      console.log('📡 Oferta SDP criada')

      // TODO: Enviar offer.sdp para backend que fará handshake com AWS
      // Por enquanto, apenas logamos o SDP
      console.log('SDP:', offer.sdp)

      // Event listeners para ICE candidates
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('ICE Candidate:', event.candidate)
          // TODO: Enviar candidate para backend
        }
      }

      this.peerConnection.onconnectionstatechange = () => {
        console.log('Estado WebRTC:', this.peerConnection?.connectionState)
      }

    } catch (error) {
      console.error('⚠️ Erro ao iniciar sessão WebRTC:', error)
      throw error
    }
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
    try {
      const resultRequest: GetLivenessResultRequest = {
        sessionId: this.livenessSession.sessionId,
        transactionId: this.livenessSession.transactionId
      }
      
      // Aguardar um pouco antes de começar o polling
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      // Fazer polling para aguardar processamento completo
      const result = await this.pollForResults(resultRequest)
      
      if (result) {
        this.livenessResult = result
        console.log('✅ Resultado obtido automaticamente:', result)
        
        // Se ainda está CREATED ou sem imagens, tentar mais uma vez após delay
        if (result.status === 'CREATED' || (!result.referenceImageUrl && result.auditImageUrls?.length === 0)) {
          console.log('⚠️ Status ainda CREATED ou sem imagens. Aguardando mais tempo...')
          await new Promise(resolve => setTimeout(resolve, 5000))
          
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
      this.sessionActive = false
      this.closeCameraModal()
    }
  }

  // Polling para aguardar resultados prontos
  private async pollForResults(request: GetLivenessResultRequest, maxAttempts: number = 10, interval: number = 3000): Promise<LivenessResultResponse | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await this.faceService.getLivenessResult(request).toPromise()
        
        if (result) {
          console.log(`📊 Tentativa ${attempt + 1}/${maxAttempts}: Status=${result.status}, Confiança=${result.confidence}, HasImages=${!!(result.referenceImageUrl || result.auditImageUrls?.length)}`)
          
          // Se status é SUCCEEDED ou FAILED, retornar imediatamente
          if (result.status === 'SUCCEEDED' || result.status === 'FAILED' || result.status === 'EXPIRED') {
            return result
          }
          
          // Se tem imagens mesmo com status CREATED, pode ser que esteja processando ainda
          if (result.referenceImageUrl || (result.auditImageUrls && result.auditImageUrls.length > 0)) {
            console.log('✅ Imagens disponíveis, retornando resultado mesmo com status CREATED')
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
    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = undefined
    }
  }
}
