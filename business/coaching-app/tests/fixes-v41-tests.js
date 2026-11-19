#!/usr/bin/env node
'use strict';
/*
 * Tests for the v41 fixes found in the live click-through on Nov 19:
 * the demo window that would not close, homepage visits at "/" that
 * were never counted, the sideways page shift, the scoreboard's
 * "None this week" on the Last week tab, the Reports comparison
 * dates, and the back button label that stuck after the member view.
 *
 *   node tests/fixes-v41-tests.js
 *
 * Runs pieces of public/app.js in a small fake page. Placeholders
 * only: no real accounts or data.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function between(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, 'marker not found: ' + startMarker);
  const j = src.indexOf(endMarker, i + startMarker.length);
  assert.ok(j > i, 'end marker not found after: ' + startMarker);
  return src.slice(i, j);
}

function fakeEl(id) {
  const el = { id, hidden: false, innerHTML: '', listeners: {} };
  el.addEventListener = (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); };
  el.fire = (type, ev) => (el.listeners[type] || []).forEach((fn) => fn(Object.assign({ target: el }, ev || {})));
  return el;
}

const R = H.makeRunner();
const { test } = R;

(async () => {
  console.log('v41 fixes from the live click-through');

  /* -- demo window ----------------------------------------------------- */
  const mediaCode = between(APP, 'let mediaTarget = null;', 'function openMedia(')
    + between(APP, 'function closeMedia() {', "document.addEventListener('click', (e) => {");
  function mediaPage() {
    const els = { 'media-modal': fakeEl('media-modal'), 'media-close': fakeEl('media-close'), 'media-player': fakeEl('media-player') };
    const doc = fakeEl('document');
    doc.getElementById = (id) => els[id] || null;
    doc.querySelector = (sel) => els[sel.replace(/^#/, '')] || null;
    const ctx = vm.createContext({ document: doc });
    vm.runInContext('const $ = (sel) => document.querySelector(sel);\n' + mediaCode, ctx);
    const open = () => { els['media-modal'].hidden = false; els['media-player'].innerHTML = '<iframe></iframe>'; };
    return { els, doc, open };
  }
  await test('the demo window\'s Close button closes it', async () => {
    const p = mediaPage(); p.open();
    p.els['media-close'].fire('click');
    assert.strictEqual(p.els['media-modal'].hidden, true);
    assert.strictEqual(p.els['media-player'].innerHTML, '', 'the video stops playing');
  });
  await test('Escape closes the demo window', async () => {
    const p = mediaPage(); p.open();
    p.doc.fire('keydown', { key: 'Enter' });
    assert.strictEqual(p.els['media-modal'].hidden, false, 'other keys leave it open');
    p.doc.fire('keydown', { key: 'Escape' });
    assert.strictEqual(p.els['media-modal'].hidden, true);
  });
  await test('a tap outside the box closes it, a tap inside does not', async () => {
    const p = mediaPage(); p.open();
    p.els['media-modal'].fire('click', { target: { id: 'media-player' } });
    assert.strictEqual(p.els['media-modal'].hidden, false);
    p.els['media-modal'].fire('click');
    assert.strictEqual(p.els['media-modal'].hidden, true);
  });
  await test('the Close button is still in the page', async () => {
    assert.ok(/id="media-modal"[^>]*hidden/.test(HTML));
    assert.ok(HTML.includes('id="media-close"'));
  });

  /* -- homepage visit at "/" ------------------------------------------- */
  await test('a signed-out visit to "/" is counted once per session', async () => {
    const boot = between(APP, '(async function boot() {', '})();');
    assert.ok(/else if \(state\.user\) showView\('home'\);[\s\S]{0,200}else rpTrackLandingView\(\);/.test(boot),
      'boot counts the visit when no other view is shown');
    const calls = [];
    const store = {};
    const ctx = vm.createContext({
      state: { user: null },
      document: { getElementById: () => ({ getAttribute: () => null }) },
      sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
      rpTrack: (name, data) => calls.push([name, data]),
    });
    vm.runInContext(between(APP, 'function rpTrackLandingView() {', '/* The answers the invitation form') , ctx);
    vm.runInContext('rpTrackLandingView(); rpTrackLandingView();', ctx);
    assert.strictEqual(JSON.stringify(calls), JSON.stringify([['landing_view', { page: '/' }]]));
  });

  /* -- sideways shift --------------------------------------------------- */
  await test('full-width bands take the scrollbar back out', async () => {
    assert.ok(CSS.includes('.lp-band { margin-inline: calc(50% - 50vw + var(--rp-sbw, 0px) / 2);'));
    const props = {};
    const ctx = vm.createContext({
      window: { innerWidth: 1440, addEventListener() {} },
      document: { documentElement: { clientWidth: 1425, style: { setProperty: (k, v) => { props[k] = v; } } } },
    });
    vm.runInContext(between(APP, 'function rpSetScrollbarVar() {', '\n}\n') + '\n}\nrpSetScrollbarVar();', ctx);
    assert.strictEqual(props['--rp-sbw'], '15px');
    ctx.document.documentElement.clientWidth = 1440;
    vm.runInContext('rpSetScrollbarVar();', ctx);
    assert.strictEqual(props['--rp-sbw'], '0px', 'phones with overlay scrollbars get nothing taken out');
  });

  /* -- scoreboard wording ---------------------------------------------- */
  await test('the Last week tab says "None last week"', async () => {
    const ctx = vm.createContext({});
    vm.runInContext(between(APP, 'function esc(s) {', '\n}\n') + '\n}\n'
      + between(APP, 'function sbSourceList(group, labels, week) {', 'async function renderScoreboard()'), ctx);
    assert.ok(vm.runInContext("sbSourceList({}, {}, 'last')", ctx).includes('None last week.'));
    assert.ok(vm.runInContext("sbSourceList({}, {}, 'this')", ctx).includes('None this week.'));
    assert.ok(!/sbSourceList\(ref\.\w+, d\.referralLabels\)/.test(APP), 'every list is told which week it shows');
  });

  /* -- Reports comparison dates ---------------------------------------- */
  const cmpBlock = between(APP, "const dstr = (d) =>", "if (!state.reportCmpTest");
  function cmpDefaults(todayIso, weekStarts) {
    const state = {};
    const ctx = vm.createContext({ state, load: { weeks: weekStarts.map((start) => ({ start })) } });
    vm.runInContext(APP.match(/^function parseDate\(s\).*$/m)[0], ctx);
    const [y, m, d] = todayIso.split('-').map(Number);
    vm.runInContext(`const RealDate = Date;
      Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(${y}, ${m - 1}, ${d}); } };
      ${cmpBlock}`, ctx);
    return state;
  }
  const season = [];
  for (let i = 0; i < 20; i++) {
    const t = new Date(2026, 9, 26 + i * 7);
    season.push(t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'));
  }
  await test('early in the season Period B never ends before it starts', async () => {
    const s = cmpDefaults('2026-11-19', season);
    assert.ok(s.reportCmpAFrom <= s.reportCmpATo, JSON.stringify(s));
    assert.ok(s.reportCmpATo < s.reportCmpBFrom, JSON.stringify(s));
    assert.ok(s.reportCmpBFrom <= s.reportCmpBTo, JSON.stringify(s));
    assert.strictEqual(s.reportCmpBTo, '2026-11-19');
  });
  await test('mid-season the split still runs through today', async () => {
    const s = cmpDefaults('2027-02-15', season);
    assert.ok(s.reportCmpATo < s.reportCmpBFrom && s.reportCmpBFrom <= s.reportCmpBTo, JSON.stringify(s));
    assert.strictEqual(s.reportCmpBTo, '2027-02-15');
  });
  await test('before the season starts both periods still read forwards', async () => {
    const s = cmpDefaults('2026-09-01', season);
    assert.ok(s.reportCmpAFrom <= s.reportCmpATo && s.reportCmpATo < s.reportCmpBFrom && s.reportCmpBFrom <= s.reportCmpBTo, JSON.stringify(s));
  });

  /* -- 30m sprint ------------------------------------------------------ */
  await test('the sample report and the baseline kit use the 30m sprint', async () => {
    const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.ok(APP.includes("['30m sprint', '4.42 s', '4.29 s', '−0.13 s']"));
    assert.ok(!/40-yard dash/i.test(between(APP, 'const RP_SAMPLE_REPORT = [', '];')));
    assert.ok(APP.includes("const CORE_KEYS = ['30m-sprint', 'vertical-jump', 'broad-jump'];"));
    assert.ok(SERVER.includes("const CORE_TEST_KEYS = ['30m-sprint', 'vertical-jump', 'broad-jump'];"));
    assert.ok(SERVER.includes("{ key: 'forty-yard-dash', name: '40-Yard Dash'"), 'the 40 stays in the catalog');
  });

  /* -- back button label ------------------------------------------------ */
  await test('the back button gets its own label back after the member view', async () => {
    const fn = between(APP, 'function syncBackHome(name) {', '/* RP-HOME-REDESIGN-END */');
    assert.ok(/btn\.innerHTML = `<span aria-hidden="true">←<\/span> \$\{esc\(RP_COPY\.back\)\}`;/.test(fn));
  });

  console.log('\n' + R.passed + ' passed, ' + R.failed + ' failed');
  process.exit(R.failed ? 1 : 0);
})();
