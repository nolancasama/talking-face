import { buildTimeline } from '../../core/timeline';
import type { Avatar, MouthTimeline, PlaybackClock, SpeechResult, TTSProvider } from '../../core/types';
import { AudioElementClock, ExternalPlaybackClock } from '../../player/clock';
import { LipSyncPlayer } from '../../player/lipSyncPlayer';
import type { AvatarStore } from '../../store/avatarStore';
import { friendlyVoices, pickProvider } from '../../tts';
import { DebugOverlay, isDebugModeEnabled } from '../debugOverlay';
import type { Navigator, Screen } from '../router';
import { InspectorScreen } from './inspector';
import { MeshLabScreen } from './meshLab';
import { SettingsScreen } from './settings';

type CachedSpeech = {
  result: SpeechResult;
  timeline: MouthTimeline;
  clock: PlaybackClock;
  player: LipSyncPlayer;
  text: string;
  voiceId: string;
  speed: number;
};

export class TalkScreen implements Screen {
  private cached: CachedSpeech | null = null;
  private debugOverlay: DebugOverlay | null = null;
  private mounted = false;

  constructor(private readonly avatar: Avatar, private readonly store: AvatarStore) {}

  async mount(host: HTMLElement, nav: Navigator): Promise<void> {
    this.mounted = true;
    let provider: TTSProvider | null = null;
    let playing = false;
    const screen = document.createElement('section');
    screen.className = 'screen talk-screen';
    const top = document.createElement('header');
    top.className = 'talk-header';
    const title = document.createElement('h1');
    title.className = 'talk-title';
    title.textContent = 'Make me talk';
    const settings = document.createElement('button');
    settings.className = 'icon-button';
    settings.type = 'button';
    settings.textContent = 'Settings';
    top.append(title, settings);

    const debugMode = isDebugModeEnabled();
    if (debugMode) {
      const inspector = document.createElement('button');
      inspector.className = 'debug-inspector-link';
      inspector.type = 'button';
      inspector.textContent = 'Inspect frames';
      inspector.addEventListener('click', () => void nav.go(new InspectorScreen(this.avatar)));
      top.insertBefore(inspector, settings);
      const meshLab = document.createElement('button');
      meshLab.className = 'debug-inspector-link';
      meshLab.type = 'button';
      meshLab.textContent = 'Mesh lab';
      meshLab.addEventListener('click', () => void nav.go(new MeshLabScreen(this.avatar)));
      top.insertBefore(meshLab, settings);
    }

    const stage = document.createElement('div');
    stage.className = 'avatar-stage talk-stage';
    const canvas = document.createElement('canvas');
    canvas.width = this.avatar.width;
    canvas.height = this.avatar.height;
    canvas.getContext('2d')?.drawImage(this.avatar.frames.REST, 0, 0);
    stage.append(canvas);
    if (debugMode) {
      this.debugOverlay = new DebugOverlay(() => this.cached
        ? {
          player: this.cached.player,
          timeline: this.cached.timeline,
          timing: this.cached.result.externalPlayback?.timingDebug?.() ?? null,
        }
        : null);
      this.debugOverlay.mount(stage);
    }

    const form = document.createElement('div');
    form.className = 'talk-controls';
    const input = document.createElement('textarea');
    input.className = 'speech-input';
    input.rows = 2;
    input.maxLength = 500;
    input.placeholder = 'Type something for me to say…';
    input.setAttribute('aria-label', 'Words to say');
    const choices = document.createElement('div');
    choices.className = 'talk-choices';
    const voiceLabel = document.createElement('label');
    voiceLabel.className = 'choice-field';
    voiceLabel.append('Voice');
    const voice = document.createElement('select');
    voice.className = 'field-control';
    voice.disabled = true;
    voiceLabel.append(voice);
    const speedLabel = document.createElement('label');
    speedLabel.className = 'choice-field speed-field';
    const speedText = document.createElement('span');
    speedText.textContent = 'Speed';
    const speedValue = document.createElement('output');
    const speed = document.createElement('input');
    speed.type = 'range';
    speed.min = '0.75';
    speed.max = '1.25';
    speed.step = '0.05';
    speed.value = '1';
    speedLabel.append(speedText, speedValue, speed);
    choices.append(voiceLabel, speedLabel);
    const status = document.createElement('p');
    status.className = 'talk-status';
    status.setAttribute('role', 'status');
    const speak = document.createElement('button');
    speak.className = 'btn btn--block speak-button';
    speak.type = 'button';
    speak.textContent = 'Speak';
    speak.disabled = true;
    const replayActions = document.createElement('div');
    replayActions.className = 'replay-actions';
    replayActions.hidden = true;
    const replay = document.createElement('button');
    replay.className = 'btn';
    replay.type = 'button';
    replay.textContent = 'Play Again';
    const edit = document.createElement('button');
    edit.className = 'btn btn--ghost';
    edit.type = 'button';
    edit.textContent = 'Edit Text';
    replayActions.append(replay, edit);
    form.append(input, choices, status, speak, replayActions);
    screen.append(top, stage, form);
    host.append(screen);

    const updateSpeed = (): void => { speedValue.textContent = `${Number(speed.value).toFixed(2)}×`; };
    const updateSpeak = (): void => { speak.disabled = playing || !provider || input.value.trim().length === 0; };
    const disposeCache = (): void => {
      this.cached?.player.stop();
      if (this.cached?.clock instanceof AudioElementClock) this.cached.clock.dispose();
      this.cached = null;
      replayActions.hidden = true;
    };
    const savePrefs = (): void => {
      void this.store.savePrefs({ voiceId: voice.value, speed: Number(speed.value) }).catch(() => {
        status.textContent = "We couldn't remember that choice.";
      });
    };
    const setPlaying = (value: boolean): void => {
      playing = value;
      input.disabled = value;
      voice.disabled = value;
      speed.disabled = value;
      replay.disabled = value;
      edit.disabled = value;
      status.textContent = value ? 'Speaking…' : '';
      replayActions.hidden = value || !this.cached;
      updateSpeak();
    };
    const playCached = async (): Promise<void> => {
      if (!this.cached) return;
      setPlaying(true);
      try {
        await this.cached.player.play();
      } catch {
        this.cached.player.stop();
        setPlaying(false);
        status.textContent = "I couldn't play that. Please try again.";
      }
    };

    input.addEventListener('input', () => {
      disposeCache();
      updateSpeak();
    });
    voice.addEventListener('change', () => { disposeCache(); savePrefs(); updateSpeak(); });
    speed.addEventListener('input', () => { updateSpeed(); disposeCache(); updateSpeak(); });
    speed.addEventListener('change', savePrefs);
    settings.addEventListener('click', () => void nav.go(new SettingsScreen(this.avatar, this.store)));
    edit.addEventListener('click', () => { input.focus(); replayActions.hidden = true; });
    replay.addEventListener('click', () => void playCached());
    speak.addEventListener('click', async () => {
      if (!provider) return;
      const text = input.value.trim();
      if (!text) return;
      disposeCache();
      speak.disabled = true;
      input.disabled = true;
      voice.disabled = true;
      speed.disabled = true;
      status.textContent = 'Getting your words ready…';
      try {
        const result = await provider.generate(text, voice.value, Number(speed.value));
        if (!this.mounted) {
          result.externalPlayback?.stop();
          return;
        }
        const timeline = buildTimeline(result.cues, result.durationMs);
        const clock: PlaybackClock = result.audio
          ? new AudioElementClock(result.audio)
          : new ExternalPlaybackClock(result.externalPlayback!, result.durationMs);
        const player = new LipSyncPlayer(this.avatar, canvas, timeline, clock);
        this.cached = { result, timeline, clock, player, text, voiceId: voice.value, speed: Number(speed.value) };
        clock.onEnd(() => {
          if (!this.mounted) return;
          setPlaying(false);
        });
        await playCached();
      } catch (error) {
        // Friendly copy for the user, real detail for whoever is debugging.
        console.error('[talk] speech generation failed', error);
        setPlaying(false);
        status.textContent = "I couldn't make the speech. Please try again.";
      }
    });

    updateSpeed();
    try {
      const [picked, prefs] = await Promise.all([pickProvider(), this.store.loadPrefs()]);
      provider = picked;
      const voices = await friendlyVoices(picked);
      if (!this.mounted) return;
      if (voices.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Default voice';
        voice.append(option);
      } else {
        for (const item of voices) {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.label;
          voice.append(option);
        }
      }
      voice.value = voices.some((item) => item.id === prefs.voiceId) ? prefs.voiceId : voice.options[0]?.value ?? '';
      speed.value = String(Math.min(1.25, Math.max(0.75, prefs.speed)));
      updateSpeed();
      voice.disabled = false;
      updateSpeak();
    } catch {
      status.textContent = 'Speaking is not available right now.';
    }
  }

  unmount(): void {
    this.mounted = false;
    this.debugOverlay?.destroy();
    this.debugOverlay = null;
    this.cached?.player.stop();
    if (this.cached?.clock instanceof AudioElementClock) this.cached.clock.dispose();
    this.cached = null;
  }
}
