#!/usr/bin/env node
'use strict';
/*
 * Tests for the security headers and the bad-request guard.
 *
 *   node tests/security-headers-tests.js
 *
 * Boots the real server on a throwaway port and data folder, then
 * deletes the folder. No athlete data, key, or secret is involved.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

function hasBaseHeaders(res) {
  for (const [k, v] of Object.entries(BASE_HEADERS)) {
    assert.strictEqual(res.headers.get(k), v, k);
  }
}

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
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-sec-'));
  const logs = [];
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start: ' + logs.join(''))), 15000);
    const poll = setInterval(() => {
      if (logs.join('').includes('running at')) { clearInterval(poll); clearTimeout(timer); resolve(); }
    }, 50);
  });

  let passed = 0;
  let failed = 0;
  const test = async (name, fn) => {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (err) { failed++; console.log('  FAIL ' + name + '\n       ' + (err && err.message)); }
  };

  try {
    await test('the app shell carries every security header', async () => {
      const res = await fetch(base + '/');
      assert.strictEqual(res.status, 200);
      hasBaseHeaders(res);
      assert.strictEqual(res.headers.get('cache-control'), 'no-cache');
    });

    await test('API answers carry the headers and are never stored', async () => {
      const res = await fetch(base + '/api/me');
      assert.strictEqual(res.status, 401);
      hasBaseHeaders(res);
      assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    });

    await test('HSTS only when the request came over HTTPS', async () => {
      const plain = await fetch(base + '/');
      assert.strictEqual(plain.headers.get('strict-transport-security'), null);
      const https = await fetch(base + '/', { headers: { 'x-forwarded-proto': 'https' } });
      assert.strictEqual(https.headers.get('strict-transport-security'), 'max-age=15552000');
    });

    await test('scripts, styles and icons keep their exact types (nosniff needs them)', async () => {
      const js = await fetch(base + '/app.js');
      assert.match(js.headers.get('content-type'), /^text\/javascript/);
      const css = await fetch(base + '/styles.css');
      assert.match(css.headers.get('content-type'), /^text\/css/);
      const svg = await fetch(base + '/assets/app-mark.svg');
      assert.strictEqual(svg.headers.get('content-type'), 'image/svg+xml');
    });

    await test('a malformed request path gets 400 and the server stays up', async () => {
      const out = await rawRequest(port, 'GET //% HTTP/1.1');
      assert.match(out, /^HTTP\/1\.1 400/);
      const again = await fetch(base + '/api/me');
      assert.strictEqual(again.status, 401);
    });
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
