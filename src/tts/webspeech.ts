import type { ExternalPlayback, SpeechCue, SpeechResult, TTSProvider, Voice } from '../core/types';

const LABELS = ['Female 1', 'Female 2', 'Male 1', 'Male 2'] as const;
const BASE_CHARACTER_MS = 72;

interface WordTiming {
  text: string;
  charIndex: number;
  startMs: number;
  endMs: number;
  cueStart: number;
  cueEnd: number;
}

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

function estimate(text: string, speed: number): { cues: SpeechCue[]; words: WordTiming[]; durationMs: number } {
  const safeSpeed = Math.max(0.1, speed);
  const gap = INTER_WORD_GAP_MS / safeSpeed;
  const matches = [...text.matchAll(/[\p{L}\p{N}']+/gu)];
  const cues: SpeechCue[] = [];
  const words: WordTiming[] = [];
  let cursor = 0;

  for (const [wordIndex, match] of matches.entries()) {
    if (wordIndex > 0) cursor += gap;
    const word = match[0];
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
    });
    cursor += duration;
  }
  return { cues, words, durationMs: cursor };
}

class SpeechSynthesisPlayback implements ExternalPlayback {
  private readonly callbacks = new Set<() => void>();
  private utterance: SpeechSynthesisUtterance | null = null;
  private startedAt = 0;
  private anchorWallMs = 0;
  private anchorSpeechMs = 0;
  private ended = false;
  private paused = false;
  /**
   * Estimated-time milliseconds to advance per real millisecond. The character
   * count estimate is crude and commonly off by a wide factor from the voice's
   * real pace, so without this the mouth finishes its whole timeline while the
   * synthesiser is still talking. Learned from consecutive word boundaries.
   */
  private paceScale = 1;
  private lastBoundaryWallMs = 0;
  private lastBoundarySpeechMs = 0;
  private hasBoundary = false;

  constructor(
    private readonly text: string,
    private readonly voiceId: string,
    private readonly speed: number,
    private readonly words: WordTiming[],
    private readonly estimatedDurationMs: number,
  ) {}

  start(): void {
    if (this.utterance && !this.ended) return;
    this.ended = false;
    this.paused = false;
    this.startedAt = performance.now();
    this.anchorWallMs = this.startedAt;
    this.anchorSpeechMs = 0;
    this.paceScale = 1;
    this.hasBoundary = false;
    const utterance = new SpeechSynthesisUtterance(this.text);
    utterance.rate = Math.max(0.1, Math.min(10, this.speed));
    utterance.voice = browserVoices().find((voice) => voice.voiceURI === this.voiceId) ?? null;
    utterance.onboundary = (event) => this.correctAtBoundary(event.charIndex);
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
    this.anchorSpeechMs = 0;
  }

  pause(): void {
    if (!this.utterance || this.ended || this.paused) return;
    this.anchorSpeechMs = this.positionMs();
    speechSynthesis.pause();
    this.paused = true;
  }

  resume(): void {
    if (!this.utterance || this.ended || !this.paused) return;
    this.anchorWallMs = performance.now();
    this.paused = false;
    speechSynthesis.resume();
  }

  positionMs(): number {
    if (this.ended) return this.estimatedDurationMs;
    if (!this.utterance) return 0;
    if (this.paused) return this.anchorSpeechMs;
    const elapsed = (performance.now() - this.anchorWallMs) * this.paceScale;
    return Math.max(0, Math.min(this.estimatedDurationMs, this.anchorSpeechMs + elapsed));
  }

  onEnd(cb: () => void): void {
    this.callbacks.add(cb);
  }

  /**
   * Re-anchor the clock when the synthesiser reports a word boundary.
   *
   * This deliberately ignores the event's `elapsedTime`. Its unit is not
   * reliable across browsers -- the spec says seconds, but engines have
   * shipped milliseconds -- and reading it in the wrong unit multiplies the
   * anchor by 1000, which slams the clock past the end of the timeline on the
   * first boundary and leaves the mouth parked on the trailing REST span for
   * the rest of the utterance.
   *
   * None of that value is needed. The event already carries the one fact that
   * matters: this word is starting NOW. The timeline is frozen in estimate
   * coordinates, so the correct anchor is simply that word's estimated start.
   * Position then advances in wall time until the next boundary re-anchors it,
   * bounding drift to a single word's length regardless of how far the
   * estimate is from the synthesiser's real pace.
   *
   * Note the cue objects are intentionally left alone: buildTimeline copies
   * the spans it derives, so mutating cues here would change nothing that is
   * actually rendered.
   */
  private correctAtBoundary(charIndex: number): void {
    const word = this.words.find((candidate, index) => {
      const next = this.words[index + 1];
      return charIndex >= candidate.charIndex && (!next || charIndex < next.charIndex);
    });
    if (!word) return;
    const now = performance.now();

    // Two boundaries give the voice's real pace against the estimate: how much
    // estimated time was meant to pass versus how much really did. Clamped,
    // because a repeated or out-of-order boundary would otherwise produce a
    // wild or negative ratio.
    if (this.hasBoundary) {
      const realDelta = now - this.lastBoundaryWallMs;
      const estimatedDelta = word.startMs - this.lastBoundarySpeechMs;
      if (realDelta > 1 && estimatedDelta > 0) {
        const observed = estimatedDelta / realDelta;
        this.paceScale = Math.min(4, Math.max(0.25, observed));
      }
    }

    this.anchorSpeechMs = word.startMs;
    this.anchorWallMs = now;
    this.lastBoundaryWallMs = now;
    this.lastBoundarySpeechMs = word.startMs;
    this.hasBoundary = true;
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.paused = false;
    this.utterance = null;
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
