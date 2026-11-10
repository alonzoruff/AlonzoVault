#!/usr/bin/env node
'use strict';
/*
 * Protocols content check. Run after dropping a protocol into
 * content/protocols.json:
 *
 *   node scripts/protocols-report.js            (checks content/protocols.json)
 *   node scripts/protocols-report.js some.json  (checks another file)
 *
 * Prints, in plain words: how many protocols are in each status, any entry
 * that would be skipped and exactly why, and the full list of video slots
 * that still need a clip (protocol, week, step, what the clip should show).
 * Exits 1 when any entry has a problem, so a bad paste is caught before
 * deploy. It reads one file and writes nothing.
 */
const fs = require('fs');
const path = require('path');
const lib = require('../lib/protocols');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'content', 'protocols.json'));
let raw;
try {
  raw = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error('Could not read ' + file + ': ' + err.message);
  process.exit(1);
}
const list = Array.isArray(raw) ? raw : (raw && raw.protocols) || [];
const report = lib.checkProtocols(raw);

const counts = {};
for (const p of report.valid) counts[p.status] = (counts[p.status] || 0) + 1;
console.log('Protocols file: ' + file);
console.log('Entries in file: ' + list.length + ', valid: ' + report.valid.length + ', skipped: ' + report.skipped.length);
for (const st of lib.STATUSES) if (counts[st]) console.log('  ' + st + ': ' + counts[st]);

if (report.skipped.length) {
  console.log('\nProblems (these entries would NOT show):');
  for (const sk of report.skipped) {
    console.log('  ' + sk.id);
    for (const pr of sk.problems) console.log('    - ' + pr);
  }
}

const gaps = lib.videoGaps(raw);
console.log('\nVideo slots without a clip yet: ' + gaps.length);
if (gaps.length) {
  console.log('\n| Protocol | Week | Where | Clip | What the video should show | Status |');
  console.log('|---|---|---|---|---|---|');
  for (const g of gaps) console.log('| ' + g.protocol + ' | ' + g.weekLabel + ' | ' + (g.step ? 'step ' + g.step : 'whole week') + ' | ' + (g.label || '-').replace(/\|/g, '/') + ' | ' + g.shows.replace(/\|/g, '/') + ' | ' + g.state + ' |');
}
process.exit(report.skipped.length ? 1 : 0);
