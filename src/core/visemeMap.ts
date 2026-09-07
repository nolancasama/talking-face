// The phoneme/viseme -> pose mapping. This is a PRODUCT decision table, not an
// implementation detail: edit it here and nowhere else.
//
// The canonical vocabulary is this app's own eleven poses (src/core/poses.ts).
// A provider's viseme ids are translated INTO that vocabulary; they never
// become the vocabulary. Rationale in DESIGN_DECISIONS.md.
import type { MouthPose } from './poses';

/** Azure Speech viseme ids 0-21. https://aka.ms/speech/viseme */
export const AZURE_VISEME_TO_POSE: Readonly<Record<number, MouthPose>> = {
  0: 'REST',        // silence
  1: 'BIG_OPEN',    // ae, ax, ah
  2: 'BIG_OPEN',    // aa
  3: 'OPEN_ROUND',  // ao
  4: 'SMALL_OPEN',  // eh, uh -- reduced vowels, not a full gape
  5: 'SMALL_OPEN',  // er
  6: 'WIDE',        // y, iy, ih
  7: 'ROUND',       // w, uw
  8: 'OPEN_ROUND',  // ow
  9: 'OPEN_ROUND',  // aw
  10: 'OPEN_ROUND', // oy
  11: 'BIG_OPEN',   // ay
  12: 'SMALL_OPEN', // h
  13: 'SMALL_OPEN', // r -- see R_POSE below
  14: 'L',          // l
  15: 'WIDE',       // s, z
  16: 'SH_CH',      // sh, ch, jh, zh
  17: 'TH',         // th
  18: 'TEETH_LIP',  // f, v
  19: 'SMALL_OPEN', // d, t, n
  20: 'SMALL_OPEN', // k, g, ng
  21: 'CLOSED',     // p, b, m
};

/**
 * English /r/ has genuine lip protrusion, so SH_CH is arguably closer in shape
 * than SMALL_OPEN. SMALL_OPEN wins anyway: SH_CH's photograph is a deliberate
 * "shhh" face, and wearing it for every R in a sentence reads as an affectation.
 * A neutral slightly-open mouth is the less wrong of the two available errors.
 * Isolated here so it is one edit to change once there is real footage to judge.
 */
export const R_POSE: MouthPose = 'SMALL_OPEN';

/** ARPAbet-style symbols, stress digits stripped, upper-cased. */
export const PHONEME_TO_POSE: Readonly<Record<string, MouthPose>> = {
  // lips meeting
  M: 'CLOSED', B: 'CLOSED', P: 'CLOSED',
  // teeth on lip
  F: 'TEETH_LIP', V: 'TEETH_LIP',
  // tongue between teeth
  TH: 'TH', DH: 'TH',
  // tongue behind teeth
  L: 'L',
  // postalveolar, lips forward
  SH: 'SH_CH', CH: 'SH_CH', JH: 'SH_CH', ZH: 'SH_CH',
  // spread
  IY: 'WIDE', IH: 'WIDE', EY: 'WIDE', Y: 'WIDE', S: 'WIDE', Z: 'WIDE',
  // rounded, closed
  UW: 'ROUND', W: 'ROUND',
  // rounded, open
  OW: 'OPEN_ROUND', AO: 'OPEN_ROUND', AW: 'OPEN_ROUND', OY: 'OPEN_ROUND',
  // wide open
  AA: 'BIG_OPEN', AE: 'BIG_OPEN', AH: 'BIG_OPEN', AY: 'BIG_OPEN',
  // reduced vowels and consonants with no distinctive lip shape
  EH: 'SMALL_OPEN', UH: 'SMALL_OPEN', ER: 'SMALL_OPEN', R: 'SMALL_OPEN',
  T: 'SMALL_OPEN', D: 'SMALL_OPEN', N: 'SMALL_OPEN', K: 'SMALL_OPEN',
  G: 'SMALL_OPEN', NG: 'SMALL_OPEN', HH: 'SMALL_OPEN',
  // silence
  SIL: 'REST', SP: 'REST', PAU: 'REST', '': 'REST',
};

/**
 * Anything unrecognised. SMALL_OPEN rather than a full gape: an unknown symbol
 * mid-utterance is far more likely to be an ordinary consonant than an AHH.
 */
export const FALLBACK_POSE: MouthPose = 'SMALL_OPEN';

// Timeline shaping constants. Tuned for "readable at arm's length on a phone".
/**
 * Spans shorter than this are absorbed into a neighbour. Partial commitment
 * (see FULL_COMMIT_MS) now handles brief spans more gracefully than absorption
 * does, so this is deliberately low and preserves detail.
 */
export const MIN_SPAN_MS = 45;
export const TRAILING_REST_MS = 120; // settle back to REST after the last cue
