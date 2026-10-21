import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file (all JS, CSS and images inlined). Used as the template
// for "Export → Interactive HTML": the app injects the loaded data into a copy of it.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  worker: { format: 'es' },
  define: { __INGOVIQ_STANDALONE__: 'true' },
  build: { outDir: 'dist-standalone', emptyOutDir: true, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10000 },
});
