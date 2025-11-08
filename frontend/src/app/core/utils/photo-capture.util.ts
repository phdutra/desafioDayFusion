export interface CaptureOptions {
  width?: number;
  height?: number;
  imageType?: string;
  quality?: number;
}

export async function captureFrame(video: HTMLVideoElement, options?: CaptureOptions): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('Vídeo não inicializado. Aguarde a câmera iniciar.');
  }

  const width = options?.width ?? video.videoWidth;
  const height = options?.height ?? video.videoHeight;
  const imageType = options?.imageType ?? 'image/jpeg';
  const quality = options?.quality ?? 0.92;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Contexto 2D não disponível.');
  }

  context.drawImage(video, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Falha ao capturar imagem.'));
        return;
      }

      resolve(blob);
    }, imageType, quality);
  });
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

