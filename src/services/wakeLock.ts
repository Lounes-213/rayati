/**
 * Screen Wake Lock. The lock is released by the browser whenever the page is
 * hidden, so it is re-acquired on `visibilitychange` while the show is running.
 * Support is partial (iOS needs 16.4+): callers treat `false` as "just warn".
 */
export interface WakeLockService {
  readonly supported: boolean;
  isActive(): boolean;
  /**
   * Resolves true when the screen lock is held. The browser *defers* the request
   * while the document is hidden, so `timeoutMs` returns false early without
   * cancelling the request: the lock is acquired as soon as the page is visible.
   */
  request(timeoutMs?: number): Promise<boolean>;
  release(): Promise<void>;
  dispose(): void;
}

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export function createWakeLock(): WakeLockService {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const api = nav?.wakeLock as { request(type: 'screen'): Promise<WakeLockSentinelLike> } | undefined;
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;
  let listenerAttached = false;

  async function acquire(): Promise<boolean> {
    if (!api) return false;
    try {
      sentinel = await api.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
      return true;
    } catch (error) {
      console.warn('[rayati] wake lock refused', error);
      sentinel = null;
      return false;
    }
  }

  function onVisibility(): void {
    if (wanted && document.visibilityState === 'visible' && !sentinel) void acquire();
  }

  return {
    supported: Boolean(api),
    isActive: () => sentinel !== null && !sentinel.released,

    async request(timeoutMs = 0) {
      wanted = true;
      if (!listenerAttached && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility);
        listenerAttached = true;
      }
      if (!api) return false;
      const pending = acquire();
      if (timeoutMs <= 0) return pending;
      // Never let a deferred request block the show.
      return Promise.race([
        pending,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ]);
    },

    async release() {
      wanted = false;
      const current = sentinel;
      sentinel = null;
      try {
        await current?.release();
      } catch {
        /* already released */
      }
    },

    dispose() {
      wanted = false;
      if (listenerAttached && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
        listenerAttached = false;
      }
    },
  };
}
