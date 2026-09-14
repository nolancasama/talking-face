import { describe, expect, it } from 'vitest';
import { mapViseme, phonemeForToken } from './visemeMapper';

describe('mapViseme', () => {
  it('maps Azure viseme ids', () => {
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 21 })).toBe('CLOSED');
    expect(mapViseme({ kind: 'viseme', provider: 'Azure', id: 10 })).toBe('OPEN_ROUND');
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 18 })).toBe('TEETH_LIP');
    // R's modest rounding stays nearer a neutral open mouth than the SH_CH face.
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 13 })).toBe('SMALL_OPEN');
  });

  it('normalises phonemes before looking them up', () => {
    expect(mapViseme({ kind: 'phoneme', symbol: 'iy1' })).toBe('WIDE');
    expect(mapViseme({ kind: 'phoneme', symbol: '  aa2 ' })).toBe('BIG_OPEN');
    expect(mapViseme({ kind: 'phoneme', symbol: ' r ' })).toBe('SMALL_OPEN');
  });

  it('maps silence to REST', () => {
    expect(mapViseme({ kind: 'silence' })).toBe('REST');
  });

  it('uses the low-strength neutral fallback for unknown tokens', () => {
    expect(mapViseme({ kind: 'phoneme', symbol: '?' })).toBe('SMALL_OPEN');
    expect(mapViseme({ kind: 'viseme', provider: 'other', id: 21 })).toBe('SMALL_OPEN');
    expect(mapViseme({ kind: 'viseme', provider: 'azure', id: 999 })).toBe('SMALL_OPEN');
  });
});

describe('phonemeForToken', () => {
  it('keeps ARPAbet stress and treats unstressed AH as schwa', () => {
    expect(phonemeForToken({ kind: 'phoneme', symbol: 'ah1' })).toEqual({ symbol: 'AH', stress: 1 });
    expect(phonemeForToken({ kind: 'phoneme', symbol: 'AH0' })).toEqual({ symbol: 'AX', stress: 0 });
    expect(phonemeForToken({ kind: 'phoneme', symbol: 'K' })).toEqual({ symbol: 'K', stress: null });
  });

  it('normalises Azure visemes and silence aliases to phonemes', () => {
    expect(phonemeForToken({ kind: 'viseme', provider: 'azure', id: 21 }).symbol).toBe('P');
    expect(phonemeForToken({ kind: 'viseme', provider: 'azure', id: 0 }).symbol).toBe('SIL');
    expect(phonemeForToken({ kind: 'phoneme', symbol: 'sp' }).symbol).toBe('SIL');
  });
});
