/**
 * Calibration code: [start bit][Gray bits, MSB first][parity bit].
 * The page flashes it; tools/opencv_calibrate.py decodes the same layout.
 * Gray code means two consecutive seat numbers differ by one bit only, which
 * makes the decode robust against a dropped frame.
 */
import { CALIBRATION } from '../core/config';

export interface CalibrationCode {
  bits: number[];
  seat: number;
  /** Total duration of one code repetition in ms. */
  durationMs: number;
}

export function toGray(value: number): number {
  return value ^ (value >> 1);
}

export function fromGray(gray: number): number {
  let value = gray;
  let shift = 1;
  while (shift < 32) {
    value ^= value >> shift;
    shift <<= 1;
  }
  return value >>> 0;
}

export function parityOf(value: number): number {
  let v = value >>> 0;
  v ^= v >>> 16;
  v ^= v >>> 8;
  v ^= v >>> 4;
  v ^= v >>> 2;
  v ^= v >>> 1;
  return v & 1;
}

/** Build the bit sequence flashed for a seat. */
export function encodeCode(seat: number, dataBits = CALIBRATION.dataBits): CalibrationCode {
  const value = Math.max(0, Math.trunc(seat)) & ((1 << dataBits) - 1);
  const gray = toGray(value) >>> 0;
  const bits: number[] = [];
  if (CALIBRATION.startBit) bits.push(1);
  for (let i = dataBits - 1; i >= 0; i--) bits.push((gray >>> i) & 1);
  if (CALIBRATION.parity) bits.push(parityOf(gray));
  return { bits, seat: value, durationMs: bits.length * CALIBRATION.bitMs };
}

/** Inverse of `encodeCode` (used by unit tests and by the OpenCV tool's logic). */
export function decodeBits(bits: number[]): number | null {
  if (bits.length < 3) return null;
  if (CALIBRATION.startBit && bits[0] !== 1) return null;
  const data = CALIBRATION.startBit ? bits.slice(1) : bits.slice();
  const hasParity = CALIBRATION.parity && data.length > 1;
  const payload = hasParity ? data.slice(0, -1) : data;
  const payloadParity = payload.reduce((acc, bit) => acc ^ (bit ? 1 : 0), 0);
  if (hasParity && payloadParity !== (data[data.length - 1] ? 1 : 0)) return null;
  const gray = payload.reduce((acc, bit) => ((acc << 1) | (bit ? 1 : 0)) >>> 0, 0);
  return fromGray(gray);
}
