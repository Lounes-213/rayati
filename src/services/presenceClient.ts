import type { SeatSelection, ShowFile } from '../core/types';

export interface PresenceDevice {
  deviceId: string;
  seat: SeatSelection | null;
  userAgent?: string;
  lastSeen: number;
  validated?: boolean;
}

export interface PresenceResponse {
  count: number;
  devices: PresenceDevice[];
  now: number;
}

export function getDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'dev_temp';
  let id = localStorage.getItem('rayati_device_id');
  if (!id) {
    id = `phone_${Math.random().toString(36).substring(2, 8)}`;
    localStorage.setItem('rayati_device_id', id);
  }
  return id;
}

const localChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rayati_presence') : null;

/**
 * Starts automatic presence heartbeat for this phone, and listens for camera confirmation.
 */
export function startPresenceHeartbeat(
  getSeat: () => SeatSelection | null | undefined,
  onValidated?: (seat: SeatSelection) => void,
): () => void {
  const deviceId = getDeviceId();
  let isAlreadyValidated = false;

  // Listen to instant local validation channel (for multi-tab / local tests)
  localChannel?.addEventListener('message', (ev) => {
    if (ev.data?.type === 'validate_phone') {
      if (ev.data.validateAll || ev.data.deviceId === deviceId) {
        if (!isAlreadyValidated && ev.data.seat) {
          isAlreadyValidated = true;
          onValidated?.(ev.data.seat);
        }
      }
    }
  });

  const sendHeartbeat = async () => {
    const seat = getSeat() || null;
    const payload: PresenceDevice = {
      deviceId,
      seat,
      lastSeen: Date.now(),
      validated: isAlreadyValidated,
    };

    // 1. Fast local lane for multi-tab testing
    try {
      localChannel?.postMessage({ type: 'heartbeat', device: payload });
    } catch {
      // ignore
    }

    // 2. Global Cloudflare API for real mobile phones on 4G / Wi-Fi
    try {
      const res = await fetch('/api/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = (await res.json()) as { validated?: boolean; seat?: SeatSelection };
        if (data.validated && !isAlreadyValidated && data.seat) {
          isAlreadyValidated = true;
          onValidated?.(data.seat);
        }
      }
    } catch {
      // offline / stadium network loss tolerated
    }
  };

  // Immediate ping then repeat every 2.5 seconds
  void sendHeartbeat();
  const timer = setInterval(() => void sendHeartbeat(), 2500);

  return () => {
    clearInterval(timer);
  };
}

/**
 * Validates devices from Admin (Camera detected phones).
 */
export async function validateDevicesFromAdmin(
  deviceIds?: string[],
  validateAll = true,
  seat?: SeatSelection,
): Promise<void> {
  // Broadcast locally
  try {
    localChannel?.postMessage({
      type: 'validate_phone',
      validateAll,
      deviceIds,
      seat,
    });
  } catch {
    // ignore
  }

  // Send to Cloudflare API
  try {
    await fetch('/api/presence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'validate',
        validateAll,
        deviceIds,
        seat,
      }),
    });
  } catch {
    // network fallback
  }
}

/**
 * Fetches the list of real connected devices (used by control room dashboard).
 */
export async function fetchLivePresence(): Promise<PresenceResponse> {
  try {
    const res = await fetch('/api/presence', {
      headers: { 'cache-control': 'no-store' },
    });
    if (res.ok) {
      return (await res.json()) as PresenceResponse;
    }
  } catch {
    // network failure fallback
  }
  return { count: 0, devices: [], now: Date.now() };
}

/**
 * Fetches the active programmed tifo show from the server or local storage.
 */
export async function fetchProgrammedShow(): Promise<{ title: string; show: ShowFile | null }> {
  try {
    const res = await fetch('/api/show', { headers: { 'cache-control': 'no-store' } });
    if (res.ok) {
      const data = (await res.json()) as { title?: string; tifo?: string; show?: ShowFile };
      if (data.show) {
        return { title: data.title || 'تيفو الدخلة الوطنية 🇩🇿', show: data.show };
      }
    }
  } catch {
    // fallback
  }

  try {
    const raw = localStorage.getItem('rayati_active_show');
    if (raw) {
      const show = JSON.parse(raw) as ShowFile;
      return { title: show.meta.name || 'تيفو راياتي 🇩🇿', show };
    }
  } catch {
    // fallback
  }

  return { title: 'علم الجزائر الوطني 🇩🇿', show: null };
}
