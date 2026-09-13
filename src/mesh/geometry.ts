import type { Avatar, FaceLandmarks, MouthPose, Point } from '../core/types';
import { detect } from '../align/landmarks';
import {
  DEFAULT_TOPOLOGY,
  MESH_INNER_LIP_INDICES,
  type MeshTopology,
} from './topology';

export const CONTROL_REFERENCE_POSE = {
  jawOpen: 'BIG_OPEN',
  lipWidth: 'WIDE',
  lipRound: 'ROUND',
  lipClosure: 'CLOSED',
} as const satisfies Record<string, MouthPose>;

export interface PoseMeshGeometry {
  readonly pose: MouthPose;
  readonly points: readonly Point[];
}

export interface AvatarMeshGeometry {
  readonly topologyVersion: number;
  readonly restPoints: readonly Point[];
  readonly deltas: Partial<Record<MouthPose, readonly Point[]>>;
}

interface DetectedPoseGeometry {
  readonly geometry: PoseMeshGeometry;
  readonly landmarks: FaceLandmarks;
}

export async function extractPoseGeometry(
  frame: ImageBitmap,
  topology: MeshTopology,
): Promise<PoseMeshGeometry | null> {
  return (await extractDetectedPoseGeometry(frame, topology, 'REST'))?.geometry ?? null;
}

export async function computeAvatarMeshGeometry(
  avatar: Pick<Avatar, 'frames'>,
  topology: MeshTopology = DEFAULT_TOPOLOGY,
): Promise<AvatarMeshGeometry> {
  const rest = await extractDetectedPoseGeometry(avatar.frames.REST, topology, 'REST');
  if (!rest) throw new Error('Could not detect exactly one face in the REST frame');

  const deadzone = interOcularDistance(rest.landmarks) * 0.01;
  const deltas: Partial<Record<MouthPose, readonly Point[]>> = {};
  const poses = Object.values(CONTROL_REFERENCE_POSE);
  await Promise.all(poses.map(async (pose) => {
    const frame = avatar.frames[pose];
    if (!frame) return;
    const detected = await extractDetectedPoseGeometry(frame, topology, pose);
    if (!detected) return;
    deltas[pose] = detected.geometry.points.map((point, index) => {
      const restPoint = rest.geometry.points[index];
      if (!restPoint) return { x: 0, y: 0 };
      const delta = { x: point.x - restPoint.x, y: point.y - restPoint.y };
      return Math.hypot(delta.x, delta.y) < deadzone ? { x: 0, y: 0 } : delta;
    });
  }));

  return {
    topologyVersion: topology.version,
    restPoints: rest.geometry.points,
    deltas,
  };
}

async function extractDetectedPoseGeometry(
  frame: ImageBitmap,
  topology: MeshTopology,
  pose: MouthPose,
): Promise<DetectedPoseGeometry | null> {
  const detection = await detect(frame);
  if (detection.faceCount !== 1 || !detection.landmarks || !detection.meshPoints) return null;

  const innerPoints: Point[] = [];
  for (const index of MESH_INNER_LIP_INDICES) {
    const point = detection.meshPoints[index];
    if (!point) return null;
    innerPoints.push(point);
  }
  const centroid = meanPoint(innerPoints);
  const points: Point[] = [];
  for (const landmarkIndex of topology.landmarkIndices) {
    if (landmarkIndex === null) {
      points.push(centroid);
      continue;
    }
    const point = detection.meshPoints[landmarkIndex];
    if (!point) return null;
    points.push(point);
  }
  if (points.length !== topology.vertexCount) return null;

  return { geometry: { pose, points }, landmarks: detection.landmarks };
}

function meanPoint(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function interOcularDistance(landmarks: FaceLandmarks): number {
  const leftOuter = landmarks.rigid[0];
  const rightOuter = landmarks.rigid[3];
  if (!leftOuter || !rightOuter) return 0;
  return Math.hypot(rightOuter.x - leftOuter.x, rightOuter.y - leftOuter.y);
}
