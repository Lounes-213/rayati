import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/data/storage';
import { createShowRepository } from '../src/data/showRepository';
import { applyCorrections } from '../src/data/corrections';
import { decodeShow, indexAt } from '../src/domain/showTimeline';
import type { CorrectionsFile } from '../src/data/corrections';
import type { ShowChunk, ShowFile } from '../src/core/types';

const core: ShowFile = {
  v: 1,
  meta: {
    id: 'chunked',
    name: 'Chunked',
    generatedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2030-01-01T00:00:00Z',
    startAt: 0,
    durationMs: 1000,
    tickMs: 100,
    seatCount: 4,
    acts: 2,
    actMs: 500,
  },
  palette: ['#000000', '#0A7D3E', '#FFFFFF'],
  timelines: [],
  seatIndex: { runs: [] },
  chunks: [
    { url: 'show-000.json', seatFrom: 0, seatTo: 1 },
    { url: 'show-001.json', seatFrom: 2, seatTo: 3 },
  ],
};

const chunks: Record<string, ShowChunk> = {
  'show-000.json': {
    i: 0,
    seatFrom: 0,
    seatTo: 1,
    runs: [[0, 2]],
    timelines: [
      [
        [1, 1000],
      ],
    ],
  },
  'show-001.json': {
    i: 1,
    seatFrom: 2,
    seatTo: 3,
    runs: [[0, 2]],
    timelines: [
      [
        [2, 1000],
      ],
    ],
  },
};

function stubFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('show-') ? chunks[url.slice(url.indexOf('show-'))] : core;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('show repository', () => {
  it('loads the core file and every prefetched chunk', async () => {
    const prefetched: string[][] = [];
    const repo = createShowRepository({
      storage: createMemoryStorage(),
      url: 'show.json',
      fetcher: stubFetch(),
      correctionsUrl: null,
      precache: async (urls) => {
        prefetched.push(urls);
      },
    });

    const progress: number[] = [];
    const loaded = await repo.load((ratio) => progress.push(ratio));

    expect(loaded.chunks).toBe(2);
    expect(loaded.show.seatCount).toBe(4);
    expect(indexAt(loaded.show, 0, 500)).toBe(1);
    expect(indexAt(loaded.show, 3, 500)).toBe(2);
    expect(prefetched[0]).toEqual(['show.json', 'show-000.json', 'show-001.json']);
    expect(progress.at(-1)).toBe(1);
    expect(repo.cachedMeta()).toMatchObject({ id: 'chunked' });
  });

  it('survives a missing payload without caching garbage', async () => {
    const failing = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    const repo = createShowRepository({
      storage: createMemoryStorage(),
      url: 'show.json',
      fetcher: failing,
      correctionsUrl: null,
    });
    await expect(repo.load()).rejects.toThrow(/HTTP 500/);
    expect(repo.cachedMeta()).toBeNull();
  });
});

describe('corrections', () => {
  const base = () =>
    decodeShow({
      v: 1,
      meta: { ...core.meta, seatCount: 4 },
      palette: core.palette,
      timelines: [
        [
          [1, 1000],
        ],
        [
          [2, 1000],
        ],
      ],
      // seats 0-2 share timeline 0, seat 3 sits on timeline 1
      seatIndex: { runs: [[0, 3], [1, 1]] },
    });

  it('moves a seat onto the timeline of where it physically sits', () => {
    const show = base();
    const file: CorrectionsFile = {
      v: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      showId: 'chunked',
      assignments: [{ seat: 0, sourceSeat: 3 }],
    };
    const result = applyCorrections(show, file);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.timelineCount).toBe(2);
    expect(show.seatTimeline[0]).toBe(1); // borrowed the timeline of physical seat 3
    expect(indexAt(show, 0, 0)).toBe(2);
  });

  it('ignores impossible or incomplete assignments instead of crashing', () => {
    const show = base();
    const file: CorrectionsFile = {
      v: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      assignments: [
        { seat: 99, sourceSeat: 1 },
        { seat: 1, sourceSeat: 99 },
        { seat: 2 },
      ],
    };
    const result = applyCorrections(show, file);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(3);
  });

  it('accepts an explicit timeline id', () => {
    const show = base();
    const result = applyCorrections(show, {
      v: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      assignments: [{ seat: 1, timeline: 1 }],
    });
    expect(result.applied).toBe(1);
    expect(show.seatTimeline[1]).toBe(1);
    expect(indexAt(show, 1, 0)).toBe(2);
  });
});
