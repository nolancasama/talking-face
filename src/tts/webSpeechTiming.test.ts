import { describe, expect, it } from 'vitest';
import { VISUAL_LEAD_MS } from '../core/articulation';
import { buildTimeline, mouthAt } from '../core/timeline';
import { estimate } from './webspeech';
import {
  HARD_HOLD_MAX_MS,
  SOFT_HOLD_MAX_MS,
  START_FALLBACK_MS,
  START_REST_MS,
  WebSpeechTimingClock,
  classifyGap,
} from './webSpeechTiming';
import type { WordTiming } from './webSpeechTiming';

/** A clock over the real estimator, driven by a fake wall clock. */
function harness(text: string) {
  const result = estimate(text, 1);
  let wallMs = 1000;
  const clock = new WebSpeechTimingClock(result.words, result.durationMs, () => wallMs);
  const word = (name: string): WordTiming => {
    const found = result.words.find((candidate) => candidate.text === name);
    if (!found) throw new Error(`no word ${name}`);
    return found;
  };
  return {
    result,
    clock,
    word,
    advance: (ms: number) => { wallMs += ms; },
    /** Fire the boundary for a word, as the browser would. */
    say: (name: string) => clock.boundary(word(name).charIndex, 'word'),
    timeline: buildTimeline(result.cues, result.durationMs),
  };
}

/** Speak words at the estimate's own pace (paceScale 1) up to and including `last`. */
function speakThrough(h: ReturnType<typeof harness>, names: string[]): void {
  h.clock.start();
  h.clock.speechStarted();
  names.forEach((name, index) => {
    if (index > 0) h.advance(h.word(name).startMs - h.word(names[index - 1]!).startMs);
    h.say(name);
  });
}

describe.each([
  ['period', 'Hello there. How are you?', ['Hello', 'there'], 'How', '.'],
  ['question mark', 'Are you okay? Yes.', ['Are', 'you', 'okay'], 'Yes', '?'],
  ['exclamation mark', 'Stop! Come back.', ['Stop'], 'Come', '!'],
])('hard barrier: %s', (_label, text, before, after, punctuation) => {
  it('holds at REST during a real pause and never advances into the next sentence', () => {
    const h = harness(text);
    speakThrough(h, before);
    const next = h.word(after);

    // Far longer than the remaining estimate, still short of the safety release.
    let heldFrames = 0;
    for (let waited = 0; waited < 1500; waited += 20) {
      h.advance(20);
      const position = h.clock.positionMs();
      expect(position + VISUAL_LEAD_MS).toBeLessThan(next.startMs);
      if (h.clock.debugState().phase === 'hold') {
        heldFrames += 1;
        expect(mouthAt(h.timeline, position + VISUAL_LEAD_MS)).toBe('REST');
      }
    }
    expect(heldFrames).toBeGreaterThan(40);
    const state = h.clock.debugState();
    expect(state.phase).toBe('hold');
    expect(state.hold).toMatchObject({ barrier: 'hard', punctuation, nextWord: after });
  });

  it('known-bad control: without holds the same pause runs into the next sentence', () => {
    const h = harness(text);
    const unheld = new WebSpeechTimingClock(h.result.words, h.result.durationMs, () => wall);
    unheld.parkMs = () => null;
    let wall = 0;
    unheld.start();
    before.forEach((name, index) => {
      if (index > 0) wall += h.word(name).startMs - h.word(before[index - 1]!).startMs;
      unheld.boundary(h.word(name).charIndex, 'word');
    });
    wall += 1500;
    expect(unheld.positionMs() + VISUAL_LEAD_MS).toBeGreaterThan(h.word(after).startMs);
  });

  it('releases on the next boundary, anchored at that word\'s own start', () => {
    const h = harness(text);
    speakThrough(h, before);
    h.advance(900);
    h.say(after);
    expect(h.clock.positionMs()).toBe(h.word(after).startMs);
    expect(h.clock.debugState().phase).toBe('word');
  });
});

describe('soft barrier', () => {
  it('classifies commas as soft and never holds indefinitely', () => {
    const h = harness('Well, maybe.');
    expect(h.word('Well')).toMatchObject({ barrier: 'soft', punctuation: ',' });
    speakThrough(h, ['Well']);
    const park = h.clock.parkMs(0)!;

    h.advance((park - h.word('Well').startMs) + 100);
    expect(h.clock.debugState().hold?.barrier).toBe('soft');
    expect(h.clock.positionMs()).toBe(park);

    h.advance(SOFT_HOLD_MAX_MS);
    expect(h.clock.debugState().phase).toBe('word');
    expect(h.clock.positionMs()).toBeGreaterThan(park);
  });

  it('still leaves a REST slot in the timeline at the comma', () => {
    const h = harness('Well, maybe.');
    expect(mouthAt(h.timeline, h.clock.parkMs(0)! + VISUAL_LEAD_MS)).toBe('REST');
  });
});

describe('hard barrier safety release', () => {
  it('resumes estimating if the next boundary is dropped', () => {
    const h = harness('Hello there. How are you?');
    speakThrough(h, ['Hello', 'there']);
    const park = h.clock.parkMs(1)!;
    h.advance(park - h.word('there').startMs + HARD_HOLD_MAX_MS + 100);
    expect(h.clock.positionMs()).toBeCloseTo(park + 100, 6);
  });

  it('does not hold when the engine has sent no boundaries at all', () => {
    const h = harness('Hello there. How are you?');
    h.clock.start();
    h.clock.speechStarted();
    h.advance(h.word('How').startMs + 10);
    expect(h.clock.positionMs()).toBeCloseTo(h.word('How').startMs + 10, 6);
  });
});

describe('pace learning', () => {
  it('ignores sentence silence when learning speaking rate', () => {
    const text = 'the cat sat on the mat. then the dog ran to the park';
    const h = harness(text);
    const truePace = 0.8; // the voice is slower than the estimate
    h.clock.start();
    const words = h.result.words;
    words.forEach((word, index) => {
      if (index > 0) {
        const previous = words[index - 1]!;
        const spoken = (word.startMs - previous.startMs) / truePace;
        h.advance(previous.barrier === 'hard' ? spoken + 700 : spoken);
      }
      h.clock.boundary(word.charIndex, 'word');
    });
    const state = h.clock.debugState();
    expect(state.paceScale).toBeCloseTo(truePace, 6);
    // One sample per in-phrase pair; the pair spanning the period is excluded.
    expect(state.paceSamples).toBe(words.length - 2);
  });

  it('is not replaced wholesale by a single noisy interval', () => {
    const h = harness('one two three four five');
    speakThrough(h, ['one', 'two', 'three', 'four']);
    expect(h.clock.debugState().paceScale).toBeCloseTo(1, 6);
    const estimatedDelta = h.word('five').startMs - h.word('four').startMs;
    h.advance(estimatedDelta * 3); // one word spoken three times slower
    h.say('five');
    const pace = h.clock.debugState().paceScale;
    expect(pace).toBeLessThan(1);
    expect(pace).toBeGreaterThan(0.6);
  });

  it('does not learn across a pause/resume', () => {
    const h = harness('one two three');
    speakThrough(h, ['one']);
    h.clock.pause();
    h.advance(5000);
    h.clock.resume();
    h.advance(h.word('two').startMs - h.word('one').startMs);
    h.say('two');
    expect(h.clock.debugState().paceSamples).toBe(0);
  });
});

describe('re-anchoring', () => {
  it('starts the first word after a pause from its own anchor, not the free-run position', () => {
    const h = harness('One. Two. Three.');
    speakThrough(h, ['One']);
    h.advance(2 * HARD_HOLD_MAX_MS); // way past the free-running estimate
    h.say('Two');
    expect(h.clock.positionMs()).toBe(h.word('Two').startMs);
    h.advance(20);
    expect(h.clock.positionMs()).toBeCloseTo(h.word('Two').startMs + 20, 6);
  });

  it('ignores duplicate and out-of-order boundaries', () => {
    const h = harness('alpha beta gamma');
    speakThrough(h, ['alpha', 'beta']);
    h.advance(30);
    h.clock.boundary(h.word('beta').charIndex, 'sentence');
    h.say('alpha');
    expect(h.clock.positionMs()).toBeCloseTo(h.word('beta').startMs + 30, 6);
  });

  it('maps a charIndex on the punctuation before a word to that following word', () => {
    const h = harness('Are you okay? Yes.');
    speakThrough(h, ['Are', 'you', 'okay']);
    h.advance(500);
    h.clock.boundary('Are you okay?'.length, 'word'); // points at the space
    expect(h.clock.positionMs()).toBe(h.word('Yes').startMs);
  });
});

describe('text without punctuation', () => {
  it('keeps the original estimate and the plain re-anchor/free-run clock', () => {
    const h = harness('hello how are you');
    expect(h.result.words.every((word) => word.barrier === 'none')).toBe(true);
    // Original layout (72ms per character, 55ms between words) after the start REST.
    expect(h.result.words.map((word) => word.startMs - START_REST_MS)).toEqual([0, 415, 686, 957]);
    speakThrough(h, ['hello', 'how']);
    h.advance(10_000);
    expect(h.clock.debugState().hold).toBeNull();
    expect(h.clock.positionMs()).toBe(h.result.durationMs);
  });
});

describe('classifyGap', () => {
  it.each([
    ['. ', 'hard', '.'], ['? ', 'hard', '?'], ['! ', 'hard', '!'], ['." ', 'hard', '.'],
    [', ', 'soft', ','], ['; ', 'soft', ';'], [': ', 'soft', ':'], [' — ', 'soft', '—'], [' - ', 'soft', '-'],
    [' ', 'none', ''], ['-', 'none', ''],
  ])('%j → %s', (between, barrier, punctuation) => {
    expect(classifyGap(between, 'word', 'next')).toEqual({ barrier, punctuation });
  });

  it('does not treat decimal points or thousands separators as breaks', () => {
    expect(classifyGap('.', '3', '5').barrier).toBe('none');
    expect(classifyGap(',', '1', '000').barrier).toBe('none');
  });
});

describe('utterance startup', () => {
  it('does not move before the engine starts speaking, and renders REST there', () => {
    const h = harness('Hello.'); // fake wall clock starts at 1000
    h.clock.start();
    h.advance(500);
    expect(h.clock.positionMs()).toBe(0);
    expect(h.clock.debugState()).toMatchObject({ phase: 'waiting', startedVia: null, sinceRequestMs: 500 });
    expect(mouthAt(h.timeline, h.clock.positionMs() + VISUAL_LEAD_MS)).toBe('REST');
  });

  it('known-bad control: the waiting position would show a mouth shape without the start REST', () => {
    const h = harness('Hello.');
    const unshifted = h.result.cues.map((cue) => ({
      ...cue, startMs: cue.startMs - START_REST_MS, endMs: cue.endMs - START_REST_MS,
    }));
    expect(mouthAt(buildTimeline(unshifted, h.result.durationMs), VISUAL_LEAD_MS)).not.toBe('REST');
  });

  it('starts from the onstart epoch, not from speak()', () => {
    const h = harness('Hello there friend');
    h.clock.start();
    h.advance(500);
    h.clock.speechStarted();
    h.advance(100);
    expect(h.clock.positionMs()).toBeCloseTo(100, 6);
    expect(h.clock.debugState()).toMatchObject({ phase: 'estimating', startedVia: 'onstart', startLatencyMs: 500 });
  });

  it('re-anchors on the first boundary after start', () => {
    const h = harness('Hello there friend');
    h.clock.start();
    h.advance(300);
    h.clock.speechStarted();
    h.advance(8);
    h.say('Hello');
    expect(h.clock.positionMs()).toBe(h.word('Hello').startMs);
    expect(h.clock.debugState().phase).toBe('word');
  });

  it('keeps estimating after start on a voice that sends no boundaries', () => {
    const h = harness('Hello there friend');
    h.clock.start();
    h.advance(400);
    h.clock.speechStarted();
    h.advance(800);
    expect(h.clock.positionMs()).toBeCloseTo(800, 6);
  });

  it('keeps punctuation holds after a delayed start', () => {
    const h = harness('One. Two.');
    h.clock.start();
    h.advance(350);
    h.clock.speechStarted();
    h.say('One');
    h.advance(1500);
    expect(h.clock.positionMs()).toBe(h.clock.parkMs(0));
    expect(h.clock.debugState().hold?.punctuation).toBe('.');
    h.say('Two');
    expect(h.clock.positionMs()).toBe(h.word('Two').startMs);
  });

  it('keeps pace learning after a delayed start', () => {
    const h = harness('one two three four five');
    h.clock.start();
    h.advance(600);
    h.clock.speechStarted();
    h.result.words.forEach((word, index) => {
      if (index > 0) h.advance((word.startMs - h.result.words[index - 1]!.startMs) / 0.8);
      h.clock.boundary(word.charIndex, 'word');
    });
    expect(h.clock.debugState().paceScale).toBeCloseTo(0.8, 6);
  });

  it('cancel before start stays at 0 and returns to idle', () => {
    const h = harness('Hello.');
    h.clock.start();
    h.advance(500);
    h.clock.stop();
    expect(h.clock.positionMs()).toBe(0);
    h.advance(START_FALLBACK_MS * 2);
    expect(h.clock.positionMs()).toBe(0);
    expect(h.clock.debugState().phase).toBe('idle');
  });

  it('an end before start lands on the trailing REST', () => {
    const h = harness('Hello.');
    h.clock.start();
    h.clock.finish();
    expect(mouthAt(h.timeline, h.clock.positionMs() + VISUAL_LEAD_MS)).toBe('REST');
  });

  it('pause/resume after start is unchanged', () => {
    const h = harness('Hello there friend');
    h.clock.start();
    h.clock.speechStarted();
    h.advance(100);
    h.clock.pause();
    h.advance(5000);
    expect(h.clock.positionMs()).toBeCloseTo(100, 6);
    h.clock.resume();
    h.advance(50);
    expect(h.clock.positionMs()).toBeCloseTo(150, 6);
  });

  it('pausing before start does not establish the epoch or run the fallback timer', () => {
    const h = harness('Hello there friend');
    h.clock.start();
    h.advance(200);
    h.clock.pause();
    h.advance(START_FALLBACK_MS * 2);
    expect(h.clock.positionMs()).toBe(0);
    expect(h.clock.debugState().phase).toBe('paused');
    h.clock.resume();
    h.advance(START_FALLBACK_MS - 100);
    expect(h.clock.debugState().phase).toBe('waiting');
    h.clock.speechStarted();
    h.advance(40);
    expect(h.clock.positionMs()).toBeCloseTo(40, 6);
  });

  it('a boundary before onstart starts the clock once and a late onstart cannot move it back', () => {
    const h = harness('Hello there friend');
    h.clock.start();
    h.advance(250);
    h.say('Hello');
    expect(h.clock.debugState().startedVia).toBe('boundary');
    h.advance(10);
    h.clock.speechStarted();
    expect(h.clock.positionMs()).toBeCloseTo(h.word('Hello').startMs + 10, 6);
  });

  it('falls back conservatively when onstart never arrives, and a late onstart corrects it', () => {
    const h = harness('Hello there friend');
    h.clock.start();
    h.advance(START_FALLBACK_MS - 1);
    expect(h.clock.positionMs()).toBe(0);
    h.advance(101);
    expect(h.clock.positionMs()).toBeCloseTo(100, 6);
    expect(h.clock.debugState().startedVia).toBe('fallback');
    h.clock.speechStarted();
    expect(h.clock.positionMs()).toBe(0);
    expect(h.clock.debugState().startedVia).toBe('onstart');
  });
});
