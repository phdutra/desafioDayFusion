import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CognitoService } from '../../core/aws/cognito.service';
import { RekognitionService } from '../../core/aws/rekognition.service';
import { S3Service } from '../../core/aws/s3.service';
import { LivenessSummary } from '../../core/models/liveness-result.model';
import { VoiceStep } from '../../core/models/voice-step.model';
import {
  startCameraStream,
  stopMediaStream,
  startVideoRecording,
  MediaRecorderController,
  RecordedMedia
} from '../../core/utils/media-recorder.util';
import { captureFrame, blobToUint8Array } from '../../core/utils/photo-capture.util';
import { speakSequence } from '../../core/utils/voice-sequence.util';

interface CaptureInternal {
  position: string;
  confidence: number;
  s3Key: string;
  previewUrl: string;
}

@Component({
  selector: 'app-liveness-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './liveness-modal.component.html',
  styleUrls: ['./liveness-modal.component.scss']
})
export class LivenessModalComponent implements OnDestroy {
  @ViewChild('videoElement') videoRef?: ElementRef<HTMLVideoElement>;

  @Input({ required: true }) voiceSteps: VoiceStep[] = [];
  @Input() documentFile: File | null = null;
  @Input() totalSegments = 64;

  @Output() sessionCompleted = new EventEmitter<LivenessSummary>();
  @Output() sessionFailed = new EventEmitter<string>();

  isRunning = false;
  progress = 0;
  statusMessage = '';
  errorMessage: string | null = null;

  private stream?: MediaStream;
  private videoRecorder: MediaRecorderController | null = null;
  private shouldAbort = false;
  private skipNextStart = false;

  constructor(
    private readonly cognitoService: CognitoService,
    private readonly rekognitionService: RekognitionService,
    private readonly s3Service: S3Service
  ) {}

  async startSession(): Promise<void> {
    if (!this.voiceSteps?.length) {
      this.errorMessage = 'Configure ao menos uma instrução de voz antes de iniciar.';
      return;
    }

    if (this.skipNextStart) {
      this.skipNextStart = false;
      this.shouldAbort = false;
      return;
    }

    speechSynthesis.cancel();
    this.resetState();
    this.shouldAbort = false;
    this.updateProgress(5);
    this.isRunning = true;
    this.statusMessage = 'Preparando sessão...';
    console.info('[LivenessModal] Iniciando sessão de liveness.');

    const sessionId = `${Date.now()}`;
    const captures: CaptureInternal[] = [];
    let referenceFaceBytes: Uint8Array | null = null;
    let recordedVideo: RecordedMedia | null = null;
    let documentUpload:
      | {
          key: string;
          url?: string;
        }
      | null = null;

    try {
      console.info('[LivenessModal] Solicitando credenciais Cognito (forceRefresh=true).');
      const credentials = await this.cognitoService.getCredentials(true);
      console.info('[LivenessModal] Credenciais obtidas.', {
        accessKeyId: credentials.accessKeyId?.slice(0, 4) + '***',
        expiration: (credentials as any).expiration ?? null
      });
      this.updateProgress(15);

      this.stream = await startCameraStream();
      const videoElement = this.videoRef?.nativeElement;

      if (!videoElement) {
        throw new Error('Elemento de vídeo não encontrado.');
      }

      videoElement.srcObject = this.stream;
      await videoElement.play();
      console.info('[LivenessModal] Stream de vídeo iniciado.');
      this.updateProgress(20);

      try {
        this.videoRecorder = startVideoRecording(this.stream);
        console.info('[LivenessModal] Gravação de vídeo iniciada.');
      } catch (recorderError) {
        this.videoRecorder = null;
        console.warn('[LivenessModal] Não foi possível iniciar gravação de vídeo.', recorderError);
      }
      this.updateProgress(25);

      const baseProgress = 25;
      const stepsRange = 55;

      await speakSequence(
        this.voiceSteps,
        (step, index) => {
          if (this.shouldAbort) {
            return;
          }
          this.statusMessage = `🎤 ${step.texto}...`;
          console.info('[LivenessModal] Instrução anunciada.', { index, step });
        },
        (step, index) => {
          if (this.shouldAbort) {
            return;
          }
          const ratio = (index + 1) / this.voiceSteps.length;
          const percent = baseProgress + ratio * stepsRange;
          this.updateProgress(percent);
          this.statusMessage = `📸 Captura ${index + 1}/${this.voiceSteps.length} concluída`;
          console.info('[LivenessModal] Captura concluída.', { position: step.posicao, index });
        },
        async (step) => {
          if (this.shouldAbort) {
            return;
          }
          if (!videoElement) {
            throw new Error('Vídeo não inicializado.');
          }

          const blob = await captureFrame(videoElement);
          const bytes = await blobToUint8Array(blob);
          console.info('[LivenessModal] Foto capturada.', {
            position: step.posicao,
            blobSize: blob.size,
            mimeType: blob.type
          });
          const confidence = await this.rekognitionService.detectFaceConfidence(bytes);
          const { key, url } = await this.s3Service.uploadLivenessAsset(sessionId, step.posicao, blob);

          captures.push({
            position: step.posicao,
            confidence,
            s3Key: key,
            previewUrl: url ?? URL.createObjectURL(blob)
          });

          if (!referenceFaceBytes && step.posicao.toLowerCase() === 'frente') {
            referenceFaceBytes = bytes;
          }

          if (!referenceFaceBytes) {
            referenceFaceBytes = bytes;
          }
        },
        () => this.shouldAbort
      );

      if (this.shouldAbort) {
        this.statusMessage = 'Sessão cancelada pelo usuário.';
        this.errorMessage = null;
        return;
      }

      this.statusMessage = 'Processando capturas...';
      this.updateProgress(85);

      if (this.videoRecorder) {
        console.info('[LivenessModal] Finalizando gravação de vídeo.');
        recordedVideo = await this.videoRecorder.stopRecording();
        console.info('[LivenessModal] Vídeo capturado.', {
          mimeType: recordedVideo.mimeType,
          size: recordedVideo.blob.size,
          durationMs: recordedVideo.durationMs
        });
        this.videoRecorder = null;
        this.updateProgress(90);
      }

      stopMediaStream(this.stream);
      this.stream = undefined;
      
      // Processar análise com progresso incremental
      this.statusMessage = 'Analisando resultados...';
      this.updateProgress(92);

      const livenessScore = captures.length
        ? captures.reduce((acc, item) => acc + item.confidence, 0) / captures.length
        : 0;
      
      this.updateProgress(96);

      let faceMatchScore: number | undefined;

      if (this.documentFile && referenceFaceBytes) {
        const documentBlob = this.documentFile;
        const documentBytes = await blobToUint8Array(documentBlob);
        const faceMatch = await this.rekognitionService.compareFaces(referenceFaceBytes, documentBytes);
        faceMatchScore = faceMatch.similarity;
        documentUpload = await this.s3Service.uploadLivenessAsset(sessionId, 'document', documentBlob);
      }

      let videoSummary: LivenessSummary['video'] | undefined;

      if (recordedVideo && recordedVideo.blob.size > 0) {
        try {
          const uploadResult = await this.s3Service.uploadLivenessVideo(sessionId, recordedVideo.blob, recordedVideo.mimeType);
          videoSummary = {
            s3Key: uploadResult.key,
            url: uploadResult.url ?? URL.createObjectURL(recordedVideo.blob),
            mimeType: uploadResult.mimeType,
            size: uploadResult.size,
            durationMs: recordedVideo.durationMs
          };
          console.info('[LivenessModal] Vídeo enviado ao S3.', videoSummary);
        } catch (videoError) {
          console.error('[LivenessModal] Falha ao enviar vídeo ao S3.', videoError);
        }
      }

      const isLive = livenessScore >= 70;
      const hasStrongMatch = faceMatchScore === undefined || faceMatchScore >= 80;

      const metadata: Record<string, string> = {};
      if (this.documentFile?.name) {
        metadata['documentName'] = this.documentFile.name;
      }
      if (documentUpload?.url) {
        metadata['documentUrl'] = documentUpload.url;
      }

      const summary: LivenessSummary = {
        sessionId,
        createdAt: new Date().toISOString(),
        isLive,
        livenessScore: Number(livenessScore.toFixed(2)),
        faceMatchScore: faceMatchScore !== undefined ? Number(faceMatchScore.toFixed(2)) : undefined,
        status: !isLive ? 'Rejeitado' : hasStrongMatch ? 'Aprovado' : 'Revisar',
        captures,
        video: videoSummary,
        documentKey: documentUpload?.key ?? undefined,
        documentName: this.documentFile?.name ?? undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined
      };

      console.info('[LivenessModal] Sessão concluída.', summary);

      // Animação de finalização até 100%
      this.statusMessage = 'Finalizando...';
      this.updateProgress(100);
      
      // Aguardar animação de finalização antes de emitir conclusão
      await new Promise(resolve => setTimeout(resolve, 500));
      
      this.statusMessage = 'Sessão concluída com sucesso.';
      this.sessionCompleted.emit(summary);
    } catch (error: any) {
      const message = error?.message ?? 'Falha inesperada durante a sessão.';
      console.error('[LivenessModal] Falha na sessão.', {
        message,
        error
      });
      this.errorMessage = message;
      this.statusMessage = 'Erro durante a sessão.';
      this.sessionFailed.emit(message);
    } finally {
      if (this.shouldAbort) {
        this.statusMessage = 'Sessão cancelada pelo usuário.';
        this.errorMessage = null;
      }
      stopMediaStream(this.stream);
      this.stream = undefined;
      this.isRunning = false;
      console.info('[LivenessModal] Sessão finalizada (cleanup).');
      if (this.videoRecorder) {
        try {
          await this.videoRecorder.stopRecording();
        } catch (stopError) {
          console.warn('[LivenessModal] Erro ao finalizar gravação de vídeo no cleanup.', stopError);
        } finally {
          this.videoRecorder = null;
        }
      }
    }
  }

  cancelSession(): void {
    const wasRunning = this.isRunning;
    this.shouldAbort = true;
    this.skipNextStart = !wasRunning;
    speechSynthesis.cancel();

    this.statusMessage = 'Sessão cancelada pelo usuário.';
    this.errorMessage = null;
    this.isRunning = false;
    this.progress = 0;
    stopMediaStream(this.stream);
    this.stream = undefined;

    if (this.videoRecorder) {
      const recorder = this.videoRecorder;
      this.videoRecorder = null;
      if (recorder) {
        void recorder.stopRecording().catch((stopError) => {
          console.warn('[LivenessModal] Erro ao finalizar gravação ao cancelar sessão.', stopError);
        });
      }
    }
  }

  ngOnDestroy(): void {
    this.shouldAbort = true;
    speechSynthesis.cancel();
    stopMediaStream(this.stream);
    this.stream = undefined;
  }

  private resetState(): void {
    this.progress = 0;
    this.statusMessage = '';
    this.errorMessage = null;
  }

  private updateProgress(target: number): void {
    const value = Math.min(100, Math.max(0, Math.round(target)));
    if (value > this.progress) {
      this.progress = value;
    }
  }

  get ringSegments(): Array<{ rotation: string; active: boolean }> {
    const segments = Math.max(24, this.totalSegments);
    const activeSegments = Math.round((this.progress / 100) * segments);
    const angle = 360 / segments;

    return Array.from({ length: segments }, (_, index) => ({
      rotation: `rotate(${index * angle}deg)`,
      active: index < activeSegments
    }));
  }
}

