import { describe, expect, it } from 'vitest';
import { POSE_ARTICULATION, poseWeights } from '../../core/articulation';
import { ALL_POSES, CORE_POSES, EXTENDED_POSES, ONBOARDING_POSES, POSE_PROMPTS } from '../../core/poses';
import type { MouthPose } from '../../core/poses';
import type { StoredAvatar } from '../../core/types';
import { migrateStoredAvatar } from '../../store/avatarStore';
import {
  SKIP_OFFER_AFTER_FAILURES,
  advanceAfter,
  canSkip,
  nextButtonLabel,
  progressLabel,
} from './captureFlow';

/** Walk a sequence the way CaptureScreen does: one step at a time until preview. */
function walk(sequence: readonly MouthPose[]): { visited: MouthPose[]; labels: string[] } {
  const visited: MouthPose[] = [];
  const labels: string[] = [];
  let index = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    visited.push(sequence[index]!);
    labels.push(progressLabel(index, sequence.length));
    const step = advanceAfter(index, sequence);
    if (step.kind === 'preview') return { visited, labels };
    index = step.stepIndex;
  }
  throw new Error('flow never reached preview');
}

describe('onboarding capture sequence', () => {
  it('asks for all eleven poses in the intended order', () => {
    expect(ONBOARDING_POSES).toEqual([
      'REST', 'CLOSED', 'SMALL_OPEN', 'BIG_OPEN', 'WIDE', 'ROUND',
      'OPEN_ROUND', 'TEETH_LIP', 'TH', 'SH_CH', 'L',
    ]);
    expect(new Set(ONBOARDING_POSES).size).toBe(ALL_POSES.length);
  });

  it('counts progress out of 11', () => {
    const { labels } = walk(ONBOARDING_POSES);
    expect(labels[0]).toBe('Photo 1 of 11');
    expect(labels.at(-1)).toBe('Photo 11 of 11');
    expect(labels).toHaveLength(11);
  });

  it('reaches the former extended poses in the same run, with no stop after the core', () => {
    const { visited } = walk(ONBOARDING_POSES);
    expect(visited).toEqual([...ONBOARDING_POSES]);
    for (const pose of EXTENDED_POSES) expect(visited).toContain(pose);
    const lastCore = ONBOARDING_POSES.indexOf('ROUND');
    expect(advanceAfter(lastCore, ONBOARDING_POSES)).toEqual({ kind: 'next', stepIndex: lastCore + 1 });
    expect(nextButtonLabel(lastCore, ONBOARDING_POSES.length)).toBe('Next');
  });

  it('goes to preview after L', () => {
    const last = ONBOARDING_POSES.length - 1;
    expect(ONBOARDING_POSES[last]).toBe('L');
    expect(advanceAfter(last, ONBOARDING_POSES)).toEqual({ kind: 'preview' });
    expect(nextButtonLabel(last, ONBOARDING_POSES.length)).toBe('Preview');
  });

  it('still supports a shorter upgrade run of only the missing poses', () => {
    const { visited, labels } = walk(EXTENDED_POSES);
    expect(visited).toEqual([...EXTENDED_POSES]);
    expect(labels.at(-1)).toBe('Photo 5 of 5');
  });
});

describe('skip after repeated quality failures', () => {
  it('is offered only after the threshold, and never for REST', () => {
    expect(canSkip('TH', SKIP_OFFER_AFTER_FAILURES - 1)).toBe(false);
    expect(canSkip('TH', SKIP_OFFER_AFTER_FAILURES)).toBe(true);
    expect(canSkip('REST', 1000)).toBe(false);
  });

  it('a skipped pose advances exactly like a captured one', () => {
    const index = ONBOARDING_POSES.indexOf('TH');
    expect(advanceAfter(index, ONBOARDING_POSES)).toEqual({ kind: 'next', stepIndex: index + 1 });
  });
});

describe('capture copy', () => {
  it('gives every pose a short title and instruction with no internal ids', () => {
    for (const pose of ALL_POSES) {
      const { title, instruction } = POSE_PROMPTS[pose];
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(16);
      expect(instruction.length).toBeGreaterThan(0);
      expect(instruction.length).toBeLessThanOrEqual(64);
      for (const id of ALL_POSES.filter((candidate) => candidate.includes('_'))) {
        expect(`${title} ${instruction}`).not.toContain(id);
      }
    }
  });
});

describe('older avatars without the extended poses', () => {
  const coreOnly = (): StoredAvatar => ({
    schemaVersion: 3,
    id: 'old',
    createdAt: 1,
    width: 10,
    height: 10,
    frames: Object.fromEntries(CORE_POSES.map((pose) => [pose, new Blob()])) as StoredAvatar['frames'],
    region: {} as StoredAvatar['region'],
    nudge: {},
  });

  it('load unchanged, with no migration or recapture', () => {
    const stored = coreOnly();
    const migrated = migrateStoredAvatar(stored);
    expect(migrated).toBe(stored);
    expect(Object.keys(migrated.frames).sort()).toEqual([...CORE_POSES].sort());
  });

  it('still render every extended target from the poses they do have', () => {
    for (const pose of EXTENDED_POSES) {
      const weights = poseWeights(POSE_ARTICULATION[pose], CORE_POSES);
      expect(weights.length).toBeGreaterThan(0);
      for (const entry of weights) expect(CORE_POSES).toContain(entry.pose);
    }
  });
});
