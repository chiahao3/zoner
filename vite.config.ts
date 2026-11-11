import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> dist/        (GitHub Pages, relative base so it works under /<repo>/)
// `npm run build:single` -> dist-single/ (one self-contained zoner.html for offline microscope PCs)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: { include: ['tests/**/*.test.ts'] },
}));
