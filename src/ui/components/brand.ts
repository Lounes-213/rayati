import { el } from '../dom';
import type { I18n } from '../../services/i18n';
import { createLogoMark } from './logo';

/** Wordmark + pixel-flag logo. */
export function createBrand(i18n: I18n, options: { withWord?: boolean } = {}): HTMLElement {
  const mark = createLogoMark({ title: i18n.t('a11y.logo') });
  if (options.withWord === false) return el('div', { class: 'brand' }, mark);
  return el(
    'div',
    { class: 'brand' },
    mark,
    el(
      'div',
      { class: 'brand__word' },
      el('span', { class: 'brand__ar', text: 'راياتي' }),
      el('span', { class: 'brand__latin', text: 'Rayati' }),
    ),
  );
}
