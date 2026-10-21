import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the build work on GitHub Pages under /INGOVIQ-AI/ and from any folder
export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  define: { __INGOVIQ_STANDALONE__: 'false' },
  build: { chunkSizeWarningLimit: 2500 },
});
