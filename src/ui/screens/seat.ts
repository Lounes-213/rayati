import type { SeatRef } from '../../core/types';
import { checkSeat, rowOf, rowsOfSection, seatNumbers, type SeatIndex } from '../../domain/seat';
import type { AppContext, ScreenFactory } from '../app';
import { createLangSwitch } from '../components/langSwitch';
import { createSeatPreview } from '../components/seatPreview';
import { el, screenShell } from '../dom';

/**
 * Screen 2 — Seat. Two ways in, one source of truth: the cascading dropdowns are
 * filled from seats.json, so an invalid seat cannot even be selected. The QR link
 * (?s=B&r=12&n=7) is printed on the seat itself, not on the ticket, because fans
 * often sit somewhere other than their ticket says.
 */
export const createSeatScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state, seats } = ctx;
  const t = (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars);
  const { screen, inner } = screenShell({ testId: 'seat' });
  const index = seats.cached();

  const back = el('button', {
    class: 'btn btn--ghost btn--sm',
    text: t('nav.back'),
    attrs: { type: 'button' },
    on: { click: () => ctx.go(state.seat ? 'ready' : 'welcome') },
  });
  inner.append(el('div', { class: 'topbar' }, back, createLangSwitch(i18n)));

  if (!index) {
    inner.append(
      el(
        'div',
        { class: 'card' },
        el('h1', { class: 'section-title', text: t('seat.title') }),
        el('p', { class: 'card__hint', text: t('error.seats') }),
        el('button', {
          class: 'btn btn--primary btn--block',
          text: t('nav.retry'),
          attrs: { type: 'button' },
          on: {
            click: async () => {
              try {
                await seats.load();
                ctx.go('seat');
              } catch {
                ctx.toast(t('error.seats'), 'error');
              }
            },
          },
        }),
      ),
    );
    return { element: screen };
  }

  inner.append(...buildPicker(ctx, index));
  return { element: screen };
};

function buildPicker(ctx: AppContext, index: SeatIndex): HTMLElement[] {
  const { i18n, state, seats } = ctx;
  const t = (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars);

  const initial: Partial<SeatRef> = state.seat ?? {};
  let pick: Partial<SeatRef> = {
    section: initial.section,
    row: initial.row,
    seat: initial.seat,
  };

  const preview = createSeatPreview(index, t('a11y.seatGrid'));
  const confirm = el('button', {
    class: 'btn btn--primary btn--lg btn--block',
    text: t('seat.confirm'),
    attrs: { type: 'button', disabled: true },
  });

  const sectionSelect = el('select', { class: 'select', attrs: { 'aria-label': t('seat.section') } });
  const rowSelect = el('select', { class: 'select', attrs: { 'aria-label': t('seat.row') } });
  const seatSelect = el('select', { class: 'select select--seat', attrs: { 'aria-label': t('seat.number') } });

  const placeholder = (label: string) => el('option', { text: label, attrs: { value: '' } });
  sectionSelect.appendChild(placeholder('—'));
  for (const section of index.sections) {
    sectionSelect.appendChild(el('option', { text: section.id, attrs: { value: section.id } }));
  }

  function valid(): SeatRef | null {
    if (!pick.section || !pick.row || !pick.seat) return null;
    const ref: SeatRef = { section: pick.section, row: pick.row, seat: pick.seat };
    return checkSeat(index, ref).ok ? ref : null;
  }

  function refresh(): void {
    const ref = valid();
    confirm.disabled = !ref;
    if (ref) {
      preview.update({
        ...ref,
        index: checkSeat(index, ref).index,
        key: `${ref.section}-${ref.row}-${ref.seat}`,
        source: 'manual',
      });
    } else {
      preview.update(null);
    }
  }

  function fillRows(): void {
    rowSelect.replaceChildren(placeholder('—'));
    seatSelect.replaceChildren(placeholder('—'));
    seatSelect.disabled = true;
    if (!pick.section) {
      rowSelect.disabled = true;
      refresh();
      return;
    }
    rowSelect.disabled = false;
    for (const row of rowsOfSection(index, pick.section)) {
      rowSelect.appendChild(el('option', { text: String(row.id), attrs: { value: String(row.id) } }));
    }
    if (pick.row && rowOf(index, pick.section, pick.row)) rowSelect.value = String(pick.row);
    else pick.row = undefined;
    fillSeats();
  }

  function fillSeats(): void {
    seatSelect.replaceChildren(placeholder('—'));
    if (!pick.section || !pick.row) {
      seatSelect.disabled = true;
      refresh();
      return;
    }
    seatSelect.disabled = false;
    for (const seat of seatNumbers(index, pick.section, pick.row)) {
      seatSelect.appendChild(el('option', { text: String(seat), attrs: { value: String(seat) } }));
    }
    if (pick.seat && seatNumbers(index, pick.section, pick.row).includes(pick.seat)) {
      seatSelect.value = String(pick.seat);
    } else {
      pick.seat = undefined;
    }
    refresh();
  }

  sectionSelect.addEventListener('change', () => {
    pick = { section: sectionSelect.value || undefined };
    fillRows();
  });
  rowSelect.addEventListener('change', () => {
    pick.row = rowSelect.value ? Number.parseInt(rowSelect.value, 10) : undefined;
    fillSeats();
  });
  seatSelect.addEventListener('change', () => {
    pick.seat = seatSelect.value ? Number.parseInt(seatSelect.value, 10) : undefined;
    refresh();
  });

  if (pick.section) sectionSelect.value = pick.section;
  fillRows();

  confirm.addEventListener('click', () => {
    const ref = valid();
    if (!ref) return;
    const selection = seats.select(ref, 'manual', index);
    if (!selection) {
      ctx.toast(t('problem.seatNotFound'), 'error');
      return;
    }
    ctx.saveSeat(selection);
    ctx.go('ready');
  });

  const detected =
    state.seatFromLink && state.seat
      ? el(
          'div',
          { class: 'card card--tight' },
          el(
            'div',
            { class: 'row' },
            el('span', { class: 'pill pill--ok' }, el('span', { class: 'pill__dot' }), t('seat.detected')),
          ),
          el('div', { class: 'seat-summary__seat num', text: state.seat.key }),
        )
      : null;

  const problem = state.seatProblem
    ? el('div', { class: 'pill pill--err', text: t(`problem.${state.seatProblem}`) })
    : null;

  return [
    el(
      'div',
      { class: 'stack' },
      el('h1', { class: 'section-title', text: t('seat.title') }),
      el('p', { class: 'card__hint', text: t('seat.lead') }),
      problem,
      detected,
    ),
    el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'form-grid' },
        el('label', { class: 'field' }, el('span', { class: 'field__label', text: t('seat.section') }), sectionSelect),
        el('label', { class: 'field' }, el('span', { class: 'field__label', text: t('seat.row') }), rowSelect),
        el('label', { class: 'field' }, el('span', { class: 'field__label', text: t('seat.number') }), seatSelect),
      ),
      preview.element,
      confirm,
    ),
    el('p', { class: 'footer-note', text: t('seat.footer') }),
  ];
}
