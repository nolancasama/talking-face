import {
  VISUAL_LEAD_MS,
  poseWeights as resolvePoseWeights,
  smoothArticulation,
} from '../core/articulation';
import type { Articulation } from '../core/articulation';
import { articulationAt, mouthAt } from '../core/timeline';
import { ALL_POSES } from '../core/types';
import type { Avatar, MouthPose, MouthTimeline, PlaybackClock } from '../core/types';

type PausableClock = PlaybackClock & { pause?: () => void };
type PoseWeight = ReturnType<typeof resolvePoseWeights>[number];

export interface LipSyncPlayerSnapshot {
  readonly currentArticulation: Readonly<Articulation>;
  readonly targetArticulation: Readonly<Articulation>;
  readonly poseWeights: readonly Readonly<PoseWeight>[];
  readonly clockPositionMs: number;
  readonly visualTimeMs: number;
  readonly activeMouthState: MouthPose;
  readonly availablePoses: readonly MouthPose[];
}

/** Renders pre-baked avatar frames against a playback-position master clock. */
export class LipSyncPlayer {
  private readonly context: CanvasRenderingContext2D;
  private animationFrame: number | null = null;
  private runId = 0;
  private currentArticulation!: Articulation;
  private targetArticulation!: Articulation;
  private currentPoseWeights: PoseWeight[] = [];
  private lastRenderedAtMs: number | null = null;
  private lastClockPositionMs: number | null = null;
  private clockPositionMs = 0;
  private visualTimeMs = VISUAL_LEAD_MS;
  private activeMouthState: MouthPose = 'REST';
  private readonly availablePoses: readonly MouthPose[];

  constructor(
    private readonly avatar: Avatar,
    private readonly canvas: HTMLCanvasElement,
    private readonly timeline: MouthTimeline,
    private readonly clock: PausableClock,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas context is required for lip-sync playback');
    this.context = context;
    this.availablePoses = ALL_POSES.filter((pose) => avatar.frames[pose] !== undefined);
    this.sizeCanvas();
    this.resetSmoothing(this.clock.nowMs(), performance.now());
    this.drawResolvedFrames();
    clock.onEnd(() => this.handleEnd());
  }

  async play(): Promise<void> {
    const runId = ++this.runId;
    this.cancelFrame();
    await this.clock.start();
    if (runId !== this.runId) return;
    this.resetAndDrawCurrent(performance.now());
    this.animationFrame = requestAnimationFrame((timestamp) => this.tick(runId, timestamp));
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
    this.resetAndDrawCurrent(performance.now());
  }

  /** Re-apply sizing after a device-pixel-ratio or layout change. */
  resize(): void {
    this.sizeCanvas();
    this.drawCurrentFrame(performance.now());
  }

  /** Return a coherent, mutation-safe snapshot of the latest rendered frame. */
  getSnapshot(): LipSyncPlayerSnapshot {
    return {
      currentArticulation: { ...this.currentArticulation },
      targetArticulation: { ...this.targetArticulation },
      poseWeights: this.currentPoseWeights.map((entry) => ({ ...entry })),
      clockPositionMs: this.clockPositionMs,
      visualTimeMs: this.visualTimeMs,
      activeMouthState: this.activeMouthState,
      availablePoses: [...this.availablePoses],
    };
  }

  private tick(runId: number, timestampMs: number): void {
    if (runId !== this.runId || !this.clock.playing()) {
      this.animationFrame = null;
      return;
    }
    this.drawCurrentFrame(timestampMs);
    this.animationFrame = requestAnimationFrame((timestamp) => this.tick(runId, timestamp));
  }

  private drawCurrentFrame(renderedAtMs: number): void {
    const clockPositionMs = this.clock.nowMs();
    if (this.lastClockPositionMs !== null && clockPositionMs < this.lastClockPositionMs) {
      this.resetSmoothing(clockPositionMs, renderedAtMs);
      this.drawResolvedFrames();
      return;
    }

    const visualTimeMs = clockPositionMs + VISUAL_LEAD_MS;
    const targetArticulation = articulationAt(this.timeline, visualTimeMs);
    const elapsedMs = this.lastRenderedAtMs === null
      ? 0
      : Math.max(0, renderedAtMs - this.lastRenderedAtMs);

    this.currentArticulation = smoothArticulation(
      this.currentArticulation,
      targetArticulation,
      elapsedMs,
    );
    this.targetArticulation = targetArticulation;
    this.currentPoseWeights = resolvePoseWeights(this.currentArticulation, this.availablePoses);
    this.clockPositionMs = clockPositionMs;
    this.visualTimeMs = visualTimeMs;
    this.activeMouthState = mouthAt(this.timeline, visualTimeMs);
    this.lastRenderedAtMs = renderedAtMs;
    this.lastClockPositionMs = clockPositionMs;
    this.drawResolvedFrames();
  }

  private resetAndDrawCurrent(renderedAtMs: number): void {
    this.resetSmoothing(this.clock.nowMs(), renderedAtMs);
    this.drawResolvedFrames();
  }

  private resetSmoothing(clockPositionMs: number, renderedAtMs: number): void {
    const visualTimeMs = clockPositionMs + VISUAL_LEAD_MS;
    const targetArticulation = articulationAt(this.timeline, visualTimeMs);
    this.currentArticulation = { ...targetArticulation };
    this.targetArticulation = targetArticulation;
    this.currentPoseWeights = resolvePoseWeights(this.currentArticulation, this.availablePoses);
    this.clockPositionMs = clockPositionMs;
    this.visualTimeMs = visualTimeMs;
    this.activeMouthState = mouthAt(this.timeline, visualTimeMs);
    this.lastRenderedAtMs = renderedAtMs;
    this.lastClockPositionMs = clockPositionMs;
  }

  private drawResolvedFrames(): void {
    const first = this.currentPoseWeights[0];
    if (!first) return;

    const { context } = this;
    context.globalAlpha = 1;
    if (this.currentPoseWeights.length === 1) {
      context.drawImage(this.frameFor(first.pose), 0, 0, this.avatar.width, this.avatar.height);
      return;
    }

    const second = this.currentPoseWeights[1]!;
    const heavier = first.weight >= second.weight ? first : second;
    const lighter = heavier === first ? second : first;
    context.drawImage(this.frameFor(heavier.pose), 0, 0, this.avatar.width, this.avatar.height);
    context.globalAlpha = lighter.weight;
    context.drawImage(this.frameFor(lighter.pose), 0, 0, this.avatar.width, this.avatar.height);
    context.globalAlpha = 1;
  }

  private frameFor(pose: MouthPose): ImageBitmap {
    const frame = this.avatar.frames[pose];
    if (!frame) throw new Error(`Avatar is missing resolved pose frame ${pose}`);
    return frame;
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
    this.resetAndDrawCurrent(performance.now());
  }
}
