import type {
  ExternalPlayback,
  PlaybackTimingDebug,
  SpeechCue,
  SpeechResult,
  TTSProvider,
  Voice,
} from '../core/types';
import { TRAILING_REST_MS } from '../core/visemeMap';
import { START_REST_MS, WebSpeechTimingClock, barrierGapMs, classifyGap } from './webSpeechTiming';
import type { WordTiming } from './webSpeechTiming';

const LABELS = ['Female 1', 'Female 2', 'Male 1', 'Male 2'] as const;
const BASE_CHARACTER_MS = 72;

function browserVoices(): SpeechSynthesisVoice[] {
  return typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices();
}

function selectedVoices(): SpeechSynthesisVoice[] {
  const voices = browserVoices();
  const english = voices.filter((voice) => /^en(?:-|_)/i.test(voice.lang));
  return (english.length > 0 ? english : voices).slice(0, LABELS.length);
}

function friendlyVoices(): Voice[] {
  return selectedVoices().map((voice, index) => ({
    id: voice.voiceURI,
    label: LABELS[index] ?? `Voice ${index + 1}`,
  }));
}

/** Groups whose ARPAbet symbol names a vowel sound, i.e. one this estimator
 *  can actually put a WIDE/ROUND/OPEN vowel shape on (as opposed to the OPEN
 *  fallback that most unshaped consonants share). Real speech holds vowels
 *  and passes quickly through consonants; `estimate()` uses this set to give
 *  vowel groups a proportionally longer slice of the word's duration, so the
 *  states that are not OPEN survive long enough to actually be seen. */
const VOWEL_GROUPS = new Set([
  'AA', 'AE', 'AH', 'AX', 'EH', 'ER', 'IH', 'IY', 'UH', 'UW', 'AO', 'AY', 'AW', 'EY', 'OW', 'OY',
]);

const EXCEPTION_PHONEMES: Readonly<Record<string, readonly string[]>> = {
  a: ['AH0'], the: ['DH', 'AH0'], to: ['T', 'UW0'], of: ['AH0', 'V'], is: ['IH0', 'Z'],
  was: ['W', 'AH0', 'Z'], are: ['AA0', 'R'], you: ['Y', 'UW1'], your: ['Y', 'AO1', 'R'],
  do: ['D', 'UW1'], one: ['W', 'AH1', 'N'], come: ['K', 'AH1', 'M'], some: ['S', 'AH1', 'M'],
  have: ['HH', 'AE1', 'V'], said: ['S', 'EH1', 'D'], this: ['DH', 'IH1', 'S'],
  that: ['DH', 'AE1', 'T'], they: ['DH', 'EY1'], them: ['DH', 'EH1', 'M'],
  there: ['DH', 'EH1', 'R'], then: ['DH', 'EH1', 'N'], these: ['DH', 'IY1', 'Z'],
  those: ['DH', 'OW1', 'Z'], with: ['W', 'IH1', 'TH'], what: ['W', 'AH1', 'T'],
  many: ['M', 'EH1', 'N', 'IY0'], very: ['V', 'EH1', 'R', 'IY0'], good: ['G', 'UH1', 'D'],
  mom: ['M', 'AA1', 'M'], me: ['M', 'IY1'], we: ['W', 'IY1'], he: ['HH', 'IY1'],
  she: ['SH', 'IY1'], be: ['B', 'IY1'], my: ['M', 'AY1'], i: ['AY1'],
  going: ['G', 'OW1', 'IH0', 'NG'], about: ['AH0', 'B', 'AW1', 'T'],
  blue: ['B', 'L', 'UW1'], shoes: ['SH', 'UW1', 'Z'], apple: ['AE1', 'P', 'AH0', 'L'],
  balloons: ['B', 'AH0', 'L', 'UW1', 'N', 'Z'], can: ['K', 'AE1', 'N'],
  and: ['AE0', 'N', 'D'], for: ['F', 'AO0', 'R'], or: ['AO0', 'R'],
  // O as /u/: the magic-e rule would say OW.
  move: ['M', 'UW1', 'V'], prove: ['P', 'R', 'UW1', 'V'], lose: ['L', 'UW1', 'Z'],
  who: ['HH', 'UW1'], two: ['T', 'UW1'],
  // Short O despite the open-first-syllable rule; also keeps "nobody" right.
  body: ['B', 'AA1', 'D', 'IY0'],
};

/**
 * O in an open first syllable -- one consonant, then a vowel -- is long:
 * "No-lan", "o-pen", "o-ver", "no-body", "ro-bot". It came out as AA, so the
 * stressed OH in "Nolan" was never generated at all. Limited to the first
 * syllable and to O (later syllables and other vowels have far more short
 * exceptions); R/W/X/Y are excluded because they form their own patterns.
 * Known misses such as "copy" or "model" read OW for AA: both open the jaw.
 */
function isOpenFirstSyllableO(upper: string, index: number): boolean {
  if (/[AEIOU]/.test(upper.slice(0, index))) return false;
  const consonant = upper[index + 1] ?? '';
  const vowel = upper[index + 2] ?? '';
  return consonant !== '' && !VOWEL_LETTERS.has(consonant) && !/[RWX]/.test(consonant) && /[AEIOU]/.test(vowel);
}

/**
 * "moved", "liked", "names": a silent-e stem plus an inflection. Resolving the
 * stem first keeps its long vowel (and any lexicon entry) instead of reading
 * the E as a vowel. Stems ending in T/D/S/X/Z/CH/SH are left alone: there the
 * E is actually pronounced ("wanted", "boxes").
 */
function silentEStem(lower: string): { stem: string; ending: string } | null {
  const match = lower.match(/^(.*[aeiou][^aeiouy])e([ds])$/);
  if (!match || /(?:[tdsxz]|ch|sh)$/.test(match[1]!)) return null;
  return { stem: `${match[1]!}e`, ending: match[2] === 'd' ? 'D' : 'Z' };
}

const VOWEL_LETTERS = new Set(['A', 'E', 'I', 'O', 'U', 'Y']);
const SINGLE_VOWELS: Readonly<Record<string, string>> = {
  A: 'AE', E: 'EH', I: 'IH', O: 'AA', U: 'AH',
};
const LONG_VOWELS: Readonly<Record<string, string>> = {
  A: 'EY', E: 'IY', I: 'AY', O: 'OW', U: 'UW',
};
const VOWEL_PATTERNS: Readonly<Record<string, readonly string[]>> = {
  EE: ['IY'], EA: ['IY'], AI: ['EY'], AY: ['EY'], OA: ['OW'], OO: ['UW'],
  EW: ['UW'], UE: ['UW'], OI: ['OY'], OY: ['OY'], OU: ['AW'], OW: ['OW'],
  ER: ['ER'], IR: ['ER'], UR: ['ER'], AR: ['AA', 'R'], OR: ['AO', 'R'],
};
const CONSONANTS: Readonly<Record<string, readonly string[]>> = {
  B: ['B'], D: ['D'], F: ['F'], G: ['G'], H: ['HH'], J: ['JH'], K: ['K'], L: ['L'],
  M: ['M'], N: ['N'], P: ['P'], Q: ['K'], R: ['R'], S: ['S'], T: ['T'], V: ['V'],
  W: ['W'], X: ['K', 'S'], Z: ['Z'],
};

/** A compact spelling-to-ARPAbet fallback, used only when Web Speech cannot
 * provide phoneme timing. Whole-word exceptions cover common irregular words;
 * the rules deliberately emit only symbols understood by PHONEME_PROFILES. */
export function phonemeGroups(word: string): string[] {
  const lower = word.toLocaleLowerCase('en-US');
  const exception = EXCEPTION_PHONEMES[lower];
  if (exception) return [...exception];
  const inflected = silentEStem(lower);
  if (inflected) return [...phonemeGroups(inflected.stem), inflected.ending];

  const groups: string[] = [];
  const upper = word.toUpperCase().replace(/[^A-Z]/g, '');
  const finalEIsSilent = upper.endsWith('E')
    && upper.length > 2
    && !VOWEL_LETTERS.has(upper.at(-2) ?? '')
    && [...upper.slice(0, -1)].some((letter) => VOWEL_LETTERS.has(letter));
  const magicEIndex = finalEIsSilent
    && LONG_VOWELS[upper.at(-3) ?? '']
    && !VOWEL_LETTERS.has(upper.at(-2) ?? '')
    ? upper.length - 3
    : -1;

  for (let index = 0; index < upper.length;) {
    if (finalEIsSilent && index === upper.length - 1) break;
    if (index === magicEIndex) {
      groups.push(LONG_VOWELS[upper[index]!]!);
      index += 1;
      continue;
    }

    const trigram = upper.slice(index, index + 3);
    if (trigram === 'IGH') {
      groups.push('AY');
      index += 3;
      continue;
    }
    if (trigram === 'ALL') {
      groups.push('AO', 'L');
      index += 3;
      continue;
    }

    const pair = upper.slice(index, index + 2);
    if (pair === 'IE' && index + 2 === upper.length) {
      groups.push('AY');
      index += 2;
      continue;
    }
    const vowelPattern = VOWEL_PATTERNS[pair];
    if (vowelPattern) {
      groups.push(...vowelPattern);
      index += 2;
      continue;
    }
    const consonantPattern: Readonly<Record<string, readonly string[]>> = {
      TH: ['TH'], SH: ['SH'], CH: ['CH'], PH: ['F'], NG: ['NG'], NK: ['NG', 'K'], CK: ['K'], WH: ['W'], QU: ['K', 'W'],
    };
    if (consonantPattern[pair]) {
      groups.push(...consonantPattern[pair]!);
      index += 2;
      continue;
    }

    const letter = upper[index]!;
    if (letter === upper[index + 1] && !VOWEL_LETTERS.has(letter)) {
      index += 1;
      continue;
    }
    if (letter === 'C') {
      groups.push(/[EIY]/.test(upper[index + 1] ?? '') ? 'S' : 'K');
    } else if (letter === 'Y') {
      if (index === 0) groups.push('Y');
      else if (index === upper.length - 1 && !VOWEL_LETTERS.has(upper[index - 1] ?? '')) {
        const hasOtherVowel = [...upper.slice(0, -1)].some((candidate) => /[AEIOU]/.test(candidate));
        groups.push(hasOtherVowel ? 'IY' : 'AY');
      } else {
        groups.push('IH');
      }
    } else if (letter === 'O' && index > 0 && index === upper.length - 1 && !VOWEL_LETTERS.has(upper[index - 1]!)) {
      // Open final O is long: go, no, so, hello, photo.
      groups.push('OW');
    } else if (letter === 'O' && isOpenFirstSyllableO(upper, index)) {
      // The one place spelling is real evidence of stress: a long open first
      // syllable carries it ("NO-lan", "O-pen"). Marking it lets the word's
      // duration favour it and the track protect it.
      groups.push('OW1');
    } else if (SINGLE_VOWELS[letter]) {
      groups.push(SINGLE_VOWELS[letter]!);
    } else if (CONSONANTS[letter]) {
      groups.push(...CONSONANTS[letter]!);
    }
    index += 1;
  }
  return groups;
}

/** A held vowel against a passed-through consonant, in relative weight. Real
 *  speech spends noticeably longer on a vowel than on the consonants around
 *  it; splitting a word's duration evenly by letter (the previous behaviour)
 *  gave every group the same slice regardless, so a word's one or two vowel
 *  groups -- the ones actually carrying WIDE/ROUND/CLOSED shapes -- ended up
 *  exactly as brief as the OPEN-mapped consonants around them. At a 45ms
 *  crossfade that is barely on screen, so the avatar reads as doing nothing
 *  but OPEN/REST. This weighting is the fix: consonants stay quick, vowels
 *  get room to actually register. */
const VOWEL_WEIGHT = 1.7;
const CONSONANT_WEIGHT = 1;
/**
 * Stress shapes duration inside a word as much as vowel-vs-consonant does. With
 * one vowel weight, "about" gave its schwa 113ms and its stressed /aU/ 113ms
 * split into two ~55ms halves: "a-" hung open while "-bout" flashed past.
 */
const REDUCED_VOWEL_WEIGHT = 1.1;
const DIPHTHONG_WEIGHT = 2.2;
/**
 * A diphthong known to be stressed takes more of its word. Inside a
 * multisyllable word ("Nolan", "open", "nobody") the consonants were already at
 * the dwell donor floor, so the stressed OH could not borrow the time it needed
 * to show; the word's other sounds give it up here instead, and the word does
 * not get longer.
 */
const STRESSED_DIPHTHONG_WEIGHT = 2.6;
const DIPHTHONG_GROUPS = new Set(['AY', 'AW', 'EY', 'OW', 'OY']);

function groupWeight(group: string): number {
  const symbol = group.replace(/\d+$/, '');
  if (!VOWEL_GROUPS.has(symbol)) return CONSONANT_WEIGHT;
  if (group.endsWith('0')) return REDUCED_VOWEL_WEIGHT;
  if (!DIPHTHONG_GROUPS.has(symbol)) return VOWEL_WEIGHT;
  return group.endsWith('1') ? STRESSED_DIPHTHONG_WEIGHT : DIPHTHONG_WEIGHT;
}

/**
 * Word duration is estimated from letter count, which badly undersizes short
 * words carrying a full vowel: "go" came out at 144ms, too short for the jaw
 * to reach the OH shape at all. Reduced function words ("a", "to", "the")
 * really are that short and keep their letter-count estimate.
 */
const MIN_CONTENT_WORD_MS = 180;

function minimumWordMs(groups: readonly string[]): number {
  const fullVowel = groups.some((group) => VOWEL_GROUPS.has(group.replace(/\d+$/, '')) && !group.endsWith('0'));
  return fullVowel ? MIN_CONTENT_WORD_MS : 0;
}

/** Gap inserted between words. Real speech has micro-pauses; without one the
 *  estimator strings every word into one unbroken span with no REST to reset
 *  on, which reads as continuous mouth movement rather than speech. */
const INTER_WORD_GAP_MS = 55;

/**
 * Estimate cue timing from text. Punctuation between words (read from the
 * original string) widens the gap into a REST slot; see webSpeechTiming.ts for
 * why its length is only a fallback once boundary events arrive.
 */
export function estimate(text: string, speed: number): { cues: SpeechCue[]; words: WordTiming[]; durationMs: number } {
  const safeSpeed = Math.max(0.1, speed);
  const gap = INTER_WORD_GAP_MS / safeSpeed;
  const matches = [...text.matchAll(/[\p{L}\p{N}']+/gu)];
  const cues: SpeechCue[] = [];
  const words: WordTiming[] = [];
  // REST before the first word, so a clock waiting at 0 renders REST.
  let cursor = START_REST_MS;

  for (const [wordIndex, match] of matches.entries()) {
    const previous = words[wordIndex - 1];
    if (previous) cursor += barrierGapMs(previous.barrier, gap, safeSpeed);
    const word = match[0];
    const wordEnd = (match.index ?? 0) + word.length;
    const next = matches[wordIndex + 1];
    const { barrier, punctuation } = next
      ? classifyGap(text.slice(wordEnd, next.index ?? wordEnd), word, next[0])
      : { ...classifyGap(text.slice(wordEnd), word, ''), barrier: 'none' as const };
    const groups = phonemeGroups(word);
    const duration = Math.max(word.length * BASE_CHARACTER_MS, minimumWordMs(groups)) / safeSpeed;
    const weights = groups.map(groupWeight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const cueStart = cues.length;
    let offset = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const share = (weights[index] ?? 1) / totalWeight;
      const startMs = cursor + offset;
      offset += duration * share;
      cues.push({ startMs, endMs: cursor + offset, token: { kind: 'phoneme', symbol: groups[index] ?? '' } });
    }
    words.push({
      text: word,
      charIndex: match.index ?? 0,
      startMs: cursor,
      endMs: cursor + duration,
      cueStart,
      cueEnd: cues.length,
      barrier,
      punctuation,
    });
    cursor += duration;
  }
  return { cues, words, durationMs: cursor + TRAILING_REST_MS };
}

class SpeechSynthesisPlayback implements ExternalPlayback {
  private readonly callbacks = new Set<() => void>();
  private utterance: SpeechSynthesisUtterance | null = null;
  private ended = false;
  private paused = false;
  /**
   * Position, pace learning and punctuation holds all live in the clock. This
   * class only owns the utterance lifecycle and forwards its events.
   *
   * Boundary events deliberately ignore `elapsedTime`: its unit is not reliable
   * across browsers (the spec says seconds, engines have shipped ms), and
   * reading it wrongly slams the clock past the end of the timeline. The event
   * already carries the one fact that matters -- this word starts NOW.
   */
  private readonly clock: WebSpeechTimingClock;

  constructor(
    private readonly text: string,
    private readonly voiceId: string,
    private readonly speed: number,
    words: WordTiming[],
    estimatedDurationMs: number,
  ) {
    this.clock = new WebSpeechTimingClock(words, estimatedDurationMs);
  }

  start(): void {
    if (this.utterance && !this.ended) return;
    this.ended = false;
    this.paused = false;
    this.clock.start();
    const utterance = new SpeechSynthesisUtterance(this.text);
    utterance.rate = Math.max(0.1, Math.min(10, this.speed));
    utterance.voice = browserVoices().find((voice) => voice.voiceURI === this.voiceId) ?? null;
    // The clock epoch is when the engine starts speaking, not when speak() is
    // called: queueing and voice loading can take hundreds of milliseconds.
    utterance.onstart = () => this.clock.speechStarted();
    utterance.onboundary = (event) => this.clock.boundary(event.charIndex, event.name);
    utterance.onend = () => this.finish();
    utterance.onerror = () => this.finish();
    this.utterance = utterance;
    speechSynthesis.speak(utterance);
  }

  stop(): void {
    if (!this.utterance || this.ended) return;
    this.utterance.onstart = null;
    this.utterance.onboundary = null;
    this.utterance.onend = null;
    this.utterance.onerror = null;
    speechSynthesis.cancel();
    this.utterance = null;
    this.ended = false;
    this.paused = false;
    this.clock.stop();
  }

  pause(): void {
    if (!this.utterance || this.ended || this.paused) return;
    this.clock.pause();
    speechSynthesis.pause();
    this.paused = true;
  }

  resume(): void {
    if (!this.utterance || this.ended || !this.paused) return;
    this.clock.resume();
    this.paused = false;
    speechSynthesis.resume();
  }

  positionMs(): number {
    return this.clock.positionMs();
  }

  timingDebug(): PlaybackTimingDebug {
    return this.clock.debugState();
  }

  onEnd(cb: () => void): void {
    this.callbacks.add(cb);
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.paused = false;
    this.utterance = null;
    this.clock.finish();
    for (const callback of this.callbacks) callback();
  }
}

export class WebSpeechTTSProvider implements TTSProvider {
  readonly name = 'webspeech';

  async available(): Promise<boolean> {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  async voices(): Promise<Voice[]> {
    return friendlyVoices();
  }

  async generate(text: string, voiceId: string, speed: number): Promise<SpeechResult> {
    const estimateResult = estimate(text, speed);
    return {
      audio: null,
      durationMs: estimateResult.durationMs,
      cues: estimateResult.cues,
      externalPlayback: new SpeechSynthesisPlayback(
        text,
        voiceId,
        speed,
        estimateResult.words,
        estimateResult.durationMs,
      ),
    };
  }
}
