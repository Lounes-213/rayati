/** Format constants + tiny shared helpers. */

export const SHOW_FORMAT_VERSION = 1;
export const SEATS_FORMAT_VERSION = 1;

/** Palette index 0 is reserved for pure black ("seat not used / off"). */
export const OFF_INDEX = 0;
export const OFF_COLOR = '#000000';

/** WCAG check helpers used for the high-contrast palette report in the tools. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/** Relative luminance (WCAG 2.1) of a #rrggbb colour, 0..1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True when a palette colour is bright enough to be worth turning the torch on. */
export function isWhiteish(hex: string, threshold = 0.72): boolean {
  return luminance(hex) >= threshold;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Safe integer parse: returns fallback for '', 'abc', null, 1e99… */
export function toInt(value: unknown, fallback = Number.NaN): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d{1,9}$/.test(value.trim())) return Number.parseInt(value, 10);
  return fallback;
}

/** Tolerant JSON fetch used by every repository (never throws on bad payload). */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'omit', ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}
