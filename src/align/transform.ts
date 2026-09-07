import type { FaceLandmarks, Point, SimilarityTransform } from '../core/types';

const MIN_VARIANCE = 1e-12;

/**
 * Fits the similarity transform that maps `source` (a pose) onto `target`
 * (the neutral selfie). Only the rigid landmark sets participate in the fit.
 */
export function solveSimilarityTransform(
  source: FaceLandmarks,
  target: FaceLandmarks,
): SimilarityTransform {
  const sourcePoints = source.rigid;
  const targetPoints = target.rigid;

  if (sourcePoints.length !== targetPoints.length || sourcePoints.length < 2) {
    throw new Error('Similarity fitting requires equal rigid point sets with at least two points');
  }

  const sourceMean = mean(sourcePoints);
  const targetMean = mean(targetPoints);
  let dot = 0;
  let cross = 0;
  let sourceVariance = 0;

  for (let index = 0; index < sourcePoints.length; index += 1) {
    const sourcePoint = sourcePoints[index];
    const targetPoint = targetPoints[index];
    if (!sourcePoint || !targetPoint) continue;

    const sx = sourcePoint.x - sourceMean.x;
    const sy = sourcePoint.y - sourceMean.y;
    const tx = targetPoint.x - targetMean.x;
    const ty = targetPoint.y - targetMean.y;
    dot += sx * tx + sy * ty;
    cross += sx * ty - sy * tx;
    sourceVariance += sx * sx + sy * sy;
  }

  if (sourceVariance <= MIN_VARIANCE) {
    throw new Error('Similarity fitting requires non-coincident rigid points');
  }

  const rotation = Math.atan2(cross, dot);
  const scale = Math.hypot(dot, cross) / sourceVariance;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const mappedMeanX = scale * (cosine * sourceMean.x - sine * sourceMean.y);
  const mappedMeanY = scale * (sine * sourceMean.x + cosine * sourceMean.y);

  return {
    scale,
    rotation,
    tx: targetMean.x - mappedMeanX,
    ty: targetMean.y - mappedMeanY,
  };
}

/** Applies a pose-to-neutral similarity transform to one point. */
export function apply(transform: SimilarityTransform, point: Point): Point {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return {
    x: transform.scale * (cosine * point.x - sine * point.y) + transform.tx,
    y: transform.scale * (sine * point.x + cosine * point.y) + transform.ty,
  };
}

/** Returns the exact inverse of a non-degenerate similarity transform. */
export function invert(transform: SimilarityTransform): SimilarityTransform {
  if (Math.abs(transform.scale) <= MIN_VARIANCE) {
    throw new Error('Cannot invert a zero-scale similarity transform');
  }

  const scale = 1 / transform.scale;
  const rotation = -transform.rotation;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    scale,
    rotation,
    tx: -scale * (cosine * transform.tx - sine * transform.ty),
    ty: -scale * (sine * transform.tx + cosine * transform.ty),
  };
}

function mean(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}
