import { describe, expect, it } from 'vitest';
import { prepareSeats } from '../src/domain/seat';
import seatsJson from '../public/seats.json';
import {
  PRESET_CADRES,
  analyzeCadreSeats,
  countConnectedInCadre,
  generateShowFromImage,
  generateShowWithCadrePreset,
} from '../src/services/cadreMapping';

describe('Cadre Mapping Service (نظام تحديد الإطار والمناطق)', () => {
  const seats = prepareSeats(seatsJson as never);

  it('correctly analyzes full stand and sub-cadres', () => {
    const full = analyzeCadreSeats(seats, PRESET_CADRES.full);
    expect(full.totalInCadre).toBe(seats.total);

    const virageNord = analyzeCadreSeats(seats, PRESET_CADRES.virage_nord);
    expect(virageNord.totalInCadre).toBeGreaterThan(0);
    expect(virageNord.totalInCadre).toBeLessThan(seats.total);

    const virageSud = analyzeCadreSeats(seats, PRESET_CADRES.virage_sud);
    expect(virageSud.totalInCadre).toBeGreaterThan(0);
    expect(virageSud.totalInCadre).toBeLessThan(seats.total);
  });

  it('accurately counts connected phones within a cadre', () => {
    const cadre = PRESET_CADRES.virage_nord;
    const { seatsInfo } = analyzeCadreSeats(seats, cadre);

    // Pick 100 connected seats
    const connected = new Set<number>();
    for (let i = 0; i < 100; i++) {
      connected.add(i);
    }

    const count = countConnectedInCadre(seatsInfo, connected);
    // Since seats 0..99 are in section A (top rows), they should all be in virage_nord
    expect(count).toBe(100);
  });

  it('generates a valid ShowFile from raw image pixels mapped to cadre', () => {
    const cadre = PRESET_CADRES.centrale;
    // 4x4 RGBA dummy image
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    // Fill with emerald green
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 10;
      data[i + 1] = 125;
      data[i + 2] = 62;
      data[i + 3] = 255;
    }

    const show = generateShowFromImage(seats, cadre, { width, height, data }, 'black', 15000);

    expect(show.v).toBe(1);
    expect(show.meta.seatCount).toBe(seats.total);
    expect(show.palette.length).toBeGreaterThanOrEqual(1);
    expect(show.timelines.length).toBeGreaterThan(0);

    // Sum of seat runs must equal total seats
    const totalCovered = show.seatIndex.runs.reduce((acc, [, count]) => acc + count, 0);
    expect(totalCovered).toBe(seats.total);
  });

  it('generates a valid ShowFile restricting a preset animation to the cadre', () => {
    const cadre = PRESET_CADRES.virage_nord;
    const show = generateShowWithCadrePreset(seats, cadre, 'ultras_strobe', 'black', 10000);

    expect(show.v).toBe(1);
    expect(show.meta.seatCount).toBe(seats.total);
    const totalCovered = show.seatIndex.runs.reduce((acc, [, count]) => acc + count, 0);
    expect(totalCovered).toBe(seats.total);
  });
});
