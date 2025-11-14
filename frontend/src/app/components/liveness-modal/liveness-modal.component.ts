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
          this.statusMessage = step.texto;
          this.updateDirection(step.posicao);
          console.info('[LivenessModal] Instrução anunciada.', { index, step });
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
          const sizeKB = (blob.size / 1024).toFixed(2);
          
          console.info('[LivenessModal] ✅ Foto comprimida e capturada:', {
            position: step.posicao,
            size: `${sizeKB} KB`,
            mimeType: blob.type,
            resolution: '640×480',
            quality: '80%'
          });
          
          const confidence = await this.rekognitionService.detectFaceConfidence(bytes);
          const { key, url } = await this.s3Service.uploadLivenessAsset(sessionId, step.posicao, blob);
          
          console.info('[LivenessModal] ✅ Foto enviada ao S3:', {
            position: step.posicao,
            s3Key: key,
            size: `${sizeKB} KB`
          });

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
        const sizeMB = (recordedVideo.blob.size / 1024 / 1024).toFixed(2);
        const sizeKB = (recordedVideo.blob.size / 1024).toFixed(2);
        const durationSeconds = (recordedVideo.durationMs / 1000).toFixed(2);
        const bitrate = recordedVideo.durationMs > 0
          ? ((recordedVideo.blob.size * 8) / (recordedVideo.durationMs / 1000) / 1000).toFixed(0)
          : '0';
        
        console.info('[LivenessModal] ✅ Vídeo comprimido e capturado:', {
          mimeType: recordedVideo.mimeType,
          size: `${sizeMB} MB (${sizeKB} KB)`,
          duration: `${durationSeconds}s`,
          bitrate: `${bitrate} kbps`,
          codec: recordedVideo.mimeType.includes('h264') || recordedVideo.mimeType.includes('avc1')
            ? 'H.264 (MP4) - Compatível com Rekognition'
            : recordedVideo.mimeType.includes('vp9')
            ? 'VP9 (WebM) - Fallback'
            : 'WebM'
        });
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
          
          console.info('[LivenessModal] ✅ Vídeo enviado ao S3 com sucesso:', {
            s3Key: uploadResult.key,
            size: `${(uploadResult.size / 1024 / 1024).toFixed(2)} MB`,
            uploadDuration: `${uploadDurationFormatted}s`,
            uploadSpeed: `${uploadSpeed} MB/s`,
            mimeType: uploadResult.mimeType
          });
        } catch (videoError) {
          console.error('[LivenessModal] ❌ Falha ao enviar vídeo ao S3.', videoError);
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
            console.info('[LivenessModal] 📊 Chamando backend para análise completa:', {
              sessionId,
              selfieKey,
              documentKey: documentUpload.key
            });
            
            const livenessResultRequest = {
              sessionId,
              transactionId: this.transactionId,
              documentKey: documentUpload.key,
              selfieKey: selfieKey
            };
            
            // Chamar endpoint do backend para análise completa
            backendAnalysis = await this.faceService.getLivenessResult(livenessResultRequest).toPromise();
            
            console.info('[LivenessModal] ✅ Resposta do backend recebida:', backendAnalysis);
            
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
                console.warn('[LivenessModal] 🚨 Backend rejeitou documento:', backendAnalysis.message);
              }
              
              console.info('[LivenessModal] 📊 Análise completa do backend:', {
                liveness: livenessScore,
                message: backendAnalysis.message,
                status: backendAnalysis.status
              });
            }
          }
        } catch (backendError) {
          console.error('[LivenessModal] ❌ Erro ao chamar backend para análise:', backendError);
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

      console.info('[LivenessModal] Sessão concluída.', summary);

      // Animação de finalização até 100%
      this.statusMessage = 'Finalizando...';
      this.updateProgress(100);
      
      // Preparar resultado e observação
      const isApproved = summary.status === 'Aprovado';
      
      // Usar IdentityScore se disponível, senão usar livenessScore
      if (backendAnalysis?.identityScore !== undefined && backendAnalysis.identityScore !== null) {
        this.resultScore = Math.round(backendAnalysis.identityScore);
      } else {
        this.resultScore = summary.livenessScore;
      }
      
      // Score do documento
      if (backendAnalysis?.documentScore !== undefined && backendAnalysis.documentScore !== null) {
        this.resultDocumentScore = Math.round(backendAnalysis.documentScore);
      } else {
        this.resultDocumentScore = null;
      }
      
      // Construir observação baseada no resultado
      let observation = '';
      
      // Se backend retornou análise, usar observação do backend (prioridade) ou mensagem
      if (backendAnalysis?.observacao) {
        observation = backendAnalysis.observacao;
        console.info('[LivenessModal] 📋 Usando observação do backend:', observation);
      } else if (backendAnalysis?.message) {
        observation = backendAnalysis.message;
        console.info('[LivenessModal] 📋 Usando mensagem do backend:', observation);
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
          console.warn('[LivenessModal] Erro ao finalizar gravação ao cancelar sessão.', stopError);
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

