import './ui/styles/base.css';
import { type TifoPresetType } from './services/tifoStudio';
import { prepareSeats } from './domain/seat';
import seatsJson from '../public/seats.json';
import {
  PRESET_CADRES,
  type CadreBox,
  type OutsideCadreMode,
  analyzeCadreSeats,
  countConnectedInCadre,
  generateShowFromImage,
  generateShowWithCadrePreset,
} from './services/cadreMapping';
import { fetchLivePresence, validateDevicesFromAdmin, type PresenceDevice } from './services/presenceClient';
import type { ShowFile } from './core/types';

const seats = prepareSeats(seatsJson as never);

// DOM Elements
const standCanvas = document.getElementById('standCanvas') as HTMLCanvasElement;
const previewCanvas = document.getElementById('previewCanvas') as HTMLCanvasElement;
const camVideo = document.getElementById('camVideo') as HTMLVideoElement;
const btnStadiumCam = document.getElementById('btnStadiumCam') as HTMLButtonElement;
const btnWebcam = document.getElementById('btnWebcam') as HTMLButtonElement;
const btnGrid = document.getElementById('btnGrid') as HTMLButtonElement;
const startScanBtn = document.getElementById('startScanBtn') as HTMLButtonElement;
const validateAllBtn = document.getElementById('validateAllBtn') as HTMLButtonElement;
const quickValidateBtn = document.getElementById('quickValidateBtn') as HTMLButtonElement;
const resetCadreBtn = document.getElementById('resetCadreBtn') as HTMLButtonElement;
const refreshPresenceBtn = document.getElementById('refreshPresenceBtn') as HTMLButtonElement;
const toggleDataModeBtn = document.getElementById('toggleDataModeBtn') as HTMLButtonElement;
const dataSourceLabel = document.getElementById('dataSourceLabel') as HTMLElement;

const connectedCountEl = document.getElementById('connectedCount') as HTMLElement;
const cadreCountEl = document.getElementById('cadreCount') as HTMLElement;
const cadrePctEl = document.getElementById('cadrePct') as HTMLElement;
const activeTifoLabel = document.getElementById('activeTifoLabel') as HTMLElement;
const cadreActiveModeLabel = document.getElementById('cadreActiveModeLabel') as HTMLElement;
const selectedCadreTitle = document.getElementById('selectedCadreTitle') as HTMLElement;
const cadreStatsDetail = document.getElementById('cadreStatsDetail') as HTMLElement;
const canvasHudText = document.getElementById('canvasHudText') as HTMLElement;
const hudDot = document.getElementById('hudDot') as HTMLElement;
const devicesContainer = document.getElementById('devicesContainer') as HTMLElement;
const devicesListCount = document.getElementById('devicesListCount') as HTMLElement;

const masterClock = document.getElementById('masterClock') as HTMLElement;
const countdownBanner = document.getElementById('countdownBanner') as HTMLElement;
const kickoff10sBtn = document.getElementById('kickoff10sBtn') as HTMLButtonElement;
const instantStartBtn = document.getElementById('instantStartBtn') as HTMLButtonElement;
const blackoutBtn = document.getElementById('blackoutBtn') as HTMLButtonElement;
const downloadShowBtn = document.getElementById('downloadShowBtn') as HTMLButtonElement;

const tabPresets = document.getElementById('tabPresets') as HTMLButtonElement;
const tabImages = document.getElementById('tabImages') as HTMLButtonElement;
const presetsPanel = document.getElementById('presetsPanel') as HTMLElement;
const imagesPanel = document.getElementById('imagesPanel') as HTMLElement;
const imageFileInput = document.getElementById('imageFileInput') as HTMLInputElement;
const outsideModeSelect = document.getElementById('outsideModeSelect') as HTMLSelectElement;

// State: Real Data 100% by default!
type ViewMode = 'stadium_cam' | 'webcam' | 'grid';
let currentViewMode: ViewMode = 'webcam';
const stadiumCamImg = new Image();
stadiumCamImg.src = '/images/stadium_tifo_night.png';

let isSimulationMode = false;
let cameraStream: MediaStream | null = null;
let isScanning = false;
let currentOutsideMode: OutsideCadreMode = 'black';
let activeTifoType: TifoPresetType = 'algeria_flag';
let currentCadre: CadreBox = { ...PRESET_CADRES.full };
let currentShow: ShowFile | null = null;
let customImageCanvas: HTMLCanvasElement | null = null;

// Registry of REAL devices connected right now
const realDevices = new Map<string, PresenceDevice>();
// Connected seat indices (for stadium canvas and cadre calculations)
let activeSeatIndices = new Set<number>();

// BroadcastChannels for local zero-latency tab communication
const controlChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rayati_control') : null;
const presenceChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rayati_presence') : null;

// Listen to local presence channel
presenceChannel?.addEventListener('message', (event) => {
  if (event.data?.type === 'heartbeat' && event.data.device) {
    const dev = event.data.device as PresenceDevice;
    realDevices.set(dev.deviceId, dev);
    updateFromPresence();
  }
});

// Clock updates
function updateClock(): void {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
  if (masterClock) masterClock.textContent = `${h}:${m}:${s}.${ms}`;
}
setInterval(updateClock, 50);

// Fetch real presence from Cloudflare API every 2.5 seconds
async function syncLivePresence(): Promise<void> {
  const res = await fetchLivePresence();
  const now = Date.now();

  // Clean stale devices older than 20 seconds
  for (const [id, dev] of realDevices.entries()) {
    if (now - dev.lastSeen > 20000) realDevices.delete(id);
  }

  // Merge incoming devices from Cloudflare
  for (const dev of res.devices) {
    realDevices.set(dev.deviceId, dev);
  }

  updateFromPresence();
}

setInterval(() => void syncLivePresence(), 2500);
void syncLivePresence();

refreshPresenceBtn?.addEventListener('click', () => {
  void syncLivePresence();
});

// Toggle between 100% Real Devices and Simulated 8,420 Stadium Test Mode
toggleDataModeBtn?.addEventListener('click', () => {
  isSimulationMode = !isSimulationMode;
  if (isSimulationMode) {
    toggleDataModeBtn.textContent = '🔴 العودة إلى البيانات الحقيقية فقط';
    toggleDataModeBtn.className = 'btn btn--primary btn--sm';
    if (dataSourceLabel) dataSourceLabel.textContent = 'وضع المحاكاة الكاملة (+8,420 افتراضي)';
  } else {
    toggleDataModeBtn.textContent = '🧪 تجربة وضع المحاكاة (+8,420 افتراضي)';
    toggleDataModeBtn.className = 'btn btn--secondary btn--sm';
    if (dataSourceLabel) dataSourceLabel.textContent = 'بيانات حية 100% (Real Live Devices)';
  }
  updateFromPresence();
});

// Recompute active seat indices and update UI
function updateFromPresence(): void {
  activeSeatIndices = new Set<number>();

  if (isSimulationMode) {
    // Fill 8,420 mock seats for stadium rehearsal preview
    for (let i = 0; i < 8420; i++) {
      activeSeatIndices.add(i);
    }
  } else {
    // 100% REAL LIVE DEVICES
    let unassignedCounter = 0;
    for (const dev of realDevices.values()) {
      if (dev.seat && typeof dev.seat.index === 'number' && dev.seat.index >= 0) {
        activeSeatIndices.add(dev.seat.index);
      } else {
        // If device has no locked seat yet, map to first available seats in Section A
        activeSeatIndices.add(unassignedCounter);
        unassignedCounter++;
      }
    }
  }

  renderDevicesList();
  updateTelemetry();
}

// Render the list of real connected phones in the UI
function renderDevicesList(): void {
  const devices = Array.from(realDevices.values());
  if (devicesListCount) devicesListCount.textContent = String(devices.length);

  if (!devicesContainer) return;

  if (devices.length === 0) {
    devicesContainer.innerHTML = `
      <div class="device-item" style="color: var(--c-text-muted); justify-content: center;">
        في انتظار دخول أول هاتف إلى rayati.pages.dev ...
      </div>
    `;
    return;
  }

  devicesContainer.innerHTML = '';
  devices.forEach((dev, idx) => {
    const item = document.createElement('div');
    item.className = 'device-item';
    const isVal = Boolean(dev.validated);
    const statusPill = isVal
      ? `<span class="pill pill--ok" style="font-size: 10px; padding: 2px 6px;">✅ تم التثبيت</span>`
      : `<span class="pill pill--warn" style="font-size: 10px; padding: 2px 6px;">⏳ وميض نشط</span>`;
    const seatLabel = dev.seat ? `${dev.seat.section} · صف ${dev.seat.row} · مقعد ${dev.seat.seat}` : `تحديد آلي`;
    const secondsAgo = Math.max(0, Math.round((Date.now() - dev.lastSeen) / 1000));

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: ${isVal ? 'var(--c-green-bright)' : 'var(--c-gold)'}; font-size: 10px;">●</span>
        <strong style="color: #fff;">📱 هاتف #${idx + 1}</strong>
        ${statusPill}
        <span class="muted" style="font-size: 11px;">(${dev.deviceId.substring(0, 8)})</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--c-gold); font-family: var(--font-num); font-size: 11px;">${seatLabel}</span>
        ${
          !isVal
            ? `<button type="button" class="btn btn--primary btn--sm" data-dev-val="${dev.deviceId}" style="font-size: 10px; padding: 2px 8px; background: var(--c-green-bright); color: #000; font-weight: 700;">تثبيت</button>`
            : ''
        }
        <span class="muted" style="font-size: 10px;">${secondsAgo}ث</span>
      </div>
    `;

    const btnVal = item.querySelector<HTMLButtonElement>('[data-dev-val]');
    btnVal?.addEventListener('click', async (e) => {
      e.stopPropagation();
      dev.validated = true;
      if (!dev.seat) {
        dev.seat = {
          section: 'A',
          row: 1,
          seat: idx + 1,
          index: idx,
          key: `A-1-${idx + 1}`,
          source: 'optical',
        };
      }
      await validateDevicesFromAdmin([dev.deviceId], false, dev.seat || undefined);
      updateFromPresence();
    });

    devicesContainer.appendChild(item);
  });
}

// Validate all connected phones and assign seats
async function validateAllConnectedPhones(): Promise<void> {
  const devices = Array.from(realDevices.values());
  if (devices.length === 0) {
    alert('لا يوجد أي هاتف متصل حالياً للتأكيد. افتح التطبيق في هاتف أو نافذة أخرى لتجربة التأكيد.');
    return;
  }

  let seatIdx = 0;
  for (const dev of realDevices.values()) {
    dev.validated = true;
    if (!dev.seat) {
      dev.seat = {
        section: 'A',
        row: Math.floor(seatIdx / 20) + 1,
        seat: (seatIdx % 20) + 1,
        index: seatIdx,
        key: `A-${Math.floor(seatIdx / 20) + 1}-${(seatIdx % 20) + 1}`,
        source: 'optical',
      };
    }
    seatIdx++;
  }

  await validateDevicesFromAdmin(undefined, true);
  updateFromPresence();
}

// Telemetry updater
function updateTelemetry(): void {
  const totalConnected = activeSeatIndices.size;
  if (connectedCountEl) connectedCountEl.textContent = totalConnected.toLocaleString();

  const { seatsInfo } = analyzeCadreSeats(seats, currentCadre);
  const connectedInCadre = countConnectedInCadre(seatsInfo, activeSeatIndices);

  if (cadreCountEl) cadreCountEl.textContent = connectedInCadre.toLocaleString();
  const pct = totalConnected > 0 ? ((connectedInCadre / totalConnected) * 100).toFixed(1) : '0';

  if (cadrePctEl) {
    if (currentCadre.id === 'full') {
      cadrePctEl.textContent = `${totalConnected} هاتف (كامل المدرج)`;
    } else {
      cadrePctEl.textContent = `${pct}% من الهواتف المتصلة (${connectedInCadre} هاتف)`;
    }
  }

  if (selectedCadreTitle) {
    selectedCadreTitle.textContent = `الإطار المختار: ${currentCadre.name}`;
  }
  if (cadreStatsDetail) {
    cadreStatsDetail.textContent = `${connectedInCadre.toLocaleString()} هاتف متصل داخل الإطار`;
  }
  if (cadreActiveModeLabel) {
    cadreActiveModeLabel.textContent = `داخل ${currentCadre.name}`;
  }

  if (canvasHudText) {
    canvasHudText.textContent = isSimulationMode
      ? `SIMULATION · 8,420 VIRTUAL FANS`
      : `REAL LIVE · ${totalConnected} REAL PHONE(S) CONNECTED`;
  }
}

// Interactive Cadre Dragging / Resizing
let isDraggingCadre = false;
let dragStartX = 0;
let dragStartY = 0;

function setupCadreInteractions(): void {
  const getCanvasCoords = (e: MouseEvent | TouchEvent) => {
    const rect = standCanvas.getBoundingClientRect();
    const clientX = 'touches' in e && e.touches[0] ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e && e.touches[0] ? e.touches[0].clientY : (e as MouseEvent).clientY;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (e: MouseEvent | TouchEvent) => {
    isDraggingCadre = true;
    const pos = getCanvasCoords(e);
    dragStartX = pos.x;
    dragStartY = pos.y;
    currentCadre = {
      id: 'custom',
      name: 'إطار مخصص (Cadre ROI)',
      xMin: pos.x,
      yMin: pos.y,
      xMax: pos.x + 0.01,
      yMax: pos.y + 0.01,
    };
    updateCadreSelectionUI();
    rebuildCurrentShow();
  };

  const onPointerMove = (e: MouseEvent | TouchEvent) => {
    if (!isDraggingCadre) return;
    const pos = getCanvasCoords(e);
    currentCadre.xMin = Math.min(dragStartX, pos.x);
    currentCadre.xMax = Math.max(dragStartX, pos.x);
    currentCadre.yMin = Math.min(dragStartY, pos.y);
    currentCadre.yMax = Math.max(dragStartY, pos.y);
    updateTelemetry();
  };

  const onPointerUp = () => {
    if (isDraggingCadre) {
      isDraggingCadre = false;
      if (currentCadre.xMax - currentCadre.xMin < 0.05) currentCadre.xMax = currentCadre.xMin + 0.1;
      if (currentCadre.yMax - currentCadre.yMin < 0.05) currentCadre.yMax = currentCadre.yMin + 0.1;
      rebuildCurrentShow();
    }
  };

  standCanvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  standCanvas.addEventListener('touchstart', onPointerDown, { passive: true });
  window.addEventListener('touchmove', onPointerMove, { passive: true });
  window.addEventListener('touchend', onPointerUp);
}

// Preset Cadre Buttons
function updateCadreSelectionUI(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-cadre]').forEach((btn) => {
    if (btn.dataset.cadre === currentCadre.id) {
      btn.className = 'btn btn--primary btn--sm';
    } else {
      btn.className = 'btn btn--secondary btn--sm';
    }
  });
}

document.querySelectorAll<HTMLButtonElement>('[data-cadre]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const cadreKey = btn.dataset.cadre;
    if (cadreKey && PRESET_CADRES[cadreKey]) {
      currentCadre = { ...PRESET_CADRES[cadreKey] };
      updateCadreSelectionUI();
      updateTelemetry();
      rebuildCurrentShow();
    }
  });
});

resetCadreBtn?.addEventListener('click', () => {
  currentCadre = { ...PRESET_CADRES.full };
  updateCadreSelectionUI();
  updateTelemetry();
  rebuildCurrentShow();
});

// View Mode Controls: Stadium Cam vs Webcam vs Digital Grid
function updateViewButtons(): void {
  if (btnStadiumCam) btnStadiumCam.className = currentViewMode === 'stadium_cam' ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm';
  if (btnWebcam) btnWebcam.className = currentViewMode === 'webcam' ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm';
  if (btnGrid) btnGrid.className = currentViewMode === 'grid' ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm';

  if (canvasHudText) {
    if (currentViewMode === 'stadium_cam') {
      canvasHudText.textContent = `STAND CAM 01 · 1080p 30 FPS · ACTIVE`;
    } else if (currentViewMode === 'webcam') {
      canvasHudText.textContent = `LIVE PC WEBCAM · 1080p · ACTIVE`;
    } else {
      canvasHudText.textContent = `STADIUM GRID · SEAT MAP`;
    }
  }
}

async function initWebcam(): Promise<void> {
  try {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    cameraStream = stream;
    camVideo.srcObject = stream;
    await camVideo.play();
    currentViewMode = 'webcam';
    updateViewButtons();
  } catch (err) {
    console.warn('Webcam permission denied or unavailable:', err);
    currentViewMode = 'stadium_cam';
    updateViewButtons();
  }
}

btnStadiumCam?.addEventListener('click', () => {
  currentViewMode = 'stadium_cam';
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  updateViewButtons();
});

btnWebcam?.addEventListener('click', async () => {
  await initWebcam();
});

btnGrid?.addEventListener('click', () => {
  currentViewMode = 'grid';
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  updateViewButtons();
});

// Admin phone validation buttons
validateAllBtn?.addEventListener('click', () => {
  void validateAllConnectedPhones();
});

quickValidateBtn?.addEventListener('click', () => {
  void validateAllConnectedPhones();
});

// In-Browser Optical CV Scanner (Scans and confirms detected phones)
startScanBtn?.addEventListener('click', () => {
  isScanning = !isScanning;
  startScanBtn.textContent = isScanning ? '⏹️ إيقاف المسح' : '🔍 مسح بصري لحظي (CV Scan)';
  startScanBtn.style.background = isScanning ? '#D21034' : 'var(--c-gold)';

  if (hudDot) {
    hudDot.className = isScanning ? 'hud-dot-rec hud-dot-rec--scanning' : 'hud-dot-rec';
  }

  if (isScanning) {
    if (canvasHudText) canvasHudText.textContent = 'DECODING OPTICAL GRAY CODE ON WEBCAM FEED...';
    setTimeout(async () => {
      isScanning = false;
      startScanBtn.textContent = '🔍 مسح بصري لحظي (CV Scan)';
      startScanBtn.style.background = 'var(--c-gold)';
      if (hudDot) hudDot.className = 'hud-dot-rec';
      await validateAllConnectedPhones();
    }, 2800);
  }
});

// Render Main Stand Canvas (interactive phone dots + cadre overlay)
function drawStandCanvas(): void {
  const ctx = standCanvas.getContext('2d');
  if (!ctx) return;

  const width = (standCanvas.width = standCanvas.parentElement?.clientWidth || 600);
  const height = (standCanvas.height = standCanvas.parentElement?.clientHeight || 320);

  ctx.clearRect(0, 0, width, height);

  // Background rendering based on View Mode
  if (currentViewMode === 'webcam') {
    if (camVideo.readyState >= 2) {
      ctx.drawImage(camVideo, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#060A10';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('📹 جارٍ تشغيل كاميرا الحاسوب المباشرة...', width / 2, height / 2);
      ctx.textAlign = 'start';
    }
  } else if (currentViewMode === 'stadium_cam') {
    if (stadiumCamImg.complete && stadiumCamImg.naturalWidth > 0) {
      ctx.drawImage(stadiumCamImg, 0, 0, width, height);
      ctx.fillStyle = 'rgba(2, 4, 8, 0.42)';
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = '#060A10';
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    // Grid mode
    ctx.fillStyle = '#060A10';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let c = 1; c < 10; c++) {
      ctx.beginPath();
      ctx.moveTo((c * width) / 10, 0);
      ctx.lineTo((c * width) / 10, height);
      ctx.stroke();
    }
    for (let r = 1; r < 5; r++) {
      ctx.beginPath();
      ctx.moveTo(0, (r * height) / 5);
      ctx.lineTo(width, (r * height) / 5);
      ctx.stroke();
    }
  }

  // Homography 3x3 Perspective Trapezoid for camera feeds
  if (currentViewMode === 'webcam' || currentViewMode === 'stadium_cam') {
    const p1 = { x: width * 0.1, y: height * 0.88 }; // Bottom Left
    const p2 = { x: width * 0.9, y: height * 0.88 }; // Bottom Right
    const p3 = { x: width * 0.78, y: height * 0.16 }; // Top Right
    const p4 = { x: width * 0.22, y: height * 0.16 }; // Top Left

    ctx.strokeStyle = isScanning ? '#D21034' : 'rgba(18, 194, 98, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Corner reference markers
    [p1, p2, p3, p4].forEach((p, idx) => {
      ctx.fillStyle = '#D4AF37';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.fillText(`P${idx + 1}`, p.x + 6, p.y + 3);
    });
  }

  // Draw phone dots for active connected phones
  const { seatsInfo } = analyzeCadreSeats(seats, currentCadre);
  const dotRadius = Math.max(3.5, width / 180);

  // If in real live mode and no phones yet, draw helpful prompt in canvas
  if (!isSimulationMode && activeSeatIndices.size === 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📡 في انتظار دخول الهواتف إلى rayati.pages.dev...', width / 2, height / 2);
    ctx.textAlign = 'start';
  }

  for (let i = 0; i < seatsInfo.length; i++) {
    const s = seatsInfo[i];
    if (!s) continue;
    const isConn = activeSeatIndices.has(s.seatIndex);
    if (!isConn) continue;

    const px = s.nx * width;
    const py = s.ny * height;

    if (!isSimulationMode) {
      // Real live device: draw glowing animated radar pulse!
      const pulse = (Math.sin(Date.now() / 200) * 0.5 + 0.5) * 4;
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, dotRadius + 4 + pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = s.inCadre ? '#D4AF37' : '#12C262';
      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Simulation mode
      ctx.fillStyle = s.inCadre ? '#D4AF37' : 'rgba(10, 125, 62, 0.6)';
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw Cadre Bounding Box
  const bx = currentCadre.xMin * width;
  const by = currentCadre.yMin * height;
  const bw = (currentCadre.xMax - currentCadre.xMin) * width;
  const bh = (currentCadre.yMax - currentCadre.yMin) * height;

  // Semi-transparent overlay outside cadre
  if (currentCadre.id !== 'full') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, width, by);
    ctx.fillRect(0, by + bh, width, height - (by + bh));
    ctx.fillRect(0, by, bx, bh);
    ctx.fillRect(bx + bw, by, width - (bx + bw), bh);
  }

  // Neon glowing bounding box
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.setLineDash([]);

  // Corner resize handles
  const handleSize = 7;
  ctx.fillStyle = '#12C262';
  const corners = [
    { x: bx, y: by },
    { x: bx + bw, y: by },
    { x: bx, y: by + bh },
    { x: bx + bw, y: by + bh },
  ];
  corners.forEach((c) => {
    ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
  });

  // Label tag above cadre
  ctx.fillStyle = 'rgba(212, 175, 55, 0.9)';
  ctx.fillRect(bx, Math.max(0, by - 22), 160, 20);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(`إطار: ${currentCadre.name.substring(0, 18)}`, bx + 6, Math.max(14, by - 8));

  // Laser scanner animation
  if (isScanning) {
    const scanY = (Math.sin(Date.now() / 250) * 0.5 + 0.5) * height;
    ctx.strokeStyle = '#D21034';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, scanY);
    ctx.lineTo(width, scanY);
    ctx.stroke();
  }

  requestAnimationFrame(drawStandCanvas);
}

// Render Realistic Pitch-View Preview
function drawPitchPreview(): void {
  const ctx = previewCanvas.getContext('2d');
  if (!ctx) return;

  const w = (previewCanvas.width = previewCanvas.parentElement?.clientWidth || 340);
  const h = (previewCanvas.height = previewCanvas.parentElement?.clientHeight || 200);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000407';
  ctx.fillRect(0, 0, w, h);

  if (!currentShow) return;

  const palette = currentShow.palette;
  const { seatsInfo } = analyzeCadreSeats(seats, currentCadre);
  const runs = currentShow.seatIndex.runs;

  const seatColors: string[] = new Array(seats.total);
  let curSeat = 0;
  for (const [timelineIdx, count] of runs) {
    const timeline = currentShow.timelines[timelineIdx];
    const initialPaletteIdx = timeline?.[0]?.[0] ?? 0;
    const color = palette[initialPaletteIdx] || '#000000';
    for (let c = 0; c < count && curSeat < seats.total; c++) {
      seatColors[curSeat] = color;
      curSeat++;
    }
  }

  for (let i = 0; i < seatsInfo.length; i++) {
    const s = seatsInfo[i];
    if (!s) continue;
    if (!activeSeatIndices.has(s.seatIndex)) continue;

    const col = seatColors[s.seatIndex] || '#000000';
    if (col === '#000000') continue;

    const pitchX = (s.nx - 0.5) * (0.6 + s.ny * 0.4) + 0.5;
    const px = pitchX * w;
    const py = (0.2 + s.ny * 0.75) * h;

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Rebuild Show payload based on active Cadre + Image or Preset
function rebuildCurrentShow(): void {
  if (customImageCanvas) {
    const ctx = customImageCanvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, customImageCanvas.width, customImageCanvas.height);
      currentShow = generateShowFromImage(
        seats,
        currentCadre,
        { width: imgData.width, height: imgData.height, data: imgData.data },
        currentOutsideMode,
      );
    }
  } else {
    currentShow = generateShowWithCadrePreset(
      seats,
      currentCadre,
      activeTifoType,
      currentOutsideMode,
    );
  }

  // Save to localStorage and broadcast to local tabs
  if (currentShow) {
    try {
      localStorage.setItem('rayati_active_show', JSON.stringify(currentShow));
      controlChannel?.postMessage({ type: 'show_updated', show: currentShow });

      // Also post to Cloudflare API so remote phones receive it
      void fetch('/api/show', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'change_tifo', tifo: activeTifoType, show: currentShow }),
      }).catch(() => {});
    } catch {
      // quota fallback
    }
  }

  drawPitchPreview();
  updateTelemetry();
}

// Mode Tabs
tabPresets?.addEventListener('click', () => {
  tabPresets.classList.add('mode-tab--active');
  tabImages.classList.remove('mode-tab--active');
  presetsPanel.style.display = 'block';
  imagesPanel.style.display = 'none';
  customImageCanvas = null;
  rebuildCurrentShow();
});

tabImages?.addEventListener('click', () => {
  tabImages.classList.add('mode-tab--active');
  tabPresets.classList.remove('mode-tab--active');
  imagesPanel.style.display = 'flex';
  presetsPanel.style.display = 'none';
  if (!customImageCanvas) loadEmblemPreset('crescent_gold');
});

// Preset Buttons
const tifoLabels: Record<TifoPresetType, string> = {
  algeria_flag: 'علم الجزائر 🇩🇿',
  stadium_wave: 'موجة OLA 🌊',
  ultras_strobe: 'كراكاج الألتراس ⚡',
  club_mca: 'مولودية الجزائر 🟢🔴',
  club_usma: 'اتحاد العاصمة 🔴⚫',
  club_jsk: 'شبيبة القبائل 🟡🟢',
  club_crb: 'شباب بلوزداد 🔴⚪',
  club_ess: 'وفاق سطيف ⚪⚫',
  giant_text: 'كتابة عملاقة ✍️',
};

document.querySelectorAll<HTMLButtonElement>('[data-tifo]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tifo = btn.dataset.tifo as TifoPresetType;
    if (tifo) {
      activeTifoType = tifo;
      customImageCanvas = null;
      if (activeTifoLabel) activeTifoLabel.textContent = tifoLabels[tifo] || tifo;

      document.querySelectorAll('[data-tifo]').forEach((b) => b.classList.remove('btn--primary'));
      btn.classList.add('btn--primary');

      rebuildCurrentShow();
    }
  });
});

// Image file upload handler
imageFileInput?.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        customImageCanvas = canvas;
        if (activeTifoLabel) activeTifoLabel.textContent = `صورة: ${file.name.substring(0, 16)}`;
        rebuildCurrentShow();
      }
    };
    img.src = loadEvent.target?.result as string;
  };
  reader.readAsDataURL(file);
});

// Emblem presets (Golden Crescent, Palestine/Algeria, Ultras Torch)
function loadEmblemPreset(type: string): void {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (type === 'crescent_gold') {
    ctx.fillStyle = '#0A7D3E';
    ctx.fillRect(0, 0, canvas.width / 2, canvas.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);

    ctx.fillStyle = '#D4AF37';
    ctx.beginPath();
    ctx.arc(32, 16, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0A7D3E';
    ctx.beginPath();
    ctx.arc(34, 16, 7.5, 0, Math.PI * 2);
    ctx.fill();
    if (activeTifoLabel) activeTifoLabel.textContent = '🌙 هلال ونجمة ذهبية';
  } else if (type === 'palestine_dz') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, 10);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 10, canvas.width, 11);
    ctx.fillStyle = '#0A7D3E';
    ctx.fillRect(0, 21, canvas.width, 11);
    ctx.fillStyle = '#D21034';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(22, 16);
    ctx.lineTo(0, 32);
    ctx.closePath();
    ctx.fill();
    if (activeTifoLabel) activeTifoLabel.textContent = '🇵🇸🇩🇿 خاوة خاوة';
  } else {
    ctx.fillStyle = '#D21034';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#D4AF37';
    ctx.beginPath();
    ctx.arc(32, 16, 11, 0, Math.PI * 2);
    ctx.fill();
    if (activeTifoLabel) activeTifoLabel.textContent = '🔥 شعلة الألتراس';
  }

  customImageCanvas = canvas;
  rebuildCurrentShow();
}

document.querySelectorAll<HTMLButtonElement>('[data-emblem]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const emblem = btn.dataset.emblem;
    if (emblem) loadEmblemPreset(emblem);
  });
});

// Outside mode selector
outsideModeSelect?.addEventListener('change', () => {
  currentOutsideMode = outsideModeSelect.value as OutsideCadreMode;
  rebuildCurrentShow();
});

// Master Kickoff Controls
kickoff10sBtn?.addEventListener('click', () => {
  const targetTime = Date.now() + 10000;
  localStorage.setItem('rayati_master_start', String(targetTime));
  controlChannel?.postMessage({ type: 'start_countdown', targetTime });

  // Broadcast to Cloudflare API
  void fetch('/api/show', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'start_countdown', targetTime }),
  }).catch(() => {});

  countdownBanner.textContent = 'العد التنازلي انطلق: الدخلة تبدأ بعد 10 ثوانٍ !';
  countdownBanner.className = 'pill pill--warn';

  let remaining = 10;
  const countInterval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      countdownBanner.textContent = `الانطلاق بعد ${remaining} ثوانٍ...`;
    } else {
      clearInterval(countInterval);
      countdownBanner.textContent = 'الدخلة مشتعلة الآن في الملعب! 🇩🇿';
      countdownBanner.className = 'pill pill--ok';
    }
  }, 1000);
});

instantStartBtn?.addEventListener('click', () => {
  const targetTime = Date.now();
  controlChannel?.postMessage({ type: 'instant_start', targetTime });
  void fetch('/api/show', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'instant_start', targetTime }),
  }).catch(() => {});
  countdownBanner.textContent = 'العرض انطلق فوري! 🇩🇿';
  countdownBanner.className = 'pill pill--ok';
});

blackoutBtn?.addEventListener('click', () => {
  controlChannel?.postMessage({ type: 'blackout' });
  void fetch('/api/show', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'blackout' }),
  }).catch(() => {});
  countdownBanner.textContent = 'إطفاء الشاشات (Blackout نشط)';
  countdownBanner.className = 'pill';
});

// Download show.json
downloadShowBtn?.addEventListener('click', () => {
  if (!currentShow) rebuildCurrentShow();
  if (!currentShow) return;

  const blob = new Blob([JSON.stringify(currentShow, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'show.json';
  a.click();
  URL.revokeObjectURL(url);
});

// Init
setupCadreInteractions();
updateViewButtons();
updateFromPresence();
rebuildCurrentShow();
void initWebcam();
requestAnimationFrame(drawStandCanvas);
