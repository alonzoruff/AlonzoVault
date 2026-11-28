#!/usr/bin/env node
'use strict';
/*
 * Tests for the three sign-in protections:
 *   1. the limit on password guesses (5 wrong for one email pauses
 *      that email for 15 minutes; 30 wrong from one address pauses
 *      that address),
 *   2. "Sign out everywhere",
 *   3. change password.
 *
 *   node tests/sign-in-protection-tests.js
 *
 * Runs every API check twice: once in file mode (Render) and once in
 * hosted-store mode (Vercel) against the local fake Upstash. Then it
 * checks the timing rules of lib/guess-limit.js with a pretend clock.
 * Every email, password, address and secret here is made up.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeRunner, startApp } = require('./harness');
const { startFakeUpstash, FAKE_TOKEN } = require('./fake-upstash');
const { createGuessLimit } = require('../lib/guess-limit');

const OWNER = { email: 'owner@example.test', password: 'owner-pass-123' };
const MEMBER = { email: 'member@example.test', password: 'member-pass-123' };
const COACH = { email: 'coach.two@example.test', password: 'coach-pass-123' };
const LOCKED = /paused for 15 minutes/;

/* One request. `ip` sets x-forwarded-for so each block of checks can
   act as its own network (TEST-NET addresses, never real ones). */
async function call(app, method, p, body, cookie, ip) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (ip) headers['x-forwarded-for'] = ip;
  const res = await fetch(app.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  const sc = res.headers.get('set-cookie');
  return { status: res.status, json, setCookie: sc || '', cookie: sc ? sc.split(';')[0] : null };
}
const login = (app, who, ip) => call(app, 'POST', '/api/login', { email: who.email, password: who.password }, null, ip);
const wrong = (app, email, ip) => call(app, 'POST', '/api/login', { email, password: 'not-the-password' }, null, ip);

/* A cookie signed the way the app signed them before this change
   (no sign-in number inside). */
function oldStyleCookie(secret, uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return 'rp_session=' + payload + '.' + sig;
}

async function suite(r, label, app, secretOf, extra) {
  const T = (name, fn) => r.test(label + ': ' + name, fn);

  /* Accounts: owner (head coach), an invited assistant coach and an
     invited member. */
  const own = await call(app, 'POST', '/api/register', OWNER);
  assert.strictEqual(own.status, 201, 'owner register');
  const ownerCookie = own.cookie;
  assert.strictEqual((await call(app, 'POST', '/api/client-invites', { email: MEMBER.email }, ownerCookie)).status, 200);
  assert.strictEqual((await call(app, 'POST', '/api/coach-invites', { email: COACH.email }, ownerCookie)).status, 200);
  const mem = await call(app, 'POST', '/api/register', MEMBER);
  assert.strictEqual(mem.status, 201, 'member register');
  assert.strictEqual((await call(app, 'POST', '/api/register', COACH)).status, 201, 'coach register');

  await T('coach and member sign-in still work', async () => {
    const a = await login(app, OWNER, '198.51.100.1');
    assert.strictEqual(a.status, 200); assert.strictEqual(a.json.role, 'coach');
    const c = await login(app, COACH, '198.51.100.1');
    assert.strictEqual(c.status, 200); assert.strictEqual(c.json.role, 'coach');
    const m = await login(app, MEMBER, '198.51.100.1');
    assert.strictEqual(m.status, 200); assert.strictEqual(m.json.role, 'athlete');
  });

  /* ---------- 1. guess limit ---------- */
  await T('4 wrong passwords: still allowed to try, right password works', async () => {
    const ip = '198.51.100.2';
    for (let i = 0; i < 4; i++) assert.strictEqual((await wrong(app, COACH.email, ip)).status, 401);
    assert.strictEqual((await login(app, COACH, ip)).status, 200);
  });

  await T('a right password clears the count (4 wrong, right, 4 wrong is still not a pause)', async () => {
    const ip = '198.51.100.3';
    for (let i = 0; i < 4; i++) assert.strictEqual((await wrong(app, COACH.email, ip)).status, 401);
    assert.strictEqual((await login(app, COACH, ip)).status, 200);
    for (let i = 0; i < 4; i++) assert.strictEqual((await wrong(app, COACH.email, ip)).status, 401, 'second round, try ' + (i + 1));
    assert.strictEqual((await login(app, COACH, ip)).status, 200);
  });

  await T('5 wrong passwords pause that email: even the right password is turned away', async () => {
    const ip = '198.51.100.4';
    for (let i = 0; i < 5; i++) {
      const w = await wrong(app, MEMBER.email, ip);
      assert.strictEqual(w.status, 401, 'try ' + (i + 1));
      assert.strictEqual(w.json.error, 'Email or password did not match.');
    }
    const blocked = await login(app, MEMBER, ip);
    assert.strictEqual(blocked.status, 429);
    assert.match(blocked.json.error, LOCKED);
    assert.strictEqual(blocked.setCookie, '', 'no cookie while paused');
    /* From a different network too: the pause is on the email. */
    assert.strictEqual((await login(app, MEMBER, '198.51.100.40')).status, 429);
    /* Same email typed in capitals and with spaces is the same email. */
    const caps = await call(app, 'POST', '/api/login', { email: '  MEMBER@Example.TEST ', password: MEMBER.password }, null, ip);
    assert.strictEqual(caps.status, 429);
  });

  await T('a paused email does not stop anyone else signing in', async () => {
    assert.strictEqual((await login(app, OWNER, '198.51.100.4')).status, 200);
    assert.strictEqual((await login(app, COACH, '198.51.100.5')).status, 200);
  });

  await T('the pause looks the same for an email with no account', async () => {
    const ip = '198.51.100.6';
    for (let i = 0; i < 5; i++) assert.strictEqual((await wrong(app, 'nobody@example.test', ip)).status, 401);
    const r6 = await wrong(app, 'nobody@example.test', ip);
    assert.strictEqual(r6.status, 429);
    assert.match(r6.json.error, LOCKED);
  });

  await T('30 wrong passwords from one address, across many emails, pause that address', async () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < 30; i++) {
      assert.strictEqual((await wrong(app, 'guess' + i + '@example.test', ip)).status, 401, 'try ' + (i + 1));
    }
    const fromThere = await login(app, OWNER, ip);
    assert.strictEqual(fromThere.status, 429);
    assert.strictEqual((await login(app, OWNER, '203.0.113.10')).status, 200, 'other address fine');
  });

  await T('an empty or broken sign-in is still a plain "did not match", not a pause', async () => {
    const e = await call(app, 'POST', '/api/login', {}, null, '198.51.100.7');
    assert.strictEqual(e.status, 401);
  });

  /* ---------- 2. sign out everywhere ---------- */
  await T('sign out everywhere ends every sign-in for that account, this device too', async () => {
    const ip = '198.51.100.8';
    const a = (await login(app, COACH, ip)).cookie;
    const b = (await login(app, COACH, ip)).cookie;
    const other = (await login(app, OWNER, ip)).cookie;
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, a)).status, 200);
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, b)).status, 200);
    const out = await call(app, 'POST', '/api/account/sign-out-everywhere', {}, a);
    assert.strictEqual(out.status, 200);
    assert.match(out.setCookie, /rp_session=;.*Max-Age=0/, 'this device cookie cleared');
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, a)).status, 401, 'device A out');
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, b)).status, 401, 'device B out');
    assert.strictEqual((await call(app, 'GET', '/api/profiles', undefined, b)).status, 401, 'no team data either');
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, other)).status, 200, 'other accounts untouched');
    const again = await login(app, COACH, ip);
    assert.strictEqual(again.status, 200, 'can sign in again with the same password');
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, again.cookie)).status, 200);
  });

  await T('cookies made before this change keep working until sign out everywhere', async () => {
    const secret = secretOf();
    const u = await login(app, OWNER, '198.51.100.9');
    const old = oldStyleCookie(secret, u.json.id);
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, old)).status, 200, 'old cookie accepted');
    assert.strictEqual((await call(app, 'POST', '/api/account/sign-out-everywhere', {}, u.cookie)).status, 200);
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, old)).status, 401, 'old cookie refused after');
  });

  await T('sign out everywhere and change password need a sign-in', async () => {
    assert.strictEqual((await call(app, 'POST', '/api/account/sign-out-everywhere', {})).status, 401);
    assert.strictEqual((await call(app, 'POST', '/api/account/password', { currentPassword: 'x', newPassword: 'yyyyyyyy' })).status, 401);
  });

  /* ---------- 3. change password ---------- */
  await T('change password: wrong current, too short, too long and unchanged are refused', async () => {
    const c = (await login(app, OWNER, '198.51.100.11')).cookie;
    const bad = await call(app, 'POST', '/api/account/password', { currentPassword: 'nope-nope-1', newPassword: 'brand-new-pass-1' }, c, '198.51.100.11');
    assert.strictEqual(bad.status, 400); assert.match(bad.json.error, /current password did not match/);
    const short = await call(app, 'POST', '/api/account/password', { currentPassword: OWNER.password, newPassword: 'short' }, c, '198.51.100.11');
    assert.strictEqual(short.status, 400); assert.match(short.json.error, /at least 8/);
    const long = await call(app, 'POST', '/api/account/password', { currentPassword: OWNER.password, newPassword: 'x'.repeat(201) }, c, '198.51.100.11');
    assert.strictEqual(long.status, 400);
    const same = await call(app, 'POST', '/api/account/password', { currentPassword: OWNER.password, newPassword: OWNER.password }, c, '198.51.100.11');
    assert.strictEqual(same.status, 400); assert.match(same.json.error, /different/);
    const notText = await call(app, 'POST', '/api/account/password', { currentPassword: 12345678, newPassword: 87654321 }, c, '198.51.100.11');
    assert.strictEqual(notText.status, 400);
    assert.strictEqual((await login(app, OWNER, '198.51.100.11')).status, 200, 'password unchanged');
  });

  await T('change password: new one works, old one stops, other devices signed out, this one stays', async () => {
    const ip = '198.51.100.12';
    /* The coach account: the member email is still paused from above. */
    const who = COACH;
    const thisDevice = (await login(app, who, '198.51.100.13')).cookie;
    const otherDevice = (await login(app, who, ip)).cookie;
    const newPass = 'a-new-made-up-pass-9';
    const ch = await call(app, 'POST', '/api/account/password', { currentPassword: who.password, newPassword: newPass }, thisDevice, ip);
    assert.strictEqual(ch.status, 200);
    assert.ok(ch.cookie && ch.cookie.length > 'rp_session='.length, 'fresh cookie for this device');
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, ch.cookie)).status, 200, 'this device stays signed in');
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, otherDevice)).status, 401, 'other device signed out');
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, thisDevice)).status, 401, 'the old cookie on this device is replaced');
    assert.strictEqual((await call(app, 'POST', '/api/login', { email: who.email, password: who.password }, null, ip)).status, 401, 'old password refused');
    const n = await call(app, 'POST', '/api/login', { email: who.email, password: newPass }, null, ip);
    assert.strictEqual(n.status, 200, 'new password works');
    assert.strictEqual(n.json.role, 'coach', 'role unchanged');
    who.password = newPass;
  });

  await T('wrong current passwords count toward the same pause as sign-in', async () => {
    const ip = '198.51.100.14';
    const c = (await login(app, OWNER, ip)).cookie;
    for (let i = 0; i < 5; i++) {
      const w = await call(app, 'POST', '/api/account/password', { currentPassword: 'wrong-' + i + '-pass', newPassword: 'whatever-pass-1' }, c, ip);
      assert.strictEqual(w.status, 400, 'try ' + (i + 1));
    }
    const blocked = await call(app, 'POST', '/api/account/password', { currentPassword: OWNER.password, newPassword: 'whatever-pass-1' }, c, ip);
    assert.strictEqual(blocked.status, 429); assert.match(blocked.json.error, LOCKED);
    assert.strictEqual((await login(app, OWNER, '198.51.100.15')).status, 429, 'sign-in paused too');
    assert.strictEqual((await call(app, 'GET', '/api/me', undefined, c)).status, 200, 'already signed-in device is not thrown out');
  });

  await T('nothing about the guess count or emails is written to the saved data', async () => {
    const text = extra.savedText();
    assert.ok(!/gl:|guess-limit|not-the-password/.test(text), 'no counter in saved data');
    for (const k of extra.storeKeys()) assert.ok(!k.includes('@'), 'no raw email in a store key: ' + k);
  });

  await T('a changed password is saved as a hash, never as typed', async () => {
    const text = extra.savedText();
    assert.ok(!text.includes('a-new-made-up-pass-9'));
    assert.ok(/passwordChangedAt/.test(text));
  });
}

(async () => {
  const r = makeRunner();

  /* ---------- file mode (Render) ---------- */
  console.log('File mode (Render)');
  const fileApp = await startApp({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined, KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined, SESSION_SECRET: undefined });
  try {
    await suite(r, 'file', fileApp,
      () => fs.readFileSync(path.join(fileApp.dataDir, '.session-secret'), 'utf8').trim(),
      { savedText: () => fileApp.dbText(), storeKeys: () => [] });
  } catch (err) { r.failed++; console.log('  FAIL file setup\n       ' + (err && err.stack)); }
  finally { fileApp.stop(); }

  /* ---------- store mode (Vercel) ---------- */
  console.log('Store mode (Vercel, fake Upstash)');
  OWNER.password = 'owner-pass-123'; MEMBER.password = 'member-pass-123'; COACH.password = 'coach-pass-123';
  const fake = await startFakeUpstash();
  const SECRET = 'test-session-secret-not-real';
  const storeApp = await startApp({
    UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: FAKE_TOKEN,
    STORE_PREFIX: 'signin-test', SESSION_SECRET: SECRET, OWNER_SETUP_EMAIL: OWNER.email,
  });
  try {
    await suite(r, 'store', storeApp, () => SECRET, {
      savedText: () => {
        const raw = fake.kv.get('signin-test:db');
        return raw ? JSON.stringify(require('../lib/store').decode(raw)) : '';
      },
      storeKeys: () => [...fake.kv.keys()],
    });
    await r.test('store: the counters live in the shared store, so every copy of the app sees them', async () => {
      const keys = [...fake.kv.keys()].filter(k => k.startsWith('signin-test:hit:gl:'));
      assert.ok(keys.some(k => k.includes(':gl:lock:')), 'a pause is in the store');
    });
  } catch (err) { r.failed++; console.log('  FAIL store setup\n       ' + (err && err.stack)); }
  finally { storeApp.stop(); fake.server.close(); }

  /* ---------- timing rules, with a pretend clock ---------- */
  console.log('Timing rules (lib/guess-limit.js)');
  let t = 1_000_000;
  const gl = createGuessLimit({ store: null, secret: 'made-up', now: () => t });
  const MIN = 60 * 1000;
  await r.test('the pause lasts 15 minutes from the 5th wrong try, then lifts', async () => {
    for (let i = 0; i < 5; i++) await gl.recordFailure('a@example.test', '192.0.2.1');
    assert.strictEqual(await gl.isLocked('a@example.test', '192.0.2.1'), true);
    t += 14 * MIN;
    assert.strictEqual(await gl.isLocked('a@example.test', '192.0.2.1'), true, 'still paused at 14 minutes');
    t += 1 * MIN + 1;
    assert.strictEqual(await gl.isLocked('a@example.test', '192.0.2.1'), false, 'lifted at 15 minutes');
  });
  await r.test('after a pause lifts, the count starts from zero', async () => {
    for (let i = 0; i < 4; i++) await gl.recordFailure('a@example.test', '192.0.2.1');
    assert.strictEqual(await gl.isLocked('a@example.test'), false);
  });
  await r.test('wrong tries more than 15 minutes apart are forgotten', async () => {
    for (let i = 0; i < 4; i++) await gl.recordFailure('b@example.test');
    t += 16 * MIN;
    await gl.recordFailure('b@example.test');
    assert.strictEqual(await gl.isLocked('b@example.test'), false);
  });
  await r.test('a flood of new emails cannot lift an existing pause early', async () => {
    for (let i = 0; i < 5; i++) await gl.recordFailure('c@example.test');
    for (let i = 0; i < 6000; i++) await gl.recordFailure('flood' + i + '@example.test');
    assert.strictEqual(await gl.isLocked('c@example.test'), true);
  });
  await r.test('if the shared store is down, sign-in is not blocked by the limit', async () => {
    const broken = { hit: async () => { throw new Error('down'); }, peekHit: async () => { throw new Error('down'); }, clearHit: async () => { throw new Error('down'); } };
    const g2 = createGuessLimit({ store: broken, secret: 'made-up' });
    const origErr = console.error; console.error = () => {};
    try {
      await g2.recordFailure('d@example.test', '192.0.2.2');
      assert.strictEqual(await g2.isLocked('d@example.test', '192.0.2.2'), false);
      await g2.recordSuccess('d@example.test');
    } finally { console.error = origErr; }
  });

  console.log('\n' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
})();
