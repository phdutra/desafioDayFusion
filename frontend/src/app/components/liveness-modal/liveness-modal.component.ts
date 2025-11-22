import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
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
import { environment } from '../../../environments/environment';
import { StartLivenessRequest, LivenessSessionResponse } from '../../shared/models/transaction.model';
import { LivenessService } from '../../services/liveness.service';
import { firstValueFrom } from 'rxjs';

// Declaração do widget oficial AWS Face Liveness V2 (conforme guia)
declare const FaceLiveness: any;

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
  styleUrls: ['./liveness-modal.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
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

  // AWS Widget properties
  awsSessionId: string = '';
  awsStreamingUrl: string = '';
  awsRegion: string = environment.aws?.region || 'us-east-1';
  resultsUrl: string = `${environment.apiUrl}/liveness/results`;
  useCustomWidget = false; // Flag para usar widget custom (fallback) ou oficial
  
  // AWS Widget state
  private awsPollingActive = false;
  private awsWidgetResult: any = null;
  private widgetEventHandlers: { onLivenessComplete?: (event: Event) => void; onLivenessError?: (event: Event) => void } = {};
  private widgetInstance: any = null; // Instância do widget oficial AWS V2

  constructor(
    private readonly cognitoService: CognitoService,
    private readonly rekognitionService: RekognitionService,
    private readonly s3Service: S3Service,
    private readonly faceService: FaceRecognitionService,
    private readonly livenessService: LivenessService
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
    
    // LOG: Início da sessão
    console.log('[Liveness] 🚀 Iniciando sessão:', {
      sessionId,
      hasDocumentFile: !!this.documentFile,
      documentFileName: this.documentFile?.name,
      voiceStepsCount: this.voiceSteps?.length
    });
    
    // Inicializar widget AWS
    let awsWidgetInitialized = false;
    try {
      await this.initializeAwsWidget(sessionId);
      awsWidgetInitialized = true;
      console.log('[Liveness] ✅ Widget AWS inicializado com sucesso. SessionId AWS:', this.awsSessionId);
    } catch (widgetError) {
      console.error('[Liveness] ❌ Erro ao inicializar widget AWS:', widgetError);
      console.warn('[Liveness] ⚠️ Continuando com fluxo local (sem validação AWS 3D)');
      // Continua com fluxo local mesmo se widget falhar
      awsWidgetInitialized = false;
    }
    
    // Adicionar flag no metadata para indicar se AWS foi inicializado
    const metadata: Record<string, string> = {
      awsWidgetInitialized: String(awsWidgetInitialized),
      awsSessionId: this.awsSessionId || 'N/A'
    };
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

      // Calcular score local ANTES do merge (para enviar ao backend)
      const localLivenessScore = captures.length
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

    // Análise local (capturas, frames, etc)
    const localAnalysis = {
      score: localLivenessScore,
      capturesCount: captures.length,
      averageConfidence: captures.length > 0 
        ? captures.reduce((acc, item) => acc + item.confidence, 0) / captures.length 
        : 0
    };

    // Aguardar resultado do AWS (polling ou evento)
    let awsResult = this.awsWidgetResult;
    if (!awsResult && this.awsSessionId) {
      // Tentar obter resultado do polling se ainda não tiver
      try {
        awsResult = await this.checkAwsResultInBackground(this.awsSessionId);
      } catch (pollError) {
        console.error('[Liveness] Erro ao obter resultado AWS:', pollError);
        awsResult = null;
      }
    }

    // Merge seguro: AWS manda na decisão
    const mergedResult = this.mergeLivenessResults(localAnalysis, awsResult);
    
    // Aplicar resultado do merge
    let isLive = mergedResult.isLive;
    let livenessScore = mergedResult.finalScore; // Score após merge (pode ser 0 se AWS falhou)
    const mergeReason = mergedResult.reason;

    // REGRA ANTI-FRAUDE: Verificar AWS Liveness ANTES de chamar backend
    // IMPORTANTE: Só tratar como fraude se AWS EXPLICITAMENTE detectou FAKE/SPOOF
    // Se AWS não completou (UNKNOWN, CREATED) ou timeout → usar fallback (score local), NÃO tratar como fraude
    const awsDetectedFake = 
      mergedResult.source === 'aws' && // Só se veio do AWS (não fallback)
      (mergedResult.aws?.decision === 'FAKE' || 
       mergedResult.aws?.decision === 'SPOOF' ||
       (mergedResult.aws?.status === 'failed' && mergedResult.aws?.decision !== 'UNKNOWN'));
    
    // LOG: Validação de fraude AWS
    console.log('[Liveness] 🔍 Validação de fraude AWS:', {
      awsDetectedFake,
      source: mergedResult.source,
      awsDecision: mergedResult.aws?.decision,
      awsStatus: mergedResult.aws?.status,
      isLive: mergedResult.isLive,
      reason: mergedResult.reason
    });
    
    // LOG DETALHADO: Registrar estado antes da validação AWS
    console.log('[Liveness] 📊 Estado após merge AWS:', {
      mergedResultIsLive: mergedResult.isLive,
      mergedResultSource: mergedResult.source,
      mergedResultFinalScore: mergedResult.finalScore,
      awsStatus: mergedResult.aws?.status,
      awsDecision: mergedResult.aws?.decision,
      awsConfidence: mergedResult.aws?.confidence,
      mergeReason: mergedResult.reason,
      localLivenessScore: localLivenessScore,
      awsDetectedFake: awsDetectedFake
    });
    
    if (awsDetectedFake) {
      // AWS detectou fraude → zerar score imediatamente
      isLive = false;
      livenessScore = 0;
      console.warn('[Liveness] 🚨 AWS detectou FRAUDE – zerando livenessScore e marcando como não-live.');
      console.warn('[Liveness] Detalhes AWS:', {
        isLive: mergedResult.isLive,
        source: mergedResult.source,
        awsStatus: mergedResult.aws?.status,
        awsDecision: mergedResult.aws?.decision,
        awsConfidence: mergedResult.aws?.confidence,
        reason: mergedResult.reason,
        livenessScoreAntes: mergedResult.finalScore,
        livenessScoreDepois: 0
      });
    } else {
      console.log('[Liveness] ✅ AWS aprovou liveness:', {
        isLive: mergedResult.isLive,
        decision: mergedResult.aws?.decision,
        confidence: mergedResult.aws?.confidence,
        finalScore: mergedResult.finalScore
      });
    }

    const hasStrongMatch = faceMatchScore === undefined || faceMatchScore >= 80;
    let documentRejected = this.documentFile !== null && faceMatchScore === 0;

      // Adicionar informações adicionais ao metadata (já inicializado antes)
      if (this.documentFile?.name) {
        metadata['documentName'] = this.documentFile.name;
      }
      if (documentUpload?.url) {
        metadata['documentUrl'] = documentUpload.url;
      }
    if (faceMatchReason) {
      metadata['faceMatchReason'] = faceMatchReason;
    }
    // Adicionar metadata do AWS
    if (mergedResult.aws) {
      metadata['awsDecision'] = mergedResult.aws.decision;
      metadata['awsConfidence'] = String(mergedResult.aws.confidence);
      metadata['awsStatus'] = mergedResult.aws.status;
    }
    if (mergeReason) {
      metadata['mergeReason'] = mergeReason;
    }
    metadata['localLivenessScore'] = String(localLivenessScore);
    metadata['mergedLivenessScore'] = String(mergedResult.finalScore);

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
              selfieKey: selfieKey,
              localLivenessScore: localLivenessScore  // Enviar score LOCAL original (antes do merge), não o score após merge
            };
            
            // LOG: Antes de chamar backend
            console.log('[Liveness] 📤 Enviando requisição ao backend:', {
              sessionId,
              localLivenessScore: localLivenessScore,
              awsDetectedFake: awsDetectedFake,
              livenessScoreAtual: livenessScore,
              isLive: isLive
            });
            
            // Chamar endpoint do backend para análise completa
            backendAnalysis = await this.faceService.getLivenessResult(livenessResultRequest).toPromise();
            
            // LOG: Resposta do backend
            console.log('[Liveness] 📥 Resposta do backend:', {
              status: backendAnalysis?.status,
              livenessDecision: backendAnalysis?.livenessDecision,
              confidence: backendAnalysis?.confidence,
              identityScore: backendAnalysis?.identityScore,
              documentScore: backendAnalysis?.documentScore,
              matchScore: backendAnalysis?.matchScore,
              observacao: backendAnalysis?.observacao,
              message: backendAnalysis?.message
            });
            
            // Se backend retornou análise, usar esses dados
            if (backendAnalysis) {
              // CRÍTICO: Se AWS detectou fraude, NÃO usar score do backend
              // Manter livenessScore = 0 quando AWS detectou fraude
              if (awsDetectedFake) {
                console.warn('[Liveness] ⚠️ AWS detectou fraude - ignorando livenessScore do backend. Mantendo score = 0');
                livenessScore = 0;
              } else {
                // Atualizar scores com dados do backend apenas se AWS aprovou
              if (backendAnalysis.confidence !== undefined) {
                livenessScore = backendAnalysis.confidence * 100;
                  console.log('[Liveness] ✅ Atualizando livenessScore do backend:', livenessScore);
                }
              }
              
              // Backend já fez match + análise de documento
              // Se backend rejeitou, atualizar status
              if (backendAnalysis.message && backendAnalysis.message.includes('rejeitado')) {
                isLive = false;
                documentRejected = true;
                console.log('[Liveness] ❌ Backend rejeitou via message');
              }
            }
          }
        } catch (backendError) {
          // Continua com análise local se backend falhar
        }
      }

      // REGRA ANTI-FRAUDE: AWS Liveness tem PRIORIDADE MÁXIMA
      // Se AWS detectou FAKE → SEMPRE rejeitar, mesmo que backend tenha aprovado
      // Isso previne spoofing (foto em celular, vídeo em outro dispositivo, etc)
      // (awsDetectedFake já foi definido acima, antes de chamar o backend)
      
      // AJUSTE: Na captura 3D, se há score bom do backend, aprovar automaticamente
      // MAS só se AWS também aprovou (não detectou fraude)
      // Prioridade: AWS Liveness > status do backend > identityScore > observação > scores locais
      let finalStatus: 'Aprovado' | 'Rejeitado' | 'Revisar' = 'Revisar';
      
      // REGRA ANTI-FRAUDE CRÍTICA: Só aprovar se AWS confirmou LIVE explicitamente
      // Se AWS não completou ou não confirmou LIVE → SEMPRE rejeitar/revisar (não aprovar)
      
      // Se AWS detectou fraude, rejeitar imediatamente
      if (awsDetectedFake) {
        finalStatus = 'Rejeitado';
        console.log('[Liveness] ❌ Rejeitado: AWS detectou fraude (FAKE/SPOOF)');
      }
      // Se AWS não completou validação (timeout, UNKNOWN, CREATED) → REJEITAR/REVISAR
      else if (mergedResult.source === 'fallback' || !mergedResult.isLive) {
        // AWS não validou → não aprovar automaticamente (pode ser spoofing)
        finalStatus = 'Rejeitado';
        console.log('[Liveness] ❌ Rejeitado: AWS não completou validação 3D. Sem validação AWS, não é possível confirmar que não é spoofing.');
      } else if (documentRejected) {
        finalStatus = 'Rejeitado';
        console.log('[Liveness] ❌ Rejeitado: documento rejeitado');
      } else if (backendAnalysis) {
        // Se backend retornou análise E AWS confirmou LIVE, usar decisão do backend
        // IMPORTANTE: Só aprovar se AWS também confirmou LIVE (não apenas se backend aprovou)
        if (backendAnalysis.status) {
          const backendStatus = backendAnalysis.status.toUpperCase();
          if (backendStatus === 'APPROVED' || backendStatus === 'APROVADO') {
            // Só aprovar se AWS também confirmou LIVE
            if (mergedResult.isLive && mergedResult.aws?.decision === 'LIVE') {
              finalStatus = 'Aprovado';
              console.log('[Liveness] ✅ Aprovado: Backend APPROVED E AWS confirmou LIVE');
            } else {
              finalStatus = 'Rejeitado';
              console.log('[Liveness] ❌ Rejeitado: Backend aprovou mas AWS não confirmou LIVE');
            }
          } else if (backendStatus === 'REJECTED' || backendStatus === 'REJEITADO') {
            finalStatus = 'Rejeitado';
            console.log('[Liveness] ❌ Rejeitado: Backend rejeitou via status');
          } else if (backendStatus === 'REVIEW' || backendStatus === 'REVISAR' || backendStatus === 'MANUAL_REVIEW') {
            finalStatus = 'Revisar';
            console.log('[Liveness] 🔍 Backend solicitou revisão via status');
          }
        }
        
        // Se não há status explícito, usar identityScore (mas só aprovar se AWS confirmou LIVE)
        if (finalStatus === 'Revisar' && backendAnalysis.identityScore !== undefined && backendAnalysis.identityScore !== null) {
          const identityScoreValue = backendAnalysis.identityScore;
          // Só aprovar se IdentityScore alto E AWS confirmou LIVE
          if (identityScoreValue >= 0.85 && mergedResult.isLive && mergedResult.aws?.decision === 'LIVE') {
            finalStatus = 'Aprovado';
            console.log('[Liveness] ✅ Aprovado: IdentityScore alto E AWS confirmou LIVE');
          } else if (identityScoreValue >= 0.70) {
            finalStatus = 'Revisar';
            console.log('[Liveness] 🔍 Revisar: IdentityScore médio ou AWS não confirmou LIVE');
          } else {
            finalStatus = 'Rejeitado';
            console.log('[Liveness] ❌ Rejeitado: IdentityScore baixo');
          }
        }
        
        // Se ainda não definiu, verificar observação (mas só aprovar se AWS confirmou LIVE)
        if (finalStatus === 'Revisar' && backendAnalysis.observacao) {
          if (backendAnalysis.observacao.includes('Validação automática aprovada') && 
              mergedResult.isLive && mergedResult.aws?.decision === 'LIVE') {
            finalStatus = 'Aprovado';
            console.log('[Liveness] ✅ Aprovado: Backend aprovou via observação E AWS confirmou LIVE');
          } else if (backendAnalysis.observacao.includes('rejeitado') || backendAnalysis.observacao.includes('fraude')) {
            finalStatus = 'Rejeitado';
            console.log('[Liveness] ❌ Rejeitado: Backend rejeitou via observação');
          } else {
            finalStatus = 'Rejeitado';
            console.log('[Liveness] ❌ Rejeitado: Backend aprovou mas AWS não confirmou LIVE');
          }
        }
      } else if (hasStrongMatch && livenessScore >= 80 && mergedResult.isLive && mergedResult.aws?.decision === 'LIVE') {
        // Sem backendAnalysis mas com scores altos E AWS confirmou LIVE → aprovar
        finalStatus = 'Aprovado';
        console.log('[Liveness] ✅ Aprovado: scores locais altos E AWS confirmou LIVE');
      } else {
        // Qualquer outra situação → rejeitar/revisar
        finalStatus = 'Rejeitado';
        console.log('[Liveness] ❌ Rejeitado: AWS não confirmou LIVE ou scores insuficientes');
      }

      // Preparar resultado e observação
      const isApproved = finalStatus === 'Aprovado';
      
      // Construir observação baseada no resultado ANTES de criar summary
      let observation = '';
      
      // PRIORIDADE 1: Se AWS detectou fraude, sempre mostrar mensagem de fraude
      if (awsDetectedFake) {
        observation = `🚨 Fraude detectada pelo AWS Liveness: ${mergeReason || 'Possível spoofing (foto em celular, vídeo em outro dispositivo, etc)'}`;
        console.log('[Liveness] 📝 Observação definida como fraude AWS:', observation);
      }
      // PRIORIDADE 2: Se backend retornou análise, usar observação do backend (mas só se AWS não detectou fraude)
      else if (backendAnalysis?.observacao) {
        observation = backendAnalysis.observacao;
        console.log('[Liveness] 📝 Observação do backend:', observation);
      } else if (backendAnalysis?.message) {
        observation = backendAnalysis.message;
        console.log('[Liveness] 📝 Mensagem do backend:', observation);
      } else if (isApproved) {
        observation = `Liveness: ${livenessScore}%`;
        if (faceMatchScore !== undefined) {
          observation += ` | Face Match: ${faceMatchScore}%`;
        }
        console.log('[Liveness] 📝 Observação de aprovação:', observation);
      } else {
        // Priorizar razão do merge AWS se disponível
        if (mergeReason && !isLive) {
          observation = mergeReason;
        } else if (!isLive) {
          observation = `Liveness abaixo do mínimo (${livenessScore}% < 70%)`;
        } else if (documentRejected && faceMatchScore !== undefined) {
          observation = `Face match não confere (${faceMatchScore}%)`;
          if (faceMatchReason) {
            observation += `: ${faceMatchReason}`;
          }
        } else {
          observation = `Verificação falhou. Liveness: ${livenessScore}%`;
        }
        console.log('[Liveness] 📝 Observação de rejeição/revisão:', observation);
      }
      
      // Salvar observação no metadata para aparecer no histórico
      if (observation) {
        metadata['observacao'] = observation;
      }
      
      // Adicionar informações de debug no metadata
      metadata['awsDetectedFake'] = String(awsDetectedFake);
      metadata['awsDecision'] = mergedResult.aws?.decision || 'N/A';
      metadata['awsStatus'] = String(mergedResult.aws?.status || 'N/A');
      metadata['awsConfidence'] = String(mergedResult.aws?.confidence || 0);
      metadata['mergeSource'] = mergedResult.source || 'unknown';
      metadata['mergeReason'] = mergeReason || 'N/A';
      metadata['localLivenessScore'] = String(localLivenessScore);
      metadata['mergedLivenessScore'] = String(mergedResult.finalScore);

      const summary: LivenessSummary = {
        sessionId,
        createdAt: new Date().toISOString(),
        isLive,
        livenessScore: Number(livenessScore.toFixed(2)),
        faceMatchScore: faceMatchScore !== undefined ? Number(faceMatchScore.toFixed(2)) : undefined,
        status: finalStatus,
        captures,
        video: videoSummary,
        documentKey: documentUpload?.key ?? undefined,
        documentName: this.documentFile?.name ?? undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        backendAnalysis: backendAnalysis ?? undefined
      };

      // LOG FINAL: Resumo completo antes de finalizar
      console.log('[Liveness] 📊 RESUMO FINAL:', {
        finalStatus: finalStatus,
        isLive: isLive,
        livenessScore: livenessScore,
        faceMatchScore: faceMatchScore,
        awsDetectedFake: awsDetectedFake,
        awsDecision: mergedResult.aws?.decision,
        awsStatus: mergedResult.aws?.status,
        backendStatus: backendAnalysis?.status,
        backendIdentityScore: backendAnalysis?.identityScore,
        observation: observation,
        documentRejected: documentRejected
      });

      // Animação de finalização até 100%
      this.statusMessage = 'Finalizando...';
      this.updateProgress(100);
      
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
    this.detachWidgetEvents();
    this.destroyOfficialWidget();
  }

  // ========== AWS Widget Integration ==========

  private async initializeAwsWidget(sessionId: string): Promise<void> {
    try {
      // Tentar usar widget oficial AWS V2 primeiro (conforme guia)
      if (typeof FaceLiveness !== 'undefined') {
        await this.initializeOfficialWidget();
        return;
      }
      
      // Fallback: usar widget custom ou método antigo
      console.warn('[Liveness] Widget oficial AWS V2 não encontrado, usando método alternativo');
      this.useCustomWidget = true;
      
      // Criar sessão AWS Liveness
      const request: StartLivenessRequest = {
        transactionId: this.transactionId
      };
      
      const sessionResponse = await this.faceService.startLivenessSession(request).toPromise();
      
      if (!sessionResponse?.sessionId) {
        throw new Error('Falha ao criar sessão AWS Liveness');
      }

      this.awsSessionId = sessionResponse.sessionId;
      this.awsStreamingUrl = sessionResponse.streamingUrl || '';
      
      // Anexar listeners de eventos do widget
      this.attachWidgetEvents();
      
      // Aguardar um pouco para o widget inicializar antes de iniciar polling
      setTimeout(() => {
        // Iniciar polling em background
        this.checkAwsResultInBackground(this.awsSessionId).catch(err => {
          console.error('[Liveness] Erro no polling AWS:', err);
        });
      }, 2000);
      
      console.log('[Liveness] Widget AWS inicializado com sessionId:', this.awsSessionId);
    } catch (error) {
      console.error('[Liveness] Erro ao inicializar widget AWS:', error);
      throw error;
    }
  }

  /**
   * Inicializa widget oficial AWS Face Liveness V2 (conforme guia dayfusion-liveness-modal-aws-v2.md)
   */
  private async initializeOfficialWidget(): Promise<void> {
    try {
      // Passo 1: criar sessão no backend (conforme guia)
      const sessionResponse = await firstValueFrom(this.livenessService.createSession());
      
      if (!sessionResponse?.sessionId) {
        throw new Error('Falha ao criar sessão AWS Liveness');
      }

      this.awsSessionId = sessionResponse.sessionId;
      this.statusMessage = 'Sessão criada. Carregando câmera...';
      
      // Passo 2: inicializar widget oficial
      await this.initOfficialWidget(this.awsSessionId);
      
      console.log('[Liveness] ✅ Widget oficial AWS V2 inicializado com sessionId:', this.awsSessionId);
    } catch (error) {
      console.error('[Liveness] ❌ Erro ao inicializar widget oficial AWS:', error);
      throw error;
    }
  }

  /**
   * Inicializa widget oficial AWS Face Liveness V2 no container
   */
  private async initOfficialWidget(sessionId: string): Promise<void> {
    const container = document.getElementById('liveness-widget-container');
    
    if (!container) {
      console.error('[Liveness] Container do widget não encontrado.');
      return;
    }

    // Limpar widget anterior se existir
    this.destroyOfficialWidget();

    try {
      // Inicializar widget oficial conforme guia
      this.widgetInstance = new FaceLiveness({
        sessionId,
        region: this.awsRegion,
        preset: 'faceMovementAndLight', // conforme doc da AWS
        onError: (err: any) => {
          console.error('[Liveness] Erro widget oficial:', err);
          this.statusMessage = 'Erro na captura. Tente novamente.';
          this.errorMessage = err?.message || 'Erro no widget AWS';
        },
        onComplete: (result: any) => {
          console.log('[Liveness] Resultado parcial (frontend):', result);
          this.statusMessage = 'Processando resultado...';
          if (this.awsSessionId) {
            this.fetchFinalResult(this.awsSessionId);
          }
        }
      });

      this.widgetInstance.render(container);
    } catch (err) {
      console.error('[Liveness] Erro ao inicializar widget oficial:', err);
      this.statusMessage = 'Não foi possível iniciar a câmera.';
      this.errorMessage = 'Erro ao inicializar widget AWS';
      throw err;
    }
  }

  /**
   * Busca resultado final do backend (conforme guia)
   */
  private fetchFinalResult(sessionId: string): void {
    this.livenessService.getResult(sessionId).subscribe({
      next: (result) => {
        console.log('[Liveness] Resultado final (backend):', result);
        const confidence = result.confidence ?? 0;
        this.statusMessage = `Verificação concluída. Confiança: ${(confidence * 100).toFixed(2)}%`;
        
        // Processar resultado e integrar com lógica existente
        this.processAwsResult(result);
      },
      error: (err) => {
        console.error('[Liveness] Erro ao buscar resultado:', err);
        this.statusMessage = 'Erro ao obter resultado da verificação.';
        this.errorMessage = 'Erro ao obter resultado do backend';
      }
    });
  }

  /**
   * Processa resultado do AWS e integra com lógica existente
   */
  private processAwsResult(result: any): void {
    const confidence = result.confidence ?? 0;
    const status = result.status || 'UNKNOWN';
    const decision = result.livenessDecision || result.decision || 'UNKNOWN';
    
    this.awsWidgetResult = {
      status: status === 'SUCCEEDED' ? 'success' : 'failed',
      decision: decision.toUpperCase(),
      confidence: confidence,
      raw: result
    };
    
    console.log('[Liveness] Resultado AWS processado:', this.awsWidgetResult);
  }

  /**
   * Destrói widget oficial AWS V2
   */
  private destroyOfficialWidget(): void {
    if (this.widgetInstance && typeof this.widgetInstance.destroy === 'function') {
      this.widgetInstance.destroy();
    }
    this.widgetInstance = null;
  }

  private attachWidgetEvents(): void {
    const onLivenessComplete = (event: Event) => {
      const customEvent = event as CustomEvent;

      const detail = customEvent.detail || {};
      const decision = detail.decision ?? detail.livenessDecision ?? 'FAKE';
      const confidence = detail.confidence ?? detail.livenessConfidence ?? 0;

      this.awsWidgetResult = {
        status: 'success',
        decision: decision.toUpperCase(),
        confidence,
        raw: detail
      };

      console.log('[Liveness] Evento liveness-complete:', this.awsWidgetResult);
    };

    const onLivenessError = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.error('[Liveness] Evento liveness-error:', customEvent.detail);

      this.awsWidgetResult = {
        status: 'failed',
        decision: 'FAKE',
        confidence: 0,
        raw: customEvent.detail
      };
    };

    document.addEventListener('liveness-complete', onLivenessComplete);
    document.addEventListener('liveness-error', onLivenessError);

    // Guardar referências para remover depois
    this.widgetEventHandlers = { onLivenessComplete, onLivenessError };
  }

  private detachWidgetEvents(): void {
    if (this.widgetEventHandlers.onLivenessComplete) {
      document.removeEventListener('liveness-complete', this.widgetEventHandlers.onLivenessComplete);
    }
    if (this.widgetEventHandlers.onLivenessError) {
      document.removeEventListener('liveness-error', this.widgetEventHandlers.onLivenessError);
    }
    this.widgetEventHandlers = {};
  }

  private async checkAwsResultInBackground(sessionId: string): Promise<any> {
    if (!sessionId) {
      console.warn('[Liveness] checkAwsResultInBackground chamado sem sessionId.');
      return {
        decision: 'FAKE',
        confidence: 0,
        reason: 'Missing sessionId',
        status: 'failed'
      };
    }

    if (this.awsPollingActive) {
      console.log('[Liveness] Polling já está ativo, ignorando nova chamada.');
      return null;
    }

    this.awsPollingActive = true;

    const maxAttempts = 60;       // ~60s (1s por tentativa)
    const pollInterval = 1000;
    let attempts = 0;

    return new Promise((resolve) => {
      const doResolve = (result: any) => {
        this.awsPollingActive = false;
        resolve(result);
      };

      const poll = setInterval(async () => {
        attempts++;

        try {
          const response = await fetch(`${this.resultsUrl}?sessionId=${sessionId}`, {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            }
          });

          if (!response.ok) {
            console.warn('[Liveness] Falha ao obter resultado AWS. HTTP:', response.status);
            if (attempts >= maxAttempts) {
              clearInterval(poll);
              return doResolve({
                decision: 'FAKE',
                confidence: 0,
                reason: `AWS results endpoint error: ${response.status}`,
                status: 'failed'
              });
            }
            return;
          }

          const data = await response.json();
          console.log('[Liveness] Resultado AWS parcial:', data);

          // Se ainda estiver processando (CREATED, IN_PROGRESS, ou sem status), segue o polling
          // IMPORTANTE: CREATED significa que a sessão foi criada mas ainda não processou
          if (!data.status || 
              data.status === 'IN_PROGRESS' || 
              data.status === 'CREATED' ||
              (data.livenessDecision === 'UNKNOWN' && data.confidence === 0)) {
            console.log(`[Liveness] AWS ainda processando (status: ${data.status}, decision: ${data.livenessDecision}). Tentativa ${attempts}/${maxAttempts}`);
            if (attempts >= maxAttempts) {
              clearInterval(poll);
              // Se timeout, retornar null para usar fallback (score local com penalidade)
              // NÃO tratar como fraude se apenas timeout
              console.warn('[Liveness] ⚠️ AWS timeout após', maxAttempts, 'tentativas. Usando fallback (score local).');
              return doResolve(null); // null = usar fallback, não fraude
            }
            return;
          }

          // Aqui já temos um status conclusivo
          clearInterval(poll);

          const livenessDecision = data.livenessDecision ?? data.decision;
          const confidence = data.confidence ?? data.livenessConfidence ?? 0;

          // Normalização do resultado
          // Só considerar 'success' se status for SUCCEEDED E tiver decisão válida
          const isSuccess = data.status === 'SUCCEEDED' && 
                           livenessDecision && 
                           livenessDecision.toUpperCase() !== 'UNKNOWN' &&
                           confidence > 0;

          const normalized = {
            raw: data,
            decision: livenessDecision?.toUpperCase() || 'UNKNOWN',
            confidence,
            status: isSuccess ? 'success' : (data.status === 'SUCCEEDED' ? 'incomplete' : 'failed'),
            reason: data.reason || null,
            awsStatus: data.status // Preservar status original do AWS
          };

          console.log('[Liveness] Resultado AWS normalizado:', normalized);
          return doResolve(normalized);

        } catch (err) {
          console.error('[Liveness] Erro no polling AWS:', err);

          if (attempts >= maxAttempts) {
            clearInterval(poll);
            return doResolve({
              decision: 'FAKE',
              confidence: 0,
              reason: 'AWS polling exception/timeout',
              status: 'failed'
            });
          }
        }
      }, pollInterval);
    });
  }

  private mergeLivenessResults(localAnalysis: any, awsResult: any) {
    // localAnalysis = resultado interno (frames, olhos, movimento etc)
    // awsResult = retorno do checkAwsResultInBackground()

    let finalIsLive = false;
    let finalScore = 0;
    let finalReason: string | null = null;

    // LOG: Estado inicial do merge
    console.log('[Liveness] 🔄 mergeLivenessResults chamado:', {
      hasAwsResult: !!awsResult,
      awsResult: awsResult,
      localAnalysis: localAnalysis,
      localScore: localAnalysis?.score
    });

    // 1. Se não veio awsResult (timeout ou erro), NÃO aprovar automaticamente
    // REGRA ANTI-FRAUDE: Sem validação AWS 3D, não podemos confirmar que não é spoofing
    // Score local alto não detecta foto em celular - apenas AWS 3D detecta isso
    if (!awsResult) {
      const localScore = localAnalysis?.score ?? 0;
      // SEMPRE rejeitar ou revisar quando AWS não validou (não aprovar automaticamente)
      // Isso previne spoofing (foto em celular) que teria score local alto
      finalScore = Math.max(0, localScore - 30); // Penalidade maior (30 pontos)
      finalIsLive = false; // SEMPRE false quando AWS não validou
      finalReason = `⚠️ AWS não completou validação 3D (timeout/erro). Sem validação AWS, não é possível confirmar que não é spoofing (foto em celular). Score local: ${localScore}%, Score final: ${finalScore}%. Revisão obrigatória.`;
      console.warn('[Liveness] 🚨 awsResult ausente – REJEITANDO/REVISANDO (não aprovar sem AWS):', {
        localScore,
        finalScore,
        finalIsLive,
        reason: finalReason
      });
      return {
        isLive: false,
        finalScore,
        reason: finalReason,
        source: 'fallback'
      };
    }

    const decision = (awsResult.decision || '').toUpperCase();
    const confidence = awsResult.confidence ?? 0;
    const awsStatus = awsResult.awsStatus || awsResult.status;

    // LOG: Detalhes do AWS para debug
    console.log('[Liveness] 🔍 Analisando resultado AWS:', {
      decision,
      confidence,
      awsStatus,
      status: awsResult.status,
      reason: awsResult.reason
    });

    // 2. Se AWS EXPLICITAMENTE falou que é FAKE → bloqueia (fraude confirmada)
    if (decision === 'FAKE' || decision === 'SPOOF') {
      console.warn('[Liveness] 🚨 AWS confirmou FAKE/SPOOF – bloqueando.');
      return {
        isLive: false,
        finalScore: 0,
        reason: awsResult.reason || 'AWS confirmed FAKE/SPOOF',
        source: 'aws'
      };
    }

    // 3. Se AWS disse LIVE com confiança boa → considera live
    if (decision === 'LIVE' && confidence >= 0.7) {
      finalIsLive = true;
      finalScore = Math.max(localAnalysis?.score ?? 80, 80);
      finalReason = `AWS confirmed LIVE with confidence ${(confidence * 100).toFixed(1)}%`;
      console.log('[Liveness] ✅ AWS confirmou LIVE:', { confidence, finalScore });
    } 
    // 4. Se AWS retornou UNKNOWN, CREATED, ou status incompleto → REJEITAR/REVISAR (não aprovar)
    // REGRA ANTI-FRAUDE: Sem validação AWS 3D completa, não podemos confirmar que não é spoofing
    else if (decision === 'UNKNOWN' || 
             awsStatus === 'CREATED' || 
             awsStatus === 'IN_PROGRESS' ||
             awsResult.status === 'incomplete') {
      const localScore = localAnalysis?.score ?? 0;
      // SEMPRE rejeitar/revisar quando AWS não completou (não aprovar automaticamente)
      finalScore = Math.max(0, localScore - 30); // Penalidade maior (30 pontos)
      finalIsLive = false; // SEMPRE false quando AWS não completou
      finalReason = `⚠️ AWS não completou validação 3D (status: ${awsStatus}, decision: ${decision}). Sem validação AWS completa, não é possível confirmar que não é spoofing (foto em celular). Score local: ${localScore}%, Score final: ${finalScore}%. Revisão obrigatória.`;
      console.warn('[Liveness] 🚨 AWS não completou análise – REJEITANDO/REVISANDO (não aprovar sem AWS completo):', {
        awsStatus,
        decision,
        localScore,
        finalScore,
        finalIsLive,
        reason: finalReason
      });
      return {
        isLive: false,
        finalScore,
        reason: finalReason,
        source: 'fallback'
      };
    }
    // 5. Se AWS falhou explicitamente (não timeout) → tratar como fraude apenas se decisão for FAKE
    else if (awsResult.status === 'failed' && decision !== 'UNKNOWN') {
      console.warn('[Liveness] AWS falhou explicitamente:', awsResult.reason);
      return {
        isLive: false,
        finalScore: Math.min(localAnalysis?.score ?? 30, 30),
        reason: awsResult.reason || 'AWS analysis failed',
        source: 'aws'
      };
    }
    // 6. Qualquer outra situação não conclusiva → REJEITAR/REVISAR (não aprovar)
    // REGRA ANTI-FRAUDE: Só aprovar se AWS confirmar LIVE explicitamente
    else {
      const localScore = localAnalysis?.score ?? 0;
      // SEMPRE rejeitar/revisar quando AWS não confirmou LIVE
      finalScore = Math.max(0, localScore - 30); // Penalidade maior
      finalIsLive = false; // SEMPRE false quando AWS não confirmou LIVE
      finalReason = `⚠️ AWS retornou decisão não conclusiva (${decision}, conf: ${confidence}). Sem confirmação AWS LIVE, não é possível confirmar que não é spoofing. Score local: ${localScore}%, Score final: ${finalScore}%. Revisão obrigatória.`;
      console.warn('[Liveness] 🚨 AWS decisão não conclusiva – REJEITANDO/REVISANDO (não aprovar sem AWS LIVE):', finalReason);
      return {
        isLive: false,
        finalScore,
        reason: finalReason,
        source: 'fallback'
      };
    }

    return {
      isLive: finalIsLive,
      finalScore,
      reason: finalReason,
      source: 'aws+local',
      aws: awsResult,
      local: localAnalysis
    };
  }

  // Callbacks do widget AWS
  onWidgetCancel = (): void => {
    console.log('[Liveness] Widget AWS cancelado pelo usuário');
    this.awsWidgetResult = {
      status: 'failed',
      decision: 'FAKE',
      confidence: 0,
      reason: 'User cancelled widget'
    };
  };

  onWidgetError = (error: any): void => {
    console.error('[Liveness] Erro no widget AWS:', error);
    this.awsWidgetResult = {
      status: 'failed',
      decision: 'FAKE',
      confidence: 0,
      reason: error?.message || 'Widget error'
    };
  };

  onWidgetSuccess = (result: any): void => {
    console.log('[Liveness] Widget AWS sucesso:', result);
    const decision = result?.decision ?? result?.livenessDecision ?? 'FAKE';
    const confidence = result?.confidence ?? result?.livenessConfidence ?? 0;
    
    this.awsWidgetResult = {
      status: 'success',
      decision: decision.toUpperCase(),
      confidence,
      raw: result
    };
  };

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

