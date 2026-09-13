import type { FaceLandmarks, Point } from '../core/types';
import type { ImageSource, NormalizedLandmark } from '@mediapipe/tasks-vision';

// Supply public/models/face_landmarker.task; it is intentionally not downloaded at runtime.
const MODEL_PATH = `${import.meta.env.BASE_URL}models/face_landmarker.task`;
// Copy the @mediapipe/tasks-vision WASM distribution into public/models/wasm.
const WASM_PATH = `${import.meta.env.BASE_URL}models/wasm`;

/** MediaPipe Face Mesh indices, in the frozen contract's conventional order. */
export const RIGID_MESH_INDICES = [
  263, // anatomical left eye outer corner (left lateral canthus)
  362, // anatomical left eye inner corner (left medial canthus)
  133, // anatomical right eye inner corner (right medial canthus)
  33, // anatomical right eye outer corner (right lateral canthus)
  6, // bony mid-dorsum of the nose, below the eye line and above the nasal tip
] as const;

/** Full outer vermilion contour, clockwise from the anatomical right corner. */
export const OUTER_LIP_MESH_INDICES = [
  61, // anatomical right mouth corner
  185, // right upper outer lip, lateral
  40, // right upper outer lip, mid-lateral
  39, // right upper outer lip, medial
  37, // right upper Cupid's bow
  0, // upper-lip centre
  267, // left upper Cupid's bow
  269, // left upper outer lip, medial
  270, // left upper outer lip, mid-lateral
  409, // left upper outer lip, lateral
  291, // anatomical left mouth corner
  375, // left lower outer lip, lateral
  321, // left lower outer lip, mid-lateral
  405, // left lower outer lip, medial
  314, // left lower-lip bow
  17, // lower-lip centre
  84, // right lower-lip bow
  181, // right lower outer lip, medial
  91, // right lower outer lip, mid-lateral
  146, // right lower outer lip, lateral
] as const;

export const CHIN_MESH_INDEX = 152; // lowest point of the mental protuberance
const NOSE_TIP_MESH_INDEX = 1; // used only to estimate yaw; never used for registration

export interface LandmarkDetection {
  landmarks: FaceLandmarks | null;
  /** Complete MediaPipe mesh in source-image pixels for geometry consumers. */
  meshPoints?: readonly Point[] | null;
  faceCount: number;
}

type Landmarker = import('@mediapipe/tasks-vision').FaceLandmarker;
let landmarkerPromise: Promise<Landmarker> | undefined;

/** Lazily loads MediaPipe and detects/mapping landmarks into source-image pixels. */
export async function detect(image: ImageSource): Promise<LandmarkDetection> {
  const landmarker = await getLandmarker();
  const result = landmarker.detect(image);
  const faceCount = result.faceLandmarks.length;
  const firstFace = result.faceLandmarks[0];
  const meshPoints = firstFace ? mapMesh(firstFace, image) : null;
  return {
    faceCount,
    landmarks: meshPoints ? mapFace(meshPoints) : null,
    meshPoints,
  };
}

function getLandmarker(): Promise<Landmarker> {
  landmarkerPromise ??= createLandmarker();
  return landmarkerPromise;
}

async function createLandmarker(): Promise<Landmarker> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH },
    runningMode: 'IMAGE',
    numFaces: 5,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

function mapMesh(mesh: readonly NormalizedLandmark[], image: ImageSource): readonly Point[] {
  const { width, height } = imageDimensions(image);
  return mesh.map((landmark) => ({ x: landmark.x * width, y: landmark.y * height }));
}

function mapFace(mesh: readonly Point[]): FaceLandmarks {
  const toPoint = (index: number): Point => {
    const landmark = mesh[index];
    if (!landmark) throw new Error(`MediaPipe face mesh is missing landmark ${index}`);
    return landmark;
  };

  const rigid = RIGID_MESH_INDICES.map(toPoint);
  const lipContour = OUTER_LIP_MESH_INDICES.map(toPoint);
  const leftEyeCentre = midpoint(rigid[0], rigid[1]);
  const rightEyeCentre = midpoint(rigid[2], rigid[3]);
  const eyeSpan = distance(leftEyeCentre, rightEyeCentre);
  const eyeMidpoint = midpoint(leftEyeCentre, rightEyeCentre);
  const noseTip = toPoint(NOSE_TIP_MESH_INDEX);

  return {
    rigid,
    lipContour,
    chin: toPoint(CHIN_MESH_INDEX),
    roll: radiansToDegrees(Math.atan2(
      leftEyeCentre.y - rightEyeCentre.y,
      leftEyeCentre.x - rightEyeCentre.x,
    )),
    yaw: radiansToDegrees(Math.atan2(noseTip.x - eyeMidpoint.x, eyeSpan / 2)),
  };
}

function imageDimensions(image: ImageSource): { width: number; height: number } {
  const source = image as unknown as Record<string, unknown>;
  const width = numericDimension(source, 'videoWidth', 'naturalWidth', 'displayWidth', 'width');
  const height = numericDimension(source, 'videoHeight', 'naturalHeight', 'displayHeight', 'height');
  if (width <= 0 || height <= 0) throw new Error('Cannot detect landmarks in an empty image');
  return { width, height };
}

function numericDimension(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function midpoint(first: Point | undefined, second: Point | undefined): Point {
  if (!first || !second) throw new Error('MediaPipe face mesh is missing an eye corner');
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function radiansToDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}
