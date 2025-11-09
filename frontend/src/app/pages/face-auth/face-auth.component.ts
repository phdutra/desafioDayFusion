import { CommonModule } from '@angular/common';
import { Component, ViewChild, computed, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { LivenessModalComponent } from '../../components/liveness-modal/liveness-modal.component';
import { VoiceStep } from '../../core/models/voice-step.model';
import { LivenessCaptureSummary, LivenessSummary } from '../../core/models/liveness-result.model';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-face-auth',
  standalone: true,
  imports: [CommonModule, LivenessModalComponent],
  templateUrl: './face-auth.component.html',
  styleUrls: ['./face-auth.component.scss']
})
export class FaceAuthComponent {
  @ViewChild(LivenessModalComponent) livenessModal?: LivenessModalComponent;

  // Instruções otimizadas para autenticação rápida (delays reduzidos)
  readonly voiceSteps = signal<VoiceStep[]>([
    { texto: 'Olhe para a câmera', delay: 800, posicao: 'frente' },
    { texto: 'Vire à esquerda', delay: 800, posicao: 'esquerda' },
    { texto: 'Vire à direita', delay: 800, posicao: 'direita' }
  ]);

  readonly isModalOpen = signal(false);
  readonly isAuthenticating = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly lastCapture = signal<LivenessCaptureSummary | null>(null);

  readonly formattedCpf = computed(() => this.formatCpf(this.cpf));
  readonly greeting = computed(() => this.displayName ? `Olá, ${this.displayName}!` : 'Olá!');

  private readonly cpf: string;
  private readonly displayName: string;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthService
  ) {
    const cpfParam = this.route.snapshot.queryParamMap.get('cpf');
    if (!cpfParam) {
      this.router.navigate(['/login']);
      this.cpf = '';
      this.displayName = '';
      return;
    }

    const sanitized = this.sanitizeCpf(cpfParam);
    if (sanitized.length !== 11) {
      this.router.navigate(['/login']);
      this.cpf = '';
      this.displayName = '';
      return;
    }

    this.cpf = sanitized;
    this.displayName = this.route.snapshot.queryParamMap.get('name') ?? '';
  }

  startAuthentication(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.isModalOpen.set(true);
    setTimeout(() => {
      void this.livenessModal?.startSession();
    }, 150);
  }

  retryAuthentication(): void {
    this.lastCapture.set(null);
    this.startAuthentication();
  }

  handleSessionCompleted(summary: LivenessSummary): void {
    this.closeModal();
    const capture = this.selectBestCapture(summary);

    if (!capture) {
      this.errorMessage.set('Não foi possível obter uma imagem válida. Tente novamente.');
      return;
    }

    this.lastCapture.set(capture);
    this.authenticateWithCapture(capture.s3Key);
  }

  handleSessionFailed(message: string): void {
    this.closeModal();
    this.errorMessage.set(message || 'Falha na sessão de captura. Tente novamente.');
  }

  private authenticateWithCapture(imageKey: string): void {
    this.isAuthenticating.set(true);
    this.errorMessage.set(null);
    this.successMessage.set('🔍 Validando captura...');

    this.authService.loginWithFace({
      cpf: this.cpf,
      imageKey
    })
      .pipe(finalize(() => this.isAuthenticating.set(false)))
      .subscribe({
        next: (response) => {
          if (response.success) {
            const message = response.message || `✅ Autenticação aprovada. Bem-vindo${this.displayName ? ', ' + this.displayName : ''}!`;
            this.successMessage.set(message);
            // Reduzir delay para navegação mais rápida
            setTimeout(() => {
              this.router.navigate(['/dashboard']);
            }, 600);
            return;
          }

          this.errorMessage.set(response.message || 'Autenticação não aprovada. Tente novamente.');
        },
        error: (error) => {
          this.errorMessage.set(error?.error?.message ?? 'Erro ao validar FaceID. Tente novamente.');
          this.successMessage.set(null);
        }
      });
  }

  private closeModal(): void {
    if (this.livenessModal) {
      this.livenessModal.cancelSession();
    }
    this.isModalOpen.set(false);
  }

  private selectBestCapture(summary: LivenessSummary): LivenessCaptureSummary | null {
    if (!summary.captures?.length) {
      return null;
    }

    const frontCapture = summary.captures.find(
      (capture) => capture.position.toLowerCase() === 'frente'
    );
    if (frontCapture) {
      return frontCapture;
    }

    return summary.captures.reduce((best, current) => {
      return current.confidence > best.confidence ? current : best;
    }, summary.captures[0]);
  }

  private sanitizeCpf(value: string): string {
    return value.replace(/\D/g, '');
  }

  private formatCpf(value: string): string {
    if (!value) {
      return '';
    }

    return value
      .replace(/\D/g, '')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
}

