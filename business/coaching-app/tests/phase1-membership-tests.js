#!/usr/bin/env node
'use strict';
/*
 * Phase 1 membership restructure (AYG Lab Master Directive, Nov 27,
 * 2026): two athlete tiers at $79.99 and $150, the $10 Lab Access
 * tier retired, Team Lab sold by consultation at $250 per
 * organization, Lab Pass capped at 50 active members, and the old
 * 3-day trial shown as a seven-day guided preview.
 *
 *   node tests/phase1-membership-tests.js
 *
 * Boots the real server on a spare port with a throwaway data folder
 * and a fake Stripe. Every name, email, key and price ID here is a
 * made-up placeholder; nothing touches the live site or real Stripe.
 */
const assert = require('assert');
const { makeRunner, startFakeStripe, startApp, api, seedAccounts } = require('./harness');

const r = makeRunner();

function fakeMember(i, tier, status) {
  return {
    id: 'seed-' + tier + '-' + i, email: 'seed' + i + '-' + tier + '@example.test',
    role: 'athlete', passwordHash: 'x', salt: 'x', createdAt: '2026-11-01T12:00:00.000Z',
    tier, membershipStatus: status || 'active', tierUpdatedAt: '2026-11-01T12:00:00.000Z',
    stripeCustomerId: null, stripeSubscriptionId: null, membershipHistory: [],
  };
}

async function main() {
  const fake = await startFakeStripe();
  const app = await startApp({
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_real',
    STRIPE_API_BASE: 'http://127.0.0.1:' + fake.port,
    TRIAL_DAYS: undefined,
  });
  try {
    let s = await seedAccounts(app, 'member@example.test');
    const memberId = s.memberId;

    /* 50 active Lab Pass members, one cancelled Lab Pass member and
       one account still on the retired 'access' tier. */
    await app.restart((d) => {
      for (let i = 0; i < 50; i++) d.users.push(fakeMember(i, 'pass'));
      d.users.push(fakeMember(99, 'pass', 'cancelled'));
      d.users.push(Object.assign(fakeMember(7, 'access'), { id: 'seed-retired', email: 'retired@example.test' }));
    });
    const owner = await api(app, 'POST', '/api/login', { email: 'owner@example.test', password: 'owner-pass-123' });
    const member = await api(app, 'POST', '/api/login', { email: 'member@example.test', password: 'member-pass-123' });
    const oc = owner.cookie;
    const mc = member.cookie;

    await r.test('the tier catalog is the two athlete plans at the new prices', async () => {
      const res = await api(app, 'GET', '/api/my/membership', undefined, mc);
      assert.strictEqual(res.status, 200);
      const t = res.json.tiers;
      assert.deepStrictEqual(t.map(x => x.key), ['training', 'pass']);
      assert.strictEqual(t[0].name, 'Lab Training');
      assert.strictEqual(t[0].priceLabel, '$79.99/month');
      assert.strictEqual(t[1].name, 'Lab Pass');
      assert.strictEqual(t[1].priceLabel, '$150/month');
      assert.ok(t[0].includes.includes('The full exercise video library'));
      assert.ok(t[0].includes.includes('The full training program library'));
      assert.ok(t[1].includes.some(x => /up to 3 a week, 30 minutes/.test(x)));
      assert.ok(t[1].includes.some(x => /up to 30 a week/.test(x)));
      assert.strictEqual(res.json.teamLab.priceLabel, '$250/month per organization');
      assert.strictEqual(res.json.teamLab.coachAccounts, 5);
      assert.strictEqual(res.json.labPass.capacity, 50);
      assert.strictEqual(res.json.labPass.full, true);
    });

    await r.test('the retired Lab Access tier cannot be set any more (400)', async () => {
      const res = await api(app, 'PUT', '/api/access/' + memberId, { tier: 'access' }, oc);
      assert.strictEqual(res.status, 400);
    });

    await r.test('an account still on the retired tier loads as Lab Training (moved up, never down)', async () => {
      const res = await api(app, 'GET', '/api/access', undefined, oc);
      const row = (res.json.members || []).find(x => x.email === 'retired@example.test');
      assert.ok(row, 'row missing');
      assert.strictEqual(row.tier, 'training');
      assert.strictEqual(row.active, true);
    });

    await r.test('Lab Pass is full at 50: the coach cannot add a 51st (409, plain words)', async () => {
      const res = await api(app, 'PUT', '/api/access/' + memberId, { tier: 'pass' }, oc);
      assert.strictEqual(res.status, 409);
      assert.ok(/Lab Pass is full right now/.test(res.json.error));
      assert.ok(/50 athletes/.test(res.json.error));
      assert.strictEqual(app.userByEmail('member@example.test').tier, null);
    });

    await r.test('a full Lab Pass does not block Lab Training', async () => {
      const res = await api(app, 'PUT', '/api/access/' + memberId, { tier: 'training' }, oc);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.membership.tier, 'training');
    });

    await r.test('Lab Training opens the full libraries, form reviews and loads', async () => {
      const content = await api(app, 'GET', '/api/content', undefined, mc);
      assert.strictEqual(content.status, 200);
      assert.ok(Array.isArray(content.json.labPrograms) && content.json.labPrograms.length > 0);
      /* Not linked to a roster profile here, so form reviews answer
         "not linked", never a membership lock. */
      const fc = await api(app, 'GET', '/api/my/form-checks', undefined, mc);
      assert.strictEqual(fc.json.needsTier, undefined);
      assert.strictEqual(fc.json.notLinked, true);
      assert.strictEqual((await api(app, 'GET', '/api/my/loads', undefined, mc)).status, 200);
      const live = await api(app, 'GET', '/api/live-sessions', undefined, mc);
      assert.strictEqual(live.status, 403);
      assert.strictEqual(live.json.needsTier, 'pass');
    });

    await r.test('checkout refuses Lab Pass while it is full, before any Stripe call', async () => {
      const before = fake.seen.length;
      const res = await api(app, 'POST', '/api/checkout/session', { tier: 'pass' }, mc);
      assert.strictEqual(res.status, 409);
      assert.ok(res.json.full === true);
      assert.strictEqual(fake.seen.length, before);
    });

    await r.test('checkout no longer sells the retired tier (400, no Stripe call)', async () => {
      const before = fake.seen.length;
      const res = await api(app, 'POST', '/api/checkout/session', { tier: 'access' }, mc);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(fake.seen.length, before);
    });

    await r.test('re-saving a member already on Lab Pass works while it is full', async () => {
      const res = await api(app, 'PUT', '/api/access/seed-pass-0', { tier: 'pass' }, oc);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.membership.tier, 'pass');
    });

    await r.test('a freed Lab Pass spot can be filled again', async () => {
      const cancel = await api(app, 'PUT', '/api/access/seed-pass-1', { status: 'cancelled' }, oc);
      assert.strictEqual(cancel.status, 200);
      const res = await api(app, 'PUT', '/api/access/' + memberId, { tier: 'pass' }, oc);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.membership.tier, 'pass');
    });

    const request = (tierInterest, email) => api(app, 'POST', '/api/invite-requests', {
      name: 'Pat Placeholder', email, forWhom: 'self', tierInterest,
      goal: 'Run a faster 100m.', grade: '12th grade', sport: 'Track', consent: true,
    });
    await r.test('an invitation request can ask about Team Lab', async () => {
      const res = await request('team', 'team-request@example.test');
      assert.strictEqual(res.status, 201);
      const list = await api(app, 'GET', '/api/invite-requests', undefined, oc);
      const row = (list.json.requests || []).find(x => x.email === 'team-request@example.test');
      assert.strictEqual(row && row.tierInterest, 'team');
    });

    await r.test('an old page that still asks for Lab Access is filed as Lab Training', async () => {
      const res = await request('access', 'old-page@example.test');
      assert.strictEqual(res.status, 201);
      const list = await api(app, 'GET', '/api/invite-requests', undefined, oc);
      const row = (list.json.requests || []).find(x => x.email === 'old-page@example.test');
      assert.strictEqual(row && row.tierInterest, 'training');
    });

    await r.test('the guided preview defaults to seven days in the served app', async () => {
      const js = await api(app, 'GET', '/app.js');
      assert.ok(js.text.includes("parseInt('7', 10)"));
    });

    await r.test('the landing plans: new prices, Team Lab by consultation, no $10 tier, reworded hero', async () => {
      const page = (await api(app, 'GET', '/')).text;
      const plans = page.slice(page.indexOf('id="plans"'), page.indexOf('id="about"'));
      assert.ok(plans.includes('$79.99 <small>/ month</small>'));
      assert.ok(plans.includes('$150 <small>/ month</small>'));
      assert.ok(plans.includes('$250 <small>/ month</small>'));
      assert.ok(plans.includes('Per organization'));
      assert.ok(plans.includes('Limited to 50 athletes'));
      assert.ok(plans.includes('data-view="book">Book a Team Lab consultation'));
      assert.ok(plans.includes('Seven-day guided preview'));
      assert.ok(!plans.includes('Lab Access') && !plans.includes('$10 '));
      assert.ok(!page.includes('data-invite-tier="access"'));
      assert.ok(!page.includes('joint angles'));
      assert.ok(page.includes('Coach AJ breaks down your mechanics'));
      assert.ok(page.includes('Plans from $79.99 a month'));
    });
  } finally {
    app.stop();
    fake.server.close();
  }
  console.log('\n' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
