import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VerificationAnalysis, VerificationStatus } from '../../core/models/verification-analysis.model';
import { VerificationAdminService } from '../../core/services/verification-admin.service';

@Component({
  selector: 'app-verification-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  providers: [DatePipe],
  templateUrl: './verification-detail.component.html',
  styleUrl: './verification-detail.component.scss'
})
export class VerificationDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(VerificationAdminService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly sessionId = signal<string>('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly statusUpdating = signal(false);
  readonly error = signal<string | null>(null);
  readonly item = signal<VerificationAnalysis | null>(null);
  readonly observation = signal('');

  readonly hasObservationChanges = computed(() => this.observation().trim() !== (this.item()?.manualObservation ?? '').trim());

  get observationText(): string {
    return this.observation();
  }

  set observationText(value: string) {
    this.observation.set(value);
  }

  ngOnInit(): void {
    const session = this.route.snapshot.paramMap.get('sessionId');
    if (!session) {
      this.router.navigate(['/verifications']).catch(() => undefined);
      return;
    }

    this.sessionId.set(session);
    this.load();
  }

  formatDate(value?: string | null): string | null {
    if (!value) {
      return null;
    }

    return this.datePipe.transform(value, 'dd/MM/yyyy HH:mm');
  }

  formatScore(value?: number | null): string {
    if (value === null || value === undefined) {
      return '—';
    }

    return `${Math.round(value)}%`;
  }

  openMedia(url?: string | null): void {
    if (!url) {
      return;
    }

    window.open(url, '_blank', 'noreferrer');
  }

  saveObservation(): void {
    const session = this.sessionId();
    const currentObservation = this.observation().trim();
    if (!session || !currentObservation) {
      return;
    }

    this.saving.set(true);
    this.service
      .saveObservation(session, currentObservation)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.load();
        },
        error: (err) => {
          console.error('[VerificationDetail] Falha ao salvar observação manual', err);
          this.saving.set(false);
          this.error.set('Não foi possível salvar a observação. Tente novamente.');
        }
      });
  }

  updateStatus(status: VerificationStatus): void {
    const session = this.sessionId();
    if (!session) {
      return;
    }

    this.statusUpdating.set(true);
    const notes = this.observation().trim() || undefined;

    this.service
      .updateStatus(session, status, notes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.statusUpdating.set(false);
          this.load();
        },
        error: (err) => {
          console.error('[VerificationDetail] Falha ao atualizar status', err);
          this.statusUpdating.set(false);
          this.error.set('Não foi possível atualizar o status. Tente novamente.');
        }
      });
  }

  statusClass(status: VerificationStatus): string {
    switch (status) {
      case 'APPROVED':
        return 'status-badge status-approved';
      case 'REJECTED':
        return 'status-badge status-rejected';
      default:
        return 'status-badge status-review';
    }
  }

  private load(): void {
    const session = this.sessionId();
    if (!session) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.service
      .get(session)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.item.set(response);
          this.observation.set(response.manualObservation ?? '');
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[VerificationDetail] Falha ao carregar verificação', err);
          this.loading.set(false);
          this.error.set('Não foi possível carregar os dados da verificação.');
          this.item.set(null);
        }
      });
  }
}

