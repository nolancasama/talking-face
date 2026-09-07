import type { TTSProvider, Voice } from '../core/types';
import { AzureTTSProvider } from './azure';
import { WebSpeechTTSProvider } from './webspeech';

/** Friendly labels shared by every provider-facing voice picker. */
export const VOICE_LABELS = ['Female 1', 'Female 2', 'Male 1', 'Male 2'] as const;

export async function pickProvider(): Promise<TTSProvider> {
  const providers: TTSProvider[] = [new AzureTTSProvider(), new WebSpeechTTSProvider()];
  for (const provider of providers) {
    if (await provider.available()) return provider;
  }
  throw new Error('No text-to-speech provider is available in this browser.');
}

/** Returns provider-native ids paired only with product-owned friendly labels. */
export async function friendlyVoices(provider: TTSProvider): Promise<Voice[]> {
  const voices = await provider.voices();
  return voices.slice(0, VOICE_LABELS.length).map((voice, index) => ({
    id: voice.id,
    label: VOICE_LABELS[index] ?? 'Voice',
  }));
}

export { AzureTTSProvider, WebSpeechTTSProvider };
