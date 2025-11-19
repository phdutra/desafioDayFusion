import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

@Injectable({
  providedIn: 'root'
})
export class CompressionService {
  private ffmpeg: FFmpeg | null = null;
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
   * Carrega FFmpeg apenas quando necessário (lazy load)
   */
  private async loadFFmpeg(): Promise<void> {
    if (this.ffmpegLoaded && this.ffmpeg) {
      return;
    }

    try {
      console.log('📦 [CompressionService] Carregando FFmpeg...');
      this.ffmpeg = new FFmpeg();

      // Carregar FFmpeg do CDN
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
      });

      this.ffmpegLoaded = true;
      console.log('✅ [CompressionService] FFmpeg carregado com sucesso');
    } catch (error) {
      console.error('❌ [CompressionService] Erro ao carregar FFmpeg:', error);
      throw new Error('Não foi possível carregar o compressor de vídeo');
    }
  }

  /**
   * Compressa um vídeo usando FFmpeg
   * @param file Arquivo de vídeo original
   * @returns Blob comprimido
   */
  async compressVideo(file: File): Promise<Blob> {
    try {
      await this.loadFFmpeg();

      if (!this.ffmpeg) {
        throw new Error('FFmpeg não foi carregado');
      }

      console.log('🎥 [CompressionService] Comprimindo vídeo:', {
        originalSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        originalType: file.type
      });

      // Escrever arquivo de entrada
      await this.ffmpeg.writeFile('input.mp4', await fetchFile(file));

      // Executar compressão
      // Parâmetros otimizados para qualidade facial mantida:
      // - scale=640:480: Reduz resolução mantendo proporção
      // - b:v 800k: Bitrate de vídeo (800 kbps)
      // - b:a 64k: Bitrate de áudio (64 kbps)
      // - r 15: Frame rate reduzido para 15fps (suficiente para análise facial)
      await this.ffmpeg.exec([
        '-i', 'input.mp4',
        '-vf', 'scale=640:480',
        '-b:v', '800k',
        '-b:a', '64k',
        '-r', '15',
        '-preset', 'fast',
        'output.mp4'
      ]);

      // Ler arquivo de saída
      const data = await this.ffmpeg.readFile('output.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });

      const originalSizeMB = (file.size / 1024 / 1024).toFixed(2);
      const compressedSizeMB = (blob.size / 1024 / 1024).toFixed(2);
      const reduction = ((1 - blob.size / file.size) * 100).toFixed(1);

      console.log('✅ [CompressionService] Vídeo comprimido:', {
        originalSize: `${originalSizeMB} MB`,
        compressedSize: `${compressedSizeMB} MB`,
        reduction: `${reduction}%`,
        type: blob.type
      });

      // Limpar arquivos temporários
      await this.ffmpeg.deleteFile('input.mp4');
      await this.ffmpeg.deleteFile('output.mp4');

      return blob;
    } catch (error) {
      console.error('❌ [CompressionService] Erro ao comprimir vídeo:', error);
      // Em caso de erro, retornar arquivo original como Blob
      return file;
    }
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

