#!/usr/bin/env node
'use strict';
/*
 * Tests for the meet entry tracker.   node tests/entries-tests.js
 *
 * Checks the shared warning rules, every meet file in meets/, and the real server over HTTP:
 * access, saving and clearing slots, conflict handling, warnings that never block,
 * survival across a restart, and that a lowered slot count never drops a name.
 * Every athlete name below is made up. The keys are made up too.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server');
const R = require('../public/entries-rules');
const { loadMeets, MEETS_DIR } = require('../lib/entries');

const PK = 'test-portal-key-0123456789';
const LK = 'test-luna-key-9876543210';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

/* a small made-up meet for the rule tests */
const MEET = {
  id: 'test-meet', name: 'Test Meet', date: '2026-12-01', slots: 5,
  rules: [{ type: 'group', label: 'Open distance races', events: ['g-1600', 'g-1000', 'g-3200'], max: 1, upTo: { athletes: 3, max: 2 } }],
  events: [
    { id: 'g-1600', name: 'Girls 1600m Run', kind: 'run' },
    { id: 'g-1000', name: 'Girls 1000m Run', kind: 'run' },
    { id: 'g-3200', name: 'Girls 3200m Run', kind: 'run' },
    { id: 'g-55', name: 'Girls 55m Dash', kind: 'run', slots: 3 },
    { id: 'g-4x2', name: 'Girls 800m Relay (4x200)', kind: 'relay' }
  ]
};

async function boot(o) {
  const opt = o || {};
  const dir = opt.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'entries-test-'));
  const cfg = { port: 0, host: '127.0.0.1', dataDir: dir, portalKey: PK, lunaKey: LK, quiet: true, meetsDir: opt.meetsDir };
  let srv = await start(cfg);
  const app = { dir, cfg, base: () => 'http://127.0.0.1:' + srv.port, cookie: null };
  app.call = async (method, p, x) => {
    const y = x || {};
    const headers = {};
    if (y.body !== undefined) headers['content-type'] = 'application/json';
    const as = y.as === undefined ? 'aj' : y.as;
    if (as === 'aj' && app.cookie) headers.cookie = app.cookie;
    if (as === 'luna') headers['x-luna-key'] = LK;
    const res = await fetch(app.base() + p, { method, headers, body: y.body === undefined ? undefined : JSON.stringify(y.body), redirect: 'manual' });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* html */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const link = await app.call('GET', '/entries?key=' + PK, { as: 'none' });
  app.cookie = link.headers.get('set-cookie').split(';')[0];
  app.link = link;
  app.put = (meet, ev, i, body) => app.call('PUT', '/api/entries/' + meet + '/' + ev + '/' + i, { body });
  app.restart = async () => { await srv.close(); srv = await start(cfg); };
  app.close = () => srv.close();
  app.stop = async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return app;
}
function meetsDirWith(meet) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'entries-meets-'));
  fs.writeFileSync(path.join(d, meet.id + '.json'), JSON.stringify(meet));
  return d;
}

(async () => {
  console.log('rules');
  await test('names match however they are typed', () => {
    assert.strictEqual(R.key('  Test   Runner A '), R.key('test runner a'));
  });
  await test('counts: filled out of slots, event override, names past the limit counted apart', () => {
    const v = R.review(MEET, { 'g-55': ['Sample Sprinter', '', 'Test Runner B', 'Over Limit Name'], 'g-4x2': ['A Relay', 'B Relay'] });
    assert.deepStrictEqual(v.events['g-55'], { filled: 2, total: 3, extra: 1 });
    assert.deepStrictEqual(v.events['g-4x2'], { filled: 2, total: 5, extra: 0 });
    assert.strictEqual(v.total, 5 + 5 + 5 + 3 + 5);
    assert.strictEqual(v.filled, 4);
  });
  await test('one distance race each is fine; three athletes may double', () => {
    const v = R.review(MEET, {
      'g-1600': ['Test Runner A', 'Test Runner B', 'Test Runner C'],
      'g-1000': ['Test Runner A', 'Test Runner B', 'Test Runner C'],
      'g-3200': ['Test Runner D']
    });
    assert.deepStrictEqual(v.warnings, []);
  });
  await test('a fourth doubler warns on all four', () => {
    const v = R.review(MEET, {
      'g-1600': ['Test Runner A', 'Test Runner B', 'Test Runner C', 'Test Runner D'],
      'g-3200': ['Test Runner A', 'Test Runner B', 'Test Runner C', 'test runner d']
    });
    assert.strictEqual(v.warnings.length, 4);
    assert.ok(/4 athletes are doubling/.test(v.warnings[0].message) && /Only 3 may run 2/.test(v.warnings[0].message));
    assert.strictEqual(R.summary(v.warnings).length, 1);
  });
  await test('three distance races warns for that athlete', () => {
    const v = R.review(MEET, { 'g-1600': ['Test Runner A'], 'g-1000': ['Test Runner A'], 'g-3200': ['Test Runner A'] });
    assert.strictEqual(v.warnings.length, 1);
    assert.ok(/in 3 open distance races\. The most anyone may run is 2/.test(v.warnings[0].message));
  });
  await test('without an exception, the second race warns', () => {
    const m = JSON.parse(JSON.stringify(MEET)); delete m.rules[0].upTo;
    const v = R.review(m, { 'g-1600': ['Test Runner A'], 'g-1000': ['Test Runner A'] });
    assert.strictEqual(v.warnings.length, 1);
  });
  await test('a per-athlete event limit counts relays too', () => {
    const m = Object.assign({}, MEET, { rules: [{ type: 'maxEvents', max: 3 }] });
    const ok = R.review(m, { 'g-55': ['Sample Sprinter'], 'g-4x2': ['Sample Sprinter'], 'g-1600': ['Sample Sprinter'] });
    assert.deepStrictEqual(ok.warnings, []);
    const over = R.review(m, { 'g-55': ['Sample Sprinter'], 'g-4x2': ['Sample Sprinter'], 'g-1600': ['Sample Sprinter'], 'g-3200': ['Sample Sprinter'] });
    assert.strictEqual(over.warnings.length, 1);
    assert.ok(/4 events\. This meet allows 3/.test(over.warnings[0].message));
  });
  await test('the same name twice in one event warns', () => {
    const v = R.review(MEET, { 'g-55': ['Sample Sprinter', 'sample sprinter'] });
    assert.strictEqual(v.warnings[0].rule, 'twice');
  });
  await test('a meet with no published limit never warns about doubles', () => {
    const m = Object.assign({}, MEET, { rules: [] });
    const v = R.review(m, { 'g-1600': ['Test Runner A'], 'g-1000': ['Test Runner A'], 'g-3200': ['Test Runner A'], 'g-55': ['Test Runner A'] });
    assert.deepStrictEqual(v.warnings, []);
  });
  await test('bad meet files are refused with a plain reason', () => {
    assert.throws(() => R.checkMeet(Object.assign({}, MEET, { slots: 0 })), /slots must be/);
    assert.throws(() => R.checkMeet(Object.assign({}, MEET, { events: [MEET.events[0], MEET.events[0]] })), /used twice/);
    assert.throws(() => R.checkMeet(Object.assign({}, MEET, { rules: [{ type: 'group', label: 'X', events: ['nope'], max: 1 }] })), /not in this meet/);
    assert.doesNotThrow(() => R.checkMeet(MEET));
  });

  console.log('meet files');
  const meets = loadMeets(MEETS_DIR);
  await test('all 12 meet files load, in date order, Episcopal first', () => {
    assert.strictEqual(meets.length, 12);
    assert.strictEqual(meets[0].id, 'episcopal-2026-11-30');
    for (let i = 1; i < meets.length; i++) assert.ok(meets[i - 1].date <= meets[i].date);
  });
  await test('every meet starts at 5 entries per event, relays included', () => {
    for (const m of meets) {
      assert.strictEqual(m.slots, 5, m.id);
      for (const e of m.events) assert.strictEqual(R.slotCount(m, e), 5, m.id + ' ' + e.id);
    }
  });
  await test('Episcopal Nov 30: 30 events, 150 slots, the distance rule on 1000, 1600 and 3200', () => {
    const m = meets[0];
    assert.strictEqual(m.events.length, 30);
    assert.strictEqual(R.review(m, {}).total, 150);
    assert.strictEqual(m.rules.length, 1);
    assert.deepStrictEqual(m.rules[0].events.slice().sort(), ['b-1000m-run', 'b-1600m-run', 'b-3200m-run', 'g-1000m-run', 'g-1600m-run', 'g-3200m-run']);
    assert.strictEqual(m.events.filter((e) => e.kind === 'relay').length, 6);
  });
  await test('meets with no published event list say so', () => {
    for (const m of meets.filter((x) => !x.events.length)) assert.ok(/not published its event list/.test(m.note), m.id);
  });

  console.log('server');
  {
    const app = await boot();
    await test('the page opens from the portal link and drops the key from the address', async () => {
      assert.strictEqual(app.link.status, 302);
      assert.strictEqual(app.link.headers.get('location'), '/entries');
      const page = await app.call('GET', '/entries');
      assert.strictEqual(page.status, 200);
      assert.ok(/entries\.js/.test(page.text) && /entries-rules\.js/.test(page.text));
      assert.strictEqual((await app.call('GET', '/entries-rules.js')).status, 200);
    });
    await test('without the cookie: page locked, API refused, Luna cannot write', async () => {
      assert.strictEqual((await app.call('GET', '/entries', { as: 'none' })).status, 401);
      assert.strictEqual((await app.call('GET', '/api/entries', { as: 'none' })).status, 401);
      assert.strictEqual((await app.call('PUT', '/api/entries/episcopal-2026-11-30/g-55m-dash/0', { as: 'none', body: { name: 'X' } })).status, 401);
      assert.strictEqual((await app.call('PUT', '/api/entries/episcopal-2026-11-30/g-55m-dash/0', { as: 'luna', body: { name: 'X' } })).status, 401);
    });
    await test('list shows every meet with filled and total', async () => {
      const r = await app.call('GET', '/api/entries');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.meets.length, 12);
      assert.deepStrictEqual([r.json.meets[0].filled, r.json.meets[0].total], [0, 150]);
    });
    await test('a name saves, the count moves, and it can be cleared', async () => {
      let r = await app.put('episcopal-2026-11-30', 'g-55m-dash', 2, { name: '  Sample   Sprinter ', was: '' });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json.names['g-55m-dash'], ['', '', 'Sample Sprinter']);
      assert.strictEqual(r.json.filled, 1);
      r = await app.put('episcopal-2026-11-30', 'g-55m-dash', 2, { name: '', was: 'Sample Sprinter' });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json.names['g-55m-dash'], []);
      assert.strictEqual(r.json.filled, 0);
    });
    await test('relays take 5 names like any event', async () => {
      for (let i = 0; i < 5; i++) assert.strictEqual((await app.put('episcopal-2026-11-30', 'g-800m-relay-4x200', i, { name: 'Relay Runner ' + i })).status, 200);
      assert.strictEqual((await app.put('episcopal-2026-11-30', 'g-800m-relay-4x200', 5, { name: 'One Too Many' })).status, 400);
    });
    await test('warnings come back but never block the save', async () => {
      await app.put('episcopal-2026-11-30', 'g-1600m-run', 0, { name: 'Test Runner A' });
      await app.put('episcopal-2026-11-30', 'g-1000m-run', 0, { name: 'Test Runner A' });
      const r = await app.put('episcopal-2026-11-30', 'g-3200m-run', 0, { name: 'Test Runner A' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.names['g-3200m-run'][0], 'Test Runner A');
      assert.strictEqual(r.json.warnings.length, 1);
      assert.ok(/Test Runner A is in 3 open distance races/.test(r.json.warnings[0]));
    });
    await test('a slot changed somewhere else is not overwritten blind', async () => {
      await app.put('episcopal-2026-11-30', 'b-300m-dash', 0, { name: 'Phone Name', was: '' });
      const r = await app.put('episcopal-2026-11-30', 'b-300m-dash', 0, { name: 'Laptop Name', was: '' });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.current, 'Phone Name');
      const again = await app.put('episcopal-2026-11-30', 'b-300m-dash', 0, { name: 'Laptop Name', was: 'Phone Name' });
      assert.strictEqual(again.status, 200);
    });
    await test('bad input gets a plain 4xx and changes nothing', async () => {
      const before = JSON.stringify((await app.call('GET', '/api/entries/episcopal-2026-11-30')).json.names);
      assert.strictEqual((await app.put('episcopal-2026-11-30', 'g-55m-dash', 0, { name: 'x'.repeat(61) })).status, 400);
      assert.strictEqual((await app.put('episcopal-2026-11-30', 'g-55m-dash', 0, { name: '<b>Bold</b>' })).status, 400);
      assert.strictEqual((await app.put('episcopal-2026-11-30', 'g-55m-dash', 0, { name: 5 })).status, 400);
      assert.strictEqual((await app.put('episcopal-2026-11-30', 'g-55m-dash', 0, { name: 'Ok', extra: 1 })).status, 400);
      assert.strictEqual((await app.put('episcopal-2026-11-30', 'nope', 0, { name: 'Ok' })).status, 404);
      assert.strictEqual((await app.put('no-such-meet', 'g-55m-dash', 0, { name: 'Ok' })).status, 404);
      assert.strictEqual(JSON.stringify((await app.call('GET', '/api/entries/episcopal-2026-11-30')).json.names), before);
    });
    await test('Luna can read entries', async () => {
      const r = await app.call('GET', '/api/luna/entries/episcopal-2026-11-30', { as: 'luna' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.names['g-1600m-run'][0], 'Test Runner A');
    });
    await test('entries are in their own file, and survive a restart', async () => {
      assert.ok(fs.existsSync(path.join(app.dir, 'entries.json')));
      assert.ok(!/Test Runner A/.test(fs.readFileSync(path.join(app.dir, 'portal.json'), 'utf8')));
      await app.restart();
      const r = await app.call('GET', '/api/entries/episcopal-2026-11-30');
      assert.strictEqual(r.json.names['g-3200m-run'][0], 'Test Runner A');
      assert.strictEqual(r.json.names['b-300m-dash'][0], 'Laptop Name');
    });
    await test('an unreadable entries.json stops the server and is left alone', async () => {
      await app.close();
      const f = path.join(app.dir, 'entries.json');
      fs.writeFileSync(f, '{ broken');
      await assert.rejects(start(app.cfg), /entries\.json exists but cannot be read/);
      assert.strictEqual(fs.readFileSync(f, 'utf8'), '{ broken');
      fs.rmSync(app.dir, { recursive: true, force: true });
    });
  }
  {
    const dir = meetsDirWith(MEET);
    const app = await boot({ meetsDir: dir });
    await test('lowering a slot count later keeps every name already typed', async () => {
      for (let i = 0; i < 5; i++) await app.put('test-meet', 'g-1600', i, { name: 'Made Up ' + i });
      fs.writeFileSync(path.join(dir, 'test-meet.json'), JSON.stringify(Object.assign({}, MEET, { slots: 3 })));
      await app.restart();
      let r = await app.call('GET', '/api/entries/test-meet');
      assert.strictEqual(r.json.names['g-1600'].length, 5);
      assert.strictEqual(r.json.filled, 3);
      r = await app.put('test-meet', 'g-1600', 4, { name: '' });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json.names['g-1600'], ['Made Up 0', 'Made Up 1', 'Made Up 2', 'Made Up 3']);
      assert.strictEqual((await app.put('test-meet', 'g-1600', 4, { name: 'Past The End' })).status, 400);
    });
    await test('a meet file whose name does not match its id is refused at start', async () => {
      await app.close();
      fs.renameSync(path.join(dir, 'test-meet.json'), path.join(dir, 'other.json'));
      await assert.rejects(start(app.cfg), /file name must be the meet id/);
    });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(app.dir, { recursive: true, force: true });
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
