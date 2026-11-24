#!/usr/bin/env node
'use strict';
/*
 * Checks questions.txt and prints a plain report.   node scripts/check-questions.js
 * Exit code 1 if any question has a problem, so the tests catch it too.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('../lib/questions');

const file = process.argv[2] || path.join(__dirname, '..', 'questions.txt');
const { questions, errors } = parse(fs.readFileSync(file, 'utf8'));

const counts = {};
for (const q of questions) {
  counts[q.section] = counts[q.section] || {};
  counts[q.section][q.topic] = (counts[q.section][q.topic] || 0) + 1;
}
console.log(questions.length + ' questions read from ' + path.basename(file));
for (const section of Object.keys(counts)) {
  const topics = counts[section];
  const n = Object.values(topics).reduce((a, b) => a + b, 0);
  console.log('\n' + section + ': ' + n);
  for (const t of Object.keys(topics)) console.log('  ' + t + ': ' + topics[t]);
}
if (errors.length) {
  console.log('\nNeeds fixing (' + errors.length + '):');
  for (const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('\nNo problems found.');
