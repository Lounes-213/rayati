import { formatClock } from '../../domain/colorFrame';
import type { AppContext, ScreenFactory } from '../app';
import { createLangSwitch } from '../components/langSwitch';
import { createSeatPreview } from '../components/seatPreview';
import { el, screenShell } from '../dom';

/**
 * Screen 3 — Ready. Everything a fan must do before the whistle, in this order:
 * confirm the seat, raise the brightness, sync the clock, optionally arm the
 * torch, and make sure the show file is already on the phone.
 */
export const createReadyScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state, clock } = ctx;
  const t = (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars);
  const { screen, inner } = screenShell({ testId: 'ready' });

  const back = el('button', {
    class: 'btn btn--ghost btn--sm',
    text: t('nav.back'),
    attrs: { type: 'button' },
    on: { click: () => ctx.go('welcome') },
  });
  inner.append(el('div', { class: 'topbar' }, back, createLangSwitch(i18n)));

  if (!state.seat || state.seat.index < 0) {
    inner.append(
      el(
        'div',
        { class: 'card' },
        el('h1', { class: 'section-title', text: t('seat.title') }),
        el('p', { class: 'card__hint', text: t('seat.lead') }),
        el('button', {
          class: 'btn btn--primary btn--block',
          text: t('seat.pick'),
          attrs: { type: 'button' },
          on: { click: () => ctx.go('seat') },
        }),
      ),
    );
    return { element: screen };
  }

  /* ---------------------------------------------------------------- seat */
  const seatCard = el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'row row--between' },
      el('span', { class: 'card__title', text: t('ready.seatLabel') }),
      el('span', { class: 'pill pill--ok' }, el('span', { class: 'pill__dot' }), state.seat.key),
    ),
    el(
      'div',
      { class: 'seat-summary' },
      el('span', { class: 'seat-summary__seat num', text: state.seat.key }),
      el(
        'span',
        { class: 'seat-summary__meta' },
        `${t('seat.section')} ${state.seat.section} · ${t('seat.row')} ${state.seat.row} · ${t('seat.number')} ${state.seat.seat}`,
      ),
    ),
    el('button', {
      class: 'btn btn--secondary btn--block',
      text: t('welcome.changeSeat'),
      attrs: { type: 'button' },
      on: { click: () => ctx.go('seat') },
    }),
  );

  const preview = ctx.seats.cached() ? createSeatPreview(ctx.seats.cached()!, t('a11y.seatGrid')) : null;
  preview?.update(state.seat);
  if (preview) seatCard.insertBefore(preview.element, seatCard.lastElementChild);

  /* ---------------------------------------------------------------- sync */
  const syncPill = el('span', { class: 'pill' });
  const syncOffset = el('span', { class: 'muted num' });
  const syncCard = el(
    'div',
    { class: 'card' },
    el('h2', { class: 'card__title', text: t('ready.sync') }),
    el('div', { class: 'row row--between' }, syncPill, syncOffset),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'btn btn--secondary btn--sm',
        text: t('nav.retry'),
        attrs: { type: 'button' },
        on: {
          click: async () => {
            syncPill.textContent = t('ready.syncChecking');
            const result = await clock.sync();
            ctx.toast(
              result.samples > 0 ? t('ready.syncOk') : t('ready.syncFailed'),
              result.samples > 0 ? 'success' : 'error',
            );
            update();
          },
        },
      }),
      el('button', {
        class: 'btn btn--ghost btn--sm num',
        text: '−100 ms',
        attrs: { type: 'button' },
        on: { click: () => (clock.setManualOffset(clock.state().offsetMs - 100), update()) },
      }),
      el('button', {
        class: 'btn btn--ghost btn--sm num',
        text: '+100 ms',
        attrs: { type: 'button' },
        on: { click: () => (clock.setManualOffset(clock.state().offsetMs + 100), update()) },
      }),
    ),
    el('p', { class: 'card__hint', text: t('app.tagline') }),
  );

  /* ---------------------------------------------------------- brightness */
  const brightnessCard = el(
    'div',
    { class: 'card' },
    el('h2', { class: 'card__title', text: `☀ ${t('ready.brightness.title')}` }),
    el('p', { class: 'card__hint', text: t('ready.brightness.text') }),
  );

  /* --------------------------------------------------------------- torch */
  const torchCard = isAndroidBrowser() ? buildTorchCard(ctx) : null;

  /* ------------------------------------------------------------- preload */
  const progressBar = el('div', { class: 'progress__bar' });
  const progressText = el('span', { class: 'card__hint' });
  const progressWrap = el('div', { class: 'progress__track' }, progressBar);
  const preloadCard = el(
    'div',
    { class: 'card' },
    el('h2', { class: 'card__title', text: t('ready.preload.title') }),
    el('div', { class: 'progress', attrs: { role: 'progressbar', 'aria-label': t('a11y.progress') } }, progressWrap, progressText),
  );

  /* ----------------------------------------------------------- countdown */
  const countdownValue = el('div', { class: 'seat-summary__seat num', text: '--:--' });
  const statsLine = el('span', { class: 'muted' });
  const expiredPill = el('span', { class: 'pill pill--warn hidden', text: t('ready.expired') });
  const countdownCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'row row--between' }, el('h2', { class: 'card__title', text: t('ready.countdown.title') }), expiredPill),
    countdownValue,
    statsLine,
  );

  /* --------------------------------------------------------------- start */
  const startButton = el('button', {
    class: 'btn btn--primary btn--lg btn--block',
    text: t('ready.start'),
    attrs: { type: 'button', 'data-action': 'start-show' },
    on: { click: () => ctx.go('show') },
  });

  const calibrateButton = el('button', {
    class: 'linkish',
    text: t('ready.calibrate'),
    attrs: { type: 'button' },
    on: { click: () => ctx.go('calibrate') },
  });

  function update(): void {
    // sync
    const sync = clock.state();
    syncPill.className = 'pill' + (sync.samples > 0 ? ' pill--ok' : ' pill--warn');
    syncPill.replaceChildren(
      el('span', { class: 'pill__dot' }),
      document.createTextNode(
        sync.source === 'network'
          ? t('ready.syncOk')
          : sync.source === 'manual'
            ? t('ready.syncManual')
            : t('ready.syncDevice'),
      ),
    );
    syncOffset.textContent = `${t('ready.syncOffset', { ms: sync.offsetMs })}${clock.isStale() ? ' · ' + t('ready.syncStale') : ''}`;

    // preload
    const preload = state.preload;
    progressBar.style.width = `${preload.status === 'ready' ? 100 : preload.percent}%`;
    progressWrap.parentElement?.classList.toggle(
      'progress--indeterminate',
      preload.status === 'idle' || preload.status === 'loading',
    );
    progressText.textContent =
      preload.status === 'ready'
        ? t('ready.preload.ready')
        : preload.status === 'failed'
          ? t('ready.preload.failed')
          : preload.status === 'loading'
            ? t('ready.preload.loading', { percent: preload.percent })
            : t('ready.preload.waiting');

    // countdown + stats
    const show = state.show;
    if (show) {
      const startAt = show.meta.startAt;
      const remaining = startAt > 0 ? startAt - clock.now() : -1;
      countdownValue.textContent = remaining > 0 ? formatClock(remaining) : t('ready.countdown.live');
      statsLine.textContent = t('ready.stats', {
        seats: i18n.formatNumber(show.meta.seatCount || show.seatCount),
        colors: show.palette.length - 1,
        duration: formatClock(show.meta.durationMs),
      });
      expiredPill.classList.toggle('hidden', !show.expired);
    } else {
      countdownValue.textContent = '--:--';
      statsLine.textContent = '';
    }
  }

  inner.append(
    el('h1', { class: 'section-title', text: t('ready.title') }),
    el('p', { class: 'card__hint', text: t('ready.lead') }),
    seatCard,
    countdownCard,
    startButton,
    brightnessCard,
    syncCard,
    ...(torchCard ? [torchCard] : []),
    preloadCard,
    el('p', { class: 'footer-note', text: t('show.hint') }),
    calibrateButton,
  );

  let timer = 0;
  update();

  return {
    element: screen,

    async onEnter() {
      update();
      timer = window.setInterval(update, 500);
      ctx.cleanup(() => window.clearInterval(timer));
      // If the file is not cached yet, make sure the request is in flight.
      void ctx.ensureShow();
    },

    onExit() {
      window.clearInterval(timer);
    },
  };
};

/** Android Chromium is the only place where `torch` may exist. Never on iOS. */
function isAndroidBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent) && !/iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function buildTorchCard(ctx: AppContext): HTMLElement {
  const { i18n, torch } = ctx;
  const t = (key: string) => i18n.t(key);
  const status = el('span', { class: 'muted' });
  const toggle = el('button', {
    class: 'btn btn--gold btn--block',
    text: t('ready.torch.enable'),
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const state = ctx.torch.state();
        if (state.status === 'ready' || state.status === 'on') {
          await torch.disable();
          toggle.textContent = t('ready.torch.enable');
          status.textContent = '';
          return;
        }
        const probed = await torch.probe();
        if (probed.status === 'denied') {
          ctx.toast(t('ready.torch.denied'), 'info');
          toggle.classList.add('hidden');
          status.textContent = t('ready.torch.denied');
          return;
        }
        if (probed.status !== 'ready') {
          toggle.classList.add('hidden');
          status.textContent = t('ready.torch.unsupported');
          return;
        }
        await torch.enable();
        toggle.textContent = t('ready.torch.stop');
        status.textContent = t('ready.torch.enabled');
      },
    },
  });

  const card = el(
    'div',
    { class: 'card' },
    el('h2', { class: 'card__title', text: `🔆 ${t('ready.torch.title')}` }),
    el('p', { class: 'card__hint', text: t('ready.torch.text') }),
    toggle,
    status,
  );

  // Reflect a previously enabled torch when coming back from the show.
  const current = ctx.torch.state();
  if (current.status === 'ready' || current.status === 'on') {
    toggle.textContent = t('ready.torch.stop');
    status.textContent = t('ready.torch.enabled');
  }
  return card;
}
