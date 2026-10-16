import { describe, expect, it } from 'vitest';
import {
  applyChunk,
  decodeRateStats,
  decodeSeatIndex,
  decodeShow,
  decodeTimeline,
  indexAt,
  msToTicks,
  progressAt,
  renderFrame,
  timelineIndexAt,
} from '../src/domain/showTimeline';
import type { ShowFile } from '../src/core/types';

function show(overrides: Partial<ShowFile> = {}): ShowFile {
  return {
    v: 1,
    meta: {
      id: 'test',
      name: 'Test show',
      generatedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2030-01-01T00:00:00Z',
      startAt: 0,
      durationMs: 1000,
      tickMs: 100,
      seatCount: 4,
      acts: 3,
      actMs: 400,
    },
    palette: ['#000000', '#0A7D3E', '#FFFFFF'],
    timelines: [
      [
        [1, 400],
        [2, 600],
      ],
    ],
    seatIndex: { runs: [[0, 4]] },
    ...overrides,
  };
}

describe('timeline decoding', () => {
  it('quantises durations to the tick grid', () => {
    expect(msToTicks(400, 100)).toBe(4);
    expect(msToTicks(250, 100)).toBe(3); // rounded to the nearest tick
    expect(msToTicks(0, 100)).toBe(1); // never a zero-length step
    expect(msToTicks(Number.NaN, 100)).toBe(1);
  });

  it('builds a flat lookup table for short timelines', () => {
    const timeline = decodeTimeline(
      [
        [2, 400],
        [2, 300],
        [1, 300],
      ],
      100,
    );
    expect(timeline.ticks).toBe(10);
    expect(Array.from(timeline.flat!)).toEqual([2, 2, 2, 2, 2, 2, 2, 1, 1, 1]);
    // Identical neighbours are merged: one run for the first 7 ticks.
    expect(timeline.runs).toBe(2);
  });

  it('switches to the run structure for long timelines and stays exact', () => {
    const steps: number[][] = [];
    for (let i = 0; i < 200; i++) steps.push([i % 3, 100]);
    const timeline = decodeTimeline(steps, 100, 50);
    expect(timeline.flat).toBeUndefined();
    for (let tick = 0; tick < timeline.ticks; tick++) {
      expect(timelineIndexAt(timeline, tick * 100, 100)).toBe(tick % 3);
    }
  });

  it('clamps palette indices and handles garbage input', () => {
    const clamped = decodeTimeline(
      [
        [99, 100],
        [1, 100],
      ],
      100,
      1000,
      3,
    );
    expect(Array.from(clamped.flat!)).toEqual([2, 1]);
    expect(decodeTimeline([], 100).ticks).toBe(0);
    expect(decodeTimeline([[1]], 100).runs).toBe(0);
  });

  it('is safe before, inside and after the show', () => {
    const timeline = decodeTimeline(
      [
        [1, 500],
        [2, 500],
      ],
      100,
    );
    expect(timelineIndexAt(timeline, -5000, 100)).toBe(1);
    expect(timelineIndexAt(timeline, 499, 100)).toBe(1);
    expect(timelineIndexAt(timeline, 500, 100)).toBe(2);
    expect(timelineIndexAt(timeline, 10_000, 100)).toBe(2);
  });
});

describe('seat index decoding', () => {
  it('expands runs and pads a short file with black', () => {
    const warnings: string[] = [];
    const map = decodeSeatIndex(
      [
        [0, 2],
        [1, 1],
      ],
      5,
      2,
      warnings,
    );
    expect(Array.from(map)).toEqual([0, 0, 1, 0, 0]);
    expect(warnings[0]).toContain('padded');
  });

  it('truncates a file that covers too many seats', () => {
    const warnings: string[] = [];
    const map = decodeSeatIndex([[1, 10]], 3, 2, warnings);
    expect(map).toHaveLength(3);
    expect(warnings[0]).toContain('truncated');
  });

  it('uses 16-bit ids beyond 255 timelines', () => {
    const map = decodeSeatIndex(
      [[300, 4]],
      4,
      400,
    );
    expect(map).toBeInstanceOf(Uint16Array);
    expect(Array.from(map)).toEqual([300, 300, 300, 300]);
  });
});

describe('show decoding', () => {
  it('resolves the palette colour of a seat over time', () => {
    const decoded = decodeShow(show());
    expect(decoded.seatCount).toBe(4);
    expect(decoded.warnings).toEqual([]);
    expect(indexAt(decoded, 0, 0)).toBe(1);
    expect(indexAt(decoded, 3, 999)).toBe(2);
    expect(indexAt(decoded, 99, 0)).toBe(0); // out of range -> black
    expect(decoded.paletteRgb[3]).toBe(0x0a); // first colour of #0A7D3E
  });

  it('always keeps pure black at index 0', () => {
    const decoded = decodeShow(show({ palette: ['#123456', '#FFFFFF'] }));
    expect(decoded.palette[0]).toBe('#000000');
    expect(decoded.palette).toContain('#123456');
  });

  it('reports an expired payload but still plays it', () => {
    const file = show();
    file.meta = { ...file.meta, expiresAt: '2020-01-01T00:00:00Z' };
    const decoded = decodeShow(file, { now: Date.now() });
    expect(decoded.expired).toBe(true);
    expect(decoded.timelines).toHaveLength(1);
  });

  it('warns instead of throwing on a damaged payload', () => {
    const decoded = decodeShow({
      v: 9,
      meta: undefined as never,
      palette: ['nope'],
      timelines: [],
      seatIndex: { runs: [] },
    });
    expect(decoded.warnings.join(' | ')).toContain('version');
    expect(decoded.warnings.join(' | ')).toContain('palette');
    expect(decoded.warnings.join(' | ')).toContain('no timelines');
  });

  it('renders a whole frame with one palette index per seat', () => {
    const decoded = decodeShow(
      show({
        timelines: [
          [
            [1, 500],
            [2, 500],
          ],
          [[0, 1000]],
        ],
        seatIndex: {
          runs: [
            [0, 2],
            [1, 2],
          ],
        },
      }),
    );
    const frame = renderFrame(decoded, 900);
    expect(Array.from(frame)).toEqual([2, 2, 0, 0]);
    expect(progressAt(decoded, 500)).toBeCloseTo(0.5);
    expect(progressAt(decoded, 5000)).toBe(1);
    expect(decodeRateStats(decoded).timelines).toBe(2);
  });

  it('merges an optional chunk with offset timeline ids', () => {
    const decoded = decodeShow(show());
    applyChunk(decoded, {
      i: 0,
      seatFrom: 2,
      seatTo: 3,
      runs: [[0, 2]],
      timelines: [
        [
          [2, 1000],
        ],
      ],
    });
    expect(decoded.timelines).toHaveLength(2);
    expect(Array.from(decoded.seatTimeline)).toEqual([0, 0, 1, 1]);
    expect(indexAt(decoded, 2, 500)).toBe(2); // chunk timeline
    expect(indexAt(decoded, 0, 500)).toBe(2); // core timeline, second step
    expect(indexAt(decoded, 0, 100)).toBe(1);
  });
});
