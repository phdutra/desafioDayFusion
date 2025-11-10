import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type AnalysisStep = 'recording' | 'uploading' | 'detecting' | 'analyzing' | 'complete' | 'error';

@Component({
  selector: 'app-analysis-progress',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analysis-progress.component.html',
  styleUrls: ['./analysis-progress.component.scss']
})
export class AnalysisProgressComponent {
  @Input() currentStep: AnalysisStep = 'recording';
  @Input() progress: number = 0; // 0-100
  @Input() message: string = '';
  @Input() show: boolean = false;

  getStepNumber(step: AnalysisStep): number {
    const steps: AnalysisStep[] = ['recording', 'uploading', 'detecting', 'analyzing', 'complete'];
    return steps.indexOf(step) + 1;
  }

  isStepActive(step: AnalysisStep): boolean {
    return this.getStepNumber(step) <= this.getStepNumber(this.currentStep);
  }

  isStepComplete(step: AnalysisStep): boolean {
    return this.getStepNumber(step) < this.getStepNumber(this.currentStep);
  }

  get currentStepNumber(): number {
    return this.getStepNumber(this.currentStep);
  }

  get totalSteps(): number {
    return 4; // recording, uploading, detecting, analyzing
  }

  get progressPercentage(): number {
    if (this.currentStep === 'complete') return 100;
    if (this.currentStep === 'error') return 0;
    
    const baseProgress = ((this.currentStepNumber - 1) / this.totalSteps) * 100;
    const stepProgress = (this.progress / 100) * (100 / this.totalSteps);
    
    return Math.min(baseProgress + stepProgress, 100);
  }

  get stepLabel(): string {
    switch (this.currentStep) {
      case 'recording':
        return 'Gravando vídeo...';
      case 'uploading':
        return 'Enviando para análise...';
      case 'detecting':
        return 'Detectando rosto...';
      case 'analyzing':
        return 'Analisando autenticidade...';
      case 'complete':
        return 'Análise completa!';
      case 'error':
        return 'Erro na análise';
      default:
        return '';
    }
  }

  get stepDescription(): string {
    switch (this.currentStep) {
      case 'recording':
        return 'Capturando vídeo de 4 segundos';
      case 'uploading':
        return 'Fazendo upload seguro do vídeo';
      case 'detecting':
        return 'Verificando padrões de piscadas';
      case 'analyzing':
        return 'Detectando possíveis manipulações';
      case 'complete':
        return 'Verificação de autenticidade concluída';
      case 'error':
        return this.message || 'Ocorreu um erro durante a análise';
      default:
        return '';
    }
  }
}

