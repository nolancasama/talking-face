import {
  AZURE_VISEME_TO_POSE,
  FALLBACK_POSE,
  PHONEME_TO_POSE,
  R_POSE,
} from './visemeMap';
import type { MouthPose, SpeechToken } from './types';

/** Resolve a provider token to the canonical mouth-pose vocabulary. */
export function mapSpeechToken(token: SpeechToken): MouthPose {
  if (token.kind === 'silence') return 'REST';

  if (token.kind === 'phoneme') {
    const symbol = token.symbol.trim().replace(/\d/g, '').toUpperCase();
    if (symbol === 'R') return R_POSE;
    return PHONEME_TO_POSE[symbol] ?? FALLBACK_POSE;
  }

  if (token.provider.toLowerCase() === 'azure') {
    if (token.id === 13) return R_POSE;
    return AZURE_VISEME_TO_POSE[token.id] ?? FALLBACK_POSE;
  }

  return FALLBACK_POSE;
}

/** Kept as a convenient viseme-oriented name for provider implementations. */
export const mapViseme = mapSpeechToken;
