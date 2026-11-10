// @ts-nocheck
// Growth simulations, lifted verbatim from reference/culture-growth-editor.html.
// Only the module wiring at the bottom is new. Runs in a worker (needs OffscreenCanvas).
// ======================= core =======================
let W = 192, H = 144, CX = W / 2 | 0, CY = H / 2 | 0; // grid size; the studio sets it to the shape of the screen
const TAU = Math.PI * 2;
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hash = (a, b, c) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function createCanvas(w=1,h=1) { return new OffscreenCanvas(w,h); }
function glyphMask(w, h, px) { const c = createCanvas(w,h); const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = `bold ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('S', w / 2, h / 2 + px * .04); const d = x.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 128 ? 1 : 0; return m; }
let GLYPH; // Supplied by the main thread so letter masks use the same browser font.
const insideGlyph = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && GLYPH[yi * W + xi] === 1; };
function makeSkel(w, h, k) { const c = createCanvas(w,h); const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.scale(k, k); x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round'; return x; }
const ageStyle = t => { const g = 1 + Math.round(clamp(t, 0, 1) * 254); return `rgb(${g},${g},${g})`; };
function line(x, x0, y0, x1, y1, w) { x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); }
function toField(x, w, h) { const d = x.getImageData(0, 0, w, h).data, f = new Float32Array(w * h); for (let i = 0; i < f.length; i++) f[i] = d[i * 4] / 255; return f; }
function blur(f, w, h, sigma) {
  if (sigma < .05) return f;
  const rad = Math.ceil(sigma * 3), k = new Float32Array(rad * 2 + 1); let sum = 0;
  for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-i * i / (2 * sigma * sigma)); sum += k[i + rad]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const t = new Float32Array(f.length), o = new Float32Array(f.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -rad; i <= rad; i++) a += f[y * w + clamp(x + i, 0, w - 1)] * k[i + rad]; t[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -rad; i <= rad; i++) a += t[clamp(y + i, 0, h - 1) * w + x] * k[i + rad]; o[y * w + x] = a; }
  return o;
}
function upBilinear(s, sw, sh, dw, dh) { const o = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) { const v = (y + .5) / dh * sh - .5, y0 = clamp(Math.floor(v), 0, sh - 1), y1 = Math.min(y0 + 1, sh - 1), fy = clamp(v - y0, 0, 1);
    for (let x = 0; x < dw; x++) { const u = (x + .5) / dw * sw - .5, x0 = clamp(Math.floor(u), 0, sw - 1), x1 = Math.min(x0 + 1, sw - 1), fx = clamp(u - x0, 0, 1);
      o[y * dw + x] = lerp(lerp(s[y0 * sw + x0], s[y0 * sw + x1], fx), lerp(s[y1 * sw + x0], s[y1 * sw + x1], fx), fy); } } return o; }
function upNearest(s, sw, sh, dw, dh) { const o = new Float32Array(dw * dh); for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) o[y * dw + x] = s[Math.floor(y / dh * sh) * sw + Math.floor(x / dw * sw)]; return o; }
function bayer(n) { let m = [[0]]; while (m.length < n) { const k = m.length, o = []; for (let y = 0; y < 2 * k; y++) { o.push([]); for (let x = 0; x < 2 * k; x++) { const b = m[y % k][x % k] * 4; o[y].push(b + [[0, 2], [3, 1]][y >= k | 0][x >= k | 0]); } } m = o; } return m.map(r => r.map(v => (v + .5) / (n * n))); }
const MAT = { bayer4: bayer(4), bayer8: bayer(8) };

let r = rng(1);

// ======================= systems =======================
// Each: name, params [{key,label,min,max,step,def,live,fmt} | {key,label,options,def,live}], init(p)->state, step(state,p)->active,
// field(state,p)->{f,age,binary,contrast,sigma}, and for vector systems draw(ctx,state,p) in world units (used for skeleton render, export) and segments(state,p) for SVG.
const pct = v => Math.round(v * 100) + '%', num = v => (+v).toFixed(2), int = v => String(Math.round(v));
const SYSTEMS = [];

// ---- 1 Space colonisation ----
SYSTEMS.push({
  name: 'Space colonisation', vector: true,
  params: [
    { key: 'crown', label: 'Crown', options: ['ellipse', 'ring', 'band', 'letter'], def: 'ellipse' },
    { key: 'roots', label: 'Roots', options: ['one', 'two', 'many'], def: 'one' },
    { key: 'attr', label: 'Attractors', min: 100, max: 1500, step: 10, def: 520, fmt: int },
    { key: 'reach', label: 'Reach (influence radius)', min: 6, max: 48, step: 1, def: 24, live: true, fmt: int },
    { key: 'kill', label: 'Kill radius', min: 1, max: 10, step: .5, def: 3, live: true, fmt: num },
    { key: 'leaf', label: 'Twig width', min: .2, max: 2.5, step: .05, def: .8, live: true, fmt: num },
    { key: 'trunk', label: 'Trunk cap', min: 2, max: 14, step: .5, def: 7, live: true, fmt: num },
  ],
  init(p) {
    let A; const n = p.attr;
    if (p.crown === 'ellipse') A = Array.from({ length: n }, () => { const a = r() * TAU, d = Math.sqrt(r()); return { x: CX + Math.cos(a) * d * W * .3, y: H * .42 + Math.sin(a) * d * H * .32, alive: true }; });
    else if (p.crown === 'ring') A = Array.from({ length: n }, () => { const a = r() * TAU, d = 34 + r() * 18; return { x: CX + Math.cos(a) * d, y: H * .42 + Math.sin(a) * d, alive: true }; });
    else if (p.crown === 'band') A = Array.from({ length: n }, () => ({ x: W * .04 + r() * W * .92, y: H * .12 + r() * H * .5, alive: true }));
    else { const cells = []; for (let i = 0; i < GLYPH.length; i++) if (GLYPH[i]) cells.push(i); A = Array.from({ length: n }, () => { const i = cells[Math.floor(r() * cells.length)]; return { x: i % W, y: (i / W) | 0, alive: true }; }); }
    const roots = p.roots === 'one' ? [{ x: CX, y: H - 1 }] : p.roots === 'two' ? [{ x: W * .3, y: H - 1 }, { x: W * .7, y: H - 1 }] : Array.from({ length: 11 }, (_, i) => ({ x: W * .08 + i * 16, y: H - 1 }));
    const nodes = [];
    for (const rt of roots) { nodes.push({ x: rt.x, y: rt.y, p: -1, ch: [], t: 0 }); let cur = nodes.length - 1;
      for (let g = 0; g < 200; g++) { const nd = nodes[cur]; let best = null, bd = 1e9; for (const a of A) { const d = (a.x - nd.x) ** 2 + (a.y - nd.y) ** 2; if (d < bd) { bd = d; best = a; } }
        if (!best || bd < (p.reach * .8) ** 2) break; const dd = Math.sqrt(bd);
        nodes.push({ x: nd.x + (best.x - nd.x) / dd * 2 + (r() - .5) * .8, y: nd.y + (best.y - nd.y) / dd * 2 + (r() - .5) * .8, p: cur, ch: [], t: 0 }); nd.ch.push(nodes.length - 1); cur = nodes.length - 1; } }
    return { A, nodes, it: 0 };
  },
  step(s, p) {
    const D = p.reach, Kd = p.kill, acc = new Array(s.nodes.length).fill(null); let any = false;
    for (const a of s.A) { if (!a.alive) continue; let best = -1, bd = D * D;
      for (let i = 0; i < s.nodes.length; i++) { const dx = a.x - s.nodes[i].x, dy = a.y - s.nodes[i].y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      if (best < 0) continue; const n = s.nodes[best], dd = Math.sqrt(bd) || 1; (acc[best] || (acc[best] = { x: 0, y: 0 })); acc[best].x += (a.x - n.x) / dd; acc[best].y += (a.y - n.y) / dd; }
    const L = s.nodes.length; s.it++;
    for (let i = 0; i < L; i++) { const c = acc[i]; if (!c) continue; const m = Math.hypot(c.x, c.y) || 1; s.nodes.push({ x: s.nodes[i].x + c.x / m * 2, y: s.nodes[i].y + c.y / m * 2, p: i, ch: [], t: s.it }); s.nodes[i].ch.push(s.nodes.length - 1); any = true; }
    for (const a of s.A) { if (!a.alive) continue; for (let i = L; i < s.nodes.length; i++) if ((a.x - s.nodes[i].x) ** 2 + (a.y - s.nodes[i].y) ** 2 < Kd * Kd) { a.alive = false; break; } }
    return any;
  },
  widths(s, p) { const w = new Float32Array(s.nodes.length); for (let i = s.nodes.length - 1; i >= 0; i--) { const n = s.nodes[i]; if (!n.ch.length) w[i] = p.leaf; else { let q = 0; for (const c of n.ch) q += w[c] * w[c]; w[i] = Math.sqrt(q); } } return w; },
  draw(x, s, p, age) { const w = this.widths(s, p), mT = Math.max(1, s.it); for (let i = 0; i < s.nodes.length; i++) { const n = s.nodes[i]; if (n.p < 0) continue; const q = s.nodes[n.p]; if (age) x.strokeStyle = ageStyle(n.t / mT); line(x, q.x, q.y, n.x, n.y, Math.min(p.trunk, w[i] * .9)); } },
  segments(s, p) { const w = this.widths(s, p); return s.nodes.filter(n => n.p >= 0).map((n, i) => ({ a: s.nodes[n.p], b: n, w: Math.min(p.trunk, w[s.nodes.indexOf(n)] * .9) })); },
  sigma: .7, contrast: 1.7,
});

// ---- 2 DLA ----
SYSTEMS.push({
  name: 'DLA', grid: true,
  params: [
    { key: 'seedgeo', label: 'Seed', options: ['point', 'line', 'ring', 'letter', 'scatter'], def: 'point' },
    { key: 'stick', label: 'Sticking probability', min: .02, max: 1, step: .01, def: .4, live: true, fmt: pct },
    { key: 'max', label: 'Particles', min: 300, max: 20000, step: 100, def: 2600, live: true, fmt: int },
    { key: 'batch', label: 'Particles per step', min: 5, max: 200, step: 5, def: 40, live: true, fmt: int },
  ],
  init(p) {
    const s = { g: new Uint8Array(W * H), age: new Float32Array(W * H), cells: [], coarse: new Uint16Array(Math.ceil(W / 8) * Math.ceil(H / 8)), CW: Math.ceil(W / 8), CH: Math.ceil(H / 8), stuck: 0, st: {} };
    s.add = i => { s.g[i] = 1; s.cells.push(i); s.coarse[((i / W | 0) >> 3) * s.CW + ((i % W) >> 3)]++; };
    const dist = (x, y) => Math.hypot(x - CX, y - CY);
    if (p.seedgeo === 'point') { s.add(CY * W + CX); s.st.R = 2; s.spawn = () => { const a = r() * TAU; return [CX + Math.cos(a) * (s.st.R + 3), CY + Math.sin(a) * (s.st.R + 3)]; }; s.kill = (x, y) => dist(x, y) > s.st.R + 24; s.onStick = (x, y) => { s.st.R = Math.max(s.st.R, dist(x, y)); }; }
    else if (p.seedgeo === 'line') { for (let x = 1; x < W - 1; x++) s.add((H - 2) * W + x); s.st.top = H - 2; s.spawn = () => [1 + r() * (W - 2), Math.max(1, s.st.top - 3)]; s.kill = (x, y) => y < s.st.top - 20; s.onStick = (x, y) => { s.st.top = Math.min(s.st.top, y); }; }
    else if (p.seedgeo === 'ring') { for (let a = 0; a < TAU; a += .012) s.add(Math.round(CY + Math.sin(a) * 50) * W + Math.round(CX + Math.cos(a) * 50)); s.st.rin = 46; s.spawn = () => { const a = r() * TAU, d = Math.sqrt(r()) * Math.max(2, s.st.rin - 3); return [CX + Math.cos(a) * d, CY + Math.sin(a) * d]; }; s.kill = (x, y) => dist(x, y) > 52; s.onStick = (x, y) => { s.st.rin = Math.min(s.st.rin, dist(x, y)); }; }
    else { if (p.seedgeo === 'letter') { for (let i = 0; i < GLYPH.length; i++) if (GLYPH[i]) s.add(i); } else for (let i = 0; i < 14; i++) s.add(Math.round(8 + r() * (H - 16)) * W + Math.round(8 + r() * (W - 16)));
      s.spawn = () => { const i = s.cells[Math.floor(r() * s.cells.length)], a = r() * TAU; s.st.ox = i % W; s.st.oy = (i / W) | 0; return [s.st.ox + Math.cos(a) * 7, s.st.oy + Math.sin(a) * 7]; }; s.kill = (x, y) => Math.hypot(x - s.st.ox, y - s.st.oy) > 22; s.onStick = () => {}; }
    for (const i of s.cells) s.age[i] = 1;
    return s;
  },
  step(s, p) {
    if (s.stuck >= p.max) return false;
    const g = s.g, near = (x, y) => g[y * W + x - 1] || g[y * W + x + 1] || g[(y - 1) * W + x] || g[(y + 1) * W + x];
    const nearBlock = (x, y) => { const bx = x >> 3, by = y >> 3; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const cx = bx + dx, cy = by + dy; if (cx >= 0 && cy >= 0 && cx < s.CW && cy < s.CH && s.coarse[cy * s.CW + cx]) return true; } return false; };
    for (let n = 0, tries = 0; n < p.batch && tries < p.batch * 20 && s.stuck < p.max; tries++) {
      let [x, y] = s.spawn(); x = Math.round(x); y = Math.round(y); if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || g[y * W + x]) continue;
      for (let k = 0; k < 3000; k++) {
        if (nearBlock(x, y)) { const d = r() * 4 | 0; x += d === 0 ? 1 : d === 1 ? -1 : 0; y += d === 2 ? 1 : d === 3 ? -1 : 0; }
        else { const a = r() * TAU; x += Math.round(Math.cos(a) * 6); y += Math.round(Math.sin(a) * 6); }
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || s.kill(x, y)) break;
        if (near(x, y) && r() < p.stick) { const i = y * W + x; s.add(i); s.stuck++; s.age[i] = 1 + s.stuck; s.onStick(x, y); n++; break; }
      }
    }
    return true;
  },
  field(s) { const f = new Float32Array(W * H), age = new Float32Array(W * H), m = s.stuck + 1; for (let i = 0; i < f.length; i++) { f[i] = s.g[i]; age[i] = s.age[i] ? s.age[i] / m : 0; } return { f, age, binary: true, contrast: 1 }; },
});

// ---- 3 Physarum ----
SYSTEMS.push({
  name: 'Physarum', grid: true, recency: true,
  params: [
    { key: 'agents', label: 'Agents', min: 500, max: 12000, step: 100, def: 4000, fmt: int },
    { key: 'sensor', label: 'Sensor distance', min: 2, max: 24, step: .5, def: 7, live: true, fmt: num },
    { key: 'sangle', label: 'Sensor angle', min: .15, max: 1.3, step: .05, def: .6, live: true, fmt: num },
    { key: 'turn', label: 'Turn', min: .05, max: 1.2, step: .05, def: .5, live: true, fmt: num },
    { key: 'fade', label: 'Fade (kept per step)', min: .8, max: .995, step: .005, def: .92, live: true, fmt: v => (v * 100).toFixed(1) + '%' },
    { key: 'deposit', label: 'Deposit', min: .1, max: 4, step: .1, def: 1, live: true, fmt: num },
  ],
  init(p) { const N = p.agents, s = { T: new Float32Array(W * H), T2: new Float32Array(W * H), occ: new Uint8Array(W * H), last: new Float32Array(W * H), N, X: new Float32Array(N), Y: new Float32Array(N), A: new Float32Array(N), t: 0 };
    for (let i = 0; i < N; i++) { s.X[i] = r() * W; s.Y[i] = r() * H; s.A[i] = r() * TAU; s.occ[(Math.round(s.Y[i]) % H) * W + Math.round(s.X[i]) % W] = 1; } return s; },
  step(s, p) {
    const SD = p.sensor, SA = p.sangle, RA = p.turn, T = s.T, wrap = (v, n) => ((Math.round(v) % n) + n) % n, sample = (x, y) => T[wrap(y, H) * W + wrap(x, W)]; s.t++;
    for (let i = 0; i < s.N; i++) { const a = s.A[i], x = s.X[i], y = s.Y[i];
      const fw = sample(x + Math.cos(a) * SD, y + Math.sin(a) * SD), l = sample(x + Math.cos(a - SA) * SD, y + Math.sin(a - SA) * SD), rt = sample(x + Math.cos(a + SA) * SD, y + Math.sin(a + SA) * SD);
      if (fw > l && fw > rt) {} else if (l > rt) s.A[i] -= RA; else if (rt > l) s.A[i] += RA; else s.A[i] += (r() - .5) * RA * 2;
      let nx = x + Math.cos(s.A[i]), ny = y + Math.sin(s.A[i]); nx = ((nx % W) + W) % W; ny = ((ny % H) + H) % H;
      const ci = wrap(y, H) * W + wrap(x, W), ni = wrap(ny, H) * W + wrap(nx, W);
      if (ni !== ci && s.occ[ni]) { s.A[i] = r() * TAU; continue; }
      s.occ[ci] = 0; s.occ[ni] = 1; s.X[i] = nx; s.Y[i] = ny; T[ni] += p.deposit; s.last[ni] = s.t; }
    const T2 = s.T2, dec = p.fade;
    for (let y = 0; y < H; y++) { const ym = ((y - 1 + H) % H) * W, y0 = y * W, yp = ((y + 1) % H) * W;
      for (let x = 0; x < W; x++) { const xm = (x - 1 + W) % W, xp = (x + 1) % W; T2[y0 + x] = (T[ym + xm] + T[ym + x] + T[ym + xp] + T[y0 + xm] + T[y0 + x] + T[y0 + xp] + T[yp + xm] + T[yp + x] + T[yp + xp]) / 9 * dec; } }
    s.T = T2; s.T2 = T; return true;
  },
  field(s) { const T = s.T, smp = []; for (let i = 0; i < T.length; i += 7) smp.push(T[i]); smp.sort((a, b) => a - b); const mx = smp[Math.floor(smp.length * .995)] || 1;
    const f = new Float32Array(W * H), age = new Float32Array(W * H), t = Math.max(1, s.t); for (let i = 0; i < f.length; i++) { f[i] = Math.pow(clamp(T[i] / mx, 0, 1), .6); age[i] = s.last[i] / t; } return { f, age, contrast: 1.4 }; },
});

// ---- 4 Reaction-diffusion ----
SYSTEMS.push({
  name: 'Reaction-diffusion', grid: true, smooth: true,
  params: [
    { key: 'seeds', label: 'Seeds', options: ['scatter', 'trunk', 'grid', 'letter'], def: 'scatter' },
    { key: 'feed', label: 'Feed', min: .01, max: .09, step: .0005, def: .0545, live: true, fmt: v => (+v).toFixed(4) },
    { key: 'kill', label: 'Kill', min: .04, max: .075, step: .0005, def: .062, live: true, fmt: v => (+v).toFixed(4) },
    { key: 'db', label: 'B diffusion', min: .2, max: .8, step: .01, def: .5, live: true, fmt: num },
  ],
  init(p) { const s = { A: new Float32Array(W * H).fill(1), B: new Float32Array(W * H), A2: new Float32Array(W * H).fill(1), B2: new Float32Array(W * H), birth: new Float32Array(W * H), t: 0 };
    const disk = (cx, cy, rad) => { for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) { s.B[y * W + x] = 1; s.A[y * W + x] = 0; } };
    if (p.seeds === 'scatter') for (let i = 0; i < 12; i++) disk(8 + r() * (W - 16), 8 + r() * (H - 16), 3);
    else if (p.seeds === 'trunk') { let x = CX, y = H * .9; while (y > H * .3) { disk(x, y, 3); y -= 9; x += (r() - .5) * 9; } }
    else if (p.seeds === 'grid') { for (let y = 16; y < H; y += 24) for (let x = 16; x < W; x += 24) disk(x, y, 2.5); }
    else { for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2) if (GLYPH[y * W + x] && r() < .15) disk(x, y, 1.5); }
    return s; },
  step(s, p) { const A = s.A, B = s.B, A2 = s.A2, B2 = s.B2, Fd = p.feed, Kd = p.kill, DB = p.db; s.t++;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x, a = A[i], b = B[i];
      const la = -a + .2 * (A[i - 1] + A[i + 1] + A[i - W] + A[i + W]) + .05 * (A[i - W - 1] + A[i - W + 1] + A[i + W - 1] + A[i + W + 1]);
      const lb = -b + .2 * (B[i - 1] + B[i + 1] + B[i - W] + B[i + W]) + .05 * (B[i - W - 1] + B[i - W + 1] + B[i + W - 1] + B[i + W + 1]);
      const abb = a * b * b; A2[i] = a + (la - abb + Fd * (1 - a)); B2[i] = b + (DB * lb + abb - (Kd + Fd) * b); }
    s.A = A2; s.A2 = A; s.B = B2; s.B2 = B; if (s.t % 5 === 0) for (let i = 0; i < B2.length; i++) if (!s.birth[i] && B2[i] > .2) s.birth[i] = s.t; return true; },
  field(s) { const f = new Float32Array(W * H), age = new Float32Array(W * H), t = Math.max(1, s.t); for (let i = 0; i < f.length; i++) { f[i] = clamp(s.B[i] * 2.6, 0, 1); age[i] = s.birth[i] / t; } return { f: blur(f, W, H, .5), age, contrast: 1.5 }; },
});

// ---- 5 Hyphae ----
SYSTEMS.push({
  name: 'Hyphae', vector: true, incremental: true,
  params: [
    { key: 'start', label: 'Start', options: ['centre', 'bottom', 'scatter'], def: 'centre' },
    { key: 'tips', label: 'Starting tips', min: 1, max: 24, step: 1, def: 6, fmt: int },
    { key: 'crowd', label: 'Crowding threshold', min: .5, max: 10, step: .5, def: 2, live: true, fmt: num },
    { key: 'split', label: 'Apical split chance', min: 0, max: .1, step: .005, def: .015, live: true, fmt: v => (v * 100).toFixed(1) + '%' },
    { key: 'branch', label: 'Side branch chance', min: 0, max: .12, step: .005, def: .02, live: true, fmt: v => (v * 100).toFixed(1) + '%' },
    { key: 'wander', label: 'Wander', min: 0, max: 1.2, step: .05, def: .5, live: true, fmt: num },
    { key: 'width', label: 'New tip width', min: .4, max: 3, step: .1, def: 1.3, live: true, fmt: num },
    { key: 'maxTips', label: 'Max tips', min: 10, max: 600, step: 10, def: 160, live: true, fmt: int },
  ],
  init(p) { const s = { tips: [], segs: [], D: new Float32Array(W * H), t: 0, drawn: 0 };
    for (let i = 0; i < p.tips; i++) { if (p.start === 'centre') s.tips.push({ x: CX, y: CY, a: i / p.tips * TAU + r() * .5, w: p.width });
      else if (p.start === 'bottom') s.tips.push({ x: W * (.1 + .8 * (i + .5) / p.tips), y: H - 2, a: -Math.PI / 2 + (r() - .5) * .6, w: p.width });
      else s.tips.push({ x: 8 + r() * (W - 16), y: 8 + r() * (H - 16), a: r() * TAU, w: p.width }); }
    return s; },
  step(s, p) { if (!s.tips.length) return false; s.t++;
    const dens = (px, py) => { const xi = Math.round(px), yi = Math.round(py); if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) return 99; let q = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) q += s.D[(yi + dy) * W + xi + dx]; return q; };
    const next = [];
    for (const t of s.tips) { const look = [-.7, 0, .7].map(o => dens(t.x + Math.cos(t.a + o) * 3, t.y + Math.sin(t.a + o) * 3)); if (Math.min(...look) > p.crowd) continue;
      const steer = look[0] < look[1] && look[0] <= look[2] ? -1 : look[2] < look[1] && look[2] < look[0] ? 1 : 0; t.a += steer * .35 + (r() - .5) * p.wander;
      const nx = t.x + Math.cos(t.a) * 1.3, ny = t.y + Math.sin(t.a) * 1.3; if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
      s.segs.push({ a: { x: t.x, y: t.y }, b: { x: nx, y: ny }, w: t.w, t: s.t }); t.x = nx; t.y = ny; s.D[Math.round(ny) * W + Math.round(nx)] += 1;
      if (s.tips.length + next.length < p.maxTips) { if (r() < p.split) { next.push({ x: nx, y: ny, a: t.a - .6, w: Math.max(.4, t.w * .8) }); t.a += .6; t.w = Math.max(.4, t.w * .8); } else if (r() < p.branch) next.push({ x: nx, y: ny, a: t.a + (r() < .5 ? -1.2 : 1.2), w: Math.max(.4, t.w * .7) }); }
      next.push(t); }
    s.tips = next; return true; },
  draw(x, s, p, age) { const mT = Math.max(1, s.t); for (const g of s.segs) { if (age) x.strokeStyle = ageStyle(g.t / mT); line(x, g.a.x, g.a.y, g.b.x, g.b.y, g.w); } },
  segments(s) { return s.segs; }, sigma: 0, contrast: 1.4,
});

// ---- 6 Drainage ----
SYSTEMS.push({
  name: 'Drainage', vector: true,
  params: [
    { key: 'outlets', label: 'Outlets', options: ['bottom centre', 'bottom edge', 'two sides', 'ring', 'centre'], def: 'bottom centre' },
    { key: 'points', label: 'Points', min: 100, max: 4000, step: 50, def: 650, fmt: int },
    { key: 'perStep', label: 'Points per step', min: 1, max: 60, step: 1, def: 8, live: true, fmt: int },
    { key: 'wscale', label: 'Width scale', min: .05, max: 1.2, step: .05, def: .35, live: true, fmt: num },
    { key: 'wexp', label: 'Width exponent', min: .2, max: .9, step: .05, def: .5, live: true, fmt: num },
    { key: 'wcap', label: 'Width cap', min: 1, max: 14, step: .5, def: 6, live: true, fmt: num },
  ],
  init(p) { const o = p.outlets, outlets = o === 'bottom centre' ? [{ x: CX, y: H - 1 }] : o === 'bottom edge' ? Array.from({ length: 8 }, (_, i) => ({ x: 12 + i * 24, y: H - 1 })) : o === 'two sides' ? [{ x: 1, y: CY }, { x: W - 2, y: CY }] : o === 'ring' ? Array.from({ length: 10 }, (_, i) => ({ x: CX + Math.cos(i / 10 * TAU) * 52, y: CY + Math.sin(i / 10 * TAU) * 38 })) : [{ x: CX, y: CY }];
    const src = Array.from({ length: p.points }, () => ({ x: 3 + r() * (W - 6), y: 3 + r() * (H - 6) })), dOut = q => Math.min(...outlets.map(u => Math.hypot(q.x - u.x, q.y - u.y))); src.sort((a, b) => dOut(a) - dOut(b));
    return { P: outlets.map(u => ({ x: u.x, y: u.y, p: -1 })), nOut: outlets.length, src, i: 0 }; },
  step(s, p) { if (s.i >= s.src.length) return false; for (let k = 0; k < p.perStep && s.i < s.src.length; k++) { const q = s.src[s.i++]; let best = 0, bd = 1e9; for (let j = 0; j < s.P.length; j++) { const d = (q.x - s.P[j].x) ** 2 + (q.y - s.P[j].y) ** 2; if (d < bd) { bd = d; best = j; } } s.P.push({ x: q.x, y: q.y, p: best }); } return true; },
  acc(s) { const a = new Float32Array(s.P.length).fill(1); for (let i = s.P.length - 1; i >= s.nOut; i--) a[s.P[i].p] += a[i]; return a; },
  draw(x, s, p, age) { const a = this.acc(s), n = s.P.length; for (let i = s.nOut; i < n; i++) { const nd = s.P[i], q = s.P[nd.p]; if (age) x.strokeStyle = ageStyle(i / n); line(x, q.x, q.y, nd.x, nd.y, Math.min(p.wcap, p.wscale * Math.pow(a[i], p.wexp))); } },
  segments(s, p) { const a = this.acc(s); return s.P.slice(s.nOut).map((nd, k) => ({ a: s.P[nd.p], b: nd, w: Math.min(p.wcap, p.wscale * Math.pow(a[k + s.nOut], p.wexp)) })); },
  sigma: .7, contrast: 1.6,
});

// ---- 7 Differential growth ----
SYSTEMS.push({
  name: 'Differential growth', vector: true,
  params: [
    { key: 'shape', label: 'Shape', options: ['loop', 'open line'], def: 'loop' },
    { key: 'inside', label: 'Constraint', options: ['free', 'circle', 'letter'], def: 'free' },
    { key: 'RR', label: 'Repulsion radius', min: 1.2, max: 7, step: .1, def: 3.2, live: true, fmt: num },
    { key: 'ins', label: 'Insertions per step', min: 0, max: 5, step: 1, def: 1, live: true, fmt: int },
    { key: 'att', label: 'Attraction', min: .02, max: .6, step: .01, def: .25, live: true, fmt: num },
    { key: 'noise', label: 'Noise', min: 0, max: 1.2, step: .05, def: .3, live: true, fmt: num },
    { key: 'maxN', label: 'Max points', min: 100, max: 4000, step: 50, def: 1100, live: true, fmt: int },
    { key: 'fill', label: 'Fill the loop', options: ['filled', 'outline'], def: 'filled', live: true },
  ],
  init(p) { let Pn, inside = null, closed = p.shape === 'loop';
    if (p.inside === 'circle') inside = (x, y) => Math.hypot(x - CX, y - CY) < 50; if (p.inside === 'letter') inside = insideGlyph;
    if (!closed) Pn = Array.from({ length: 60 }, (_, i) => ({ x: 12 + i / 59 * (W - 24), y: CY }));
    else { let cx = CX, cy = CY, rad = 14; if (p.inside === 'letter') { let best = null, bd = 1e9; for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) { if (!GLYPH[y * W + x]) continue; let ok = true; for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!GLYPH[(y + dy) * W + x + dx]) { ok = false; break; } if (!ok) continue; const d = (x - CX) ** 2 + (y - CY) ** 2; if (d < bd) { bd = d; best = { x, y }; } } if (best) { cx = best.x; cy = best.y; } rad = 3; }
      Pn = Array.from({ length: 48 }, (_, i) => { const a = i / 48 * TAU; return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad * (rad > 5 ? .7 : 1) }; }); }
    const ag = makeSkel(W, H, 1); return { P: Pn, closed, inside, t: 0, ag }; },
  step(s, p) { let Pn = s.P; const n = Pn.length, closed = s.closed, edges = closed ? n : n - 1, RR = p.RR, cs = RR; s.t++;
    const insAt = new Set(); for (let k = 0; k < p.ins && n < p.maxN; k++) insAt.add(Math.floor(r() * edges));
    const Q = []; for (let i = 0; i < n; i++) { const a = Pn[i]; Q.push(a); if (i < edges) { const b = Pn[(i + 1) % n]; if (n < p.maxN && (insAt.has(i) || Math.hypot(b.x - a.x, b.y - a.y) > RR * .7)) Q.push({ x: (a.x + b.x) / 2 + (r() - .5) * .3, y: (a.y + b.y) / 2 + (r() - .5) * .3 }); } }
    Pn = Q; const m = Pn.length, Gm = new Map(); Pn.forEach((q, i) => { const k = ((q.x / cs) | 0) + 256 * ((q.y / cs) | 0); if (!Gm.has(k)) Gm.set(k, []); Gm.get(k).push(i); });
    const Fo = Pn.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < m; i++) { const q = Pn[i], pv = closed ? Pn[(i - 1 + m) % m] : Pn[i - 1], nx = closed ? Pn[(i + 1) % m] : Pn[i + 1];
      if (pv && nx) { Fo[i].x += ((pv.x + nx.x) / 2 - q.x) * p.att; Fo[i].y += ((pv.y + nx.y) / 2 - q.y) * p.att; }
      const gx = (q.x / cs) | 0, gy = (q.y / cs) | 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = Gm.get(gx + dx + 256 * (gy + dy)); if (!arr) continue; for (const j of arr) { if (j === i) continue; const ex = q.x - Pn[j].x, ey = q.y - Pn[j].y, d = Math.hypot(ex, ey); if (d < RR && d > 1e-6) { const k = (RR - d) / RR; Fo[i].x += ex / d * k; Fo[i].y += ey / d * k; } } }
      Fo[i].x += (r() - .5) * p.noise; Fo[i].y += (r() - .5) * p.noise; }
    for (let i = 0; i < m; i++) { if (!closed && (i === 0 || i === m - 1)) continue; const nx = clamp(Pn[i].x + Fo[i].x, 3, W - 4), ny = clamp(Pn[i].y + Fo[i].y, 3, H - 4); if (s.inside && !s.inside(nx, ny)) continue; Pn[i].x = nx; Pn[i].y = ny; }
    s.P = Pn; if (s.t % 25 === 0) { s.ag.fillStyle = s.ag.strokeStyle = ageStyle(Math.min(1, s.t / 800)); this.path(s.ag, s, { fill: 'filled' }); } return true; },
  path(x, s, p) { x.beginPath(); s.P.forEach((q, i) => i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)); if (s.closed) x.closePath(); if (s.closed && p.fill === 'filled') x.fill(); else { x.lineWidth = 1.4; x.stroke(); } },
  draw(x, s, p, age) { if (age) { x.drawImage(s.ag.canvas, 0, 0, W, H); x.fillStyle = x.strokeStyle = ageStyle(1); } this.path(x, s, p); },
  segments(s) { const out = []; for (let i = 0; i < s.P.length - (s.closed ? 0 : 1); i++) out.push({ a: s.P[i], b: s.P[(i + 1) % s.P.length], w: 1 }); return out; },
  sigma: 1, contrast: 1.5,
});

// ---- 8 Cracks ----
SYSTEMS.push({
  name: 'Cracks', vector: true,
  params: [
    { key: 'start', label: 'Start', options: ['top', 'centre', 'edges', 'ring', 'single'], def: 'top' },
    { key: 'angLo', label: 'Branch angle, min', min: .05, max: 1.5, step: .05, def: .15, live: true, fmt: v => Math.round(v * 57.3) + '°' },
    { key: 'angHi', label: 'Branch angle, max', min: .1, max: 1.57, step: .05, def: .35, live: true, fmt: v => Math.round(v * 57.3) + '°' },
    { key: 'wobble', label: 'Wobble', min: 0, max: .5, step: .01, def: .06, live: true, fmt: num },
    { key: 'branchP', label: 'Branch chance', min: 0, max: .2, step: .005, def: .03, live: true, fmt: v => (v * 100).toFixed(1) + '%' },
    { key: 'maxGen', label: 'Generations', min: 1, max: 8, step: 1, def: 4, live: true, fmt: int },
    { key: 'stopAll', label: 'Stop on contact', options: ['children only', 'everything'], def: 'children only', live: true },
    { key: 'maxCracks', label: 'Max cracks', min: 10, max: 400, step: 10, def: 120, live: true, fmt: int },
  ],
  init(p) { let starts; const st = p.start;
    if (st === 'top') starts = [0, 1].map(() => ({ x: W * (.3 + r() * .4), y: 1, a: Math.PI / 2 + (r() - .5) * .3 }));
    else if (st === 'centre') starts = Array.from({ length: 7 }, (_, i) => ({ x: CX, y: CY, a: i / 7 * TAU + r() * .3 }));
    else if (st === 'edges') starts = Array.from({ length: 12 }, (_, i) => { const side = i % 4, t = r(); return side === 0 ? { x: t * W, y: 1, a: Math.PI / 2 + (r() - .5) * .6 } : side === 1 ? { x: t * W, y: H - 2, a: -Math.PI / 2 + (r() - .5) * .6 } : side === 2 ? { x: 1, y: t * H, a: (r() - .5) * .6 } : { x: W - 2, y: t * H, a: Math.PI + (r() - .5) * .6 }; });
    else if (st === 'ring') starts = Array.from({ length: 10 }, (_, i) => { const a = i / 10 * TAU; return { x: CX + Math.cos(a) * 55, y: CY + Math.sin(a) * 42, a: a + Math.PI + (r() - .5) * .4 }; });
    else starts = [{ x: CX, y: 1, a: Math.PI / 2 }];
    return { cr: starts.map((q, i) => ({ ...q, w: 1.6, g: 0, n: 0, id: i + 1 })), nextId: starts.length + 1, id: new Int16Array(W * H), segs: [], t: 0 }; },
  step(s, p) { if (!s.cr.length) return false; s.t++;
    const markId = (px, py, k) => { const xi = Math.round(px), yi = Math.round(py); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = xi + dx, y = yi + dy; if (x >= 0 && y >= 0 && x < W && y < H && !s.id[y * W + x]) s.id[y * W + x] = k; } };
    const hits = (px, py, k) => { const xi = Math.round(px), yi = Math.round(py); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = xi + dx, y = yi + dy; if (x >= 0 && y >= 0 && x < W && y < H && s.id[y * W + x] && s.id[y * W + x] !== k) return true; } return false; };
    const next = [], lo = Math.min(p.angLo, p.angHi), hi = Math.max(p.angLo, p.angHi);
    for (const c of s.cr) { c.a += (r() - .5) * p.wobble; const nx = c.x + Math.cos(c.a) * 2, ny = c.y + Math.sin(c.a) * 2; c.n++;
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || c.n > 140) continue;
      s.segs.push({ a: { x: c.x, y: c.y }, b: { x: nx, y: ny }, w: c.w, t: s.t });
      if ((p.stopAll === 'everything' || c.g > 0) && c.n > 4 && hits(nx, ny, c.id)) continue;
      c.x = nx; c.y = ny; markId(nx, ny, c.id);
      if (c.g < p.maxGen && s.cr.length + next.length < p.maxCracks && r() < p.branchP) next.push({ x: nx, y: ny, a: c.a + (r() < .5 ? -1 : 1) * (lo + r() * (hi - lo)), w: Math.max(.6, c.w * .7), g: c.g + 1, n: 0, id: s.nextId++ });
      next.push(c); }
    s.cr = next; return true; },
  draw(x, s, p, age) { const mT = Math.max(1, s.t); for (const g of s.segs) { if (age) x.strokeStyle = ageStyle(g.t / mT); line(x, g.a.x, g.a.y, g.b.x, g.b.y, g.w); } },
  segments(s) { return s.segs; }, sigma: .35, contrast: 2.2,
});

// vector systems share one field builder: draw the structure at k× into a skeleton canvas, read back, blur
function vectorField(sys, s, p, w, h, k) {
  const sk = makeSkel(w, h, k); sys.draw(sk, s, p, false); const ag = makeSkel(w, h, k); sys.draw(ag, s, p, true);
  return { f: blur(toField(sk, w, h), w, h, sys.sigma * k), age: toField(ag, w, h), contrast: sys.contrast };
}
// Growth is an amount, never a clock. DLA/drainage use particle/point counts.
const GROWTH_STEPS = [150,0,450,1800,240,0,650,180];
function targetFor(sysIndex,p,amount){return Math.round((sysIndex===1?p.max:sysIndex===5?p.points:GROWTH_STEPS[sysIndex])*amount/100)}
function progressFor(sysIndex,s,steps){return sysIndex===1?s.stuck:sysIndex===5?s.i:steps}
function defaults(index){return Object.fromEntries(SYSTEMS[index].params.map(q=>[q.key,q.def]))}

// ======================= module wiring =======================
export const setGrid = (w, h) => { W = w; H = h; CX = W / 2 | 0; CY = H / 2 | 0; };
export const setRng = seed => { r = rng(seed); };
export const setGlyph = mask => { GLYPH = mask; };
export { W, H, SYSTEMS, vectorField, makeSkel, toField, blur, upBilinear, clamp, targetFor, progressFor, defaults };
