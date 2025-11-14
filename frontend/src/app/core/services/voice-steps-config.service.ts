import { Injectable, signal } from '@angular/core'
import { VoiceStep } from '../models/voice-step.model'

/**
 * Serviço para gerenciar configurações de instruções de voz.
 * Permite criar, modificar e persistir instruções personalizadas
 * que são compartilhadas entre Dashboard e Capture3D.
 */
@Injectable({
  providedIn: 'root'
})
export class VoiceStepsConfigService {
  private readonly STORAGE_KEY = 'dayfusion_voice_steps'
  
  // Instruções padrão do sistema
  private readonly defaultSteps: VoiceStep[] = [
    { texto: 'Olhe para frente', delay: 1500, posicao: 'frente' },
    { texto: 'Vire à esquerda', delay: 2000, posicao: 'esquerda' },
    { texto: 'Vire à direita', delay: 2000, posicao: 'direita' },
    { texto: 'Piscar e sorrir', delay: 2000, posicao: 'piscar_sorrir' }
  ]

  // Signal reativo com as instruções atuais
  readonly steps = signal<VoiceStep[]>(this.loadSteps())

  constructor() {
  }

  /**
   * Carrega instruções do localStorage ou retorna padrões
   */
  private loadSteps(): VoiceStep[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as VoiceStep[]
        
        // Validar estrutura básica
        if (Array.isArray(parsed) && parsed.length > 0) {
          const isValid = parsed.every(
            step => 
              typeof step.texto === 'string' && 
              typeof step.delay === 'number' && 
              typeof step.posicao === 'string'
          )
          
          if (isValid) {
            return parsed
          }
        }
      }
    } catch (error) {
    }
    
    return [...this.defaultSteps]
  }

  /**
   * Salva instruções no localStorage
   */
  private saveSteps(steps: VoiceStep[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(steps))
    } catch (error) {
    }
  }

  /**
   * Obtém as instruções atuais (snapshot)
   */
  getSteps(): VoiceStep[] {
    return [...this.steps()]
  }

  /**
   * Atualiza as instruções e persiste
   */
  setSteps(steps: VoiceStep[]): void {
    if (!steps || steps.length === 0) {
      return
    }

    this.steps.set([...steps])
    this.saveSteps(steps)
  }

  /**
   * Adiciona uma nova instrução
   */
  addStep(step: VoiceStep): void {
    const updated = [...this.steps(), step]
    this.setSteps(updated)
  }

  /**
   * Remove uma instrução por índice
   */
  removeStep(index: number): void {
    const updated = this.steps().filter((_, i) => i !== index)
    if (updated.length > 0) {
      this.setSteps(updated)
    } else {
    }
  }

  /**
   * Atualiza uma instrução específica
   */
  updateStep(index: number, step: VoiceStep): void {
    const updated = this.steps().map((s, i) => i === index ? step : s)
    this.setSteps(updated)
  }

  /**
   * Restaura instruções padrão
   */
  resetToDefault(): void {
    this.setSteps([...this.defaultSteps])
  }

  /**
   * Verifica se está usando configuração padrão
   */
  isDefault(): boolean {
    const current = this.steps()
    if (current.length !== this.defaultSteps.length) {
      return false
    }
    
    return current.every((step, i) => {
      const def = this.defaultSteps[i]
      return step.texto === def.texto && 
             step.delay === def.delay && 
             step.posicao === def.posicao
    })
  }

  /**
   * Obtém apenas as instruções de captura facial (exclui documentos, etc)
   */
  getFacialSteps(): VoiceStep[] {
    return this.steps().filter(step => 
      step.posicao !== 'documento' && 
      step.posicao !== 'upload'
    )
  }
}

