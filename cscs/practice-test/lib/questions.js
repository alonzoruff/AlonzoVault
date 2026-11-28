/*
 * Reads the plain-text question file (questions.txt) into question objects.
 * Works in the browser (window.CSCSQuestions) and in Node (require).
 *
 * One question looks like this, and questions are split by a line of ---
 *
 *   Section: Applied
 *   Topic: Program Design
 *   Q: The question text.
 *   A) First choice
 *   B) Second choice
 *   C) Third choice
 *   Answer: B
 *   Why: One or two sentences on why B is right.
 *
 * Lines starting with # are notes and are skipped. A line with no label is
 * added onto the line above it, so long questions can wrap.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSCSQuestions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SECTIONS = { applied: 'Applied', scientific: 'Scientific Foundations', 'scientific foundations': 'Scientific Foundations' };
  var LETTERS = ['A', 'B', 'C'];
  /* "Section:", "Q:", "Answer:" and so on need the colon; choices are "A)" or "A." */
  var LABEL = /^(?:(section|topic|q|question|answer|why)\s*:|([a-e])[).](?=\s|$))\s*/i;

  function fieldName(m) {
    if (m[2]) return m[2].toUpperCase();
    var l = m[1].toLowerCase();
    return (l === 'q' || l === 'question') ? 'q' : l;
  }

  function parse(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var questions = [];
    var errors = [];
    var block = null;
    var last = null;

    function finish() {
      if (!block) return;
      var b = block;
      block = null; last = null;
      var where = 'The question that starts on line ' + b.line;
      var problems = [];
      if (!b.q) problems.push(where + ' has no "Q:" line.');
      var section = SECTIONS[String(b.section || '').trim().toLowerCase()];
      if (!b.section) problems.push(where + ' has no "Section:" line. Use Applied or Scientific Foundations.');
      else if (!section) problems.push(where + ' has Section "' + b.section + '". Use Applied or Scientific Foundations.');
      if (!b.topic) problems.push(where + ' has no "Topic:" line.');
      if (b.D || b.E) problems.push(where + ' has more than 3 answer choices. Every question needs exactly 3: A, B and C.');
      var missing = LETTERS.filter(function (k) { return !b[k]; });
      if (missing.length) problems.push(where + ' is missing choice ' + missing.join(' and ') + '. Every question needs exactly 3: A, B and C.');
      var ans = String(b.answer || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
      if (!b.answer) problems.push(where + ' has no "Answer:" line.');
      else if (LETTERS.indexOf(ans) < 0) problems.push(where + ' has Answer "' + b.answer + '". It must be A, B or C.');
      if (problems.length) { errors.push.apply(errors, problems); return; }
      questions.push({
        id: questions.length + 1,
        line: b.line,
        section: section,
        topic: b.topic.trim(),
        q: b.q.trim(),
        choices: LETTERS.map(function (k) { return { key: k, text: b[k].trim() }; }),
        answer: ans,
        why: (b.why || '').trim()
      });
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') continue;
      if (/^-{3,}$/.test(line)) { finish(); continue; }
      var m = line.match(LABEL);
      if (m) {
        if (!block) block = { line: i + 1 };
        var name = fieldName(m);
        if (block[name] !== undefined) {
          errors.push('Line ' + (i + 1) + ' repeats "' + (m[1] || m[2] + ')') + '" in the same question. Is a --- line missing above it?');
          continue;
        }
        block[name] = line.slice(m[0].length);
        last = name;
      } else if (block && last) {
        block[last] += ' ' + line;
      } else {
        errors.push('Line ' + (i + 1) + ' is not part of a question: "' + line.slice(0, 60) + '"');
      }
    }
    finish();
    return { questions: questions, errors: errors };
  }

  return { parse: parse, SECTIONS: ['Applied', 'Scientific Foundations'] };
});
