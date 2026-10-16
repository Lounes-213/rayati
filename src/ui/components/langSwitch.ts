import { el } from '../dom';
import { LANGS, LANG_LABELS, type I18n } from '../../services/i18n';

/** One-tap language switch, always visible in the top bar. */
export function createLangSwitch(i18n: I18n): HTMLElement {
  const group = el('div', {
    class: 'lang',
    attrs: { role: 'group', 'aria-label': i18n.t('a11y.langSwitch') },
  });
  for (const lang of LANGS) {
    const button = el('button', {
      class: 'lang__btn',
      text: LANG_LABELS[lang],
      attrs: {
        type: 'button',
        lang,
        'aria-pressed': String(i18n.lang() === lang),
        title: LANG_LABELS[lang],
      },
      on: { click: () => i18n.setLang(lang) },
    });
    group.appendChild(button);
  }
  return group;
}
