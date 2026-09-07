import { describe, expect, it } from 'vitest';
import type { FaceLandmarks, Point, SimilarityTransform } from '../core/types';
import { apply, invert, solveSimilarityTransform } from './transform';

const RIGID: readonly Point[] = [
  { x: -4, y: -2 },
  { x: -1, y: -2.5 },
  { x: 1, y: -2.5 },
  { x: 4, y: -2 },
  { x: 0.25, y: 1 },
];

describe('solveSimilarityTransform', () => {
  it('solves identity', () => {
    expectTransform(solveSimilarityTransform(face(RIGID), face(RIGID)), identity());
  });

  it('solves pure translation', () => {
    expectSolved({ scale: 1, rotation: 0, tx: 14, ty: -9 });
  });

  it('solves pure rotation', () => {
    expectSolved({ scale: 1, rotation: Math.PI / 5, tx: 0, ty: 0 });
  });

  it('solves pure uniform scale', () => {
    expectSolved({ scale: 2.35, rotation: 0, tx: 0, ty: 0 });
  });

  it('solves a combined scale, rotation, and translation', () => {
    const expected = { scale: 0.78, rotation: -0.43, tx: 105, ty: 62 };
    const solved = expectSolved(expected);
    const original = { x: 18, y: -7 };
    const recovered = apply(invert(solved), apply(solved, original));
    expect(recovered.x).toBeCloseTo(original.x, 9);
    expect(recovered.y).toBeCloseTo(original.y, 9);
  });

  it('absorbs one jittered anchor through the over-determined fit', () => {
    const expected = { scale: 1.2, rotation: 0.18, tx: 40, ty: -12 };
    const target = RIGID.map((point) => apply(expected, point));
    const jittered = target.map((point, index) => index === 4
      ? { x: point.x + 0.35, y: point.y - 0.25 }
      : point);
    const solved = solveSimilarityTransform(face(RIGID), face(jittered));

    expect(solved.scale).toBeCloseTo(expected.scale, 1);
    expect(solved.rotation).toBeCloseTo(expected.rotation, 1);
    expect(solved.tx).toBeCloseTo(expected.tx, 0);
    expect(solved.ty).toBeCloseTo(expected.ty, 0);
  });
});

function expectSolved(expected: SimilarityTransform): SimilarityTransform {
  const target = RIGID.map((point) => apply(expected, point));
  const solved = solveSimilarityTransform(face(RIGID), face(target));
  expectTransform(solved, expected);
  return solved;
}

function expectTransform(actual: SimilarityTransform, expected: SimilarityTransform): void {
  expect(actual.scale).toBeCloseTo(expected.scale, 10);
  expect(actual.rotation).toBeCloseTo(expected.rotation, 10);
  expect(actual.tx).toBeCloseTo(expected.tx, 10);
  expect(actual.ty).toBeCloseTo(expected.ty, 10);
}

function identity(): SimilarityTransform {
  return { scale: 1, rotation: 0, tx: 0, ty: 0 };
}

function face(rigid: readonly Point[]): FaceLandmarks {
  return {
    rigid,
    lipContour: [{ x: -1, y: 2 }, { x: 1, y: 3 }],
    chin: { x: 0, y: 8 },
    roll: 0,
    yaw: 0,
  };
}
