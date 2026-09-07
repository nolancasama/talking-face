import { describe, expect, it } from 'vitest';
import {
  POSE_ARTICULATION,
  commitmentFor,
  mixArticulation,
  poseWeights,
  smoothToward,
} from './articulation';

describe('commitmentFor', () => {
  it('commits fully to a sustained span', () => {
    expect(commitmentFor('ROUND', 200)).toBe(1);
  });

  it('commits only partially to a fleeting span', () => {
    expect(commitmentFor('ROUND', 40)).toBeLessThan(1);
    expect(commitmentFor('ROUND', 40)).toBeGreaterThan(0);
  });

  it('never lets a short span vanish entirely', () => {
    expect(commitmentFor('ROUND', 1)).toBeGreaterThanOrEqual(0.3);
  });

  it('always commits fully to CLOSED, however brief', () => {
    expect(commitmentFor('CLOSED', 10)).toBe(1);
  });

  it('is monotonic in duration', () => {
    expect(commitmentFor('WIDE', 30)).toBeLessThanOrEqual(commitmentFor('WIDE', 90));
  });
});

describe('poseWeights', () => {
  it('resolves a reference pose to itself', () => {
    for (const state of ['REST', 'CLOSED', 'OPEN', 'WIDE', 'ROUND'] as const) {
      const weights = poseWeights(POSE_ARTICULATION[state]);
      expect(weights[0]?.state).toBe(state);
      expect(weights[0]?.weight).toBe(1);
    }
  });

  it('blends at most two reference poses', () => {
    const halfway = mixArticulation(POSE_ARTICULATION.REST, POSE_ARTICULATION.OPEN, 0.5);
    expect(poseWeights(halfway).length).toBeLessThanOrEqual(2);
  });

  it('produces weights that sum to one', () => {
    const halfway = mixArticulation(POSE_ARTICULATION.WIDE, POSE_ARTICULATION.ROUND, 0.5);
    const total = poseWeights(halfway).reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('smoothToward', () => {
  it('is frame-rate independent', () => {
    // One 32ms step should land near two 16ms steps.
    const oneStep = smoothToward(0, 1, 50, 32);
    const twoSteps = smoothToward(smoothToward(0, 1, 50, 16), 1, 50, 16);
    expect(oneStep).toBeCloseTo(twoSteps, 6);
  });

  it('converges toward the target without overshooting', () => {
    let value = 0;
    for (let i = 0; i < 100; i += 1) value = smoothToward(value, 1, 50, 16);
    expect(value).toBeGreaterThan(0.99);
    expect(value).toBeLessThanOrEqual(1);
  });
});
