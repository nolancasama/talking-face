// A deterministic simulation of what LipSyncPlayer actually puts on screen:
// the visual lead, per-frame smoothing at a fixed frame rate, and pose
// resolution. A vowel can be correct in the coarticulated target and still be
// invisible (or a two-photograph blend) once rendered, so perceptual checks run
// against this rather than against coarticulate() directly.
//
// Test and diagnostic tooling only; the player does not import it.
import { VISUAL_LEAD_MS, poseWeights, smoothArticulation } from './articulation';
import type { Articulation } from './articulation';
import { coarticulate } from './coarticulation';
import type { ArticulationTrack } from './coarticulation';
import type { MouthPose } from './poses';

export const SIMULATED_FRAME_MS = 1000 / 60;

export interface SimulatedFrame {
  /** Visual (track) time of the frame: clock position + VISUAL_LEAD_MS. */
  readonly ms: number;
  /** The smoothed articulation the renderer resolves. */
  readonly articulation: Articulation;
}

export function simulatePlayback(track: ArticulationTrack, frameMs = SIMULATED_FRAME_MS): SimulatedFrame[] {
  const frames: SimulatedFrame[] = [];
  let current = coarticulate(track, VISUAL_LEAD_MS);
  for (let clock = 0; clock <= track.durationMs; clock += frameMs) {
    const ms = clock + VISUAL_LEAD_MS;
    current = smoothArticulation(current, coarticulate(track, ms), frameMs);
    frames.push({ ms, articulation: current });
  }
  return frames;
}

/** Longest continuous on-screen time for which `holds` is true. */
export function longestVisibleMs(
  frames: readonly SimulatedFrame[],
  holds: (articulation: Articulation) => boolean,
  frameMs = SIMULATED_FRAME_MS,
): number {
  let best = 0;
  let run = 0;
  for (const frame of frames) {
    run = holds(frame.articulation) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best * frameMs;
}

/** The blend weight a given captured pose receives for this articulation (0 if not drawn). */
export function poseWeightOf(articulation: Articulation, pose: MouthPose): number {
  return poseWeights(articulation).find((entry) => entry.pose === pose)?.weight ?? 0;
}
