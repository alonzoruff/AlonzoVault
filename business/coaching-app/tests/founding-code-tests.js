#!/usr/bin/env node
'use strict';
/*
 * Founding code (Nov 28, 2026): a code word typed at sign-up stands in
 * for an email invite and starts the account on Lab Pass, free. The
 * word comes only from the FOUNDING_CODE environment setting.
 *
 *   node tests/founding-code-tests.js
 *
 * Real server, throwaway data folder, made-up people. The code word
 * used here is a test placeholder, not the real one.
 */
const assert = require('assert');
const { makeRunner, startApp, api, seedAccounts } = require('./harness');

const r = makeRunner();
const TEST_CODE = 'TESTCODE-PLACEHOLDER';

function fakePass(i) {
  return {
    id: 'seed-pass-' + i, email: 'seed' + i + '@example.test', role: 'athlete', passHash: 'x',
    createdAt: '2026-11-01T12:00:00.000Z', tier: 'pass', membershipStatus: 'active',
    tierUpdatedAt: '2026-11-01T12:00:00.000Z', stripeCustomerId: null, stripeSubscriptionId: null,
    membershipHistory: [],
  };
}

async function main() {
  const app = await startApp({ FOUNDING_CODE: TEST_CODE });
  try {
    const s = await seedAccounts(app, 'invited@example.test');
    const oc = s.ownerCookie;
    const reg = (email, code) => api(app, 'POST', '/api/register',
      Object.assign({ email, password: 'pass-word-123' }, code === undefined ? {} : { code }));

    await r.test('the code word is never on the public site or in the served app', async () => {
      const page = (await api(app, 'GET', '/')).text;
      const js = (await api(app, 'GET', '/app.js')).text;
      assert.ok(!page.includes(TEST_CODE) && !js.includes(TEST_CODE));
      assert.ok(!page.toUpperCase().includes('FOUNDFAM') && !js.toUpperCase().includes('FOUNDFAM'));
    });

    await r.test('the existing invite flow is unchanged: an invited email registers with no tier', async () => {
      // seedAccounts already registered invited@example.test through the invite list.
      const u = app.userByEmail('invited@example.test');
      assert.ok(u);
      assert.strictEqual(u.tier, null);
      assert.ok(!u.complimentary);
    });

    await r.test('no invite and no code: still turned away (403)', async () => {
      const res = await reg('stranger@example.test');
      assert.strictEqual(res.status, 403);
      assert.strictEqual(app.userByEmail('stranger@example.test'), null);
    });

    await r.test('a wrong code is rejected (400) and no account is made', async () => {
      const res = await reg('wrong@example.test', 'NOT-THE-CODE');
      assert.strictEqual(res.status, 400);
      assert.ok(/not valid/.test(res.json.error));
      assert.strictEqual(app.userByEmail('wrong@example.test'), null);
    });

    await r.test('the valid code redeems: account made, Lab Pass active, free, logged', async () => {
      const res = await reg('founder@example.test', '  ' + TEST_CODE.toLowerCase() + ' ');
      assert.strictEqual(res.status, 201, JSON.stringify(res.json));
      const u = app.userByEmail('founder@example.test');
      assert.strictEqual(u.role, 'athlete');
      assert.strictEqual(u.tier, 'pass');
      assert.strictEqual(u.membershipStatus, 'active');
      assert.strictEqual(u.complimentary, 'founding-code');
      const last = u.membershipHistory[u.membershipHistory.length - 1];
      assert.strictEqual(last.by, 'founding-code');
      const st = await api(app, 'GET', '/api/founding-code', undefined, oc);
      assert.strictEqual(st.status, 200);
      assert.strictEqual(st.json.enabled, true);
      assert.strictEqual(st.json.count, 1);
      assert.strictEqual(st.json.redemptions[0].email, 'founder@example.test');
      assert.ok(st.json.redemptions[0].at);
      assert.ok(!JSON.stringify(st.json).includes(TEST_CODE));
    });

    await r.test('a founding member does not count as paying on the scoreboard', async () => {
      const sb = await api(app, 'GET', '/api/owner/scoreboard', undefined, oc);
      assert.strictEqual(sb.status, 200);
      assert.strictEqual(sb.json.mrr.this, 0);
    });

    await r.test('an invited email that also types the code follows the invite (code ignored)', async () => {
      assert.strictEqual((await api(app, 'POST', '/api/client-invites', { email: 'both@example.test' }, oc)).status, 200);
      const res = await reg('both@example.test', TEST_CODE);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(app.userByEmail('both@example.test').tier, null);
    });

    await r.test('members and signed-out visitors cannot read the redemption log', async () => {
      assert.strictEqual((await api(app, 'GET', '/api/founding-code')).status, 401);
      const mc = (await api(app, 'POST', '/api/login', { email: 'founder@example.test', password: 'pass-word-123' })).cookie;
      assert.strictEqual((await api(app, 'GET', '/api/founding-code', undefined, mc)).status, 403);
    });

    await r.test('redemptions count against the Lab Pass cap: at 50, the code is refused (409)', async () => {
      await app.restart((d) => { for (let i = 0; i < 49; i++) d.users.push(fakePass(i)); });
      const res = await reg('late@example.test', TEST_CODE);
      assert.strictEqual(res.status, 409);
      assert.ok(/full/.test(res.json.error));
      assert.strictEqual(app.userByEmail('late@example.test'), null);
    });

    await r.test('too many wrong codes from one address are slowed down (429)', async () => {
      let last;
      for (let i = 0; i < 12; i++) last = await reg('guess' + i + '@example.test', 'GUESS-' + i);
      assert.strictEqual(last.status, 429);
    });
  } finally {
    app.stop();
  }

  /* With FOUNDING_CODE unset the code is off: even the right word fails. */
  const off = await startApp({ FOUNDING_CODE: '' });
  try {
    await seedAccounts(off, 'someone@example.test');
    await r.test('with FOUNDING_CODE unset the code is turned off', async () => {
      const res = await api(off, 'POST', '/api/register', { email: 'off@example.test', password: 'pass-word-123', code: TEST_CODE });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(off.userByEmail('off@example.test'), null);
    });
  } finally {
    off.stop();
  }
  console.log('\n' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
