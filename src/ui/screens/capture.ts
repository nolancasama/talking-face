import { ONBOARDING_POSES, POSE_PROMPTS } from '../../core/poses';
import type { Avatar, CapturedShot, MouthPose } from '../../core/types';
import { detect } from '../../align/landmarks';
import { checkCapture as checkShot } from '../../align/quality';
import type { AvatarStore } from '../../store/avatarStore';
import type { Navigator, Screen } from '../router';
import { advanceAfter, canSkip, nextButtonLabel, progressLabel } from './captureFlow';
import { PreviewScreen } from './preview';

const GUIDANCE = {
  'no-face': "I can't see your face - move a bit closer.",
  'multiple-faces': 'Looks like more than one face. Try again on your own.',
  'too-dark': "It's a bit dark - try facing a window.",
  'not-frontal': 'Turn to face the camera straight on.',
  'scale-mismatch': 'Try holding the phone about where you held it last time.',
  'too-blurry': 'That came out blurry - hold still a moment.',
} as const;

/** Every pose is registered against REST: only the mouth should move. */
const HOLD_STILL_HINT = 'Keep your head still — only your mouth moves.';

export interface CaptureSession {
  neutral?: CapturedShot;
  poses: Partial<Record<MouthPose, CapturedShot>>;
}

export interface CaptureScreenOptions {
  /** Upgrade mode: capture only these poses for an existing avatar. */
  posesToCapture?: readonly MouthPose[];
  existingAvatar?: Avatar;
  initialNeutral?: CapturedShot;
}

export class CaptureScreen implements Screen {
  private stream: MediaStream | null = null;
  private accepted: CapturedShot | null = null;
  private mounted = false;
  private readonly posesToCapture: readonly MouthPose[];
  private readonly existingAvatar?: Avatar;
  private readonly session: CaptureSession;
  private stepIndex = 0;
  /** Quality-gate rejections on the current pose, for the skip offer. */
  private consecutiveFailures = 0;
  private videoEl!: HTMLVideoElement;
  private stillEl!: HTMLCanvasElement;
  private cameraMessageEl!: HTMLElement;
  private messageTextEl!: HTMLElement;
  private feedbackEl!: HTMLElement;
  private skipBtn!: HTMLButtonElement;
  private captureBtn!: HTMLButtonElement;
  private afterEl!: HTMLElement;
  private nextBtn!: HTMLButtonElement;
  private stepPillEl!: HTMLElement;
  private dotsContainerEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private instructionEl!: HTMLElement;
  private nav!: Navigator;

  constructor(
    private readonly store: AvatarStore,
    options?: CaptureScreenOptions,
  ) {
    this.existingAvatar = options?.existingAvatar;
    this.posesToCapture = options?.posesToCapture?.length ? options.posesToCapture : ONBOARDING_POSES;
    this.session = {
      neutral: options?.initialNeutral,
      poses: {},
    };
  }

  async mount(host: HTMLElement, nav: Navigator): Promise<void> {
    this.mounted = true;
    this.nav = nav;

    const screen = document.createElement('section');
    screen.className = 'screen capture-screen';

    const header = document.createElement('header');
    header.className = 'capture-header';
    const headerMeta = document.createElement('div');
    headerMeta.className = 'capture-header-meta';
    this.stepPillEl = document.createElement('span');
    this.stepPillEl.className = 'step-pill';
    this.dotsContainerEl = document.createElement('div');
    this.dotsContainerEl.className = 'progress-dots';
    this.dotsContainerEl.setAttribute('aria-hidden', 'true');
    headerMeta.append(this.stepPillEl, this.dotsContainerEl);

    this.titleEl = document.createElement('h1');
    this.titleEl.className = 'capture-instruction';
    this.instructionEl = document.createElement('p');
    this.instructionEl.className = 'capture-detail';
    header.append(headerMeta, this.titleEl, this.instructionEl);

    const cameraFrame = document.createElement('div');
    cameraFrame.className = 'camera-frame';
    this.videoEl = document.createElement('video');
    this.videoEl.className = 'camera-video';
    this.videoEl.autoplay = true;
    this.videoEl.muted = true;
    this.videoEl.playsInline = true;
    this.stillEl = document.createElement('canvas');
    this.stillEl.className = 'camera-still';
    this.stillEl.hidden = true;
    const oval = document.createElement('div');
    oval.className = 'face-guide';
    oval.setAttribute('aria-hidden', 'true');
    this.cameraMessageEl = document.createElement('div');
    this.cameraMessageEl.className = 'camera-message';
    this.cameraMessageEl.hidden = true;
    this.messageTextEl = document.createElement('p');
    const retryCamera = document.createElement('button');
    retryCamera.className = 'btn btn--ghost';
    retryCamera.type = 'button';
    retryCamera.textContent = 'Try Camera Again';
    this.cameraMessageEl.append(this.messageTextEl, retryCamera);
    cameraFrame.append(this.videoEl, this.stillEl, oval, this.cameraMessageEl);

    this.feedbackEl = document.createElement('p');
    this.feedbackEl.className = 'capture-feedback';
    this.feedbackEl.setAttribute('role', 'status');

    // Deliberately quiet: the normal path is always "capture this pose".
    this.skipBtn = document.createElement('button');
    this.skipBtn.className = 'capture-skip';
    this.skipBtn.type = 'button';
    this.skipBtn.textContent = 'Skip this photo';
    this.skipBtn.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'capture-actions';
    this.captureBtn = document.createElement('button');
    this.captureBtn.className = 'shutter';
    this.captureBtn.type = 'button';
    this.captureBtn.setAttribute('aria-label', 'Capture photo');
    this.captureBtn.disabled = true;
    this.afterEl = document.createElement('div');
    this.afterEl.className = 'after-capture';
    this.afterEl.hidden = true;
    const retake = document.createElement('button');
    retake.className = 'btn btn--ghost';
    retake.type = 'button';
    retake.textContent = 'Retake';
    this.nextBtn = document.createElement('button');
    this.nextBtn.className = 'btn';
    this.nextBtn.type = 'button';
    this.nextBtn.textContent = 'Next';
    this.afterEl.append(retake, this.nextBtn);
    actions.append(this.captureBtn, this.afterEl);

    screen.append(header, cameraFrame, this.feedbackEl, this.skipBtn, actions);
    host.append(screen);

    retryCamera.addEventListener('click', () => void this.startCamera());
    this.captureBtn.addEventListener('click', () => void this.takePhoto());
    retake.addEventListener('click', () => this.handleRetake());
    this.nextBtn.addEventListener('click', () => this.handleNext());
    this.skipBtn.addEventListener('click', () => this.handleSkip());

    this.updateStepUI();
    await this.startCamera();
  }

  unmount(): void {
    this.mounted = false;
    this.releaseCamera();
    this.accepted?.image.close();
    this.accepted = null;
  }

  private currentPose(): MouthPose {
    return this.posesToCapture[this.stepIndex] ?? 'REST';
  }

  private updateStepUI(): void {
    const prompt = POSE_PROMPTS[this.currentPose()];
    const totalSteps = this.posesToCapture.length;

    this.stepPillEl.textContent = progressLabel(this.stepIndex, totalSteps);
    this.titleEl.textContent = prompt.title;
    this.instructionEl.textContent = prompt.instruction;

    this.dotsContainerEl.replaceChildren();
    for (let i = 0; i < totalSteps; i++) {
      const dot = document.createElement('span');
      dot.className = 'progress-dot';
      if (i < this.stepIndex) {
        dot.classList.add('completed');
      } else if (i === this.stepIndex) {
        dot.classList.add('active');
      }
      this.dotsContainerEl.append(dot);
    }

    this.nextBtn.textContent = nextButtonLabel(this.stepIndex, totalSteps);
    this.consecutiveFailures = 0;
    this.setFeedback('');
    this.updateSkip();
  }

  /** Show a message, or the hold-still hint when there is nothing else to say. */
  private setFeedback(text: string): void {
    this.feedbackEl.textContent = text || (this.currentPose() === 'REST' ? '' : HOLD_STILL_HINT);
  }

  private updateSkip(): void {
    this.skipBtn.hidden = this.accepted !== null || !canSkip(this.currentPose(), this.consecutiveFailures);
  }

  private async startCamera(): Promise<void> {
    this.cameraMessageEl.hidden = true;
    this.setFeedback('');
    this.captureBtn.disabled = true;

    if (!this.stream || !this.stream.active || this.stream.getVideoTracks().every((t) => t.readyState === 'ended')) {
      this.releaseCamera();
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
      } catch {
        if (!this.mounted) return;
        this.messageTextEl.textContent = 'Camera access is needed to take your photos. Please allow it, then try again.';
        this.cameraMessageEl.hidden = false;
        return;
      }
    }

    if (!this.mounted) {
      this.releaseCamera();
      return;
    }

    try {
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this.captureBtn.disabled = false;
    } catch {
      this.messageTextEl.textContent = 'Camera access is needed to take your photos. Please allow it, then try again.';
      this.cameraMessageEl.hidden = false;
    }
  }

  private async takePhoto(): Promise<void> {
    if (this.videoEl.videoWidth === 0 || this.videoEl.videoHeight === 0) return;
    this.captureBtn.disabled = true;
    this.feedbackEl.textContent = 'Checking your photo…';

    const frame = document.createElement('canvas');
    frame.width = this.videoEl.videoWidth;
    frame.height = this.videoEl.videoHeight;
    const context = frame.getContext('2d');
    if (!context) return;
    context.translate(frame.width, 0);
    context.scale(-1, 1);
    context.drawImage(this.videoEl, 0, 0, frame.width, frame.height);
    const bitmap = await createImageBitmap(frame);

    try {
      const detection = await detect(bitmap);
      const neutralReference = this.session.neutral;
      const checked = await checkShot(bitmap, detection, neutralReference);
      if (!this.mounted) {
        bitmap.close();
        return;
      }
      if (!checked.ok) {
        bitmap.close();
        this.rejectPhoto(GUIDANCE[checked.reason]);
        return;
      }
      this.accepted = checked.shot;
      this.stillEl.width = bitmap.width;
      this.stillEl.height = bitmap.height;
      this.stillEl.getContext('2d')?.drawImage(bitmap, 0, 0);
      this.stillEl.hidden = false;
      this.videoEl.hidden = true;
      this.captureBtn.hidden = true;
      this.afterEl.hidden = false;
      this.setFeedback('');
      this.updateSkip();
    } catch {
      bitmap.close();
      this.rejectPhoto("I couldn't check that photo. Please try again.");
    }
  }

  private rejectPhoto(message: string): void {
    this.consecutiveFailures += 1;
    this.setFeedback(message);
    this.captureBtn.disabled = false;
    this.updateSkip();
  }

  private handleRetake(): void {
    this.accepted?.image.close();
    this.accepted = null;
    this.showLiveCamera();
    this.setFeedback('');
    this.updateSkip();
  }

  private handleNext(): void {
    if (!this.accepted) return;
    const pose = this.currentPose();
    if (pose === 'REST') {
      this.session.neutral = this.accepted;
    } else {
      this.session.poses[pose] = this.accepted;
    }
    this.accepted = null;
    this.advance();
  }

  /** Leave this pose absent; storage and rendering already tolerate that. */
  private handleSkip(): void {
    if (this.accepted || !canSkip(this.currentPose(), this.consecutiveFailures)) return;
    this.advance();
  }

  private advance(): void {
    const step = advanceAfter(this.stepIndex, this.posesToCapture);
    if (step.kind === 'preview') {
      this.finishCapture();
      return;
    }
    this.stepIndex = step.stepIndex;
    this.showLiveCamera();
    this.updateStepUI();
  }

  private showLiveCamera(): void {
    this.stillEl.hidden = true;
    this.videoEl.hidden = false;
    this.captureBtn.hidden = false;
    this.captureBtn.disabled = false;
    this.afterEl.hidden = true;
  }

  private finishCapture(): void {
    if (!this.session.neutral) return;
    this.releaseCamera();
    void this.nav.go(
      new PreviewScreen(this.store, this.session.neutral, this.session.poses, this.existingAvatar),
      { replace: true },
    );
  }

  private releaseCamera(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
