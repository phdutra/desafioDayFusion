import { CommonModule } from '@angular/common'
import { Component, inject, signal, OnInit, ViewChild, effect } from '@angular/core'
import { Router, RouterModule } from '@angular/router'
import { StatisticsService } from '../../core/services/statistics.service'
import { NgApexchartsModule, ChartComponent } from 'ng-apexcharts'
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexDataLabels,
  ApexStroke,
  ApexYAxis,
  ApexTitleSubtitle,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexResponsive,
  ApexPlotOptions,
  ApexFill,
  ApexTooltip,
  ApexGrid
} from 'ng-apexcharts'

export type ChartOptions = {
  series: ApexAxisChartSeries | ApexNonAxisChartSeries;
  chart: ApexChart;
  xaxis?: ApexXAxis;
  yaxis?: ApexYAxis;
  dataLabels?: ApexDataLabels;
  stroke?: ApexStroke;
  title?: ApexTitleSubtitle;
  legend?: ApexLegend;
  labels?: string[];
  responsive?: ApexResponsive[];
  plotOptions?: ApexPlotOptions;
  fill?: ApexFill;
  tooltip?: ApexTooltip;
  colors?: string[];
  grid?: ApexGrid;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, NgApexchartsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  @ViewChild('chart') chart!: ChartComponent
  
  // Valores animados para contadores
  animatedTotalSessions = signal(0)
  animatedApproved = signal(0)
  animatedRejected = signal(0)
  animatedAvgScore = signal(0)
  animatedApprovalRate = signal(0)
  animatedRejectionRate = signal(0)
  
  private readonly statisticsService = inject(StatisticsService)
  private readonly router = inject(Router)

  readonly stats = this.statisticsService.stats
  readonly selectedPeriod = signal<number>(30) // dias

  // Configurações de gráficos
  donutChartOptions!: Partial<ChartOptions>
  lineChartOptions!: Partial<ChartOptions>
  barChartOptions!: Partial<ChartOptions>
  radialChartOptions!: Partial<ChartOptions>

  ngOnInit(): void {
    this.initializeCharts()
    this.animateCounters()
  }

  /**
   * Anima os contadores de estatísticas
   */
  private animateCounters(): void {
    const stats = this.stats()
    const duration = 1500 // ms

    this.animateValue(this.animatedTotalSessions, 0, stats.totalSessions, duration)
    this.animateValue(this.animatedApproved, 0, stats.approved, duration)
    this.animateValue(this.animatedRejected, 0, stats.rejected, duration)
    this.animateValue(this.animatedAvgScore, 0, stats.avgLivenessScore, duration)
    this.animateValue(this.animatedApprovalRate, 0, stats.approvalRate, duration)
    this.animateValue(this.animatedRejectionRate, 0, stats.rejectionRate, duration)
  }

  /**
   * Anima um valor de início ao fim
   */
  private animateValue(signal: any, start: number, end: number, duration: number): void {
    const range = end - start
    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      
      // Easing function (ease-out)
      const easeProgress = 1 - Math.pow(1 - progress, 3)
      
      const currentValue = start + (range * easeProgress)
      signal.set(Math.round(currentValue * 10) / 10) // Arredonda para 1 casa decimal

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }

  /**
   * Retorna a cor hexadecimal correspondente ao status para os gráficos
   */
  private getChartColorForStatus(status: string): string {
    switch (status) {
      case 'Aprovado':
        return '#22c55e' // Verde escuro profissional
      case 'Rejeitado':
        return '#f87171' // Vermelho coral suave
      case 'Revisar':
        return '#fbbf24' // Amarelo dourado suave
      case 'Pendente':
        return '#818cf8' // Azul lavanda suave
      default:
        return '#94a3b8' // Cinza azulado suave
    }
  }

  /**
   * Inicializa todos os gráficos
   */
  private initializeCharts(): void {
    const stats = this.stats()

    // Gráfico Donut - Distribuição por Status
    this.donutChartOptions = {
      series: stats.statusDistribution.map(s => s.count),
      chart: {
        type: 'donut',
        height: 320,
        foreColor: '#e5e7eb',
        fontFamily: 'Inter, sans-serif',
        background: 'transparent',
        animations: {
          enabled: true,
          speed: 800
        }
      },
      labels: stats.statusDistribution.map(s => s.status),
      colors: stats.statusDistribution.map(s => this.getChartColorForStatus(s.status)),
      legend: {
        position: 'bottom',
        horizontalAlign: 'center',
        fontSize: '14px'
      },
      plotOptions: {
        pie: {
          donut: {
            size: '70%',
            labels: {
              show: true,
              total: {
                show: true,
                label: 'Total',
                fontSize: '16px',
                fontWeight: 600,
                color: '#e5e7eb',
                formatter: () => stats.totalSessions.toString()
              },
              value: {
                fontSize: '24px',
                fontWeight: 700,
                color: '#00f2fe'
              }
            }
          }
        }
      },
      dataLabels: {
        enabled: true,
        style: {
          fontSize: '14px',
          fontWeight: 600
        },
        dropShadow: {
          enabled: false
        }
      },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (val) => val + ' sessões'
        }
      },
      responsive: [{
        breakpoint: 480,
        options: {
          chart: { width: 280 },
          legend: { position: 'bottom' }
        }
      }]
    }

    // Gráfico de Linha - Evolução dos Scores
    const sessionIndices = stats.recentSessions.slice(0, 10).reverse().map((_, i) => `S${i + 1}`)
    const livenessScores = stats.recentSessions.slice(0, 10).reverse().map(s => s.livenessScore)
    const faceMatchScores = stats.recentSessions.slice(0, 10).reverse().map(s => s.faceMatchScore || 0)

    this.lineChartOptions = {
      series: [
        {
          name: 'Liveness Score',
          data: livenessScores
        },
        {
          name: 'Face Match Score',
          data: faceMatchScores
        }
      ],
      chart: {
        type: 'line',
        height: 320,
        foreColor: '#e5e7eb',
        background: 'transparent',
        toolbar: {
          show: true,
          tools: {
            download: true,
            selection: false,
            zoom: false,
            zoomin: false,
            zoomout: false,
            pan: false,
            reset: false
          }
        },
        animations: {
          enabled: true,
          speed: 800
        }
      },
      stroke: {
        curve: 'smooth',
        width: 3
      },
      colors: ['#00ff88', '#ffaa00'],
      xaxis: {
        categories: sessionIndices,
        labels: {
          style: {
            fontSize: '12px'
          }
        }
      },
      yaxis: {
        min: 0,
        max: 100,
        labels: {
          formatter: (val) => val.toFixed(0) + '%'
        }
      },
      grid: {
        borderColor: '#374151',
        strokeDashArray: 3
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        fontSize: '14px'
      },
      dataLabels: {
        enabled: false
      },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (val) => val.toFixed(1) + '%'
        }
      }
    }

    // Gráfico de Barras - Faixas de Score
    this.barChartOptions = {
      series: [{
        name: 'Sessões',
        data: stats.scoreRanges.map(r => r.count)
      }],
      chart: {
        type: 'bar',
        height: 320,
        foreColor: '#e5e7eb',
        background: 'transparent',
        toolbar: { show: false },
        animations: {
          enabled: true,
          speed: 800
        }
      },
      plotOptions: {
        bar: {
          borderRadius: 8,
          horizontal: false,
          columnWidth: '60%',
          dataLabels: {
            position: 'top'
          }
        }
      },
      dataLabels: {
        enabled: true,
        offsetY: -20,
        style: {
          fontSize: '12px',
          colors: ['#e5e7eb']
        }
      },
      xaxis: {
        categories: stats.scoreRanges.map(r => r.range),
        labels: {
          style: {
            fontSize: '12px'
          }
        }
      },
      yaxis: {
        labels: {
          formatter: (val) => val.toFixed(0)
        }
      },
      colors: ['#6366f1'],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.5,
          gradientToColors: ['#00f2fe'],
          inverseColors: false,
          opacityFrom: 1,
          opacityTo: 0.8,
          stops: [0, 100]
        }
      },
      grid: {
        borderColor: '#374151',
        strokeDashArray: 3
      },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (val) => val + ' sessões'
        }
      }
    }

    // Gráfico Radial - Taxa de Aprovação
    this.radialChartOptions = {
      series: [stats.approvalRate],
      chart: {
        type: 'radialBar',
        height: 280,
        foreColor: '#e5e7eb',
        background: 'transparent'
      },
      plotOptions: {
        radialBar: {
          hollow: {
            size: '70%'
          },
          track: {
            background: '#1f2937',
            strokeWidth: '100%'
          },
          dataLabels: {
            show: true,
            name: {
              show: true,
              fontSize: '16px',
              fontWeight: 600,
              color: '#e5e7eb',
              offsetY: -10
            },
            value: {
              show: true,
              fontSize: '32px',
              fontWeight: 700,
              color: '#00ff88',
              offsetY: 5,
              formatter: (val) => val.toFixed(1) + '%'
            }
          }
        }
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.5,
          gradientToColors: ['#00ff88'],
          inverseColors: false,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100]
        }
      },
      stroke: {
        lineCap: 'round'
      },
      labels: ['Taxa de Aprovação'],
      colors: ['#00f2fe']
    }
  }

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

  /**
   * Formata número grande com sufixo
   */
  formatNumber(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
    return num.toString()
  }
}

