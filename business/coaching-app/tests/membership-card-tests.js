#!/usr/bin/env node
'use strict';
/*
 * Tests for the Account tab's membership card (step 1d, display):
 * what a member sees before cancelling, while a paid period is
 * running out, and after it has ended.
 *
 *   node tests/membership-card-tests.js
 *
 * app.js is browser code with no module exports, so this pulls the
 * real renderMembershipCard (and the small helpers it uses) straight
 * out of public/app.js and runs them against a tiny fake page. It
 * also pulls cancelNotice out of server.js to prove the sentence the
 * browser builds from an end date is word for word the sentence the
 * server sends. Placeholders only: no real accounts or data.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function between(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, 'marker not found: ' + startMarker);
  const j = src.indexOf(endMarker, i + startMarker.length);
  assert.ok(j > i, 'end marker not found after: ' + startMarker);
  return src.slice(i, j);
}
const code = [
  between(APP, 'function esc(s) {', '\n}\n') + '\n}\n',
  APP.match(/^function parseDate\(s\).*$/m)[0],
  APP.match(/^function fmtDate\(d\).*$/m)[0],
  between(APP, 'function membershipEndNotice(m) {', '/* ---------------- member access (coach)'),
  between(APP, 'const TIER_ADDS = {', 'const LOCK_ICON'),
].join('\n');
const serverCancelNotice = between(SERVER, 'function cancelNotice(iso) {', '\n}\n') + '\n}\n';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (err) { failed++; console.log('  FAIL ' + name + '\n       ' + (err && err.message)); }
}

/* A fake page: one container plus whatever ids its html mentions. */
function makePage(initialData, apiPostImpl) {
  const els = {};
  const mk = (id) => {
    const el = { id, listeners: {}, disabled: false, textContent: '', _html: '' };
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._html; },
      set(v) { this._html = v; for (const k of Object.keys(els)) if (k !== id && k !== 'member-membership') delete els[k]; },
    });
    el.addEventListener = (type, fn) => { el.listeners[type] = fn; };
    el.click = () => (el.listeners.click ? el.listeners.click() : undefined);
    return el;
  };
  const container = mk('member-membership');
  els['member-membership'] = container;
  const $ = (sel) => {
    const id = sel.replace(/^#/, '');
    if (els[id]) return els[id];
    const hay = Object.values(els).map((e) => e._html).join('\n');
    if (hay.includes('id="' + id + '"')) { els[id] = mk(id); return els[id]; }
    return null;
  };
  const calls = { nav: 0, home: 0, posts: [] };
  const state = { user: { role: 'athlete' }, membershipData: initialData, membership: initialData.membership };
  const ctx = {
    state, $, calls,
    isAthleteUser: () => true,
    api: async () => initialData,
    apiPost: async (url, body) => { calls.posts.push(url); return apiPostImpl(url, body); },
    applyMembershipNav: () => { calls.nav++; },
    renderHome: () => { calls.home++; },
    Intl, Date, Number, Object, String, Array, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n' + between(APP, 'async function renderMembershipCard() {', '/* ---------------- member access (coach)') + '\nthis.renderMembershipCard = renderMembershipCard; this.membershipEndNotice = membershipEndNotice;', ctx);
  return { ctx, container, $, state, calls };
}

const TIER = { name: 'Lab Training', priceLabel: '$49.99/month' };
const membership = (o) => Object.assign({
  tier: 'training', tierName: TIER.name, priceLabel: TIER.priceLabel, status: 'active', active: true,
  cancelsAt: null, tierUpdatedAt: '2026-10-01T12:00:00.000Z', includes: ['Form checks with replies from your coach'],
}, o || {});
const data = (m) => ({ account: { email: 'member@example.test', createdAt: '2026-09-01T00:00:00.000Z', profileName: null }, membership: m, tiers: [] });
const END = '2026-11-23T17:00:00.000Z';
const SENTENCE = 'Your membership will end on November 23, 2026. You keep full access until then.';

(async () => {
  console.log('membership card');

  await test('an active member with nothing pending sees the cancel button and the since date (unchanged)', async () => {
    const pg = makePage(data(membership()), async () => ({}));
    await pg.ctx.renderMembershipCard();
    const h = pg.container.innerHTML;
    assert.ok(h.includes('id="membership-cancel-btn"'));
    assert.ok(h.includes('<span class="muted">since '), 'the status line keeps its since date');
    assert.ok(!h.includes('membership-end-notice'));
  });

  await test('the confirm box is true for both kinds of member and has no stale Stripe line', async () => {
    const pg = makePage(data(membership()), async () => ({}));
    await pg.ctx.renderMembershipCard();
    pg.$('#membership-cancel-btn').click();
    const h = pg.$('#membership-cancel-zone').innerHTML;
    assert.ok(h.includes('If you pay by subscription, your membership stops at the end of the period you have paid for'));
    assert.ok(h.includes('If your coach gave you access directly, it ends right away'));
    assert.ok(!/your coach will stop the subscription/.test(h));
    assert.ok(h.includes('id="membership-cancel-yes"') && h.includes('id="membership-cancel-no"'));
  });

  await test('after cancelling a subscription, the card shows the server sentence and no cancel button', async () => {
    const pg = makePage(data(membership()), async () => ({ ok: true, membership: membership({ cancelsAt: END }), notice: SENTENCE }));
    await pg.ctx.renderMembershipCard();
    pg.$('#membership-cancel-btn').click();
    await pg.$('#membership-cancel-yes').click();
    await new Promise((r) => setImmediate(r));
    const h = pg.container.innerHTML;
    assert.ok(h.includes(SENTENCE), 'the sentence is on the card');
    assert.ok(h.includes('id="membership-end-notice"') && h.includes('role="status"'));
    assert.ok(!h.includes('membership-cancel-btn') && !h.includes('membership-cancel-zone'));
    assert.ok(h.includes('badge low') && h.includes('Active'), 'still shown as active');
    assert.ok(!h.includes('<span class="muted">since '), 'no misleading "since" date on the status line while an end is pending');
    assert.ok(h.includes('Form checks with replies from your coach'), 'the tier list stays: access has not ended');
    assert.ok(!h.includes('has ended'), 'does not say access ended');
    assert.strictEqual(pg.calls.posts.length, 1);
    assert.strictEqual(pg.calls.posts[0], '/api/my/membership/cancel');
    assert.ok(pg.calls.nav >= 1 && pg.calls.home >= 1, 'nav and home refreshed as before');
  });

  await test('right after cancelling, the server wording is what is shown (even if it ever differs)', async () => {
    const custom = 'Placeholder server wording for this test.';
    const pg = makePage(data(membership()), async () => ({ ok: true, membership: membership({ cancelsAt: END }), notice: custom }));
    await pg.ctx.renderMembershipCard();
    pg.$('#membership-cancel-btn').click();
    await pg.$('#membership-cancel-yes').click();
    await new Promise((r) => setImmediate(r));
    assert.ok(pg.container.innerHTML.includes(custom));
    assert.ok(!pg.container.innerHTML.includes('November 23, 2026'));
  });

  await test('reload: with only the end date, the card builds the identical sentence', async () => {
    const pg = makePage(data(membership({ cancelsAt: END })), async () => ({}));
    await pg.ctx.renderMembershipCard();
    assert.ok(pg.container.innerHTML.includes(SENTENCE));
    assert.ok(!pg.container.innerHTML.includes('membership-cancel-btn'));
  });

  await test('the browser sentence matches the server sentence for many dates, including daylight saving edges', async () => {
    const serverCtx = vm.createContext({ Intl, Date, Number });
    vm.runInContext(serverCancelNotice + '\nthis.cancelNotice = cancelNotice;', serverCtx);
    const pg = makePage(data(membership()), async () => ({}));
    const isos = [END, '2026-11-01T05:59:59.000Z', '2026-11-01T06:00:00.000Z', '2026-03-08T06:59:59.000Z',
      '2026-03-08T07:00:00.000Z', '2026-12-31T04:59:59.000Z', '2027-01-01T04:00:00.000Z', '2026-07-04T03:59:59.000Z'];
    for (let d = 0; d < 400; d++) isos.push(new Date(Date.UTC(2026, 0, 1) + d * 86400000 + 13 * 3600000).toISOString());
    for (const iso of isos) {
      pg.state.membershipNotice = ''; pg.state.membershipNoticeFor = null;
      assert.strictEqual(pg.ctx.membershipEndNotice({ cancelsAt: iso }), serverCtx.cancelNotice(iso), iso);
    }
    assert.strictEqual(pg.ctx.membershipEndNotice({ cancelsAt: null }), serverCtx.cancelNotice(null));
    assert.strictEqual(pg.ctx.membershipEndNotice({ cancelsAt: 'garbage' }), serverCtx.cancelNotice('garbage'));
  });

  await test('a remembered server sentence is not reused for a different end date', async () => {
    const pg = makePage(data(membership({ cancelsAt: '2027-02-02T17:00:00.000Z' })), async () => ({}));
    pg.state.membershipNotice = SENTENCE; pg.state.membershipNoticeFor = END;
    await pg.ctx.renderMembershipCard();
    assert.ok(pg.container.innerHTML.includes('February 2, 2027'));
    assert.ok(!pg.container.innerHTML.includes('November 23'));
  });

  await test('a member with no subscription who cancels sees the existing cancelled card', async () => {
    const pg = makePage(data(membership()), async () => ({ ok: true, membership: membership({ status: 'cancelled', active: false }) }));
    await pg.ctx.renderMembershipCard();
    pg.$('#membership-cancel-btn').click();
    await pg.$('#membership-cancel-yes').click();
    await new Promise((r) => setImmediate(r));
    const h = pg.container.innerHTML;
    assert.ok(h.includes('Your tier access has ended.'));
    assert.ok(h.includes('badge high') && h.includes('Cancelled'));
    assert.ok(!h.includes('membership-end-notice'));
  });

  await test('once the paid period has ended (status cancelled), the existing cancelled card shows', async () => {
    const pg = makePage(data(membership({ status: 'cancelled', active: false, cancelsAt: null })), async () => ({}));
    await pg.ctx.renderMembershipCard();
    assert.ok(pg.container.innerHTML.includes('Your tier access has ended.'));
  });

  await test('a member with no tier still sees the no-membership card', async () => {
    const pg = makePage(data(membership({ tier: null, tierName: null, priceLabel: null, active: false })), async () => ({}));
    await pg.ctx.renderMembershipCard();
    assert.ok(pg.container.innerHTML.includes('No membership yet.'));
  });

  await test('if the server refuses (payment provider down), the message shows and the button works again', async () => {
    const msg = 'We could not reach the payment provider just now, so your membership has not been changed. Please try again in a few minutes.';
    const pg = makePage(data(membership()), async () => { throw new Error(msg); });
    await pg.ctx.renderMembershipCard();
    pg.$('#membership-cancel-btn').click();
    const yes = pg.$('#membership-cancel-yes');
    const pending = yes.click();
    assert.strictEqual(yes.disabled, true, 'disabled while the request runs');
    assert.strictEqual(yes.textContent, 'Cancelling');
    await pending;
    assert.strictEqual(pg.$('#membership-cancel-err').textContent, msg);
    assert.strictEqual(yes.disabled, false);
    assert.strictEqual(yes.textContent, 'Yes, cancel my membership');
    assert.ok(pg.container.innerHTML.includes('membership-cancel-zone'), 'the card did not change');
  });

  await test('the new member-facing copy has no long dashes and no bold in running text', async () => {
    const pg = makePage(data(membership()), async () => ({ ok: true, membership: membership({ cancelsAt: END }), notice: SENTENCE }));
    await pg.ctx.renderMembershipCard();
    pg.$('#membership-cancel-btn').click();
    const confirmHtml = pg.$('#membership-cancel-zone').innerHTML;
    await pg.$('#membership-cancel-yes').click();
    await new Promise((r) => setImmediate(r));
    const noticeHtml = pg.container.innerHTML.slice(pg.container.innerHTML.indexOf('membership-end-notice'));
    const added = [confirmHtml.replace(/<strong>Cancel your membership\?<\/strong>/, ''), noticeHtml.split('What your tier includes')[0]].join('\n');
    assert.ok(!/[—–]/.test(added), 'no em or en dashes');
    assert.ok(!/<strong>|<b>/.test(added), 'no bold in the new text');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
