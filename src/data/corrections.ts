/**
 * corrections.json — small update file produced by tools/opencv_calibrate.py.
 * A phone that sits in the wrong seat keeps flashing its registered code, so the
 * tool tells us which timeline that phone should actually play (the timeline of
 * the seat it is physically covering). Phones that were not detected keep their
 * registered colour: the correction file only ever moves seats.
 */
import { KEYS } from '../core/config';
import type { TimelineSteps } from '../core/types';
import { decodeTimeline, type DecodedShow } from '../domain/showTimeline';
import { createStorage, getJson, setJson, type KVStorage } from './storage';

export interface CorrectionAssignment {
  /** Seat registered by the phone (the seat printed on the QR). */
  seat: number;
  /** Physical seat whose timeline this phone must actually play. */
  sourceSeat?: number;
  /**
   * Absolute timeline id in the merged show (shown timelines first, then the
   * timelines declared by this corrections file) — an alternative to `sourceSeat`.
   */
  timeline?: number;
}

export interface CorrectionsFile {
  v: number;
  generatedAt: string;
  showId?: string;
  /** Optional timelines appended after the show's own timelines. */
  timelines?: TimelineSteps[];
  assignments: CorrectionAssignment[];
  stats?: Record<string, number>;
}

export interface CorrectionsResult {
  applied: number;
  skipped: number;
  file: CorrectionsFile;
  /** Timelines the show had before this file was merged. */
  timelineCount: number;
}

/** Merge a corrections file into a decoded show. Returns the number of seats moved. */
export function applyCorrections(show: DecodedShow, file: CorrectionsFile): CorrectionsResult {
  const timelineCount = show.timelines.length;
  for (const steps of file.timelines ?? []) {
    show.timelines.push(decodeTimeline(steps, show.meta.tickMs, undefined, show.palette.length));
  }
  let applied = 0;
  let skipped = 0;
  for (const item of file.assignments ?? []) {
    const seat = Math.trunc(Number(item.seat));
    if (!Number.isFinite(seat) || seat < 0 || seat >= show.seatCount) {
      skipped++;
      continue;
    }
    // Preferred form: borrow the timeline of the seat the phone really covers,
    // so the correction stays valid even if the show file is rebuilt later.
    let global: number;
    if (Number.isFinite(Number(item.sourceSeat))) {
      const source = Math.trunc(Number(item.sourceSeat));
      if (source < 0 || source >= show.seatCount) {
        skipped++;
        continue;
      }
      global = show.seatTimeline[source];
    } else if (Number.isFinite(Number(item.timeline))) {
      // Absolute id: the show's own timelines, then the file's extra ones.
      global = Math.max(0, Math.trunc(Number(item.timeline)));
    } else {
      skipped++;
      continue;
    }
    if (global >= show.timelines.length) {
      skipped++;
      continue;
    }
    show.seatTimeline[seat] = global;
    applied++;
  }
  return { applied, skipped, file, timelineCount };
}

export interface CorrectionsOptions {
  storage?: KVStorage;
  url?: string;
  fetcher?: typeof fetch;
}

/**
 * Corrections are optional: a 404 (no calibration run) is a normal outcome.
 * The last merged file is cached so later offline loads behave identically.
 */
export async function loadCorrections(options: CorrectionsOptions = {}): Promise<CorrectionsFile | null> {
  const storage = options.storage ?? createStorage();
  const url = options.url ?? 'corrections.json';
  const fetcher = options.fetcher ?? fetch;
  try {
    const res = await fetcher(url, { credentials: 'omit' });
    if (!res.ok) return getJson<CorrectionsFile | null>(storage, KEYS.corrections, null);
    const file = (await res.json()) as CorrectionsFile;
    if (!Array.isArray(file?.assignments)) return null;
    setJson(storage, KEYS.corrections, file);
    return file;
  } catch {
    return getJson<CorrectionsFile | null>(storage, KEYS.corrections, null);
  }
}
