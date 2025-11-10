import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class CameraService {
  private stream: MediaStream | null = null;
  private mediaRecorder?: MediaRecorder;
  private recordedChunks: Blob[] = [];

  async getMediaStream(): Promise<MediaStream> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: true  // Incluir áudio para análise anti-deepfake
      });
      return this.stream;
    } catch (error) {
      console.error('Error accessing camera:', error);
      throw new Error('Unable to access camera. Please check permissions.');
    }
  }

  async capturePhoto(videoElement: HTMLVideoElement): Promise<string> {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) {
      throw new Error('Unable to get canvas context');
    }

    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  stopStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  async checkCameraSupport(): Promise<boolean> {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * Inicia gravação de vídeo curto (3-5s) com áudio para análise anti-deepfake
   */
  startVideoRecording(): void {
    if (!this.stream) {
      console.error('Stream não disponível para gravação');
      return;
    }

    this.recordedChunks = [];

    const options: MediaRecorderOptions = {
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: 1000000  // 1 Mbps
    };

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.start();
      console.log('📹 Gravação de vídeo iniciada');
    } catch (error) {
      console.error('Erro ao iniciar gravação:', error);
    }
  }

  /**
   * Para gravação e retorna blob do vídeo
   */
  stopVideoRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        console.log('✅ Vídeo gravado:', blob.size, 'bytes');
        this.recordedChunks = [];
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Verifica se o navegador suporta gravação de vídeo
   */
  checkVideoRecordingSupport(): boolean {
    return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm');
  }
}
