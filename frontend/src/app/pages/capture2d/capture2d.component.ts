import { Component, OnDestroy, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { FaceComparisonRequest, FaceComparisonResponse } from '../../shared/models/transaction.model'
import { CameraModalComponent } from '../../shared/components/camera-modal/camera-modal.component'

@Component({
  selector: 'app-capture2d',
  standalone: true,
  imports: [CommonModule, FormsModule, CameraModalComponent],
  templateUrl: './capture2d.component.html',
  styleUrls: ['./capture2d.component.scss']
})
export class Capture2dComponent implements OnInit, OnDestroy {
  selfieDataUrl: string | null = null
  selfieUploadedKey: string | null = null
  selfieViewUrl: string | null = null
  documentFile: File | null = null
  documentPreview: string | null = null
  documentUploadedKey: string | null = null
  documentViewUrl: string | null = null
  loading = false
  transactionId: string | null = null
  result: FaceComparisonResponse | null = null
  statusMessage: string | null = null
  
  // Modal state
  showCameraModal = false

  constructor(
    private faceService: FaceRecognitionService
  ) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {}

  openCameraModal(): void {
    this.showCameraModal = true
  }
  
  closeCameraModal(): void {
    this.showCameraModal = false
  }

  onPhotoCaptured(dataUrl: string): void {
    this.selfieDataUrl = dataUrl
    this.closeCameraModal()
  }

  retakePhoto(): void {
    this.selfieDataUrl = null
    this.openCameraModal()
  }

  private async uploadSelfieOnly(): Promise<void> {
    if (!this.selfieDataUrl) return
    this.loading = true
    this.statusMessage = null
    this.selfieUploadedKey = null
    this.selfieViewUrl = null

    try {
      const selfieFile = this.dataUrlToFile(this.selfieDataUrl, 'selfie.jpg')
      const selfieUpload = await this.faceService.uploadViaApi(selfieFile, this.transactionId ?? undefined).toPromise()
      if (!selfieUpload) throw new Error('Failed to upload selfie via API')
      this.selfieUploadedKey = selfieUpload.key
      const view = await this.faceService.generateDownloadUrl(selfieUpload.key).toPromise()
      this.selfieViewUrl = view?.url || null
      this.statusMessage = 'Selfie uploaded successfully.'
    } catch (err) {
      alert('Error uploading selfie. Please try again.')
    } finally {
      this.loading = false
    }
  }

  onDocumentSelected(evt: Event): void {
    const input = evt.target as HTMLInputElement
    const file = input.files && input.files[0]
    if (!file) return
    this.documentFile = file
    this.documentPreview = URL.createObjectURL(file)
  }

  canValidate(): boolean {
    return !!this.selfieDataUrl
  }

  private dataUrlToFile(dataUrl: string, filename: string): File {
    const arr = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)?.[1] ?? 'image/jpeg'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) u8arr[n] = bstr.charCodeAt(n)
    return new File([u8arr], filename, { type: mime })
  }

  onUploadClick(): void {
    if (this.documentFile) {
      this.uploadAndValidate()
    } else {
      this.uploadSelfieOnly()
    }
  }

  async uploadAndValidate(): Promise<void> {
    if (!this.selfieDataUrl || !this.documentFile) return
    this.loading = true
    this.result = null

    try {
      const selfieFile = this.dataUrlToFile(this.selfieDataUrl, 'selfie.jpg')
      const selfieUpload = await this.faceService.uploadViaApi(selfieFile, this.transactionId ?? undefined).toPromise()
      if (!selfieUpload) throw new Error('Failed to upload selfie via API')

      const docUpload = await this.faceService.uploadViaApi(this.documentFile, this.transactionId ?? undefined).toPromise()
      if (!docUpload) throw new Error('Failed to upload document via API')
      this.documentUploadedKey = docUpload.key

      const [selfieDL, docDL] = await Promise.all([
        this.faceService.generateDownloadUrl(selfieUpload.key).toPromise(),
        this.faceService.generateDownloadUrl(docUpload.key).toPromise()
      ])
      this.selfieViewUrl = selfieDL?.url || null
      this.documentViewUrl = docDL?.url || null

      const compareReq: FaceComparisonRequest = {
        selfieKey: selfieUpload.key,
        documentKey: docUpload.key,
        transactionId: this.transactionId ?? undefined,
      }
      const compare = await this.faceService.compareFaces(compareReq).toPromise()
      if (compare) {
        this.result = compare
        this.transactionId = compare.transactionId
      }
    } catch (err) {
      alert('There was an error during validation. Please try again.')
    } finally {
      this.loading = false
    }
  }
}
