/*
 * CSCS practice test: pick a set, answer one question at a time against the
 * clock, then see the score broken down by topic, weakest first.
 * Question text comes from questions.txt and is only ever set as text.
 */
(function () {
  'use strict';
  var Q = window.CSCSQuestions;
  var Z = window.CSCSQuiz;
  var app = document.getElementById('app');
  var HISTORY_KEY = 'cscs-practice-history';

  var bank = [];
  var errors = [];
  var choice = { section: 'Applied', count: 10, pace: 60 };
  var run = null;   /* { set, answers, index, endsAt, timer, timedOut } */

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function show(nodes) {
    app.textContent = '';
    nodes.forEach(function (n) { if (n) app.appendChild(n); });
    window.scrollTo(0, 0);
  }

  function readHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; }
  }
  function saveHistory(entry) {
    try {
      var h = readHistory();
      h.unshift(entry);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 10)));
    } catch (e) { /* private window or storage off: history is a nice-to-have */ }
  }

  function poolSize(section) {
    return bank.filter(function (q) { return section === 'all' || q.section === section; }).length;
  }

  /* ---------- Start screen ---------- */

  function radioGroup(name, legend, options, current, cols) {
    var wrap = el('div', { class: 'seg' + (cols ? ' cols-' + cols : '') });
    options.forEach(function (o, i) {
      var id = name + '-' + i;
      var input = el('input', { type: 'radio', name: name, id: id, value: String(o.value) });
      if (String(o.value) === String(current)) input.checked = true;
      input.addEventListener('change', function () { choice[name] = o.value; renderStart(); });
      var label = el('label', { for: id }, [el('span', null, [o.label, o.note ? el('small', { text: o.note }) : null])]);
      wrap.appendChild(input); wrap.appendChild(label);
    });
    return el('fieldset', null, [el('legend', { text: legend }), wrap]);
  }

  function renderStart() {
    var sections = [
      { value: 'Applied', label: 'Applied', note: poolSize('Applied') + ' questions' },
      { value: 'Scientific Foundations', label: 'Scientific Foundations', note: poolSize('Scientific Foundations') + ' questions' },
      { value: 'all', label: 'Mixed', note: bank.length + ' questions' }
    ];
    var pool = poolSize(choice.section);
    var counts = [10, 20, 0].map(function (n) {
      var real = n === 0 ? pool : Math.min(n, pool);
      return { value: n, label: n === 0 ? 'All' : String(n), note: n === 0 ? real + ' total' : null };
    });
    var paces = [
      { value: 45, label: '45 sec', note: 'per question' },
      { value: 60, label: '60 sec', note: 'per question' },
      { value: 90, label: '90 sec', note: 'per question' }
    ];
    var n = choice.count === 0 ? pool : Math.min(choice.count, pool);
    var total = n * choice.pace;

    var errBox = null;
    if (errors.length) {
      errBox = el('div', { class: 'errors', role: 'alert' }, [
        el('h2', { text: 'Some questions in questions.txt need fixing' }),
        el('p', { class: 'small', text: 'These were skipped. Everything else still works.' }),
        el('ul', null, errors.slice(0, 12).map(function (e) { return el('li', { text: e }); }))
      ]);
    }

    var hist = readHistory();
    var histBox = hist.length ? el('div', null, [
      el('h2', { text: 'Recent sets' }),
      el('ul', { class: 'history' }, hist.slice(0, 5).map(function (h) {
        var weak = h.weakest ? ', weakest: ' + h.weakest : '';
        return el('li', { text: h.date + '  ' + h.section + '  ' + h.correct + '/' + h.total + ' (' + h.pct + '%)' + weak });
      }))
    ]) : null;

    show([
      el('h1', { text: 'CSCS Practice Test' }),
      el('p', { class: 'muted', text: 'Timed sets, one question at a time, scored by topic so weak areas show up fast.' }),
      el('p', { class: 'note', text: 'Practice questions written by Claude for study. These are not real NSCA exam items.' }),
      errBox,
      radioGroup('section', 'Section', sections, choice.section),
      radioGroup('count', 'How many questions', counts, choice.count, 3),
      radioGroup('pace', 'Time per question', paces, choice.pace, 3),
      el('button', { class: 'btn', type: 'button', onclick: startRun, disabled: n ? null : 'disabled' }, ['Start ' + n + ' questions']),
      el('p', { class: 'summary', text: n ? Z.clock(total) + ' on the clock. Unanswered questions count as wrong.' : 'No questions in this section yet.' }),
      histBox
    ]);
  }

  /* ---------- Test screen ---------- */

  function startRun() {
    var set = Z.buildSet(bank, { section: choice.section, count: choice.count });
    if (!set.length) return;
    run = { set: set, answers: {}, index: 0, endsAt: Date.now() + set.length * choice.pace * 1000, timedOut: false, section: choice.section };
    run.timer = setInterval(tick, 250);
    renderQuestion();
  }

  function remaining() { return (run.endsAt - Date.now()) / 1000; }

  function tick() {
    if (!run) return;
    var left = remaining();
    var t = app.querySelector('.timer');
    if (t) {
      t.textContent = Z.clock(left);
      t.classList.toggle('low', left <= 60);
    }
    if (left <= 0) { run.timedOut = true; finish(); }
  }

  function renderQuestion() {
    var q = run.set[run.index];
    var total = run.set.length;
    var picked = run.answers[q.id];
    var last = run.index === total - 1;
    var answered = Object.keys(run.answers).length;
    var left = remaining();

    var bar = el('div', { class: 'bar' }, [
      el('div', { class: 'bar-top' }, [
        el('button', { class: 'quit', type: 'button', onclick: quit }, ['Quit']),
        el('span', { class: 'count', text: 'Question ' + (run.index + 1) + ' of ' + total }),
        el('span', { class: 'timer' + (left <= 60 ? ' low' : ''), role: 'timer', 'aria-label': 'Time left', text: Z.clock(left) })
      ]),
      el('div', { class: 'progress', 'aria-hidden': 'true' }, [el('span', { style: 'width:' + Math.round((answered / total) * 100) + '%' })])
    ]);

    var choices = el('div', { class: 'choices', role: 'group', 'aria-label': 'Answer choices' });
    q.choices.forEach(function (c, i) {
      var letter = String.fromCharCode(65 + i);
      choices.appendChild(el('button', {
        class: 'choice', type: 'button', 'aria-pressed': picked === c.key ? 'true' : 'false',
        onclick: function () { run.answers[q.id] = c.key; renderQuestion(); }
      }, [el('span', { class: 'letter', text: letter }), el('span', { text: c.text })]));
    });

    var nav = el('div', { class: 'row' }, [
      el('button', { class: 'btn ghost', type: 'button', onclick: function () { run.index--; renderQuestion(); }, disabled: run.index === 0 ? 'disabled' : null }, ['Back']),
      last
        ? el('button', { class: 'btn', type: 'button', onclick: confirmFinish }, ['Finish'])
        : el('button', { class: 'btn', type: 'button', onclick: function () { run.index++; renderQuestion(); } }, [picked ? 'Next' : 'Skip'])
    ]);

    show([bar, el('p', { class: 'tag', text: q.topic }), el('p', { class: 'stem', text: q.q }), choices, nav]);
  }

  function confirmFinish() {
    var open = run.set.length - Object.keys(run.answers).length;
    if (open > 0 && !window.confirm(open + (open === 1 ? ' question is' : ' questions are') + ' unanswered and will count as wrong. Finish anyway?')) return;
    finish();
  }

  function quit() {
    if (!window.confirm('Quit this set? Your answers will not be scored.')) return;
    clearInterval(run.timer);
    run = null;
    renderStart();
  }

  /* ---------- Results ---------- */

  function finish() {
    clearInterval(run.timer);
    var r = Z.score(run.set, run.answers);
    var timedOut = run.timedOut;
    var sectionName = run.section === 'all' ? 'Mixed' : run.section;
    saveHistory({
      date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      section: sectionName, correct: r.correct, total: r.total, pct: r.pct,
      weakest: r.byTopic.length && r.byTopic[0].pct < 100 ? r.byTopic[0].topic : ''
    });
    run = null;
    renderResults(r, timedOut, sectionName);
  }

  function level(p) { return p < 60 ? 'lvl-low' : p < 80 ? 'lvl-mid' : 'lvl-high'; }

  function renderResults(r, timedOut, sectionName) {
    var topics = el('div', { class: 'topics' }, r.byTopic.map(function (t) {
      return el('div', { class: 'topic ' + level(t.pct) }, [
        el('div', { class: 'topic-head' }, [
          el('span', { class: 'topic-name' }, [t.topic, t.pct < 60 ? el('span', { class: 'flag', text: 'Study this' }) : null]),
          el('span', { class: 'topic-num', text: t.correct + '/' + t.total + '  ' + t.pct + '%' })
        ]),
        el('div', { class: 'topic-sec', text: t.section }),
        el('div', { class: 'meter', 'aria-hidden': 'true' }, [el('span', { style: 'width:' + Math.max(t.pct, 2) + '%' })])
      ]);
    }));

    var review = r.missed.length ? el('div', null, [
      el('h2', { text: 'Review what you missed (' + r.missed.length + ')' }),
      el('div', { class: 'review' }, r.missed.map(function (m) {
        var q = m.question;
        var text = function (key) { var c = q.choices.filter(function (x) { return x.key === key; })[0]; return c ? c.text : ''; };
        return el('div', { class: 'miss' }, [
          el('div', { class: 'tag', text: q.topic }),
          el('div', { class: 'q', text: q.q }),
          el('div', { class: 'ans yours' }, [el('b', { text: 'Your answer' }), m.picked ? text(m.picked) : 'No answer']),
          el('div', { class: 'ans right' }, [el('b', { text: 'Correct answer' }), text(q.answer)]),
          q.why ? el('p', { class: 'why', text: q.why }) : null
        ]);
      }))
    ]) : el('p', { class: 'muted', text: 'Every question right. Nice work.' });

    show([
      el('h1', { text: 'Your score' }),
      timedOut ? el('p', { class: 'timeup', text: 'Time ran out. Unanswered questions counted as wrong.' }) : null,
      el('div', { class: 'score' }, [
        el('div', { class: 'big', text: r.pct + '%' }),
        el('div', { class: 'sub', text: r.correct + ' of ' + r.total + ' correct, ' + sectionName })
      ]),
      el('h2', { text: 'By topic, weakest first' }),
      topics,
      review,
      el('div', { class: 'stack' }, [
        el('button', { class: 'btn', type: 'button', onclick: startRun }, ['Try another set']),
        el('button', { class: 'btn ghost', type: 'button', onclick: renderStart }, ['Change settings'])
      ])
    ]);
  }

  /* ---------- Load ---------- */

  fetch('questions.txt', { cache: 'no-store' })
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
    .then(function (text) {
      var parsed = Q.parse(text);
      bank = parsed.questions;
      errors = parsed.errors;
      renderStart();
    })
    .catch(function () {
      show([el('h1', { text: 'CSCS Practice Test' }), el('p', { class: 'errors', text: 'The question file could not be loaded. Start the app with "node server.js" in the cscs/practice-test folder and open the address it prints.' })]);
    });
})();
