// The canonical mouth-pose vocabulary. Every pose name in the application
// comes from here -- no string literals anywhere else.
//
// FROZEN CONTRACT. Capture, baking, storage, mapping, rendering and the debug
// tools are all written against this file.

/** The eleven canonical poses. REST is the untouched neutral selfie. */
export type MouthPose =
  | 'REST'
  | 'CLOSED'
  | 'SMALL_OPEN'
  | 'BIG_OPEN'
  | 'WIDE'
  | 'ROUND'
  | 'OPEN_ROUND'
  | 'TEETH_LIP'
  | 'TH'
  | 'SH_CH'
  | 'L';

/**
 * Capture order. REST first because every other pose is aligned against it.
 *
 * The set is split into a required core and an optional extended tier. Eleven
 * mandatory photographs is a long way to ask a first-time user (a child,
 * often) to walk before they see anything work, and the extended poses are
 * also the hardest to photograph well -- a bad TH frame looks worse than a
 * principled approximation of one. The core alone is a working avatar; the
 * extended poses are an opt-in upgrade, and any of them may be absent.
 *
 * This is the same mechanism that carries a legacy five-pose avatar forward,
 * so it costs nothing extra: an old avatar is simply an eleven-pose avatar
 * with most of the set missing.
 */
export const CORE_POSES: readonly MouthPose[] = [
  'REST', 'CLOSED', 'SMALL_OPEN', 'BIG_OPEN', 'WIDE', 'ROUND',
];

export const EXTENDED_POSES: readonly MouthPose[] = [
  'OPEN_ROUND', 'TEETH_LIP', 'TH', 'SH_CH', 'L',
];

export const ALL_POSES: readonly MouthPose[] = [...CORE_POSES, ...EXTENDED_POSES];

/** Poses the user photographs. REST is the neutral selfie, captured separately. */
export const CAPTURE_POSES: readonly MouthPose[] = ALL_POSES.filter((pose) => pose !== 'REST');

export function isCorePose(pose: MouthPose): boolean {
  return CORE_POSES.includes(pose);
}

/**
 * User-facing capture copy. Deliberately free of phonetic vocabulary -- no
 * "viseme", no "phoneme", no pose id ever reaches the screen.
 */
export interface PoseCapturePrompt {
  /** Friendly name shown as the step title. */
  title: string;
  /** One short instruction. */
  instruction: string;
}

export const POSE_PROMPTS: Readonly<Record<MouthPose, PoseCapturePrompt>> = {
  REST:       { title: 'Relax',      instruction: 'Look straight at the camera and relax your mouth.' },
  CLOSED:     { title: 'Mmm',        instruction: 'Close your lips like you\u2019re saying MMM.' },
  SMALL_OPEN: { title: 'Just a bit', instruction: 'Relax your mouth and open it just a little.' },
  BIG_OPEN:   { title: 'Ahh',        instruction: 'Open your mouth like you\u2019re saying AHH.' },
  WIDE:       { title: 'Eee',        instruction: 'Smile slightly and say EEE.' },
  ROUND:      { title: 'Ooo',        instruction: 'Round your lips like you\u2019re saying OOO.' },
  OPEN_ROUND: { title: 'Oh',         instruction: 'Say OH, with your lips round and open.' },
  TEETH_LIP:  { title: 'Fff',        instruction: 'Rest your top teeth gently on your bottom lip, like FFF.' },
  TH:         { title: 'Th',         instruction: 'Peek your tongue just between your teeth, like TH.' },
  SH_CH:      { title: 'Shh',        instruction: 'Push your lips forward a little and say SHHH.' },
  L:          { title: 'Lll',        instruction: 'Say LLL with your tongue behind your top teeth.' },
};
