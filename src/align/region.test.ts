import { describe, expect, it } from 'vitest';
import type { FaceLandmarks } from '../core/types';
import { computeMouthRegion } from './region';

const LANDMARKS: FaceLandmarks = {
  rigid: [
    { x: 70, y: 50 },
    { x: 90, y: 50 },
    { x: 110, y: 50 },
    { x: 130, y: 50 },
    { x: 100, y: 70 },
  ],
  lipContour: [
    { x: 78, y: 103 },
    { x: 86, y: 98 },
    { x: 100, y: 96 },
    { x: 114, y: 98 },
    { x: 122, y: 103 },
    { x: 114, y: 110 },
    { x: 100, y: 113 },
    { x: 86, y: 110 },
  ],
  chin: { x: 100, y: 156 },
  roll: 0,
  yaw: 0,
};

describe('computeMouthRegion', () => {
  it('contains every outer-lip point with room for the nasolabial folds', () => {
    const region = computeMouthRegion(LANDMARKS);
    for (const point of LANDMARKS.lipContour) {
      expect(point.x).toBeGreaterThan(region.x);
      expect(point.x).toBeLessThan(region.x + region.width);
      expect(point.y).toBeGreaterThan(region.y);
      expect(point.y).toBeLessThan(region.y + region.height);
    }
    expect(region.width).toBeGreaterThan(2 * (122 - 78));
  });

  it('extends below the chin and uses a proportional feather', () => {
    const region = computeMouthRegion(LANDMARKS);
    expect(region.y + region.height).toBeGreaterThan(LANDMARKS.chin.y);
    expect(region.feather).toBeGreaterThan(0);
    expect(region.feather).toBeLessThan(Math.min(region.width, region.height) / 2);
  });
});
