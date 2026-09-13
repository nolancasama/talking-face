import type {
  ExternalPlayback,
  PlaybackTimingDebug,
  SpeechCue,
  SpeechResult,
  TTSProvider,
  Voice,
} from '../core/types';
import { WebSpeechTimingClock, barrierGapMs, classifyGap } from './webSpeechTiming';
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
  'AE', 'EH', 'IH', 'AO', 'UH', 'IY', 'EY', 'OY', 'AW', 'UW', 'AA', 'AH', 'AY', 'OW',
]);

function phonemeGroups(word: string): string[] {
  const groups: string[] = [];
  const upper = word.toUpperCase();
  const patterns = ['TH', 'SH', 'CH', 'PH', 'NG', 'OO', 'OW', 'OU', 'OI', 'OY', 'EE', 'EA', 'AI', 'AY'];
  for (let index = 0; index < upper.length;) {
    const pair = upper.slice(index, index + 2);
    if (patterns.includes(pair)) {
      groups.push(pair === 'PH' ? 'F' : pair === 'OO' ? 'UW' : pair === 'OU' ? 'AW' : pair === 'OI' ? 'OY' : pair === 'EE' || pair === 'EA' ? 'IY' : pair === 'AI' ? 'EY' : pair);
      index += 2;
    } else {
      const letter = upper[index];
      if (letter && /[A-Z]/.test(letter)) {
        // Approximate ARPAbet symbols for letters whose table lookup would
        // otherwise miss (bare letters not present as PHONEME_TO_MOUTH keys)
        // or would be phonetically wrong on their own.
        const approximations: Readonly<Record<string, string>> = {
          A: 'AE', E: 'EH', I: 'IH', O: 'AO', U: 'UH', C: 'K', Q: 'K', X: 'K', J: 'JH', H: 'HH',
        };
        groups.push(approximations[letter] ?? letter);
      }
      index += 1;
    }
  }
  return groups.length > 0 ? groups : ['SIL'];
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

function groupWeight(group: string): number {
  return VOWEL_GROUPS.has(group) ? VOWEL_WEIGHT : CONSONANT_WEIGHT;
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
  let cursor = 0;

  for (const [wordIndex, match] of matches.entries()) {
    const previous = words[wordIndex - 1];
    if (previous) cursor += barrierGapMs(previous.barrier, gap, safeSpeed);
    const word = match[0];
    const wordEnd = (match.index ?? 0) + word.length;
    const next = matches[wordIndex + 1];
    const { barrier, punctuation } = next
      ? classifyGap(text.slice(wordEnd, next.index ?? wordEnd), word, next[0])
      : { ...classifyGap(text.slice(wordEnd), word, ''), barrier: 'none' as const };
    const duration = word.length * BASE_CHARACTER_MS / safeSpeed;
    const groups = phonemeGroups(word);
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
  return { cues, words, durationMs: cursor };
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
    utterance.onboundary = (event) => this.clock.boundary(event.charIndex, event.name);
    utterance.onend = () => this.finish();
    utterance.onerror = () => this.finish();
    this.utterance = utterance;
    speechSynthesis.speak(utterance);
  }

  stop(): void {
    if (!this.utterance || this.ended) return;
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
