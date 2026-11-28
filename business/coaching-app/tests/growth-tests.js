#!/usr/bin/env node
'use strict';
/*
 * Tests for the v40 growth build: in-app funnel events and the
 * owner-only scoreboard.
 *
 *   node tests/growth-tests.js
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
const FUNNEL = ['landing_view', 'portal_preview_open', 'invitation_request_started',
  'invitation_request_submitted', 'invite_approved', 'paid_membership_started',
  'first_workout_completed', 'weekly_active_member', 'cancellation', 'referral_source'];

(async () => {
  console.log('growth build: funnel events and owner scoreboard');
  const fake = await H.startFakeStripe();
  const app = await H.startApp(ENV(fake));
  const noKeyApp = await H.startApp({ STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined });
  try {
    const events = (name) => (app.db().events || []).filter((e) => !name || e.name === name);
    /* Public events are saved a moment later, in one batch. */
    const waitFor = async (fn) => {
      for (let i = 0; i < 60; i++) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
      return false;
    };
    const board = (cookie) => H.api(app, 'GET', '/api/owner/scoreboard', undefined, cookie);
    const publicEvent = (body, cookie, ip) => {
      const headers = { 'content-type': 'application/json' };
      if (cookie) headers.cookie = cookie;
      if (ip) headers['x-forwarded-for'] = ip;
      return fetch(app.base + '/api/events', { method: 'POST', headers, body: JSON.stringify(body) })
        .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    };

    const emails = { a: 'growth.a@example.test', b: 'growth.b@example.test', c: 'growth.c@example.test' };
    const seeded = await H.seedAccounts(app, emails.a);
    const ownerCookie = seeded.ownerCookie;
    const ids = { a: seeded.memberId };
    const cookies = { a: seeded.memberCookie };
    for (const k of ['b', 'c']) {
      assert.strictEqual((await H.api(app, 'POST', '/api/client-invites', { email: emails[k] }, ownerCookie)).status, 200);
      const r = await H.api(app, 'POST', '/api/register', { email: emails[k], password: 'member-pass-123' });
      assert.strictEqual(r.status, 201);
      ids[k] = r.json.id; cookies[k] = r.cookie;
    }

    /* -- the scoreboard is the owner's alone -------------------------- */
    await test('scoreboard: signed out gets 401', async () => {
      assert.strictEqual((await board()).status, 401);
    });
    await test('scoreboard: a member gets 403', async () => {
      const r = await board(cookies.a);
      assert.strictEqual(r.status, 403);
      assert.ok(!('mrr' in (r.json || {})));
    });
    await test('scoreboard: the owner gets this week and last week with an as-of time', async () => {
      const r = await board(ownerCookie);
      assert.strictEqual(r.status, 200);
      const d = r.json;
      assert.ok(Date.parse(d.asOf) > Date.now() - 60000);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d.weeks.this.start));
      assert.ok(d.weeks.last.end < d.weeks.this.start);
      assert.strictEqual(d.paymentsOn, true);
      assert.deepStrictEqual(d.prices, { training: 79.99, pass: 150 });
      assert.deepStrictEqual(d.funnel.map((x) => x.name), FUNNEL);
      assert.strictEqual(d.mrr.this, 0);
      assert.strictEqual(d.requests.this.qualified, 0);
      assert.strictEqual(d.firstWeek.this.pct, null, 'nothing to measure reads as not tracked, not 0%');
      assert.ok(d.notInApp.some((n) => /Marketing spend/.test(n.label)));
      assert.ok(d.notInApp.some((n) => /Coach and admin hours/.test(n.label)));
    });
    await test('scoreboard: a week that ended before counting began is null, never zero', async () => {
      const d = (await board(ownerCookie)).json;
      for (const row of d.funnel) assert.strictEqual(row.last, null, row.name);
      for (const row of d.funnel) assert.strictEqual(typeof row.this, 'number', row.name);
    });

    /* -- public funnel events ----------------------------------------- */
    await test('events: a landing view from a visitor is counted', async () => {
      const r = await publicEvent({ name: 'landing_view', page: '/plans' }, null, '10.0.0.1');
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.json.counted, true);
      assert.ok(await waitFor(() => events('landing_view').length === 1), 'saved');
      const e = events('landing_view');
      assert.strictEqual(e.length, 1);
      assert.strictEqual(e[0].page, '/plans');
    });
    await test('events: a strange page is stored as the homepage', async () => {
      await publicEvent({ name: 'landing_view', page: 'https://evil.example/x?y=1' }, null, '10.0.0.1');
      assert.ok(await waitFor(() => events('landing_view').length === 2), 'saved');
      assert.strictEqual(events('landing_view')[1].page, '/');
    });
    await test('events: the portal preview needs one of the real screens', async () => {
      assert.strictEqual((await publicEvent({ name: 'portal_preview_open' }, null, '10.0.0.1')).status, 400);
      assert.strictEqual((await publicEvent({ name: 'portal_preview_open', screen: 'secret' }, null, '10.0.0.1')).status, 400);
      const ok = await publicEvent({ name: 'portal_preview_open', screen: 'progress' }, null, '10.0.0.1');
      assert.strictEqual(ok.status, 201);
      assert.ok(await waitFor(() => events('portal_preview_open').length === 1), 'saved');
      assert.strictEqual(events('portal_preview_open')[0].screen, 'progress');
    });
    await test('events: the form-started step is counted', async () => {
      assert.strictEqual((await publicEvent({ name: 'invitation_request_started' }, null, '10.0.0.1')).status, 201);
    });
    await test('events: the public endpoint refuses server-side and unknown steps', async () => {
      for (const name of ['paid_membership_started', 'cancellation', 'invite_approved', 'nope', '']) {
        assert.strictEqual((await publicEvent({ name }, null, '10.0.0.1')).status, 400, name);
      }
      assert.strictEqual(events('paid_membership_started').length, 0);
    });
    await test('events: nothing is counted for a signed-in person', async () => {
      await new Promise((res) => setTimeout(res, 1800));
      const before2 = events().length;
      const r = await publicEvent({ name: 'landing_view' }, cookies.a, '10.0.0.1');
      assert.strictEqual(r.status, 200);
      await new Promise((res) => setTimeout(res, 1800));
      assert.strictEqual(events().length, before2);
      assert.strictEqual(r.json.counted, false);
    });
    await test('events: no address, email or browser detail is stored', async () => {
      const text = JSON.stringify(app.db().events);
      assert.ok(!text.includes('10.0.0.1'));
      assert.ok(!text.includes('@'));
      assert.ok(!/user-agent|userAgent|ip"/i.test(text));
    });
    await test('events: one visitor sending too fast is slowed down', async () => {
      let limited = false;
      for (let i = 0; i < 40 && !limited; i++) {
        const r = await publicEvent({ name: 'landing_view' }, null, '10.9.9.9');
        if (r.status === 429) limited = true;
      }
      assert.ok(limited, 'expected a 429');
      assert.strictEqual((await publicEvent({ name: 'landing_view' }, null, '10.8.8.8')).status, 201, 'another visitor is unaffected');
    });

    /* -- invitation requests and referral sources --------------------- */
    const request = (email, heardFrom) => H.api(app, 'POST', '/api/invite-requests', {
      name: 'Sample Visitor', email, goal: 'Faster 100m', forWhom: 'self', grade: 'Adult',
      sport: 'Track', consent: true, heardFrom,
    });
    let reqId = null;
    await test('invite request: an unknown source is refused, including object keys', async () => {
      assert.strictEqual((await request('x1@example.test', 'billboard')).status, 400);
      assert.strictEqual((await request('x2@example.test', 'constructor')).status, 400);
    });
    await test('invite request: submitted and referral source are recorded', async () => {
      const r = await request(emails.b, 'friend');
      assert.strictEqual(r.status, 201);
      const sub = events('invitation_request_submitted');
      assert.strictEqual(sub.length, 1);
      reqId = sub[0].requestId;
      const ref = events('referral_source');
      assert.strictEqual(ref.length, 1);
      assert.strictEqual(ref[0].source, 'friend');
    });
    await test('invite request: no answer to the question is fine and records no source', async () => {
      assert.strictEqual((await request('quiet@example.test')).status, 201);
      assert.strictEqual((await request('paid.click@example.test', 'ad')).status, 201);
      assert.strictEqual(events('referral_source').length, 2);
    });
    await test('invite requests list shows where the request heard about the Lab', async () => {
      const r = await H.api(app, 'GET', '/api/invite-requests', undefined, ownerCookie);
      const row = r.json.requests.find((x) => x.email === emails.b);
      assert.strictEqual(row.heardFrom, 'friend');
      assert.strictEqual(row.heardFromLabel, 'A friend or family member');
    });
    await test('marking a request invited records invite_approved once', async () => {
      const r = await H.api(app, 'POST', '/api/invite-requests/' + reqId + '/status', { status: 'invited' }, ownerCookie);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(events('invite_approved').length, 1);
    });
    await test('declining a request takes it out of qualified', async () => {
      const list = (await H.api(app, 'GET', '/api/invite-requests', undefined, ownerCookie)).json.requests;
      const quiet = list.find((x) => x.email === 'quiet@example.test');
      assert.strictEqual((await H.api(app, 'POST', '/api/invite-requests/' + quiet.id + '/status', { status: 'declined' }, ownerCookie)).status, 200);
      const d = (await board(ownerCookie)).json;
      assert.deepStrictEqual(d.requests.this, { received: 3, declined: 1, qualified: 2 });
      assert.strictEqual(d.conversion.this.approvals, 1);
      assert.strictEqual(d.referrals.this.referral.friend, 1);
      assert.strictEqual(d.referrals.this.referralTotal, 1);
      assert.strictEqual(d.referrals.this.paid.ad, 1, 'paid sources are kept apart from referrals');
      assert.strictEqual(d.referrals.this.noAnswer, 1);
    });

    /* -- paid starts, MRR and plans set by hand ------------------------ */
    fake.subs.sub_g1 = H.makeSub('sub_g1', { price: H.PRICE.training, userId: ids.b, customer: 'cus_gb' });
    const checkout = H.evt('checkout.session.completed', {
      object: 'checkout.session', id: 'cs_test_g1', mode: 'subscription', payment_status: 'paid',
      status: 'complete', subscription: 'sub_g1', customer: 'cus_gb', client_reference_id: ids.b,
      customer_email: emails.b, metadata: {},
    });
    await test('a Stripe checkout records paid_membership_started with the tier', async () => {
      assert.strictEqual((await H.sendEvent(app, checkout)).status, 200);
      const e = events('paid_membership_started');
      assert.strictEqual(e.length, 1);
      assert.strictEqual(e[0].tier, 'training');
      assert.strictEqual(e[0].memberId, ids.b);
    });
    await test('a replayed checkout event does not count a second start', async () => {
      assert.strictEqual((await H.sendEvent(app, checkout)).status, 200);
      assert.strictEqual(events('paid_membership_started').length, 1);
    });
    await test('a plan set by hand is shown apart and left out of revenue', async () => {
      const r = await H.api(app, 'PUT', '/api/access/' + ids.c, { tier: 'pass' }, ownerCookie);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(events('paid_membership_started').length, 1);
      const d = (await board(ownerCookie)).json;
      assert.strictEqual(d.newPaid.this.training, 1);
      assert.strictEqual(d.newPaid.this.total, 1);
      assert.strictEqual(d.activePaid.this.training, 1);
      assert.strictEqual(d.activePaid.this.pass, 0);
      assert.strictEqual(d.mrr.this, 79.99);
      assert.strictEqual(d.handSetPlans.pass, 1);
      assert.strictEqual(d.conversion.this.paidStarts, 1);
      assert.strictEqual(d.conversion.sinceLaunch.paidStarts, 1, 'invited request email went on to pay');
    });

    /* -- first workouts and weekly activity ---------------------------- */
    await app.restart((d) => {
      d.profiles.push({ id: 'prof_growth_b', firstName: 'Sample', lastName: 'Member', groupId: null, events: [],
        topAthlete: false, archived: false, status: 'active', createdAt: new Date().toISOString() });
      d.athleteLinks[emails.b] = 'prof_growth_b';
    });
    await test('the first logged workout records first_workout_completed and one weekly_active_member', async () => {
      const r = await H.api(app, 'POST', '/api/my/logs', { title: 'Block starts', status: 'done' }, cookies.b);
      assert.strictEqual(r.status, 201, JSON.stringify(r.json));
      assert.strictEqual(events('first_workout_completed').length, 1);
      assert.strictEqual(events('weekly_active_member').length, 1);
    });
    await test('a second workout the same week adds neither', async () => {
      assert.strictEqual((await H.api(app, 'POST', '/api/my/logs', { title: 'Tempo', status: 'done' }, cookies.b)).status, 201);
      assert.strictEqual(events('first_workout_completed').length, 1);
      assert.strictEqual(events('weekly_active_member').length, 1);
    });
    await test('scoreboard: members who trained counts from the records', async () => {
      const d = (await board(ownerCookie)).json;
      assert.strictEqual(d.weeklyActive.this, 1);
      assert.strictEqual(d.firstWeek.this.newMembers, 2);
      assert.strictEqual(d.firstWeek.this.notLinked, 1);
      const row = d.funnel.find((x) => x.name === 'weekly_active_member');
      assert.strictEqual(row.this, 1);
    });

    /* -- cancellations with reasons ------------------------------------ */
    await test('a member cancel with a reason records cancellation with that reason', async () => {
      const r = await H.api(app, 'POST', '/api/my/membership/cancel', { cancelReason: 'time' }, cookies.b);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const e = events('cancellation');
      assert.strictEqual(e.length, 1);
      assert.strictEqual(e[0].reason, 'time');
      assert.strictEqual(e[0].tier, 'training');
    });
    await test('a made-up reason is dropped, not stored', async () => {
      const r = await H.api(app, 'POST', '/api/my/membership/cancel', { cancelReason: '__proto__' }, cookies.c);
      assert.strictEqual(r.status, 200);
      const e = events('cancellation');
      assert.strictEqual(e.length, 2);
      assert.strictEqual(e[1].reason, undefined);
    });
    await test('scoreboard: cancellations list plain reasons, counted once', async () => {
      const d = (await board(ownerCookie)).json;
      assert.strictEqual(d.cancellations.this.length, 2);
      const paid = d.cancellations.this.find((c) => c.paid);
      assert.strictEqual(paid.reasonLabel, 'Not enough time to train');
      const hand = d.cancellations.this.find((c) => !c.paid);
      assert.strictEqual(hand.reasonLabel, null);
      assert.strictEqual(d.activePaid.this.training, 1, 'a paid member keeps access to the end of the period');
      assert.strictEqual(d.handSetPlans.total, 0);
    });

    /* -- without card payments switched on ----------------------------- */
    await test('scoreboard says when card payments are not switched on', async () => {
      const owner = await H.api(noKeyApp, 'POST', '/api/register', { email: 'owner@example.test', password: 'owner-pass-123' });
      const r = await H.api(noKeyApp, 'GET', '/api/owner/scoreboard', undefined, owner.cookie);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.paymentsOn, false);
    });
    await test('an assistant coach (not the owner) gets 403', async () => {
      const owner = await H.api(noKeyApp, 'POST', '/api/login', { email: 'owner@example.test', password: 'owner-pass-123' });
      await noKeyApp.restart((d) => {
        d.users.push(Object.assign({}, d.users[0], { id: 'coach_two', email: 'coach.two@example.test', isOwner: false }));
      });
      const login = await H.api(noKeyApp, 'POST', '/api/login', { email: 'coach.two@example.test', password: 'owner-pass-123' });
      assert.strictEqual(login.status, 200, JSON.stringify(login.json));
      assert.strictEqual((await H.api(noKeyApp, 'GET', '/api/owner/scoreboard', undefined, login.cookie)).status, 403);
      assert.ok(owner.status === 200);
    });
  } catch (err) {
    R.failed++;
    console.log('  FAIL setup: ' + (err && err.stack));
  } finally {
    app.stop(); noKeyApp.stop(); fake.server.close();
  }
  console.log('\n' + R.passed + ' passed, ' + R.failed + ' failed');
  process.exit(R.failed ? 1 : 0);
})();
