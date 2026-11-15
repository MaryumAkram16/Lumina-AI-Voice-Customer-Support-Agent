import { defineConfig } from 'vite';

/**
 * The demo page. Built into ../public, which Vercel serves as static files
 * next to the /api functions, so the page and the API share one origin.
 */
export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: '../public',
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
