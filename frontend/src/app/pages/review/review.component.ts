import { Component, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { Transaction, TransactionStatus } from '../../shared/models/transaction.model'

@Component({
  selector: 'app-review',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './review.component.html',
  styleUrls: ['./review.component.scss']
})
export class ReviewComponent implements OnInit {
  transactions: Transaction[] = []
  loading = false
  thumbs: Record<string, { selfie?: string; doc?: string }> = {}

  constructor(private faceService: FaceRecognitionService) {}

  ngOnInit(): void {
    this.refresh()
  }

  async refresh(): Promise<void> {
    this.loading = true
    try {
      this.transactions = await this.faceService.getTransactionsForReview().toPromise() || []
      // Converter status numérico para string (backend retorna enums como números)
      this.transactions = this.transactions.map(tx => ({
        ...tx,
        status: typeof tx.status === 'number' 
          ? TransactionStatus[tx.status] 
          : tx.status
      }))
      // Preload presigned GET URLs for thumbnails (best-effort)
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
        } catch { /* ignore */ }
        this.thumbs[tx.id] = entries
      })
      await Promise.allSettled(promises)
    } finally {
      this.loading = false
    }
  }

  async review(tx: Transaction, status: 'Approved'|'Rejected'): Promise<void> {
    await this.faceService.reviewTransaction({ transactionId: tx.id, status: status as any }).toPromise()
    await this.refresh()
  }

  handleImageError(event: Event): void {
    const img = event.target as HTMLImageElement
    if (img) {
      img.style.display = 'none'
    }
  }
}
