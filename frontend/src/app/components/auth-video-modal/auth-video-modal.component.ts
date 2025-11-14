import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { CognitoService } from '../../core/aws/cognito.service';
import { RekognitionService } from '../../core/aws/rekognition.service';
import { S3Service } from '../../core/aws/s3.service';
import { LivenessSummary, LivenessVideoSummary } from '../../core/models/liveness-result.model';
import { VoiceStep } from '../../core/models/voice-step.model';
import {
  startCameraStream,
  stopMediaStream,
  startVideoRecording,
  MediaRecorderController,
  RecordedMedia
} from '../../core/utils/media-recorder.util';
import { captureFrame, blobToUint8Array } from '../../core/utils/photo-capture.util';
import { cancelSpeech, speakSequence } from '../../core/utils/voice-sequence.util';

interface CaptureInternal {
  position: string;
  confidence: number;
  s3Key: string;
  previewUrl: string;
}

@Component({
  selector: 'app-auth-video-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth-video-modal.component.html',
  styleUrls: ['./auth-video-modal.component.scss']
})
export class AuthVideoModalComponent implements OnDestroy {
  @ViewChild('videoElement') videoRef?: ElementRef<HTMLVideoElement>;

  @Input({ required: true }) voiceSteps: VoiceStep[] = [];
  @Input() totalSegments = 64;

  @Output() sessionCompleted = new EventEmitter<LivenessSummary>();
  @Output() sessionFailed = new EventEmitter<string>();

  isRunning = false;
  progress = 0;
  statusMessage = '';
  errorMessage: string | null = null;
  currentDirection: 'up' | 'down' | 'left' | 'right' | 'center' | null = null;

  private stream?: MediaStream;
  private videoRecorder: MediaRecorderController | null = null;
  private shouldAbort = false;

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

    cancelSpeech();
    this.resetState();
    this.shouldAbort = false;
    this.updateProgress(5);
    this.isRunning = true;
    this.statusMessage = 'Preparando sessão...';

    const sessionId = `${Date.now()}`;
    const captures: CaptureInternal[] = [];
    let referenceFaceBytes: Uint8Array | null = null;
    let recordedVideo: RecordedMedia | null = null;

    try {
      const credentials = await this.cognitoService.getCredentials(true);
      this.updateProgress(15);

      this.stream = await startCameraStream();
      const videoElement = this.videoRef?.nativeElement;

      if (!videoElement) {
        throw new Error('Elemento de vídeo não encontrado.');
      }

      videoElement.srcObject = this.stream;
      await videoElement.play();
      this.updateProgress(25);
      this.statusMessage = 'Câmera ativada. Aguarde as instruções...';

      this.videoRecorder = await startVideoRecording(this.stream);
      this.updateProgress(30);

      for (let i = 0; i < this.voiceSteps.length; i++) {
        if (this.shouldAbort) {
          throw new Error('Sessão cancelada pelo usuário.');
        }

        const step = this.voiceSteps[i];
        this.currentDirection = step.posicao as any;
        this.statusMessage = step.texto || 'Aguardando...';

        if (step.texto) {
          await speakSequence([step]);
        } else {
          await new Promise((resolve) => setTimeout(resolve, step.delay));
        }

        if (this.shouldAbort) {
          throw new Error('Sessão cancelada pelo usuário.');
        }

        const blob = await captureFrame(videoElement);
        if (!blob) {
          continue;
        }

        const frameBytes = await blobToUint8Array(blob);
        if (i === 0) {
          referenceFaceBytes = frameBytes;
        }

        const confidence = await this.rekognitionService.detectFaceConfidence(frameBytes);
        if (confidence === 0) {
          continue;
        }

        const { key, url } = await this.s3Service.uploadLivenessAsset(sessionId, step.posicao, blob);

        captures.push({
          position: step.posicao,
          confidence,
          s3Key: key,
          previewUrl: url ?? URL.createObjectURL(blob)
        });

        const progressStep = 60 / this.voiceSteps.length;
        this.updateProgress(30 + (i + 1) * progressStep);
      }

      if (this.shouldAbort) {
        throw new Error('Sessão cancelada pelo usuário.');
      }

      this.statusMessage = 'Finalizando captura...';
      this.updateProgress(90);

      let videoSummary: LivenessVideoSummary | undefined;
      if (this.videoRecorder) {
        recordedVideo = await this.videoRecorder.stopRecording();
        if (recordedVideo?.blob) {
          try {
            const uploadResult = await this.s3Service.uploadLivenessVideo(sessionId, recordedVideo.blob, recordedVideo.mimeType);
            videoSummary = {
              s3Key: uploadResult.key,
              url: uploadResult.url ?? URL.createObjectURL(recordedVideo.blob),
              mimeType: uploadResult.mimeType,
              size: uploadResult.size,
              durationMs: recordedVideo.durationMs
            };
          } catch (videoError) {
          }
        }
      }

      this.updateProgress(100);
      this.statusMessage = 'Captura concluída!';

      const livenessScore = captures.length
        ? captures.reduce((acc, item) => acc + item.confidence, 0) / captures.length
        : 0;

      const summary: LivenessSummary = {
        sessionId,
        createdAt: new Date().toISOString(),
        isLive: livenessScore >= 70,
        livenessScore: Number(livenessScore.toFixed(2)),
        status: livenessScore >= 70 ? 'Aprovado' : 'Rejeitado',
        captures: captures.map((c) => ({
          position: c.position,
          confidence: c.confidence,
          s3Key: c.s3Key,
          previewUrl: c.previewUrl
        })),
        video: videoSummary
      };

      this.sessionCompleted.emit(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido na sessão.';
      this.errorMessage = message;
      this.sessionFailed.emit(message);
    } finally {
      this.cleanup();
    }
  }

  cancelSession(): void {
    this.shouldAbort = true;
    this.cleanup();
    cancelSpeech();
  }

  private resetState(): void {
    this.progress = 0;
    this.statusMessage = '';
    this.errorMessage = null;
    this.currentDirection = null;
    this.isRunning = false;
  }

  private updateProgress(value: number): void {
    this.progress = Math.min(100, Math.max(0, value));
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

  private cleanup(): void {
    if (this.videoRecorder) {
      this.videoRecorder = null;
    }

    if (this.stream) {
      stopMediaStream(this.stream);
      this.stream = undefined;
    }

    const videoElement = this.videoRef?.nativeElement;
    if (videoElement) {
      videoElement.srcObject = null;
      videoElement.pause();
    }

    this.isRunning = false;
  }

  ngOnDestroy(): void {
    this.cleanup();
    cancelSpeech();
  }
}

