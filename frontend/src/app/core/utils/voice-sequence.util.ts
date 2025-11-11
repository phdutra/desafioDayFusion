import { VoiceStep } from '../models/voice-step.model';

export type SequenceHandler = (step: VoiceStep, index: number) => Promise<void> | void;
export type SequenceUpdate = (step: VoiceStep, index: number) => void;

const getSpeechSynthesis = (): SpeechSynthesis | undefined => {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
    return undefined;
  }
  return window.speechSynthesis;
};

function speak(text: string): Promise<void> {
  // Se o texto estiver vazio, não fala nada e resolve imediatamente
  if (!text || text.trim() === '') {
    return Promise.resolve();
  }

  const synth = getSpeechSynthesis();

  if (!synth) {
    // Fallback: sem suporte a speech synthesis, apenas aguarda um tempo proporcional ao tamanho da mensagem.
    const fallbackDelay = Math.min(Math.max(text.length * 80, 1200), 5000);
    return wait(fallbackDelay);
  }

  return new Promise(resolve => {
    let finished = false;
    const timeout = window.setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        synth.cancel();
      } catch {
        // ignora
      }
      resolve();
    }, Math.min(Math.max(text.length * 90, 2000), 7000));

    const complete = () => {
      if (finished) {
        return;
      }
      finished = true;
      window.clearTimeout(timeout);
      resolve();
    };

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.onend = complete;
    utterance.onerror = complete;

    try {
      synth.speak(utterance);
    } catch {
      complete();
    }
  });
}

function wait(duration: number): Promise<void> {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return new Promise(resolve => window.setTimeout(resolve, safeDuration));
}

export function cancelSpeech(): void {
  const synth = getSpeechSynthesis();
  if (!synth) {
    return;
  }
  try {
    synth.cancel();
  } catch {
    // ignora
  }
}

export async function speakSequence(
  steps: VoiceStep[],
  onBeforeStep?: SequenceUpdate,
  onAfterStep?: SequenceUpdate,
  capture?: SequenceHandler,
  shouldAbort?: () => boolean
): Promise<void> {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];

    if (shouldAbort?.()) {
      cancelSpeech();
      return;
    }

    onBeforeStep?.(step, index);

    if (shouldAbort?.()) {
      cancelSpeech();
      return;
    }

    await speak(step.texto);

    if (shouldAbort?.()) {
      cancelSpeech();
      return;
    }

    await wait(step.delay);

    if (shouldAbort?.()) {
      cancelSpeech();
      return;
    }

    await capture?.(step, index);

    if (shouldAbort?.()) {
      cancelSpeech();
      return;
    }

    onAfterStep?.(step, index);
  }
}

