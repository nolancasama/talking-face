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
  ])('maps %s to supported ARPAbet groups', (word, expected) => {
    expect(phonemeGroups(word)).toEqual(expected);
  });

  it('weights stressed vowels as vowels', () => {
    const result = estimate('you', 1);
    const [consonant, vowel] = result.cues;
    expect((vowel?.endMs ?? 0) - (vowel?.startMs ?? 0))
      .toBeGreaterThan((consonant?.endMs ?? 0) - (consonant?.startMs ?? 0));
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
