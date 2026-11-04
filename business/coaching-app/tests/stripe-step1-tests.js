#!/usr/bin/env node
'use strict';
/*
 * Tests for webhook-stage steps 1a (checkout identity) and 1b
 * (webhook receiver: signature, size, 503, and ignored events;
 * what verified membership events write is tested in
 * stripe-step1c-tests.js). Standalone and zero-dependency:
 *
 *   node tests/stripe-step1-tests.js
 *
 * Part 1 unit-tests lib/stripe.js. Part 2 boots the real server.js
 * on a free port with a throwaway DATA_DIR and a local fake Stripe
 * (via STRIPE_API_BASE), then drives it over HTTP. No real Stripe
 * call, key, or member data is involved anywhere.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const stripeLib = require('../lib/stripe');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (err) { failed++; console.log('  FAIL ' + name + '\n       ' + (err && err.message)); }
}

const SECRET = 'whsec_test_secret_not_real';
function sign(payload, secret, t) {
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + payload).digest('hex');
  return 't=' + t + ',v1=' + sig;
}
const nowSec = () => Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------------ */
/* Part 1: lib/stripe.js                                                */
/* ------------------------------------------------------------------ */
async function unitTests() {
  console.log('lib/stripe.js');
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const t = nowSec();

  await test('accepts a valid signature (string and Buffer bodies agree)', () => {
    const h = sign(body, SECRET, t);
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, h, SECRET).ok, true);
    assert.strictEqual(stripeLib.verifyWebhookSignature(Buffer.from(body), h, SECRET).ok, true);
  });
  await test('rejects a tampered body', () => {
    const h = sign(body, SECRET, t);
    assert.strictEqual(stripeLib.verifyWebhookSignature(body + ' ', h, SECRET).ok, false);
  });
  await test('rejects the wrong secret', () => {
    const h = sign(body, 'whsec_other', t);
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, h, SECRET).ok, false);
  });
  await test('rejects a missing, empty, or malformed header', () => {
    for (const h of [undefined, '', 'garbage', 't=abc,v1=00', 't=' + t, 'v1=00']) {
      assert.strictEqual(stripeLib.verifyWebhookSignature(body, h, SECRET).ok, false, String(h));
    }
  });
  await test('rejects when no secret is configured', () => {
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, sign(body, SECRET, t), '').ok, false);
  });
  await test('rejects a stale timestamp and a far-future one', () => {
    const old = t - 3600;
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, sign(body, SECRET, old), SECRET).ok, false);
    const future = t + 3600;
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, sign(body, SECRET, future), SECRET).ok, false);
  });
  await test('honors a custom tolerance and an injected clock', () => {
    const h = sign(body, SECRET, 1000);
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, h, SECRET, { now: 1000 * 1000 + 299000 }).ok, true);
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, h, SECRET, { now: 1000 * 1000 + 301000 }).ok, false);
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, h, SECRET, { now: 1000 * 1000 + 301000, toleranceSeconds: 600 }).ok, true);
  });
  await test('accepts a header with several v1 signatures when one matches', () => {
    const good = sign(body, SECRET, t);
    const h = good + ',v1=' + 'a'.repeat(64) + ',v0=ignored';
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, h, SECRET).ok, true);
    const rotated = 't=' + t + ',v1=' + 'b'.repeat(64) + ',v1=' + good.split('v1=')[1];
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, rotated, SECRET).ok, true);
  });
  await test('rejects non-hex and wrong-length signatures without throwing', () => {
    const h = 't=' + t + ',v1=zzzz,v1=' + 'a'.repeat(63);
    assert.strictEqual(stripeLib.verifyWebhookSignature(body, h, SECRET).ok, false);
  });
  await test('describeEvent summarizes a checkout session and never leaks an email', () => {
    const d = stripeLib.describeEvent({
      id: 'evt_9', type: 'checkout.session.completed', livemode: false, created: 1700000000,
      data: { object: {
        object: 'checkout.session', id: 'cs_test_1', status: 'complete',
        client_reference_id: 'user-123', customer: 'cus_1', subscription: 'sub_1',
        customer_email: 'someone@example.com', customer_details: { email: 'someone@example.com' },
        metadata: { user_id: 'user-123' },
      } },
    });
    assert.strictEqual(d.clientReferenceId, 'user-123');
    assert.strictEqual(d.subscriptionId, 'sub_1');
    assert.strictEqual(d.hasEmail, true);
    assert.ok(!JSON.stringify(d).includes('someone@example.com'));
  });
  await test('describeEvent reads a subscription event and survives garbage', () => {
    const d = stripeLib.describeEvent({ type: 'customer.subscription.deleted',
      data: { object: { object: 'subscription', id: 'sub_7', status: 'canceled', customer: 'cus_7' } } });
    assert.strictEqual(d.subscriptionId, 'sub_7');
    assert.strictEqual(d.status, 'canceled');
    for (const junk of [null, undefined, 5, 'x', [], { data: 5 }, { data: { object: null } }]) {
      assert.doesNotThrow(() => stripeLib.describeEvent(junk));
    }
  });
}

/* ------------------------------------------------------------------ */
/* Part 2: the real server over HTTP                                    */
/* ------------------------------------------------------------------ */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

/* A fake Stripe API: records each form body the server posts. */
function startFakeStripe() {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
        seen.push({ path: req.url, auth: req.headers.authorization, form });
        const body = JSON.stringify({ id: 'cs_test_fake', url: 'https://checkout.example.test/pay/cs_test_fake' });
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }));
  });
}

async function startApp(extraEnv) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-step1-'));
  const env = Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dataDir }, extraEnv);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start: ' + logs.join(''))), 15000);
    const poll = setInterval(() => {
      if (logs.join('').includes('running at')) { clearInterval(poll); clearTimeout(timer); resolve(); }
    }, 50);
    child.on('exit', () => { clearInterval(poll); clearTimeout(timer); reject(new Error('server exited: ' + logs.join(''))); });
  });
  return {
    base: 'http://127.0.0.1:' + port, dataDir, logs,
    dbText: () => { try { return fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'); } catch (_) { return ''; } },
    stop: () => { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

async function api(app, method, p, body, cookie) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(app.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
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

async function httpTests() {
  console.log('server.js over HTTP');
  const fake = await startFakeStripe();
  const app = await startApp({
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    STRIPE_API_BASE: 'http://127.0.0.1:' + fake.port,
    STRIPE_WEBHOOK_SECRET: SECRET,
    DOMAIN: 'https://app.example.test',
  });
  const noSecretApp = await startApp({ STRIPE_WEBHOOK_SECRET: undefined, STRIPE_SECRET_KEY: undefined });
  const memberEmail = 'member.one@example.test';
  let ownerCookie, memberCookie, memberId;

  try {
    // Accounts: the first registration is the owner (a coach); the owner invites a member.
    const owner = await api(app, 'POST', '/api/register', { email: 'owner@example.test', password: 'owner-pass-123' });
    assert.strictEqual(owner.status, 201);
    ownerCookie = owner.cookie;
    const inv = await api(app, 'POST', '/api/client-invites', { email: memberEmail }, ownerCookie);
    assert.strictEqual(inv.status, 200);
    const member = await api(app, 'POST', '/api/register', { email: memberEmail, password: 'member-pass-123' });
    assert.strictEqual(member.status, 201);
    memberCookie = member.cookie;
    memberId = member.json.id;
    assert.ok(memberId, 'member id present in the register response');

    const checkout = (cookie, body) => api(app, 'POST', '/api/checkout/session', body, cookie);
    const IDENTITY_KEYS = ['client_reference_id', 'customer_email', 'metadata[user_id]', 'metadata[tier]',
      'subscription_data[metadata][user_id]', 'subscription_data[metadata][tier]'];

    await test('1a: signed-out checkout keeps the original parameters (no identity keys)', async () => {
      const before = fake.seen.length;
      const r = await checkout(undefined, { tier: 'access' });
      assert.strictEqual(r.status, 200);
      const sent = fake.seen[before].form;
      for (const k of IDENTITY_KEYS) assert.ok(!(k in sent), 'unexpected ' + k);
      assert.strictEqual(sent.mode, 'subscription');
      assert.strictEqual(sent.payment_method_collection, 'always');
      assert.strictEqual(sent['metadata[integration_identifier]'], 'hosted_web_0001');
    });
    await test('1a: signed-in member checkout carries identity and tier', async () => {
      const before = fake.seen.length;
      const r = await checkout(memberCookie, { tier: 'training' });
      assert.strictEqual(r.status, 200);
      const sent = fake.seen[before].form;
      assert.strictEqual(sent.client_reference_id, memberId);
      assert.strictEqual(sent.customer_email, memberEmail);
      assert.strictEqual(sent['metadata[user_id]'], memberId);
      assert.strictEqual(sent['subscription_data[metadata][user_id]'], memberId);
      assert.strictEqual(sent['metadata[tier]'], 'training');
      assert.strictEqual(sent['subscription_data[metadata][tier]'], 'training');
      assert.strictEqual(sent.mode, 'subscription');
      assert.strictEqual(sent.payment_method_collection, 'always');
    });
    await test('1a: identity comes from the session, never from the request body', async () => {
      const before = fake.seen.length;
      await checkout(memberCookie, { tier: 'access', client_reference_id: 'someone-else', userId: 'someone-else', email: 'x@example.test' });
      const sent = fake.seen[before].form;
      assert.strictEqual(sent.client_reference_id, memberId);
      assert.strictEqual(sent.customer_email, memberEmail);
    });
    await test('1a: a coach checkout carries no identity', async () => {
      const before = fake.seen.length;
      const r = await checkout(ownerCookie, { tier: 'access' });
      assert.strictEqual(r.status, 200);
      for (const k of IDENTITY_KEYS) assert.ok(!(k in fake.seen[before].form), 'unexpected ' + k);
    });
    await test('1a: unknown tier is still a 400 with no Stripe call', async () => {
      const before = fake.seen.length;
      const r = await checkout(memberCookie, { tier: 'platinum' });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(fake.seen.length, before);
    });
    await test('1a: no tier keeps the original single-price path (member still gets identity)', async () => {
      const before = fake.seen.length;
      const r = await checkout(memberCookie, {});
      assert.strictEqual(r.status, 200);
      const sent = fake.seen[before].form;
      assert.strictEqual(sent.client_reference_id, memberId);
      assert.ok(!('metadata[tier]' in sent));
    });

    // Webhook (dry-run)
    const event = JSON.stringify({
      id: 'evt_test_1', type: 'invoice.created', livemode: false, created: nowSec(),
      data: { object: { object: 'checkout.session', id: 'cs_test_1', status: 'complete',
        client_reference_id: memberId, customer: 'cus_test_1', subscription: 'sub_test_1',
        customer_email: memberEmail, metadata: { user_id: memberId } } },
    });
    const dbBefore = app.dbText();

    await test('1b: valid signature gets 200, with no login needed', async () => {
      const r = await webhook(app, event, sign(event, SECRET, nowSec()));
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json, { received: true });
    });
    await test('1b: an event type the app does not act on writes nothing (db.json byte-identical)', async () => {
      assert.strictEqual(app.dbText(), dbBefore);
      const me = await api(app, 'GET', '/api/my/membership', undefined, memberCookie);
      assert.strictEqual(me.json.membership.tier, null);
    });
    await test('1b: the log line names the event but never contains the email', async () => {
      const log = app.logs.join('');
      assert.ok(log.includes('[stripe-webhook] ignored-event-type'));
      assert.ok(log.includes('evt_test_1'));
      assert.ok(!log.includes(memberEmail));
    });
    await test('1b: a replayed delivery is also a harmless 200', async () => {
      const r = await webhook(app, event, sign(event, SECRET, nowSec()));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(app.dbText(), dbBefore);
    });
    await test('1b: tampered body, wrong secret, stale timestamp, and missing header all get 400', async () => {
      assert.strictEqual((await webhook(app, event + ' ', sign(event, SECRET, nowSec()))).status, 400);
      assert.strictEqual((await webhook(app, event, sign(event, 'whsec_wrong', nowSec()))).status, 400);
      assert.strictEqual((await webhook(app, event, sign(event, SECRET, nowSec() - 3600))).status, 400);
      assert.strictEqual((await webhook(app, event, undefined)).status, 400);
    });
    await test('1b: a rejected request gives no detail in the response body', async () => {
      const r = await webhook(app, event, 'garbage');
      assert.strictEqual(r.status, 400);
      assert.deepStrictEqual(r.json, { error: 'Signature check failed.' });
    });
    await test('1b: validly signed but not JSON gets 400', async () => {
      const junk = 'this is not json';
      assert.strictEqual((await webhook(app, junk, sign(junk, SECRET, nowSec()))).status, 400);
    });
    await test('1b: an oversize body gets 413', async () => {
      const big = 'x'.repeat(1024 * 1024 + 10);
      assert.strictEqual((await webhook(app, big, sign(big, SECRET, nowSec()))).status, 413);
    });
    await test('1b: with no STRIPE_WEBHOOK_SECRET the endpoint is inert (503)', async () => {
      const r = await webhook(noSecretApp, event, sign(event, SECRET, nowSec()));
      assert.strictEqual(r.status, 503);
    });
    await test('1b: with no STRIPE_SECRET_KEY checkout is still inert (503)', async () => {
      const r = await api(noSecretApp, 'POST', '/api/checkout/session', { tier: 'access' });
      assert.strictEqual(r.status, 503);
    });
    await test('1b: other methods on the webhook path do not become a free read', async () => {
      const r = await api(app, 'GET', '/api/stripe/webhook');
      assert.strictEqual(r.status, 401);
    });
    await test('1b: the rest of the app is unaffected (login still works)', async () => {
      const r = await api(app, 'POST', '/api/login', { email: memberEmail, password: 'member-pass-123' });
      assert.strictEqual(r.status, 200);
    });
  } finally {
    app.stop();
    noSecretApp.stop();
    fake.server.close();
  }
}

(async () => {
  await unitTests();
  await httpTests();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
