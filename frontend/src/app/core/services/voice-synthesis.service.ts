import { Injectable, NgZone } from '@angular/core'

/**
 * Serviço dedicado para síntese de voz que funciona mesmo durante operações intensivas
 * como WebRTC. Usa Zone.js e processamento assíncrono para garantir que a voz não seja
 * interrompida mesmo quando o WebRTC está consumindo recursos.
 */
@Injectable({
  providedIn: 'root'
})
export class VoiceSynthesisService {
  private speechSynthesis: SpeechSynthesis | null = null
  private messageQueue: Array<{ text: string; lang: string; priority: number }> = []
  private isProcessing = false
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private processingInterval?: number
  private rafProcessorId?: number
  private isEnabled = true
  private keepAliveInterval?: number

  constructor(private ngZone: NgZone) {
    this.initialize()
  }

  private initialize(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.speechSynthesis = window.speechSynthesis
      
      // Iniciar processamento contínuo da fila em uma zona separada
      this.startQueueProcessor()
      
      console.log('✅ VoiceSynthesisService inicializado')
    } else {
      console.warn('⚠️ SpeechSynthesis não está disponível neste navegador')
    }
  }

  /**
   * Inicia o processador de fila que verifica periodicamente por mensagens pendentes
   * IMPORTANTE: processQueue() já garante execução na zona correta, então não precisa runOutsideAngular
   * Usa múltiplos intervalos para garantir processamento mesmo durante WebRTC
   */
  private startQueueProcessor(): void {
    // Processar fila a cada 50ms para garantir resposta rápida (mais frequente)
    // processQueue() já usa NgZone.run() internamente, então não precisa runOutsideAngular
    this.processingInterval = window.setInterval(() => {
      this.processQueue()
    }, 50)
    
    // Backup: usar requestAnimationFrame também para garantir processamento
    const rafProcessor = () => {
      this.processQueue()
      this.rafProcessorId = requestAnimationFrame(rafProcessor)
    }
    this.rafProcessorId = requestAnimationFrame(rafProcessor)
    
    // Keep-alive agressivo: forçar verificação a cada 25ms se houver mensagens na fila
    // Isso garante que mesmo durante WebRTC intensivo, a fila será processada
    this.keepAliveInterval = window.setInterval(() => {
      if (this.messageQueue.length > 0 && !this.isProcessing) {
        this.processQueue()
      }
    }, 25)
  }

  /**
   * Processa a fila de mensagens de forma assíncrona
   * Continua processando mesmo se houver operações intensivas em andamento
   * IMPORTANTE: Sempre executa dentro da zona do Angular para garantir funcionamento durante WebRTC
   */
  private processQueue(): void {
    // Garantir que sempre executa na zona do Angular
    this.ngZone.run(() => {
      if (!this.speechSynthesis) {
        return
      }
      
      if (this.messageQueue.length === 0) {
        return // Fila vazia, não precisa logar
      }

      // Verificar estado atual de fala (com verificação mais robusta)
      let isCurrentlySpeaking = false
      try {
        isCurrentlySpeaking = this.speechSynthesis.speaking || this.isProcessing
      } catch (e) {
        // Se houver erro ao verificar, assumir que não está falando
        isCurrentlySpeaking = this.isProcessing
      }

      // Se está falando, verificar se realmente está ou se é apenas flag desatualizada
      if (isCurrentlySpeaking) {
        // Se utterance anterior terminou mas flag ainda está true, limpar e continuar
        try {
          if (!this.speechSynthesis.speaking && this.isProcessing) {
            // Limpar flag desatualizada silenciosamente
            this.currentUtterance = null
            this.isProcessing = false
            isCurrentlySpeaking = false
            // Continuar para processar próxima mensagem
          } else if (this.currentUtterance && !this.speechSynthesis.speaking) {
            // Limpar utterance terminado silenciosamente
            this.currentUtterance = null
            this.isProcessing = false
            isCurrentlySpeaking = false
            // Continuar para processar próxima mensagem
          } else {
            // Realmente está falando, aguardar
            return
          }
        } catch (e) {
          // Se erro ao verificar, limpar mesmo assim e continuar
          this.currentUtterance = null
          this.isProcessing = false
          isCurrentlySpeaking = false
        }
      }

      // Processar próxima mensagem da fila (ordenada por prioridade)
      if (this.messageQueue.length > 0 && !isCurrentlySpeaking) {
        // Ordenar por prioridade (maior primeiro)
        this.messageQueue.sort((a, b) => b.priority - a.priority)
        
        const message = this.messageQueue.shift()
        if (message) {
          this.speakInternal(message.text, message.lang)
        }
      }
    })
  }

  /**
   * Adiciona uma mensagem à fila de síntese de voz
   * @param text Texto a ser falado
   * @param lang Idioma (padrão: pt-BR)
   * @param cancelPrevious Se true, cancela a fala anterior e limpa a fila
   * @param priority Prioridade (maior = mais importante, padrão: 0)
   */
  speak(text: string, lang: string = 'pt-BR', cancelPrevious: boolean = true, priority: number = 0): void {
    if (!this.isEnabled || !this.speechSynthesis) {
      console.warn('⚠️ VoiceSynthesis desabilitado ou não disponível')
      return
    }

    // Se deve cancelar anterior, limpar fila e utterance atual
    if (cancelPrevious) {
      this.cancel()
      // Aguardar um pouco para garantir que o cancelamento foi processado
      setTimeout(() => {
        this.addToQueue(text, lang, priority)
      }, 200)
    } else {
      this.addToQueue(text, lang, priority)
    }
  }

  /**
   * Adiciona mensagem à fila
   */
  private addToQueue(text: string, lang: string, priority: number): void {
    this.messageQueue.push({ text, lang, priority })
    
    // Forçar processamento imediato usando múltiplas estratégias
    // processQueue() já garante execução na zona correta, então não precisa runOutsideAngular
    if (!this.isProcessing) {
      // Estratégia 1: setTimeout imediato
      setTimeout(() => this.processQueue(), 5)
      
      // Estratégia 2: requestAnimationFrame
      requestAnimationFrame(() => {
        this.processQueue()
      })
      
      // Estratégia 3: setTimeout com delay maior como backup
      setTimeout(() => {
        if (this.messageQueue.length > 0 && !this.isProcessing) {
          this.processQueue()
        }
      }, 50)
    }
  }

  /**
   * Fala uma mensagem internamente (chamado pelo processador de fila)
   */
  private speakInternal(text: string, lang: string): void {
    if (!this.speechSynthesis || this.isProcessing) {
      return
    }

    try {
      // Limpar utterance anterior se existir
      if (this.currentUtterance) {
        this.speechSynthesis.cancel()
        this.currentUtterance = null
      }

      // Criar novo utterance
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = lang
      utterance.rate = 1.0
      utterance.pitch = 1.0
      utterance.volume = 1.0

      // Callbacks para gerenciar estado
      utterance.onstart = () => {
        // IMPORTANTE: Callbacks podem ser executados fora da zona do Angular durante WebRTC
        // Usar NgZone.run para garantir que o estado seja atualizado na zona correta
        this.ngZone.run(() => {
          this.isProcessing = true
          this.currentUtterance = utterance
        })
      }

      utterance.onend = () => {
        // IMPORTANTE: Callbacks podem ser executados fora da zona do Angular durante WebRTC
        // Usar NgZone.run para garantir que o processamento continue na zona correta
        this.ngZone.run(() => {
          // FORÇAR limpeza completa do estado
          this.isProcessing = false
          this.currentUtterance = null
          
          // Forçar cancelamento de qualquer utterance pendente (caso haja algum problema)
          try {
            if (this.speechSynthesis?.speaking) {
              console.warn('⚠️ [onend] SpeechSynthesis ainda marcado como speaking, forçando cancel...')
              this.speechSynthesis.cancel()
            }
          } catch (e) {
            console.warn('⚠️ [onend] Erro ao cancelar speechSynthesis:', e)
          }
          
          // Processar próxima mensagem imediatamente e também após delays múltiplos
          // Usar múltiplas estratégias para garantir que continue funcionando durante WebRTC
          if (this.messageQueue.length > 0) {
            this.processQueue()
          }
          
          // Backup: tentar novamente após pequenos delays (múltiplas tentativas)
          const tryProcessAgain = (delay: number) => {
            setTimeout(() => {
              this.ngZone.run(() => {
                if (this.messageQueue.length > 0) {
                  // FORÇAR limpeza novamente antes de tentar
                  if (!this.speechSynthesis?.speaking) {
                    this.isProcessing = false
                    this.currentUtterance = null
                  }
                  
                  this.processQueue()
                }
              })
            }, delay)
          }
          
          // Múltiplas tentativas com delays diferentes (sem logs para não poluir console)
          tryProcessAgain(50)
          tryProcessAgain(150)
          tryProcessAgain(300)
          tryProcessAgain(500)
          tryProcessAgain(1000)
        })
      }

      utterance.onerror = (error) => {
        // IMPORTANTE: Callbacks podem ser executados fora da zona do Angular durante WebRTC
        // Usar NgZone.run para garantir que o processamento continue na zona correta
        this.ngZone.run(() => {
          // Ignorar erros de interrupção/cancelamento
          if (error.error !== 'interrupted' && error.error !== 'canceled') {
            console.error('❌ Erro na síntese de voz:', error.error)
          }
          this.isProcessing = false
          this.currentUtterance = null
          
          // Tentar próxima mensagem mesmo com erro (múltiplas tentativas)
          setTimeout(() => {
            this.ngZone.run(() => {
              this.processQueue()
            })
          }, 100)
          
          setTimeout(() => {
            this.ngZone.run(() => {
              if (this.messageQueue.length > 0 && !this.isProcessing) {
                this.processQueue()
              }
            })
          }, 250)
        })
      }

      // Estratégia múltipla para garantir que a fala não seja bloqueada pelo WebRTC
      // Quando WebRTC está ativo, o SpeechSynthesis pode não responder imediatamente
      // Precisamos tentar múltiplas vezes e usar diferentes estratégias
      let attempts = 0
      const maxAttempts = 15 // Aumentado para dar mais chances durante WebRTC
      let hasStarted = false
      
      const attemptSpeak = () => {
        // Se já iniciou, não tentar novamente
        if (hasStarted && this.speechSynthesis?.speaking) {
          return
        }
        
        attempts++
        
        try {
          if (!this.speechSynthesis) {
            // Log apenas se realmente falhar após várias tentativas
            if (attempts >= maxAttempts - 2) {
              console.warn('⚠️ SpeechSynthesis não disponível após', attempts, 'tentativas')
            }
            if (attempts >= maxAttempts) {
              this.isProcessing = false
              this.currentUtterance = null
              setTimeout(() => this.processQueue(), 100)
            } else {
              setTimeout(attemptSpeak, 100)
            }
            return
          }
          
          // Verificar se já está falando (pode ser de uma tentativa anterior)
          const isCurrentlySpeaking = this.speechSynthesis.speaking || this.isProcessing
          
          if (!isCurrentlySpeaking) {
            // Tentar falar - usar try-catch interno para capturar erros específicos
            try {
              this.speechSynthesis.speak(utterance)
              
              // Verificar se realmente iniciou após um pequeno delay
              setTimeout(() => {
                if (this.speechSynthesis?.speaking) {
                  // Se realmente iniciou, marcar como iniciado
                  hasStarted = true
                } else if (!hasStarted && this.isProcessing) {
                  // Se não iniciou, tentar novamente silenciosamente
                  hasStarted = false
                  if (attempts < maxAttempts) {
                    setTimeout(attemptSpeak, 150)
                  }
                }
              }, 300)
            } catch (speakError: any) {
              // Log apenas se realmente falhar após várias tentativas
              if (attempts >= maxAttempts - 2) {
                console.warn('⚠️ Erro ao chamar speak() após', attempts, 'tentativas:', speakError)
              }
              hasStarted = false
              // Tentar novamente se ainda não atingiu máximo
              if (attempts < maxAttempts) {
                setTimeout(attemptSpeak, 150)
              } else {
                this.isProcessing = false
                this.currentUtterance = null
                setTimeout(() => this.processQueue(), 100)
              }
            }
          } else {
            // Se já está falando, marcar como iniciado e não tentar novamente
            if (this.speechSynthesis.speaking) {
              hasStarted = true
            } else if (attempts < maxAttempts) {
              // Se ainda não iniciou mas atingiu limite de tentativas, limpar
              setTimeout(attemptSpeak, 100)
            } else {
              // Máximo de tentativas atingido, limpar silenciosamente
              this.isProcessing = false
              this.currentUtterance = null
              setTimeout(() => this.processQueue(), 100)
            }
          }
        } catch (error) {
          // Log apenas erros críticos
          if (attempts >= maxAttempts - 2) {
            console.error('❌ Erro geral ao tentar falar após', attempts, 'tentativas:', error)
          }
          hasStarted = false
          if (attempts < maxAttempts) {
            setTimeout(attemptSpeak, 150)
          } else {
            this.isProcessing = false
            this.currentUtterance = null
            setTimeout(() => this.processQueue(), 100)
          }
        }
      }
      
      // Executar usando NgZone.run para garantir execução na zona correta
      // IMPORTANTE: Durante WebRTC, precisamos garantir que a voz seja executada na zona do Angular
      this.ngZone.run(() => {
        // Tentar imediatamente
        attemptSpeak()
        
        // Backup: tentar via requestAnimationFrame (pode ser necessário durante WebRTC)
        requestAnimationFrame(() => {
          if (!hasStarted && !this.speechSynthesis?.speaking && attempts < 5) {
            attemptSpeak()
          }
        })
        
        // Backup adicional: tentar após delay pequeno (WebRTC pode precisar de tempo)
        setTimeout(() => {
          if (!hasStarted && !this.speechSynthesis?.speaking && attempts < 5) {
            attemptSpeak()
          }
        }, 100)
      })
    } catch (error) {
      console.error('❌ Erro ao criar utterance:', error)
      this.isProcessing = false
      this.currentUtterance = null
      setTimeout(() => this.processQueue(), 100)
    }
  }

  /**
   * Cancela a fala atual e limpa a fila
   */
  cancel(): void {
    if (this.speechSynthesis) {
      this.speechSynthesis.cancel()
    }
    this.messageQueue = []
    this.currentUtterance = null
    this.isProcessing = false
  }

  /**
   * Para de falar (alias para cancel)
   */
  stop(): void {
    this.cancel()
  }

  /**
   * Verifica se está falando atualmente
   */
  isSpeaking(): boolean {
    if (!this.speechSynthesis) {
      return false
    }
    // Verificar tanto o estado interno quanto o estado do SpeechSynthesis
    const speaking = this.speechSynthesis.speaking || this.isProcessing
    return speaking
  }

  /**
   * Habilita ou desabilita o serviço
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled
    if (!enabled) {
      this.cancel()
    }
  }

  /**
   * Limpa recursos ao destruir o serviço
   */
  ngOnDestroy(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = undefined
    }
    if (this.rafProcessorId !== undefined) {
      cancelAnimationFrame(this.rafProcessorId)
      this.rafProcessorId = undefined
    }
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = undefined
    }
    this.cancel()
  }
}
