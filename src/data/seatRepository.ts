/**
 * Seat repository: seats.json is small (ranges, not a seat list), so it is cached
 * in localStorage after the first load and works fully offline afterwards.
 */
import { KEYS, PATHS } from '../core/config';
import { SEATS_FORMAT_VERSION } from '../core/constants';
import type { SeatSelection, SeatRef, SeatsFile } from '../core/types';
import { checkSeat, parseSeatKey, prepareSeats, seatKey, type SeatCheck, type SeatIndex } from '../domain/seat';
import { createStorage, getJson, setJson, type KVStorage } from './storage';

export interface SeatRepositoryOptions {
  storage?: KVStorage;
  url?: string;
  fetcher?: typeof fetch;
}

export interface LoadedSeats {
  index: SeatIndex;
  from: 'network' | 'cache';
  bytes: number;
}

export interface SeatRepository {
  load(): Promise<LoadedSeats>;
  /** Synchronous attempt so the first paint can already show the last seat. */
  cached(): SeatIndex | null;
  selected(): SeatSelection | null;
  select(ref: SeatRef, source: SeatSelection['source'], index: SeatIndex): SeatSelection | null;
  clearSelection(): void;
}

export function createSeatRepository(options: SeatRepositoryOptions = {}): SeatRepository {
  const storage = options.storage ?? createStorage();
  const url = options.url ?? PATHS.seats;
  const fetcher = options.fetcher ?? fetch;
  let memory: SeatIndex | null = null;

  function prepare(file: SeatsFile): SeatIndex {
    if (file.v !== SEATS_FORMAT_VERSION) {
      console.warn(`[rayati] seats.json version ${String(file.v)} != ${SEATS_FORMAT_VERSION}`);
    }
    return prepareSeats(file);
  }

  function cached(): SeatIndex | null {
    if (memory) return memory;
    const saved = getJson<SeatsFile | null>(storage, KEYS.seatsCache, null);
    if (!saved) return null;
    memory = prepare(saved);
    return memory;
  }

  return {
    async load() {
      try {
        const res = await fetcher(url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const index = prepare(JSON.parse(text) as SeatsFile);
        setJson(storage, KEYS.seatsCache, JSON.parse(text) as SeatsFile);
        memory = index;
        return { index, from: 'network', bytes: text.length };
      } catch (error) {
        const saved = cached();
        if (saved) return { index: saved, from: 'cache', bytes: 0 };
        throw new Error(`seats_unavailable: ${(error as Error).message}`);
      }
    },

    cached,

    selected() {
      const ref = parseSeatKey(storage.get(KEYS.seat));
      if (!ref) return null;
      const index = cached();
      if (!index) return { ...ref, index: -1, key: seatKey(ref), source: 'restored' };
      const check = checkSeat(index, ref);
      return { ...ref, index: check.index, key: seatKey(ref), source: 'restored' };
    },

    select(ref, source, index) {
      const check: SeatCheck = checkSeat(index, ref);
      if (!check.ok) return null;
      const selection: SeatSelection = { ...ref, index: check.index, key: seatKey(ref), source };
      storage.set(KEYS.seat, selection.key);
      return selection;
    },

    clearSelection() {
      storage.remove(KEYS.seat);
    },
  };
}
