import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Vite config for the Set Tools Svelte app.
// Dev:   `npm run dev`    → http://localhost:5173/
// Build: `npm run build`  → dist/ (static files; serve from project root for production)
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
