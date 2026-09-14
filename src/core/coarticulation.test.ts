import { describe, expect, it } from 'vitest';
import { POSE_ARTICULATION, poseWeights } from './articulation';
import type { Articulation } from './articulation';
import {
  BARRIER_SILENCE_MS,
  buildArticulationTrack,
  coarticulate,
  describeCoarticulation,
} from './coarticulation';
import type { ArticulationSegment, ArticulationTrack } from './coarticulation';
import { TRAILING_REST_MS } from './visemeMap';
import type { SpeechCue, SpeechToken } from './types';

/** Leading silence long enough to be an utterance-edge barrier. */
const LEAD_MS = 60;

type Sound = readonly [symbol: string, durationMs: number];

function speak(...sounds: Sound[]): ArticulationTrack {
  let cursor = LEAD_MS;
  const cues: SpeechCue[] = sounds.map(([symbol, duration]) => {
    const token: SpeechToken = symbol === '_'
      ? { kind: 'silence' }
      : { kind: 'phoneme', symbol };
    const cue = { startMs: cursor, endMs: cursor + duration, token };
    cursor += duration;
    return cue;
  });
  return buildArticulationTrack(cues, cursor + TRAILING_REST_MS);
}

function segment(track: ArticulationTrack, phoneme: string, occurrence = 0): ArticulationSegment {
  const found = track.segments.filter((entry) => entry.phoneme === phoneme)[occurrence];
  if (!found) throw new Error(`no ${phoneme} #${occurrence} in track`);
  return found;
}

const middle = (entry: ArticulationSegment): number => (entry.startMs + entry.endMs) / 2;
const at = (track: ArticulationTrack, ms: number): Articulation => coarticulate(track, ms);
const nearestPose = (articulation: Articulation) => poseWeights(articulation)[0]!;

describe('bilabial closure (M/B/P)', () => {
  const map = speak(['M', 70], ['AE', 130], ['P', 80]);

  it('reaches full lip closure on M and P in "map"', () => {
    for (const phoneme of ['M', 'P']) {
      const articulation = at(map, middle(segment(map, phoneme)));
      expect(articulation.lipClosure).toBeGreaterThan(0.98);
      expect(nearestPose(articulation).pose).toBe('CLOSED');
    }
  });

  it('still reaches closure when the M is only 15ms long', () => {
    const track = speak(['AA', 150], ['M', 15], ['AA', 150]);
    const m = segment(track, 'M');
    let peak = 0;
    for (let ms = m.startMs - 20; ms <= m.endMs + 20; ms += 1) {
      peak = Math.max(peak, at(track, ms).lipClosure);
    }
    expect(peak).toBeGreaterThan(0.98);
  });

  it('keeps the closure dominant in pose resolution despite neighbouring rounding ("moon")', () => {
    const moon = speak(['M', 70], ['UW', 160], ['N', 70]);
    const weights = poseWeights(at(moon, middle(segment(moon, 'M'))));
    expect(weights[0]!.pose).toBe('CLOSED');
    expect(weights[0]!.weight).toBeGreaterThan(0.7);
  });
});

describe('labiodental (F/V)', () => {
  it('drives both F and V in "five" to the TEETH_LIP gesture', () => {
    const five = speak(['F', 80], ['AY', 170], ['V', 70]);
    for (const phoneme of ['F', 'V']) {
      const articulation = at(five, middle(segment(five, phoneme)));
      expect(articulation.lipClosure).toBeCloseTo(POSE_ARTICULATION.TEETH_LIP.lipClosure, 1);
      expect(articulation.jawOpen).toBeLessThan(0.22);
      expect(nearestPose(articulation).pose).toBe('TEETH_LIP');
    }
  });
});

describe('anticipatory rounding', () => {
  it('starts rounding during the /t/ of "too", before /u/ begins', () => {
    const too = speak(['T', 80], ['UW', 180]);
    const t = segment(too, 'T');
    const early = at(too, t.startMs + 10).lipRound;
    const late = at(too, t.endMs - 10).lipRound;
    expect(late).toBeGreaterThan(early + 0.15);
    expect(late).toBeGreaterThan(0.25);
    expect(describeCoarticulation(too, t.endMs - 10)?.anticipation?.feature).toBe('ROUND');
  });

  it('sustains a rounded /u/ in "moon" without a big jaw opening', () => {
    const moon = speak(['M', 70], ['UW', 160], ['N', 70]);
    const articulation = at(moon, middle(segment(moon, 'UW')));
    expect(articulation.lipRound).toBeGreaterThan(0.7);
    expect(articulation.jawOpen).toBeLessThan(0.3);
    expect(nearestPose(articulation).pose).toBe('ROUND');
  });

  it('lets /w/ reach real rounding even when brief', () => {
    const what = speak(['W', 60], ['AH1', 120], ['T', 70]);
    expect(at(what, middle(segment(what, 'W'))).lipRound).toBeGreaterThan(0.55);
  });
});

describe('low-visibility consonants', () => {
  it('keeps both K in "kick" from opening the jaw', () => {
    const kick = speak(['K', 70], ['IH', 110], ['K', 70]);
    for (const occurrence of [0, 1]) {
      const k = segment(kick, 'K', occurrence);
      for (let ms = k.startMs; ms < k.endMs; ms += 5) {
        expect(at(kick, ms).jawOpen).toBeLessThan(0.3);
      }
    }
    expect(describeCoarticulation(kick, middle(segment(kick, 'K')))!.strength).toBeLessThan(0.2);
  });

  it('adds no pose of its own between two vowels ("aka")', () => {
    const aka = speak(['AA', 160], ['K', 60], ['AA', 160]);
    const vowel = at(aka, middle(segment(aka, 'AA')));
    const k = at(aka, middle(segment(aka, 'K')));
    expect(k.jawOpen).toBeGreaterThan(vowel.jawOpen * 0.75);
    expect(nearestPose(k).pose).toBe(nearestPose(vowel).pose);
  });

  it('lets the following vowel dominate /h/ in "hello"', () => {
    const hello = speak(['HH', 60], ['EH', 110], ['L', 70], ['OW', 200]);
    const h = segment(hello, 'HH');
    const eh = at(hello, middle(segment(hello, 'EH')));
    const lateH = at(hello, h.endMs - 10);
    expect(describeCoarticulation(hello, middle(h))!.strength).toBeLessThan(0.05);
    expect(lateH.lipWidth).toBeGreaterThan(POSE_ARTICULATION.REST.lipWidth + (eh.lipWidth - POSE_ARTICULATION.REST.lipWidth) * 0.6);
  });

  it('does not render S as a full smile', () => {
    const sea = speak(['S', 90], ['AA', 160]);
    const s = at(sea, middle(segment(sea, 'S')));
    expect(s.lipWidth).toBeLessThan(0.7);
    expect(s.jawOpen).toBeLessThan(0.2);
  });
});

describe('tongue gestures', () => {
  it('shows the dental tongue for TH in "think" and DH in "this"', () => {
    const think = speak(['TH', 80], ['IH', 90], ['NG', 60], ['K', 60]);
    const th = at(think, middle(segment(think, 'TH')));
    expect(th.tongue).toBeGreaterThan(0.95);
    expect(nearestPose(th).pose).toBe('TH');

    const thisWord = speak(['DH', 70], ['IH', 100], ['S', 90]);
    const dh = at(thisWord, middle(segment(thisWord, 'DH')));
    expect(dh.tongue).toBeGreaterThan(0.8);
    expect(dh.jawOpen).toBeLessThan(0.3);
    expect(nearestPose(dh).pose).toBe('TH');
  });

  it('uses the tongue for L without a large unrelated pose ("hello", "mall")', () => {
    const hello = speak(['HH', 60], ['EH', 110], ['L', 70], ['OW', 200]);
    const mall = speak(['M', 70], ['AO', 150], ['L', 120]);
    for (const track of [hello, mall]) {
      const l = at(track, middle(segment(track, 'L')));
      expect(l.tongue).toBeGreaterThan(0.3);
      expect(l.jawOpen).toBeLessThan(0.45);
      expect(l.lipClosure).toBeLessThan(0.2);
      expect(['L', 'SMALL_OPEN', 'TH']).toContain(nearestPose(l).pose);
    }
  });
});

describe('postalveolar (SH/CH)', () => {
  it('gives a recognisable but restrained forward-lip gesture ("shopping", "chair")', () => {
    const shopping = speak(['SH', 90], ['AA', 130], ['P', 70], ['IH', 80], ['NG', 60]);
    const chair = speak(['CH', 90], ['EH', 150], ['R', 90]);
    for (const [track, phoneme] of [[shopping, 'SH'], [chair, 'CH']] as const) {
      const sh = at(track, middle(segment(track, phoneme)));
      expect(sh.lipRound).toBeGreaterThan(0.4);
      expect(sh.lipRound).toBeLessThan(POSE_ARTICULATION.ROUND.lipRound * 0.8);
      expect(sh.jawOpen).toBeLessThan(0.35);
      expect(nearestPose(sh).pose).toBe('SH_CH');
    }
  });
});

describe('stress and vowel reduction', () => {
  it('articulates a stressed vowel more than the same vowel unstressed', () => {
    const stressed = speak(['B', 70], ['AH1', 130], ['T', 70]);
    const unstressed = speak(['B', 70], ['AH0', 130], ['T', 70]);
    const strong = at(stressed, middle(segment(stressed, 'AH')));
    const weak = at(unstressed, middle(segment(unstressed, 'AX')));
    expect(strong.jawOpen).toBeGreaterThan(weak.jawOpen + 0.15);
    expect(weak.jawOpen).toBeLessThan(0.35);
  });

  it('reduces a very short open vowel instead of gaping', () => {
    const brief = speak(['T', 70], ['AA', 50], ['T', 70]);
    expect(at(brief, middle(segment(brief, 'AA'))).jawOpen).toBeLessThan(0.6);
  });
});

describe('transition direction', () => {
  it('closes early into "am" but releases quickly out of "ma"', () => {
    const ma = speak(['M', 80], ['AA', 160]);
    const am = speak(['AA', 160], ['M', 80]);
    const releaseM = segment(ma, 'M');
    const approachM = segment(am, 'M');
    let asymmetry = 0;
    for (let offset = 5; offset <= 40; offset += 5) {
      const afterRelease = at(ma, releaseM.endMs + offset).lipClosure;
      const beforeClosure = at(am, approachM.startMs - offset).lipClosure;
      expect(beforeClosure).toBeGreaterThanOrEqual(afterRelease);
      asymmetry = Math.max(asymmetry, beforeClosure - afterRelease);
    }
    expect(asymmetry).toBeGreaterThan(0.2);
  });
});

describe('track structure', () => {
  it('holds REST at an utterance-edge silence, right up to the first sound', () => {
    const track = speak(['UW', 150]);
    // The Web Speech start wait parks visual time 1ms before the first word.
    expect(at(track, LEAD_MS - 1)).toEqual(POSE_ARTICULATION.REST);
  });

  it('treats a pause at least BARRIER_SILENCE_MS long as a barrier', () => {
    const track = speak(['AA', 150], ['_', BARRIER_SILENCE_MS], ['UW', 150]);
    const pause = track.segments.find((entry, index) => entry.phoneme === 'SIL' && index > 0 && index < track.segments.length - 1)!;
    expect(pause.barrier).toBe(true);
    expect(at(track, pause.endMs - 1)).toEqual(POSE_ARTICULATION.REST);
  });

  it('does not drop to REST across a brief inter-word gap', () => {
    const track = speak(['AA', 150], ['_', 55], ['AA', 150]);
    const gap = track.segments.find((entry, index) => entry.phoneme === 'SIL' && index > 0 && !entry.barrier)!;
    const vowel = at(track, middle(segment(track, 'AA')));
    expect(at(track, middle(gap)).jawOpen).toBeGreaterThan(vowel.jawOpen * 0.7);
  });

  it('resolves a sustained isolated sound to its own target', () => {
    const track = speak(['AA', 400]);
    expect(at(track, middle(segment(track, 'AA'))).jawOpen).toBeCloseTo(0.95, 2);
  });

  it('merges repeated cues and splits diphthongs into nucleus and offglide', () => {
    const track = speak(['P', 40], ['P', 40], ['AY', 200]);
    expect(track.segments.filter((entry) => entry.phoneme === 'P')).toHaveLength(1);
    expect(track.segments.map((entry) => entry.phoneme)).toContain('AY:IH');
    const ay = at(track, middle(segment(track, 'AY')));
    const glide = at(track, middle(segment(track, 'AY:IH')));
    expect(glide.lipWidth).toBeGreaterThan(ay.lipWidth);
    expect(glide.jawOpen).toBeLessThan(ay.jawOpen);
  });

  it('is continuous away from barriers', () => {
    const track = speak(['T', 80], ['UW', 150], ['M', 70], ['AE', 130], ['P', 80], ['F', 70], ['AY', 170], ['V', 70]);
    const speechStart = LEAD_MS;
    const speechEnd = track.durationMs - TRAILING_REST_MS;
    let previous = at(track, speechStart + 1);
    for (let ms = speechStart + 2; ms < speechEnd - 1; ms += 1) {
      const current = at(track, ms);
      for (const key of Object.keys(current) as (keyof Articulation)[]) {
        expect(Math.abs(current[key] - previous[key])).toBeLessThan(0.12);
      }
      previous = current;
    }
  });

  it('returns REST for an empty track or a non-finite time', () => {
    expect(coarticulate(buildArticulationTrack([], 0), 10)).toEqual(POSE_ARTICULATION.REST);
    expect(coarticulate(speak(['AA', 100]), Number.NaN)).toEqual(POSE_ARTICULATION.REST);
  });

  it('is provider-independent: Azure visemes drive the same gestures', () => {
    const viseme = (id: number): SpeechToken => ({ kind: 'viseme', provider: 'azure', id });
    const cues: SpeechCue[] = [
      { startMs: 60, endMs: 130, token: viseme(21) },
      { startMs: 130, endMs: 260, token: viseme(2) },
      { startMs: 260, endMs: 340, token: viseme(21) },
    ];
    const track = buildArticulationTrack(cues, 340 + TRAILING_REST_MS);
    expect(at(track, 95).lipClosure).toBeGreaterThan(0.98);
    expect(at(track, 195).jawOpen).toBeGreaterThan(0.8);
  });
});

describe('describeCoarticulation', () => {
  it('reports the sound, its neighbours and carryover', () => {
    const moon = speak(['M', 70], ['UW', 160], ['N', 70]);
    const uw = segment(moon, 'UW');
    const debug = describeCoarticulation(moon, uw.startMs + 8)!;
    expect(debug.phoneme).toBe('UW');
    expect(debug.previous).toBe('M');
    expect(debug.next).toBe('N');
    expect(debug.phonemeClass).toBe('vowel');
    expect(debug.carryover?.feature).toBe('CLOSE');
  });
});
