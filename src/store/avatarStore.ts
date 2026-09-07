// Local persistence. One avatar, no accounts, no cloud. Frames are stored as
// Blobs (structured-cloneable and compact) and rehydrated to ImageBitmap on
// load, which is the form the renderer wants.
import type { Avatar, StoredAvatar, MouthState, Preferences } from '../core/types';
import { MOUTH_STATES } from '../core/types';

const DB_NAME = 'talking-face';
const DB_VERSION = 1;
const AVATARS = 'avatars';
const PREFS = 'prefs';
const AVATAR_KEY = 'current';
const PREFS_KEY = 'prefs';

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

/** Encode one composited frame. PNG: these are photographs of a face composited
 *  with a soft alpha edge, and JPEG has no alpha to preserve. */
async function encode(frame: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(frame, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export class AvatarStore {
  async saveAvatar(avatar: Avatar): Promise<void> {
    const entries = await Promise.all(
      MOUTH_STATES.map(async (m) => [m, await encode(avatar.frames[m])] as const),
    );
    const frames = Object.fromEntries(entries) as Record<MouthState, Blob>;
    const stored: StoredAvatar = {
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
    const stored = await tx<StoredAvatar | undefined>(AVATARS, 'readonly', (s) => s.get(AVATAR_KEY));
    if (!stored) return null;
    const entries = await Promise.all(
      MOUTH_STATES.map(async (m) => {
        const blob = stored.frames[m];
        if (!blob) throw new Error(`stored avatar is missing the ${m} frame`);
        return [m, await createImageBitmap(blob)] as const;
      }),
    );
    return {
      id: stored.id,
      createdAt: stored.createdAt,
      width: stored.width,
      height: stored.height,
      frames: Object.fromEntries(entries) as Record<MouthState, ImageBitmap>,
      region: stored.region,
      nudge: stored.nudge,
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
