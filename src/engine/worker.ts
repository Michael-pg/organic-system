/// <reference lib="webworker" />
// Bake worker: runs a growth simulation and turns the result into textures the player can animate.
//   R = density field   G = age (when each pixel grew, 0..1)   B = wide blur of the field (contours, hover swell)
import { W, H, SYSTEMS, setGrid, setRng, setGlyph, vectorField, makeSkel, toField, blur, upBilinear, clamp, targetFor, progressFor } from './systems.js';
import type { BakeMessage, BakeRequest, CatalogMessage } from './types';

const VECTOR_SCALE = 4; // vector systems rasterise at 4x the simulation grid
const FLIP_FRAMES = 48, FLIP_OVERLAP = 16, FLIP_STRIDE = 2;

let queued: BakeRequest | null = null;
let working = false;
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Spread known ages outward until every pixel has one, so soft halos and contours reveal with the growth front. */
function fillAge(age: Float32Array, w: number, h: number): Float32Array {
  let a: Float32Array = age, b: Float32Array = new Float32Array(age.length);
  for (let pass = 0; pass < w + h; pass++) {
    let changed = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (a[i] > 0) { b[i] = a[i]; continue; }
      let m = 0;
      if (x > 0 && a[i - 1] > m) m = a[i - 1];
      if (x < w - 1 && a[i + 1] > m) m = a[i + 1];
      if (y > 0 && a[i - w] > m) m = a[i - w];
      if (y < h - 1 && a[i + w] > m) m = a[i + w];
      b[i] = m; if (m > 0) changed = true;
    }
    [a, b] = [b, a];
    if (!changed) break;
  }
  return a;
}

/** Antialiased stroke edges blend age toward zero; take the neighbourhood maximum to restore the true value. */
function sharpenAge(age: Float32Array, w: number, h: number, passes: number): Float32Array {
  let a: Float32Array = age, b: Float32Array = new Float32Array(age.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let m = a[i];
      if (m > 0 || pass > 0) {
        if (x > 0 && a[i - 1] > m) m = a[i - 1];
        if (x < w - 1 && a[i + 1] > m) m = a[i + 1];
        if (y > 0 && a[i - w] > m) m = a[i - w];
        if (y < h - 1 && a[i + w] > m) m = a[i + w];
      }
      b[i] = m;
    }
    [a, b] = [b, a];
  }
  return a;
}

/** Remap ages so equal time reveals equal area; pacing is then set entirely by the loop's easing curve. */
function ageCurve(age: Float32Array): (v: number) => number {
  const bins = new Float64Array(257); let total = 0;
  for (let i = 0; i < age.length; i++) if (age[i] > 0) { bins[Math.min(255, Math.floor(age[i] * 256)) + 1]++; total++; }
  if (!total) return v => v;
  for (let i = 1; i < 257; i++) bins[i] = bins[i - 1] + bins[i] / total;
  return v => { if (!(v > 0)) return 0; const x = Math.min(255.999, v * 256), i = Math.floor(x); return Math.max(.004, bins[i] + (bins[i + 1] - bins[i]) * (x - i)); };
}
const remap = (age: Float32Array, curve: (v: number) => number) => { for (let i = 0; i < age.length; i++) age[i] = curve(age[i]); return age; };

/** Separable gaussian with row-wise accumulation; several times faster than the reference blur at bake resolution. */
function fastBlur(f: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < .05) return f;
  const rad = Math.ceil(sigma * 3), k = new Float32Array(rad * 2 + 1); let sum = 0;
  for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-i * i / (2 * sigma * sigma)); sum += k[i + rad]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const t = new Float32Array(f.length), o = new Float32Array(f.length);
  for (let y = 0; y < h; y++) { const row = y * w;
    for (let i = -rad; i <= rad; i++) { const c = k[i + rad], x0 = Math.max(0, -i), x1 = Math.min(w, w - i);
      for (let x = 0; x < x0; x++) t[row + x] += f[row] * c;
      for (let x = x0; x < x1; x++) t[row + x] += f[row + x + i] * c;
      for (let x = x1; x < w; x++) t[row + x] += f[row + w - 1] * c; } }
  for (let y = 0; y < h; y++) { const row = y * w;
    for (let i = -rad; i <= rad; i++) { const c = k[i + rad], src = Math.min(h - 1, Math.max(0, y + i)) * w;
      for (let x = 0; x < w; x++) o[row + x] += t[src + x] * c; } }
  return o;
}

function pack(f: Float32Array, age: Float32Array, wide: Float32Array, n: number): Uint8Array {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = Math.round(clamp(f[i], 0, 1) * 255);
    out[i * 4 + 1] = Math.max(1, Math.round(clamp(age[i], 0, 1) * 255));
    out[i * 4 + 2] = Math.round(clamp(wide[i], 0, 1) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

function bakeTextures(sys: any, state: any, p: any) {
  if (sys.vector) {
    const k = VECTOR_SCALE, w = W * k, h = H * k;
    const sk = makeSkel(w, h, k); sys.draw(sk, state, p, false); const ag = makeSkel(w, h, k); sys.draw(ag, state, p, true);
    const rawF = toField(sk, w, h), rawA = toField(ag, w, h);
    const hi = { f: fastBlur(rawF, w, h, sys.sigma * k), age: rawA, contrast: sys.contrast };
    const lo = vectorField(sys, state, p, W, H, 1);
    const sharp = sharpenAge(hi.age, w, h, 2), curve = ageCurve(sharp);
    const filled = fillAge(remap(lo.age, curve), W, H);
    const ageLo = upBilinear(filled, W, H, w, h), ageHi = remap(sharp, curve);
    for (let i = 0; i < ageHi.length; i++) if (!(ageHi[i] > 0)) ageHi[i] = ageLo[i];
   
    const wide = upBilinear(blur(lo.f, W, H, 2.5), W, H, w, h);
    // strokes with the age they grew at, for the animated SVG export
    const segs = sys.segments(state, p), segments = new Float32Array(segs.length * 6);
    for (let i = 0; i < segs.length; i++) { const g = segs[i], mx = clamp(Math.round((g.a.x + g.b.x) / 2 * k), 0, w - 1), my = clamp(Math.round((g.a.y + g.b.y) / 2 * k), 0, h - 1);
      segments.set([g.a.x, g.a.y, g.b.x, g.b.y, g.w, ageHi[my * w + mx]], i * 6); }
    const pixels = pack(hi.f, ageHi, wide, w * h);
    return { width: w, height: h, pixels, binary: false, contrast: hi.contrast || 1.5, segments };
  }
  const fld = sys.field(state, p);
  return { width: W, height: H, pixels: pack(fld.f, fillAge(remap(fld.age, ageCurve(fld.age)), W, H), blur(fld.f, W, H, 2.5), W * H), binary: !!fld.binary, contrast: fld.contrast || 1.5, segments: undefined as Float32Array | undefined };
}

/** Systems that never settle (Physarum) get a flipbook of real frames, with the tail crossfaded into the head so it loops. */
function bakeFlipbook(sys: any, state: any, p: any) {
  const total = FLIP_FRAMES + FLIP_OVERLAP, n = W * H, raw: Float32Array[] = [];
  for (let i = 0; i < total; i++) { for (let s = 0; s < FLIP_STRIDE; s++) sys.step(state, p); raw.push(sys.field(state, p).f); }
  const data = new Uint8Array(FLIP_FRAMES * n);
  for (let i = 0; i < FLIP_FRAMES; i++) {
    const t = i < FLIP_OVERLAP ? (i + .5) / FLIP_OVERLAP : 1, a = raw[i], b = i < FLIP_OVERLAP ? raw[FLIP_FRAMES + i] : a;
    for (let j = 0; j < n; j++) data[i * n + j] = Math.round(clamp(b[j] + (a[j] - b[j]) * t, 0, 1) * 255);
  }
  return { count: FLIP_FRAMES, width: W, height: H, data };
}

async function pump() {
  if (working) return; working = true;
  try {
    while (queued) {
      const job: BakeRequest = queued; queued = null;
      const sys = SYSTEMS[job.sys], p: any = { ...job.params };
      setGrid(job.grid[0], job.grid[1]); setGlyph(job.glyph);
      setRng(job.seed * 31 + job.sys * 7 + 1);
      const start = performance.now(), state = sys.init(p), target = targetFor(job.sys, p, job.amount);
      let steps = 0, active = true, cancelled = false, stalled = 0;
      while (active && progressFor(job.sys, state, steps) < target) {
        const slice = performance.now();
        do {
          const before = progressFor(job.sys, state, steps), remaining = target - before;
          active = sys.step(state, job.sys === 1 ? { ...p, batch: Math.min(p.batch, remaining) } : job.sys === 5 ? { ...p, perStep: Math.min(p.perStep, remaining) } : p); steps++;
          stalled = progressFor(job.sys, state, steps) === before ? stalled + 1 : 0; if (stalled >= 12) active = false;
        } while (active && progressFor(job.sys, state, steps) < target && performance.now() - slice < 12);
        await delay();
        const next = queued as BakeRequest | null;
        if (next && next.sys !== job.sys) { cancelled = true; break; }
      }
      if (cancelled) continue;
      const { segments, ...tex } = bakeTextures(sys, state, p), flip = sys.recency ? bakeFlipbook(sys, state, p) : undefined;
      const message: BakeMessage = { type: 'bake', revision: job.revision, sys: job.sys, seed: job.seed, amount: job.amount, elapsed: performance.now() - start, grid: job.grid, bake: { ...tex, flip }, segments };
      postMessage(message, flip ? [tex.pixels.buffer, flip.data.buffer] : [tex.pixels.buffer]);
    }
  } catch (error) {
    postMessage({ type: 'error', message: (error as Error).message });
  } finally { working = false; }
}

onmessage = ({ data }) => {
  if (data.type === 'init') {
    const message: CatalogMessage = { type: 'catalog', systems: SYSTEMS.map((s: any) => ({ name: s.name, vector: !!s.vector, living: !!s.recency, params: s.params.map(({ fmt, ...q }: any) => q) })) };
    postMessage(message);
  }
  if (data.type === 'bake') { queued = data; pump(); }
};
