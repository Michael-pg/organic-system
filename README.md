# Organic System

A studio for growing organic forms (hyphae, branches, cracks, slime mould, reaction-diffusion and more) and turning them into seamless looping animations.

- **Grow** a form from one of eight simulations, with a seed and shape controls.
- **Loop** it: grow → hold → recede, a travelling pulse, or a still that breathes.
- **Style** it: dither, halftone, lines, contours, age rings, outline, palettes.
- **React**: wind, sway and breath, plus hover effects (bloom, recoil, ripple).
- **Export**: an embeddable web component, a standalone HTML file, MP4, GIF, PNG, or animated SVG.

## Run it

```bash
npm install
npm run dev
```

`npm run build` produces a static site in `dist/` (no server needed).

## Use an export on your own site

"Copy embed snippet + textures" gives you a PNG and a few lines of HTML:

```html
<script type="module" src="organic-loop.js"></script>
<organic-loop src="hyphae-seed1.png" recipe='{"v":1,"params":{},"bake":{"binary":false,"contrast":1.4}}'></organic-loop>
```

`organic-loop.js` is about 8 KB gzipped with no dependencies; it is built to `public/organic-loop.js` and served from the site root. Size the element with CSS. It pauses off screen and shows a still frame for people who prefer reduced motion. Change settings live with `element.set({ figure: '#fff', duration: 12 })`.

## Layout

- `src/engine` – growth simulations, run in a worker and baked to a texture (density, age, blur).
- `src/player` – the WebGL2 player and the `<organic-loop>` element. This is the part that ships to other sites.
- `src/studio` – the editor, built with React and DialKit.
- `reference/` – the static editor this project grew out of.
