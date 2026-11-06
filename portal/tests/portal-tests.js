#!/usr/bin/env node
'use strict';
/*
 * Tests for the AJ Command Portal.   node tests/portal-tests.js
 *
 * Boots the real server on a test port with a throwaway data folder and a
 * movable clock, then drives it over HTTP: access keys, quest completion,
 * the branched unlock chain, daily habits and the weekly dial, the morning
 * bonus, the Talk thread, Luna's updates, and survival across restarts
 * (including a real child process). The keys below are made up.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { start } = require('../server');
const G = require('../lib/game');

const PK = 'test-portal-key-0123456789';
const LK = 'test-luna-key-9876543210';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const noon = (ymd) => new Date(ymd + 'T17:00:00Z');    /* noon in New York in November */

async function boot(o) {
  const opt = o || {};
  const dir = opt.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
  const clock = { t: noon(opt.day || '2026-11-03') };
  const cfg = { port: 0, host: '127.0.0.1', dataDir: dir, portalKey: opt.noKeys ? '' : PK, lunaKey: opt.noKeys ? '' : LK, now: () => clock.t, quiet: true };
  let srv = await start(cfg);
  const app = { dir, clock, srv, base: () => 'http://127.0.0.1:' + srv.port, cookie: null };
  app.call = async (method, p, x) => {
    const y = x || {};
    const headers = Object.assign({}, y.headers || {});
    if (y.body !== undefined) headers['content-type'] = 'application/json';
    const as = y.as === undefined ? 'aj' : y.as;
    if (as === 'aj' && app.cookie) headers.cookie = app.cookie;
    if (as === 'luna') headers['x-luna-key'] = y.key || LK;
    const res = await fetch(app.base() + p, { method, headers, body: y.body === undefined ? undefined : JSON.stringify(y.body), redirect: 'manual' });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* html */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  app.signIn = async () => {
    const r = await app.call('GET', '/?key=' + PK, { as: 'none' });
    app.cookie = r.headers.get('set-cookie').split(';')[0];
    return r;
  };
  app.state = async () => (await app.call('GET', '/api/state')).json;
  app.done = (id, body) => app.call('POST', '/api/quests/' + id + '/complete', { body: body || {} });
  app.luna = (method, p, body) => app.call(method, p, { as: 'luna', body });
  app.restart = async () => { await srv.close(); srv = await start(cfg); app.srv = srv; };
  app.stop = async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  if (!opt.noSignIn && !opt.noKeys) await app.signIn();
  return app;
}
const find = (s, id) => { for (const l of s.lands) for (const q of (l.quests || [])) if (q.id === id) return q; return null; };
const landOf = (s, id) => s.lands.find((l) => l.id === id);

(async () => {
  console.log('access');
  {
    const app = await boot({ noSignIn: true });
    await test('without the key: locked page, API refused, health and icons stay public', async () => {
      const page = await app.call('GET', '/', { as: 'none' });
      assert.strictEqual(page.status, 401);
      assert.ok(/private/.test(page.text) && !/Command Portal<\/h1>[\s\S]*Level/.test(page.text));
      assert.strictEqual((await app.call('GET', '/api/state', { as: 'none' })).status, 401);
      assert.strictEqual((await app.call('GET', '/app.js', { as: 'none' })).status, 401);
      assert.strictEqual((await app.call('GET', '/healthz', { as: 'none' })).status, 200);
      assert.strictEqual((await app.call('GET', '/icon-180.png', { as: 'none' })).status, 200);
    });
    await test('a wrong key link shows the locked page and sets no cookie', async () => {
      const r = await app.call('GET', '/?key=nope-nope-nope-nope', { as: 'none' });
      assert.strictEqual(r.status, 401);
      assert.strictEqual(r.headers.get('set-cookie'), null);
    });
    await test('the right key link sets a cookie and sends AJ to a clean address', async () => {
      const r = await app.signIn();
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.get('location'), '/');
      const sc = r.headers.get('set-cookie');
      assert.ok(/HttpOnly/.test(sc) && /SameSite=Lax/.test(sc));
      assert.ok(!sc.includes(PK), 'the cookie must not contain the key itself');
      assert.strictEqual((await app.call('GET', '/api/state')).status, 200);
      assert.strictEqual((await app.call('GET', '/')).status, 200);
    });
    await test('the key form on the locked page works, and a wrong key does not', async () => {
      const bad = await fetch(app.base() + '/unlock', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'key=wrong', redirect: 'manual' });
      assert.strictEqual(bad.status, 401);
      const good = await fetch(app.base() + '/unlock', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'key=' + PK, redirect: 'manual' });
      assert.strictEqual(good.status, 303);
      assert.ok(good.headers.get('set-cookie'));
    });
    await test('Luna and AJ keys are separate: neither opens the other’s doors', async () => {
      assert.strictEqual((await app.call('GET', '/api/outbox')).status, 401);                  /* AJ cookie on a Luna route */
      assert.strictEqual((await app.call('GET', '/api/outbox', { as: 'luna', key: 'x'.repeat(20) })).status, 401);
      assert.strictEqual((await app.call('GET', '/api/outbox', { as: 'luna', key: PK })).status, 401);   /* AJ's key as Luna's */
      assert.strictEqual((await app.call('GET', '/api/outbox', { as: 'luna' })).status, 200);
      assert.strictEqual((await app.call('GET', '/api/state', { as: 'luna' })).status, 401);   /* Luna key on an AJ route */
    });
    await test('a request from another site cannot act with AJ’s cookie', async () => {
      const r = await app.call('POST', '/api/quests/h-days/complete', { body: {}, headers: { origin: 'https://evil.example' } });
      assert.strictEqual(r.status, 403);
      assert.strictEqual((await app.state()).hero.xp, 0);
    });
    await test('many wrong Luna keys get a pause instead of a free guessing game', async () => {
      let last = 0;
      for (let i = 0; i < 35; i++) last = (await app.call('GET', '/api/outbox', { as: 'luna', key: 'wrong-key-' + i + '-xxxxxxxxxx' })).status;
      assert.strictEqual(last, 429);
    });
    await app.stop();

    await test('with no keys set, nothing opens (it fails closed)', async () => {
      const a = await boot({ noKeys: true });
      assert.strictEqual((await a.call('GET', '/', { as: 'none' })).status, 503);
      assert.strictEqual((await a.call('GET', '/api/state', { as: 'none' })).status, 401);
      assert.strictEqual((await a.call('GET', '/api/outbox', { as: 'luna' })).status, 503);
      await a.stop();
    });
    await test('keys that are too short or the same are refused at startup', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
      await assert.rejects(() => start({ port: 0, dataDir: dir, portalKey: 'short', lunaKey: LK, quiet: true }), /at least 16/);
      await assert.rejects(() => start({ port: 0, dataDir: dir, portalKey: PK, lunaKey: PK, quiet: true }), /different/);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  console.log('\nthe game');
  {
    const app = await boot();
    await test('the seed carries the real Oura numbers, keyed content, and a $61 total', async () => {
      const s = await app.state();
      assert.deepStrictEqual([s.oura.sleep, s.oura.readiness, s.oura.asOf], [67, 66, 'Night of Nov 2-3']);
      assert.strictEqual(s.today.dateLabel, 'Tuesday, November 3');
      assert.strictEqual(s.usage.totalLabel, 'about $61 a month');
      assert.strictEqual(s.hero.level, 1);
      const c = (await app.luna('GET', '/api/luna/content')).json.content;
      assert.ok(!Array.isArray(c.quests) && c.quests['m-phone'] && c.quests['m-phone'].owner === 'AJ');
      assert.ok(!Array.isArray(c.party) && c.party.Claude);
    });
    await test('only Health starts open; the rest show how to open them', async () => {
      const s = await app.state();
      assert.deepStrictEqual(s.lands.filter((l) => l.open).map((l) => l.id), ['health']);
      assert.ok(/Clear 2 more quests in Health/.test(landOf(s, 'school').lockMessage));
      assert.ok(!landOf(s, 'school').quests, 'a locked land does not show its quests');
    });
    await test('party quests cannot be completed by AJ, unknown ids are 404', async () => {
      const r = await app.done('l-step1');
      assert.strictEqual(r.status, 403);
      assert.ok(/belongs to Claude/.test(r.json.error));
      assert.strictEqual((await app.done('nope')).status, 404);
    });
    await test('an event that has not happened yet cannot be ticked', async () => {
      const r = await app.done('h-swim');
      assert.strictEqual(r.status, 409);
      assert.ok(/opens on Nov 6/.test(r.json.error));
    });
    await test('a quest in a locked land with no deadline stays locked', async () => {
      const r = await app.done('s-fix');
      assert.strictEqual(r.status, 403);
      assert.ok(/still locked/.test(r.json.error));
    });
    await test('a deadline inside a week is in the Today strip and can be done from a locked land', async () => {
      const s = await app.state();
      assert.deepStrictEqual(s.today.urgent.map((q) => q.id), ['m-phone']);
      assert.ok(s.today.urgent[0].canComplete);
      assert.strictEqual(s.today.urgent[0].leftLabel, '5 days left');
      assert.ok(!s.today.urgent.some((q) => q.id === 'm-license'), 'Nov 27 is not inside a week');
      const r = await app.done('m-phone');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.awarded.xp, 20);
      const s2 = r.json.state;
      assert.strictEqual(landOf(s2, 'money').cleared, 1, 'it counts toward its own land');
      assert.ok(!landOf(s2, 'money').open, 'but it does not open the land');
    });
    await test('XP is whatever Luna set: a number in the request is ignored, and a second tap pays nothing', async () => {
      const r = await app.done('h-days', { xp: 9999 });
      assert.strictEqual(r.json.awarded.xp, 10);
      const again = await app.done('h-days');
      assert.strictEqual(again.status, 200);
      assert.strictEqual(again.json.alreadyDone, true);
      assert.strictEqual(again.json.state.hero.xp, 30);
    });
    await test('level n needs 30 + 10n XP: 40 gets level 2, 90 gets level 3', async () => {
      assert.deepStrictEqual([G.levelFor(39).level, G.levelFor(40).level, G.levelFor(89).level, G.levelFor(90).level, G.levelFor(150).level], [1, 2, 2, 3, 4]);
      const r = await app.done('h-alarm');                 /* 30 + 10 = 40 */
      assert.strictEqual(r.json.awarded.levelFrom, 1);
      assert.strictEqual(r.json.awarded.levelTo, 2);
      assert.strictEqual(r.json.state.hero.level, 2);
      assert.strictEqual(r.json.state.hero.need, 50);
    });
    await test('two Health quests open School and Track and Personal together (a branch, not a chain)', async () => {
      const s = await app.state();
      assert.deepStrictEqual(s.lands.filter((l) => l.open).map((l) => l.id).sort(), ['health', 'personal', 'school']);
      assert.ok(!landOf(s, 'lab').open && !landOf(s, 'money').open);
    });
    await test('The Lab opens after two School quests; Money and Admin opens after one Lab quest', async () => {
      assert.strictEqual((await app.done('s-fix')).status, 200);
      const r = await app.done('s-roster');
      assert.deepStrictEqual(r.json.awarded.unlocked.map((l) => l.id), ['lab']);
      const r2 = await app.done('l-render');
      assert.deepStrictEqual(r2.json.awarded.unlocked.map((l) => l.id), ['money']);
    });
    await test('unlocks are permanent: undoing the quest that opened a land does not close it', async () => {
      const r = await app.call('POST', '/api/quests/l-render/undo', { body: {} });
      assert.strictEqual(r.status, 200);
      assert.ok(landOf(r.json.state, 'money').open);
    });
    await test('Money and Admin also opens through Personal (the other branch)', async () => {
      const b = await boot({ day: '2026-11-05' });
      await b.done('h-days'); await b.done('h-alarm');
      const r = await b.done('p-kairos');
      assert.deepStrictEqual(r.json.awarded.unlocked.map((l) => l.id), ['money']);
      await b.stop();
    });
    await test('a party quest marked Done by Luna counts toward unlocking, and unblocks what waited on AJ', async () => {
      const b = await boot();
      await b.luna('PUT', '/api/lands', { lab: { unlock: null } });          /* open the Lab for this check */
      let s = await b.state();
      assert.strictEqual(find(s, 'l-checkout').label, 'Blocked');
      assert.strictEqual(landOf(s, 'lab').cleared, 0);
      await b.done('l-render');
      s = await b.state();
      assert.strictEqual(find(s, 'l-checkout').label, 'Ready', 'it was waiting on AJ\u2019s paste');
      assert.strictEqual(landOf(s, 'lab').cleared, 1);
      await b.luna('PUT', '/api/quests/l-step1', { status: 'Done' });
      s = await b.state();
      assert.strictEqual(landOf(s, 'lab').cleared, 2, 'a party quest marked Done counts');
      await b.stop();
    });
    await app.stop();
  }

  console.log('\ndaily habits, the dial, and bonuses');
  {
    await test('daily habits pay once a day, again the next day, and stay out of the unlock math', async () => {
      const app = await boot();
      const a = await app.done('h-fit');
      assert.strictEqual(a.json.awarded.xp, 5);
      assert.strictEqual((await app.done('h-fit')).json.alreadyDone, true);
      assert.strictEqual((await app.state()).hero.xp, 5);
      await app.done('h-sleep');
      const s = await app.state();
      assert.ok(!landOf(s, 'school').open, 'two dailies do not open School and Track');
      assert.strictEqual(s.hero.questsTotal, 17, 'dailies are not counted as quests to clear');
      assert.strictEqual(landOf(s, 'health').total, 3);
      app.clock.t = noon('2026-11-04');
      assert.strictEqual((await app.done('h-fit')).json.awarded.xp, 5);
      assert.strictEqual((await app.state()).hero.xp, 15);
      await app.stop();
    });
    await test('five days of habits in a week earns +20 on Sunday, once; the best week is kept and nothing resets', async () => {
      const app = await boot({ day: '2026-11-02' });                       /* Monday */
      const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
      for (const d of days) { app.clock.t = noon(d); assert.strictEqual((await app.done('h-fit')).status, 200); }
      let s = await app.state();
      assert.strictEqual(s.hero.dial.count, 5);
      assert.strictEqual(s.hero.xp, 25, 'no bonus before Sunday');
      assert.ok(/lands on Sunday/.test(s.hero.dial.label));
      app.clock.t = noon('2026-11-07');                                   /* Saturday */
      assert.strictEqual((await app.state()).hero.xp, 25);
      app.clock.t = noon('2026-11-08');                                   /* Sunday */
      s = await app.state();
      assert.strictEqual(s.hero.xp, 45);
      assert.ok(s.hero.dial.paid);
      assert.strictEqual((await app.state()).hero.xp, 45, 'it never pays twice');
      app.clock.t = noon('2026-11-09');                                   /* next Monday */
      s = await app.state();
      assert.strictEqual(s.hero.dial.count, 0);
      assert.strictEqual(s.hero.dial.best, 5, 'the best week stays');
      assert.strictEqual(s.hero.xp, 45, 'nothing was taken back');
      await app.stop();
    });
    await test('a bonus week still pays if AJ only opens the portal on Monday', async () => {
      const app = await boot({ day: '2026-11-02' });
      for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) { app.clock.t = noon(d); await app.done('h-fit'); }
      app.clock.t = noon('2026-11-09');
      assert.strictEqual((await app.state()).hero.xp, 45);
      await app.stop();
    });
    await test('four days is not enough, and a missed day costs nothing', async () => {
      const app = await boot({ day: '2026-11-02' });
      for (const d of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06']) { app.clock.t = noon(d); await app.done('h-fit'); }
      app.clock.t = noon('2026-11-08');
      const s = await app.state();
      assert.strictEqual(s.hero.xp, 20);
      assert.ok(!s.hero.dial.paid);
      await app.stop();
    });
    await test('Luna’s pick earns +5 once, only for today’s pick, and undo takes it back', async () => {
      const app = await boot();
      assert.strictEqual((await app.luna('PUT', '/api/briefing', { focus: 'h-days' })).status, 200);
      const r = await app.done('h-days');
      assert.deepStrictEqual(r.json.awarded.bonuses, [{ kind: 'first', xp: 5 }]);
      assert.strictEqual(r.json.state.hero.xp, 15);
      const u = await app.call('POST', '/api/quests/h-days/undo', { body: {} });
      assert.strictEqual(u.json.state.hero.xp, 0);
      const again = await app.done('h-days');
      assert.strictEqual(again.json.state.hero.xp, 15, 'redo earns it once, not twice');
      const other = await app.done('h-alarm');
      assert.deepStrictEqual(other.json.awarded.bonuses, [], 'a different quest earns no bonus');
      await app.stop();
    });
    await test('yesterday’s pick earns nothing today', async () => {
      const app = await boot();
      await app.luna('PUT', '/api/briefing', { focus: 'h-days' });
      app.clock.t = noon('2026-11-04');
      const s = await app.state();
      assert.strictEqual(s.briefing.focus, null);
      const r = await app.done('h-days');
      assert.deepStrictEqual(r.json.awarded.bonuses, []);
      await app.stop();
    });
    await test('only today’s ticks can be undone', async () => {
      const app = await boot();
      await app.done('h-days');
      app.clock.t = noon('2026-11-04');
      const r = await app.call('POST', '/api/quests/h-days/undo', { body: {} });
      assert.strictEqual(r.status, 409);
      assert.ok(!find(await app.state(), 'h-days').canUndo);
      await app.stop();
    });
    await test('an event happening today is in the Today strip and can be ticked even in a locked land', async () => {
      const app = await boot({ day: '2026-11-07' });
      const s = await app.state();
      assert.ok(s.today.urgent.some((q) => q.id === 's-states' && q.canComplete));
      assert.strictEqual((await app.done('s-states')).status, 200);
      await app.stop();
    });
    await test('the suggested quest is Luna’s pick, else the next open one in the earliest open land', async () => {
      const app = await boot();
      let s = await app.state();
      assert.strictEqual(s.today.suggested.quest.id, 'h-days');
      assert.strictEqual(s.today.suggested.picked, false);
      await app.luna('PUT', '/api/briefing', { focus: 'h-alarm' });
      s = await app.state();
      assert.strictEqual(s.today.suggested.quest.id, 'h-alarm');
      assert.strictEqual(s.today.suggested.picked, true);
      await app.stop();
    });
    await test('the morning briefing: Luna’s pick, Soon within 3 days, one overnight line, dismissible for the day', async () => {
      const app = await boot();
      assert.strictEqual((await app.state()).briefing.focus, null, 'no pick yet');
      await app.luna('PUT', '/api/briefing', { focus: 'h-days', overnight: 'Claude built the hosted portal.' });
      let b = (await app.state()).briefing;
      assert.ok(b.show);
      assert.strictEqual(b.focus.id, 'h-days');
      assert.deepStrictEqual(b.soon.map((q) => q.id).sort(), ['h-swim', 'p-kairos', 'p-prayer']);
      assert.strictEqual(b.overnight.text, 'Claude built the hosted portal.');
      assert.strictEqual((await app.call('POST', '/api/briefing/dismiss', { body: {} })).status, 200);
      assert.strictEqual((await app.state()).briefing.show, false);
      app.clock.t = noon('2026-11-04');
      assert.strictEqual((await app.state()).briefing.show, true, 'it comes back the next day');
      app.clock.t = noon('2026-12-20');
      await app.luna('PUT', '/api/briefing', { overnight: null });
      assert.strictEqual((await app.state()).briefing.show, false, 'nothing to show means no screen');
      await app.stop();
    });
  }

  console.log('\nv3 map data');
  {
    const app = await boot();
    await test('each land reports its XP bar: one-off AJ quests only, earned as paid, total as set now', async () => {
      let s = await app.state();
      assert.deepStrictEqual(s.lands.map((l) => [l.id, l.xp, l.xpTotal]),
        [['health', 0, 35], ['school', 0, 115], ['personal', 0, 30], ['lab', 0, 20], ['money', 0, 75]]);
      await app.done('h-fit');                                               /* a daily */
      assert.strictEqual(landOf(await app.state(), 'health').xp, 0, 'dailies are not on the land bar');
      await app.done('h-days');
      assert.strictEqual(landOf(await app.state(), 'health').xp, 10);
      await app.luna('PUT', '/api/quests/h-days', { xp: 50 });
      s = await app.state();
      assert.strictEqual(landOf(s, 'health').xp, 10, 'paid XP stays as it was paid');
      assert.strictEqual(landOf(s, 'health').xpTotal, 75);
      await app.done('m-phone');                                             /* a deadline done from a locked land */
      s = await app.state();
      assert.ok(!landOf(s, 'money').open);
      assert.strictEqual(landOf(s, 'money').xp, 20);
    });
    await test('reopening a completed quest earns nothing, even after Luna raises its XP', async () => {
      const before = (await app.state()).hero.xp;
      const r = await app.done('h-days');
      assert.strictEqual(r.json.alreadyDone, true);
      assert.strictEqual(r.json.awarded.xp, 0);
      assert.strictEqual(r.json.state.hero.xp, before);
    });
    await test('lands list the lands that lead into them, so the map can draw its roads from data', async () => {
      const s = await app.state();
      assert.deepStrictEqual(s.lands.map((l) => [l.id, l.from]),
        [['health', []], ['school', ['health']], ['personal', ['health']], ['lab', ['school']], ['money', ['lab', 'personal']]]);
    });
    await app.stop();

    const b = await boot();
    await test('hero.next names the nearest shut land in plain words, and ends when all are open', async () => {
      let h = (await b.state()).hero;
      assert.strictEqual(h.next.text, 'Clear 2 more quests in Health to open School and Track.');
      assert.strictEqual(h.xpToNext, 40);
      await b.done('h-days');
      h = (await b.state()).hero;
      assert.strictEqual(h.next.text, 'Clear 1 more quest in Health to open School and Track.');
      assert.strictEqual(h.xpToNext, 30);
      await b.done('h-alarm');                                               /* School and Personal open */
      h = (await b.state()).hero;
      assert.strictEqual(h.next.text, 'Clear 1 more quest in Personal to open Money and Admin.', 'fewest quests to go wins');
      assert.strictEqual(h.level, 1);
      assert.strictEqual(h.xpToNext, 20, '20 of the 40 XP for level 2');
      await b.done('s-fix'); await b.done('s-roster'); await b.done('l-render');
      assert.strictEqual((await b.state()).hero.next, null);
    });
    await b.stop();
  }

  console.log('\nlive update stamps');
  {
    const app = await boot();
    const live = async () => (await app.state()).live;
    const later = () => { app.clock.t = new Date(app.clock.t.getTime() + 60000); };
    await test('AJ’s own ticks and messages never move the stamps', async () => {
      const a = await live();
      later(); await app.done('h-days');
      later(); await app.call('POST', '/api/outbox', { body: { text: 'Add this quest: call the dentist.' } });
      assert.deepStrictEqual(await live(), a);
    });
    await test('Luna’s content edit, overnight line and reply each move their own stamp', async () => {
      const a = await live();
      later(); await app.luna('PUT', '/api/oura', { sleep: 70 });
      const b = await live();
      assert.notStrictEqual(b.content, a.content);
      assert.strictEqual(b.overnight, a.overnight);
      later(); await app.luna('PUT', '/api/briefing', { overnight: 'Claude shipped the map.' });
      const c = await live();
      assert.ok(c.overnight && c.overnight !== a.overnight);
      assert.strictEqual(c.replies, null);
      later();
      const id = (await app.state()).outbox.messages[0].id;
      await app.luna('POST', '/api/outbox/' + id + '/status', { reply: 'Placed it in Personal.' });
      const d = await live();
      assert.notStrictEqual(d.replies, null, 'a reply from Luna sets the replies stamp');
    });
    await app.stop();
  }

  console.log('\nv3 wording and files');
  {
    const COPY = require('../public/copy.js');
    const text = fs.readFileSync(path.join(__dirname, '..', 'public', 'copy.js'), 'utf8');
    await test('the wording file has no invented land names or XP numbers, and Quick Add says it was sent to Luna', async () => {
      for (const bad of ['Training Grounds', 'Research Tower', '+75', 'Level 7', 'Level 5']) assert.ok(!text.includes(bad), 'found ' + bad);
      for (const land of ['Health', 'School and Track', 'Personal', 'The Lab', 'Money and Admin']) assert.ok(!text.includes(land), 'land names come from the server, not the wording file: ' + land);
      assert.ok(/Sent to Luna/.test(COPY.quickAdd.sent));
      assert.ok(!/added to the map|is on the map/i.test(COPY.quickAdd.sent));
    });
    await test('the approved lines are all there, word for word', async () => {
      assert.strictEqual(COPY.walking.length, 9); assert.strictEqual(COPY.arriving.length, 8);
      assert.strictEqual(COPY.idle.length, 6); assert.strictEqual(COPY.finished.length, 8);
      assert.ok(COPY.walking.includes('One thing at a time.') && COPY.arriving.includes('Your call.') && COPY.idle.includes('Just say the word.') && COPY.finished.includes('Another one down.'));
      assert.strictEqual(COPY.levelUp.title(4), 'Level 4 reached');
      assert.strictEqual(COPY.unlock.title('The Lab'), 'New land unlocked: The Lab');
      assert.strictEqual(COPY.unlock.noQuests, 'You can now add quests here.');
      assert.strictEqual(COPY.toast.many(3), '3 new updates');
      assert.strictEqual(COPY.error.save, 'Couldn’t save. Try again.');
      assert.strictEqual(COPY.quickAdd.message('Call the dentist', 'Personal', 'Tomorrow'), 'Add this quest: Call the dentist. Where: Personal. When: Tomorrow.');
    });
    await test('say() never gives the same line twice in a row', async () => {
      for (const kind of ['walking', 'arriving', 'idle', 'finished', 'levelLines']) {
        let prev = null;
        for (let i = 0; i < 300; i++) { const l = COPY.say(kind); assert.notStrictEqual(l, prev, kind); prev = l; }
      }
    });
    await test('the wording and map scripts are served to AJ’s cookie and not to strangers', async () => {
      const app = await boot();
      for (const f of ['/copy.js', '/world.js']) {
        assert.strictEqual((await app.call('GET', f)).status, 200, f);
        assert.strictEqual((await app.call('GET', f, { as: 'none' })).status, 401, f);
      }
      assert.ok(/window/.test((await app.call('GET', '/copy.js')).text));
      await app.stop();
    });
    await test('the map script has no inline style attributes (the page policy blocks them) and no invented land names', async () => {
      const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'world.js'), 'utf8');
      assert.ok(!/setAttribute\(\s*['"]style['"]/.test(w), 'setAttribute style');
      assert.ok(!/style=\\?["']/.test(w), 'style= in markup');
      assert.ok(!/\.innerHTML\s*=\s*[^'"\s;]/.test(w.replace(/\.innerHTML\s*=\s*['"]{2}/g, '')), 'innerHTML only ever cleared, never filled with data');
      for (const bad of ['Training Grounds', 'Research Tower', '+75']) assert.ok(!w.includes(bad), bad);
    });
  }

  console.log('\nprogress stays separate from content');
  {
    const app = await boot();
    await test('Luna’s edits never touch AJ’s ticks, even when she changes or removes the quest', async () => {
      await app.done('h-days');
      const file = () => JSON.parse(fs.readFileSync(path.join(app.dir, 'portal.json'), 'utf8'));
      const before = JSON.stringify(file().progress);
      assert.ok(file().content && file().progress && Array.isArray(file().outbox), 'three separate sections');
      await app.luna('PUT', '/api/quests/h-days', { xp: 50, title: 'Pick the fitness days' });
      await app.luna('PUT', '/api/oura', { sleep: 80 });
      assert.strictEqual(JSON.stringify(file().progress), before, 'progress is byte for byte the same');
      assert.strictEqual((await app.state()).hero.xp, 10, 'paid XP stays as it was');
      await app.luna('DELETE', '/api/quests/h-days');
      assert.strictEqual(JSON.stringify(file().progress), before);
      assert.strictEqual((await app.state()).hero.xp, 10);
      const p = (await app.luna('GET', '/api/luna/progress')).json;
      assert.ok(p.completions['h-days']);
    });
    await app.stop();
  }

  console.log('\ntalk to the party');
  {
    const app = await boot();
    let id;
    await test('a message is saved as new, shows in the thread at once, and has the exact first label', async () => {
      const r = await app.call('POST', '/api/outbox', { body: { text: '  Please ask Char about the flyer.  ', clientId: 'client-id-0001' } });
      assert.strictEqual(r.status, 201);
      id = r.json.message.id;
      assert.strictEqual(r.json.message.status, 'new');
      assert.strictEqual(r.json.message.label, 'Saved. Luna has not opened it yet.');
      const s = await app.state();
      assert.strictEqual(s.outbox.messages.length, 1);
      assert.strictEqual(s.outbox.messages[0].text, 'Please ask Char about the flyer.');
      assert.ok(s.outbox.messages[0].at && s.outbox.messages[0].canWithdraw);
    });
    await test('sending the same message twice (a retry) saves it once', async () => {
      const r = await app.call('POST', '/api/outbox', { body: { text: 'Please ask Char about the flyer.', clientId: 'client-id-0001' } });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.duplicate, true);
      assert.strictEqual((await app.state()).outbox.messages.length, 1);
    });
    await test('empty, huge and malformed messages are refused', async () => {
      assert.strictEqual((await app.call('POST', '/api/outbox', { body: { text: '   ' } })).status, 400);
      assert.strictEqual((await app.call('POST', '/api/outbox', { body: { text: 'x'.repeat(2001) } })).status, 400);
      assert.strictEqual((await app.call('POST', '/api/outbox', { body: { text: 'ok', clientId: 'bad id!' } })).status, 400);
    });
    await test('Luna reads with a status filter, and reading changes nothing', async () => {
      const r = await app.luna('GET', '/api/outbox?status=new');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json.messages.map((m) => m.id), [id]);
      assert.strictEqual((await app.luna('GET', '/api/outbox?status=done')).json.messages.length, 0);
      assert.strictEqual((await app.luna('GET', '/api/outbox?status=bogus')).status, 400);
      assert.strictEqual((await app.state()).outbox.messages[0].status, 'new', 'still new until Luna sets it');
    });
    await test('the labels move only when Luna or the owner sets them, in AJ’s words', async () => {
      const set = (b) => app.luna('POST', '/api/outbox/' + id + '/status', b);
      const label = async () => (await app.state()).outbox.messages[0].label;
      assert.strictEqual((await set({ status: 'picked_up' })).status, 200);
      assert.strictEqual(await label(), 'With Luna');
      assert.strictEqual((await set({ status: 'routed' })).status, 400, 'routing needs a name');
      await set({ status: 'routed', routedTo: 'Char' });
      assert.strictEqual(await label(), 'Sent to Char');
      await set({ status: 'working', by: 'Char' });
      assert.strictEqual(await label(), 'Char is on it');
      await set({ status: 'waiting', by: 'Char', reply: 'Which size flyer do you want?' });
      assert.strictEqual(await label(), 'Waiting on you');
      await set({ status: 'done', by: 'Char', reply: 'Flyer is final.' });
      const m = (await app.state()).outbox.messages[0];
      assert.strictEqual(m.label, 'Done');
      assert.deepStrictEqual(m.replies.map((r) => r.from + ': ' + r.text), ['Char: Which size flyer do you want?', 'Char: Flyer is final.']);
    });
    await test('Luna’s update rules: AJ cannot set statuses, and bad input is refused', async () => {
      const url = '/api/outbox/' + id + '/status';
      assert.strictEqual((await app.call('POST', url, { body: { status: 'done' } })).status, 401);
      assert.strictEqual((await app.luna('POST', url, { status: 'finished' })).status, 400);
      assert.strictEqual((await app.luna('POST', url, { status: 'done', by: 'Nobody' })).status, 400);
      assert.strictEqual((await app.luna('POST', url, { status: 'done', extra: 1 })).status, 400);
      assert.strictEqual((await app.luna('POST', url, {})).status, 400);
      assert.strictEqual((await app.luna('POST', '/api/outbox/ffffffff/status', { status: 'done' })).status, 404);
    });
    await test('replies show as unread on the Talk tab until AJ opens it', async () => {
      assert.strictEqual((await app.state()).outbox.unread, 1);
      await app.call('POST', '/api/outbox/seen', { body: {} });
      assert.strictEqual((await app.state()).outbox.unread, 0);
      app.clock.t = new Date(app.clock.t.getTime() + 60000);
      await app.luna('POST', '/api/outbox/' + id + '/status', { reply: 'One more thing.' });
      assert.strictEqual((await app.state()).outbox.unread, 1);
    });
    await test('AJ can withdraw a message only while it is still new', async () => {
      const a = (await app.call('POST', '/api/outbox', { body: { text: 'Never mind this one.' } })).json.message.id;
      const b = (await app.call('POST', '/api/outbox', { body: { text: 'Keep this one.' } })).json.message.id;
      assert.strictEqual((await app.call('POST', '/api/outbox/' + a + '/withdraw', { body: {} })).status, 200);
      await app.luna('POST', '/api/outbox/' + b + '/status', { status: 'picked_up' });
      const late = await app.call('POST', '/api/outbox/' + b + '/withdraw', { body: {} });
      assert.strictEqual(late.status, 409);
      assert.strictEqual((await app.luna('POST', '/api/outbox/' + a + '/status', { status: 'done' })).status, 409);
      const labels = (await app.state()).outbox.messages.map((m) => m.label);
      assert.ok(labels.includes('Withdrawn') && labels.includes('With Luna'));
      assert.strictEqual((await app.luna('GET', '/api/outbox?status=new')).json.messages.length, 0, 'a withdrawn message is not waiting for Luna');
    });
    await app.stop();
  }

  console.log('\nLuna keeps it current');
  {
    const app = await boot();
    await test('new Oura numbers show up in the state, and bad ones are refused', async () => {
      const r = await app.luna('PUT', '/api/oura', { asOf: 'Night of Nov 3-4', sleep: 81, readiness: 77 });
      assert.strictEqual(r.status, 200);
      const s = await app.state();
      assert.deepStrictEqual([s.oura.sleep, s.oura.readiness, s.today.oura.asOf], [81, 77, 'Night of Nov 3-4']);
      assert.strictEqual(s.updatedAt, r.json.updatedAt);
      assert.strictEqual((await app.luna('PUT', '/api/oura', { sleep: 101 })).status, 400);
      assert.strictEqual((await app.luna('PUT', '/api/oura', { sleeep: 80 })).status, 400);
      assert.strictEqual((await app.luna('PUT', '/api/oura', {})).status, 400);
      assert.strictEqual((await app.state()).oura.sleep, 81);
    });
    await test('usage updates merge by service, and the total follows', async () => {
      assert.strictEqual((await app.luna('PUT', '/api/usage', { snapshot: 'Wed Nov 4, 2026', services: { luna: { weekly: { usedPct: 84, resets: 'Nov 5, 10:42 AM EST' } } } })).status, 200);
      let s = await app.state();
      assert.strictEqual(s.usage.snapshot, 'Wed Nov 4, 2026');
      assert.strictEqual(s.usage.services.find((x) => x.id === 'luna').weekly.usedPct, 84);
      assert.strictEqual(s.usage.services.find((x) => x.id === 'luna').price, 20, 'untouched fields stay');
      await app.luna('PUT', '/api/usage', { services: { notion: { name: 'Notion', plan: 'Plus', price: 10 } } });
      s = await app.state();
      assert.strictEqual(s.usage.totalLabel, 'about $71 a month');
      assert.strictEqual((await app.luna('PUT', '/api/usage', { services: { luna: { price: 'free' } } })).status, 400);
    });
    await test('party updates merge by name, with a plain error for a bad sprite', async () => {
      assert.strictEqual((await app.luna('PUT', '/api/party', { Char: { job: 'Finishing the copy pack.', status: 'Busy', state: 'waiting' } })).status, 200);
      const p = (await app.state()).party.find((x) => x.name === 'Char');
      assert.deepStrictEqual([p.job, p.status, p.state, p.role], ['Finishing the copy pack.', 'Busy', 'waiting', 'Words, ideas, planning']);
      const bad = await app.luna('PUT', '/api/party', { Char: { sprite: 'dragon' } });
      assert.strictEqual(bad.status, 400);
      assert.ok(/sprite must be one of/.test(bad.json.error));
    });
    await test('quests: add, change one field, and remove, by id', async () => {
      assert.strictEqual((await app.luna('PUT', '/api/quests/s-bus', { land: 'school', title: 'Confirm the team bus', owner: 'AJ', xp: 15, due: '2026-11-20', dueLabel: 'Nov 20' })).status, 200);
      await app.done('h-days'); await app.done('h-alarm');
      let s = await app.state();
      const q = find(s, 's-bus');
      assert.deepStrictEqual([q.title, q.xp, q.daysLeft], ['Confirm the team bus', 15, 17]);
      await app.luna('PUT', '/api/quests/s-bus', { xp: 25 });
      assert.strictEqual(find(await app.state(), 's-bus').xp, 25);
      assert.strictEqual((await app.luna('DELETE', '/api/quests/s-bus')).status, 200);
      assert.strictEqual(find(await app.state(), 's-bus'), null);
      assert.strictEqual((await app.luna('DELETE', '/api/quests/s-bus')).status, 404);
    });
    await test('a bad quest in a batch means none of the batch is applied', async () => {
      const r = await app.luna('PUT', '/api/quests', { 'good-one': { land: 'lab', title: 'Fine', owner: 'Char' }, 'bad-one': { land: 'nowhere', title: 'Broken', owner: 'AJ' } });
      assert.strictEqual(r.status, 400);
      const c = (await app.luna('GET', '/api/luna/content')).json.content;
      assert.ok(!c.quests['good-one'] && !c.quests['bad-one']);
    });
    await test('quest rules: AJ quests carry XP and no status, party quests the reverse, no wait loops', async () => {
      const put = (id, b) => app.luna('PUT', '/api/quests/' + id, b);
      assert.strictEqual((await put('x-1', { land: 'lab', title: 'T', owner: 'AJ', status: 'Done' })).status, 400);
      assert.strictEqual((await put('x-2', { land: 'lab', title: 'T', owner: 'Claude', xp: 10 })).status, 400);
      assert.strictEqual((await put('x-3', { land: 'lab', title: 'T', owner: 'AJ', xp: 500 })).status, 400);
      assert.strictEqual((await put('x-4', { land: 'lab', title: 'T', owner: 'AJ', date: '2026-02-31' })).status, 400);
      assert.strictEqual((await put('X_5', { land: 'lab', title: 'T', owner: 'AJ' })).status, 404, 'unsafe ids never reach a handler');
      assert.strictEqual((await app.luna('PUT', '/api/quests', { 'a-1': { land: 'lab', title: 'A', owner: 'Char', needs: 'a-2' }, 'a-2': { land: 'lab', title: 'B', owner: 'Char', needs: 'a-1' } })).status, 400);
      assert.strictEqual((await put('x-6', { land: 'lab', title: 'T', owner: 'AJ', __proto__: { a: 1 }, polluted: 1 })).status, 400);
    });
    await test('land rules: a loop in the unlock chain is refused', async () => {
      const r = await app.luna('PUT', '/api/lands', { health: { unlock: { anyOf: [{ land: 'money', need: 1 }] } } });
      assert.strictEqual(r.status, 400);
      assert.ok(/loop/.test(r.json.error));
    });
    await test('briefing: only an AJ quest can be the pick, and overnight is one line of text', async () => {
      assert.strictEqual((await app.luna('PUT', '/api/briefing', { focus: 'l-step1' })).status, 400);
      assert.strictEqual((await app.luna('PUT', '/api/briefing', { focus: 'nope' })).status, 400);
      assert.strictEqual((await app.luna('PUT', '/api/briefing', { overnight: 'Char drafted the copy pack.' })).status, 200);
    });
    await app.stop();
  }

  console.log('\nstorage');
  {
    await test('progress, messages and Luna’s edits survive a restart', async () => {
      const app = await boot();
      await app.done('h-days'); await app.done('h-alarm');
      await app.call('POST', '/api/outbox', { body: { text: 'Still here after a restart?' } });
      await app.luna('PUT', '/api/oura', { sleep: 90 });
      const before = await app.state();
      await app.restart();
      await app.signIn();
      const after = await app.state();
      assert.deepStrictEqual([after.hero.xp, after.hero.level, after.lands.filter((l) => l.open).length], [before.hero.xp, before.hero.level, before.lands.filter((l) => l.open).length]);
      assert.strictEqual(after.outbox.messages.length, 1);
      assert.strictEqual(after.oura.sleep, 90);
      await app.stop();
    });
    await test('the same cookie works from a second device with no shared memory', async () => {
      const app = await boot();
      await app.done('h-days');
      const other = await fetch(app.base() + '/api/state', { headers: { cookie: app.cookie } });
      assert.strictEqual((await other.json()).hero.xp, 10);
      await app.stop();
    });
    await test('a failed save changes nothing and says so; after it clears, saving works again', async () => {
      const app = await boot();
      const tmp = path.join(app.dir, 'portal.json.tmp');
      fs.mkdirSync(tmp);
      const r = await app.done('h-days');
      assert.strictEqual(r.status, 500);
      assert.ok(/Nothing was changed/.test(r.json.error));
      assert.strictEqual((await app.state()).hero.xp, 0, 'rolled back in memory');
      fs.rmdirSync(tmp);
      assert.strictEqual((await app.done('h-days')).status, 200);
      assert.ok(fs.existsSync(path.join(app.dir, 'portal.json.bak')), 'the previous copy is kept');
      await app.stop();
    });
    await test('a leftover temp file from a crash does not stop the server, and a corrupt file is never overwritten', async () => {
      const app = await boot();
      await app.done('h-days');
      await app.srv.close();
      fs.writeFileSync(path.join(app.dir, 'portal.json.tmp'), '{ half a write');
      app.srv = await start({ port: 0, host: '127.0.0.1', dataDir: app.dir, portalKey: PK, lunaKey: LK, quiet: true, now: () => app.clock.t });
      await app.srv.close();
      fs.writeFileSync(path.join(app.dir, 'portal.json'), '{ not json');
      await assert.rejects(() => start({ port: 0, dataDir: app.dir, portalKey: PK, lunaKey: LK, quiet: true }), /cannot be read/);
      assert.strictEqual(fs.readFileSync(path.join(app.dir, 'portal.json'), 'utf8'), '{ not json', 'left exactly as found');
      fs.rmSync(app.dir, { recursive: true, force: true });
    });
    await test('the real server.js boots from the environment, serves the app, and keeps state across a process restart', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-proc-'));
      const port = 38000 + Math.floor(Math.random() * 1000);
      const run = () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir, PORTAL_KEY: PK, LUNA_KEY: LK }), stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (d) => { out += d; if (out.includes('running on port')) resolve(child); });
        child.stderr.on('data', (d) => { out += d; });
        child.on('exit', () => reject(new Error('server exited: ' + out)));
      });
      const stop = (c) => new Promise((r) => { c.removeAllListeners('exit'); c.once('exit', r); c.kill(); });
      let child = await run();
      const base = 'http://127.0.0.1:' + port;
      const link = await fetch(base + '/?key=' + PK, { redirect: 'manual' });
      const cookie = link.headers.get('set-cookie').split(';')[0];
      const html = await (await fetch(base + '/', { headers: { cookie } })).text();
      assert.ok(/AJ Command Portal/.test(html) && /app\.js/.test(html));
      const js = await fetch(base + '/app.js', { headers: { cookie } });
      assert.strictEqual(js.status, 200);
      const done = await fetch(base + '/api/quests/h-days/complete', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
      assert.strictEqual(done.status, 200);
      await fetch(base + '/api/outbox', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Across a restart.' }) });
      await stop(child);
      child = await run();
      const st = await (await fetch(base + '/api/state', { headers: { cookie } })).json();
      assert.strictEqual(st.hero.xp, 10);
      assert.strictEqual(st.outbox.messages[0].text, 'Across a restart.');
      await stop(child);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
