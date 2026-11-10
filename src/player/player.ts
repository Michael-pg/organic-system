// Organic player: animates a baked organism on the GPU. No dependencies; this is the part that ships to other sites.
import { VERT, FRAG, INFLUENCE_FRAG } from './shaders';

export interface Bake {
  width: number; height: number;
  /** RGBA8: R density, G age, B wide blur. */
  pixels: Uint8Array;
  binary: boolean; contrast: number;
  /** Optional looping frames of the density field, for systems that keep moving. */
  flip?: { count: number; width: number; height: number; data: Uint8Array };
}

export const LOOPS = ['still', 'grow', 'pulse'] as const;
export const RECEDES = ['retract', 'decay'] as const;
export const SOURCES = ['form', 'contours', 'rings', 'outline'] as const;
export const PATTERNS = ['soft', 'random', 'bayer4', 'bayer8', 'threshold', 'halftone', 'lines'] as const;
export const HOVERS = ['none', 'bloom', 'recoil', 'ripple'] as const;

export interface PlayerParams {
  // loop
  loop: (typeof LOOPS)[number];
  /** Seconds per loop. */
  duration: number;
  /** Share of the loop spent growing and holding; the rest recedes. */
  growShare: number; holdShare: number;
  recede: (typeof RECEDES)[number];
  ease: [number, number, number, number];
  /** Softness of the growth front, in age units. */
  soft: number;
  bands: number; laps: number; bandWidth: number; base: number;
  // look
  source: (typeof SOURCES)[number];
  pattern: (typeof PATTERNS)[number];
  cell: number; contrast: number;
  levels: number; flow: number; lineWidth: number;
  figure: string; ground: string; accent: string; accentMix: number;
  transparent: boolean; seed: number;
  fit: 'contain' | 'cover';
  /** Width in CSS pixels the look was designed at. When set, cell and line sizes scale with the element so it looks the same at any size. 0 keeps them in absolute pixels. */
  refWidth: number;
  // environment
  windX: number; windY: number; wind: number; gust: number;
  sway: number; breath: number; noiseScale: number; tempo: number;
  // hover
  hover: (typeof HOVERS)[number];
  hoverRadius: number; hoverStrength: number; hoverLinger: number;
}

export const DEFAULTS: PlayerParams = {
  loop: 'grow', duration: 8, growShare: .55, holdShare: .15, recede: 'decay', ease: [.45, 0, .2, 1], soft: .04,
  bands: 2, laps: 1, bandWidth: .35, base: .15,
  source: 'form', pattern: 'bayer4', cell: 3, contrast: 1.5, levels: 6, flow: 1, lineWidth: 1.5,
  figure: '#d4ff3d', ground: '#1c232e', accent: '#3de8ff', accentMix: .85, transparent: false, seed: 1, fit: 'contain', refWidth: 0,
  windX: 1, windY: 0, wind: 0, gust: 2, sway: .01, breath: .25, noiseScale: 5, tempo: 2,
  hover: 'bloom', hoverRadius: .12, hoverStrength: 1, hoverLinger: 1.2,
};

function bezier([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 24; i++) { const v = at(x1, x2, t); if (Math.abs(v - x) < 1e-5) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
  return at(y1, y2, t);
}

/** The window of ages that is visible at a point in the loop. */
export function envelope(p: PlayerParams, phase: number): { lo: number; hi: number } {
  const s = p.soft + .01, open = { lo: -1, hi: 2 };
  if (p.loop !== 'grow') return open;
  const grow = Math.max(.01, p.growShare), hold = Math.max(0, Math.min(1 - grow, p.holdShare)), rest = 1 - grow - hold;
  const span = (e: number) => -s + e * (1 + 2 * s);
  if (phase < grow) return { lo: -1, hi: span(bezier(p.ease, phase / grow)) };
  if (phase < grow + hold || rest <= 0) return open;
  const e = bezier(p.ease, (phase - grow - hold) / rest);
  return p.recede === 'retract' ? { lo: -1, hi: span(1 - e) } : { lo: span(e), hi: 2 };
}

/** How visible something of a given age is at a point in the loop. Mirrors visible() in the shader. */
export function visibility(p: PlayerParams, phase: number, age: number): number {
  const step = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const { lo, hi } = envelope(p, phase), s = p.soft + .001;
  if (p.loop === 'pulse') {
    const f = age * Math.round(p.bands) - phase * Math.round(p.laps), x = Math.abs(f - Math.floor(f) - .5) * 2;
    return p.base + (1 - p.base) * (1 - step(p.bandWidth, p.bandWidth + s * 4 + .02, x));
  }
  return (1 - step(hi - s, hi + s, age)) * step(lo - s, lo + s, age);
}

/** The point in the loop that best stands in for the whole thing (reduced motion, poster frames). */
export function restPhase(p: PlayerParams): number { return p.loop === 'grow' ? Math.min(.999, p.growShare + p.holdShare / 2) : 0; }

export interface PlayerOptions {
  /** Follow the canvas's CSS size. Turn off to render at a fixed canvas width and height. */
  autoSize?: boolean;
  /** Device pixels per CSS pixel for cell and line sizes. Defaults to the display's. */
  pixelRatio?: number;
  /** Start the animation loop straight away. */
  autoplay?: boolean;
}

let probe: CanvasRenderingContext2D | null = null;
const colours = new Map<string, [number, number, number]>();
function rgb(css: string): [number, number, number] {
  let c = colours.get(css);
  if (!c) {
    probe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
    probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = css; probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data; c = [d[0] / 255, d[1] / 255, d[2] / 255];
    if (colours.size > 256) colours.clear(); colours.set(css, c);
  }
  return c;
}

const INF_W = 128, INF_H = 96, SWAP_MS = 450;

export class OrganicPlayer {
  readonly canvas: HTMLCanvasElement;
  params: PlayerParams = { ...DEFAULTS };
  /** Position in the loop, 0..1. */
  phase = 0;
  playing = true;
  /** Called every frame with the current phase. */
  onFrame?: (phase: number) => void;

  private gl: WebGL2RenderingContext;
  private main: WebGLProgram; private inf: WebGLProgram;
  private uni = new Map<string, WebGLUniformLocation | null>();
  private texA: WebGLTexture; private texB: WebGLTexture; private flipTex: WebGLTexture;
  private infTex: WebGLTexture[] = []; private infFbo: WebGLFramebuffer[] = []; private infIndex = 0;
  private bake: Bake | null = null; private swapStart = -1e9; private hasFlip = false; private flipCount = 1; private aspect = 4 / 3;
  private pointer = { x: -9, y: -9, down: 0 };
  private raf = 0; private last = 0; private time = 0;
  private observer: ResizeObserver | null = null; private cleanup: (() => void)[] = [];
  private options: PlayerOptions;

  constructor(canvas: HTMLCanvasElement, options: PlayerOptions = {}) {
    this.canvas = canvas; this.options = options;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.main = this.program(VERT, FRAG); this.inf = this.program(VERT, INFLUENCE_FRAG);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [this.main, this.inf]) { const loc = gl.getAttribLocation(p, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const blank = new Uint8Array([0, 1, 0, 255]);
    this.texA = this.texture(1, 1, blank, false); this.texB = this.texture(1, 1, blank, false);
    this.flipTex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.flipTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, 1, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1)); this.flipFilter();
    for (let i = 0; i < 2; i++) {
      const t = this.texture(INF_W, INF_H, new Uint8Array(INF_W * INF_H * 4), false), f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      this.infTex.push(t); this.infFbo.push(f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (options.autoSize !== false) { this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas); this.resize(); }
    const move = (e: PointerEvent) => { const p = this.toBake(e.clientX, e.clientY); this.pointer.x = p[0]; this.pointer.y = p[1]; this.pointer.down = 1; };
    const leave = () => { this.pointer.down = 0; };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', move); canvas.addEventListener('pointerleave', leave);
    this.cleanup.push(() => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', move); canvas.removeEventListener('pointerleave', leave); });
    if (options.autoplay !== false) this.start();
  }

  /** Run the animation loop. */
  start() { if (!this.raf) { this.last = 0; this.raf = requestAnimationFrame(this.tick); } }
  /** Stop drawing altogether (off-screen, reduced motion, export). */
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  set(patch: Partial<PlayerParams>) { Object.assign(this.params, patch); }

  /** Swap in a new organism. The previous one crossfades out, so reshaping reads as morphing. */
  setBake(bake: Bake) {
    const gl = this.gl, first = !this.bake;
    [this.texA, this.texB] = [this.texB, this.texA];
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bake.width, bake.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bake.pixels);
    const filter = bake.binary ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    this.hasFlip = !!bake.flip;
    if (bake.flip) { this.flipCount = bake.flip.count; gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.flipTex);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, bake.flip.width, bake.flip.height, bake.flip.count, 0, gl.RED, gl.UNSIGNED_BYTE, bake.flip.data); this.flipFilter(); }
    this.bake = bake; this.aspect = bake.width / bake.height;
    this.swapStart = first ? -1e9 : performance.now();
  }

  /** Draw one frame at an exact point in the loop (used for deterministic export). */
  render(phase = this.phase) { this.phase = phase; this.draw(0); }

  destroy() { this.stop(); this.observer?.disconnect(); this.cleanup.forEach(f => f()); this.gl.getExtension('WEBGL_lose_context')?.loseContext(); }

  // ---- internals ----
  private tick = (now: number) => {
    const dt = Math.min(.1, (now - (this.last || now)) / 1000); this.last = now;
    if (this.playing) this.phase = (this.phase + dt / Math.max(.1, this.params.duration)) % 1;
    this.time += dt; this.draw(dt); this.onFrame?.(this.phase);
    this.raf = requestAnimationFrame(this.tick);
  };

  private draw(dt: number) {
    const gl = this.gl, p = this.params, c = this.canvas;
    // 1. pointer influence
    const src = this.infIndex, dst = 1 - src;
    gl.useProgram(this.inf); gl.bindFramebuffer(gl.FRAMEBUFFER, this.infFbo[dst]); gl.viewport(0, 0, INF_W, INF_H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.infTex[src]);
    this.f(this.inf, 'uPrev', 0, true); this.f(this.inf, 'uDown', p.hover === 'none' ? 0 : this.pointer.down);
    gl.uniform2f(this.u(this.inf, 'uPtr'), this.pointer.x, this.pointer.y); gl.uniform2f(this.u(this.inf, 'uTexel'), 1 / INF_W, 1 / INF_H);
    this.f(this.inf, 'uDecay', dt > 0 ? Math.exp(-dt / Math.max(.05, p.hoverLinger)) : 1); this.f(this.inf, 'uRadius', p.hoverRadius); this.f(this.inf, 'uAspect', this.aspect);
    gl.drawArrays(gl.TRIANGLES, 0, 3); this.infIndex = dst;

    // 2. organism
    const m = this.main, env = envelope(p, this.phase), shown = p.fit === 'cover' ? Math.max(c.width, c.height * this.aspect) : Math.min(c.width, c.height * this.aspect);
    const dpr = this.options.pixelRatio ?? (p.refWidth > 0 ? shown / p.refWidth : c.width / Math.max(1, c.clientWidth || c.width));
    gl.useProgram(m); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, c.width, c.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.infTex[dst]);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.flipTex);
    this.f(m, 'uA', 0, true); this.f(m, 'uB', 1, true); this.f(m, 'uInf', 2, true); this.f(m, 'uFlip', 3, true);
    const mix = Math.min(1, (performance.now() - this.swapStart) / SWAP_MS);
    this.f(m, 'uMix', mix * mix * (3 - 2 * mix)); this.f(m, 'uHasFlip', this.hasFlip ? 1 : 0); this.f(m, 'uFlipCount', this.flipCount); this.f(m, 'uFlipLaps', Math.max(1, Math.round(p.laps)));
    this.f(m, 'uBinary', this.bake?.binary ? 1 : 0); this.f(m, 'uAspect', this.aspect); this.f(m, 'uFit', p.fit === 'cover' ? 1 : 0);
    gl.uniform2f(this.u(m, 'uRes'), c.width, c.height); this.f(m, 'uPhase', this.phase); this.f(m, 'uTime', this.time);
    this.f(m, 'uLo', env.lo); this.f(m, 'uHi', env.hi); this.f(m, 'uSoft', p.soft + .001);
    this.f(m, 'uPulse', p.loop === 'pulse' ? 1 : 0); this.f(m, 'uBands', Math.round(p.bands)); this.f(m, 'uLaps', Math.round(p.laps)); this.f(m, 'uBandWidth', p.bandWidth); this.f(m, 'uBase', p.base);
    this.f(m, 'uSource', SOURCES.indexOf(p.source), true); this.f(m, 'uPattern', PATTERNS.indexOf(p.pattern), true);
    this.f(m, 'uCell', Math.max(1, Math.round(p.cell * dpr))); this.f(m, 'uContrast', p.contrast * (this.bake?.contrast ?? 1.5) / 1.5);
    this.f(m, 'uLevels', Math.round(p.levels)); this.f(m, 'uFlow', Math.round(p.flow)); this.f(m, 'uLineW', p.lineWidth * dpr);
    this.f(m, 'uAccentMix', p.accentMix); this.f(m, 'uTransparent', p.transparent ? 1 : 0); this.f(m, 'uSeed', p.seed % 1000);
    gl.uniform3fv(this.u(m, 'uFigure'), rgb(p.figure)); gl.uniform3fv(this.u(m, 'uGround'), rgb(p.ground)); gl.uniform3fv(this.u(m, 'uAccent'), rgb(p.accent));
    const wl = Math.hypot(p.windX, p.windY) || 1;
    gl.uniform2f(this.u(m, 'uWindDir'), p.windX / wl, -p.windY / wl);
    this.f(m, 'uWind', p.wind * .05 * Math.min(1, Math.hypot(p.windX, p.windY))); this.f(m, 'uGust', p.gust); this.f(m, 'uSway', p.sway); this.f(m, 'uBreath', p.breath);
    this.f(m, 'uNoiseScale', p.noiseScale); this.f(m, 'uTempo', Math.max(1, Math.round(p.tempo)));
    this.f(m, 'uHover', HOVERS.indexOf(p.hover), true); this.f(m, 'uHoverStrength', p.hoverStrength);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Client coordinates to bake space, mirroring the shader's fit. */
  private toBake(cx: number, cy: number): [number, number] {
    const r = this.canvas.getBoundingClientRect(), ca = r.width / r.height;
    let wide = ca > this.aspect; if (this.params.fit === 'cover') wide = !wide;
    const sx = wide ? ca / this.aspect : 1, sy = wide ? 1 : this.aspect / ca;
    return [((cx - r.left) / r.width - .5) * sx + .5, ((cy - r.top) / r.height - .5) * sy + .5];
  }

  private resize() {
    const c = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  private u(p: WebGLProgram, name: string) {
    const key = (p === this.main ? 'm:' : 'i:') + name;
    if (!this.uni.has(key)) this.uni.set(key, this.gl.getUniformLocation(p, name));
    return this.uni.get(key)!;
  }
  private f(p: WebGLProgram, name: string, value: number, int = false) { int ? this.gl.uniform1i(this.u(p, name), value) : this.gl.uniform1f(this.u(p, name), value); }

  private flipFilter() { const gl = this.gl;
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, gl.LINEAR);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, gl.CLAMP_TO_EDGE); }

  private texture(w: number, h: number, data: Uint8Array, nearest: boolean) {
    const gl = this.gl, t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, nearest ? gl.NEAREST : gl.LINEAR);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    return t;
  }

  private program(vs: string, fs: string) {
    const gl = this.gl, p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader failed to compile.');
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Program failed to link.');
    return p;
  }
}
