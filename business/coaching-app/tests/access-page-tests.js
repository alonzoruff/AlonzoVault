#!/usr/bin/env node
'use strict';
/*
 * Tests for the coach's Member access page (step 1d follow-up):
 * the pending end date on a row, the Stripe caution on rows where
 * the coach's own Cancel button would not stop billing, and the
 * header sentence.
 *
 *   node tests/access-page-tests.js
 *
 * app.js is browser code with no module exports, so this pulls the
 * real renderAccess (and the helpers it uses) straight out of
 * public/app.js and runs it against a tiny fake page. Placeholders
 * only: no real accounts or data.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function between(startMarker, endMarker) {
  const i = APP.indexOf(startMarker);
  assert.ok(i >= 0, 'marker not found: ' + startMarker);
  const j = APP.indexOf(endMarker, i + startMarker.length);
  assert.ok(j > i, 'end marker not found after: ' + startMarker);
  return APP.slice(i, j);
}
const code = [
  between('function esc(s) {', '\n}\n') + '\n}\n',
  APP.match(/^function parseDate\(s\).*$/m)[0],
  APP.match(/^function fmtDate\(d\).*$/m)[0],
  between('const ACCESS_TIER_OPTIONS = [', '/* ---------------- live sessions (Lab Pass)'),
  between('const TIER_ADDS = {', 'const LOCK_ICON'),
].join('\n');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (err) { failed++; console.log('  FAIL ' + name + '\n       ' + (err && err.message)); }
}

async function render(members) {
  const el = { innerHTML: '', querySelectorAll: () => [] };
  const ctx = {
    $: () => el, isCoachUser: () => true, gateHtml: () => {},
    api: async () => ({ members }), apiPut: async () => ({}),
    Intl, Date, Number, Object, String, Array, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.renderAccess = renderAccess; this.accessEndDate = accessEndDate;', ctx);
  await ctx.renderAccess();
  return { html: el.innerHTML, ctx };
}
const member = (o) => Object.assign({
  userId: 'u-1', email: 'member@example.test', createdAt: '2026-09-01T00:00:00.000Z', profileId: null, profileName: null,
  tier: 'training', tierName: 'Lab Training', priceLabel: '$49.99/month', status: 'active', active: true,
  tierUpdatedAt: '2026-10-01T12:00:00.000Z', cancelsAt: null,
  stripeCustomerId: null, stripeSubscriptionId: null,
  history: [{ at: '2026-10-01T12:00:00.000Z', by: 'coach', byEmail: 'owner@example.test', action: 'set-tier', tier: 'training', status: 'active' }],
}, o || {});
const WARNING = 'This member pays through Stripe. Cancelling here changes their access in this app only.';
const END = '2026-11-23T17:00:00.000Z';

(async () => {
  console.log('coach Member access page');

  await test('the header sentence describes the webhook as live, not future', async () => {
    const { html } = await render([member()]);
    assert.ok(!/webhook will set/.test(html));
    assert.ok(html.includes('the Stripe webhook updates the same fields by itself'));
    assert.ok(html.includes('a change from Stripe replaces a manual one'));
  });

  await test('a subscribed, active row with nothing pending shows the Stripe caution', async () => {
    const { html } = await render([member({ stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })]);
    assert.ok(html.includes(WARNING));
    assert.ok(html.includes('To end it for good, cancel the subscription in Stripe.'));
    assert.ok(html.includes('Stripe subscription on file'));
    assert.ok(html.includes('data-access-cancel'), 'the coach Cancel button is still there');
  });

  await test('a row whose end is already scheduled shows the end date and no caution', async () => {
    const { html } = await render([member({ stripeSubscriptionId: 'sub_1', cancelsAt: END })]);
    assert.ok(html.includes('badge low') && html.includes('Active'));
    assert.ok(html.includes('ends November 23, 2026'));
    assert.ok(!html.includes(WARNING));
  });

  await test('the end date is read in New York time (an evening end stays on its own day)', async () => {
    const { ctx } = await render([]);
    assert.strictEqual(ctx.accessEndDate('2026-11-24T02:00:00.000Z'), 'November 23, 2026');
    assert.strictEqual(ctx.accessEndDate('2026-11-24T06:00:00.000Z'), 'November 24, 2026');
    assert.strictEqual(ctx.accessEndDate(null), '');
    assert.strictEqual(ctx.accessEndDate('garbage'), '');
  });

  await test('a cancelled subscribed row shows neither the caution nor an end date', async () => {
    const { html } = await render([member({ status: 'cancelled', active: false, stripeSubscriptionId: 'sub_1', cancelsAt: null })]);
    assert.ok(!html.includes(WARNING));
    assert.ok(!html.includes('ends '));
    assert.ok(html.includes('Cancelled') && html.includes('data-access-reactivate'));
  });

  await test('a row with no subscription is exactly as before: no caution, no end date', async () => {
    const { html } = await render([member()]);
    assert.ok(!html.includes(WARNING));
    assert.ok(!html.includes('Stripe subscription on file'));
    assert.ok(!html.includes('muted">ends '));
    assert.ok(html.includes('data-access-cancel') && html.includes('data-access-save'));
  });

  await test('a row with a missing end date field (older server) still renders', async () => {
    const m = member({ stripeSubscriptionId: 'sub_1' }); delete m.cancelsAt;
    const { html } = await render([m]);
    assert.ok(html.includes(WARNING));
  });

  await test('the history line shows a member-requested cancel generically', async () => {
    const m = member({ stripeSubscriptionId: 'sub_1', cancelsAt: END,
      history: [{ at: '2026-11-03T13:00:00.000Z', by: 'member', byEmail: 'member@example.test', action: 'cancel-requested', tier: 'training', status: 'active' }] });
    const { html } = await render([m]);
    assert.ok(html.includes('Last change: cancel-requested'));
    assert.ok(html.includes('by member'));
  });

  await test('no members still shows the existing empty message', async () => {
    const { html } = await render([]);
    assert.ok(html.includes('No member accounts yet.'));
  });

  await test('the new coach-facing copy has no long dashes and no bold in running text', async () => {
    const { html } = await render([member({ stripeSubscriptionId: 'sub_1' }), member({ userId: 'u-2', stripeSubscriptionId: 'sub_2', cancelsAt: END })]);
    const added = [html.slice(html.indexOf('Every member account'), html.indexOf('</p>', html.indexOf('Every member account'))),
      html.slice(html.indexOf('This member pays through Stripe'), html.indexOf('</p>', html.indexOf('This member pays through Stripe'))),
      html.slice(html.indexOf('muted">ends '), html.indexOf('</span>', html.indexOf('muted">ends ')))].join('\n');
    assert.ok(added.length > 100);
    assert.ok(!/[—–]/.test(added));
    assert.ok(!/<strong>|<b>/.test(added));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
