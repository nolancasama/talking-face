// Phoneme -> articulation profile. The linguistic knowledge of the lip-sync
// layer lives here: what each speech sound does to the visible mouth, how
// strongly, and how far its gesture reaches into its neighbours in time.
//
// Provider-independent: Azure visemes, Web Speech estimates and any future TTS
// are all normalised to these ARPAbet-style symbols first (visemeMapper.ts).
// How neighbouring profiles combine over time is coarticulation.ts.
import { POSE_ARTICULATION, durationCommitment, mixArticulation } from './articulation';
import type { Articulation } from './articulation';

export type ArticulationControl = keyof Articulation;

export const ARTICULATION_CONTROLS: readonly ArticulationControl[] = [
  'jawOpen', 'lipWidth', 'lipRound', 'lipClosure', 'tongue',
];

export type PhonemeClass =
  | 'silence'
  | 'vowel'
  | 'bilabial'
  | 'labiodental'
  | 'dental'
  | 'alveolar'
  | 'postalveolar'
  | 'velar'
  | 'glottal'
  | 'approximant'
  | 'other';

/** ARPAbet lexical stress: 1 primary, 2 secondary, 0 unstressed, null unknown. */
export type Stress = 0 | 1 | 2 | null;

export interface PhonemeArticulationProfile {
  readonly class: PhonemeClass;
  /** Full-strength target. Captured poses are reference extremes; most sounds sit between them. */
  readonly articulation: Articulation;
  /**
   * How strongly this sound claims the visible mouth against its neighbours
   * (its dominance, 0..1). A velar is ~0.1: the vowels around it decide the
   * face. A bilabial is 1. This is relative to context, never to REST, so a
   * weak consonant hands the mouth to its neighbours instead of closing it.
   */
  readonly visualStrength: number;
  /** Per-control multipliers on visualStrength (default 1). */
  readonly controls?: Partial<Record<ArticulationControl, number>>;
  /** How far ahead of the sound its gesture starts to show. */
  readonly anticipatoryMs: number;
  /** How long its gesture lingers after it ends. */
  readonly carryoverMs: number;
  /**
   * Controls that must actually reach the target however brief the sound is:
   * lips meeting for M/B/P, teeth on lip for F/V, tongue for TH. These are
   * enforced as constraints after blending, not merely weighted heavily.
   */
  readonly critical?: readonly ArticulationControl[];
  /** Diphthong second target (a symbol in this table). */
  readonly offglide?: string;
  /** Short debug label for the visible gesture, e.g. ROUND. */
  readonly feature: string;
}

/**
 * The relaxed mid-speech mouth. Reduced targets (short, unstressed) move
 * toward this, not toward REST: an unstressed vowel is a lazier vowel, not a
 * closed mouth.
 */
export const SPEECH_NEUTRAL: Articulation = {
  jawOpen: 0.18, lipWidth: 0.35, lipRound: 0.03, lipClosure: 0.02, tongue: 0,
};

const art = (overrides: Partial<Articulation>): Articulation => ({
  jawOpen: 0, lipWidth: 0.35, lipRound: 0, lipClosure: 0, tongue: 0, ...overrides,
});

const vowel = (
  articulation: Articulation,
  feature: string,
  extra: Partial<PhonemeArticulationProfile> = {},
): PhonemeArticulationProfile => ({
  class: 'vowel',
  articulation,
  visualStrength: 1,
  // A vowel only claims the lip dimension it actually specifies: an unrounded
  // vowel does not care about rounding, so it must not fight an adjacent W or
  // SH for it; a rounded vowel is lax about spread. Vowels also leave the
  // tongue to consonants that actually show it.
  controls: articulation.lipRound >= 0.5
    ? { lipWidth: 0.6, tongue: 0.4 }
    : { lipRound: 0.35, tongue: 0.4 },
  anticipatoryMs: 50,
  carryoverMs: 60,
  feature,
  ...extra,
});

const BILABIAL: PhonemeArticulationProfile = {
  class: 'bilabial',
  articulation: art({ jawOpen: 0.04, lipWidth: 0.28, lipClosure: 1 }),
  visualStrength: 1,
  controls: { lipWidth: 0.5, tongue: 0.2 },
  anticipatoryMs: 70,
  // Release is fast; approach is not. This is what makes "am" and "ma" differ.
  carryoverMs: 35,
  // Rounding is constrained too. Real lips do stay rounded through the M of
  // "moon", but no captured photograph shows rounded closure, so any rounding
  // here resolves to a second (SH_CH/ROUND) frame ghosted over the closed
  // lips. Rounding for the /u/ starts at the release instead.
  critical: ['lipClosure', 'jawOpen', 'lipRound'],
  feature: 'CLOSE',
};

const LABIODENTAL: PhonemeArticulationProfile = {
  class: 'labiodental',
  articulation: { ...POSE_ARTICULATION.TEETH_LIP },
  visualStrength: 0.95,
  controls: { lipRound: 0.4, tongue: 0.2 },
  anticipatoryMs: 60,
  carryoverMs: 35,
  critical: ['lipClosure', 'jawOpen'],
  feature: 'TEETH',
};

const DENTAL = (tongue: number): PhonemeArticulationProfile => ({
  class: 'dental',
  // Restrained jaw: the tongue is the signal, not a gape.
  articulation: art({ jawOpen: 0.18, lipWidth: 0.42, tongue }),
  visualStrength: 0.85,
  controls: { lipWidth: 0.5, lipRound: 0.4 },
  anticipatoryMs: 45,
  carryoverMs: 35,
  critical: ['tongue'],
  feature: 'TONGUE',
});

const ALVEOLAR_STOP: PhonemeArticulationProfile = {
  class: 'alveolar',
  // Jaw rises slightly for the tongue tip; the lips do nothing distinctive.
  articulation: art({ jawOpen: 0.14, lipWidth: 0.38, lipRound: 0.03, tongue: 0.12 }),
  visualStrength: 0.35,
  controls: { lipWidth: 0.4, lipRound: 0.3, lipClosure: 0.5, tongue: 0.5 },
  anticipatoryMs: 40,
  carryoverMs: 40,
  feature: 'ALVEOLAR',
};

const SIBILANT: PhonemeArticulationProfile = {
  class: 'alveolar',
  // Teeth nearly together, lips slightly spread -- not the full EEE smile the
  // old table used for every S.
  articulation: art({ jawOpen: 0.07, lipWidth: 0.5, lipRound: 0.02 }),
  visualStrength: 0.5,
  // Sibilants need the teeth nearly together: the jaw is the one thing S
  // insists on, so it resists the neighbouring vowel's opening.
  controls: { jawOpen: 1.6, lipWidth: 0.5, lipRound: 0.35, lipClosure: 0.5, tongue: 0.3 },
  anticipatoryMs: 45,
  carryoverMs: 40,
  feature: 'NARROW',
};

const POSTALVEOLAR: PhonemeArticulationProfile = {
  class: 'postalveolar',
  // Forward lips, short of SH_CH's reference 0.65 and far short of OOO.
  articulation: art({ jawOpen: 0.15, lipWidth: 0.28, lipRound: 0.62 }),
  visualStrength: 0.8,
  controls: { tongue: 0.3 },
  anticipatoryMs: 70,
  carryoverMs: 50,
  feature: 'FORWARD',
};

const VELAR: PhonemeArticulationProfile = {
  class: 'velar',
  // Made at the back of the mouth: almost nothing to see.
  articulation: art({ jawOpen: 0.2, lipWidth: 0.36, lipRound: 0.03 }),
  visualStrength: 0.12,
  anticipatoryMs: 30,
  carryoverMs: 30,
  feature: 'VELAR',
};

const GLOTTAL: PhonemeArticulationProfile = {
  class: 'glottal',
  articulation: { ...SPEECH_NEUTRAL },
  visualStrength: 0.03,
  anticipatoryMs: 20,
  carryoverMs: 20,
  feature: 'H',
};

export const SILENCE_PROFILE: PhonemeArticulationProfile = {
  class: 'silence',
  articulation: { ...POSE_ARTICULATION.REST },
  visualStrength: 1,
  // Brisk: speech onset and offset should not lag the audio.
  anticipatoryMs: 30,
  carryoverMs: 30,
  feature: 'REST',
};

export const FALLBACK_PROFILE: PhonemeArticulationProfile = {
  class: 'other',
  articulation: { ...SPEECH_NEUTRAL },
  visualStrength: 0.2,
  anticipatoryMs: 35,
  carryoverMs: 35,
  feature: '?',
};

/** ARPAbet symbols, stress digits stripped, upper-cased. */
export const PHONEME_PROFILES: Readonly<Record<string, PhonemeArticulationProfile>> = {
  SIL: SILENCE_PROFILE,

  // Vowels: jaw opening follows actual vowel height, not one BIG_OPEN for all.
  AA: vowel(art({ jawOpen: 0.95, lipWidth: 0.42, lipRound: 0.05 }), 'OPEN'),
  AE: vowel(art({ jawOpen: 0.75, lipWidth: 0.6 }), 'OPEN'),
  AH: vowel(art({ jawOpen: 0.55, lipWidth: 0.42, lipRound: 0.05 }), 'OPEN'),
  AX: vowel(art({ jawOpen: 0.3, lipWidth: 0.38, lipRound: 0.05 }), 'SCHWA', { visualStrength: 0.6 }),
  EH: vowel(art({ jawOpen: 0.45, lipWidth: 0.62 }), 'MID'),
  ER: vowel(art({ jawOpen: 0.28, lipWidth: 0.3, lipRound: 0.3 }), 'R'),
  IH: vowel(art({ jawOpen: 0.28, lipWidth: 0.8 }), 'WIDE'),
  IY: vowel(art({ jawOpen: 0.2, lipWidth: 0.95 }), 'WIDE'),
  UH: vowel(art({ jawOpen: 0.3, lipWidth: 0.22, lipRound: 0.6 }), 'ROUND'),
  // Rounding is the one vowel gesture that genuinely starts early.
  UW: vowel(art({ jawOpen: 0.18, lipWidth: 0.12, lipRound: 1 }), 'ROUND', { anticipatoryMs: 70 }),
  AO: vowel(art({ jawOpen: 0.6, lipWidth: 0.3, lipRound: 0.7 }), 'ROUND', { anticipatoryMs: 60 }),
  // Diphthongs glide: nucleus first, then the offglide target.
  AY: vowel(art({ jawOpen: 0.85, lipWidth: 0.5 }), 'OPEN', { offglide: 'IH' }),
  AW: vowel(art({ jawOpen: 0.8, lipWidth: 0.5, lipRound: 0.05 }), 'OPEN', { offglide: 'UH' }),
  EY: vowel(art({ jawOpen: 0.4, lipWidth: 0.75 }), 'MID', { offglide: 'IY' }),
  OW: vowel(art({ jawOpen: 0.5, lipWidth: 0.3, lipRound: 0.75 }), 'ROUND', { anticipatoryMs: 60, offglide: 'UW' }),
  OY: vowel(art({ jawOpen: 0.6, lipWidth: 0.3, lipRound: 0.7 }), 'ROUND', { anticipatoryMs: 60, offglide: 'IY' }),

  P: BILABIAL, B: BILABIAL, M: BILABIAL,
  F: LABIODENTAL, V: LABIODENTAL,
  TH: DENTAL(1), DH: DENTAL(0.85),
  T: ALVEOLAR_STOP, D: ALVEOLAR_STOP, N: ALVEOLAR_STOP,
  S: SIBILANT, Z: SIBILANT,
  SH: POSTALVEOLAR, ZH: POSTALVEOLAR, CH: POSTALVEOLAR, JH: POSTALVEOLAR,
  K: VELAR, G: VELAR, NG: VELAR,
  HH: GLOTTAL,

  L: {
    class: 'approximant',
    articulation: art({ jawOpen: 0.24, lipWidth: 0.42, lipRound: 0.02, tongue: 0.55 }),
    visualStrength: 0.5,
    controls: { lipWidth: 0.3, lipRound: 0.3, tongue: 1.4 },
    anticipatoryMs: 45,
    carryoverMs: 45,
    feature: 'TONGUE',
  },
  R: {
    class: 'approximant',
    // Modest rounding; weak enough that context decides how much shows.
    articulation: art({ jawOpen: 0.2, lipWidth: 0.28, lipRound: 0.25 }),
    visualStrength: 0.4,
    controls: { lipClosure: 0.5, tongue: 0.3 },
    anticipatoryMs: 70,
    carryoverMs: 60,
    feature: 'R',
  },
  W: {
    class: 'approximant',
    articulation: art({ jawOpen: 0.1, lipWidth: 0.1, lipRound: 0.95 }),
    visualStrength: 0.85,
    controls: { jawOpen: 0.6, tongue: 0.3 },
    anticipatoryMs: 110,
    carryoverMs: 60,
    feature: 'ROUND',
  },
  Y: {
    class: 'approximant',
    articulation: art({ jawOpen: 0.15, lipWidth: 0.62 }),
    visualStrength: 0.25,
    anticipatoryMs: 40,
    carryoverMs: 40,
    feature: 'Y',
  },
};

/** Symbols some sources use for sounds already in the table. */
const ALIASES: Readonly<Record<string, string>> = {
  '': 'SIL', SP: 'SIL', PAU: 'SIL', SILENCE: 'SIL',
  AXR: 'ER', IX: 'IH', UX: 'UW', DX: 'T', NX: 'N', EL: 'L', EM: 'M', EN: 'N', Q: 'HH', H: 'HH',
};

export interface ParsedPhoneme {
  /** Canonical table key, or the raw upper-cased symbol if unknown. */
  readonly symbol: string;
  readonly stress: Stress;
}

/** Normalise "aa1", " AH0 ", "sp" to a table symbol plus stress. */
export function parsePhoneme(raw: string): ParsedPhoneme {
  const trimmed = raw.trim().toUpperCase();
  const digit = trimmed.match(/[012]/);
  const stress = digit ? (Number(digit[0]) as 0 | 1 | 2) : null;
  let symbol = trimmed.replace(/\d/g, '');
  symbol = ALIASES[symbol] ?? symbol;
  // An unstressed AH is a schwa, and a schwa is nearly a resting mouth.
  if (symbol === 'AH' && stress === 0) symbol = 'AX';
  return { symbol, stress };
}

export function profileFor(symbol: string): PhonemeArticulationProfile {
  return PHONEME_PROFILES[symbol] ?? FALLBACK_PROFILE;
}

/** Vowel articulation scale by stress. Unknown stress is treated as full. */
const STRESS_SCALE: Readonly<Record<'0' | '1' | '2', number>> = { 0: 0.6, 1: 1, 2: 0.85 };

export function stressScale(profile: PhonemeArticulationProfile, stress: Stress): number {
  if (profile.class !== 'vowel' || stress === null) return 1;
  return STRESS_SCALE[stress];
}

/**
 * Consonants are brief by nature, and their targets are already modest (their
 * visibility is governed by dominance), so duration only trims them this far.
 * Without the floor a 60ms W barely rounds.
 */
const CONSONANT_MIN_COMMIT = 0.85;

/**
 * The target a particular occurrence of a sound actually aims for. Short and
 * unstressed vowels are partial gestures toward SPEECH_NEUTRAL; critical
 * gestures and silence always aim for the full target.
 */
export function gestureTarget(
  profile: PhonemeArticulationProfile,
  stress: Stress,
  durationMs: number,
): Articulation {
  if (profile.class === 'silence' || profile.critical?.length) return { ...profile.articulation };
  const commitment = durationCommitment(durationMs);
  const extent = profile.class === 'vowel'
    ? commitment * stressScale(profile, stress)
    : Math.max(CONSONANT_MIN_COMMIT, commitment);
  return mixArticulation(SPEECH_NEUTRAL, profile.articulation, extent);
}

/** A profile's dominance over one control, before temporal falloff. */
export function dominance(
  profile: PhonemeArticulationProfile,
  control: ArticulationControl,
  stress: Stress,
): number {
  return profile.visualStrength * (profile.controls?.[control] ?? 1) * stressScale(profile, stress);
}

/** The control that carries a profile's visible gesture, for debug output. */
export function salientControl(profile: PhonemeArticulationProfile): ArticulationControl {
  if (profile.critical?.[0]) return profile.critical[0];
  let best: ArticulationControl = 'jawOpen';
  let bestDelta = -1;
  for (const control of ARTICULATION_CONTROLS) {
    const delta = Math.abs(profile.articulation[control] - SPEECH_NEUTRAL[control]);
    if (delta > bestDelta) {
      best = control;
      bestDelta = delta;
    }
  }
  return best;
}
