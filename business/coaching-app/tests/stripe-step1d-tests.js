#!/usr/bin/env node
'use strict';
/*
 * Tests for webhook-stage step 1d: cancelling in the app also
 * cancels the Stripe subscription, at the end of the paid period.
 *
 *   node tests/stripe-step1d-tests.js
 *
 * Boots the real server.js against a local fake Stripe and a
 * throwaway data folder. Placeholders only: no real keys, secrets,
 * or member data.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const R = H.makeRunner();
const { test } = R;

const ENV = (fake) => ({
  STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
  STRIPE_API_BASE: 'http://127.0.0.1:' + fake.port,
  STRIPE_WEBHOOK_SECRET: H.WEBHOOK_SECRET,
  DOMAIN: 'https://app.example.test',
});

(async () => {
  console.log('in-app cancel and Stripe');
  const fake = await H.startFakeStripe();
  const app = await H.startApp(ENV(fake));
  const noKeyApp = await H.startApp({ STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined });
  const periodEnd = H.nowSec() + 20 * 86400;
  try {
    const emails = {};
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) emails[k] = 'cancel.' + k + '@example.test';
    const seeded = await H.seedAccounts(app, emails.a);
    const ownerCookie = seeded.ownerCookie;
    const ids = { a: seeded.memberId };
    const cookies = { a: seeded.memberCookie };
    for (const k of ['b', 'c', 'd', 'e', 'f']) {
      assert.strictEqual((await H.api(app, 'POST', '/api/client-invites', { email: emails[k] }, ownerCookie)).status, 200);
      const r = await H.api(app, 'POST', '/api/register', { email: emails[k], password: 'member-pass-123' });
      assert.strictEqual(r.status, 201);
      ids[k] = r.json.id; cookies[k] = r.cookie;
    }
    const acct = (k) => app.userByEmail(emails[k]);
    const last = (k) => { const h = acct(k).membershipHistory; return h[h.length - 1]; };
    const cancel = (k) => H.api(app, 'POST', '/api/my/membership/cancel', {}, cookies[k]);
    const posts = () => fake.seen.filter((x) => x.method === 'POST' && x.path.startsWith('/v1/subscriptions/'));

    // Members a..d and f carry a subscription; e has none (coach-granted tier only).
    const subOf = { a: 'sub_ca', b: 'sub_cb', c: 'sub_cc', d: 'sub_cd', f: 'sub_cf' };
    for (const [k, id] of Object.entries(subOf)) {
      fake.subs[id] = H.makeSub(id, { price: H.PRICE.training, periodEnd, customer: 'cus_' + k });
    }
    await app.restart((d) => {
      for (const u of d.users) {
        const k = Object.keys(emails).find((x) => emails[x] === u.email);
        if (!k || u.role !== 'athlete') continue;
        u.tier = 'training'; u.membershipStatus = 'active';
        u.tierUpdatedAt = '2026-10-01T12:00:00.000Z';
        if (subOf[k]) { u.stripeSubscriptionId = subOf[k]; u.stripeCustomerId = 'cus_' + k; }
      }
    });

    await test('cancel with a subscription: Stripe is told to stop at period end', async () => {
      const r = await cancel('a');
      assert.strictEqual(r.status, 200);
      const p = posts();
      assert.strictEqual(p.length, 1);
      assert.strictEqual(p[0].path, '/v1/subscriptions/sub_ca');
      assert.strictEqual(p[0].form.cancel_at_period_end, 'true');
      assert.ok(/^Bearer sk_test_/.test(p[0].auth));
    });
    await test('the member keeps access until the period ends, and sees the end date', async () => {
      assert.strictEqual(acct('a').membershipStatus, 'active');
      const m = await H.api(app, 'GET', '/api/my/membership', undefined, cookies.a);
      assert.strictEqual(m.json.membership.status, 'active');
      assert.strictEqual(m.json.membership.active, true);
      assert.strictEqual(m.json.membership.cancelsAt, new Date(periodEnd * 1000).toISOString());
      assert.strictEqual((await H.api(app, 'GET', '/api/content', undefined, cookies.a)).status, 200);
    });
    await test('the response carries a plain sentence with the date, in natural wording', async () => {
      const again = await cancel('a');
      const n = again.json.notice;
      assert.ok(/^Your membership will end on [A-Z][a-z]+ \d{1,2}, \d{4}\. You keep full access until then\.$/.test(n), n);
      assert.ok(!/[—–]/.test(n), 'no long dashes in member-facing copy');
    });
    await test('the history records the member asking, and nothing else changed', async () => {
      const h = last('a');
      assert.strictEqual(h.by, 'member');
      assert.strictEqual(h.action, 'cancel-requested');
      assert.strictEqual(h.tier, 'training');
      assert.strictEqual(h.status, 'active');
    });
    await test('asking to cancel does not move the "since" date (tierUpdatedAt)', async () => {
      assert.strictEqual(acct('a').tierUpdatedAt, '2026-10-01T12:00:00.000Z');
      const m = await H.api(app, 'GET', '/api/my/membership', undefined, cookies.a);
      assert.strictEqual(m.json.membership.tierUpdatedAt, '2026-10-01T12:00:00.000Z');
    });
    await test('a double click is a harmless 200: no second Stripe call, no second history entry', async () => {
      assert.strictEqual(posts().length, 1);
      assert.strictEqual(acct('a').membershipHistory.filter((x) => x.action === 'cancel-requested').length, 1);
    });
    await test('when Stripe reports the subscription ended, access ends and the date clears', async () => {
      const sub = H.makeSub('sub_ca', { price: H.PRICE.training, status: 'canceled', customer: 'cus_a' });
      const r = await H.sendEvent(app, H.evt('customer.subscription.deleted', sub));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('a').membershipStatus, 'cancelled');
      assert.strictEqual(acct('a').stripeCancelAt, null);
      assert.strictEqual((await H.api(app, 'GET', '/api/content', undefined, cookies.a)).status, 403);
      assert.strictEqual(last('a').by, 'stripe');
    });

    await test('Stripe is down (5xx): 502 with a plain message, and nothing here changed', async () => {
      fake.failPost = 500;
      const before = JSON.stringify(acct('b'));
      const r = await cancel('b');
      assert.strictEqual(r.status, 502);
      assert.ok(/has not been changed/.test(r.json.error));
      assert.strictEqual(JSON.stringify(acct('b')), before);
    });
    await test('trying again after Stripe is back works', async () => {
      fake.failPost = 0;
      const r = await cancel('b');
      assert.strictEqual(r.status, 200);
      assert.ok(acct('b').stripeCancelAt);
    });
    await test('Stripe answers but does not confirm the cancellation: 502, unchanged', async () => {
      const real = fake.subs.sub_cc;
      fake.subs.sub_cc = new Proxy(real, { get: (t, k) => (k === 'cancel_at_period_end' ? false : t[k]), set: () => true });
      const before = JSON.stringify(acct('c'));
      const r = await cancel('c');
      fake.subs.sub_cc = real;
      assert.strictEqual(r.status, 502);
      assert.strictEqual(JSON.stringify(acct('c')), before);
    });
    await test('Stripe says the subscription no longer exists: the plain local cancel applies', async () => {
      delete fake.subs.sub_cd;
      const r = await cancel('d');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('d').membershipStatus, 'cancelled');
      assert.strictEqual(last('d').by, 'member');
      assert.strictEqual(last('d').action, 'cancel');
    });
    await test('an account with no subscription cancels exactly as before, with no Stripe call', async () => {
      const calls = fake.seen.length;
      const r = await cancel('e');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('e').membershipStatus, 'cancelled');
      assert.strictEqual(last('e').action, 'cancel');
      assert.strictEqual(fake.seen.length, calls);
      assert.ok(!('notice' in r.json));
    });
    await test('a member cannot cancel anyone else: the route only acts on the signed-in account', async () => {
      const before = JSON.stringify(acct('f'));
      await H.api(app, 'POST', '/api/my/membership/cancel', { userId: ids.f, id: ids.f, email: emails.f }, cookies.e);
      assert.strictEqual(JSON.stringify(acct('f')), before);
    });
    await test('signed-out is 401 and a coach gets the existing 400', async () => {
      assert.strictEqual((await H.api(app, 'POST', '/api/my/membership/cancel', {})).status, 401);
      assert.strictEqual((await H.api(app, 'POST', '/api/my/membership/cancel', {}, ownerCookie)).status, 400);
    });
    await test('saving fails after Stripe agreed: 500, memory rolled back, and the retry completes', async () => {
      const tmpDir = path.join(app.dataDir, 'db.json.tmp');
      fs.mkdirSync(tmpDir);
      const histLen = acct('f').membershipHistory.length;
      const r1 = await cancel('f');
      assert.strictEqual(r1.status, 500);
      const m = await H.api(app, 'GET', '/api/my/membership', undefined, cookies.f);
      assert.strictEqual(m.json.membership.cancelsAt, null, 'memory rolled back');
      fs.rmdirSync(tmpDir);
      const r2 = await cancel('f');
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(acct('f').membershipHistory.length, histLen + 1);
    });
    await test('a member who resumes in Stripe (cancel date cleared by the webhook) can cancel again', async () => {
      const resumed = H.makeSub('sub_cf', { price: H.PRICE.training, periodEnd, customer: 'cus_f' });
      assert.strictEqual((await H.sendEvent(app, H.evt('customer.subscription.updated', resumed))).status, 200);
      assert.strictEqual(acct('f').stripeCancelAt, null);
      const before = posts().length;
      assert.strictEqual((await cancel('f')).status, 200);
      assert.strictEqual(posts().length, before + 1);
    });
    await test('with no Stripe key on the host: 502 and nothing changes (never a silent local cancel)', async () => {
      const seeded2 = await H.seedAccounts(noKeyApp, 'nokey.member@example.test');
      await noKeyApp.restart((d) => {
        const u = d.users.find((x) => x.email === 'nokey.member@example.test');
        u.tier = 'access'; u.stripeSubscriptionId = 'sub_nokey'; u.stripeCustomerId = 'cus_nokey';
      });
      const r = await H.api(noKeyApp, 'POST', '/api/my/membership/cancel', {}, seeded2.memberCookie);
      assert.strictEqual(r.status, 502);
      assert.strictEqual(noKeyApp.userByEmail('nokey.member@example.test').membershipStatus, 'active');
    });
    await test('the coach Access page carries each member\'s pending end date (null when none)', async () => {
      const r = await H.api(app, 'GET', '/api/access', undefined, ownerCookie);
      const row = (k) => r.json.members.find((m) => m.email === emails[k]);
      assert.strictEqual(row('b').cancelsAt, new Date(periodEnd * 1000).toISOString());
      assert.strictEqual(row('b').status, 'active');
      assert.strictEqual(row('c').cancelsAt, null);
      assert.strictEqual(row('e').cancelsAt, null);
    });
    await test('the coach Access page shows the member-requested cancel in the history', async () => {
      const r = await H.api(app, 'GET', '/api/access', undefined, ownerCookie);
      const row = r.json.members.find((m) => m.email === emails.b);
      assert.ok(row.history.some((h) => h.action === 'cancel-requested' && h.by === 'member'));
    });
  } finally { app.stop(); noKeyApp.stop(); fake.server.close(); }
  console.log('\n' + R.passed + ' passed, ' + R.failed + ' failed');
  process.exit(R.failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
