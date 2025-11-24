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
    if (!this.matchResult) {
      return 'Revisar';
    }

    const livenessScore = this.livenessResult.confidenceScore;
    const matchScore = this.matchResult.bestMatchScore || 0;
    const finalScore = this.matchResult.finalScore || livenessScore;

    if (livenessScore >= 90 && matchScore >= 80 && finalScore >= 85) {
      return 'Aprovado';
    } else if (livenessScore < 70 || matchScore < 50 || finalScore < 60) {
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

