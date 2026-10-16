import { LIMITS } from '../../core/config';
import { formatClock, isTorchFrame } from '../../domain/colorFrame';
import { indexAt } from '../../domain/showTimeline';
import { createShowEngine, type FrameContext, type ShowEngine } from '../../services/showEngine';
import type { AppContext, ScreenFactory } from '../app';
import { el } from '../dom';
import { createHoldButton } from '../components/holdButton';

/**
 * Screen 4 — Show. Nothing but colour on screen: no buttons to fat-finger,
 * a wake lock so the phone does not sleep, and a 1.2 s hold to leave.
 */
export const createShowScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state } = ctx;
  const t = (key: string) => i18n.t(key);

  const colorLayer = el('div', { class: 'show__color' });
  const hint = el('p', { class: 'show__hint', text: t('show.hint') });
  const countNum = el('div', { class: 'show__count-num num', text: '--:--' });
  const countTitle = el('div', { class: 'show__count-title', text: t('ready.countdown.title') });
  const countdown = el('div', { class: 'show__count' }, countTitle, countNum);
  const element = el('div', { class: 'show', attrs: { 'data-screen': 'show' } }, colorLayer, hint, countdown);

  let engine: ShowEngine | null = null;
  let torchLive = false;
  let lastIndex = -1;
  let exited = false;

  const exit = createHoldButton({
    label: t('show.hold'),
    holdMs: LIMITS.exitHoldMs,
    onHold: () => {
      if (exited) return;
      exited = true;
      ctx.go('ready');
    },
  });
  element.appendChild(exit.element);

  /** Block every accidental interaction: taps, long press, pinch, context menu. */
  const swallow = (event: Event) => {
    if (event.target === exit.element || exit.element.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  for (const type of ['click', 'dblclick', 'contextmenu', 'selectstart', 'touchmove'] as const) {
    element.addEventListener(type, swallow, { passive: false });
  }

  function onFrame(frame: FrameContext): void {
    const show = state.show!;
    const seat = state.seat!;
    const colorIndex = indexAt(show, seat.index, frame.elapsedMs);
    if (colorIndex !== lastIndex) {
      lastIndex = colorIndex;
      colorLayer.style.backgroundColor = show.palette[colorIndex] ?? '#000000';
      if (torchLive) ctx.torch.set(isTorchFrame(show.paletteRgb, colorIndex));
    }
    if (!frame.started) {
      countNum.textContent = formatClock(frame.startsInMs);
    } else if (countdown.isConnected) {
      countdown.remove();
    }
  }

  return {
    element,

    async onEnter() {
      const show = await ctx.ensureShow();
      if (!show || !state.seat || state.seat.index < 0) {
        ctx.toast(state.seat ? t('error.show') : t('seat.title'), 'error');
        ctx.go('ready');
        return;
      }

      // Immersive mode is best-effort and must NEVER delay the show: a wake-lock
      // request is deferred by the browser while a document is hidden, and a
      // pending fullscreen promise would leave the fans in the dark.
      void ctx.fullscreen.enter(element).then((full) => {
        if (!full && ctx.fullscreen.supported) ctx.toast(t('error.fullscreen'), 'info', 3000);
      });
      void ctx.wakeLock.request(1500).then((awake) => {
        if (!awake) ctx.toast(t('error.wakeLock'), 'info', 3000);
      });

      if (ctx.torch.state().status === 'ready' || ctx.torch.state().status === 'on') {
        await ctx.torch.enable();
        torchLive = ctx.torch.state().status === 'ready' || ctx.torch.state().status === 'on';
      }

      // The hint disappears after a few seconds: it is guidance, not chrome.
      const hintTimer = window.setTimeout(() => hint.remove(), LIMITS.hintMs);
      ctx.cleanup(() => window.clearTimeout(hintTimer));

      engine = createShowEngine({
        show,
        clock: ctx.clock,
        catchUp: true,
        onFrame,
        onEnd: () => {
          if (exited) return;
          exited = true;
          ctx.go('done');
        },
      });
      engine.start();

      // Contract with the engine: keep it fresh when coming back from background.
      const onVisible = () => {
        if (document.visibilityState === 'visible') void ctx.wakeLock.request(1500);
      };
      document.addEventListener('visibilitychange', onVisible);
      ctx.cleanup(() => document.removeEventListener('visibilitychange', onVisible));
    },

    onExit() {
      engine?.stop();
      engine = null;
      ctx.torch.set(false);
      void ctx.torch.disable();
      void ctx.wakeLock.release();
      void ctx.fullscreen.exit();
      torchLive = false;
    },
  };
};
