/**
 * /api/presence — Live presence and real-time connected phone registry.
 *
 * Phones hit POST /api/presence every 3-5 seconds with their deviceId and seat.
 * The Admin dashboard queries GET /api/presence to see the exact real count
 * and coordinates of devices currently online in the stadium.
 */

// In-memory cache across Cloudflare isolate lifecycle
const memoryPresence = new Map();

function cleanStaleDevices(map, maxAgeMs = 20000) {
  const now = Date.now();
  for (const [id, dev] of map.entries()) {
    if (now - dev.lastSeen > maxAgeMs) {
      map.delete(id);
    }
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();
    const deviceId = String(data.deviceId || '').trim();

    if (!deviceId) {
      return new Response(JSON.stringify({ error: 'deviceId is required' }), {
        status: 400,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }

    const now = Date.now();
    const entry = {
      deviceId,
      seat: data.seat || null,
      userAgent: request.headers.get('user-agent')?.substring(0, 80) || 'Device',
      lastSeen: now,
    };

    // Update in-memory
    memoryPresence.set(deviceId, entry);
    cleanStaleDevices(memoryPresence);

    // If KV is bound, also persist to KV
    if (env && env.RAYATI_PRESENCE) {
      try {
        await env.RAYATI_PRESENCE.put(`dev:${deviceId}`, JSON.stringify(entry), {
          expirationTtl: 60, // Auto-expire after 60s
        });
      } catch {
        // Continue with memory cache
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
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

export async function onRequestGet({ env }) {
  cleanStaleDevices(memoryPresence);

  let devices = Array.from(memoryPresence.values());

  // If KV is bound and memory has few items, check KV list
  if (env && env.RAYATI_PRESENCE && devices.length === 0) {
    try {
      const list = await env.RAYATI_PRESENCE.list({ prefix: 'dev:', limit: 200 });
      const now = Date.now();
      const kvDevices = [];
      for (const key of list.keys) {
        const val = await env.RAYATI_PRESENCE.get(key.name);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (now - parsed.lastSeen <= 25000) {
              kvDevices.push(parsed);
              memoryPresence.set(parsed.deviceId, parsed);
            }
          } catch {
            // ignore bad json
          }
        }
      }
      if (kvDevices.length > 0) devices = kvDevices;
    } catch {
      // Continue with memory cache
    }
  }

  return new Response(
    JSON.stringify({
      count: devices.length,
      devices,
      now: Date.now(),
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
