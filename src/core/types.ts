/**
 * Shared types. Everything here is plain data so it can be unit-tested
 * without a DOM and reused by the simulation view.
 */

export type Lang = 'ar' | 'fr' | 'en';
export type LangDict = Record<Lang, string>;

/** A physical seat: section letter, row number, seat number. */
export interface SeatRef {
  section: string;
  row: number;
  seat: number;
}

/* ------------------------------------------------------------------ seats.json */

/** Blocked seat range inside a row: [from, to] inclusive. */
export type SeatRange = [number, number];

export interface RowDef {
  /** Row number as printed on the seat (1-based). */
  id: number;
  seatFrom: number;
  seatTo: number;
  /** Seats that physically do not exist (aisles, pillars, camera spots). */
  blocked?: SeatRange[];
}

export interface SectionDef {
  id: string;
  name: LangDict;
  /** Position of the section inside the stadium panorama grid (0-based). */
  col: number;
  row: number;
  rows: RowDef[];
}

export interface SeatsFile {
  v: number;
  generatedAt: string;
  stadium: { name: string; capacity: number };
  /** Panorama grid layout: sections laid side by side, rows over rows. */
  layout: { sectionCols: number; sectionRows: number; cellW: number; cellH: number };
  sections: SectionDef[];
}

/* ------------------------------------------------------------------ show.json */

export interface ShowMeta {
  id: string;
  name: string;
  generatedAt: string;
  /** ISO time after which the file is considered stale (still playable). */
  expiresAt: string;
  /** Absolute start time, epoch ms. 0 = "play as soon as the phone is ready". */
  startAt: number;
  durationMs: number;
  /** Encoding resolution in ms (100 for Rayati). */
  tickMs: number;
  seatCount: number;
  /** Number of animation steps (acts) in the show. */
  acts: number;
  actMs: number;
  /** Short human hint shown before the show starts (per language). */
  title?: LangDict;
}

/** Run-length encoded timeline: list of [paletteIndex, durationMs]. */
export type TimelineSteps = number[][];

export interface ShowChunkRef {
  url: string;
  seatFrom: number;
  seatTo: number;
}

export interface ShowChunk extends Omit<ShowChunkRef, 'url'> {
  i: number;
  runs: SeatRange[];
  /** Timelines owned by this chunk; ids are globally offset by the loader. */
  timelines?: TimelineSteps[];
}

export interface ShowFile {
  v: number;
  meta: ShowMeta;
  /** Max 16 high-contrast colours. Index 0 is always pure black (OFF). */
  palette: string[];
  timelines: TimelineSteps[];
  /** Seat-to-timeline map, in global seat order, run-length encoded. */
  seatIndex: { runs: SeatRange[]; timelines?: TimelineSteps[] };
  /** Optional chunked variant: every chunk is prefetched before the event. */
  chunks?: ShowChunkRef[];
}

/* ------------------------------------------------------------------ app state */

export interface SeatSelection extends SeatRef {
  /** Global seat index used to look up the timeline. */
  index: number;
  key: string;
  /** Where the seat came from: printed QR / manual picker. */
  source: 'qr' | 'manual' | 'restored';
}

export interface ClockState {
  /** ms to add to Date.now() to obtain the shared show time. */
  offsetMs: number;
  rttMs: number;
  samples: number;
  source: 'network' | 'manual' | 'device';
  /** Epoch ms when the offset was measured (0 when never synced). */
  measuredAt: number;
}

export interface ShowStats {
  seats: number;
  timelines: number;
  acts: number;
  durationMs: number;
  paletteColors: number;
}

export type Route = 'welcome' | 'seat' | 'ready' | 'show' | 'done' | 'calibrate';
