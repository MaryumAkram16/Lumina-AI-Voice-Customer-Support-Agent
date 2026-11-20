import { defineConfig } from 'vite';

/**
 * The "Talk to Lumina" page. Built into ../public and served at /, next to the
 * kit page (at /kit/, see scripts/build-landing.ts) and the /api functions,
 * so everything shares one origin. emptyOutDir is off so the kit page that
 * build-landing.ts put in public/kit/ survives.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  build: {
    outDir: '../public',
    emptyOutDir: false,
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
