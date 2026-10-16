/** Fullscreen helper (with the WebKit fallback iOS Safari still needs). */
export interface FullscreenService {
  readonly supported: boolean;
  isActive(): boolean;
  enter(element: HTMLElement): Promise<boolean>;
  exit(): Promise<void>;
  onChange(cb: (active: boolean) => void): () => void;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
}

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}

export function createFullscreen(): FullscreenService {
  const doc = typeof document !== 'undefined' ? (document as FullscreenDocument) : undefined;
  const listeners = new Set<(active: boolean) => void>();

  function active(): boolean {
    return Boolean(doc?.fullscreenElement ?? doc?.webkitFullscreenElement ?? null);
  }

  if (doc) {
    const notify = () => listeners.forEach((cb) => cb(active()));
    doc.addEventListener('fullscreenchange', notify);
    doc.addEventListener('webkitfullscreenchange', notify);
  }

  return {
    supported: Boolean(doc && (doc.documentElement.requestFullscreen || (doc.documentElement as FullscreenElement).webkitRequestFullscreen)),

    isActive: active,

    async enter(element) {
      const target = element as FullscreenElement;
      try {
        if (target.requestFullscreen) {
          await target.requestFullscreen({ navigationUI: 'hide' });
          return true;
        }
        if (target.webkitRequestFullscreen) {
          await target.webkitRequestFullscreen();
          return true;
        }
      } catch (error) {
        console.warn('[rayati] fullscreen refused', error);
      }
      return false;
    },

    async exit() {
      try {
        if (doc?.exitFullscreen) await doc.exitFullscreen();
        else if (doc?.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } catch {
        /* already out */
      }
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
