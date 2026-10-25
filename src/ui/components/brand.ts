import { el } from '../dom';
import type { I18n } from '../../services/i18n';

/** Wordmark + brand logo. */
export function createBrand(i18n: I18n, options: { withWord?: boolean } = {}): HTMLElement {
  const mark = el('img', {
    attrs: {
      src: '/icons/rayati_mark.svg',
      alt: i18n.t('a11y.logo') || 'Rayti',
      style: 'width: 48px; height: 48px; object-fit: contain;',
    },
  });
  if (options.withWord === false) return el('div', { class: 'brand' }, mark);
  return el(
    'div',
    { class: 'brand', attrs: { style: 'display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 18px;' } },
    mark,
    el(
      'div',
      { class: 'brand__word', attrs: { style: 'text-align: start;' } },
      el('div', { attrs: { style: 'font-weight: 900; font-size: 1.35rem; color: #0F172A; line-height: 1.1;' }, text: 'رايتي · RAYTI' }),
      el('div', { attrs: { style: 'font-size: 10px; color: #008B7A; font-weight: 800; letter-spacing: 0.08em;' }, text: 'STADIUM LIGHT SHOW & TIFO' }),
    ),
  );
}
