import { el } from '../dom';
import type { SeatSelection } from '../../core/types';
import type { SeatIndex } from '../../domain/seat';
import { rowOf, rowsOfSection } from '../../domain/seat';

export interface SeatPreview {
  element: HTMLElement;
  update(selection: SeatSelection | null): void;
}

/**
 * Stadium map: sections are placed on the panorama grid from seats.json and the
 * chosen seat shows as a gold dot inside its section.
 */
export function createSeatPreview(index: SeatIndex, label: string): SeatPreview {
  const layout = index.file.layout ?? { sectionCols: 10, sectionRows: 1, cellW: 100, cellH: 10 };
  const grid = el('div', {
    class: 'preview',
    attrs: { role: 'img', 'aria-label': label },
    style: {
      gridTemplateColumns: `repeat(${layout.sectionCols}, 1fr)`,
      gridTemplateRows: `repeat(${layout.sectionRows}, 1fr)`,
    } as Partial<CSSStyleDeclaration>,
  });
  const dot = el('span', { class: 'preview__dot hidden' });
  const cells = new Map<string, HTMLElement>();

  for (const section of index.sections) {
    const cell = el('div', { class: 'preview__section', attrs: { title: section.id } });
    cell.style.gridColumn = String(section.col + 1);
    cell.style.gridRow = String(section.row + 1);
    cells.set(section.id, cell);
    grid.appendChild(cell);
  }

  const element = el('div', { class: 'stack' }, grid, el('div', { class: 'preview__label', text: label }));

  return {
    element,
    update(selection) {
      cells.forEach((cell, id) => {
        const active = selection?.section === id;
        cell.classList.toggle('preview__section--active', active);
        if (active) {
          const row = rowOf(index, id, selection!.row);
          const rows = rowsOfSection(index, id);
          if (!row || rows.length === 0) return;
          const rowIndex = rows.findIndex((r) => r.id === row.id);
          const seatSpan = Math.max(1, row.seatTo - row.seatFrom);
          const left = ((selection!.seat - row.seatFrom) / seatSpan) * 100;
          const top = rows.length > 1 ? (rowIndex / (rows.length - 1)) * 100 : 50;
          dot.style.left = `${Math.min(97, Math.max(3, left))}%`;
          dot.style.top = `${Math.min(94, Math.max(6, top))}%`;
          cell.appendChild(dot);
          dot.classList.remove('hidden');
        } else if (dot.parentElement === cell) {
          dot.remove();
        }
      });
      if (!selection) dot.classList.add('hidden');
    },
  };
}
