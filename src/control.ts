import './ui/styles/base.css';
import { generateTifoShow, type TifoPresetType } from './services/tifoStudio';
import { prepareSeats } from './domain/seat';
import seatsJson from '../public/seats.json';

const seats = prepareSeats(seatsJson as never);

// DOM elements
const camVideo = document.getElementById('camVideo') as HTMLVideoElement;
const camCanvas = document.getElementById('camCanvas') as HTMLCanvasElement;
const toggleCamBtn = document.getElementById('toggleCamBtn') as HTMLButtonElement;
const startScanBtn = document.getElementById('startScanBtn') as HTMLButtonElement;
const masterClock = document.getElementById('masterClock') as HTMLElement;
const countdownBanner = document.getElementById('countdownBanner') as HTMLElement;
const kickoff10sBtn = document.getElementById('kickoff10sBtn') as HTMLButtonElement;
const instantStartBtn = document.getElementById('instantStartBtn') as HTMLButtonElement;
const blackoutBtn = document.getElementById('blackoutBtn') as HTMLButtonElement;
const activeTifoLabel = document.getElementById('activeTifoLabel') as HTMLElement;
const downloadShowBtn = document.getElementById('downloadShowBtn') as HTMLButtonElement;
const connectedCountEl = document.getElementById('connectedCount') as HTMLElement;
const camHudText = document.getElementById('camHudText') as HTMLElement;

let currentStream: MediaStream | null = null;
let isScanning = false;
let currentTifoType: TifoPresetType = 'algeria_flag';
let connectedFans = 8420;

// Broadcast channel for local multi-tab/device sync
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rayati_control') : null;

// Clock ticker
function updateClock(): void {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
  if (masterClock) masterClock.textContent = `${h}:${m}:${s}.${ms}`;
}
setInterval(updateClock, 50);

// Gentle connected fan fluctuation simulation (+/- random fans)
setInterval(() => {
  if (connectedFans < 9850) {
    connectedFans += Math.floor(Math.random() * 5);
    if (connectedCountEl) connectedCountEl.textContent = connectedFans.toLocaleString();
  }
}, 3000);

// Camera management
async function toggleCamera(): Promise<void> {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
    camVideo.srcObject = null;
    if (camHudText) camHudText.textContent = 'STAND CAM · OFF';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    currentStream = stream;
    camVideo.srcObject = stream;
    if (camHudText) camHudText.textContent = 'STAND CAM · 1080p 30 FPS ACTIVE';
    drawHomographyOverlay();
  } catch {
    alert('تعذر فتح الكاميرا، يرجى السماح بالإذن في المتصفح أو التأكد من توصيل الكاميرا.');
  }
}

toggleCamBtn?.addEventListener('click', () => void toggleCamera());

// Homography Perspective Overlay on Canvas
function drawHomographyOverlay(): void {
  const canvasCtx = camCanvas.getContext('2d');
  if (!canvasCtx) return;

  function loop() {
    if (!canvasCtx) return;
    camCanvas.width = camCanvas.parentElement?.clientWidth || 400;
    camCanvas.height = camCanvas.parentElement?.clientHeight || 280;
    canvasCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

    const w = camCanvas.width;
    const h = camCanvas.height;

    // 4 Homography reference points of the grandstand
    const p1 = { x: w * 0.12, y: h * 0.85 }; // Bottom-Left
    const p2 = { x: w * 0.88, y: h * 0.85 }; // Bottom-Right
    const p3 = { x: w * 0.76, y: h * 0.22 }; // Top-Right
    const p4 = { x: w * 0.24, y: h * 0.22 }; // Top-Left

    // Draw perspective polygon
    canvasCtx.strokeStyle = isScanning ? '#D21034' : '#12C262';
    canvasCtx.lineWidth = 2;
    canvasCtx.setLineDash([6, 4]);
    canvasCtx.beginPath();
    canvasCtx.moveTo(p1.x, p1.y);
    canvasCtx.lineTo(p2.x, p2.y);
    canvasCtx.lineTo(p3.x, p3.y);
    canvasCtx.lineTo(p4.x, p4.y);
    canvasCtx.closePath();
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);

    // Draw corner markers
    const corners = [p1, p2, p3, p4];
    corners.forEach((pt, idx) => {
      canvasCtx.fillStyle = '#D4AF37';
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      canvasCtx.fill();
      canvasCtx.fillStyle = '#fff';
      canvasCtx.font = '10px monospace';
      canvasCtx.fillText(`P${idx + 1}`, pt.x + 8, pt.y + 4);
    });

    if (isScanning) {
      // Draw simulated scanning line moving up and down
      const scanY = (Math.sin(Date.now() / 200) * 0.5 + 0.5) * (h * 0.63) + h * 0.22;
      canvasCtx.strokeStyle = '#D4AF37';
      canvasCtx.lineWidth = 2;
      canvasCtx.beginPath();
      canvasCtx.moveTo(w * 0.2, scanY);
      canvasCtx.lineTo(w * 0.8, scanY);
      canvasCtx.stroke();

      canvasCtx.fillStyle = 'rgba(210, 16, 52, 0.85)';
      canvasCtx.fillRect(w / 2 - 60, 14, 120, 22);
      canvasCtx.fillStyle = '#fff';
      canvasCtx.font = 'bold 11px sans-serif';
      canvasCtx.textAlign = 'center';
      canvasCtx.fillText('SCANNING BLOBS...', w / 2, 29);
      canvasCtx.textAlign = 'start';
    }

    requestAnimationFrame(loop);
  }
  loop();
}

// Start Optical Scanner
startScanBtn?.addEventListener('click', () => {
  isScanning = !isScanning;
  startScanBtn.textContent = isScanning ? '⏹️ إيقاف المسح البصري' : '⚡ بدء المسح الضوئي وتصحيح المقاعد';
  startScanBtn.style.background = isScanning ? '#D21034' : 'var(--c-gold)';

  if (isScanning) {
    if (camHudText) camHudText.textContent = 'SCANNING · GRAY CODE DECODING IN PROGRESS';
    setTimeout(() => {
      isScanning = false;
      startScanBtn.textContent = '⚡ بدء المسح الضوئي وتصحيح المقاعد';
      startScanBtn.style.background = 'var(--c-gold)';
      if (camHudText) camHudText.textContent = 'STAND CAM · 1080p 30 FPS ACTIVE';
      alert('تم اكتمال المسح البصري لـ 8,420 هاتف وتحديث خريطة المقاعد بنجاح! 🇩🇿');
    }, 6000);
  }
});

// Kickoff 10s Countdown Trigger
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

// Instant Start
instantStartBtn?.addEventListener('click', () => {
  const targetTime = Date.now();
  channel?.postMessage({ type: 'instant_start', targetTime });
  countdownBanner.textContent = 'العرض انطلق فوري! 🇩🇿';
  countdownBanner.className = 'pill pill--ok';
});

// Blackout emergency
blackoutBtn?.addEventListener('click', () => {
  channel?.postMessage({ type: 'blackout' });
  countdownBanner.textContent = 'إطفاء الشاشات (Blackout نشط)';
  countdownBanner.className = 'pill';
});

// Tifo Preset Switcher
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
      currentTifoType = tifo;
      if (activeTifoLabel) activeTifoLabel.textContent = tifoLabels[tifo] || tifo;
      channel?.postMessage({ type: 'change_tifo', tifo });

      // Visual feedback
      document.querySelectorAll('[data-tifo]').forEach((b) => b.classList.remove('btn--primary'));
      btn.classList.add('btn--primary');
    }
  });
});

// Download show.json
downloadShowBtn?.addEventListener('click', () => {
  const show = generateTifoShow(seats, {
    type: currentTifoType,
    name: `Rayati-${currentTifoType}`,
    durationMs: 30000,
  });

  const blob = new Blob([JSON.stringify(show, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'show.json';
  a.click();
  URL.revokeObjectURL(url);
});
