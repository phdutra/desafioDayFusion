import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigPanelComponent } from '../../components/config-panel/config-panel.component';
import { LivenessModalComponent } from '../../components/liveness-modal/liveness-modal.component';
import { LivenessSummary } from '../../core/models/liveness-result.model';
import { VoiceStep } from '../../core/models/voice-step.model';
import { LivenessHistoryService } from '../../core/services/liveness-history.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfigPanelComponent, LivenessModalComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  readonly voiceSteps = signal<VoiceStep[]>([
    { texto: 'Olhe para frente', delay: 1500, posicao: 'frente' },
    { texto: 'Vire à esquerda', delay: 2000, posicao: 'esquerda' },
    { texto: 'Vire à direita', delay: 2000, posicao: 'direita' }
  ]);

  documentFile: File | null = null;
  lastResult = signal<LivenessSummary | null>(null);
  errorMessage = signal<string | null>(null);

  constructor(private readonly historyService: LivenessHistoryService) {}

  readonly resultJson = computed(() =>
    this.lastResult()
      ? JSON.stringify(
          {
            isLive: this.lastResult()!.isLive,
            livenessScore: this.lastResult()!.livenessScore,
            faceMatchScore: this.lastResult()!.faceMatchScore ?? null,
            status: this.lastResult()!.status
          },
          null,
          2
        )
      : null
  );

  onStepsChange(steps: VoiceStep[]): void {
    this.voiceSteps.set(steps);
  }

  onDocumentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.documentFile = null;
      return;
    }
    this.documentFile = file;
  }

  clearDocument(): void {
    this.documentFile = null;
  }

  handleSessionCompleted(summary: LivenessSummary): void {
    this.errorMessage.set(null);
    this.lastResult.set(summary);
    this.historyService.addEntry(summary);
  }

  handleSessionFailed(message: string): void {
    this.errorMessage.set(message);
  }
}

