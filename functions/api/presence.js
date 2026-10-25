/**
 * /api/presence — Lightweight in-memory presence endpoint.
 * No Cloudflare KV operations are used (0 KV quota consumption).
 */

const memoryPresence = new Map();

function cleanStaleDevices(map, maxAgeMs = 25000) {
  const now = Date.now();
  for (const [id, dev] of map.entries()) {
    if (now - dev.lastSeen > maxAgeMs) {
      map.delete(id);
    }
  }
}

export async function onRequestPost({ request }) {
  try {
    const data = await request.json();
    const action = String(data.action || 'heartbeat');

    if (action === 'validate') {
      const targetIds = Array.isArray(data.deviceIds) ? data.deviceIds : [];
      const validateAll = Boolean(data.validateAll);
      let validatedCount = 0;

      for (const [id, dev] of memoryPresence.entries()) {
        if (validateAll || targetIds.includes(id)) {
          dev.validated = true;
          if (data.seat) dev.seat = data.seat;
          validatedCount++;
        }
      }

      return new Response(JSON.stringify({ ok: true, validatedCount }), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }

    const deviceId = String(data.deviceId || '').trim();
    if (!deviceId) {
      return new Response(JSON.stringify({ error: 'deviceId is required' }), {
        status: 400,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }

    const now = Date.now();
    const existing = memoryPresence.get(deviceId);
    const entry = {
      deviceId,
      seat: data.seat || existing?.seat || null,
      userAgent: request.headers.get('user-agent')?.substring(0, 80) || 'Device',
      lastSeen: now,
      validated: existing ? existing.validated : true,
    };

    memoryPresence.set(deviceId, entry);
    cleanStaleDevices(memoryPresence);

    return new Response(
      JSON.stringify({
        ok: true,
        validated: entry.validated,
        seat: entry.seat,
        activeCount: memoryPresence.size,
        serverTime: now,
      }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store, max-age=0',
          'access-control-allow-origin': '*',
        },
      },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
}

export async function onRequestGet() {
  cleanStaleDevices(memoryPresence);
  const devices = Array.from(memoryPresence.values());

  return new Response(
    JSON.stringify({
      count: devices.length,
      devices,
      serverTime: Date.now(),
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'access-control-allow-origin': '*',
      },
    },
  );
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400',
    },
  });
}
