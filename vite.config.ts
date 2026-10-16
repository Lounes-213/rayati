import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

/**
 * Dev-only time endpoint: mirrors Cloudflare Pages `functions/api/time.js`
 * so clock sync can be tested locally (`npm run dev`).
 */
function timeEndpoint(): Plugin {
  return {
    name: 'rayati-time-endpoint',
    apply: 'serve',
    configureServer(server) {
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/time')) return next();
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.setHeader('access-control-allow-origin', '*');
        res.end(JSON.stringify({ now: Date.now() }));
      };
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [timeEndpoint()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 2048,
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        simulation: resolve(import.meta.dirname, 'simulation.html'),
        guide: resolve(import.meta.dirname, 'guide.html'),
        control: resolve(import.meta.dirname, 'control.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
