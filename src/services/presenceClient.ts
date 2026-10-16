import type { SeatSelection } from '../core/types';

export interface PresenceDevice {
  deviceId: string;
  seat: SeatSelection | null;
  userAgent?: string;
  lastSeen: number;
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
 * Starts automatic presence heartbeat for this phone.
 */
export function startPresenceHeartbeat(getSeat: () => SeatSelection | null | undefined): () => void {
  const deviceId = getDeviceId();

  const sendHeartbeat = async () => {
    const seat = getSeat() || null;
    const payload: PresenceDevice = {
      deviceId,
      seat,
      lastSeen: Date.now(),
    };

    // 1. Fast local lane for multi-tab testing
    try {
      localChannel?.postMessage({ type: 'heartbeat', device: payload });
    } catch {
      // ignore
    }

    // 2. Global Cloudflare API for real mobile phones on 4G / Wi-Fi
    try {
      await fetch('/api/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // offline / stadium network loss tolerated
    }
  };

  // Immediate ping then repeat every 4 seconds
  void sendHeartbeat();
  const timer = setInterval(() => void sendHeartbeat(), 4000);

  return () => {
    clearInterval(timer);
  };
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
