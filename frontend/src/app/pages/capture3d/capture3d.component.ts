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
      // 1. Criar sessão no backend
      const request: StartLivenessRequest = {}
      const session = await this.faceService.startLivenessSession(request).toPromise()
      if (!session) throw new Error('Falha ao criar sessão de liveness')

      this.livenessSession = session
      console.log('✅ Sessão criada:', session.sessionId)

      // 2. Iniciar WebRTC com stream do modal
      const stream = this.cameraModal?.getStream()
      if (stream) {
        await this.startWebRTCSession(stream)
      }

      this.sessionActive = true
      this.livenessLoading = false
      console.log('✅ Sessão WebRTC iniciada')
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

  onLivenessComplete(result: any): void {
    this.livenessResult = result
    this.sessionActive = false
    this.closeCameraModal()
  }

  async stopSession(): Promise<void> {
    if (this.livenessSession) {
      try {
        // Buscar resultados do liveness
        const resultRequest: GetLivenessResultRequest = {
          sessionId: this.livenessSession.sessionId,
          transactionId: this.livenessSession.transactionId
        }
        
        const result = await this.faceService.getLivenessResult(resultRequest).toPromise()
        if (result) {
          this.livenessResult = result
          console.log('✅ Resultado obtido:', result)
        }
      } catch (err: any) {
        console.error('Erro ao buscar resultado:', err)
        this.livenessError = 'Erro ao obter resultado da verificação.'
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

  private cleanup(): void {
    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = undefined
    }
  }
}
