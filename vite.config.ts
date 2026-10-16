import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

/**
 * Dev-only time endpoint: mirrors Cloudflare Pages `functions/api/time.js`
 * so clock sync can be tested locally (`npm run dev`).
 */
function devApiEndpoints(): Plugin {
  const presenceMap = new Map<string, { deviceId: string; seat: unknown; userAgent: string; lastSeen: number }>();
  let activeCommand = { type: 'idle', targetTime: 0, tifo: 'algeria_flag', updatedAt: Date.now() };

  return {
    name: 'rayati-dev-api-endpoints',
    apply: 'serve',
    configureServer(server) {
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url) return next();

        // 1. /api/time
        if (req.url.startsWith('/api/time')) {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.setHeader('access-control-allow-origin', '*');
          return res.end(JSON.stringify({ now: Date.now() }));
        }

        // 2. /api/presence
        if (req.url.startsWith('/api/presence')) {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.setHeader('access-control-allow-origin', '*');

          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body || '{}');
                const action = data.action || 'heartbeat';

                if (action === 'validate') {
                  const targetIds = Array.isArray(data.deviceIds) ? data.deviceIds : [];
                  const validateAll = Boolean(data.validateAll);
                  let validatedCount = 0;
                  for (const [id, dev] of presenceMap.entries()) {
                    if (validateAll || targetIds.includes(id)) {
                      (dev as { validated?: boolean }).validated = true;
                      if (data.seat) (dev as { seat?: unknown }).seat = data.seat;
                      validatedCount++;
                    }
                  }
                  return res.end(JSON.stringify({ ok: true, validatedCount }));
                }

                const deviceId = String(data.deviceId || '').trim();
                let devEntry: { deviceId: string; seat: unknown; userAgent: string; lastSeen: number; validated?: boolean } | undefined;
                if (deviceId) {
                  const existing = presenceMap.get(deviceId) as { deviceId: string; seat: unknown; userAgent: string; lastSeen: number; validated?: boolean } | undefined;
                  devEntry = {
                    deviceId,
                    seat: data.seat || existing?.seat || null,
                    userAgent: req.headers['user-agent'] || 'DevDevice',
                    lastSeen: Date.now(),
                    validated: Boolean(existing?.validated || data.validated || false),
                  };
                  presenceMap.set(deviceId, devEntry);
                }
                res.end(JSON.stringify({
                  ok: true,
                  validated: devEntry?.validated || false,
                  seat: devEntry?.seat || null,
                  activeCount: presenceMap.size,
                }));
              } catch {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'invalid json' }));
              }
            });
            return;
          }

          // GET: return active devices in last 20s
          const now = Date.now();
          for (const [id, dev] of presenceMap.entries()) {
            if (now - dev.lastSeen > 20000) presenceMap.delete(id);
          }
          return res.end(JSON.stringify({ count: presenceMap.size, devices: Array.from(presenceMap.values()), now }));
        }

        // 3. /api/show
        if (req.url.startsWith('/api/show')) {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.setHeader('access-control-allow-origin', '*');

          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body || '{}');
                activeCommand = { ...data, updatedAt: Date.now() };
                res.end(JSON.stringify({ ok: true, activeCommand }));
              } catch {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'invalid json' }));
              }
            });
            return;
          }

          return res.end(JSON.stringify(activeCommand));
        }

        next();
      };
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [devApiEndpoints()],
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
