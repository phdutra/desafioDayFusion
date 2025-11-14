import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, takeUntil } from 'rxjs';
import { Subject } from 'rxjs';
import { LivenessModalComponent } from '../../components/liveness-modal/liveness-modal.component';
import { VoiceStep } from '../../core/models/voice-step.model';
import { LivenessCaptureSummary, LivenessSummary } from '../../core/models/liveness-result.model';
import { AuthService } from '../../core/services/auth.service';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LivenessModalComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent implements OnDestroy {
  @ViewChild(LivenessModalComponent) livenessModal?: LivenessModalComponent;

  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly storageService = inject(FaceRecognitionService);
  private readonly destroy$ = new Subject<void>();

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3)]]
  });

  readonly voiceSteps = signal<VoiceStep[]>([
    { texto: 'Olhe para a câmera', delay: 1500, posicao: 'frente' },
    { texto: 'Incline suavemente à esquerda', delay: 2000, posicao: 'esquerda' },
    { texto: 'Incline suavemente à direita', delay: 2000, posicao: 'direita' },
    { texto: 'Sorria para finalizar', delay: 2000, posicao: 'sorriso' }
  ]);

  readonly isModalOpen = signal(false);
  readonly isSubmitting = signal(false);
  readonly captureSummary = signal<LivenessCaptureSummary | null>(null);
  readonly livenessError = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly currentAvatar = signal<string | null>(null);

  readonly hasCapture = computed(() => this.captureSummary() !== null);
  readonly formattedCpf = computed(() => this.formatCpf(this.cpf));
  readonly currentInitials = computed(() => {
    const name = this.form.getRawValue().name?.trim();
    if (name) {
      const parts = name.split(' ').filter(Boolean);
      if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
      }
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    return this.cpf ? this.cpf.substring(0, 2) : 'DF';
  });

  private cpf = '';

  constructor() {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe((user) => {
        if (!user) {
          return;
        }


        // Suporta ambos os formatos (camelCase e PascalCase do backend)
        this.cpf = user.cpf || user.Cpf || '';
        const userName = user.name || user.Name || '';
        
        
        if (!this.form.dirty) {
          this.form.patchValue({ name: userName });
        }

        const faceImageKey = user.faceImageKey || user.FaceImageKey;
        if (faceImageKey) {
          this.loadAvatar(faceImageKey);
          return;
        }

        const faceImageUrl = user.faceImageUrl || user.FaceImageUrl;
        if (faceImageUrl && faceImageUrl.startsWith('http')) {
          this.currentAvatar.set(faceImageUrl);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: KeyboardEvent): void {
    if (this.isModalOpen()) {
      event.preventDefault();
      this.closeCapture();
    }
  }

  isAdmin(): boolean {
    return this.authService.isAdmin();
  }

  onBackdropClick(event: MouseEvent): void {
    // Fecha o modal ao clicar no backdrop (fundo escuro)
    if (event.target === event.currentTarget) {
      this.closeCapture();
    }
  }

  openCapture(): void {
    this.livenessError.set(null);
    this.successMessage.set(null);
    this.isModalOpen.set(true);

    setTimeout(() => {
      void this.livenessModal?.startSession();
    }, 150);
  }

  closeCapture(): void {
    this.isModalOpen.set(false);
    this.livenessModal?.cancelSession();
  }

  handleSessionCompleted(summary: LivenessSummary): void {
    this.closeCapture();

    const bestCapture = this.selectBestCapture(summary);
    if (!bestCapture) {
      this.livenessError.set('Não identificamos uma captura adequada. Tente novamente.');
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
    this.livenessError.set(null);
  }

  submit(): void {
    this.form.markAllAsTouched();
    this.successMessage.set(null);

    if (this.form.invalid) {
      this.errorMessage.set('Informe um nome válido (mínimo de 3 caracteres).');
      return;
    }

    const capture = this.captureSummary();
    if (!capture) {
      this.errorMessage.set('Capture uma nova foto antes de salvar as alterações.');
      return;
    }

    if (!this.cpf) {
      this.errorMessage.set('Não foi possível identificar seu CPF. Refaça o login.');
      return;
    }

    this.errorMessage.set(null);
    this.isSubmitting.set(true);

    const payload = {
      cpf: this.cpf,
      name: this.form.getRawValue().name.trim(),
      imageKey: capture.s3Key
    };

    this.authService.registerFace(payload)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (response) => {
          this.successMessage.set('Perfil atualizado com sucesso!');
          this.captureSummary.set(null);
          this.livenessError.set(null);
          this.form.markAsPristine();

          if (response.faceImageKey) {
            this.loadAvatar(response.faceImageKey);
          } else if (capture.previewUrl) {
            this.currentAvatar.set(capture.previewUrl);
          }
        },
        error: (error) => {
          const message = error?.error?.message ?? 'Erro ao atualizar perfil. Tente novamente.';
          this.errorMessage.set(message);
        }
      });
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

  private loadAvatar(key: string): void {
    this.storageService.generateDownloadUrl(key, 45)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => this.currentAvatar.set(response.url),
        error: (error) => {
          this.currentAvatar.set(null);
        }
      });
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

