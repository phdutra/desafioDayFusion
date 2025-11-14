import { CommonModule } from '@angular/common';
import { Component, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthVideoModalComponent } from '../../components/auth-video-modal/auth-video-modal.component';
import { VoiceStep } from '../../core/models/voice-step.model';
import { LivenessCaptureSummary, LivenessSummary } from '../../core/models/liveness-result.model';
import { AuthService } from '../../core/services/auth.service';
import { CpfLookupResponse } from '../../shared/models/auth.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AuthVideoModalComponent],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  @ViewChild(AuthVideoModalComponent) authVideoModal?: AuthVideoModalComponent;
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  // Login: captura silenciosa e rápida (sem instruções de voz)
  readonly voiceSteps = signal<VoiceStep[]>([
    { texto: '', delay: 1500, posicao: 'frente' } // Texto vazio = sem voz
  ]);

  readonly form = this.fb.nonNullable.group({
    cpf: ['', [Validators.required]]
  });

  readonly isModalOpen = signal(false);
  readonly isAuthenticating = signal(false);
  readonly showCpfFallback = signal(false);
  readonly statusMessage = signal<string | null>(null);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly showWaitModal = signal(false);
  readonly waitModalTitle = signal<string>('Autenticando...');
  readonly waitModalMessage = signal<string>('Por favor, aguarde enquanto validamos sua identidade.');
  readonly waitModalClosable = signal(false);
  readonly authProgress = signal(0);

  readonly isCpfInvalid = computed(() => {
    const control = this.form.controls.cpf;
    if (!control.touched) {
      return false;
    }
    const digits = this.sanitizeCpf(control.value);
    return digits.length !== 11;
  });

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {
    if (this.authService.getToken()) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.handleInitialApprovalPending();
  }

  startFaceLogin(): void {
    this.waitModalClosable.set(false);
    this.statusMessage.set('Iniciando verificação facial segura...');
    this.errorMessage.set(null);
    this.showCpfFallback.set(false);
    this.loading.set(false);
    this.form.reset({ cpf: '' });
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.isModalOpen.set(true);

    setTimeout(() => {
      void this.authVideoModal?.startSession();
    }, 150);
  }

  handleSessionCompleted(summary: LivenessSummary): void {
    const capture = this.selectBestCapture(summary);

    if (!capture) {
      this.closeModal();
      this.triggerFallback('Não foi possível capturar seu rosto. Tente novamente ou confirme pelo CPF.');
      return;
    }
    
    // Mantém o modal aberto e inicia autenticação com barra de progresso
    this.authProgress.set(0);
    this.statusMessage.set('Autenticando...');
    
    // Inicia autenticação
    this.authenticateWithFace(capture);
  }

  handleSessionFailed(message: string): void {
    this.closeModal();
    this.triggerFallback(message || 'Não conseguimos verificar seu rosto. Informe seu CPF para continuar.');
  }

  onCpfInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = this.sanitizeCpf(input.value).slice(0, 11);
    const masked = this.maskCpf(digits);
    this.form.patchValue({ cpf: masked }, { emitEvent: false });
  }

  onSubmit(): void {
    this.form.markAllAsTouched();
    const digits = this.sanitizeCpf(this.form.getRawValue().cpf);

    if (digits.length !== 11) {
      this.errorMessage.set('Informe um CPF válido com 11 dígitos.');
      return;
    }

    this.errorMessage.set(null);
    this.loading.set(true);

    this.authService.checkCpf(digits)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => this.handleLookupSuccess(response),
        error: (error) => {
          console.error('[LoginComponent] Erro ao validar CPF:', error);
          const message = error?.error?.message ?? 'Erro ao validar CPF. Tente novamente.';
          this.errorMessage.set(message);
        }
      });
  }

  private handleLookupSuccess(response: CpfLookupResponse): void {
    const queryParams: Record<string, string> = { cpf: response.cpf };

    if (response.name) {
      queryParams['name'] = response.name;
    }

    if (!response.exists) {
      queryParams['source'] = 'cpf-lookup';
      this.router.navigate(['/cadastro-facial'], { queryParams });
      return;
    }

    if (response.hasFaceId) {
      this.router.navigate(['/autenticacao-facial'], { queryParams });
      return;
    }

    this.router.navigate(['/cadastro-facial'], { queryParams });
  }

  private authenticateWithFace(capture: LivenessCaptureSummary): void {
    this.isAuthenticating.set(true);
    this.authProgress.set(10);

    // Simula progresso durante autenticação
    const progressInterval = setInterval(() => {
      const current = this.authProgress();
      if (current < 90) {
        this.authProgress.set(current + 10);
      }
    }, 200);

    this.authService.loginWithFace({
      cpf: '',
      imageKey: capture.s3Key
    })
      .pipe(finalize(() => {
        this.isAuthenticating.set(false);
        clearInterval(progressInterval);
      }))
      .subscribe({
        next: (response) => {
          if (response.success) {
            // Completa a barra de progresso
            this.authProgress.set(100);
            
            // Fecha o modal de captura
            this.closeModal();
            
            // Busca o nome do usuário autenticado
            let userName = response.user?.name || (response.user as any)?.name;
            
            // Se não veio no response.user, aguarda o currentUser carregar
            if (!userName) {
              // Aguarda um momento para o AuthService buscar o currentUser
              setTimeout(() => {
                this.authService.getCurrentUser().subscribe({
                  next: (user) => {
                    userName = user.name || user.Name || 'Usuário';
                    
                    const welcomeMessage = `Bem-vindo, ${userName}`;
                    this.waitModalMessage.set(welcomeMessage);
                    this.speakWelcomeMessage(welcomeMessage);
                  },
                  error: (err) => {
                    console.error('[LoginComponent] Erro ao buscar nome do usuário:', err);
                  }
                });
              }, 500);
              
              userName = 'Usuário'; // Temporário
            }
            
            const welcomeMessage = `Bem-vindo, ${userName}`;
            
            // Atualiza o modal de espera com a mensagem de sucesso
            this.waitModalTitle.set('✅ Autenticado com Sucesso!');
            this.waitModalMessage.set(welcomeMessage);
            this.waitModalClosable.set(false);
            
            // Abre o modal de boas-vindas
            this.showWaitModal.set(true);
            
            // Fala a mensagem de boas-vindas
            this.speakWelcomeMessage(welcomeMessage);
            
            // Aguarda 3 segundos antes de navegar (tempo para ouvir a mensagem)
            setTimeout(() => {
              this.showWaitModal.set(false);
              this.router.navigate(['/dashboard']);
            }, 3000);
            return;
          }

          // Falha na autenticação
          this.authProgress.set(0);
          this.closeModal();
          if (this.isPendingApprovalMessage(response.message)) {
            this.showPendingApprovalModal(response.message);
            return;
          }
          this.triggerFallback(response.message || 'Não reconhecemos seu rosto. Confirme seu CPF abaixo.');
        },
        error: (error) => {
          console.error('[LoginComponent] Erro no login facial:', error);
          const rawMessage = error?.error?.message ?? error?.message;
          const message = typeof rawMessage === 'string' ? rawMessage : null;

          this.authProgress.set(0);
          this.closeModal();

          if (error?.status === 401 && this.isPendingApprovalMessage(message)) {
            this.showPendingApprovalModal(message ?? undefined);
            return;
          }

          this.triggerFallback(message ?? 'Não reconhecemos seu rosto. Confirme seu CPF abaixo.');
        }
      });
  }

  private speakWelcomeMessage(message: string): void {
    try {
      // Cancela qualquer fala anterior
      speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      
      speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('[LoginComponent] Erro ao falar mensagem de boas-vindas:', error);
    }
  }

  private triggerFallback(message: string): void {
    this.statusMessage.set(message);
    this.showCpfFallback.set(true);
    this.isAuthenticating.set(false);
    this.errorMessage.set(null);
  }

  closeWaitModal(): void {
    this.showWaitModal.set(false);
    this.waitModalClosable.set(false);
    this.waitModalTitle.set('Autenticando...');
    this.waitModalMessage.set('Por favor, aguarde enquanto validamos sua identidade.');
  }

  private handleInitialApprovalPending(): void {
    const approvalParam = this.route.snapshot.queryParamMap.get('approval');
    if (approvalParam !== 'pending') {
      return;
    }

    const nameParam = this.route.snapshot.queryParamMap.get('name');
    const baseMessage = nameParam
      ? `${nameParam}, recebemos seu cadastro. Assim que um administrador aprovar, você poderá acessar o sistema.`
      : 'Recebemos seu cadastro. Assim que um administrador aprovar, você poderá acessar o sistema.';

    this.showPendingApprovalModal(baseMessage);

    setTimeout(() => {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { approval: null, name: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }, 0);
  }

  private showPendingApprovalModal(message?: string): void {
    this.waitModalTitle.set('Cadastro em análise');
    this.waitModalMessage.set(
      message || 'Seu cadastro está pendente de aprovação. Tente novamente mais tarde.'
    );
    this.waitModalClosable.set(true);
    this.showWaitModal.set(true);
  }

  private isPendingApprovalMessage(message?: string | null): boolean {
    if (!message) {
      return false;
    }

    const normalized = message.toLowerCase();
    return (
      normalized.includes('aguardando aprovação') ||
      normalized.includes('pendente de autorização') ||
      normalized.includes('pendente de aprovação') ||
      normalized.includes('pendente')
    );
  }

  private selectBestCapture(summary: LivenessSummary): LivenessCaptureSummary | null {
    if (!summary.captures?.length) {
      return null;
    }

    const frontCapture = summary.captures.find((capture) => capture.position.toLowerCase() === 'frente');
    if (frontCapture) {
      return frontCapture;
    }

    return summary.captures.reduce((best, current) =>
      current.confidence > best.confidence ? current : best, summary.captures[0]);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (!this.isModalOpen()) {
      return;
    }

    event.preventDefault();
    this.closeModal();
  }

  closeModal(): void {
    if (this.authVideoModal) {
      this.authVideoModal.cancelSession();
    }

    this.isModalOpen.set(false);
    this.isAuthenticating.set(false);
    this.statusMessage.set(null);
  }

  private sanitizeCpf(value: string): string {
    return value.replace(/\D/g, '');
  }

  private maskCpf(value: string): string {
    if (!value) {
      return '';
    }

    const part1 = value.substring(0, 3);
    const part2 = value.substring(3, 6);
    const part3 = value.substring(6, 9);
    const part4 = value.substring(9, 11);

    let masked = part1;
    if (part2) {
      masked += '.' + part2;
    }
    if (part3) {
      masked += '.' + part3;
    }
    if (part4) {
      masked += '-' + part4;
    }
    return masked;
  }
}
