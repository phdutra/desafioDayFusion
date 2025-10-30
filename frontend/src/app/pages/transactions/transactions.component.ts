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
      this.transactions = await this.faceService.getTransactions().toPromise() || []
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

  openResult(id: string): void {
    this.router.navigate(['/result', id])
  }
}
