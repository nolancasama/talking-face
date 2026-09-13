import { describe, expect, it } from 'vitest';
import type { Point } from '../core/types';
import { solveTriangleAffine } from './warp';

const BASIS: readonly [Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

describe('solveTriangleAffine', () => {
  it('solves identity', () => {
    expect(solveTriangleAffine(BASIS, BASIS)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });

  it('solves a known affine mapping', () => {
    const affine = solveTriangleAffine(BASIS, [
      { x: 6, y: 7 },
      { x: 8, y: 10 },
      { x: 10, y: 12 },
    ]);
    expect(affine).toEqual({ a: 2, b: 3, c: 4, d: 5, e: 6, f: 7 });
  });

  it('returns null for a collinear source triangle', () => {
    expect(solveTriangleAffine([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ], BASIS)).toBeNull();
  });
});
