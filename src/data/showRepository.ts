/**
 * Show repository. One stadium-wide file is fetched once, kept by the Service
 * Worker cache, then decoded into memory. During the show nothing is requested.
 */
import { KEYS, LIMITS, PATHS, SHOW } from '../core/config';
import type { ShowChunk, ShowFile } from '../core/types';
import { applyChunk, decodeShow, type DecodedShow } from '../domain/showTimeline';
import { applyCorrections, loadCorrections, type CorrectionsFile } from './corrections';
import { createStorage, getJson, setJson, type KVStorage } from './storage';

export interface ShowRepositoryOptions {
  storage?: KVStorage;
  url?: string;
  fetcher?: typeof fetch;
  /** Injected hook so the app can ask the Service Worker to keep the file. */
  precache?: (urls: string[]) => Promise<void>;
  /** Optional corrections file (OpenCV calibration output). */
  correctionsUrl?: string | null;
  now?: () => number;
}

export interface LoadedShow {
  show: DecodedShow;
  bytes: number;
  /** True when the payload came straight out of the HTTP/SW cache. */
  fromCache: boolean;
  corrections: CorrectionsResultSummary | null;
  /** Chunk urls that were fetched, if the file is chunked. */
  chunks: number;
}

export interface CorrectionsResultSummary {
  applied: number;
  skipped: number;
  generatedAt: string;
}

export interface ShowRepository {
  url(): string;
  load(onProgress?: (ratio: number) => void): Promise<LoadedShow>;
  cachedMeta(): { id: string; generatedAt: string; bytes: number } | null;
}

export function createShowRepository(options: ShowRepositoryOptions = {}): ShowRepository {
  const storage = options.storage ?? createStorage();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => Date.now());
  const showUrl = options.url ?? resolveShowUrl();

  return {
    url: () => showUrl,

    cachedMeta() {
      return getJson<{ id: string; generatedAt: string; bytes: number } | null>(
        storage,
        KEYS.showMeta,
        null,
      );
    },

    async load(onProgress) {
      let payload: ShowFile | null = null;
      let text = '';
      let bytes = 0;
      let fromCache = false;

      try {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('rayati_active_show') : null;
        if (stored) {
          payload = JSON.parse(stored) as ShowFile;
          text = stored;
          bytes = new Blob([stored]).size;
          fromCache = true;
          onProgress?.(0.9);
        }
      } catch {
        payload = null;
      }

      if (!payload) {
        const res = await fetchWithProgress(showUrl, fetcher, (r) =>
          onProgress?.(r * 0.9),
        );
        text = res.text;
        bytes = res.bytes;
        fromCache = res.fromCache;
        payload = JSON.parse(text) as ShowFile;
      }

      const show = decodeShow(payload, { flatThresholdTicks: SHOW.flatThresholdTicks, now: now() });
      if (show.expired) console.warn('[rayati] show file is past its expiry date');

      // Chunks (optional): every chunk must be local before the event.
      let chunkCount = 0;
      const chunkUrls: string[] = [];
      if (Array.isArray(payload.chunks) && payload.chunks.length > 0) {
        for (const ref of payload.chunks) {
          const url = absoluteUrl(ref.url, showUrl);
          chunkUrls.push(url);
          const chunkText = await fetchText(url, fetcher);
          applyChunk(show, JSON.parse(chunkText) as ShowChunk);
          chunkCount++;
        }
      }
      if (options.precache) {
        // Fire and forget: caching failures must not block the show.
        void options.precache([showUrl, ...chunkUrls]).catch(() => undefined);
      }
      onProgress?.(0.95);

      // Optional calibration corrections (small, only used when a calibration ran).
      let corrections: CorrectionsResultSummary | null = null;
      if (options.correctionsUrl !== null) {
        const file = await loadCorrections({
          storage,
          url: options.correctionsUrl ?? 'corrections.json',
          fetcher,
        });
        if (file && (!file.showId || file.showId === show.meta.id)) {
          const result = applyCorrections(show, file as CorrectionsFile);
          corrections = {
            applied: result.applied,
            skipped: result.skipped,
            generatedAt: file.generatedAt,
          };
        }
      }

      setJson(storage, KEYS.showMeta, {
        id: show.meta.id,
        generatedAt: show.meta.generatedAt,
        bytes,
      });
      if (bytes > LIMITS.showWarnBytes) {
        show.warnings.push(`payload is ${(bytes / 1_048_576).toFixed(2)} MB (target < 2 MB gzip)`);
      }
      onProgress?.(1);
      return { show, bytes, fromCache, corrections, chunks: chunkCount };
    },
  };
}

/** `?show=` override, restricted to same-origin relative paths. */
export function resolveShowUrl(search = typeof location !== 'undefined' ? location.search : ''): string {
  const raw = new URLSearchParams(search).get('show');
  if (!raw) return PATHS.show;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      return url.origin === (typeof location !== 'undefined' ? location.origin : url.origin)
        ? url.pathname + url.search
        : PATHS.show;
    }
    return raw.replace(/^\.?\//, '');
  } catch {
    return PATHS.show;
  }
}

function absoluteUrl(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const basePath = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  return `${basePath}${url.replace(/^\.?\//, '')}`;
}

async function fetchText(url: string, fetcher: typeof fetch): Promise<string> {
  const res = await fetcher(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Stream the payload when possible so the UI can show real download progress. */
async function fetchWithProgress(
  url: string,
  fetcher: typeof fetch,
  onProgress?: (ratio: number) => void,
): Promise<{ text: string; bytes: number; fromCache: boolean }> {
  const res = await fetcher(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const fromCache = res.headers.get('x-rayati-cache') === 'hit' || res.headers.get('age') !== null;
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    onProgress?.(1);
    return { text, bytes: text.length, fromCache };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (total > 0) onProgress?.(Math.min(1, received / total));
  }
  text += decoder.decode();
  return { text, bytes: received || text.length, fromCache };
}
