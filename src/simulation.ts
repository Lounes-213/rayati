/**
 * Simulation view (desktop) & Tifo Studio Suite.
 * 1. Full stadium grid rendering (10,000 seats).
 * 2. Tifo Studio & Customizer (Algerian Flag, Wave, Strobe, Algerian Ligue 1 clubs).
 * 3. Live 4-Phone Testing with real QR codes and 4 synchronized virtual smartphone mockups.
 */
import './ui/styles/base.css';
import './ui/styles/simulation.css';
import { SHOW } from './core/config';
import { formatClock } from './domain/colorFrame';
import { decodeShow, renderFrame, timelineIndexAt, type DecodedShow } from './domain/showTimeline';
import { seatAt, type SeatIndex } from './domain/seat';
import { createClockSync } from './data/clockSync';
import { createSeatRepository } from './data/seatRepository';
import { createShowRepository } from './data/showRepository';
import { createMemoryStorage } from './data/storage';
import { createShowEngine } from './services/showEngine';
import { generateTifoShow, type TifoPresetType } from './services/tifoStudio';
import { generateQrSvg } from './ui/components/qr';
import { el } from './ui/dom';

const root = document.getElementById('sim');
if (root) void boot(root);

async function boot(host: HTMLElement): Promise<void> {
  const storage = createMemoryStorage();
  const seatRepo = createSeatRepository({ storage, url: '/seats.json' });
  const showRepo = createShowRepository({ storage, url: '/show.json', correctionsUrl: null, precache: undefined });

  let seats: SeatIndex;
  let show: DecodedShow;
  try {
    seats = (await seatRepo.load()).index;
    show = (await showRepo.load()).show;
  } catch (error) {
    host.appendChild(
      el(
        'div',
        { class: 'sim-panel' },
        el('h2', { text: 'Simulation' }),
        el('p', { class: 'sim-error', text: `Could not load /seats.json and /show.json: ${(error as Error).message}` }),
        el('p', { class: 'sim-field', html: 'Run <code>npm run seats</code> and <code>npm run show</code> first.' }),
      ),
    );
    return;
  }

  /* ------------------------------------------------------------- geometry */
  const { cellW, cellH, sectionCols, sectionRows } = seats.file.layout ?? {
    cellW: 100,
    cellH: 10,
    sectionCols: 10,
    sectionRows: 1,
  };
  const width = sectionCols * cellW;
  const height = sectionRows * cellH;

  const cellOf = new Int32Array(seats.total);
  const seatOfCell = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < seats.total; i++) {
    const ref = seatAt(seats, i);
    if (!ref) continue;
    const section = seats.sections.find((s) => s.id === ref.section);
    if (!section) continue;
    const rows = seats.file.sections.find((s) => s.id === ref.section)?.rows ?? [];
    const rowIndex = Math.max(0, rows.findIndex((r) => r.id === ref.row));
    const seatFrom = rows[rowIndex]?.seatFrom ?? 1;
    const x = section.col * cellW + Math.min(cellW - 1, Math.max(0, ref.seat - seatFrom));
    const y = section.row * cellH + Math.min(cellH - 1, rowIndex);
    const cell = y * width + x;
    cellOf[i] = cell;
    seatOfCell[cell] = i;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const offCtx = offscreen.getContext('2d', { willReadFrequently: true })!;
  const image = offCtx.createImageData(width, height);
  const imageBytes = image.data;
  const frame = new Uint8Array(seats.total);
  const rgba = new Uint8Array(width * height * 4);

  /* ------------------------------------------------------------------ UI */
  const canvas = el('canvas', { class: 'sim-canvas', attrs: { width, height } }) as HTMLCanvasElement;
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.imageSmoothingEnabled = false;

  const clockLabel = el('dd', { class: 'num', text: '0:00' });
  const seatLabel = el('dd', { class: 'num', text: '—' });
  const seatColor = el('dd', { class: 'num', text: '—' });
  const fpsLabel = el('dd', { class: 'num', text: '—' });
  const progressLabel = el('dd', { class: 'num', text: '0%' });

  const playButton = el('button', { class: 'btn btn--primary btn--sm', text: 'Pause' });
  const restartButton = el('button', { class: 'btn btn--secondary btn--sm', text: 'Restart' });
  const scrub = el('input', {
    attrs: { type: 'range', min: 0, max: show.meta.durationMs, step: 100, value: 0 },
  }) as HTMLInputElement;
  const speed = el('input', {
    attrs: { type: 'range', min: 1, max: 8, step: 1, value: 1 },
  }) as HTMLInputElement;
  const zoom = el('input', {
    attrs: { type: 'range', min: 1, max: 8, step: 1, value: 3 },
  }) as HTMLInputElement;

  const swatchesContainer = el('div', { class: 'sim-legend' });
  function updateSwatches(): void {
    swatchesContainer.replaceChildren(
      ...show.palette.map((hex, index) =>
        el('span', {
          class: 'sim-swatch',
          attrs: { title: `${index}: ${hex}`, style: `background:${hex}` },
        }),
      ),
    );
  }
  updateSwatches();

  const speedLabel = el('span', { text: 'Speed ×1' });
  const zoomLabel = el('span', { text: 'Zoom 3 px/seat' });

  const stats = el(
    'dl',
    { class: 'sim-readout' },
    el('dt', { text: 'Clock' }),
    clockLabel,
    el('dt', { text: 'Progress' }),
    progressLabel,
    el('dt', { text: 'FPS' }),
    fpsLabel,
    el('dt', { text: 'Seat under cursor' }),
    seatLabel,
    el('dt', { text: 'Colour' }),
    seatColor,
  );

  const clock = createClockSync({
    storage,
    fetcher: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
  });

  /* ------------------------------------------------------------- 4-phone mockups */
  // We monitor 4 representative seats:
  // 1: Green wing (A-01-01)
  // 2: White wing (A-01-50)
  // 3: Crescent / Center (B-01-01)
  // 4: Red wing (C-01-01)
  const phoneSeatIndices = [
    0, // A-01-01
    49, // A-01-50
    1000, // B-01-01
    2000, // C-01-01
  ];

  const phoneScreens: HTMLElement[] = [];
  const phoneColorLabels: HTMLElement[] = [];
  const phoneMockupCards: HTMLElement[] = [];

  const phoneLabels = [
    { title: 'Tél 1 · A-01-01', desc: 'Vert / Aile Gauche', role: 'Green Wing' },
    { title: 'Tél 2 · A-01-50', desc: 'Blanc / Aile Droite', role: 'White Wing' },
    { title: 'Tél 3 · B-01-01', desc: 'Rouge / Centre Croissant', role: 'Center Emblem' },
    { title: 'Tél 4 · C-01-01', desc: 'Rouge / Virage Nord', role: 'Red Sector' },
  ];

  for (let i = 0; i < 4; i++) {
    const sColor = el('span', { class: 'mockup-color-hex', text: '#000000' });
    const sBadge = el('span', { class: 'mockup-seat-badge', text: phoneLabels[i].title });
    const screenEl = el('div', { class: 'mockup-screen' }, sBadge, sColor);
    const phoneEl = el('div', { class: 'mockup-phone' }, el('div', { class: 'mockup-notch' }), screenEl);

    phoneScreens.push(screenEl);
    phoneColorLabels.push(sColor);
    phoneMockupCards.push(phoneEl);
  }

  let engine = createShowEngine({
    show,
    clock,
    speed: 1,
    onFrame: (frameCtx) => {
      draw(frameCtx.elapsedMs);
      clockLabel.textContent = `${formatClock(frameCtx.elapsedMs)} / ${formatClock(frameCtx.durationMs)}`;
      progressLabel.textContent = `${Math.round(frameCtx.progress * 100)}%`;
      scrub.value = String(Math.round(frameCtx.elapsedMs));
    },
  });

  playButton.addEventListener('click', () => {
    if (engine.paused) {
      engine.resume();
      playButton.textContent = 'Pause';
    } else {
      engine.pause();
      playButton.textContent = 'Play';
    }
  });
  restartButton.addEventListener('click', () => engine.seek(0));
  scrub.addEventListener('input', () => engine.seek(Number(scrub.value)));
  speed.addEventListener('input', () => engine.setSpeed(Number(speed.value)));
  zoom.addEventListener('input', () => applyZoom());

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * height);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const seat = seatOfCell[y * width + x];
    if (seat < 0) {
      seatLabel.textContent = '—';
      return;
    }
    const ref = seatAt(seats, seat);
    const timeline = show.timelines[show.seatTimeline[seat]];
    const index = timeline ? timelineIndexAt(timeline, engine.context().elapsedMs, show.meta.tickMs) : 0;
    seatLabel.textContent = ref ? `${ref.section}-${ref.row}-${ref.seat} (#${seat})` : '—';
    seatColor.textContent = `${show.palette[index] ?? '#000000'} (tl ${show.seatTimeline[seat]})`;
  });

  function applyZoom(): void {
    const scale = Number(zoom.value);
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${height * scale}px`;
  }

  let fpsAcc = 0;
  let fpsFrames = 0;
  let lastFrameAt = 0;
  function draw(timeMs: number): void {
    const now = performance.now();
    if (lastFrameAt > 0) fpsAcc += now - lastFrameAt;
    lastFrameAt = now;
    renderFrame(show, timeMs, frame);
    rgba.fill(0);
    for (let seat = 0; seat < frame.length; seat++) {
      const p = frame[seat] * 3;
      const cell = cellOf[seat] * 4;
      rgba[cell] = show.paletteRgb[p];
      rgba[cell + 1] = show.paletteRgb[p + 1];
      rgba[cell + 2] = show.paletteRgb[p + 2];
      rgba[cell + 3] = 255;
    }
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    imageBytes.set(rgba.subarray(0, imageBytes.length));
    offCtx.putImageData(image, 0, 0);
    ctx2d.drawImage(offscreen, 0, 0);

    // Update 4 virtual smartphone screens in real-time
    for (let i = 0; i < 4; i++) {
      const seatIdx = phoneSeatIndices[i];
      const colorIdx = frame[seatIdx] ?? 0;
      const hex = show.palette[colorIdx] ?? '#000000';
      if (phoneScreens[i]) {
        phoneScreens[i].style.backgroundColor = hex;
        phoneColorLabels[i].textContent = hex;
      }
    }

    fpsFrames++;
    if (fpsFrames >= 30) {
      fpsLabel.textContent = `${(1000 / (fpsAcc / fpsFrames)).toFixed(0)}`;
      fpsAcc = 0;
      fpsFrames = 0;
    }
  }

  /* ------------------------------------------------------------- 4-phone QR panel */
  const test4Pane = el('div', { class: 'test4-container sim-tab-pane hidden' });

  const hostIpInput = el('input', {
    class: 'select',
    attrs: {
      type: 'text',
      value: window.location.origin,
      style: 'max-width: 420px; font-family: monospace;',
    },
  }) as HTMLInputElement;

  const syncCountdownBtn = el('button', {
    class: 'btn btn--primary btn--sm',
    text: '⚡ Lancer le compte à rebours 10s pour tous les téléphones',
    attrs: { type: 'button' },
  });

  const syncStatusLabel = el('span', { class: 'pill pill--ok hidden', text: 'Compte à rebours armé !' });

  syncCountdownBtn.addEventListener('click', () => {
    const targetStart = Date.now() + 10000;
    show.meta.startAt = targetStart;
    engine.seek(0);
    syncStatusLabel.classList.remove('hidden');
    syncStatusLabel.textContent = `Synchro armée ! Top départ dans 10 secondes`;
    renderQrCards();
    setTimeout(() => syncStatusLabel.classList.add('hidden'), 8000);
  });

  hostIpInput.addEventListener('change', () => renderQrCards());

  const qrCardsGrid = el('div', { class: 'test4-grid' });

  const testParams = [
    { s: 'A', r: '1', n: '1', title: 'Téléphone 1', desc: 'Section A · Rang 1 · Siège 1 (Vert)' },
    { s: 'A', r: '1', n: '50', title: 'Téléphone 2', desc: 'Section A · Rang 1 · Siège 50 (Blanc)' },
    { s: 'B', r: '1', n: '1', title: 'Téléphone 3', desc: 'Section B · Rang 1 · Siège 1 (Croissant)' },
    { s: 'C', r: '1', n: '1', title: 'Téléphone 4', desc: 'Section C · Rang 1 · Siège 1 (Rouge)' },
  ];

  async function renderQrCards(): Promise<void> {
    qrCardsGrid.replaceChildren();
    const base = hostIpInput.value.trim().replace(/\/$/, '');

    for (const item of testParams) {
      const url = `${base}/?s=${item.s}&r=${item.r}&n=${item.n}`;
      const qrSvg = await generateQrSvg(url, { width: 170 });

      const card = el(
        'div',
        { class: 'test4-card' },
        el('div', { class: 'test4-phone-title', text: item.title }),
        el('div', { class: 'test4-phone-role', text: item.desc }),
        el('div', { class: 'test4-qr-wrap', html: qrSvg }),
        el('a', {
          class: 'btn btn--secondary btn--sm btn--block',
          text: 'Ouvrir ce siège',
          attrs: { href: url, target: '_blank', style: 'text-decoration: none; font-size: 11px;' },
        }),
      );
      qrCardsGrid.appendChild(card);
    }
  }
  void renderQrCards();

  test4Pane.append(
    el(
      'div',
      { class: 'card', style: 'border-color: var(--c-green-bright);' },
      el('h2', { class: 'card__title', text: '📱 Test synchronisé sur 4 smartphones en direct' }),
      el(
        'p',
        { class: 'card__hint' },
        'Connecte 4 téléphones au même réseau Wi-Fi / Partage de connexion 4G. Scanne un QR code sur chaque appareil : ils se caleront sur la même seconde !',
      ),
      el(
        'div',
        { style: 'display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-block: 12px;' },
        el('label', { class: 'sim-field' }, el('span', { text: 'Adresse IP locale / Domaine :' }), hostIpInput),
        syncCountdownBtn,
        syncStatusLabel,
      ),
    ),
    el('h3', { style: 'color: #D4AF37; margin-top: 12px;' }, 'Écrans virtuels en direct (simulation temps-réel) :'),
    el('div', { class: 'phone-mockups-wrap' }, ...phoneMockupCards),
    qrCardsGrid,
  );

  /* ------------------------------------------------------------- Tifo Studio panel */
  const studioPane = el('div', { class: 'studio-container sim-tab-pane hidden' });

  const presetSelect = el(
    'select',
    { class: 'select' },
    el('option', { attrs: { value: 'algeria_flag' }, text: '🇩🇿 العلم الوطني الجزائري (Ondulation & Étoile / Croissant)' }),
    el('option', { attrs: { value: 'stadium_wave' }, text: '🌊 Vague lumineuse (OLA du virage)' }),
    el('option', { attrs: { value: 'ultras_strobe' }, text: '⚡ Craquage Ultras (Flashs stroboscopiques)' }),
    el('option', { attrs: { value: 'club_mca' }, text: '⚽ MC Alger (Vert & Rouge 🟢🔴)' }),
    el('option', { attrs: { value: 'club_usma' }, text: '⚽ USM Alger (Rouge & Noir 🔴⚫)' }),
    el('option', { attrs: { value: 'club_jsk' }, text: '⚽ JS Kabylie (Jaune & Vert 🟡🟢)' }),
    el('option', { attrs: { value: 'club_crb' }, text: '⚽ CR Belouizdad (Rouge & Blanc 🔴⚪)' }),
    el('option', { attrs: { value: 'club_ess' }, text: '⚽ ES Sétif (Blanc & Noir ⚪⚫)' }),
  ) as HTMLSelectElement;

  const durationSelect = el(
    'select',
    { class: 'select' },
    el('option', { attrs: { value: '15000' }, text: '15 secondes' }),
    el('option', { attrs: { value: '30000', selected: 'true' }, text: '30 secondes' }),
    el('option', { attrs: { value: '60000' }, text: '60 secondes' }),
    el('option', { attrs: { value: '120000' }, text: '2 minutes' }),
  ) as HTMLSelectElement;

  const applyShowBtn = el('button', {
    class: 'btn btn--primary btn--block',
    text: '⚡ Appliquer immédiatement au stade',
    attrs: { type: 'button' },
  });

  const exportShowBtn = el('button', {
    class: 'btn btn--secondary btn--block',
    text: '💾 Télécharger show.json pour la production',
    attrs: { type: 'button' },
  });

  const studioStatus = el('span', { class: 'pill pill--ok hidden', text: 'Tifo appliqué !' });

  let activeCustomShow = generateTifoShow(seats, {
    type: 'algeria_flag',
    name: 'Algerian Flag Tifo',
    durationMs: 30000,
  });

  function applyPreset(): void {
    const presetType = presetSelect.value as TifoPresetType;
    const dur = Number(durationSelect.value);

    activeCustomShow = generateTifoShow(seats, {
      type: presetType,
      name: `Rayati-${presetType}`,
      durationMs: dur,
    });

    show = decodeShow(activeCustomShow);
    scrub.max = String(show.meta.durationMs);

    engine.pause();
    engine = createShowEngine({
      show,
      clock,
      speed: Number(speed.value),
      onFrame: (frameCtx) => {
        draw(frameCtx.elapsedMs);
        clockLabel.textContent = `${formatClock(frameCtx.elapsedMs)} / ${formatClock(frameCtx.durationMs)}`;
        progressLabel.textContent = `${Math.round(frameCtx.progress * 100)}%`;
        scrub.value = String(Math.round(frameCtx.elapsedMs));
      },
    });
    engine.start();
    updateSwatches();

    studioStatus.classList.remove('hidden');
    studioStatus.textContent = 'Nouveau Tifo appliqué avec succès !';
    setTimeout(() => studioStatus.classList.add('hidden'), 4000);
  }

  applyShowBtn.addEventListener('click', () => applyPreset());

  exportShowBtn.addEventListener('click', () => {
    const jsonString = JSON.stringify(activeCustomShow, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'show.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  studioPane.append(
    el(
      'aside',
      { class: 'sim-panel' },
      el('h2', { text: '🎨 Studio de Programmation du Tifo' }),
      el('p', { class: 'card__hint' }, 'Choisis les couleurs, animations et durées de la chorégraphie du virage.'),
      el('label', { class: 'sim-field' }, el('span', { text: 'Modèle de Tifo :' }), presetSelect),
      el('label', { class: 'sim-field' }, el('span', { text: 'Durée de la boucle :' }), durationSelect),
      applyShowBtn,
      exportShowBtn,
      studioStatus,
    ),
    el(
      'div',
      { class: 'sim-stage' },
      el('h3', { style: 'color: #D4AF37; margin-bottom: 12px; align-self: flex-start;' }, 'Aperçu des 4 téléphones synchronisés :'),
      el('div', { class: 'phone-mockups-wrap', style: 'width: 100%;' }, ...phoneMockupCards),
    ),
  );

  /* ------------------------------------------------------------- Navigation tabs */
  const tabSimBtn = el('button', {
    class: 'sim-tab-btn',
    attrs: { type: 'button', 'aria-selected': 'true' },
    text: '🏟️ Vue Stade Complète',
  });
  const tabStudioBtn = el('button', {
    class: 'sim-tab-btn',
    attrs: { type: 'button', 'aria-selected': 'false' },
    text: '🎨 Studio de Programmation',
  });
  const tabTest4Btn = el('button', {
    class: 'sim-tab-btn',
    attrs: { type: 'button', 'aria-selected': 'false' },
    text: '📱 Test Direct sur 4 Smartphones',
  });
  const guideLink = el('a', {
    class: 'sim-tab-btn',
    attrs: { href: '/guide.html', style: 'text-decoration: none; color: var(--c-gold); border-color: var(--c-gold);' },
    text: '📖 Guide du Supporter (En images)',
  });
  const appLink = el('a', {
    class: 'sim-tab-btn',
    attrs: { href: '/', style: 'text-decoration: none;' },
    text: '🚀 Ouvrir l\'App Mobile',
  });

  const simControlsPane = el('div', { class: 'sim-tab-pane' });
  const simPanelAside = el(
    'aside',
    { class: 'sim-panel' },
    el('h2', { text: 'Playback' }),
    el('div', { class: 'sim-buttons' }, playButton, restartButton),
    el('label', { class: 'sim-field' }, el('span', { text: 'Timeline' }), scrub),
    el('label', { class: 'sim-field' }, speedLabel, speed),
    el('label', { class: 'sim-field' }, zoomLabel, zoom),
    stats,
    swatchesContainer,
    el('p', { class: 'sim-field', html: `Same engine as the phones: ${SHOW.tickMs} ms ticks, RLE timelines.` }),
  );
  const simStageDiv = el('div', { class: 'sim-stage' }, canvas);
  simControlsPane.append(simPanelAside, simStageDiv);

  function selectTab(tab: 'sim' | 'studio' | 'test4'): void {
    tabSimBtn.setAttribute('aria-selected', tab === 'sim' ? 'true' : 'false');
    tabStudioBtn.setAttribute('aria-selected', tab === 'studio' ? 'true' : 'false');
    tabTest4Btn.setAttribute('aria-selected', tab === 'test4' ? 'true' : 'false');

    simControlsPane.classList.toggle('hidden', tab !== 'sim');
    studioPane.classList.toggle('hidden', tab !== 'studio');
    test4Pane.classList.toggle('hidden', tab !== 'test4');
  }

  tabSimBtn.addEventListener('click', () => selectTab('sim'));
  tabStudioBtn.addEventListener('click', () => selectTab('studio'));
  tabTest4Btn.addEventListener('click', () => selectTab('test4'));

  const navBar = el('nav', { class: 'sim-nav' }, tabSimBtn, tabStudioBtn, tabTest4Btn, guideLink, appLink);

  host.append(
    el(
      'header',
      { class: 'sim-header' },
      el(
        'div',
        { attrs: { style: 'display: flex; align-items: center; gap: 12px;' } },
        el('img', {
          attrs: {
            src: '/icons/rayati_mark.svg',
            alt: 'Rayti',
            style: 'width: 36px; height: 36px; object-fit: contain;',
          },
        }),
        el('h1', { class: 'sim-title' }, 'رايتي · RAYTI', el('span', { text: 'Simulation & Studio' })),
      ),
      el(
        'div',
        { class: 'sim-legend' },
        el('span', { class: 'pill', text: `${seats.total} sièges` }),
        el('span', { class: 'pill', text: `${show.timelines.length} timelines` }),
        el('span', { class: 'pill', text: `${show.meta.tickMs} ms/tick` }),
        el('span', { class: 'pill', text: `${formatClock(show.meta.durationMs)} show` }),
      ),
    ),
    navBar,
    simControlsPane,
    studioPane,
    test4Pane,
  );

  speed.addEventListener('input', () => (speedLabel.textContent = `Speed ×${speed.value}`));
  zoom.addEventListener('input', () => (zoomLabel.textContent = `Zoom ${zoom.value} px/seat`));

  applyZoom();
  engine.start();
  clockLabel.textContent = `0:00 / ${formatClock(show.meta.durationMs)}`;
}
