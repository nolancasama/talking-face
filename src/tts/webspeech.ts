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
        const approximations: Readonly<Record<string, string>> = {
          A: 'AE', E: 'EH', I: 'IH', O: 'AO', U: 'UH', C: 'K', Q: 'K', X: 'K', J: 'JH',
        };
        groups.push(approximations[letter] ?? letter);
      }
      index += 1;
    }
  }
  return groups.length > 0 ? groups : ['SIL'];
}

function estimate(text: string, speed: number): { cues: SpeechCue[]; words: WordTiming[]; durationMs: number } {
  const safeSpeed = Math.max(0.1, speed);
  const matches = [...text.matchAll(/[\p{L}\p{N}']+/gu)];
  const cues: SpeechCue[] = [];
  const words: WordTiming[] = [];
  let cursor = 0;

  for (const match of matches) {
    const word = match[0];
    const duration = word.length * BASE_CHARACTER_MS / safeSpeed;
    const groups = phonemeGroups(word);
    const cueStart = cues.length;
    for (let index = 0; index < groups.length; index += 1) {
      const startMs = cursor + duration * index / groups.length;
      const endMs = cursor + duration * (index + 1) / groups.length;
      cues.push({ startMs, endMs, token: { kind: 'phoneme', symbol: groups[index] ?? '' } });
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

  constructor(
    private readonly text: string,
    private readonly voiceId: string,
    private readonly speed: number,
    private readonly cues: SpeechCue[],
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
    const utterance = new SpeechSynthesisUtterance(this.text);
    utterance.rate = Math.max(0.1, Math.min(10, this.speed));
    utterance.voice = browserVoices().find((voice) => voice.voiceURI === this.voiceId) ?? null;
    utterance.onboundary = (event) => this.correctAtBoundary(event.charIndex, event.elapsedTime * 1000);
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
    const elapsed = performance.now() - this.anchorWallMs;
    return Math.max(0, Math.min(this.estimatedDurationMs, this.anchorSpeechMs + elapsed));
  }

  onEnd(cb: () => void): void {
    this.callbacks.add(cb);
  }

  private correctAtBoundary(charIndex: number, actualMs: number): void {
    const wordIndex = this.words.findIndex((word, index) => {
      const next = this.words[index + 1];
      return charIndex >= word.charIndex && (!next || charIndex < next.charIndex);
    });
    if (wordIndex < 0) return;
    const word = this.words[wordIndex];
    if (!word) return;
    const delta = actualMs - word.startMs;
    for (let index = word.cueStart; index < this.cues.length; index += 1) {
      const cue = this.cues[index];
      if (!cue) continue;
      cue.startMs = Math.max(0, cue.startMs + delta);
      cue.endMs = Math.max(cue.startMs, cue.endMs + delta);
    }
    for (let index = wordIndex; index < this.words.length; index += 1) {
      const timing = this.words[index];
      if (!timing) continue;
      timing.startMs += delta;
      timing.endMs += delta;
    }
    this.anchorSpeechMs = actualMs;
    this.anchorWallMs = performance.now();
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
        estimateResult.cues,
        estimateResult.words,
        estimateResult.durationMs,
      ),
    };
  }
}
