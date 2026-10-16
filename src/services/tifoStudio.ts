import type { ShowFile, TimelineSteps } from '../core/types';
import { seatAt, type SeatIndex } from '../domain/seat';

export type TifoPresetType =
  | 'algeria_flag'
  | 'stadium_wave'
  | 'ultras_strobe'
  | 'giant_text'
  | 'club_mca'
  | 'club_usma'
  | 'club_jsk'
  | 'club_crb'
  | 'club_ess';

export interface TifoPresetConfig {
  type: TifoPresetType;
  name: string;
  durationMs: number;
  customText?: string;
}

/**
 * Procedural Tifo generator for Rayati stadium crowd displays.
 * Converts geometric algorithms, flag emblems, club colors, and text into
 * deduplicated run-length-encoded (RLE) timeline show files.
 */
export function generateTifoShow(
  seats: SeatIndex,
  config: TifoPresetConfig,
  startTime: number = 0,
): ShowFile {
  const tickMs = 100;
  const durationMs = Math.max(5000, config.durationMs || 30000);
  const totalTicks = Math.floor(durationMs / tickMs);
  const totalSeats = seats.total;

  const layout = seats.file.layout ?? {
    cellW: 100,
    cellH: 10,
    sectionCols: 10,
    sectionRows: 1,
  };
  const gridW = layout.sectionCols * layout.cellW;
  const gridH = layout.sectionRows * layout.cellH;

  // Map each seat index to (x, y) in the grid
  const seatCoords: Array<{ x: number; y: number }> = new Array(totalSeats);
  for (let i = 0; i < totalSeats; i++) {
    const s = seatAt(seats, i);
    if (!s) {
      seatCoords[i] = { x: 0, y: 0 };
      continue;
    }
    const sec = seats.sections.find((x) => x.id === s.section);
    const col = sec?.col ?? 0;
    const row = sec?.row ?? 0;
    const rows = seats.file.sections.find((x) => x.id === s.section)?.rows ?? [];
    const rowIndex = Math.max(0, rows.findIndex((r) => r.id === s.row));
    const seatFrom = rows[rowIndex]?.seatFrom ?? 1;
    const x = col * layout.cellW + Math.min(layout.cellW - 1, Math.max(0, s.seat - seatFrom));
    const y = row * layout.cellH + Math.min(layout.cellH - 1, rowIndex);
    seatCoords[i] = { x, y };
  }

  let palette: string[] = ['#000000'];
  let colorFn: (x: number, y: number, tick: number) => number = () => 0;

  switch (config.type) {
    case 'algeria_flag': {
      // 0: black, 1: green, 2: white, 3: red, 4: bright green highlight
      palette = ['#000000', '#0A7D3E', '#FFFFFF', '#D21034', '#12C262'];
      const midX = gridW / 2;
      const midY = gridH / 2;
      const radius = gridH * 0.38;

      colorFn = (x, y, tick) => {
        // Waving ripple across columns
        const wave = Math.sin(x * 0.02 - tick * 0.15) * 0.8;
        const effY = y + wave;

        // Distance from center for crescent & star
        const dx = (x - midX) * 0.85;
        const dy = effY - midY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Crescent outer and inner circles
        const inOuter = dist < radius;
        const innerDx = (x - (midX + radius * 0.28)) * 0.85;
        const inInner = Math.sqrt(innerDx * innerDx + dy * dy) < radius * 0.78;
        const isCrescent = inOuter && !inInner;

        // 5-pointed Star inside crescent
        const starDx = (x - (midX + radius * 0.22)) * 0.85;
        const starDist = Math.sqrt(starDx * starDx + dy * dy);
        const angle = Math.atan2(dy, starDx);
        const starRadius = radius * 0.36 * (1 + 0.45 * Math.cos(5 * angle));
        const isStar = starDist < starRadius;

        if (isCrescent || isStar) {
          return 3; // Red
        }

        if (x < midX) {
          // Green half with wave lighting
          return wave > 0.4 ? 4 : 1;
        } else {
          // White half
          return 2;
        }
      };
      break;
    }

    case 'stadium_wave': {
      // 0: black, 1: emerald, 2: gold, 3: white
      palette = ['#000000', '#0A7D3E', '#D4AF37', '#FFFFFF'];
      const waveWidth = gridW * 0.12;

      colorFn = (x, _y, tick) => {
        const cycleProgress = (tick % 60) / 60; // 6s per loop
        const waveCenter = cycleProgress * (gridW + waveWidth * 2) - waveWidth;
        const dist = Math.abs(x - waveCenter);

        if (dist < waveWidth * 0.3) return 3; // White crest
        if (dist < waveWidth * 0.6) return 2; // Gold body
        if (dist < waveWidth) return 1; // Green wake
        return 0; // Black standby
      };
      break;
    }

    case 'ultras_strobe': {
      // 0: black, 1: white burst, 2: red flare, 3: emerald flare
      palette = ['#000000', '#FFFFFF', '#D21034', '#0A7D3E'];

      colorFn = (x, _y, tick) => {
        const beat = Math.floor(tick / 4) % 8; // 400ms beats
        const flashPhase = tick % 4; // 100ms flash then decay
        if (flashPhase > 1) return 0; // Black decay

        if (beat === 0 || beat === 4) return 1; // Pure White flash
        if (beat === 2 || beat === 6) {
          return x < gridW / 2 ? 3 : 2; // Green & Red half flash
        }
        return 1;
      };
      break;
    }

    case 'club_mca': {
      // Green & Red vertical stripes (MC Alger)
      palette = ['#000000', '#0A7D3E', '#D21034', '#FFFFFF'];
      colorFn = (x, _y, tick) => {
        const stripe = Math.floor((x + tick) / 50) % 2;
        return stripe === 0 ? 1 : 2;
      };
      break;
    }

    case 'club_usma': {
      // Red & Black vertical stripes (USM Alger)
      palette = ['#000000', '#D21034', '#151515', '#FFFFFF'];
      colorFn = (x, _y, tick) => {
        const stripe = Math.floor((x + tick) / 50) % 2;
        return stripe === 0 ? 1 : 2;
      };
      break;
    }

    case 'club_jsk': {
      // Yellow & Green (JS Kabylie)
      palette = ['#000000', '#FFD700', '#0A7D3E', '#FFFFFF'];
      colorFn = (x, _y, tick) => {
        const stripe = Math.floor((x + tick) / 50) % 2;
        return stripe === 0 ? 1 : 2;
      };
      break;
    }

    case 'club_crb': {
      // Red & White (CR Belouizdad)
      palette = ['#000000', '#D21034', '#FFFFFF', '#8B0000'];
      colorFn = (x, _y, tick) => {
        const stripe = Math.floor((x + tick) / 50) % 2;
        return stripe === 0 ? 1 : 2;
      };
      break;
    }

    case 'club_ess': {
      // White & Black (ES Sétif)
      palette = ['#000000', '#FFFFFF', '#1A1A1A', '#808080'];
      colorFn = (x, _y, tick) => {
        const stripe = Math.floor((x + tick) / 50) % 2;
        return stripe === 0 ? 1 : 2;
      };
      break;
    }

    default: {
      palette = ['#000000', '#0A7D3E', '#FFFFFF', '#D21034'];
      colorFn = (x) => (x < gridW / 2 ? 1 : 2);
    }
  }

  // Generate timelines for each seat and deduplicate
  const uniqueTimelines: TimelineSteps[] = [];
  const timelineKeyMap = new Map<string, number>();
  const seatTimeline: number[] = new Array(totalSeats).fill(0);

  for (let seat = 0; seat < totalSeats; seat++) {
    const { x, y } = seatCoords[seat] ?? { x: 0, y: 0 };

    // Build RLE timeline steps: [[paletteIndex, durationMs], [paletteIndex, durationMs]...]
    const steps: number[][] = [];
    let currentColor = -1;
    let currentLen = 0;

    for (let t = 0; t < totalTicks; t++) {
      const color = colorFn(x, y, t);
      if (color === currentColor) {
        currentLen++;
      } else {
        if (currentColor !== -1) {
          steps.push([currentColor, currentLen * tickMs]);
        }
        currentColor = color;
        currentLen = 1;
      }
    }
    if (currentColor !== -1 && currentLen > 0) {
      steps.push([currentColor, currentLen * tickMs]);
    }

    const key = steps.map((s) => `${s[0]}:${s[1]}`).join(',');
    let timelineIndex = timelineKeyMap.get(key);
    if (timelineIndex === undefined) {
      timelineIndex = uniqueTimelines.length;
      uniqueTimelines.push(steps);
      timelineKeyMap.set(key, timelineIndex);
    }
    seatTimeline[seat] = timelineIndex;
  }

  // RLE encode the seat-to-timeline map into [timelineId, repeatCount] runs
  const seatRuns: [number, number][] = [];
  let curId = -1;
  let curCount = 0;
  for (let i = 0; i < totalSeats; i++) {
    const id = seatTimeline[i] ?? 0;
    if (id === curId) {
      curCount++;
    } else {
      if (curId !== -1) {
        seatRuns.push([curId, curCount]);
      }
      curId = id;
      curCount = 1;
    }
  }
  if (curId !== -1 && curCount > 0) {
    seatRuns.push([curId, curCount]);
  }

  return {
    v: 1,
    meta: {
      id: `rayati-${config.type}-${Date.now()}`,
      name: config.name || 'Rayati Tifo Show',
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(),
      startAt: startTime,
      durationMs,
      tickMs,
      seatCount: totalSeats,
      acts: 1,
      actMs: durationMs,
    },
    palette,
    timelines: uniqueTimelines,
    seatIndex: { runs: seatRuns },
  };
}
