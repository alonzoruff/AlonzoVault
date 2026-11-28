#!/usr/bin/env node
'use strict';
/*
 * Tests for the CSCS practice test.   node tests/practice-tests.js
 *
 * Covers the question file format (including the 3-choice rule and the
 * starter set's 20/10 split), set building, scoring by topic, the clock,
 * and the static server.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parse } = require('../lib/questions');
const Z = require('../lib/quiz');
const { start, ROUTES } = require('../server');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const ONE = [
  'Section: Applied', 'Topic: Program Design', 'Q: Pick B.', 'A) no', 'B) yes', 'C) no', 'Answer: B', 'Why: Because.'
].join('\n');

(async () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'questions.txt'), 'utf8');
  const bank = parse(text);

  console.log('Starter question file');
  await test('parses with no errors', () => assert.deepStrictEqual(bank.errors, []));
  await test('has 30 questions: 20 Applied and 10 Scientific Foundations', () => {
    assert.strictEqual(bank.questions.length, 30);
    assert.strictEqual(bank.questions.filter((q) => q.section === 'Applied').length, 20);
    assert.strictEqual(bank.questions.filter((q) => q.section === 'Scientific Foundations').length, 10);
  });
  await test('every question has exactly 3 choices and a key that is one of them', () => {
    for (const q of bank.questions) {
      assert.deepStrictEqual(q.choices.map((c) => c.key), ['A', 'B', 'C'], 'question on line ' + q.line);
      assert.ok(['A', 'B', 'C'].includes(q.answer), 'question on line ' + q.line);
      for (const c of q.choices) assert.ok(c.text.length > 0, 'empty choice on line ' + q.line);
    }
  });
  await test('every question has a topic and an explanation', () => {
    for (const q of bank.questions) { assert.ok(q.topic, 'line ' + q.line); assert.ok(q.why.length > 20, 'line ' + q.line); }
  });
  await test('no two questions share the same text, and no choice repeats inside a question', () => {
    const seen = new Set();
    for (const q of bank.questions) {
      assert.ok(!seen.has(q.q), 'duplicate: ' + q.q); seen.add(q.q);
      assert.strictEqual(new Set(q.choices.map((c) => c.text)).size, 3, 'line ' + q.line);
    }
  });
  await test('file is labeled as practice questions, not real exam items', () => {
    assert.ok(/NOT real NSCA[\s#]+exam items/i.test(text));
  });
  await test('answer keys are spread across A, B and C', () => {
    for (const k of ['A', 'B', 'C']) assert.ok(bank.questions.filter((q) => q.answer === k).length >= 6, k);
  });

  console.log('Question format rules');
  await test('reads one well-formed question', () => {
    const r = parse(ONE);
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.questions[0].answer, 'B');
    assert.strictEqual(r.questions[0].section, 'Applied');
  });
  await test('wrapped lines join onto the field above', () => {
    const r = parse(ONE.replace('Q: Pick B.', 'Q: Pick\nB please.'));
    assert.strictEqual(r.questions[0].q, 'Pick B please.');
  });
  await test('notes, blank lines, Windows line endings and lower-case labels are fine', () => {
    const r = parse('# note\r\n\r\n' + ONE.toLowerCase().replace(/\n/g, '\r\n'));
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.questions[0].answer, 'B');
  });
  await test('accepts "A." as well as "A)", and "Scientific" for the section', () => {
    const r = parse(ONE.replace('A)', 'A.').replace('Section: Applied', 'Section: Scientific'));
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.questions[0].section, 'Scientific Foundations');
  });
  await test('a line that starts with a word like "Quick" is not read as a label', () => {
    const r = parse(ONE.replace('Q: Pick B.', 'Q: Pick B.\nQuickly.'));
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.questions[0].q, 'Pick B. Quickly.');
  });
  await test('rejects a fourth choice', () => {
    const r = parse(ONE.replace('C) no', 'C) no\nD) maybe'));
    assert.strictEqual(r.questions.length, 0);
    assert.match(r.errors[0], /exactly 3/);
  });
  await test('rejects only 2 choices and names the line', () => {
    const r = parse(ONE.replace('C) no\n', ''));
    assert.strictEqual(r.questions.length, 0);
    assert.match(r.errors.join(' '), /line 1 .*missing choice C/);
  });
  await test('rejects an answer that is not A, B or C', () => {
    assert.match(parse(ONE.replace('Answer: B', 'Answer: D')).errors[0], /must be A, B or C/);
  });
  await test('rejects an unknown section and a missing topic', () => {
    const r = parse(ONE.replace('Section: Applied', 'Section: Practical').replace('Topic: Program Design\n', ''));
    assert.match(r.errors.join(' '), /Use Applied or Scientific Foundations/);
    assert.match(r.errors.join(' '), /no "Topic:"/);
  });
  await test('a forgotten --- between questions is caught', () => {
    const r = parse(ONE + '\n' + ONE);
    assert.match(r.errors.join(' '), /--- line missing/);
  });
  await test('one bad question does not hide the good ones', () => {
    const r = parse(ONE + '\n---\n' + ONE.replace('Answer: B', 'Answer: Z') + '\n---\n' + ONE);
    assert.strictEqual(r.questions.length, 2);
    assert.strictEqual(r.errors.length, 1);
    assert.match(r.errors[0], /line 10/);
  });

  console.log('Building a set');
  await test('filters by section and caps the count', () => {
    const s = Z.buildSet(bank.questions, { section: 'Applied', count: 10, rng: seeded(1) });
    assert.strictEqual(s.length, 10);
    assert.ok(s.every((q) => q.section === 'Applied'));
    assert.strictEqual(Z.buildSet(bank.questions, { section: 'Scientific Foundations', count: 20 }).length, 10);
    assert.strictEqual(Z.buildSet(bank.questions, { section: 'all', count: 0 }).length, 30);
  });
  await test('no repeats inside a set, and each question still has its 3 choices', () => {
    const s = Z.buildSet(bank.questions, { section: 'all', count: 0, rng: seeded(7) });
    assert.strictEqual(new Set(s.map((q) => q.id)).size, 30);
    for (const q of s) assert.deepStrictEqual(q.choices.map((c) => c.key).sort(), ['A', 'B', 'C']);
  });
  await test('shuffling choices keeps the right answer attached to its text', () => {
    const s = Z.buildSet(bank.questions, { section: 'all', count: 0, rng: seeded(3) });
    for (const q of s) {
      const orig = bank.questions.find((o) => o.id === q.id);
      const right = orig.choices.find((c) => c.key === orig.answer).text;
      assert.strictEqual(q.choices.find((c) => c.key === q.answer).text, right);
    }
  });
  await test('choice order really changes across sets', () => {
    const firsts = new Set();
    for (let i = 0; i < 20; i++) firsts.add(Z.buildSet(bank.questions, { section: 'all', count: 0, rng: seeded(i + 11) })[0].choices[0].text);
    assert.ok(firsts.size > 1);
  });

  console.log('Scoring');
  const mini = [
    { id: 1, section: 'Applied', topic: 'Program Design', answer: 'A' },
    { id: 2, section: 'Applied', topic: 'Program Design', answer: 'B' },
    { id: 3, section: 'Applied', topic: 'Exercise Technique', answer: 'C' },
    { id: 4, section: 'Scientific Foundations', topic: 'Nutrition', answer: 'A' }
  ];
  await test('counts right answers, and unanswered counts as wrong', () => {
    const r = Z.score(mini, { 1: 'A', 2: 'C', 3: 'C' });
    assert.strictEqual(r.correct, 2); assert.strictEqual(r.total, 4); assert.strictEqual(r.pct, 50);
    assert.strictEqual(r.answered, 3);
    assert.deepStrictEqual(r.missed.map((m) => [m.question.id, m.picked]), [[2, 'C'], [4, null]]);
  });
  await test('breaks the score down by topic, weakest first', () => {
    const r = Z.score(mini, { 1: 'A', 2: 'C', 3: 'C' });
    assert.deepStrictEqual(r.byTopic.map((t) => [t.topic, t.correct, t.total, t.pct]), [
      ['Nutrition', 0, 1, 0], ['Program Design', 1, 2, 50], ['Exercise Technique', 1, 1, 100]
    ]);
  });
  await test('a perfect set and an empty set both score cleanly', () => {
    assert.strictEqual(Z.score(mini, { 1: 'A', 2: 'B', 3: 'C', 4: 'A' }).pct, 100);
    assert.strictEqual(Z.score([], {}).pct, 0);
  });
  await test('the same topic name in two sections is scored separately', () => {
    const r = Z.score([{ id: 1, section: 'Applied', topic: 'Mixed', answer: 'A' }, { id: 2, section: 'Scientific Foundations', topic: 'Mixed', answer: 'A' }], { 1: 'A' });
    assert.strictEqual(r.byTopic.length, 2);
  });
  await test('clock shows minutes and seconds and never goes negative', () => {
    assert.strictEqual(Z.clock(600), '10:00');
    assert.strictEqual(Z.clock(59.2), '1:00');
    assert.strictEqual(Z.clock(5), '0:05');
    assert.strictEqual(Z.clock(-3), '0:00');
  });

  console.log('Server');
  const srv = await start(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    await test('serves the page, scripts and question file', async () => {
      for (const p of Object.keys(ROUTES)) {
        const res = await fetch(base + p);
        assert.strictEqual(res.status, 200, p);
      }
      const page = await (await fetch(base + '/')).text();
      assert.match(page, /CSCS Practice Test/);
      assert.match(page, /name="viewport"/);
      const q = await (await fetch(base + '/questions.txt')).text();
      assert.strictEqual(parse(q).questions.length, 30);
    });
    await test('nothing outside the app is reachable', async () => {
      for (const p of ['/server.js', '/package.json', '/../README.md', '/%2e%2e/README.md', '/tests/practice-tests.js', '/public/app.js']) {
        assert.strictEqual((await fetch(base + p)).status, 404, p);
      }
      assert.strictEqual((await fetch(base + '/questions.txt', { method: 'POST' })).status, 405);
    });
    await test('health check answers ok', async () => {
      assert.deepStrictEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
    });
    await test('page code never writes question text as HTML', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
      assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(js));
    });
  } finally { srv.close(); }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
