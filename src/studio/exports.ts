// Everything that leaves the studio: embed snippet, standalone HTML, baked textures, MP4, GIF, PNG and animated SVG.
import { OrganicPlayer, DEFAULTS, visibility, restPhase, type Bake, type PlayerParams } from '../player/player';
import type { Recipe } from '../player/element';

export interface ExportJob {
  /** Short file-safe name, e.g. "hyphae-seed12". */
  name: string;
  bake: Bake;
  segments?: Float32Array;
  params: PlayerParams;
  /** Width of the organism in the preview, in CSS pixels, so cell sizes match what is on screen. */
  previewWidth: number;
  width: number; fps: number; repeats: number;
  progress: (message: string) => void;
}

const FLIP_COLS = 8;
const PLAYER_URL = import.meta.env.BASE_URL + 'organic-loop.js';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const toBlob = (canvas: HTMLCanvasElement, type = 'image/png') => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode the image.')), type));
const toDataUrl = (blob: Blob) => new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(blob); });
const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
const nextFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));

// ---- baked textures ----
function pixelsToPng(rgba: Uint8ClampedArray, width: number, height: number) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  c.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0); return toBlob(c);
}
export const bakePng = (bake: Bake) => pixelsToPng(new Uint8ClampedArray(bake.pixels), bake.width, bake.height);
export function flipPng(flip: NonNullable<Bake['flip']>) {
  const rows = Math.ceil(flip.count / FLIP_COLS), w = flip.width * FLIP_COLS, h = flip.height * rows, out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < flip.count; i++) { const ox = (i % FLIP_COLS) * flip.width, oy = Math.floor(i / FLIP_COLS) * flip.height;
    for (let y = 0; y < flip.height; y++) for (let x = 0; x < flip.width; x++) { const v = flip.data[(i * flip.height + y) * flip.width + x], q = ((oy + y) * w + ox + x) * 4;
      out[q] = out[q + 1] = out[q + 2] = v; out[q + 3] = 255; } }
  return pixelsToPng(out, w, h);
}

export function recipeFor(params: PlayerParams, bake: Bake, refWidth: number): Recipe {
  const changed = Object.fromEntries(Object.entries({ ...params, refWidth: Math.round(refWidth) }).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(DEFAULTS[k as keyof PlayerParams])));
  return { v: 1, params: changed, bake: { binary: bake.binary, contrast: bake.contrast },
    ...(bake.flip ? { flip: { count: bake.flip.count, cols: FLIP_COLS, width: bake.flip.width, height: bake.flip.height } } : {}) };
}

// ---- embed ----
function elementTag(recipe: Recipe, src: string, flipSrc?: string) {
  return `<organic-loop src="${src}"${flipSrc ? ` flip-src="${flipSrc}"` : ''}\n  recipe='${attr(JSON.stringify(recipe))}'></organic-loop>`;
}

/** The lines someone pastes into their own page. The texture files are downloaded alongside. */
export function snippet(job: ExportJob) {
  const script = new URL(PLAYER_URL, location.href).href;
  return `<!-- Organic loop: put ${job.name}.png${job.bake.flip ? ` and ${job.name}-frames.png` : ''} next to this page (or change the paths).
     Host organic-loop.js yourself for production. Size it with CSS; by default it keeps the shape it was grown at. -->
<script type="module" src="${script}"></script>
${elementTag(recipeFor(job.params, job.bake, job.previewWidth), `${job.name}.png`, job.bake.flip && `${job.name}-frames.png`)}`;
}

export async function downloadTextures(job: ExportJob) {
  download(await bakePng(job.bake), `${job.name}.png`);
  if (job.bake.flip) download(await flipPng(job.bake.flip), `${job.name}-frames.png`);
}

/** One file with the player and textures inlined: opens anywhere, and doubles as a working example. */
export async function standaloneHtml(job: ExportJob) {
  const response = await fetch(PLAYER_URL);
  if (!response.ok) throw new Error('Could not load the player bundle (organic-loop.js).');
  const code = (await response.text()).replace(/<\/script/g, '<\\/script');
  const src = await toDataUrl(await bakePng(job.bake)), flipSrc = job.bake.flip ? await toDataUrl(await flipPng(job.bake.flip)) : undefined;
  const ground = job.params.transparent ? 'transparent' : job.params.ground;
  return new Blob([`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${attr(job.name)}</title>
<style>html, body { margin: 0; height: 100%; background: ${ground}; } organic-loop { width: 100%; height: 100%; aspect-ratio: auto; }</style>
</head>
<body>
${elementTag(recipeFor(job.params, job.bake, job.previewWidth), src, flipSrc)}
<script type="module">
${code}
</script>
</body>
</html>
`], { type: 'text/html' });
}

// ---- frame-exact rendering ----
function renderer(job: ExportJob, patch: Partial<PlayerParams> = {}) {
  const canvas = document.createElement('canvas'), aspect = job.bake.width / job.bake.height;
  canvas.width = job.width; canvas.height = Math.round(job.width / aspect / 2) * 2;
  const player = new OrganicPlayer(canvas, { autoSize: false, autoplay: false, pixelRatio: job.width / Math.max(1, job.previewWidth) });
  player.set({ ...job.params, fit: 'contain', hover: 'none', ...patch }); player.setBake(job.bake);
  return { canvas, player };
}

export async function stillPng(job: ExportJob, phase: number) {
  const { canvas, player } = renderer(job);
  try { player.render(phase); return await toBlob(canvas); } finally { player.destroy(); }
}

export async function mp4(job: ExportJob) {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video. Try Chrome, Edge or a recent Safari.');
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, getFirstEncodableVideoCodec } = await import('mediabunny');
  const { canvas, player } = renderer(job, { transparent: false });
  try {
    const format = new Mp4OutputFormat(), target = new BufferTarget(), output = new Output({ format, target });
    const codec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width: canvas.width, height: canvas.height });
    if (!codec) throw new Error('No video codec is available for this size in this browser.');
    // dithered pixels are close to noise for a video codec, so the bitrate has to be generous
    const source = new CanvasSource(canvas, { codec, bitrate: Math.round(canvas.width * canvas.height * job.fps * .22) });
    output.addVideoTrack(source, { frameRate: job.fps }); await output.start();
    const perLoop = Math.max(2, Math.round(job.params.duration * job.fps)), total = perLoop * job.repeats;
    for (let i = 0; i < total; i++) {
      player.render((i % perLoop) / perLoop); await source.add(i / job.fps, 1 / job.fps);
      if (i % 10 === 0) { job.progress(`Encoding MP4… ${Math.round(i / total * 100)}%`); await nextFrame(); }
    }
    await output.finalize();
    return new Blob([target.buffer!], { type: 'video/mp4' });
  } finally { player.destroy(); }
}

export async function gif(job: ExportJob) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const p = job.params, twoColour = p.pattern !== 'soft' && p.accentMix === 0, clear = twoColour && p.transparent;
  const { canvas, player } = renderer(job, { transparent: clear });
  try {
    const w = canvas.width, h = canvas.height, copy = document.createElement('canvas'); copy.width = w; copy.height = h;
    const ctx = copy.getContext('2d', { willReadFrequently: true })!, encoder = GIFEncoder();
    const delay = Math.max(20, Math.round(100 / job.fps) * 10), frames = Math.max(2, Math.round(p.duration * 1000 / delay));
    const figure = rgbOf(p.figure), ground = rgbOf(p.ground), pair = [ground, figure];
    for (let i = 0; i < frames; i++) {
      player.render(i / frames); ctx.clearRect(0, 0, w, h); ctx.drawImage(canvas, 0, 0);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      if (twoColour) {
        // exactly two colours: no quantising, tiny files, crisp cells
        const index = new Uint8Array(w * h);
        if (clear) for (let j = 0; j < index.length; j++) index[j] = rgba[j * 4 + 3] > 127 ? 1 : 0;
        else for (let j = 0; j < index.length; j++) { const q = j * 4;
          index[j] = Math.abs(rgba[q] - figure[0]) + Math.abs(rgba[q + 1] - figure[1]) + Math.abs(rgba[q + 2] - figure[2]) < Math.abs(rgba[q] - ground[0]) + Math.abs(rgba[q + 1] - ground[1]) + Math.abs(rgba[q + 2] - ground[2]) ? 1 : 0; }
        encoder.writeFrame(index, w, h, { palette: pair, delay, transparent: clear, transparentIndex: 0 });
      } else {
        const palette = quantize(rgba, 256); encoder.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay });
      }
      if (i % 4 === 0) { job.progress(`Encoding GIF… ${Math.round(i / frames * 100)}%`); await nextFrame(); }
    }
    encoder.finish();
    return new Blob([encoder.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
  } finally { player.destroy(); }
}

function rgbOf(css: string): number[] {
  const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d')!;
  x.fillStyle = css; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)];
}

// ---- animated SVG (vector systems) ----
const BUCKETS = 64, SAMPLES = 80;

/** Strokes grouped by when they grew; each group fades in and out on the loop with plain CSS, so the file needs no script. */
export function animatedSvg(job: ExportJob) {
  const segs = job.segments, p = job.params;
  if (!segs?.length) throw new Error('Animated SVG needs a line-based system (branches, hyphae, drainage, cracks, differential growth).');
  const groups = Array.from({ length: BUCKETS }, () => new Map<string, string[]>());
  for (let i = 0; i < segs.length; i += 6) {
    const b = Math.min(BUCKETS - 1, Math.floor(segs[i + 5] * BUCKETS)), w = Math.max(.1, Math.round(segs[i + 4] * 5) / 5).toFixed(1);
    const list = groups[b].get(w) ?? groups[b].set(w, []).get(w)!;
    list.push(`M${segs[i].toFixed(2)} ${segs[i + 1].toFixed(2)}L${segs[i + 2].toFixed(2)} ${segs[i + 3].toFixed(2)}`);
  }
  let css = `.o{animation:${p.duration}s linear infinite}@media(prefers-reduced-motion:reduce){.o{animation:none!important;opacity:1!important}}`, body = '';
  groups.forEach((widths, b) => {
    if (!widths.size) return;
    const age = (b + .5) / BUCKETS, values = Array.from({ length: SAMPLES + 1 }, (_, i) => Math.round(visibility(p, (i % SAMPLES) / SAMPLES, age) * 100) / 100);
    const flat = values.every(v => v === values[0]);
    if (!flat) { const stops: string[] = [];
      for (let i = 0; i <= SAMPLES; i++) if (i === 0 || i === SAMPLES || values[i] !== values[i - 1] || values[i] !== values[i + 1]) stops.push(`${+(i / SAMPLES * 100).toFixed(2)}%{opacity:${values[i]}}`);
      css += `@keyframes g${b}{${stops.join('')}}`; }
    const stroke = p.accentMix > 0 ? ` stroke="color-mix(in srgb, ${p.accent} ${Math.round(p.accentMix * age * 100)}%, ${p.figure})"` : '';
    body += `<g${flat ? ` opacity="${values[0]}"` : ` class="o" style="animation-name:g${b}"`}${stroke}>`;
    for (const [w, d] of widths) body += `<path stroke-width="${w}" d="${d.join('')}"/>`;
    body += '</g>';
  });
  const gw = job.bake.width / 4, gh = job.bake.height / 4; // vector bakes are 4x the growth grid
  const meta = JSON.stringify({ name: job.name, loop: p.loop, duration: p.duration }).replace(/</g, '');
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="${Math.round(1920 * gh / gw)}" viewBox="0 0 ${gw} ${gh}"><metadata>${meta}</metadata><style>${css}</style>`
    + (p.transparent ? '' : `<rect width="${gw}" height="${gh}" fill="${p.ground}"/>`)
    + `<g stroke="${p.figure}" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`], { type: 'image/svg+xml' });
}

export { restPhase };
