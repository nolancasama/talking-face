import type { CapturedShot, CaptureCheck, FaceLandmarks, MouthRegion, Point } from '../core/types';
import type { LandmarkDetection } from './landmarks';
import { computeMouthRegion } from './region';

/** Below 45/255, camera noise dominates useful skin and mouth detail. */
export const MIN_MEAN_LUMA = 45;
/** Beyond 16 degrees, a 2D similarity fit cannot hide perspective asymmetry. */
export const MAX_ABS_YAW_DEGREES = 16;
/** Beyond 12 degrees, the face is visibly tilted even after registration. */
export const MAX_ABS_ROLL_DEGREES = 12;
/** Eighteen percent permits normal lean while rejecting material face-size drift. */
export const MAX_INTER_OCULAR_DRIFT_FRACTION = 0.18;
/** A Laplacian variance below 65 indicates lost mouth-edge detail at normalized size. */
export const MIN_MOUTH_LAPLACIAN_VARIANCE = 65;

const LUMA_SAMPLE_SIZE = 64;
const BLUR_SAMPLE_LONG_EDGE = 192;

/** Runs all capture gates and, on success, returns the frozen CapturedShot shape. */
export async function checkCapture(
  image: ImageBitmap,
  detection: LandmarkDetection,
  neutral?: CapturedShot,
  mouthRegion?: MouthRegion,
): Promise<CaptureCheck> {
  if (detection.faceCount === 0 || !detection.landmarks) {
    return { ok: false, reason: 'no-face' };
  }
  if (detection.faceCount > 1) {
    return { ok: false, reason: 'multiple-faces' };
  }

  const landmarks = detection.landmarks;
  if (meanLuma(image) < MIN_MEAN_LUMA) {
    return { ok: false, reason: 'too-dark' };
  }
  if (
    Math.abs(landmarks.yaw) > MAX_ABS_YAW_DEGREES
    || Math.abs(landmarks.roll) > MAX_ABS_ROLL_DEGREES
  ) {
    return { ok: false, reason: 'not-frontal' };
  }
  if (neutral && interOcularDrift(landmarks, neutral.landmarks) > MAX_INTER_OCULAR_DRIFT_FRACTION) {
    return { ok: false, reason: 'scale-mismatch' };
  }

  const region = mouthRegion ?? computeMouthRegion(landmarks);
  if (mouthLaplacianVariance(image, region) < MIN_MOUTH_LAPLACIAN_VARIANCE) {
    return { ok: false, reason: 'too-blurry' };
  }

  return { ok: true, shot: { image, landmarks } };
}

/** Fractional inter-ocular scale drift, independent of image dimensions. */
export function interOcularDrift(current: FaceLandmarks, neutral: FaceLandmarks): number {
  const currentDistance = interOcularDistance(current);
  const neutralDistance = interOcularDistance(neutral);
  if (neutralDistance <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(currentDistance / neutralDistance - 1);
}

function interOcularDistance(landmarks: FaceLandmarks): number {
  const leftOuter = landmarks.rigid[0];
  const rightOuter = landmarks.rigid[3];
  if (!leftOuter || !rightOuter) return 0;
  return distance(leftOuter, rightOuter);
}

function meanLuma(image: ImageBitmap): number {
  const canvas = createCanvas(LUMA_SAMPLE_SIZE, LUMA_SAMPLE_SIZE);
  const context = context2d(canvas, true);
  context.drawImage(image, 0, 0, LUMA_SAMPLE_SIZE, LUMA_SAMPLE_SIZE);
  const pixels = context.getImageData(0, 0, LUMA_SAMPLE_SIZE, LUMA_SAMPLE_SIZE).data;
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += luma(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0);
  }
  return total / (pixels.length / 4);
}

function mouthLaplacianVariance(image: ImageBitmap, region: MouthRegion): number {
  const sourceX = Math.max(0, region.x);
  const sourceY = Math.max(0, region.y);
  const sourceRight = Math.min(image.width, region.x + region.width);
  const sourceBottom = Math.min(image.height, region.y + region.height);
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  if (sourceWidth <= 2 || sourceHeight <= 2) return 0;

  const scale = BLUR_SAMPLE_LONG_EDGE / Math.max(sourceWidth, sourceHeight);
  const width = Math.max(3, Math.round(sourceWidth * scale));
  const height = Math.max(3, Math.round(sourceHeight * scale));
  const canvas = createCanvas(width, height);
  const context = context2d(canvas, true);
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const offset = pixel * 4;
    gray[pixel] = luma(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0);
  }

  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const centre = gray[y * width + x] ?? 0;
      const laplacian =
        (gray[(y - 1) * width + x] ?? 0)
        + (gray[(y + 1) * width + x] ?? 0)
        + (gray[y * width + x - 1] ?? 0)
        + (gray[y * width + x + 1] ?? 0)
        - 4 * centre;
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

function luma(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

type AnalysisCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnalysisContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createCanvas(width: number, height: number): AnalysisCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') {
    throw new Error('Canvas analysis is unavailable in this environment');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: AnalysisCanvas, willReadFrequently: boolean): AnalysisContext {
  const context = canvas.getContext('2d', { willReadFrequently });
  if (!context) throw new Error('A 2D canvas context is required for capture quality checks');
  return context as AnalysisContext;
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
