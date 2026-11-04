#!/usr/bin/env node
'use strict';
/*
 * Tests for webhook-stage step 1c: the double-subscribe guard, the
 * backup-restore rule, and the webhook writing membership changes.
 *
 *   node tests/stripe-step1c-tests.js
 *
 * Boots the real server.js against a local fake Stripe and a
 * throwaway data folder. Placeholders only: no real keys, secrets,
 * or member data.
 */
const assert = require('assert');
const H = require('./harness');

const R = H.makeRunner();
const { test } = R;

const ENV = (fake) => ({
  STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
  STRIPE_API_BASE: 'http://127.0.0.1:' + fake.port,
  STRIPE_WEBHOOK_SECRET: H.WEBHOOK_SECRET,
  DOMAIN: 'https://app.example.test',
});

/* ------------------------------------------------------------------ */
/* Double-subscribe guard                                               */
/* ------------------------------------------------------------------ */
async function guardTests() {
  console.log('double-subscribe guard');
  const fake = await H.startFakeStripe();
  const app = await H.startApp(ENV(fake));
  try {
    const email = 'guard.member@example.test';
    const { ownerCookie, memberCookie } = await H.seedAccounts(app, email);
    const checkout = (cookie, body) => H.api(app, 'POST', '/api/checkout/session', body, cookie);

    await test('a member with no subscription can start checkout', async () => {
      const r = await checkout(memberCookie, { tier: 'access' });
      assert.strictEqual(r.status, 200);
    });

    await app.restart((d) => {
      const u = d.users.find((x) => x.email === email);
      u.tier = 'access'; u.membershipStatus = 'active';
      u.stripeCustomerId = 'cus_test_1'; u.stripeSubscriptionId = 'sub_test_1';
    });

    await test('a member with a live subscription gets 409 and no Stripe call', async () => {
      const before = fake.seen.length;
      const r = await checkout(memberCookie, { tier: 'training' });
      assert.strictEqual(r.status, 409);
      assert.ok(/already have a membership/.test(r.json.error));
      assert.strictEqual(fake.seen.length, before);
    });
    await test('the guard also covers a request that names no tier', async () => {
      const before = fake.seen.length;
      assert.strictEqual((await checkout(memberCookie, {})).status, 409);
      assert.strictEqual(fake.seen.length, before);
    });
    await test('signed-out and coach checkouts are untouched by the guard', async () => {
      assert.strictEqual((await checkout(undefined, { tier: 'access' })).status, 200);
      assert.strictEqual((await checkout(ownerCookie, { tier: 'access' })).status, 200);
    });

    await app.restart((d) => {
      d.users.find((x) => x.email === email).membershipStatus = 'cancelled';
    });
    await test('once the subscription has ended (cancelled), the member may sign up again', async () => {
      const r = await checkout(memberCookie, { tier: 'training' });
      assert.strictEqual(r.status, 200);
    });
  } finally { app.stop(); fake.server.close(); }
}

/* ------------------------------------------------------------------ */
/* Backup restore leaves Stripe-owned accounts alone                    */
/* ------------------------------------------------------------------ */
async function restoreTests() {
  console.log('backup restore');
  const fake = await H.startFakeStripe();
  const app = await H.startApp(ENV(fake));
  try {
    const e1 = 'restore.one@example.test';
    const e2 = 'restore.two@example.test';
    const { ownerCookie } = await H.seedAccounts(app, e1);
    assert.strictEqual((await H.api(app, 'POST', '/api/client-invites', { email: e2 }, ownerCookie)).status, 200);
    assert.strictEqual((await H.api(app, 'POST', '/api/register', { email: e2, password: 'member-pass-123' })).status, 201);
    const idOf = (e) => app.userByEmail(e).id;
    const setTier = (e, tier) => H.api(app, 'PUT', '/api/access/' + idOf(e), { tier }, ownerCookie);

    // Both members hold Lab Access when the backup is taken.
    assert.strictEqual((await setTier(e1, 'access')).status, 200);
    assert.strictEqual((await setTier(e2, 'access')).status, 200);
    const exp = await fetch(app.base + '/api/export/backup', { headers: { cookie: ownerCookie } });
    assert.strictEqual(exp.status, 200);
    const backupText = await exp.text();

    // Afterwards: member one becomes Stripe-owned on Lab Pass, member two is changed by the coach.
    await app.restart((d) => {
      const u = d.users.find((x) => x.email === e1);
      u.tier = 'pass'; u.membershipStatus = 'active';
      u.stripeCustomerId = 'cus_test_1'; u.stripeSubscriptionId = 'sub_test_1';
      u.membershipHistory.push({ at: '2026-01-01T00:00:00.000Z', by: 'stripe', byEmail: null, action: 'subscribe', tier: 'pass', status: 'active' });
    });
    assert.strictEqual((await setTier(e2, 'training')).status, 200);
    const stripeOwnedBefore = JSON.stringify(app.userByEmail(e1));

    const imp = await fetch(app.base + '/api/import/backup', {
      method: 'POST', headers: { cookie: ownerCookie, 'content-type': 'application/json' }, body: backupText,
    });
    assert.strictEqual(imp.status, 200, 'import should succeed');

    await test('restore leaves a Stripe-owned account exactly as it was', async () => {
      assert.strictEqual(JSON.stringify(app.userByEmail(e1)), stripeOwnedBefore);
      const u = app.userByEmail(e1);
      assert.strictEqual(u.tier, 'pass');
      assert.strictEqual(u.stripeSubscriptionId, 'sub_test_1');
      assert.strictEqual(u.stripeCustomerId, 'cus_test_1');
    });
    await test('restore still rolls back an account with no subscription (as before)', async () => {
      assert.strictEqual(app.userByEmail(e2).tier, 'access');
    });
  } finally { app.stop(); fake.server.close(); }
}


/* ------------------------------------------------------------------ */
/* lib/stripe.js: membership mapping (pure)                             */
/* ------------------------------------------------------------------ */
async function libTests() {
  console.log('lib/stripe.js membership mapping');
  const L = require('../lib/stripe');
  await test('status mapping: access-keeping states are active, final ends are cancelled', () => {
    for (const st of ['active', 'trialing', 'past_due']) assert.strictEqual(L.mapSubscriptionStatus(st), 'active', st);
    for (const st of ['canceled', 'unpaid']) assert.strictEqual(L.mapSubscriptionStatus(st), 'cancelled', st);
    for (const st of ['incomplete', 'incomplete_expired', 'paused', 'mystery', undefined, null, 5]) {
      assert.strictEqual(L.mapSubscriptionStatus(st), null, String(st));
    }
  });
  await test('tier comes only from the price, through the server table', () => {
    assert.strictEqual(L.tierForPrice(H.PRICE.pass, H.PRICE), 'pass');
    assert.strictEqual(L.tierForPrice('price_unknown', H.PRICE), null);
    assert.strictEqual(L.tierForPrice(undefined, H.PRICE), null);
  });
  await test('subscription ids are checked before they go into a URL', () => {
    assert.strictEqual(L.isSubscriptionId('sub_1AbC_x'), true);
    for (const bad of ['', 'sub_', 'cus_1', 'sub_1/../x', 'sub_1?x=1', 'sub_1 ', null, 5]) {
      assert.strictEqual(L.isSubscriptionId(bad), false, String(bad));
    }
  });
  await test('subscriptionFacts reads price, user id, customer, and cancel date', () => {
    const sub = H.makeSub('sub_f1', { price: H.PRICE.training, userId: 'u-1', cancelAtPeriodEnd: true, periodEnd: 1900000000 });
    const f = L.subscriptionFacts(sub, H.PRICE);
    assert.strictEqual(f.tier, 'training');
    assert.strictEqual(f.userId, 'u-1');
    assert.strictEqual(f.customerId, 'cus_test_1');
    assert.strictEqual(f.status, 'active');
    assert.strictEqual(f.cancelAt, new Date(1900000000 * 1000).toISOString());
  });
  await test('the period end is found on the subscription or on its items', () => {
    assert.strictEqual(L.periodEndSeconds({ current_period_end: 5 }), 5);
    assert.strictEqual(L.periodEndSeconds({ items: { data: [{ current_period_end: 7 }] } }), 7);
    assert.strictEqual(L.periodEndSeconds({}), null);
    const f = L.subscriptionFacts({ id: 'sub_f2', cancel_at_period_end: true, items: { data: [{ price: { id: H.PRICE.access }, current_period_end: 1900000000 }] } }, H.PRICE);
    assert.strictEqual(f.cancelAt, new Date(1900000000 * 1000).toISOString());
  });
  await test('facts helpers survive garbage without throwing', () => {
    for (const junk of [null, undefined, 5, 'x', [], { items: 5 }, { items: { data: [null, 5] } }]) {
      assert.doesNotThrow(() => L.subscriptionFacts(junk, H.PRICE));
      assert.doesNotThrow(() => L.sessionFacts(junk));
    }
  });
  await test('sessionFacts prefers the client reference, falls back to metadata, lowercases email', () => {
    const a = L.sessionFacts({ mode: 'subscription', payment_status: 'paid', subscription: 'sub_1', client_reference_id: 'u-1', metadata: { user_id: 'u-2' }, customer_email: 'A@B.test' });
    assert.strictEqual(a.userId, 'u-1');
    assert.strictEqual(a.email, 'a@b.test');
    assert.strictEqual(L.sessionFacts({ metadata: { user_id: 'u-2' } }).userId, 'u-2');
    assert.strictEqual(L.sessionFacts({ subscription: { id: 'sub_9' } }).subscriptionId, 'sub_9');
  });
}

/* ------------------------------------------------------------------ */
/* The webhook writes membership changes                                */
/* ------------------------------------------------------------------ */
async function webhookTests() {
  console.log('webhook membership writes');
  const fake = await H.startFakeStripe();
  const app = await H.startApp(ENV(fake));
  const T0 = H.nowSec();
  let tick = 0;
  const at = () => T0 + (++tick);
  const fs = require('fs');
  const path = require('path');
  try {
    const emails = { a: 'wh.a@example.test', b: 'wh.b@example.test', c: 'wh.c@example.test', d: 'wh.d@example.test' };
    const seeded = await H.seedAccounts(app, emails.a);
    const ownerCookie = seeded.ownerCookie;
    const ids = { a: seeded.memberId };
    const cookies = { a: seeded.memberCookie };
    for (const k of ['b', 'c', 'd']) {
      assert.strictEqual((await H.api(app, 'POST', '/api/client-invites', { email: emails[k] }, ownerCookie)).status, 200);
      const r = await H.api(app, 'POST', '/api/register', { email: emails[k], password: 'member-pass-123' });
      assert.strictEqual(r.status, 201);
      ids[k] = r.json.id; cookies[k] = r.cookie;
    }
    const acct = (k) => app.userByEmail(emails[k]);
    const last = (k) => { const h = acct(k).membershipHistory; return h[h.length - 1]; };
    const checkoutEvt = (o) => H.evt('checkout.session.completed', {
      object: 'checkout.session', id: 'cs_test_x', mode: o.mode || 'subscription',
      payment_status: o.pay || 'paid', status: 'complete', subscription: o.sub,
      customer: o.cust || 'cus_test_1', client_reference_id: o.ref,
      customer_email: o.email, metadata: o.meta || {},
    }, { id: o.id, created: o.created || at() });
    const subEvt = (type, sub, o) => H.evt(type, sub, { id: (o || {}).id, created: (o || {}).created || at() });
    const getCalls = () => fake.seen.filter((x) => x.method === 'GET').length;

    /* -- checkout.session.completed ----------------------------------- */
    fake.subs.sub_a1 = H.makeSub('sub_a1', { price: H.PRICE.training, userId: ids.a, customer: 'cus_a' });
    const evA = checkoutEvt({ id: 'evt_a_checkout', ref: ids.a, sub: 'sub_a1', cust: 'cus_a', email: emails.a });
    await test('checkout completed: finds the account, looks up the price, writes tier, status, and ids', async () => {
      const r = await H.sendEvent(app, evA);
      assert.strictEqual(r.status, 200);
      const u = acct('a');
      assert.strictEqual(u.tier, 'training');
      assert.strictEqual(u.membershipStatus, 'active');
      assert.strictEqual(u.stripeSubscriptionId, 'sub_a1');
      assert.strictEqual(u.stripeCustomerId, 'cus_a');
      assert.ok(u.tierUpdatedAt);
      const h = last('a');
      assert.strictEqual(h.by, 'stripe');
      assert.strictEqual(h.action, 'subscribe');
      assert.strictEqual(h.tier, 'training');
      const get = fake.seen.find((x) => x.method === 'GET' && x.path === '/v1/subscriptions/sub_a1');
      assert.ok(get && /^Bearer sk_test_/.test(get.auth), 'subscription looked up with the placeholder key');
    });
    await test('the member now has access, and the Account tab shows the tier', async () => {
      const r = await H.api(app, 'GET', '/api/my/membership', undefined, cookies.a);
      assert.strictEqual(r.json.membership.tier, 'training');
      assert.strictEqual(r.json.membership.active, true);
      assert.ok(!JSON.stringify(r.json).includes('sub_a1'), 'no Stripe ids reach the member');
    });
    await test('a replayed event id is a harmless 200: no second write, no second lookup', async () => {
      const histLen = acct('a').membershipHistory.length;
      const calls = getCalls();
      const r = await H.sendEvent(app, evA);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('a').membershipHistory.length, histLen);
      assert.strictEqual(getCalls(), calls);
      assert.ok(app.logs.join('').includes('[stripe-webhook] duplicate'));
    });
    await test('a second event about the same subscription with nothing new writes no history', async () => {
      const histLen = acct('a').membershipHistory.length;
      const r = await H.sendEvent(app, subEvt('customer.subscription.updated', fake.subs.sub_a1));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('a').membershipHistory.length, histLen);
    });
    await test('event ids are remembered, and backups never carry them', async () => {
      assert.ok(app.db().stripeEvents.some((e) => e.id === 'evt_a_checkout'));
      const exp = await fetch(app.base + '/api/export/backup', { headers: { cookie: ownerCookie } });
      assert.ok(!(await exp.text()).includes('stripeEvents'));
    });

    /* -- who paid: matching rules -------------------------------------- */
    await test('the tier comes from the price, not from metadata on the event', async () => {
      fake.subs.sub_b1 = H.makeSub('sub_b1', { price: H.PRICE.access, customer: 'cus_b' });
      const r = await H.sendEvent(app, checkoutEvt({ ref: ids.b, sub: 'sub_b1', cust: 'cus_b', meta: { tier: 'pass' } }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('b').tier, 'access');
    });
    await test('email is the fallback when no account id is present (exactly one match)', async () => {
      fake.subs.sub_c1 = H.makeSub('sub_c1', { price: H.PRICE.pass, customer: 'cus_c' });
      const r = await H.sendEvent(app, checkoutEvt({ sub: 'sub_c1', cust: 'cus_c', email: emails.c.toUpperCase() }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('c').tier, 'pass');
      assert.strictEqual(acct('c').stripeSubscriptionId, 'sub_c1');
    });
    await test('no matching account: 200, nothing written, and the event can come again', async () => {
      fake.subs.sub_x1 = H.makeSub('sub_x1', { price: H.PRICE.access });
      const before = app.dbText();
      const r = await H.sendEvent(app, checkoutEvt({ ref: 'no-such-user', sub: 'sub_x1', email: 'nobody@example.test' }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(app.dbText(), before);
      assert.ok(app.logs.join('').includes('no-matching-account'));
    });
    await test('a coach account is never given a membership, even if its id is on the session', async () => {
      const owner = (app.db().users || []).find((u) => u.email === 'owner@example.test');
      fake.subs.sub_o1 = H.makeSub('sub_o1', { price: H.PRICE.pass });
      const before = app.dbText();
      const r = await H.sendEvent(app, checkoutEvt({ ref: owner.id, sub: 'sub_o1', email: emails.d }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(app.dbText(), before);
    });
    await test('a session that is not a paid subscription is ignored before any lookup', async () => {
      const calls = getCalls();
      const before = app.dbText();
      assert.strictEqual((await H.sendEvent(app, checkoutEvt({ ref: ids.d, sub: 'sub_d1', mode: 'payment' }))).status, 200);
      assert.strictEqual((await H.sendEvent(app, checkoutEvt({ ref: ids.d, sub: 'sub_d1', pay: 'unpaid' }))).status, 200);
      assert.strictEqual(getCalls(), calls);
      assert.strictEqual(app.dbText(), before);
    });
    await test('a no-card trial session (no_payment_required, trialing) is accepted', async () => {
      fake.subs.sub_d1 = H.makeSub('sub_d1', { price: H.PRICE.access, status: 'trialing', customer: 'cus_d' });
      const r = await H.sendEvent(app, checkoutEvt({ ref: ids.d, sub: 'sub_d1', cust: 'cus_d', pay: 'no_payment_required' }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('d').tier, 'access');
      assert.strictEqual(acct('d').membershipStatus, 'active');
    });

    /* -- subscription events -------------------------------------------- */
    await test('subscription updated: a price change moves the tier (history says stripe, set-tier)', async () => {
      fake.subs.sub_a1 = H.makeSub('sub_a1', { price: H.PRICE.pass, userId: ids.a, customer: 'cus_a' });
      assert.strictEqual((await H.sendEvent(app, subEvt('customer.subscription.updated', fake.subs.sub_a1))).status, 200);
      assert.strictEqual(acct('a').tier, 'pass');
      assert.strictEqual(last('a').by, 'stripe');
      assert.strictEqual(last('a').action, 'set-tier');
    });
    await test('Stripe wins over a coach change; both are in the history', async () => {
      await new Promise((r) => setTimeout(r, 5));
      const sinceBefore = acct('a').tierUpdatedAt;
      assert.strictEqual((await H.api(app, 'PUT', '/api/access/' + ids.a, { tier: 'access' }, ownerCookie)).status, 200);
      assert.strictEqual(last('a').by, 'coach');
      assert.notStrictEqual(acct('a').tierUpdatedAt, sinceBefore, 'a coach tier change still moves the since date');
      fake.subs.sub_a1 = H.makeSub('sub_a1', { price: H.PRICE.training, userId: ids.a, customer: 'cus_a' });
      assert.strictEqual((await H.sendEvent(app, subEvt('customer.subscription.updated', fake.subs.sub_a1))).status, 200);
      assert.strictEqual(acct('a').tier, 'training');
      const by = acct('a').membershipHistory.map((h) => h.by);
      assert.deepStrictEqual(by.slice(-2), ['coach', 'stripe']);
    });
    await test('past_due keeps access and writes no history while Stripe retries the card', async () => {
      const histLen = acct('b').membershipHistory.length;
      const sub = H.makeSub('sub_b1', { price: H.PRICE.access, status: 'past_due', customer: 'cus_b' });
      assert.strictEqual((await H.sendEvent(app, subEvt('customer.subscription.updated', sub))).status, 200);
      assert.strictEqual(acct('b').membershipStatus, 'active');
      assert.strictEqual(acct('b').membershipHistory.length, histLen);
    });
    await test('a scheduled cancel (cancel at period end) is stored, with no change to access', async () => {
      const sub = H.makeSub('sub_b1', { price: H.PRICE.access, cancelAtPeriodEnd: true, periodEnd: 1900000000, customer: 'cus_b' });
      assert.strictEqual((await H.sendEvent(app, subEvt('customer.subscription.updated', sub))).status, 200);
      assert.strictEqual(acct('b').stripeCancelAt, new Date(1900000000 * 1000).toISOString());
      assert.strictEqual(acct('b').membershipStatus, 'active');
      const resumed = H.makeSub('sub_b1', { price: H.PRICE.access, customer: 'cus_b' });
      assert.strictEqual((await H.sendEvent(app, subEvt('customer.subscription.updated', resumed))).status, 200);
      assert.strictEqual(acct('b').stripeCancelAt, null);
    });
    await test('unpaid ends the membership (cancelled) and keeps the tier on the record', async () => {
      const sub = H.makeSub('sub_c1', { price: H.PRICE.pass, status: 'unpaid', customer: 'cus_c' });
      assert.strictEqual((await H.sendEvent(app, subEvt('customer.subscription.updated', sub))).status, 200);
      assert.strictEqual(acct('c').membershipStatus, 'cancelled');
      assert.strictEqual(acct('c').tier, 'pass');
      assert.strictEqual(last('c').action, 'cancel');
      assert.strictEqual(last('c').by, 'stripe');
    });
    let deletedAt;
    await test('subscription deleted: cancelled, access ends at once, login and data stay', async () => {
      deletedAt = at();
      const sub = H.makeSub('sub_a1', { price: H.PRICE.training, status: 'canceled', customer: 'cus_a' });
      assert.strictEqual((await H.sendEvent(app, subEvt('customer.subscription.deleted', sub, { created: deletedAt }))).status, 200);
      assert.strictEqual(acct('a').membershipStatus, 'cancelled');
      assert.strictEqual(acct('a').tier, 'training');
      assert.strictEqual(acct('a').stripeCancelAt, null);
      assert.strictEqual((await H.api(app, 'GET', '/api/content', undefined, cookies.a)).status, 403);
      assert.strictEqual((await H.api(app, 'GET', '/api/my/membership', undefined, cookies.a)).status, 200);
    });
    await test('an older event arriving after a newer one is dropped (out of order)', async () => {
      const histLen = acct('a').membershipHistory.length;
      const sub = H.makeSub('sub_a1', { price: H.PRICE.training, status: 'active', customer: 'cus_a' });
      const r = await H.sendEvent(app, subEvt('customer.subscription.updated', sub, { created: deletedAt - 100 }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('a').membershipStatus, 'cancelled');
      assert.strictEqual(acct('a').membershipHistory.length, histLen);
      assert.ok(app.logs.join('').includes('ignored-stale'));
    });
    await test('a cancelled member can sign up again: the new subscription takes over', async () => {
      fake.subs.sub_a2 = H.makeSub('sub_a2', { price: H.PRICE.pass, userId: ids.a, customer: 'cus_a' });
      const r = await H.sendEvent(app, checkoutEvt({ ref: ids.a, sub: 'sub_a2', cust: 'cus_a' }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('a').stripeSubscriptionId, 'sub_a2');
      assert.strictEqual(acct('a').membershipStatus, 'active');
      assert.strictEqual(acct('a').tier, 'pass');
      assert.strictEqual(last('a').action, 'subscribe');
    });
    await test('the old subscription ending later does not touch the new membership', async () => {
      const before = JSON.stringify(acct('a'));
      const sub = H.makeSub('sub_a1', { price: H.PRICE.training, status: 'canceled', userId: ids.a, customer: 'cus_a' });
      assert.strictEqual((await H.sendEvent(app, subEvt('customer.subscription.deleted', sub))).status, 200);
      assert.strictEqual(JSON.stringify(acct('a')), before);
    });
    await test('a second live subscription never overwrites the first; the coach sees it in the history', async () => {
      const sinceBefore2 = acct('a').tierUpdatedAt;
      fake.subs.sub_a3 = H.makeSub('sub_a3', { price: H.PRICE.access, userId: ids.a, customer: 'cus_a' });
      const r = await H.sendEvent(app, checkoutEvt({ ref: ids.a, sub: 'sub_a3', cust: 'cus_a' }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('a').stripeSubscriptionId, 'sub_a2');
      assert.strictEqual(acct('a').tier, 'pass');
      assert.strictEqual(last('a').action, 'second-subscription-ignored');
      assert.strictEqual(acct('a').tierUpdatedAt, sinceBefore2, 'the since date does not move');
    });
    await test('an unknown event type is a 200 that writes nothing', async () => {
      const before = app.dbText();
      assert.strictEqual((await H.sendEvent(app, H.evt('invoice.paid', { object: 'invoice', id: 'in_1' }))).status, 200);
      assert.strictEqual(app.dbText(), before);
    });

    /* -- failures: Stripe retries on 500 -------------------------------- */
    const idsE = { id: 'evt_retry_1' };
    await test('Stripe lookup fails (5xx): 500, nothing written, event not remembered', async () => {
      fake.subs.sub_r1 = H.makeSub('sub_r1', { price: H.PRICE.training, userId: ids.d, customer: 'cus_r' });
      await app.restart((d) => { const u = d.users.find((x) => x.email === emails.d); u.tier = null; u.stripeSubscriptionId = null; u.stripeCustomerId = null; u.membershipHistory = []; });
      const before = app.dbText();
      fake.failGet = 500;
      const r = await H.sendEvent(app, checkoutEvt({ id: idsE.id, ref: ids.d, sub: 'sub_r1', cust: 'cus_r' }));
      assert.strictEqual(r.status, 500);
      assert.strictEqual(app.dbText(), before);
      assert.ok(!app.db().stripeEvents.some((e) => e.id === idsE.id));
    });
    await test('the retry of the same event succeeds once Stripe is back', async () => {
      fake.failGet = 0;
      const r = await H.sendEvent(app, checkoutEvt({ id: idsE.id, ref: ids.d, sub: 'sub_r1', cust: 'cus_r' }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(acct('d').tier, 'training');
      assert.ok(app.db().stripeEvents.some((e) => e.id === idsE.id));
    });
    await test('a subscription Stripe says does not exist is a 200 (retrying cannot help)', async () => {
      const before = app.dbText();
      const r = await H.sendEvent(app, checkoutEvt({ ref: ids.b, sub: 'sub_missing', cust: 'cus_b' }));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(app.dbText(), before);
    });
    await test('a price that is not in the tier table, for a member with no tier, is a 500 (not a silent free ride)', async () => {
      await app.restart((d) => { const u = d.users.find((x) => x.email === emails.b); u.tier = null; u.membershipStatus = 'active'; u.stripeSubscriptionId = null; });
      fake.subs.sub_odd = H.makeSub('sub_odd', { price: 'price_not_in_the_table', userId: ids.b });
      const before = app.dbText();
      const r = await H.sendEvent(app, checkoutEvt({ ref: ids.b, sub: 'sub_odd' }));
      assert.strictEqual(r.status, 500);
      assert.strictEqual(app.dbText(), before);
    });
    await test('if saving to disk fails, the in-memory change is undone and the retry works', async () => {
      const tmpDir = path.join(app.dataDir, 'db.json.tmp');
      fs.mkdirSync(tmpDir);                       // makes the atomic write fail
      fake.subs.sub_s1 = H.makeSub('sub_s1', { price: H.PRICE.pass, userId: ids.b, customer: 'cus_s' });
      const ev = checkoutEvt({ id: 'evt_save_fail', ref: ids.b, sub: 'sub_s1', cust: 'cus_s' });
      const stripeEntries = () => acct('b').membershipHistory.filter((h) => h.by === 'stripe').length;
      const entriesBefore = stripeEntries();
      const r1 = await H.sendEvent(app, ev);
      assert.strictEqual(r1.status, 500);
      const m = await H.api(app, 'GET', '/api/my/membership', undefined, cookies.b);
      assert.strictEqual(m.json.membership.tier, null, 'memory rolled back');
      fs.rmdirSync(tmpDir);
      const r2 = await H.sendEvent(app, ev);
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(acct('b').tier, 'pass');
      assert.strictEqual(stripeEntries(), entriesBefore + 1, 'the failed attempt left no history; the retry added exactly one');
    });
    await test('the event memory is capped (oldest dropped first)', async () => {
      await app.restart((d) => { d.stripeEvents = Array.from({ length: 1000 }, (_, i) => ({ id: 'evt_old_' + i, at: '2026-01-01T00:00:00.000Z' })); });
      fake.subs.sub_k1 = H.makeSub('sub_k1', { price: H.PRICE.access, status: 'trialing', userId: ids.c, customer: 'cus_k' });
      const r = await H.sendEvent(app, subEvt('customer.subscription.created', fake.subs.sub_k1, { id: 'evt_cap_new' }));
      assert.strictEqual(r.status, 200);
      const ev = app.db().stripeEvents;
      assert.strictEqual(ev.length, 1000);
      assert.strictEqual(ev[ev.length - 1].id, 'evt_cap_new');
      assert.strictEqual(ev[0].id, 'evt_old_1');
    });
    await test('a signed-up-again member via subscription.created is bound by the user id on the subscription', async () => {
      assert.strictEqual(acct('c').stripeSubscriptionId, 'sub_k1');
      assert.strictEqual(acct('c').membershipStatus, 'active');
      assert.strictEqual(acct('c').tier, 'access');
    });
    await test('the coach Access page lists the stripe actor with no client change', async () => {
      const r = await H.api(app, 'GET', '/api/access', undefined, ownerCookie);
      const row = r.json.members.find((m) => m.email === emails.a);
      assert.ok(row.history.some((h) => h.by === 'stripe'));
      assert.strictEqual(row.stripeSubscriptionId, 'sub_a2');
    });
  } finally { app.stop(); fake.server.close(); }
}

(async () => {
  await libTests();
  await guardTests();
  await restoreTests();
  await webhookTests();
  console.log('\n' + R.passed + ' passed, ' + R.failed + ' failed');
  process.exit(R.failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
