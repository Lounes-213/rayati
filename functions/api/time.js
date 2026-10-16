/**
 * GET /api/time — shared show clock (Cloudflare Pages Function, free tier).
 *
 * Every phone samples this a few times before the show and keeps the offset
 * measured on the fastest round trip. The response must never be cached and
 * must be as small as possible: thousands of phones hit it at once.
 */
export function onRequestGet() {
  return new Response(JSON.stringify({ now: Date.now() }), {
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
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-max-age': '86400',
    },
  });
}
