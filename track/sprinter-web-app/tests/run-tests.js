#!/usr/bin/env node
/*
 * Sprinter Workout App — server test suite.
 *
 * Zero dependencies: starts server.js on a throwaway port with a
 * temporary DATA_DIR, exercises the API end to end, then kills the
 * server and deletes the temp data. Run with:  node tests/run-tests.js
 *
 * Covers the full coach system (accounts, logs, swaps, groups, roster
 * import, assignments, completions, testing + Epley, weekly tracker,
 * concerns, demo media) plus edge cases: dates outside the season,
 * impossible calendar dates, malformed bodies, duplicate handling.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3217;
const BASE = 'http://127.0.0.1:' + PORT;
const APP_DIR = path.dirname(__dirname);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-test-'));

let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; }
  else { failures.push(name + (extra !== undefined ? ' — got: ' + JSON.stringify(extra) : '')); }
}

async function api(cookie, method, p, body, opts = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let data;
  if (opts.raw !== undefined) {
    data = opts.raw;
    headers['content-type'] = opts.contentType || 'application/json';
  } else if (body !== undefined) {
    data = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(BASE + p, { method, headers, body: data });
  let json = null;
  try { json = await res.json(); } catch (_) { /* empty/non-json */ }
  let setCookie = [];
  try { setCookie = res.headers.getSetCookie(); } catch (_) {
    const sc = res.headers.get('set-cookie'); if (sc) setCookie = [sc];
  }
  return { status: res.status, json, setCookie };
}
const cookieOf = (r) => (r.setCookie[0] || '').split(';')[0];

/* Raw-text variant for the CSV downloads (api() parses JSON only). */
async function apiText(cookie, p) {
  const res = await fetch(BASE + p, { headers: cookie ? { cookie } : {} });
  return {
    status: res.status,
    text: await res.text(),
    type: res.headers.get('content-type') || '',
    disp: res.headers.get('content-disposition') || '',
  };
}

async function main() {
  /* ---------------- content + auth ---------------- */
  let r = await api(null, 'GET', '/api/content');
  check('content loads', r.status === 200);
  check('content counts are 49/16/29',
    r.json.sessions.length === 49 && r.json.drills.length === 16 && r.json.weeks.length === 29,
    [r.json.sessions.length, r.json.drills.length, r.json.weeks.length]);
  r = await api(null, 'GET', '/');
  check('home page serves', r.status === 200);

  r = await api(null, 'POST', '/api/register', { email: 'coach@test.com', password: 'testpass123' });
  check('first register is 201', r.status === 201, r.status);
  check('first account is coach', r.json.role === 'coach', r.json.role);
  const coach = cookieOf(r);
  r = await api(null, 'POST', '/api/register', { email: 'athlete@test.com', password: 'testpass123' });
  check('second account is athlete', r.json.role === 'athlete', r.json.role);
  const athlete = cookieOf(r);
  r = await api(null, 'POST', '/api/register', { email: 'coach@test.com', password: 'testpass123' });
  check('duplicate email is 409', r.status === 409, r.status);
  r = await api(null, 'POST', '/api/register', { email: 'not-an-email', password: 'testpass123' });
  check('bad email is 400', r.status === 400, r.status);
  r = await api(null, 'POST', '/api/register', { email: 'x@test.com', password: 'short' });
  check('short password is 400', r.status === 400, r.status);
  r = await api(null, 'POST', '/api/login', { email: 'coach@test.com', password: 'wrongpassword' });
  check('wrong password is 401', r.status === 401, r.status);
  r = await api(null, 'POST', '/api/login', { email: 'coach@test.com', password: 'testpass123' });
  check('correct login is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/me');
  check('/api/me shows coach role', r.json.role === 'coach', r.json);
  r = await api(null, 'GET', '/api/groups');
  check('team data without login is 401', r.status === 401, r.status);
  for (const p of ['/api/groups', '/api/profiles', '/api/media', '/api/concerns', '/api/weekly/dashboard', '/api/coach/feed?date=2026-10-26']) {
    r = await api(athlete, 'GET', p);
    check('athlete is 403 on ' + p.split('?')[0], r.status === 403, r.status);
  }

  /* ---------------- coach's own log + swaps ---------------- */
  r = await api(athlete, 'POST', '/api/logs', { date: '2026-10-26', sessionId: 'ACC-01', group: '100/200', happened: 'Felt fast', marks: '10.4', feel: 4, notes: '' });
  check('log add is 201', r.status === 201, r.status);
  const logId = r.json.entry.id;
  r = await api(athlete, 'GET', '/api/logs');
  check('log lists the entry', r.json.entries.some(e => e.id === logId));
  r = await api(athlete, 'POST', '/api/logs', { date: '2026-10-26', sessionId: 'XXX-99' });
  check('log with unknown session is 400', r.status === 400, r.status);
  r = await api(athlete, 'POST', '/api/logs', { date: '26/10/2026', sessionId: 'ACC-01' });
  check('log with bad date is 400', r.status === 400, r.status);
  r = await api(athlete, 'DELETE', '/api/logs/' + logId);
  check('log delete is 200', r.status === 200, r.status);
  r = await api(athlete, 'DELETE', '/api/logs/' + logId);
  check('log delete twice is 404', r.status === 404, r.status);

  r = await api(athlete, 'PUT', '/api/swaps', { week: 1, day: 'tue', xt: 'XT-01' });
  check('swap to XT is 200', r.status === 200 && r.json.swaps['1:tue'] === 'XT-01', r.json);
  r = await api(athlete, 'PUT', '/api/swaps', { week: 1, day: 'tue', xt: 'ACC-01' });
  check('swap to non-XT is 400', r.status === 400, r.status);
  r = await api(athlete, 'PUT', '/api/swaps', { week: 30, day: 'tue', xt: 'XT-01' });
  check('swap week 30 is 400', r.status === 400, r.status);
  r = await api(athlete, 'PUT', '/api/swaps', { week: 1, day: 'funday', xt: 'XT-01' });
  check('swap bad day is 400', r.status === 400, r.status);
  r = await api(athlete, 'PUT', '/api/swaps', { week: 1, day: 'tue', xt: null });
  check('swap unset works', r.status === 200 && !('1:tue' in r.json.swaps), r.json);

  /* ---------------- groups ---------------- */
  r = await api(coach, 'POST', '/api/groups', { name: '100/200' });
  check('group create is 201', r.status === 201, r.status);
  const gSprint = r.json.group.id;
  r = await api(coach, 'POST', '/api/groups', { name: '100/200' });
  check('duplicate group name is 409', r.status === 409, r.status);
  r = await api(coach, 'POST', '/api/groups', { name: '   ' });
  check('blank group name is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/groups', { name: '400 Group' });
  const g400 = r.json.group.id;
  r = await api(coach, 'PUT', '/api/groups/' + g400, { name: '400m Group' });
  check('group rename is 200', r.status === 200 && r.json.group.name === '400m Group', r.json);
  r = await api(coach, 'PUT', '/api/groups/' + gSprint, { name: '400m Group' });
  check('rename onto an existing name is 409', r.status === 409, r.status);
  r = await api(coach, 'PUT', '/api/groups/does-not-exist', { name: 'Nope' });
  check('rename unknown group is 404', r.status === 404, r.status);

  /* ---------------- profiles ---------------- */
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Jane', lastName: 'Doe', groupId: gSprint, events: ['sprinter', 'jumper', 'sprinter'] });
  check('profile create is 201', r.status === 201, r.status);
  const jane = r.json.profile.id;
  check('profile events are de-duplicated', r.json.profile.events.length === 2, r.json.profile.events);
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'X', lastName: 'Y', groupId: 'nope' });
  check('profile with unknown group is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Only' });
  check('profile missing last name is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/profiles?groupId=' + gSprint);
  check('profiles filter by group', r.json.profiles.length === 1 && r.json.profiles[0].id === jane, r.json.profiles.length);
  r = await api(coach, 'GET', '/api/profiles?event=jumper');
  check('profiles filter by event', r.json.profiles.some(p => p.id === jane));
  r = await api(coach, 'GET', '/api/profiles?q=doe');
  check('profiles search by name', r.json.profiles.some(p => p.id === jane));
  r = await api(coach, 'PUT', '/api/profiles/' + jane, { topAthlete: true });
  check('profile can be starred', r.status === 200 && r.json.profile.topAthlete === true, r.json);

  /* ---------------- roster import ---------------- */
  const roster = [
    'Rossi, Ana | Sprint Squad | sprinter | yes',
    'Lee, Ben | Sprint Squad | sprinter, hurdler |',
    'Kim, Cara | Distance Crew | jumper |',
    'Fox, Dan | Distance Crew | hurdler |',
  ].join('\n');
  r = await api(coach, 'POST', '/api/profiles/import', { text: roster });
  check('import creates 4 profiles', r.json.report.created === 4, r.json.report);
  check('import creates 2 groups', r.json.report.groupsCreated === 2, r.json.report);
  check('import has no errors', r.json.report.errors.length === 0, r.json.report.errors);
  r = await api(coach, 'POST', '/api/profiles/import', { text: roster });
  check('re-import creates 0', r.json.report.created === 0, r.json.report);
  check('re-import skips 4', r.json.report.skipped.length === 4, r.json.report);
  r = await api(coach, 'GET', '/api/profiles?event=hurdler');
  check('import set event tags', r.json.profiles.length === 2, r.json.profiles.map(p => p.name));
  r = await api(coach, 'GET', '/api/profiles?top=1');
  check('import set the top star', r.json.profiles.some(p => p.lastName === 'Rossi'), r.json.profiles.map(p => p.name));

  const partial = [
    'Rossi, Ana | Sprint Squad | sprinter | yes',
    'Lee, Ben | Sprint Squad | sprinter, hurdler |',
    'Park, Eli | Throws Crew | sprinter |',
    'Quinn, Fay | Throws Crew | jumper |',
  ].join('\n');
  r = await api(coach, 'POST', '/api/profiles/import', { text: partial });
  check('partial-duplicate import creates only the 2 new', r.json.report.created === 2, r.json.report);
  check('partial-duplicate import skips the 2 existing', r.json.report.skipped.length === 2, r.json.report);

  r = await api(coach, 'POST', '/api/profiles/import', { text: 'Rossi, Ana | Throws Crew | sprinter |' });
  check('same athlete in a different group is skipped, not duplicated', r.json.report.created === 0 && r.json.report.skipped.length === 1, r.json.report);
  r = await api(coach, 'GET', '/api/profiles?q=Rossi');
  check('still exactly one Rossi profile', r.json.profiles.length === 1, r.json.profiles.length);

  r = await api(coach, 'POST', '/api/profiles/import', { text: 'Garbage line with no structure' });
  check('malformed import line is reported', r.json.report.errors.length === 1, r.json.report);
  r = await api(coach, 'POST', '/api/profiles/import', { text: '   ' });
  check('empty import is 400', r.status === 400, r.status);

  const csvText = 'name,group,events,top\n"Hall, Gus",Sprint Squad,sprinter,no\n"Ivy, Hope",Sprint Squad,hurdler,yes';
  r = await api(coach, 'POST', '/api/profiles/import', { text: csvText });
  check('CSV import creates 2', r.json.report.created === 2, r.json.report);
  r = await api(coach, 'GET', '/api/profiles?top=1');
  check('CSV import set star from "yes"', r.json.profiles.some(p => p.lastName === 'Ivy'), r.json.profiles.map(p => p.name));

  const longFirst = 'A'.repeat(60);
  r = await api(coach, 'POST', '/api/profiles/import', { text: 'Longname, ' + longFirst + ' | Sprint Squad | sprinter |' });
  check('import with a very long name still imports', r.json.report.created === 1, r.json.report);
  r = await api(coach, 'GET', '/api/profiles?q=Longname');
  check('imported long name is truncated to 40', r.json.profiles.length === 1 && r.json.profiles[0].firstName.length <= 40, r.json.profiles[0] && r.json.profiles[0].firstName.length);

  const bigRoster = Array.from({ length: 501 }, (_, i) => 'Bulk' + i + ', Kid' + i + ' | Bulk Group | sprinter |').join('\n');
  r = await api(coach, 'POST', '/api/profiles/import', { text: bigRoster });
  check('import over 500 lines is 400', r.status === 400, r.status);

  /* ---------------- assignments + plan edges ---------------- */
  const feedFor = (feed, gid) => feed.groups.find(g => g.group && g.group.id === gid);
  r = await api(coach, 'GET', '/api/coach/feed?date=2026-10-26');
  let f = feedFor(r.json, gSprint);
  check('plan default for Week 1 Monday is ACC-01', f && f.assignment.sessionId === 'ACC-01', f && f.assignment);
  check('plan default source is "plan"', f && f.assignment.source === 'plan', f && f.assignment);

  r = await api(coach, 'POST', '/api/assignments/override', { groupId: gSprint, date: '2026-10-26', sessionId: 'SE-02', note: 'test day change' });
  check('override applies', r.status === 200 && r.json.assignment.sessionId === 'SE-02' && r.json.assignment.source === 'override', r.json);
  r = await api(coach, 'GET', '/api/coach/feed?date=2026-10-26');
  f = feedFor(r.json, g400);
  check('override does not leak into another group', f && f.assignment.sessionId === 'ACC-01', f && f.assignment);
  r = await api(coach, 'POST', '/api/assignments/override', { groupId: gSprint, date: '2026-10-26', sessionId: 'XXX-99' });
  check('override with unknown session is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/assignments/override', { groupId: 'nope', date: '2026-10-26', sessionId: 'SE-02' });
  check('override with unknown group is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/assignments/override', { groupId: gSprint, date: '10/26/2026', sessionId: 'SE-02' });
  check('override with US-format date is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/assignments/override', { groupId: gSprint, date: '2026-02-30', sessionId: 'SE-02' });
  check('override with Feb 30 is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/assignments/override', { groupId: gSprint, date: '2026-10-26', sessionId: null });
  check('override clears back to plan', r.status === 200 && r.json.assignment.sessionId === 'ACC-01', r.json);

  r = await api(coach, 'GET', '/api/coach/feed?date=2026-10-20');
  f = feedFor(r.json, gSprint);
  check('date before season start clamps to Week 1 (200, plan)', r.status === 200 && f && f.assignment.sessionId === 'TEM-01', { status: r.status, a: f && f.assignment });
  r = await api(coach, 'GET', '/api/coach/feed?date=2027-06-15');
  f = feedFor(r.json, gSprint);
  check('date after season end clamps to final week (200, no crash)', r.status === 200 && f && f.assignment.sessionId === null, { status: r.status, a: f && f.assignment });
  r = await api(coach, 'GET', '/api/coach/feed?date=2027-06-18');
  f = feedFor(r.json, gSprint);
  check('post-season Friday reads final-week Friday (RM-05)', f && f.assignment.sessionId === 'RM-05', f && f.assignment);
  r = await api(coach, 'GET', '/api/coach/feed?date=2027-02-30');
  check('feed with Feb 30 is 400', r.status === 400, r.status);

  /* ---------------- completions ---------------- */
  r = await api(coach, 'POST', '/api/completions', { profileId: jane, date: '2026-10-26', marks: '10.4', feel: 4 });
  check('completion mark is 200', r.status === 200 && r.json.completion.sessionId === 'ACC-01', r.json);
  r = await api(coach, 'GET', '/api/coach/feed?date=2026-10-26');
  f = feedFor(r.json, gSprint);
  const janeRow = f.members.find(m => m.profile.id === jane);
  check('feed shows Jane completed with marks', janeRow.completed === true && janeRow.completion.marks === '10.4', janeRow);
  const squad = r.json.groups.find(g => g.group && g.group.name === 'Sprint Squad');
  check('other group member is not completed', squad.members.every(m => !m.completed), squad.members.map(m => m.completed));
  r = await api(coach, 'POST', '/api/completions', { profileId: jane, date: '2026-10-26', completed: false });
  check('completion unmark works', r.status === 200 && r.json.removed === true, r.json);
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Sam', lastName: 'Solo' });
  const sam = r.json.profile.id;
  r = await api(coach, 'POST', '/api/completions', { profileId: sam, date: '2026-10-26' });
  check('completion for groupless athlete is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/completions', { profileId: 'nope', date: '2026-10-26' });
  check('completion for unknown profile is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/completions', { profileId: jane, date: '2026-02-30' });
  check('completion with Feb 30 is 400', r.status === 400, r.status);

  /* ---------------- group delete with members ---------------- */
  r = await api(coach, 'POST', '/api/groups', { name: 'Temp Group' });
  const gTemp = r.json.group.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Tim', lastName: 'Temp', groupId: gTemp });
  const tim = r.json.profile.id;
  r = await api(coach, 'POST', '/api/assignments/override', { groupId: gTemp, date: '2026-10-26', sessionId: 'SE-02' });
  check('temp group override set', r.status === 200, r.status);
  r = await api(coach, 'DELETE', '/api/groups/' + gTemp);
  check('group delete with members is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/profiles/' + tim + '/records');
  check('member of deleted group is unassigned, not orphaned', r.json.profile.groupId === null, r.json.profile);
  r = await api(coach, 'GET', '/api/coach/feed?date=2026-10-26');
  check('deleted group is gone from feed', !r.json.groups.some(g => g.group && g.group.id === gTemp));
  const timRow = r.json.unassigned.members.find(m => m.profile.id === tim);
  check('ex-member lands in the unassigned bucket', !!timRow, r.json.unassigned.members.length);
  r = await api(coach, 'DELETE', '/api/groups/' + gTemp);
  check('group delete twice is 404', r.status === 404, r.status);

  /* ---------------- testing tracker ---------------- */
  r = await api(coach, 'GET', '/api/tests');
  check('battery has 8 preloaded tests', r.json.tests.length === 8, r.json.tests.length);
  check('battery includes hang clean', r.json.tests.some(t => t.key === 'hang-clean'));
  r = await api(coach, 'POST', '/api/tests', { name: 'Medicine Ball Throw', unit: 'ft' });
  check('custom test create is 201', r.status === 201 && r.json.test.custom === true, r.json);
  r = await api(coach, 'POST', '/api/tests', { name: 'No Unit' });
  check('custom test without unit is 400', r.status === 400, r.status);

  r = await api(coach, 'POST', '/api/test-days', { date: '2026-11-02', title: 'Fall Weight Room Testing', testKeys: ['bench-press', 'back-squat', 'vertical-jump'] });
  check('test day create is 201', r.status === 201, r.status);
  const day1 = r.json.testDay.id;
  r = await api(coach, 'POST', '/api/test-days', { date: '2026-11-02', title: 'Bad', testKeys: ['nope'] });
  check('test day with unknown test is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/test-days', { date: '2026-11-02', title: '', testKeys: ['bench-press'] });
  check('test day without title is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/test-days', { date: '2026-02-30', title: 'Bad date', testKeys: ['bench-press'] });
  check('test day with Feb 30 is 400', r.status === 400, r.status);

  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'bench-press', weight: 185, reps: 5 });
  check('bench 185x5 is 201', r.status === 201, r.status);
  check('Epley: 185x5 -> est 1RM 216', r.json.result.est1rm === 216, r.json.result);
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'back-squat', weight: 225 });
  check('single (no reps) est = weight', r.json.result.est1rm === 225, r.json.result);
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'bench-press', weight: 190, reps: 5 });
  check('re-entering a result updates (200)', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/results?profileId=' + jane + '&testDayId=' + day1);
  const benchRows = r.json.results.filter(x => x.testKey === 'bench-press');
  check('upsert keeps one bench row, now 222', benchRows.length === 1 && benchRows[0].est1rm === 222, benchRows);
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'hang-clean', weight: 135 });
  check('result for test not in the day is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'vertical-jump', value: -3 });
  check('negative result is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'bench-press', weight: 'abc' });
  check('non-numeric weight is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'bench-press', weight: 100, reps: 0 });
  check('reps 0 is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'bench-press', weight: 100, reps: 31 });
  check('reps 31 is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/results', { profileId: 'nope', testDayId: day1, testKey: 'bench-press', weight: 100 });
  check('result for unknown profile is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: 'nope', testKey: 'bench-press', weight: 100 });
  check('result for unknown day is 404', r.status === 404, r.status);

  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day1, testKey: 'vertical-jump', value: 24.5 });
  check('vertical jump stores raw value', r.status === 201 && r.json.result.value === 24.5, r.json.result);
  r = await api(coach, 'POST', '/api/test-days', { date: '2027-02-01', title: 'Winter Testing', testKeys: ['vertical-jump'] });
  const day2 = r.json.testDay.id;
  r = await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day2, testKey: 'vertical-jump', value: 26 });
  const vj2 = r.json.result.id;
  r = await api(coach, 'GET', '/api/results?profileId=' + jane);
  check('PB tracks the best across days', r.json.personalBests['vertical-jump'].display === 26, r.json.personalBests);
  r = await api(coach, 'GET', '/api/results?profileId=does-not-exist');
  check('results for unknown profile is 404', r.status === 404, r.status);
  r = await api(coach, 'DELETE', '/api/results/' + vj2);
  check('result delete is 200', r.status === 200, r.status);
  r = await api(coach, 'DELETE', '/api/results/' + vj2);
  check('result delete twice is 404', r.status === 404, r.status);

  r = await api(coach, 'POST', '/api/test-days', { date: '2027-03-01', title: 'Throwaway Day', testKeys: ['back-squat'] });
  const day3 = r.json.testDay.id;
  await api(coach, 'POST', '/api/results', { profileId: jane, testDayId: day3, testKey: 'back-squat', weight: 200 });
  r = await api(coach, 'DELETE', '/api/test-days/' + day3);
  check('test day delete is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/results?testDayId=' + day3);
  check('deleting a test day removes its results', r.json.results.length === 0, r.json.results.length);
  r = await api(coach, 'DELETE', '/api/test-days/' + day3);
  check('test day delete twice is 404', r.status === 404, r.status);

  /* ---------------- weekly tracker ---------------- */
  r = await api(coach, 'GET', '/api/weekly/metrics');
  check('7 default weekly metrics', r.json.metrics.length === 7, r.json.metrics.length);
  check('weekly metrics include hang clean + bench 1RM',
    r.json.metrics.some(m => m.key === 'hang-clean-1rm') && r.json.metrics.some(m => m.key === 'bench-press-1rm'));
  r = await api(coach, 'POST', '/api/weekly/metrics', { name: '60m time', unit: 'sec', better: 'lower' });
  check('custom weekly metric is 201', r.status === 201, r.status);
  r = await api(coach, 'POST', '/api/weekly/metrics', { name: 'Bad', unit: 'sec', better: 'sideways' });
  check('custom metric with bad "better" is 400', r.status === 400, r.status);

  for (const [week, value] of [['2026-10-26', 3.10], ['2026-11-02', 3.04], ['2026-11-09', 2.98]]) {
    r = await api(coach, 'PUT', '/api/weekly/entry', { profileId: jane, metricId: 'fly-30m', week, value });
    check('weekly entry ' + week + ' is 200', r.status === 200, r.status);
  }
  r = await api(coach, 'GET', '/api/weekly/series?profileId=' + jane + '&metricId=fly-30m');
  check('series has 3 ordered points', r.json.points.length === 3 && r.json.points[0].week === '2026-10-26' && r.json.points[2].week === '2026-11-09', r.json.points);
  check('series best is 2.98', r.json.best === 2.98, r.json.best);
  check('series delta is -0.12', r.json.delta === -0.12, r.json.delta);
  check('series improved=true for lower-better', r.json.improved === true, r.json.improved);
  r = await api(coach, 'PUT', '/api/weekly/entry', { profileId: jane, metricId: 'fly-30m', week: '2026-11-09', value: 2.95 });
  check('weekly overwrite is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/weekly/series?profileId=' + jane + '&metricId=fly-30m');
  check('overwrite replaces, still 3 points, best 2.95', r.json.points.length === 3 && r.json.best === 2.95, r.json);
  r = await api(coach, 'PUT', '/api/weekly/entry', { profileId: jane, metricId: 'fly-30m', week: '2026-10-27', value: 3.0 });
  check('non-Monday week is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/weekly/entry', { profileId: jane, metricId: 'fly-30m', week: '2026-02-30', value: 3.0 });
  check('weekly entry with Feb 30 is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/weekly/entry', { profileId: jane, metricId: 'fly-30m', week: '2026-10-26', value: -1 });
  check('negative weekly value is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/weekly/entry', { profileId: jane, metricId: 'nope', week: '2026-10-26', value: 3.0 });
  check('unknown weekly metric is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/weekly/entry', { profileId: 'nope', metricId: 'fly-30m', week: '2026-10-26', value: 3.0 });
  check('weekly entry for unknown profile is 404', r.status === 404, r.status);

  r = await api(coach, 'GET', '/api/weekly/overlay?metricId=fly-30m');
  const overlayAthletes = r.json.athletes;
  check('overlay includes starred Jane', overlayAthletes.some(a => a.profileId === jane), overlayAthletes.map(a => a.name));
  r = await api(coach, 'GET', '/api/profiles?q=Lee');
  const ben = r.json.profiles[0].id;
  check('overlay excludes unstarred Ben', !overlayAthletes.some(a => a.profileId === ben));
  r = await api(coach, 'GET', '/api/weekly/dashboard');
  check('dashboard lists Jane as a top athlete', r.json.topAthletes.some(t => t.id === jane));
  check('dashboard carries Jane fly-30m entries', !!(r.json.entries[jane] || {})['fly-30m']);

  /* ---------------- aches & pains ---------------- */
  r = await api(coach, 'POST', '/api/concerns', { profileId: jane, area: 'hamstring', side: 'left', feeling: 'tightness', pain: 6, started: '2026-10-27', impact: 'modified', note: 'Tight after hills' });
  check('concern create is 201', r.status === 201, r.status);
  check('concern starts as "new"', r.json.concern.status === 'new', r.json.concern);
  const concern1 = r.json.concern.id;
  for (const [label, patch] of [
    ['pain 0', { pain: 0 }], ['pain 11', { pain: 11 }], ['pain 5.5', { pain: 5.5 }],
    ['bad area', { area: 'elbow-grease' }], ['bad side', { side: 'middle' }],
    ['bad feeling', { feeling: 'weird' }], ['bad impact', { impact: 'meh' }],
    ['Feb 30 start', { started: '2026-02-30' }], ['word start date', { started: 'yesterday' }],
  ]) {
    const body = Object.assign({ profileId: jane, area: 'knee', side: 'left', feeling: 'ache', pain: 5, started: '2026-10-27', impact: 'none' }, patch);
    r = await api(coach, 'POST', '/api/concerns', body);
    check('concern with ' + label + ' is 400', r.status === 400, r.status);
  }
  r = await api(coach, 'POST', '/api/concerns', { profileId: 'nope', area: 'knee', side: 'left', feeling: 'ache', pain: 5, started: '2026-10-27', impact: 'none' });
  check('concern for unknown profile is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/concerns', { profileId: jane, area: 'achilles', side: 'right', feeling: 'sharp', pain: 8, started: '2026-10-28', impact: 'stopped', note: '' });
  const concern2 = r.json.concern.id;
  r = await api(coach, 'GET', '/api/concerns');
  check('flagged high-pain concern sorts first', r.json.concerns[0].id === concern2 && r.json.concerns[0].flagged === true, r.json.concerns.map(c => [c.pain, c.flagged]));
  r = await api(coach, 'PUT', '/api/concerns/' + concern2, { status: 'monitoring', coachNote: 'Sent to athletic trainer' });
  check('concern moves to monitoring with note', r.status === 200 && r.json.concern.status === 'monitoring' && r.json.concern.coachNote === 'Sent to athletic trainer', r.json);
  r = await api(coach, 'PUT', '/api/concerns/' + concern2, { status: 'bogus' });
  check('concern with bad status is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/concerns/' + concern2, { pain: 0 });
  check('concern pain update to 0 is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/concerns/does-not-exist', { status: 'cleared' });
  check('concern update unknown id is 404', r.status === 404, r.status);
  r = await api(coach, 'PUT', '/api/concerns/' + concern2, { status: 'cleared' });
  check('concern can be cleared', r.status === 200 && r.json.concern.status === 'cleared', r.json);
  void concern1;

  /* ---------------- combined profile records ---------------- */
  await api(coach, 'POST', '/api/completions', { profileId: jane, date: '2026-10-26', marks: '10.4', feel: 5 });
  r = await api(coach, 'GET', '/api/profiles/' + jane + '/records');
  check('records include completions', r.json.completions.length >= 1, r.json.completions.length);
  check('records include test results', r.json.results.length >= 1, r.json.results.length);
  check('records include weekly entries', !!(r.json.weekly || {})['fly-30m'], Object.keys(r.json.weekly || {}));
  check('records include concerns', r.json.concerns.length >= 2, r.json.concerns.length);
  r = await api(coach, 'GET', '/api/profiles/does-not-exist/records');
  check('records for unknown profile is 404', r.status === 404, r.status);

  /* ---------------- movement media ---------------- */
  r = await api(coach, 'GET', '/api/media');
  const media = r.json.media;
  check('media serves all 24 base entries', Object.keys(media).length === 24, Object.keys(media).length);
  check('ankle dribbles embed URL is correct', media['DRL-16'] && media['DRL-16'].embedUrl === 'https://www.youtube.com/embed/fPzTm57KOKk', media['DRL-16']);
  check('base media is marked source=base', media['squat'] && media['squat'].source === 'base', media['squat']);
  r = await api(coach, 'PUT', '/api/media/custom-move-1', { url: 'https://www.youtube.com/watch?v=X0J1m-R6CKk' });
  check('coach media set is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/media');
  check('coach media overrides as source=coach', r.json.media['custom-move-1'] && r.json.media['custom-move-1'].source === 'coach', r.json.media['custom-move-1']);
  r = await api(coach, 'PUT', '/api/media/DRL-01', { url: 'https://youtu.be/X0J1m-R6CKk' });
  check('youtu.be short link accepted', r.status === 200, r.status);
  r = await api(coach, 'PUT', '/api/media/custom-move-1', { url: 'https://vimeo.com/123456789' });
  check('Vimeo link is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/media/custom-move-1', { url: 'not a url at all' });
  check('garbage link is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/media/custom-move-2', { url: 'https://example.com/demo.gif' });
  check('direct GIF link accepted as gif', r.status === 200 && r.json.media.type === 'gif', r.json);
  r = await api(coach, 'PUT', '/api/media/bad id!', { url: 'https://www.youtube.com/watch?v=X0J1m-R6CKk' });
  check('bad movement id is 400', r.status === 400, r.status);
  r = await api(coach, 'DELETE', '/api/media/DRL-16');
  check('media delete is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/media');
  check('tombstone hides the base entry', !('DRL-16' in r.json.media), Object.keys(r.json.media).length);
  r = await api(coach, 'PUT', '/api/media/DRL-16', { url: 'https://www.youtube.com/watch?v=fPzTm57KOKk' });
  check('re-adding after tombstone works', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/media');
  check('re-added entry is back, as coach source', r.json.media['DRL-16'] && r.json.media['DRL-16'].source === 'coach', r.json.media['DRL-16']);
  r = await api(coach, 'DELETE', '/api/media/custom-move-1');
  await api(coach, 'DELETE', '/api/media/custom-move-2');
  r = await api(coach, 'GET', '/api/media');
  check('coach-only entries delete cleanly', !('custom-move-1' in r.json.media) && !('custom-move-2' in r.json.media));

  /* ---------------- malformed bodies ---------------- */
  r = await api(coach, 'POST', '/api/groups', undefined, { raw: 'this is not json{', contentType: 'application/json' });
  check('non-JSON body is a clean 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/content');
  check('server alive after non-JSON body', r.status === 200, r.status);
  r = await api(null, 'POST', '/api/login', undefined, { raw: 'null', contentType: 'application/json' });
  check('JSON null body gets a clean auth error', r.status === 400 || r.status === 401, r.status);
  r = await api(coach, 'POST', '/api/profiles', undefined, { raw: '[1,2,3]', contentType: 'application/json' });
  check('JSON array body is a clean 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/concerns', {});
  check('empty-object concern is 404 (no profile)', r.status === 404, r.status);
  let oversizedThrew = false;
  try {
    await api(coach, 'POST', '/api/groups', undefined, { raw: JSON.stringify({ name: 'x'.repeat(300 * 1024) }), contentType: 'application/json' });
  } catch (_) { oversizedThrew = true; }
  r = await api(coach, 'GET', '/api/content');
  check('server alive after oversized body', r.status === 200, r.status);
  void oversizedThrew;

  /* ---------------- coach Today summary + CSV exports ---------------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  const nowD = new Date();
  const today = nowD.getFullYear() + '-' + pad2(nowD.getMonth() + 1) + '-' + pad2(nowD.getDate());

  // A flagged, still-open concern for Jane (pain 9, stopped training).
  r = await api(coach, 'POST', '/api/concerns', {
    profileId: jane, area: 'knee', side: 'right', feeling: 'sharp', pain: 9,
    started: today, impact: 'stopped', note: 'Summary flag check',
  });
  check('summary setup: flagged concern created', r.status === 201, r.status);
  // Mark Jane complete for today so the summary count has something to count.
  r = await api(coach, 'POST', '/api/completions', { profileId: jane, date: today, marks: 'today', feel: 4 });
  check('summary setup: completion for today marked', r.status === 200, r.status);

  r = await api(coach, 'GET', '/api/coach/today');
  check('today summary is 200', r.status === 200, r.status);
  check('today summary date is today', r.json.date === today, r.json.date);
  check('today summary names a season week', Number.isInteger(r.json.week), r.json.week);
  const sumGroup = (r.json.groups || []).find(g => g.group.id === gSprint);
  check('summary includes the 100/200 group', !!sumGroup, (r.json.groups || []).map(g => g.group.name));
  check('summary group carries an assignment object',
    !!sumGroup && !!sumGroup.assignment && 'sessionId' in sumGroup.assignment,
    sumGroup && sumGroup.assignment);
  check('summary completion count is 1 of 1 after marking',
    !!sumGroup && sumGroup.completed === 1 && sumGroup.total === 1, sumGroup);
  check('summary flags the high-pain concern first',
    Array.isArray(r.json.healthFlags) && r.json.healthFlags.length >= 1 &&
    r.json.healthFlags[0].pain === 9 && r.json.healthFlags[0].flagged === true,
    r.json.healthFlags && r.json.healthFlags[0]);
  check('summary health flags name the athlete',
    r.json.healthFlags[0].athleteName === 'Jane Doe', r.json.healthFlags[0].athleteName);
  check('summary excludes cleared concerns',
    !r.json.healthFlags.some(c => c.id === concern2), r.json.healthFlags.map(c => c.id));
  r = await api(athlete, 'GET', '/api/coach/today');
  check('athlete is 403 on today summary', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/coach/today');
  check('today summary without login is 401', r.status === 401, r.status);

  // A profile whose display name contains a comma — exports must quote it.
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Doe, Jane', lastName: 'Comma', groupId: gSprint });
  check('comma-name profile created', r.status === 201, r.status);

  let x = await apiText(coach, '/api/export/testing.csv');
  check('testing export is 200 text/csv', x.status === 200 && x.type.includes('text/csv'), { status: x.status, type: x.type });
  check('testing export filename is testing-results.csv', x.disp.includes('testing-results.csv'), x.disp);
  check('testing export has the header row',
    x.text.startsWith('Test Day,Date,Athlete,Group,Test,Raw Entry,Est. 1RM (lb)'), x.text.slice(0, 90));
  check('testing export has the test day and athlete',
    x.text.includes('Fall Weight Room Testing') && x.text.includes('Jane Doe'), x.text.slice(0, 320));
  check('testing export has bench raw entry and est 1RM',
    x.text.includes('190 × 5') && x.text.includes('222'), x.text.slice(0, 320));
  x = await apiText(coach, '/api/export/weekly.csv');
  check('weekly export is 200 text/csv', x.status === 200 && x.type.includes('text/csv'), { status: x.status, type: x.type });
  check('weekly export has Jane fly rows',
    x.text.includes('Jane Doe') && x.text.includes('Fly 30m time') &&
    x.text.includes('2026-11-09') && x.text.includes('2.95'), x.text.slice(0, 320));
  x = await apiText(coach, '/api/export/roster.csv');
  check('roster export is 200 text/csv', x.status === 200 && x.type.includes('text/csv'), { status: x.status, type: x.type });
  check('roster export quotes the comma name', x.text.includes('"Doe, Jane Comma"'), x.text.slice(0, 400));
  check('roster export lists Jane in 100/200', /Jane Doe,100\/200/.test(x.text), x.text.slice(0, 400));
  for (const pth of ['/api/export/testing.csv', '/api/export/weekly.csv', '/api/export/roster.csv']) {
    x = await apiText(athlete, pth);
    check('athlete is 403 on ' + pth, x.status === 403, x.status);
  }

  /* ---------------- archive behavior ---------------- */
  r = await api(coach, 'PUT', '/api/profiles/' + jane, { archived: true });
  check('profile archive is 200', r.status === 200 && r.json.profile.archived === true, r.json);
  r = await api(coach, 'GET', '/api/profiles');
  check('archived profile hidden by default', !r.json.profiles.some(p => p.id === jane));
  r = await api(coach, 'GET', '/api/profiles?includeArchived=1');
  check('archived profile visible with includeArchived=1', r.json.profiles.some(p => p.id === jane));
  r = await api(coach, 'GET', '/api/weekly/dashboard');
  check('archived top athlete leaves the dashboard', !r.json.topAthletes.some(t => t.id === jane));
}

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + '/api/content');
      if (res.status === 200) return true;
    } catch (_) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

(async () => {
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR, SESSION_SECRET: 'test-secret' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', d => { serverLog += d; });
  child.stderr.on('data', d => { serverLog += d; });
  try {
    if (!await waitForServer()) throw new Error('server did not start.\n' + serverLog);
    await main();
  } catch (err) {
    failures.push('SUITE ERROR: ' + err.message);
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  for (const f of failures) console.log('  FAIL: ' + f);
  process.exit(failures.length ? 1 : 0);
})();
