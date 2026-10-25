/**
 * /api/show — Lightweight stateless response.
 * No Cloudflare KV operations are used (0 KV quota consumption).
 */

let memoryState = {
  type: 'cube_colors',
  cols: 2,
  rows: 2,
  colors: ['#00A859', '#38BDF8', '#38BDF8', '#00A859'],
  targetTime: 0,
  updatedAt: 0,
};

export async function onRequestPost({ request }) {
  try {
    const data = await request.json();
    memoryState = {
      ...memoryState,
      ...data,
      updatedAt: Date.now(),
    };

    return new Response(JSON.stringify({ ok: true, memoryState }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, no-cache, max-age=0',
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

export async function onRequestGet() {
  return new Response(JSON.stringify(memoryState), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, max-age=0',
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
