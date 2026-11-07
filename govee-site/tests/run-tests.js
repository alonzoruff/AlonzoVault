'use strict';
/*
 * Govee Lights tests. Run with:  npm test   (or: node tests/run-tests.js)
 *
 * No real Govee account and no API key are involved: the Govee client is
 * built with a stub fetch that plays the classic developer API from a
 * small in-memory light store, and records every call it receives.
 */
const assert = require('assert');
const { createApp } = require('../server');
const { createGoveeClient } = require('../lib/govee-client');

/* ------------------------------------------------------------------ */
/* Stub Govee API (fetch layer)                                        */
/* ------------------------------------------------------------------ */

const BEDROOM_ID = 'AA:BB:CC:DD:EE:FF:01:02';
const LEFT_ID = '11:22:33:44:55:66:77:88';

function makeStubGovee() {
  const calls = [];
  const store = {};
  store[BEDROOM_ID] = { online: true, powerState: 'on', brightness: 31, colorTemInKelvin: 2700 };
  store[LEFT_ID] = { online: true, powerState: 'off', brightness: 31, color: { r: 255, g: 0, b: 0 } };

  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function fetchImpl(url, init) {
    const u = new URL(url);
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ method: (init && init.method) || 'GET', path: u.pathname, query: u.search, body });

    if (u.pathname === '/v1/devices') {
      return json({
        code: 200,
        data: {
          devices: [
            { device: BEDROOM_ID, model: 'H6008', deviceName: 'Bedroom lamp', controllable: true, retrievable: true },
            { device: LEFT_ID, model: 'H6006', deviceName: 'Left bulb', controllable: true, retrievable: true },
          ],
        },
      });
    }
    if (u.pathname === '/v1/devices/state') {
      const id = u.searchParams.get('device');
      const s = store[id];
      if (!s) return json({ code: 400, message: 'unknown device' }, 400);
      const properties = [{ online: s.online }, { powerState: s.powerState }, { brightness: s.brightness }];
      if (s.color) properties.push({ color: s.color });
      if (s.colorTemInKelvin) properties.push({ colorTemInKelvin: s.colorTemInKelvin });
      return json({ code: 200, data: { device: id, model: u.searchParams.get('model'), properties } });
    }
    if (u.pathname === '/v1/devices/control') {
      const s = store[body.device];
      if (!s) return json({ code: 400, message: 'unknown device' }, 400);
      if (body.cmd.name === 'turn') s.powerState = body.cmd.value;
      if (body.cmd.name === 'brightness') s.brightness = body.cmd.value;
      if (body.cmd.name === 'colorTem') { s.colorTemInKelvin = body.cmd.value; delete s.color; }
      if (body.cmd.name === 'color') { s.color = body.cmd.value; delete s.colorTemInKelvin; }
      return json({ code: 200, message: 'Success' });
    }
    return json({ code: 404, message: 'no route' }, 404);
  }

  return { calls, store, fetchImpl };
}

/* ------------------------------------------------------------------ */
/* Test plumbing                                                       */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + String((err && err.message) || err));
  }
}

function listen(app) {
  return new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', () => {
      resolve('http://127.0.0.1:' + app.server.address().port);
    });
  });
}

function close(app) {
  return new Promise((resolve) => app.server.close(resolve));
}

async function getJson(base, p) {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
}

async function postJson(base, p, obj) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });
  return { status: res.status, body: await res.json() };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const stub = makeStubGovee();
  const client = createGoveeClient({ apiKey: 'test-key', fetchImpl: stub.fetchImpl });
  const app = createApp({ client });
  const base = await listen(app);

  await app.refreshAll();

  await check('(a) /api/lights serves the cache without a live Govee call per request', async () => {
    const callsBefore = stub.calls.length;
    const one = await getJson(base, '/api/lights');
    const two = await getJson(base, '/api/lights');
    assert.strictEqual(stub.calls.length, callsBefore, 'a page read triggered a live Govee call');
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.setupNeeded, false);
    assert.strictEqual(one.body.devices.length, 2);
    assert.strictEqual(one.body.updatedAt, two.body.updatedAt);
    const bedroom = one.body.devices.find(d => d.device === BEDROOM_ID);
    assert.strictEqual(bedroom.name, 'Bedroom lamp');
    assert.strictEqual(bedroom.powerState, 'on');
    assert.strictEqual(bedroom.brightness, 31);
    assert.strictEqual(bedroom.colorTem, 2700);
  });

  await check('(b) control POST forwards the exact body to Govee and updates the cache', async () => {
    const res = await postJson(base, '/api/control', {
      device: BEDROOM_ID, model: 'H6008', cmd: { name: 'brightness', value: 50 },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.device.brightness, 50, 'response device not updated');

    const put = stub.calls.filter(c => c.path === '/v1/devices/control').pop();
    assert(put, 'no control call reached the stub');
    assert.strictEqual(put.method, 'PUT');
    assert.deepStrictEqual(put.body, {
      device: BEDROOM_ID, model: 'H6008', cmd: { name: 'brightness', value: 50 },
    });

    const lights = await getJson(base, '/api/lights');
    const bedroom = lights.body.devices.find(d => d.device === BEDROOM_ID);
    assert.strictEqual(bedroom.brightness, 50, 'cache not updated after control');
  });

  await check('(b2) an out-of-range command is rejected before it reaches Govee', async () => {
    const callsBefore = stub.calls.filter(c => c.path === '/v1/devices/control').length;
    const res = await postJson(base, '/api/control', {
      device: BEDROOM_ID, model: 'H6008', cmd: { name: 'brightness', value: 500 },
    });
    assert.strictEqual(res.status, 400);
    const callsAfter = stub.calls.filter(c => c.path === '/v1/devices/control').length;
    assert.strictEqual(callsAfter, callsBefore, 'invalid command was forwarded to Govee');
  });

  await close(app);

  await check('(c) missing API key starts in the setup state, no crash', async () => {
    const bare = createApp({ apiKey: '' });
    const bareBase = await listen(bare);
    try {
      assert.strictEqual(bare.setupNeeded, true);
      const lights = await getJson(bareBase, '/api/lights');
      assert.strictEqual(lights.status, 200);
      assert.strictEqual(lights.body.setupNeeded, true);
      assert.deepStrictEqual(lights.body.devices, []);
      const ctl = await postJson(bareBase, '/api/control', {
        device: BEDROOM_ID, model: 'H6008', cmd: { name: 'turn', value: 'off' },
      });
      assert.strictEqual(ctl.status, 503);
      const page = await fetch(bareBase + '/');
      assert.strictEqual(page.status, 200);
      const html = await page.text();
      assert(html.indexOf('Setup needed') !== -1, 'setup panel missing from the page');
    } finally {
      await close(bare);
    }
  });

  console.log('\n' + passed + ' passed / ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
