import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { CameraService } from '../../core/services/camera.service'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { FaceComparisonRequest, FaceComparisonResponse } from '../../shared/models/transaction.model'
import { LivenessModalComponent } from '../../components/liveness-modal/liveness-modal.component'
import { LivenessSummary } from '../../core/models/liveness-result.model'
import { VoiceStep } from '../../core/models/voice-step.model'

@Component({
  selector: 'app-capture',
  standalone: true,
  imports: [CommonModule, FormsModule, LivenessModalComponent],
  templateUrl: './capture.component.html',
  styleUrls: ['./capture.component.scss']
})
export class CaptureComponent implements OnInit, OnDestroy {
  @ViewChild('video', { static: false }) videoRef?: ElementRef<HTMLVideoElement>
  @ViewChild(LivenessModalComponent) livenessModal?: LivenessModalComponent

  cameraReady = false
  selfieDataUrl: string | null = null
  selfieUploadedKey: string | null = null
  selfieViewUrl: string | null = null
  documentFile: File | null = null
  documentPreview: string | null = null
  documentUploadedKey: string | null = null
  documentViewUrl: string | null = null
  loading = false
  transactionId: string | null = null
  result: FaceComparisonResponse | null = null
  statusMessage: string | null = null
  
  // Face detection
  detectionStatus: 'idle' | 'detecting' | 'ready' | 'captured' = 'idle'
  detectionProgress: number = 0
  progressDashArray = 2 * Math.PI * 145 // Circunferência do círculo (raio 145)
  progressDashOffset = 0
  detectionInterval?: number
  
  // Modal state
  showCameraModal = false
  showLivenessModal = false

  // Liveness 3D state (novo fluxo com componente reutilizável)
  livenessSummary: LivenessSummary | null = null
  livenessError: string | null = null

  voiceSteps: VoiceStep[] = [
    { texto: 'Olhe para frente', delay: 1500, posicao: 'frente' },
    { texto: 'Vire à esquerda', delay: 2000, posicao: 'esquerda' },
    { texto: 'Vire à direita', delay: 2000, posicao: 'direita' }
  ]

  constructor(
    private cameraService: CameraService,
    private faceService: FaceRecognitionService
  ) {}

  async ngOnInit(): Promise<void> {
    // Optionally start camera automatically
  }

  ngOnDestroy(): void {
    this.stopDetection()
    this.stopCamera()
  }

  async startCamera(): Promise<void> {
    if (!this.videoRef) return
    const supported = await this.cameraService.checkCameraSupport()
    if (!supported) {
      alert('Câmera não suportada neste navegador')
      return
    }
    const stream = await this.cameraService.getMediaStream()
    this.videoRef.nativeElement.srcObject = stream
    this.cameraReady = true
    this.detectionStatus = 'detecting'
    this.startFaceDetection()
  }

  stopCamera(): void {
    this.stopDetection()
    this.cameraService.stopStream()
    this.cameraReady = false
    this.detectionStatus = 'idle'
    this.detectionProgress = 0
    this.progressDashOffset = this.progressDashArray
  }

  retakePhoto(): void {
    this.selfieDataUrl = null
    this.detectionStatus = 'detecting'
    this.detectionProgress = 0
    this.progressDashOffset = this.progressDashArray
    this.startFaceDetection()
  }

  startFaceDetection(): void {
    if (!this.videoRef || !this.cameraReady) return
    
    // Simulação de detecção de rosto com progresso
    let progress = 0
    const updateProgress = () => {
      if (this.detectionStatus === 'captured') return
      
      progress += 2
      if (progress > 100) {
        progress = 100
      }
      
      this.detectionProgress = progress
      this.progressDashOffset = this.progressDashArray * (1 - progress / 100)
      
      if (progress >= 100) {
        this.detectionStatus = 'ready'
      }
      
      if (this.detectionStatus !== 'ready') {
        this.detectionInterval = window.setTimeout(updateProgress, 50)
      }
    }
    
    updateProgress()
  }

  stopDetection(): void {
    if (this.detectionInterval) {
      clearTimeout(this.detectionInterval)
      this.detectionInterval = undefined
    }
  }

  getDetectionStatusText(): string {
    switch (this.detectionStatus) {
      case 'detecting':
        return 'Ajuste sua posição...'
      case 'ready':
        return 'Posição perfeita!'
      case 'captured':
        return 'Capturado!'
      default:
        return ''
    }
  }

  async captureSelfie(): Promise<void> {
    if (!this.videoRef || this.detectionStatus !== 'ready') return
    this.stopDetection()
    this.detectionStatus = 'captured'
    this.selfieDataUrl = await this.cameraService.capturePhoto(this.videoRef.nativeElement)
    // Fecha o modal após captura bem-sucedida
    setTimeout(() => {
      this.closeCameraModal()
    }, 500)
    // Only capture the selfie; uploading is triggered explicitly by the Upload button
  }
  
  // Modal control methods
  openCameraModal(): void {
    this.showCameraModal = true
    // Inicia a câmera automaticamente ao abrir o modal
    setTimeout(() => {
      this.startCamera()
    }, 100)
  }
  
  closeCameraModal(): void {
    this.showCameraModal = false
    this.stopCamera()
  }
  
  onModalBackdropClick(event: Event): void {
    // Fecha o modal ao clicar no backdrop
    if (event.target === event.currentTarget) {
      this.closeCameraModal()
    }
  }

  private async uploadSelfieOnly(): Promise<void> {
    if (!this.selfieDataUrl) return
    this.loading = true
    this.statusMessage = null
    this.selfieUploadedKey = null
    this.selfieViewUrl = null

    try {
      const selfieFile = this.dataUrlToFile(this.selfieDataUrl, 'selfie.jpg')
      const selfieUpload = await this.faceService.uploadViaApi(selfieFile, this.transactionId ?? undefined).toPromise()
      if (!selfieUpload) throw new Error('Failed to upload selfie via API')
      this.selfieUploadedKey = selfieUpload.key
      const view = await this.faceService.generateDownloadUrl(selfieUpload.key).toPromise()
      this.selfieViewUrl = view?.url || null
      this.statusMessage = 'Selfie uploaded successfully.'
    } catch (err) {
      console.error(err)
      alert('Error uploading selfie. Please try again.')
    } finally {
      this.loading = false
    }
  }

  onDocumentSelected(evt: Event): void {
    const input = evt.target as HTMLInputElement
    const file = input.files && input.files[0]
    if (!file) return
    this.documentFile = file
    this.documentPreview = URL.createObjectURL(file)
  }

  canValidate(): boolean {
    // Allow upload with only selfie
    return !!this.selfieDataUrl
  }

  private dataUrlToFile(dataUrl: string, filename: string): File {
    const arr = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)?.[1] ?? 'image/jpeg'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) u8arr[n] = bstr.charCodeAt(n)
    return new File([u8arr], filename, { type: mime })
  }

  onUploadClick(): void {
    if (this.documentFile) {
      this.uploadAndValidate()
    } else {
      this.uploadSelfieOnly()
    }
  }

  async uploadAndValidate(): Promise<void> {
    if (!this.selfieDataUrl || !this.documentFile) return
    this.loading = true
    this.result = null

    try {
      const selfieFile = this.dataUrlToFile(this.selfieDataUrl, 'selfie.jpg')
      // 1) Upload selfie via API
      const selfieUpload = await this.faceService.uploadViaApi(selfieFile, this.transactionId ?? undefined).toPromise()
      if (!selfieUpload) throw new Error('Failed to upload selfie via API')

      // 2) Upload document via API
      const docUpload = await this.faceService.uploadViaApi(this.documentFile, this.transactionId ?? undefined).toPromise()
      if (!docUpload) throw new Error('Failed to upload document via API')
      this.documentUploadedKey = docUpload.key

      const [selfieDL, docDL] = await Promise.all([
        this.faceService.generateDownloadUrl(selfieUpload.key).toPromise(),
        this.faceService.generateDownloadUrl(docUpload.key).toPromise()
      ])
      this.selfieViewUrl = selfieDL?.url || null
      this.documentViewUrl = docDL?.url || null

      // 3) Compare faces
      const compareReq: FaceComparisonRequest = {
        selfieKey: selfieUpload.key,
        documentKey: docUpload.key,
        transactionId: this.transactionId ?? undefined,
      }
      
      console.log('🔍 [Capture] Starting face comparison with request:', {
        selfieKey: compareReq.selfieKey,
        documentKey: compareReq.documentKey,
        transactionId: compareReq.transactionId
      })
      
      const compare = await this.faceService.compareFaces(compareReq).toPromise()
      
      console.log('📥 [Capture] Face comparison response received:', {
        similarityScore: compare?.similarityScore,
        status: compare?.status,
        message: compare?.message,
        transactionId: compare?.transactionId,
        fullResponse: compare
      })
      
      if (compare) {
        this.result = compare
        this.transactionId = compare.transactionId
        
        if (compare.similarityScore === 0 || compare.similarityScore === null || compare.similarityScore === undefined) {
          console.warn('⚠️ [Capture] WARNING: Similarity score is 0 or null!', {
            score: compare.similarityScore,
            status: compare.status,
            message: compare.message
          })
        }
      } else {
        console.error('❌ [Capture] No response received from face comparison API')
      }
    } catch (err) {
      console.error(err)
      alert('There was an error during validation. Please try again.')
    } finally {
      this.loading = false
    }
  }

  // Face Liveness 3D Methods
  startLiveness3D(): void {
    this.livenessError = null
    this.livenessSummary = null
    this.showLivenessModal = true

    // Inicia a sessão automaticamente ao renderizar o modal
    const autoStart = async (attempt = 0) => {
      if (!this.livenessModal) {
        if (attempt < 10) {
          setTimeout(() => autoStart(attempt + 1), 100)
        }
        return
      }

      try {
        await this.livenessModal.startSession()
      } catch (error: any) {
        console.error('❌ Erro ao iniciar sessão de liveness 3D automaticamente:', error)
        this.livenessError = error?.message || 'Erro ao iniciar verificação 3D.'
      }
    }

    setTimeout(() => autoStart(), 50)
  }

  closeLivenessModal(): void {
    if (this.livenessModal) {
      this.livenessModal.cancelSession()
    }
    this.showLivenessModal = false
  }

  onLivenessSessionCompleted(summary: LivenessSummary): void {
    this.livenessSummary = summary
    this.livenessError = null
    this.closeLivenessModal()
    this.statusMessage = 'Verificação 3D concluída com sucesso.'
  }

  onLivenessSessionFailed(message: string): void {
    this.livenessError = message
  }
}
