import { FULL_COMMIT_MS, FRAME_CROSSFADE_MS, VISUAL_LEAD_MS } from '../core/articulation';
import { MIN_SPAN_MS } from '../core/visemeMap';
import type { PlaybackTimingDebug, PunctuationBarrier } from '../core/types';

/**
 * Web Speech timing, isolated from the browser API so it can be driven by fake
 * boundary events in tests.
 *
 * Authority, highest first:
 *   actual word boundary > punctuation barrier > learned pace > character estimate
 */

export interface WordTiming {
  text: string;
  charIndex: number;
  startMs: number;
  endMs: number;
  cueStart: number;
  cueEnd: number;
  /** Phrase break between this word and the next one ('none' for the last word). */
  barrier: PunctuationBarrier;
  /** The punctuation that caused the barrier, e.g. '?' or ','. Empty for none. */
  punctuation: string;
}

/**
 * Estimated REST slot after a hard break (. ? !). Its length only matters when
 * the engine sends no boundary events; otherwise the clock holds inside it for
 * however long the voice really pauses. The floor keeps the slot long enough
 * for REST to fully commit and for the park point (which sits VISUAL_LEAD_MS
 * before the next word) to still land inside it.
 */
export const HARD_BARRIER_GAP_MS = 240;
export const HARD_BARRIER_MIN_GAP_MS = FULL_COMMIT_MS + VISUAL_LEAD_MS + FRAME_CROSSFADE_MS;
/** Estimated REST slot after a soft break (, ; : dash): a brief rest opportunity. */
export const SOFT_BARRIER_GAP_MS = 120;
export const SOFT_BARRIER_MIN_GAP_MS = MIN_SPAN_MS + VISUAL_LEAD_MS;

/**
 * Safety release for a hard hold whose next boundary never arrives (engines do
 * occasionally drop one). Not a pause length: real pauses release on the
 * boundary long before this.
 */
export const HARD_HOLD_MAX_MS = 2000;
/** A comma never holds indefinitely; past this the estimate resumes. */
export const SOFT_HOLD_MAX_MS = 400;

/**
 * REST lead-in before the first word in the estimated timeline. Without it the
 * first word starts at 0 and the player's VISUAL_LEAD_MS lookahead shows its
 * first sound while the clock is still waiting for speech to start. Sized from
 * the lead (and kept past MIN_SPAN_MS so the timeline cannot absorb it), not a
 * delay: the first boundary re-anchors straight to the word regardless.
 */
export const START_REST_MS = Math.max(MIN_SPAN_MS, VISUAL_LEAD_MS) + 1;

/**
 * Safety start if the engine never reports speech starting (no onstart and no
 * boundary). Deliberately long: real start latency is usually well under a
 * second, and starting early is the bug this guards against. A late onstart
 * still corrects a fallback start.
 */
export const START_FALLBACK_MS = 2000;

/** Pace estimates outside this range are treated as bad samples, not a voice. */
const PACE_MIN = 0.25;
const PACE_MAX = 4;
/** Weight of each new word-pair sample in the log-space pace average. */
const PACE_SMOOTHING = 0.35;

/** Classify the text between two words (or after the last one). */
export function classifyGap(
  between: string,
  previousWord: string,
  nextWord: string,
): { barrier: PunctuationBarrier; punctuation: string } {
  // A decimal point or a thousands comma ("3.5", "1,000") is not a phrase break.
  const numeric = /^[.,]$/.test(between) && /\d$/.test(previousWord) && /^\d/.test(nextWord);
  if (!numeric) {
    const hard = between.match(/[.?!…。？！]/u);
    if (hard) return { barrier: 'hard', punctuation: hard[0] };
    const soft = between.match(/[,;:—–]|\s-{1,2}\s|--/u);
    if (soft) return { barrier: 'soft', punctuation: soft[0].trim() };
  }
  return { barrier: 'none', punctuation: '' };
}

/** Estimated-time gap after a word with the given barrier. */
export function barrierGapMs(barrier: PunctuationBarrier, wordGapMs: number, speed: number): number {
  const safeSpeed = Math.max(0.1, speed);
  if (barrier === 'hard') return Math.max(HARD_BARRIER_MIN_GAP_MS, HARD_BARRIER_GAP_MS / safeSpeed);
  if (barrier === 'soft') return Math.max(SOFT_BARRIER_MIN_GAP_MS, SOFT_BARRIER_GAP_MS / safeSpeed);
  return wordGapMs;
}

interface Hold {
  wordIndex: number;
  startedAtMs: number;
}

/**
 * The visual clock for a Web Speech utterance, in estimate-timeline coordinates.
 *
 * Between boundaries it advances at the learned pace. At a punctuation barrier
 * it parks inside the REST slot before the next word and waits there for that
 * word's boundary, so the face waits for the audio and never forms the next
 * sentence during a real pause. The utterance itself is never delayed.
 */
export class WebSpeechTimingClock {
  /** speak() requested (waiting or started). */
  private running = false;
  /** The engine has actually begun speaking; the clock epoch is set. */
  private started = false;
  private startedVia: 'onstart' | 'boundary' | 'fallback' | null = null;
  private startLatencyMs: number | null = null;
  private requestedAtMs = 0;
  /** Start of the current unpaused wait, for the fallback timer. */
  private waitFromMs = 0;
  private paused = false;
  private ended = false;
  private anchorWallMs = 0;
  private anchorSpeechMs = 0;
  private anchorWordIndex = -1;
  private lastCharIndex: number | null = null;
  /** Estimated ms per real ms, learned from consecutive in-phrase word pairs. */
  private paceScale = 1;
  private paceSamples = 0;
  private lastWordEventIndex = -1;
  private lastWordEventWallMs = 0;

  constructor(
    private readonly words: readonly WordTiming[],
    private readonly durationMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** speak() was requested. The clock holds at 0 until speech actually starts. */
  start(): void {
    const now = this.now();
    this.running = true;
    this.started = false;
    this.startedVia = null;
    this.startLatencyMs = null;
    this.requestedAtMs = now;
    this.waitFromMs = now;
    this.paused = false;
    this.ended = false;
    this.anchorWallMs = now;
    this.anchorSpeechMs = 0;
    this.anchorWordIndex = -1;
    this.lastCharIndex = null;
    this.paceScale = 1;
    this.paceSamples = 0;
    this.lastWordEventIndex = -1;
  }

  /**
   * The engine reports speech has begun (utterance.onstart): the clock epoch.
   * Ignored once a boundary has anchored the clock, so it can never move the
   * clock backwards; it does correct a fallback start that guessed too early.
   */
  speechStarted(): void {
    if (!this.running || this.ended) return;
    const now = this.now();
    this.settleStart(now);
    if (this.started && !(this.startedVia === 'fallback' && this.anchorWordIndex < 0)) return;
    this.started = false;
    this.beginAt(now, 'onstart');
  }

  stop(): void {
    this.running = false;
    this.started = false;
    this.paused = false;
    this.ended = false;
    this.anchorSpeechMs = 0;
  }

  pause(): void {
    if (!this.running || this.paused || this.ended) return;
    this.anchorSpeechMs = this.positionMs();
    this.paused = true;
    // Paused wall time is not speech; never learn pace across it.
    this.lastWordEventIndex = -1;
  }

  resume(): void {
    if (!this.running || !this.paused || this.ended) return;
    this.anchorWallMs = this.now();
    // Time spent paused before start must not count toward the fallback.
    if (!this.started) this.waitFromMs = this.anchorWallMs;
    this.paused = false;
  }

  finish(): void {
    this.ended = true;
    this.paused = false;
  }

  /**
   * Re-anchor on a boundary event. The word starts NOW, so the clock jumps to
   * that word's estimated start -- from wherever it was, including a hold --
   * and any error accumulated since the previous boundary is discarded.
   */
  boundary(charIndex: number, name?: string): void {
    if (!this.running || this.ended) return;
    const index = this.wordIndexAt(charIndex);
    if (index < 0) return;
    // Duplicate (e.g. a 'sentence' event alongside the 'word' event) or
    // out-of-order boundary: re-anchoring backwards would only add a jump.
    if (this.anchorWordIndex >= 0 && index <= this.anchorWordIndex) return;

    const now = this.now();
    // A word boundary proves speech has started, even if onstart has not
    // arrived yet (or never will). The anchor below then places the clock.
    this.settleStart(now);
    if (!this.started) this.beginAt(now, 'boundary');
    const word = this.words[index]!;
    const isWordEvent = name === undefined || name === '' || name === 'word';

    if (isWordEvent) {
      const previous = this.words[index - 1];
      // Only an adjacent pair with no punctuation between them measures
      // speaking rate. A pair spanning a barrier contains a pause, and folding
      // that silence in would read as the voice suddenly slowing down.
      if (previous && this.lastWordEventIndex === index - 1 && previous.barrier === 'none') {
        const realDelta = now - this.lastWordEventWallMs;
        const estimatedDelta = word.startMs - previous.startMs;
        if (realDelta > 1 && estimatedDelta > 0) this.learnPace(estimatedDelta / realDelta);
      }
      this.lastWordEventIndex = index;
      this.lastWordEventWallMs = now;
    }

    this.anchorSpeechMs = word.startMs;
    this.anchorWallMs = now;
    this.anchorWordIndex = index;
    this.lastCharIndex = charIndex;
  }

  positionMs(): number {
    if (this.ended) return this.durationMs;
    if (!this.running) return 0;
    const now = this.now();
    this.settleStart(now);
    if (!this.started) return 0;
    if (this.paused) return this.anchorSpeechMs;
    return this.clamp(this.resolve(now).positionMs);
  }

  debugState(): PlaybackTimingDebug {
    const now = this.now();
    this.settleStart(now);
    const advancing = this.running && this.started && !this.paused && !this.ended;
    const resolved = advancing
      ? this.resolve(now)
      : { positionMs: this.positionMs(), hold: null };
    const word = this.words[this.anchorWordIndex];
    const holdWord = resolved.hold ? this.words[resolved.hold.wordIndex] : undefined;
    return {
      source: 'webspeech',
      phase: this.ended ? 'ended'
        : !this.running ? 'idle'
        : this.paused ? 'paused'
        : !this.started ? 'waiting'
        : resolved.hold ? 'hold'
        : this.anchorWordIndex < 0 ? 'estimating'
        : 'word',
      word: word?.text ?? null,
      charIndex: this.lastCharIndex,
      anchorMs: this.anchorSpeechMs,
      estimatedMs: advancing
        ? this.clamp(this.anchorSpeechMs + (now - this.anchorWallMs) * this.paceScale)
        : resolved.positionMs,
      positionMs: this.clamp(resolved.positionMs),
      paceScale: this.paceScale,
      paceSamples: this.paceSamples,
      startedVia: this.startedVia,
      startLatencyMs: this.startLatencyMs,
      sinceRequestMs: this.running ? now - this.requestedAtMs : null,
      hold: resolved.hold && holdWord
        ? {
          barrier: holdWord.barrier,
          punctuation: holdWord.punctuation,
          heldMs: now - resolved.hold.startedAtMs,
          nextWord: this.words[resolved.hold.wordIndex + 1]?.text ?? '',
        }
        : null,
    };
  }

  /** Where the clock parks for a barrier: inside the REST slot, far enough
   *  before the next word that the player's visual lead still lands on REST. */
  parkMs(index: number): number | null {
    const word = this.words[index];
    const next = this.words[index + 1];
    if (!word || !next || word.barrier === 'none') return null;
    return Math.max(word.endMs, next.startMs - VISUAL_LEAD_MS - 1);
  }

  /**
   * Walk forward from the anchor through any barriers the clock has reached.
   * Holds only apply once the engine has proven it sends boundaries; an engine
   * that sends none would otherwise freeze the mouth at the first period.
   */
  private resolve(now: number): { positionMs: number; hold: Hold | null } {
    let speechMs = this.anchorSpeechMs;
    let wallMs = this.anchorWallMs;
    if (this.anchorWordIndex >= 0) {
      for (let index = this.anchorWordIndex; index < this.words.length; index += 1) {
        const park = this.parkMs(index);
        if (park === null || park < speechMs) continue;
        const reachedAtMs = wallMs + (park - speechMs) / this.paceScale;
        if (now <= reachedAtMs) break;
        const maxHold = this.words[index]!.barrier === 'hard' ? HARD_HOLD_MAX_MS : SOFT_HOLD_MAX_MS;
        if (now <= reachedAtMs + maxHold) {
          return { positionMs: park, hold: { wordIndex: index, startedAtMs: reachedAtMs } };
        }
        // Released without a boundary: resume estimating from the park point.
        speechMs = park;
        wallMs = reachedAtMs + maxHold;
      }
    }
    return { positionMs: speechMs + (now - wallMs) * this.paceScale, hold: null };
  }

  /** Set the clock epoch: position 0 at wall time `atMs`. */
  private beginAt(atMs: number, via: 'onstart' | 'boundary' | 'fallback'): void {
    if (this.started) return;
    this.started = true;
    this.startedVia = via;
    this.startLatencyMs = atMs - this.requestedAtMs;
    this.anchorSpeechMs = 0;
    this.anchorWallMs = atMs;
  }

  /** Apply the missing-onstart safety start once its (unpaused) wait expires. */
  private settleStart(now: number): void {
    if (this.running && !this.started && !this.paused && !this.ended
      && now - this.waitFromMs > START_FALLBACK_MS) {
      this.beginAt(this.waitFromMs + START_FALLBACK_MS, 'fallback');
    }
  }

  private learnPace(observed: number): void {
    const sample = Math.min(PACE_MAX, Math.max(PACE_MIN, observed));
    this.paceScale = this.paceSamples === 0
      ? sample
      : Math.exp(Math.log(this.paceScale) * (1 - PACE_SMOOTHING) + Math.log(sample) * PACE_SMOOTHING);
    this.paceSamples += 1;
  }

  /**
   * Map an event's charIndex to a word. An index inside a word is that word;
   * one on the whitespace or punctuation before a word (some engines report
   * that) belongs to the word that follows, never to the one before it.
   */
  private wordIndexAt(charIndex: number): number {
    for (let index = 0; index < this.words.length; index += 1) {
      const word = this.words[index]!;
      if (charIndex < word.charIndex + word.text.length) return index;
    }
    return -1;
  }

  private clamp(ms: number): number {
    return Math.max(0, Math.min(this.durationMs, ms));
  }
}
