import { Component, OnInit, OnDestroy, AfterViewInit, OnChanges, SimpleChanges, ViewChild, ElementRef, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core'
import { CommonModule } from '@angular/common'
import { CameraService } from '../../../core/services/camera.service'
import { FaceRecognitionService } from '../../../core/services/face-recognition.service'
import { firstValueFrom } from 'rxjs'

export type CameraMode = '2d' | '3d'

@Component({
  selector: 'app-camera-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './camera-modal.component.html',
  styleUrls: ['./camera-modal.component.scss']
})
export class CameraModalComponent implements OnInit, OnDestroy, AfterViewInit, OnChanges {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>
  
  @Input() mode: CameraMode = '2d'
  @Input() isOpen: boolean = false
  
  @Output() close = new EventEmitter<void>()
  @Output() capture = new EventEmitter<string>()
  @Output() livenessStart = new EventEmitter<void>()
  @Output() livenessComplete = new EventEmitter<any>()

  cameraReady = false
  cameraInitializing = false
  error: string | null = null
  
  // 2D face detection
  detectionStatus: 'idle' | 'detecting' | 'ready' | 'captured' = 'idle'
  detectionProgress: number = 0
  progressDashArray = 2 * Math.PI * 145
  progressDashOffset = 0
  detectionInterval?: number

  // 3D liveness
  sessionActive = false
  faceDetected = false
  validatingPosition = false
  validationMessage = ''
  
  // Instruções de voz e fases automáticas
  currentPhase: 'waiting' | 'positioning' | 'validating' | 'recording' | 'processing' | 'completed' = 'waiting'
  currentLivenessStep: 'center' | 'right' | 'left' | 'blink_smile' | 'completed' = 'center'
  phaseInstructions: string[] = []
  private speechSynthesis: SpeechSynthesis | null = null
  private currentSpeechUtterance: SpeechSynthesisUtterance | null = null
  private phaseCheckInterval?: number
  private autoFinalizeTimer?: number
  private livenessStepTimer?: number
  
  private stream?: MediaStream
  private validationInterval?: number

  constructor(
    private cameraService: CameraService,
    private faceService: FaceRecognitionService,
    private cdr: ChangeDetectorRef
  ) {
    // Inicializar síntese de voz se disponível
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.speechSynthesis = window.speechSynthesis
    }
  }

  ngOnInit(): void {}

  async ngAfterViewInit(): Promise<void> {
    if (this.isOpen) {
      await this.initializeCamera()
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        setTimeout(() => this.initializeCamera(), 100)
      } else {
        this.cleanup()
      }
    }
  }

  ngOnDestroy(): void {
    this.cleanup()
  }

  async initializeCamera(): Promise<void> {
    if (!this.isOpen) return
    
    this.cameraInitializing = true
    this.error = null
    this.cdr.detectChanges()

    try {
      console.log('🎥 Iniciando acesso à câmera...')
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('API de mídia não suportada neste navegador')
      }

      this.stream = await this.cameraService.getMediaStream()
      
      console.log('✅ Stream obtido, configurando vídeo...')
      
      // Aguardar até o elemento estar disponível
      let retries = 0
      while (!this.videoElement?.nativeElement && retries < 10) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries++
        this.cdr.detectChanges()
      }

      if (this.videoElement?.nativeElement) {
        const video = this.videoElement.nativeElement
        video.srcObject = this.stream
        
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timeout aguardando vídeo ficar pronto'))
          }, 5000)
          
          const onReady = () => {
            clearTimeout(timeout)
            video.removeEventListener('loadedmetadata', onReady)
            video.removeEventListener('canplay', onReady)
            resolve()
          }
          
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            clearTimeout(timeout)
            resolve()
          } else {
            video.addEventListener('loadedmetadata', onReady, { once: true })
            video.addEventListener('canplay', onReady, { once: true })
          }
        })
        
        await video.play()
        this.cameraReady = true
        this.cameraInitializing = false
        
        if (this.mode === '2d') {
          this.startFaceDetection()
        } else if (this.mode === '3d') {
          // Iniciar validação de posicionamento para 3D
          this.currentPhase = 'waiting'
          this.speakInstruction('Olá! Vou guiá-lo durante a verificação. Primeiro, posicione seu rosto no centro da tela.')
          this.startPositionValidation()
        }
        
        this.cdr.detectChanges()
        console.log('✅ Câmera iniciada com sucesso')
      } else {
        throw new Error('Elemento de vídeo não encontrado no DOM')
      }
    } catch (error: any) {
      console.error('❌ Erro ao acessar a câmera:', error)
      this.error = error.message || 'Erro ao acessar a câmera. Verifique as permissões.'
      this.cameraInitializing = false
      this.cdr.detectChanges()
    }
  }

  closeModal(): void {
    this.cleanup()
    this.close.emit()
  }

  onBackdropClick(event: Event): void {
    if (event.target === event.currentTarget) {
      this.closeModal()
    }
  }

  // 2D Face Detection
  startFaceDetection(): void {
    if (!this.videoElement || !this.cameraReady || this.mode !== '2d') return
    
    this.detectionStatus = 'detecting'
    let progress = 0
    
    const updateProgress = () => {
      if (this.detectionStatus === 'captured' || !this.isOpen) return
      
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

  stopFaceDetection(): void {
    if (this.detectionInterval) {
      clearTimeout(this.detectionInterval)
      this.detectionInterval = undefined
    }
  }

  async capturePhoto(): Promise<void> {
    if (!this.videoElement || this.detectionStatus !== 'ready' || this.mode !== '2d') return
    
    this.stopFaceDetection()
    this.detectionStatus = 'captured'
    
    try {
      const dataUrl = await this.cameraService.capturePhoto(this.videoElement.nativeElement)
      this.capture.emit(dataUrl)
      setTimeout(() => this.closeModal(), 300)
    } catch (error) {
      console.error('Erro ao capturar foto:', error)
      this.error = 'Erro ao capturar foto. Tente novamente.'
      this.detectionStatus = 'ready'
      this.startFaceDetection()
    }
  }

  // Instruções de voz
  speakInstruction(text: string, lang: string = 'pt-BR'): void {
    if (!this.speechSynthesis) return
    
    // Cancelar fala anterior se existir
    if (this.currentSpeechUtterance) {
      this.speechSynthesis.cancel()
    }
    
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.volume = 1.0
    
    utterance.onend = () => {
      this.currentSpeechUtterance = null
    }
    
    utterance.onerror = (error) => {
      console.warn('Erro na síntese de voz:', error)
      this.currentSpeechUtterance = null
    }
    
    this.currentSpeechUtterance = utterance
    this.speechSynthesis.speak(utterance)
  }

  stopSpeaking(): void {
    if (this.speechSynthesis) {
      this.speechSynthesis.cancel()
      this.currentSpeechUtterance = null
    }
  }

  // 3D Position Validation - Contínua
  startPositionValidation(): void {
    if (this.mode !== '3d' || !this.cameraReady || !this.videoElement) return
    
    this.currentPhase = 'positioning'
    this.faceDetected = false
    this.validationMessage = 'Aguardando câmera...'
    this.validatingPosition = true
    
    let validationAttempts = 0
    let consecutiveFailures = 0
    
    // Validar continuamente a cada 3 segundos
    const validatePosition = async () => {
      if (!this.isOpen || this.mode !== '3d' || this.sessionActive) {
        this.stopPositionValidation()
        return
      }
      
      validationAttempts++
      
      try {
        this.validationMessage = 'Analisando posição...'
        this.cdr.detectChanges()
        
        // Capturar frame atual
        const dataUrl = await this.cameraService.capturePhoto(this.videoElement.nativeElement)
        
        // Converter para File
        const file = this.dataUrlToFile(dataUrl, `validation_${Date.now()}.jpg`)
        
        // Fazer upload e verificar face
        const uploadResult = await firstValueFrom(this.faceService.uploadViaApi(file))
        
        if (uploadResult?.key) {
          // Verificar se há face na imagem
          const hasFace = await firstValueFrom(this.faceService.detectFaces(uploadResult.key))
          
          console.log(`🔍 Validação #${validationAttempts}: Face detectada = ${hasFace}`)
          
          if (hasFace) {
            this.faceDetected = true
            this.currentPhase = 'validating'
            this.validationMessage = '✓ Posição perfeita! Iniciando verificação...'
            this.error = null
            consecutiveFailures = 0
            this.cdr.detectChanges()
            
            // Instrução de voz
            this.speakInstruction('Posição perfeita! Iniciando a verificação automaticamente em 3 segundos.')
            
            // Parar validação
            this.stopPositionValidation()
            
            // Atualizar mensagem para mostrar countdown
            let countdown = 3
            const countdownInterval = setInterval(() => {
              countdown--
              if (countdown > 0) {
                this.validationMessage = `✓ Tudo certo! Iniciando em ${countdown}...`
                this.cdr.detectChanges()
              } else {
                clearInterval(countdownInterval)
                this.validationMessage = '✓ Iniciando agora...'
                this.cdr.detectChanges()
              }
            }, 1000)
            
            // Iniciar automaticamente após 3 segundos
            setTimeout(() => {
              clearInterval(countdownInterval)
              if (this.faceDetected && !this.sessionActive && this.isOpen) {
                console.log('🚀 Iniciando liveness automaticamente após detecção...')
                this.startLiveness3D()
              }
            }, 3000)
            
            return
          } else {
            this.faceDetected = false
            consecutiveFailures++
            
            // Mensagens rotativas para evitar repetição
            const messages = [
              'Rosto não detectado. Centralize seu rosto no guia',
              'Ajuste: Fique mais próximo da câmera',
              'Certifique-se de que seu rosto está totalmente visível',
              'Mantenha os olhos abertos e olhe para a câmera',
              'Evite movimentos bruscos e mantenha-se centralizado'
            ]
            
            // Rotacionar mensagens
            const messageIndex = (validationAttempts - 1) % messages.length
            this.validationMessage = messages[messageIndex]
            
            // Instruções de voz apenas a cada 3 tentativas para não sobrecarregar
            if (validationAttempts % 3 === 0) {
              const voiceMessages = [
                'Por favor, centralize seu rosto no centro da tela',
                'Fique mais próximo da câmera e certifique-se de que seu rosto está totalmente visível',
                'Mantenha os olhos abertos e olhe diretamente para a câmera'
              ]
              const voiceIndex = Math.floor((validationAttempts - 1) / 3) % voiceMessages.length
              this.speakInstruction(voiceMessages[voiceIndex])
            }
            
            // Se muitas falhas consecutivas, pode ser problema técnico
            if (consecutiveFailures >= 5) {
              this.validationMessage = 'A detecção está demorando. Verifique se há luz suficiente e tente reposicionar'
            }
            
            console.warn(`⚠️ Validação #${validationAttempts} falhou. Tentativas consecutivas: ${consecutiveFailures}`)
          }
        } else {
          this.faceDetected = false
          this.validationMessage = 'Erro ao fazer upload da imagem'
          console.error('Upload falhou - sem key retornada')
        }
      } catch (error: any) {
        console.error('Erro na validação de posição:', error)
        this.faceDetected = false
        consecutiveFailures++
        
        // Mensagens de erro mais específicas
        if (error?.message?.includes('camera') || error?.message?.includes('permission')) {
          this.validationMessage = 'Erro na câmera. Verifique as permissões'
        } else if (error?.status === 404 || error?.message?.includes('404')) {
          this.validationMessage = 'Erro: Endpoint não encontrado. Verifique a API'
        } else if (error?.status === 0 || error?.message?.includes('Network')) {
          this.validationMessage = 'Erro de conexão. Verifique sua internet'
        } else {
          this.validationMessage = `Erro ao validar (tentativa ${validationAttempts})`
        }
        
        // Após muitos erros, sugerir recarregar
        if (consecutiveFailures >= 3 && validationAttempts > 5) {
          this.validationMessage = 'Muitos erros. Tente fechar e abrir o modal novamente'
        }
      }
      
      this.cdr.detectChanges()
      
      // Continuar validando se ainda não detectou e modal está aberto
      if (!this.faceDetected && this.isOpen && !this.sessionActive) {
        this.validationInterval = window.setTimeout(validatePosition, 3000)
      }
    }
    
    // Iniciar primeira validação após 1.5 segundos
    setTimeout(validatePosition, 1500)
  }

  stopPositionValidation(): void {
    if (this.validationInterval) {
      clearTimeout(this.validationInterval)
      this.validationInterval = undefined
    }
    this.validatingPosition = false
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

  // 3D Liveness
  async startLiveness3D(): Promise<void> {
    if (this.mode !== '3d' || !this.cameraReady || !this.stream) {
      this.error = 'Câmera não está pronta. Aguarde...'
      return
    }

    // Validar posição antes de iniciar
    if (!this.faceDetected) {
      this.error = 'Posicione seu rosto corretamente antes de iniciar.'
      // Tentar validar novamente
      this.startPositionValidation()
      return
    }

    this.stopPositionValidation()
    this.stopSpeaking()
    this.sessionActive = true
    this.currentPhase = 'recording'
    this.currentLivenessStep = 'center'
    
    // Instruções iniciais de gravação
    this.speakInstruction('Gravação iniciada. Olhe para a câmera e mantenha-se preparado. Vou pedir três movimentos.')
    
    this.livenessStart.emit()
    console.log('✅ Liveness 3D iniciado')
    
    // Iniciar sequência de movimentos após 3 segundos
    setTimeout(() => {
      this.startLivenessSteps()
    }, 3000)
    
    // Iniciar verificação automática de conclusão (tempo total ajustado)
    this.startAutoFinalization()
  }

  // Sequência de etapas do liveness: direita, esquerda, piscar e sorrir
  startLivenessSteps(): void {
    if (!this.sessionActive || !this.isOpen) return

    // Etapa 1: Virar para direita
    // PRIMEIRO: Falar a instrução e aguardar ela começar (usar evento onstart)
    const utterance1 = this.createUtterance('Por favor, vire lentamente seu rosto para a direita.')
    utterance1.onstart = () => {
      // Quando a voz começar a falar, mostrar instrução visual após 1.2s
      setTimeout(() => {
        if (this.sessionActive && this.isOpen) {
          this.currentLivenessStep = 'right'
          this.cdr.detectChanges()
        }
      }, 1200)
    }
    this.speechSynthesis?.speak(utterance1)

    // Etapa 2: Virar para esquerda (após 6 segundos - 5s ação + 1s buffer)
    this.livenessStepTimer = window.setTimeout(() => {
      if (!this.sessionActive || !this.isOpen) return
      
      // Reset visual temporário
      this.currentLivenessStep = 'center'
      this.cdr.detectChanges()
      
      // PRIMEIRO: Falar a instrução
      const utterance2 = this.createUtterance('Agora, vire lentamente seu rosto para a esquerda.')
      utterance2.onstart = () => {
        // Quando a voz começar, mostrar instrução visual após 1.2s
        setTimeout(() => {
          if (this.sessionActive && this.isOpen) {
            this.currentLivenessStep = 'left'
            this.cdr.detectChanges()
          }
        }, 1200)
      }
      this.speechSynthesis?.speak(utterance2)

      // Etapa 3: Piscar e sorrir (após mais 6 segundos)
      this.livenessStepTimer = window.setTimeout(() => {
        if (!this.sessionActive || !this.isOpen) return
        
        // Reset visual temporário
        this.currentLivenessStep = 'center'
        this.cdr.detectChanges()
        
        // PRIMEIRO: Falar a instrução
        const utterance3 = this.createUtterance('Agora, piscar os olhos e sorrir.')
        utterance3.onstart = () => {
          // Quando a voz começar, mostrar instrução visual após 1.2s
          setTimeout(() => {
            if (this.sessionActive && this.isOpen) {
              this.currentLivenessStep = 'blink_smile'
              this.cdr.detectChanges()
            }
          }, 1200)
        }
        this.speechSynthesis?.speak(utterance3)

        // Finalizar etapas após mais 4 segundos
        this.livenessStepTimer = window.setTimeout(() => {
          if (!this.sessionActive || !this.isOpen) return
          this.currentLivenessStep = 'completed'
          this.speakInstruction('Muito bem! Mantenha-se imóvel. Processando resultados.')
          this.cdr.detectChanges()
        }, 4000)
      }, 6000)
    }, 6000)
  }

  // Método auxiliar para criar utterance com configurações
  private createUtterance(text: string): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'pt-BR'
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.volume = 1.0
    return utterance
  }

  // Finalização automática da fase de gravação
  startAutoFinalization(): void {
    // Limpar timer anterior se existir
    if (this.autoFinalizeTimer) {
      clearTimeout(this.autoFinalizeTimer)
    }

    // Tempo ajustado para incluir as 3 etapas + tempo de processamento do backend:
    // 3s (início) + 5s (direita) + 5s (esquerda) + 4s (piscar/sorrir) + 15s (processamento backend) = ~32 segundos
    const minRecordingTime = 32000 // 32 segundos mínimo (tempo para completar etapas + backend processar)
    const maxRecordingTime = 45000 // 45 segundos máximo
    
    // Primeira verificação após tempo mínimo
    this.autoFinalizeTimer = window.setTimeout(() => {
      if (this.sessionActive && this.isOpen) {
        // Se ainda não completou todas as etapas, aguardar um pouco mais
        if (this.currentLivenessStep !== 'completed') {
          console.log('⏱️ Aguardando conclusão das etapas...')
          // Aguardar mais 5 segundos
          this.autoFinalizeTimer = window.setTimeout(() => {
            if (this.sessionActive && this.isOpen) {
              this.processResultsAndFinalize()
            }
          }, 5000)
        } else {
          this.processResultsAndFinalize()
        }
      }
    }, minRecordingTime)
  }

  private processResultsAndFinalize(): void {
    console.log('⏱️ Tempo mínimo de gravação atingido. Verificando se pode finalizar...')
    this.speakInstruction('Processando resultados. Aguarde um momento.')
    this.currentPhase = 'processing'
    this.cdr.detectChanges()
    
    // Aguardar um pouco antes de finalizar completamente
    setTimeout(() => {
      if (this.sessionActive && this.isOpen) {
        console.log('✅ Finalizando automaticamente após tempo máximo')
        this.finalizeLivenessAutomatically()
      }
    }, 3000)
  }

  finalizeLivenessAutomatically(): void {
    if (!this.sessionActive) return
    
    this.currentPhase = 'completed'
    this.stopSpeaking()
    this.speakInstruction('Verificação concluída. Processando resultados finais.')
    
    // Emitir evento de conclusão para o componente pai
    // O componente pai deve buscar os resultados e finalizar
    this.livenessComplete.emit({ autoFinalized: true })
    
    // Fechar modal após um breve delay para o usuário ouvir a mensagem
    setTimeout(() => {
      this.sessionActive = false
      // Não fechar modal automaticamente - deixar componente pai gerenciar
      // this.closeModal()
    }, 2000)
  }

  stopLiveness(): void {
    this.stopSpeaking()
    this.sessionActive = false
    this.currentPhase = 'completed'
    this.currentLivenessStep = 'completed'
    
    if (this.autoFinalizeTimer) {
      clearTimeout(this.autoFinalizeTimer)
      this.autoFinalizeTimer = undefined
    }
    
    if (this.livenessStepTimer) {
      clearTimeout(this.livenessStepTimer)
      this.livenessStepTimer = undefined
    }
    
    // Emitir evento de conclusão manual
    this.livenessComplete.emit({ manualStop: true })
    
    this.closeModal()
  }

  getStream(): MediaStream | undefined {
    return this.stream
  }

  private cleanup(): void {
    this.stopFaceDetection()
    this.stopPositionValidation()
    this.stopSpeaking()
    
    if (this.autoFinalizeTimer) {
      clearTimeout(this.autoFinalizeTimer)
      this.autoFinalizeTimer = undefined
    }
    
    if (this.livenessStepTimer) {
      clearTimeout(this.livenessStepTimer)
      this.livenessStepTimer = undefined
    }
    
    if (this.phaseCheckInterval) {
      clearTimeout(this.phaseCheckInterval)
      this.phaseCheckInterval = undefined
    }
    
    this.cameraService.stopStream()
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = undefined
    }

    this.cameraReady = false
    this.cameraInitializing = false
    this.detectionStatus = 'idle'
    this.detectionProgress = 0
    this.progressDashOffset = this.progressDashArray
    this.sessionActive = false
    this.faceDetected = false
    this.validatingPosition = false
    this.validationMessage = ''
    this.currentPhase = 'waiting'
    this.currentLivenessStep = 'center'
    this.error = null
  }

  // Método para obter texto da etapa atual
  getLivenessStepText(): string {
    switch (this.currentLivenessStep) {
      case 'center':
        return 'Olhe para a câmera'
      case 'right':
        return 'Vire para direita →'
      case 'left':
        return '← Vire para esquerda'
      case 'blink_smile':
        return '👁️ Piscar e 😊 Sorrir'
      case 'completed':
        return 'Etapas concluídas ✓'
      default:
        return 'Aguardando...'
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
}

