import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Cache all static assets (JS, CSS, HTML, images)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't precache source maps
        globIgnores: ['**/*.map'],
        runtimeCaching: [
          {
            // Cache API calls to Supabase with network-first strategy
            urlPattern: /^https:\/\/qywzcaghcyueegxnkhjj\.supabase\.co/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
      manifest: {
        name: 'Set Tools — DA Workstation',
        short_name: 'Set Tools',
        description: '2nd AD / 2nd 2nd AD workstation for film & TV production',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/tomorrow/',
        scope: '/tomorrow/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
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
