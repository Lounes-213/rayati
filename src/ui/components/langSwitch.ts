import { el } from '../dom';
import { LANGS, LANG_LABELS, type I18n } from '../../services/i18n';
import type { Lang } from '../../core/types';

/**
 * Minimal language switch showing ONLY the currently selected language as a pill.
 * Zero icons. Clicking cycles to the next language: ar -> fr -> en -> ar.
 */
export function createLangSwitch(i18n: I18n): HTMLElement {
  const currentLang = i18n.lang();

  const button = el('button', {
    class: 'lang__active-btn',
    text: LANG_LABELS[currentLang],
    attrs: {
      type: 'button',
      'aria-label': i18n.t('a11y.langSwitch'),
      title: LANG_LABELS[currentLang],
    },
    on: {
      click: () => {
        const nextIdx = (LANGS.indexOf(i18n.lang()) + 1) % LANGS.length;
        const nextLang = LANGS[nextIdx] as Lang;
        i18n.setLang(nextLang);
        button.textContent = LANG_LABELS[nextLang];
      },
    },
  });

  return button;
}

