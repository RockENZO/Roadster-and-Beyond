import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /<repo>/ and anywhere else.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
});
