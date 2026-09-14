// End-to-end perceptual scenarios from real-face testing: Web Speech estimate
// -> articulation track -> simulated playback. Each case names the phrase that
// was judged on a face, so a regression here maps straight back to it.
import { describe, expect, it } from 'vitest';
import { buildArticulationTrack } from '../core/coarticulation';
import type { ArticulationSegment, ArticulationTrack } from '../core/coarticulation';
import { longestVisibleMs, poseWeightOf, simulatePlayback } from '../core/playbackSimulation';
import type { SimulatedFrame } from '../core/playbackSimulation';
import { estimate } from './webspeech';

function speakText(text: string): ArticulationTrack {
  const result = estimate(text, 1);
  return buildArticulationTrack(result.cues, result.durationMs);
}

const segmentsOf = (track: ArticulationTrack, phoneme: string): ArticulationSegment[] =>
  track.segments.filter((entry) => entry.phoneme === phoneme);

const framesDuring = (frames: readonly SimulatedFrame[], from: number, to: number): SimulatedFrame[] =>
  frames.filter((frame) => frame.ms >= from && frame.ms <= to);

const roundedVisibleMs = (text: string): number =>
  longestVisibleMs(simulatePlayback(speakText(text)), (a) => a.lipRound >= 0.6);

describe('stressed OH inside a word ("No." vs "Nolan.")', () => {
  it('generates the stressed OH in Nolan, as in No', () => {
    const [ow] = segmentsOf(speakText('Nolan.'), 'OW');
    expect(ow).toBeDefined();
    expect(ow!.stress).toBe(1);
  });

  it('keeps the OH of Nolan nearly as visible as standalone No', () => {
    const alone = roundedVisibleMs('No.');
    expect(alone).toBeGreaterThanOrEqual(120);
    expect(roundedVisibleMs('Nolan.')).toBeGreaterThanOrEqual(alone * 0.8);
    const peak = Math.max(...simulatePlayback(speakText('Nolan.')).map((frame) => frame.articulation.lipRound));
    expect(peak).toBeGreaterThan(0.75);
  });

  it.each(['Nobody.', 'Notebook.', 'Going.', 'Open.', 'Over.'])(
    'shows the stressed internal OH in %s',
    (text) => {
      expect(segmentsOf(speakText(text), 'OW')[0]?.stress).toBe(1);
      // Five frames or more. "Open." is the tightest (~83ms): its OH starts the
      // utterance, so rounding builds up from REST.
      expect(roundedVisibleMs(text)).toBeGreaterThanOrEqual(80);
    },
  );
});

describe('L stays good', () => {
  it.each(['Hello, Lily.', 'Nolan.'])('every L in %s still shows its tongue', (text) => {
    const track = speakText(text);
    const frames = simulatePlayback(track);
    const ls = segmentsOf(track, 'L');
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) {
      // Rendered peaks for these ~45-55ms L's sit around 0.34-0.5; the tongue
      // path is not touched by the nucleus hold or the estimator changes.
      const tongue = Math.max(...framesDuring(frames, l.startMs, l.endMs + 40).map((frame) => frame.articulation.tongue));
      expect(tongue).toBeGreaterThan(0.3);
    }
  });
});

describe('rounded vowels', () => {
  it.each(['Move.', 'Moved.', 'Moon.', 'Food.', 'Too blue.'])(
    'every /u/ in %s settles clearly on the ROUND photograph at some point',
    (text) => {
      const track = speakText(text);
      const frames = simulatePlayback(track);
      for (const uw of segmentsOf(track, 'UW')) {
        const during = framesDuring(frames, uw.startMs, uw.endMs);
        expect(Math.max(...during.map((frame) => poseWeightOf(frame.articulation, 'ROUND')))).toBeGreaterThan(0.6);
      }
    },
  );

  it.each(['Moved.', 'Moon.', 'Food.', 'Too blue.'])(
    'never combines strong rounding with spread lips in %s',
    (text) => {
      for (const frame of simulatePlayback(speakText(text))) {
        if (frame.articulation.lipRound >= 0.7) expect(frame.articulation.lipWidth).toBeLessThanOrEqual(0.3);
      }
    },
  );

  it('keeps both rounded vowels of "Too blue." firmly ROUND', () => {
    const track = speakText('Too blue.');
    const frames = simulatePlayback(track);
    const vowels = segmentsOf(track, 'UW');
    expect(vowels).toHaveLength(2);
    for (const uw of vowels) {
      const during = framesDuring(frames, uw.startMs, uw.endMs);
      expect(Math.max(...during.map((frame) => poseWeightOf(frame.articulation, 'ROUND')))).toBeGreaterThan(0.75);
    }
  });
});
