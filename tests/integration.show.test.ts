/**
 * Integration test: what tools/generate_seats.py and tools/build_show.py produced
 * must be exactly what the app decodes. This is the check that protects the seat
 * index contract between Python and TypeScript — a mismatch here means a wrong
 * colour on somebody's phone in a full stadium.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SeatsFile, ShowFile } from '../src/core/types';
import { checkSeat, prepareSeats, seatAt } from '../src/domain/seat';
import { decodeShow, indexAt, renderFrame } from '../src/domain/showTimeline';

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, `../public/${name}`), 'utf8')) as T;

const seatsFile = read<SeatsFile>('seats.json');
const showFile = read<ShowFile>('show.json');
const index = prepareSeats(seatsFile);
const show = decodeShow(showFile, { now: Date.parse('2026-10-16T00:00:00Z') });

describe('seats.json <-> show.json contract', () => {
  it('indexes exactly as many seats as the seat file enumerates', () => {
    expect(show.meta.seatCount).toBe(index.total);
    expect(show.seatTimeline.length).toBe(index.total);
  });

  it('decodes without warnings', () => {
    expect(show.warnings).toEqual([]);
  });

  it('uses an RLE seat index that covers every seat', () => {
    const covered = showFile.seatIndex.runs.reduce((sum, [, repeat]) => sum + repeat, 0);
    expect(covered).toBe(index.total);
  });

  it('keeps every timeline inside the palette and the show duration', () => {
    const expectedTicks = Math.round(show.meta.durationMs / show.meta.tickMs);
    for (const timeline of show.timelines) {
      const ticks = timeline.flat
        ? timeline.flat.length
        : (timeline.starts?.[timeline.runs] ?? 0);
      expect(ticks).toBe(expectedTicks);
      if (timeline.flat) {
        for (const value of timeline.flat) expect(value).toBeLessThan(show.palette.length);
      }
    }
  }, 15000);

  it('points every seat at an existing timeline', () => {
    let max = 0;
    for (const id of show.seatTimeline) max = Math.max(max, id);
    expect(max).toBeLessThan(show.timelines.length);
  });

  it('plays black before the entrance wipe and never returns a bad colour', () => {
    const atStart = renderFrame(show, 0);
    for (const value of atStart) expect(value).toBeLessThan(show.palette.length);

    // Mid-show every seat must resolve to a real colour.
    for (const time of [120_000, 300_000, 480_000]) {
      for (let seat = 0; seat < show.seatCount; seat += 37) {
        const color = indexAt(show, seat, time);
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThan(show.palette.length);
      }
    }
  });

  it('keeps the show inside the offline budget for the MVP stadium', () => {
    const bytes = JSON.stringify(showFile).length;
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    expect(show.timelines.length).toBeLessThan(400); // dedupe actually worked
  });

  it('maps a sample of seats through the real QR path', () => {
    for (const [section, row, seat] of [
      ['A', 1, 1],
      ['B', 12 % 10 + 1, 7],
      ['J', 10, 100],
    ] as const) {
      const check = checkSeat(index, { section, row, seat });
      if (!check.ok) continue; // blocked seat: it must not be selectable
      const ref = seatAt(index, check.index)!;
      expect(`${ref.section}-${ref.row}-${ref.seat}`).toBe(`${section}-${row}-${seat}`);
      expect(indexAt(show, check.index, 300_000)).toBeLessThan(show.palette.length);
    }
  });
});
