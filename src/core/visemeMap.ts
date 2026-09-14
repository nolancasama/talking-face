// Provider token -> phoneme identity. This is a PRODUCT decision table, not an
// implementation detail: edit it here and nowhere else.
//
// Providers are normalised to ARPAbet-style phoneme symbols first; what each
// sound does to the mouth lives in phonemeArticulation.ts, and which captured
// pose is nearest is derived from that articulation (never tabled twice).
// Rationale in DESIGN_DECISIONS.md.

/**
 * Azure Speech viseme ids 0-21 -> a representative phoneme.
 * https://aka.ms/speech/viseme
 *
 * Azure's ids already merge sounds, so each picks the member whose visible
 * gesture is the safest stand-in for the whole group.
 */
export const AZURE_VISEME_TO_PHONEME: Readonly<Record<number, string>> = {
  0: 'SIL',  // silence
  1: 'AH',   // ae, ax, ah -- between the open AE and the schwa
  2: 'AA',   // aa
  3: 'AO',   // ao
  4: 'EH',   // eh, uh
  5: 'ER',   // er
  6: 'IH',   // y, iy, ih -- IH rather than IY: less smile per Y
  7: 'UW',   // w, uw
  8: 'OW',   // ow
  9: 'AW',   // aw
  10: 'OY',  // oy
  11: 'AY',  // ay
  12: 'HH',  // h
  13: 'R',   // r
  14: 'L',   // l
  15: 'S',   // s, z
  16: 'SH',  // sh, ch, jh, zh
  17: 'TH',  // th, dh
  18: 'F',   // f, v
  19: 'T',   // d, t, n
  20: 'K',   // k, g, ng
  21: 'P',   // p, b, m
};

// Timeline shaping constants. Tuned for "readable at arm's length on a phone".
/**
 * Spans shorter than this are absorbed into a neighbour in the debug pose
 * strip. The articulation track itself never absorbs: brief sounds are
 * handled by duration-aware gestures (see coarticulation.ts).
 */
export const MIN_SPAN_MS = 45;
export const TRAILING_REST_MS = 120; // settle back to REST after the last cue
