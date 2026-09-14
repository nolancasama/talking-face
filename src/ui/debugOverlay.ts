import { VISUAL_LEAD_MS } from '../core/articulation';
import type { Articulation } from '../core/articulation';
import type { CoarticulationDebug } from '../core/coarticulation';
import type { MouthPose, MouthTimeline, PlaybackTimingDebug } from '../core/types';
import type { LipSyncPlayer } from '../player/lipSyncPlayer';

const DEBUG_STORAGE_KEY = 'talking-face:debug';
const ARTICULATION_KEYS = [
  'jawOpen',
  'lipWidth',
  'lipRound',
  'lipClosure',
  'tongue',
] as const satisfies readonly (keyof Articulation)[];

const TIMELINE_COLOURS: Readonly<Record<MouthPose, string>> = {
  REST: '#64748b',
  CLOSED: '#f43f5e',
  SMALL_OPEN: '#fb923c',
  BIG_OPEN: '#f59e0b',
  WIDE: '#22c55e',
  ROUND: '#8b5cf6',
  OPEN_ROUND: '#a855f7',
  TEETH_LIP: '#06b6d4',
  TH: '#ec4899',
  SH_CH: '#3b82f6',
  L: '#10b981',
};

/** DEV-only switch. `?debug=1` enables it persistently; `?debug=0` clears it. */
export function isDebugModeEnabled(): boolean {
  if (!import.meta.env.DEV) return false;

  const toggle = new URLSearchParams(globalThis.location.search).get('debug');
  if (toggle === '1' || toggle === '0') {
    try {
      if (toggle === '1') globalThis.localStorage.setItem(DEBUG_STORAGE_KEY, '1');
      else globalThis.localStorage.removeItem(DEBUG_STORAGE_KEY);
    } catch {
      // Storage may be unavailable in private/restricted browser contexts.
    }
    return toggle === '1';
  }

  try {
    return globalThis.localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

type ControlElements = {
  value: HTMLOutputElement;
  fill: HTMLSpanElement;
  target: HTMLSpanElement;
};

export interface DebugSession {
  readonly player: LipSyncPlayer;
  readonly timeline: MouthTimeline;
  /** Present for clocks that expose timing state (Web Speech). */
  readonly timing?: PlaybackTimingDebug | null;
}

/** One-line clock phase: tells a timing fault apart from a mapping fault. */
export function describeTiming(timing: PlaybackTimingDebug): string {
  if (timing.phase === 'hold' && timing.hold) {
    const kind = timing.hold.barrier === 'hard' ? 'PUNCTUATION HOLD' : 'SOFT HOLD';
    return `${kind} (${timing.hold.punctuation}) ${timing.hold.heldMs.toFixed(0)}ms · waiting for “${timing.hold.nextWord}”`;
  }
  if (timing.phase === 'waiting') {
    return `WAITING FOR SPEECH START · ${(timing.sinceRequestMs ?? 0).toFixed(0)}ms`;
  }
  if (timing.phase === 'estimating') {
    return `STARTED via ${timing.startedVia ?? '?'} after ${(timing.startLatencyMs ?? 0).toFixed(0)}ms · no boundary yet`;
  }
  if (timing.phase === 'word') return `WORD: ${timing.word ?? '?'} @${timing.charIndex ?? '?'}`;
  return timing.phase.toUpperCase();
}

/**
 * One-line linguistic decision, e.g.
 * `/t/ ‹/uw/› /n/ · vowel ×1.00 · anticipate CLOSE 0.31 · carry ALVEOLAR 0.12`.
 */
export function describeSpeechSound(speech: CoarticulationDebug): string {
  const symbol = (phoneme: string | null): string => (phoneme === null ? '·' : `/${phoneme.toLowerCase()}/`);
  const stress = speech.stress === null ? '' : ` s${speech.stress}`;
  const parts = [
    `${symbol(speech.previous)} ‹${symbol(speech.phoneme)}› ${symbol(speech.next)}`,
    `${speech.phonemeClass} ×${speech.strength.toFixed(2)}${stress}`,
  ];
  if (speech.critical) parts.push(`CRITICAL ${speech.critical}`);
  if (speech.anticipation) parts.push(`anticipate ${speech.anticipation.feature} ${speech.anticipation.share.toFixed(2)}`);
  if (speech.carryover) parts.push(`carry ${speech.carryover.feature} ${speech.carryover.share.toFixed(2)}`);
  return parts.join(' · ');
}

/** A separate, read-only diagnostic surface for LipSyncPlayer state. */
export class DebugOverlay {
  private readonly root = document.createElement('aside');
  private readonly stateValue = document.createElement('strong');
  private readonly soundValue = document.createElement('strong');
  private readonly posesValue = document.createElement('span');
  private readonly clockValue = document.createElement('span');
  private readonly visualValue = document.createElement('span');
  private readonly weightsValue = document.createElement('span');
  private readonly speechValue = document.createElement('strong');
  private readonly paceValue = document.createElement('span');
  private readonly timelineCanvas = document.createElement('canvas');
  private readonly controls = new Map<keyof Articulation, ControlElements>();
  private animationFrame: number | null = null;

  constructor(private readonly readSession: () => DebugSession | null) {
    this.root.className = 'debug-overlay';
    this.root.setAttribute('aria-label', 'Lip sync debug overlay');

    const heading = document.createElement('div');
    heading.className = 'debug-overlay__heading';
    const label = document.createElement('span');
    label.textContent = 'LIP SYNC';
    heading.append(label, this.stateValue);

    const controls = document.createElement('div');
    controls.className = 'debug-overlay__controls';
    for (const key of ARTICULATION_KEYS) {
      const row = document.createElement('div');
      row.className = 'debug-control';
      const name = document.createElement('span');
      name.textContent = key;
      const value = document.createElement('output');
      const bar = document.createElement('div');
      bar.className = 'debug-control__bar';
      const fill = document.createElement('span');
      fill.className = 'debug-control__fill';
      const target = document.createElement('span');
      target.className = 'debug-control__target';
      bar.append(fill, target);
      row.append(name, value, bar);
      controls.append(row);
      this.controls.set(key, { value, fill, target });
    }

    const sound = this.makeMetric('sound', this.soundValue);
    const poses = this.makeMetric('poses', this.posesValue);
    const weights = this.makeMetric('weights', this.weightsValue);
    const clock = this.makeMetric('clock', this.clockValue, ' ms');
    const visual = this.makeMetric('visual', this.visualValue, ' ms');
    const leadValue = document.createElement('span');
    leadValue.textContent = `${VISUAL_LEAD_MS}`;
    const lead = this.makeMetric('VISUAL_LEAD_MS', leadValue, ' ms');
    const speech = this.makeMetric('speech', this.speechValue);
    const pace = this.makeMetric('anchor/est/pace', this.paceValue);

    this.timelineCanvas.className = 'debug-timeline';
    this.timelineCanvas.setAttribute('aria-label', 'Mouth timeline and visual-time playhead');
    const legend = document.createElement('div');
    legend.className = 'debug-timeline-legend';
    for (const [state, colour] of Object.entries(TIMELINE_COLOURS)) {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = colour;
      item.append(swatch, state);
      legend.append(item);
    }
    this.root.append(heading, sound, controls, poses, weights, clock, visual, lead, speech, pace, this.timelineCanvas, legend);
  }

  mount(host: HTMLElement): void {
    host.append(this.root);
    this.render();
  }

  destroy(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.root.remove();
  }

  private makeMetric(nameText: string, value: HTMLElement, suffix = ''): HTMLElement {
    const row = document.createElement('div');
    row.className = 'debug-metric';
    const name = document.createElement('span');
    name.textContent = nameText;
    row.append(name, value);
    if (suffix) row.append(suffix);
    return row;
  }

  private render = (): void => {
    const session = this.readSession();
    if (!session) {
      this.renderIdle();
      this.animationFrame = requestAnimationFrame(this.render);
      return;
    }

    const snapshot = session.player.getSnapshot();
    this.stateValue.textContent = snapshot.activeMouthState;
    this.soundValue.textContent = snapshot.speech ? describeSpeechSound(snapshot.speech) : '—';
    this.posesValue.textContent = snapshot.availablePoses.join(' ');
    this.clockValue.textContent = snapshot.clockPositionMs.toFixed(1);
    this.visualValue.textContent = snapshot.visualTimeMs.toFixed(1);
    this.weightsValue.textContent = snapshot.poseWeights
      .map(({ pose, weight }) => `${pose} ${weight.toFixed(3)}`)
      .join(' + ');
    const timing = session.timing;
    this.speechValue.textContent = timing ? describeTiming(timing) : 'n/a (audio clock)';
    this.paceValue.textContent = timing
      ? `${timing.anchorMs.toFixed(0)} / ${timing.estimatedMs.toFixed(0)} → ${timing.positionMs.toFixed(0)} ms · ×${timing.paceScale.toFixed(2)} (n=${timing.paceSamples})`
      : '—';

    for (const key of ARTICULATION_KEYS) {
      const elements = this.controls.get(key)!;
      const current = snapshot.currentArticulation[key];
      const target = snapshot.targetArticulation[key];
      // current → coarticulated target (the sound's own target)
      const own = snapshot.speech ? ` (${snapshot.speech.target[key].toFixed(2)})` : '';
      elements.value.textContent = `${current.toFixed(3)} → ${target.toFixed(3)}${own}`;
      elements.fill.style.width = `${Math.min(1, Math.max(0, current)) * 100}%`;
      elements.target.style.left = `${Math.min(1, Math.max(0, target)) * 100}%`;
    }

    this.drawTimeline(session.timeline, snapshot.visualTimeMs);
    this.animationFrame = requestAnimationFrame(this.render);
  };

  private renderIdle(): void {
    this.stateValue.textContent = 'IDLE';
    this.soundValue.textContent = '—';
    this.posesValue.textContent = '—';
    this.clockValue.textContent = '—';
    this.visualValue.textContent = '—';
    this.weightsValue.textContent = '—';
    this.speechValue.textContent = '—';
    this.paceValue.textContent = '—';
    for (const elements of this.controls.values()) {
      elements.value.textContent = '—';
      elements.fill.style.width = '0';
      elements.target.style.left = '0';
    }
    this.drawTimeline([], 0);
  }

  private drawTimeline(timeline: MouthTimeline, visualTimeMs: number): void {
    const rect = this.timelineCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.timelineCanvas.width !== pixelWidth || this.timelineCanvas.height !== pixelHeight) {
      this.timelineCanvas.width = pixelWidth;
      this.timelineCanvas.height = pixelHeight;
    }

    const context = this.timelineCanvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#111827';
    context.fillRect(0, 0, width, height);

    const duration = timeline.at(-1)?.endMs ?? 0;
    if (!(duration > 0)) return;
    for (const span of timeline) {
      context.fillStyle = TIMELINE_COLOURS[span.mouth] ?? '#64748b';
      context.fillRect(
        (span.startMs / duration) * width,
        0,
        Math.max(1, ((span.endMs - span.startMs) / duration) * width),
        height,
      );
    }

    const playheadX = Math.min(width, Math.max(0, (visualTimeMs / duration) * width));
    context.fillStyle = '#ffffff';
    context.fillRect(Math.max(0, playheadX - 1), 0, 2, height);
  }
}
