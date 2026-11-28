/*
 * Practice set building and scoring. Works in the browser (window.CSCSQuiz)
 * and in Node (require). No timers or page code here, so it can be tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSCSQuiz = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function shuffle(list, rng) {
    var a = list.slice();
    var r = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /*
   * section: 'Applied', 'Scientific Foundations' or 'all'
   * count: how many questions (capped at what exists); 0 or missing means all
   * Choices are shuffled too, so the right answer is not always in the same spot.
   */
  function buildSet(questions, opts) {
    var o = opts || {};
    var pool = questions.filter(function (q) { return !o.section || o.section === 'all' || q.section === o.section; });
    var picked = shuffle(pool, o.rng);
    if (o.count > 0) picked = picked.slice(0, o.count);
    return picked.map(function (q) {
      return { id: q.id, section: q.section, topic: q.topic, q: q.q, answer: q.answer, why: q.why, choices: shuffle(q.choices, o.rng) };
    });
  }

  /* answers: { [question id]: 'A' | 'B' | 'C' }. Anything unanswered counts as wrong. */
  function score(set, answers) {
    var a = answers || {};
    var topics = {};
    var order = [];
    var missed = [];
    var correct = 0;
    set.forEach(function (q) {
      var key = q.section + '|' + q.topic;
      if (!topics[key]) { topics[key] = { section: q.section, topic: q.topic, correct: 0, total: 0 }; order.push(key); }
      var t = topics[key];
      t.total++;
      var picked = a[q.id] || null;
      if (picked === q.answer) { t.correct++; correct++; }
      else missed.push({ question: q, picked: picked });
    });
    var byTopic = order.map(function (k) {
      var t = topics[k];
      t.pct = Math.round((t.correct / t.total) * 100);
      return t;
    });
    /* Weakest first, so the area to study is on top. Ties keep the bigger sample first. */
    byTopic.sort(function (x, y) { return (x.pct - y.pct) || (y.total - x.total) || x.topic.localeCompare(y.topic); });
    var total = set.length;
    return {
      correct: correct,
      total: total,
      pct: total ? Math.round((correct / total) * 100) : 0,
      answered: set.filter(function (q) { return a[q.id]; }).length,
      byTopic: byTopic,
      missed: missed
    };
  }

  /* 0:00 style. Never below zero. */
  function clock(seconds) {
    var s = Math.max(0, Math.ceil(seconds));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  return { shuffle: shuffle, buildSet: buildSet, score: score, clock: clock };
});
