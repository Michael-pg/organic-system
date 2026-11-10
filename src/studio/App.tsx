import { useEffect, useMemo, useRef, useState } from 'react';
import { DialRoot, useDialKitController, type DialConfig, type ResolvedValues } from 'dialkit';
import 'dialkit/styles.css';
import { SYSTEMS } from '../engine/systems.js';
import type { SystemInfo, WorkerMessage } from '../engine/types';
import { OrganicPlayer, DEFAULTS, LOOPS, RECEDES, SOURCES, PATTERNS, HOVERS, type Bake, type PlayerParams } from '../player/player';
import * as exporter from './exports';

const CATALOG: SystemInfo[] = SYSTEMS.map((s: any) => ({ name: s.name, vector: !!s.vector, living: !!s.recency, params: s.params }));
const DEFAULT_SYSTEM = 4; // Hyphae
const HIDDEN: Record<number, string[]> = { 1: ['batch'], 5: ['perStep'] };
// figure, ground, accent
const PALETTES: Record<string, [string, string, string]> = {
  'moss / bone': ['#efe9d6', '#16241c', '#ff8a4c'], 'plum / spore': ['#f4c7d8', '#2a1730', '#ffd166'], 'slate / lichen': ['#c9f27b', '#1d2433', '#7ad7f0'],
  'cream / clay': ['#b4482f', '#f3ead9', '#2f4b3a'], 'paper / ink': ['#1e1e1e', '#f5f2ea', '#d6452b'], 'night / white': ['#ffffff', '#000000', '#95bbec'],
  'olive / blue': ['#95bbec', '#6c5f17', '#e3fd52'],
};
const select = (options: readonly string[], def: string) => ({ type: 'select' as const, options: [...options], default: def });
const D = DEFAULTS;

const ORGANISM = {
  system: select(CATALOG.map(s => s.name), CATALOG[DEFAULT_SYSTEM].name),
  growth: [70, 0, 100, 1],
  seed: [1, 0, 9999, 1],
  newSeed: { type: 'action', label: 'New seed' },
} satisfies DialConfig;

const LOOP = {
  mode: select(LOOPS, D.loop),
  duration: [D.duration, 1, 30, .5],
  curve: { type: 'easing', duration: D.duration, ease: D.ease },
  growShare: [D.growShare, .05, 1, .01],
  holdShare: [D.holdShare, 0, .9, .01],
  recede: select(RECEDES, D.recede),
  softFront: [D.soft, 0, .3, .005],
  pulse: { _collapsed: true, bands: [D.bands, 1, 8, 1], laps: [D.laps, 1, 6, 1], width: [D.bandWidth, .05, .95, .01], rest: [D.base, 0, 1, .01] },
} satisfies DialConfig;

const LOOK = {
  source: select(SOURCES, D.source),
  pattern: select(PATTERNS, D.pattern),
  cell: [D.cell, 1, 16, 1],
  contrast: [D.contrast, .5, 3, .05],
  palette: select(Object.keys(PALETTES), 'moss / bone'),
  figure: D.figure,
  ground: D.ground,
  accent: D.accent,
  accentByAge: [D.accentMix, 0, 1, .01],
  transparent: false,
  fit: select(['cover', 'contain'], 'cover'),
  lines: { _collapsed: true, levels: [D.levels, 1, 16, 1], flow: [D.flow, -4, 4, 1], width: [D.lineWidth, .5, 8, .5] },
} satisfies DialConfig;

const ENVIRONMENT = {
  windDirection: { type: 'pad', x: [D.windX, -1, 1, .01], y: [D.windY, -1, 1, .01] },
  wind: [D.wind, 0, 1, .01],
  gusts: [D.gust, 0, 8, .1],
  sway: [D.sway, 0, .08, .001],
  breath: [D.breath, 0, 1.5, .01],
  grain: [D.noiseScale, 1, 20, .5],
  tempo: [D.tempo, 1, 8, 1],
} satisfies DialConfig;

const HOVER = {
  effect: select(HOVERS, D.hover),
  radius: [D.hoverRadius, .02, .5, .01],
  strength: [D.hoverStrength, 0, 2, .05],
  linger: [D.hoverLinger, .1, 6, .1],
} satisfies DialConfig;

const EXPORT = {
  width: select(['640', '960', '1280', '1920'], '1280'),
  fps: select(['24', '30', '60'], '30'),
  repeats: [1, 1, 6, 1],
  embed: { copySnippet: { type: 'action', label: 'Copy embed snippet + textures' }, html: { type: 'action', label: 'Download standalone HTML' } },
  video: { mp4: { type: 'action', label: 'Download MP4' }, gif: { type: 'action', label: 'Download GIF' } },
  still: { png: { type: 'action', label: 'Download PNG frame' }, svg: { type: 'action', label: 'Download animated SVG' } },
} satisfies DialConfig;

// Everything lives in one DialKit panel, so "Copy parameters" and "Save version" cover the whole piece.
// The shape folder is rebuilt per growth system; it is keyed by system so each one remembers its own values.
const shapeKey = (sys: number) => `${CATALOG[sys].name} shape`;
const shapeConfig = (sys: number): DialConfig => Object.fromEntries(CATALOG[sys].params.filter(q => !HIDDEN[sys]?.includes(q.key)).map(q =>
  [q.key, q.options ? select(q.options, String(q.def)) : [q.def as number, q.min!, q.max!, q.step!]]));
const panelConfig = (sys: number): DialConfig => ({
  organism: ORGANISM, [shapeKey(sys)]: shapeConfig(sys), loop: LOOP, look: LOOK,
  environment: { _collapsed: true, ...ENVIRONMENT }, hover: { _collapsed: true, ...HOVER }, export: { _collapsed: true, ...EXPORT },
});
type Values = ResolvedValues<{ organism: typeof ORGANISM; loop: typeof LOOP; look: typeof LOOK; environment: typeof ENVIRONMENT; hover: typeof HOVER; export: typeof EXPORT }>
  & Record<string, Record<string, number | string> | undefined>;

function glyphMask(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true })!, size = Math.min(w * .78, h * 1.04);
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = `bold ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('S', w / 2, h / 2 + size * .04);
  const d = x.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4] > 128 ? 1 : 0; return mask;
}

/** A growth grid with the same number of cells as the original 192 x 144, reshaped to fill the stage. */
function gridFor(width: number, height: number): [number, number] {
  const aspect = Math.min(2.6, Math.max(.4, width / Math.max(1, height))), h = Math.round(Math.sqrt(192 * 144 / aspect) / 2) * 2;
  return [Math.round(h * aspect / 2) * 2, h];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null), scrubRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<OrganicPlayer | null>(null), workerRef = useRef<Worker | null>(null), revision = useRef(0);
  const [sys, setSys] = useState(DEFAULT_SYSTEM), [grid, setGrid] = useState<[number, number] | null>(null);
  const [status, setStatus] = useState('Growing…'), [playing, setPlaying] = useState(true), [error, setError] = useState('');
  const grown = useRef<{ bake: Bake; segments?: Float32Array; name: string } | null>(null), busy = useRef(false), runExport = useRef<(path: string) => void>(() => {});

  const config = useMemo(() => panelConfig(sys), [sys]);
  const dial = useDialKitController('Organic System', config, { id: 'organic-system', onAction: path => {
    if (path.endsWith('newSeed')) dial.setValue('organism.seed', Math.floor(Math.random() * 9999)); else runExport.current(path);
  } });
  const v = dial.values as unknown as Values;
  const o = v.organism, loop = v.loop, l = v.look, env = v.environment, hover = v.hover, exp = v.export;
  const chosen = Math.max(0, CATALOG.findIndex(s => s.name === o.system));
  useEffect(() => { setSys(chosen); }, [chosen]);

  // player + worker lifetime
  useEffect(() => {
    let player: OrganicPlayer;
    try { player = new OrganicPlayer(canvasRef.current!); } catch (e) { setError((e as Error).message); return; }
    player.onFrame = phase => { const s = scrubRef.current; if (s && document.activeElement !== s) s.value = String(phase); };
    playerRef.current = player;
    if (import.meta.env.DEV) Object.assign(window, { __organic: player, __export: (path: string) => runExport.current(path), __exporter: exporter, __grown: grown });
    const worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'error') setError(data.message);
      if (data.type !== 'bake') return;
      player.setBake(data.bake);
      grown.current = { bake: data.bake, segments: data.segments, name: `${CATALOG[data.sys].name.toLowerCase().replace(/[^a-z]+/g, '-')}-seed${data.seed}` };
      if (data.revision === revision.current) setStatus(`${CATALOG[data.sys].name} · growth ${data.amount}% · seed ${data.seed} · ${Math.round(data.elapsed)} ms`);
    };
    worker.onerror = e => setError(e.message || 'The growth worker failed to start.');
    worker.postMessage({ type: 'init' });
    workerRef.current = worker;
    // grow at the shape of the stage, and re-grow once a resize settles
    let timer = 0; const stage = canvasRef.current!;
    const measure = () => { const g = gridFor(stage.clientWidth, stage.clientHeight); setGrid(old => old && old[0] === g[0] && old[1] === g[1] ? old : g); };
    const sizes = new ResizeObserver(() => { clearTimeout(timer); timer = window.setTimeout(measure, 250); }); sizes.observe(stage); measure();
    return () => { sizes.disconnect(); clearTimeout(timer); worker.terminate(); player.destroy(); playerRef.current = null; workerRef.current = null; };
  }, []);

  // shape changes re-grow the organism in the background; the player crossfades to the result
  const shape = chosen === sys ? v[shapeKey(sys)] : undefined, shapeJson = shape ? JSON.stringify(shape) : '';
  useEffect(() => {
    if (!shapeJson || !workerRef.current || !grid) return;
    setStatus(`${CATALOG[sys].name} · growing…`);
    const defaults = Object.fromEntries(CATALOG[sys].params.map(q => [q.key, q.def]));
    workerRef.current.postMessage({ type: 'bake', revision: ++revision.current, sys, seed: o.seed, amount: o.growth, params: { ...defaults, ...JSON.parse(shapeJson) }, grid, glyph: glyphMask(grid[0], grid[1]) });
  }, [sys, o.seed, o.growth, shapeJson, grid]);

  // look and motion are just numbers handed to the shader, so they apply on the next frame
  const paletteRef = useRef(l.palette);
  useEffect(() => {
    if (paletteRef.current === l.palette) return; paletteRef.current = l.palette;
    const [figure, ground, accent] = PALETTES[l.palette] ?? PALETTES['moss / bone']; dial.setValues({ look: { figure, ground, accent } } as never);
  }, [l.palette]);

  const curve = loop.curve as { ease?: [number, number, number, number] };
  const params: Partial<PlayerParams> = {
    loop: loop.mode as PlayerParams['loop'], duration: loop.duration, ease: Array.isArray(curve.ease) ? curve.ease : D.ease,
    growShare: loop.growShare, holdShare: loop.holdShare, recede: loop.recede as PlayerParams['recede'], soft: loop.softFront,
    bands: loop.pulse.bands, laps: loop.pulse.laps, bandWidth: loop.pulse.width, base: loop.pulse.rest,
    source: l.source as PlayerParams['source'], pattern: l.pattern as PlayerParams['pattern'], cell: l.cell, contrast: l.contrast,
    levels: l.lines.levels, flow: l.lines.flow, lineWidth: l.lines.width,
    figure: l.figure, ground: l.ground, accent: l.accent, accentMix: l.accentByAge, transparent: l.transparent, fit: l.fit as PlayerParams['fit'], seed: o.seed,
    windX: env.windDirection.x, windY: env.windDirection.y, wind: env.wind, gust: env.gusts, sway: env.sway, breath: env.breath, noiseScale: env.grain, tempo: env.tempo,
    hover: hover.effect as PlayerParams['hover'], hoverRadius: hover.radius, hoverStrength: hover.strength, hoverLinger: hover.linger,
  };
  useEffect(() => { playerRef.current?.set(params); });

  runExport.current = async path => {
    const player = playerRef.current, g = grown.current, kind = path.split('.').pop();
    if (!player || !g || busy.current) return;
    const c = player.canvas, aspect = g.bake.width / g.bake.height, fits = Math.min(c.clientWidth, c.clientHeight * aspect), covers = Math.max(c.clientWidth, c.clientHeight * aspect);
    const job: exporter.ExportJob = { ...g, params: { ...player.params }, previewWidth: player.params.fit === 'cover' ? covers : fits,
      width: Number(exp.width), fps: Number(exp.fps), repeats: exp.repeats, progress: setStatus };
    busy.current = true; setError('');
    try {
      if (kind === 'copySnippet') { const text = exporter.snippet(job); await exporter.downloadTextures(job);
        try { await navigator.clipboard.writeText(text); setStatus('Embed snippet copied; textures downloaded.'); }
        catch { exporter.download(new Blob([text], { type: 'text/html' }), `${g.name}-snippet.html`); setStatus('Clipboard was blocked, so the snippet was downloaded with the textures.'); } }
      else if (kind === 'html') { exporter.download(await exporter.standaloneHtml(job), `${g.name}.html`); setStatus('Standalone HTML downloaded.'); }
      else if (kind === 'mp4') { exporter.download(await exporter.mp4(job), `${g.name}.mp4`); setStatus('MP4 downloaded.'); }
      else if (kind === 'gif') { exporter.download(await exporter.gif(job), `${g.name}.gif`); setStatus('GIF downloaded.'); }
      else if (kind === 'png') { exporter.download(await exporter.stillPng(job, player.phase), `${g.name}-frame.png`); setStatus('PNG frame downloaded.'); }
      else if (kind === 'svg') { exporter.download(exporter.animatedSvg(job), `${g.name}.svg`); setStatus('Animated SVG downloaded.'); }
    } catch (e) { setError((e as Error).message); setStatus('Export failed.'); }
    finally { busy.current = false; }
  };

  const toggle = () => { const p = playerRef.current; if (!p) return; p.playing = !p.playing; setPlaying(p.playing); };
  const backdrop = l.transparent ? 'repeating-conic-gradient(#d9d9d9 0% 25%, #fff 0% 50%) 0 / 20px 20px' : l.ground;

  return (
    <>
      <main className="stage" style={{ background: backdrop }}>
        <canvas ref={canvasRef} />
        {error && <p className="error" role="alert">{error}</p>}
      </main>
      <footer className="bar">
        <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</button>
        <input ref={scrubRef} type="range" min="0" max="1" step="0.001" defaultValue="0" aria-label="Loop position"
          onInput={e => { const p = playerRef.current; if (p) p.phase = Number(e.currentTarget.value); }} />
        <span role="status" aria-live="polite">{status}</span>
      </footer>
      <DialRoot position="top-right" theme="dark" productionEnabled />
    </>
  );
}
