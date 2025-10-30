import { Component, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ActivatedRoute } from '@angular/router'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { Transaction } from '../../shared/models/transaction.model'

@Component({
  selector: 'app-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './result.component.html',
  styleUrls: ['./result.component.scss']
})
export class ResultComponent implements OnInit {
  tx: Transaction | null = null
  loading = false
  selfieUrl: string | null = null
  docUrl: string | null = null

  constructor(private route: ActivatedRoute, private faceService: FaceRecognitionService) {}

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id')
    if (!id) return
    this.loading = true
    try {
      this.tx = await this.faceService.getTransaction(id).toPromise() || null
      if (this.tx) {
        const [s, d] = await Promise.all([
          this.tx.selfieUrl ? this.faceService.generateDownloadUrl(this.tx.selfieUrl, 60).toPromise() : Promise.resolve(undefined),
          this.tx.documentUrl ? this.faceService.generateDownloadUrl(this.tx.documentUrl, 60).toPromise() : Promise.resolve(undefined)
        ])
        this.selfieUrl = s?.url || null
        this.docUrl = d?.url || null
      }
    } finally {
      this.loading = false
    }
  }
}
