import { Component, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { Transaction } from '../../shared/models/transaction.model'

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss']
})
export class TransactionsComponent implements OnInit {
  transactions: Transaction[] = []
  loading = false
  thumbs: Record<string, { selfie?: string; doc?: string }> = {}

  constructor(private faceService: FaceRecognitionService, private router: Router) {}

  ngOnInit(): void {
    this.load()
  }

  async load(): Promise<void> {
    this.loading = true
    try {
      const response = await this.faceService.getTransactions().toPromise()
      this.transactions = response || []
      
      if (this.transactions.length === 0) {
      }
      
      // Preload presigned URLs para thumbnails
      const promises = this.transactions.map(async tx => {
        const entries: { selfie?: string; doc?: string } = {}
        try {
          if (tx.selfieUrl) {
            const p = await this.faceService.generateDownloadUrl(tx.selfieUrl, 30).toPromise()
            entries.selfie = p?.url
          }
          if (tx.documentUrl) {
            const p2 = await this.faceService.generateDownloadUrl(tx.documentUrl, 30).toPromise()
            entries.doc = p2?.url
          }
        } catch (err) {
        }
        this.thumbs[tx.id] = entries
      })
      await Promise.allSettled(promises)
    } catch (err) {
      this.transactions = []
      alert('Erro ao carregar histórico. Verifique o console para mais detalhes.')
    } finally {
      this.loading = false
    }
  }

  openResult(id: string): void {
    this.router.navigate(['/result', id])
  }

  getApprovedCount(): number {
    return this.transactions.filter(tx => tx.status === 'Approved').length
  }

  getAverageScore(): number {
    const scores = this.transactions
      .map(tx => tx.similarityScore)
      .filter((score): score is number => score !== null && score !== undefined)
    
    if (scores.length === 0) return 0
    
    const sum = scores.reduce((acc, score) => acc + score, 0)
    return sum / scores.length
  }
}
