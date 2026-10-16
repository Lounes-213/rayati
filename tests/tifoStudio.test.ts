import { describe, expect, it } from 'vitest';
import { prepareSeats } from '../src/domain/seat';
import { decodeShow } from '../src/domain/showTimeline';
import { generateTifoShow } from '../src/services/tifoStudio';
import seatsJson from '../public/seats.json';

describe('Tifo Studio Procedural Generator', () => {
  const seatsIndex = prepareSeats(seatsJson as never);

  it('generates a valid Algerian flag tifo show', () => {
    const show = generateTifoShow(seatsIndex, {
      type: 'algeria_flag',
      name: 'Algerian Flag Tifo',
      durationMs: 15000,
    });

    expect(show.v).toBe(1);
    expect(show.palette).toContain('#0A7D3E');
    expect(show.palette).toContain('#FFFFFF');
    expect(show.palette).toContain('#D21034');
    expect(show.timelines.length).toBeGreaterThan(0);
    expect(show.seatIndex.runs.length).toBeGreaterThan(0);

    // Decode with domain engine without errors or warnings
    const decoded = decodeShow(show);
    expect(decoded.timelines.length).toBe(show.timelines.length);
    expect(decoded.seatCount).toBe(seatsIndex.total);
    expect(decoded.palette.length).toBe(show.palette.length);
  });

  it('generates club presets and stadium wave', () => {
    const wave = generateTifoShow(seatsIndex, {
      type: 'stadium_wave',
      name: 'Stadium Wave',
      durationMs: 10000,
    });
    expect(wave.meta.durationMs).toBe(10000);
    expect(decodeShow(wave).seatCount).toBe(seatsIndex.total);

    const mca = generateTifoShow(seatsIndex, {
      type: 'club_mca',
      name: 'MCA Tifo',
      durationMs: 10000,
    });
    expect(mca.palette).toContain('#0A7D3E');
    expect(mca.palette).toContain('#D21034');

    const usma = generateTifoShow(seatsIndex, {
      type: 'club_usma',
      name: 'USMA Tifo',
      durationMs: 10000,
    });
    expect(usma.palette).toContain('#D21034');
    expect(usma.palette).toContain('#151515');
  });
});
