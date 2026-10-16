/**
 * Seat domain logic — pure, no DOM, no I/O.
 * The global seat index enumerated here MUST match tools/generate_seats.py:
 * sections in file order, rows by ascending id, seats ascending, blocked seats skipped.
 */
import type { RowDef, SeatRef, SectionDef, SeatsFile } from '../core/types';

export interface SeatIndex {
  file: SeatsFile;
  sections: SectionDef[];
  sectionIds: string[];
  /** Cumulative seat count before each section (global order). */
  sectionStart: Map<string, number>;
  /** Row lookup per section, by row id. */
  rowsBySection: Map<string, Map<number, RowDef>>;
  /** Cumulative seat count before each row, keyed `${sectionId}:${rowId}`. */
  rowStart: Map<string, number>;
  total: number;
}

export type SeatProblem =
  | 'unknownSection'
  | 'unknownRow'
  | 'seatNotFound'
  | 'seatBlocked'
  | 'noSeats';

export interface SeatCheck {
  ok: boolean;
  problem?: SeatProblem;
  index: number;
}

/** Number of usable seats in a row (excluding blocked ranges). */
export function rowSeatCount(row: RowDef): number {
  let count = row.seatTo - row.seatFrom + 1;
  for (const [from, to] of row.blocked ?? []) {
    const lo = Math.max(from, row.seatFrom);
    const hi = Math.min(to, row.seatTo);
    if (hi >= lo) count -= hi - lo + 1;
  }
  return Math.max(0, count);
}

export function isBlocked(row: RowDef, seat: number): boolean {
  for (const [from, to] of row.blocked ?? []) {
    if (seat >= from && seat <= to) return true;
  }
  return false;
}

/** Build the ordered index once, then answer every lookup in O(1). */
export function prepareSeats(file: SeatsFile): SeatIndex {
  const sections = [...(file.sections ?? [])].sort((a, b) => a.col - b.col || a.row - b.row);
  const sectionIds: string[] = [];
  const sectionStart = new Map<string, number>();
  const rowsBySection = new Map<string, Map<number, RowDef>>();
  const rowStart = new Map<string, number>();
  let cursor = 0;

  for (const section of sections) {
    sectionIds.push(section.id);
    sectionStart.set(section.id, cursor);
    const rows = new Map<number, RowDef>();
    for (const row of [...(section.rows ?? [])].sort((a, b) => a.id - b.id)) {
      rows.set(row.id, row);
      rowStart.set(`${section.id}:${row.id}`, cursor);
      cursor += rowSeatCount(row);
    }
    rowsBySection.set(section.id, rows);
  }

  return { file, sections, sectionIds, sectionStart, rowsBySection, rowStart, total: cursor };
}

export function sectionOf(index: SeatIndex, id: string): SectionDef | undefined {
  const start = index.sectionStart.get(id);
  return start === undefined ? undefined : index.sections.find((s) => s.id === id);
}

export function rowOf(index: SeatIndex, sectionId: string, rowId: number): RowDef | undefined {
  return index.rowsBySection.get(sectionId)?.get(rowId);
}

/** Valid seat numbers of a row, in order (used to fill the third dropdown). */
export function seatNumbers(index: SeatIndex, sectionId: string, rowId: number): number[] {
  const row = rowOf(index, sectionId, rowId);
  if (!row) return [];
  const out: number[] = [];
  for (let s = row.seatFrom; s <= row.seatTo; s++) if (!isBlocked(row, s)) out.push(s);
  return out;
}

export function rowsOfSection(index: SeatIndex, sectionId: string): RowDef[] {
  const rows = index.rowsBySection.get(sectionId);
  return rows ? [...rows.values()].sort((a, b) => a.id - b.id) : [];
}

/** Validate a seat and return its global index. Invalid seats are impossible inputs. */
export function checkSeat(index: SeatIndex, ref: SeatRef): SeatCheck {
  const start = index.sectionStart.get(ref.section);
  if (start === undefined) return { ok: false, problem: 'unknownSection', index: -1 };
  const row = rowOf(index, ref.section, ref.row);
  if (!row) return { ok: false, problem: 'unknownRow', index: -1 };
  if (!Number.isInteger(ref.seat) || ref.seat < row.seatFrom || ref.seat > row.seatTo) {
    return { ok: false, problem: 'seatNotFound', index: -1 };
  }
  if (isBlocked(row, ref.seat)) return { ok: false, problem: 'seatBlocked', index: -1 };
  const base = index.rowStart.get(`${ref.section}:${ref.row}`) ?? 0;
  let offset = 0;
  for (let s = row.seatFrom; s < ref.seat; s++) if (!isBlocked(row, s)) offset++;
  return { ok: true, index: base + offset };
}

/** Reverse lookup: global index -> seat (used by the simulation + calibration). */
export function seatAt(index: SeatIndex, globalIndex: number): SeatRef | null {
  if (!Number.isInteger(globalIndex) || globalIndex < 0 || globalIndex >= index.total) return null;
  for (const section of index.sections) {
    const start = index.sectionStart.get(section.id) ?? 0;
    const nextStart = start + sectionSeatCount(index, section.id);
    if (globalIndex >= start && globalIndex < nextStart) {
      let cursor = start;
      for (const row of rowsOfSection(index, section.id)) {
        const count = rowSeatCount(row);
        if (globalIndex < cursor + count) {
          let offset = globalIndex - cursor;
          for (let s = row.seatFrom; s <= row.seatTo; s++) {
            if (isBlocked(row, s)) continue;
            if (offset === 0) return { section: section.id, row: row.id, seat: s };
            offset--;
          }
          return null;
        }
        cursor += count;
      }
    }
  }
  return null;
}

export function sectionSeatCount(index: SeatIndex, sectionId: string): number {
  let total = 0;
  for (const row of rowsOfSection(index, sectionId)) total += rowSeatCount(row);
  return total;
}

export function seatKey(ref: SeatRef): string {
  return `${ref.section}-${ref.row}-${ref.seat}`;
}

export function parseSeatKey(key: string | null | undefined): SeatRef | null {
  if (!key) return null;
  const parts = key.split('-');
  if (parts.length !== 3) return null;
  const [section, row, seat] = parts;
  const r = Number.parseInt(row, 10);
  const n = Number.parseInt(seat, 10);
  if (!section || !/^[A-Za-z0-9]{1,3}$/.test(section) || !Number.isInteger(r) || !Number.isInteger(n)) {
    return null;
  }
  return { section: section.toUpperCase(), row: r, seat: n };
}

/**
 * Parse the seat carried by a QR link: `?s=B&r=12&n=7`.
 * The QR is printed on the seat itself, so a fan sitting elsewhere still scans the right code.
 */
export function parseSeatParams(
  params: URLSearchParams,
  index: SeatIndex,
): { ref?: SeatRef; problem?: SeatProblem } {
  const rawSection = params.get('s') ?? params.get('section');
  const rawRow = params.get('r') ?? params.get('row');
  const rawSeat = params.get('n') ?? params.get('seat');
  if (!rawSection || !rawRow || !rawSeat) return {};
  const ref: SeatRef = {
    section: rawSection.trim().toUpperCase(),
    row: Number.parseInt(rawRow, 10),
    seat: Number.parseInt(rawSeat, 10),
  };
  const check = checkSeat(index, ref);
  return check.ok ? { ref } : { problem: check.problem };
}
