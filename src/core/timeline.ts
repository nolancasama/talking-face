import {
  CROSSFADE_MS,
  MIN_SPAN_MS,
  TRAILING_REST_MS,
} from './visemeMap';
import { mapSpeechToken } from './visemeMapper';
import type { MouthSpan, MouthState, MouthTimeline, SpeechCue } from './types';

export interface MouthCrossfade {
  from: MouthState;
  to: MouthState;
  t: number;
}

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
    const index = spans.findIndex((span) => spanDuration(span) < MIN_SPAN_MS);
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

/** Return the active boundary crossfade, or a settled state when outside one. */
export function crossfadeAt(timeline: MouthTimeline, ms: number): MouthCrossfade {
  const to = mouthAt(timeline, ms);
  if (timeline.length < 2 || !Number.isFinite(ms)) return { from: to, to, t: 1 };

  let low = 1;
  let high = timeline.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (timeline[middle]!.startMs <= ms) low = middle + 1;
    else high = middle - 1;
  }

  const index = high;
  if (index > 0) {
    const current = timeline[index]!;
    const elapsed = ms - current.startMs;
    if (elapsed >= 0 && elapsed < CROSSFADE_MS) {
      return {
        from: timeline[index - 1]!.mouth,
        to: current.mouth,
        t: elapsed / CROSSFADE_MS,
      };
    }
  }

  return { from: to, to, t: 1 };
}
