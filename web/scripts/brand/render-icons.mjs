#!/usr/bin/env node
/*
 * Renders every app-icon PNG from the source drawings next to this file (1024, full bleed):
 *
 *   node web/scripts/brand/render-icons.mjs
 *
 *   app-icon.svg        -> ios/MealPlanner/Assets.xcassets/AppIcon.appiconset/AppIcon.png   1024  (Xcode makes the rest)
 *   app-icon-dark.svg   -> ios/MealPlanner/Assets.xcassets/AppIcon.appiconset/AppIcon-Dark.png    1024, transparent
 *   app-icon-tinted.svg -> ios/MealPlanner/Assets.xcassets/AppIcon.appiconset/AppIcon-Tinted.png  1024, grayscale
 *   app-icon.svg        -> web/public/icon-512.png                                        512
 *   app-icon.svg        -> web/public/icon-192.png                                        192
 *   app-icon.svg        -> web/public/apple-touch-icon.png                                180
 *   favicon.svg         -> web/public/favicon.svg                                         (copied as is)
 *
 * Only a headless Chrome or Edge is needed (no sharp, no resvg): each size is a tiny HTML page
 * holding the SVG at exactly N×N, screenshotted in an N×N window at device scale 1. Set BROWSER
 * to the browser's executable if it isn't in the usual place.
 *
 * The App Store rejects an app icon with an alpha channel, and iOS paints a transparent touch
 * icon black, so every PNG except the Dark one must be opaque RGB. Chromium normally writes RGB
 * already; if a build writes RGBA, the alpha is dropped with ffmpeg when it is installed, or by
 * re-encoding the PNG here otherwise (those drawings have a full-bleed tile, so nothing is lost).
 * The Dark appearance is the opposite: it has no tile and must keep its alpha, so iOS can put
 * its own dark background behind the box. It is rendered on a transparent page.
 *
 * glyph.svg next to this file is the one-colour mark used inside the apps (web icons.tsx
 * 'mark', iPhone AppGlyph.imageset in both asset catalogs, filled #000000 there). Change those
 * by hand. icon-layers/ holds the same drawing split for Icon Composer, and logo/ the logo
 * (BRAND.md); neither is rendered here.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const iconSet = join(repo, 'ios', 'MealPlanner', 'Assets.xcassets', 'AppIcon.appiconset');

/** source: the drawing next to this file; alpha: keep the transparency (the Dark appearance only). */
const OUTPUTS = [
  { size: 1024, source: 'app-icon.svg', file: join(iconSet, 'AppIcon.png') },
  { size: 1024, source: 'app-icon-dark.svg', file: join(iconSet, 'AppIcon-Dark.png'), alpha: true },
  { size: 1024, source: 'app-icon-tinted.svg', file: join(iconSet, 'AppIcon-Tinted.png') },
  { size: 512, source: 'app-icon.svg', file: join(repo, 'web', 'public', 'icon-512.png') },
  { size: 192, source: 'app-icon.svg', file: join(repo, 'web', 'public', 'icon-192.png') },
  { size: 180, source: 'app-icon.svg', file: join(repo, 'web', 'public', 'apple-touch-icon.png') },
];

function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) {
    console.error('No Chrome or Edge found. Set BROWSER to its executable and run again.');
    process.exit(1);
  }
  return found;
}

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

// --- PNG helpers: read the header, and drop an alpha channel without any library -------------

/** The IHDR fields that matter here: size, bit depth and colour type (2 = RGB, 6 = RGBA). */
function pngInfo(file) {
  const png = readFileSync(file);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24],
    colorType: png[25],
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** The pixels of an 8-bit RGBA PNG, unfiltered: 4 bytes per pixel, row after row. */
function decodeRgba(file) {
  const png = readFileSync(file);
  const { width, height, bitDepth, colorType } = pngInfo(file);
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`${file}: expected 8-bit RGBA, got depth ${bitDepth} type ${colorType}`);
  const idat = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      rgba[y * stride + x] = (v + predictor) & 0xff;
    }
  }
  return { png, width, height, rgba };
}

/** Rewrites an 8-bit RGBA PNG as RGB (alpha thrown away; the art is opaque everywhere). */
function stripAlphaInJs(file) {
  const { png, width, height, rgba } = decodeRgba(file);
  const stride = width * 4;
  const rgb = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1); // filter byte 0 (None) at the start of each row
    for (let x = 0; x < width; x++) rgba.copy(rgb, row + 1 + x * 3, y * stride + x * 4, y * stride + x * 4 + 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  writeFileSync(file, Buffer.concat([
    png.subarray(0, 8),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rgb, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function makeOpaque(file, ffmpeg) {
  if (pngInfo(file).colorType === 2) return 'RGB';
  if (ffmpeg) {
    const tmp = `${file}.rgb.png`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-pix_fmt', 'rgb24', tmp]);
    renameSync(tmp, file);
    return 'RGBA -> RGB (ffmpeg)';
  }
  stripAlphaInJs(file);
  return 'RGBA -> RGB';
}

// --- Render ----------------------------------------------------------------------------------

const browser = findBrowser();
const ffmpeg = hasFfmpeg();
const work = mkdtempSync(join(tmpdir(), 'breadbox-icons-'));
console.log(`Rendering with ${browser}`);

try {
  // Render and check everything first, then write into the repo, so a failure part-way never
  // leaves a half-updated icon set behind.
  const done = [];
  for (const [n, { size, source, file, alpha }] of OUTPUTS.entries()) {
    const svg = readFileSync(join(here, source), 'utf8')
      .replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    const page = join(work, `icon-${n}.html`);
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;overflow:hidden;background:${alpha ? 'transparent' : '#F1E5D2'}}svg{display:block}
</style></head><body>${svg}</body></html>`);
    const shot = join(work, `icon-${n}.png`);
    execFileSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${join(work, 'profile')}`,
      '--force-device-scale-factor=1',
      ...(alpha ? ['--default-background-color=00000000'] : []),
      `--window-size=${size},${size}`,
      `--screenshot=${shot}`,
      pathToFileURL(page).href,
    ], { stdio: 'ignore', timeout: 60_000 });
    if (!existsSync(shot)) throw new Error(`The browser wrote no screenshot for ${source} at ${size}px`);

    const { width, height, colorType } = pngInfo(shot);
    if (width !== size || height !== size) throw new Error(`${source} at ${size}px came out ${width}×${height}`);
    let colour;
    if (alpha) {
      // The drawing leaves the corners empty, so a real transparent render has a clear corner.
      // An opaque one (a browser that ignored --default-background-color) would ship a square.
      if (colorType !== 6 || decodeRgba(shot).rgba[3] !== 0) {
        throw new Error(`${source} needs a transparent background, but the browser rendered it opaque`);
      }
      colour = 'RGBA (transparent)';
    } else {
      colour = makeOpaque(shot, ffmpeg);
    }
    done.push({ shot, file, size, colour });
  }

  for (const { shot, file, size, colour } of done) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, readFileSync(shot));
    console.log(`${String(size).padStart(4)}  ${colour.padEnd(20)}  ${file}`);
  }
  const favicon = join(repo, 'web', 'public', 'favicon.svg');
  copyFileSync(join(here, 'favicon.svg'), favicon);
  console.log(`      copied              ${favicon}`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
