import { VoiceStep } from '../models/voice-step.model';

export type SequenceHandler = (step: VoiceStep, index: number) => Promise<void> | void;
export type SequenceUpdate = (step: VoiceStep, index: number) => void;

function speak(text: string): Promise<void> {
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
  capture?: SequenceHandler
): Promise<void> {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];

    onBeforeStep?.(step, index);

    await speak(step.texto);
    await wait(step.delay);

    await capture?.(step, index);

    onAfterStep?.(step, index);
  }
}

