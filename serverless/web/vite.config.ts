import { defineConfig } from 'vite';

/**
 * The demo page. Built into ../public/demo and served at /demo, next to the
 * landing page (at /, see scripts/build-landing.mjs) and the /api functions,
 * so everything shares one origin.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: '/demo/',
  build: {
    outDir: '../public/demo',
    emptyOutDir: true,
    target: 'es2022',
    // The Retell client bundles its WebRTC stack; it is loaded lazily.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    // `npm run dev:local` serves the API on port 3000.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
