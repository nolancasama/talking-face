// Vendors the on-device face-landmark assets into public/models.
// They are downloaded/copied rather than committed: the model is ~3.7MB and is
// an immutable third-party artifact, so git is the wrong place for it.
import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

const src = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
const destWasm = 'public/models/wasm';

await mkdir(destWasm, { recursive: true });
for (const file of await readdir(src)) {
  await copyFile(join(src, file), join(destWasm, file));
}
console.log(`wasm runtime -> ${destWasm}`);

const model = 'public/models/face_landmarker.task';
if (await exists(model)) {
  console.log('model already present, leaving it alone');
} else {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  await writeFile(model, Buffer.from(await res.arrayBuffer()));
  console.log(`model -> ${model}`);
}
