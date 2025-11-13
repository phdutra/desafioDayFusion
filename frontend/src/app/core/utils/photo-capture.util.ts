export interface CaptureOptions {
  width?: number;
  height?: number;
  imageType?: string;
  quality?: number;
}

/**
 * Configurações de compressão otimizadas para verificação facial
 * Conforme DayFusion_Video_Compression_MediaRecorder.md
 */
const DEFAULT_IMAGE_OPTIONS: Required<Omit<CaptureOptions, 'imageType'>> = {
  width: 640,
  height: 480,
  quality: 0.8 // 80% de qualidade = compressão equilibrada
};

/**
 * Captura um frame do vídeo com compressão otimizada
 * Usa resolução 640×480 e qualidade JPEG 80% para reduzir tamanho do arquivo
 */
export async function captureFrame(video: HTMLVideoElement, options?: CaptureOptions): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('Vídeo não inicializado. Aguarde a câmera iniciar.');
  }

  // Usar resolução padrão otimizada (640×480) se não especificado
  const width = options?.width ?? DEFAULT_IMAGE_OPTIONS.width;
  const height = options?.height ?? DEFAULT_IMAGE_OPTIONS.height;
  const imageType = options?.imageType ?? 'image/jpeg';
  const quality = options?.quality ?? DEFAULT_IMAGE_OPTIONS.quality;

  // Log das configurações de compressão
  console.log('📸 [PhotoCapture] Capturando frame com compressão:', {
    resolution: `${width}×${height}`,
    quality: `${(quality * 100).toFixed(0)}%`,
    type: imageType
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Contexto 2D não disponível.');
  }

  // Desenhar imagem do vídeo no canvas com resolução otimizada
  context.drawImage(video, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Falha ao capturar imagem.'));
        return;
      }

      const sizeKB = (blob.size / 1024).toFixed(2);
      console.log('✅ [PhotoCapture] Frame capturado e comprimido:', {
        size: `${sizeKB} KB`,
        resolution: `${width}×${height}`,
        quality: `${(quality * 100).toFixed(0)}%`,
        type: blob.type
      });

      resolve(blob);
    }, imageType, quality);
  });
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

