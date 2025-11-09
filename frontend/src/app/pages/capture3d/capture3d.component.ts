import { CommonModule } from '@angular/common'
import { Component, computed, signal, ViewChild } from '@angular/core'
import { LivenessModalComponent } from '../../components/liveness-modal/liveness-modal.component'
import { LivenessSummary } from '../../core/models/liveness-result.model'
import { VoiceStep } from '../../core/models/voice-step.model'
import { LivenessHistoryService } from '../../core/services/liveness-history.service'

@Component({
  selector: 'app-capture3d',
  standalone: true,
  imports: [CommonModule, LivenessModalComponent],
  templateUrl: './capture3d.component.html',
  styleUrls: ['./capture3d.component.scss']
})
export class Capture3dComponent {
  @ViewChild(LivenessModalComponent) livenessModal?: LivenessModalComponent

  readonly voiceSteps = signal<VoiceStep[]>([
    { texto: 'Olhe para frente', delay: 1500, posicao: 'frente' },
    { texto: 'Vire à esquerda', delay: 2000, posicao: 'esquerda' },
    { texto: 'Vire à direita', delay: 2000, posicao: 'direita' },
    { texto: 'Piscar e sorrir', delay: 2000, posicao: 'piscar_sorrir' }
  ])

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

  constructor(private readonly historyService: LivenessHistoryService) {}

  openModal(): void {
    this.errorMessage.set(null)
    this.isModalOpen.set(true)
    setTimeout(() => this.startSession(), 150)
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
      console.error('❌ Erro ao iniciar sessão 3D:', error)
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

