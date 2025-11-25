import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FaceMatchService, MatchWithDocumentResponse } from '../../core/services/face-match.service';

export interface LivenessResult {
  sessionId: string;
  confidenceScore: number;
  fraudScore?: number;
  auditImages?: { bucket: string; key: string; url?: string }[];
  videoBucket?: string;
  videoKey?: string;
  raw?: any;
}

@Component({
  selector: 'app-custom-review-step',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './custom-review-step.component.html',
  styleUrls: ['./custom-review-step.component.scss']
})
export class CustomReviewStepComponent implements OnInit {
  @Input() livenessResult!: LivenessResult;
  @Input() documentImageS3Path!: string;
  @Input() documentImageUrl?: string; // URL assinada direta (opcional)
  @Output() finished = new EventEmitter<string | null>();

  isLoadingMatch = false;
  isSaving = false;
  matchResult?: MatchWithDocumentResponse;
  resolvedDocumentUrl?: string;

  get status(): 'Aprovado' | 'Rejeitado' | 'Revisar' {
    // Prioridade 1: Verificar status do backendAnalysis (do raw do livenessResult)
    const backendAnalysis = this.livenessResult.raw?.backendAnalysis;
    if (backendAnalysis?.status) {
      const statusUpper = backendAnalysis.status.toUpperCase();
      if (statusUpper === 'APPROVED' || statusUpper === 'APROVADO') {
        return 'Aprovado';
      } else if (statusUpper === 'REJECTED' || statusUpper === 'REJEITADO') {
        return 'Rejeitado';
      } else if (statusUpper === 'REVIEW' || statusUpper === 'REVISAR') {
        return 'Revisar';
      }
    }
    
    // Prioridade 2: Verificar se documento foi rejeitado pelo score
    const documentScore = backendAnalysis?.documentScore ?? this.livenessResult.raw?.documentScore ?? 0;
    const observacaoText = backendAnalysis?.observacao || '';
    const hasInvalidFlags = observacaoText.includes('não é RG') || 
                           observacaoText.includes('não é CNH') ||
                           observacaoText.includes('Documento rejeitado') ||
                           observacaoText.includes('inválido');
    
    if (documentScore <= 0 || documentScore < 50 || hasInvalidFlags) {
      return 'Rejeitado';
    }

    // Prioridade 3: Se não tiver matchResult, retornar Revisar (mas verificar documento primeiro)
    if (!this.matchResult) {
      // Se documento é válido mas não tem match, pode ser Revisar ou Aprovado dependendo do liveness
      const livenessScore = this.livenessResult.confidenceScore;
      if (livenessScore >= 90 && documentScore >= 85) {
        return 'Aprovado';
      } else if (livenessScore < 70 || documentScore < 50) {
        return 'Rejeitado';
      }
      return 'Revisar';
    }

    // Prioridade 4: Determinar baseado nos scores de match
    const livenessScore = this.livenessResult.confidenceScore;
    const matchScore = this.matchResult.bestMatchScore || 0;
    const finalScore = this.matchResult.finalScore || livenessScore;

    if (livenessScore >= 90 && matchScore >= 80 && finalScore >= 85 && documentScore >= 85) {
      return 'Aprovado';
    } else if (livenessScore < 70 || matchScore < 50 || finalScore < 60 || documentScore < 50) {
      return 'Rejeitado';
    } else {
      return 'Revisar';
    }
  }

  constructor(private faceMatchService: FaceMatchService) {}

  ngOnInit(): void {
    this.loadDocumentImage();
    this.runMatch();
  }

  private loadDocumentImage(): void {
    console.log('[CustomReviewStep] Carregando imagem do documento:', {
      documentImageUrl: this.documentImageUrl,
      documentImageS3Path: this.documentImageS3Path
    });

    // Prioridade 1: Usar URL assinada direta se disponível
    if (this.documentImageUrl) {
      this.resolvedDocumentUrl = this.documentImageUrl;
      console.log('[CustomReviewStep] Usando URL assinada direta do documento:', this.resolvedDocumentUrl);
      return;
    }

    if (!this.documentImageS3Path) {
      console.warn('[CustomReviewStep] documentImageS3Path não fornecido');
      return;
    }

    // Prioridade 2: Se o path já é uma URL completa, usar diretamente
    if (this.documentImageS3Path.startsWith('http://') || this.documentImageS3Path.startsWith('https://')) {
      this.resolvedDocumentUrl = this.documentImageS3Path;
      console.log('[CustomReviewStep] Usando URL completa do path:', this.resolvedDocumentUrl);
      return;
    }

    // Prioridade 3: Se é um path S3 (s3://bucket/key), usar endpoint do backend
    if (this.documentImageS3Path.startsWith('s3://')) {
      // Codificar o path para URL
      const encodedPath = encodeURIComponent(this.documentImageS3Path);
      this.resolvedDocumentUrl = `/api/media/document?path=${encodedPath}`;
      console.log('[CustomReviewStep] Usando endpoint do backend para documento:', this.resolvedDocumentUrl);
    } else {
      // Assumir que é uma key do S3 e construir path
      const encodedPath = encodeURIComponent(`s3://${this.documentImageS3Path}`);
      this.resolvedDocumentUrl = `/api/media/document?path=${encodedPath}`;
      console.log('[CustomReviewStep] Construindo path S3:', this.resolvedDocumentUrl);
    }
  }

  private runMatch(): void {
    if (!this.documentImageS3Path || !this.livenessResult.auditImages?.length) {
      return;
    }

    // Não fazer match se documento já foi rejeitado pelo backend
    const backendAnalysis = this.livenessResult.raw?.backendAnalysis;
    if (backendAnalysis?.status) {
      const statusUpper = backendAnalysis.status.toUpperCase();
      if (statusUpper === 'REJECTED' || statusUpper === 'REJEITADO') {
        console.log('[CustomReviewStep] Documento rejeitado pelo backend, pulando match');
        this.isLoadingMatch = false;
        return;
      }
    }

    // Verificar se documento é inválido pelo score ou flags
    const documentScore = backendAnalysis?.documentScore ?? this.livenessResult.raw?.documentScore ?? 0;
    const observacaoText = backendAnalysis?.observacao || '';
    const hasInvalidFlags = observacaoText.includes('não é RG') || 
                           observacaoText.includes('não é CNH') ||
                           observacaoText.includes('Documento rejeitado') ||
                           observacaoText.includes('inválido');
    
    if (documentScore <= 0 || documentScore < 50 || hasInvalidFlags) {
      console.log('[CustomReviewStep] Documento inválido detectado, pulando match. Score:', documentScore);
      this.isLoadingMatch = false;
      return;
    }

    this.isLoadingMatch = true;

    this.faceMatchService
      .matchLivenessWithDocument(
        this.livenessResult.sessionId,
        this.documentImageS3Path,
        this.livenessResult.auditImages
      )
      .subscribe({
        next: res => {
          this.matchResult = res;
        },
        error: err => {
          console.error('Erro ao fazer match com documento', err);
        },
        complete: () => (this.isLoadingMatch = false)
      });
  }

  async confirm(): Promise<void> {
    this.isSaving = true;
    try {
      // TODO: chamar API para salvar auditoria
      console.log('Salvar auditoria', {
        liveness: this.livenessResult,
        match: this.matchResult
      });
      // Emitir null (sem observação, pois campo foi removido)
      this.finished.emit(null);
    } finally {
      this.isSaving = false;
    }
  }

  cancel(): void {
    // Emitir null quando cancelar (sem observação)
    this.finished.emit(null);
  }

  onDocumentImageError(event: Event): void {
    console.error('[CustomReviewStep] Erro ao carregar imagem do documento:', {
      path: this.documentImageS3Path,
      url: this.resolvedDocumentUrl,
      directUrl: this.documentImageUrl
    });
    
    // Tentar usar endpoint alternativo se disponível
    if (this.documentImageS3Path && this.documentImageS3Path.startsWith('s3://')) {
      // Extrair bucket e key
      const match = this.documentImageS3Path.match(/^s3:\/\/([^\/]+)\/(.+)$/);
      if (match) {
        const [, bucket, key] = match;
        // Tentar usar endpoint de liveness-frame como fallback
        this.resolvedDocumentUrl = `/api/media/liveness-frame?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
        console.log('[CustomReviewStep] Tentando endpoint alternativo:', this.resolvedDocumentUrl);
      }
    }
  }
}

