import { crossfadeAt } from '../core/timeline';
import type { Avatar, MouthState, MouthTimeline, PlaybackClock } from '../core/types';

type PausableClock = PlaybackClock & { pause?: () => void };

/** Renders pre-baked avatar frames against a playback-position master clock. */
export class LipSyncPlayer {
  private readonly context: CanvasRenderingContext2D;
  private animationFrame: number | null = null;
  private runId = 0;

  constructor(
    private readonly avatar: Avatar,
    private readonly canvas: HTMLCanvasElement,
    private readonly timeline: MouthTimeline,
    private readonly clock: PausableClock,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas context is required for lip-sync playback');
    this.context = context;
    this.sizeCanvas();
    this.drawMouth('REST');
    clock.onEnd(() => this.handleEnd());
  }

  async play(): Promise<void> {
    const runId = ++this.runId;
    this.cancelFrame();
    await this.clock.start();
    if (runId !== this.runId) return;
    this.drawCurrentFrame();
    this.animationFrame = requestAnimationFrame(() => this.tick(runId));
  }

  pause(): void {
    if (!this.clock.playing()) return;
    ++this.runId;
    this.clock.pause?.();
    this.cancelFrame();
  }

  async resume(): Promise<void> {
    if (this.clock.playing()) return;
    await this.play();
  }

  stop(): void {
    ++this.runId;
    this.cancelFrame();
    this.clock.stop();
    this.drawMouth('REST');
  }

  /** Re-apply sizing after a device-pixel-ratio or layout change. */
  resize(): void {
    this.sizeCanvas();
    this.drawCurrentFrame();
  }

  private tick(runId: number): void {
    if (runId !== this.runId || !this.clock.playing()) {
      this.animationFrame = null;
      return;
    }
    this.drawCurrentFrame();
    this.animationFrame = requestAnimationFrame(() => this.tick(runId));
  }

  private drawCurrentFrame(): void {
    const blend = crossfadeAt(this.timeline, this.clock.nowMs());
    if (blend.from === blend.to || blend.t >= 1) {
      this.drawMouth(blend.to);
      return;
    }

    // Cross-dissolve, NOT two half-transparent draws. The outgoing frame goes
    // down fully opaque and the incoming one fades in over it, which keeps the
    // canvas at alpha 1 throughout. Clearing first and drawing at complementary
    // alphas instead leaves total alpha at t + (1-t)^2 -- 0.75 at the midpoint --
    // so the page background shows through the face on every mouth change.
    // Both frames are opaque full-frame composites, so no clear is needed.
    const { context } = this;
    context.globalAlpha = 1;
    context.drawImage(this.avatar.frames[blend.from], 0, 0, this.avatar.width, this.avatar.height);
    context.globalAlpha = blend.t;
    context.drawImage(this.avatar.frames[blend.to], 0, 0, this.avatar.width, this.avatar.height);
    context.globalAlpha = 1;
  }

  private drawMouth(mouth: MouthState): void {
    this.context.globalAlpha = 1;
    this.context.drawImage(this.avatar.frames[mouth], 0, 0, this.avatar.width, this.avatar.height);
  }

  private sizeCanvas(): void {
    const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.avatar.width * ratio);
    this.canvas.height = Math.round(this.avatar.height * ratio);
    // The backing store is the avatar's own resolution; display size is left to
    // the layout. Pinning CSS pixels to the photo's intrinsic width would
    // overflow a phone screen for any reasonably sized capture.
    this.canvas.style.width = '100%';
    this.canvas.style.height = 'auto';
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private cancelFrame(): void {
    if (this.animationFrame === null) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  private handleEnd(): void {
    ++this.runId;
    this.cancelFrame();
    this.drawMouth('REST');
  }
}
