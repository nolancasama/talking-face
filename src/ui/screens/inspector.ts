import { MOUTH_STATES } from '../../core/types';
import type { Avatar, MouthState } from '../../core/types';
import { isDebugModeEnabled } from '../debugOverlay';
import type { Navigator, Screen } from '../router';

type InspectorView = 'grid' | 'flip' | 'difference';

/** DEV-only inspection of the five baked, already-aligned avatar frames. */
export class InspectorScreen implements Screen {
  private selected: MouthState = 'CLOSED';

  constructor(private readonly avatar: Avatar) {}

  mount(host: HTMLElement, nav: Navigator): void {
    if (!isDebugModeEnabled()) return;

    const screen = document.createElement('section');
    screen.className = 'screen inspector-screen';
    const header = document.createElement('header');
    header.className = 'inspector-header';
    const back = document.createElement('button');
    back.className = 'btn btn--ghost inspector-back';
    back.type = 'button';
    back.textContent = 'Back';
    back.addEventListener('click', () => void nav.back());
    const title = document.createElement('h1');
    title.className = 'h1';
    title.textContent = 'Frame inspector';
    header.append(back, title);

    const viewTabs = document.createElement('div');
    viewTabs.className = 'inspector-tabs';
    const panels = new Map<InspectorView, HTMLElement>();

    const grid = document.createElement('div');
    grid.className = 'inspector-grid';
    for (const state of MOUTH_STATES) {
      const card = document.createElement('button');
      card.className = 'inspector-frame-card';
      card.type = 'button';
      const canvas = this.makeFrameCanvas(state);
      const label = document.createElement('span');
      label.textContent = state;
      card.append(canvas, label);
      card.addEventListener('click', () => {
        this.selected = state;
        showView('flip');
      });
      grid.append(card);
    }
    panels.set('grid', grid);

    const flip = document.createElement('div');
    flip.className = 'inspector-detail';
    const flipCanvas = this.makeFrameCanvas(this.selected, 'inspector-large-canvas');
    const flipLabel = document.createElement('strong');
    const flipButtons = this.makeStateButtons((state) => {
      this.selected = state;
      this.drawFrame(flipCanvas, state);
      flipLabel.textContent = state;
    });
    flip.append(flipLabel, flipCanvas, flipButtons);
    panels.set('flip', flip);

    const difference = document.createElement('div');
    difference.className = 'inspector-detail';
    const differenceLabel = document.createElement('strong');
    const differenceCanvas = document.createElement('canvas');
    differenceCanvas.className = 'inspector-large-canvas inspector-difference-canvas';
    differenceCanvas.width = this.avatar.width;
    differenceCanvas.height = this.avatar.height;
    const differenceHint = document.createElement('p');
    differenceHint.className = 'hint inspector-hint';
    differenceHint.textContent = 'Pixel difference from REST. Aligned, unchanged areas should be near black.';
    const differenceButtons = this.makeStateButtons((state) => {
      this.selected = state;
      differenceLabel.textContent = `${state} − REST`;
      this.drawDifference(differenceCanvas, state);
    });
    difference.append(differenceLabel, differenceCanvas, differenceHint, differenceButtons);
    panels.set('difference', difference);

    const content = document.createElement('div');
    content.className = 'inspector-content';
    const showView = (view: InspectorView): void => {
      for (const [name, panel] of panels) panel.hidden = name !== view;
      for (const button of viewTabs.querySelectorAll<HTMLButtonElement>('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.view === view));
      }
      if (view === 'flip') {
        flipLabel.textContent = this.selected;
        this.drawFrame(flipCanvas, this.selected);
      } else if (view === 'difference') {
        differenceLabel.textContent = `${this.selected} − REST`;
        this.drawDifference(differenceCanvas, this.selected);
      }
    };

    const tabLabels: ReadonlyArray<[InspectorView, string]> = [
      ['grid', 'Grid'],
      ['flip', 'Flip'],
      ['difference', 'Difference'],
    ];
    for (const [view, label] of tabLabels) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.view = view;
      button.textContent = label;
      button.addEventListener('click', () => showView(view));
      viewTabs.append(button);
    }

    content.append(grid, flip, difference);
    screen.append(header, viewTabs, content);
    host.append(screen);
    showView('grid');
  }

  private makeFrameCanvas(state: MouthState, className = ''): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = className;
    canvas.width = this.avatar.width;
    canvas.height = this.avatar.height;
    this.drawFrame(canvas, state);
    return canvas;
  }

  private drawFrame(canvas: HTMLCanvasElement, state: MouthState): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.globalAlpha = 1;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(this.avatar.frames[state], 0, 0, canvas.width, canvas.height);
  }

  private makeStateButtons(onSelect: (state: MouthState) => void): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'inspector-state-buttons';
    for (const state of MOUTH_STATES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = state;
      button.addEventListener('click', () => onSelect(state));
      controls.append(button);
    }
    return controls;
  }

  private drawDifference(canvas: HTMLCanvasElement, state: MouthState): void {
    const restCanvas = document.createElement('canvas');
    const stateCanvas = document.createElement('canvas');
    restCanvas.width = stateCanvas.width = this.avatar.width;
    restCanvas.height = stateCanvas.height = this.avatar.height;
    const restContext = restCanvas.getContext('2d', { willReadFrequently: true });
    const stateContext = stateCanvas.getContext('2d', { willReadFrequently: true });
    const output = canvas.getContext('2d');
    if (!restContext || !stateContext || !output) return;

    restContext.drawImage(this.avatar.frames.REST, 0, 0, this.avatar.width, this.avatar.height);
    stateContext.drawImage(this.avatar.frames[state], 0, 0, this.avatar.width, this.avatar.height);
    const restPixels = restContext.getImageData(0, 0, this.avatar.width, this.avatar.height);
    const statePixels = stateContext.getImageData(0, 0, this.avatar.width, this.avatar.height);
    const result = output.createImageData(this.avatar.width, this.avatar.height);
    for (let index = 0; index < result.data.length; index += 4) {
      result.data[index] = Math.abs(statePixels.data[index]! - restPixels.data[index]!);
      result.data[index + 1] = Math.abs(statePixels.data[index + 1]! - restPixels.data[index + 1]!);
      result.data[index + 2] = Math.abs(statePixels.data[index + 2]! - restPixels.data[index + 2]!);
      result.data[index + 3] = 255;
    }
    output.putImageData(result, 0, 0);
  }
}
