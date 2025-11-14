import { Component, OnInit, OnDestroy, AfterViewInit, OnChanges, SimpleChanges, ViewChild, ElementRef, Input, Output, EventEmitter, ChangeDetectorRef, NgZone, ViewEncapsulation } from '@angular/core'
import { CommonModule } from '@angular/common'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { CameraService } from '../../../core/services/camera.service'
import { FaceRecognitionService } from '../../../core/services/face-recognition.service'
import { VoiceSynthesisService } from '../../../core/services/voice-synthesis.service'
import { firstValueFrom } from 'rxjs'

export type CameraMode = '2d' | '3d'

@Component({
  selector: 'app-camera-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './camera-modal.component.html',
  styleUrls: ['./camera-modal.component.scss'],
  encapsulation: ViewEncapsulation.Emulated // CORREÇÃO: Isolar CSS do componente para não interferir no widget AWS
})
export class CameraModalComponent implements OnInit, OnDestroy, AfterViewInit, OnChanges {
  @ViewChild('videoElement', { static: false }) videoElement?: ElementRef<HTMLVideoElement>
  @ViewChild('videoElement3d', { static: false }) videoElement3d?: ElementRef<HTMLVideoElement>
  
  @Input() mode: CameraMode = '2d'
  @Input() isOpen: boolean = false
  @Input() processingResults: boolean = false
  @Input() processingProgress: number = 0 // 0-100
  @Input() useRealWidget: boolean = false // Se true, desabilita simulação e aguarda widget real
  
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
  
  // Progresso do anel segmentado (0-100)
  livenessProgress = 0
  phaseInstructions: string[] = []
  private phaseCheckInterval?: number
  private autoFinalizeTimer?: number
  private livenessStepTimer?: number
  private widgetCompletionTimeout?: number // Timeout de segurança para widget não responder
  private livenessStepCallbacks: Map<string, () => void> = new Map()
  
  private stream?: MediaStream
  private validationInterval?: number

  constructor(
    private cameraService: CameraService,
    private faceService: FaceRecognitionService,
    private voiceService: VoiceSynthesisService,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {}

  async ngAfterViewInit(): Promise<void> {
    if (this.isOpen) {
      await this.initializeCamera()
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
        previousValue: changes['isOpen'].previousValue,
        currentValue: changes['isOpen'].currentValue,
        isOpen: this.isOpen
      })
      
      if (this.isOpen) {
        // Aguardar um pouco antes de inicializar para garantir que DOM está pronto
        setTimeout(() => {
          // Verificar novamente se modal ainda está aberto antes de inicializar
          if (this.isOpen) {
            this.initializeCamera()
          }
        }, 100)
      } else {
        this.sessionActive = false
        this.cameraInitializing = false
        this.cleanup()
        // Forçar detecção de mudanças para garantir que o modal desapareça
        this.cdr.detectChanges()
      }
    }
  }

  ngOnDestroy(): void {
    this.cleanup()
  }

  async initializeCamera(): Promise<void> {
    // IMPORTANTE: Verificar múltiplas vezes se modal está aberto para evitar erro após fechar
    if (!this.isOpen) {
      return
    }
    
    this.cameraInitializing = true
    this.error = null
    this.cdr.detectChanges()

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('API de mídia não suportada neste navegador')
      }

      // Verificar novamente antes de obter stream
      if (!this.isOpen) {
        this.cameraInitializing = false
        return
      }

      this.stream = await this.cameraService.getMediaStream()
      
      // Verificar novamente após obter stream (modal pode ter fechado durante await)
      if (!this.isOpen) {
        this.cameraService.stopStream()
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop())
          this.stream = undefined
        }
        this.cameraInitializing = false
        return
      }
      
      // Aguardar até o elemento estar disponível (2D ou 3D)
      let retries = 0
      const maxRetries = 20 // Aumentar para dar mais tempo
      const targetVideo = this.mode === '2d' ? this.videoElement : this.videoElement3d
      
      while (!targetVideo?.nativeElement && retries < maxRetries && this.isOpen) {
        await new Promise(resolve => setTimeout(resolve, 150))
        retries++
        this.cdr.detectChanges()
      }

      // Verificar novamente se modal ainda está aberto
      if (!this.isOpen) {
        this.cameraService.stopStream()
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop())
          this.stream = undefined
        }
        this.cameraInitializing = false
        return
      }

      const video = targetVideo?.nativeElement
      if (!video) {
          mode: this.mode, 
          videoElement: !!this.videoElement?.nativeElement,
          videoElement3d: !!this.videoElement3d?.nativeElement,
          isOpen: this.isOpen
        })
        // Limpar recursos antes de lançar erro
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop())
          this.stream = undefined
        }
        throw new Error('Elemento de vídeo não encontrado no DOM')
      }
      
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
      
      // Verificar novamente antes de reproduzir vídeo
      if (!this.isOpen) {
        this.cameraService.stopStream()
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop())
          this.stream = undefined
        }
        this.cameraInitializing = false
        return
      }

      await video.play()
      
      // Verificar novamente após play
      if (!this.isOpen) {
        video.pause()
        this.cameraService.stopStream()
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop())
          this.stream = undefined
        }
        this.cameraInitializing = false
        return
      }

      this.cameraReady = true
      this.cameraInitializing = false
      
      // Aguardar um pouco para garantir que o DOM está atualizado
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Verificar novamente antes de iniciar detecção/validação
      if (!this.isOpen) {
        this.cameraService.stopStream()
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop())
          this.stream = undefined
        }
        this.cameraReady = false
        this.cameraInitializing = false
        return
      }
      
      this.cdr.detectChanges()
      
      if (this.mode === '2d') {
        this.startFaceDetection()
      } else if (this.mode === '3d') {
        // Verificar novamente se o vídeo 3D está disponível
        if (this.videoElement3d?.nativeElement && this.isOpen) {
          // Iniciar validação de posicionamento para 3D
          this.currentPhase = 'waiting'
          this.speakInstruction('Olá! Vou guiá-lo durante a verificação. Primeiro, posicione seu rosto no centro da tela.')
          this.startPositionValidation()
        } else {
          this.error = 'Não foi possível inicializar a câmera para verificação 3D'
          this.cameraInitializing = false
        }
      }
      
      this.cdr.detectChanges()
    } catch (error: any) {
      // Se erro ocorrer mas modal já fechou, não mostrar erro
      if (!this.isOpen) {
        return
      }
      
      this.error = error.message || 'Erro ao acessar a câmera. Verifique as permissões.'
      this.cameraInitializing = false
      
      // Limpar recursos em caso de erro
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop())
        this.stream = undefined
      }
      
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
      this.error = 'Erro ao capturar foto. Tente novamente.'
      this.detectionStatus = 'ready'
      this.startFaceDetection()
    }
  }

  // Instruções de voz - agora usa o serviço dedicado
  speakInstruction(text: string, lang: string = 'pt-BR', cancelPrevious: boolean = true): void {
    this.voiceService.speak(text, lang, cancelPrevious)
  }

  stopSpeaking(): void {
    this.voiceService.stop()
  }

  // 3D Position Validation - Contínua
  startPositionValidation(): void {
    if (this.mode !== '3d' || !this.cameraReady || !this.videoElement3d) return
    
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
        
        // Capturar frame atual (usar vídeo 3D)
        const video3d = this.videoElement3d?.nativeElement
        if (!video3d) return
        const dataUrl = await this.cameraService.capturePhoto(video3d)
        
        // Converter para File
        const file = this.dataUrlToFile(dataUrl, `validation_${Date.now()}.jpg`)
        
        // Fazer upload e verificar face
        const uploadResult = await firstValueFrom(this.faceService.uploadViaApi(file))
        
        if (uploadResult?.key) {
          // Verificar se há face na imagem
          const hasFace = await firstValueFrom(this.faceService.detectFaces(uploadResult.key))
          
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
            
          }
        } else {
          this.faceDetected = false
          this.validationMessage = 'Erro ao fazer upload da imagem'
        }
      } catch (error: any) {
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

    // Se o widget real está sendo usado, aguardar widget iniciar gravação
    // IMPORTANTE: Conforme AWS_FaceLiveness_SessionExpired.md
    // O widget tem uma tela inicial com botão "Iniciar Verificação" que o usuário DEVE clicar
    // Não iniciar voz ou sequência até o usuário clicar no botão interno do widget
    if (this.useRealWidget) {
      // NÃO definir sessionActive como true ainda - só será true quando widget criar sessão (após clique)
      // NÃO definir currentPhase como 'recording' ainda - aguardar widget iniciar
      this.currentLivenessStep = 'center'
      
      
      // Emitir evento para renderizar o widget
      // O widget será renderizado mas não iniciará até o usuário clicar no botão interno
      this.ngZone.run(() => {
        this.livenessStart.emit()
      })
      
      // IMPORTANTE: NÃO chamar waitForWidgetToStartRecording() aqui
      // O widget vai criar a sessão e disparar evento quando usuário clicar no botão interno
      // Aguardaremos o evento 'liveness-started' ou 'user-activity-started' do widget
      // para então iniciar a sequência de voz
      
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
    
    // Instruções iniciais de gravação - FALAR ANTES de emitir evento para evitar bloqueio
    this.speakInstruction('Gravação iniciada. Olhe para a câmera e mantenha-se preparado. Vou pedir três movimentos.')
    
    // IMPORTANTE: Usar NgZone.run para garantir que voz continue funcionando após WebRTC iniciar
    // O WebRTC pode interferir na síntese de voz, então precisamos garantir execução na zona correta
    this.ngZone.run(() => {
      this.livenessStart.emit()
    })
    
    // Iniciar sequência de movimentos após 3 segundos
    // IMPORTANTE: Chamar startLivenessSteps mesmo quando useRealWidget é true
    // O waitForWidgetToStartRecording também chama, mas este garante que sempre será chamado
    setTimeout(() => {
      if (this.sessionActive && this.isOpen) {
        this.startLivenessSteps()
      }
    }, 3000)
    
    // Iniciar verificação automática de conclusão (tempo total ajustado)
    this.startAutoFinalization()
  }

  /**
   * CORREÇÃO: Inicia a sequência de voz DEPOIS que o usuário clicou no botão do widget AWS
   * Este método é chamado pelo componente pai quando o widget dispara evento de início
   */
  startLivenessSequenceAfterWidgetButton(): void {
    
    // Parar qualquer voz anterior
    this.stopSpeaking()
    
    // Marcar que widget iniciou (usuário clicou no botão)
    this.sessionActive = true
    this.currentPhase = 'recording'
    this.currentLivenessStep = 'center'
    
    // Instruções iniciais de gravação
    this.speakInstruction('Gravação iniciada. Olhe para a câmera e mantenha-se preparado. Vou pedir três movimentos.')
    
    // Iniciar sequência de movimentos após voz inicial terminar
    setTimeout(() => {
      if (this.sessionActive && this.isOpen) {
        this.startLivenessSteps()
      }
    }, 3000)
    
    // Iniciar verificação automática de conclusão
    this.startAutoFinalization()
  }

  // SOLUÇÃO ALTERNATIVA: Polling ativo + botões manuais
  // Não depende de timers, callbacks ou voz - usa polling contínuo para verificar tempo
  startLivenessSteps(): void {
      sessionActive: this.sessionActive,
      isOpen: this.isOpen,
      useRealWidget: this.useRealWidget,
      currentLivenessStep: this.currentLivenessStep,
      currentPhase: this.currentPhase
    })
    
    // Verificar se já está em execução (evitar duplicação)
    if (this.currentLivenessStep !== 'center' && this.currentLivenessStep !== 'completed') {
      return
    }
    
    if (!this.sessionActive || !this.isOpen) {
      return
    }
    
    const isRealWidget = this.useRealWidget

    // Definir sequência de etapas
    this.livenessStepsSequence = [
      {
        step: 'right' as const,
        text: 'Por favor, vire lentamente seu rosto para a direita.',
        displayTime: 6000,
        voiceText: 'Por favor, vire lentamente seu rosto para a direita.'
      },
      {
        step: 'left' as const,
        text: 'Agora, vire lentamente seu rosto para a esquerda.',
        displayTime: 6000,
        voiceText: 'Agora, vire lentamente seu rosto para a esquerda.'
      },
      {
        step: 'blink_smile' as const,
        text: 'Agora, piscar os olhos e sorrir.',
        displayTime: 5000,
        voiceText: 'Agora, piscar os olhos e sorrir.'
      },
      {
        step: 'completed' as const,
        text: 'Muito bem! Mantenha-se imóvel.',
        displayTime: 3000,
        voiceText: 'Muito bem! Mantenha-se imóvel. ' + (isRealWidget ? 'Aguardando processamento.' : 'Processando resultados.')
      }
    ]

    // Iniciar na primeira etapa
    this.currentStepIndex = -1
    this.advanceToNextStepViaPolling()

    // Iniciar polling ativo (verifica a cada 500ms se precisa avançar)
    this.startStepPolling()
  }

  // Polling para detectar quando a primeira mensagem de voz termina
  private startInitialMessagePolling(): void {
    // Limpar polling anterior se existir
    if (this.initialMessagePollingInterval) {
      clearInterval(this.initialMessagePollingInterval)
    }

    let checkCount = 0
    
    this.initialMessagePollingInterval = this.ngZone.runOutsideAngular(() => {
      return window.setInterval(() => {
        this.ngZone.run(() => {
          checkCount++
          
          // Verificar se já passou tempo suficiente (primeira mensagem leva ~5-6s)
          if (checkCount > 12) { // 6 segundos (500ms * 12)
            if (this.initialMessagePollingInterval) {
              clearInterval(this.initialMessagePollingInterval)
              this.initialMessagePollingInterval = undefined
            }
            if (this.sessionActive && this.isOpen && this.useRealWidget && this.currentLivenessStep === 'center') {
              this.startLivenessSteps()
            }
            return
          }
          
          // Verificar se a voz terminou (SpeechSynthesis não está falando)
          const speechSynthesis = window.speechSynthesis
          if (speechSynthesis && !speechSynthesis.speaking && !speechSynthesis.pending) {
            
            if (this.initialMessagePollingInterval) {
              clearInterval(this.initialMessagePollingInterval)
              this.initialMessagePollingInterval = undefined
            }
            
            // Aguardar um pouco mais para garantir que a mensagem realmente terminou
            setTimeout(() => {
              if (this.sessionActive && this.isOpen && this.useRealWidget && this.currentLivenessStep === 'center') {
                this.startLivenessSteps()
              }
            }, 500)
          } else if (checkCount % 4 === 0) {
            // Log a cada 2 segundos para debug
              speaking: speechSynthesis?.speaking,
              pending: speechSynthesis?.pending,
              currentStep: this.currentLivenessStep
            })
          }
        })
      }, 500) // Verificar a cada 500ms
    }) as any

  }

  // Polling ativo que verifica periodicamente se precisa avançar
  private startStepPolling(): void {
    // Limpar polling anterior se existir
    if (this.stepPollingInterval) {
      clearInterval(this.stepPollingInterval)
    }

    
    this.stepPollingInterval = this.ngZone.runOutsideAngular(() => {
      return window.setInterval(() => {
        this.ngZone.run(() => {
          this.checkAndAdvanceStep()
        })
      }, 500) // Verifica a cada 500ms
    }) as any

  }

  // Verifica se o tempo passou e avança automaticamente
  private checkAndAdvanceStep(): void {
    // Log periódico a cada 10 verificações (5 segundos) para debug
    if (!this.lastPollingLog || Date.now() - this.lastPollingLog > 5000) {
        sessionActive: this.sessionActive,
        isOpen: this.isOpen,
        currentStepIndex: this.currentStepIndex,
        sequenceLength: this.livenessStepsSequence.length,
        currentStepStartTime: this.currentStepStartTime,
        currentLivenessStep: this.currentLivenessStep
      })
      this.lastPollingLog = Date.now()
    }
    
    if (!this.sessionActive || !this.isOpen || this.currentStepIndex < 0) {
      return
    }

    if (this.currentStepIndex >= this.livenessStepsSequence.length) {
      // Sequência concluída, parar polling
      if (this.stepPollingInterval) {
        clearInterval(this.stepPollingInterval)
        this.stepPollingInterval = undefined
      }
      return
    }

    if (!this.currentStepStartTime) {
      return
    }

    const currentStep = this.livenessStepsSequence[this.currentStepIndex]
    const elapsed = Date.now() - this.currentStepStartTime

    if (elapsed >= currentStep.displayTime) {
      
      // Avançar para próxima etapa (ou finalizar se for a última)
      this.advanceToNextStepViaPolling()
    }
  }
  
  private lastPollingLog?: number

  // Avança para a próxima etapa
  private advanceToNextStepViaPolling(): void {
      currentStepIndex: this.currentStepIndex,
      sequenceLength: this.livenessStepsSequence.length,
      sessionActive: this.sessionActive,
      isOpen: this.isOpen
    })
    
    this.currentStepIndex++

    if (this.currentStepIndex >= this.livenessStepsSequence.length) {
      if (this.stepPollingInterval) {
        clearInterval(this.stepPollingInterval)
        this.stepPollingInterval = undefined
      }
      
      // IMPORTANTE: Quando todas as etapas são concluídas (incluindo 'completed'), verificar se deve finalizar
      // Se o widget real está sendo usado, NÃO finalizar automaticamente - aguardar widget terminar
      if (this.currentLivenessStep === 'completed') {
        if (this.useRealWidget) {
          // Widget real está sendo usado - NÃO finalizar automaticamente
          // O widget AWS vai disparar o evento liveness-complete quando terminar
          
          // TIMEOUT DE SEGURANÇA: Se o widget não disparar evento em 5 segundos, forçar finalização
          // Isso previne que o modal fique travado indefinidamente
          this.startWidgetCompletionTimeout()
        } else {
          // Simulação - pode finalizar automaticamente após tempo suficiente
          setTimeout(() => {
            if (this.sessionActive && this.isOpen && !this.useRealWidget) {
              this.processResultsAndFinalize()
            }
          }, 4000) // 4 segundos após completar (tempo para última mensagem de voz + margem)
        }
      }
      
      return
    }

    if (!this.sessionActive || !this.isOpen) {
        sessionActive: this.sessionActive,
        isOpen: this.isOpen
      })
      return
    }

    const currentStep = this.livenessStepsSequence[this.currentStepIndex]

    // Atualizar UI IMEDIATAMENTE
    this.ngZone.run(() => {
      if (this.currentPhase !== 'recording') {
        this.currentPhase = 'recording'
      }
      
      this.currentLivenessStep = currentStep.step
      this.currentStepStartTime = Date.now() // Registrar timestamp para polling
      this.cdr.detectChanges()
      
        currentLivenessStep: this.currentLivenessStep,
        currentPhase: this.currentPhase,
        currentStepStartTime: this.currentStepStartTime,
        currentStepIndex: this.currentStepIndex
      })
    })

    // Tentar falar (mas não bloquear - voz é opcional)
    // A voz não bloqueia o avanço das etapas
    // IMPORTANTE: Usar NgZone.run para garantir que voz funcione mesmo durante WebRTC
    this.ngZone.run(() => {
      try {
        this.voiceService.speak(currentStep.voiceText, 'pt-BR', false, this.livenessStepsSequence.length - this.currentStepIndex)
      } catch (error) {
      }
    })
    
    // IMPORTANTE: O avanço das etapas NÃO depende da voz funcionar
    // O polling verifica o tempo e avança automaticamente
  }

  // Método público para avanço manual via botão
  advanceStepManually(): void {
    if (!this.sessionActive || !this.isOpen) {
      return
    }

    this.advanceToNextStepViaPolling()
  }

  /**
   * Fala uma mensagem com callbacks onstart e onend
   * Usa polling para detectar quando a fala termina (já que o serviço não expõe callbacks diretamente)
   * Usa NgZone para garantir que callbacks sejam executados mesmo durante WebRTC
   */
  private speakWithCallback(
    text: string,
    onStart?: () => void,
    onEnd?: () => void
  ): void {
    
    // Falar a mensagem usando NgZone para garantir execução mesmo durante WebRTC
    this.ngZone.runOutsideAngular(() => {
      this.voiceService.speak(text, 'pt-BR', true, 1)
    })
    
    let wasSpeaking = false
    let started = false
    let ended = false
    let startCalled = false
    
    // Callback onstart - verificar imediatamente e depois periodicamente
    if (onStart) {
      // Verificar imediatamente
      if (this.voiceService.isSpeaking()) {
        started = true
        wasSpeaking = true
        startCalled = true
        this.ngZone.run(() => {
          if (onStart) onStart()
        })
      } else {
        // Verificar periodicamente até começar
        const startCheckInterval = setInterval(() => {
          if (this.voiceService.isSpeaking() && !startCalled) {
            started = true
            wasSpeaking = true
            startCalled = true
            clearInterval(startCheckInterval)
            this.ngZone.run(() => {
              if (onStart) onStart()
            })
          }
        }, 100)
        
        // Timeout para start (5 segundos)
        setTimeout(() => {
          clearInterval(startCheckInterval)
          if (!startCalled && this.voiceService.isSpeaking()) {
            started = true
            wasSpeaking = true
            startCalled = true
            this.ngZone.run(() => {
              if (onStart) onStart()
            })
          }
        }, 5000)
      }
    } else {
      // Se não há onStart, marcar como started se já está falando
      wasSpeaking = this.voiceService.isSpeaking()
      started = wasSpeaking
    }
    
    // Polling para detectar quando termina (verificar a cada 50ms - mais frequente)
    if (onEnd) {
      let checkCount = 0
      const checkInterval = setInterval(() => {
        checkCount++
        const isSpeaking = this.voiceService.isSpeaking()
        
        // Log periódico para debug (a cada 1 segundo)
        if (checkCount % 20 === 0) {
            isSpeaking,
            wasSpeaking,
            started,
            ended
          })
        }
        
        // Se ainda não detectou início mas está falando agora, marcar como iniciado
        if (!started && isSpeaking) {
          started = true
          wasSpeaking = true
          if (onStart && !startCalled) {
            startCalled = true
            this.ngZone.run(() => {
              onStart()
            })
          }
        }
        
        // Se estava falando e agora parou, terminou
        if (wasSpeaking && !isSpeaking && !ended) {
          clearInterval(checkInterval)
          ended = true
          
          // Aguardar um pouco mais para garantir que realmente terminou
          // Usar NgZone.run para garantir que callback seja executado mesmo durante WebRTC
          setTimeout(() => {
            const stillSpeaking = this.voiceService.isSpeaking()
            
            if (!stillSpeaking) {
              this.ngZone.run(() => {
                if (onEnd) {
                  try {
                    onEnd()
                  } catch (error) {
                  }
                } else {
                }
              })
            } else {
              this.ngZone.run(() => {
                if (onEnd) {
                  try {
                    onEnd()
                  } catch (error) {
                  }
                }
              })
            }
          }, 300)
        }
        
        // Atualizar estado
        wasSpeaking = isSpeaking
      }, 50) // Verificar a cada 50ms (mais frequente)
      
      // Timeout de segurança REDUZIDO para 6 segundos (a mensagem deve durar ~4-5 segundos)
      setTimeout(() => {
        clearInterval(checkInterval)
        if (!ended) {
          ended = true
          this.ngZone.run(() => {
            if (onEnd) {
              try {
                onEnd()
              } catch (error) {
              }
            }
          })
        }
      }, 6000) // Reduzido para 6 segundos
    }
  }

  /**
   * Aguarda o widget AWS iniciar a gravação antes de começar instruções de voz
   * Detecta quando vídeo está ativo via WebRTC
   */
  private waitForWidgetToStartRecording(): void {
    let checkCount = 0
    const maxChecks = 40 // 20 segundos (500ms cada)
    let recordingStarted = false
    
    const checkWidgetState = () => {
      if (!this.sessionActive || !this.isOpen || !this.useRealWidget) {
        return
      }
      
      checkCount++
      
      const widget = document.querySelector('face-liveness-widget')
      if (!widget) {
        if (checkCount < maxChecks) {
          setTimeout(checkWidgetState, 500)
        }
        return
      }
      
      // Verificação detalhada: se vídeo está ativo (WebRTC gravando), widget iniciou
      const videoElements = widget.querySelectorAll('video')
      let hasActiveVideo = false
      let hasWebRTCStream = false
      let hasLiveTracks = false
      
      videoElements.forEach((video: HTMLVideoElement) => {
        if (video.srcObject && !video.paused && video.readyState >= 2) {
          hasActiveVideo = true
          
          // Verificar se é MediaStream (WebRTC)
          if (video.srcObject instanceof MediaStream) {
            hasWebRTCStream = true
            const tracks = video.srcObject.getTracks()
            
            // Verificar se há tracks de vídeo ativos
            const videoTracks = tracks.filter(track => track.kind === 'video' && track.readyState === 'live')
            if (videoTracks.length > 0) {
              hasLiveTracks = true
              if (checkCount % 10 === 0) {
                  videoTracks: videoTracks.length,
                  trackState: videoTracks[0].readyState,
                  trackSettings: videoTracks[0].getSettings()
                })
              }
            }
          }
        }
      })
      
      // Log diagnóstico periódico
      if (checkCount % 10 === 0 && !recordingStarted) {
        const htmlWidget = widget as HTMLElement
          hasActiveVideo,
          hasWebRTCStream,
          hasLiveTracks,
          videoElementsCount: videoElements.length,
          widgetVisible: htmlWidget.offsetParent !== null,
          widgetDisplayed: window.getComputedStyle(htmlWidget).display !== 'none'
        })
      }
      
      if (hasActiveVideo && hasWebRTCStream && hasLiveTracks && !recordingStarted) {
        recordingStarted = true
        
        
        // Aguardar 2 segundos para garantir que widget está realmente gravando
        setTimeout(() => {
          if (this.sessionActive && this.isOpen && this.useRealWidget) {
            // Mensagem inicial usando serviço com callback
            const messageText = 'Gravação iniciada. Olhe para a câmera e mantenha-se preparado. Vou pedir três movimentos.'
            
            // SOLUÇÃO SIMPLIFICADA: Chamar startLivenessSteps após tempo fixo, SEM depender de voz
            // A voz é apenas informativa, mas não bloqueia o avanço
            // IMPORTANTE: Usar NgZone.run para garantir que voz funcione mesmo durante WebRTC
            this.ngZone.run(() => {
              try {
                this.voiceService.speak(messageText, 'pt-BR', true, 10)
              } catch (error) {
              }
            })
            
            // CHAMADA DIRETA: Não depender de voz, polling ou callbacks
            // Após 5 segundos, iniciar sequência de etapas automaticamente
            
            const directTimeout = this.ngZone.runOutsideAngular(() => {
              return window.setTimeout(() => {
                this.ngZone.run(() => {
                  if (this.sessionActive && this.isOpen && this.useRealWidget) {
                    this.startLivenessSteps()
                  } else {
                      sessionActive: this.sessionActive,
                      isOpen: this.isOpen,
                      useRealWidget: this.useRealWidget
                    })
                  }
                })
              }, 5000) // 5 segundos - tempo suficiente para a mensagem inicial
            })
            
            // Backup adicional após 7 segundos (caso o primeiro falhe)
            const backupTimeout = this.ngZone.runOutsideAngular(() => {
              return window.setTimeout(() => {
                this.ngZone.run(() => {
                  if (this.sessionActive && this.isOpen && this.useRealWidget && this.currentLivenessStep === 'center') {
                    this.startLivenessSteps()
                  } else {
                  }
                })
              }, 7000)
            })
            
            // Guardar timers para limpeza
            this.stepTimers.push(directTimeout, backupTimeout)
          }
        }, 2000)
        return
      }
      
      // Continuar verificando
      if (!recordingStarted && checkCount < maxChecks) {
        setTimeout(checkWidgetState, 500)
      } else if (!recordingStarted && checkCount >= maxChecks) {
        // Timeout: iniciar mesmo assim (vídeo pode estar ativo mas não detectamos)
        if (this.sessionActive && this.isOpen && this.useRealWidget) {
          const messageText = 'Gravação iniciada. Olhe para a câmera e mantenha-se preparado. Vou pedir três movimentos.'
          
          // Abordagem com timeout fixo e múltiplas estratégias
          this.voiceService.speak(messageText, 'pt-BR', true, 10)
          
          // Múltiplos timeouts de backup
          const timeout1 = this.ngZone.runOutsideAngular(() => {
            return window.setTimeout(() => {
              this.ngZone.run(() => {
                if (this.sessionActive && this.isOpen && this.useRealWidget) {
                  this.startLivenessSteps()
                }
              })
            }, 7000)
          })
          
          const timeout2 = this.ngZone.runOutsideAngular(() => {
            return window.setTimeout(() => {
              this.ngZone.run(() => {
                if (this.sessionActive && this.isOpen && this.useRealWidget && this.currentLivenessStep === 'center') {
                  this.startLivenessSteps()
                }
              })
            }, 9000)
          })
          
          this.stepTimers.push(timeout1, timeout2)
        }
      }
    }
    
    // Começar verificação após 2 segundos
    setTimeout(checkWidgetState, 2000)
  }

  // Finalização automática da fase de gravação
  startAutoFinalization(): void {
    // Se o widget real está sendo usado, NÃO iniciar auto-finalize
    // O widget real vai disparar o evento liveness-complete quando terminar
    if (this.useRealWidget) {
      return
    }
    
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
      if (this.sessionActive && this.isOpen && !this.useRealWidget) {
        // Se ainda não completou todas as etapas, aguardar um pouco mais
        if (this.currentLivenessStep !== 'completed') {
          // Aguardar mais 5 segundos
          this.autoFinalizeTimer = window.setTimeout(() => {
            if (this.sessionActive && this.isOpen && !this.useRealWidget) {
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
    // Se o widget real está sendo usado, NÃO finalizar automaticamente
    // O widget AWS precisa processar o vídeo e disparar o evento liveness-complete
    if (this.useRealWidget) {
      // Não fazer nada - apenas aguardar o widget terminar
      return
    }
    
    this.speakInstruction('Processando resultados. Aguarde um momento.')
    this.currentPhase = 'processing'
    this.cdr.detectChanges()
    
    // Aguardar um pouco antes de finalizar completamente
    setTimeout(() => {
      if (this.sessionActive && this.isOpen && !this.useRealWidget) {
        this.finalizeLivenessAutomatically()
      }
    }, 3000)
  }

  finalizeLivenessAutomatically(): void {
    if (!this.sessionActive) return
    
    // Limpar timeout de segurança se existir
    this.clearWidgetCompletionTimeout()
    
    this.currentPhase = 'completed'
    this.stopSpeaking()
    
    // Emitir evento de conclusão IMEDIATAMENTE para o componente pai
    // O componente pai deve fechar o modal e mostrar tela de processamento
    this.livenessComplete.emit({ autoFinalized: true })
    
    // Fechar modal imediatamente - não aguardar
    this.sessionActive = false
    // O componente pai vai fechar o modal quando receber o evento
  }
  
  /**
   * CORREÇÃO: Clica no botão "Iniciar Verificação" dentro do Shadow DOM do widget AWS
   * Este método acessa o Shadow DOM e dispara o clique no botão interno
   */
  clickWidgetStartButton(): void {
    
    try {
      const widget = document.querySelector('face-liveness-widget') as any
      if (!widget) {
        this.error = 'Widget AWS não encontrado. Tente recarregar a página.'
        return
      }

      // Tentar acessar Shadow DOM
      const shadowRoot = widget.shadowRoot
      if (!shadowRoot) {
        this.error = 'Não foi possível acessar o widget. Tente recarregar.'
        return
      }

      // Buscar botão "Iniciar Verificação" no Shadow DOM
      const buttons = shadowRoot.querySelectorAll('button')
      const startButton = Array.from(buttons).find((btn: any) => {
        const text = (btn.textContent || btn.innerText || '').toLowerCase().trim()
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase()
        const className = (btn.className || '').toLowerCase()
        
        // Excluir botões de cancelar/fechar
        const isCancelButton = text.includes('cancel') || 
                              text.includes('cancelar') ||
                              text.includes('close') ||
                              text.includes('fechar')
        
        if (isCancelButton) return false
        
        // Buscar botão de início
        return text.includes('iniciar') || 
               text.includes('start') ||
               text.includes('verificação') ||
               text.includes('verification') ||
               text.includes('begin') ||
               text.includes('começar') ||
               ariaLabel.includes('start') ||
               ariaLabel.includes('iniciar') ||
               className.includes('start') ||
               className.includes('begin') ||
               className.includes('widget-start-button')
      }) as HTMLButtonElement | undefined

      if (startButton) {
          text: startButton.textContent || startButton.innerText,
          disabled: startButton.disabled,
          className: startButton.className
        })

        // Verificar se está desabilitado
        if (startButton.disabled || startButton.hasAttribute('disabled')) {
          // Aguardar um pouco e tentar novamente
          setTimeout(() => {
            this.clickWidgetStartButton()
          }, 1000)
          return
        }

        // Disparar clique no botão
        startButton.click()
        
        // Também tentar dispatch de evento para garantir
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        })
        startButton.dispatchEvent(clickEvent)

        
        // Chamar método que inicia a sequência após widget iniciar
        setTimeout(() => {
          if (this.useRealWidget && !this.sessionActive) {
            this.startLivenessSequenceAfterWidgetButton()
          }
        }, 500)

      } else {
          text: btn.textContent || btn.innerText,
          className: btn.className,
          disabled: btn.disabled
        })))
        this.error = 'Botão não encontrado no widget. Tente recarregar.'
      }
    } catch (error: any) {
      this.error = `Erro ao iniciar verificação: ${error?.message || 'Erro desconhecido'}`
    }
  }

  // Verifica se o botão "Iniciar Verificação" aparece dentro do widget
  private checkWidgetButton(): { found: boolean; details: any } {
    const widget = document.querySelector('face-liveness-widget') as any
    if (!widget) {
      return { found: false, details: { widgetExists: false } }
    }
    
    let details: any = {
      widgetExists: true,
      widgetVisible: window.getComputedStyle(widget).display !== 'none',
      hasShadowRoot: !!widget.shadowRoot,
      buttonFound: false,
      buttonText: null,
      buttonVisible: false,
      videoElements: 0,
      hasActiveVideo: false
    }
    
    // Tentar acessar shadowRoot se disponível
    const widgetElement = widget.shadowRoot || widget
    
    // Procurar botões dentro do widget
    let buttons: NodeListOf<HTMLElement> | HTMLElement[] = []
    try {
      buttons = widgetElement.querySelectorAll('button')
      if (buttons.length === 0 && widget.shadowRoot) {
        // Tentar dentro do shadow root
        buttons = widget.shadowRoot.querySelectorAll('button')
      }
    } catch (e) {
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
    }
    
    // Verificar vídeos
    let videoElements: NodeListOf<HTMLVideoElement> | HTMLVideoElement[] = []
    try {
      videoElements = widgetElement.querySelectorAll('video')
      if (videoElements.length === 0 && widget.shadowRoot) {
        videoElements = widget.shadowRoot.querySelectorAll('video')
      }
    } catch (e) {
    }
    
    details.videoElements = videoElements.length
    details.hasActiveVideo = Array.from(videoElements).some((video: HTMLVideoElement) => {
      return video.srcObject && !video.paused && video.readyState >= 2
    })
    
    return {
      found: !!startButton,
      details
    }
  }
  
  // Inicia timeout de segurança: se widget não disparar evento, força finalização
  // IMPORTANTE: Timeout de 5 segundos para resposta rápida
  private startWidgetCompletionTimeout(): void {
    // Limpar timeout anterior se existir
    this.clearWidgetCompletionTimeout()
    
    // Verificar estado inicial do widget
    const initialCheck = this.checkWidgetButton()
    
    if (!initialCheck.found) {
    } else {
        text: initialCheck.details.buttonText,
        visible: initialCheck.details.buttonVisible,
        disabled: initialCheck.details.buttonDisabled
      })
    }
    
    // Verificação periódica do botão (a cada 2 segundos)
    let checkCount = 0
    const periodicCheck = setInterval(() => {
      checkCount++
      const check = this.checkWidgetButton()
      
      if (check.found && checkCount % 5 === 0) {
        // Log a cada 10 segundos (5 * 2s)
      } else if (!check.found && checkCount % 5 === 0) {
        // Log a cada 10 segundos se botão não encontrado
      }
    }, 2000) // Verificar a cada 2 segundos
    
    // Guardar interval ID para limpar quando necessário
    const originalWidgetTimeout = this.widgetCompletionTimeout
    const originalClearTimeout = this.clearWidgetCompletionTimeout.bind(this)
    
    // Sobrescrever temporariamente clearWidgetCompletionTimeout para limpar também o interval
    const self = this
    this.clearWidgetCompletionTimeout = function() {
      clearInterval(periodicCheck)
      originalClearTimeout()
    }
    
    
    this.widgetCompletionTimeout = window.setTimeout(() => {
      // Limpar verificação periódica
      clearInterval(periodicCheck)
      
      // Restaurar método original
      this.clearWidgetCompletionTimeout = originalClearTimeout
      
      // Verificação final antes do timeout
      const finalCheck = this.checkWidgetButton()
      
      if (!finalCheck.found) {
      } else {
      }
      
      if (this.sessionActive && this.isOpen && this.useRealWidget && this.currentLivenessStep === 'completed') {
        
        // IMPORTANTE: Parar a câmera antes de finalizar
        this.cameraService.stopStream()
        
        if (this.stream) {
          this.stream.getTracks().forEach(track => {
            track.stop()
          })
          this.stream = undefined
        }
        
        // Limpar estado e recursos
        this.sessionActive = false
        this.cameraReady = false
        this.widgetCompletionTimeout = undefined
        
        // Forçar finalização mesmo sem evento do widget
        // Emitir evento para o componente pai buscar resultados
        this.livenessComplete.emit({ 
          autoFinalized: true,
          timeout: true,
          message: 'Widget não respondeu - finalização forçada por timeout',
          widgetState: finalCheck.details
        })
        
      }
    }, 5000) // 5 segundos conforme solicitação do usuário
  }
  
  // Limpa timeout de segurança
  private clearWidgetCompletionTimeout(): void {
    if (this.widgetCompletionTimeout) {
      clearTimeout(this.widgetCompletionTimeout)
      this.widgetCompletionTimeout = undefined
    }
  }

  stopLiveness(): void {
    this.stopSpeaking()
    this.sessionActive = false
    this.currentPhase = 'completed'
    this.currentLivenessStep = 'completed'
    
    // Limpar timeout de segurança do widget
    this.clearWidgetCompletionTimeout()
    
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

  private stepTimers: number[] = []
  private stepPollingInterval?: number
  private initialMessagePollingInterval?: number
  private currentStepStartTime?: number
  private currentStepIndex: number = -1
  private livenessStepsSequence: Array<{step: 'right' | 'left' | 'blink_smile' | 'completed', text: string, displayTime: number, voiceText: string}> = []

  private cleanup(): void {
    
    // IMPORTANTE: Parar câmera PRIMEIRO para evitar tentar acessar DOM após modal fechar
    try {
      this.cameraService.stopStream()
      
      if (this.stream) {
        this.stream.getTracks().forEach(track => {
          track.stop()
        })
        this.stream = undefined
      }
    } catch (e) {
    }
    
    // Limpar timeout de segurança do widget
    this.clearWidgetCompletionTimeout()
    this.stopFaceDetection()
    this.stopPositionValidation()
    this.stopSpeaking()
    
    // Limpar todos os timers de steps
    this.stepTimers.forEach(timerId => {
      clearTimeout(timerId)
    })
    this.stepTimers = []
    
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
    
    if (this.stepPollingInterval) {
      clearInterval(this.stepPollingInterval)
      this.stepPollingInterval = undefined
    }
    
    if (this.initialMessagePollingInterval) {
      clearInterval(this.initialMessagePollingInterval)
      this.initialMessagePollingInterval = undefined
    }

    // Limpar estado
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
    this.livenessStepCallbacks.clear()
    
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

  // Calcular progresso do liveness
  getLivenessProgress(): number {
    if (this.sessionActive) {
      if (this.currentPhase === 'recording') {
        // Progresso durante gravação baseado nas etapas
        if (this.currentLivenessStep === 'center') return 10
        else if (this.currentLivenessStep === 'right') return 30
        else if (this.currentLivenessStep === 'left') return 60
        else if (this.currentLivenessStep === 'blink_smile') return 85
        else if (this.currentLivenessStep === 'completed') return 95
      } else if (this.currentPhase === 'processing') {
        return 98
      } else if (this.currentPhase === 'completed') {
        return 100
      }
    } else if (this.faceDetected) {
      // Quando centralização está correta, preencher completamente (100%) - círculo verde pontilhado completo
      return 100
    }
    // Sempre mostrar pelo menos os segmentos inativos (cinza) mesmo quando não há progresso
    return 0
  }

  // Gerar array de segmentos para renderização
  getProgressSegments(): Array<{x1: number, y1: number, x2: number, y2: number, isActive: boolean}> {
    const totalSegments = 60
    const centerX = 200
    const centerY = 200
    const circleRadiusInViewBox = 178.5
    const innerRadius = circleRadiusInViewBox
    const outerRadius = circleRadiusInViewBox + 15
    
    const progress = this.getLivenessProgress()
    this.livenessProgress = progress
    const activeSegments = Math.floor((progress / 100) * totalSegments)
    
    const segments: Array<{x1: number, y1: number, x2: number, y2: number, isActive: boolean}> = []
    
    for (let i = 0; i < totalSegments; i++) {
      const angle = (i / totalSegments) * 2 * Math.PI - Math.PI / 2
      const isActive = i < activeSegments
      
      const x1 = centerX + innerRadius * Math.cos(angle)
      const y1 = centerY + innerRadius * Math.sin(angle)
      const x2 = centerX + outerRadius * Math.cos(angle)
      const y2 = centerY + outerRadius * Math.sin(angle)
      
      segments.push({ x1, y1, x2, y2, isActive })
    }
    
    return segments
  }

  // Gerar string SVG completo dos segmentos do anel de progresso (método alternativo)
  getProgressSegmentsSVGString(): string {
    const segments = this.getProgressSegments()
    const progress = this.livenessProgress
    
    let lines = ''
    
    segments.forEach(seg => {
      const strokeColor = seg.isActive ? '#22c55e' : 'rgba(255, 255, 255, 0.6)'
      const strokeWidth = seg.isActive ? '8' : '6'
      const opacity = seg.isActive ? '1' : '0.8'
      const glowStyle = progress === 100 && seg.isActive 
        ? 'filter: drop-shadow(0 0 6px rgba(34, 197, 94, 1));' 
        : ''
      
      lines += `<line x1="${seg.x1.toFixed(2)}" y1="${seg.y1.toFixed(2)}" x2="${seg.x2.toFixed(2)}" y2="${seg.y2.toFixed(2)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="${opacity}" style="${glowStyle}"/>`
    })
    
    const svg = `<svg class="progress-segments-svg" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">${lines}</svg>`
    
    if (!svg || svg.length < 100) {
    }
    
    return svg
  }
  
  // TrackBy para ngFor dos segmentos
  trackByIndex(index: number): number {
    return index
  }

  // Retornar SVG sanitizado para innerHTML (método alternativo - mantido para compatibilidade)
  getProgressSegmentsSVG(): SafeHtml {
    const svgString = this.getProgressSegmentsSVGString()
    const sanitized = this.sanitizer.sanitize(1, svgString) || ''
    
    return sanitized as SafeHtml
  }
}

