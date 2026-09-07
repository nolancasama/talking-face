// The phoneme/viseme -> five-state mapping. This is a PRODUCT decision table,
// not an implementation detail: edit it here and nowhere else.
//
// Rationale for the judgement calls is in DESIGN_DECISIONS.md. In short:
//   - F/V map to CLOSED, not OPEN. The lower lip meets the teeth, so a closed
//     mouth reads far closer than an open one at 60ms.
//   - R and the rounded diphthongs (OW/AW/OY) map to ROUND.
//   - Tongue consonants with no distinctive lip shape (T/D/N/K/G/L/TH) fall
//     back to OPEN, which is what the mouth is doing anyway mid-word.
import type { MouthState } from './types';

/** Azure Speech viseme ids 0-21. https://aka.ms/speech/viseme */
export const AZURE_VISEME_TO_MOUTH: Readonly<Record<number, MouthState>> = {
  0: 'REST',    // silence
  1: 'OPEN',    // ae, ax, ah
  2: 'OPEN',    // aa
  3: 'ROUND',   // ao
  4: 'OPEN',    // eh, uh
  5: 'OPEN',    // er
  6: 'WIDE',    // y, iy, ih
  7: 'ROUND',   // w, uw
  8: 'ROUND',   // ow
  9: 'ROUND',   // aw
  10: 'ROUND',  // oy
  11: 'OPEN',   // ay
  12: 'OPEN',   // h
  13: 'ROUND',  // r
  14: 'OPEN',   // l
  15: 'WIDE',   // s, z
  16: 'ROUND',  // sh, ch, jh, zh
  17: 'OPEN',   // th  (approximated)
  18: 'CLOSED', // f, v (approximated)
  19: 'OPEN',   // d, t, n, th
  20: 'OPEN',   // k, g, ng
  21: 'CLOSED', // p, b, m
};

/** ARPAbet-style symbols, stress digits stripped, upper-cased. */
export const PHONEME_TO_MOUTH: Readonly<Record<string, MouthState>> = {
  // closed
  M: 'CLOSED', B: 'CLOSED', P: 'CLOSED', F: 'CLOSED', V: 'CLOSED',
  // wide
  IY: 'WIDE', IH: 'WIDE', EY: 'WIDE', Y: 'WIDE', S: 'WIDE', Z: 'WIDE',
  // round
  UW: 'ROUND', UH: 'ROUND', W: 'ROUND', OW: 'ROUND', AO: 'ROUND',
  AW: 'ROUND', OY: 'ROUND', SH: 'ROUND', CH: 'ROUND', JH: 'ROUND',
  ZH: 'ROUND', R: 'ROUND', ER: 'ROUND',
  // open (includes the tongue consonants with no distinctive lip shape)
  AA: 'OPEN', AE: 'OPEN', AH: 'OPEN', EH: 'OPEN', AY: 'OPEN',
  T: 'OPEN', D: 'OPEN', N: 'OPEN', K: 'OPEN', G: 'OPEN', NG: 'OPEN',
  L: 'OPEN', TH: 'OPEN', DH: 'OPEN', HH: 'OPEN',
  // silence
  SIL: 'REST', SP: 'REST', PAU: 'REST', '': 'REST',
};

/** Anything unrecognised. OPEN is the safest default mid-utterance. */
export const FALLBACK_MOUTH: MouthState = 'OPEN';

// Timeline shaping constants. Tuned for "readable at arm's length on a phone".
// Partial articulation commitment now handles brief spans more gracefully than
// absorption alone, so retain more of the timeline's phonetic detail.
export const MIN_SPAN_MS = 45;
export const TRAILING_REST_MS = 120; // settle back to REST after the last cue
