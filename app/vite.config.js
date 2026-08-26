import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Deploy under a subpath (e.g. GitHub Pages /d3sign/) with:
  //   VITE_BASE=/d3sign/ npm run build
  // Defaults to './' so dist/ works from any directory.
  base: process.env.VITE_BASE || './',
  build: {
    outDir: 'dist',
  },
  server: {
    host: '0.0.0.0',
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  preview: {
    host: '0.0.0.0',
  },
});
