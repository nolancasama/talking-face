import { CORE_POSES, EXTENDED_POSES, POSE_PROMPTS } from '../../core/poses';
import type { Avatar, CapturedShot, MouthPose } from '../../core/types';
import { detect } from '../../align/landmarks';
import { checkCapture as checkShot } from '../../align/quality';
import type { AvatarStore } from '../../store/avatarStore';
import type { Navigator, Screen } from '../router';
import { PreviewScreen } from './preview';

const GUIDANCE = {
  'no-face': "I can't see your face - move a bit closer.",
  'multiple-faces': 'Looks like more than one face. Try again on your own.',
  'too-dark': "It's a bit dark - try facing a window.",
  'not-frontal': 'Turn to face the camera straight on.',
  'scale-mismatch': 'Try holding the phone about where you held it last time.',
  'too-blurry': 'That came out blurry - hold still a moment.',
} as const;

export interface CaptureSession {
  neutral?: CapturedShot;
  poses: Partial<Record<MouthPose, CapturedShot>>;
}

export interface CaptureScreenOptions {
  posesToCapture?: readonly MouthPose[];
  existingAvatar?: Avatar;
  initialNeutral?: CapturedShot;
}

export class CaptureScreen implements Screen {
  private stream: MediaStream | null = null;
  private accepted: CapturedShot | null = null;
  private mounted = false;
  private posesToCapture: readonly MouthPose[];
  private readonly existingAvatar?: Avatar;
  private readonly session: CaptureSession;
  private stepIndex = 0;
  private isUpgradeMode = false;
  private videoEl!: HTMLVideoElement;
  private stillEl!: HTMLCanvasElement;
  private cameraMessageEl!: HTMLElement;
  private messageTextEl!: HTMLElement;
  private feedbackEl!: HTMLElement;
  private captureBtn!: HTMLButtonElement;
  private afterEl!: HTMLElement;
  private nextBtn!: HTMLButtonElement;
  private stepPillEl!: HTMLElement;
  private dotsContainerEl!: HTMLElement;
  private instructionEl!: HTMLElement;
  private decisionCardEl!: HTMLElement;
  private cameraFrameEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private nav!: Navigator;

  constructor(
    private readonly store: AvatarStore,
    options?: CaptureScreenOptions,
  ) {
    this.existingAvatar = options?.existingAvatar;
    this.isUpgradeMode = Boolean(options?.posesToCapture && options.posesToCapture.length > 0);
    this.posesToCapture = options?.posesToCapture ?? [...CORE_POSES];
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
    headerMeta.append(this.stepPillEl, this.dotsContainerEl);

    this.instructionEl = document.createElement('h1');
    this.instructionEl.className = 'capture-instruction';
    header.append(headerMeta, this.instructionEl);

    this.cameraFrameEl = document.createElement('div');
    this.cameraFrameEl.className = 'camera-frame';
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
    this.cameraFrameEl.append(this.videoEl, this.stillEl, oval, this.cameraMessageEl);

    this.decisionCardEl = document.createElement('div');
    this.decisionCardEl.className = 'capture-decision-card';
    this.decisionCardEl.hidden = true;
    const decisionTitle = document.createElement('h2');
    decisionTitle.textContent = 'Your talking face is ready!';
    const decisionCopy = document.createElement('p');
    decisionCopy.textContent = 'You can use it now, or take a few extra photos for even better lip sync.';
    const decisionActions = document.createElement('div');
    decisionActions.className = 'capture-decision-actions';
    const finishBtn = document.createElement('button');
    finishBtn.className = 'btn btn--block';
    finishBtn.type = 'button';
    finishBtn.textContent = 'Finish and Preview';
    const continueBtn = document.createElement('button');
    continueBtn.className = 'btn btn--ghost btn--block';
    continueBtn.type = 'button';
    continueBtn.textContent = 'Add Extra Lip Shapes';
    decisionActions.append(finishBtn, continueBtn);
    this.decisionCardEl.append(decisionTitle, decisionCopy, decisionActions);

    this.feedbackEl = document.createElement('p');
    this.feedbackEl.className = 'capture-feedback';
    this.feedbackEl.setAttribute('role', 'status');

    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'capture-actions';
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
    this.actionsEl.append(this.captureBtn, this.afterEl);

    screen.append(header, this.cameraFrameEl, this.decisionCardEl, this.feedbackEl, this.actionsEl);
    host.append(screen);

    retryCamera.addEventListener('click', () => void this.startCamera());
    this.captureBtn.addEventListener('click', () => void this.takePhoto());
    retake.addEventListener('click', () => this.handleRetake());
    this.nextBtn.addEventListener('click', () => this.handleNext());

    finishBtn.addEventListener('click', () => {
      this.finishCapture();
    });

    continueBtn.addEventListener('click', () => {
      this.startExtendedRun();
    });

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
    const pose = this.currentPose();
    const prompt = POSE_PROMPTS[pose];
    const totalSteps = this.posesToCapture.length;
    const currentStepNum = this.stepIndex + 1;

    this.stepPillEl.textContent = `${currentStepNum} / ${totalSteps}`;
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

    const isLastStep = this.stepIndex === totalSteps - 1;
    if (this.isUpgradeMode) {
      this.nextBtn.textContent = isLastStep ? 'Preview' : 'Next';
    } else if (totalSteps === CORE_POSES.length) {
      this.nextBtn.textContent = isLastStep ? 'Done' : 'Next';
    } else {
      this.nextBtn.textContent = isLastStep ? 'Preview' : 'Next';
    }
  }

  private async startCamera(): Promise<void> {
    this.cameraMessageEl.hidden = true;
    this.feedbackEl.textContent = '';
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
        this.feedbackEl.textContent = GUIDANCE[checked.reason];
        bitmap.close();
        this.captureBtn.disabled = false;
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
      this.feedbackEl.textContent = '';
    } catch {
      bitmap.close();
      this.feedbackEl.textContent = "I couldn't check that photo. Please try again.";
      this.captureBtn.disabled = false;
    }
  }

  private handleRetake(): void {
    this.accepted?.image.close();
    this.accepted = null;
    this.stillEl.hidden = true;
    this.videoEl.hidden = false;
    this.captureBtn.hidden = false;
    this.captureBtn.disabled = false;
    this.afterEl.hidden = true;
    this.feedbackEl.textContent = '';
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

    if (this.stepIndex < this.posesToCapture.length - 1) {
      this.stepIndex += 1;
      this.stillEl.hidden = true;
      this.videoEl.hidden = false;
      this.captureBtn.hidden = false;
      this.captureBtn.disabled = false;
      this.afterEl.hidden = true;
      this.feedbackEl.textContent = '';
      this.updateStepUI();
    } else {
      // Completed the active run
      if (!this.isUpgradeMode && this.posesToCapture.length === CORE_POSES.length) {
        // Just finished the 6 core poses! Show decision point
        this.showDecisionPoint();
      } else {
        this.finishCapture();
      }
    }
  }

  private showDecisionPoint(): void {
    this.cameraFrameEl.hidden = true;
    this.actionsEl.hidden = true;
    this.feedbackEl.textContent = '';
    this.instructionEl.textContent = 'Ready to preview!';
    this.decisionCardEl.hidden = false;
  }

  private startExtendedRun(): void {
    this.decisionCardEl.hidden = true;
    this.cameraFrameEl.hidden = false;
    this.actionsEl.hidden = false;
    this.posesToCapture = [...EXTENDED_POSES];
    this.stepIndex = 0;
    this.stillEl.hidden = true;
    this.videoEl.hidden = false;
    this.captureBtn.hidden = false;
    this.captureBtn.disabled = false;
    this.afterEl.hidden = true;
    this.feedbackEl.textContent = '';
    this.updateStepUI();
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
