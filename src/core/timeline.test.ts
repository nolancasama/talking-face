import { describe, expect, it } from 'vitest';
import {
  FRAME_CROSSFADE_MS,
  POSE_ARTICULATION,
  commitmentFor,
  mixArticulation,
} from './articulation';
import { TRAILING_REST_MS } from './visemeMap';
import { articulationAt, buildTimeline, mouthAt } from './timeline';
import type { MouthTimeline, SpeechCue } from './types';

const cue = (startMs: number, endMs: number, symbol: string): SpeechCue => ({
  startMs,
  endMs,
  token: { kind: 'phoneme', symbol },
});

describe('buildTimeline', () => {
  it('merges adjacent cues resolving to the same mouth', () => {
    const timeline = buildTimeline([cue(0, 100, 'AA'), cue(100, 200, 'AE')], 320);
    expect(timeline).toEqual([
      { startMs: 0, endMs: 200, mouth: 'OPEN' },
      { startMs: 200, endMs: 320, mouth: 'REST' },
    ]);
  });

  it('absorbs a sub-minimum span into the longer neighbour', () => {
    const timeline = buildTimeline([
      cue(0, 100, 'M'),
      cue(100, 130, 'AA'),
      cue(130, 330, 'IY'),
    ], 450);
    expect(timeline).toEqual([
      { startMs: 0, endMs: 100, mouth: 'CLOSED' },
      { startMs: 100, endMs: 330, mouth: 'WIDE' },
      { startMs: 330, endMs: 450, mouth: 'REST' },
    ]);
  });

  it('preserves a CLOSED span regardless of duration', () => {
    const timeline = buildTimeline([
      cue(0, 100, 'AA'),
      cue(100, 110, 'M'),
      cue(110, 250, 'IY'),
    ], 370);
    expect(timeline).toContainEqual({ startMs: 100, endMs: 110, mouth: 'CLOSED' });
  });

  it('is gapless, non-overlapping, increasing, and duration-bounded', () => {
    const timeline = buildTimeline([cue(40, 140, 'AA'), cue(190, 400, 'M')], 500);
    expect(timeline[0]!.startMs).toBe(0);
    expect(timeline.at(-1)?.endMs).toBe(500);
    expect(timeline.at(-1)?.mouth).toBe('REST');
    expect((timeline.at(-1)?.endMs ?? 0) - (timeline.at(-1)?.startMs ?? 0))
      .toBeGreaterThanOrEqual(TRAILING_REST_MS);
    for (let index = 0; index < timeline.length; index += 1) {
      expect(timeline[index]!.endMs).toBeGreaterThan(timeline[index]!.startMs);
      if (index > 0) expect(timeline[index]!.startMs).toBe(timeline[index - 1]!.endMs);
    }
  });

  it('handles zero and shorter-than-trailing-rest durations', () => {
    expect(buildTimeline([cue(0, 100, 'AA')], 0)).toEqual([]);
    expect(buildTimeline([cue(0, 100, 'AA')], 50)).toEqual([
      { startMs: 0, endMs: 50, mouth: 'REST' },
    ]);
  });
});

describe('mouthAt', () => {
  const timeline: MouthTimeline = [
    { startMs: 0, endMs: 100, mouth: 'OPEN' },
    { startMs: 100, endMs: 200, mouth: 'ROUND' },
    { startMs: 200, endMs: 300, mouth: 'REST' },
  ];

  it('resolves interiors and exact half-open boundaries', () => {
    expect(mouthAt(timeline, 0)).toBe('OPEN');
    expect(mouthAt(timeline, 99.999)).toBe('OPEN');
    expect(mouthAt(timeline, 100)).toBe('ROUND');
    expect(mouthAt(timeline, 200)).toBe('REST');
    expect(mouthAt(timeline, 300)).toBe('REST');
  });

  it('returns REST for an empty timeline', () => {
    expect(mouthAt([], 0)).toBe('REST');
  });
});

describe('articulationAt', () => {
  it('resolves a sustained span to its reference pose', () => {
    const timeline: MouthTimeline = [
      { startMs: 0, endMs: 200, mouth: 'WIDE' },
    ];

    expect(articulationAt(timeline, 100)).toEqual(POSE_ARTICULATION.WIDE);
  });

  it('lands a brief span strictly between the previous pose and its reference pose', () => {
    const timeline: MouthTimeline = [
      { startMs: 0, endMs: 200, mouth: 'OPEN' },
      { startMs: 200, endMs: 240, mouth: 'ROUND' },
    ];
    const resolved = articulationAt(timeline, 200 + FRAME_CROSSFADE_MS);
    const expected = mixArticulation(
      POSE_ARTICULATION.OPEN,
      POSE_ARTICULATION.ROUND,
      commitmentFor('ROUND', 40),
    );

    expect(resolved).toEqual(expected);
    expect(resolved.lipRound).toBeGreaterThan(POSE_ARTICULATION.OPEN.lipRound);
    expect(resolved.lipRound).toBeLessThan(POSE_ARTICULATION.ROUND.lipRound);
  });

  it('reaches full closure even for a span shorter than the frame crossfade', () => {
    const boundary = 200 + FRAME_CROSSFADE_MS / 2;
    const timeline: MouthTimeline = [
      { startMs: 0, endMs: 200, mouth: 'OPEN' },
      { startMs: 200, endMs: boundary, mouth: 'CLOSED' },
      { startMs: boundary, endMs: 400, mouth: 'OPEN' },
    ];

    expect(articulationAt(timeline, boundary)).toEqual(POSE_ARTICULATION.CLOSED);
  });

  it('is continuous across a span boundary', () => {
    const timeline: MouthTimeline = [
      { startMs: 0, endMs: 200, mouth: 'OPEN' },
      { startMs: 200, endMs: 400, mouth: 'ROUND' },
    ];
    const justBefore = articulationAt(timeline, 199.999);
    const atBoundary = articulationAt(timeline, 200);

    expect(atBoundary).toEqual(justBefore);
  });
});
