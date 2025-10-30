import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { CameraService } from '../../core/services/camera.service'
import { FaceRecognitionService } from '../../core/services/face-recognition.service'
import { PresignedUrlRequest, FaceComparisonRequest, FaceComparisonResponse, TransactionStatus } from '../../shared/models/transaction.model'

@Component({
  selector: 'app-capture',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './capture.component.html',
  styleUrls: ['./capture.component.scss']
})
export class CaptureComponent implements OnInit, OnDestroy {
  @ViewChild('video', { static: false }) videoRef?: ElementRef<HTMLVideoElement>

  cameraReady = false
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

  constructor(
    private cameraService: CameraService,
    private faceService: FaceRecognitionService,
  ) {}

  async ngOnInit(): Promise<void> {
    // Optionally start camera automatically
  }

  ngOnDestroy(): void {
    this.stopCamera()
  }

  async startCamera(): Promise<void> {
    if (!this.videoRef) return
    const supported = await this.cameraService.checkCameraSupport()
    if (!supported) {
      alert('Camera not supported in this browser')
      return
    }
    const stream = await this.cameraService.getMediaStream()
    this.videoRef.nativeElement.srcObject = stream
    this.cameraReady = true
  }

  stopCamera(): void {
    this.cameraService.stopStream()
    this.cameraReady = false
  }

  async captureSelfie(): Promise<void> {
    if (!this.videoRef) return
    this.selfieDataUrl = await this.cameraService.capturePhoto(this.videoRef.nativeElement)
    // Only capture the selfie; uploading is triggered explicitly by the Upload button
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
      console.error(err)
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
    // Allow upload with only selfie
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
      // 1) Upload selfie via API
      const selfieUpload = await this.faceService.uploadViaApi(selfieFile, this.transactionId ?? undefined).toPromise()
      if (!selfieUpload) throw new Error('Failed to upload selfie via API')

      // 2) Upload document via API
      const docUpload = await this.faceService.uploadViaApi(this.documentFile, this.transactionId ?? undefined).toPromise()
      if (!docUpload) throw new Error('Failed to upload document via API')
      this.documentUploadedKey = docUpload.key

      const [selfieDL, docDL] = await Promise.all([
        this.faceService.generateDownloadUrl(selfieUpload.key).toPromise(),
        this.faceService.generateDownloadUrl(docUpload.key).toPromise()
      ])
      this.selfieViewUrl = selfieDL?.url || null
      this.documentViewUrl = docDL?.url || null

      // 3) Compare faces
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
      console.error(err)
      alert('There was an error during validation. Please try again.')
    } finally {
      this.loading = false
    }
  }
}
