import type { AppContext, ScreenFactory } from '../app';
import { createBrand } from '../components/brand';
import { createLangSwitch } from '../components/langSwitch';
import { el, screenShell } from '../dom';

/** Screen 1 — Welcome: the logo, the promise, one big button. */
export const createWelcomeScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state } = ctx;
  const t = (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars);
  const { screen, inner } = screenShell({ center: true, testId: 'welcome' });

  const steps = el(
    'ol',
    { class: 'steps' },
    ...[t('welcome.how.1'), t('welcome.how.2'), t('welcome.how.3')].map((text, index) =>
      el(
        'li',
        { class: 'step' },
        el('span', { class: 'step__num', text: String(index + 1) }),
        el('span', { class: 'step__text', text }),
      ),
    ),
  );

  const join = el('button', {
    class: 'btn btn--primary btn--lg btn--block',
    text: t('welcome.join'),
    attrs: { type: 'button', 'data-action': 'join' },
    on: { click: () => ctx.go(state.seat ? 'ready' : 'calibrate') },
  });

  const manualPick = el('button', {
    class: 'linkish',
    text: t('welcome.manualPick'),
    attrs: { type: 'button' },
    on: { click: () => ctx.go('seat') },
  });

  const saved =
    state.seat && state.seat.index >= 0
      ? el(
          'div',
          { class: 'card card--tight' },
          el(
            'div',
            { class: 'row row--between' },
            el('span', { class: 'pill pill--ok' }, el('span', { class: 'pill__dot' }), t('ready.seatLabel')),
            el('span', { class: 'num', text: state.seat.key }),
          ),
          el('button', {
            class: 'btn btn--secondary btn--block',
            text: t('welcome.changeSeat'),
            attrs: { type: 'button' },
            on: { click: () => ctx.go('seat') },
          }),
        )
      : null;

  inner.append(
    el('div', { class: 'topbar' }, el('span', { class: 'badge', text: t('welcome.badge') }), createLangSwitch(i18n)),
    createBrand(i18n),
    el(
      'div',
      { class: 'hero' },
      el('h1', { class: 'hero__title', text: t('welcome.title') }),
      el('p', { class: 'hero__lead', text: t('welcome.lead') }),
    ),
    join,
    saved ?? manualPick,
    el('a', {
      class: 'btn btn--secondary btn--block',
      text: `📖 ${t('welcome.guideBtn')}`,
      attrs: { href: '/guide.html', style: 'text-decoration: none;' },
    }),
    saved ?? el('div', { class: 'chip-row' }, el('span', { class: 'pill', text: t('welcome.offline') }), el('span', { class: 'pill', text: t('app.tagline') })),
    el('div', { class: 'card' }, el('h2', { class: 'card__title', text: t('welcome.how.title') }), steps),
    el(
      'p',
      { class: 'footer-note' },
      t('welcome.privacy'),
      el('br'),
      t('app.pitch'),
    ),
  );

  return { element: screen };
};
