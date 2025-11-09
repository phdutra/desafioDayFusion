import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigPanelComponent } from '../../components/config-panel/config-panel.component';
import { LivenessModalComponent } from '../../components/liveness-modal/liveness-modal.component';
import { LivenessSummary } from '../../core/models/liveness-result.model';
import { VoiceStep } from '../../core/models/voice-step.model';
import { LivenessHistoryService } from '../../core/services/liveness-history.service';
import { VoiceStepsConfigService } from '../../core/services/voice-steps-config.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfigPanelComponent, LivenessModalComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {
  private readonly historyService = inject(LivenessHistoryService);
  private readonly voiceStepsConfig = inject(VoiceStepsConfigService);
  
  // Usar o serviço compartilhado para gerenciar as instruções
  readonly voiceSteps = this.voiceStepsConfig.steps;

  documentFile: File | null = null;
  lastResult = signal<LivenessSummary | null>(null);
  errorMessage = signal<string | null>(null);

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
    // Atualizar as instruções no serviço compartilhado (persiste no localStorage)
    this.voiceStepsConfig.setSteps(steps);
    console.log('🎤 Instruções de voz atualizadas no Dashboard:', steps);
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

