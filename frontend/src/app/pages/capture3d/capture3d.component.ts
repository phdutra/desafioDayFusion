import { CommonModule } from '@angular/common'
import { Component, computed, HostListener, inject, signal, ViewChild } from '@angular/core'
import { LivenessModalComponent } from '../../components/liveness-modal/liveness-modal.component'
import { LivenessSummary } from '../../core/models/liveness-result.model'
import { VoiceStep } from '../../core/models/voice-step.model'
import { LivenessHistoryService } from '../../core/services/liveness-history.service'
import { VoiceStepsConfigService } from '../../core/services/voice-steps-config.service'

@Component({
  selector: 'app-capture3d',
  standalone: true,
  imports: [CommonModule, LivenessModalComponent],
  templateUrl: './capture3d.component.html',
  styleUrls: ['./capture3d.component.scss']
})
export class Capture3dComponent {
  private readonly historyService = inject(LivenessHistoryService)
  private readonly voiceStepsConfig = inject(VoiceStepsConfigService)
  
  @ViewChild(LivenessModalComponent) livenessModal?: LivenessModalComponent

  // Usar o serviço compartilhado para obter as instruções configuradas no Dashboard
  readonly voiceSteps = this.voiceStepsConfig.steps

  lastResult = signal<LivenessSummary | null>(null)
  errorMessage = signal<string | null>(null)
  isModalOpen = signal<boolean>(false)
  documentFile = signal<File | null>(null)

  readonly statusSummary = computed(() => {
    const result = this.lastResult()
    if (!result) return null

    return {
      status: result.status,
      livenessScore: result.livenessScore,
      faceMatchScore: result.faceMatchScore ?? null,
      sessionId: result.sessionId,
      createdAt: result.createdAt
    }
  })

  readonly documentInfo = computed(() => {
    const file = this.documentFile()
    if (!file) return null
    return {
      name: file.name,
      sizeKb: file.size / 1024
    }
  })

  showAlertModal = signal<boolean>(false)

  constructor() {
    // Log para debug: mostrar que está usando instruções do serviço compartilhado
  }

  @HostListener('window:keydown.escape', ['$event'])
  handleEscapeKey(event: KeyboardEvent): void {
    // Fechar modal de captura se estiver aberto
    if (this.isModalOpen()) {
      event.preventDefault()
      this.closeModal()
    }
    // Fechar modal de alerta se estiver aberto
    else if (this.showAlertModal()) {
      event.preventDefault()
      this.closeAlertModal()
    }
  }

  openModal(): void {
    // Valida se o documento foi anexado antes de abrir o modal de captura facial
    if (!this.documentFile()) {
      this.showAlertModal.set(true)
      return
    }

    this.errorMessage.set(null)
    this.isModalOpen.set(true)
    setTimeout(() => this.startSession(), 150)
  }

  closeAlertModal(): void {
    this.showAlertModal.set(false)
  }

  closeModal(): void {
    if (this.livenessModal) {
      this.livenessModal.cancelSession()
    }
    this.isModalOpen.set(false)
  }

  async startSession(): Promise<void> {
    if (!this.livenessModal) {
      setTimeout(() => this.startSession(), 100)
      return
    }

    try {
      await this.livenessModal.startSession()
    } catch (error: any) {
      this.errorMessage.set(error?.message ?? 'Erro ao iniciar verificação 3D.')
    }
  }

  handleSessionCompleted(summary: LivenessSummary): void {
    this.lastResult.set(summary)
    this.errorMessage.set(null)
    this.historyService.addEntry(summary)
    this.closeModal()
  }

  handleSessionFailed(message: string): void {
    this.errorMessage.set(message)
  }

  onDocumentSelected(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files && input.files[0]
    if (!file) return
    this.documentFile.set(file)
    input.value = ''
  }

  clearDocument(): void {
    this.documentFile.set(null)
  }
}

