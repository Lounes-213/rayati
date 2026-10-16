/**
 * k6 load test — 10 000 virtual fans hitting the app before a show.
 *
 * It reproduces the real traffic shape:
 *   - the shell (HTML, JS, CSS) is requested once per fan (cold cache),
 *   - seats.json is requested by every fan,
 *   - the 1-2 MB show.json is requested by every fan (these are the 20 minutes
 *     before kick-off, where the CDN must hold),
 *   - most fans then poll /api/time a few times,
 *   - a fan who opens the page again during the show fetches only from cache,
 *     which is exactly what the "revisit" scenario measures.
 *
 * Usage
 * -----
 *   k6 run tools/k6_load_test.js
 *   k6 run -e BASE=https://rayati.pages.dev -e FANS=10000 -e RAMPDOWN=5m tools/k6_load_test.js
 *   k6 run -e BASE=http://localhost:4173 -e FANS=200 tools/k6_load_test.js   # smoke run
 *
 * Thresholds fail the run when p95 latency or the error rate slips.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:4173';
const FANS = Number(__ENV.FANS || 10000);
const HOLD = __ENV.HOLD || '10m';
const RAMPUP = __ENV.RAMPUP || '10m';
const RAMPDOWN = __ENV.RAMPDOWN || '2m';
const SEAT = __ENV.SEAT || 'B-12-7'; // a fan's seat, e.g. from a QR link
const SHOW = __ENV.SHOW || 'show.json';

const showBytes = new Trend('show_payload_bytes', true);
const shellErrors = new Rate('shell_errors');
const showErrors = new Rate('show_errors');
const timeErrors = new Rate('time_errors');

export const options = {
  scenarios: {
    // Fans arriving before the show and downloading everything.
    pre_show_download: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMPUP, target: FANS },
        { duration: HOLD, target: FANS },
        { duration: RAMPDOWN, target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'fanBeforeShow',
    },
    // 2% of fans reopen the app during the show: cache-hit traffic only.
    during_show_revisit: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.round(FANS * 0.02)),
      duration: HOLD,
      startTime: RAMPUP,
      exec: 'fanDuringShow',
    },
    // Time sync: a short burst right before the show starts.
    clock_sync_burst: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: Math.max(10, Math.round(FANS / 10)),
      maxVUs: Math.max(50, FANS),
      stages: [
        { duration: '30s', target: Math.round(FANS / 30) },
        { duration: '1m', target: Math.round(FANS / 30) },
        { duration: '30s', target: 0 },
      ],
      startTime: RAMPUP,
      exec: 'clockSync',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:show}': ['p(95)<1500'],
    'http_req_duration{name:shell}': ['p(95)<500'],
    'http_req_duration{name:time}': ['p(95)<400'],
    shell_errors: ['rate<0.005'],
    show_errors: ['rate<0.01'],
    time_errors: ['rate<0.02'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

/** A fan opens the app cold, picks a seat and downloads the show file. */
export function fanBeforeShow() {
  group('shell', () => {
    const page = http.get(`${BASE}/?s=${SEAT.split('-')[0]}&r=1&n=1`, {
      tags: { name: 'shell' },
      headers: { 'user-agent': 'k6-rayati-fan/1.0' },
    });
    shellErrors.add(!check(page, { 'shell 200': (r) => r.status === 200 }));
  });

  group('seats', () => {
    const seats = http.get(`${BASE}/seats.json`, { tags: { name: 'seats' } });
    check(seats, {
      'seats 200': (r) => r.status === 200,
      'seats is json': (r) => String(r.headers['Content-Type']).includes('json'),
      'seats has sections': (r) => r.body && r.body.includes('"sections"'),
    });
  });

  group('show', () => {
    const show = http.get(`${BASE}/${SHOW}`, { tags: { name: 'show' } });
    showBytes.add(show.body ? show.body.length : 0);
    showErrors.add(
      !check(show, {
        'show 200': (r) => r.status === 200,
        'show has timelines': (r) => Boolean(r.body && r.body.includes('"timelines"')),
      }),
    );
  });

  sleep(Math.random() * 8 + 2); // fans wander, they do not hammer in lockstep
}

/** Page already cached: only the tiny /api/time request goes to the network. */
export function fanDuringShow() {
  const res = http.get(`${BASE}/api/time`, { tags: { name: 'time' } });
  timeErrors.add(!check(res, { 'time 200': (r) => r.status === 200 }));
  sleep(20);
}

/** The ready screen samples /api/time three times to compute the clock offset. */
export function clockSync() {
  for (let i = 0; i < 3; i++) {
    const res = http.get(`${BASE}/api/time`, { tags: { name: 'time' } });
    timeErrors.add(!check(res, { 'time 200': (r) => r.status === 200 }));
    sleep(0.3);
  }
}
