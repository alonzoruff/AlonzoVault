'use strict';
/*
 * Shared test harness for the Stripe webhook-stage tests.
 *
 * Boots the real server.js on a free port with a throwaway DATA_DIR
 * and a local fake Stripe (via STRIPE_API_BASE). No real Stripe call,
 * key, secret, or member data is involved anywhere: every key and
 * secret below is a made-up placeholder.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WEBHOOK_SECRET = 'whsec_test_secret_not_real';
const nowSec = () => Math.floor(Date.now() / 1000);

function sign(payload, secret, t) {
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + payload).digest('hex');
  return 't=' + t + ',v1=' + sig;
}

function makeRunner() {
  const r = { passed: 0, failed: 0 };
  r.test = async (name, fn) => {
    try { await fn(); r.passed++; console.log('  ok   ' + name); }
    catch (err) { r.failed++; console.log('  FAIL ' + name + '\n       ' + (err && err.message)); }
  };
  return r;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

/* A fake Stripe API. It records every request and keeps a tiny
   subscription table the tests fill in. Failure switches let a test
   make the next calls fail the way the real API can. */
function startFakeStripe() {
  return new Promise((resolve) => {
    const fake = { seen: [], subs: {}, failGet: 0, failPost: 0, port: 0, server: null };
    fake.server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
        fake.seen.push({ method: req.method, path: req.url, auth: req.headers.authorization, form });
        const send = (status, obj) => {
          const body = JSON.stringify(obj);
          res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
          res.end(body);
        };
        const missing = () => send(404, { error: { code: 'resource_missing', message: 'No such subscription' } });
        if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
          return send(200, { id: 'cs_test_fake', url: 'https://checkout.example.test/pay/cs_test_fake' });
        }
        const m = req.url.match(/^\/v1\/subscriptions\/([^/?]+)$/);
        if (m && req.method === 'GET') {
          if (fake.failGet) return send(fake.failGet, { error: { message: 'simulated failure' } });
          return fake.subs[m[1]] ? send(200, fake.subs[m[1]]) : missing();
        }
        if (m && req.method === 'POST') {
          if (fake.failPost) return send(fake.failPost, { error: { message: 'simulated failure' } });
          const sub = fake.subs[m[1]];
          if (!sub) return missing();
          if (form.cancel_at_period_end === 'true') {
            sub.cancel_at_period_end = true;
            sub.cancel_at = sub.current_period_end;
          } else if (form.cancel_at_period_end === 'false') {
            sub.cancel_at_period_end = false;
            sub.cancel_at = null;
          }
          return send(200, sub);
        }
        return send(404, { error: { message: 'unexpected fake route ' + req.method + ' ' + req.url } });
      });
    });
    fake.server.listen(0, '127.0.0.1', () => { fake.port = fake.server.address().port; resolve(fake); });
  });
}

/* A subscription object shaped like Stripe's, for the fake to serve
   and for building webhook events. */
function makeSub(id, o) {
  const x = o || {};
  const periodEnd = x.periodEnd || (nowSec() + 20 * 86400);
  return {
    object: 'subscription', id, customer: x.customer || 'cus_test_1',
    status: x.status || 'active', current_period_end: periodEnd,
    cancel_at_period_end: !!x.cancelAtPeriodEnd,
    cancel_at: x.cancelAtPeriodEnd ? periodEnd : null,
    metadata: x.userId ? { user_id: x.userId } : {},
    items: { data: [{ price: { id: x.price || 'price_1UWTZpAelNSvNtsvHAVExdYX' }, current_period_end: periodEnd }] },
  };
}
const PRICE = {
  access: 'price_1UWTZpAelNSvNtsvHAVExdYX',
  training: 'price_1UWSwJAelNSvNtsvz0ctLK9z',
  pass: 'price_1UWSwiAelNSvNtsv5R2KyEu0',
};

async function startApp(extraEnv, existingDir) {
  const port = await freePort();
  const dataDir = existingDir || fs.mkdtempSync(path.join(os.tmpdir(), 'rp-stripe-'));
  const buildEnv = (more) => {
    const env = Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dataDir }, extraEnv, more);
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    return env;
  };
  const app = { base: 'http://127.0.0.1:' + port, dataDir, logs: [], child: null };
  const boot = async (more) => {
    app.logs.length = 0;
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
      { env: buildEnv(more), stdio: ['ignore', 'pipe', 'pipe'] });
    app.child = child;
    child.stdout.on('data', (d) => app.logs.push(String(d)));
    child.stderr.on('data', (d) => app.logs.push(String(d)));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start: ' + app.logs.join(''))), 15000);
      const poll = setInterval(() => {
        if (app.logs.join('').includes('running at')) { clearInterval(poll); clearTimeout(timer); resolve(); }
      }, 50);
      child.on('exit', () => { clearInterval(poll); clearTimeout(timer); reject(new Error('server exited: ' + app.logs.join(''))); });
    });
  };
  await boot();
  const dbFile = path.join(dataDir, 'db.json');
  app.dbText = () => { try { return fs.readFileSync(dbFile, 'utf8'); } catch (_) { return ''; } };
  app.db = () => JSON.parse(app.dbText() || '{}');
  app.userByEmail = (email) => (app.db().users || []).find((u) => u.email === email) || null;
  /* Stop the server, let a test edit db.json directly, boot again
     on the same port and data folder. */
  app.restart = async (mutate) => {
    await new Promise((resolve) => { app.child.once('exit', resolve); app.child.kill(); });
    if (mutate) { const d = app.db(); mutate(d); fs.writeFileSync(dbFile, JSON.stringify(d, null, 1)); }
    await boot();
  };
  app.stop = () => { try { app.child.kill(); } catch (_) { /* gone */ } fs.rmSync(dataDir, { recursive: true, force: true }); };
  return app;
}

async function api(app, method, p, body, cookie) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(app.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function webhook(app, payload, header) {
  const headers = { 'content-type': 'application/json' };
  if (header !== undefined) headers['stripe-signature'] = header;
  const res = await fetch(app.base + '/api/stripe/webhook', { method: 'POST', headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  return { status: res.status, json };
}

/* Send an event object, signed with the placeholder secret. */
function sendEvent(app, event, opts) {
  const o = opts || {};
  const body = JSON.stringify(event);
  return webhook(app, body, sign(body, o.secret || WEBHOOK_SECRET, o.t || nowSec()));
}

let evtCounter = 0;
function evt(type, object, o) {
  const x = o || {};
  evtCounter += 1;
  return { id: x.id || 'evt_test_' + evtCounter, type, livemode: false, created: x.created || nowSec(), data: { object } };
}

/* Owner plus one invited member, ready to use. */
async function seedAccounts(app, memberEmail) {
  const owner = await api(app, 'POST', '/api/register', { email: 'owner@example.test', password: 'owner-pass-123' });
  if (owner.status !== 201) throw new Error('owner register failed: ' + owner.status);
  const inv = await api(app, 'POST', '/api/client-invites', { email: memberEmail }, owner.cookie);
  if (inv.status !== 200) throw new Error('invite failed: ' + inv.status);
  const member = await api(app, 'POST', '/api/register', { email: memberEmail, password: 'member-pass-123' });
  if (member.status !== 201) throw new Error('member register failed: ' + member.status);
  return { ownerCookie: owner.cookie, memberCookie: member.cookie, memberId: member.json.id };
}

module.exports = {
  WEBHOOK_SECRET, PRICE, nowSec, sign, makeRunner, startFakeStripe, makeSub,
  startApp, api, webhook, sendEvent, evt, seedAccounts,
};
