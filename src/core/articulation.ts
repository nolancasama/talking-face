// The continuous articulation model.
//
// The five baked frames are reference EXTREMES, not the only renderable
// states. This module describes where the mouth is right now as continuous
// parameters, so the renderer can commit only partially to a pose instead of
// hard-switching photographs at phoneme speed.
//
// FROZEN CONTRACT: the renderer and the debug overlay are both written against
// this file. Values here are product decisions -- see DESIGN_DECISIONS.md.
import type { MouthState } from './types';

/**
 * Continuous mouth controls. Internal only; never surfaced in the user UI.
 *
 * These are deliberately NOT independent of one another -- with five reference
 * photographs the renderable space is a blend over those five, so these
 * parameters describe intent and `poseWeights` resolves it to something that
 * can actually be drawn.
 */
export interface Articulation {
  /** Jaw drop. Low-frequency: smoothed harder than the lip controls. */
  jawOpen: number;
  /** Horizontal lip spread (EEE direction). */
  lipWidth: number;
  /** Lip rounding/pursing (OOO direction). */
  lipRound: number;
  /** Lip closure (MMM direction). Protected: see CLOSURE_TAU_MS. */
  lipClosure: number;
}

/** Reference articulation for each baked pose. */
export const POSE_ARTICULATION: Readonly<Record<MouthState, Articulation>> = {
  REST:   { jawOpen: 0,    lipWidth: 0.30, lipRound: 0,   lipClosure: 0.10 },
  CLOSED: { jawOpen: 0,    lipWidth: 0.25, lipRound: 0,   lipClosure: 1    },
  OPEN:   { jawOpen: 1,    lipWidth: 0.45, lipRound: 0.1, lipClosure: 0    },
  WIDE:   { jawOpen: 0.35, lipWidth: 1,    lipRound: 0,   lipClosure: 0    },
  ROUND:  { jawOpen: 0.40, lipWidth: 0.20, lipRound: 1,   lipClosure: 0    },
};

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * Anticipatory coarticulation: humans begin shaping a sound before it is
 * audible, so the mouth leads the audio slightly. Without this the avatar
 * reads as fractionally late even when it is numerically in sync.
 * Configurable; 30/50/70ms are the values worth comparing by eye.
 */
export const VISUAL_LEAD_MS = 50;

/**
 * Smoothing time constants, in milliseconds to reach ~63% of a new target.
 * The jaw is deliberately slower than the lips: a jaw physically cannot
 * re-articulate per consonant, and letting it try is a large part of what
 * reads as frantic.
 */
export const JAW_TAU_MS = 90;
export const LIP_TAU_MS = 45;
/**
 * Closure is the fastest control. M/B/P must visibly meet the lips; smoothing
 * that as slowly as the other controls turns a plosive into a mumble.
 */
export const CLOSURE_TAU_MS = 28;

/**
 * Crossfade between reference frames. Deliberately short: alpha-blending two
 * photographs of different mouth positions produces double lips and double
 * teeth, and past roughly 25ms that ghosting is more objectionable than a
 * hard cut would have been.
 */
export const FRAME_CROSSFADE_MS = 18;

/**
 * A span must last this long for the mouth to commit fully to its pose.
 * Shorter spans pull the articulation only partway toward the target, in
 * proportion to their duration -- so a fleeting 40ms ROUND registers as a
 * gesture toward rounding rather than a full photographic swap.
 */
export const FULL_COMMIT_MS = 120;
/** Floor on that proportion, so a very short span still reads as something. */
export const MIN_COMMIT = 0.35;

/**
 * CLOSED is exempt from partial commitment. Lips meeting is the single most
 * legible speech event the five-state model can express, and a half-committed
 * M reads as a mistake rather than as subtlety.
 */
export const PROTECTED_STATES: readonly MouthState[] = ['CLOSED'];

/**
 * How fully a span of the given duration should commit to its pose.
 * Frame-rate independent and monotonic in duration.
 */
export function commitmentFor(state: MouthState, durationMs: number): number {
  if (PROTECTED_STATES.includes(state)) return 1;
  const ratio = Math.max(0, durationMs) / FULL_COMMIT_MS;
  return Math.min(1, Math.max(MIN_COMMIT, ratio));
}

/**
 * Exponential smoothing toward a target, independent of frame rate.
 * `tau` is the time to close ~63% of the remaining distance.
 */
export function smoothToward(current: number, target: number, tau: number, dtMs: number): number {
  if (!(tau > 0)) return target;
  if (!(dtMs > 0)) return current;
  const alpha = 1 - Math.exp(-dtMs / tau);
  return current + (target - current) * alpha;
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
  };
}

/** Blend two articulations by `t` in 0..1. */
export function mixArticulation(from: Articulation, to: Articulation, t: number): Articulation {
  const k = Math.min(1, Math.max(0, t));
  return {
    jawOpen: from.jawOpen + (to.jawOpen - from.jawOpen) * k,
    lipWidth: from.lipWidth + (to.lipWidth - from.lipWidth) * k,
    lipRound: from.lipRound + (to.lipRound - from.lipRound) * k,
    lipClosure: from.lipClosure + (to.lipClosure - from.lipClosure) * k,
  };
}

/**
 * Resolve an articulation to drawable weights over the five baked frames.
 *
 * Until geometric warping exists (Stage 2), the renderable space is a blend
 * over the reference photographs, so this picks the nearest reference poses
 * and weights them. It is deliberately sparse -- at most two contributors --
 * because blending three or more photographs of different mouth positions
 * compounds the ghosting that FRAME_CROSSFADE_MS exists to limit.
 */
export function poseWeights(articulation: Articulation): Array<{ state: MouthState; weight: number }> {
  const states = Object.keys(POSE_ARTICULATION) as MouthState[];
  const scored = states
    .map((state) => ({ state, distance: articulationDistance(articulation, POSE_ARTICULATION[state]) }))
    .sort((a, b) => a.distance - b.distance);

  const nearest = scored[0];
  const second = scored[1];
  if (!nearest) return [{ state: 'REST', weight: 1 }];
  if (!second || nearest.distance === 0) return [{ state: nearest.state, weight: 1 }];

  // Inverse-distance weighting between the two closest reference poses.
  const total = nearest.distance + second.distance;
  if (!(total > 0)) return [{ state: nearest.state, weight: 1 }];
  const nearestWeight = 1 - nearest.distance / total;
  return [
    { state: nearest.state, weight: nearestWeight },
    { state: second.state, weight: 1 - nearestWeight },
  ];
}

/** Weighted distance. Closure dominates: a closed mouth is categorically
 *  different from an open one, however similar the other controls look. */
export function articulationDistance(a: Articulation, b: Articulation): number {
  const jaw = (a.jawOpen - b.jawOpen) * 1.0;
  const width = (a.lipWidth - b.lipWidth) * 0.8;
  const round = (a.lipRound - b.lipRound) * 0.9;
  const closure = (a.lipClosure - b.lipClosure) * 1.6;
  return Math.hypot(jaw, width, round, closure);
}
