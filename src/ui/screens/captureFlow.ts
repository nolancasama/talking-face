// Pure capture-flow rules, kept free of the camera, DOM and MediaPipe so the
// onboarding sequence can be unit-tested. CaptureScreen owns everything else.
import type { MouthPose } from '../../core/poses';

/**
 * Consecutive quality-gate rejections on one pose before a quiet "Skip this
 * photo" is offered. The gate itself is never relaxed; this only stops a pose
 * the camera cannot get (poor lighting, a tongue pose that will not register) from
 * trapping the user. A skipped pose is simply absent, which storage and the
 * renderer already tolerate.
 */
export const SKIP_OFFER_AFTER_FAILURES = 3;

export type CaptureAdvance =
  | { readonly kind: 'next'; readonly stepIndex: number }
  | { readonly kind: 'preview' };

export function progressLabel(stepIndex: number, total: number): string {
  return `Photo ${stepIndex + 1} of ${total}`;
}

/** After capturing or skipping a step: the next step, or on to preview. */
export function advanceAfter(stepIndex: number, sequence: readonly MouthPose[]): CaptureAdvance {
  return stepIndex < sequence.length - 1
    ? { kind: 'next', stepIndex: stepIndex + 1 }
    : { kind: 'preview' };
}

export function nextButtonLabel(stepIndex: number, total: number): string {
  return stepIndex >= total - 1 ? 'Preview' : 'Next';
}

/** REST is the alignment reference and can never be skipped. */
export function canSkip(pose: MouthPose, consecutiveFailures: number): boolean {
  return pose !== 'REST' && consecutiveFailures >= SKIP_OFFER_AFTER_FAILURES;
}
