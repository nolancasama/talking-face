import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaceLandmarks, Point } from '../core/types';
import { detect } from '../align/landmarks';
import { computeAvatarMeshGeometry, extractPoseGeometry } from './geometry';
import { DEFAULT_TOPOLOGY } from './topology';

vi.mock('../align/landmarks', () => ({ detect: vi.fn() }));

const REST_FRAME = {} as ImageBitmap;
const POSE_FRAME = {} as ImageBitmap;
const LANDMARKS: FaceLandmarks = {
  rigid: [
    { x: 0, y: 0 },
    { x: 25, y: 0 },
    { x: 75, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 20 },
  ],
  lipContour: [],
  chin: { x: 50, y: 100 },
  roll: 0,
  yaw: 0,
};

describe('mesh geometry extraction', () => {
  beforeEach(() => {
    vi.mocked(detect).mockReset();
  });

  it('snaps per-vertex pose deltas below one percent of inter-ocular distance', async () => {
    const restMesh = makeMesh();
    const poseMesh = restMesh.map((point, index) => index === 61
      ? { x: point.x + 2, y: point.y }
      : { x: point.x + 0.5, y: point.y + 0.5 });
    vi.mocked(detect)
      .mockResolvedValueOnce(detection(restMesh))
      .mockResolvedValueOnce(detection(poseMesh));

    const geometry = await computeAvatarMeshGeometry({
      frames: { REST: REST_FRAME, BIG_OPEN: POSE_FRAME },
    });

    expect(geometry.deltas.BIG_OPEN?.[0]).toEqual({ x: 2, y: 0 });
    expect(geometry.deltas.BIG_OPEN?.[1]).toEqual({ x: 0, y: 0 });
    expect(geometry.deltas.BIG_OPEN?.[36]).toEqual({ x: 0, y: 0 });
  });

  it('omits deltas for absent reference poses', async () => {
    vi.mocked(detect).mockResolvedValueOnce(detection(makeMesh()));
    const geometry = await computeAvatarMeshGeometry({ frames: { REST: REST_FRAME } });
    expect(geometry.deltas).toEqual({});
  });

  it('returns null when detection finds no face', async () => {
    vi.mocked(detect).mockResolvedValueOnce({ faceCount: 0, landmarks: null, meshPoints: null });
    await expect(extractPoseGeometry(REST_FRAME, DEFAULT_TOPOLOGY)).resolves.toBeNull();
  });
});

function makeMesh(): readonly Point[] {
  return Array.from({ length: 478 }, (_, index) => ({ x: index, y: index * 2 }));
}

function detection(meshPoints: readonly Point[]) {
  return { faceCount: 1, landmarks: LANDMARKS, meshPoints } as const;
}
