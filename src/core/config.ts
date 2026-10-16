/**
 * Stadium + show configuration.
 * Scaling to 50 000 seats only means changing STADIUM_SEATS (and re-running the tools).
 */

/** MVP stadium: 10 sections x 10 rows x 100 seats = 10 000 seats. */
export const STADIUM_SEATS = 10_000;

export const STADIUM = {
  seats: STADIUM_SEATS,
  sections: 10,
  rows: 10,
  seatsPerRow: 100,
  name: { ar: 'ملعب راياتي الوطني', fr: 'Stade National Rayati', en: 'Rayati National Stadium' },
} as const;

/** Show defaults (mirrored in tools/build_show.py). */
export const SHOW = {
  tickMs: 100,
  actMs: 400,
  durationMs: 10 * 60_000,
  maxPalette: 16,
  /** Timelines decoded into a flat array when short enough for O(1) lookup. */
  flatThresholdTicks: 15_000,
} as const;

/** Runtime limits & timings. */
export const LIMITS = {
  /** Auto-stop the torch after this much continuous use (overheating). */
  torchMaxOnMs: 60_000,
  /** Minimum continuous off time before the torch may be re-armed. */
  torchCooldownMs: 10_000,
  /** On-screen hint duration in show mode. */
  hintMs: 8_000,
  /** Duration of a hold on screen to leave show mode. */
  exitHoldMs: 1_200,
  /** Show file size warning threshold in bytes (gzip target is 2 MB). */
  showWarnBytes: 2_500_000,
  /** Clock offset older than this is flagged as stale. */
  clockStaleMs: 6 * 3_600_000,
  /** Re-sync wall clock every N seconds during playback. */
  resyncEveryMs: 2_000,
} as const;

/** Storage keys (the storage layer adds the `rayati.` namespace). */
export const KEYS = {
  seat: 'seat.v1',
  seatsCache: 'seats-cache.v1',
  lang: 'lang.v1',
  clock: 'clock.v1',
  torch: 'torch.v1',
  showMeta: 'showmeta.v1',
  corrections: 'corrections.v1',
} as const;

/** Asset paths (relative so the app can be hosted in a sub-folder). */
export const PATHS = {
  seats: 'seats.json',
  show: 'show.json',
  time: '/api/time',
  sw: '/sw.js',
} as const;

/** Calibration (Gray code) parameters shared by the page and the OpenCV tool. */
export const CALIBRATION = {
  /** ms per bit. 250 ms = 4 bits/s, far below half of any camera frame rate. */
  bitMs: 250,
  /**
   * Blank gap between two code repetitions.
   * It MUST be at least as long as the code itself (1 + dataBits + 1 bits),
   * otherwise a decoder could lock onto a shifted alignment inside a long run of
   * dark bits and read a valid-looking code. This is what makes the flash
   * self-synchronising: gapMs / bitMs >= dataBits + 2.
   */
  gapMs: 5000,
  /** 1 start bit + 16 data bits (65 536 seats, covers 10k and 50k) + 1 parity bit. */
  dataBits: 16,
  startBit: true,
  parity: true,
} as const;
