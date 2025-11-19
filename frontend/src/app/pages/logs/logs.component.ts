import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LogsService, LogEntry } from '../../core/services/logs.service';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './logs.component.html',
  styleUrls: ['./logs.component.scss']
})
export class LogsComponent implements OnInit, OnDestroy {
  logs: LogEntry[] = [];
  filteredLogs: LogEntry[] = [];
  loading = false;
  error: string | null = null;
  
  // Filtros
  filterPattern = '';
  startDate: string = '';
  endDate: string = '';
  limit = 100;
  
  // Paginação
  currentPage = 1;
  itemsPerPage = 50;
  totalPages = 1;
  
  // Auto-refresh
  autoRefresh = false;
  refreshInterval: any;
  
  private destroy$ = new Subject<void>();
  private filterSubject = new Subject<string>();

  constructor(private logsService: LogsService) {
    // Configurar datas padrão (últimas 24 horas)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - 24);
    
    this.endDate = endDate.toISOString().slice(0, 16);
    this.startDate = startDate.toISOString().slice(0, 16);
  }

  ngOnInit(): void {
    this.loadLogs();
    
    // Debounce para filtro de texto
    this.filterSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.applyFilters();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopAutoRefresh();
  }

  loadLogs(): void {
    this.loading = true;
    this.error = null;

    const request: any = {
      limit: this.limit
    };

    if (this.startDate) {
      request.startTime = new Date(this.startDate).toISOString();
    }
    if (this.endDate) {
      request.endTime = new Date(this.endDate).toISOString();
    }
    if (this.filterPattern.trim()) {
      request.filterPattern = this.filterPattern.trim();
    }

    this.logsService.getLogs(request).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        this.logs = response.logs || [];
        this.applyFilters();
        this.loading = false;
        
        if (response.message) {
          this.error = response.message;
        }
      },
      error: (err) => {
        console.error('Erro ao carregar logs:', err);
        this.error = err.error?.message || 'Erro ao carregar logs';
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    let filtered = [...this.logs];

    // Filtro de texto local (se não usar filterPattern do CloudWatch)
    if (this.filterPattern.trim() && !this.filterPattern.includes(' ')) {
      const searchTerm = this.filterPattern.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(searchTerm)
      );
    }

    this.filteredLogs = filtered;
    this.totalPages = Math.ceil(this.filteredLogs.length / this.itemsPerPage);
    this.currentPage = 1;
  }

  onFilterChange(): void {
    this.filterSubject.next(this.filterPattern);
  }

  onDateChange(): void {
    this.loadLogs();
  }

  toggleAutoRefresh(): void {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  }

  startAutoRefresh(): void {
    this.refreshInterval = setInterval(() => {
      this.loadLogs();
    }, 30000); // Atualiza a cada 30 segundos
  }

  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  refresh(): void {
    this.loadLogs();
  }

  clearFilters(): void {
    this.filterPattern = '';
    const endDate = new Date();
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - 24);
    
    this.endDate = endDate.toISOString().slice(0, 16);
    this.startDate = startDate.toISOString().slice(0, 16);
    this.limit = 100;
    this.loadLogs();
  }

  get paginatedLogs(): LogEntry[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    return this.filteredLogs.slice(start, end);
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  getLogLevel(message: string): string {
    const msg = message.toLowerCase();
    if (msg.includes('error') || msg.includes('❌') || msg.includes('erro')) {
      return 'error';
    }
    if (msg.includes('warning') || msg.includes('⚠️') || msg.includes('aviso')) {
      return 'warning';
    }
    if (msg.includes('info') || msg.includes('✅') || msg.includes('📊')) {
      return 'info';
    }
    return 'default';
  }

  formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      // Feedback visual pode ser adicionado aqui
    });
  }
}
