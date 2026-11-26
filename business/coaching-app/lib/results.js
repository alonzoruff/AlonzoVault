'use strict';
/* Lab results for the public landing page (content/lab_results.json).

   The file holds REAL numbers only. Luna or AJ fill it in from the
   Lab's own testing; nothing here invents or samples a number. Until
   the file says "status": "published" and carries real numbers, the
   page shows a clearly marked placeholder with no figures at all.

   Shape (every number is a plain number, times in seconds):
   {
     "status": "placeholder" | "published",
     "asOf": "2026-12-15",                 // date the numbers were pulled
     "source": "Winter Base Protocol, blocks ending Dec 2026",
     "athletesTested": 18,                 // athletes with a baseline AND a retest
     "tests": [
       { "key": "30m-sprint", "athletes": 18,
         "medianChange": -0.08, "minChange": -0.21, "maxChange": 0.03,
         "improved": 15 },
       { "key": "fly-30m", ... }
     ],
     "cards": [                            // before/after cards, consent only
       { "label": "11th grade sprinter",   // NO names, initials or schools
         "program": "Winter Base Protocol",
         "consent": true,                  // the athlete said yes (Part 4d)
         "tests": [ { "key": "30m-sprint", "before": 4.62, "after": 4.51 } ] }
     ]
   }

   "Change" is after minus before, so for a time a negative change is
   faster. Anything that does not fit this shape is dropped, a card
   without consent: true is dropped, and an invalid file falls back to
   the placeholder. */

const RESULT_TESTS = {
  '30m-sprint': { label: '30m sprint', unit: 's', better: 'lower' },
  'fly-30m': { label: 'Flying 30m', unit: 's', better: 'lower' },
};
const MAX_CARDS = 6;
const CARD_KEYS = new Set(['label', 'program', 'consent', 'tests']);

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const cleanStr = (x, max) => (typeof x === 'string' && x.trim() && x.trim().length <= max) ? x.trim() : null;

function placeholder() {
  return { status: 'placeholder', tests: Object.keys(RESULT_TESTS).map(key => Object.assign({ key }, RESULT_TESTS[key])), cards: [] };
}

function cleanAggregate(t, athletesTested) {
  if (!t || typeof t !== 'object' || !RESULT_TESTS[t.key]) return null;
  const ok = Number.isInteger(t.athletes) && t.athletes > 0 && t.athletes <= athletesTested
    && num(t.medianChange) && num(t.minChange) && num(t.maxChange)
    && t.minChange <= t.medianChange && t.medianChange <= t.maxChange
    && Number.isInteger(t.improved) && t.improved >= 0 && t.improved <= t.athletes;
  if (!ok) return null;
  return Object.assign({ key: t.key }, RESULT_TESTS[t.key], {
    athletes: t.athletes, medianChange: t.medianChange, minChange: t.minChange,
    maxChange: t.maxChange, improved: t.improved,
  });
}

function cleanCard(c) {
  if (!c || typeof c !== 'object' || c.consent !== true) return null;
  if (Object.keys(c).some(k => !CARD_KEYS.has(k))) return null;
  const label = cleanStr(c.label, 60);
  const program = c.program === undefined ? null : cleanStr(c.program, 80);
  if (!label || (c.program !== undefined && !program)) return null;
  if (!Array.isArray(c.tests) || !c.tests.length) return null;
  const tests = [];
  for (const t of c.tests) {
    if (!t || !RESULT_TESTS[t.key] || !num(t.before) || !num(t.after) || t.before <= 0 || t.after <= 0) return null;
    tests.push(Object.assign({ key: t.key }, RESULT_TESTS[t.key], { before: t.before, after: t.after }));
  }
  return { label, program, tests };
}

/* Returns the public view: either the placeholder or a published set
   whose every number passed the checks above. */
function cleanResults(raw) {
  if (!raw || typeof raw !== 'object' || raw.status !== 'published') return placeholder();
  const athletesTested = raw.athletesTested;
  const asOf = typeof raw.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.asOf) ? raw.asOf : null;
  if (!Number.isInteger(athletesTested) || athletesTested <= 0 || !asOf || !Array.isArray(raw.tests)) return placeholder();
  const tests = raw.tests.map(t => cleanAggregate(t, athletesTested)).filter(Boolean);
  if (!tests.length) return placeholder();
  const cards = (Array.isArray(raw.cards) ? raw.cards : []).map(cleanCard).filter(Boolean).slice(0, MAX_CARDS);
  return {
    status: 'published', asOf, source: cleanStr(raw.source, 160),
    athletesTested, tests, cards,
  };
}

module.exports = { cleanResults, RESULT_TESTS, MAX_CARDS };
