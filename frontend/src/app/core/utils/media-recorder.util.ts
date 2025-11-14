export interface MediaStreamOptions {
  video?: MediaTrackConstraints;
  audio?: boolean;
}

export interface RecordedMedia {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface MediaRecorderController {
  stopRecording: () => Promise<RecordedMedia>;
}

export interface VideoRecordingOptions {
  width?: number;
  height?: number;
  bitrate?: number;
  audio?: boolean;
  preferredMimeTypes?: string[];
}

/**
 * Configurações de compressão otimizadas para verificação facial
 * Conforme DayFusion_Video_Compression_MediaRecorder.md
 */
const DEFAULT_VIDEO_OPTIONS: Required<VideoRecordingOptions> = {
  width: 640,
  height: 480,
  bitrate: 800000, // 0.8 Mbps
  audio: false,
  preferredMimeTypes: [
    'video/mp4;codecs=h264',
    'video/mp4;codecs=avc1.42E01E',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ]
};

/**
 * Inicia stream de câmera com resolução otimizada para compressão
 */
export async function startCameraStream(options?: MediaStreamOptions): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    video: options?.video ?? {
      facingMode: 'user',
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 }
    },
    audio: options?.audio ?? false
  };

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia não suportado neste navegador.');
  }

  return navigator.mediaDevices.getUserMedia(constraints);
}

export function stopMediaStream(stream?: MediaStream | null): void {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach(track => track.stop());
}

/**
 * Detecta o melhor codec suportado pelo navegador
 * Prioriza H.264 (MP4) para compatibilidade com AWS Rekognition
 */
function getSupportedMimeType(preferredTypes: string[]): string {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder não suportado neste navegador.');
  }

  for (const mimeType of preferredTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  // Fallback para o tipo padrão
  const fallback = 'video/webm';
  return fallback;
}

/**
 * Inicia gravação de vídeo com compressão otimizada
 * Usa MediaRecorder API com bitrate controlado (640×480, 800kbps, H.264)
 */
export function startVideoRecording(
  stream: MediaStream,
  options: VideoRecordingOptions = {}
): MediaRecorderController {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder não suportado neste navegador.');
  }

  const config = { ...DEFAULT_VIDEO_OPTIONS, ...options };
  const selectedMimeType = getSupportedMimeType(config.preferredMimeTypes);

  // Configurar opções do MediaRecorder com compressão
  const recorderOptions: MediaRecorderOptions = {
    mimeType: selectedMimeType,
    videoBitsPerSecond: config.bitrate
  };

  // Configurações de compressão aplicadas

  const recorder = new MediaRecorder(stream, recorderOptions);
  const chunks: BlobPart[] = [];
  const startTime = performance.now();

  const recordingPromise = new Promise<RecordedMedia>((resolve, reject) => {
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener('stop', () => {
      const durationMs = performance.now() - startTime;
      const blob = new Blob(chunks, { type: selectedMimeType });

      resolve({
        blob,
        mimeType: selectedMimeType,
        durationMs
      });
    });

    recorder.addEventListener('error', (event) => {
      const error = event.error ?? new Error('Falha durante gravação de vídeo.');
      reject(error);
    });
  });

  // Iniciar gravação com timeslice para receber chunks periodicamente
  // Isso evita problemas de memória em gravações longas
  recorder.start(1000); // Chunk a cada 1 segundo

  return {
    stopRecording: async () => {
      if (recorder.state === 'recording') {
        recorder.stop();
      } else if (recorder.state === 'paused') {
        recorder.stop();
      }
      return recordingPromise;
    }
  };
}

