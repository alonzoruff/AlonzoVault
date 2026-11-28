#!/usr/bin/env node
'use strict';
/*
 * Tests for the coach Filming Tracker (/api/filming).
 *
 *   node tests/filming-tests.js
 *
 * Boots the real server on a throwaway DATA_DIR, checks the 102
 * movements and their categories, the 90/90 Hip Rotations seed,
 * marking and notes, adding a movement, and that every change
 * survives a server restart. Accounts are made-up test accounts.
 */
const assert = require('assert');
const { makeRunner, startApp, api, seedAccounts } = require('./harness');

(async () => {
  const t = makeRunner();
  const app = await startApp();
  try {
    const { ownerCookie, memberCookie } = await seedAccounts(app, 'member@example.test');
    const find = (payload, id) => payload.categories
      .reduce((a, c) => a.concat(c.movements), []).find((m) => m.id === id);

    await t.test('the tracker is coach-only', async () => {
      assert.strictEqual((await api(app, 'GET', '/api/filming')).status, 401);
      assert.strictEqual((await api(app, 'GET', '/api/filming', undefined, memberCookie)).status, 403);
      assert.strictEqual((await api(app, 'PUT', '/api/filming/VID-001', { filmed: true }, memberCookie)).status, 403);
    });

    await t.test('all 102 movements, grouped Mobility 22 / Running 41 / Strengthening 39', async () => {
      const r = await api(app, 'GET', '/api/filming', undefined, ownerCookie);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.total, 102);
      assert.deepStrictEqual(r.json.categories.map((c) => [c.name, c.total]),
        [['Mobility', 22], ['Running', 41], ['Strengthening', 39]]);
      const ids = r.json.categories.reduce((a, c) => a.concat(c.movements.map((m) => m.id)), []);
      assert.strictEqual(new Set(ids).size, 102);
    });

    await t.test('90/90 Hip Rotations starts filmed, and nothing else does', async () => {
      const r = await api(app, 'GET', '/api/filming', undefined, ownerCookie);
      const hip = find(r.json, 'VID-076');
      assert.strictEqual(hip.movement, '90/90 Hip Rotations');
      assert.strictEqual(hip.category, 'Mobility');
      assert.strictEqual(hip.filmed, true);
      assert.ok(hip.note.includes('Nov 20'));
      assert.strictEqual(r.json.filmed, 1);
    });

    await t.test('marking filmed and writing a note save', async () => {
      let r = await api(app, 'PUT', '/api/filming/VID-001', { filmed: true }, ownerCookie);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.filmed, true);
      r = await api(app, 'PUT', '/api/filming/VID-001', { note: '  Take 2 is the keeper  ' }, ownerCookie);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.note, 'Take 2 is the keeper');
      assert.strictEqual(r.json.filmed, true, 'a note leaves the status alone');
      r = await api(app, 'GET', '/api/filming', undefined, ownerCookie);
      assert.strictEqual(r.json.filmed, 2);
      assert.strictEqual(find(r.json, 'VID-001').note, 'Take 2 is the keeper');
    });

    await t.test('bad updates are refused', async () => {
      assert.strictEqual((await api(app, 'PUT', '/api/filming/VID-999', { filmed: true }, ownerCookie)).status, 404);
      assert.strictEqual((await api(app, 'PUT', '/api/filming/VID-002', { filmed: 'yes' }, ownerCookie)).status, 400);
      assert.strictEqual((await api(app, 'PUT', '/api/filming/VID-002', {}, ownerCookie)).status, 400);
      assert.strictEqual((await api(app, 'PUT', '/api/filming/VID-002', { note: 'x'.repeat(501) }, ownerCookie)).status, 400);
    });

    await t.test('the coach can add a movement to a category', async () => {
      let r = await api(app, 'POST', '/api/filming', { movement: ' Banded  Ankle Mobilization ', category: 'Mobility' }, ownerCookie);
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.json.item.id, 'NEW-001');
      assert.strictEqual(r.json.item.movement, 'Banded Ankle Mobilization');
      assert.strictEqual((await api(app, 'POST', '/api/filming', { movement: 'banded ankle mobilization', category: 'Running' }, ownerCookie)).status, 409);
      assert.strictEqual((await api(app, 'POST', '/api/filming', { movement: 'A-skips', category: 'Running' }, ownerCookie)).status, 409);
      assert.strictEqual((await api(app, 'POST', '/api/filming', { movement: 'Sled Push', category: 'Speed' }, ownerCookie)).status, 400);
      assert.strictEqual((await api(app, 'POST', '/api/filming', { movement: '   ', category: 'Running' }, ownerCookie)).status, 400);
      r = await api(app, 'GET', '/api/filming', undefined, ownerCookie);
      assert.strictEqual(r.json.total, 103);
      const added = find(r.json, 'NEW-001');
      assert.strictEqual(added.custom, true);
      assert.strictEqual(added.filmed, false);
      assert.strictEqual(r.json.categories[0].total, 23);
    });

    await t.test('everything survives a restart, and the seed never comes back', async () => {
      assert.strictEqual((await api(app, 'PUT', '/api/filming/VID-076', { filmed: false }, ownerCookie)).status, 200);
      assert.strictEqual((await api(app, 'PUT', '/api/filming/NEW-001', { filmed: true, note: 'Shot at the gym' }, ownerCookie)).status, 200);
      await app.restart();
      const r = await api(app, 'GET', '/api/filming', undefined, ownerCookie);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(find(r.json, 'VID-001').filmed, true);
      assert.strictEqual(find(r.json, 'VID-001').note, 'Take 2 is the keeper');
      assert.strictEqual(find(r.json, 'VID-076').filmed, false, 'an unmarked seed stays unmarked');
      assert.strictEqual(find(r.json, 'NEW-001').filmed, true);
      assert.strictEqual(find(r.json, 'NEW-001').note, 'Shot at the gym');
      assert.strictEqual(r.json.total, 103);
    });

    await t.test('only added movements can be removed', async () => {
      assert.strictEqual((await api(app, 'DELETE', '/api/filming/VID-001', undefined, ownerCookie)).status, 400);
      assert.strictEqual((await api(app, 'DELETE', '/api/filming/NEW-404', undefined, ownerCookie)).status, 404);
      assert.strictEqual((await api(app, 'DELETE', '/api/filming/NEW-001', undefined, ownerCookie)).status, 200);
      const r = await api(app, 'GET', '/api/filming', undefined, ownerCookie);
      assert.strictEqual(r.json.total, 102);
      assert.strictEqual(app.db().filming['NEW-001'], undefined);
    });

    await t.test('the tracker rides along in the full backup', async () => {
      const r = await api(app, 'GET', '/api/export/backup', undefined, ownerCookie);
      assert.strictEqual(r.status, 200);
      const data = r.json.data || r.json;
      assert.strictEqual(data.filming['VID-001'].filmed, true);
      assert.ok(Array.isArray(data.filmingExtras));
    });

    await t.test('the page and script carry the Filming Tracker view', async () => {
      const page = await api(app, 'GET', '/');
      assert.ok(page.text.includes('id="view-filming"') && page.text.includes('data-view="filming"')
        && page.text.includes('id="filming-main"'));
      const js = await api(app, 'GET', '/app.js');
      assert.ok(js.text.includes('/api/filming') && js.text.includes('renderFilming'));
    });
  } finally {
    app.stop();
  }
  console.log('\n' + t.passed + ' passed, ' + t.failed + ' failed');
  process.exit(t.failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
