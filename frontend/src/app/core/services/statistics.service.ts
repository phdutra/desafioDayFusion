import { Injectable, inject, signal, computed } from '@angular/core'
import { LivenessHistoryService } from './liveness-history.service'
import { LivenessSummary } from '../models/liveness-result.model'

export interface DashboardStats {
  totalSessions: number
  approved: number
  rejected: number
  others: number
  approvalRate: number
  rejectionRate: number
  avgLivenessScore: number
  avgFaceMatchScore: number
  recentSessions: LivenessSummary[]
  statusDistribution: { status: string; count: number; percentage: number }[]
  scoreRanges: { range: string; count: number }[]
}

/**
 * Serviço para calcular estatísticas do sistema de reconhecimento facial
 */
@Injectable({
  providedIn: 'root'
})
export class StatisticsService {
  private readonly historyService = inject(LivenessHistoryService)

  /**
   * Estatísticas computadas reativamente a partir do histórico
   */
  readonly stats = computed<DashboardStats>(() => {
    const historyEntries = this.historyService.history()
    const allSessions = historyEntries.map(entry => entry.summary)
    
    if (allSessions.length === 0) {
      return this.getEmptyStats()
    }

    const approved = allSessions.filter((s: LivenessSummary) => s.status === 'Aprovado').length
    const rejected = allSessions.filter((s: LivenessSummary) => s.status === 'Rejeitado').length
    const others = allSessions.filter((s: LivenessSummary) => 
      s.status !== 'Aprovado' && s.status !== 'Rejeitado'
    ).length
    
    const totalSessions = allSessions.length
    const approvalRate = totalSessions > 0 ? (approved / totalSessions) * 100 : 0
    const rejectionRate = totalSessions > 0 ? (rejected / totalSessions) * 100 : 0

    // Calcular média de scores
    const avgLivenessScore = this.calculateAverage(
      allSessions.map((s: LivenessSummary) => s.livenessScore)
    )
    
    const faceMatchScores = allSessions
      .map((s: LivenessSummary) => s.faceMatchScore)
      .filter((score): score is number => score !== undefined && score !== null)
    
    const avgFaceMatchScore = this.calculateAverage(faceMatchScores)

    // Distribuição por status - agregar todos os status dinamicamente
    const statusMap = new Map<string, number>()
    allSessions.forEach((s: LivenessSummary) => {
      const status = s.status || 'Indefinido'
      statusMap.set(status, (statusMap.get(status) || 0) + 1)
    })

    const statusDistribution = Array.from(statusMap.entries())
      .map(([status, count]) => ({
        status,
        count,
        percentage: (count / totalSessions) * 100
      }))
      .sort((a, b) => b.count - a.count) // Ordenar por quantidade (maior primeiro)

    // Distribuição por faixa de score
    const scoreRanges = this.getScoreRanges(allSessions)

    // Sessões recentes (últimas 5) - Filtra sessões com status "Revisar"
    const recentSessions = allSessions
      .filter((s: LivenessSummary) => s.status !== 'Revisar')
      .slice(0, 5)

    return {
      totalSessions,
      approved,
      rejected,
      others,
      approvalRate,
      rejectionRate,
      avgLivenessScore,
      avgFaceMatchScore,
      recentSessions,
      statusDistribution,
      scoreRanges
    }
  })

  private getEmptyStats(): DashboardStats {
    return {
      totalSessions: 0,
      approved: 0,
      rejected: 0,
      others: 0,
      approvalRate: 0,
      rejectionRate: 0,
      avgLivenessScore: 0,
      avgFaceMatchScore: 0,
      recentSessions: [],
      statusDistribution: [],
      scoreRanges: []
    }
  }

  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0
    const sum = numbers.reduce((acc, val) => acc + val, 0)
    return Math.round((sum / numbers.length) * 100) / 100
  }

  private getScoreRanges(sessions: LivenessSummary[]): { range: string; count: number }[] {
    const ranges = [
      { range: '0-50', count: 0 },
      { range: '50-70', count: 0 },
      { range: '70-85', count: 0 },
      { range: '85-95', count: 0 },
      { range: '95-100', count: 0 }
    ]

    sessions.forEach(session => {
      const score = session.livenessScore
      if (score >= 0 && score < 50) ranges[0].count++
      else if (score >= 50 && score < 70) ranges[1].count++
      else if (score >= 70 && score < 85) ranges[2].count++
      else if (score >= 85 && score < 95) ranges[3].count++
      else if (score >= 95 && score <= 100) ranges[4].count++
    })

    return ranges.filter(r => r.count > 0)
  }

  /**
   * Obtém estatísticas por período
   */
  getStatsByPeriod(days: number): DashboardStats {
    const historyEntries = this.historyService.history()
    const allSessions = historyEntries.map(entry => entry.summary)
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const filteredSessions = allSessions.filter((session: LivenessSummary) => {
      const sessionDate = new Date(session.createdAt)
      return sessionDate >= cutoffDate
    })

    // Calcular estatísticas para o período filtrado
    const approved = filteredSessions.filter((s: LivenessSummary) => s.status === 'Aprovado').length
    const rejected = filteredSessions.filter((s: LivenessSummary) => s.status === 'Rejeitado').length
    const others = filteredSessions.filter((s: LivenessSummary) => 
      s.status !== 'Aprovado' && s.status !== 'Rejeitado'
    ).length
    
    const totalSessions = filteredSessions.length
    const approvalRate = totalSessions > 0 ? (approved / totalSessions) * 100 : 0
    const rejectionRate = totalSessions > 0 ? (rejected / totalSessions) * 100 : 0

    const avgLivenessScore = this.calculateAverage(
      filteredSessions.map((s: LivenessSummary) => s.livenessScore)
    )
    
    const faceMatchScores = filteredSessions
      .map((s: LivenessSummary) => s.faceMatchScore)
      .filter((score): score is number => score !== undefined && score !== null)
    
    const avgFaceMatchScore = this.calculateAverage(faceMatchScores)

    // Distribuição por status para o período
    const statusMap = new Map<string, number>()
    filteredSessions.forEach((s: LivenessSummary) => {
      const status = s.status || 'Indefinido'
      statusMap.set(status, (statusMap.get(status) || 0) + 1)
    })

    const statusDistribution = Array.from(statusMap.entries())
      .map(([status, count]) => ({
        status,
        count,
        percentage: (count / totalSessions) * 100 || 0
      }))
      .sort((a, b) => b.count - a.count)

    return {
      totalSessions,
      approved,
      rejected,
      others,
      approvalRate,
      rejectionRate,
      avgLivenessScore,
      avgFaceMatchScore,
      recentSessions: filteredSessions
        .filter((s: LivenessSummary) => s.status !== 'Revisar')
        .slice(0, 5),
      statusDistribution,
      scoreRanges: this.getScoreRanges(filteredSessions)
    }
  }
}

