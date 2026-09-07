import type { CapturedShot, CapturePose } from '../../core/types';
import { detect } from '../../align/landmarks';
import { checkCapture as checkShot } from '../../align/quality';
import type { AvatarStore } from '../../store/avatarStore';
import type { Navigator, Screen } from '../router';
import { PreviewScreen } from './preview';

const STEPS: ReadonlyArray<{ pose: 'REST' | CapturePose; instruction: string }> = [
  { pose: 'REST', instruction: 'Look straight at the camera and relax your mouth.' },
  { pose: 'CLOSED', instruction: "Close your lips like you're saying MMM." },
  { pose: 'OPEN', instruction: "Open your mouth like you're saying AHH." },
  { pose: 'WIDE', instruction: 'Smile slightly and say EEE.' },
  { pose: 'ROUND', instruction: "Round your lips like you're saying OOO." },
];

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
  poses: Partial<Record<CapturePose, CapturedShot>>;
}

export class CaptureScreen implements Screen {
  private stream: MediaStream | null = null;
  private accepted: CapturedShot | null = null;
  private mounted = false;

  constructor(
    private readonly store: AvatarStore,
    private readonly step = 0,
    private readonly session: CaptureSession = { poses: {} },
  ) {}

  async mount(host: HTMLElement, nav: Navigator): Promise<void> {
    this.mounted = true;
    const item = STEPS[this.step] ?? STEPS[0]!;
    const screen = document.createElement('section');
    screen.className = 'screen capture-screen';

    const header = document.createElement('header');
    header.className = 'capture-header';
    const progress = document.createElement('span');
    progress.className = 'step-pill';
    progress.textContent = `${this.step + 1} / ${STEPS.length}`;
    const instruction = document.createElement('h1');
    instruction.className = 'capture-instruction';
    instruction.textContent = item.instruction;
    header.append(progress, instruction);

    const camera = document.createElement('div');
    camera.className = 'camera-frame';
    const video = document.createElement('video');
    video.className = 'camera-video';
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    const still = document.createElement('canvas');
    still.className = 'camera-still';
    still.hidden = true;
    const oval = document.createElement('div');
    oval.className = 'face-guide';
    oval.setAttribute('aria-hidden', 'true');
    const cameraMessage = document.createElement('div');
    cameraMessage.className = 'camera-message';
    cameraMessage.hidden = true;
    const messageText = document.createElement('p');
    const retryCamera = document.createElement('button');
    retryCamera.className = 'btn btn--ghost';
    retryCamera.type = 'button';
    retryCamera.textContent = 'Try Camera Again';
    cameraMessage.append(messageText, retryCamera);
    camera.append(video, still, oval, cameraMessage);

    const feedback = document.createElement('p');
    feedback.className = 'capture-feedback';
    feedback.setAttribute('role', 'status');

    const actions = document.createElement('div');
    actions.className = 'capture-actions';
    const capture = document.createElement('button');
    capture.className = 'shutter';
    capture.type = 'button';
    capture.setAttribute('aria-label', 'Capture photo');
    capture.disabled = true;
    const after = document.createElement('div');
    after.className = 'after-capture';
    after.hidden = true;
    const retake = document.createElement('button');
    retake.className = 'btn btn--ghost';
    retake.type = 'button';
    retake.textContent = 'Retake';
    const next = document.createElement('button');
    next.className = 'btn';
    next.type = 'button';
    next.textContent = this.step === STEPS.length - 1 ? 'Preview' : 'Next';
    after.append(retake, next);
    actions.append(capture, after);
    screen.append(header, camera, feedback, actions);
    host.append(screen);

    const startCamera = async (): Promise<void> => {
      cameraMessage.hidden = true;
      feedback.textContent = '';
      capture.disabled = true;
      this.releaseCamera();
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (!this.mounted) {
          this.releaseCamera();
          return;
        }
        video.srcObject = this.stream;
        await video.play();
        capture.disabled = false;
      } catch {
        messageText.textContent = 'Camera access is needed to take your photos. Please allow it, then try again.';
        cameraMessage.hidden = false;
      }
    };

    retryCamera.addEventListener('click', () => void startCamera());
    capture.addEventListener('click', async () => {
      if (video.videoWidth === 0 || video.videoHeight === 0) return;
      capture.disabled = true;
      feedback.textContent = 'Checking your photo…';
      const frame = document.createElement('canvas');
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      const context = frame.getContext('2d');
      if (!context) return;
      context.translate(frame.width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, frame.width, frame.height);
      const bitmap = await createImageBitmap(frame);
      try {
        const detection = await detect(bitmap);
        const checked = await checkShot(bitmap, detection, this.session.neutral);
        if (!this.mounted) {
          bitmap.close();
          return;
        }
        if (!checked.ok) {
          feedback.textContent = GUIDANCE[checked.reason];
          bitmap.close();
          capture.disabled = false;
          return;
        }
        this.accepted = checked.shot;
        still.width = bitmap.width;
        still.height = bitmap.height;
        still.getContext('2d')?.drawImage(bitmap, 0, 0);
        still.hidden = false;
        video.hidden = true;
        capture.hidden = true;
        after.hidden = false;
        feedback.textContent = '';
      } catch {
        bitmap.close();
        feedback.textContent = "I couldn't check that photo. Please try again.";
        capture.disabled = false;
      }
    });

    retake.addEventListener('click', () => {
      this.accepted?.image.close();
      this.accepted = null;
      still.hidden = true;
      video.hidden = false;
      capture.hidden = false;
      capture.disabled = false;
      after.hidden = true;
      feedback.textContent = '';
    });

    next.addEventListener('click', () => {
      if (!this.accepted) return;
      if (item.pose === 'REST') this.session.neutral = this.accepted;
      else this.session.poses[item.pose] = this.accepted;
      this.accepted = null;
      if (this.step < STEPS.length - 1) {
        void nav.go(new CaptureScreen(this.store, this.step + 1, this.session), { replace: true });
      } else if (this.session.neutral) {
        void nav.go(new PreviewScreen(this.store, this.session.neutral, this.session.poses as Record<CapturePose, CapturedShot>), { replace: true });
      }
    });

    await startCamera();
  }

  unmount(): void {
    this.mounted = false;
    this.releaseCamera();
    this.accepted?.image.close();
    this.accepted = null;
  }

  private releaseCamera(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
