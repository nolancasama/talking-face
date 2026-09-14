// The continuous articulation model.
//
// The baked frames are reference EXTREMES, not the only renderable states.
// This module describes where the mouth is right now as continuous controls,
// so the renderer can commit only partially to a pose instead of hard-switching
// photographs at phoneme speed.
//
// FROZEN CONTRACT: the renderer, the mapper and the debug tools are written
// against this file. Values here are product decisions -- see DESIGN_DECISIONS.md.
import type { MouthPose } from './poses';
import { ALL_POSES } from './poses';

/**
 * Continuous mouth controls. Internal only; never surfaced in the user UI.
 *
 * `tongue` exists because the other four cannot separate the poses that differ
 * only by tongue position. With jaw/width/round/closure alone, TH and L sit
 * 0.05 apart against a median pose separation of ~0.8 -- a 16x collapse, so
 * ordinary smoothing noise would decide which of two near-identical
 * photographs to show, and both captures would be wasted.
 */
export interface Articulation {
  /** Jaw drop. Low-frequency: smoothed harder than the lip controls. */
  jawOpen: number;
  /** Horizontal lip spread (EEE direction). */
  lipWidth: number;
  /** Lip rounding/protrusion (OOO direction). */
  lipRound: number;
  /** Lip closure (MMM direction). Protected: see CLOSURE_TAU_MS. */
  lipClosure: number;
  /** Tongue visibility/forwardness. Separates TH and L from neutral opens. */
  tongue: number;
}

/**
 * Reference articulation per pose.
 *
 * BIG_OPEN sits at a full 1.0. In the previous five-pose vocabulary the single
 * OPEN state did double duty -- the wide AHH vowel AND the fallback for every
 * consonant with no distinctive lip shape -- so it had to be detuned to 0.8 to
 * stop consonant runs rendering as a yawn. SMALL_OPEN now absorbs those
 * consonants, which frees BIG_OPEN to mean what it says.
 *
 * TEETH_LIP carries closure 0.45 rather than a near-resting 0.20: F and V tuck
 * the lower lip against the upper teeth, which is genuinely much closer to
 * closed than a relaxed mouth, and at 0.20 it sat only 0.25 from REST.
 */
export const POSE_ARTICULATION: Readonly<Record<MouthPose, Articulation>> = {
  REST:       { jawOpen: 0.00, lipWidth: 0.30, lipRound: 0.00, lipClosure: 0.10, tongue: 0.0 },
  CLOSED:     { jawOpen: 0.00, lipWidth: 0.25, lipRound: 0.00, lipClosure: 1.00, tongue: 0.0 },
  SMALL_OPEN: { jawOpen: 0.25, lipWidth: 0.35, lipRound: 0.05, lipClosure: 0.00, tongue: 0.0 },
  BIG_OPEN:   { jawOpen: 1.00, lipWidth: 0.45, lipRound: 0.05, lipClosure: 0.00, tongue: 0.0 },
  WIDE:       { jawOpen: 0.30, lipWidth: 1.00, lipRound: 0.00, lipClosure: 0.00, tongue: 0.0 },
  ROUND:      { jawOpen: 0.25, lipWidth: 0.15, lipRound: 1.00, lipClosure: 0.00, tongue: 0.0 },
  OPEN_ROUND: { jawOpen: 0.60, lipWidth: 0.30, lipRound: 0.80, lipClosure: 0.00, tongue: 0.0 },
  TEETH_LIP:  { jawOpen: 0.15, lipWidth: 0.45, lipRound: 0.00, lipClosure: 0.45, tongue: 0.0 },
  TH:         { jawOpen: 0.20, lipWidth: 0.45, lipRound: 0.00, lipClosure: 0.00, tongue: 1.0 },
  SH_CH:      { jawOpen: 0.20, lipWidth: 0.30, lipRound: 0.65, lipClosure: 0.00, tongue: 0.0 },
  L:          { jawOpen: 0.25, lipWidth: 0.45, lipRound: 0.00, lipClosure: 0.00, tongue: 0.6 },
};

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * Anticipatory coarticulation: humans begin shaping a sound before it is
 * audible, so the mouth leads the audio slightly. Configurable; 30/50/70ms are
 * the values worth comparing by eye.
 */
export const VISUAL_LEAD_MS = 50;

/**
 * Smoothing time constants, in ms to close ~63% of the distance to a target.
 *
 * Articulator dynamics (early rounding, fast closure, slow jaw, low-visibility
 * consonants) now live in the coarticulated target itself -- see
 * coarticulation.ts. This smoothing is only the last anti-jitter stage (Web
 * Speech re-anchors the clock at every word boundary), so it is lighter than
 * when it was the only thing standing between pose-to-pose jumps and the
 * screen: at the old 90ms the jaw lagged a 100ms vowel by most of its length.
 * The ordering is kept: jaw slowest, closure fastest.
 */
export const JAW_TAU_MS = 50;
export const LIP_TAU_MS = 30;
export const TONGUE_TAU_MS = 30;
/**
 * Closure is the fastest control. M/B/P must visibly meet the lips; smoothing
 * that as slowly as the others turns a plosive into a mumble.
 */
export const CLOSURE_TAU_MS = 12;

/**
 * Crossfade between reference frames. Deliberately short: alpha-blending two
 * photographs of different mouth positions produces double lips and double
 * teeth, and past roughly 25ms that ghosting is worse than a hard cut.
 */
export const FRAME_CROSSFADE_MS = 18;

/**
 * A span must last this long for the mouth to commit fully to its pose.
 * Shorter spans pull only partway toward the target, in proportion to their
 * duration, so a fleeting 40ms ROUND reads as a gesture toward rounding rather
 * than a full photographic swap. This matters more with eleven poses than it
 * did with five: more distinct references means more to flicker between.
 */
export const FULL_COMMIT_MS = 120;
/** Floor on that proportion, so a very short span still reads as something. */
export const MIN_COMMIT = 0.35;

/**
 * Poses exempt from partial commitment, because each has a defining visible
 * feature that a half-commitment destroys rather than softens: lips meeting
 * (CLOSED), teeth on lip (TEETH_LIP), tongue between teeth (TH). Smoothing
 * these away is what makes M, F and TH read as mumbles.
 */
export const PROTECTED_POSES: readonly MouthPose[] = ['CLOSED', 'TEETH_LIP', 'TH'];

/** How fully a span of the given duration should commit to its pose. */
export function commitmentFor(pose: MouthPose, durationMs: number): number {
  if (PROTECTED_POSES.includes(pose)) return 1;
  return durationCommitment(durationMs);
}

/** Duration-proportional commitment, independent of pose (see FULL_COMMIT_MS). */
export function durationCommitment(durationMs: number): number {
  const ratio = Math.max(0, durationMs) / FULL_COMMIT_MS;
  return Math.min(1, Math.max(MIN_COMMIT, ratio));
}

/** Exponential smoothing toward a target, independent of frame rate. */
export function smoothToward(current: number, target: number, tau: number, dtMs: number): number {
  if (!(tau > 0)) return target;
  if (!(dtMs > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-dtMs / tau));
}

/** Per-control smoothing of a whole articulation vector. */
export function smoothArticulation(
  current: Articulation,
  target: Articulation,
  dtMs: number,
): Articulation {
  return {
    jawOpen: smoothToward(current.jawOpen, target.jawOpen, JAW_TAU_MS, dtMs),
    lipWidth: smoothToward(current.lipWidth, target.lipWidth, LIP_TAU_MS, dtMs),
    lipRound: smoothToward(current.lipRound, target.lipRound, LIP_TAU_MS, dtMs),
    lipClosure: smoothToward(current.lipClosure, target.lipClosure, CLOSURE_TAU_MS, dtMs),
    tongue: smoothToward(current.tongue, target.tongue, TONGUE_TAU_MS, dtMs),
  };
}

/** Blend two articulations by `t` in 0..1. */
export function mixArticulation(from: Articulation, to: Articulation, t: number): Articulation {
  const k = Math.min(1, Math.max(0, t));
  const lerp = (a: number, b: number): number => a + (b - a) * k;
  return {
    jawOpen: lerp(from.jawOpen, to.jawOpen),
    lipWidth: lerp(from.lipWidth, to.lipWidth),
    lipRound: lerp(from.lipRound, to.lipRound),
    lipClosure: lerp(from.lipClosure, to.lipClosure),
    tongue: lerp(from.tongue, to.tongue),
  };
}

/**
 * Control weights for pose distance. Closure and tongue dominate because they
 * are categorical visual features -- a closed mouth or a visible tongue is a
 * different thing, not a slightly different shape.
 */
const DISTANCE_WEIGHTS = { jaw: 1.0, width: 0.8, round: 0.9, closure: 1.6, tongue: 1.4 };

export function articulationDistance(a: Articulation, b: Articulation): number {
  return Math.hypot(
    (a.jawOpen - b.jawOpen) * DISTANCE_WEIGHTS.jaw,
    (a.lipWidth - b.lipWidth) * DISTANCE_WEIGHTS.width,
    (a.lipRound - b.lipRound) * DISTANCE_WEIGHTS.round,
    (a.lipClosure - b.lipClosure) * DISTANCE_WEIGHTS.closure,
    (a.tongue - b.tongue) * DISTANCE_WEIGHTS.tongue,
  );
}

export interface PoseWeight {
  pose: MouthPose;
  weight: number;
}

/**
 * Resolve an articulation to drawable weights over the AVAILABLE baked frames.
 *
 * `available` is the set of poses this avatar actually has. Passing a subset is
 * the whole fallback mechanism: an avatar missing TH simply has TH excluded
 * from the candidate set, and the distance metric finds the closest thing it
 * does have. That single behaviour covers optional extended poses, a capture
 * the user skipped, and a legacy five-pose avatar -- no fallback table needed.
 *
 * Deliberately sparse (at most two contributors): blending three or more
 * photographs of different mouth positions compounds the ghosting that
 * FRAME_CROSSFADE_MS exists to limit.
 */
export function poseWeights(
  articulation: Articulation,
  available: readonly MouthPose[] = ALL_POSES,
): PoseWeight[] {
  const candidates: readonly MouthPose[] = available.length > 0 ? available : ['REST'];
  const scored = candidates
    .map((pose) => ({ pose, distance: articulationDistance(articulation, POSE_ARTICULATION[pose]) }))
    .sort((a, b) => a.distance - b.distance);

  const nearest = scored[0];
  if (!nearest) return [{ pose: 'REST', weight: 1 }];
  const second = scored[1];
  if (!second || nearest.distance === 0) return [{ pose: nearest.pose, weight: 1 }];

  const total = nearest.distance + second.distance;
  if (!(total > 0)) return [{ pose: nearest.pose, weight: 1 }];
  const nearestWeight = 1 - nearest.distance / total;
  return [
    { pose: nearest.pose, weight: nearestWeight },
    { pose: second.pose, weight: 1 - nearestWeight },
  ];
}
