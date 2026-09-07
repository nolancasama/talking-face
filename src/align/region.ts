import type { CapturedShot, FaceLandmarks, MouthPose, MouthRegion, Point } from '../core/types';
import { CAPTURE_POSES } from '../core/types';
import { apply, solveSimilarityTransform } from './transform';

/** Horizontal coverage relative to lip width, chosen to reach static cheek skin. */
export const REGION_WIDTH_IN_LIP_WIDTHS = 2.4;
/** Top padding relative to lip width, keeping the upper edge above moving skin. */
export const REGION_TOP_PADDING_IN_LIP_WIDTHS = 0.32;
/** Extra coverage below the chin relative to lip width. */
export const REGION_CHIN_PADDING_IN_LIP_WIDTHS = 0.18;
/** A broad falloff hides exposure and registration differences at the boundary. */
export const REGION_FEATHER_FRACTION = 0.18;

/**
 * Computes the compositing region in the neutral selfie's pixel coordinates,
 * sized to hold EVERY pose rather than only the neutral one.
 *
 * Sizing from the neutral shot alone under-covers by construction: the poses
 * exist precisely because they are more extreme than neutral. A WIDE (EEE)
 * smile is wider and a BIG_OPEN (AHH) jaw is lower than anything the neutral lip
 * contour predicts, so each pose's lips and chin are mapped into neutral space
 * through its own registration transform and the union drives the geometry.
 */
export function computeMouthRegionFromShots(
  neutral: CapturedShot,
  poses: Readonly<Partial<Record<MouthPose, CapturedShot>>>,
): MouthRegion {
  const points: Point[] = [...neutral.landmarks.lipContour, neutral.landmarks.chin];

  for (const pose of CAPTURE_POSES) {
    const shot = poses[pose];
    if (!shot) continue;
    const toNeutral = solveSimilarityTransform(shot.landmarks, neutral.landmarks);
    for (const point of shot.landmarks.lipContour) points.push(apply(toNeutral, point));
    points.push(apply(toNeutral, shot.landmarks.chin));
  }

  // The chin used for padding is the lowest seen across every pose.
  let chinY = Number.NEGATIVE_INFINITY;
  for (const point of points) chinY = Math.max(chinY, point.y);

  return regionFromExtents(points, { x: neutral.landmarks.chin.x, y: chinY });
}

/** Neutral-only sizing. Kept for tests and for previewing a single shot. */
export function computeMouthRegion(landmarks: FaceLandmarks): MouthRegion {
  if (landmarks.lipContour.length === 0) {
    throw new Error('Cannot compute a mouth region without a lip contour');
  }
  return regionFromExtents([...landmarks.lipContour], landmarks.chin);
}

function regionFromExtents(contour: readonly Point[], chin: Point): MouthRegion {
  if (contour.length === 0) {
    throw new Error('Cannot compute a mouth region without a lip contour');
  }

  let lipLeft = Number.POSITIVE_INFINITY;
  let lipRight = Number.NEGATIVE_INFINITY;
  let lipTop = Number.POSITIVE_INFINITY;
  let lipBottom = Number.NEGATIVE_INFINITY;

  for (const point of contour) {
    lipLeft = Math.min(lipLeft, point.x);
    lipRight = Math.max(lipRight, point.x);
    lipTop = Math.min(lipTop, point.y);
    lipBottom = Math.max(lipBottom, point.y);
  }

  const lipWidth = lipRight - lipLeft;
  const lipHeight = lipBottom - lipTop;
  if (lipWidth <= 0 || lipHeight < 0) {
    throw new Error('Cannot compute a mouth region from a degenerate lip contour');
  }

  const centreX = (lipLeft + lipRight) / 2;
  const width = Math.max(
    lipWidth * REGION_WIDTH_IN_LIP_WIDTHS,
    lipWidth + lipHeight * 4,
  );
  const topPadding = Math.max(
    lipWidth * REGION_TOP_PADDING_IN_LIP_WIDTHS,
    lipHeight * 1.5,
  );
  const chinPadding = Math.max(
    lipWidth * REGION_CHIN_PADDING_IN_LIP_WIDTHS,
    lipHeight * 0.75,
  );
  const y = lipTop - topPadding;
  const bottom = Math.max(chin.y + chinPadding, lipBottom + chinPadding);
  const height = bottom - y;

  return {
    x: centreX - width / 2,
    y,
    width,
    height,
    feather: Math.min(width, height) * REGION_FEATHER_FRACTION,
  };
}
