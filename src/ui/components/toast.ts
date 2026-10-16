import { el } from '../dom';

export type ToastKind = 'info' | 'error' | 'success';

export interface Toaster {
  element: HTMLElement;
  show(message: string, kind?: ToastKind, durationMs?: number): void;
}

/** Bottom toasts: every failure path in the app ends up here, in the user's language. */
export function createToaster(): Toaster {
  const element = el('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });

  function show(message: string, kind: ToastKind = 'info', durationMs = 4200): void {
    const toast = el('div', { class: `toast toast--${kind}`, text: message });
    element.appendChild(toast);
    window.setTimeout(() => {
      toast.style.opacity = '0';
      window.setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }

  return { element, show };
}
