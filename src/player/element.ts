// <organic-loop>: the embeddable form of the player.
//
//   <script type="module" src="organic-loop.js"></script>
//   <organic-loop src="organism.png" recipe='{"params":{...},"bake":{...}}'></organic-loop>
//
// Attributes: src (baked organism PNG), flip-src (optional frame atlas), recipe (JSON), paused.
// Any player setting can also be changed live from script: element.set({ figure: '#fff', duration: 12 }).
import { OrganicPlayer, DEFAULTS, restPhase, type Bake, type PlayerParams } from './player';

export interface Recipe {
  v: 1;
  params: Partial<PlayerParams>;
  bake: { binary: boolean; contrast: number };
  flip?: { count: number; cols: number; width: number; height: number };
}

function loadPixels(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0); resolve(x.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = () => reject(new Error('organic-loop: could not load ' + src.slice(0, 80)));
    img.src = src;
  });
}

export class OrganicLoopElement extends HTMLElement {
  static observedAttributes = ['src', 'flip-src', 'recipe', 'paused'];
  player: OrganicPlayer | null = null;
  private recipe: Recipe | null = null;
  private loadId = 0; private visible = true;
  private io: IntersectionObserver | null = null;
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  connectedCallback() {
    if (this.player) return;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{display:block;aspect-ratio:4/3;overflow:hidden}canvas{display:block;width:100%;height:100%;touch-action:pan-y}</style><canvas part="canvas"></canvas>';
    try { this.player = new OrganicPlayer(root.querySelector('canvas')!, { autoplay: false }); }
    catch (error) { console.warn(error); return; }
    this.io = new IntersectionObserver(entries => { this.visible = entries[entries.length - 1].isIntersecting; this.sync(); });
    this.io.observe(this);
    this.motion.addEventListener('change', this.sync);
    this.readRecipe(); this.load();
  }

  disconnectedCallback() {
    this.io?.disconnect(); this.io = null; this.motion.removeEventListener('change', this.sync);
    this.player?.destroy(); this.player = null;
  }

  attributeChangedCallback(name: string) {
    if (!this.player) return;
    if (name === 'recipe') this.readRecipe();
    if (name === 'src' || name === 'flip-src') this.load();
    this.sync();
  }

  /** Change any player setting live. */
  set(patch: Partial<PlayerParams>) { this.player?.set(patch); if (!this.player?.playing) this.player?.render(); }

  // Only animate while on screen, and hold a still frame for people who ask for reduced motion.
  private sync = () => {
    const p = this.player; if (!p) return;
    if (this.motion.matches) { p.stop(); p.render(restPhase(p.params)); return; }
    p.playing = !this.hasAttribute('paused');
    if (this.visible) p.start(); else p.stop();
  };

  private readRecipe() {
    try { this.recipe = JSON.parse(this.getAttribute('recipe') || 'null'); } catch { console.warn('organic-loop: recipe is not valid JSON'); return; }
    this.player?.set({ ...DEFAULTS, ...this.recipe?.params });
  }

  private async load() {
    const src = this.getAttribute('src'), flipSrc = this.getAttribute('flip-src'), id = ++this.loadId;
    if (!src) return;
    try {
      const [main, atlas] = await Promise.all([loadPixels(src), flipSrc && this.recipe?.flip ? loadPixels(flipSrc) : null]);
      if (id !== this.loadId || !this.player) return;
      const bake: Bake = { width: main.width, height: main.height, pixels: new Uint8Array(main.data.buffer), binary: !!this.recipe?.bake?.binary, contrast: this.recipe?.bake?.contrast ?? 1.5 };
      const f = this.recipe?.flip;
      if (atlas && f) {
        const data = new Uint8Array(f.count * f.width * f.height);
        for (let i = 0; i < f.count; i++) { const ox = (i % f.cols) * f.width, oy = Math.floor(i / f.cols) * f.height;
          for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) data[(i * f.height + y) * f.width + x] = atlas.data[((oy + y) * atlas.width + ox + x) * 4]; }
        bake.flip = { count: f.count, width: f.width, height: f.height, data };
      }
      this.player.setBake(bake); this.sync();
    } catch (error) { console.warn(error); }
  }
}

if (!customElements.get('organic-loop')) customElements.define('organic-loop', OrganicLoopElement);
