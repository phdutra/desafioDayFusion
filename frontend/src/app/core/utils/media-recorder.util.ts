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

export async function startCameraStream(options?: MediaStreamOptions): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    video: options?.video ?? { facingMode: 'user' },
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

export function startVideoRecording(stream: MediaStream, preferredMimeTypes: string[] = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
]): MediaRecorderController {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder não suportado neste navegador.');
  }

  let selectedMimeType = preferredMimeTypes.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
  const options: MediaRecorderOptions = {};

  if (selectedMimeType) {
    options.mimeType = selectedMimeType;
  } else {
    selectedMimeType = 'video/webm';
  }

  const recorder = new MediaRecorder(stream, options);
  const chunks: Blob[] = [];
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
      reject(event.error ?? new Error('Falha durante gravação de vídeo.'));
    });
  });

  recorder.start();

  return {
    stopRecording: async () => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      return recordingPromise;
    }
  };
}

