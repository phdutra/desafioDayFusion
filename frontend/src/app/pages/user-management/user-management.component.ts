import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserManagementService } from '../../core/services/user-management.service';
import { UserManagement } from '../../shared/models/user-management.model';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-management.component.html',
  styleUrls: ['./user-management.component.scss']
})
export class UserManagementComponent implements OnInit {
  users = signal<UserManagement[]>([]);
  pendingUsers = signal<UserManagement[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  selectedTab = signal<'all' | 'pending'>('pending');

  constructor(private readonly userManagementService: UserManagementService) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  selectTab(tab: 'all' | 'pending'): void {
    this.selectedTab.set(tab);
    if (tab === 'pending') {
      this.loadPendingUsers();
    } else {
      this.loadAllUsers();
    }
  }

  loadUsers(): void {
    this.loadPendingUsers();
  }

  loadAllUsers(): void {
    this.loading.set(true);
    this.error.set(null);
    
    this.userManagementService.getAllUsers().subscribe({
      next: (users) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('Erro ao carregar usuários. Tente novamente.');
        this.loading.set(false);
        console.error('Erro ao carregar usuários:', err);
      }
    });
  }

  loadPendingUsers(): void {
    this.loading.set(true);
    this.error.set(null);
    
    this.userManagementService.getPendingUsers().subscribe({
      next: (users) => {
        this.pendingUsers.set(users);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('Erro ao carregar usuários pendentes. Tente novamente.');
        this.loading.set(false);
        console.error('Erro ao carregar usuários pendentes:', err);
      }
    });
  }

  approveUser(user: UserManagement): void {
    if (!confirm(`Aprovar usuário ${user.name} (${user.cpf})?`)) {
      return;
    }

    this.loading.set(true);
    this.userManagementService.approveUser(user.cpf).subscribe({
      next: (response) => {
        this.successMessage.set(response.message);
        setTimeout(() => this.successMessage.set(null), 3000);
        this.loadUsers();
      },
      error: (err) => {
        this.error.set('Erro ao aprovar usuário. Tente novamente.');
        this.loading.set(false);
        console.error('Erro ao aprovar usuário:', err);
      }
    });
  }

  rejectUser(user: UserManagement): void {
    if (!confirm(`Rejeitar usuário ${user.name} (${user.cpf})?`)) {
      return;
    }

    this.loading.set(true);
    this.userManagementService.rejectUser(user.cpf).subscribe({
      next: (response) => {
        this.successMessage.set(response.message);
        setTimeout(() => this.successMessage.set(null), 3000);
        this.loadUsers();
      },
      error: (err) => {
        this.error.set('Erro ao rejeitar usuário. Tente novamente.');
        this.loading.set(false);
        console.error('Erro ao rejeitar usuário:', err);
      }
    });
  }

  toggleRole(user: UserManagement): void {
    const newRole = user.role === 'Admin' ? 'User' : 'Admin';
    
    if (!confirm(`Alterar role de ${user.name} para ${newRole}?`)) {
      return;
    }

    this.loading.set(true);
    this.userManagementService.updateUserRole(user.cpf, newRole).subscribe({
      next: (response) => {
        this.successMessage.set(response.message);
        setTimeout(() => this.successMessage.set(null), 3000);
        this.loadUsers();
        if (this.selectedTab() === 'all') {
          this.loadAllUsers();
        }
      },
      error: (err) => {
        this.error.set('Erro ao atualizar role. Tente novamente.');
        this.loading.set(false);
        console.error('Erro ao atualizar role:', err);
      }
    });
  }

  formatCpf(cpf: string): string {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  formatDate(date: string | undefined): string {
    if (!date) return 'Nunca';
    return new Date(date).toLocaleString('pt-BR');
  }

  getRoleColor(role: string): string {
    return role === 'Admin' ? 'role-admin' : 'role-user';
  }

  getStatusColor(isApproved: boolean): string {
    return isApproved ? 'status-approved' : 'status-pending';
  }
}

