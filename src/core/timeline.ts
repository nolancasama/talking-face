import {
  FRAME_CROSSFADE_MS,
  POSE_ARTICULATION,
  commitmentFor,
  mixArticulation,
} from './articulation';
import type { Articulation } from './articulation';
import { MIN_SPAN_MS, TRAILING_REST_MS } from './visemeMap';
import { mapSpeechToken } from './visemeMapper';
import type { MouthSpan, MouthState, MouthTimeline, SpeechCue } from './types';

const spanDuration = (span: MouthSpan): number => span.endMs - span.startMs;

function mergeAdjacent(spans: MouthSpan[]): MouthSpan[] {
  const merged: MouthSpan[] = [];
  for (const span of spans) {
    if (!(span.endMs > span.startMs)) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.mouth === span.mouth && previous.endMs === span.startMs) {
      previous.endMs = span.endMs;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function absorbShortSpans(input: MouthSpan[]): MouthSpan[] {
  let spans = mergeAdjacent(input);

  while (spans.length > 1) {
    const index = spans.findIndex(
      (span) => span.mouth !== 'CLOSED' && spanDuration(span) < MIN_SPAN_MS,
    );
    if (index < 0) break;

    const current = spans[index]!;
    const left = spans[index - 1];
    const right = spans[index + 1];

    if (!left) {
      right!.startMs = current.startMs;
    } else if (!right) {
      left.endMs = current.endMs;
    } else if (spanDuration(right) > spanDuration(left)) {
      right.startMs = current.startMs;
    } else {
      // Prefer the earlier neighbour on a tie for deterministic output.
      left.endMs = current.endMs;
    }

    spans.splice(index, 1);
    spans = mergeAdjacent(spans);
  }

  return spans;
}

/**
 * Build a gapless timeline bounded by the supplied playback duration.
 *
 * The final rest is inside (rather than after) durationMs so the timeline and
 * its playback clock share the same endpoint.
 */
export function buildTimeline(cues: readonly SpeechCue[], durationMs: number): MouthTimeline {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (duration === 0) return [];

  const speechEnd = Math.max(0, duration - TRAILING_REST_MS);
  const sorted = cues
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs))
    .map((cue, order) => ({ cue, order }))
    .sort((a, b) => a.cue.startMs - b.cue.startMs || a.order - b.order);

  const spans: MouthSpan[] = [];
  let cursor = 0;

  for (const { cue } of sorted) {
    const start = Math.max(cursor, Math.min(speechEnd, Math.max(0, cue.startMs)));
    const end = Math.max(start, Math.min(speechEnd, Math.max(0, cue.endMs)));

    if (start > cursor) {
      spans.push({ startMs: cursor, endMs: start, mouth: 'REST' });
      cursor = start;
    }
    if (end > start) {
      spans.push({ startMs: start, endMs: end, mouth: mapSpeechToken(cue.token) });
      cursor = end;
    }
  }

  if (cursor < speechEnd) spans.push({ startMs: cursor, endMs: speechEnd, mouth: 'REST' });
  if (speechEnd < duration) spans.push({ startMs: speechEnd, endMs: duration, mouth: 'REST' });

  return absorbShortSpans(spans);
}

/** Resolve a time using half-open spans; the timeline endpoint uses its last span. */
export function mouthAt(timeline: MouthTimeline, ms: number): MouthState {
  if (timeline.length === 0) return 'REST';
  const first = timeline[0]!;
  if (!Number.isFinite(ms) || ms <= first.startMs) return first.mouth;

  const last = timeline[timeline.length - 1]!;
  if (ms >= last.endMs) return last.mouth;

  let low = 0;
  let high = timeline.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const span = timeline[middle]!;
    if (ms < span.startMs) high = middle - 1;
    else if (ms >= span.endMs) low = middle + 1;
    else return span.mouth;
  }

  return last.mouth;
}

/**
 * Resolve the timeline's target articulation at a playback position.
 *
 * Each span commits from the previous span's effective endpoint rather than
 * from its baked reference pose. Real boundaries then blend toward that
 * endpoint over the short photographic-frame crossfade window.
 */
export function articulationAt(timeline: MouthTimeline, ms: number): Articulation {
  if (timeline.length === 0 || !Number.isFinite(ms)) {
    return { ...POSE_ARTICULATION.REST };
  }

  let previous = POSE_ARTICULATION.REST;
  for (let index = 0; index < timeline.length; index += 1) {
    const span = timeline[index]!;
    const committed = mixArticulation(
      previous,
      POSE_ARTICULATION[span.mouth],
      commitmentFor(span.mouth, spanDuration(span)),
    );

    if (ms < span.endMs || index === timeline.length - 1) {
      // The first span has no real incoming boundary. Resolving it immediately
      // also lets a reset at position zero start at the correct articulation.
      if (index === 0 || ms >= span.startMs + FRAME_CROSSFADE_MS) {
        return committed;
      }

      const transitionDuration = Math.min(FRAME_CROSSFADE_MS, spanDuration(span));
      if (!(transitionDuration > 0)) return committed;
      return mixArticulation(previous, committed, (ms - span.startMs) / transitionDuration);
    }

    previous = committed;
  }

  return { ...previous };
}
