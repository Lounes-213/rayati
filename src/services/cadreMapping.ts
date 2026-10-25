import type { ShowFile, TimelineSteps } from '../core/types';
import { seatAt, type SeatIndex } from '../domain/seat';
import { generateTifoShow, type TifoPresetType } from './tifoStudio';

export type CadreShape = 'rectangle' | 'circle' | 'diamond' | 'heart' | 'triangle';

export interface CadreBox {
  id: string;
  name: string;
  /** Normalized coordinates [0, 1] relative to grandstand layout */
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  shape?: CadreShape;
}

export type OutsideCadreMode = 'black' | 'emerald' | 'white' | 'dim';

export const PRESET_CADRES: Record<string, CadreBox> = {
  full: {
    id: 'full',
    name: 'كامل المدرج (العرض الكلي)',
    xMin: 0.0,
    yMin: 0.0,
    xMax: 1.0,
    yMax: 1.0,
  },
  virage_nord: {
    id: 'virage_nord',
    name: 'الفيراج الشمالي (Ultras Nord)',
    xMin: 0.0,
    yMin: 0.0,
    xMax: 1.0,
    yMax: 0.4,
  },
  centrale: {
    id: 'centrale',
    name: 'المدرج المقابل الأوسط (Tribune Centrale)',
    xMin: 0.2,
    yMin: 0.2,
    xMax: 0.8,
    yMax: 0.8,
  },
  virage_sud: {
    id: 'virage_sud',
    name: 'الفيراج الجنوبي (Virage Sud)',
    xMin: 0.0,
    yMin: 0.6,
    xMax: 1.0,
    yMax: 1.0,
  },
  custom: {
    id: 'custom',
    name: 'إطار مخصص (Cadre ROI)',
    xMin: 0.25,
    yMin: 0.25,
    xMax: 0.75,
    yMax: 0.75,
  },
};

export interface SeatCadreInfo {
  seatIndex: number;
  inCadre: boolean;
  /** Normalized coordinate in stadium [0, 1] */
  nx: number;
  ny: number;
  /** Normalized coordinate within the cadre [0, 1] (clamped if outside) */
  u: number;
  v: number;
}

/**
 * Precomputes normalized coordinates for each seat and checks inclusion in the cadre.
 */
export function analyzeCadreSeats(seats: SeatIndex, cadre: CadreBox): {
  seatsInfo: SeatCadreInfo[];
  totalInCadre: number;
} {
  const total = seats.total;
  const layout = seats.file.layout ?? {
    cellW: 100,
    cellH: 10,
    sectionCols: 2,
    sectionRows: 5,
  };
  const gridW = layout.sectionCols * layout.cellW;
  const gridH = layout.sectionRows * layout.cellH;

  const width = Math.max(0.001, cadre.xMax - cadre.xMin);
  const height = Math.max(0.001, cadre.yMax - cadre.yMin);

  const seatsInfo: SeatCadreInfo[] = new Array(total);
  let totalInCadre = 0;

  for (let i = 0; i < total; i++) {
    const s = seatAt(seats, i);
    if (!s) {
      seatsInfo[i] = { seatIndex: i, inCadre: false, nx: 0, ny: 0, u: 0, v: 0 };
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

    const nx = Math.min(1, Math.max(0, x / gridW));
    const ny = Math.min(1, Math.max(0, y / gridH));

    const inBox = nx >= cadre.xMin && nx <= cadre.xMax && ny >= cadre.yMin && ny <= cadre.yMax;
    const u = Math.min(1, Math.max(0, (nx - cadre.xMin) / width));
    const v = Math.min(1, Math.max(0, (ny - cadre.yMin) / height));

    let inCadre = inBox;
    if (inBox && cadre.shape && cadre.shape !== 'rectangle') {
      if (cadre.shape === 'circle') {
        const dx = u - 0.5;
        const dy = v - 0.5;
        inCadre = dx * dx + dy * dy <= 0.25;
      } else if (cadre.shape === 'diamond') {
        inCadre = Math.abs(u - 0.5) + Math.abs(v - 0.5) <= 0.5;
      } else if (cadre.shape === 'triangle') {
        inCadre = v >= 2 * Math.abs(u - 0.5);
      } else if (cadre.shape === 'heart') {
        const x0 = (u - 0.5) * 2.2;
        const y0 = (0.55 - v) * 2.2;
        inCadre = Math.pow(x0 * x0 + y0 * y0 - 1, 3) - x0 * x0 * Math.pow(y0, 3) <= 0;
      }
    }
    if (inCadre) totalInCadre++;

    seatsInfo[i] = { seatIndex: i, inCadre, nx, ny, u, v };
  }

  return { seatsInfo, totalInCadre };
}

/**
 * Counts how many active connected phones fall within the selected cadre.
 */
export function countConnectedInCadre(
  seatsInfo: SeatCadreInfo[],
  connectedSeatIndices: Set<number>,
): number {
  let count = 0;
  for (const info of seatsInfo) {
    if (info.inCadre && connectedSeatIndices.has(info.seatIndex)) {
      count++;
    }
  }
  return count;
}

/**
 * Color quantizer to map continuous RGB into a limited palette for efficient RLE encoding.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Creates a valid ShowFile from an image canvas or pixel data mapped directly to the Cadre.
 */
export function generateShowFromImage(
  seats: SeatIndex,
  cadre: CadreBox,
  imagePixels: { width: number; height: number; data: Uint8ClampedArray | number[] },
  outsideMode: OutsideCadreMode = 'black',
  durationMs: number = 30000,
): ShowFile {
  const { seatsInfo } = analyzeCadreSeats(seats, cadre);
  const totalSeats = seats.total;
  const tickMs = 1000; // Static image display ticks every 1s

  const outsideColor =
    outsideMode === 'emerald'
      ? '#0A7D3E'
      : outsideMode === 'white'
        ? '#FFFFFF'
        : outsideMode === 'dim'
          ? '#111822'
          : '#000000';

  // Build a distinct palette with the outside color at index 0
  const palette: string[] = [outsideColor];
  const colorMap = new Map<string, number>();
  colorMap.set(outsideColor, 0);

  function getPaletteIndex(hex: string): number {
    let idx = colorMap.get(hex);
    if (idx !== undefined) return idx;
    idx = palette.length;
    palette.push(hex);
    colorMap.set(hex, idx);
    return idx;
  }

  const seatColorIndices = new Array<number>(totalSeats);

  for (let i = 0; i < totalSeats; i++) {
    const info = seatsInfo[i];
    if (!info || !info.inCadre) {
      seatColorIndices[i] = 0; // outside color
      continue;
    }

    // Sample from image pixels
    const px = Math.min(imagePixels.width - 1, Math.floor(info.u * imagePixels.width));
    const py = Math.min(imagePixels.height - 1, Math.floor(info.v * imagePixels.height));
    const offset = (py * imagePixels.width + px) * 4;

    const r = imagePixels.data[offset] ?? 0;
    const g = imagePixels.data[offset + 1] ?? 0;
    const b = imagePixels.data[offset + 2] ?? 0;
    const a = imagePixels.data[offset + 3] ?? 255;

    if (a < 64) {
      // Semi-transparent pixels become outside background
      seatColorIndices[i] = 0;
    } else {
      // Quantize to 5-bit color per channel to keep palette size under 256
      const qr = Math.round(r / 16) * 16;
      const qg = Math.round(g / 16) * 16;
      const qb = Math.round(b / 16) * 16;
      const hex = rgbToHex(qr, qg, qb);
      seatColorIndices[i] = getPaletteIndex(hex);
    }
  }

  // Deduplicate timelines: each seat holds its color for durationMs
  const uniqueTimelines: TimelineSteps[] = [];
  const timelineKeyMap = new Map<number, number>();
  const seatTimeline: number[] = new Array(totalSeats);

  for (let i = 0; i < totalSeats; i++) {
    const colIdx = seatColorIndices[i] ?? 0;
    let tIdx = timelineKeyMap.get(colIdx);
    if (tIdx === undefined) {
      tIdx = uniqueTimelines.length;
      uniqueTimelines.push([[colIdx, durationMs]]);
      timelineKeyMap.set(colIdx, tIdx);
    }
    seatTimeline[i] = tIdx;
  }

  // RLE encode the seat-to-timeline map
  const seatRuns: [number, number][] = [];
  let curId = -1;
  let curCount = 0;
  for (let i = 0; i < totalSeats; i++) {
    const id = seatTimeline[i] ?? 0;
    if (id === curId) {
      curCount++;
    } else {
      if (curId !== -1) seatRuns.push([curId, curCount]);
      curId = id;
      curCount = 1;
    }
  }
  if (curId !== -1 && curCount > 0) seatRuns.push([curId, curCount]);

  return {
    v: 1,
    meta: {
      id: `rayati-cadre-img-${Date.now()}`,
      name: `Rayati Image Cadre [${cadre.name}]`,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(),
      startAt: 0,
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

/**
 * Creates a ShowFile with a preset tifo applied strictly inside the cadre,
 * while seats outside the cadre remain in outsideMode.
 */
export function generateShowWithCadrePreset(
  seats: SeatIndex,
  cadre: CadreBox,
  presetType: TifoPresetType,
  outsideMode: OutsideCadreMode = 'black',
  durationMs: number = 30000,
): ShowFile {
  // If cadre is full stadium and rectangular, delegate directly to the full generator
  if (cadre.xMin === 0 && cadre.yMin === 0 && cadre.xMax === 1 && cadre.yMax === 1 && (!cadre.shape || cadre.shape === 'rectangle')) {
    return generateTifoShow(seats, {
      type: presetType,
      name: `Rayati-${presetType}`,
      durationMs,
    });
  }

  // Generate full preset show first
  const fullShow = generateTifoShow(seats, {
    type: presetType,
    name: `Rayati-${presetType}`,
    durationMs,
  });

  const { seatsInfo } = analyzeCadreSeats(seats, cadre);
  const totalSeats = seats.total;

  const outsideColor =
    outsideMode === 'emerald'
      ? '#0A7D3E'
      : outsideMode === 'white'
        ? '#FFFFFF'
        : outsideMode === 'dim'
          ? '#111822'
          : '#000000';

  // Ensure outsideColor is in palette
  let outsidePaletteIdx = fullShow.palette.indexOf(outsideColor);
  if (outsidePaletteIdx === -1) {
    outsidePaletteIdx = fullShow.palette.length;
    fullShow.palette.push(outsideColor);
  }

  // Add static outside timeline
  const outsideTimelineIdx = fullShow.timelines.length;
  fullShow.timelines.push([[outsidePaletteIdx, durationMs]]);

  // Expand seat runs to individual seat timelines
  const expandedSeatTimelines: number[] = new Array(totalSeats);
  let cursor = 0;
  for (const [tIdx, count] of fullShow.seatIndex.runs) {
    for (let c = 0; c < count && cursor < totalSeats; c++) {
      expandedSeatTimelines[cursor] = tIdx;
      cursor++;
    }
  }

  // Overwrite seats outside cadre with outsideTimelineIdx
  for (let i = 0; i < totalSeats; i++) {
    const info = seatsInfo[i];
    if (!info || !info.inCadre) {
      expandedSeatTimelines[i] = outsideTimelineIdx;
    }
  }

  // Re-encode into RLE runs
  const seatRuns: [number, number][] = [];
  let curId = -1;
  let curCount = 0;
  for (let i = 0; i < totalSeats; i++) {
    const id = expandedSeatTimelines[i] ?? 0;
    if (id === curId) {
      curCount++;
    } else {
      if (curId !== -1) seatRuns.push([curId, curCount]);
      curId = id;
      curCount = 1;
    }
  }
  if (curId !== -1 && curCount > 0) seatRuns.push([curId, curCount]);

  fullShow.seatIndex.runs = seatRuns;
  fullShow.meta.name = `Rayati [${cadre.name}] - ${presetType}`;
  return fullShow;
}
