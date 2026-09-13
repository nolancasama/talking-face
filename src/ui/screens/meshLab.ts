import type { Avatar, MouthPose } from '../../core/types';
import { computeAvatarMeshGeometry, type AvatarMeshGeometry } from '../../mesh/geometry';
import { solveMeshTarget, type MeshControls } from '../../mesh/solver';
import { DEFAULT_TOPOLOGY } from '../../mesh/topology';
import { drawMeshFrame } from '../../mesh/warp';
import { isDebugModeEnabled } from '../debugOverlay';
import type { Navigator, Screen } from '../router';

const CONTROL_KEYS = [
  'jawOpen',
  'lipWidth',
  'lipRound',
  'lipClosure',
] as const satisfies readonly (keyof MeshControls)[];

const REFERENCE_POSES = [
  'CLOSED',
  'BIG_OPEN',
  'WIDE',
  'ROUND',
] as const satisfies readonly MouthPose[];

/** DEV-only visual gate for judging landmark mesh deformation by hand. */
export class MeshLabScreen implements Screen {
  private animationFrame: number | null = null;
  private mounted = false;

  constructor(private readonly avatar: Avatar) {}

  async mount(host: HTMLElement, nav: Navigator): Promise<void> {
    if (!isDebugModeEnabled()) return;
    this.mounted = true;

    const screen = document.createElement('section');
    screen.className = 'screen mesh-lab-screen';
    const header = document.createElement('header');
    header.className = 'inspector-header';
    const back = document.createElement('button');
    back.className = 'btn btn--ghost inspector-back';
    back.type = 'button';
    back.textContent = 'Back';
    back.addEventListener('click', () => void nav.back());
    const title = document.createElement('h1');
    title.className = 'h1';
    title.textContent = 'Mesh lab';
    header.append(back, title);

    const status = document.createElement('p');
    status.className = 'talk-status mesh-lab-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Detecting mesh geometry…';
    const notes = document.createElement('div');
    notes.className = 'mesh-lab-notes';
    const stage = document.createElement('div');
    stage.className = 'avatar-stage mesh-lab-stage';
    const canvas = document.createElement('canvas');
    canvas.width = this.avatar.width;
    canvas.height = this.avatar.height;
    canvas.getContext('2d')?.drawImage(this.avatar.frames.REST, 0, 0);
    stage.append(canvas);
    const controlsElement = document.createElement('div');
    controlsElement.className = 'mesh-lab-controls';
    const controlInputs = new Map<keyof MeshControls, HTMLInputElement>();
    const controlOutputs = new Map<keyof MeshControls, HTMLOutputElement>();
    for (const key of CONTROL_KEYS) {
      const row = document.createElement('label');
      row.className = 'mesh-lab-control';
      const name = document.createElement('span');
      name.textContent = key;
      const output = document.createElement('output');
      output.textContent = '0.00';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.value = '0';
      input.disabled = true;
      row.append(name, output, input);
      controlsElement.append(row);
      controlInputs.set(key, input);
      controlOutputs.set(key, output);
    }
    const degenerate = document.createElement('p');
    degenerate.className = 'hint mesh-lab-degenerate';
    degenerate.textContent = 'Degenerate triangles: —';
    screen.append(header, status, notes, stage, controlsElement, degenerate);
    host.append(screen);

    let geometry: AvatarMeshGeometry;
    try {
      geometry = await computeAvatarMeshGeometry(this.avatar);
    } catch (error) {
      if (!this.mounted) return;
      console.error('[mesh-lab] geometry extraction failed', error);
      status.textContent = 'Could not detect mesh geometry in the REST frame.';
      return;
    }
    if (!this.mounted) return;

    for (const pose of REFERENCE_POSES) {
      if (!this.avatar.frames[pose]) appendNote(notes, `${pose} (absent)`);
      else if (!geometry.deltas[pose]) appendNote(notes, `${pose} (detection failed)`);
    }
    if (!notes.hasChildNodes()) appendNote(notes, 'All four reference poses detected.');
    status.textContent = 'Geometry ready. Drag the sliders to judge the warp.';
    for (const input of controlInputs.values()) input.disabled = false;

    const context = canvas.getContext('2d');
    if (!context) {
      status.textContent = 'Canvas 2D is unavailable.';
      return;
    }
    const width = Math.ceil(this.avatar.region.width);
    const height = Math.ceil(this.avatar.region.height);
    const scratch = {
      overlay: new OffscreenCanvas(width, height),
      mask: new OffscreenCanvas(width, height),
    } as const;
    const draw = (): void => {
      this.animationFrame = null;
      const controls = readControls(controlInputs);
      const target = solveMeshTarget(controls, geometry, DEFAULT_TOPOLOGY);
      const result = drawMeshFrame(
        context,
        this.avatar.frames.REST,
        geometry.restPoints,
        target,
        DEFAULT_TOPOLOGY,
        this.avatar.region,
        scratch,
      );
      degenerate.textContent = `Degenerate triangles: ${result.degenerateTriangleCount}`;
    };
    const scheduleDraw = (): void => {
      if (this.animationFrame === null) this.animationFrame = requestAnimationFrame(draw);
    };
    for (const key of CONTROL_KEYS) {
      const input = controlInputs.get(key)!;
      input.addEventListener('input', () => {
        controlOutputs.get(key)!.textContent = Number(input.value).toFixed(2);
        scheduleDraw();
      });
    }
    draw();
  }

  unmount(): void {
    this.mounted = false;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }
}

function readControls(inputs: ReadonlyMap<keyof MeshControls, HTMLInputElement>): MeshControls {
  return {
    jawOpen: Number(inputs.get('jawOpen')?.value ?? 0),
    lipWidth: Number(inputs.get('lipWidth')?.value ?? 0),
    lipRound: Number(inputs.get('lipRound')?.value ?? 0),
    lipClosure: Number(inputs.get('lipClosure')?.value ?? 0),
  };
}

function appendNote(host: HTMLElement, text: string): void {
  const note = document.createElement('span');
  note.textContent = text;
  host.append(note);
}
