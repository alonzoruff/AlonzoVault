'use strict';
/*
 * Sprint Biomechanics reports (Nov 28): the tool page needs sign-in
 * and a plan, saved reports are stored against the member's account,
 * weekly allowance matches form reviews (Lab Training 7, Lab Pass 30),
 * key-frame pictures are never stored, members only see their own
 * reports, and coaches review them.
 * Run: node tests/sprint-analysis-tests.js
 */
const assert = require('assert');
const { makeRunner, startFakeStripe, startApp, api, seedAccounts } = require('./harness');

async function page(app, path, cookie) {
  const res = await fetch(app.base + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  return { status: res.status, text: await res.text(), location: res.headers.get('location') };
}

const sample = (name) => ({
  report: {
    athlete: { name, event: '60m' },
    steps: [{ step: 1, trunkLean: 45.2, shinAngle: 48 }, { step: 2, trunkLean: 50 }],
    faults: ['Heel recovery low'],
    keyframes: [{ label: 'Step 1 touchdown', image: 'data:image/png;base64,AAAA' }],
  },
});

async function main() {
  const r = makeRunner('sprint analysis');
  const fake = await startFakeStripe();
  const app = await startApp({
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_real',
    STRIPE_API_BASE: 'http://127.0.0.1:' + fake.port,
  });
  try {
    const s = await seedAccounts(app, 'member@example.test');
    const oc = s.ownerCookie;
    const mc = s.memberCookie;
    await api(app, 'POST', '/api/client-invites', { email: 'other@example.test' }, oc);
    const other = await api(app, 'POST', '/api/register', { email: 'other@example.test', password: 'member-pass-123' });
    let firstId = null;

    await r.test('the tool page asks a signed-out visitor to sign in', async () => {
      const res = await page(app, '/sprint-analysis');
      assert.strictEqual(res.status, 401);
      assert.ok(res.text.includes('Sign in first'));
    });
    await r.test('the raw .html path cannot skip the check', async () => {
      const res = await page(app, '/sprint-analysis.html');
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.location, '/sprint-analysis');
    });
    await r.test('a member with no plan is turned away from the page and the API', async () => {
      assert.strictEqual((await page(app, '/sprint-analysis', mc)).status, 403);
      const post = await api(app, 'POST', '/api/reports/sprint-analysis', sample('Test Runner'), mc);
      assert.strictEqual(post.status, 403);
      assert.strictEqual(post.json.needsTier, 'training');
      assert.strictEqual((await api(app, 'GET', '/api/my/sprint-analyses', undefined, mc)).status, 403);
    });
    await r.test('a signed-out request to save a report gets 401', async () => {
      assert.strictEqual((await api(app, 'POST', '/api/reports/sprint-analysis', sample('X'))).status, 401);
    });

    await api(app, 'PUT', '/api/access/' + s.memberId, { tier: 'training' }, oc);
    await api(app, 'PUT', '/api/access/' + other.json.id, { tier: 'training' }, oc);

    await r.test('a Lab Training member can open the page', async () => {
      assert.strictEqual((await page(app, '/sprint-analysis', mc)).status, 200);
    });
    await r.test('saving a report stores it against the account, without pictures', async () => {
      const res = await api(app, 'POST', '/api/reports/sprint-analysis', sample('Test Runner'), mc);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.report.athleteName, 'Test Runner');
      assert.strictEqual(res.json.weekCount, 1);
      assert.strictEqual(res.json.weekLimit, 7);
      firstId = res.json.report.id;
      const stored = app.db().sprintAnalyses.find((x) => x.id === firstId);
      assert.strictEqual(stored.userId, s.memberId);
      assert.strictEqual(stored.report.steps[0].trunkLean, 45.2);
      assert.ok(!JSON.stringify(stored).includes('data:image'), 'snapshot image was kept');
      assert.strictEqual(stored.report.keyframes[0].label, 'Step 1 touchdown');
    });
    await r.test('an empty report is refused', async () => {
      const res = await api(app, 'POST', '/api/reports/sprint-analysis', { report: {} }, mc);
      assert.strictEqual(res.status, 400);
    });
    await r.test('the member sees the report in their history, in full on request', async () => {
      const list = await api(app, 'GET', '/api/my/sprint-analyses', undefined, mc);
      assert.strictEqual(list.json.reports.length, 1);
      assert.strictEqual(list.json.reports[0].report, undefined);
      const one = await api(app, 'GET', '/api/my/sprint-analyses/' + firstId, undefined, mc);
      assert.strictEqual(one.json.report.report.athlete.name, 'Test Runner');
    });
    await r.test('another member cannot read it', async () => {
      const res = await api(app, 'GET', '/api/my/sprint-analyses/' + firstId, undefined, other.cookie);
      assert.strictEqual(res.status, 404);
      const list = await api(app, 'GET', '/api/my/sprint-analyses', undefined, other.cookie);
      assert.strictEqual(list.json.reports.length, 0);
    });
    await r.test('Lab Training stops at 7 a week', async () => {
      for (let i = 2; i <= 7; i++) {
        const ok = await api(app, 'POST', '/api/reports/sprint-analysis', sample('Run ' + i), mc);
        assert.strictEqual(ok.status, 201);
      }
      const eighth = await api(app, 'POST', '/api/reports/sprint-analysis', sample('Run 8'), mc);
      assert.strictEqual(eighth.status, 429);
      assert.strictEqual(eighth.json.weekLimit, 7);
    });
    await r.test('Lab Pass allows 30 a week', async () => {
      await api(app, 'PUT', '/api/access/' + s.memberId, { tier: 'pass' }, oc);
      const res = await api(app, 'POST', '/api/reports/sprint-analysis', sample('Run 8'), mc);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.weekLimit, 30);
    });
    await r.test('members cannot use the coach review endpoints', async () => {
      assert.strictEqual((await api(app, 'GET', '/api/sprint-analyses', undefined, mc)).status, 403);
      assert.strictEqual((await api(app, 'POST', '/api/sprint-analyses/' + firstId + '/review', { note: 'x' }, mc)).status, 403);
    });
    await r.test('the coach sees every report, newest first, with counts', async () => {
      const res = await api(app, 'GET', '/api/sprint-analyses', undefined, oc);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.counts.total, 8);
      assert.strictEqual(res.json.counts.new, 8);
      assert.strictEqual(res.json.reports[0].athleteName, 'Run 8');
      const one = await api(app, 'GET', '/api/sprint-analyses/' + firstId, undefined, oc);
      assert.strictEqual(one.json.report.email, 'member@example.test');
    });
    await r.test('a coach note marks it reviewed and the member sees the note', async () => {
      const res = await api(app, 'POST', '/api/sprint-analyses/' + firstId + '/review', { note: 'Good shin angles. Work on step 2 lean.' }, oc);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.report.status, 'reviewed');
      const list = await api(app, 'GET', '/api/my/sprint-analyses', undefined, mc);
      const mine = list.json.reports.find((x) => x.id === firstId);
      assert.strictEqual(mine.coachNote, 'Good shin angles. Work on step 2 lean.');
    });
  } finally {
    app.stop();
    fake.server.close();
  }
  console.log('\n' + r.passed + ' passed, ' + r.failed + ' failed');
  process.exit(r.failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
