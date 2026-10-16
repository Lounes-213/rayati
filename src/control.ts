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
import type { ShowFile } from './core/types';

const seats = prepareSeats(seatsJson as never);

// DOM Elements
const standCanvas = document.getElementById('standCanvas') as HTMLCanvasElement;
const previewCanvas = document.getElementById('previewCanvas') as HTMLCanvasElement;
const camVideo = document.getElementById('camVideo') as HTMLVideoElement;
const viewToggleBtn = document.getElementById('viewToggleBtn') as HTMLButtonElement;
const startScanBtn = document.getElementById('startScanBtn') as HTMLButtonElement;
const resetCadreBtn = document.getElementById('resetCadreBtn') as HTMLButtonElement;

const connectedCountEl = document.getElementById('connectedCount') as HTMLElement;
const cadreCountEl = document.getElementById('cadreCount') as HTMLElement;
const cadrePctEl = document.getElementById('cadrePct') as HTMLElement;
const activeTifoLabel = document.getElementById('activeTifoLabel') as HTMLElement;
const cadreActiveModeLabel = document.getElementById('cadreActiveModeLabel') as HTMLElement;
const selectedCadreTitle = document.getElementById('selectedCadreTitle') as HTMLElement;
const cadreStatsDetail = document.getElementById('cadreStatsDetail') as HTMLElement;
const canvasHudText = document.getElementById('canvasHudText') as HTMLElement;
const hudDot = document.getElementById('hudDot') as HTMLElement;

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

// State
let isCameraView = false;
let cameraStream: MediaStream | null = null;
let isScanning = false;
let currentOutsideMode: OutsideCadreMode = 'black';
let activeTifoType: TifoPresetType = 'algeria_flag';
let currentCadre: CadreBox = { ...PRESET_CADRES.full };
let currentShow: ShowFile | null = null;
let customImageCanvas: HTMLCanvasElement | null = null;

// Simulated connected seats set (8,420 randomly assigned connected phones)
const connectedSeats = new Set<number>();
const totalStadiumSeats = seats.total;
const initialTarget = 8420;
while (connectedSeats.size < initialTarget) {
  connectedSeats.add(Math.floor(Math.random() * totalStadiumSeats));
}

// BroadcastChannel for live inter-tab synchronization
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rayati_control') : null;

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

// Fluctuate connected phones slightly (+1 to 3 fans arriving)
setInterval(() => {
  if (connectedSeats.size < totalStadiumSeats - 50) {
    for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) {
      connectedSeats.add(Math.floor(Math.random() * totalStadiumSeats));
    }
    updateTelemetry();
  }
}, 4000);

// Telemetry updater
function updateTelemetry(): void {
  const totalConnected = connectedSeats.size;
  if (connectedCountEl) connectedCountEl.textContent = totalConnected.toLocaleString();

  const { seatsInfo } = analyzeCadreSeats(seats, currentCadre);
  const connectedInCadre = countConnectedInCadre(seatsInfo, connectedSeats);

  if (cadreCountEl) cadreCountEl.textContent = connectedInCadre.toLocaleString();
  const pct = totalConnected > 0 ? ((connectedInCadre / totalConnected) * 100).toFixed(1) : '0';

  if (cadrePctEl) {
    if (currentCadre.id === 'full') {
      cadrePctEl.textContent = '100% من الحاضرين (كامل المدرج)';
    } else {
      cadrePctEl.textContent = `${pct}% من مجمل الهواتف المتصلة`;
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
      // Ensure minimum box size
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

// View Toggle: Stadium Grid vs Camera
async function toggleView(): Promise<void> {
  isCameraView = !isCameraView;
  if (isCameraView) {
    viewToggleBtn.textContent = '🗺️ مخطط المدرج';
    camVideo.style.display = 'block';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
      });
      cameraStream = stream;
      camVideo.srcObject = stream;
      if (canvasHudText) canvasHudText.textContent = 'STAND CAM · 1080p FEED';
    } catch {
      camVideo.style.display = 'none';
      isCameraView = false;
      viewToggleBtn.textContent = '📹 الكاميرا';
      alert('لم يتم العثور على كاميرا أو تعذر الحصول على الإذن. استمرار وضع مخطط المدرج.');
    }
  } else {
    viewToggleBtn.textContent = '📹 الكاميرا';
    camVideo.style.display = 'none';
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    if (canvasHudText) canvasHudText.textContent = `STADIUM GRID · ${connectedSeats.size} PHONES`;
  }
}
viewToggleBtn?.addEventListener('click', () => void toggleView());

// In-Browser Optical CV Scanner simulation
startScanBtn?.addEventListener('click', () => {
  isScanning = !isScanning;
  startScanBtn.textContent = isScanning ? '⏹️ إيقاف المسح' : '⚡ مسح ضوئي لحظي وتحديث الهواتف (In-Browser CV)';
  startScanBtn.style.background = isScanning ? '#D21034' : 'var(--c-gold)';

  if (hudDot) {
    hudDot.className = isScanning ? 'hud-dot-rec hud-dot-rec--scanning' : 'hud-dot-rec';
  }

  if (isScanning) {
    if (canvasHudText) canvasHudText.textContent = 'DECODING GRAY CODE BLOBS & HOMOGRAPHY...';
    setTimeout(() => {
      isScanning = false;
      startScanBtn.textContent = '⚡ مسح ضوئي لحظي وتحديث الهواتف (In-Browser CV)';
      startScanBtn.style.background = 'var(--c-gold)';
      if (hudDot) hudDot.className = 'hud-dot-rec';
      if (canvasHudText) canvasHudText.textContent = `STADIUM GRID · ${connectedSeats.size} PHONES ACTIVE`;
      alert(`اكتمل المسح البصري لـ ${connectedSeats.size.toLocaleString()} هاتف وتحديث خريطة المقاعد بنجاح! 🇩🇿`);
    }, 4000);
  }
});

// Render Main Stand Canvas (interactive phone dots + cadre overlay)
function drawStandCanvas(): void {
  const ctx = standCanvas.getContext('2d');
  if (!ctx) return;

  const width = (standCanvas.width = standCanvas.parentElement?.clientWidth || 600);
  const height = (standCanvas.height = standCanvas.parentElement?.clientHeight || 320);

  ctx.clearRect(0, 0, width, height);

  // Background stadium stands representation
  if (!isCameraView) {
    ctx.fillStyle = '#060A10';
    ctx.fillRect(0, 0, width, height);

    // Section grid guidelines
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

  // Draw connected phone dots
  const { seatsInfo } = analyzeCadreSeats(seats, currentCadre);
  const dotRadius = Math.max(1.5, width / 240);

  for (let i = 0; i < seatsInfo.length; i += 3) {
    // sample every 3rd seat for performant 60fps rendering
    const s = seatsInfo[i];
    if (!s) continue;
    const isConn = connectedSeats.has(s.seatIndex);
    if (!isConn) continue;

    const px = s.nx * width;
    const py = s.ny * height;

    if (s.inCadre) {
      ctx.fillStyle = '#D4AF37'; // Golden phone in cadre
    } else {
      ctx.fillStyle = 'rgba(10, 125, 62, 0.6)'; // Subtle emerald phone outside
    }
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw Cadre Bounding Box
  const bx = currentCadre.xMin * width;
  const by = currentCadre.yMin * height;
  const bw = (currentCadre.xMax - currentCadre.xMin) * width;
  const bh = (currentCadre.yMax - currentCadre.yMin) * height;

  // Semi-transparent overlay outside cadre
  if (currentCadre.id !== 'full') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    // Top
    ctx.fillRect(0, 0, width, by);
    // Bottom
    ctx.fillRect(0, by + bh, width, height - (by + bh));
    // Left
    ctx.fillRect(0, by, bx, bh);
    // Right
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

  // Draw perspective rows representing the grandstand illuminated by phones
  const palette = currentShow.palette;
  const { seatsInfo } = analyzeCadreSeats(seats, currentCadre);
  const runs = currentShow.seatIndex.runs;

  // Expand first tick colors
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

  // Draw crowd dots with glow
  for (let i = 0; i < seatsInfo.length; i += 4) {
    const s = seatsInfo[i];
    if (!s) continue;
    if (!connectedSeats.has(s.seatIndex)) continue;

    const col = seatColors[s.seatIndex] || '#000000';
    if (col === '#000000') continue;

    // Perspective projection from pitch
    const pitchX = (s.nx - 0.5) * (0.6 + s.ny * 0.4) + 0.5;
    const px = pitchX * w;
    const py = (0.2 + s.ny * 0.75) * h;

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
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

  // Save to localStorage for instant local tab sync
  if (currentShow) {
    try {
      localStorage.setItem('rayati_active_show', JSON.stringify(currentShow));
      channel?.postMessage({ type: 'show_updated', show: currentShow });
    } catch {
      // quota limit fallback
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
  // If no custom image yet, generate default emblem
  if (!customImageCanvas) {
    loadEmblemPreset('crescent_gold');
  }
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
    // Elegant Golden Crescent and Star
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
    // Palestine & Algerian brother flag stripes
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, 10);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 10, canvas.width, 11);
    ctx.fillStyle = '#0A7D3E';
    ctx.fillRect(0, 21, canvas.width, 11);
    // Red triangle
    ctx.fillStyle = '#D21034';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(22, 16);
    ctx.lineTo(0, 32);
    ctx.closePath();
    ctx.fill();
    if (activeTifoLabel) activeTifoLabel.textContent = '🇵🇸🇩🇿 خاوة خاوة';
  } else {
    // Ultras Pyro Flame
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
  channel?.postMessage({ type: 'start_countdown', targetTime });

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
  channel?.postMessage({ type: 'instant_start', targetTime });
  countdownBanner.textContent = 'العرض انطلق فوري! 🇩🇿';
  countdownBanner.className = 'pill pill--ok';
});

blackoutBtn?.addEventListener('click', () => {
  channel?.postMessage({ type: 'blackout' });
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
updateTelemetry();
rebuildCurrentShow();
requestAnimationFrame(drawStandCanvas);
