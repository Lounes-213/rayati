import type { AppContext, ScreenFactory } from '../app';
import { createLangSwitch } from '../components/langSwitch';
import { createSeatPreview } from '../components/seatPreview';
import { el, screenShell } from '../dom';

/**
 * Screen 2 — Seat Confirmation.
 * Strictly driven by the QR code scanned on the seat backrest.
 * Manual seat changing is completely removed to protect the tifo choreography.
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

  const brandLogo = el(
    'div',
    { attrs: { style: 'display: flex; align-items: center; gap: 10px;' } },
    el('img', {
      attrs: {
        src: '/icons/rayati_mark.svg',
        alt: 'Rayti',
        style: 'width: 34px; height: 34px; object-fit: contain;',
      },
    }),
    el(
      'div',
      {},
      el('div', {
        attrs: { style: 'font-weight: 900; font-size: 1.15rem; color: #0F172A; line-height: 1.1;' },
        text: 'رايتي · RAYTI',
      }),
      el('div', {
        attrs: { style: 'font-size: 9px; color: #008B7A; font-weight: 800; letter-spacing: 0.05em;' },
        text: 'STADIUM LIGHT SHOW',
      }),
    ),
  );

  inner.append(el('div', { class: 'topbar' }, back, brandLogo, createLangSwitch(i18n)));

  if (state.seat && state.seat.index >= 0) {
    const preview = index ? createSeatPreview(index, t('a11y.seatGrid')) : null;
    preview?.update(state.seat);

    inner.append(
      el(
        'div',
        { class: 'card', attrs: { style: 'background: var(--c-surface); border-radius: var(--r-lg);' } },
        el(
          'div',
          { class: 'row row--between', attrs: { style: 'margin-bottom: 8px;' } },
          el('h1', { class: 'card__title', text: 'تم تأكيد موقع مقعدك' }),
          el('span', { class: 'pill pill--ok' }, 'مسح رمز QR'),
        ),
        el(
          'div',
          { class: 'seat-summary', attrs: { style: 'margin-block: 12px;' } },
          el('span', { class: 'seat-summary__seat num', text: state.seat.key }),
          el(
            'span',
            { class: 'seat-summary__meta' },
            `المدرج ${state.seat.section} · الصف ${state.seat.row} · المقعد ${state.seat.seat}`,
          ),
        ),
        preview ? preview.element : el('div'),
        el('button', {
          class: 'btn btn--primary btn--block',
          text: 'الانتقال إلى شاشة العرض المباشر',
          attrs: { type: 'button', style: 'margin-top: 14px; border-radius: var(--r-full); font-weight: 700;' },
          on: { click: () => ctx.go('ready') },
        }),
      ),
    );
    return { element: screen };
  }

  // No seat scanned yet
  inner.append(
    el(
      'div',
      { class: 'card', attrs: { style: 'background: var(--c-surface); border-radius: var(--r-lg); text-align: center; padding: 24px;' } },
      el('img', {
        attrs: {
          src: '/icons/rayati_mark.svg',
          alt: 'Rayti',
          style: 'width: 64px; height: 64px; margin: 0 auto 14px; display: block; object-fit: contain;',
        },
      }),
      el('h1', { class: 'card__title', text: 'تحديد المقعد عبر رمز QR حصرياً' }),
      el('p', {
        class: 'card__hint',
        text: 'لضمان دقة وتطابق ألوان التيفو في الملعب، يتم تحديد مقعدك حصرياً عن طريق مسح رمز QR الملصق على ظهر كرسيك بكاميرا الهاتف.',
        attrs: { style: 'line-height: 1.6; margin-block: 10px;' },
      }),
      el('button', {
        class: 'btn btn--primary btn--block',
        text: 'العودة إلى الصفحة الرئيسية',
        attrs: { type: 'button', style: 'border-radius: var(--r-full); font-weight: 700; margin-top: 8px;' },
        on: { click: () => ctx.go('welcome') },
      }),
    ),
  );

  return { element: screen };
};
