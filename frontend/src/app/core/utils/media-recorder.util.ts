export interface MediaStreamOptions {
  video?: MediaTrackConstraints;
  audio?: boolean;
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

