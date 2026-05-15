import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Vite config for the Set Tools Svelte app.
//
// Dev:    `npm run dev`    → http://localhost:5173/
// Build:  `npm run build`  → ../tomorrow/  (served at /tomorrow/ by the
//                            existing :8282 Python static server)
//
// `base: '/tomorrow/'` is critical: it makes the built index.html reference
// its assets at /tomorrow/assets/... so they resolve correctly when served
// under that path. Without it, the page loads but assets 404.
export default defineConfig({
  plugins: [svelte()],
  base: '/tomorrow/',
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: '../tomorrow',
    emptyOutDir: true,
    sourcemap: true,
  },
});
