#!/usr/bin/env node
'use strict';
/*
 * Tests for coach email notifications (lib/notify.js) and the
 * Calendly booking page.
 *
 *   node tests/notify-tests.js
 *
 * Boots the real server with a local fake Resend (RESEND_API_BASE),
 * so no email is ever sent. Every key and address is a placeholder.
 */
const assert = require('assert');
const http = require('http');
const { makeRunner, startApp, api } = require('./harness');

function startFakeResend() {
  return new Promise((resolve) => {
    const fake = { seen: [], fail: 0, server: null, base: '' };
    fake.server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* bad json */ }
        fake.seen.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
        const status = fake.fail || 200;
        const out = JSON.stringify(status === 200 ? { id: 'email_' + fake.seen.length } : { message: 'simulated failure' });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(out);
      });
    });
    fake.server.listen(0, '127.0.0.1', () => {
      fake.base = 'http://127.0.0.1:' + fake.server.address().port;
      resolve(fake);
    });
  });
}

const waitFor = async (pred, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return pred();
};

(async () => {
  const t = makeRunner();
  const resend = await startFakeResend();
  const app = await startApp({
    RESEND_API_KEY: 're_test_not_real', NOTIFY_EMAIL: 'coach@example.test',
    RESEND_API_BASE: resend.base, DOMAIN: 'https://rp.example.test',
  });
  try {
    const owner = await api(app, 'POST', '/api/register', { email: 'owner@example.test', password: 'owner-pass-123' });

    await t.test('the first (owner) account sends no notification', async () => {
      assert.strictEqual(owner.status, 201);
      await new Promise((r) => setTimeout(r, 200));
      assert.strictEqual(resend.seen.length, 0);
    });

    await t.test('an invitation request emails the coach, reply-to the visitor', async () => {
      const r = await api(app, 'POST', '/api/invite-requests', {
        name: 'Pat Visitor', email: 'pat@example.test', goal: 'Run a faster 400', forWhom: 'self',
      });
      assert.strictEqual(r.status, 201);
      assert.ok(await waitFor(() => resend.seen.length === 1), 'no email sent');
      const m = resend.seen[0];
      assert.strictEqual(m.path, '/emails');
      assert.strictEqual(m.auth, 'Bearer re_test_not_real');
      assert.deepStrictEqual(m.body.to, ['coach@example.test']);
      assert.strictEqual(m.body.reply_to, 'pat@example.test');
      assert.ok(/invitation request from Pat Visitor/.test(m.body.subject), m.body.subject);
      assert.ok(m.body.text.includes('Goal: Run a faster 400'));
      assert.ok(m.body.text.includes('https://rp.example.test/'));
    });

    await t.test('a honeypot (bot) invitation request sends nothing', async () => {
      const before = resend.seen.length;
      const r = await api(app, 'POST', '/api/invite-requests', {
        name: 'Bot', email: 'bot@example.test', goal: 'x', website: 'http://spam',
      });
      assert.strictEqual(r.status, 201);
      await new Promise((res) => setTimeout(res, 200));
      assert.strictEqual(resend.seen.length, before);
    });

    await t.test('a refused (uninvited) sign-up emails the coach', async () => {
      const before = resend.seen.length;
      const r = await api(app, 'POST', '/api/register', { email: 'stranger@example.test', password: 'stranger-pass-1' });
      assert.strictEqual(r.status, 403);
      assert.ok(await waitFor(() => resend.seen.length === before + 1));
      assert.ok(/without an invitation: stranger@example\.test/.test(resend.seen[before].body.subject));
    });

    await t.test('an invited member creating an account emails the coach', async () => {
      await api(app, 'POST', '/api/client-invites', { email: 'member@example.test' }, owner.cookie);
      const before = resend.seen.length;
      const r = await api(app, 'POST', '/api/register', { email: 'member@example.test', password: 'member-pass-123' });
      assert.strictEqual(r.status, 201);
      assert.ok(await waitFor(() => resend.seen.length === before + 1));
      assert.ok(/New member account: member@example\.test/.test(resend.seen[before].body.subject));
    });

    await t.test('a Resend failure never fails the visitor\'s request', async () => {
      resend.fail = 500;
      const r = await api(app, 'POST', '/api/invite-requests', {
        name: 'Sam Visitor', email: 'sam@example.test', goal: 'Get stronger',
      });
      assert.strictEqual(r.status, 201);
      const logged = await waitFor(() => app.logs.join('').includes('[notify] Resend refused'));
      resend.fail = 0;
      assert.ok(logged, 'the failure should be logged');
      assert.ok(!app.logs.join('').includes('re_test_not_real'), 'the key must never be logged');
    });

    await t.test('the booking page embeds the Calendly 30-minute event', async () => {
      const js = await fetch(app.base + '/app.js').then((x) => x.text());
      assert.ok(js.includes("const CALENDLY_URL = 'https://calendly.com/alonzo-ruffinjr/30min'"));
      assert.ok(!js.includes('__CALENDLY_URL__'));
    });
  } finally {
    app.stop();
    resend.server.close();
  }

  // With no key the app runs exactly as before and says notifications are off.
  const quiet = await startApp({ RESEND_API_KEY: undefined, NOTIFY_EMAIL: undefined });
  try {
    await t.test('without RESEND_API_KEY nothing is sent and the request still succeeds', async () => {
      await api(quiet, 'POST', '/api/register', { email: 'owner@example.test', password: 'owner-pass-123' });
      const r = await api(quiet, 'POST', '/api/invite-requests', { name: 'Lee', email: 'lee@example.test', goal: 'Speed' });
      assert.strictEqual(r.status, 201);
      assert.ok(await waitFor(() => quiet.logs.join('').includes('Email notifications are off')));
    });
  } finally {
    quiet.stop();
  }

  console.log('\n' + t.passed + ' passed, ' + t.failed + ' failed');
  process.exit(t.failed ? 1 : 0);
})();
