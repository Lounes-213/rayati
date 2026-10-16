import { el } from '../dom';

export interface HoldButtonOptions {
  label: string;
  holdMs: number;
  onHold(): void;
  /** Called with 0..1 progress while holding (used for the ring). */
  onProgress?(ratio: number): void;
}

export interface HoldButton {
  element: HTMLButtonElement;
  dispose(): void;
}

/**
 * Touch-proof exit: one stray tap does nothing, a deliberate 1.2 s hold leaves
 * show mode. Works with mouse, touch and pen through pointer events.
 */
export function createHoldButton(options: HoldButtonOptions): HoldButton {
  const ring = el('span', { class: 'show__ring', attrs: { 'aria-hidden': 'true' } });
  const button = el(
    'button',
    {
      class: 'show__exit',
      attrs: { type: 'button', 'aria-label': options.label },
      style: { '--exit-hold': `${options.holdMs}ms` } as Partial<CSSStyleDeclaration>,
    },
    ring,
    el('span', { text: options.label }),
  );

  let startedAt = 0;
  let frame = 0;
  let holding = false;

  function loop(): void {
    if (!holding) return;
    const ratio = Math.min(1, (performance.now() - startedAt) / options.holdMs);
    options.onProgress?.(ratio);
    if (ratio >= 1) {
      stop();
      options.onHold();
      return;
    }
    frame = requestAnimationFrame(loop);
  }

  function start(event: PointerEvent): void {
    event.preventDefault();
    if (holding) return;
    holding = true;
    startedAt = performance.now();
    button.classList.add('show__exit--holding');
    frame = requestAnimationFrame(loop);
  }

  function stop(): void {
    holding = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    button.classList.remove('show__exit--holding');
    options.onProgress?.(0);
  }

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    element: button,
    dispose() {
      stop();
      button.replaceWith(button.cloneNode(true));
    },
  };
}
