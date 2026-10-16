import { CALIBRATION } from '../../core/config';
import { encodeCode } from '../../domain/grayCode';
import { startPresenceHeartbeat } from '../../services/presenceClient';
import type { AppContext, ScreenFactory } from '../app';
import { el } from '../dom';

/**
 * Screen 2 — Optical Calibration via Gray Code flashing.
 * - ZERO user phone camera: phones only display flashing optical codes.
 * - The phone blinks Gray Code and sends continuous heartbeats.
 * - When the stadium PC camera / admin detects and validates the phone,
 *   it triggers an emerald green flash, haptic vibration, celebratory chime,
 *   and transitions to the synchronized show screen.
 */
export const createCalibrateScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state } = ctx;
  const t = (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars);
  const seatIndex = Math.max(0, state.seat?.index ?? 0);
  const code = encodeCode(seatIndex);

  const screen = el('section', { class: 'flash', attrs: { 'data-screen': 'calibrate' } });
  const bitLayer = el('div', { class: 'flash__bit' });

  // Progress pulse animation ring
  const radarWave = el('div', {
    attrs: {
      style:
        'width: 54px; height: 54px; border-radius: 50%; border: 3px solid var(--c-gold); margin: 0 auto; animation: pulse-radar 1.5s infinite ease-out;',
    },
  });

  // Active calibration HUD
  const hud = el(
    'div',
    { class: 'flash__hud stack', attrs: { style: 'max-width: 380px; text-align: center;' } },
    radarWave,
    el('div', {
      class: 'card__title',
      text: '📡 كاميرا المنصة تقوم بمسح المدرج...',
      attrs: { style: 'color: #fff; font-size: 1.15rem; margin-top: 8px;' },
    }),
    el('p', {
      text: 'ارفع هاتفك أمامك ووجه الشاشة نحو الميدان لتلتقط كاميرا المنصة موقعك تلقائياً عبر شفرة غراي.',
      attrs: { style: 'font-size: 0.85rem; color: rgba(255,255,255,0.8); line-height: 1.4;' },
    }),
    el('div', { class: 'flash__code', text: code.bits.join(' ') }),
    el(
      'div',
      {
        attrs: {
          style:
            'display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.8rem; color: var(--c-gold); font-family: var(--font-num); background: rgba(0,0,0,0.5); padding: 6px 12px; border-radius: var(--r-full); border: 1px solid rgba(212,175,55,0.3);',
        },
      },
      el('span', { class: 'pill__dot', attrs: { style: 'background: var(--c-gold); box-shadow: 0 0 8px var(--c-gold);' } }),
      'بانتظار تأكيد كاميرا المنصة (Live CV)',
    ),
    el('button', {
      class: 'btn btn--secondary btn--sm btn--block',
      text: '✕ إلغاء والعودة للرئيسية',
      attrs: { type: 'button', style: 'margin-top: 10px;' },
      on: { click: () => ctx.go('welcome') },
    }),
  );

  // Success Confirmation HUD (Emerald Green Confirmation)
  const checkSvg = `
    <svg width="68" height="68" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin: 0 auto; display: block; filter: drop-shadow(0 4px 16px rgba(0,0,0,0.4));">
      <circle cx="32" cy="32" r="30" fill="#D4AF37" stroke="#FFFFFF" stroke-width="3"/>
      <path d="M20 32.5L28.5 41L44 24" stroke="#05070A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

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
          'max-width: 360px; text-align: center; border-color: rgba(212, 175, 55, 0.6); box-shadow: 0 20px 50px rgba(0,0,0,0.8); background: rgba(5,7,10,0.92);',
      },
    },
    el('div', { html: checkSvg }),
    el('h2', {
      class: 'card__title',
      text: '✅ تم التعرف وتأكيد المقعد بنجاح 🇩🇿',
      attrs: { style: 'color: #D4AF37; font-size: 1.25rem; margin-top: 8px;' },
    }),
    el('p', {
      text: 'التقطت كاميرا المنصة إشارة هاتفك بدقة، وأصبح جهازك بكسلاً نشطاً في التيفو المتزامن.',
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
      text: 'المتابعة إلى شاشة التيفو المتزامن 🚀',
      attrs: { type: 'button', style: 'background: #D4AF37; color: #05070A; font-weight: 800; padding: 12px;' },
      on: { click: () => ctx.go('ready') },
    }),
  );

  screen.append(bitLayer, hud, successHud);

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

    hud.classList.add('hidden');
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
    bitLayer.classList.toggle('flash__bit--on', bit);

    raf = requestAnimationFrame(loop);
  }

  function startCalibration(): void {
    if (raf) cancelAnimationFrame(raf);
    isCompleted = false;
    screen.style.background = '#000';
    bitLayer.style.background = '';
    bitLayer.classList.remove('flash__bit--on');
    hud.classList.remove('hidden');
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
