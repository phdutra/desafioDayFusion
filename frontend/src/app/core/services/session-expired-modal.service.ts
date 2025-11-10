import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SessionExpiredModalService {
  readonly isModalOpen = signal<boolean>(false);
  
  showModal(): void {
    this.isModalOpen.set(true);
  }
  
  closeModal(): void {
    this.isModalOpen.set(false);
  }
}

