// Coarticulation: phoneme/context/duration/stress -> continuous Articulation.
//
// A dominance-function blend (after Cohen & Massaro). Every nearby segment
// pulls every control toward its target with a weight of
//
//     segment weight x profile dominance(control) x temporal falloff
//
// where the falloff is 1 inside the segment and decays with distance, using
// the profile's anticipatory reach before it and carryover reach after it.
// Because those reaches differ per sound and per control, transitions are not
// symmetric crossfades: lips close early for an upcoming M and release fast,
// rounding starts well ahead of /u/, and a velar barely registers between
// vowels. Critical gestures (lip closure, teeth on lip, tongue for TH) are then
// enforced as constraints so no amount of blending turns them into a mumble.
//
// Provider-independent: it consumes normalised SpeechCues only.
import { POSE_ARTICULATION, VISUAL_LEAD_MS, mixArticulation } from './articulation';
import type { Articulation } from './articulation';
import {
  ARTICULATION_CONTROLS,
  dominance,
  gestureTarget,
  profileFor,
  salientControl,
  stressScale,
} from './phonemeArticulation';
import type {
  ArticulationControl,
  PhonemeArticulationProfile,
  PhonemeClass,
  Stress,
} from './phonemeArticulation';
import { TRAILING_REST_MS } from './visemeMap';
import { phonemeForToken } from './visemeMapper';
import type { SpeechCue } from './types';

/**
 * Per-control reach multipliers. Articulators differ in speed: rounding starts
 * early, the lips close quickly and release faster still, the jaw lags, and
 * the tongue is brief.
 */
export const ANTICIPATION_REACH: Readonly<Record<ArticulationControl, number>> = {
  jawOpen: 1, lipWidth: 1, lipRound: 1.4, lipClosure: 0.8, tongue: 0.6,
};
export const CARRYOVER_REACH: Readonly<Record<ArticulationControl, number>> = {
  jawOpen: 1.2, lipWidth: 1, lipRound: 1.2, lipClosure: 0.5, tongue: 0.6,
};

/**
 * A silence at least this long (or at either end of the utterance) is a
 * barrier: it renders as REST and no gesture reaches across it. This is what
 * keeps the Web Speech start wait and punctuation holds -- which park the
 * visual clock just before the next word -- from pre-shaping that word.
 */
export const BARRIER_SILENCE_MS = 90;
/** A brief inter-word gap is not a pause: it only nudges toward REST. */
export const SHORT_PAUSE_STRENGTH = 0.15;

/**
 * After speech, a barrier relaxes to REST over this long instead of snapping:
 * the last sound finishes, then the mouth settles. Capped per barrier so REST
 * is exact by the point a punctuation hold parks the visual clock.
 */
export const REST_RELAX_MS = 80;

/** Critical constraints hold for at least this long, so a 15ms M still shows. */
export const CRITICAL_MIN_MS = 50;
/**
 * Ramp into and out of a critical constraint. Short: a half-closed mouth
 * resolves to the TEETH_LIP photograph, so lingering there flashes an F.
 */
export const CRITICAL_RAMP_MS = 10;

/**
 * Minimum visible vowel dwell, in ms. A correct vowel shape shorter than this
 * is on screen for too few frames to register (a rounded /u/ at 60ms reads as
 * no vowel at all). Short vowels BORROW time from neighbouring consonants down
 * to DWELL_DONOR_FLOOR_MS, so speech is never slower overall. Only visibility
 * changes: how far the gesture goes is still judged on the original duration,
 * so a brief vowel stays a reduced vowel, just a perceptible one.
 * Reduced (unstressed, schwa) vowels get none.
 */
export const MIN_VOWEL_DWELL_MS = {
  normal: 90,
  stressed: 100,
  diphthong: 130,
  /** Extra for a vowel directly before a pause: it must finish before REST. */
  phraseFinalBonus: 20,
} as const;
/** A consonant never gives up time below this. */
export const DWELL_DONOR_FLOOR_MS = 45;
/**
 * A phrase-final vowel may also borrow this much from the pause after it. The
 * visual track already leads audio by VISUAL_LEAD_MS, so this stays inside the
 * audible vowel.
 */
export const FINAL_REST_BORROW_MS = 30;

/** Influence at distance == reach is e^-3, about 5%. */
const FALLOFF = 3;
/** Neighbours considered on each side. Reaches never span more than this. */
const WINDOW = 4;
/**
 * Diphthongs at least this long split into nucleus and offglide. Shorter ones
 * stay one segment aiming partway along the glide: two ~40ms targets would each
 * be invisible, one clear movement is not.
 */
export const DIPHTHONG_SPLIT_MS = 100;
/** The nucleus carries the vowel; the glide is the shorter tail. */
export const NUCLEUS_SHARE = 0.6;
/**
 * Offglides undershoot: the /U/ of /oU/ is a movement toward /u/, not an
 * arrival. Aiming at the full glide vowel pulled "go" and "hello" out of the OH
 * shape before it formed, and gave "about" an SH face.
 */
export const GLIDE_EXTENT = 0.6;
/** How far along the glide an unsplit short diphthong aims. */
const SHORT_DIPHTHONG_GLIDE = 0.3;

export interface ArticulationSegment {
  readonly startMs: number;
  readonly endMs: number;
  /** Canonical symbol; an offglide reads e.g. "AY:IH". */
  readonly phoneme: string;
  readonly stress: Stress;
  readonly profile: PhonemeArticulationProfile;
  /** Duration- and stress-adjusted target for this occurrence. */
  readonly target: Articulation;
  /** Multiplier on the profile's dominance; weak for short pauses. */
  readonly weight: number;
  readonly barrier: boolean;
  /** The whole sound's duration as the provider gave it, before dwell. */
  readonly sourceMs: number;
  /** Time borrowed from neighbours by the minimum-dwell rule. */
  readonly dwellMs: number;
  /** Directly followed by a barrier pause. */
  readonly phraseFinal: boolean;
  readonly part: 'whole' | 'nucleus' | 'offglide';
}

export interface ArticulationTrack {
  readonly segments: readonly ArticulationSegment[];
  readonly durationMs: number;
}

interface RawSegment {
  startMs: number;
  endMs: number;
  symbol: string;
  stress: Stress;
  sourceMs: number;
  dwellMs: number;
  barrier: boolean;
  phraseFinal: boolean;
}

const rawLength = (entry: RawSegment): number => entry.endMs - entry.startMs;

export function minimumDwellMs(
  profile: PhonemeArticulationProfile,
  stress: Stress,
  phraseFinal: boolean,
): number {
  if (profile.class !== 'vowel') return 0;
  // Reduced vowels are meant to be fleeting.
  if (stressScale(profile, stress) < 1 || profile.visualStrength < 1) return 0;
  const base = profile.offglide
    ? MIN_VOWEL_DWELL_MS.diphthong
    : stress === 1 || stress === 2 ? MIN_VOWEL_DWELL_MS.stressed : MIN_VOWEL_DWELL_MS.normal;
  return base + (phraseFinal ? MIN_VOWEL_DWELL_MS.phraseFinalBonus : 0);
}

function donorCapacity(donor: RawSegment | undefined, finalRest: boolean): number {
  if (!donor) return 0;
  const donorClass = profileFor(donor.symbol).class;
  if (donorClass === 'vowel') return 0;
  if (donorClass === 'silence') {
    return finalRest && donor.barrier
      ? Math.max(0, Math.min(FINAL_REST_BORROW_MS, rawLength(donor) - VISUAL_LEAD_MS - 1))
      : 0;
  }
  return Math.max(0, rawLength(donor) - DWELL_DONOR_FLOOR_MS);
}

/** Lengthen too-brief vowels by moving boundaries into adjacent consonants. */
function applyMinimumDwell(raw: RawSegment[]): void {
  raw.forEach((entry, index) => {
    const need = minimumDwellMs(profileFor(entry.symbol), entry.stress, entry.phraseFinal) - rawLength(entry);
    if (!(need > 0)) return;
    const left = raw[index - 1];
    const right = raw[index + 1];
    const leftCapacity = donorCapacity(left, false);
    const rightCapacity = donorCapacity(right, entry.phraseFinal);
    let takeRight = Math.min(rightCapacity, need / 2);
    const takeLeft = Math.min(leftCapacity, need - takeRight);
    takeRight = Math.min(rightCapacity, need - takeLeft);
    if (left && takeLeft > 0) {
      left.endMs -= takeLeft;
      entry.startMs -= takeLeft;
    }
    if (right && takeRight > 0) {
      right.startMs += takeRight;
      entry.endMs += takeRight;
    }
    entry.dwellMs = takeLeft + takeRight;
  });
}

/**
 * Build the segment track from provider cues. Span bounds follow buildTimeline
 * exactly (gaps become silence; the trailing rest sits inside durationMs), so
 * the debug pose strip and the articulation agree on where things are -- except
 * where the minimum-dwell rule has deliberately moved a vowel boundary.
 */
export function buildArticulationTrack(cues: readonly SpeechCue[], durationMs: number): ArticulationTrack {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (duration === 0) return { segments: [], durationMs: 0 };

  const speechEnd = Math.max(0, duration - TRAILING_REST_MS);
  const sorted = cues
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs))
    .map((cue, order) => ({ cue, order }))
    .sort((a, b) => a.cue.startMs - b.cue.startMs || a.order - b.order);

  const raw: RawSegment[] = [];
  const push = (startMs: number, endMs: number, symbol: string, stress: Stress): void => {
    if (!(endMs > startMs)) return;
    const previous = raw[raw.length - 1];
    // Doubled letters and repeated cues are one sound, not two gestures.
    if (previous && previous.symbol === symbol && previous.stress === stress && previous.endMs === startMs) {
      previous.endMs = endMs;
    } else {
      raw.push({ startMs, endMs, symbol, stress, sourceMs: 0, dwellMs: 0, barrier: false, phraseFinal: false });
    }
  };

  let cursor = 0;
  for (const { cue } of sorted) {
    const start = Math.max(cursor, Math.min(speechEnd, Math.max(0, cue.startMs)));
    const end = Math.max(start, Math.min(speechEnd, Math.max(0, cue.endMs)));
    if (start > cursor) {
      push(cursor, start, 'SIL', null);
      cursor = start;
    }
    if (end > start) {
      const { symbol, stress } = phonemeForToken(cue.token);
      push(start, end, symbol, stress);
      cursor = end;
    }
  }
  push(cursor, duration, 'SIL', null);

  // Classify on provider durations, before any boundary moves.
  raw.forEach((entry, index) => {
    entry.sourceMs = rawLength(entry);
    entry.barrier = profileFor(entry.symbol).class === 'silence'
      && (index === 0 || index === raw.length - 1 || entry.sourceMs >= BARRIER_SILENCE_MS);
  });
  raw.forEach((entry, index) => {
    entry.phraseFinal = raw[index + 1]?.barrier === true && profileFor(entry.symbol).class !== 'silence';
  });
  applyMinimumDwell(raw);

  const segments: ArticulationSegment[] = [];
  for (const entry of raw) {
    const profile = profileFor(entry.symbol);
    const common = {
      stress: entry.stress,
      sourceMs: entry.sourceMs,
      dwellMs: entry.dwellMs,
      phraseFinal: entry.phraseFinal,
    };
    if (profile.class === 'silence') {
      segments.push({
        ...common,
        startMs: entry.startMs,
        endMs: entry.endMs,
        phoneme: 'SIL',
        profile,
        target: { ...POSE_ARTICULATION.REST },
        weight: entry.barrier ? 1 : SHORT_PAUSE_STRENGTH,
        barrier: entry.barrier,
        part: 'whole',
      });
      continue;
    }

    // Gesture extent is judged on the provider duration of the whole sound:
    // dwell makes a vowel visible for longer, never bigger.
    const target = (part: PhonemeArticulationProfile): Articulation =>
      gestureTarget(part, entry.stress, entry.sourceMs);
    const base = { ...common, weight: 1, barrier: false };
    const glide = profile.offglide ? profileFor(profile.offglide) : null;
    const length = rawLength(entry);

    if (glide && length >= DIPHTHONG_SPLIT_MS) {
      const split = entry.startMs + length * NUCLEUS_SHARE;
      segments.push({
        ...base, startMs: entry.startMs, endMs: split, phoneme: entry.symbol,
        profile, target: target(profile), part: 'nucleus',
      });
      segments.push({
        ...base, startMs: split, endMs: entry.endMs, phoneme: `${entry.symbol}:${profile.offglide}`,
        profile: glide, target: mixArticulation(target(profile), target(glide), GLIDE_EXTENT), part: 'offglide',
      });
    } else {
      segments.push({
        ...base, startMs: entry.startMs, endMs: entry.endMs, phoneme: entry.symbol, profile,
        target: glide ? mixArticulation(target(profile), target(glide), SHORT_DIPHTHONG_GLIDE) : target(profile),
        part: 'whole',
      });
    }
  }

  return { segments, durationMs: duration };
}

function segmentIndexAt(segments: readonly ArticulationSegment[], ms: number): number {
  const lastIndex = segments.length - 1;
  if (ms <= segments[0]!.startMs) return 0;
  if (ms >= segments[lastIndex]!.endMs) return lastIndex;
  let low = 0;
  let high = lastIndex;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const segment = segments[middle]!;
    if (ms < segment.startMs) high = middle - 1;
    else if (ms >= segment.endMs) low = middle + 1;
    else return middle;
  }
  return lastIndex;
}

/** Neighbour range for a non-barrier segment: stops at (and includes) barriers. */
function windowAround(segments: readonly ArticulationSegment[], index: number): [number, number] {
  let low = index;
  while (low > 0 && index - low < WINDOW) {
    low -= 1;
    if (segments[low]!.barrier) break;
  }
  let high = index;
  while (high < segments.length - 1 && high - index < WINDOW) {
    high += 1;
    if (segments[high]!.barrier) break;
  }
  return [low, high];
}

function temporal(segment: ArticulationSegment, ms: number, control: ArticulationControl): number {
  let distance: number;
  let reach: number;
  if (ms < segment.startMs) {
    distance = segment.startMs - ms;
    reach = segment.profile.anticipatoryMs * ANTICIPATION_REACH[control];
  } else if (ms > segment.endMs) {
    distance = ms - segment.endMs;
    reach = segment.profile.carryoverMs * CARRYOVER_REACH[control];
  } else {
    return 1;
  }
  if (!(reach > 0) || distance > reach * 2) return 0;
  return Math.exp(-FALLOFF * (distance / reach) ** 2);
}

function influence(segment: ArticulationSegment, ms: number, control: ArticulationControl): number {
  return segment.weight * dominance(segment.profile, control, segment.stress) * temporal(segment, ms, control);
}

/** 1 across a critical segment's core, ramping at its edges; widened when brief. */
export function criticalEnvelope(segment: ArticulationSegment, ms: number): number {
  const centre = (segment.startMs + segment.endMs) / 2;
  const width = Math.max(segment.endMs - segment.startMs, CRITICAL_MIN_MS);
  const half = width / 2;
  const ramp = Math.min(CRITICAL_RAMP_MS, width / 3);
  const distance = Math.abs(ms - centre);
  if (distance >= half) return 0;
  if (distance <= half - ramp) return 1;
  return (half - distance) / ramp;
}

/** How long a barrier after speech takes to reach exact REST. */
function relaxWindowMs(barrier: ArticulationSegment): number {
  return Math.max(0, Math.min(REST_RELAX_MS, barrier.endMs - barrier.startMs - VISUAL_LEAD_MS - 1));
}

interface Evaluation {
  readonly articulation: Articulation;
  readonly index: number;
  readonly low: number;
  readonly high: number;
  readonly critical: ArticulationSegment | null;
  /** 0..1 progress of REST taking over inside a relaxing barrier; 1 otherwise. */
  readonly restShare: number;
}

function weightAt(
  segments: readonly ArticulationSegment[],
  evaluation: Pick<Evaluation, 'index' | 'restShare'>,
  j: number,
  ms: number,
  control: ArticulationControl,
): number {
  const weight = influence(segments[j]!, ms, control);
  return j === evaluation.index && segments[j]!.barrier ? weight * evaluation.restShare : weight;
}

function evaluate(track: ArticulationTrack, ms: number): Evaluation | null {
  const { segments } = track;
  if (segments.length === 0 || !Number.isFinite(ms)) return null;
  const index = segmentIndexAt(segments, ms);
  const current = segments[index]!;

  let low: number;
  let high: number;
  let restShare = 1;
  if (current.barrier) {
    // Inside a pause: hold REST, except while the sound before it finishes.
    const previous = segments[index - 1];
    const relax = previous && !previous.barrier ? relaxWindowMs(current) : 0;
    if (!(relax > 0) || ms >= current.startMs + relax) {
      return { articulation: { ...current.target }, index, low: index, high: index, critical: null, restShare: 1 };
    }
    low = index - 1;
    high = index;
    restShare = Math.max(0, (ms - current.startMs) / relax);
  } else {
    [low, high] = windowAround(segments, index);
  }

  const partial = { index, restShare };
  const articulation = { ...current.target };
  for (const control of ARTICULATION_CONTROLS) {
    let weighted = 0;
    let total = 0;
    for (let j = low; j <= high; j += 1) {
      const weight = weightAt(segments, partial, j, ms, control);
      weighted += weight * segments[j]!.target[control];
      total += weight;
    }
    if (total > 1e-6) articulation[control] = weighted / total;
  }

  // Constraints: the strongest active critical envelope wins per control.
  let critical: ArticulationSegment | null = null;
  let criticalStrength = 0;
  const strongest = new Map<ArticulationControl, { envelope: number; target: number }>();
  for (let j = low; j <= high; j += 1) {
    const segment = segments[j]!;
    if (!segment.profile.critical) continue;
    const envelope = criticalEnvelope(segment, ms);
    if (!(envelope > 0)) continue;
    if (envelope > criticalStrength) {
      critical = segment;
      criticalStrength = envelope;
    }
    for (const control of segment.profile.critical) {
      const pulled = envelope * (segment.profile.criticalPull?.[control] ?? 1);
      if (pulled > (strongest.get(control)?.envelope ?? 0)) {
        strongest.set(control, { envelope: pulled, target: segment.target[control] });
      }
    }
  }
  for (const [control, { envelope, target }] of strongest) {
    articulation[control] += (target - articulation[control]) * envelope;
  }

  return { articulation, index, low, high, critical, restShare };
}

/** The coarticulated target articulation at a playback position. */
export function coarticulate(track: ArticulationTrack, ms: number): Articulation {
  return evaluate(track, ms)?.articulation ?? { ...POSE_ARTICULATION.REST };
}

export interface NeighbourInfluence {
  readonly phoneme: string;
  readonly feature: string;
  readonly control: ArticulationControl;
  /** Share of that control's total dominance at this instant. */
  readonly share: number;
}

export interface CoarticulationDebug {
  readonly phoneme: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly phonemeClass: PhonemeClass;
  /** Effective visual strength of the current sound (weight x strength x stress). */
  readonly strength: number;
  readonly stress: Stress;
  readonly target: Articulation;
  readonly articulation: Articulation;
  /** The next sound shaping this one, when its share is meaningful. */
  readonly anticipation: NeighbourInfluence | null;
  /** The previous sound still shaping this one, when its share is meaningful. */
  readonly carryover: NeighbourInfluence | null;
  /** Feature label of an active critical constraint, e.g. CLOSE. */
  readonly critical: string | null;
  /** Visible duration of this segment (after dwell, per diphthong part). */
  readonly durationMs: number;
  /** Provider duration of the whole sound. */
  readonly sourceMs: number;
  readonly dwellMs: number;
  readonly phraseFinal: boolean;
  readonly part: ArticulationSegment['part'];
  /** For a pause: holding REST, or still relaxing out of the last sound. */
  readonly rest: 'barrier' | 'relaxing' | 'short-pause' | null;
}

/** Below this share a neighbour's influence is not worth reporting. */
const REPORT_SHARE = 0.1;

function neighbourInfluence(
  segments: readonly ArticulationSegment[],
  evaluation: Evaluation,
  neighbourIndex: number,
  ms: number,
): NeighbourInfluence | null {
  if (neighbourIndex < evaluation.low || neighbourIndex > evaluation.high || neighbourIndex === evaluation.index) {
    return null;
  }
  const neighbour = segments[neighbourIndex]!;
  if (neighbour.barrier) return null;
  const control = salientControl(neighbour.profile);
  let total = 0;
  for (let j = evaluation.low; j <= evaluation.high; j += 1) total += weightAt(segments, evaluation, j, ms, control);
  const share = total > 0 ? weightAt(segments, evaluation, neighbourIndex, ms, control) / total : 0;
  if (share < REPORT_SHARE) return null;
  return { phoneme: neighbour.phoneme, feature: neighbour.profile.feature, control, share };
}

/** Why the mouth is doing what it is doing, for `?debug=1`. */
export function describeCoarticulation(track: ArticulationTrack, ms: number): CoarticulationDebug | null {
  const evaluation = evaluate(track, ms);
  if (!evaluation) return null;
  const { segments } = track;
  const current = segments[evaluation.index]!;
  const silence = current.profile.class === 'silence';
  return {
    phoneme: current.phoneme,
    previous: segments[evaluation.index - 1]?.phoneme ?? null,
    next: segments[evaluation.index + 1]?.phoneme ?? null,
    phonemeClass: current.profile.class,
    strength: current.weight * current.profile.visualStrength * stressScale(current.profile, current.stress),
    stress: current.stress,
    target: { ...current.target },
    articulation: evaluation.articulation,
    anticipation: neighbourInfluence(segments, evaluation, evaluation.index + 1, ms),
    carryover: neighbourInfluence(segments, evaluation, evaluation.index - 1, ms),
    critical: evaluation.critical?.profile.feature ?? null,
    durationMs: current.endMs - current.startMs,
    sourceMs: current.sourceMs,
    dwellMs: current.dwellMs,
    phraseFinal: current.phraseFinal,
    part: current.part,
    rest: !silence ? null
      : !current.barrier ? 'short-pause'
      : evaluation.low < evaluation.index ? 'relaxing'
      : 'barrier',
  };
}
