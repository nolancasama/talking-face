import { describe, expect, it } from 'vitest';
import { POSE_ARTICULATION, poseWeights } from './articulation';
import { ALL_POSES } from './poses';
import { migrateStoredAvatar } from '../store/avatarStore';
import type { LegacyStoredAvatarV1 } from '../store/avatarStore';
import { TRAILING_REST_MS } from './visemeMap';
import { buildTimeline, mouthAt } from './timeline';
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
      { startMs: 0, endMs: 200, mouth: 'BIG_OPEN' },
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

  it.each([
    ['M', 'CLOSED'],
    ['F', 'TEETH_LIP'],
    ['TH', 'TH'],
  ] as const)('preserves protected %s spans regardless of duration', (symbol, pose) => {
    const timeline = buildTimeline([
      cue(0, 100, 'AA'),
      cue(100, 110, symbol),
      cue(110, 250, 'IY'),
    ], 370);
    expect(timeline).toContainEqual({ startMs: 100, endMs: 110, mouth: pose });
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
    { startMs: 0, endMs: 100, mouth: 'BIG_OPEN' },
    { startMs: 100, endMs: 200, mouth: 'ROUND' },
    { startMs: 200, endMs: 300, mouth: 'REST' },
  ];

  it('resolves interiors and exact half-open boundaries', () => {
    expect(mouthAt(timeline, 0)).toBe('BIG_OPEN');
    expect(mouthAt(timeline, 99.999)).toBe('BIG_OPEN');
    expect(mouthAt(timeline, 100)).toBe('ROUND');
    expect(mouthAt(timeline, 200)).toBe('REST');
    expect(mouthAt(timeline, 300)).toBe('REST');
  });

  it('returns REST for an empty timeline', () => {
    expect(mouthAt([], 0)).toBe('REST');
  });
});

describe('legacy avatar migration', () => {
  it('maps OPEN to BIG_OPEN and remains drawable through available poses', () => {
    const rest = new Blob(['rest'], { type: 'image/png' });
    const closed = new Blob(['closed'], { type: 'image/png' });
    const open = new Blob(['open'], { type: 'image/png' });
    const wide = new Blob(['wide'], { type: 'image/png' });
    const round = new Blob(['round'], { type: 'image/png' });
    const legacy = {
      schemaVersion: 1,
      id: 'legacy',
      createdAt: 1,
      width: 100,
      height: 100,
      frames: { REST: rest, CLOSED: closed, OPEN: open, WIDE: wide, ROUND: round },
      region: { x: 0, y: 0, width: 10, height: 10, feather: 2 },
      nudge: { OPEN: { dx: 1, dy: 2, scale: 1.1 } },
    } satisfies LegacyStoredAvatarV1;

    const migrated = migrateStoredAvatar(legacy);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.frames.BIG_OPEN).toBe(open);
    expect('OPEN' in migrated.frames).toBe(false);
    expect(migrated.nudge.BIG_OPEN).toEqual({ dx: 1, dy: 2, scale: 1.1 });
    expect(legacy.frames.OPEN).toBe(open);

    const available = ALL_POSES.filter((pose) => migrated.frames[pose] !== undefined);
    const weights = poseWeights(POSE_ARTICULATION.TH, available);
    expect(weights.length).toBeGreaterThan(0);
    for (const entry of weights) expect(migrated.frames[entry.pose]).toBeInstanceOf(Blob);
  });
});
