import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subject, filter, take, takeUntil } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { UserProfile } from './shared/models/auth.model';
import { FaceRecognitionService } from './core/services/face-recognition.service';
import { SessionExpiredModalComponent } from './shared/components/session-expired-modal/session-expired-modal.component';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, SessionExpiredModalComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnDestroy {
  private readonly authRoutes = new Set(['/login', '/cadastro-facial', '/autenticacao-facial']);
  readonly showShell = signal(true);
  readonly currentUser = signal<UserProfile | null>(null);
  readonly avatarUrl = signal<string | null>(null);
  readonly displayName = computed(() => {
    const user = this.currentUser();
    return user?.name || user?.Name || 'Usuário';
  });
  readonly displayCpf = computed(() => {
    const user = this.currentUser();
    const cpf = user?.cpf || user?.Cpf;
    return cpf ? this.formatCpf(cpf) : '';
  });
  readonly userInitials = computed(() => {
    const user = this.currentUser();
    const name = (user?.name || user?.Name)?.trim();
    if (name) {
      const parts = name.split(' ').filter(Boolean);
      if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
      }
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    const cpf = user?.cpf || user?.Cpf;
    return cpf ? cpf.substring(0, 2) : 'DF';
  });

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly storageService: FaceRecognitionService
  ) {
    console.log('[AppComponent] Inicializando componente principal');
    this.updateShellVisibility(router.url);
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => this.updateShellVisibility(event.urlAfterRedirects));

    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe((user) => {
        console.log('[AppComponent] Usuário recebido:', user);
        console.log('[AppComponent] currentUser signal atualizado:', this.currentUser());
        this.currentUser.set(user);

        if (!user) {
          console.log('[AppComponent] Nenhum usuário logado');
          this.avatarUrl.set(null);
          return;
        }

        const faceImageKey = user?.faceImageKey || user?.FaceImageKey;
        if (faceImageKey) {
          console.log('[AppComponent] Carregando avatar do S3:', faceImageKey);
          this.loadAvatar(faceImageKey);
          return;
        }

        const faceImageUrl = user?.faceImageUrl || user?.FaceImageUrl;
        if (faceImageUrl && faceImageUrl.startsWith('http')) {
          console.log('[AppComponent] Usando URL direta do avatar:', faceImageUrl);
          this.avatarUrl.set(faceImageUrl);
          return;
        }

        console.log('[AppComponent] Nenhuma imagem de avatar disponível');
        this.avatarUrl.set(null);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToProfile(): void {
    void this.router.navigate(['/perfil']);
  }

  logout(): void {
    this.authService.logout()
      .pipe(take(1))
      .subscribe({
        next: () => {
          void this.router.navigate(['/login']);
        },
        error: (error) => {
          console.error('[AppComponent] Falha ao realizar logout.', error);
        }
      });
  }

  private updateShellVisibility(url: string): void {
    const path = url.split('?')[0];
    this.showShell.set(!this.authRoutes.has(path));
  }

  private loadAvatar(key: string): void {
    this.storageService.generateDownloadUrl(key, 45)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => this.avatarUrl.set(response.url),
        error: (error) => {
          console.warn('[AppComponent] Falha ao gerar URL temporária para avatar.', error);
          this.avatarUrl.set(null);
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
