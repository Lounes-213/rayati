import { describe, expect, it } from 'vitest';
import { CALIBRATION } from '../src/core/config';
import { decodeBits, encodeCode, fromGray, parityOf, toGray } from '../src/domain/grayCode';

describe('Gray code calibration frame', () => {
  it('round-trips every seat of the MVP and the 50k stadium', () => {
    for (const seat of [0, 1, 2, 7, 999, 4970, 9999, 12345, 49_999, 65_535]) {
      const code = encodeCode(seat);
      expect(decodeBits(code.bits)).toBe(seat);
    }
  });

  it('flashes 1 start bit + data bits + 1 parity bit', () => {
    const code = encodeCode(1234);
    expect(code.bits).toHaveLength(1 + CALIBRATION.dataBits + 1);
    expect(code.bits[0]).toBe(1);
    expect(code.durationMs).toBe(code.bits.length * CALIBRATION.bitMs);
  });

  it('detects a single flipped bit with the parity bit', () => {
    const code = encodeCode(4711);
    const flipped = [...code.bits];
    flipped[6] = flipped[6] ? 0 : 1;
    expect(decodeBits(flipped)).toBeNull();
  });

  it('rejects a frame without a start bit', () => {
    const code = encodeCode(12);
    const damaged = [...code.bits];
    damaged[0] = 0;
    expect(decodeBits(damaged)).toBeNull();
    expect(decodeBits([])).toBeNull();
  });

  it('keeps the Gray property: neighbours differ by one bit', () => {
    for (let seat = 0; seat < 64; seat++) {
      const a = encodeCode(seat).bits.slice(1, 1 + CALIBRATION.dataBits);
      const b = encodeCode(seat + 1).bits.slice(1, 1 + CALIBRATION.dataBits);
      const differences = a.reduce((sum, bit, i) => sum + (bit === b[i] ? 0 : 1), 0);
      expect(differences).toBe(1);
    }
  });

  it('converts between binary and Gray', () => {
    for (const value of [0, 1, 5, 42, 65_535]) {
      expect(fromGray(toGray(value))).toBe(value);
      expect(parityOf(value)).toBe(value.toString(2).split('').filter((c) => c === '1').length % 2);
    }
  });
});
