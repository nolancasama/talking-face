import { buildFeatherMask } from '../align/bake';
import type { MouthRegion, Point } from '../core/types';
import type { MeshTarget } from './solver';
import type { MeshTopology } from './topology';

type WarpContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TriangleAffine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export function solveTriangleAffine(
  src: readonly [Point, Point, Point],
  dst: readonly [Point, Point, Point],
): TriangleAffine | null {
  const [first, second, third] = src;
  const denominator = first.x * (second.y - third.y)
    + second.x * (third.y - first.y)
    + third.x * (first.y - second.y);
  if (Math.abs(denominator) < 1e-8) return null;

  const [toFirst, toSecond, toThird] = dst;
  return {
    a: (toFirst.x * (second.y - third.y)
      + toSecond.x * (third.y - first.y)
      + toThird.x * (first.y - second.y)) / denominator,
    b: (toFirst.y * (second.y - third.y)
      + toSecond.y * (third.y - first.y)
      + toThird.y * (first.y - second.y)) / denominator,
    c: (toFirst.x * (third.x - second.x)
      + toSecond.x * (first.x - third.x)
      + toThird.x * (second.x - first.x)) / denominator,
    d: (toFirst.y * (third.x - second.x)
      + toSecond.y * (first.x - third.x)
      + toThird.y * (second.x - first.x)) / denominator,
    e: (toFirst.x * (second.x * third.y - third.x * second.y)
      + toSecond.x * (third.x * first.y - first.x * third.y)
      + toThird.x * (first.x * second.y - second.x * first.y)) / denominator,
    f: (toFirst.y * (second.x * third.y - third.x * second.y)
      + toSecond.y * (third.x * first.y - first.x * third.y)
      + toThird.y * (first.x * second.y - second.x * first.y)) / denominator,
  };
}

export function renderMeshWarp(
  ctx: WarpContext,
  sourceImage: ImageBitmap,
  restPoints: readonly Point[],
  targetPoints: readonly Point[],
  topology: MeshTopology,
): { degenerateTriangleCount: number } {
  let degenerateTriangleCount = 0;
  for (const triangle of topology.triangles) {
    const src = trianglePoints(restPoints, triangle);
    const dst = trianglePoints(targetPoints, triangle);
    if (!src || !dst) {
      degenerateTriangleCount += 1;
      continue;
    }
    const affine = solveTriangleAffine(src, dst);
    if (!affine) {
      degenerateTriangleCount += 1;
      continue;
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dst[0].x, dst[0].y);
    ctx.lineTo(dst[1].x, dst[1].y);
    ctx.lineTo(dst[2].x, dst[2].y);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
    ctx.drawImage(sourceImage, 0, 0);
    ctx.restore();
  }
  return { degenerateTriangleCount };
}

const maskSignatures = new WeakMap<OffscreenCanvas, string>();

export function drawMeshFrame(
  ctx: CanvasRenderingContext2D,
  rest: ImageBitmap,
  restPoints: readonly Point[],
  target: MeshTarget,
  topology: MeshTopology,
  region: MouthRegion,
  scratch: { readonly overlay: OffscreenCanvas; readonly mask: OffscreenCanvas },
): { degenerateTriangleCount: number } {
  ctx.save();
  ctx.resetTransform();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(rest, 0, 0);
  ctx.restore();

  const width = Math.ceil(region.width);
  const height = Math.ceil(region.height);
  if (scratch.overlay.width !== width) scratch.overlay.width = width;
  if (scratch.overlay.height !== height) scratch.overlay.height = height;
  if (scratch.mask.width !== width) scratch.mask.width = width;
  if (scratch.mask.height !== height) scratch.mask.height = height;

  const overlayContext = context2d(scratch.overlay);
  overlayContext.resetTransform();
  overlayContext.globalCompositeOperation = 'source-over';
  overlayContext.clearRect(0, 0, width, height);
  const localTarget = target.points.map((point) => ({
    x: point.x - region.x,
    y: point.y - region.y,
  }));
  const result = renderMeshWarp(overlayContext, rest, restPoints, localTarget, topology);

  ensureMask(scratch.mask, region);
  overlayContext.resetTransform();
  overlayContext.globalCompositeOperation = 'destination-in';
  overlayContext.drawImage(scratch.mask, 0, 0);
  overlayContext.globalCompositeOperation = 'source-over';
  ctx.drawImage(scratch.overlay, region.x, region.y);
  return result;
}

function ensureMask(mask: OffscreenCanvas, region: MouthRegion): void {
  const signature = `${region.width}:${region.height}:${region.feather}`;
  if (maskSignatures.get(mask) === signature) return;
  const context = context2d(mask);
  context.resetTransform();
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, mask.width, mask.height);
  context.drawImage(buildFeatherMask(region), 0, 0);
  maskSignatures.set(mask, signature);
}

function trianglePoints(
  points: readonly Point[],
  triangle: readonly [number, number, number],
): [Point, Point, Point] | null {
  const first = points[triangle[0]];
  const second = points[triangle[1]];
  const third = points[triangle[2]];
  return first && second && third ? [first, second, third] : null;
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is required to render a mesh warp');
  return context;
}
