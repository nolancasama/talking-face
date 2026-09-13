import type { Point } from '../core/types';
import type { AvatarMeshGeometry } from './geometry';
import { CONTROL_REFERENCE_POSE } from './geometry';
import type { MeshTopology } from './topology';

export interface MeshControls {
  readonly jawOpen: number;
  readonly lipWidth: number;
  readonly lipRound: number;
  readonly lipClosure: number;
}

export interface MeshTarget {
  readonly points: readonly Point[];
}

const CONTROL_KEYS = [
  'jawOpen',
  'lipWidth',
  'lipRound',
  'lipClosure',
] as const satisfies readonly (keyof MeshControls)[];

export function solveMeshTarget(
  controls: MeshControls,
  geometry: AvatarMeshGeometry,
  topology: MeshTopology,
): MeshTarget {
  const points = Array.from({ length: topology.vertexCount }, (_, index) => {
    const rest = geometry.restPoints[index] ?? { x: 0, y: 0 };
    let x = rest.x;
    let y = rest.y;
    for (const control of CONTROL_KEYS) {
      const weight = clamp01(controls[control]);
      const delta = geometry.deltas[CONTROL_REFERENCE_POSE[control]]?.[index];
      if (!delta) continue;
      x += delta.x * weight;
      y += delta.y * weight;
    }
    return { x, y };
  });
  return clampMeshTarget({ points }, geometry);
}

export function clampMeshTarget(
  target: MeshTarget,
  geometry: AvatarMeshGeometry,
): MeshTarget {
  return {
    points: target.points.map((point, index) => {
      const rest = geometry.restPoints[index];
      if (!rest) return point;
      let maximum = 0;
      for (const poseDeltas of Object.values(geometry.deltas)) {
        const delta = poseDeltas?.[index];
        if (delta) maximum = Math.max(maximum, Math.hypot(delta.x, delta.y));
      }
      const dx = point.x - rest.x;
      const dy = point.y - rest.y;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude <= maximum || magnitude === 0) return point;
      const scale = maximum / magnitude;
      return { x: rest.x + dx * scale, y: rest.y + dy * scale };
    }),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
