import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';

@Injectable({
  providedIn: 'root'
})
export class CompressionService {
  private ffmpeg: any = null;
  private ffmpegLoaded = false;

  /**
   * Compressa uma imagem usando browser-image-compression
   * @param file Arquivo de imagem original
   * @returns Arquivo comprimido
   */
  async compressImage(file: File): Promise<File> {
    try {
      const options = {
        maxSizeMB: 0.5, // Máximo 500KB
        maxWidthOrHeight: 1080, // Resolução máxima
        useWebWorker: true, // Usar Web Worker para não travar UI
        fileType: file.type || 'image/jpeg',
        initialQuality: 0.85
      };

      console.log('📸 [CompressionService] Comprimindo imagem:', {
        originalSize: `${(file.size / 1024).toFixed(2)} KB`,
        originalType: file.type,
        options
      });

      const compressedFile = await imageCompression(file, options);

      const originalSizeKB = (file.size / 1024).toFixed(2);
      const compressedSizeKB = (compressedFile.size / 1024).toFixed(2);
      const reduction = ((1 - compressedFile.size / file.size) * 100).toFixed(1);

      console.log('✅ [CompressionService] Imagem comprimida:', {
        originalSize: `${originalSizeKB} KB`,
        compressedSize: `${compressedSizeKB} KB`,
        reduction: `${reduction}%`,
        type: compressedFile.type
      });

      return compressedFile;
    } catch (error) {
      console.error('❌ [CompressionService] Erro ao comprimir imagem:', error);
      // Em caso de erro, retornar arquivo original
      return file;
    }
  }

  /**
   * Compressa um vídeo
   * NOTA: FFmpeg não está instalado, retorna arquivo original
   * @param file Arquivo de vídeo original
   * @returns Blob (retorna original por enquanto)
   */
  async compressVideo(file: File): Promise<Blob> {
    console.warn('⚠️ [CompressionService] Compressão de vídeo não disponível - retornando arquivo original');
    // FFmpeg não está instalado, retornar arquivo original
    return file;
  }

  /**
   * Compressa automaticamente baseado no tipo de arquivo
   * @param file Arquivo (imagem ou vídeo)
   * @returns File ou Blob comprimido
   */
  async compress(file: File): Promise<File | Blob> {
    if (file.type.startsWith('video/')) {
      return await this.compressVideo(file);
    } else if (file.type.startsWith('image/')) {
      return await this.compressImage(file);
    } else {
      console.warn('⚠️ [CompressionService] Tipo de arquivo não suportado:', file.type);
      return file;
    }
  }

  /**
   * Converte Blob para File
   * @param blob Blob a ser convertido
   * @param filename Nome do arquivo
   * @param mimeType Tipo MIME
   * @returns File
   */
  blobToFile(blob: Blob, filename: string, mimeType: string): File {
    return new File([blob], filename, { type: mimeType });
  }
}

