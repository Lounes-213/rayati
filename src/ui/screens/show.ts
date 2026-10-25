import { LIMITS } from '../../core/config';
import { formatClock, isTorchFrame } from '../../domain/colorFrame';
import { indexAt } from '../../domain/showTimeline';
import { createShowEngine, type FrameContext, type ShowEngine } from '../../services/showEngine';
import type { AppContext, ScreenFactory } from '../app';
import { el } from '../dom';
import { createHoldButton } from '../components/holdButton';
import { realtimeSync, type RealtimeCommand } from '../../services/realtimeSync';

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
  const seatPillLogo = el('img', {
    attrs: {
      src: '/icons/rayati_mark.svg',
      alt: 'Rayti',
      style: 'width: 18px; height: 18px; object-fit: contain; display: inline-block;',
    },
  });
  const seatPillText = el('span', { text: state.seat?.key || 'مقعد متصل حياً' });
  const seatPill = el('div', {
    class: 'show__seat-pill',
    attrs: {
      style: 'position: absolute; top: max(16px, env(safe-area-inset-top)); inset-inline-start: 50%; transform: translateX(-50%); background: rgba(5, 7, 10, 0.75); backdrop-filter: blur(14px); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 9999px; padding: 7px 16px; font-size: 12px; font-weight: 800; color: #FFF; display: flex; align-items: center; gap: 8px; z-index: 10; pointer-events: none; box-shadow: 0 8px 30px rgba(0,0,0,0.4);'
    }
  }, seatPillLogo, seatPillText);

  const countTitle = el('div', { class: 'show__count-title', text: t('ready.countdown.title') });
  const countdown = el('div', { class: 'show__count' }, countTitle, countNum);
  const element = el('div', { class: 'show', attrs: { 'data-screen': 'show' } }, colorLayer, hint, seatPill, countdown);

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
      ctx.go('welcome');
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

  let activeColor = '#00A859';

  function onFrame(frame: FrameContext): void {
    const show = state.show;
    const seat = state.seat;
    if (!show || !seat) return;
    const colorIndex = indexAt(show, seat.index, frame.elapsedMs);
    if (colorIndex !== lastIndex) {
      lastIndex = colorIndex;
      activeColor = show.palette[colorIndex] ?? '#00A859';
      colorLayer.style.backgroundColor = activeColor;
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
      // 1. Immediately ensure seat is set (default if none provided)
      if (!state.seat) {
        state.seat = { section: 'VN', row: 12, seat: 35, index: 694, key: 'VN-12-35', source: 'restored' };
      }
      seatPillText.textContent = `المقعد: ${state.seat.key || 'متصل'}`;
      realtimeSync.setSeat(state.seat);

      // Real stadium NxM grid color mapping
      const getSeatColor = (colors: string[], cols = 60, rows = 40): string => {
        if (!colors || colors.length === 0) return '#00A859';
        if (!state.seat) return colors[0] || '#00A859';
        const r = Math.max(1, state.seat.row || 1);
        const s = Math.max(1, state.seat.seat || 1);
        const gridIndex = ((r - 1) % rows) * cols + ((s - 1) % cols);
        if (gridIndex >= 0 && gridIndex < colors.length) {
          return colors[gridIndex] || '#00A859';
        }
        if (typeof state.seat.index === 'number' && state.seat.index >= 0) {
          return colors[state.seat.index % colors.length] || '#00A859';
        }
        return colors[0] || '#00A859';
      };

      // 2. Instantly apply color from realtimeSync state in 0ms!
      const initialCmd = realtimeSync.getLastStateCommand();
      if (initialCmd && initialCmd.type === 'cube_colors' && Array.isArray(initialCmd.colors)) {
        activeColor = getSeatColor(initialCmd.colors, initialCmd.cols || 60, initialCmd.rows || 40);
      } else {
        activeColor = '#00A859';
      }
      colorLayer.style.backgroundColor = activeColor;

      // Immersive mode
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

      const hintTimer = window.setTimeout(() => hint.remove(), LIMITS.hintMs);
      ctx.cleanup(() => window.clearTimeout(hintTimer));

      // Dim seat pill slightly after 4s
      const pillTimer = window.setTimeout(() => {
        seatPill.style.opacity = '0.5';
      }, 4000);
      ctx.cleanup(() => window.clearTimeout(pillTimer));

      // Realtime Multi-Device Sync (WebSocket MQTT sub-30ms)
      const onRealtimeMsg = (cmd: RealtimeCommand) => {
        if (cmd.type === 'beat') {
          if (cmd.effect === 'pulse') {
            colorLayer.style.filter = 'brightness(1.6) saturate(1.3)';
            window.setTimeout(() => {
              colorLayer.style.filter = 'none';
            }, 120);
          } else if (cmd.effect === 'strobe') {
            colorLayer.style.backgroundColor = '#FFFFFF';
            if (torchLive) ctx.torch.set(true);
            window.setTimeout(() => {
              colorLayer.style.backgroundColor = activeColor;
              if (torchLive) ctx.torch.set(false);
            }, 80);
          } else if (cmd.effect === 'blackout_flash') {
            colorLayer.style.backgroundColor = '#000000';
            window.setTimeout(() => {
              colorLayer.style.backgroundColor = activeColor;
            }, 140);
          } else if (cmd.effect === 'color_shift') {
            colorLayer.style.filter = 'hue-rotate(180deg)';
            window.setTimeout(() => {
              colorLayer.style.filter = 'none';
            }, 150);
          }
        } else if (cmd.type === 'cube_colors' && Array.isArray(cmd.colors)) {
          const col = getSeatColor(cmd.colors, cmd.cols || 60, cmd.rows || 40);
          activeColor = col;
          colorLayer.style.backgroundColor = activeColor;
        } else if (cmd.type === 'blackout') {
          colorLayer.style.backgroundColor = '#000000';
          activeColor = '#000000';
        } else if (cmd.type === 'end_show') {
          if (exited) return;
          exited = true;
          ctx.go('done');
        }
      };

      const unsubRealtime = realtimeSync.subscribe(onRealtimeMsg);
      ctx.cleanup(unsubRealtime);

      // Local BroadcastChannel backup
      const controlChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rayati_control') : null;
      const onControlMsg = async (ev: MessageEvent) => {
        if (ev.data?.type === 'show_updated' && ev.data.show) {
          try {
            state.show = ev.data.show;
            const decoded = await ctx.ensureShow();
            if (decoded && engine) {
              engine.stop();
              lastIndex = -1;
              engine = createShowEngine({
                show: decoded,
                clock: ctx.clock,
                catchUp: true,
                onFrame,
                onEnd: () => {
                  // Do not automatically navigate to done. Hold active color until admin ends the show.
                },
              });
              engine.start();
            }
          } catch {
            // ignore
          }
        } else if (ev.data?.type === 'blackout') {
          colorLayer.style.backgroundColor = '#000000';
          activeColor = '#000000';
        } else if (ev.data?.type === 'end_show') {
          if (exited) return;
          exited = true;
          ctx.go('done');
        }
      };
      controlChannel?.addEventListener('message', onControlMsg);
      ctx.cleanup(() => {
        controlChannel?.removeEventListener('message', onControlMsg);
        controlChannel?.close();
      });

      void ctx.ensureShow().then((show) => {
        if (show && !exited && !engine) {
          engine = createShowEngine({
            show,
            clock: ctx.clock,
            catchUp: true,
            onFrame,
            onEnd: () => {
              // Do not automatically navigate to done. Hold active color until admin ends the show.
            },
          });
          engine.start();
        }
      });

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
