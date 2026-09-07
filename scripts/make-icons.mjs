// Generates the PWA icons with no image dependency: a tiny hand-rolled PNG
// writer is cheaper than pulling in a raster library for two static files.
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';

const BG = [14, 17, 22];
const ACCENT = [76, 141, 255];
const LIGHT = [242, 245, 250];

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A face silhouette with an open, speaking mouth. Reads at 48px.
function icon(x, y, size) {
  const u = (x + 0.5) / size, v = (y + 0.5) / size;
  const head = ((u - 0.5) / 0.30) ** 2 + ((v - 0.47) / 0.36) ** 2;
  const mouth = ((u - 0.5) / 0.15) ** 2 + ((v - 0.66) / 0.11) ** 2;
  const eyeL = ((u - 0.39) / 0.045) ** 2 + ((v - 0.40) / 0.06) ** 2;
  const eyeR = ((u - 0.61) / 0.045) ** 2 + ((v - 0.40) / 0.06) ** 2;
  if (mouth <= 1) return [...LIGHT, 255];
  if (eyeL <= 1 || eyeR <= 1) return [...BG, 255];
  if (head <= 1) return [...ACCENT, 255];
  return [...BG, 255];
}

await mkdir('public/icons', { recursive: true });
for (const size of [192, 512]) {
  await writeFile(`public/icons/icon-${size}.png`, png(size, icon));
  console.log(`public/icons/icon-${size}.png`);
}
