import { CommonModule } from '@angular/common'
import { Component, inject, signal } from '@angular/core'
import { Router, RouterModule } from '@angular/router'
import { StatisticsService } from '../../core/services/statistics.service'

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  private readonly statisticsService = inject(StatisticsService)
  private readonly router = inject(Router)

  readonly stats = this.statisticsService.stats
  readonly selectedPeriod = signal<number>(30) // dias

  /**
   * Obtém cor para o card de status
   */
  getStatusColor(status: string): string {
    switch (status) {
      case 'Aprovado':
        return 'approved'
      case 'Rejeitado':
        return 'rejected'
      default:
        return 'others'
    }
  }

  /**
   * Obtém ícone para o card de status
   */
  getStatusIcon(status: string): string {
    switch (status) {
      case 'Aprovado':
        return '✅'
      case 'Rejeitado':
        return '❌'
      default:
        return '📋'
    }
  }

  /**
   * Navega para uma sessão específica
   */
  viewSession(sessionId: string): void {
    this.router.navigate(['/history'], { queryParams: { sessionId } })
  }

  /**
   * Navega para o histórico completo
   */
  viewAllHistory(): void {
    this.router.navigate(['/history'])
  }

  /**
   * Navega para iniciar nova captura
   */
  startNewCapture(): void {
    this.router.navigate(['/capture3d'])
  }

  /**
   * Retorna cor da barra de progresso baseada no valor
   */
  getProgressColor(value: number): string {
    if (value >= 80) return 'success'
    if (value >= 60) return 'warning'
    return 'danger'
  }
}

