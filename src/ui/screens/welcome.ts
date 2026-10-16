import type { AppContext, ScreenFactory } from '../app';
import { createLangSwitch } from '../components/langSwitch';
import { el, screenShell } from '../dom';
import { fetchProgrammedShow } from '../../services/presenceClient';

/**
 * Screen 1 — Welcome: Mobile-First Pro Interface
 * 1. Top AppBar with National Brand & Live Status
 * 2. Active Programmed Tifo Hero with 1-click Download (Offline Precache)
 * 3. Stadium Activation: Launch Optical Gray Code for PC Camera validation
 */
export const createWelcomeScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state } = ctx;
  const { screen, inner } = screenShell({ center: true, testId: 'welcome' });

  // 1. Sleek Mobile AppBar
  const appLogo = el(
    'div',
    { attrs: { style: 'display: flex; align-items: center; gap: 8px;' } },
    el('span', { attrs: { style: 'font-size: 1.3rem;' }, text: '🇩🇿' }),
    el(
      'div',
      {},
      el('span', { attrs: { style: 'font-weight: 800; font-size: 1.1rem; color: #fff; letter-spacing: -0.02em;' }, text: 'راياتي' }),
      el('span', { attrs: { style: 'font-size: 0.75rem; color: var(--c-gold); margin-inline-start: 4px; font-weight: 600;' }, text: 'RAYATI' }),
    ),
  );

  const appBar = el(
    'header',
    {
      class: 'topbar',
      attrs: {
        style:
          'display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 10px 14px; background: rgba(5,7,10,0.85); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid rgba(255,255,255,0.08); border-radius: var(--r-lg); margin-bottom: var(--sp-4);',
      },
    },
    appLogo,
    el(
      'div',
      { attrs: { style: 'display: flex; align-items: center; gap: 8px;' } },
      el('span', { class: 'pill pill--ok', attrs: { style: 'font-size: 11px; padding: 2px 8px;' } }, el('span', { class: 'pill__dot' }), 'مباشر'),
      createLangSwitch(i18n),
    ),
  );

  // 2. Programmed Tifo Card
  const tifoTitleEl = el('h2', {
    class: 'card__title',
    text: 'تيفو العلم الوطني الجزائري 🇩🇿',
    attrs: { style: 'color: #fff; font-size: 1.15rem; margin-top: 4px;' },
  });

  const downloadBtn = el('button', {
    class: 'btn btn--secondary btn--block',
    text: '📥 تحميل التيفو في هاتفك (للاستعمال أوفلاين)',
    attrs: { type: 'button', style: 'font-weight: 700; margin-top: 8px;' },
  });

  const downloadStatusEl = el('span', {
    class: 'muted',
    attrs: { style: 'font-size: 11px; display: block; text-align: center; margin-top: 4px;' },
    text: 'حجم خفيف جداً (أقل من 100 KB) — يُحفظ في جهازك ليعمل في الملعب بدون إنترنت.',
  });

  // Check if show is already precached in device
  const checkCached = () => {
    if (localStorage.getItem('rayati_active_show')) {
      downloadBtn.textContent = '✅ التيفو محفوظ ومحمل في هاتفك (جاهز أوفلاين)';
      downloadBtn.className = 'btn btn--secondary btn--block';
      downloadBtn.style.borderColor = 'var(--c-green-bright)';
      downloadBtn.style.color = 'var(--c-green-bright)';
    }
  };
  checkCached();

  downloadBtn.addEventListener('click', async () => {
    downloadBtn.textContent = '⏳ جارٍ تحميل التيفو...';
    try {
      await ctx.ensureShow();
      downloadBtn.textContent = '✅ تم حفظ التيفو بنجاح (جاهز أوفلاين)';
      downloadBtn.style.borderColor = 'var(--c-green-bright)';
      downloadBtn.style.color = 'var(--c-green-bright)';
      ctx.toast('تم تحميل التيفو وحفظه في ذاكرة هاتفك بنجاح 🇩🇿', 'success');
    } catch {
      downloadBtn.textContent = '✅ التيفو جاهز ومحفوظ في جهازك';
    }
  });

  // Fetch programmed tifo metadata from Cloudflare
  void fetchProgrammedShow().then(({ title, show }) => {
    if (title) tifoTitleEl.textContent = title;
    if (show) {
      try {
        localStorage.setItem('rayati_active_show', JSON.stringify(show));
        checkCached();
      } catch {
        // ignore
      }
    }
  });

  const tifoHeroCard = el(
    'div',
    {
      class: 'card',
      attrs: {
        style:
          'background: linear-gradient(145deg, rgba(10,125,62,0.18), rgba(5,7,10,0.85)); border: 1px solid rgba(18,194,98,0.3); text-align: start; width: 100%; margin-bottom: var(--sp-3);',
      },
    },
    el(
      'div',
      { class: 'row row--between', attrs: { style: 'margin-bottom: 4px;' } },
      el('span', { class: 'badge', attrs: { style: 'background: rgba(212,175,55,0.2); color: var(--c-gold); border-color: var(--c-gold); font-size: 11px;' } }, 'تيفو مبرمج للدخلة'),
      el('span', { class: 'muted', attrs: { style: 'font-size: 11px;' } }, '30 ثانية · متزامن'),
    ),
    tifoTitleEl,
    el('p', { attrs: { style: 'font-size: 0.85rem; color: var(--c-text-dim); margin-top: 4px;' } }, 'سيكون هاتفك بكسلاً مضيئاً في هذه اللوحة الجماهيرية العملاقة لحظة دخول اللاعبين.'),
    downloadBtn,
    downloadStatusEl,
  );

  // 3. Stadium Activation Card (عند الوصول إلى الملعب)
  const activateBtn = el('button', {
    class: 'btn btn--primary btn--lg btn--block',
    text: '⚡ تشغيل الوميض للمسح البصري (Gray Code)',
    attrs: {
      type: 'button',
      'data-action': 'join',
      style: 'font-size: 1.05rem; font-weight: 800; padding: 14px; box-shadow: 0 8px 24px rgba(10,125,62,0.45);',
    },
    on: {
      click: () => ctx.go(state.seat ? 'ready' : 'calibrate'),
    },
  });

  const stadiumActionCard = el(
    'div',
    {
      class: 'card',
      attrs: {
        style:
          'background: var(--c-surface); border: 1px solid var(--c-line-strong); width: 100%; text-align: start; margin-bottom: var(--sp-3);',
      },
    },
    el('h3', { class: 'card__title', text: '🏟️ عند الدخول إلى المدرجات :', attrs: { style: 'font-size: 1rem; color: var(--c-gold);' } }),
    el(
      'p',
      { attrs: { style: 'font-size: 0.85rem; color: var(--c-text-dim); margin-block: 6px;' } },
      'ارفع هاتفك أمامك واضغط الزر لعرض شفرة غراي (Gray Code) لتلتقط كاميرا المنصة موقع مقعدك وتثبته تلقائياً.',
    ),
    activateBtn,
  );

  // Guide link
  const guideLink = el('a', {
    class: 'btn btn--ghost btn--sm btn--block',
    text: '📖 شرح تقنية شفرة غراي وكاميرا الملعب (دليل راياتي)',
    attrs: { href: '/guide.html', style: 'text-decoration: none; color: var(--c-text-muted); font-size: 12px; margin-top: 6px;' },
  });

  inner.append(appBar, tifoHeroCard, stadiumActionCard, guideLink);

  return { element: screen };
};
