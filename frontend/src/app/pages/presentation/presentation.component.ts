import { Component, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';

@Component({
  selector: 'app-presentation',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './presentation.component.html',
  styleUrls: ['./presentation.component.scss']
})
export class PresentationComponent implements AfterViewInit, OnDestroy {
  @ViewChild('architectureCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('livenessCanvas', { static: false }) livenessCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('matchFaceCanvas', { static: false }) matchFaceCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('presentationContainer', { static: false }) presentationContainerRef!: ElementRef<HTMLDivElement>;
  
  currentSlide = 1;
  totalSlides = 10; // Total de slides da apresentação
  isFullscreen = false;

  constructor(private router: Router) {}

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    // Ignorar se estiver digitando em um input ou textarea
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.nextSlide();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.previousSlide();
        break;
      case 'Escape':
        event.preventDefault();
        this.exitFullscreen();
        break;
    }
  }

  @HostListener('document:fullscreenchange', [])
  @HostListener('document:webkitfullscreenchange', [])
  @HostListener('document:mozfullscreenchange', [])
  @HostListener('document:MSFullscreenChange', [])
  onFullscreenChange() {
    this.isFullscreen = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
    
    if (!this.isFullscreen) {
      // Se saiu do fullscreen, voltar para o dashboard
      this.router.navigate(['/dashboard']);
    }
  }

  async enterFullscreen() {
    const element = this.presentationContainerRef?.nativeElement || document.documentElement;
    
    try {
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if ((element as any).webkitRequestFullscreen) {
        await (element as any).webkitRequestFullscreen();
      } else if ((element as any).mozRequestFullScreen) {
        await (element as any).mozRequestFullScreen();
      } else if ((element as any).msRequestFullscreen) {
        await (element as any).msRequestFullscreen();
      }
      this.isFullscreen = true;
    } catch (error) {
      console.error('Erro ao entrar em fullscreen:', error);
    }
  }

  async exitFullscreen() {
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        await (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        await (document as any).msExitFullscreen();
      }
      this.isFullscreen = false;
    } catch (error) {
      console.error('Erro ao sair do fullscreen:', error);
    }
  }

  exitPresentation() {
    this.exitFullscreen();
  }

  ngAfterViewInit() {
    // Entrar em fullscreen automaticamente
    setTimeout(() => {
      this.enterFullscreen();
    }, 300);

    // Aguardar um pouco para garantir que o canvas está disponível
    setTimeout(() => {
      if (this.currentSlide === 4) {
        this.drawArchitecture();
      } else if (this.currentSlide === 5) {
        this.drawLivenessFlow();
      } else if (this.currentSlide === 6) {
        this.drawMatchFaceFlow();
      }
    }, 100);
  }

  ngOnDestroy() {
    // Sair do fullscreen ao destruir o componente
    if (this.isFullscreen) {
      this.exitFullscreen();
    }
  }

  nextSlide() {
    if (this.currentSlide < this.totalSlides) {
      this.currentSlide++;
      setTimeout(() => {
        if (this.currentSlide === 4) {
          this.drawArchitecture();
        } else if (this.currentSlide === 5) {
          this.drawLivenessFlow();
        } else if (this.currentSlide === 6) {
          this.drawMatchFaceFlow();
        }
      }, 100);
    }
  }

  previousSlide() {
    if (this.currentSlide > 1) {
      this.currentSlide--;
      setTimeout(() => {
        if (this.currentSlide === 4) {
          this.drawArchitecture();
        } else if (this.currentSlide === 5) {
          this.drawLivenessFlow();
        } else if (this.currentSlide === 6) {
          this.drawMatchFaceFlow();
        }
      }, 100);
    }
  }

  goToSlide(slideNumber: number) {
    if (slideNumber >= 1 && slideNumber <= this.totalSlides) {
      this.currentSlide = slideNumber;
      setTimeout(() => {
        if (this.currentSlide === 4) {
          this.drawArchitecture();
        } else if (this.currentSlide === 5) {
          this.drawLivenessFlow();
        } else if (this.currentSlide === 6) {
          this.drawMatchFaceFlow();
        }
      }, 100);
    }
  }

  private drawArchitecture() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Limpar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Colors
    const colors = {
      cyan: { fill: 'rgba(0, 217, 255, 0.1)', stroke: '#00D9FF', glow: 'rgba(0, 217, 255, 0.7)' },
      purple: { fill: 'rgba(184, 41, 255, 0.1)', stroke: '#B829FF', glow: 'rgba(184, 41, 255, 0.7)' },
      green: { fill: 'rgba(0, 255, 136, 0.1)', stroke: '#00FF88', glow: 'rgba(0, 255, 136, 0.7)' },
      orange: { fill: 'rgba(255, 166, 0, 0.1)', stroke: '#FFA600', glow: 'rgba(255, 166, 0, 0.7)' }
    };

    // Helper function to draw rounded rectangle
    const roundRect = (x: number, y: number, width: number, height: number, radius: number, fill: boolean, stroke: boolean) => {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    };

    // Draw neon box
    const drawNeonBox = (x: number, y: number, width: number, height: number, color: typeof colors.cyan, title: string, subtitle: string, icon: string) => {
      // Shadow/glow effect
      ctx.shadowBlur = 10;
      ctx.shadowColor = color.glow;
      
      // Fill
      ctx.fillStyle = color.fill;
      roundRect(x, y, width, height, 5, true, false);
      
      // Border
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
      roundRect(x, y, width, height, 5, false, true);
      
      // Reset shadow
      ctx.shadowBlur = 0;
      
      // Icon (simplified - usando texto ao invés de Font Awesome)
      ctx.fillStyle = color.stroke;
      ctx.font = 'bold 16px Montserrat';
      ctx.fillText(icon, x + 15, y + 25);
      
      // Title
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px Montserrat';
      ctx.fillText(title, x + 40, y + 25);
      
      // Subtitle
      ctx.fillStyle = '#CCCCCC';
      ctx.font = '12px Roboto';
      ctx.fillText(subtitle, x + 15, y + 45);
    };

    // Draw arrow
    const drawArrow = (fromX: number, fromY: number, toX: number, toY: number, color: typeof colors.cyan) => {
      const headLength = 10;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      
      // Draw line
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
      
      // Shadow/glow
      ctx.shadowBlur = 5;
      ctx.shadowColor = color.glow;
      ctx.stroke();
      
      // Arrow head
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI/6), toY - headLength * Math.sin(angle - Math.PI/6));
      ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI/6), toY - headLength * Math.sin(angle + Math.PI/6));
      ctx.closePath();
      ctx.fillStyle = color.stroke;
      ctx.fill();
      
      // Reset shadow
      ctx.shadowBlur = 0;
    };

    // Frontend Layer
    drawNeonBox(50, 50, 180, 70, colors.cyan, 'Angular 19', 'SPA / Frontend', '⚡');
    drawNeonBox(50, 150, 180, 70, colors.cyan, 'CloudFront', 'Distribuição Global', '☁');
    
    // Auth Layer
    drawNeonBox(350, 50, 180, 70, colors.purple, 'Cognito', 'User Pool + Identity', '🔐');
    drawNeonBox(350, 150, 180, 70, colors.purple, 'IAM Roles', 'Credenciais Temporárias', '🔑');
    
    // Processing Layer
    drawNeonBox(650, 50, 200, 70, colors.green, 'Kinesis Video', 'WebRTC Stream', '📹');
    drawNeonBox(650, 150, 200, 70, colors.green, 'Rekognition Liveness', 'Anti-fraude 3D', '👁');
    drawNeonBox(650, 250, 200, 70, colors.green, 'Rekognition Face', 'CompareFaces (Match)', '👤');
    drawNeonBox(500, 380, 200, 70, colors.green, 'API Gateway / Lambda', 'Processamento / APIs', '⚙');
    
    // Storage Layer
    drawNeonBox(850, 380, 150, 70, colors.orange, 'S3', 'Mídia / Artefatos', '📦');
    drawNeonBox(650, 380, 150, 70, colors.orange, 'DynamoDB', 'Auditoria / Sessões', '🗄');
    drawNeonBox(1000, 250, 150, 70, colors.orange, 'CloudWatch', 'Logs / Métricas', '📊');
    
    // Arrows
    // Frontend to Auth
    drawArrow(230, 85, 350, 85, colors.cyan);
    drawArrow(230, 185, 350, 185, colors.cyan);
    
    // Auth to Processing
    drawArrow(530, 85, 650, 85, colors.purple);
    drawArrow(530, 185, 650, 185, colors.purple);
    
    // Processing interconnections
    drawArrow(750, 120, 750, 150, colors.green);
    drawArrow(750, 220, 750, 250, colors.green);
    drawArrow(750, 320, 750, 380, colors.green);
    drawArrow(700, 285, 600, 380, colors.green);
    
    // Processing to Storage
    drawArrow(700, 415, 850, 415, colors.green);
    drawArrow(800, 380, 850, 380, colors.green);
    drawArrow(800, 280, 1000, 280, colors.green);
  }

  private drawLivenessFlow() {
    const canvas = this.livenessCanvasRef?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Limpar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Colors
    const colors = {
      cyan: { fill: 'rgba(0, 217, 255, 0.1)', stroke: '#00D9FF', glow: 'rgba(0, 217, 255, 0.7)' },
      purple: { fill: 'rgba(184, 41, 255, 0.1)', stroke: '#B829FF', glow: 'rgba(184, 41, 255, 0.7)' },
      green: { fill: 'rgba(0, 255, 136, 0.1)', stroke: '#00FF88', glow: 'rgba(0, 255, 136, 0.7)' },
      orange: { fill: 'rgba(255, 166, 0, 0.1)', stroke: '#FFA600', glow: 'rgba(255, 166, 0, 0.7)' }
    };

    // Helper function to draw rounded rectangle
    const roundRect = (x: number, y: number, width: number, height: number, radius: number, fill: boolean, stroke: boolean) => {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    };

    // Draw neon box with number
    const drawNeonBox = (x: number, y: number, width: number, height: number, color: typeof colors.cyan, number: string, title: string, subtitle: string, icon: string) => {
      // Shadow/glow effect
      ctx.shadowBlur = 10;
      ctx.shadowColor = color.glow;
      
      // Fill
      ctx.fillStyle = color.fill;
      roundRect(x, y, width, height, 5, true, false);
      
      // Border
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
      roundRect(x, y, width, height, 5, false, true);
      
      // Reset shadow
      ctx.shadowBlur = 0;
      
      // Number circle
      ctx.beginPath();
      ctx.arc(x + 25, y + 25, 15, 0, Math.PI * 2);
      ctx.fillStyle = color.stroke;
      ctx.fill();
      
      // Number text
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 16px Montserrat';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(number, x + 25, y + 25);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      
      // Title
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px Montserrat';
      ctx.fillText(title, x + 50, y + 30);
      
      // Icon (simplified)
      ctx.fillStyle = color.stroke;
      ctx.font = 'bold 16px Montserrat';
      ctx.fillText(icon, x + width - 30, y + 30);
      
      // Subtitle (multiline)
      ctx.fillStyle = '#CCCCCC';
      ctx.font = '13px Roboto';
      const lines = subtitle.split('\n');
      lines.forEach((line, index) => {
        ctx.fillText(line, x + 20, y + 55 + (index * 20));
      });
    };

    // Draw arrow
    const drawArrow = (fromX: number, fromY: number, toX: number, toY: number, color: typeof colors.cyan) => {
      const headLength = 10;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      
      // Draw line
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
      
      // Shadow/glow
      ctx.shadowBlur = 5;
      ctx.shadowColor = color.glow;
      ctx.stroke();
      
      // Arrow head
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI/6), toY - headLength * Math.sin(angle - Math.PI/6));
      ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI/6), toY - headLength * Math.sin(angle + Math.PI/6));
      ctx.closePath();
      ctx.fillStyle = color.stroke;
      ctx.fill();
      
      // Reset shadow
      ctx.shadowBlur = 0;
    };

    // Draw Liveness Flow diagram
    const centerX = canvas.width / 2;
    const boxWidth = 320;
    const boxHeight = 65;
    const verticalGap = 12;
    const startY = 20;

    // Step 1 - Usuário inicia verificação
    drawNeonBox(centerX - boxWidth/2, startY, boxWidth, boxHeight, colors.cyan, '1', 'Usuário inicia verificação', 'O cliente solicita acesso e concede\npermissão para a câmera', '👤');

    // Step 2 - Widget WebRTC
    drawNeonBox(centerX - boxWidth/2, startY + boxHeight + verticalGap, boxWidth, boxHeight, colors.cyan, '2', 'Widget WebRTC cria sessão', 'Kinesis Video Stream estabelece\ncanal de comunicação seguro', '📹');

    // Step 3 - Captura rosto
    drawNeonBox(centerX - boxWidth/2, startY + (boxHeight + verticalGap)*2, boxWidth, boxHeight, colors.purple, '3', 'Captura curta do rosto', 'Instruções guiadas para movimentos\ne posicionamento facial', '👤');

    // Step 4 - Rekognition valida
    drawNeonBox(centerX - boxWidth/2, startY + (boxHeight + verticalGap)*3, boxWidth, boxHeight, colors.green, '4', 'Rekognition valida presença', 'Análise de profundidade, textura\ne micro-movimentos faciais', '👁');

    // Step 5 - ConfidenceScore
    drawNeonBox(centerX - boxWidth/2, startY + (boxHeight + verticalGap)*4, boxWidth, boxHeight, colors.orange, '5', 'Retorna ConfidenceScore', 'Pontuação de confiança e detecção\nde tentativas de fraude', '📊');

    // Step 6 - Registro DynamoDB
    drawNeonBox(centerX - boxWidth/2, startY + (boxHeight + verticalGap)*5, boxWidth, boxHeight, colors.orange, '6', 'Registro completo DynamoDB', 'Auditoria completa e métricas\npara análise posterior', '🗄');

    // Draw connecting arrows
    for (let i = 0; i < 5; i++) {
      const arrowColor = i < 2 ? colors.cyan : i < 3 ? colors.purple : i < 4 ? colors.green : colors.orange;
      drawArrow(
        centerX,
        startY + boxHeight + (i * (boxHeight + verticalGap)),
        centerX,
        startY + boxHeight + (i * (boxHeight + verticalGap)) + verticalGap,
        arrowColor
      );
    }
  }

  private drawMatchFaceFlow() {
    const canvas = this.matchFaceCanvasRef?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Limpar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Colors
    const colors = {
      cyan: { fill: 'rgba(0, 217, 255, 0.1)', stroke: '#00D9FF', glow: 'rgba(0, 217, 255, 0.7)' },
      green: { fill: 'rgba(0, 255, 136, 0.1)', stroke: '#00FF88', glow: 'rgba(0, 255, 136, 0.7)' },
      purple: { fill: 'rgba(184, 41, 255, 0.1)', stroke: '#B829FF', glow: 'rgba(184, 41, 255, 0.7)' },
      orange: { fill: 'rgba(255, 166, 0, 0.1)', stroke: '#FFA600', glow: 'rgba(255, 166, 0, 0.7)' }
    };

    // Helper function to draw rounded rectangle
    const roundRect = (x: number, y: number, width: number, height: number, radius: number, fill: boolean, stroke: boolean) => {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    };

    // Draw neon box with step number
    const drawNeonBox = (x: number, y: number, width: number, height: number, color: typeof colors.cyan, stepNumber: string, title: string, subtitle: string, icon: string) => {
      // Shadow/glow effect
      ctx.shadowBlur = 10;
      ctx.shadowColor = color.glow;
      
      // Fill
      ctx.fillStyle = color.fill;
      roundRect(x, y, width, height, 5, true, false);
      
      // Border
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
      roundRect(x, y, width, height, 5, false, true);
      
      // Reset shadow
      ctx.shadowBlur = 0;
      
      // Step number
      ctx.fillStyle = color.stroke;
      ctx.font = 'bold 18px Montserrat';
      ctx.fillText(stepNumber, x + 10, y + 25);
      
      // Title
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 13px Montserrat';
      ctx.fillText(title, x + 40, y + 25);
      
      // Icon (simplified)
      ctx.fillStyle = color.stroke;
      ctx.font = 'bold 13px Montserrat';
      ctx.fillText(icon, x + 10, y + 55);
      
      // Subtitle (multiline)
      ctx.fillStyle = '#CCCCCC';
      ctx.font = '11px Roboto';
      const lines = subtitle.split('\n');
      lines.forEach((line, index) => {
        ctx.fillText(line, x + 40, y + 50 + (index * 16));
      });
    };

    // Draw arrow
    const drawArrow = (fromX: number, fromY: number, toX: number, toY: number, color: typeof colors.cyan) => {
      const headLength = 10;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      
      // Draw line
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
      
      // Shadow/glow
      ctx.shadowBlur = 5;
      ctx.shadowColor = color.glow;
      ctx.stroke();
      
      // Arrow head
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI/6), toY - headLength * Math.sin(angle - Math.PI/6));
      ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI/6), toY - headLength * Math.sin(angle + Math.PI/6));
      ctx.closePath();
      ctx.fillStyle = color.stroke;
      ctx.fill();
      
      // Reset shadow
      ctx.shadowBlur = 0;
    };

    // Draw label for arrow
    const drawLabel = (text: string, x: number, y: number, color: typeof colors.cyan) => {
      ctx.fillStyle = color.stroke;
      ctx.font = '11px Roboto';
      ctx.fillText(text, x, y);
    };

    // Draw flow diagram
    const stepWidth = 150;
    const stepHeight = 90;
    const stepY = 130;
    const arrowLength = 50;
    const startX = 30;

    // Step 1
    drawNeonBox(startX, stepY, stepWidth, stepHeight, colors.cyan, '1', 'Upload Documento', 'Envio do RG/CNH via\ncâmera ou galeria', '📄');

    // Step 2
    const step2X = startX + stepWidth + arrowLength;
    drawNeonBox(step2X, stepY, stepWidth, stepHeight, colors.cyan, '2', 'Extração Foto', 'Processamento de imagem\npara isolar foto do doc', '🖼');

    // Step 3
    const step3X = step2X + stepWidth + arrowLength;
    drawNeonBox(step3X, stepY, stepWidth, stepHeight, colors.green, '3', 'Captura Facial', 'Uso do rosto validado\npelo fluxo Liveness', '👤');

    // Step 4
    const step4X = step3X + stepWidth + arrowLength;
    drawNeonBox(step4X, stepY, stepWidth, stepHeight, colors.purple, '4', 'CompareFaces', 'Rekognition gera\nMatchScore e confiança', '🔍');

    // Step 5
    const step5X = step4X + stepWidth + arrowLength;
    drawNeonBox(step5X, stepY, stepWidth, stepHeight, colors.orange, '5', 'Resultado', 'Registro na auditoria\ne retorno ao cliente', '✅');

    // Connect with arrows
    drawArrow(startX + stepWidth, stepY + stepHeight/2, step2X, stepY + stepHeight/2, colors.cyan);
    drawArrow(step2X + stepWidth, stepY + stepHeight/2, step3X, stepY + stepHeight/2, colors.cyan);
    drawArrow(step3X + stepWidth, stepY + stepHeight/2, step4X, stepY + stepHeight/2, colors.green);
    drawArrow(step4X + stepWidth, stepY + stepHeight/2, step5X, stepY + stepHeight/2, colors.purple);

    // Draw labels for arrows
    drawLabel('Documento', startX + stepWidth + 8, stepY + stepHeight/2 - 8, colors.cyan);
    drawLabel('Foto extraída', step2X + stepWidth + 8, stepY + stepHeight/2 - 8, colors.cyan);
    drawLabel('Selfie verificada', step3X + stepWidth + 8, stepY + stepHeight/2 - 8, colors.green);
    drawLabel('Similaridade %', step4X + stepWidth + 8, stepY + stepHeight/2 - 8, colors.purple);
  }
}

