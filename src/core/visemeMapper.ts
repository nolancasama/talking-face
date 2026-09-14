import { poseWeights } from './articulation';
import { parsePhoneme, profileFor } from './phonemeArticulation';
import type { ParsedPhoneme } from './phonemeArticulation';
import { AZURE_VISEME_TO_PHONEME } from './visemeMap';
import type { MouthPose, SpeechToken } from './types';

/** Normalise any provider token to a phoneme symbol plus stress. */
export function phonemeForToken(token: SpeechToken): ParsedPhoneme {
  if (token.kind === 'silence') return { symbol: 'SIL', stress: null };
  if (token.kind === 'phoneme') return parsePhoneme(token.symbol);
  if (token.provider.toLowerCase() === 'azure') {
    const symbol = AZURE_VISEME_TO_PHONEME[token.id];
    if (symbol !== undefined) return parsePhoneme(symbol);
  }
  // Unknown: resolves to the low-strength fallback profile.
  return { symbol: '?', stress: null };
}

/**
 * The captured reference pose nearest a token's full articulation. Used for
 * the debug pose strip only; the renderer follows the coarticulated track.
 */
export function mapSpeechToken(token: SpeechToken): MouthPose {
  const { articulation } = profileFor(phonemeForToken(token).symbol);
  return poseWeights(articulation)[0]?.pose ?? 'REST';
}

/** Kept as a convenient viseme-oriented name for provider implementations. */
export const mapViseme = mapSpeechToken;
