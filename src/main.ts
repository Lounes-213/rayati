/** Rayati entry point: boots the app into #app. */
import './ui/styles/base.css';
import { createApp } from './ui/app';

/**
 * Fonts load with `media="print"` so they never block the first paint; we flip
 * them to `all` once they are downloaded (and after a 2 s safety net, in case
 * the font CDN is unreachable — the system stack takes over).
 */
function activateFonts(): void {
  const link = document.getElementById('rayati-fonts');
  if (!link) return;
  const activate = () => link.setAttribute('media', 'all');
  try {
    void document.fonts.ready.then(activate);
  } catch {
    activate();
  }
  window.setTimeout(activate, 2000);
}

import { startPresenceHeartbeat } from './services/presenceClient';

const root = document.getElementById('app');
if (root) {
  activateFonts();
  const app = createApp({ root });
  void app.start();

  // Start real-time presence heartbeat to Cloudflare / local network
  startPresenceHeartbeat(() => app.context.state.seat);

  // Exposed for field debugging and for the k6/browser smoke checks.
  Object.assign(window as unknown as Record<string, unknown>, { __rayati: app.context });
}
