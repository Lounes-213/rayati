/**
 * Torch (camera flash) service — Android Chrome only.
 *
 * The screen stays the primary output; the torch is a bonus on pure-white frames
 * (Algerian white band, flash finale). Rules:
 *  - feature-detect with `track.getCapabilities().torch === true` (never on iOS),
 *  - camera permission is only asked from an explicit user tap,
 *  - auto-stop after 60 s of continuous use to avoid overheating, with a cooldown,
 *  - any failure falls back silently to screen-only.
 */
import { LIMITS } from '../core/config';

export type TorchStatus = 'unknown' | 'unsupported' | 'denied' | 'ready' | 'on' | 'cooldown';

export interface TorchState {
  status: TorchStatus;
  /** Continuous on-time in ms. */
  onMs: number;
  /** ms remaining before the torch may be used again. */
  cooldownMsLeft: number;
}

export interface TorchService {
  probe(): Promise<TorchState>;
  enable(): Promise<TorchState>;
  disable(): Promise<TorchState>;
  /** The show loop calls this for white frames. No-op unless enabled. */
  set(on: boolean): void;
  state(): TorchState;
  dispose(): void;
}

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

export interface TorchOptions {
  maxOnMs?: number;
  cooldownMs?: number;
  now?: () => number;
  mediaDevices?: MediaDevices;
}

export function createTorch(options: TorchOptions = {}): TorchService {
  const maxOnMs = options.maxOnMs ?? LIMITS.torchMaxOnMs;
  const cooldownMs = options.cooldownMs ?? LIMITS.torchCooldownMs;
  const now = options.now ?? (() => Date.now());
  const media = options.mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);

  let stream: MediaStream | null = null;
  let track: MediaStreamTrack | null = null;
  let status: TorchStatus = 'unknown';
  let onSince = 0;
  let continuousMs = 0;
  let lastOffAt = 0;
  let wanted = false;

  function snapshot(): TorchState {
    return {
      status,
      onMs: Math.round(continuousMs + (onSince ? now() - onSince : 0)),
      cooldownMsLeft: Math.max(0, Math.round(lastOffAt + cooldownMs - now())),
    };
  }

  function stopTracks(): void {
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    stream = null;
    track = null;
  }

  async function apply(on: boolean): Promise<boolean> {
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as TorchConstraintSet] });
      return true;
    } catch (error) {
      console.warn('[rayati] torch constraint failed, screen only', error);
      status = 'unsupported';
      stopTracks();
      return false;
    }
  }

  async function probeImpl(): Promise<TorchState> {
    if (!media?.getUserMedia) {
      status = 'unsupported';
      return snapshot();
    }
    if (track) return snapshot();
    try {
      stream = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      track = stream.getVideoTracks()[0] ?? null;
      const caps = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
      if (!track || caps.torch !== true) {
        status = 'unsupported';
        stopTracks();
        return snapshot();
      }
      status = 'ready';
      return snapshot();
    } catch (error) {
      const name = (error as DOMException)?.name;
      status = name === 'NotAllowedError' ? 'denied' : 'unsupported';
      stopTracks();
      return snapshot();
    }
  }

  return {
    probe: probeImpl,

    async enable() {
      if (status === 'unknown' || !track) await probeImpl();
      if (status === 'ready' || status === 'on') {
        wanted = true;
        if (status !== 'on') continuousMs = 0;
      }
      return snapshot();
    },

    async disable() {
      wanted = false;
      if (onSince) {
        continuousMs += now() - onSince;
        onSince = 0;
        lastOffAt = now();
      }
      await apply(false);
      if (status === 'on') status = 'ready';
      stopTracks();
      return snapshot();
    },

    set(on: boolean) {
      if (!track) return;
      if (!wanted) {
        if (on) void apply(false);
        return;
      }
      const time = now();
      if (on && status !== 'on') {
        if (time - lastOffAt < cooldownMs && continuousMs >= maxOnMs) return; // cooling down
        if (continuousMs >= maxOnMs) {
          void apply(false);
          lastOffAt = time;
          wanted = false;
          status = 'cooldown';
          return;
        }
        if (time - lastOffAt > cooldownMs) continuousMs = 0;
        onSince = time;
        status = 'on';
        void apply(true);
        return;
      }
      if (!on && status === 'on') {
        continuousMs += time - onSince;
        onSince = 0;
        lastOffAt = time;
        status = continuousMs >= maxOnMs ? 'cooldown' : 'ready';
        void apply(false);
      }
    },

    state: snapshot,

    dispose() {
      wanted = false;
      stopTracks();
      status = 'unsupported';
    },
  };
}
