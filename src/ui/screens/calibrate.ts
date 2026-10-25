import { CALIBRATION } from '../../core/config';
import { encodeCode } from '../../domain/grayCode';
import { startPresenceHeartbeat } from '../../services/presenceClient';
import type { AppContext, ScreenFactory } from '../app';
import { el } from '../dom';

/**
 * Screen 2 — Optical Calibration via Full-Screen Gray Code flashing.
 * - 100% PURE FULL-SCREEN FLASHING LIGHT: No cards or opaque boxes blocking the screen!
 * - High-contrast maximum brightness pulses so the PC camera can easily detect the light.
 * - When the stadium PC camera / admin detects the phone,
 *   the entire screen turns luminous Emerald Green, vibrates, plays the chime,
 *   and transitions to the synchronized show screen.
 */
export const createCalibrateScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state } = ctx;
  const t = (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars);
  const seatIndex = Math.max(0, state.seat?.index ?? 0);
  const code = encodeCode(seatIndex);

  const screen = el('section', {
    class: 'flash',
    attrs: {
      'data-screen': 'calibrate',
      style: 'position: fixed; inset: 0; background: #000; overflow: hidden; touch-action: none; user-select: none;',
    },
  });

  // Full-screen pure optical flashing light layer (100% of display)
  const bitLayer = el('div', {
    class: 'flash__bit',
    attrs: {
      style: 'position: absolute; inset: 0; width: 100vw; height: 100vh; background: #000; transition: background 40ms linear;',
    },
  });

  // Minimal, non-intrusive top cancel button (does NOT block screen light)
  const exitBtn = el('button', {
    class: 'btn btn--ghost btn--sm',
    text: 'إلغاء',
    attrs: {
      type: 'button',
      style:
        'position: absolute; top: calc(var(--safe-top, 12px) + 10px); inset-inline-end: 14px; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.3); color: #fff; border-radius: 9999px; padding: 6px 14px; font-size: 12px; z-index: 10; cursor: pointer;',
    },
    on: { click: () => ctx.go('welcome') },
  });

  // Subtle floating bottom indicator (translucent pill, leaves 95%+ of screen unblocked)
  const liveIndicator = el(
    'div',
    {
      attrs: {
        style:
          'position: absolute; bottom: calc(var(--safe-bottom, 16px) + 16px); inset-inline: 0; margin: 0 auto; width: max-content; max-width: 90vw; background: rgba(0,0,0,0.55); backdrop-filter: blur(8px); padding: 6px 16px; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.25); color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; z-index: 10; pointer-events: none;',
      },
    },
    el('span', { class: 'pill__dot', attrs: { style: 'background: #00ff66; box-shadow: 0 0 10px #00ff66;' } }),
    el('span', { attrs: { style: 'font-weight: 600;' }, text: 'الوميض نشط · وجه الشاشة نحو كاميرا الحاسوب' }),
  );



  const seatSummaryMeta = el('span', {
    class: 'seat-summary__meta num',
    attrs: { style: 'color: #fff; font-weight: 700; font-size: 1.05rem;' },
    text: state.seat
      ? `${state.seat.section} · ${t('seat.row')} ${state.seat.row} · ${t('seat.number')} ${state.seat.seat}`
      : 'المدرج العام',
  });

  const successHud = el(
    'div',
    {
      class: 'flash__hud stack hidden',
      attrs: {
        style:
          'position: relative; z-index: 20; max-width: 360px; text-align: center; border-color: rgba(212, 175, 55, 0.6); box-shadow: 0 20px 50px rgba(0,0,0,0.8); background: rgba(5,7,10,0.92);',
      },
    },
    el('img', {
      attrs: {
        src: '/icons/rayati_mark.svg',
        alt: 'Rayti',
        style: 'width: 64px; height: 64px; margin: 0 auto 10px; display: block; filter: drop-shadow(0 4px 18px rgba(0, 168, 89, 0.5));',
      },
    }),
    el('h2', {
      class: 'card__title',
      text: 'تم التقاط وتأكيد الهاتف بنجاح',
      attrs: { style: 'color: #D4AF37; font-size: 1.25rem; margin-top: 8px;' },
    }),
    el('p', {
      text: 'التقطت كاميرا الحاسوب ضوء هاتفك وتم تثبيت موقعك في التيفو المتزامن.',
      attrs: { style: 'color: rgba(255,255,255,0.85); font-size: 0.85rem;' },
    }),
    el(
      'div',
      {
        class: 'seat-summary',
        attrs: {
          style:
            'background: rgba(10,125,62,0.25); justify-content: center; border-color: rgba(18,194,98,0.4); padding: 10px 16px; margin-block: 8px;',
        },
      },
      seatSummaryMeta,
    ),
    el('button', {
      class: 'btn btn--primary btn--lg btn--block',
      text: 'المتابعة إلى شاشة التيفو المتزامن',
      attrs: { type: 'button', style: 'background: #D4AF37; color: #05070A; font-weight: 800; padding: 12px;' },
      on: { click: () => ctx.go('ready') },
    }),
  );

  screen.append(bitLayer, exitBtn, liveIndicator, successHud);

  let raf = 0;
  let start = 0;
  const cycleMs = code.bits.length * CALIBRATION.bitMs + CALIBRATION.gapMs;
  let isCompleted = false;
  let stopHeartbeat: (() => void) | null = null;
  let autoNavigateTimer = 0;

  function playSuccessFeedback(): void {
    // 1. Haptic vibration
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([100, 60, 100, 60, 240]);
      } catch {
        // Ignore vibration errors
      }
    }

    // 2. Uplifting web audio chime (C5 -> E5 -> G5)
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const actx = new AudioCtx();
        const now = actx.currentTime;
        const playTone = (freq: number, startOffset: number, duration: number) => {
          const osc = actx.createOscillator();
          const gain = actx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + startOffset);
          gain.gain.setValueAtTime(0.001, now + startOffset);
          gain.gain.exponentialRampToValueAtTime(0.2, now + startOffset + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
          osc.connect(gain);
          gain.connect(actx.destination);
          osc.start(now + startOffset);
          osc.stop(now + startOffset + duration + 0.05);
        };
        playTone(523.25, 0.0, 0.18); // C5
        playTone(659.25, 0.12, 0.22); // E5
        playTone(783.99, 0.26, 0.4); // G5
      }
    } catch {
      // Audio not permitted or unsupported, continue silently
    }
  }

  function showSuccess(): void {
    if (isCompleted) return;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    isCompleted = true;

    // Fallback seat if needed
    if (!state.seat) {
      const cached = ctx.seats.cached();
      if (cached) {
        const sel = ctx.seats.select({ section: 'A', row: 1, seat: 1 }, 'manual', cached);
        if (sel) state.seat = sel;
      }
    }

    if (state.seat) {
      seatSummaryMeta.textContent = `${state.seat.section} · ${t('seat.row')} ${state.seat.row} · ${t('seat.number')} ${state.seat.seat}`;
    }

    // Turn screen luminous Emerald Green (#0A7D3E)
    bitLayer.style.background = '#0A7D3E';
    screen.style.background = '#0A7D3E';

    exitBtn.classList.add('hidden');
    liveIndicator.classList.add('hidden');
    successHud.classList.remove('hidden');

    playSuccessFeedback();

    // Auto-proceed to ready screen after 3.5 seconds
    autoNavigateTimer = window.setTimeout(() => {
      ctx.go('ready');
    }, 3500);
  }

  function loop(): void {
    if (isCompleted) return;
    const elapsed = performance.now() - start;

    const position = elapsed % cycleMs;
    const inCode = position < code.bits.length * CALIBRATION.bitMs;
    const bit = inCode ? code.bits[Math.floor(position / CALIBRATION.bitMs)] === 1 : false;

    // High brightness flashing
    if (bit) {
      bitLayer.style.background = '#FFFFFF';
      screen.style.background = '#FFFFFF';
    } else {
      bitLayer.style.background = '#000000';
      screen.style.background = '#000000';
    }

    raf = requestAnimationFrame(loop);
  }

  function startCalibration(): void {
    if (raf) cancelAnimationFrame(raf);
    isCompleted = false;
    screen.style.background = '#000';
    bitLayer.style.background = '#000';
    exitBtn.classList.remove('hidden');
    liveIndicator.classList.remove('hidden');
    successHud.classList.add('hidden');

    start = performance.now();
    raf = requestAnimationFrame(loop);

    // Continuous presence heartbeat listening for PC camera validation
    stopHeartbeat?.();
    stopHeartbeat = startPresenceHeartbeat(
      () => state.seat,
      (validatedSeat) => {
        state.seat = validatedSeat;
        showSuccess();
      },
    );
  }

  return {
    element: screen,

    onEnter() {
      void ctx.wakeLock.request(1500);
      startCalibration();
    },

    onExit() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (autoNavigateTimer) clearTimeout(autoNavigateTimer);
      stopHeartbeat?.();
      stopHeartbeat = null;
      void ctx.wakeLock.release();
    },
  };
};
