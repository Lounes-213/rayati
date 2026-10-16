/**
 * Show engine: turns the shared clock into a smooth, monotonic show position.
 *
 * Why not simply `clock.now() - startAt` every frame? Because the device clock is
 * only read once per frame and can be adjusted by the OS; using `performance.now()`
 * between two wall-clock anchors gives a stable, jitter-free timeline, and we
 * re-anchor whenever the two disagree by more than one frame.
 */
import { LIMITS } from '../core/config';
import type { ClockSync } from '../data/clockSync';
import type { DecodedShow } from '../domain/showTimeline';

export interface FrameContext {
  /** ms since the first frame of the show. Negative during the countdown. */
  elapsedMs: number;
  durationMs: number;
  /** ms until the show starts (0 once it is running). */
  startsInMs: number;
  started: boolean;
  ended: boolean;
  progress: number;
}

export interface ShowEngineOptions {
  show: DecodedShow;
  clock: ClockSync;
  onFrame(ctx: FrameContext): void;
  onEnd?(): void;
  /** Playback speed (the simulation view uses 2x / 8x). */
  speed?: number;
  /** Start position in ms, used by the simulation scrubbing. */
  startOffsetMs?: number;
  /** Absolute epoch ms to start at; 0 = as soon as the engine starts. */
  startAtMs?: number;
  /** Join a running show at the live position instead of replaying from 0. */
  catchUp?: boolean;
  resyncEveryMs?: number;
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (handle: number) => void;
}

export interface ShowEngine {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  seek(elapsedMs: number): void;
  setSpeed(speed: number): void;
  context(): FrameContext;
  readonly running: boolean;
  readonly paused: boolean;
}

export function createShowEngine(options: ShowEngineOptions): ShowEngine {
  const now = options.now ?? (() => performance.now());
  const raf = options.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = options.caf ?? ((handle) => cancelAnimationFrame(handle));
  const resyncEveryMs = options.resyncEveryMs ?? LIMITS.resyncEveryMs;
  const duration = Math.max(1, options.show.meta.durationMs);

  let handle = 0;
  let running = false;
  let paused = false;
  let speed = options.speed ?? 1;
  let startAtMs = 0;
  let perfBase = 0;
  let wallBase = 0;
  let lastElapsed = options.startOffsetMs ?? 0;
  let lastResync = 0;
  let endedFired = false;
  let ctx: FrameContext = {
    elapsedMs: lastElapsed,
    durationMs: duration,
    startsInMs: 0,
    started: false,
    ended: false,
    progress: 0,
  };

  function compute(raw: number): FrameContext {
    const started = raw >= 0;
    const elapsed = started ? Math.min(raw, duration) : Math.max(raw, -duration);
    const ended = raw >= duration;
    return {
      elapsedMs: elapsed,
      durationMs: duration,
      startsInMs: started ? 0 : -elapsed,
      started,
      ended,
      progress: Math.max(0, Math.min(1, elapsed / duration)),
    };
  }

  function tick(): void {
    if (!running || paused) return;
    const perf = now();
    let raw = wallBase - startAtMs + (perf - perfBase) * speed;

    // Re-anchor on the wall clock when drift exceeds one tick of the show.
    if (perf - lastResync > resyncEveryMs) {
      lastResync = perf;
      const wall = options.clock.now() - startAtMs;
      if (Math.abs(wall - (wallBase - startAtMs)) > 120 || Math.abs(wall - raw) > 200) {
        wallBase = options.clock.now();
        perfBase = perf;
        raw = wallBase - startAtMs;
      }
    }

    // Monotonic guard (clock adjustments must not rewind the show).
    if (raw < lastElapsed && lastElapsed - raw < 1000) raw = lastElapsed;
    lastElapsed = raw;

    ctx = compute(raw);
    options.onFrame(ctx);
    if (ctx.ended && !endedFired) {
      endedFired = true;
      options.onEnd?.();
    }
    handle = raf(tick);
  }

  function rebase(elapsed: number, startAt: number): void {
    perfBase = now();
    wallBase = startAt + elapsed;
    lastElapsed = elapsed;
    lastResync = perfBase;
    ctx = compute(elapsed);
  }

  return {
    start() {
      if (running) return;
      const clock = options.clock;
      const explicit = options.startAtMs ?? options.show.meta.startAt ?? 0;
      const offset = options.startOffsetMs ?? 0;
      if (explicit > 0) {
        startAtMs = explicit;
        // `live` is negative before kick-off (countdown), positive afterwards
        // (a fan who opens the app mid-show joins the picture where it is).
        const live = clock.now() - explicit;
        const position = options.catchUp === false && live > 0 ? offset : live;
        rebase(position, explicit);
      } else {
        startAtMs = clock.now() - offset;
        rebase(offset, startAtMs);
      }
      running = true;
      paused = false;
      endedFired = false;
      options.onFrame(ctx);
      handle = raf(tick);
    },

    stop() {
      running = false;
      pause_clear();
    },

    pause() {
      if (!running || paused) return;
      paused = true;
      pause_clear();
    },

    resume() {
      if (!running || !paused) return;
      paused = false;
      perfBase = now();
      lastResync = perfBase;
      handle = raf(tick);
    },

    seek(elapsedMs) {
      const clamped = Math.max(0, Math.min(duration, elapsedMs));
      if (!startAtMs) startAtMs = options.clock.now() - clamped;
      endedFired = false;
      rebase(clamped, startAtMs);
      options.onFrame(ctx); // report the new position immediately (scrubbing feels instant)
      if (running && !paused) {
        pause_clear();
        handle = raf(tick);
      }
    },

    setSpeed(next) {
      const safe = Number.isFinite(next) && next > 0 ? next : 1;
      // Rebase so the position does not jump when the speed changes.
      const perf = now();
      const position = wallBase - startAtMs + (perf - perfBase) * speed;
      speed = safe;
      rebase(position, startAtMs);
    },

    context: () => ctx,
    get running() {
      return running;
    },
    get paused() {
      return paused;
    },
  };

  function pause_clear(): void {
    if (handle) caf(handle);
    handle = 0;
  }
}
