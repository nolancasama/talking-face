import { describe, expect, it } from 'vitest';
import {
  POSE_ARTICULATION,
  commitmentFor,
  mixArticulation,
  poseWeights,
  smoothToward,
  articulationDistance,
} from './articulation';
import { ALL_POSES, CORE_POSES } from './poses';

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
  it('resolves every reference pose to itself', () => {
    for (const pose of ALL_POSES) {
      const weights = poseWeights(POSE_ARTICULATION[pose]);
      expect(weights[0]?.pose).toBe(pose);
      expect(weights[0]?.weight).toBe(1);
    }
  });

  it('falls back to the nearest AVAILABLE pose when one is missing', () => {
    // An avatar with only the core set asked for a TH articulation must not
    // return TH, and must still return something drawable.
    const weights = poseWeights(POSE_ARTICULATION.TH, CORE_POSES);
    expect(weights.length).toBeGreaterThan(0);
    for (const entry of weights) expect(CORE_POSES).toContain(entry.pose);
  });

  it('keeps every pose pair separable enough to resolve stably', () => {
    // TH and L differ only by tongue position; without that control they
    // collapsed to 0.05 apart against a ~0.8 median and flickered randomly.
    let worst = Infinity;
    for (let i = 0; i < ALL_POSES.length; i += 1) {
      for (let j = i + 1; j < ALL_POSES.length; j += 1) {
        const a = POSE_ARTICULATION[ALL_POSES[i]!];
        const b = POSE_ARTICULATION[ALL_POSES[j]!];
        worst = Math.min(worst, articulationDistance(a, b));
      }
    }
    expect(worst).toBeGreaterThan(0.25);
  });

  it('blends at most two reference poses', () => {
    const halfway = mixArticulation(POSE_ARTICULATION.REST, POSE_ARTICULATION.BIG_OPEN, 0.5);
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
