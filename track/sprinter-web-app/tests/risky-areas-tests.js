#!/usr/bin/env node
'use strict';
/*
 * Tests for the five places where a bug would cost AJ data or lock
 * athletes or coaches out (Brief 13, Nov 24):
 *
 *   1. Loading the saved data file at startup (damaged, empty or
 *      older-format db.json)
 *   2. Sign-in sessions (cookie checks, sign-out, bad stored hashes)
 *   3. Restoring a backup file (every refusal leaves data untouched)
 *   4. Roster import (paste or CSV)
 *   5. Device test-result import (VALD / T-APEX CSV preview + commit)
 *
 *   node tests/risky-areas-tests.js
 *
 * Boots the real server.js on a free port with a throwaway DATA_DIR.
 * Every name, email, password and secret below is made up.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');
const SECRET = 'risky-areas-test-secret-not-real';
const COOKIE = 'swa_session';
const OWNER = { email: 'owner@example.test', password: 'owner-pass-123', ageAttested: true };

/* ---------------- tiny runner ---------------- */
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (err) { failed++; console.log('  FAIL ' + name + '\n       ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err)); }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

/* Boot the app. opts.dir reuses a data folder; opts.dbText writes
   db.json first; opts.noSecret leaves SESSION_SECRET unset. */
async function startApp(opts) {
  const o = opts || {};
  const port = await freePort();
  const dir = o.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'spr-risky-'));
  if (o.dbText !== undefined) fs.writeFileSync(path.join(dir, 'db.json'), o.dbText);
  const env = Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir });
  if (o.noSecret) delete env.SESSION_SECRET; else env.SESSION_SECRET = SECRET;
  for (const k of ['COACH_INVITE_EMAILS']) delete env[k];
  const app = { base: 'http://127.0.0.1:' + port, dir, logs: [], child: null };
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.child = child;
  child.stdout.on('data', (d) => app.logs.push(String(d)));
  child.stderr.on('data', (d) => app.logs.push(String(d)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start: ' + app.logs.join(''))), 15000);
    const poll = setInterval(() => {
      if (app.logs.join('').includes('running at')) { clearInterval(poll); clearTimeout(timer); resolve(); }
    }, 25);
    child.on('exit', () => { clearInterval(poll); clearTimeout(timer); reject(new Error('server exited: ' + app.logs.join(''))); });
  });
  app.dbFile = path.join(dir, 'db.json');
  app.dbText = () => { try { return fs.readFileSync(app.dbFile, 'utf8'); } catch (_) { return ''; } };
  app.db = () => JSON.parse(app.dbText() || '{}');
  app.stop = async (keep) => {
    if (app.child.exitCode === null && app.child.signalCode === null) {
      await new Promise((resolve) => { app.child.once('exit', resolve); app.child.kill(); });
    }
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  };
  return app;
}

async function call(app, method, p, body, cookie, opts) {
  const o = opts || {};
  const headers = Object.assign({}, o.headers || {});
  if (cookie) headers.cookie = cookie;
  let data;
  if (o.raw !== undefined) { data = o.raw; headers['content-type'] = o.contentType || 'application/json'; }
  else if (body !== undefined) { data = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await fetch(app.base + p, { method, headers, body: data });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, json, text, setCookie, cookie: setCookie ? setCookie.split(';')[0] : null };
}

/* A session cookie signed the way server.js signs one, so tests can
   build expired, unknown-user and malformed sessions on purpose. */
function signedCookie(payloadObj, secret, rawPayload) {
  const payload = rawPayload !== undefined ? rawPayload
    : Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret || SECRET).update(payload).digest('base64url');
  return COOKIE + '=' + payload + '.' + sig;
}
function passHash(password) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}

async function registerOwner(app) {
  const r = await call(app, 'POST', '/api/register', OWNER);
  assert.strictEqual(r.status, 201, 'owner register: ' + r.text);
  return r.cookie;
}
/* An athlete account: a roster profile, an email linked to it by the
   coach, then the athlete signs up with that email. */
async function linkAndRegisterAthlete(app, ownerCookie, email, last) {
  const imp = await call(app, 'POST', '/api/profiles/import', { text: (last || 'Linked') + ', Athlete | Sprinters' }, ownerCookie);
  assert.strictEqual(imp.status, 200, 'roster: ' + imp.text);
  const prof = app.db().profiles.find(p => p.lastName === (last || 'Linked'));
  const link = await call(app, 'PUT', '/api/profiles/' + prof.id + '/link', { email }, ownerCookie);
  assert.strictEqual(link.status, 200, 'link: ' + link.text);
  const r = await call(app, 'POST', '/api/register', { email, password: 'athlete-pass-123', ageAttested: true });
  assert.strictEqual(r.status, 201, 'athlete register: ' + r.text);
  return r;
}
function backup(data) { return { app: 'sprinter-workout-app', kind: 'backup', version: 1, data }; }
/* Seal a backup the way the app does (AES-256-GCM, scrypt key). */
function sealed(plaintext, passphrase, mutate) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const env = {
    app: 'sprinter-workout-app', kind: 'backup-encrypted', version: 1, kdf: 'scrypt',
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'),
  };
  if (mutate) mutate(env);
  return env;
}
const corruptCopies = (dir) => fs.readdirSync(dir).filter(f => f.startsWith('db.json.corrupt-'));

async function main() {
  /* ================================================================ */
  console.log('1. Loading the saved data file at startup');
  /* ================================================================ */
  for (const [label, text] of [
    ['a file that is not JSON', '{"users": [ {"id": "u1", '],
    ['an empty file', ''],
    ['JSON without a users list', '{"profiles": [{"id": "p1"}]}'],
    ['a JSON list instead of an object', '[1, 2, 3]'],
    ['the word null', 'null'],
  ]) {
    await test('damaged data file (' + label + ') is kept aside byte for byte, and the app still starts', async () => {
      const app = await startApp({ dbText: text });
      try {
        const copies = corruptCopies(app.dir);
        assert.strictEqual(copies.length, 1, 'one preserved copy');
        assert.strictEqual(fs.readFileSync(path.join(app.dir, copies[0]), 'utf8'), text, 'original bytes kept');
        assert.ok(app.logs.join('').includes('DATA STORE CORRUPT'), 'loud log line');
        assert.strictEqual((await call(app, 'GET', '/api/me')).status, 401);
        const db = app.db();
        assert.ok(Array.isArray(db.users) && db.users.length === 0, 'fresh empty store written');
      } finally { await app.stop(); }
    });
  }

  await test('a healthy data file is never moved aside', async () => {
    const app = await startApp({ dbText: JSON.stringify({ users: [], profiles: [] }) });
    try {
      assert.deepStrictEqual(corruptCopies(app.dir), []);
      assert.ok(!app.logs.join('').includes('DATA STORE CORRUPT'));
    } finally { await app.stop(); }
  });

  await test('an older data file (no roles, no owner flag, odd settings) upgrades without losing anyone', async () => {
    const old = {
      users: [
        { id: 'u-old-1', email: 'old-coach@example.test', passHash: passHash('old-coach-pass') },
        { id: 'u-old-2', email: 'old-athlete@example.test', passHash: passHash('old-athlete-pass'), role: 'admin' },
      ],
      profiles: [{ id: 'p-old-1', firstName: 'Test', lastName: 'Runner', status: 'mystery' }],
      groups: 'not a list',
      logs: null,
      settings: { retentionMonths: 600 },
      sessionPlans: [{ id: 'plan-ok', versions: [{ v: 1 }] }, { id: 'plan-empty', versions: [] }, null],
      handoffs: [{ id: 'h-1', about: 'x', assign: 'y' }, { id: 'h-bad' }],
    };
    const app = await startApp({ dbText: JSON.stringify(old) });
    try {
      assert.deepStrictEqual(corruptCopies(app.dir), [], 'not treated as damaged');
      const c = await call(app, 'POST', '/api/login', { email: 'old-coach@example.test', password: 'old-coach-pass' });
      assert.strictEqual(c.status, 200, c.text);
      assert.strictEqual(c.json.role, 'coach');
      assert.strictEqual(c.json.isOwner, true, 'first account owns the store');
      const a = await call(app, 'POST', '/api/login', { email: 'old-athlete@example.test', password: 'old-athlete-pass' });
      assert.strictEqual(a.status, 200, a.text);
      assert.strictEqual(a.json.role, 'athlete', 'unknown role falls back to athlete');
      assert.strictEqual(a.json.isOwner, false);
      const db = app.db();
      assert.strictEqual(db.users.length, 2);
      assert.ok(Array.isArray(db.groups) && db.groups.length === 0, 'bad groups value replaced by an empty list');
      const prof = db.profiles.find(p => p.id === 'p-old-1');
      assert.ok(prof, 'profile kept');
      assert.deepStrictEqual(prof.events, []);
      assert.strictEqual(prof.archived, false);
      assert.strictEqual(prof.groupId, null);
      assert.strictEqual(prof.status, 'active');
      assert.ok(db.logs && Array.isArray(db.logs['u-old-1']), 'log slots made');
      assert.strictEqual(db.settings.retentionMonths, 12, 'out-of-range retention reset to 12 months');
      assert.strictEqual(db.settings.weightRoomSharedDisplay, true);
      assert.deepStrictEqual(db.sessionPlans.map(p => p.id), ['plan-ok'], 'broken plans dropped, good one kept');
      assert.deepStrictEqual(db.handoffs.map(h => h.id), ['h-1']);
      assert.deepStrictEqual(db.handoffs[0].history, []);
    } finally { await app.stop(); }
  });

  await test('saved data survives a restart and no half-written temp file is left behind', async () => {
    const app = await startApp();
    let app2;
    try {
      const owner = await registerOwner(app);
      const imp = await call(app, 'POST', '/api/profiles/import', { text: 'Runner, Test | Sprinters' }, owner);
      assert.strictEqual(imp.status, 200, imp.text);
      assert.ok(!fs.existsSync(app.dbFile + '.tmp'), 'no .tmp left');
      await app.stop(true);
      app2 = await startApp({ dir: app.dir });
      assert.strictEqual((await call(app2, 'POST', '/api/login', OWNER)).status, 200);
      assert.ok(app2.db().profiles.some(p => p.firstName === 'Test' && p.lastName === 'Runner'));
      assert.deepStrictEqual(corruptCopies(app.dir), []);
    } finally { if (app2) await app2.stop(); else await app.stop(); }
  });

  /* ================================================================ */
  console.log('2. Sign-in sessions');
  /* ================================================================ */
  {
    const app = await startApp();
    try {
      const owner = await registerOwner(app);
      const ownerId = app.db().users[0].id;
      const exp = Date.now() + 3600 * 1000;

      await test('no cookie: /api/me says not logged in and team data is closed', async () => {
        const me = await call(app, 'GET', '/api/me');
        assert.strictEqual(me.status, 401);
        assert.strictEqual(me.json.error, 'not logged in');
        assert.strictEqual((await call(app, 'GET', '/api/profiles')).status, 401);
      });

      await test('a correctly signed cookie is accepted (control for the checks below)', async () => {
        const me = await call(app, 'GET', '/api/me', undefined, signedCookie({ uid: ownerId, exp }));
        assert.strictEqual(me.status, 200);
        assert.strictEqual(me.json.email, OWNER.email);
      });

      const rejects = [
        ['signed with a different secret', signedCookie({ uid: ownerId, exp }, 'some-other-secret')],
        ['payload changed after signing', (() => {
          const good = signedCookie({ uid: ownerId, exp }).split('=')[1];
          const sig = good.slice(good.lastIndexOf('.') + 1);
          const forged = Buffer.from(JSON.stringify({ uid: ownerId, exp: exp + 9e9 })).toString('base64url');
          return COOKIE + '=' + forged + '.' + sig;
        })()],
        ['no dot in the value', COOKIE + '=justonelongvaluewithnodot'],
        ['empty value', COOKIE + '='],
        ['expired', signedCookie({ uid: ownerId, exp: Date.now() - 1000 })],
        ['missing user id', signedCookie({ exp })],
        ['missing expiry', signedCookie({ uid: ownerId })],
        ['for an account that no longer exists', signedCookie({ uid: 'no-such-user', exp })],
        ['signed but not JSON inside', signedCookie(null, SECRET, Buffer.from('not json').toString('base64url'))],
        ['signature of the wrong length', COOKIE + '=abc.def'],
        ['from the other app', 'rp_session=' + signedCookie({ uid: ownerId, exp }).split('=')[1]],
      ];
      for (const [label, cookie] of rejects) {
        await test('cookie ' + label + ' is refused', async () => {
          assert.strictEqual((await call(app, 'GET', '/api/me', undefined, cookie)).status, 401, label);
          assert.strictEqual((await call(app, 'GET', '/api/profiles', undefined, cookie)).status, 401, label + ' (team data)');
        });
      }

      await test('the right cookie is found among other cookies', async () => {
        const me = await call(app, 'GET', '/api/me', undefined, 'theme=dark; other=1; ' + owner + '; last=x');
        assert.strictEqual(me.status, 200);
      });

      await test('sign out clears the cookie', async () => {
        const out = await call(app, 'POST', '/api/logout', undefined, owner);
        assert.strictEqual(out.status, 200);
        assert.deepStrictEqual(out.json, { ok: true });
        assert.ok(/Max-Age=0/.test(out.setCookie), out.setCookie);
        assert.ok(out.setCookie.startsWith(COOKIE + '=;'), out.setCookie);
        assert.ok(/HttpOnly/.test(out.setCookie) && /SameSite=Lax/.test(out.setCookie));
      });

      await test('cookies are marked Secure behind https, and not over plain http', async () => {
        const plain = await call(app, 'POST', '/api/login', OWNER);
        assert.ok(!/Secure/.test(plain.setCookie), plain.setCookie);
        const https = await call(app, 'POST', '/api/login', OWNER, null, { headers: { 'x-forwarded-proto': 'https' } });
        assert.strictEqual(https.status, 200);
        assert.ok(/; Secure/.test(https.setCookie), https.setCookie);
      });

      await test('login: email is matched without regard to case or spaces', async () => {
        const r = await call(app, 'POST', '/api/login', { email: '  OWNER@Example.TEST ', password: OWNER.password });
        assert.strictEqual(r.status, 200);
      });

      await test('login refusals: wrong password, unknown email, empty body, bad JSON, password not text', async () => {
        assert.strictEqual((await call(app, 'POST', '/api/login', { email: OWNER.email, password: 'wrong-pass-123' })).status, 401);
        assert.strictEqual((await call(app, 'POST', '/api/login', { email: 'nobody@example.test', password: OWNER.password })).status, 401);
        assert.strictEqual((await call(app, 'POST', '/api/login', undefined, null, { raw: '' })).status, 401);
        assert.strictEqual((await call(app, 'POST', '/api/login', undefined, null, { raw: '{"email": ' })).status, 400);
        assert.strictEqual((await call(app, 'POST', '/api/login', { email: OWNER.email, password: 12345678 })).status, 401);
        assert.strictEqual((await call(app, 'GET', '/api/me', undefined, owner)).status, 200, 'server still fine');
      });

      await test('register refusals: duplicate email (any case), short password, bad email, no age check, uninvited', async () => {
        const reg = (b) => call(app, 'POST', '/api/register', b);
        assert.strictEqual((await reg({ email: 'Owner@Example.test', password: 'another-pass-1', ageAttested: true })).status, 409);
        assert.strictEqual((await reg({ email: 'x@example.test', password: 'short', ageAttested: true })).status, 400);
        assert.strictEqual((await reg({ email: 'not-an-email', password: 'long-enough-1', ageAttested: true })).status, 400);
        assert.strictEqual((await reg({ email: 'x@example.test', password: 'long-enough-1', ageAttested: 'yes' })).status, 400);
        assert.strictEqual((await reg({ email: 'stranger@example.test', password: 'long-enough-1', ageAttested: true })).status, 403);
        assert.strictEqual(app.db().users.length, 1, 'no account made by any refusal');
      });
    } finally { await app.stop(); }
  }

  await test('a damaged stored password hash refuses that login without crashing the app', async () => {
    const db = { users: [
      { id: 'u1', email: 'coach@example.test', passHash: passHash('coach-pass-123'), role: 'coach', isOwner: true },
      { id: 'u2', email: 'nohash@example.test', passHash: 'no-colon-here', role: 'athlete', isOwner: false },
      { id: 'u3', email: 'blank@example.test', role: 'athlete', isOwner: false },
    ] };
    const app = await startApp({ dbText: JSON.stringify(db) });
    try {
      assert.strictEqual((await call(app, 'POST', '/api/login', { email: 'nohash@example.test', password: 'anything-123' })).status, 401);
      assert.strictEqual((await call(app, 'POST', '/api/login', { email: 'blank@example.test', password: 'anything-123' })).status, 401);
      assert.strictEqual((await call(app, 'POST', '/api/login', { email: 'coach@example.test', password: 'coach-pass-123' })).status, 200);
    } finally { await app.stop(); }
  });

  await test('without SESSION_SECRET set, a sign-in still works after a restart', async () => {
    const app = await startApp({ noSecret: true });
    let app2;
    try {
      const owner = await registerOwner(app);
      assert.ok(fs.existsSync(path.join(app.dir, '.session-secret')), 'secret saved in the data folder');
      await app.stop(true);
      app2 = await startApp({ dir: app.dir, noSecret: true });
      assert.strictEqual((await call(app2, 'GET', '/api/me', undefined, owner)).status, 200, 'athletes stay signed in across a restart');
    } finally { if (app2) await app2.stop(); else await app.stop(); }
  });

  /* ================================================================ */
  console.log('3. Restoring a backup file');
  /* ================================================================ */
  {
    const app = await startApp();
    try {
      const owner = await registerOwner(app);
      const seed = await call(app, 'POST', '/api/import/backup', backup({
        groups: [{ id: 'g-1', name: 'Sprinters' }],
        profiles: [{ id: 'p-1', firstName: 'Ana', lastName: 'Example', groupId: 'g-1' }],
        coachInvites: ['assistant@example.test'],
        overrides: { 'g-1': { '2026-11-02': { kind: 'rest' } } },
      }), owner);
      assert.strictEqual(seed.status, 200, seed.text);
      const athlete = await linkAndRegisterAthlete(app, owner, 'athlete@example.test');
      const plainFile = JSON.stringify(backup({ groups: [{ id: 'g-sealed', name: 'Sealed' }] }));

      const refusals = [
        ['a file that is not JSON', { raw: '{"app": "sprinter' }, 'That file is not valid JSON.'],
        ['an empty file', { raw: '' }, 'That is not a sprinter app backup file.'],
        ['a backup from the other app', { body: { app: 'ruffin-performance-app', kind: 'backup', data: {} } }, 'That is not a sprinter app backup file.'],
        ['the wrong kind', { body: { app: 'sprinter-workout-app', kind: 'export', data: {} } }, 'That is not a sprinter app backup file.'],
        ['data that is a list', { body: { app: 'sprinter-workout-app', kind: 'backup', data: [] } }, 'That is not a sprinter app backup file.'],
        ['a list section that is not a list', { body: backup({ groups: { 'g-9': {} } }) }, 'The backup\'s "groups" should be a list.'],
        ['a record with no id', { body: backup({ profiles: [{ firstName: 'No', lastName: 'Id' }] }) }, 'A record in "profiles" is missing its id — the file looks damaged.'],
        ['a record that is not an object', { body: backup({ groups: ['g-9'] }) }, 'A record in "groups" is missing its id — the file looks damaged.'],
        ['a custom test with no key', { body: backup({ customTests: [{ id: 'x', name: 'No key' }] }) }, 'A record in "customTests" is missing its key — the file looks damaged.'],
        ['coach invites that are not a list', { body: backup({ coachInvites: 'a@example.test' }) }, 'The backup\'s "coachInvites" should be a list of emails.'],
        ['coach invites holding a number', { body: backup({ coachInvites: ['a@example.test', 5] }) }, 'The backup\'s "coachInvites" should be a list of emails.'],
        ['an object section that is a list', { body: backup({ overrides: [] }) }, 'The backup\'s "overrides" should be an object.'],
        ['an object section that is text', { body: backup({ athleteLinks: 'x' }) }, 'The backup\'s "athleteLinks" should be an object.'],
        ['the seeded flag as text', { body: backup({ customWorkoutsSeeded: 'yes' }) }, 'The backup\'s "customWorkoutsSeeded" should be true or false.'],
        ['an encrypted file with no passphrase', { body: sealed(plainFile, 'right-passphrase') }, 'This backup is encrypted — enter its passphrase to import it.'],
        ['an encrypted file with the wrong passphrase', { body: Object.assign(sealed(plainFile, 'right-passphrase'), { passphrase: 'wrong-passphrase' }) }, 'That passphrase did not unlock this backup.'],
        ['an encrypted file that was altered', { body: sealed(plainFile, 'right-passphrase', (e) => {
          const b = Buffer.from(e.data, 'base64'); b[0] ^= 1; e.data = b.toString('base64'); e.passphrase = 'right-passphrase';
        }) }, 'That passphrase did not unlock this backup.'],
        ['an encrypted file missing its pieces', { body: sealed(plainFile, 'right-passphrase', (e) => { delete e.iv; delete e.tag; e.passphrase = 'right-passphrase'; }) }, 'That passphrase did not unlock this backup.'],
        ['an encrypted file whose contents are not JSON', { body: Object.assign(sealed('this is not json', 'right-passphrase'), { passphrase: 'right-passphrase' }) }, 'That backup file looks damaged.'],
        ['an encrypted file holding another app\'s backup', { body: Object.assign(sealed(JSON.stringify({ app: 'ruffin-performance-app', kind: 'backup', data: {} }), 'right-passphrase'), { passphrase: 'right-passphrase' }) }, 'That is not a sprinter app backup file.'],
      ];
      for (const [label, req, msg] of refusals) {
        await test('backup refused (' + label + ') and nothing changes', async () => {
          const before = app.dbText();
          const r = req.raw !== undefined
            ? await call(app, 'POST', '/api/import/backup', undefined, owner, { raw: req.raw })
            : await call(app, 'POST', '/api/import/backup', req.body, owner);
          assert.strictEqual(r.status, 400, r.text);
          assert.strictEqual(r.json.error, msg);
          assert.strictEqual(app.dbText(), before, 'data file untouched');
        });
      }

      await test('an encrypted backup with the right passphrase restores', async () => {
        const r = await call(app, 'POST', '/api/import/backup', Object.assign(sealed(plainFile, 'right-passphrase'), { passphrase: 'right-passphrase' }), owner);
        assert.strictEqual(r.status, 200, r.text);
        assert.ok(app.db().groups.some(g => g.id === 'g-sealed'));
      });

      await test('one bad section refuses the whole file: good sections before it are not half-restored', async () => {
        const before = app.dbText();
        const r = await call(app, 'POST', '/api/import/backup', backup({
          groups: [{ id: 'g-2', name: 'Hurdlers' }],
          profiles: [{ id: 'p-2', firstName: 'Bo', lastName: 'Sample' }],
          overrides: [],
        }), owner);
        assert.strictEqual(r.status, 400);
        assert.strictEqual(app.dbText(), before);
        assert.ok(!app.db().groups.some(g => g.id === 'g-2'));
      });

      await test('an athlete account cannot restore a backup', async () => {
        const before = app.dbText();
        const r = await call(app, 'POST', '/api/import/backup', backup({ groups: [{ id: 'g-x', name: 'X' }] }), athlete.cookie);
        assert.strictEqual(r.status, 403);
        assert.strictEqual(app.dbText(), before);
      });

      await test('a signed-out request cannot restore a backup', async () => {
        const r = await call(app, 'POST', '/api/import/backup', backup({ groups: [{ id: 'g-x', name: 'X' }] }));
        assert.strictEqual(r.status, 401);
      });

      await test('restore merges and never deletes: records missing from the file stay', async () => {
        const r = await call(app, 'POST', '/api/import/backup', backup({ groups: [{ id: 'g-3', name: 'Jumpers' }] }), owner);
        assert.strictEqual(r.status, 200, r.text);
        const db = app.db();
        assert.ok(db.groups.some(g => g.id === 'g-1'), 'old group kept');
        assert.ok(db.profiles.some(p => p.id === 'p-1'), 'old profile kept');
        assert.ok(db.groups.some(g => g.id === 'g-3'), 'new group added');
        assert.strictEqual(db.overrides['g-1']['2026-11-02'].kind, 'rest', 'keyed data kept');
        assert.ok(db.users.some(u => u.email === 'athlete@example.test'), 'accounts untouched');
      });

      await test('the same record twice in one file lands once, with the later copy', async () => {
        const r = await call(app, 'POST', '/api/import/backup', backup({ groups: [
          { id: 'g-dup', name: 'First copy' }, { id: 'g-dup', name: 'Second copy' },
        ] }), owner);
        assert.strictEqual(r.status, 200, r.text);
        const dups = app.db().groups.filter(g => g.id === 'g-dup');
        assert.strictEqual(dups.length, 1);
        assert.strictEqual(dups[0].name, 'Second copy');
        assert.deepStrictEqual(r.json.counts.groups, { added: 1, updated: 1 });
      });

      await test('restoring the same file twice changes nothing the second time', async () => {
        const file = backup({ groups: [{ id: 'g-4', name: 'Relay' }], weekly: { 'p-1': { '2026-11-02': { sleep: 8 } } } });
        assert.strictEqual((await call(app, 'POST', '/api/import/backup', file, owner)).status, 200);
        const b = await call(app, 'POST', '/api/import/backup', file, owner);
        assert.strictEqual(b.status, 200);
        assert.strictEqual(b.json.totalAdded, 0);
        assert.strictEqual(b.json.totalUpdated, 0);
      });

      await test('coach invites merge as a set: case and spaces folded, nothing removed', async () => {
        const r = await call(app, 'POST', '/api/import/backup', backup({
          coachInvites: ['  ASSISTANT@example.test ', 'second@example.test', ''],
        }), owner);
        assert.strictEqual(r.status, 200, r.text);
        const db = app.db();
        assert.strictEqual(db.coachInvites.filter(e => e === 'assistant@example.test').length, 1);
        assert.ok(db.coachInvites.includes('second@example.test'));
      });

      await test('the seeded-workout flag restores, so a deleted seed workout never comes back', async () => {
        const r = await call(app, 'POST', '/api/import/backup', backup({ customWorkoutsSeeded: false }), owner);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(app.db().customWorkoutsSeeded, false);
        const r2 = await call(app, 'POST', '/api/import/backup', backup({ customWorkoutsSeeded: true }), owner);
        assert.deepStrictEqual(r2.json.counts.customWorkoutsSeeded, { added: 0, updated: 1 });
        assert.strictEqual(app.db().customWorkoutsSeeded, true);
      });

      await test('every restore is written to the audit log', async () => {
        const log = app.db().exportLog || [];
        assert.ok(log.some(e => e.kind === 'backup-import' && e.email === OWNER.email));
      });

      await test('a backup never carries logins: an export has no users, hashes or secret', async () => {
        const res = await fetch(app.base + '/api/export/backup', { headers: { cookie: owner } });
        assert.strictEqual(res.status, 200);
        const text = await res.text();
        const file = JSON.parse(text);
        assert.strictEqual(file.data.users, undefined);
        assert.ok(!text.includes('passHash'), 'no password hashes');
        assert.ok(!text.includes(SECRET), 'no session secret');
      });

      await test('an encrypted export needs a passphrase of at least 8 characters', async () => {
        for (const passphrase of [undefined, '', 'short', 12345678]) {
          const r = await call(app, 'POST', '/api/export/backup', { passphrase }, owner);
          assert.strictEqual(r.status, 400, String(passphrase));
        }
      });
    } finally { await app.stop(); }
  }

  /* ================================================================ */
  console.log('4. Roster import');
  /* ================================================================ */
  {
    const app = await startApp();
    try {
      const owner = await registerOwner(app);
      const imp = (text) => call(app, 'POST', '/api/profiles/import', { text }, owner);

      await test('roster import: an empty paste is refused and nothing is saved', async () => {
        const before = app.dbText();
        for (const t of ['', '   \n\n  ']) {
          const r = await imp(t);
          assert.strictEqual(r.status, 400);
          assert.strictEqual(r.json.error, 'Paste the roster lines first.');
        }
        assert.strictEqual((await call(app, 'POST', '/api/profiles/import', { text: 42 }, owner)).status, 400);
        assert.strictEqual(app.dbText(), before);
      });

      await test('roster import: more than 500 lines is refused whole', async () => {
        const lines = [];
        for (let i = 0; i < 501; i++) lines.push('Person' + i + ', Test | Big Group');
        const r = await imp(lines.join('\n'));
        assert.strictEqual(r.status, 400);
        assert.ok(/more than 500/.test(r.json.error));
        assert.strictEqual(app.db().profiles.length, 0);
      });

      await test('roster import: plain text upload (not JSON) works', async () => {
        const r = await call(app, 'POST', '/api/profiles/import', undefined, owner,
          { raw: 'Alpha, Ann | Sprinters | 100m, 200m | yes\r\n', contentType: 'text/plain' });
        assert.strictEqual(r.status, 200, r.text);
        assert.strictEqual(r.json.report.created, 1);
        const p = app.db().profiles.find(x => x.lastName === 'Alpha');
        assert.strictEqual(p.firstName, 'Ann');
        assert.deepStrictEqual(p.events, ['100m', '200m']);
        assert.strictEqual(p.topAthlete, true);
      });

      await test('roster import: name,group CSV with quoted names, doubled quotes and "First Last" names', async () => {
        const r = await imp([
          'name,group,events,top',
          '"O""Brien, Pat",Hurdlers,"110h;300h",no',
          'Casey Jordan Lee,Hurdlers',
          '',
        ].join('\n'));
        assert.strictEqual(r.status, 200, r.text);
        assert.strictEqual(r.json.report.created, 2, JSON.stringify(r.json.report));
        const db = app.db();
        const pat = db.profiles.find(x => x.firstName === 'Pat');
        assert.strictEqual(pat.lastName, 'O"Brien');
        assert.deepStrictEqual(pat.events, ['110h', '300h']);
        const casey = db.profiles.find(x => x.firstName === 'Casey');
        assert.strictEqual(casey.lastName, 'Jordan Lee');
        assert.strictEqual(db.groups.filter(g => g.name === 'Hurdlers').length, 1, 'group made once');
      });

      await test('roster import: bad lines are reported and good lines still land', async () => {
        const r = await imp([
          'Onlyname | Sprinters',
          'Good, Gale | Sprinters',
          'Nogroup, Ned |',
          'a line with no separators',
          'name,group',
          'loneword',
        ].join('\n'));
        assert.strictEqual(r.status, 200, r.text);
        const rep = r.json.report;
        assert.strictEqual(rep.created, 1);
        assert.deepStrictEqual(rep.errors.map(e => e.line), [1, 3, 4, 6]);
        assert.ok(/Missing a first name/.test(rep.errors[0].reason));
        assert.ok(/Use "Last, First/.test(rep.errors[2].reason));
        assert.ok(/at least a name and a group/.test(rep.errors[3].reason));
      });

      await test('roster import: a name already on the roster is skipped, in any group or case', async () => {
        const r = await imp(['ALPHA, ann | Sprinters', 'Alpha, Ann | Distance', 'Brand, New | Distance', 'brand, new | Distance'].join('\n'));
        assert.strictEqual(r.status, 200, r.text);
        const rep = r.json.report;
        assert.strictEqual(rep.created, 1);
        assert.strictEqual(rep.skipped.length, 3);
        assert.ok(/Already on the roster in that group/.test(rep.skipped[0].reason));
        assert.ok(/Already on the roster in Sprinters/.test(rep.skipped[1].reason), rep.skipped[1].reason);
        assert.strictEqual(app.db().profiles.filter(p => p.lastName.toLowerCase() === 'alpha').length, 1);
        assert.strictEqual(app.db().profiles.filter(p => p.lastName.toLowerCase() === 'brand').length, 1);
      });

      await test('spreadsheet roster: one "Name" column, blank rows, lower-case names and repeats', async () => {
        const r = await call(app, 'POST', '/api/profiles/import', undefined, owner, { contentType: 'text/plain', raw: [
          '',
          'Name,Event Group,Classification',
          'jamie rivers,SS,Varsity A',
          ',,',
          'Jamie Rivers,LS,JV',
          ',SS,',
          'Solo,H,JV',
          'Distance Only,Distance,JV',
          'No Group Given,,JV',
        ].join('\r\n') });
        assert.strictEqual(r.status, 200, r.text);
        const rep = r.json.report;
        assert.strictEqual(rep.created, 1, JSON.stringify(rep));
        const jamie = app.db().profiles.find(p => p.lastName === 'Rivers');
        assert.strictEqual(jamie.firstName, 'Jamie', 'lower-case name gets capitals');
        assert.strictEqual(jamie.level, 'varsity-a');
        assert.deepStrictEqual(jamie.eventGroups, ['Short sprints']);
        assert.ok(rep.skipped.some(s => /Listed twice/.test(s.reason)), 'repeat row skipped');
        assert.strictEqual(rep.errors.filter(e => e.reason === 'No name on this row.').length, 2, 'nameless and one-word rows reported');
        assert.ok(rep.left.some(l => /Distance only/.test(l.reason)), 'distance-only athlete left out');
        assert.ok(rep.skipped.some(s => /No event group listed/.test(s.reason)));
        assert.strictEqual(app.db().profiles.filter(p => p.lastName === 'Rivers').length, 1);
      });

      await test('spreadsheet roster: a contacts-only file updates athletes already there and adds nobody', async () => {
        const before = app.db().profiles.length;
        const r = await imp([
          'First Name,Last Name,Best email address?,Cell phone number?',
          'Jamie,Rivers,Jamie.Rivers@Example.test,(202) 555-0147',
          'Ann,Alpha,not-an-email,12',
          'New,Person,new.person@example.test,202-555-0199',
          'Onlyfirst,,only.first@example.test,',
        ].join('\n'));
        assert.strictEqual(r.status, 200, r.text);
        const rep = r.json.report;
        assert.strictEqual(rep.created, 0);
        assert.strictEqual(app.db().profiles.length, before, 'nobody added');
        const jamie = app.db().profiles.find(p => p.lastName === 'Rivers');
        assert.strictEqual(jamie.email, 'jamie.rivers@example.test');
        assert.strictEqual(jamie.phone, '202-555-0147');
        const ann = app.db().profiles.find(p => p.lastName === 'Alpha');
        assert.ok(!ann.email, 'bad email not saved');
        assert.ok(rep.errors.some(e => /email not saved/.test(e.reason) && /phone not saved/.test(e.reason)));
        assert.ok(rep.skipped.some(s => /Not on the roster/.test(s.reason)));
        assert.ok(rep.errors.some(e => e.reason === 'Needs both a first and a last name.'), 'missing last name reported');
      });

      await test('spreadsheet roster: a blank cell never wipes a saved value', async () => {
        const r = await imp(['First Name,Last Name,Best email address?,Event Group', 'Jamie,Rivers,,'].join('\n'));
        assert.strictEqual(r.status, 200, r.text);
        const jamie = app.db().profiles.find(p => p.lastName === 'Rivers');
        assert.strictEqual(jamie.email, 'jamie.rivers@example.test');
        assert.deepStrictEqual(jamie.eventGroups, ['Short sprints']);
      });
    } finally { await app.stop(); }
  }

  /* ================================================================ */
  console.log('5. Device test-result import');
  /* ================================================================ */
  {
    const app = await startApp();
    try {
      const owner = await registerOwner(app);
      const seed = await call(app, 'POST', '/api/import/backup', backup({
        groups: [{ id: 'g-1', name: 'Sprinters' }],
        profiles: [
          { id: 'p-ana', firstName: 'Ana', lastName: 'Example', groupId: 'g-1' },
          { id: 'p-twin1', firstName: 'Sam', lastName: 'Twin', groupId: 'g-1' },
          { id: 'p-twin2', firstName: 'Sam', lastName: 'Twin', groupId: 'g-1' },
          { id: 'p-gone', firstName: 'Old', lastName: 'Archived', groupId: 'g-1', archived: true },
        ],
      }), owner);
      assert.strictEqual(seed.status, 200, seed.text);
      const preview = (csv, device) => call(app, 'POST', '/api/devices/' + (device || 'forcedecks') + '/preview', { csv }, owner);
      const commit = (body, device) => call(app, 'POST', '/api/devices/' + (device || 'forcedecks') + '/commit', body, owner);

      const refusals = [
        ['no file chosen', '', 'Choose a CSV file first.'],
        ['only blank rows and commas', ' ,, \n , \n', 'That file looks empty.'],
        ['no name column', 'Date,Jump Height (cm)\n2026-11-02,40', 'That file has no athlete name column — the import needs a column headed Name or Athlete.'],
      ];
      for (const [label, csv, msg] of refusals) {
        await test('device preview refused (' + label + ')', async () => {
          const r = await preview(csv);
          assert.strictEqual(r.status, 400, r.text);
          assert.strictEqual(r.json.error, msg);
        });
      }

      await test('device preview: more than 2,000 data rows is refused', async () => {
        const rows = ['Name,Date,Jump Height (cm)'];
        for (let i = 0; i < 2001; i++) rows.push('Ana Example,2026-11-02,' + (30 + (i % 10)));
        const r = await preview(rows.join('\n'));
        assert.strictEqual(r.status, 400);
        assert.ok(/more than 2,000/.test(r.json.error));
      });

      await test('device preview: bad request shapes are refused', async () => {
        assert.strictEqual((await preview('Name,Date\nA,2026-11-02', 'nosuchdevice')).status, 404);
        const bad = await call(app, 'POST', '/api/devices/forcedecks/preview', undefined, owner, { raw: '{"csv": ' });
        assert.strictEqual(bad.status, 400);
        assert.strictEqual(bad.json.error, 'That request was not valid JSON.');
        assert.strictEqual((await call(app, 'POST', '/api/devices/forcedecks/preview', { csv: 7 }, owner)).status, 400);
      });

      await test('device preview: a file with no date column asks the coach for the day', async () => {
        const r = await preview('Name,Jump Height (cm)\nAna Example,40');
        assert.strictEqual(r.status, 200, r.text);
        assert.strictEqual(r.json.needsDate, true);
        assert.strictEqual(r.json.rows[0].date, null);
      });

      await test('device preview: each bad row is named, good rows still come through, nothing is saved', async () => {
        const before = app.dbText();
        const csv = '﻿' + [
          'Athlete,Test Date,Jump Height (cm),RSI,Notes',
          ',2026-11-02,40,1.2,no name here',
          'Ana Example,11/31/2026,40,1.2,impossible date',
          'Ana Example,yesterday,40,1.2,word date',
          'Ana Example,2026-11-02,,,no numbers',
          '"Example, Ana",11/3/2026,"1,040",85%,last-first order',
          'Sam Twin,2026-11-02,38,1.1,two on the roster',
          'Old Archived,2026-11-02,30,1.0,archived athlete',
          'Nobody Known,2026-11-02,30,1.0,not on roster',
        ].join('\r\n');
        const r = await preview(csv);
        assert.strictEqual(r.status, 200, r.text);
        assert.strictEqual(r.json.needsDate, false);
        assert.deepStrictEqual(r.json.errors.map(e => e.rowIndex), [1, 2, 3, 4]);
        assert.strictEqual(r.json.errors[0].reason, 'No athlete name in this row.');
        assert.ok(/Unrecognized date "11\/31\/2026"/.test(r.json.errors[1].reason));
        assert.strictEqual(r.json.errors[3].reason, 'No test numbers in this row.');
        assert.strictEqual(r.json.rows.length, 4);
        const ana = r.json.rows[0];
        assert.strictEqual(ana.profileId, 'p-ana');
        assert.strictEqual(ana.date, '2026-11-03');
        assert.deepStrictEqual(ana.metrics, { 'Jump Height (cm)': 1040, RSI: 85 });
        const twin = r.json.rows[1];
        assert.strictEqual(twin.profileId, null);
        assert.ok(/More than one athlete/.test(twin.matchNote));
        assert.strictEqual(r.json.rows[2].profileId, null, 'archived athletes are not matched');
        assert.strictEqual(r.json.rows[3].profileId, null);
        assert.strictEqual(r.json.rows[3].matchNote, undefined);
        assert.strictEqual(app.dbText(), before, 'preview writes nothing');
      });

      await test('device commit: bad request shapes and bad session dates are refused, nothing saved', async () => {
        const before = app.dbText();
        assert.strictEqual((await commit({})).status, 400);
        assert.strictEqual((await commit({ rows: 'rows' })).status, 400);
        assert.strictEqual((await commit({ rows: [] }, 'nosuchdevice')).status, 404);
        const big = [];
        for (let i = 0; i < 2001; i++) big.push({ profileId: 'p-ana', date: '2026-11-02', metrics: { RSI: 1 } });
        const r = await commit({ rows: big });
        assert.strictEqual(r.status, 400);
        assert.ok(/more than 2,000/.test(r.json.error));
        assert.strictEqual((await call(app, 'POST', '/api/devices/forcedecks/commit', undefined, owner, { raw: 'nope' })).status, 400);
        const notReal = await commit({ rows: [{ profileId: 'p-ana', metrics: { RSI: 1 } }], sessionDate: '2026-02-30' });
        assert.strictEqual(notReal.status, 400);
        // PR 35 reworded this message in plain words ("Pick the testing date.").
        assert.ok(/Pick the testing date/.test(notReal.json.error));
        const future = await commit({ rows: [{ profileId: 'p-ana', metrics: { RSI: 1 } }], sessionDate: '2999-01-01' });
        assert.strictEqual(future.status, 400);
        assert.ok(/in the future/.test(future.json.error));
        assert.strictEqual(app.dbText(), before);
      });

      await test('device commit: rows with no athlete, bad date or no numbers are skipped and counted', async () => {
        const before = app.dbText();
        const r = await commit({ rows: [
          { profileId: 'no-such-athlete', date: '2026-11-02', metrics: { RSI: 1.2 } },
          { profileId: 'p-ana', date: '2026-02-30', metrics: { RSI: 1.2 } },
          { profileId: 'p-ana', date: '2026-11-02', metrics: { RSI: 'abc', Other: null } },
          { profileId: 'p-ana', date: '2026-11-02', metrics: ['not', 'an', 'object'] },
          { rawName: '', date: '2026-11-02', metrics: { RSI: 1 } },
          { rawName: 'Someone', date: 'bad', metrics: { RSI: 1 } },
          null, 'junk',
        ] });
        assert.strictEqual(r.status, 200, r.text);
        assert.deepStrictEqual([r.json.filed, r.json.skipped, r.json.results, r.json.stored], [0, 8, 0, 0]);
        assert.strictEqual(app.dbText(), before, 'nothing filed, nothing saved');
      });

      await test('device commit: a session date fills only rows with no date of their own', async () => {
        const r = await commit({ sessionDate: '2026-11-05', rows: [
          { profileId: 'p-ana', date: '', metrics: { 'Peak Power (W)': 3000 } },
          { profileId: 'p-ana', metrics: { 'Peak Power (W)': 3100 } },
          { profileId: 'p-ana', date: '2026-11-06', metrics: { 'Peak Power (W)': 3200 } },
          { profileId: 'p-ana', date: 'garbled', metrics: { 'Peak Power (W)': 3300 } },
        ] }, 'nordbord');
        assert.strictEqual(r.status, 200, r.text);
        assert.deepStrictEqual([r.json.filed, r.json.skipped], [3, 1], 'a bad own date is not papered over');
        const days = app.db().testDays.filter(d => d.device === 'nordbord').map(d => d.date).sort();
        assert.deepStrictEqual(days, ['2026-11-05', '2026-11-06']);
      });

      await test('device commit: filing the same results twice never doubles them', async () => {
        const rows = [{ profileId: 'p-ana', date: '11/3/2026', metrics: { 'Jump Height (cm)': 41.5, 'RSI': '1.3' } }];
        const a = await commit({ rows });
        assert.deepStrictEqual([a.json.filed, a.json.skipped, a.json.results], [1, 0, 2]);
        const b = await commit({ rows });
        assert.deepStrictEqual([b.json.filed, b.json.results], [1, 2]);
        const db = app.db();
        const days = db.testDays.filter(d => d.device === 'forcedecks' && d.date === '2026-11-03');
        assert.strictEqual(days.length, 1, 'one test day per device and date');
        const results = (db.testResults['p-ana'] || []).filter(x => x.testDayId === days[0].id);
        assert.strictEqual(results.length, 2, 'two metrics, filed once each');
      });

      await test('device commit: unmatched rows are kept once for the coach to attach later', async () => {
        const rows = [{ rawName: 'Nobody Known', date: '2026-11-02', metrics: { RSI: 1.0 } }];
        const a = await commit({ rows });
        assert.deepStrictEqual([a.json.stored, a.json.kept], [1, 0]);
        const b = await commit({ rows });
        assert.deepStrictEqual([b.json.stored, b.json.kept], [0, 1]);
        assert.strictEqual(app.db().deviceRows.filter(x => x.rawName === 'Nobody Known').length, 1);
      });

      await test('device import is coaches only', async () => {
        const athlete = await linkAndRegisterAthlete(app, owner, 'device-athlete@example.test', 'Devicetester');
        assert.strictEqual((await call(app, 'POST', '/api/devices/forcedecks/preview', { csv: 'Name,Date,X\nA,2026-11-02,1' }, athlete.cookie)).status, 403);
        assert.strictEqual((await call(app, 'POST', '/api/devices/forcedecks/commit', { rows: [] }, athlete.cookie)).status, 403);
        assert.strictEqual((await call(app, 'POST', '/api/devices/forcedecks/commit', { rows: [] })).status, 401);
      });
    } finally { await app.stop(); }
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
