import { detect } from '../../align/landmarks';
import type { Avatar } from '../../core/types';
import type { AvatarStore } from '../../store/avatarStore';
import type { Navigator, Screen } from '../router';
import { CaptureScreen } from './capture';

export class SettingsScreen implements Screen {
  constructor(private readonly avatar: Avatar, private readonly store: AvatarStore) {}

  mount(host: HTMLElement, nav: Navigator): void {
    const screen = document.createElement('section');
    screen.className = 'screen settings-screen';
    const back = document.createElement('button');
    back.className = 'btn btn--ghost settings-back';
    back.type = 'button';
    back.textContent = 'Back';
    back.addEventListener('click', () => void nav.back());
    const title = document.createElement('h1');
    title.className = 'h1';
    title.textContent = 'Settings';

    const availability = this.store.getPoseAvailability(this.avatar);
    const missingPoses = availability.missing.filter((p) => p !== 'REST');

    let upgradeBtn: HTMLButtonElement | null = null;
    if (missingPoses.length > 0) {
      upgradeBtn = document.createElement('button');
      upgradeBtn.className = 'btn btn--block upgrade-button';
      upgradeBtn.type = 'button';
      upgradeBtn.textContent = 'Improve lip sync';
      upgradeBtn.addEventListener('click', async () => {
        if (!upgradeBtn) return;
        upgradeBtn.disabled = true;
        try {
          const neutralDetection = await detect(this.avatar.frames.REST);
          if (!neutralDetection.landmarks) {
            throw new Error('Could not detect neutral face');
          }
          await nav.go(
            new CaptureScreen(this.store, {
              posesToCapture: missingPoses,
              existingAvatar: this.avatar,
              initialNeutral: {
                image: this.avatar.frames.REST,
                landmarks: neutralDetection.landmarks,
              },
            }),
          );
        } catch {
          upgradeBtn.disabled = false;
        }
      });
    }

    const privacy = document.createElement('div');
    privacy.className = 'settings-card';
    const privacyTitle = document.createElement('h2');
    privacyTitle.textContent = 'Your photos stay private';
    const privacyCopy = document.createElement('p');
    privacyCopy.className = 'hint';
    privacyCopy.textContent = 'Your face photos never leave this device.';
    privacy.append(privacyTitle, privacyCopy);
    const redo = document.createElement('button');
    redo.className = 'btn btn--ghost btn--block danger-button';
    redo.type = 'button';
    redo.textContent = 'Redo Face';
    const confirm = document.createElement('div');
    confirm.className = 'confirm-card';
    confirm.hidden = true;
    const question = document.createElement('p');
    question.textContent = 'Delete this face and take new photos?';
    const confirmActions = document.createElement('div');
    confirmActions.className = 'confirm-actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn--ghost';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const yes = document.createElement('button');
    yes.className = 'btn danger-solid';
    yes.type = 'button';
    yes.textContent = 'Yes, Redo';
    confirmActions.append(cancel, yes);
    confirm.append(question, confirmActions);
    redo.addEventListener('click', () => { confirm.hidden = false; redo.hidden = true; });
    cancel.addEventListener('click', () => { confirm.hidden = true; redo.hidden = false; });
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      try {
        await this.store.clearAvatar();
        Object.values(this.avatar.frames).forEach((frame) => frame.close());
        await nav.go(new CaptureScreen(this.store), { replace: true });
      } catch {
        question.textContent = "We couldn't remove this face. Please try again.";
        yes.disabled = false;
      }
    });

    screen.append(back, title);
    if (upgradeBtn) {
      screen.append(upgradeBtn);
    }
    screen.append(privacy, redo, confirm);
    host.append(screen);
  }
}
