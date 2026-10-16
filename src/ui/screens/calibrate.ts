import { CALIBRATION } from '../../core/config';
import { encodeCode } from '../../domain/grayCode';
import type { AppContext, ScreenFactory } from '../app';
import { el } from '../dom';

/**
 * Phase 2 — Optical Calibration mode with instant green confirmation & haptics.
 * The phone flashes [start bit][Gray seat][parity] at 4 bits/s.
 * Once scanned (or after 2 cycles / 6 seconds), the screen turns vibrant emerald green,
 * triggers haptic vibration and an uplifting audio chime, giving supporters
 * the perceived real-time "Connected!" sensation.
 */
export const createCalibrateScreen: ScreenFactory = (ctx: AppContext) => {
  const { i18n, state } = ctx;
  const t = (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars);
  const seatIndex = Math.max(0, state.seat?.index ?? 0);
  const code = encodeCode(seatIndex);

  const screen = el('section', { class: 'flash', attrs: { 'data-screen': 'calibrate' } });
  const bitLayer = el('div', { class: 'flash__bit' });

  // Progress bar element
  const progressBar = el('div', { class: 'progress__bar', attrs: { style: 'width: 0%' } });
  const progressTrack = el('div', { class: 'progress__track', attrs: { style: 'margin-block: 8px;' } }, progressBar);

  // Active calibration HUD
  const hud = el(
    'div',
    { class: 'flash__hud stack' },
    el('div', { class: 'card__title', text: t('calibrate.title') }),
    el('p', { text: t('calibrate.lead') }),
    el('div', { class: 'flash__code', text: code.bits.join('') }),
    el('div', { class: 'num', text: `${t('calibrate.seat')} #${seatIndex}` }),
    progressTrack,
    el('div', { class: 'muted', text: t('calibrate.scanning') }),
    el('button', {
      class: 'btn btn--secondary btn--sm btn--block',
      text: t('calibrate.stop'),
      attrs: { type: 'button', style: 'margin-top: 8px;' },
      on: { click: () => ctx.go('ready') },
    }),
  );

  // Success Confirmation HUD (Emerald Green Confirmation)
  const checkSvg = `
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin: 0 auto; display: block; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));">
      <circle cx="32" cy="32" r="30" fill="#D4AF37" stroke="#FFFFFF" stroke-width="3"/>
      <path d="M20 32.5L28.5 41L44 24" stroke="#05070A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  const seatSummaryMeta = el('span', {
    class: 'seat-summary__meta num',
    attrs: { style: 'color: #fff; font-weight: 700;' },
    text: state.seat ? `${state.seat.section} · ${t('seat.row')} ${state.seat.row} · ${t('seat.number')} ${state.seat.seat}` : `#${seatIndex}`,
  });

  const successHud = el(
    'div',
    { class: 'flash__hud stack hidden', attrs: { style: 'max-width: 36ch; text-align: center; border-color: rgba(212, 175, 55, 0.5); box-shadow: 0 16px 40px rgba(0,0,0,0.7);' } },
    el('div', { html: checkSvg }),
    el('h2', { class: 'card__title', text: t('calibrate.successTitle'), attrs: { style: 'color: #D4AF37; font-size: 1.25rem; margin-top: 8px;' } }),
    el('p', { text: t('calibrate.successLead'), attrs: { style: 'color: rgba(255,255,255,0.85); font-size: 0.85rem;' } }),
    el(
      'div',
      { class: 'seat-summary', attrs: { style: 'background: rgba(0,0,0,0.6); justify-content: center; border-color: rgba(212,175,55,0.35); padding: 8px 14px;' } },
      seatSummaryMeta,
    ),
    el('button', {
      class: 'btn btn--primary btn--lg btn--block',
      text: t('calibrate.continue'),
      attrs: { type: 'button', style: 'margin-top: 10px; background: #D4AF37; color: #05070A; font-weight: 700;' },
      on: { click: () => ctx.go('ready') },
    }),
    el('button', {
      class: 'btn btn--secondary btn--sm btn--block',
      text: t('welcome.changeSeat'),
      attrs: { type: 'button', style: 'margin-top: 4px;' },
      on: { click: () => ctx.go('seat') },
    }),
  );

  screen.append(bitLayer, hud, successHud);

  let raf = 0;
  let start = 0;
  const cycleMs = code.bits.length * CALIBRATION.bitMs + CALIBRATION.gapMs;
  const targetDurationMs = cycleMs * 2; // 2 full optical cycles (~6 seconds)
  let isCompleted = false;

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
        playTone(783.99, 0.26, 0.40); // G5
      }
    } catch {
      // Audio not permitted or unsupported, continue silently
    }
  }

  function showSuccess(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    isCompleted = true;

    // If no seat was previously selected, lock an auto-allocated seat from camera homography
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
  }

  function loop(): void {
    const elapsed = performance.now() - start;

    if (elapsed >= targetDurationMs && !isCompleted) {
      showSuccess();
      return;
    }

    const progress = Math.min(100, Math.round((elapsed / targetDurationMs) * 100));
    progressBar.style.width = `${progress}%`;

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
    progressBar.style.width = '0%';

    start = performance.now();
    raf = requestAnimationFrame(loop);
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
      void ctx.wakeLock.release();
    },
  };
};
