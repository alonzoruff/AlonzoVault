'use strict';
/* Measure yourself (Part 4c): the free speed tool on the public site.

   A visitor enters one time, for a 30m sprint from a start or a
   flying 30m, and gets their average speed back. Entering an email
   unlocks the full breakdown below. Everything here is arithmetic on
   the visitor's own number plus plain facts about how the test
   works. There are no norms, no percentiles, no predictions and no
   promises: the tool measures speed, it never forecasts a time or
   a result.

   The test keys match the app's own testing catalog (30m-sprint)
   and weekly metric (fly-30m). The time ranges only stop typos: a
   time outside them is almost certainly a mistake, not a fact about
   the athlete. app.js keeps a copy of MEASURE_TESTS for the free
   result shown before any email; the tests check the two match. */

const MEASURE_TESTS = {
  '30m-sprint': { label: '30m sprint from a start', min: 3.2, max: 9 },
  'fly-30m': { label: 'Flying 30m', min: 2.3, max: 8 },
};
const MEASURE_TIMING = {
  electronic: 'Electronic gates',
  hand: 'Hand stopwatch',
  unsure: 'Not sure',
};
const DISTANCE_M = 30;
const MPH_PER_MS = 2.236936;

const round = (n, places) => {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
};

/* Reads { test, time, timing } from a posted body. Answers either
   { error } with a plain sentence, or the cleaned input. */
function parseMeasureInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const test = typeof b.test === 'string' ? b.test : '';
  if (!Object.prototype.hasOwnProperty.call(MEASURE_TESTS, test)) {
    return { error: 'Please pick the 30m sprint or the flying 30m.' };
  }
  const raw = typeof b.time === 'number' ? String(b.time) : (typeof b.time === 'string' ? b.time.trim() : '');
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(raw)) {
    return { error: 'Please enter your time in seconds, like 4.25.' };
  }
  const time = round(Number(raw), 2);
  const t = MEASURE_TESTS[test];
  if (!(time >= t.min && time <= t.max)) {
    return { error: 'That time looks off for a ' + t.label.toLowerCase() + '. Please check it and enter it in seconds.' };
  }
  let timing = 'unsure';
  if (b.timing !== undefined && b.timing !== null && b.timing !== '') {
    if (typeof b.timing !== 'string' || !Object.prototype.hasOwnProperty.call(MEASURE_TIMING, b.timing)) {
      return { error: 'Please pick how the time was taken, or leave it as Not sure.' };
    }
    timing = b.timing;
  }
  return { test, time, timing };
}

/* Speed from a time, rounded the way the page shows it. */
function measureSpeed(time) {
  const ms = DISTANCE_M / time;
  return { ms: round(ms, 2), kmh: round(ms * 3.6, 1), mph: round(ms * MPH_PER_MS, 1) };
}

/* The full breakdown for a cleaned input. `date` is the day the
   time was entered (New York YYYY-MM-DD), printed on the baseline
   card. Every line is a fact about the number or the test. */
function measureBreakdown(input, date) {
  const t = MEASURE_TESTS[input.test];
  const speed = measureSpeed(input.time);
  const per10m = round(input.time / 3, 2);
  const per10 = per10m.toFixed(2);
  const notes = [];
  if (input.test === '30m-sprint') {
    notes.push('This time includes your start and your acceleration, so your average speed over the 30 m is below your top speed.');
    notes.push('Your average was ' + per10 + ' s per 10 m. The 10 m splits are not even: the first 10 m takes the longest because you are still speeding up.');
  } else {
    notes.push('A flying 30m starts the clock after a run-in, so this average is close to your top speed over that stretch.');
    notes.push('Your average was ' + per10 + ' s per 10 m.');
  }
  if (input.timing === 'hand') {
    notes.push('Hand times usually read faster than electronic times, so compare a hand time only with another hand time.');
  } else if (input.timing === 'electronic') {
    notes.push('Gates take stopwatch reaction out of the time. Use gates again when you retest so the two numbers compare.');
  } else {
    notes.push('Write down how this time was taken. A hand time and a gate time do not compare directly.');
  }
  const retest = [
    'Measure the 30 m with a tape, start line to finish line.',
    input.test === '30m-sprint'
      ? 'Use the same start every time, for example a 3-point start.'
      : 'Use the same run-in every time, measured with a tape, and time only the 30 m after it.',
    'Time it the same way as today.',
    'Run on the same surface, in the same shoes.',
    'Warm up fully first. Take 3 tries with full rest and keep the best one.',
    'Note the wind and the weather. A headwind or a cold day slows a time.',
    'Retest at the end of a training block, the way the Lab does, not every few days.',
  ];
  return {
    test: input.test, label: t.label, time: input.time,
    timing: input.timing, timingLabel: MEASURE_TIMING[input.timing],
    date: date || null, speed, per10m, notes, retest,
  };
}

module.exports = { MEASURE_TESTS, MEASURE_TIMING, parseMeasureInput, measureSpeed, measureBreakdown };
