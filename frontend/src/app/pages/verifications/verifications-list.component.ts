import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VerificationAnalysis, VerificationMetrics, VerificationStatus } from '../../core/models/verification-analysis.model';
import { VerificationAdminService } from '../../core/services/verification-admin.service';

@Component({
  selector: 'app-verifications-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  providers: [DatePipe],
  templateUrl: './verifications-list.component.html',
  styleUrl: './verifications-list.component.scss'
})
export class VerificationsListComponent implements OnInit {
  private readonly verificationService = inject(VerificationAdminService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly loading = signal(false);
  readonly metricsLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly items = signal<VerificationAnalysis[]>([]);
  readonly metrics = signal<VerificationMetrics | null>(null);

  readonly emptyState = computed(() => !this.loading() && this.items().length === 0);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loadList();
    this.loadMetrics();
  }

  formatScore(score?: number | null): string {
    if (score === null || score === undefined) {
      return '—';
    }

    return `${Math.round(score)}%`;
  }

  formatDate(value: string): string {
    return this.datePipe.transform(value, 'dd/MM/yyyy HH:mm') ?? value;
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

  trackBySessionId(_: number, item: VerificationAnalysis): string {
    return item.sessionId;
  }

  private loadList(): void {
    this.loading.set(true);
    this.error.set(null);

    this.verificationService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.items.set(response ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[VerificationsList] Falha ao carregar lista de verificações', err);
          this.error.set('Não foi possível carregar as verificações. Tente novamente.');
          this.items.set([]);
          this.loading.set(false);
        }
      });
  }

  private loadMetrics(): void {
    this.metricsLoading.set(true);

    this.verificationService
      .metrics()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.metrics.set(response);
          this.metricsLoading.set(false);
        },
        error: (err) => {
          console.warn('[VerificationsList] Falha ao carregar métricas', err);
          this.metrics.set(null);
          this.metricsLoading.set(false);
        }
      });
  }
}

