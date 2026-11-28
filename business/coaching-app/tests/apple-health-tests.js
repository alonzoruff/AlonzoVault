#!/usr/bin/env node
'use strict';
/*
 * Apple Health (Nov 28, 2026): per-member connection keys, the
 * /api/health/ingest endpoint an iPhone Shortcut posts to, the
 * member's own page and the coach view. Strictly steps, gait, speed
 * and calories (AJ's ruling): anything else a phone sends is dropped.
 *
 *   node tests/apple-health-tests.js
 *
 * Real server, throwaway data folder, made-up accounts and numbers.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { makeRunner, startApp, api, seedAccounts } = require('./harness');

const r = makeRunner();

function ingest(app, key, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (key) headers.Authorization = 'Bearer ' + key;
    const u = new URL('/api/health/ingest', app.base);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (_) { /* not json */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function nyToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function shift(d, n) {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}

async function main() {
  const app = await startApp();
  try {
    const s = await seedAccounts(app, 'athlete@example.test');
    const oc = s.ownerCookie;
    const mc = s.memberCookie;
    const memberId = s.memberId;
    const today = nyToday();

    await r.test('signed out: the Apple Health page data is closed (401)', async () => {
      assert.strictEqual((await api(app, 'GET', '/api/my/health')).status, 401);
      assert.strictEqual((await api(app, 'GET', '/api/health/members')).status, 401);
    });

    await r.test('a member without an active plan cannot make a connection key (403)', async () => {
      const res = await api(app, 'POST', '/api/my/health/key', {}, mc);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.json.needsTier, 'training');
    });

    let key;
    await r.test('a Lab Training member makes a key; it is shown once and only its hash is stored', async () => {
      assert.strictEqual((await api(app, 'PUT', '/api/access/' + memberId, { tier: 'training' }, oc)).status, 200);
      const res = await api(app, 'POST', '/api/my/health/key', {}, mc);
      assert.strictEqual(res.status, 200);
      key = res.json.key;
      assert.ok(/^aygh_[A-Za-z0-9_-]{30,}$/.test(key), key);
      const u = app.userByEmail('athlete@example.test');
      assert.ok(u.healthKeyHash && u.healthKeyHash !== key);
      const page = await api(app, 'GET', '/api/my/health', undefined, mc);
      assert.strictEqual(page.json.connected, true);
      assert.ok(!JSON.stringify(page.json).includes(key));
    });

    await r.test('ingest without a key, or with a wrong key, is refused (401) and saves nothing', async () => {
      assert.strictEqual((await ingest(app, null, { date: today, steps: 100 })).status, 401);
      assert.strictEqual((await ingest(app, 'aygh_not-a-real-key-000000000000000000', { date: today, steps: 100 })).status, 401);
      assert.strictEqual((await ingest(app, key.slice(0, -2) + 'xx', { date: today, steps: 100 })).status, 401);
      const page = await api(app, 'GET', '/api/my/health', undefined, mc);
      assert.strictEqual(page.json.days.length, 0);
    });

    await r.test('a valid day is stored: steps, gait, speed and calories, numbers sent as text included', async () => {
      const res = await ingest(app, key, {
        date: today, steps: '8,432', activeCalories: 410, walkingSpeed: '3.1 mph', runningSpeed: 7.4,
        stepLength: 28, walkingAsymmetry: '2%', doubleSupport: 27.5,
      });
      assert.strictEqual(res.status, 200, JSON.stringify(res.json));
      assert.deepStrictEqual(res.json.saved, [today]);
      const page = await api(app, 'GET', '/api/my/health', undefined, mc);
      const d = page.json.days[0];
      assert.strictEqual(d.date, today);
      assert.strictEqual(d.steps, 8432);
      assert.strictEqual(d.activeCalories, 410);
      assert.strictEqual(d.walkingSpeed, 3.1);
      assert.strictEqual(d.runningSpeed, 7.4);
      assert.strictEqual(d.stepLength, 28);
      assert.strictEqual(d.walkingAsymmetry, 2);
      assert.strictEqual(d.doubleSupport, 27.5);
      assert.ok(page.json.lastSyncAt);
    });

    await r.test('anything beyond steps, gait, speed and calories is dropped, never stored', async () => {
      const res = await ingest(app, key, {
        date: today, steps: 8432, sleepMinutes: 451, restingHeartRate: 52, hrv: 61,
        workouts: [{ type: 'Running', start: today + 'T11:00:00Z', durationMinutes: 32 }],
      });
      assert.strictEqual(res.status, 200);
      const d = (await api(app, 'GET', '/api/my/health', undefined, mc)).json;
      assert.ok(!('sleepMinutes' in d.days[0]) && !('restingHeartRate' in d.days[0]) && !('hrv' in d.days[0]));
      assert.ok(!('workouts' in d));
      const raw = fs.readFileSync(path.join(app.dataDir, 'db.json'), 'utf8');
      assert.ok(!raw.includes('sleepMinutes') && !raw.includes('restingHeartRate') && !raw.includes('"hrv"') && !raw.includes('Running'));
      const only = await ingest(app, key, { date: today, sleepMinutes: 400, hrv: 60 });
      assert.strictEqual(only.status, 400);
    });

    await r.test('sending the same day again updates it and keeps fields not sent', async () => {
      const res = await ingest(app, key, { date: today, steps: 9100 });
      assert.strictEqual(res.status, 200);
      const page = await api(app, 'GET', '/api/my/health', undefined, mc);
      assert.strictEqual(page.json.days.length, 1);
      assert.strictEqual(page.json.days[0].steps, 9100);
      assert.strictEqual(page.json.days[0].walkingSpeed, 3.1, 'fields not sent are kept');
    });

    await r.test('a batch of days is accepted', async () => {
      const res = await ingest(app, key, { days: [
        { date: shift(today, -1), steps: 7000, activeCalories: 380 },
        { date: shift(today, -2), steps: 6500, runningSpeed: 8.2 },
      ] });
      assert.strictEqual(res.status, 200);
      const page = await api(app, 'GET', '/api/my/health', undefined, mc);
      assert.deepStrictEqual(page.json.days.map(x => x.date), [today, shift(today, -1), shift(today, -2)]);
    });

    await r.test('bad data is refused (400) and nothing in that request is saved', async () => {
      const before = JSON.stringify((await api(app, 'GET', '/api/my/health', undefined, mc)).json.days);
      for (const body of [
        { date: 'yesterday', steps: 5 },
        { date: shift(today, 5), steps: 5 },
        { date: shift(today, -3), steps: -4 },
        { date: shift(today, -3), walkingSpeed: 40 },
        { date: shift(today, -3), activeCalories: 'lots' },
        { date: shift(today, -3), doubleSupport: 140 },
        { date: shift(today, -3) },
        { days: [{ date: shift(today, -3), steps: 10 }, { date: 'nope', steps: 10 }] },
      ]) {
        const res = await ingest(app, key, body);
        assert.strictEqual(res.status, 400, JSON.stringify(body));
      }
      const after = JSON.stringify((await api(app, 'GET', '/api/my/health', undefined, mc)).json.days);
      assert.strictEqual(after, before);
    });

    await r.test('the coach sees the athlete in the coach view; members and signed-out visitors do not', async () => {
      const list = await api(app, 'GET', '/api/health/members', undefined, oc);
      assert.strictEqual(list.status, 200);
      const row = list.json.members.find(m => m.id === memberId);
      assert.ok(row && row.connected === true && row.latest.steps === 9100 && row.latest.stepLength === 28, JSON.stringify(row));
      const one = await api(app, 'GET', '/api/health/members/' + memberId, undefined, oc);
      assert.strictEqual(one.status, 200);
      assert.strictEqual(one.json.days.length, 3);
      assert.strictEqual((await api(app, 'GET', '/api/health/members', undefined, mc)).status, 403);
      assert.strictEqual((await api(app, 'GET', '/api/health/members/' + memberId, undefined, mc)).status, 403);
    });

    await r.test('health data and keys never appear in account payloads or the data file in plain text', async () => {
      const me = await api(app, 'GET', '/api/me', undefined, mc);
      assert.ok(!('healthKeyHash' in me.json));
      const access = await api(app, 'GET', '/api/access', undefined, oc);
      assert.ok(!JSON.stringify(access.json).includes('healthKeyHash'));
      const raw = fs.readFileSync(path.join(app.dataDir, 'db.json'), 'utf8');
      assert.ok(!raw.includes(key));
    });

    await r.test('the coach can connect their own Apple Health too', async () => {
      const k = await api(app, 'POST', '/api/my/health/key', {}, oc);
      assert.strictEqual(k.status, 200);
      const res = await ingest(app, k.json.key, { date: today, steps: 12000 });
      assert.strictEqual(res.status, 200);
      const mine = await api(app, 'GET', '/api/my/health', undefined, oc);
      assert.strictEqual(mine.json.days[0].steps, 12000);
    });

    await r.test('a new key stops the old one; disconnecting stops sync and keeps the data', async () => {
      const k2 = (await api(app, 'POST', '/api/my/health/key', {}, mc)).json.key;
      assert.strictEqual((await ingest(app, key, { date: today, steps: 1 })).status, 401);
      assert.strictEqual((await ingest(app, k2, { date: today, steps: 9200 })).status, 200);
      assert.strictEqual((await api(app, 'DELETE', '/api/my/health/key', undefined, mc)).status, 200);
      assert.strictEqual((await ingest(app, k2, { date: today, steps: 1 })).status, 401);
      const page = await api(app, 'GET', '/api/my/health', undefined, mc);
      assert.strictEqual(page.json.connected, false);
      assert.strictEqual(page.json.days[0].steps, 9200);
    });

    await r.test('a cancelled membership cannot sync (403)', async () => {
      const k3 = (await api(app, 'POST', '/api/my/health/key', {}, mc)).json.key;
      assert.strictEqual((await api(app, 'PUT', '/api/access/' + memberId, { status: 'cancelled' }, oc)).status, 200);
      const res = await ingest(app, k3, { date: today, steps: 5 });
      assert.strictEqual(res.status, 403);
      assert.strictEqual((await api(app, 'PUT', '/api/access/' + memberId, { status: 'active' }, oc)).status, 200);
    });

    await r.test('the member can delete their Apple Health data', async () => {
      assert.strictEqual((await api(app, 'DELETE', '/api/my/health/data', undefined, mc)).status, 200);
      const page = await api(app, 'GET', '/api/my/health', undefined, mc);
      assert.strictEqual(page.json.days.length, 0);
    });

    await r.test('the data survives a restart', async () => {
      await ingest(app, (await api(app, 'POST', '/api/my/health/key', {}, mc)).json.key, { date: today, steps: 4321 });
      await app.restart();
      const login = await api(app, 'POST', '/api/login', { email: 'athlete@example.test', password: 'member-pass-123' });
      const page = await api(app, 'GET', '/api/my/health', undefined, login.cookie);
      assert.strictEqual(page.json.days[0].steps, 4321);
    });
  } finally {
    app.stop();
  }
  console.log('\n' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
