import { VoiceStep } from '../models/voice-step.model';

export type SequenceHandler = (step: VoiceStep, index: number) => Promise<void> | void;
export type SequenceUpdate = (step: VoiceStep, index: number) => void;

function speak(text: string): Promise<void> {
  // Se o texto estiver vazio, não fala nada e resolve imediatamente
  if (!text || text.trim() === '') {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

function wait(duration: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, duration));
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
      speechSynthesis.cancel();
      return;
    }

    onBeforeStep?.(step, index);

    if (shouldAbort?.()) {
      speechSynthesis.cancel();
      return;
    }

    await speak(step.texto);

    if (shouldAbort?.()) {
      speechSynthesis.cancel();
      return;
    }

    await wait(step.delay);

    if (shouldAbort?.()) {
      speechSynthesis.cancel();
      return;
    }

    await capture?.(step, index);

    if (shouldAbort?.()) {
      speechSynthesis.cancel();
      return;
    }

    onAfterStep?.(step, index);
  }
}

