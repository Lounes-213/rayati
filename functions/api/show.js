/**
 * /api/show — Shared active show and synchronized kickoff trigger.
 *
 * Admin posts commands (10s countdown target time, tifo switch, blackout).
 * Phones poll this endpoint to stay in sync with the stadium régie.
 */

let activeCommand = {
  type: 'idle',
  targetTime: 0,
  tifo: 'algeria_flag',
  updatedAt: Date.now(),
};

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();
    activeCommand = {
      ...data,
      updatedAt: Date.now(),
    };

    if (env && env.RAYATI_PRESENCE) {
      try {
        await env.RAYATI_PRESENCE.put('active_command', JSON.stringify(activeCommand), {
          expirationTtl: 300,
        });
      } catch {
        // Continue
      }
    }

    return new Response(JSON.stringify({ ok: true, activeCommand }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'access-control-allow-origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
}

export async function onRequestGet({ env }) {
  if (env && env.RAYATI_PRESENCE) {
    try {
      const val = await env.RAYATI_PRESENCE.get('active_command');
      if (val) activeCommand = JSON.parse(val);
    } catch {
      // Continue with memory
    }
  }

  return new Response(JSON.stringify(activeCommand), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'access-control-allow-origin': '*',
    },
  });
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
