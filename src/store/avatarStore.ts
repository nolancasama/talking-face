// Local persistence. One avatar, no accounts, no cloud. Frames are stored as
// Blobs (structured-cloneable and compact) and rehydrated to ImageBitmap on
// load, which is the form the renderer wants.
import { ALL_POSES } from '../core/types';
import type {
  Avatar,
  MouthPose,
  NudgeOffset,
  Preferences,
  StoredAvatar,
} from '../core/types';

const DB_NAME = 'talking-face';
const DB_VERSION = 1;
const AVATARS = 'avatars';
const PREFS = 'prefs';
const AVATAR_KEY = 'current';
const PREFS_KEY = 'prefs';
const CURRENT_SCHEMA_VERSION = 2;

const DEFAULT_PREFS: Preferences = { voiceId: '', speed: 1 };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AVATARS)) db.createObjectStore(AVATARS);
      if (!db.objectStoreNames.contains(PREFS)) db.createObjectStore(PREFS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

/** Encode one fully opaque composited photograph. */
async function encode(frame: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(frame, 0, 0);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

type LegacyMouthPose = 'REST' | 'CLOSED' | 'OPEN' | 'WIDE' | 'ROUND';

export interface LegacyStoredAvatarV1 {
  readonly schemaVersion?: 1;
  readonly id: string;
  readonly createdAt: number;
  readonly width: number;
  readonly height: number;
  readonly frames: Partial<Record<LegacyMouthPose, Blob>> & { REST: Blob };
  readonly region: StoredAvatar['region'];
  readonly nudge: Partial<Record<LegacyMouthPose, NudgeOffset>>;
}

type PersistedAvatar = StoredAvatar | LegacyStoredAvatarV1;

export interface AvatarPoseAvailability {
  readonly available: readonly MouthPose[];
  readonly missing: readonly MouthPose[];
}

function poseKeys<T>(frames: Partial<Record<MouthPose, T>>): MouthPose[] {
  return ALL_POSES.filter((pose) => frames[pose] !== undefined);
}

/** Return a version-2 view without mutating or rewriting the persisted record. */
export function migrateStoredAvatar(stored: PersistedAvatar): StoredAvatar {
  if (stored.schemaVersion === CURRENT_SCHEMA_VERSION) {
    if (!stored.frames.REST) throw new Error('Stored avatar is missing the REST frame');
    return stored;
  }
  if (stored.schemaVersion !== undefined && stored.schemaVersion !== 1) {
    throw new Error(`Unsupported avatar schema version ${stored.schemaVersion}`);
  }

  const legacy = stored as LegacyStoredAvatarV1;
  if (!legacy.frames.REST) throw new Error('Stored avatar is missing the REST frame');

  const frames: StoredAvatar['frames'] = { REST: legacy.frames.REST };
  const nudge: StoredAvatar['nudge'] = {};
  for (const pose of ['CLOSED', 'WIDE', 'ROUND'] as const) {
    const frame = legacy.frames[pose];
    if (frame) frames[pose] = frame;
    const offset = legacy.nudge[pose];
    if (offset) nudge[pose] = offset;
  }
  if (legacy.frames.OPEN) frames.BIG_OPEN = legacy.frames.OPEN;
  if (legacy.nudge.OPEN) nudge.BIG_OPEN = legacy.nudge.OPEN;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: legacy.id,
    createdAt: legacy.createdAt,
    width: legacy.width,
    height: legacy.height,
    frames,
    region: legacy.region,
    nudge,
  };
}

export class AvatarStore {
  async saveAvatar(avatar: Avatar): Promise<void> {
    const available = poseKeys(avatar.frames);
    const entries = await Promise.all(
      available.map(async (pose) => {
        const frame = avatar.frames[pose];
        if (!frame) throw new Error(`Avatar is missing advertised pose frame ${pose}`);
        return [pose, await encode(frame)] as const;
      }),
    );
    const frames = Object.fromEntries(entries) as StoredAvatar['frames'];
    if (!frames.REST) throw new Error('Avatar is missing the REST frame');
    const stored: StoredAvatar = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: avatar.id,
      createdAt: avatar.createdAt,
      width: avatar.width,
      height: avatar.height,
      frames,
      region: avatar.region,
      nudge: avatar.nudge,
    };
    await tx(AVATARS, 'readwrite', (s) => s.put(stored, AVATAR_KEY));
  }

  async loadAvatar(): Promise<Avatar | null> {
    const persisted = await tx<PersistedAvatar | undefined>(AVATARS, 'readonly', (s) => s.get(AVATAR_KEY));
    if (!persisted) return null;
    const stored = migrateStoredAvatar(persisted);
    const available = poseKeys(stored.frames);
    const entries = await Promise.all(
      available.map(async (pose) => {
        const blob = stored.frames[pose];
        if (!blob) throw new Error(`Stored avatar is missing advertised pose frame ${pose}`);
        return [pose, await createImageBitmap(blob)] as const;
      }),
    );
    const frames = Object.fromEntries(entries) as Avatar['frames'];
    if (!frames.REST) throw new Error('Stored avatar is missing the REST frame');
    return {
      id: stored.id,
      createdAt: stored.createdAt,
      width: stored.width,
      height: stored.height,
      frames,
      region: stored.region,
      nudge: stored.nudge,
    };
  }

  /** Describe capture coverage without assuming optional frames are present. */
  getPoseAvailability(avatar: Pick<Avatar, 'frames'>): AvatarPoseAvailability {
    const available = poseKeys(avatar.frames);
    const availableSet = new Set(available);
    return {
      available,
      missing: ALL_POSES.filter((pose) => !availableSet.has(pose)),
    };
  }

  /** "Redo Face". Drops the avatar; deliberately leaves preferences intact. */
  async clearAvatar(): Promise<void> {
    await tx(AVATARS, 'readwrite', (s) => s.delete(AVATAR_KEY));
  }

  async loadPrefs(): Promise<Preferences> {
    const p = await tx<Preferences | undefined>(PREFS, 'readonly', (s) => s.get(PREFS_KEY));
    return { ...DEFAULT_PREFS, ...(p ?? {}) };
  }

  async savePrefs(prefs: Preferences): Promise<void> {
    await tx(PREFS, 'readwrite', (s) => s.put(prefs, PREFS_KEY));
  }
}
