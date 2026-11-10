import { defineConfig } from 'vite';

// Builds the embeddable <organic-loop> element as one dependency-free file. It lands in public/ so the
// studio can inline it into exports, and so the deployed site serves it at /organic-loop.js.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public', emptyOutDir: false, copyPublicDir: false,
    lib: { entry: 'src/player/element.ts', formats: ['es'], fileName: () => 'organic-loop.js' },
  },
});
