import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkSeat,
  isBlocked,
  parseSeatKey,
  parseSeatParams,
  prepareSeats,
  rowSeatCount,
  seatAt,
  seatKey,
  seatNumbers,
  rowsOfSection,
} from '../src/domain/seat';
import type { SeatsFile } from '../src/core/types';

const fixture: SeatsFile = {
  v: 1,
  generatedAt: '2026-01-01T00:00:00Z',
  stadium: { name: 'Test', capacity: 12 },
  layout: { sectionCols: 2, sectionRows: 1, cellW: 5, cellH: 2 },
  sections: [
    {
      id: 'A',
      name: { ar: 'A', fr: 'A', en: 'A' },
      col: 0,
      row: 0,
      rows: [
        { id: 1, seatFrom: 1, seatTo: 5, blocked: [[3, 4]] },
        { id: 2, seatFrom: 1, seatTo: 5 },
      ],
    },
    {
      id: 'B',
      name: { ar: 'B', fr: 'B', en: 'B' },
      col: 1,
      row: 0,
      rows: [{ id: 1, seatFrom: 1, seatTo: 5 }],
    },
  ],
};

describe('seat enumeration', () => {
  const index = prepareSeats(fixture);

  it('counts usable seats, skipping blocked ranges', () => {
    expect(rowSeatCount(fixture.sections[0].rows[0])).toBe(3);
    expect(index.total).toBe(3 + 5 + 5);
  });

  it('marks blocked seats', () => {
    expect(isBlocked(fixture.sections[0].rows[0], 3)).toBe(true);
    expect(isBlocked(fixture.sections[0].rows[0], 2)).toBe(false);
    expect(seatNumbers(index, 'A', 1)).toEqual([1, 2, 5]);
  });

  it('gives a global index in file order (section, row, seat)', () => {
    expect(checkSeat(index, { section: 'A', row: 1, seat: 1 }).index).toBe(0);
    expect(checkSeat(index, { section: 'A', row: 1, seat: 2 }).index).toBe(1);
    expect(checkSeat(index, { section: 'A', row: 1, seat: 5 }).index).toBe(2);
    expect(checkSeat(index, { section: 'A', row: 2, seat: 1 }).index).toBe(3);
    expect(checkSeat(index, { section: 'B', row: 1, seat: 5 }).index).toBe(12);
  });

  it('rejects impossible seats instead of guessing', () => {
    expect(checkSeat(index, { section: 'Z', row: 1, seat: 1 })).toMatchObject({
      ok: false,
      problem: 'unknownSection',
    });
    expect(checkSeat(index, { section: 'A', row: 9, seat: 1 })).toMatchObject({
      ok: false,
      problem: 'unknownRow',
    });
    expect(checkSeat(index, { section: 'A', row: 1, seat: 9 })).toMatchObject({
      ok: false,
      problem: 'seatNotFound',
    });
    expect(checkSeat(index, { section: 'A', row: 1, seat: 3 })).toMatchObject({
      ok: false,
      problem: 'seatBlocked',
    });
  });

  it('round-trips index -> seat -> index', () => {
    for (let i = 0; i < index.total; i++) {
      const ref = seatAt(index, i);
      expect(ref).not.toBeNull();
      expect(checkSeat(index, ref!).index).toBe(i);
    }
    expect(seatAt(index, -1)).toBeNull();
    expect(seatAt(index, index.total)).toBeNull();
  });

  it('lists rows in ascending order', () => {
    expect(rowsOfSection(index, 'A').map((r) => r.id)).toEqual([1, 2]);
    expect(rowsOfSection(index, 'ZZ')).toEqual([]);
  });
});

describe('seat keys and QR links', () => {
  it('formats and parses a seat key', () => {
    expect(seatKey({ section: 'B', row: 12, seat: 7 })).toBe('B-12-7');
    expect(parseSeatKey('b-12-7')).toEqual({ section: 'B', row: 12, seat: 7 });
    expect(parseSeatKey('nonsense')).toBeNull();
    expect(parseSeatKey(null)).toBeNull();
  });

  it('reads ?s=&r=&n= from a QR link', () => {
    const index = prepareSeats(fixture);
    const ok = parseSeatParams(new URLSearchParams('s=A&r=2&n=3'), index);
    expect(ok.ref).toEqual({ section: 'A', row: 2, seat: 3 });
    expect(ok.problem).toBeUndefined();

    const blocked = parseSeatParams(new URLSearchParams('s=A&r=1&n=3'), index);
    expect(blocked.ref).toBeUndefined();
    expect(blocked.problem).toBe('seatBlocked');

    expect(parseSeatParams(new URLSearchParams('lang=fr'), index).ref).toBeUndefined();
  });
});

describe('generated seats.json', () => {
  const file = JSON.parse(
    readFileSync(resolve(__dirname, '../public/seats.json'), 'utf8'),
  ) as SeatsFile;
  const index = prepareSeats(file);

  it('describes the MVP stadium: 10 sections x 10 rows x 100 seats', () => {
    expect(file.sections).toHaveLength(10);
    expect(file.layout.cellW).toBe(100);
    expect(file.sections.every((section) => section.rows.length === 10)).toBe(true);
    // The panorama grid is 10 000 cells; aisles remove a few of them.
    expect(file.sections.length * 10 * 100).toBe(10000);
    expect(index.total).toBeGreaterThan(9000);
    expect(index.total).toBe(file.stadium.capacity);
  });

  it('enumerates every seat exactly once', () => {
    const seen = new Set<number>();
    for (let i = 0; i < index.total; i++) {
      const ref = seatAt(index, i)!;
      const check = checkSeat(index, ref);
      expect(check.ok).toBe(true);
      expect(seen.has(check.index)).toBe(false);
      seen.add(check.index);
    }
    expect(seen.size).toBe(index.total);
  });
});
