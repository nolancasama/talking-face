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
 * Pose tiers. REST first because every other pose is aligned against it.
 *
 * The core/extended split describes the DATA MODEL, not the onboarding UX. The
 * core alone renders a working avatar, and any extended pose may be absent: a
 * legacy five-pose avatar, an avatar saved before onboarding asked for all
 * eleven, or a photo skipped after repeated quality failures. Storage and the
 * renderer must keep tolerating that.
 *
 * First-time onboarding nevertheless asks for every pose in one run -- see
 * ONBOARDING_POSES.
 */
export const CORE_POSES: readonly MouthPose[] = [
  'REST', 'CLOSED', 'SMALL_OPEN', 'BIG_OPEN', 'WIDE', 'ROUND',
];

export const EXTENDED_POSES: readonly MouthPose[] = [
  'OPEN_ROUND', 'TEETH_LIP', 'TH', 'SH_CH', 'L',
];

export const ALL_POSES: readonly MouthPose[] = [...CORE_POSES, ...EXTENDED_POSES];

/**
 * First-time capture sequence: all eleven poses as one continuous run, then
 * preview. Required by the onboarding UX only, never by storage or rendering.
 */
export const ONBOARDING_POSES: readonly MouthPose[] = ALL_POSES;

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
  REST:       { title: 'Relax your face', instruction: 'Look straight ahead and keep your mouth relaxed.' },
  CLOSED:     { title: 'Say MMM',         instruction: 'Press your lips together naturally.' },
  SMALL_OPEN: { title: 'Open a little',   instruction: 'Relax your jaw and open your mouth slightly.' },
  BIG_OPEN:   { title: 'Say AHH',         instruction: 'Open your mouth comfortably wide.' },
  WIDE:       { title: 'Say EEE',         instruction: 'Stretch your lips wide like a smile.' },
  ROUND:      { title: 'Say OOO',         instruction: 'Round your lips forward.' },
  OPEN_ROUND: { title: 'Say OH',          instruction: 'Round your lips while keeping your mouth open.' },
  TEETH_LIP:  { title: 'Say FFF',         instruction: 'Touch your top teeth gently to your lower lip.' },
  TH:         { title: 'Say TH',          instruction: 'Place your tongue lightly between your teeth.' },
  SH_CH:      { title: 'Say SH',          instruction: 'Bring your lips slightly forward, like saying \u201csh.\u201d' },
  // Open slightly: with the lips closed the tongue (the whole point of L) is hidden.
  L:          { title: 'Say LLL',         instruction: 'Open slightly and lift your tongue tip behind your top teeth.' },
};
