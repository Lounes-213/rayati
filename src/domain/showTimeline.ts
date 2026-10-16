/**
 * Show timeline decoding — pure logic, unit-tested.
 *
 * Storage format (see tools/build_show.py):
 *   timelines[]        unique colour timelines, run-length encoded [paletteIndex, durationMs]
 *   seatIndex.runs[]   [timelineId, repeat] walking the global seat order
 * Timelines are deduplicated, so the file size depends on the number of distinct
 * seat behaviours (colour x wave phase), not on the number of seats.
 */
import { OFF_INDEX, SHOW_FORMAT_VERSION, clamp } from '../core/constants';
import type { ShowChunk, ShowFile, ShowMeta, SeatRange, TimelineSteps } from '../core/types';

export interface Timeline {
  /** Total ticks, i.e. duration / tickMs. */
  ticks: number;
  /** One palette index per tick — built when the timeline is short enough. */
  flat?: Uint8Array;
  /** Run starts in ticks (length runs+1, last entry === ticks). */
  starts?: Int32Array;
  /** Palette index of each run. */
  values?: Uint8Array;
  runs: number;
}

export interface DecodedShow {
  meta: ShowMeta;
  palette: string[];
  /** Palette as flat RGBA-ready bytes for canvas rendering. */
  paletteRgb: Uint8Array;
  timelines: Timeline[];
  seatCount: number;
  /** timeline id per seat, or 0 (black) when a seat has no timeline. */
  seatTimeline: Uint8Array | Uint16Array;
  warnings: string[];
  /** True when the show file's expiresAt is in the past. */
  expired: boolean;
}

export interface DecodeOptions {
  /** Build flat lookup arrays for timelines with fewer ticks than this. */
  flatThresholdTicks?: number;
  /** Override "now" (tests). */
  now?: number;
}

const DEFAULT_FLAT_THRESHOLD = 15_000;

/** ms -> ticks on the fixed 100 ms grid. Every step is at least one tick. */
export function msToTicks(ms: number, tickMs: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.round(ms / tickMs));
}

/** Decode one RLE timeline into either a flat array or a run structure. */
export function decodeTimeline(
  steps: TimelineSteps,
  tickMs: number,
  flatThreshold = DEFAULT_FLAT_THRESHOLD,
  paletteSize = 16,
): Timeline {
  const safeTick = Number.isFinite(tickMs) && tickMs > 0 ? tickMs : 100;
  const runs: number[] = [];
  const values: number[] = [];
  let ticks = 0;

  for (const step of steps ?? []) {
    if (!Array.isArray(step) || step.length < 2) continue;
    const value = toPaletteIndex(step[0], paletteSize);
    const runTicks = msToTicks(Number(step[1]), safeTick);
    if (ticks > 0 && values[values.length - 1] === value) {
      runs[runs.length - 1] += runTicks; // merge identical neighbours (keeps RLE canonical)
    } else {
      runs.push(runTicks);
      values.push(value);
    }
    ticks += runTicks;
  }

  if (runs.length === 0) {
    return { ticks: 0, flat: new Uint8Array(0), values: new Uint8Array(0), runs: 0 };
  }

  if (ticks <= flatThreshold) {
    const flat = new Uint8Array(ticks);
    let cursor = 0;
    for (let i = 0; i < runs.length; i++) {
      flat.fill(values[i], cursor, cursor + runs[i]);
      cursor += runs[i];
    }
    return { ticks, flat, runs: runs.length };
  }

  const starts = new Int32Array(runs.length + 1);
  let cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    starts[i] = cursor;
    cursor += runs[i];
  }
  starts[runs.length] = cursor;
  return { ticks, starts, values: Uint8Array.from(values), runs: runs.length };
}

function toPaletteIndex(value: unknown, paletteSize: number): number {
  const n = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return OFF_INDEX;
  return Math.min(n, Math.max(0, paletteSize - 1));
}

/**
 * Expand the seat -> timeline runs into one entry per seat.
 * A truncated file is padded with black instead of throwing: better a partial
 * show than a blank screen in a full stadium.
 */
export function decodeSeatIndex(
  runs: SeatRange[],
  seatCount: number,
  timelineCount: number,
  warnings: string[] = [],
): Uint8Array | Uint16Array {
  const use16 = timelineCount > 255;
  const map = use16 ? new Uint16Array(seatCount) : new Uint8Array(seatCount);
  const maxId = Math.max(0, timelineCount - 1);
  let cursor = 0;
  for (const run of runs ?? []) {
    if (!Array.isArray(run) || run.length < 2) continue;
    const id = clamp(Math.trunc(Number(run[0])) || 0, 0, maxId);
    const repeat = Math.max(0, Math.trunc(Number(run[1])) || 0);
    const end = Math.min(seatCount, cursor + repeat);
    for (let i = cursor; i < end; i++) map[i] = id;
    cursor += repeat;
    if (cursor >= seatCount) break;
  }
  if (cursor < seatCount) warnings.push(`seatIndex covers ${cursor}/${seatCount} seats (padded black)`);
  if (cursor > seatCount) warnings.push(`seatIndex overflows by ${cursor - seatCount} seats (truncated)`);
  return map;
}

/** Append an optional chunk: timelines get offset ids, runs fill the seat slice. */
export function applyChunk(show: DecodedShow, chunk: ShowChunk, options: DecodeOptions = {}): void {
  const tickMs = show.meta.tickMs;
  const offset = show.timelines.length;
  for (const steps of chunk.timelines ?? []) {
    show.timelines.push(decodeTimeline(steps, tickMs, options.flatThresholdTicks, show.palette.length));
  }
  let cursor = Math.max(0, Math.trunc(chunk.seatFrom));
  for (const run of chunk.runs ?? []) {
    const id = clamp(Math.trunc(Number(run[0])) + offset, 0, show.timelines.length - 1);
    const repeat = Math.max(0, Math.trunc(Number(run[1])) || 0);
    for (let i = cursor; i < Math.min(show.seatCount, cursor + repeat); i++) show.seatTimeline[i] = id;
    cursor += repeat;
  }
}

/** Validate + decode a show.json payload. Never throws; reports problems as warnings. */
export function decodeShow(file: ShowFile, options: DecodeOptions = {}): DecodedShow {
  const warnings: string[] = [];
  if (!file || typeof file !== 'object') throw new Error('show.json is not an object');
  if (file.v !== SHOW_FORMAT_VERSION) warnings.push(`unexpected show version ${String(file.v)}`);

  const meta = normalizeMeta(file.meta, warnings);
  const palette = normalizePalette(file.palette, warnings);
  const timelines: Timeline[] = (file.timelines ?? []).map((steps) =>
    decodeTimeline(steps, meta.tickMs, options.flatThresholdTicks, palette.length),
  );
  if (timelines.length === 0) warnings.push('show has no timelines');
  if (timelines.length > 65_535) warnings.push('too many timelines, ids truncated to 16 bit');

  const seatTimeline = decodeSeatIndex(
    file.seatIndex?.runs ?? [],
    meta.seatCount,
    timelines.length,
    warnings,
  );

  const now = options.now ?? Date.now();
  const expires = Date.parse(meta.expiresAt);
  return {
    meta,
    palette,
    paletteRgb: paletteToRgbBytes(palette),
    timelines,
    seatCount: meta.seatCount,
    seatTimeline,
    warnings,
    expired: Number.isFinite(expires) ? expires < now : false,
  };
}

function normalizeMeta(meta: ShowMeta | undefined, warnings: string[]): ShowMeta {
  const fallback: ShowMeta = {
    id: 'unknown',
    name: 'Rayati',
    generatedAt: new Date(0).toISOString(),
    expiresAt: new Date(8.64e15).toISOString(),
    startAt: 0,
    durationMs: 600_000,
    tickMs: 100,
    seatCount: 0,
    acts: 0,
    actMs: 400,
  };
  if (!meta || typeof meta !== 'object') {
    warnings.push('missing meta');
    return fallback;
  }
  const tickMs = Number(meta.tickMs);
  return {
    ...fallback,
    ...meta,
    tickMs: Number.isFinite(tickMs) && tickMs > 0 ? tickMs : fallback.tickMs,
    durationMs: Number(meta.durationMs) > 0 ? Number(meta.durationMs) : fallback.durationMs,
    seatCount: Math.max(0, Math.trunc(Number(meta.seatCount)) || 0),
    startAt: Math.max(0, Math.trunc(Number(meta.startAt)) || 0),
  };
}

function normalizePalette(palette: unknown, warnings: string[]): string[] {
  const out: string[] = [];
  if (Array.isArray(palette)) {
    for (const entry of palette) {
      if (typeof entry === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry)) out.push(entry.toLowerCase());
    }
  }
  if (out.length === 0) {
    warnings.push('palette missing or invalid');
    return ['#000000'];
  }
  // Index 0 is reserved for pure black ("seat off"); the spec caps the palette at 16.
  if (out[0] !== '#000000') out.unshift('#000000');
  if (out.length > 16) {
    warnings.push('palette truncated to 16 colours');
    out.length = 16;
  }
  return out;
}

export function paletteToRgbBytes(palette: string[]): Uint8Array {
  const bytes = new Uint8Array(palette.length * 3);
  palette.forEach((hex, i) => {
    const h = hex.replace('#', '');
    bytes[i * 3] = Number.parseInt(h.slice(0, 2), 16);
    bytes[i * 3 + 1] = Number.parseInt(h.slice(2, 4), 16);
    bytes[i * 3 + 2] = Number.parseInt(h.slice(4, 6), 16);
  });
  return bytes;
}

/** Palette index of a seat at a given show time. O(1) for flat timelines. */
export function indexAt(show: DecodedShow, seat: number, timeMs: number): number {
  if (seat < 0 || seat >= show.seatCount) return OFF_INDEX;
  const timeline = show.timelines[show.seatTimeline[seat]];
  if (!timeline) return OFF_INDEX;
  return timelineIndexAt(timeline, timeMs, show.meta.tickMs);
}

export function timelineIndexAt(timeline: Timeline, timeMs: number, tickMs: number): number {
  if (timeline.ticks <= 0) return OFF_INDEX;
  const tick = clamp(Math.floor(Math.max(0, timeMs) / tickMs), 0, timeline.ticks - 1);
  if (timeline.flat) return timeline.flat[tick];
  const starts = timeline.starts!;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= tick) lo = mid;
    else hi = mid;
  }
  return timeline.values![lo];
}

/** Hex colour of a seat at a given show time. */
export function colorAt(show: DecodedShow, seat: number, timeMs: number): string {
  return show.palette[indexAt(show, seat, timeMs)] ?? '#000000';
}

/** Fill a reusable buffer with one palette index per seat (simulation view). */
export function renderFrame(show: DecodedShow, timeMs: number, out?: Uint8Array): Uint8Array {
  const frame = out && out.length === show.seatCount ? out : new Uint8Array(show.seatCount);
  const tickMs = show.meta.tickMs;
  for (let seat = 0; seat < show.seatCount; seat++) {
    const timeline = show.timelines[show.seatTimeline[seat]];
    frame[seat] = timeline ? timelineIndexAt(timeline, timeMs, tickMs) : OFF_INDEX;
  }
  return frame;
}

/** Playback progress 0..1, clamped. */
export function progressAt(show: DecodedShow, timeMs: number): number {
  const duration = Math.max(1, show.meta.durationMs);
  return clamp(timeMs / duration, 0, 1);
}

/** Wall-clock time (shared show time) at which a seat's timeline ends. */
export function endMs(show: DecodedShow): number {
  return show.meta.durationMs;
}

export function decodeRateStats(show: DecodedShow) {
  const runs = show.timelines.reduce((sum, t) => sum + t.runs, 0);
  return { timelines: show.timelines.length, runs, ticks: Math.round(show.meta.durationMs / show.meta.tickMs) };
}
