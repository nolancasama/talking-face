import { describe, expect, it } from 'vitest';
import { FALLBACK_POSE, R_POSE } from './visemeMap';
import { mapViseme } from './visemeMapper';

describe('mapViseme', () => {
  it('maps Azure viseme ids', () => {
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 21 })).toBe('CLOSED');
    expect(mapViseme({ kind: 'viseme', provider: 'Azure', id: 10 })).toBe('OPEN_ROUND');
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 18 })).toBe('TEETH_LIP');
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 13 })).toBe(R_POSE);
  });

  it('normalises phonemes before looking them up', () => {
    expect(mapViseme({ kind: 'phoneme', symbol: 'iy1' })).toBe('WIDE');
    expect(mapViseme({ kind: 'phoneme', symbol: '  aa2 ' })).toBe('BIG_OPEN');
    expect(mapViseme({ kind: 'phoneme', symbol: ' r ' })).toBe(R_POSE);
  });

  it('maps silence to REST', () => {
    expect(mapViseme({ kind: 'silence' })).toBe('REST');
  });

  it('uses the fallback for unknown tokens', () => {
    expect(mapViseme({ kind: 'phoneme', symbol: '?' })).toBe(FALLBACK_POSE);
    expect(mapViseme({ kind: 'viseme', provider: 'other', id: 21 })).toBe(FALLBACK_POSE);
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 999 })).toBe(FALLBACK_POSE);
  });
});
