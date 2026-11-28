#!/usr/bin/env node
'use strict';
/*
 * Tests for the security headers and the bad-request guard.
 *
 *   node tests/security-headers-tests.js
 *
 * Boots the real server on a throwaway port and data folder. No
 * member data, key, or secret is involved.
 */
const assert = require('assert');
const net = require('net');
const { makeRunner, startApp } = require('./harness');

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function hasBaseHeaders(res) {
  for (const [k, v] of Object.entries(BASE_HEADERS)) {
    assert.strictEqual(res.headers.get(k), v, k);
  }
}

/* Send a raw request line the URL parser rejects. */
function rawRequest(port, line) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(line + '\r\nHost: x\r\nConnection: close\r\n\r\n');
    });
    let out = '';
    sock.on('data', (d) => { out += d; });
    sock.on('end', () => resolve(out));
    sock.on('error', reject);
  });
}

(async () => {
  const r = makeRunner();
  const app = await startApp({});
  const port = Number(new URL(app.base).port);
  try {
    await r.test('the app shell carries every security header', async () => {
      const res = await fetch(app.base + '/');
      assert.strictEqual(res.status, 200);
      hasBaseHeaders(res);
      assert.strictEqual(res.headers.get('cache-control'), 'no-cache');
    });

    await r.test('API answers carry the headers and are never stored', async () => {
      const res = await fetch(app.base + '/api/me');
      assert.strictEqual(res.status, 401);
      hasBaseHeaders(res);
      assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    });

    await r.test('HSTS only when the request came over HTTPS', async () => {
      const plain = await fetch(app.base + '/');
      assert.strictEqual(plain.headers.get('strict-transport-security'), null);
      const https = await fetch(app.base + '/', { headers: { 'x-forwarded-proto': 'https' } });
      assert.strictEqual(https.headers.get('strict-transport-security'), 'max-age=15552000');
    });

    await r.test('the logo keeps its own day-long cache', async () => {
      const res = await fetch(app.base + '/assets/ayg-lab-logo.jpg');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=86400');
      hasBaseHeaders(res);
    });

    await r.test('jpg photos are served as images, not as unknown files', async () => {
      const res = await fetch(app.base + '/assets/hero-sprinter.jpg');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/jpeg');
    });

    await r.test('scripts and styles keep their exact types (nosniff needs them)', async () => {
      const js = await fetch(app.base + '/app.js');
      assert.match(js.headers.get('content-type'), /^text\/javascript/);
      const css = await fetch(app.base + '/styles.css');
      assert.match(css.headers.get('content-type'), /^text\/css/);
    });

    await r.test('a malformed request path gets 400 and the server stays up', async () => {
      const out = await rawRequest(port, 'GET //% HTTP/1.1');
      assert.match(out, /^HTTP\/1\.1 400/);
      const again = await fetch(app.base + '/api/me');
      assert.strictEqual(again.status, 401);
    });
  } finally {
    app.stop();
  }
  console.log('\n' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
})();
