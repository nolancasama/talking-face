import { describe, expect, it } from 'vitest';
import { POSE_ARTICULATION, VISUAL_LEAD_MS, poseWeights, smoothArticulation } from './articulation';
import type { Articulation } from './articulation';
import {
  BARRIER_SILENCE_MS,
  MIN_VOWEL_DWELL_MS,
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

// ---------------------------------------------------------------------------
// Perceptual timing: what actually reaches the screen. These simulate the
// player (visual lead + per-frame smoothing at 60fps), because a vowel can be
// correct in the target and still never be visible once rendered.
// ---------------------------------------------------------------------------

const FRAME_MS = 1000 / 60;

interface RenderedFrame {
  /** Visual (track) time of the frame. */
  readonly ms: number;
  readonly articulation: Articulation;
}

function render(track: ArticulationTrack): RenderedFrame[] {
  const frames: RenderedFrame[] = [];
  let current = coarticulate(track, VISUAL_LEAD_MS);
  for (let clock = 0; clock <= track.durationMs; clock += FRAME_MS) {
    const ms = clock + VISUAL_LEAD_MS;
    current = smoothArticulation(current, coarticulate(track, ms), FRAME_MS);
    frames.push({ ms, articulation: current });
  }
  return frames;
}

/** Longest continuous on-screen time for which `holds` is true. */
function longestVisibleMs(frames: readonly RenderedFrame[], holds: (a: Articulation) => boolean): number {
  let best = 0;
  let run = 0;
  for (const frame of frames) {
    run = holds(frame.articulation) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best * FRAME_MS;
}

describe('perceptual timing: rounded vowel in "moved"', () => {
  // Durations as the Web Speech estimator produces them for "moved".
  const moved = speak(['M', 77], ['UW1', 130], ['V', 77], ['D', 77]);

  it('keeps strong rounding on screen long enough to register', () => {
    expect(longestVisibleMs(render(moved), (a) => a.lipRound >= 0.7 && a.lipClosure < 0.3)).toBeGreaterThanOrEqual(80);
  });

  it('does not let the M closure start the vowel from zero rounding', () => {
    const m = segment(moved, 'M');
    expect(at(moved, middle(m)).lipRound).toBeGreaterThan(0.15);
    expect(at(moved, middle(m)).lipClosure).toBeGreaterThan(0.98);
  });
});

describe('perceptual timing: final OH in "hello"', () => {
  const hello = speak(['HH', 61], ['EH', 104], ['L', 53], ['OW', 150]);

  it('shows the OH shape clearly before REST', () => {
    const frames = render(hello);
    const restStarts = segment(hello, 'SIL', 1).startMs;
    const beforeRest = frames.filter((frame) => frame.ms < restStarts);
    expect(longestVisibleMs(beforeRest, (a) => a.lipRound >= 0.6 && a.jawOpen >= 0.35)).toBeGreaterThanOrEqual(60);
  });

  it('leaves L as it was: tongue up, no big pose', () => {
    const l = at(hello, middle(segment(hello, 'L')));
    expect(l.tongue).toBeGreaterThan(0.3);
    expect(l.jawOpen).toBeLessThan(0.45);
  });
});

describe('phrase-final protection', () => {
  const cases = [
    ['go.', speak(['G', 53], ['OW', 129])],
    ['blue.', speak(['B', 78], ['L', 78], ['UW1', 132])],
    ['hello.', speak(['HH', 61], ['EH', 104], ['L', 53], ['OW', 150])],
  ] as const;

  it.each(cases)('REST does not pull on the end of the final vowel in %s', (_name, track) => {
    const pause = track.segments.at(-1)!;
    const lastSound = track.segments.at(-2)!;
    const settled = at(track, middle(lastSound));
    const tail = at(track, lastSound.endMs - 1);
    expect(tail.lipRound).toBeGreaterThan(settled.lipRound * 0.85);
    expect(tail.jawOpen).toBeGreaterThan(settled.jawOpen * 0.85);
    // ...then relaxes continuously inside the pause rather than snapping.
    const intoPause = at(track, pause.startMs + 1);
    expect(Math.abs(intoPause.lipRound - tail.lipRound)).toBeLessThan(0.05);
    expect(at(track, pause.endMs - 1)).toEqual(POSE_ARTICULATION.REST);
  });

  it('gives a short phrase-final vowel extra visible time, partly from the pause', () => {
    const track = speak(['T', 80], ['IY1', 70]);
    const iy = segment(track, 'IY');
    expect(iy.phraseFinal).toBe(true);
    expect(iy.endMs - iy.startMs).toBeGreaterThanOrEqual(MIN_VOWEL_DWELL_MS.stressed + MIN_VOWEL_DWELL_MS.phraseFinalBonus - 1);
    expect(track.durationMs).toBe(LEAD_MS + 80 + 70 + TRAILING_REST_MS);
  });
});

describe('minimum vowel dwell', () => {
  it('borrows time from neighbouring consonants without changing total duration', () => {
    const track = speak(['T', 80], ['IY1', 60], ['T', 80]);
    const iy = segment(track, 'IY');
    expect(iy.sourceMs).toBe(60);
    expect(iy.endMs - iy.startMs).toBeGreaterThanOrEqual(MIN_VOWEL_DWELL_MS.stressed - 1);
    for (const t of track.segments.filter((entry) => entry.phoneme === 'T')) {
      expect(t.endMs - t.startMs).toBeGreaterThanOrEqual(45);
    }
    expect(track.segments.at(-1)!.endMs).toBe(LEAD_MS + 220 + TRAILING_REST_MS);
  });

  it('makes a vowel visible for longer, never bigger', () => {
    const brief = speak(['T', 80], ['AA', 50], ['T', 80]);
    const aa = segment(brief, 'AA');
    expect(aa.dwellMs).toBeGreaterThan(0);
    expect(aa.target.jawOpen).toBeLessThan(0.6);
  });

  it('leaves reduced vowels fleeting', () => {
    const track = speak(['B', 70], ['AH0', 50], ['T', 70]);
    expect(segment(track, 'AX').dwellMs).toBe(0);
  });
});

describe('diphthong timing', () => {
  it('gives the nucleus more time than the glide, and the glide undershoots', () => {
    const track = speak(['G', 60], ['OW', 150], ['T', 70]);
    const nucleus = segment(track, 'OW');
    const glide = segment(track, 'OW:UW');
    expect(nucleus.endMs - nucleus.startMs).toBeGreaterThan(glide.endMs - glide.startMs);
    // Traverses two visibly different states: open-round, then closer and rounder.
    const open = at(track, middle(nucleus));
    const closing = at(track, middle(glide));
    expect(open.jawOpen).toBeGreaterThan(closing.jawOpen + 0.1);
    expect(closing.lipRound).toBeGreaterThan(open.lipRound);
    expect(glide.target.lipRound).toBeLessThan(POSE_ARTICULATION.ROUND.lipRound);
  });

  it('keeps a short diphthong as one clear movement instead of two invisible ones', () => {
    const track = speak(['T', 45], ['OW', 80], ['T', 45]);
    expect(track.segments.map((entry) => entry.phoneme)).not.toContain('OW:UW');
    const ow = segment(track, 'OW');
    expect(ow.part).toBe('whole');
    // An 80ms OW is a reduced gesture by design, but still one rounded shape.
    expect(ow.target.lipRound).toBeGreaterThan(0.5);
    expect(['OPEN_ROUND', 'ROUND', 'SH_CH']).toContain(nearestPose(ow.target).pose);
  });

  it('lets a short "go" actually open into the OH shape on screen', () => {
    const go = speak(['G', 53], ['OW', 129]);
    const frames = render(go);
    expect(Math.max(...frames.map((frame) => frame.articulation.jawOpen))).toBeGreaterThan(0.35);
    expect(Math.max(...frames.map((frame) => frame.articulation.lipRound))).toBeGreaterThan(0.65);
  });
});

describe('TH timing', () => {
  it('shows the tongue in "think", then hands over to the vowel promptly', () => {
    const think = speak(['TH', 77], ['IH', 130], ['NG', 77], ['K', 77]);
    const th = segment(think, 'TH');
    const frames = render(think);
    expect(longestVisibleMs(frames, (a) => a.tongue >= 0.8)).toBeGreaterThanOrEqual(40);
    // Tongue gone and the vowel's spread established within ~2 frames of TH ending.
    const after = frames.find((frame) => frame.ms >= th.endMs + 35)!;
    expect(after.articulation.tongue).toBeLessThan(0.3);
    expect(after.articulation.lipWidth).toBeGreaterThan(0.55);
    // The velar ending stays weak.
    const k = segment(think, 'K');
    for (const frame of frames.filter((entry) => entry.ms >= k.startMs && entry.ms < k.endMs)) {
      expect(frame.articulation.jawOpen).toBeLessThan(0.35);
    }
  });

  it('does not let voiced TH in "this" overstay', () => {
    const thisWord = speak(['DH', 78], ['IH1', 132], ['S', 78]);
    const dh = segment(thisWord, 'DH');
    const frames = render(thisWord);
    expect(longestVisibleMs(frames, (a) => a.tongue >= 0.7)).toBeGreaterThanOrEqual(30);
    // At most the sound itself plus two frames of ramp (frames are 16.7ms).
    expect(longestVisibleMs(frames, (a) => a.tongue >= 0.3)).toBeLessThanOrEqual(dh.endMs - dh.startMs + 2 * FRAME_MS);
  });
});

describe('preserved behaviour', () => {
  it('still starts rounding early across "Too blue."', () => {
    const tooBlue = speak(['T', 80], ['UW', 136], ['_', 55], ['B', 78], ['L', 78], ['UW1', 132]);
    const l = segment(tooBlue, 'L');
    expect(at(tooBlue, l.endMs - 10).lipRound).toBeGreaterThan(0.5);
    expect(at(tooBlue, segment(tooBlue, 'T').endMs - 10).lipRound).toBeGreaterThan(0.25);
  });
});
