import type { AppContext, ScreenFactory } from '../app';
import { createBrand } from '../components/brand';
import { append, el, screenShell } from '../dom';
import { shareContent } from '../../services/share';

/** Screen 5 — Done: thanks + share, the only viral loop of the product. */
export const createDoneScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state } = ctx;
  const t = (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars);
  const { screen, inner } = screenShell({ center: true, testId: 'done' });

  const share = el('button', {
    class: 'btn btn--primary btn--lg btn--block',
    text: t('done.share'),
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const outcome = await shareContent({
          title: `رايتي · Rayti`,
          text: t('done.shareText'),
          url: location.origin + location.pathname,
        });
        if (outcome === 'copied') ctx.toast(t('done.shareText'), 'success');
        if (outcome === 'unavailable') ctx.toast(t('error.generic'), 'error');
      },
    },
  });

  append(inner, [
    createBrand(i18n),
    el(
      'div',
      { class: 'hero' },
      el('h1', { class: 'hero__title', text: t('done.title') }),
      el('p', { class: 'hero__lead', text: t('done.lead') }),
    ),
    state.seat
      ? el(
          'div',
          { class: 'seat-summary' },
          el('span', { class: 'seat-summary__seat', text: state.seat.key }),
          el('span', { class: 'seat-summary__meta', text: state.seat.section }),
        )
      : null,
    share,
    el(
      'div',
      { class: 'stack' },
      el('button', {
        class: 'btn btn--secondary btn--block',
        text: t('done.again'),
        attrs: { type: 'button' },
        on: { click: () => ctx.go('show') },
      }),
      el('button', {
        class: 'btn btn--ghost btn--block',
        text: t('nav.back') || 'العودة إلى الرئيسية',
        attrs: { type: 'button' },
        on: { click: () => ctx.go('welcome') },
      }),
    ),
    el('p', { class: 'footer-note', text: t('welcome.privacy') }),
  ]);

  return { element: screen };
};
