import { CommonModule } from '@angular/common';
import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { LivenessModalComponent } from '../../components/liveness-modal/liveness-modal.component';
import { VoiceStep } from '../../core/models/voice-step.model';
import { LivenessCaptureSummary, LivenessSummary } from '../../core/models/liveness-result.model';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-face-enrollment',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LivenessModalComponent],
  templateUrl: './face-enrollment.component.html',
  styleUrls: ['./face-enrollment.component.scss']
})
export class FaceEnrollmentComponent {
  @ViewChild(LivenessModalComponent) livenessModal?: LivenessModalComponent;
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3)]]
  });

  readonly voiceSteps = signal<VoiceStep[]>([
    { texto: 'Olhe para a câmera', delay: 1500, posicao: 'frente' },
    { texto: 'Vire levemente à esquerda', delay: 2000, posicao: 'esquerda' },
    { texto: 'Vire levemente à direita', delay: 2000, posicao: 'direita' },
    { texto: 'Sorria para finalizar', delay: 2000, posicao: 'sorriso' }
  ]);

  readonly isModalOpen = signal(false);
  readonly isSubmitting = signal(false);
  readonly captureSummary = signal<LivenessCaptureSummary | null>(null);
  readonly livenessError = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly hasCapture = computed(() => this.captureSummary() !== null);
  readonly formattedCpf = computed(() => this.formatCpf(this.cpf));

  private readonly cpf: string;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthService
  ) {
    const cpfParam = this.route.snapshot.queryParamMap.get('cpf');
    if (!cpfParam) {
      this.router.navigate(['/login']);
      this.cpf = '';
      return;
    }

    const sanitized = this.sanitizeCpf(cpfParam);
    if (sanitized.length !== 11) {
      this.router.navigate(['/login']);
      this.cpf = '';
      return;
    }

    this.cpf = sanitized;

    const nameParam = this.route.snapshot.queryParamMap.get('name');
    if (nameParam) {
      this.form.patchValue({ name: nameParam });
    }
  }

  openCapture(): void {
    this.livenessError.set(null);
    this.isModalOpen.set(true);
    setTimeout(() => {
      void this.livenessModal?.startSession();
    }, 150);
  }

  closeCapture(): void {
    if (this.livenessModal) {
      this.livenessModal.cancelSession();
    }
    this.isModalOpen.set(false);
  }

  handleSessionCompleted(summary: LivenessSummary): void {
    this.closeCapture();

    const bestCapture = this.selectBestCapture(summary);
    if (!bestCapture) {
      this.livenessError.set('Não foi possível identificar uma captura válida. Tente novamente.');
      return;
    }

    this.captureSummary.set(bestCapture);
    this.livenessError.set(null);
  }

  handleSessionFailed(message: string): void {
    this.closeCapture();
    this.livenessError.set(message || 'Falha na sessão de captura. Tente novamente.');
  }

  removeCapture(): void {
    this.captureSummary.set(null);
  }

  async submit(): Promise<void> {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      this.errorMessage.set('Informe o nome completo para continuar.');
      return;
    }

    const capture = this.captureSummary();
    if (!capture) {
      this.errorMessage.set('Realize a captura facial antes de confirmar.');
      return;
    }

    this.errorMessage.set(null);
    this.isSubmitting.set(true);

    this.authService.registerFace(
      {
        cpf: this.cpf,
        name: this.form.getRawValue().name.trim(),
        imageKey: capture.s3Key
      },
      { autoLogin: false }
    )
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (response) => {
          this.router.navigate(['/login'], {
            queryParams: {
              approval: 'pending',
              name: response.name || undefined
            },
            replaceUrl: true
          });
        },
        error: (error) => {
          const message = error?.error?.message ?? 'Erro ao cadastrar face. Tente novamente.';
          this.errorMessage.set(message);
        }
      });
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

