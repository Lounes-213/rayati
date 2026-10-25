import './ui/styles/base.css';
import QRCode from 'qrcode';
import { audioEngine, type RhythmEffect } from './services/audioEngine';
import { realtimeSync } from './services/realtimeSync';
import type { ShowFile } from './core/types';

// DOM Elements
const standCanvas = document.getElementById('standCanvas') as HTMLCanvasElement;
const audioVisualizerCanvas = document.getElementById('audioVisualizer') as HTMLCanvasElement;
const canvasStatusLabel = document.getElementById('canvasStatusLabel') as HTMLElement;
const devicesLiveCount = document.getElementById('devicesLiveCount') as HTMLElement;
const masterClock = document.getElementById('masterClock') as HTMLElement;
const kpiConnected = document.getElementById('kpiConnected') as HTMLElement;
const kpiBpm = document.getElementById('kpiBpm') as HTMLElement;
const bpmStatusLabel = document.getElementById('bpmStatusLabel') as HTMLElement;
const totalSeatsDisplay = document.getElementById('totalSeatsDisplay') as HTMLElement;
const gridDimBadge = document.getElementById('gridDimBadge') as HTMLElement;

const gridColsInput = document.getElementById('gridColsInput') as HTMLInputElement;
const gridRowsInput = document.getElementById('gridRowsInput') as HTMLInputElement;
const btnApplyCustomDimensions = document.getElementById('btnApplyCustomDimensions') as HTMLButtonElement;

// Preset dimension buttons (Starting from 1x1!)
const btnSector1x1 = document.getElementById('btnSector1x1') as HTMLButtonElement;
const btnSector2x2 = document.getElementById('btnSector2x2') as HTMLButtonElement;
const btnSector4x4 = document.getElementById('btnSector4x4') as HTMLButtonElement;
const btnSector8x8 = document.getElementById('btnSector8x8') as HTMLButtonElement;
const btnSectorUltras = document.getElementById('btnSectorUltras') as HTMLButtonElement;
const btnSectorGrandstand = document.getElementById('btnSectorGrandstand') as HTMLButtonElement;
const btnSectorFull = document.getElementById('btnSectorFull') as HTMLButtonElement;

const btnAudioToggle = document.getElementById('btnAudioToggle') as HTMLButtonElement;
const bpmSelect = document.getElementById('bpmSelect') as HTMLSelectElement;
const rhythmEffectSelect = document.getElementById('rhythmEffectSelect') as HTMLSelectElement;

const imageFileInput = document.getElementById('imageFileInput') as HTMLInputElement;
const btnBroadcastShow = document.getElementById('btnBroadcastShow') as HTMLButtonElement;
const btnCountdown10s = document.getElementById('btnCountdown10s') as HTMLButtonElement;
const btnBlackout = document.getElementById('btnBlackout') as HTMLButtonElement;
const btnEndShow = document.getElementById('btnEndShow') as HTMLButtonElement;
const broadcastStatusMsg = document.getElementById('broadcastStatusMsg') as HTMLElement;

// QR Badges Generator Elements
const qrStadiumSelect = document.getElementById('qrStadiumSelect') as HTMLSelectElement;
const qrSectorSelect = document.getElementById('qrSectorSelect') as HTMLSelectElement;
const qrRowInput = document.getElementById('qrRowInput') as HTMLInputElement;
const qrSeatCountInput = document.getElementById('qrSeatCountInput') as HTMLInputElement;
const btnGenerateBadges = document.getElementById('btnGenerateBadges') as HTMLButtonElement;
const btnGenerateCurrentGridBadges = document.getElementById('btnGenerateCurrentGridBadges') as HTMLButtonElement;
const btnPrintQrSheet = document.getElementById('btnPrintQrSheet') as HTMLButtonElement;
const btnJumpQr = document.getElementById('btnJumpQr') as HTMLButtonElement;
const qrBadgesContainer = document.getElementById('qrBadgesContainer') as HTMLElement;

// State: Dimensions (Starting 1x1 up to NxM)
let gridCols = 60;
let gridRows = 40;
let seatColors: string[] = [];
let currentPattern = 'algeria_flag';
let customImageCanvas: HTMLCanvasElement | null = null;
let currentShow: ShowFile | null = null;

// Connected devices registry
let activeSeatIndices = new Set<number>();

// Broadcast channel
const controlChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rayati_control') : null;

// Audio beat reaction state
let beatFlashAlpha = 0;

// Master Clock
function updateClock(): void {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
  if (masterClock) masterClock.textContent = `${h}:${m}:${s}.${ms}`;
}
setInterval(updateClock, 50);

// Real-time presence via WebSocket & BroadcastChannel
realtimeSync.onPresence((devices) => {
  activeSeatIndices = new Set<number>();
  let unassignedIndex = 0;
  for (const dev of devices) {
    if (dev.seat && typeof dev.seat.index === 'number' && dev.seat.index >= 0) {
      activeSeatIndices.add(dev.seat.index);
    } else {
      activeSeatIndices.add(unassignedIndex % (gridCols * gridRows || 1));
      unassignedIndex++;
    }
  }
  const countStr = `${devices.length} هاتف متصل حياً`;
  if (devicesLiveCount) devicesLiveCount.textContent = countStr;
  if (kpiConnected) kpiConnected.textContent = String(devices.length);
});

// Seat Grid Dimensions Logic (1x1 to NxM)
function setGridDimensions(cols: number, rows: number, sectorName = 'المصفوفة'): void {
  gridCols = Math.max(1, Math.min(150, cols));
  gridRows = Math.max(1, Math.min(150, rows));

  if (gridColsInput) gridColsInput.value = String(gridCols);
  if (gridRowsInput) gridRowsInput.value = String(gridRows);

  const total = gridCols * gridRows;
  if (totalSeatsDisplay) totalSeatsDisplay.textContent = total.toLocaleString();
  if (gridDimBadge) gridDimBadge.textContent = `${gridCols} × ${gridRows}`;
  if (canvasStatusLabel) {
    canvasStatusLabel.textContent = `مصفوفة ${sectorName} (${gridCols}×${gridRows}) · ${total.toLocaleString()} مقعد نشط`;
  }

  [
    btnSector1x1,
    btnSector2x2,
    btnSector4x4,
    btnSector8x8,
    btnSectorUltras,
    btnSectorGrandstand,
    btnSectorFull,
  ].forEach((b) => b?.classList.remove('active'));

  if (gridCols === 1 && gridRows === 1) btnSector1x1?.classList.add('active');
  else if (gridCols === 2 && gridRows === 2) btnSector2x2?.classList.add('active');
  else if (gridCols === 4 && gridRows === 4) btnSector4x4?.classList.add('active');
  else if (gridCols === 8 && gridRows === 8) btnSector8x8?.classList.add('active');
  else if (gridCols === 60 && gridRows === 40) btnSectorUltras?.classList.add('active');
  else if (gridCols === 80 && gridRows === 50) btnSectorGrandstand?.classList.add('active');
  else if (gridCols === 100 && gridRows === 84) btnSectorFull?.classList.add('active');

  recomputeSeatColors();
  rebuildAndBroadcast();
}

btnApplyCustomDimensions?.addEventListener('click', () => {
  const c = Number(gridColsInput?.value) || 1;
  const r = Number(gridRowsInput?.value) || 1;
  setGridDimensions(c, r, 'مخصصة');
});

gridColsInput?.addEventListener('change', () => {
  setGridDimensions(Number(gridColsInput.value) || 1, gridRows, 'مخصصة');
});

gridRowsInput?.addEventListener('change', () => {
  setGridDimensions(gridCols, Number(gridRowsInput.value) || 1, 'مخصصة');
});

btnSector1x1?.addEventListener('click', () => setGridDimensions(1, 1, 'اختبار هاتف واحد'));
btnSector2x2?.addEventListener('click', () => setGridDimensions(2, 2, 'تجربة 4 هواتف'));
btnSector4x4?.addEventListener('click', () => setGridDimensions(4, 4, 'مكعب 16 هاتف'));
btnSector8x8?.addEventListener('click', () => setGridDimensions(8, 8, 'مصفوفة 64 هاتف'));
btnSectorUltras?.addEventListener('click', () => setGridDimensions(60, 40, 'المنعرج الشمالي'));
btnSectorGrandstand?.addEventListener('click', () => setGridDimensions(80, 50, 'المدرج الشرفي'));
btnSectorFull?.addEventListener('click', () => setGridDimensions(100, 84, 'الملعب الكامل'));

// Sample Tifo Image or Pattern across grid
function recomputeSeatColors(): void {
  const total = gridCols * gridRows;
  seatColors = new Array(total);

  if (customImageCanvas) {
    const ctx = customImageCanvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, gridCols, gridRows).data;
      for (let i = 0; i < total; i++) {
        const r = imgData[i * 4];
        const g = imgData[i * 4 + 1];
        const b = imgData[i * 4 + 2];
        const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        seatColors[i] = hex;
      }
      return;
    }
  }

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c;
      const normCol = gridCols > 1 ? c / (gridCols - 1) : 0.5;
      const normRow = gridRows > 1 ? r / (gridRows - 1) : 0.5;

      if (currentPattern === 'algeria_flag') {
        if (normCol < 0.46) {
          seatColors[idx] = '#00A859';
        } else if (normCol > 0.54) {
          seatColors[idx] = '#FFFFFF';
        } else {
          const distToCenter = Math.hypot(normCol - 0.5, normRow - 0.5);
          if (distToCenter < 0.16) {
            seatColors[idx] = '#D21034';
          } else {
            seatColors[idx] = normCol < 0.5 ? '#00A859' : '#FFFFFF';
          }
        }
      } else if (currentPattern === 'monogram_r') {
        const inStem = normCol >= 0.25 && normCol <= 0.35 && normRow >= 0.2 && normRow <= 0.8;
        const inTopBar = normCol >= 0.35 && normCol <= 0.65 && normRow >= 0.65 && normRow <= 0.8;
        const inMidBar = normCol >= 0.35 && normCol <= 0.65 && normRow >= 0.45 && normRow <= 0.55;
        const inLoopRight = normCol >= 0.6 && normCol <= 0.7 && normRow >= 0.55 && normRow <= 0.75;
        const inLeg = normCol >= 0.45 && normCol <= 0.72 && normRow >= 0.2 && normRow <= 0.45 && Math.abs((normCol - 0.45) - (0.45 - normRow)) < 0.12;

        seatColors[idx] = inStem || inTopBar || inMidBar || inLoopRight || inLeg ? '#00A859' : '#0B132B';
      } else if (currentPattern === 'stadium_wave') {
        const wave = Math.sin(normCol * 6 + normRow * 2);
        seatColors[idx] = wave > 0.3 ? '#38BDF8' : wave > -0.2 ? '#00A859' : '#0E1726';
      } else if (currentPattern === 'gold_cyan') {
        seatColors[idx] = (r + c) % 4 < 2 ? '#F59E0B' : '#38BDF8';
      } else if (currentPattern === 'pure_white') {
        seatColors[idx] = '#FFFFFF';
      } else {
        seatColors[idx] = '#00A859';
      }
    }
  }
}

// Pattern Selection Handlers
document.querySelectorAll('.btn-pattern').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-pattern').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentPattern = (btn as HTMLElement).dataset.pattern || 'algeria_flag';
    customImageCanvas = null;
    recomputeSeatColors();
    rebuildAndBroadcast();
  });
});

// Custom Image Rasterizer
imageFileInput?.addEventListener('change', () => {
  const file = imageFileInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      customImageCanvas = document.createElement('canvas');
      customImageCanvas.width = gridCols;
      customImageCanvas.height = gridRows;
      const ctx = customImageCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, gridCols, gridRows);
        document.querySelectorAll('.btn-pattern').forEach((b) => b.classList.remove('active'));
        recomputeSeatColors();
        rebuildAndBroadcast();
      }
    };
    img.src = e.target?.result as string;
  };
  reader.readAsDataURL(file);
});

// Build ShowFile & Broadcast via WebSocket MQTT
function rebuildAndBroadcast(): void {
  const seatCount = gridCols * gridRows;
  const palette = Array.from(new Set(seatColors));
  if (palette[0] !== '#000000') palette.unshift('#000000');

  const colorToIdx = new Map<string, number>();
  palette.forEach((hex, i) => colorToIdx.set(hex, i));

  const timelines: [number, number][][] = palette.map((_hex, i) => [
    [i, 600000],
  ]);

  const seatTimelineMap = seatColors.map((hex) => colorToIdx.get(hex) || 0);
  const runs: [number, number][] = [];
  let curId = seatTimelineMap[0] || 0;
  let curLen = 0;

  for (let i = 0; i < seatCount; i++) {
    if (seatTimelineMap[i] === curId) {
      curLen++;
    } else {
      runs.push([curId, curLen]);
      curId = seatTimelineMap[i];
      curLen = 1;
    }
  }
  if (curLen > 0) runs.push([curId, curLen]);

  currentShow = {
    v: 1,
    meta: {
      id: `live-show-${Date.now()}`,
      name: 'Rayti Live Show',
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      startAt: 0,
      durationMs: 600000,
      tickMs: 100,
      seatCount,
      acts: 1,
      actMs: 600000,
      title: {
        ar: 'تيفو رايتي المباشر والمتزامن',
        fr: 'Tifo Rayti en Direct',
        en: 'Rayti Live Stadium Tifo',
      },
    },
    palette,
    timelines,
    seatIndex: {
      runs,
    },
  };

  try {
    localStorage.setItem('rayati_active_show', JSON.stringify(currentShow));
  } catch {
    // ignore
  }

  // Broadcast command via WebSocket MQTT
  realtimeSync.publish({
    type: 'cube_colors',
    colors: seatColors,
    cols: gridCols,
    rows: gridRows,
    timestamp: Date.now(),
  });

  // Also broadcast via BroadcastChannel
  controlChannel?.postMessage({
    type: 'show_updated',
    show: currentShow,
  });
}

// Quick Action Handlers
btnBroadcastShow?.addEventListener('click', () => {
  rebuildAndBroadcast();
  showStatusMessage('تم بث المشهد الضوئي والتيفو حياً لجميع هواتف الملعب بنجاح.');
});

btnCountdown10s?.addEventListener('click', () => {
  realtimeSync.publish({ type: 'start_countdown', targetTime: Date.now() + 10000, timestamp: Date.now() });
  showStatusMessage('بدأ العد التنازلي لـ 10 ثوانٍ على جميع شاشات الجماهير.');
});

btnBlackout?.addEventListener('click', () => {
  realtimeSync.publish({ type: 'blackout', timestamp: Date.now() });
  showStatusMessage('تم إطفاء جميع شاشات المدرج (Blackout).');
});

btnEndShow?.addEventListener('click', () => {
  realtimeSync.publish({ type: 'end_show', timestamp: Date.now() });
  showStatusMessage('تم إرسال أمر إنهاء العرض لجميع هواتف الملعب.');
});

btnJumpQr?.addEventListener('click', () => {
  document.getElementById('qrSection')?.scrollIntoView({ behavior: 'smooth' });
});

function showStatusMessage(msg: string): void {
  if (!broadcastStatusMsg) return;
  broadcastStatusMsg.textContent = msg;
  broadcastStatusMsg.style.display = 'block';
  window.setTimeout(() => {
    broadcastStatusMsg.style.display = 'none';
  }, 4000);
}

// Draw Grandstand Canvas (Supports 1x1, 2x2, up to 150x150)
function drawStandCanvas(): void {
  const ctx = standCanvas?.getContext('2d');
  if (!ctx) return;

  const w = (standCanvas.width = standCanvas.parentElement?.clientWidth || 600);
  const h = (standCanvas.height = 310);

  ctx.clearRect(0, 0, w, h);

  // Background stadium haze
  const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 1.5);
  bgGrad.addColorStop(0, '#0C1B38');
  bgGrad.addColorStop(1, '#040710');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Audio flash overlay
  if (beatFlashAlpha > 0) {
    ctx.fillStyle = `rgba(16, 185, 129, ${beatFlashAlpha * 0.18})`;
    ctx.fillRect(0, 0, w, h);
    beatFlashAlpha = Math.max(0, beatFlashAlpha - 0.05);
  }

  const paddingX = 28;
  const paddingY = 28;
  const availW = w - paddingX * 2;
  const availH = h - paddingY * 2;
  const stepX = gridCols > 1 ? availW / (gridCols - 1) : 0;
  const stepY = gridRows > 1 ? availH / (gridRows - 1) : 0;

  // Single seat mode (1x1)
  if (gridCols === 1 && gridRows === 1) {
    const x = w / 2;
    const y = h / 2;
    const colHex = seatColors[0] || '#00A859';

    // Glowing halo
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.beginPath();
    ctx.arc(x, y, 54, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, 40, 0, Math.PI * 2);
    ctx.fill();

    // Main seat beacon
    ctx.fillStyle = colHex;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Text label
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px Cairo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('مقعد التجربة الوحيد (1×1)', x, y + 50);

    requestAnimationFrame(drawStandCanvas);
    return;
  }

  // Multi-seat matrix (2x2 to NxM)
  const dotRadius = Math.max(
    2.2,
    Math.min(18, Math.min(availW / gridCols, availH / gridRows) * 0.42),
  );

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c;
      const x = gridCols > 1 ? paddingX + c * stepX : w / 2;
      const y = gridRows > 1 ? paddingY + r * stepY : h / 2;
      const colHex = seatColors[idx] || '#00A859';

      ctx.fillStyle = colHex;
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();

      // If active connected device, draw subtle cyan halo
      if (activeSeatIndices.has(idx)) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, dotRadius + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  requestAnimationFrame(drawStandCanvas);
}

// Hover over stand canvas to see seat coordinates
standCanvas.addEventListener('mousemove', (e) => {
  if (gridCols === 1 && gridRows === 1) {
    if (canvasStatusLabel) {
      canvasStatusLabel.textContent = 'المقعد المحدد: الصف 1 · المقعد 1 · الرمز: VN-1-1 (مقعد الاختبار الوحيد)';
    }
    return;
  }

  const rect = standCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const paddingX = 28;
  const paddingY = 28;
  const availW = rect.width - paddingX * 2;
  const availH = rect.height - paddingY * 2;

  const col = Math.round(((mouseX - paddingX) / (availW || 1)) * (gridCols - 1)) + 1;
  const row = Math.round(((mouseY - paddingY) / (availH || 1)) * (gridRows - 1)) + 1;

  if (col >= 1 && col <= gridCols && row >= 1 && row <= gridRows) {
    if (canvasStatusLabel) {
      canvasStatusLabel.textContent = `المقعد المحدد: الصف ${row} · المقعد ${col} · الرمز: VN-${row}-${col}`;
    }
  }
});

// Audio Visualizer
audioEngine.onBeat(() => {
  beatFlashAlpha = 1.0;
});

btnAudioToggle?.addEventListener('click', () => {
  const isPlaying = audioEngine.toggle();
  btnAudioToggle.textContent = isPlaying ? 'إيقاف إيقاع الملعب' : 'تشغيل إيقاع الملعب';
  if (isPlaying) {
    btnAudioToggle.classList.remove('btn-chip--gold');
    btnAudioToggle.classList.add('btn-chip--green');
  } else {
    btnAudioToggle.classList.remove('btn-chip--green');
    btnAudioToggle.classList.add('btn-chip--gold');
  }
});

bpmSelect?.addEventListener('change', () => {
  const val = Number(bpmSelect.value) || 128;
  audioEngine.setBpm(val);
  if (kpiBpm) kpiBpm.textContent = String(val);
  if (bpmStatusLabel) bpmStatusLabel.textContent = `${val} BPM`;
});

rhythmEffectSelect?.addEventListener('change', () => {
  audioEngine.setEffect(rhythmEffectSelect.value as RhythmEffect);
});

function drawAudioVisualizer(): void {
  const ctx = audioVisualizerCanvas?.getContext('2d');
  if (!ctx) return;

  const w = (audioVisualizerCanvas.width = audioVisualizerCanvas.parentElement?.clientWidth || 300);
  const h = (audioVisualizerCanvas.height = 50);

  ctx.clearRect(0, 0, w, h);
  const freqData = audioEngine.getFrequencyData();
  const bars = 36;
  const barWidth = w / bars - 2;

  for (let i = 0; i < bars; i++) {
    const rawVal = freqData[i * 2] || 0;
    const barHeight = Math.max(3, (rawVal / 255) * h);
    const x = i * (barWidth + 2);
    const y = h - barHeight;

    const grad = ctx.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, '#10B981');
    grad.addColorStop(1, '#064E3B');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barWidth, barHeight);
  }

  requestAnimationFrame(drawAudioVisualizer);
}

// REAL STADIUM SEAT QR BADGES STUDIO
async function generateStadiumQrBadges(customItems?: Array<{ stadium: string; sector: string; row: number; seat: number }>): Promise<void> {
  if (!qrBadgesContainer) return;
  qrBadgesContainer.innerHTML = '';

  const stadiumName = qrStadiumSelect?.value || 'Nelson Mandela';
  const sector = qrSectorSelect?.value || 'VN';
  const sectorLabel = qrSectorSelect?.options[qrSectorSelect.selectedIndex]?.text || 'المنعرج الشمالي';

  const itemsToGenerate = customItems || [];
  if (itemsToGenerate.length === 0) {
    const row = Number(qrRowInput?.value) || 1;
    const count = Math.min(100, Math.max(1, Number(qrSeatCountInput?.value) || 12));
    for (let s = 1; s <= count; s++) {
      itemsToGenerate.push({ stadium: stadiumName, sector, row, seat: s });
    }
  }

  const qrBaseUrlInput = document.getElementById('qrBaseUrlInput') as HTMLInputElement | null;
  const rawBaseUrl = qrBaseUrlInput?.value?.trim() || 'https://rayati.pages.dev';
  // Guarantee printed stadium QR codes NEVER leak localhost!
  const targetBaseUrl = rawBaseUrl.includes('localhost') || rawBaseUrl.includes('127.0.0.1')
    ? 'https://rayati.pages.dev'
    : rawBaseUrl.replace(/\/+$/, '');

  for (const item of itemsToGenerate) {
    const seatRef = `${item.sector}-${item.row}-${item.seat}`;
    const directUrl = `${targetBaseUrl}/?s=${seatRef}`;

    // Generate high quality QR Code Data URL
    const qrDataUrl = await QRCode.toDataURL(directUrl, {
      width: 180,
      margin: 1,
      color: {
        dark: '#070B14',
        light: '#FFFFFF',
      },
    });

    const card = document.createElement('div');
    card.className = 'seat-qr-card';
    card.innerHTML = `
      <img src="/icons/rayati_mark.svg" class="badge-logo" alt="Rayti" />
      <div class="seat-qr-stadium">${item.stadium}</div>
      <div style="font-size: 10px; font-weight: 800; color: #008B7A;">${sectorLabel}</div>
      <img src="${qrDataUrl}" class="seat-qr-badge-img" alt="QR ${seatRef}" />
      <div class="seat-qr-coords">صف ${item.row} · مقعد ${item.seat}</div>
      <div style="font-size: 9px; font-family: monospace; color: #64748B;">${seatRef}</div>
      <div class="seat-qr-instructions">امسح الكود ليضيء مقعدك في التيفو الحي</div>
    `;

    qrBadgesContainer.appendChild(card);
  }
}

// Generate for Current Grid Matrix (1x1, 2x2, 4x4, etc.)
btnGenerateCurrentGridBadges?.addEventListener('click', () => {
  const stadiumName = qrStadiumSelect?.value || 'Nelson Mandela';
  const sector = qrSectorSelect?.value || 'VN';
  const total = gridCols * gridRows;
  const maxBadges = Math.min(total, 64); // Max 64 badges for smooth preview

  const items: Array<{ stadium: string; sector: string; row: number; seat: number }> = [];
  let count = 0;
  for (let r = 1; r <= gridRows; r++) {
    for (let c = 1; c <= gridCols; c++) {
      if (count < maxBadges) {
        items.push({ stadium: stadiumName, sector, row: r, seat: c });
        count++;
      }
    }
  }

  void generateStadiumQrBadges(items);
  showStatusMessage(`تم توليد ${items.length} شارة ملصق للمصفوفة الحالية (${gridCols}×${gridRows}) جاهزة للطباعة.`);
});

btnGenerateBadges?.addEventListener('click', () => {
  void generateStadiumQrBadges();
});

btnPrintQrSheet?.addEventListener('click', () => {
  window.print();
});

// Initialization
setGridDimensions(60, 40, 'المنعرج الشمالي');
drawStandCanvas();
drawAudioVisualizer();
void generateStadiumQrBadges();
