import { describe, expect, it } from 'vitest';
import type { AvatarMeshGeometry } from './geometry';
import { solveMeshTarget, type MeshControls } from './solver';
import type { MeshTopology } from './topology';

const TOPOLOGY: MeshTopology = {
  version: 1,
  vertexCount: 1,
  landmarkIndices: [61],
  triangles: [],
};
const ZERO: MeshControls = { jawOpen: 0, lipWidth: 0, lipRound: 0, lipClosure: 0 };

describe('solveMeshTarget', () => {
  it('reproduces one reference pose at full control', () => {
    const geometry = makeGeometry({ BIG_OPEN: [{ x: 3, y: 4 }] });
    const target = solveMeshTarget({ ...ZERO, jawOpen: 1 }, geometry, TOPOLOGY);
    expect(target.points).toEqual([{ x: 13, y: 24 }]);
  });

  it('adds two half-strength articulators', () => {
    const geometry = makeGeometry({
      BIG_OPEN: [{ x: 8, y: 0 }],
      WIDE: [{ x: 0, y: 8 }],
    });
    const target = solveMeshTarget({ ...ZERO, jawOpen: 0.5, lipWidth: 0.5 }, geometry, TOPOLOGY);
    expect(target.points[0]?.x).toBeCloseTo(14);
    expect(target.points[0]?.y).toBeCloseTo(24);
  });

  it('clamps an extreme combination to the largest observed displacement', () => {
    const geometry = makeGeometry({
      BIG_OPEN: [{ x: 10, y: 0 }],
      CLOSED: [{ x: 10, y: 0 }],
    });
    const target = solveMeshTarget({ ...ZERO, jawOpen: 1, lipClosure: 1 }, geometry, TOPOLOGY);
    expect(target.points).toEqual([{ x: 20, y: 20 }]);
  });
});

function makeGeometry(deltas: AvatarMeshGeometry['deltas']): AvatarMeshGeometry {
  return { topologyVersion: 1, restPoints: [{ x: 10, y: 20 }], deltas };
}
