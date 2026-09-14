import { describe, expect, it } from 'vitest';
import { TRAILING_REST_MS } from '../core/visemeMap';
import { estimate, phonemeGroups } from './webspeech';

describe('Web Speech phoneme estimation', () => {
  it.each([
    ['five', ['F', 'AY', 'V']],
    ['name', ['N', 'EY', 'M']],
    ['shopping', ['SH', 'AA', 'P', 'IH', 'NG']],
    ['mall', ['M', 'AO', 'L']],
    ['too', ['T', 'UW']],
    ['moon', ['M', 'UW', 'N']],
    ['see', ['S', 'IY']],
    ['you', ['Y', 'UW1']],
    ['night', ['N', 'AY', 'T']],
    ['funny', ['F', 'AH', 'N', 'IY']],
    ['think', ['TH', 'IH', 'NG', 'K']],
    ['chair', ['CH', 'EY', 'R']],
    ['the', ['DH', 'AH0']],
    // A silent-e stem plus inflection keeps its long vowel ("moved" was M AA V EH D).
    ['moved', ['M', 'UW1', 'V', 'D']],
    ['liked', ['L', 'AY', 'K', 'D']],
    ['names', ['N', 'EY', 'M', 'Z']],
    // ...but a pronounced -ed/-es is left alone.
    ['wanted', ['W', 'AE', 'N', 'T', 'EH', 'D']],
    // Open final O is OH, not AA ("hello" and "go" had no OH at all).
    ['hello', ['HH', 'EH', 'L', 'OW']],
    ['go', ['G', 'OW']],
  ])('maps %s to supported ARPAbet groups', (word, expected) => {
    expect(phonemeGroups(word)).toEqual(expected);
  });

  it('weights stressed vowels as vowels', () => {
    const result = estimate('you', 1);
    const [consonant, vowel] = result.cues;
    expect((vowel?.endMs ?? 0) - (vowel?.startMs ?? 0))
      .toBeGreaterThan((consonant?.endMs ?? 0) - (consonant?.startMs ?? 0));
  });

  it('gives a stressed diphthong more time than a reduced vowel in the same word', () => {
    const result = estimate('about', 1);
    const length = (symbol: string): number => {
      const cue = result.cues.find((entry) => entry.token.kind === 'phoneme' && entry.token.symbol === symbol)!;
      return cue.endMs - cue.startMs;
    };
    expect(length('AW1')).toBeGreaterThan(length('AH0') * 1.6);
  });

  it('does not undersize short words that carry a full vowel', () => {
    const go = estimate('go', 1).words[0]!;
    const a = estimate('a', 1).words[0]!;
    expect(go.endMs - go.startMs).toBeGreaterThanOrEqual(180);
    expect(a.endMs - a.startMs).toBeLessThan(100);
  });
});

describe('Web Speech trailing rest', () => {
  it('appends rest after the final word without moving its cue', () => {
    const result = estimate('map', 1);
    const lastWord = result.words.at(-1)!;
    const lastCue = result.cues.at(-1)!;

    expect(result.durationMs).toBe(lastWord.endMs + TRAILING_REST_MS);
    expect(lastCue.endMs).toBe(lastWord.endMs);
  });
});
