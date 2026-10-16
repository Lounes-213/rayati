import { describe, expect, it } from 'vitest';
import type { ClockSync } from '../src/data/clockSync';
import type { DecodedShow } from '../src/domain/showTimeline';
import { createShowEngine, type FrameContext } from '../src/services/showEngine';

type TestClock = ClockSync & { advance(ms: number): void };

function fakeClock(start = 1_700_000_000_000): TestClock {
  let offset = 0;
  // The wall clock advances with real time; tests move it with `wall.advance()`.
  let wall = start;
  const api: TestClock = {
    advance(ms: number) {
      wall += ms;
    },
    sync: async () => ({
      offsetMs: offset,
      rttMs: 10,
      samples: 3,
      source: 'network',
      measuredAt: start,
    }),
    state: () => ({ offsetMs: offset, rttMs: 10, samples: 3, source: 'network', measuredAt: start }),
    now: () => wall + offset,
    setManualOffset: (ms) => {
      offset = ms;
      return { offsetMs: ms, rttMs: 0, samples: 0, source: 'manual', measuredAt: start };
    },
    isStale: () => false,
    restore: () => ({ offsetMs: offset, rttMs: 0, samples: 0, source: 'network', measuredAt: start }),
  };
  return api;
}

function decodedShow(durationMs: number, startAt = 0): DecodedShow {
  return {
    meta: {
      id: 'x',
      name: 'x',
      generatedAt: '',
      expiresAt: '',
      startAt,
      durationMs,
      tickMs: 100,
      seatCount: 2,
      acts: 1,
      actMs: durationMs,
    },
    palette: ['#000000', '#FFFFFF'],
    paletteRgb: new Uint8Array([0, 0, 0, 255, 255, 255]),
    timelines: [{ ticks: 1, flat: new Uint8Array([1]), runs: 1 }],
    seatCount: 2,
    seatTimeline: new Uint8Array([0, 0]),
    warnings: [],
    expired: false,
  };
}

/** Manual rAF driver so the engine can be tested without a browser. */
function harness(durationMs: number, startAt = 0) {
  const frames: FrameContext[] = [];
  let ended = 0;
  let performanceTime = 0;
  const pending: FrameRequestCallback[] = [];
  const clock = fakeClock();
  const engine = createShowEngine({
    show: decodedShow(durationMs, startAt),
    clock,
    onFrame: (ctx) => frames.push({ ...ctx }),
    onEnd: () => ended++,
    now: () => performanceTime,
    raf: (cb) => pending.push(cb) as unknown as number,
    caf: () => undefined,
    resyncEveryMs: 1000,
  });
  const advance = (ms: number) => {
    performanceTime += ms;
    clock.advance(ms);
    const callbacks = pending.splice(0, pending.length);
    for (const cb of callbacks) cb(performanceTime);
  };
  return { engine, frames, clock, advance, ended: () => ended };
}

describe('show engine', () => {
  it('reports elapsed time from the shared clock and the injected performance clock', () => {
    const h = harness(60_000);
    h.engine.start();
    h.advance(0);
    h.advance(500);
    expect(h.frames.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(480);
    expect(h.frames.at(-1)!.started).toBe(true);
    expect(h.frames.at(-1)!.progress).toBeCloseTo(0.008, 2);
  });

  it('counts down before the show starts', () => {
    const h = harness(60_000, 1_700_000_010_000); // starts 10 s after "now"
    h.engine.start();
    h.advance(0);
    const first = h.frames.at(-1)!;
    expect(first.started).toBe(false);
    expect(first.startsInMs).toBeGreaterThan(9_000);
    expect(first.elapsedMs).toBeLessThan(0);
  });

  it('joins a running show at the live position (catch-up)', () => {
    const h = harness(600_000, 1_700_000_000_000 - 120_000);
    h.engine.start();
    h.advance(0);
    expect(h.frames.at(-1)!.elapsedMs).toBeGreaterThan(119_000);
    expect(h.frames.at(-1)!.elapsedMs).toBeLessThan(121_000);
  });

  it('can replay from the beginning instead (catchUp: false)', () => {
    const frames: FrameContext[] = [];
    const clock = fakeClock();
    const time = 0;
    const engine = createShowEngine({
      show: decodedShow(600_000, 1_700_000_000_000 - 120_000),
      clock,
      onFrame: (ctx) => frames.push({ ...ctx }),
      now: () => time,
      raf: () => 1,
      caf: () => undefined,
      catchUp: false,
    });
    engine.start();
    expect(frames.at(-1)!.elapsedMs).toBe(0);
  });

  it('fires onEnd exactly once and freezes at the end', () => {
    const h = harness(1_000);
    h.engine.start();
    h.advance(0);
    h.advance(1_100);
    h.advance(1_100);
    expect(h.ended()).toBe(1);
    expect(h.frames.at(-1)!.ended).toBe(true);
    expect(h.frames.at(-1)!.elapsedMs).toBe(1_000);
  });

  it('never rewinds when the device clock jumps backwards', () => {
    const h = harness(600_000);
    h.engine.start();
    h.advance(0);
    h.advance(5_000);
    const before = h.frames.at(-1)!.elapsedMs;
    h.clock.setManualOffset(-30_000); // the shared clock is corrected backwards
    h.advance(16);
    expect(h.frames.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(before);
  });

  it('seeks and changes speed without jumping', () => {
    const h = harness(600_000);
    h.engine.start();
    h.advance(0);
    h.engine.seek(300_000);
    expect(h.frames.at(-1)!.elapsedMs).toBe(300_000);
    expect(h.engine.context().elapsedMs).toBe(300_000);
    h.engine.setSpeed(4);
    h.advance(1_000);
    const elapsed = h.frames.at(-1)!.elapsedMs;
    expect(elapsed).toBeGreaterThan(303_000);
    expect(elapsed).toBeLessThan(305_000);
  });

  it('stops emitting frames once stopped', () => {
    const h = harness(600_000);
    h.engine.start();
    h.advance(0);
    const count = h.frames.length;
    h.engine.stop();
    h.advance(1_000);
    expect(h.frames.length).toBe(count);
  });
});
