/**
 * Clock sync. The show plays from the device clock, so every phone needs the same
 * reference time. Before the show we sample `/api/time` a few times and keep the
 * offset measured on the fastest round trip (NTP's trick in three lines).
 * If the endpoint is unreachable we keep playing: the device clock alone already
 * keeps thousands of phones within ~1 s of each other.
 */
import { KEYS, LIMITS, PATHS } from '../core/config';
import type { ClockState } from '../core/types';
import { createStorage, getJson, setJson, type KVStorage } from './storage';

export interface ClockSyncOptions {
  storage?: KVStorage;
  endpoint?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  samples?: number;
}

export interface ClockSync {
  sync(): Promise<ClockState>;
  state(): ClockState;
  /** Shared show time: epoch ms corrected by the measured offset. */
  now(): number;
  setManualOffset(ms: number): ClockState;
  isStale(): boolean;
  restore(): ClockState;
}

const IDLE: ClockState = { offsetMs: 0, rttMs: 0, samples: 0, source: 'device', measuredAt: 0 };

export function createClockSync(options: ClockSyncOptions = {}): ClockSync {
  const storage = options.storage ?? createStorage();
  const endpoint = options.endpoint ?? PATHS.time;
  const fetcher = options.fetcher ?? fetch;
  const clock = options.now ?? (() => Date.now());
  const wanted = options.samples ?? 3;
  let state: ClockState = restore();

  function restore(): ClockState {
    const saved = getJson<ClockState | null>(storage, KEYS.clock, null);
    if (saved && Number.isFinite(saved.offsetMs)) return { ...saved, source: saved.source ?? 'device' };
    return { ...IDLE };
  }

  function persist(next: ClockState): ClockState {
    setJson(storage, KEYS.clock, next);
    state = next;
    return state;
  }

  return {
    async sync() {
      let best: { offset: number; rtt: number } | null = null;
      let ok = 0;
      for (let i = 0; i < wanted; i++) {
        try {
          const t0 = clock();
          const res = await fetcher(`${endpoint}?_=${t0}`, { credentials: 'omit', cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { now?: number; t?: number };
          const t1 = clock();
          const serverNow = Number(data.now ?? data.t);
          if (!Number.isFinite(serverNow)) throw new Error('bad_time_payload');
          const rtt = t1 - t0;
          const offset = serverNow - (t0 + rtt / 2);
          if (!best || rtt < best.rtt) best = { offset, rtt };
          ok++;
        } catch {
          break; // endpoint unavailable: keep the device clock, try again next time
        }
      }
      if (!best || ok === 0) return state;
      return persist({
        offsetMs: Math.round(best.offset),
        rttMs: Math.round(best.rtt),
        samples: ok,
        source: 'network',
        measuredAt: clock(),
      });
    },

    state: () => state,
    now: () => clock() + state.offsetMs,

    setManualOffset(ms) {
      const safe = Number.isFinite(ms) ? Math.max(-60_000, Math.min(60_000, Math.round(ms))) : 0;
      return persist({ ...state, offsetMs: safe, source: 'manual', measuredAt: clock() });
    },

    isStale() {
      if (state.source === 'device' || state.measuredAt === 0) return true;
      return clock() - state.measuredAt > LIMITS.clockStaleMs;
    },

    restore: () => state,
  };
}
