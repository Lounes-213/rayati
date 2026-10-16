/** Pure colour/frame helpers shared by the show screen and the simulation view. */

/** Expand palette indices into RGBA bytes (for `ImageData`). Reuses `out` when possible. */
export function frameToRgba(
  frame: Uint8Array,
  paletteRgb: Uint8Array,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const rgba = out && out.length === frame.length * 4 ? out : new Uint8ClampedArray(frame.length * 4);
  for (let i = 0; i < frame.length; i++) {
    const p = frame[i] * 3;
    const o = i * 4;
    rgba[o] = paletteRgb[p];
    rgba[o + 1] = paletteRgb[p + 1];
    rgba[o + 2] = paletteRgb[p + 2];
    rgba[o + 3] = 255;
  }
  return rgba;
}

/** Relative luminance 0..1 of a palette entry, used to decide torch usage. */
export function paletteLuminance(paletteRgb: Uint8Array, index: number): number {
  const p = index * 3;
  const r = paletteRgb[p] / 255;
  const g = paletteRgb[p + 1] / 255;
  const b = paletteRgb[p + 2] / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True when the seat should turn the torch on (bright, low-chroma frame). */
export function isTorchFrame(paletteRgb: Uint8Array, index: number): boolean {
  return paletteLuminance(paletteRgb, index) >= 0.8;
}

/** mm:ss remaining, for countdowns and the simulation timeline. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
