// FROZEN CONTRACT. Every module below src/ implements or consumes these types.
// Do not change a signature here without updating DESIGN_DECISIONS.md first --
// four independent modules are written against this file.

/** The five visual states an avatar can be in. REST is the untouched selfie. */
export type MouthState = 'REST' | 'CLOSED' | 'OPEN' | 'WIDE' | 'ROUND';

/** The four poses the user photographs in addition to the neutral selfie. */
export type CapturePose = 'CLOSED' | 'OPEN' | 'WIDE' | 'ROUND';

export const MOUTH_STATES: readonly MouthState[] = ['REST', 'CLOSED', 'OPEN', 'WIDE', 'ROUND'];
export const CAPTURE_POSES: readonly CapturePose[] = ['CLOSED', 'OPEN', 'WIDE', 'ROUND'];

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/** A single photo taken by AvatarCapture, before any alignment work. */
export interface CapturedShot {
  /** Full-frame photo, already mirrored to match what the user saw on screen. */
  image: ImageBitmap;
  /** Landmarks detected in THIS shot's own pixel space. */
  landmarks: FaceLandmarks;
}

/**
 * Landmark subset the alignment maths actually needs, in source-image pixels.
 *
 * `rigid` must contain ONLY anatomy that does not move while speaking. Solving
 * the pose transform from lip points would cancel out the very difference the
 * overlay is meant to carry -- and points near the nostrils and upper lip are
 * not safe either: an exaggerated OOO purse or a dropped AHH jaw drags
 * subnasale and the alar base by a visible amount. The set is therefore eye
 * corners plus the bony mid-dorsum of the nose, and it is over-determined so a
 * least-squares (Umeyama) fit can absorb per-point landmark jitter.
 */
export interface FaceLandmarks {
  /**
   * Immobile anchors, at least 4 points, conventionally:
   * [leftEyeOuter, leftEyeInner, rightEyeInner, rightEyeOuter, noseBridge].
   * noseBridge is mid-dorsum -- between the eye line and the tip, on bone --
   * NOT subnasale and NOT the alar base.
   */
  rigid: readonly Point[];
  /** Full outer-lip contour, used to size the crop and nothing else. */
  lipContour: readonly Point[];
  /** Lowest point of the chin; the crop must reach at least this far down. */
  chin: Point;
  /** Degrees. Capture gates reject shots that are too far off frontal. */
  roll: number;
  yaw: number;
}

export interface Point { x: number; y: number }

/** Why a capture attempt was refused. Surfaced to the user as friendly copy. */
export type CaptureRejection =
  | 'no-face'
  | 'multiple-faces'
  | 'too-dark'
  | 'not-frontal'
  | 'scale-mismatch'   // face size drifted too far from the neutral selfie
  | 'too-blurry';

export type CaptureCheck =
  | { ok: true; shot: CapturedShot }
  | { ok: false; reason: CaptureRejection };

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

/**
 * Similarity transform (translate + rotate + uniform scale) mapping a pose
 * photo's pixel space into the neutral selfie's pixel space. Solved by
 * least-squares (Umeyama) over `FaceLandmarks.rigid` only.
 */
export interface SimilarityTransform {
  scale: number;
  /** Radians. */
  rotation: number;
  tx: number;
  ty: number;
}

/**
 * The overlay rectangle, expressed in NEUTRAL-selfie pixel coordinates. It is
 * mouth-centred but deliberately over-tall: it must reach the chin, because a
 * dropped jaw in the OPEN pose has to replace the base photo's closed chin.
 */
export interface MouthRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Feather width in px for the alpha mask that hides the rectangle edges. */
  feather: number;
}

/** User-facing correction from the preview screen's Adjust panel. */
export interface NudgeOffset {
  dx: number;
  dy: number;
  scale: number;
}

export const NO_NUDGE: NudgeOffset = { dx: 0, dy: 0, scale: 1 };

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

/**
 * A finished avatar. All five states are persisted as FULLY RENDERED frames --
 * base selfie with the aligned, masked mouth already blended in -- so steady
 * playback is a single drawImage per frame, and only a crossfade costs two
 * (outgoing and incoming at complementary alpha). No network, no landmarks and
 * no maths at play time.
 */
export interface Avatar {
  id: string;
  createdAt: number;
  width: number;
  height: number;
  frames: Record<MouthState, ImageBitmap>;
  region: MouthRegion;
  nudge: Record<CapturePose, NudgeOffset>;
}

/** Storage form of an Avatar. Raw pose photos are deliberately NOT retained. */
export interface StoredAvatar {
  id: string;
  createdAt: number;
  width: number;
  height: number;
  frames: Record<MouthState, Blob>;
  region: MouthRegion;
  nudge: Record<CapturePose, NudgeOffset>;
}

export interface Preferences {
  voiceId: string;
  speed: number;
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

export interface Voice {
  /** Provider-native id. Never shown to the user. */
  id: string;
  /** Friendly name, e.g. "Female 1". */
  label: string;
}

/** One timing event from a provider, already normalised to our vocabulary. */
export interface SpeechCue {
  startMs: number;
  endMs: number;
  /**
   * Either a provider viseme id (`{ kind: 'viseme' }`) or a phoneme symbol.
   * VisemeMapper is the only place allowed to interpret this.
   */
  token: SpeechToken;
}

export type SpeechToken =
  | { kind: 'viseme'; provider: string; id: number }
  | { kind: 'phoneme'; symbol: string }
  | { kind: 'silence' };

export interface SpeechResult {
  /**
   * Decodable audio, when the provider gives us one. `null` means the provider
   * plays speech itself (speechSynthesis) and the player must use its clock.
   */
  audio: Blob | null;
  durationMs: number;
  cues: SpeechCue[];
  /** Set when the provider owns playback rather than handing us audio. */
  externalPlayback?: ExternalPlayback;
}

/** A provider that speaks for itself, e.g. the Web Speech fallback. */
export interface ExternalPlayback {
  start(): void;
  stop(): void;
  /** Best-effort position in ms; may be interpolated from boundary events. */
  positionMs(): number;
  onEnd(cb: () => void): void;
}

export interface TTSProvider {
  readonly name: string;
  /** Whether this provider can run right now (credentials present, online). */
  available(): Promise<boolean>;
  voices(): Promise<Voice[]>;
  generate(text: string, voiceId: string, speed: number): Promise<SpeechResult>;
}

// ---------------------------------------------------------------------------
// Lip sync
// ---------------------------------------------------------------------------

/** A resolved, merged span of one mouth state. */
export interface MouthSpan {
  startMs: number;
  endMs: number;
  mouth: MouthState;
}

export type MouthTimeline = readonly MouthSpan[];

/**
 * The player's only notion of time. Generalised away from HTMLAudioElement so
 * a provider that owns its own playback can drive the same renderer.
 */
export interface PlaybackClock {
  nowMs(): number;
  playing(): boolean;
  durationMs(): number;
  start(): Promise<void>;
  stop(): void;
  onEnd(cb: () => void): void;
}
