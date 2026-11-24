#!/usr/bin/env node
'use strict';
/*
 * Hosted-store (Vercel) mode tests. Everything runs locally against a
 * fake Upstash (tests/fake-upstash.js) and, for emails, a fake Resend.
 * No real account, address, token or member data is used: every
 * email, password and key below is made up.
 *
 * Proves the Brief 7 blockers are fixed in store mode:
 *   - two copies of the app saving at the same moment both stick
 *   - data survives a restart with no disk
 *   - a save clash re-runs the request; its email goes out once
 *   - emails finish before the reply
 *   - an empty store cannot be claimed by a stranger
 *   - no SESSION_SECRET = a clear 503, never a made-up key
 *   - the visit-count limit holds across copies
 *   - read-only pause, big replies gzipped, upload caps on Vercel
 *   - the Vercel entry point serves the branded pages
 *   - the one-time copy tool moves a real db.json and checks counts
 *
 * Usage: node tests/store-tests.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { startFakeUpstash, FAKE_TOKEN } = require('./fake-upstash');
const storeLib = require('../lib/store');
const copyTool = require('../scripts/copy-to-store');

const APP_DIR = path.dirname(__dirname);
const SECRET = 'test-session-secret-not-real';

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

const children = [];
async function startApp(env, opts = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
  const args = opts.vercelEntry
    ? ['-e', "require('http').createServer(require(process.argv[1])).listen(+process.env.PORT, '127.0.0.1')", path.join(APP_DIR, 'api', 'index.js')]
    : [path.join(APP_DIR, 'server.js')];
  const child = spawn(process.execPath, args, {
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dataDir }, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  children.push(child);
  const app = { port, base: 'http://127.0.0.1:' + port, child, dataDir, log: () => log };
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    try { await raw(app, 'GET', '/robots.txt'); return app; } catch (_) { await new Promise(r => setTimeout(r, 50)); }
  }
  throw new Error('app did not start: ' + log);
}
function stopApp(app) {
  try { app.child.kill('SIGKILL'); } catch (_) { /* gone */ }
  fs.rmSync(app.dataDir, { recursive: true, force: true });
}

function raw(app, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(app.base + p, {
      method,
      headers: Object.assign(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}, headers),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
async function api(app, cookie, method, p, body) {
  const r = await raw(app, method, p, body, cookie ? { cookie } : {});
  let json = null;
  try { json = JSON.parse(r.buf.toString('utf8')); } catch (_) { /* not json */ }
  const sc = r.headers['set-cookie'];
  return { status: r.status, json, text: r.buf.toString('utf8'), cookie: sc ? String(sc[0]).split(';')[0] : null };
}

function startFakeResend() {
  return new Promise((resolve) => {
    const fake = { seen: [] };
    fake.server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* bad */ }
        fake.seen.push({ path: req.url, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'email_' + fake.seen.length }));
      });
    });
    fake.server.listen(0, '127.0.0.1', () => { fake.base = 'http://127.0.0.1:' + fake.server.address().port; resolve(fake); });
  });
}

(async () => {
  const fake = await startFakeUpstash();
  let prefixN = 0;
  const storeEnv = (extra) => Object.assign({
    UPSTASH_REDIS_REST_URL: fake.url,
    UPSTASH_REDIS_REST_TOKEN: FAKE_TOKEN,
    STORE_PREFIX: 'st' + (++prefixN),
    SESSION_SECRET: SECRET,
    OWNER_SETUP_EMAIL: 'owner@example.test',
  }, extra || {});

  try {
    console.log('lib/store.js');
    await test('settings: either naming turns store mode on; neither leaves it off', async () => {
      assert.strictEqual(storeLib.configFromEnv({}, 'x'), null);
      assert.strictEqual(storeLib.configFromEnv({ UPSTASH_REDIS_REST_URL: 'https://a.example' }, 'x'), null);
      const a = storeLib.configFromEnv({ UPSTASH_REDIS_REST_URL: 'https://a.example/', UPSTASH_REDIS_REST_TOKEN: 't' }, 'x');
      assert.deepStrictEqual(a, { url: 'https://a.example', token: 't', prefix: 'x' });
      const b = storeLib.configFromEnv({ KV_REST_API_URL: 'https://b.example', KV_REST_API_TOKEN: 't', STORE_PREFIX: 'stage' }, 'x');
      assert.strictEqual(b.prefix, 'stage');
    });
    await test('encode/decode round-trips and stays small', async () => {
      const obj = { users: [{ email: 'a@example.test' }], logs: { x: new Array(500).fill('same text') } };
      const enc = storeLib.encode(obj);
      assert.ok(enc.startsWith('gz1:'));
      assert.ok(enc.length < JSON.stringify(obj).length / 5, 'not compressed');
      assert.deepStrictEqual(storeLib.decode(enc), obj);
      assert.deepStrictEqual(storeLib.decode('{"users":[]}'), { users: [] });
      assert.strictEqual(storeLib.decode(null), null);
    });
    await test('a save with an old version is refused; the store is untouched', async () => {
      const s = storeLib.createUpstash({ url: fake.url, token: FAKE_TOKEN, prefix: 'unit1' });
      assert.deepStrictEqual(await s.load(), { version: 0, data: null });
      assert.strictEqual(await s.commit(0, { users: [1] }), 1);
      assert.strictEqual(await s.commit(0, { users: [2] }), -1);
      assert.deepStrictEqual((await s.load()).data, { users: [1] });
      assert.strictEqual(await s.commit(1, { users: [3] }), 2);
    });
    await test('a wrong token fails without printing the token', async () => {
      const s = storeLib.createUpstash({ url: fake.url, token: 'wrong-token-xyz', prefix: 'unit2' });
      await assert.rejects(s.load(), (err) => err.storeError && !/wrong-token-xyz/.test(err.message) && !err.message.includes(fake.url));
    });
    await test('a save clash re-runs the request; its deferred work runs once, before the reply', async () => {
      const s = storeLib.createUpstash({ url: fake.url, token: FAKE_TOKEN, prefix: 'unit3' });
      let mem = null, runs = 0, emails = 0, sneak = true;
      const tx = storeLib.createTransactions(s, {
        setData: (d) => { mem = d || { users: [], n: 0 }; },
        getData: () => mem,
        handle: async (req, res) => {
          runs++;
          mem.n = (mem.n || 0) + 1;
          tx.markDirty();
          tx.defer(() => { emails++; });
          if (sneak) { /* another copy saves first */
            sneak = false;
            const cur = await s.load();
            await s.commit(cur.version, { users: [], n: 100 });
          }
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('n=' + mem.n + ' emails=' + emails);
        },
        log: () => {},
      });
      const srv = http.createServer((req, res) => tx.run(req, res));
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      const r = await raw({ base: 'http://127.0.0.1:' + srv.address().port }, 'POST', '/x', {});
      srv.close();
      assert.strictEqual(runs, 2, 'request should run twice');
      assert.strictEqual(emails, 1, 'deferred work ran ' + emails + ' times');
      assert.strictEqual(r.buf.toString(), 'n=101 emails=0');
      assert.strictEqual((await s.load()).data.n, 101, 'the other copy\'s save was lost');
    });
    await test('big replies are gzipped when the browser accepts it', async () => {
      const s = storeLib.createUpstash({ url: fake.url, token: FAKE_TOKEN, prefix: 'unit4' });
      const big = JSON.stringify({ rows: new Array(60000).fill({ name: 'Made Up Athlete', mark: '11.42' }) });
      const tx = storeLib.createTransactions(s, {
        setData: () => {}, getData: () => ({}),
        handle: (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(big) }); res.end(big); },
        log: () => {},
      });
      const srv = http.createServer((req, res) => tx.run(req, res));
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      const app = { base: 'http://127.0.0.1:' + srv.address().port };
      const g = await raw(app, 'GET', '/x', undefined, { 'accept-encoding': 'gzip' });
      const p = await raw(app, 'GET', '/x');
      srv.close();
      assert.strictEqual(g.headers['content-encoding'], 'gzip');
      assert.ok(g.buf.length < big.length / 10);
      assert.strictEqual(zlib.gunzipSync(g.buf).toString(), big);
      assert.strictEqual(p.headers['content-encoding'], undefined);
      assert.strictEqual(p.buf.toString(), big);
    });

    console.log('server.js in store mode');
    await test('without SESSION_SECRET the API answers 503 (never a made-up key); pages still load', async () => {
      const app = await startApp(storeEnv({ SESSION_SECRET: '' }));
      try {
        const r = await api(app, null, 'GET', '/api/me');
        assert.strictEqual(r.status, 503, r.text);
        assert.ok(/setting up/.test(r.json.error));
        assert.ok(!fs.existsSync(path.join(app.dataDir, '.session-secret')), 'wrote a secret file');
        assert.strictEqual((await raw(app, 'GET', '/')).status, 200);
      } finally { stopApp(app); }
    });
    await test('an empty store cannot be claimed by a stranger', async () => {
      const none = await startApp(storeEnv({ OWNER_SETUP_EMAIL: '' }));
      try {
        const r = await api(none, null, 'POST', '/api/register', { email: 'owner@example.test', password: 'made-up-pass-1' });
        assert.strictEqual(r.status, 403, r.text);
      } finally { stopApp(none); }
      const app = await startApp(storeEnv());
      try {
        let r = await api(app, null, 'POST', '/api/register', { email: 'stranger@example.test', password: 'made-up-pass-1' });
        assert.strictEqual(r.status, 403, r.text);
        assert.ok(/not open for sign-up/.test(r.json.error));
        r = await api(app, null, 'POST', '/api/register', { email: 'Owner@Example.test', password: 'made-up-pass-1' });
        assert.strictEqual(r.status, 201, r.text);
        assert.strictEqual(r.json.role, 'coach');
        r = await api(app, null, 'POST', '/api/register', { email: 'stranger@example.test', password: 'made-up-pass-1' });
        assert.strictEqual(r.status, 403, 'invite-only rules still apply after setup');
      } finally { stopApp(app); }
    });

    const shared = storeEnv();
    let A = await startApp(shared);
    let B = await startApp(shared);
    let owner;
    await test('two copies share one store: a sign-in on one works on the other', async () => {
      const r = await api(A, null, 'POST', '/api/register', { email: 'owner@example.test', password: 'made-up-pass-1' });
      assert.strictEqual(r.status, 201, r.text);
      owner = r.cookie;
      const me = await api(B, owner, 'GET', '/api/me');
      assert.strictEqual(me.status, 200, me.text);
      assert.strictEqual(me.json.email, 'owner@example.test');
    });
    await test('40 saves at the same moment across two copies all stick', async () => {
      const N = 40;
      const results = await Promise.all(Array.from({ length: N }, (_, i) =>
        api(i % 2 ? B : A, owner, 'POST', '/api/groups', { name: 'Group ' + i })));
      const bad = results.filter(r => r.status !== 201);
      assert.strictEqual(bad.length, 0, JSON.stringify(bad.map(r => r.status + ' ' + r.text)));
      for (const app of [A, B]) {
        const g = await api(app, owner, 'GET', '/api/groups');
        const names = new Set((g.json.groups || g.json || []).map(x => x.name));
        for (let i = 0; i < N; i++) assert.ok(names.has('Group ' + i), 'missing Group ' + i + ' on ' + (app === A ? 'A' : 'B'));
      }
      assert.ok(!fs.existsSync(path.join(A.dataDir, 'db.json')), 'store mode wrote db.json');
    });
    await test('data survives every copy restarting (no disk involved)', async () => {
      stopApp(A); stopApp(B);
      A = await startApp(shared);
      const g = await api(A, owner, 'GET', '/api/groups');
      assert.strictEqual(g.status, 200, g.text);
      assert.strictEqual((g.json.groups || g.json).length, 40);
    });
    await test('the visit-count limit (30 a minute) holds across copies', async () => {
      B = await startApp(shared);
      /* The limit counts per clock minute: start well inside one. */
      while (new Date().getSeconds() > 50) await new Promise(r => setTimeout(r, 500));
      const codes = [];
      for (let i = 0; i < 32; i++) {
        const r = await api(i % 2 ? B : A, null, 'POST', '/api/events', { name: 'landing_view', page: '/' });
        codes.push(r.status);
      }
      assert.strictEqual(codes.filter(c => c === 201 || c === 200).length, 30, codes.join(','));
      assert.strictEqual(codes.filter(c => c === 429).length, 2, codes.join(','));
    });
    await test('visit counts are saved before the reply', async () => {
      const r = await api(A, owner, 'GET', '/api/export/backup');
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      const data = storeLib.decode(fake.kv.get(shared.STORE_PREFIX + ':db'));
      assert.strictEqual(data.events.filter(e => e.name === 'landing_view').length, 30);
    });
    await test('when the store is down, the API says so calmly (503)', async () => {
      fake.failNext = 3;
      const r = await api(A, owner, 'GET', '/api/groups');
      fake.failNext = 0;
      assert.strictEqual(r.status, 503, r.text);
      assert.ok(/not answering/.test(r.json.error));
      const ok = await api(A, owner, 'GET', '/api/groups');
      assert.strictEqual(ok.status, 200);
    });
    stopApp(A); stopApp(B);

    await test('coach emails finish before the reply, once', async () => {
      const resend = await startFakeResend();
      const app = await startApp(storeEnv({
        RESEND_API_KEY: 're_test_not_real', NOTIFY_EMAIL: 'coach@example.test', RESEND_API_BASE: resend.base,
      }));
      try {
        await api(app, null, 'POST', '/api/register', { email: 'owner@example.test', password: 'made-up-pass-1' });
        const r = await api(app, null, 'POST', '/api/invite-requests', {
          name: 'Pat Visitor', email: 'pat@example.test', goal: 'Run a faster 400', forWhom: 'self', grade: '11th', sport: 'Track', consent: true,
        });
        assert.strictEqual(r.status, 201, r.text);
        assert.strictEqual(resend.seen.length, 1, 'email was not sent before the reply');
        await new Promise(res => setTimeout(res, 200));
        assert.strictEqual(resend.seen.length, 1);
      } finally { stopApp(app); resend.server.close(); }
    });

    await test('read-only pause: reads and sign-in work, changes are refused and not saved', async () => {
      const env = storeEnv();
      const app = await startApp(env);
      const r0 = await api(app, null, 'POST', '/api/register', { email: 'owner@example.test', password: 'made-up-pass-1' });
      stopApp(app);
      const ro = await startApp(Object.assign({}, env, { READ_ONLY_MODE: '1' }));
      try {
        const login = await api(ro, null, 'POST', '/api/login', { email: 'owner@example.test', password: 'made-up-pass-1' });
        assert.strictEqual(login.status, 200, login.text);
        const w = await api(ro, login.cookie, 'POST', '/api/groups', { name: 'Blocked' });
        assert.strictEqual(w.status, 503, w.text);
        assert.ok(/paused/.test(w.json.error));
        const g = await api(ro, r0.cookie, 'GET', '/api/groups');
        assert.strictEqual(g.status, 200);
        assert.ok(!(g.json.groups || g.json).some(x => x.name === 'Blocked'));
      } finally { stopApp(ro); }
    });

    await test('read-only pause works on Render too (file mode)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro-file-'));
      const a = await startApp({ DATA_DIR: dir });
      const reg = await api(a, null, 'POST', '/api/register', { email: 'owner@example.test', password: 'made-up-pass-1' });
      assert.strictEqual(reg.status, 201, 'file mode lets the first account register as before');
      a.child.kill('SIGKILL');
      const before = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
      const ro = await startApp({ DATA_DIR: dir, READ_ONLY_MODE: 'true' });
      try {
        const w = await api(ro, reg.cookie, 'POST', '/api/groups', { name: 'Blocked' });
        assert.strictEqual(w.status, 503);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), before);
      } finally { ro.child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
    });

    console.log('Vercel entry point and config');
    await test('api/index.js serves the branded pages with the site address filled in', async () => {
      const app = await startApp(storeEnv({ SITE_URL: 'https://ayg.example.test', VERCEL: '1' }), { vercelEntry: true });
      try {
        const home = await raw(app, 'GET', '/');
        const html = home.buf.toString();
        assert.strictEqual(home.status, 200);
        assert.ok(html.includes('<link rel="canonical" href="https://ayg.example.test/">'));
        assert.ok(!/__[A-Z_]+__/.test(html), 'a placeholder was left in the page');
        const sm = (await raw(app, 'GET', '/sitemap.xml')).buf.toString();
        assert.ok(sm.includes('<loc>https://ayg.example.test/programs</loc>') && !sm.includes('__SITE_URL__'));
        const rb = (await raw(app, 'GET', '/robots.txt')).buf.toString();
        assert.ok(rb.includes('Sitemap: https://ayg.example.test/sitemap.xml'));
        const js = (await raw(app, 'GET', '/app.js')).buf.toString();
        assert.ok(!js.includes('__BRAND_NAME__'));
        const logo = await raw(app, 'GET', '/assets/ayg-lab-logo.jpg');
        assert.strictEqual(logo.status, 200);
        assert.strictEqual((await api(app, null, 'GET', '/api/me')).status, 401);
      } finally { stopApp(app); }
    });
    await test('on Vercel, imports are capped under the 4.5 MB request limit', async () => {
      const app = await startApp(storeEnv({ VERCEL: '1' }));
      try {
        const reg = await api(app, null, 'POST', '/api/register', { email: 'owner@example.test', password: 'made-up-pass-1' });
        const big = JSON.stringify({ pad: 'x'.repeat(4 * 1024 * 1024 + 10) });
        const r = await raw(app, 'POST', '/api/import/backup', big, { cookie: reg.cookie, 'content-type': 'application/json' });
        assert.strictEqual(r.status, 413, r.buf.toString().slice(0, 200));
      } finally { stopApp(app); }
    });
    await test('without the store settings, the default site address is unchanged', async () => {
      const app = await startApp({});
      try {
        const html = (await raw(app, 'GET', '/')).buf.toString();
        assert.ok(html.includes('<link rel="canonical" href="https://ruffin-performance.onrender.com/">'));
      } finally { stopApp(app); }
    });
    await test('vercel.json routes everything through the app and ships its files', async () => {
      const cfg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'vercel.json'), 'utf8'));
      assert.deepStrictEqual(cfg.rewrites, [{ source: '/(.*)', destination: '/api/index' }]);
      const inc = cfg.functions['api/index.js'].includeFiles;
      for (const d of ['content', 'public', 'lib']) assert.ok(inc.includes(d), 'includeFiles misses ' + d);
      const outDir = path.join(APP_DIR, cfg.outputDirectory);
      assert.ok(fs.statSync(outDir).isDirectory());
      const served = fs.readdirSync(outDir).filter(f => f !== '.gitkeep');
      assert.deepStrictEqual(served, [], 'the static folder must stay empty so pages go through the app');
      assert.strictEqual(require(path.join(APP_DIR, 'api', 'index.js')).length, 2);
    });

    console.log('scripts/copy-to-store.js');
    await test('copies a real db.json in, checks counts, refuses to overwrite by accident', async () => {
      /* Make a genuine db.json with the app itself, on disk (Render mode). */
      const fileApp = await startApp({});
      const reg = await api(fileApp, null, 'POST', '/api/register', { email: 'owner@example.test', password: 'made-up-pass-1' });
      for (let i = 0; i < 3; i++) await api(fileApp, reg.cookie, 'POST', '/api/groups', { name: 'Team ' + i });
      fileApp.child.kill('SIGKILL');
      const dbFile = path.join(fileApp.dataDir, 'db.json');
      const env = storeEnv();
      const lines = [];
      const out = (m) => lines.push(m);
      assert.strictEqual(await copyTool.main([dbFile], env, out), 0, lines.join('\n'));
      assert.ok(lines.includes('All counts match.'));
      lines.length = 0;
      assert.strictEqual(await copyTool.main([dbFile], env, out), 1);
      assert.ok(/already holds data/.test(lines.join('\n')));
      assert.strictEqual(await copyTool.main([dbFile, '--replace'], env, out), 0);
      assert.strictEqual(await copyTool.main([dbFile, '--check'], env, out), 0);
      assert.strictEqual(await copyTool.main([dbFile], {}, out), 2);
      /* The moved account signs in on the hosted copy with the same password. */
      const app = await startApp(env);
      try {
        const login = await api(app, null, 'POST', '/api/login', { email: 'owner@example.test', password: 'made-up-pass-1' });
        assert.strictEqual(login.status, 200, login.text);
        const g = await api(app, login.cookie, 'GET', '/api/groups');
        assert.deepStrictEqual((g.json.groups || g.json).map(x => x.name).sort(), ['Team 0', 'Team 1', 'Team 2']);
      } finally { stopApp(app); fs.rmSync(fileApp.dataDir, { recursive: true, force: true }); }
    });
  } catch (err) {
    failed++;
    console.log('SUITE ERROR: ' + (err && err.stack));
  } finally {
    for (const c of children) { try { c.kill('SIGKILL'); } catch (_) { /* gone */ } }
    fake.server.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
