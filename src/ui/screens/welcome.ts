import type { AvatarStore } from '../../store/avatarStore';
import type { Navigator, Screen } from '../router';
import { CaptureScreen } from './capture';
import './screens.css';

export class WelcomeScreen implements Screen {
  constructor(private readonly store: AvatarStore) {}

  mount(host: HTMLElement, nav: Navigator): void {
    const screen = document.createElement('section');
    screen.className = 'screen welcome-screen';

    const art = document.createElement('div');
    art.className = 'welcome-art';
    art.setAttribute('aria-hidden', 'true');
    art.innerHTML = '<span class="welcome-eye"></span><span class="welcome-eye"></span><span class="welcome-mouth"></span>';

    const title = document.createElement('h1');
    title.className = 'h1 welcome-title';
    title.textContent = 'Create your talking face';

    const copy = document.createElement('p');
    copy.className = 'hint welcome-copy';
    copy.textContent = 'Take five quick photos, then type anything you want your face to say.';

    const start = document.createElement('button');
    start.className = 'btn btn--block welcome-start';
    start.type = 'button';
    start.textContent = 'Start';
    start.addEventListener('click', () => void nav.go(new CaptureScreen(this.store)));

    screen.append(art, title, copy, start);
    host.append(screen);
  }
}
