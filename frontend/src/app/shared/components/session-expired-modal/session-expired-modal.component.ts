import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SessionExpiredModalService } from '../../../core/services/session-expired-modal.service';

@Component({
  selector: 'app-session-expired-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './session-expired-modal.component.html',
  styleUrls: ['./session-expired-modal.component.scss']
})
export class SessionExpiredModalComponent {
  private readonly modalService = inject(SessionExpiredModalService);
  private readonly router = inject(Router);

  readonly isOpen = this.modalService.isModalOpen;

  /**
   * Fecha o modal e redireciona para o login
   */
  goToLogin(): void {
    this.modalService.closeModal();
    this.router.navigate(['/login']);
  }
}

