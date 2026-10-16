/**
 * Service Worker bridge. The page never talks to Cache Storage directly: it asks
 * the worker to keep the show file, and gets per-URL progress back, so the Ready
 * screen can prove that "everything is offline before kick-off".
 */
import { PATHS } from '../core/config';

export interface PrecacheProgress {
  url: string;
  done: number;
  total: number;
  ok: boolean;
}

export interface ServiceWorkerBridge {
  readonly supported: boolean;
  register(): Promise<'ready' | 'unsupported' | 'failed'>;
  /** Ask the worker to cache the given URLs (top-level + chunks + corrections). */
  precache(urls: string[], onProgress?: (p: PrecacheProgress) => void): Promise<PrecacheProgress[]>;
  cacheStatus(urls: string[]): Promise<Record<string, boolean>>;
  clearData(): Promise<void>;
  /** True when a newer worker is installed and waiting to take over. */
  hasUpdate(): boolean;
  onUpdate(cb: () => void): () => void;
}

type SwMessage =
  | { type: 'rayati.precache'; urls: string[] }
  | { type: 'rayati.status'; urls: string[] }
  | { type: 'rayati.clear' };

interface SwReply {
  type: string;
  url?: string;
  done?: number;
  total?: number;
  ok?: boolean;
  results?: Record<string, boolean>;
}

export function createServiceWorkerBridge(options: { url?: string } = {}): ServiceWorkerBridge {
  const url = options.url ?? PATHS.sw;
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  let registration: ServiceWorkerRegistration | null = null;
  let waiting: ServiceWorker | null = null;
  const updateListeners = new Set<() => void>();

  function track(reg: ServiceWorkerRegistration): void {
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          waiting = installing;
          updateListeners.forEach((cb) => cb());
        }
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) waiting = reg.waiting;
  }

  /** Resolve the controlling worker (may be null before the first load). */
  async function controller(): Promise<ServiceWorker | null> {
    if (!supported) return null;
    if (!registration) {
      try {
        registration = (await navigator.serviceWorker.getRegistration()) ?? null;
      } catch {
        registration = null;
      }
    }
    return navigator.serviceWorker.controller ?? registration?.active ?? null;
  }

  async function send(message: SwMessage, onProgress?: (p: PrecacheProgress) => void) {
    const worker = await controller();
    if (!worker) return [] as PrecacheProgress[];
    return new Promise<PrecacheProgress[]>((resolve) => {
      const channel = new MessageChannel();
      const collected: PrecacheProgress[] = [];
      const timer = setTimeout(() => resolve(collected), 60_000); // never hang the UI
      channel.port1.onmessage = (event: MessageEvent<SwReply>) => {
        const data = event.data;
        if (data.type === 'rayati.progress') {
          const progress: PrecacheProgress = {
            url: data.url ?? '',
            done: data.done ?? 0,
            total: data.total ?? 0,
            ok: data.ok ?? false,
          };
          collected.push(progress);
          onProgress?.(progress);
          return;
        }
        if (data.type === 'rayati.done') {
          clearTimeout(timer);
          resolve(collected);
        }
        if (data.type === 'rayati.results' && data.results) {
          clearTimeout(timer);
          resolve(
            Object.entries(data.results).map(([u, ok]) => ({ url: u, done: 1, total: 1, ok })),
          );
        }
      };
      try {
        worker.postMessage(message, [channel.port2]);
      } catch {
        clearTimeout(timer);
        resolve(collected);
      }
    });
  }

  return {
    supported,

    async register() {
      if (!supported) return 'unsupported';
      try {
        registration = await navigator.serviceWorker.register(url, { scope: '/' });
        track(registration);
        await navigator.serviceWorker.ready;
        return 'ready';
      } catch (error) {
        console.warn('[rayati] service worker registration failed', error);
        return 'failed';
      }
    },

    async precache(urls, onProgress) {
      if (!supported || urls.length === 0) return [];
      return send({ type: 'rayati.precache', urls }, onProgress);
    },

    async cacheStatus(urls) {
      const results = await send({ type: 'rayati.status', urls });
      return Object.fromEntries(results.map((r) => [r.url, r.ok]));
    },

    async clearData() {
      await send({ type: 'rayati.clear' });
    },

    hasUpdate: () => waiting !== null,

    onUpdate(cb) {
      updateListeners.add(cb);
      return () => updateListeners.delete(cb);
    },
  };
}

/** Reload into the new worker once the user accepts the update. */
export async function applyUpdate(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  reg?.waiting?.postMessage({ type: 'rayati.skip-waiting' });
  location.reload();
}
