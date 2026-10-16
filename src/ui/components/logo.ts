/**
 * Rayati logo — an Algerian flag drawn as a grid of phone lights.
 * Pure SVG built in code (no asset to download, crisp at any size).
 * The wave is a pixel-snapped sine: each column of phones is shifted as a whole,
 * which is exactly what a wave does through a real crowd.
 */
const NS = 'http://www.w3.org/2000/svg';

const GRID = { cols: 14, rows: 8, cell: 12, gap: 3 };
const GREEN = '#0A7D3E';
const GREEN_LIGHT = '#12C262';
const WHITE = '#FFFFFF';
const WHITE_SOFT = '#DCEEFF';
const RED = '#D21034';
const RED_LIGHT = '#FF3B5C';
const GOLD = '#E8B84B';

interface Point {
  x: number;
  y: number;
}

function sEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function starPolygon(center: Point, outer: number, inner: number, rotation = -Math.PI / 2): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = rotation + (i * Math.PI) / 5;
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return points;
}

function inPolygon(poly: Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Colour of one phone light, based on the Algerian flag geometry. */
function cellColor(x: number, y: number): string | null {
  // Crescent = red disc minus an offset disc; star = small polygon.
  const crescentCenter = { x: 0.5, y: 0.5 };
  const dCrescent = Math.hypot(x - crescentCenter.x, y - crescentCenter.y);
  const dInner = Math.hypot(x - 0.54, y - 0.5);
  const inCrescent = dCrescent <= 0.19 && dInner >= 0.152;
  const star = starPolygon({ x: 0.615, y: 0.5 }, 0.075, 0.03);
  if (inCrescent || inPolygon(star, { x, y })) {
    return dCrescent > 0.18 || inPolygon(star, { x, y }) ? RED_LIGHT : RED;
  }
  if (x < 0.4) return x < 0.06 ? GREEN : GREEN_LIGHT;
  return x > 0.94 ? WHITE : WHITE_SOFT;
}

export interface LogoOptions {
  /** Adds the thin gold "pitch" light line under the flag. */
  withBase?: boolean;
  title?: string;
}

/** The pixel-flag mark, ready to drop into a page. */
export function createLogoMark(options: LogoOptions = {}): SVGSVGElement {
  const { cols, rows, cell, gap } = GRID;
  const width = cols * (cell + gap) - gap;
  const padding = 10;
  const height = rows * (cell + gap) - gap + padding * 2;
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `${-padding} ${-padding} ${width + padding * 2} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('class', 'brand__mark');
  svg.setAttribute('aria-label', options.title ?? 'Rayati');
  svg.setAttribute('shape-rendering', 'geometricPrecision');

  const group = sEl('g', {});
  for (let col = 0; col < cols; col++) {
    const x = (col + 0.5) / cols;
    // Pixel-snapped wave: whole columns move together, like real phones.
    const wave = Math.round(Math.sin(x * Math.PI * 1.7 - 0.25) * 1.15);
    const brightness = 0.72 + 0.28 * Math.cos(x * Math.PI * 1.7 - 0.25);
    for (let row = 0; row < rows; row++) {
      const y = (row + 0.5) / rows;
      if (y - wave / rows < 0.02 || y - wave / rows > 0.98) continue;
      const color = cellColor(x, y - wave / rows);
      if (!color) continue;
      const rect = sEl('rect', {
        x: col * (cell + gap),
        y: (row + wave) * (cell + gap),
        width: cell,
        height: cell,
        rx: 2.6,
        fill: color,
        opacity: Number(brightness.toFixed(2)),
      });
      group.appendChild(rect);
    }
  }
  svg.appendChild(group);

  if (options.withBase !== false) {
    svg.appendChild(
      sEl('rect', {
        x: 0,
        y: rows * (cell + gap) + 2,
        width,
        height: 2.5,
        rx: 1.2,
        fill: GOLD,
        opacity: 0.75,
      }),
    );
  }
  return svg;
}

/** Compact inline mark for buttons/headers. */
export function createLogoMini(size = 40): SVGSVGElement {
  const svg = createLogoMark({ withBase: false });
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(Math.round((size * 9) / 16)));
  svg.classList.remove('brand__mark');
  return svg;
}
