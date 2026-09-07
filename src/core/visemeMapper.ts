import {
  AZURE_VISEME_TO_MOUTH,
  FALLBACK_MOUTH,
  PHONEME_TO_MOUTH,
} from './visemeMap';
import type { MouthState, SpeechToken } from './types';

/** Resolve a provider token to one of the avatar's five baked mouth states. */
export function mapSpeechToken(token: SpeechToken): MouthState {
  if (token.kind === 'silence') return 'REST';

  if (token.kind === 'phoneme') {
    const symbol = token.symbol.trim().replace(/\d/g, '').toUpperCase();
    return PHONEME_TO_MOUTH[symbol] ?? FALLBACK_MOUTH;
  }

  if (token.provider.toLowerCase() === 'azure') {
    return AZURE_VISEME_TO_MOUTH[token.id] ?? FALLBACK_MOUTH;
  }

  return FALLBACK_MOUTH;
}

/** Kept as a convenient viseme-oriented name for provider implementations. */
export const mapViseme = mapSpeechToken;
