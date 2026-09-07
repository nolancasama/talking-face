import { describe, expect, it } from 'vitest';
import { FALLBACK_MOUTH } from './visemeMap';
import { mapViseme } from './visemeMapper';

describe('mapViseme', () => {
  it('maps Azure viseme ids', () => {
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 21 })).toBe('CLOSED');
    expect(mapViseme({ kind: 'viseme', provider: 'Azure', id: 10 })).toBe('ROUND');
  });

  it('normalises phonemes before looking them up', () => {
    expect(mapViseme({ kind: 'phoneme', symbol: 'iy1' })).toBe('WIDE');
    expect(mapViseme({ kind: 'phoneme', symbol: '  aa2 ' })).toBe('OPEN');
  });

  it('maps silence to REST', () => {
    expect(mapViseme({ kind: 'silence' })).toBe('REST');
  });

  it('uses the fallback for unknown tokens', () => {
    expect(mapViseme({ kind: 'phoneme', symbol: '?' })).toBe(FALLBACK_MOUTH);
    expect(mapViseme({ kind: 'viseme', provider: 'other', id: 21 })).toBe(FALLBACK_MOUTH);
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 999 })).toBe(FALLBACK_MOUTH);
  });
});
