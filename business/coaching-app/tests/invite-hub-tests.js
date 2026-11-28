#!/usr/bin/env node
'use strict';
/*
 * Invitation hub (Nov 28, 2026): the coach-only list of every
 * invitation request, with counts, every captured field, and Approve,
 * which puts the email on the member invite list (the existing invite
 * flow) so that person can create an account.
 *
 *   node tests/invite-hub-tests.js
 *
 * Real server, throwaway data folder, made-up people.
 */
const assert = require('assert');
const { makeRunner, startApp, api, seedAccounts } = require('./harness');

const r = makeRunner();

async function main() {
  const app = await startApp();
  try {
    const s = await seedAccounts(app, 'member@example.test');
    const oc = s.ownerCookie;
    const mc = s.memberCookie;

    const ask = (name, email, extra) => api(app, 'POST', '/api/invite-requests', Object.assign({
      name, email, forWhom: 'self', tierInterest: 'training', goal: 'Run a faster 100m.',
      grade: '11th grade', sport: 'Track', location: 'Silver Spring', heardFrom: undefined, consent: true,
    }, extra || {}));

    await r.test('three public requests are stored', async () => {
      assert.strictEqual((await ask('Pat One', 'pat1@example.test')).status, 201);
      assert.strictEqual((await ask('Sam Two', 'sam2@example.test', { tierInterest: 'team' })).status, 201);
      assert.strictEqual((await ask('Lee Three', 'lee3@example.test')).status, 201);
    });

    await r.test('signed out and member accounts cannot see the hub (401 / 403)', async () => {
      assert.strictEqual((await api(app, 'GET', '/api/invite-requests')).status, 401);
      assert.strictEqual((await api(app, 'GET', '/api/invite-requests', undefined, mc)).status, 403);
    });

    let list;
    await r.test('the coach sees every request with counts and every captured field', async () => {
      const res = await api(app, 'GET', '/api/invite-requests', undefined, oc);
      assert.strictEqual(res.status, 200);
      list = res.json.requests;
      assert.deepStrictEqual(res.json.counts, { total: 3, new: 3, invited: 0, declined: 0 });
      const pat = list.find(x => x.email === 'pat1@example.test');
      assert.strictEqual(pat.status, 'pending');
      assert.strictEqual(pat.grade, '11th grade');
      assert.strictEqual(pat.sport, 'Track');
      assert.strictEqual(pat.location, 'Silver Spring');
      assert.strictEqual(pat.goal, 'Run a faster 100m.');
      assert.ok(pat.createdAt);
      assert.strictEqual(list.find(x => x.email === 'sam2@example.test').tierInterest, 'team');
    });

    await r.test('a member cannot approve a request (403) and nothing changes', async () => {
      const pat = list.find(x => x.email === 'pat1@example.test');
      const res = await api(app, 'POST', '/api/invite-requests/' + pat.id + '/status', { status: 'invited' }, mc);
      assert.strictEqual(res.status, 403);
      const inv = await api(app, 'GET', '/api/client-invites', undefined, oc);
      assert.ok(!inv.json.invites.includes('pat1@example.test'));
    });

    await r.test('an assistant coach can see the hub but only the head coach approves', async () => {
      assert.strictEqual((await api(app, 'POST', '/api/coach-invites', { email: 'assistant@example.test' }, oc)).status, 200);
      const reg = await api(app, 'POST', '/api/register', { email: 'assistant@example.test', password: 'assistant-pass-123' });
      assert.ok(reg.status === 200 || reg.status === 201, JSON.stringify(reg.json));
      const ac = (await api(app, 'POST', '/api/login', { email: 'assistant@example.test', password: 'assistant-pass-123' })).cookie;
      assert.strictEqual((await api(app, 'GET', '/api/invite-requests', undefined, ac)).status, 200);
      const pat = list.find(x => x.email === 'pat1@example.test');
      const res = await api(app, 'POST', '/api/invite-requests/' + pat.id + '/status', { status: 'invited' }, ac);
      assert.strictEqual(res.status, 403);
      assert.ok(/head coach/.test(res.json.error));
    });

    await r.test('approve: the request becomes invited and the email joins the member invite list', async () => {
      const pat = list.find(x => x.email === 'pat1@example.test');
      const res = await api(app, 'POST', '/api/invite-requests/' + pat.id + '/status', { status: 'invited' }, oc);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.request.status, 'invited');
      const inv = await api(app, 'GET', '/api/client-invites', undefined, oc);
      assert.ok(inv.json.invites.includes('pat1@example.test'));
      const again = await api(app, 'GET', '/api/invite-requests', undefined, oc);
      assert.deepStrictEqual(again.json.counts, { total: 3, new: 2, invited: 1, declined: 0 });
    });

    await r.test('the approved person can now create their account (existing invite flow)', async () => {
      const reg = await api(app, 'POST', '/api/register', { email: 'pat1@example.test', password: 'pat-pass-12345' });
      assert.ok(reg.status === 200 || reg.status === 201, JSON.stringify(reg.json));
      assert.ok(app.userByEmail('pat1@example.test'));
    });

    await r.test('a request that was not approved still cannot create an account', async () => {
      const reg = await api(app, 'POST', '/api/register', { email: 'lee3@example.test', password: 'lee-pass-12345' });
      assert.ok(reg.status >= 400, JSON.stringify(reg.json));
    });

    await r.test('decline and back to new update the counts', async () => {
      const lee = list.find(x => x.email === 'lee3@example.test');
      assert.strictEqual((await api(app, 'POST', '/api/invite-requests/' + lee.id + '/status', { status: 'declined' }, oc)).status, 200);
      let c = (await api(app, 'GET', '/api/invite-requests', undefined, oc)).json.counts;
      assert.deepStrictEqual(c, { total: 3, new: 1, invited: 1, declined: 1 });
      assert.strictEqual((await api(app, 'POST', '/api/invite-requests/' + lee.id + '/status', { status: 'pending' }, oc)).status, 200);
      c = (await api(app, 'GET', '/api/invite-requests', undefined, oc)).json.counts;
      assert.deepStrictEqual(c, { total: 3, new: 2, invited: 1, declined: 0 });
    });

    await r.test('nothing about requests is on the public page', async () => {
      const page = (await api(app, 'GET', '/')).text;
      assert.ok(!page.includes('pat1@example.test') && !page.includes('Sam Two'));
    });
  } finally {
    app.stop();
  }
  console.log('\n' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
