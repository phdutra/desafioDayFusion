import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CognitoService } from '../../core/aws/cognito.service';
import { RekognitionService } from '../../core/aws/rekognition.service';
import { S3Service } from '../../core/aws/s3.service';
import { FaceRecognitionService } from '../../core/services/face-recognition.service';
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
import { cancelSpeech, speakSequence } from '../../core/utils/voice-sequence.util';

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
  currentDirection: 'up' | 'down' | 'left' | 'right' | 'center' | null = null;
  resultStatus: 'loading' | 'approved' | 'rejected' | null = null;
  resultScore: number | null = null;
  resultDocumentScore: number | null = null;
  resultObservation: string | null = null;

  private stream?: MediaStream;
  private videoRecorder: MediaRecorderController | null = null;
  private shouldAbort = false;

  @Input() transactionId?: string;

  constructor(
    private readonly cognitoService: CognitoService,
    private readonly rekognitionService: RekognitionService,
    private readonly s3Service: S3Service,
    private readonly faceService: FaceRecognitionService
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
    let documentUpload:
      | {
          key: string;
          url?: string;
        }
      | null = null;

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
      this.updateProgress(20);

      try {
        this.videoRecorder = startVideoRecording(this.stream);
      } catch (recorderError) {
        this.videoRecorder = null;
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
          this.statusMessage = step.texto;
          this.updateDirection(step.posicao);
        },
        (step, index) => {
          if (this.shouldAbort) {
            return;
          }
          const ratio = (index + 1) / this.voiceSteps.length;
          const percent = baseProgress + ratio * stepsRange;
          this.updateProgress(percent);
          this.statusMessage = `Captura ${index + 1}/${this.voiceSteps.length} concluída`;
          // Mantém a direção por um tempo antes de resetar
          setTimeout(() => {
            if (index === this.voiceSteps.length - 1) {
              this.currentDirection = null;
            }
          }, 500);
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
        recordedVideo = await this.videoRecorder.stopRecording();
        this.videoRecorder = null;
        this.updateProgress(90);
      }

      stopMediaStream(this.stream);
      this.stream = undefined;
      
      // Processar análise com progresso incremental
      this.statusMessage = 'Analisando resultados...';
      this.updateProgress(92);

      let livenessScore = captures.length
        ? captures.reduce((acc, item) => acc + item.confidence, 0) / captures.length
        : 0;
      
      this.updateProgress(96);

    let faceMatchScore: number | undefined;
    let faceMatchReason: string | undefined;

      if (this.documentFile && referenceFaceBytes) {
        const documentBlob = this.documentFile;
        const documentBytes = await blobToUint8Array(documentBlob);
      const faceMatch = await this.rekognitionService.compareFaces(referenceFaceBytes, documentBytes);
        faceMatchScore = faceMatch.similarity;
      faceMatchReason = faceMatch.reason;
        documentUpload = await this.s3Service.uploadLivenessAsset(sessionId, 'document', documentBlob);
      }

      let videoSummary: LivenessSummary['video'] | undefined;

      if (recordedVideo && recordedVideo.blob.size > 0) {
        try {
          const uploadStartTime = performance.now();
          this.statusMessage = 'Enviando vídeo comprimido ao S3...';
          const uploadResult = await this.s3Service.uploadLivenessVideo(sessionId, recordedVideo.blob, recordedVideo.mimeType);
          const uploadDurationSeconds = (performance.now() - uploadStartTime) / 1000;
          const uploadDurationFormatted = uploadDurationSeconds.toFixed(2);
          const uploadSpeed = uploadDurationSeconds > 0
            ? ((recordedVideo.blob.size / 1024 / 1024) / uploadDurationSeconds).toFixed(2)
            : '0';
          
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

    let isLive = livenessScore >= 70;
    const hasStrongMatch = faceMatchScore === undefined || faceMatchScore >= 80;
    let documentRejected = this.documentFile !== null && faceMatchScore === 0;

      const metadata: Record<string, string> = {};
      if (this.documentFile?.name) {
        metadata['documentName'] = this.documentFile.name;
      }
      if (documentUpload?.url) {
        metadata['documentUrl'] = documentUpload.url;
      }
    if (faceMatchReason) {
      metadata['faceMatchReason'] = faceMatchReason;
    }

      // Se documento foi enviado, chamar backend para análise completa
      let backendAnalysis: any = null;
      if (documentUpload?.key && referenceFaceBytes) {
        try {
          this.statusMessage = 'Analisando documento no servidor...';
          
          // Obter chave S3 da selfie de referência (frente)
          const frontCapture = captures.find(c => c.position.toLowerCase() === 'frente');
          const selfieKey = frontCapture?.s3Key;
          
          if (selfieKey && documentUpload.key) {
            const livenessResultRequest = {
              sessionId,
              transactionId: this.transactionId,
              documentKey: documentUpload.key,
              selfieKey: selfieKey
            };
            
            // Chamar endpoint do backend para análise completa
            backendAnalysis = await this.faceService.getLivenessResult(livenessResultRequest).toPromise();
            
            // Se backend retornou análise, usar esses dados
            if (backendAnalysis) {
              // Atualizar scores com dados do backend
              if (backendAnalysis.confidence !== undefined) {
                livenessScore = backendAnalysis.confidence * 100;
              }
              
              // Backend já fez match + análise de documento
              // Se backend rejeitou, atualizar status
              if (backendAnalysis.message && backendAnalysis.message.includes('rejeitado')) {
                isLive = false;
                documentRejected = true;
              }
            }
          }
        } catch (backendError) {
          // Continua com análise local se backend falhar
        }
      }

      const summary: LivenessSummary = {
        sessionId,
        createdAt: new Date().toISOString(),
        isLive,
        livenessScore: Number(livenessScore.toFixed(2)),
        faceMatchScore: faceMatchScore !== undefined ? Number(faceMatchScore.toFixed(2)) : undefined,
      status: !isLive ? 'Rejeitado' : documentRejected ? 'Rejeitado' : hasStrongMatch ? 'Aprovado' : 'Revisar',
        captures,
        video: videoSummary,
        documentKey: documentUpload?.key ?? undefined,
        documentName: this.documentFile?.name ?? undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        backendAnalysis: backendAnalysis ?? undefined
      };


      // Animação de finalização até 100%
      this.statusMessage = 'Finalizando...';
      this.updateProgress(100);
      
      // Preparar resultado e observação
      const isApproved = summary.status === 'Aprovado';
      
      // Quando aprovado, mostrar apenas um score consolidado
      if (isApproved) {
        // Calcular score consolidado: média ponderada ou usar o melhor score disponível
        let consolidatedScore = 0;
        
        if (backendAnalysis?.identityScore !== undefined && backendAnalysis.identityScore !== null) {
          // Se tem identityScore, usar ele (já é um score consolidado)
          consolidatedScore = Math.round(backendAnalysis.identityScore * 100);
        } else {
          // Calcular média ponderada: 60% liveness + 40% documento
          const livenessWeight = 0.6;
          const documentWeight = 0.4;
          
          const livenessScore = summary.livenessScore;
          const documentScore = backendAnalysis?.documentScore 
            ? Math.round(backendAnalysis.documentScore) 
            : 100; // Se não tem documento score mas está aprovado, assume 100
          
          consolidatedScore = Math.round(
            (livenessScore * livenessWeight) + (documentScore * documentWeight)
          );
        }
        
        // Garantir que o score consolidado seja pelo menos 85% quando aprovado
        this.resultScore = Math.max(consolidatedScore, 85);
        this.resultDocumentScore = null; // Não mostrar score separado quando aprovado
      } else {
        // Quando rejeitado ou em revisão, mostrar scores separados para diagnóstico
        if (backendAnalysis?.identityScore !== undefined && backendAnalysis.identityScore !== null) {
          this.resultScore = Math.round(backendAnalysis.identityScore * 100);
        } else {
          this.resultScore = summary.livenessScore;
        }
        
        // Score do documento (apenas quando não aprovado)
        if (backendAnalysis?.documentScore !== undefined && backendAnalysis.documentScore !== null) {
          this.resultDocumentScore = Math.round(backendAnalysis.documentScore);
        } else {
          this.resultDocumentScore = null;
        }
      }
      
      // Construir observação baseada no resultado
      let observation = '';
      
      // Se backend retornou análise, usar observação do backend (prioridade) ou mensagem
      if (backendAnalysis?.observacao) {
        observation = backendAnalysis.observacao;
      } else if (backendAnalysis?.message) {
        observation = backendAnalysis.message;
      } else if (isApproved) {
        observation = `Liveness: ${summary.livenessScore}%`;
        if (summary.faceMatchScore !== undefined) {
          observation += ` | Face Match: ${summary.faceMatchScore}%`;
        }
      } else {
        if (!isLive) {
          observation = `Liveness abaixo do mínimo (${summary.livenessScore}% < 70%)`;
        } else if (documentRejected && faceMatchScore !== undefined) {
          observation = `Face match não confere (${faceMatchScore}%)`;
          if (faceMatchReason) {
            observation += `: ${faceMatchReason}`;
          }
        } else {
          observation = `Verificação falhou. Liveness: ${summary.livenessScore}%`;
        }
      }

      this.resultObservation = observation;
      
      // Mostrar animação de loading (verde)
      this.resultStatus = 'loading';
      
      // Aguardar 0.5s no loading verde
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Animação de resultado (azul se aprovado, vermelho se rejeitado)
      this.resultStatus = isApproved ? 'approved' : 'rejected';
      
      // Aguardar 1 segundo da animação de resultado antes de emitir
      await new Promise(resolve => setTimeout(resolve, 9000));
      
      // Após animação, o resultado já está sendo exibido no template
      this.statusMessage = '';
      this.sessionCompleted.emit(summary);
    } catch (error: any) {
      const message = error?.message ?? 'Falha inesperada durante a sessão.';
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
      if (this.videoRecorder) {
        try {
          await this.videoRecorder.stopRecording();
        } catch (stopError) {
        } finally {
          this.videoRecorder = null;
        }
      }
    }
  }

  cancelSession(): void {
    this.shouldAbort = true;
    cancelSpeech();

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
        });
      }
    }
  }

  ngOnDestroy(): void {
    this.shouldAbort = true;
    cancelSpeech();
    stopMediaStream(this.stream);
    this.stream = undefined;
  }

  private resetState(): void {
    this.progress = 0;
    this.statusMessage = '';
    this.errorMessage = null;
    this.currentDirection = null;
    this.resultStatus = null;
    this.resultScore = null;
    this.resultDocumentScore = null;
    this.resultObservation = null;
  }

  private updateDirection(posicao: string): void {
    const posLower = posicao.toLowerCase().trim();
    if (posLower.includes('esquerda') || posLower.includes('left')) {
      this.currentDirection = 'left';
    } else if (posLower.includes('direita') || posLower.includes('right')) {
      this.currentDirection = 'right';
    } else if (posLower.includes('cima') || posLower.includes('cabeça') || posLower.includes('up') || posLower.includes('top')) {
      this.currentDirection = 'up';
    } else if (posLower.includes('baixo') || posLower.includes('down') || posLower.includes('bottom')) {
      this.currentDirection = 'down';
    } else {
      // frente, center, etc
      this.currentDirection = 'center';
    }
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

