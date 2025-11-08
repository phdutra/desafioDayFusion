import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VoiceStep } from '../../core/models/voice-step.model';

@Component({
  selector: 'app-config-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './config-panel.component.html',
  styleUrl: './config-panel.component.scss'
})
export class ConfigPanelComponent {
  @Input({ required: true }) steps: VoiceStep[] = [];
  @Output() stepsChange = new EventEmitter<VoiceStep[]>();

  addStep(): void {
    const updated = [
      ...this.steps,
      { texto: 'Olhe para frente', delay: 2000, posicao: 'frente' }
    ];
    this.stepsChange.emit(updated);
  }

  removeStep(index: number): void {
    const updated = this.steps.filter((_, i) => i !== index);
    this.stepsChange.emit(updated);
  }

  moveUp(index: number): void {
    if (index === 0) {
      return;
    }
    this.reorder(index, index - 1);
  }

  moveDown(index: number): void {
    if (index >= this.steps.length - 1) {
      return;
    }
    this.reorder(index, index + 1);
  }

  updateStep(index: number, field: keyof VoiceStep, value: string | number): void {
    const updated = this.steps.map((step, i) =>
      i === index
        ? { ...step, [field]: field === 'delay' ? Number(value) : value }
        : step
    );
    this.stepsChange.emit(updated);
  }

  resetToDefault(): void {
    const defaults: VoiceStep[] = [
      { texto: 'Olhe para frente', delay: 1500, posicao: 'frente' },
      { texto: 'Vire à esquerda', delay: 2000, posicao: 'esquerda' },
      { texto: 'Vire à direita', delay: 2000, posicao: 'direita' }
    ];
    this.stepsChange.emit(defaults);
  }

  trackByIndex(_: number, item: VoiceStep): string {
    return `${item.texto}-${item.posicao}-${item.delay}`;
  }

  private reorder(from: number, to: number): void {
    const updated = [...this.steps];
    const [removed] = updated.splice(from, 1);
    updated.splice(to, 0, removed);
    this.stepsChange.emit(updated);
  }
}

