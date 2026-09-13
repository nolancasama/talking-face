import {
  CAPTURE_POSES,
  NO_NUDGE,
  type CapturedShot,
  type MouthPose,
  type MouthRegion,
  type NudgeOffset,
  type SimilarityTransform,
} from '../core/types';
import { solveSimilarityTransform } from './transform';

type RenderCanvas = OffscreenCanvas | HTMLCanvasElement;
type RenderContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

type BakedFrames = Partial<Record<MouthPose, ImageBitmap>> & { REST: ImageBitmap };

/** Bakes REST plus the captured pose composites into full-size playback frames. */
export async function bake(
  neutral: CapturedShot,
  poses: Readonly<Partial<Record<MouthPose, CapturedShot>>>,
  region: MouthRegion,
  nudges: Readonly<Partial<Record<MouthPose, NudgeOffset>>>,
): Promise<BakedFrames> {
  validateRegion(region);
  const frameWidth = neutral.image.width;
  const frameHeight = neutral.image.height;
  const mask = buildFeatherMask(region);
  const rest = await copyBitmap(neutral.image, frameWidth, frameHeight);
  const frames: BakedFrames = { REST: rest };

  for (const pose of CAPTURE_POSES) {
    const shot = poses[pose];
    if (!shot) continue;
    const transform = solveSimilarityTransform(shot.landmarks, neutral.landmarks);
    frames[pose] = await compositeFrame(
      neutral.image,
      shot.image,
      transform,
      region,
      nudges[pose] ?? NO_NUDGE,
      mask,
      frameWidth,
      frameHeight,
    );
  }

  return frames;
}

/** Descriptive alias for callers that prefer the operation's full name. */
export const bakeMouthFrames = bake;

async function compositeFrame(
  neutral: ImageBitmap,
  pose: ImageBitmap,
  transform: SimilarityTransform,
  region: MouthRegion,
  nudge: NudgeOffset,
  mask: RenderCanvas,
  frameWidth: number,
  frameHeight: number,
): Promise<ImageBitmap> {
  if (!Number.isFinite(nudge.scale) || nudge.scale <= 0) {
    throw new Error('Nudge scale must be a positive finite number');
  }

  const overlay = createCanvas(Math.ceil(region.width), Math.ceil(region.height));
  const overlayContext = context2d(overlay);
  const matrix = nudgedMatrix(transform, region, nudge);
  overlayContext.setTransform(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e - region.x,
    matrix.f - region.y,
  );
  overlayContext.drawImage(pose, 0, 0);
  overlayContext.resetTransform();
  overlayContext.globalCompositeOperation = 'destination-in';
  overlayContext.drawImage(mask, 0, 0);
  overlayContext.globalCompositeOperation = 'source-over';

  const frame = createCanvas(frameWidth, frameHeight);
  const frameContext = context2d(frame);
  frameContext.drawImage(neutral, 0, 0);
  frameContext.drawImage(overlay, region.x, region.y);
  return canvasToBitmap(frame);
}

function nudgedMatrix(
  transform: SimilarityTransform,
  region: MouthRegion,
  nudge: NudgeOffset,
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  const centreX = region.x + region.width / 2;
  const centreY = region.y + region.height / 2;
  const postTranslateX = (1 - nudge.scale) * centreX + nudge.dx;
  const postTranslateY = (1 - nudge.scale) * centreY + nudge.dy;

  return {
    a: nudge.scale * transform.scale * cosine,
    b: nudge.scale * transform.scale * sine,
    c: -nudge.scale * transform.scale * sine,
    d: nudge.scale * transform.scale * cosine,
    e: nudge.scale * transform.tx + postTranslateX,
    f: nudge.scale * transform.ty + postTranslateY,
  };
}

export function buildFeatherMask(region: MouthRegion): RenderCanvas {
  const width = Math.ceil(region.width);
  const height = Math.ceil(region.height);
  const mask = createCanvas(width, height);
  const context = context2d(mask);

  // Opaque plateau across the interior, ramping to zero only within `feather`
  // px of the boundary. A centre-weighted radial falloff was tried first and is
  // wrong for this region: the region is deliberately sized so its EDGE lands on
  // static skin, and spreading the falloff inward from the centre leaves the lip
  // corners semi-transparent -- which ghosts exactly the WIDE (EEE) pose whose
  // whole point is wide corners. See DESIGN_DECISIONS.md.
  const feather = Math.max(1, Math.min(region.feather, Math.min(width, height) / 2 - 1));
  const image = context.createImageData(width, height);
  const data = image.data;

  // Precompute the per-axis ramp so the fill is two lookups per pixel.
  const rampX = edgeRamp(width, feather);
  const rampY = edgeRamp(height, feather);

  for (let y = 0; y < height; y += 1) {
    const ay = rampY[y] as number;
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = row + x * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // The product of the two axis ramps rounds the corners naturally.
      data[i + 3] = Math.round(255 * ay * (rampX[x] as number));
    }
  }

  context.putImageData(image, 0, 0);
  return mask;
}

/** Per-axis alpha ramp: 0 at the edge, 1 once `feather` px inside, smoothstepped. */
export function edgeRamp(length: number, feather: number): Float32Array {
  const ramp = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const distance = Math.min(i + 0.5, length - (i + 0.5));
    const t = Math.min(1, Math.max(0, distance / feather));
    ramp[i] = t * t * (3 - 2 * t);
  }
  return ramp;
}

async function copyBitmap(image: ImageBitmap, width: number, height: number): Promise<ImageBitmap> {
  const canvas = createCanvas(width, height);
  context2d(canvas).drawImage(image, 0, 0);
  return canvasToBitmap(canvas);
}

function canvasToBitmap(canvas: RenderCanvas): Promise<ImageBitmap> {
  return createImageBitmap(canvas);
}

function createCanvas(width: number, height: number): RenderCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') {
    throw new Error('Canvas rendering is unavailable in this environment');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: RenderCanvas): RenderContext {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is required to bake mouth frames');
  return context as RenderContext;
}

function validateRegion(region: MouthRegion): void {
  if (
    !Number.isFinite(region.x)
    || !Number.isFinite(region.y)
    || !Number.isFinite(region.width)
    || !Number.isFinite(region.height)
    || !Number.isFinite(region.feather)
    || region.width <= 0
    || region.height <= 0
    || region.feather <= 0
  ) {
    throw new Error('Mouth region must contain finite positive dimensions and feather');
  }
}
