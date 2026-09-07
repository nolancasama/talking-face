import { bake } from '../../align/bake';
import { computeMouthRegionFromShots } from '../../align/region';
import {
  CAPTURE_POSES,
  MOUTH_STATES,
  type Avatar,
  type CapturedShot,
  type CapturePose,
  type MouthState,
  type NudgeOffset,
} from '../../core/types';
import type { AvatarStore } from '../../store/avatarStore';
import type { Navigator, Screen } from '../router';
import { CaptureScreen } from './capture';
import { TalkScreen } from './talk';

const DISPLAY_NAMES: Record<MouthState, string> = {
  REST: 'Relaxed', CLOSED: 'Closed', OPEN: 'Open', WIDE: 'Smile', ROUND: 'Round',
};

export class PreviewScreen implements Screen {
  private timer: number | null = null;
  private frames: Avatar['frames'] | null = null;
  private mounted = false;
  private handedOff = false;
  private bakeVersion = 0;
  private rebakeTimer: number | null = null;

  constructor(
    private readonly store: AvatarStore,
    private readonly neutral: CapturedShot,
    private readonly poses: Record<CapturePose, CapturedShot>,
  ) {}

  async mount(host: HTMLElement, nav: Navigator): Promise<void> {
    this.mounted = true;
    const region = computeMouthRegionFromShots(this.neutral, this.poses);
    const nudges = Object.fromEntries(CAPTURE_POSES.map((pose) => [pose, { dx: 0, dy: 0, scale: 1 }])) as Record<CapturePose, NudgeOffset>;
    let activePose: CapturePose = 'CLOSED';
    let stateIndex = 0;

    const screen = document.createElement('section');
    screen.className = 'screen preview-screen';
    const title = document.createElement('h1');
    title.className = 'h1';
    title.textContent = 'How does it look?';
    const stage = document.createElement('div');
    stage.className = 'avatar-stage preview-stage';
    const canvas = document.createElement('canvas');
    const stateLabel = document.createElement('span');
    stateLabel.className = 'preview-state';
    stateLabel.textContent = 'Getting your face ready…';
    stage.append(canvas, stateLabel);

    const adjust = document.createElement('button');
    adjust.className = 'adjust-toggle';
    adjust.type = 'button';
    adjust.textContent = 'Adjust';
    adjust.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    panel.className = 'adjust-panel';
    panel.hidden = true;
    const poseSelect = document.createElement('select');
    poseSelect.className = 'field-control';
    poseSelect.setAttribute('aria-label', 'Photo to adjust');
    for (const pose of CAPTURE_POSES) {
      const option = document.createElement('option');
      option.value = pose;
      option.textContent = DISPLAY_NAMES[pose];
      poseSelect.append(option);
    }
    panel.append(poseSelect);

    const sliders = new Map<keyof NudgeOffset, HTMLInputElement>();
    const addSlider = (key: keyof NudgeOffset, labelText: string, min: string, max: string, step: string): void => {
      const label = document.createElement('label');
      label.className = 'slider-row';
      const text = document.createElement('span');
      text.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      input.setAttribute('aria-label', `${labelText} adjustment`);
      sliders.set(key, input);
      label.append(text, input);
      panel.append(label);
    };
    addSlider('dx', 'X', '-40', '40', '1');
    addSlider('dy', 'Y', '-40', '40', '1');
    addSlider('scale', 'Size', '0.85', '1.15', '0.01');

    const error = document.createElement('p');
    error.className = 'capture-feedback';
    error.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'preview-actions';
    const good = document.createElement('button');
    good.className = 'btn btn--block';
    good.type = 'button';
    good.textContent = 'Looks Good';
    good.disabled = true;
    const retake = document.createElement('button');
    retake.className = 'btn btn--ghost btn--block';
    retake.type = 'button';
    retake.textContent = 'Retake Photos';
    actions.append(good, retake);
    screen.append(title, stage, adjust, panel, error, actions);
    host.append(screen);

    const draw = (): void => {
      if (!this.frames) return;
      const state = MOUTH_STATES[stateIndex] ?? 'REST';
      const frame = this.frames[state];
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      canvas.getContext('2d')?.drawImage(frame, 0, 0);
      stateLabel.textContent = DISPLAY_NAMES[state];
    };
    const replaceFrames = async (): Promise<void> => {
      const version = ++this.bakeVersion;
      error.textContent = '';
      try {
        const nextFrames = await bake(this.neutral, this.poses, region, nudges);
        if (!this.mounted || version !== this.bakeVersion) {
          MOUTH_STATES.forEach((state) => nextFrames[state].close());
          return;
        }
        if (this.frames) MOUTH_STATES.forEach((state) => this.frames?.[state].close());
        this.frames = nextFrames;
        good.disabled = false;
        draw();
      } catch {
        error.textContent = "We couldn't prepare the preview. Please retake your photos.";
      }
    };
    const syncSliders = (): void => {
      const values = nudges[activePose];
      sliders.get('dx')!.value = String(values.dx);
      sliders.get('dy')!.value = String(values.dy);
      sliders.get('scale')!.value = String(values.scale);
    };
    const scheduleBake = (): void => {
      if (this.rebakeTimer !== null) window.clearTimeout(this.rebakeTimer);
      this.rebakeTimer = window.setTimeout(() => {
        this.rebakeTimer = null;
        void replaceFrames();
      }, 80);
    };
    poseSelect.addEventListener('change', () => {
      activePose = poseSelect.value as CapturePose;
      stateIndex = MOUTH_STATES.indexOf(activePose);
      syncSliders();
      draw();
    });
    for (const [key, input] of sliders) {
      input.addEventListener('input', () => {
        nudges[activePose][key] = Number(input.value);
        scheduleBake();
      });
    }
    adjust.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      adjust.setAttribute('aria-expanded', String(!panel.hidden));
    });
    retake.addEventListener('click', () => void nav.go(new CaptureScreen(this.store), { replace: true }));
    good.addEventListener('click', async () => {
      if (!this.frames) return;
      good.disabled = true;
      good.textContent = 'Saving…';
      const avatar: Avatar = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
        createdAt: Date.now(),
        width: this.neutral.image.width,
        height: this.neutral.image.height,
        frames: this.frames,
        region,
        nudge: nudges,
      };
      try {
        await this.store.saveAvatar(avatar);
        this.handedOff = true;
        await nav.go(new TalkScreen(avatar, this.store), { replace: true });
      } catch {
        error.textContent = "We couldn't save your face. Please try again.";
        good.disabled = false;
        good.textContent = 'Looks Good';
      }
    });

    syncSliders();
    await replaceFrames();
    this.timer = window.setInterval(() => {
      stateIndex = (stateIndex + 1) % MOUTH_STATES.length;
      draw();
    }, 500);
  }

  unmount(): void {
    this.mounted = false;
    this.bakeVersion += 1;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.rebakeTimer !== null) window.clearTimeout(this.rebakeTimer);
    this.rebakeTimer = null;
    this.neutral.image.close();
    CAPTURE_POSES.forEach((pose) => this.poses[pose].image.close());
    if (!this.handedOff && this.frames) MOUTH_STATES.forEach((state) => this.frames?.[state].close());
  }
}
