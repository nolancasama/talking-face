import type { ExternalPlayback, PlaybackClock } from '../core/types';

type EndCallback = () => void;

/** A PlaybackClock backed by browser-decoded audio. */
export class AudioElementClock implements PlaybackClock {
  private readonly audio: HTMLAudioElement;
  private readonly objectUrl: string;
  private readonly endCallbacks = new Set<EndCallback>();
  private endFired = false;

  constructor(blob: Blob) {
    this.objectUrl = URL.createObjectURL(blob);
    this.audio = new Audio(this.objectUrl);
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.finish());
  }

  nowMs(): number {
    return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime * 1000 : 0;
  }

  playing(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  durationMs(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration * 1000 : 0;
  }

  async start(): Promise<void> {
    if (this.audio.ended || (this.durationMs() > 0 && this.nowMs() >= this.durationMs())) {
      this.audio.currentTime = 0;
    }
    this.endFired = false;
    await this.audio.play();
  }

  /** Pause without changing the playback position. */
  pause(): void {
    this.audio.pause();
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.endFired = false;
  }

  onEnd(cb: EndCallback): void {
    this.endCallbacks.add(cb);
  }

  /** Release the object URL when the clock is no longer needed. */
  dispose(): void {
    this.stop();
    URL.revokeObjectURL(this.objectUrl);
    this.endCallbacks.clear();
  }

  private finish(): void {
    if (this.endFired) return;
    this.endFired = true;
    for (const callback of this.endCallbacks) callback();
  }
}

type PausableExternalPlayback = ExternalPlayback & {
  pause?: () => void;
  resume?: () => void;
};

/** A PlaybackClock for providers, such as Web Speech, that own playback. */
export class ExternalPlaybackClock implements PlaybackClock {
  private readonly endCallbacks = new Set<EndCallback>();
  private isPlaying = false;
  private isPaused = false;
  private endFired = false;

  constructor(
    private readonly playback: PausableExternalPlayback,
    private readonly totalDurationMs: number,
  ) {
    playback.onEnd(() => this.finish());
  }

  nowMs(): number {
    const position = this.playback.positionMs();
    return Math.min(this.totalDurationMs, Math.max(0, Number.isFinite(position) ? position : 0));
  }

  playing(): boolean {
    return this.isPlaying;
  }

  durationMs(): number {
    return this.totalDurationMs;
  }

  async start(): Promise<void> {
    this.endFired = false;
    this.isPlaying = true;
    try {
      if (this.isPaused && this.playback.resume) {
        this.playback.resume();
      } else {
        this.playback.start();
      }
    } catch (error) {
      this.isPlaying = false;
      throw error;
    }
    this.isPaused = false;
  }

  pause(): void {
    if (!this.isPlaying) return;
    if (this.playback.pause) {
      this.playback.pause();
      this.isPaused = true;
    } else {
      this.playback.stop();
      this.isPaused = false;
    }
    this.isPlaying = false;
  }

  stop(): void {
    this.playback.stop();
    this.isPlaying = false;
    this.isPaused = false;
    this.endFired = false;
  }

  onEnd(cb: EndCallback): void {
    this.endCallbacks.add(cb);
  }

  private finish(): void {
    if (!this.isPlaying || this.endFired) return;
    this.endFired = true;
    this.isPlaying = false;
    this.isPaused = false;
    for (const callback of this.endCallbacks) callback();
  }
}
