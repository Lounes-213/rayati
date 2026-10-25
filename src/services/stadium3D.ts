import * as THREE from 'three';
import { realtimeSync, type RealtimeCommand } from './realtimeSync';

export type TifoPattern3D = 'algeria' | 'rayti_r' | 'wave' | 'gold_cyan' | 'strobe';
export type CameraView3D = 'virage' | 'field' | 'overhead';

export interface Stadium3DController {
  setPattern(pattern: TifoPattern3D): void;
  setNightMode(night: boolean): void;
  setCameraView(view: CameraView3D): void;
  destroy(): void;
}

export function createStadium3D(canvas: HTMLCanvasElement): Stadium3DController {
  const width = canvas.clientWidth || 800;
  const height = canvas.clientHeight || 450;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b14);
  scene.fog = new THREE.FogExp2(0x070b14, 0.015);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 1000);
  camera.position.set(0, 32, 65);
  camera.lookAt(0, 10, -5);

  let renderer: THREE.WebGLRenderer | null = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Ambient & Floodlights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const floodlight1 = new THREE.DirectionalLight(0xdcfce7, 1.8);
  floodlight1.position.set(40, 50, 40);
  scene.add(floodlight1);

  const floodlight2 = new THREE.DirectionalLight(0x67e8f9, 1.2);
  floodlight2.position.set(-40, 50, 40);
  scene.add(floodlight2);

  // Football Pitch Canvas Texture
  const pitchCanvas = document.createElement('canvas');
  pitchCanvas.width = 512;
  pitchCanvas.height = 320;
  const pCtx = pitchCanvas.getContext('2d');
  if (pCtx) {
    pCtx.fillStyle = '#064e3b';
    pCtx.fillRect(0, 0, 512, 320);
    // Stripes
    for (let i = 0; i < 512; i += 32) {
      pCtx.fillStyle = i % 64 === 0 ? '#047857' : '#059669';
      pCtx.fillRect(i, 0, 32, 320);
    }
    // Lines
    pCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    pCtx.lineWidth = 3;
    pCtx.strokeRect(20, 20, 472, 280);
    pCtx.beginPath();
    pCtx.moveTo(256, 20);
    pCtx.lineTo(256, 300);
    pCtx.stroke();
    pCtx.beginPath();
    pCtx.arc(256, 160, 40, 0, Math.PI * 2);
    pCtx.stroke();
  }
  const pitchTexture = new THREE.CanvasTexture(pitchCanvas);
  const pitchGeo = new THREE.PlaneGeometry(75, 45);
  const pitchMat = new THREE.MeshStandardMaterial({ map: pitchTexture, roughness: 0.8 });
  const pitch = new THREE.Mesh(pitchGeo, pitchMat);
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0, -15);
  scene.add(pitch);

  // Stadium Grandstand Tiers (Curved amphitheater of pixels)
  const COLS = 60; // 60 columns wide
  const ROWS = 35; // 35 rows high
  const TOTAL_SEATS = COLS * ROWS; // 2,100 seats

  const seatBoxGeo = new THREE.BoxGeometry(0.85, 0.6, 0.6);
  const seatMat = new THREE.MeshStandardMaterial({
    roughness: 0.2,
    metalness: 0.1,
    vertexColors: true,
  });

  const instancedSeats = new THREE.InstancedMesh(seatBoxGeo, seatMat, TOTAL_SEATS);
  const dummy = new THREE.Object3D();
  const seatPositions: Array<{ x: number; y: number; z: number; row: number; col: number }> = [];

  const arcRadius = 55;
  const arcAngle = Math.PI * 0.75; // 135-degree stadium arc

  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    const tierElev = 1.5 + r * 0.75;
    const tierRadius = arcRadius + r * 0.65;

    for (let c = 0; c < COLS; c++) {
      const angle = -arcAngle / 2 + (c / (COLS - 1)) * arcAngle;
      const x = Math.sin(angle) * tierRadius;
      const z = Math.cos(angle) * tierRadius - 35;
      const y = tierElev;

      dummy.position.set(x, y, z);
      dummy.rotation.y = angle + Math.PI;
      dummy.rotation.x = 0.25;
      dummy.updateMatrix();

      instancedSeats.setMatrixAt(idx, dummy.matrix);
      seatPositions.push({ x, y, z, row: r, col: c });
      idx++;
    }
  }

  instancedSeats.instanceMatrix.needsUpdate = true;
  scene.add(instancedSeats);

  // Patterns Color Logic
  let currentPattern: TifoPattern3D = 'algeria';
  const colorObj = new THREE.Color();

  function applySeatColors(timeSec: number): void {
    if (!instancedSeats) return;

    for (let i = 0; i < TOTAL_SEATS; i++) {
      const seat = seatPositions[i];
      const normCol = seat.col / COLS;
      const normRow = seat.row / ROWS;

      if (currentPattern === 'algeria') {
        // Algerian National Flag: Left emerald green, right pure white, center ruby red crescent & star
        if (normCol < 0.46) {
          colorObj.set('#00A859'); // Emerald Green
        } else if (normCol > 0.54) {
          colorObj.set('#FFFFFF'); // Pure White
        } else {
          // Center band: red crescent zone
          const distToCenter = Math.hypot(normCol - 0.5, normRow - 0.5);
          if (distToCenter < 0.18) {
            colorObj.set('#D21034'); // Ruby Red
          } else {
            colorObj.set(normCol < 0.5 ? '#00A859' : '#FFFFFF');
          }
        }
      } else if (currentPattern === 'rayti_r') {
        // Pixel R Monogram
        const inStem = normCol >= 0.25 && normCol <= 0.35 && normRow >= 0.2 && normRow <= 0.8;
        const inTopBar = normCol >= 0.35 && normCol <= 0.65 && normRow >= 0.65 && normRow <= 0.8;
        const inMidBar = normCol >= 0.35 && normCol <= 0.65 && normRow >= 0.45 && normRow <= 0.55;
        const inLoopRight = normCol >= 0.6 && normCol <= 0.7 && normRow >= 0.55 && normRow <= 0.75;
        const inLeg = normCol >= 0.45 && normCol <= 0.72 && normRow >= 0.2 && normRow <= 0.45 && Math.abs((normCol - 0.45) - (0.45 - normRow)) < 0.12;

        if (inStem || inTopBar || inMidBar || inLoopRight || inLeg) {
          colorObj.set('#00A859'); // Pixel Green
        } else {
          colorObj.set('#0B132B'); // Dark Stadium Obsidian
        }
      } else if (currentPattern === 'wave') {
        // Dynamic Sine Wave Light Propagation
        const waveVal = Math.sin(normCol * 8 - timeSec * 4 + normRow * 2);
        if (waveVal > 0.4) {
          colorObj.set('#38BDF8'); // Cyan Light Wave
        } else if (waveVal > -0.2) {
          colorObj.set('#00A859'); // Emerald Green
        } else {
          colorObj.set('#0E1726'); // Dim Dark
        }
      } else if (currentPattern === 'gold_cyan') {
        if ((seat.row + seat.col) % 4 < 2) {
          colorObj.set('#F59E0B'); // Gold
        } else {
          colorObj.set('#38BDF8'); // Cyan
        }
      } else if (currentPattern === 'strobe') {
        // Strobe flash
        const flash = Math.sin(timeSec * 8) > 0.3;
        colorObj.set(flash ? '#FFFFFF' : '#00A859');
      }

      instancedSeats.setColorAt(i, colorObj);
    }
    if (instancedSeats.instanceColor) {
      instancedSeats.instanceColor.needsUpdate = true;
    }
  }

  // Subscribe to Live Realtime Beats & State
  const unsubRealtime = realtimeSync.subscribe((cmd: RealtimeCommand) => {
    if (cmd.type === 'beat') {
      if (cmd.effect === 'strobe') {
        currentPattern = 'strobe';
        setTimeout(() => {
          currentPattern = 'algeria';
        }, 120);
      } else if (cmd.effect === 'wave') {
        currentPattern = 'wave';
      }
    } else if (cmd.type === 'blackout') {
      for (let i = 0; i < TOTAL_SEATS; i++) {
        colorObj.set('#000000');
        instancedSeats.setColorAt(i, colorObj);
      }
      if (instancedSeats.instanceColor) instancedSeats.instanceColor.needsUpdate = true;
    }
  });

  // Interactive Drag & Orbit
  let isDragging = false;
  let prevMouseX = 0;
  let prevMouseY = 0;
  let targetAngleY = 0;
  let targetAngleX = 0.3;
  let currentAngleY = 0;
  let currentAngleX = 0.3;
  let zoomDist = 65;

  const onPointerDown = (e: PointerEvent) => {
    isDragging = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - prevMouseX;
    const deltaY = e.clientY - prevMouseY;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;

    targetAngleY += deltaX * 0.008;
    targetAngleX = Math.max(0.1, Math.min(1.1, targetAngleX - deltaY * 0.008));
  };

  const onPointerUp = (e: PointerEvent) => {
    isDragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomDist = Math.max(30, Math.min(110, zoomDist + e.deltaY * 0.05));
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Render Loop
  let reqId = 0;
  const clock = new THREE.Clock();

  function animate(): void {
    if (!renderer) return;
    reqId = requestAnimationFrame(animate);

    const elapsed = clock.getElapsedTime();

    // Smooth camera interpolation
    currentAngleY += (targetAngleY - currentAngleY) * 0.08;
    currentAngleX += (targetAngleX - currentAngleX) * 0.08;

    // Gentle camera breathing drift if not dragging
    const driftY = isDragging ? 0 : Math.sin(elapsed * 0.3) * 0.05;

    camera.position.x = Math.sin(currentAngleY + driftY) * Math.cos(currentAngleX) * zoomDist;
    camera.position.z = Math.cos(currentAngleY + driftY) * Math.cos(currentAngleX) * zoomDist;
    camera.position.y = Math.sin(currentAngleX) * zoomDist + 10;
    camera.lookAt(0, 8, -5);

    applySeatColors(elapsed);
    renderer.render(scene, camera);
  }

  animate();

  // Resize observer
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const cr = entry.contentRect;
      if (cr.width > 0 && cr.height > 0 && renderer) {
        camera.aspect = cr.width / cr.height;
        camera.updateProjectionMatrix();
        renderer.setSize(cr.width, cr.height, false);
      }
    }
  });
  resizeObserver.observe(canvas.parentElement || canvas);

  return {
    setPattern(pattern: TifoPattern3D) {
      currentPattern = pattern;
    },
    setNightMode(night: boolean) {
      if (night) {
        scene.background = new THREE.Color(0x05080e);
        ambientLight.intensity = 0.3;
        floodlight1.intensity = 1.2;
        floodlight2.intensity = 0.9;
      } else {
        scene.background = new THREE.Color(0x0f172a);
        ambientLight.intensity = 0.8;
        floodlight1.intensity = 2.0;
        floodlight2.intensity = 1.5;
      }
    },
    setCameraView(view: CameraView3D) {
      if (view === 'virage') {
        targetAngleY = 0;
        targetAngleX = 0.35;
        zoomDist = 58;
      } else if (view === 'field') {
        targetAngleY = Math.PI * 0.95;
        targetAngleX = 0.18;
        zoomDist = 48;
      } else if (view === 'overhead') {
        targetAngleY = 0;
        targetAngleX = 1.05;
        zoomDist = 80;
      }
    },
    destroy() {
      cancelAnimationFrame(reqId);
      unsubRealtime();
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      if (renderer) {
        renderer.dispose();
        renderer = null;
      }
    },
  };
}
