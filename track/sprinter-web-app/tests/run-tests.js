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

  /* ---------------- video library ---------------- */
  const contentJson = (await api(null, 'GET', '/api/content')).json;
  const vids = contentJson.videoLibrary;
  check('video library serves an array', Array.isArray(vids), typeof vids);
  check('video library has 102 entries', Array.isArray(vids) && vids.length === 102,
    Array.isArray(vids) ? vids.length : 'not an array');
  if (Array.isArray(vids)) {
    const wantCounts = {
      'Warm-Ups & Drills': 22, 'Lifts & Weight Room': 25, 'Sprint Mechanics & Speed': 20,
      'Plyometrics': 10, 'Hip Mobility & Strength': 15, 'Core & Trunk': 5, 'Recovery & Mobility': 5,
    };
    const gotCounts = {};
    for (const v of vids) gotCounts[v.category] = (gotCounts[v.category] || 0) + 1;
    check('video library category counts are exact',
      Object.keys(gotCounts).length === 7 &&
      Object.keys(wantCounts).every(k => gotCounts[k] === wantCounts[k]),
      gotCounts);
    const ids = vids.map(v => v.id);
    const wantIds = Array.from({ length: 102 }, (_, i) => 'VID-' + String(i + 1).padStart(3, '0'));
    check('video entry ids are unique and complete VID-001..VID-102',
      new Set(ids).size === 102 && wantIds.every(id => ids.includes(id)), ids.slice(0, 5));
    const urlRe = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;
    check('every video url is canonical watch form with an 11-char id',
      vids.every(v => urlRe.test(v.url || '')), vids.find(v => !urlRe.test(v.url || '')));
    const yids = vids.map(v => (v.url.match(urlRe) || [])[1]);
    check('no duplicate video ids in the library', new Set(yids).size === yids.length);
    check('every video entry has all 7 fields filled',
      vids.every(v => ['id', 'title', 'category', 'movement', 'url', 'source', 'note']
        .every(f => typeof v[f] === 'string' && v[f].trim().length > 0)));
    check('card-gap demos are in the library (VID-101 squat, VID-102 lateral walks)',
      vids.some(v => v.id === 'VID-101' && /squat/i.test(v.movement)) &&
      vids.some(v => v.id === 'VID-102' && /lateral/i.test(v.movement)));
  }
  const pageHtml = await apiText(null, '/');
  check('videos view markers are in the served page',
    pageHtml.status === 200 && pageHtml.text.includes('id="view-videos"') &&
    pageHtml.text.includes('data-view="videos"') && pageHtml.text.includes('id="vid-search"') &&
    pageHtml.text.includes('id="vid-chips"') && pageHtml.text.includes('id="vid-grid"'));
  const appJs = await apiText(null, '/app.js');
  check('videos filter/search/play wiring is in the served JS',
    appJs.status === 200 && appJs.text.includes('renderVideos') &&
    appJs.text.includes('data-vidcat') && appJs.text.includes('vid-search') &&
    appJs.text.includes('i.ytimg.com/vi/') && appJs.text.includes('youtube-nocookie.com/embed/'));

  /* ---------------- glossary (Definitions tab) ---------------- */
  const gloss = contentJson.glossary;
  check('glossary serves an array', Array.isArray(gloss), typeof gloss);
  check('glossary has 138 entries', Array.isArray(gloss) && gloss.length === 138,
    Array.isArray(gloss) ? gloss.length : 'not an array');
  if (Array.isArray(gloss)) {
    const wantDefCounts = {
      'Types of Running': 22, 'Sprint Drills & Warm-Up': 30, 'Lifts & Strength': 23,
      'Plyometrics & Power': 12, 'Mobility, Activation & Core': 26, 'Program Terms': 25,
    };
    const gotDefCounts = {};
    for (const e of gloss) gotDefCounts[e.category] = (gotDefCounts[e.category] || 0) + 1;
    check('glossary category counts are exact',
      Object.keys(gotDefCounts).length === 6 &&
      Object.keys(wantDefCounts).every(k => gotDefCounts[k] === wantDefCounts[k]),
      gotDefCounts);
    check('every glossary entry has term/category/definition and a known category',
      gloss.every(e => typeof e.term === 'string' && e.term.trim()
        && typeof e.definition === 'string' && e.definition.trim()
        && Object.prototype.hasOwnProperty.call(wantDefCounts, e.category)),
      gloss.find(e => !(typeof e.term === 'string' && e.term.trim()
        && typeof e.definition === 'string' && e.definition.trim()
        && Object.prototype.hasOwnProperty.call(wantDefCounts, e.category))));
    const runningTerms = ['Extensive Tempo', 'Intensive Tempo', 'Acceleration',
      'Maximum Velocity', 'Speed Endurance', 'Special Endurance'];
    check('required Types of Running terms exist',
      runningTerms.every(t => gloss.some(e => e.term === t && e.category === 'Types of Running')),
      runningTerms.filter(t => !gloss.some(e => e.term === t && e.category === 'Types of Running')));
    /* Drill names in drills.csv are Title-Cased in the glossary and one
       drops its distance ("Jog 800m + ..." -> "Jog + Progressive
       Strides"), so compare with case/punctuation/distance normalized. */
    const normTerm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .split(' ').filter(tok => tok && !/^\d+(m|km|s)?$/.test(tok)).join(' ');
    const glossNorms = new Set(gloss.map(e => normTerm(e.term)));
    const drillNames = (contentJson.drills || []).map(d => d.name);
    check('all 16 drill names appear as glossary terms',
      drillNames.length === 16 && drillNames.every(n => glossNorms.has(normTerm(n))),
      drillNames.filter(n => !glossNorms.has(normTerm(n))));
  }
  check('definitions view markers are in the served page',
    pageHtml.status === 200 && pageHtml.text.includes('id="view-definitions"') &&
    pageHtml.text.includes('data-view="definitions"') && pageHtml.text.includes('id="def-search"') &&
    pageHtml.text.includes('id="def-chips"') && pageHtml.text.includes('id="def-list"'));
  check('definitions search/filter wiring is in the served JS',
    appJs.status === 200 && appJs.text.includes('renderDefinitions') &&
    appJs.text.includes('data-defcat') && appJs.text.includes('def-search'));

  /* ---------------- coach education ---------------- */
  const edu = contentJson.coachEducation;
  check('coach education serves an array', Array.isArray(edu), typeof edu);
  check('coach education has 23 entries', Array.isArray(edu) && edu.length === 23,
    Array.isArray(edu) ? edu.length : 'not an array');
  if (Array.isArray(edu)) {
    const wantEduCounts = { 'Local (DC Metro)': 4, 'National (U.S.)': 9, 'Online': 10 };
    const gotEduCounts = {};
    for (const e of edu) gotEduCounts[e.bucket] = (gotEduCounts[e.bucket] || 0) + 1;
    check('coach education bucket counts are 4/9/10',
      Object.keys(gotEduCounts).length === 3 &&
      Object.keys(wantEduCounts).every(k => gotEduCounts[k] === wantEduCounts[k]),
      gotEduCounts);
    check('every coach education entry has all fields and an https url',
      edu.every(e => ['name', 'provider', 'bucket', 'focus', 'format', 'location', 'url', 'notes']
        .every(f => typeof e[f] === 'string' && e[f].trim().length > 0)
        && /^https:\/\//.test(e.url)
        && ['Sprints', 'Strength & Performance', 'Both'].includes(e.focus)),
      edu.find(e => !/^https:\/\//.test(e.url || '')));
  }
  check('coach education view markers are in the served page',
    pageHtml.status === 200 && pageHtml.text.includes('id="view-education"') &&
    pageHtml.text.includes('data-view="education"') && pageHtml.text.includes('id="edu-search"') &&
    pageHtml.text.includes('id="edu-chips"') && pageHtml.text.includes('id="edu-focus"') &&
    pageHtml.text.includes('id="edu-list"'));
  check('coach education filter/search wiring is in the served JS',
    appJs.status === 200 && appJs.text.includes('renderEducation') &&
    appJs.text.includes('data-edubucket') && appJs.text.includes('edu-focus'));
  check('inventory view markers are in the served page',
    pageHtml.status === 200 && pageHtml.text.includes('id="view-inventory"') &&
    pageHtml.text.includes('data-view="inventory"') && pageHtml.text.includes('id="inventory-main"'));
  check('inventory wiring is in the served JS',
    appJs.status === 200 && appJs.text.includes('renderInventory') &&
    appJs.text.includes('/api/inventory'));

  /* UX reorganization: five primary destinations (Today, Train,
     Learn, My Log, Account) + a coach-only Coach area; grouped views
     under hub views with a shared sub-navigation. Nothing removed —
     every pre-existing view section is still in the page. */
  check('hub views for Train, Learn and Coach are in the served page',
    pageHtml.text.includes('id="view-train"') && pageHtml.text.includes('id="view-learn"') &&
    pageHtml.text.includes('id="view-coachhub"'));
  check('primary nav carries the five destinations plus the coach area',
    ['data-view="home"', 'data-view="train"', 'data-view="learn"', 'data-view="log"',
     'data-view="account"', 'data-view="coachhub"'].every(s => pageHtml.text.includes(s)));
  check('mobile bottom tab bar is in the served page',
    pageHtml.text.includes('id="tab-bar"') && pageHtml.text.includes('tabbar'));
  check('every pre-existing view section survived the reorganization',
    ['view-home', 'view-library', 'view-season', 'view-log', 'view-cards', 'view-nutrition',
     'view-videos', 'view-definitions', 'view-education', 'view-testing', 'view-top',
     'view-health', 'view-groups', 'view-coach', 'view-inventory', 'view-drills',
     'view-qtr', 'view-guide', 'view-account']
      .every(id => pageHtml.text.includes('id="' + id + '"')));
  check('grouped views keep a sub-navigation slot',
    (pageHtml.text.match(/subnav-slot/g) || []).length >= 12,
    (pageHtml.text.match(/subnav-slot/g) || []).length);
  check('app JS maps views to nav areas and renders the sub-nav',
    appJs.text.includes('VIEW_AREA') && appJs.text.includes('GROUP_SUBNAV') &&
    appJs.text.includes('renderSubnav'));
  check('app JS has the dismissible Start here strip (localStorage)',
    appJs.text.includes('start-strip') && appJs.text.includes('swa-start-here') &&
    appJs.text.includes('start-dismiss'));
  check('app JS surfaces today\'s warm-up card on the home view',
    appJs.text.includes('home-warmup-card') && appJs.text.includes('WARMUP_CARD_FOR'));
  const swJs = await apiText(null, '/sw.js');
  check('service worker cache is bumped to v24',
    swJs.status === 200 && swJs.text.includes("sprinter-app-v24"), swJs.text.slice(0, 80));

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

  /* ---------------- equipment inventory ---------------- */
  r = await api(null, 'GET', '/api/inventory');
  check('inventory without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/inventory');
  check('athlete is 403 on inventory list', r.status === 403, r.status);
  r = await api(athlete, 'POST', '/api/inventory', { name: 'Sneak', category: 'Hurdles', quantity: 1, condition: 'Good' });
  check('athlete is 403 on inventory create', r.status === 403, r.status);
  r = await api(athlete, 'PUT', '/api/inventory/whatever', { quantity: 2 });
  check('athlete is 403 on inventory update', r.status === 403, r.status);
  r = await api(athlete, 'DELETE', '/api/inventory/whatever');
  check('athlete is 403 on inventory delete', r.status === 403, r.status);

  r = await api(coach, 'GET', '/api/inventory');
  check('inventory starts empty', r.status === 200 && Array.isArray(r.json.items) && r.json.items.length === 0,
    r.json && r.json.items && r.json.items.length);
  r = await api(coach, 'POST', '/api/inventory', { name: 'Championship blocks', category: 'Starting Blocks', quantity: 8, condition: 'Good', location: 'Track shed', note: 'Moye-style' });
  check('inventory create is 201', r.status === 201, r.status);
  const invBlocks = r.json.item.id;
  check('inventory item keeps its fields',
    r.json.item.name === 'Championship blocks' && r.json.item.category === 'Starting Blocks' &&
    r.json.item.quantity === 8 && r.json.item.condition === 'Good' &&
    r.json.item.location === 'Track shed' && !!r.json.item.updatedAt, r.json.item);
  r = await api(coach, 'POST', '/api/inventory', { name: 'Practice hurdles', category: 'Hurdles', quantity: 40, condition: 'Replace', location: 'Track shed', note: 'Two bent uprights' });
  const invHurdles = r.json.item.id;
  r = await api(coach, 'POST', '/api/inventory', { name: 'Relay batons', category: 'Relay Batons', quantity: 12, condition: 'Fair', location: 'Coach office', note: '' });
  const invBatons = r.json.item.id;

  r = await api(coach, 'GET', '/api/inventory');
  check('inventory lists the three items', r.status === 200 && r.json.items.length === 3,
    r.json.items && r.json.items.length);
  check('inventory sorts by category then name',
    r.json.items.map(i => i.id).join(',') === [invHurdles, invBatons, invBlocks].join(','),
    r.json.items.map(i => i.name));
  const invSummary = {
    types: r.json.items.length,
    units: r.json.items.reduce((s, i) => s + i.quantity, 0),
    replace: r.json.items.filter(i => i.condition === 'Replace').length,
  };
  check('inventory summary matches what was created',
    invSummary.types === 3 && invSummary.units === 60 && invSummary.replace === 1, invSummary);

  r = await api(coach, 'PUT', '/api/inventory/' + invBlocks, { quantity: 6, condition: 'Fair' });
  check('inventory update is 200 with new values',
    r.status === 200 && r.json.item.quantity === 6 && r.json.item.condition === 'Fair' &&
    r.json.item.name === 'Championship blocks', r.json);
  r = await api(coach, 'GET', '/api/inventory');
  check('inventory totals reflect the update',
    r.json.items.reduce((s, i) => s + i.quantity, 0) === 58, r.json.items.map(i => i.quantity));

  r = await api(coach, 'POST', '/api/inventory', { category: 'Hurdles', quantity: 1, condition: 'Good' });
  check('inventory missing name is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/inventory', { name: 'Neg', category: 'Hurdles', quantity: -1, condition: 'Good' });
  check('inventory negative quantity is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/inventory', { name: 'Frac', category: 'Hurdles', quantity: 2.5, condition: 'Good' });
  check('inventory fractional quantity is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/inventory', { name: 'BadCat', category: 'Widgets', quantity: 1, condition: 'Good' });
  check('inventory bad category is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/inventory', { name: 'BadCond', category: 'Hurdles', quantity: 1, condition: 'Minty' });
  check('inventory bad condition is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/inventory/' + invBlocks, { condition: 'Broken' });
  check('inventory update with bad condition is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/inventory/does-not-exist', { quantity: 1 });
  check('inventory update of unknown id is 404', r.status === 404, r.status);
  r = await api(coach, 'DELETE', '/api/inventory/does-not-exist');
  check('inventory delete of unknown id is 404', r.status === 404, r.status);

  r = await api(coach, 'DELETE', '/api/inventory/' + invBatons);
  check('inventory delete is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/inventory');
  check('inventory no longer lists the deleted item',
    r.json.items.length === 2 && !r.json.items.some(i => i.id === invBatons),
    r.json.items && r.json.items.length);

  /* ---------------- assistant coach invites ---------------- */
  r = await api(athlete, 'GET', '/api/coach-invites');
  check('athlete is 403 on the invite list', r.status === 403, r.status);
  r = await api(athlete, 'POST', '/api/coach-invites', { email: 'sneak@test.com' });
  check('athlete cannot invite (403)', r.status === 403, r.status);
  r = await api(coach, 'GET', '/api/me');
  check('/api/me marks the first account as owner', r.json.isOwner === true, r.json);
  const ownerId = r.json.id;

  // Invite BEFORE registration, with messy case and spacing.
  r = await api(coach, 'POST', '/api/coach-invites', { email: '  NewCoach@Test.com ' });
  check('owner invite is 200', r.status === 200, r.status);
  check('invite email is trimmed + lowercased', (r.json.invites || []).includes('newcoach@test.com'), r.json.invites);
  r = await api(coach, 'POST', '/api/coach-invites', { email: 'NEWCOACH@test.com' });
  check('duplicate invite (different case) is a no-op', r.status === 200 && r.json.alreadyInvited === true, r.json);
  r = await api(coach, 'GET', '/api/coach-invites');
  check('invite list still holds exactly one entry', (r.json.invites || []).filter(e => e === 'newcoach@test.com').length === 1, r.json.invites);
  r = await api(coach, 'POST', '/api/coach-invites', { email: 'not-an-email' });
  check('invite with a bad email is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/coach-invites', { email: 'coach@test.com' });
  check('inviting the owner email is 400', r.status === 400, r.status);

  // The invited email registers straight into coach access.
  r = await api(null, 'POST', '/api/register', { email: 'NewCoach@Test.com', password: 'testpass123' });
  check('invite-before-registration lands as coach', r.status === 201 && r.json.role === 'coach', r.json);
  check('invited coach is not the owner', r.json.isOwner === false, r.json);
  const assistant = cookieOf(r);
  r = await api(assistant, 'GET', '/api/groups');
  check('assistant coach reaches team data (200)', r.status === 200, r.status);

  // A non-owner coach can view invites but never manage them.
  r = await api(assistant, 'GET', '/api/coach-invites');
  check('non-owner coach can view invites + coaches', r.status === 200 && Array.isArray(r.json.invites) && (r.json.coaches || []).some(u => u.email === 'newcoach@test.com'), r.json);
  r = await api(assistant, 'POST', '/api/coach-invites', { email: 'third@test.com' });
  check('non-owner coach cannot invite (403)', r.status === 403, r.status);
  r = await api(assistant, 'DELETE', '/api/coach-invites/newcoach@test.com');
  check('non-owner coach cannot remove (403)', r.status === 403, r.status);

  // The owner can never be downgraded or removed, by either route.
  r = await api(coach, 'PUT', '/api/users/' + ownerId + '/role', { role: 'athlete' });
  check('owner cannot be downgraded via the role endpoint (400)', r.status === 400, r.status);
  r = await api(coach, 'DELETE', '/api/coach-invites/coach@test.com');
  check('owner cannot be removed via invites (400)', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/me');
  check('owner is still coach after both attempts', r.json.role === 'coach', r.json);

  // Invite AFTER registration upgrades the existing account at once —
  // the athlete's original session cookie sees it on the next request,
  // because roles resolve fresh from the store per request.
  r = await api(coach, 'POST', '/api/coach-invites', { email: 'Athlete@Test.com' });
  check('inviting an existing account is 200 + upgraded', r.status === 200 && r.json.upgraded === true, r.json);
  r = await api(athlete, 'GET', '/api/me');
  check('upgraded account reads coach on its next request', r.json.role === 'coach', r.json);
  r = await api(athlete, 'GET', '/api/groups');
  check('upgraded account reaches team data', r.status === 200, r.status);

  // Revoking downgrades immediately: team endpoints 403 again.
  r = await api(coach, 'DELETE', '/api/coach-invites/' + encodeURIComponent('ATHLETE@test.com'));
  check('revoke reports the downgrade', r.status === 200 && r.json.downgraded === true, r.json);
  r = await api(athlete, 'GET', '/api/groups');
  check('revoked account is 403 on team data again', r.status === 403, r.status);
  r = await api(athlete, 'GET', '/api/me');
  check('revoked account reads athlete again', r.json.role === 'athlete', r.json);

  // Removing a pending invite means a later registration is athlete.
  r = await api(coach, 'POST', '/api/coach-invites', { email: 'pending@test.com' });
  check('pending invite is added', r.status === 200, r.status);
  r = await api(coach, 'DELETE', '/api/coach-invites/pending@test.com');
  check('pending invite is removed', r.status === 200 && r.json.removedInvite === true, r.json);
  r = await api(null, 'POST', '/api/register', { email: 'pending@test.com', password: 'testpass123' });
  check('registering after the invite was revoked is athlete', r.status === 201 && r.json.role === 'athlete', r.json);
  r = await api(coach, 'DELETE', '/api/coach-invites/ghost@test.com');
  check('removing an unknown email is 404', r.status === 404, r.status);

  /* ---------------- warm-up card editor ---------------- */
  // The shipped cards live in the page; the editor wiring lives in the JS.
  check('warm-up card shell is unchanged (3 cards + print buttons)',
    pageHtml.text.includes('id="wu-card-1"') && pageHtml.text.includes('id="wu-card-2"') &&
    pageHtml.text.includes('id="wu-card-3"') && pageHtml.text.includes('data-print-card="wu-card-1"') &&
    pageHtml.text.includes('data-print-card="wu-card-2"') && pageHtml.text.includes('data-print-card="wu-card-3"'));
  check('warm-up editor wiring is in the served JS',
    appJs.text.includes('Edit this card') && appJs.text.includes('/api/warmup-cards') &&
    appJs.text.includes('/api/coach/warmup-cards/'));

  r = await api(null, 'GET', '/api/warmup-cards');
  check('warm-up cards start with no edits for a fresh viewer',
    r.status === 200 && r.json.cards && Object.keys(r.json.cards).length === 0, r.json);
  r = await api(null, 'GET', '/api/coach/warmup-cards');
  check('warm-up coach state without login is 401', r.status === 401, r.status);
  r = await api(null, 'PUT', '/api/coach/warmup-cards/wu-card-1', { sections: [] });
  check('warm-up save without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/coach/warmup-cards');
  check('athlete is 403 on the warm-up coach state', r.status === 403, r.status);
  r = await api(athlete, 'PUT', '/api/coach/warmup-cards/wu-card-1', { sections: [] });
  check('athlete is 403 on warm-up save', r.status === 403, r.status);
  r = await api(athlete, 'DELETE', '/api/coach/warmup-cards/wu-card-1');
  check('athlete is 403 on warm-up reset', r.status === 403, r.status);

  r = await api(coach, 'GET', '/api/coach/warmup-cards');
  check('coach state lists all three cards, none edited',
    r.status === 200 && r.json.cards.length === 3 &&
    r.json.cards.every(c => c.edited === false && c.sections === null),
    r.json && r.json.cards);

  /* An edit of Card 1 (Light): section 1 gains a marker item (add),
     section 2 swaps its first two items (reorder) and drops
     "Walking quad pulls" (remove). */
  const wuEdit1 = {
    sections: [
      { items: [
        { name: 'Jog', detail: '400-800m easy \u2014 relaxed shoulders, easy breathing' },
        { name: 'Skipping', detail: '2 x 20m \u2014 regular skip and arm-swing skip only, keep it light' },
        { name: 'Test Marker Drill', detail: '2 x 20m \u2014 restart marker' },
      ] },
      { items: [
        { name: 'Lateral leg swings', detail: '10 per leg \u2014 hips stay square while the leg opens and closes' },
        { name: 'Forward leg swings', detail: '10 per leg \u2014 tall posture, no trunk swing' },
        { name: 'Walking knee hugs', detail: '15-20m \u2014 rise onto the toe of the stance leg' },
        { name: 'Hip circles', detail: '5 each direction, per leg \u2014 knee at 90 degrees, big controlled circle' },
        { name: 'Karaoke', detail: '20m each direction, easy \u2014 opens the hips, stay light on your feet' },
      ] },
      { items: [
        { name: 'Ankle dribbles', detail: '20m \u2014 short quick steps on the balls of the feet' },
        { name: 'Relaxed strides', detail: '2 x 60m at about 70% \u2014 finish each stride slightly faster, stay relaxed' },
      ] },
      { items: [
        { name: 'Breathing easy', detail: 'you can talk in full sentences' },
      ] },
    ],
  };
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-1', wuEdit1);
  check('coach warm-up save is 200', r.status === 200 && r.json.ok === true, r.status);
  r = await api(null, 'GET', '/api/warmup-cards');
  const pubCard1 = r.json.cards && r.json.cards['wu-card-1'];
  check('fresh viewer sees the edited card, others untouched',
    r.status === 200 && !!pubCard1 && !r.json.cards['wu-card-2'] && !r.json.cards['wu-card-3'],
    r.json && Object.keys(r.json.cards || {}));
  check('edited card shows the add, the reorder, and the removal',
    !!pubCard1 &&
    pubCard1.sections[0].items.some(i => i.name === 'Test Marker Drill') &&
    pubCard1.sections[1].items.map(i => i.name).join('|') ===
      'Lateral leg swings|Forward leg swings|Walking knee hugs|Hip circles|Karaoke' &&
    !JSON.stringify(pubCard1).includes('Walking quad pulls'),
    pubCard1 && pubCard1.sections[1].items.map(i => i.name));
  r = await api(coach, 'GET', '/api/coach/warmup-cards');
  check('coach state flags card 1 as edited only',
    r.status === 200 &&
    r.json.cards.find(c => c.id === 'wu-card-1').edited === true &&
    r.json.cards.find(c => c.id === 'wu-card-2').edited === false,
    r.json.cards);

  // An assistant (non-owner) coach can edit too — that is the point.
  const wuEdit3 = {
    sections: [
      { items: [{ name: 'Jog', detail: '400m easy' }] },
      { items: [{ name: 'Leg swings', detail: 'forward + lateral, 10 per leg' }] },
      { items: [{ name: 'Glute bridges', detail: 'x 10' }] },
      { items: [{ name: 'Easy strides or spin', detail: '2 x 60m relaxed' }] },
    ],
  };
  r = await api(assistant, 'PUT', '/api/coach/warmup-cards/wu-card-3', wuEdit3);
  check('assistant coach can save a warm-up edit', r.status === 200 && r.json.ok === true, r.status);
  r = await api(null, 'GET', '/api/warmup-cards');
  check('assistant edit is live for fresh viewers',
    !!(r.json.cards && r.json.cards['wu-card-3']), r.json && Object.keys(r.json.cards || {}));
  r = await api(coach, 'DELETE', '/api/coach/warmup-cards/wu-card-3');
  check('owner reset of the assistant edit is 200', r.status === 200 && r.json.reset === true, r.json);

  // Invalid payloads are clean 400s.
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-9', wuEdit1);
  check('warm-up save with a bad card id is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-2', { sections: wuEdit1.sections.slice(0, 3) });
  check('warm-up save with the wrong section count is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-2', { sections: 'nope' });
  check('warm-up save with non-array sections is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-2',
    { sections: [{ items: [{ name: '   ' }] }, { items: [] }, { items: [] }, { items: [] }] });
  check('warm-up save with an empty item name is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-2',
    { sections: [{ items: [{ name: 'x'.repeat(81) }] }, { items: [] }, { items: [] }, { items: [] }] });
  check('warm-up save with an oversized name is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-2',
    { sections: [{ items: [{ name: 'Ok', detail: 'x'.repeat(241) }] }, { items: [] }, { items: [] }, { items: [] }] });
  check('warm-up save with an oversized detail is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-2',
    { sections: [{ items: Array.from({ length: 31 }, (_, i) => ({ name: 'Item ' + i })) }, { items: [] }, { items: [] }, { items: [] }] });
  check('warm-up save with too many items in a section is 400', r.status === 400, r.status);
  r = await api(coach, 'DELETE', '/api/coach/warmup-cards/wu-card-9');
  check('warm-up reset with a bad card id is 400', r.status === 400, r.status);
  r = await api(null, 'GET', '/api/warmup-cards');
  check('the invalid saves changed nothing',
    r.status === 200 && !!r.json.cards['wu-card-1'] && !r.json.cards['wu-card-2'],
    r.json && Object.keys(r.json.cards || {}));

  // Reset restores the shipped card: the override disappears.
  r = await api(coach, 'DELETE', '/api/coach/warmup-cards/wu-card-1');
  check('warm-up reset is 200 and reports the reset', r.status === 200 && r.json.reset === true, r.json);
  r = await api(null, 'GET', '/api/warmup-cards');
  check('after reset a fresh viewer gets the shipped card again',
    r.status === 200 && Object.keys(r.json.cards).length === 0, r.json);
  r = await api(coach, 'DELETE', '/api/coach/warmup-cards/wu-card-1');
  check('resetting an unedited card is a clean no-op', r.status === 200 && r.json.reset === false, r.json);

  // Save once more so the restart check below can prove persistence.
  r = await api(coach, 'PUT', '/api/coach/warmup-cards/wu-card-1', wuEdit1);
  check('coach re-saves the card 1 edit for the restart check', r.status === 200, r.status);

  /* ---------------- TV board (weight-room display) ----------------
     The board is the Workout of the Day: one full-screen page per
     group, each page carrying the group's warm-up card and the
     complete session. It is a pure client of the coach today
     endpoint plus the app's own session/plan content — it adds no
     server surface — so the checks cover the served page/JS
     wiring, the gates on the one endpoint it reads, and the hard
     privacy rule: its render path never touches the aches-and-
     pains data. */
  check('TV board view is in the served page',
    pageHtml.text.includes('id="view-tv"') && pageHtml.text.includes('id="tv-main"') &&
    pageHtml.text.includes('id="tv-exit"') && pageHtml.text.includes('Exit TV board'));
  check('TV board is reachable from the Coach hub and the coach sub-nav',
    pageHtml.text.includes('data-view="tv"') && appJs.text.includes("['tv', 'TV Board']") &&
    appJs.text.includes("tv: 'coachhub'"));
  check('TV board entry button is on the coach checklist view',
    appJs.text.includes('coach-open-tv') && appJs.text.includes("showView('tv')"));
  const tvStart = appJs.text.indexOf('TV BOARD');
  const tvEnd = appJs.text.indexOf('/* ---------------- boot', tvStart);
  const tvCode = tvStart >= 0 && tvEnd > tvStart ? appJs.text.slice(tvStart, tvEnd) : '';
  check('TV board code block is present in the served JS', tvCode.length > 500, tvCode.length);
  check('TV board reads only the coach today endpoint (no tracker or testing data)',
    tvCode.includes('/api/coach/today') && !tvCode.includes('/api/weekly/dashboard') &&
    !tvCode.includes('/api/tests') && !tvCode.includes('/api/results'));
  check('TV board has no leaderboard panel',
    !tvCode.toLowerCase().includes('leaderboard') && !tvCode.includes('tvBoards') &&
    !tvCode.includes('Testing results will appear here'));
  check('TV board render path never references aches-and-pains data',
    !tvCode.toLowerCase().includes('concern') && !tvCode.includes('healthFlags') &&
    !tvCode.includes('a.note'));
  check('TV board header is the Workout of the Day',
    tvCode.includes('Workout of the Day') && tvCode.includes('tvWodHeaderHtml'));
  check('TV board builds one page per group from its units',
    tvCode.includes('tvGroupUnits') && tvCode.includes('tvPageHtml') && tvCode.includes('tv-page'));
  check('TV board rotates between group pages (~20s) and pauses on interaction',
    tvCode.includes('TV_ROTATE_MS = 20000') && tvCode.includes('setInterval') &&
    tvCode.includes('tvPaused') && tvCode.includes('pointerdown'));
  check('TV board long pages split or auto-scroll instead of clipping type',
    tvCode.includes('tv-autoscroll') && tvCode.includes('--tv-scale') && tvCode.includes('TV_MIN_SCALE'));
  check('TV board honors reduced motion (no auto-rotation)',
    tvCode.includes('prefersReducedMotion'));
  check('TV board re-fetches its data about every 5 minutes',
    tvCode.includes('TV_REFRESH_MS = 5 * 60 * 1000'));
  check('TV board puts the warm-up inside each group page (live card, coach edits included)',
    tvCode.includes('cloneNode') && tvCode.includes('tv-wu-slot') && tvCode.includes('tvCardIdForGroup'));
  check('TV board renders the full session (spec grid and coaching cues)',
    tvCode.includes('tvSessionHtml') && tvCode.includes('Coaching cues') &&
    tvCode.includes('Total volume') && tvCode.includes('coaching_cues'));
  check('TV board rest day shows the no-workout page with the next training day',
    tvCode.includes('No workout today') && tvCode.includes('tvNextTrainingDay'));
  const acc01 = (contentJson.sessions || []).find(s => s.id === 'ACC-01');
  check('a known session carries the full detail the TV page renders',
    !!acc01 && !!acc01.coaching_cues && !!acc01.reps && !!acc01.rest,
    acc01 && acc01.id);
  r = await api(coach, 'GET', '/api/coach/today');
  check('TV board data source: coach reads today with its groups',
    r.status === 200 && Array.isArray(r.json.groups), r.status);
  r = await api(athlete, 'GET', '/api/coach/today');
  check('athlete is 403 on the today data the TV board reads', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/coach/today');
  check('today data without login is 401', r.status === 401, r.status);

  /* ---------------- reports, test-day grid, meet results ----------
     Fresh fixtures (own group + athletes) so every count is exact. */
  r = await api(coach, 'POST', '/api/groups', { name: 'Report Squad' });
  const gRep = r.json.group.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Amy', lastName: 'Report', groupId: gRep, events: ['sprinter'] });
  const amyR = r.json.profile.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Ben', lastName: 'Report', groupId: gRep, events: ['jumper'] });
  const benR = r.json.profile.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Cara', lastName: 'Nodata' });
  const caraR = r.json.profile.id;

  /* Empty-state reports: a fresh group and an athlete with no data. */
  r = await api(coach, 'GET', '/api/reports/completions');
  const repW1 = ((r.json.groups.find(g => g.group.id === gRep) || {}).weeks || []).find(w => w.monday === '2026-10-26');
  check('reports completions: fresh group week 1 has plan assignments, zero completions',
    !!repW1 && repW1.assigned === 6 && repW1.completions === 0 && repW1.completedDays === 0, repW1);
  r = await api(coach, 'GET', '/api/reports/athlete/' + caraR);
  check('report card for athlete with no data: empty sections, null percent',
    r.status === 200 && r.json.testing.length === 0 && r.json.weekly.length === 0 &&
    r.json.meetPrs.length === 0 && r.json.completions.percent === null &&
    r.json.completions.denominator === 0 && r.json.health.total === 0, r.json);
  r = await api(coach, 'GET', '/api/reports/athlete/nope');
  check('report card for unknown athlete is 404', r.status === 404, r.status);
  r = await api(coach, 'GET', '/api/reports/load');
  check('planned load report covers 29 weeks, each summing to 7 days',
    r.status === 200 && r.json.weeks.length === 29 &&
    r.json.weeks.every(w => w.high + w.low + w.off === 7), r.json.weeks[0]);
  r = await api(coach, 'GET', '/api/reports/team-trend');
  const ttPull = (r.json.tests || []).find(t => t.testKey === 'pull-ups');
  check('team trend includes tests with no results as empty point lists',
    !!ttPull && Array.isArray(ttPull.points) && ttPull.points.length === 0, ttPull);

  /* ---- test-day rapid entry grid (bulk save) ---- */
  r = await api(coach, 'POST', '/api/test-days', { date: '2026-11-09', title: 'Report Day 1', testKeys: ['back-squat', 'vertical-jump'] });
  const rDay1 = r.json.testDay.id;
  r = await api(coach, 'POST', '/api/test-days', { date: '2027-02-08', title: 'Report Day 2', testKeys: ['back-squat', 'vertical-jump'] });
  const rDay2 = r.json.testDay.id;
  r = await api(coach, 'POST', '/api/results/bulk', {
    testDayId: rDay1,
    entries: [
      { profileId: amyR, testKey: 'back-squat', weight: 200, reps: 5 },
      { profileId: benR, testKey: 'back-squat', weight: 150, reps: 5 },
      { profileId: amyR, testKey: 'vertical-jump', value: 24 },
      { profileId: benR, testKey: 'vertical-jump', value: 28 },
    ],
  });
  check('bulk grid save writes the whole grid', r.status === 200 && r.json.saved === 4 && r.json.created === 4, r.json);
  r = await api(coach, 'GET', '/api/results?testDayId=' + rDay1);
  check('bulk save prefills: 4 results on the day', r.status === 200 && r.json.results.length === 4,
    r.json.results && r.json.results.length);
  const amySquat1 = r.json.results.find(x => x.profileId === amyR && x.testKey === 'back-squat');
  check('bulk lift went through Epley (200x5 = 233)', !!amySquat1 && amySquat1.est1rm === 233, amySquat1);
  r = await api(coach, 'POST', '/api/results/bulk', {
    testDayId: rDay1,
    entries: [{ profileId: amyR, testKey: 'back-squat', weight: 205, reps: 5 }],
  });
  check('bulk re-save updates instead of duplicating', r.status === 200 && r.json.updated === 1 && r.json.created === 0, r.json);
  r = await api(coach, 'POST', '/api/results/bulk', {
    testDayId: rDay1,
    entries: [
      { profileId: benR, testKey: 'vertical-jump', value: -2 },
      { profileId: amyR, testKey: 'back-squat', weight: 999, reps: 40 },
    ],
  });
  check('bulk save with bad cells is 400 with one precise error per cell',
    r.status === 400 && Array.isArray(r.json.cellErrors) && r.json.cellErrors.length === 2 &&
    r.json.cellErrors.some(e => e.profileId === benR && e.testKey === 'vertical-jump') &&
    r.json.cellErrors.some(e => e.profileId === amyR && e.testKey === 'back-squat'), r.json);
  r = await api(coach, 'GET', '/api/results?testDayId=' + rDay1);
  const benVjAfter = r.json.results.find(x => x.profileId === benR && x.testKey === 'vertical-jump');
  const amySquatAfter = r.json.results.find(x => x.profileId === amyR && x.testKey === 'back-squat');
  check('rejected bulk save wrote nothing (benR jump still 28, amyR squat still 239)',
    !!benVjAfter && benVjAfter.value === 28 && !!amySquatAfter && amySquatAfter.est1rm === 239,
    { benR: benVjAfter, amyR: amySquatAfter });
  r = await api(coach, 'POST', '/api/results/bulk', {
    testDayId: rDay1,
    entries: [{ profileId: amyR, testKey: 'hang-clean', weight: 100 }],
  });
  check('bulk cell for a test not on the day is a precise 400',
    r.status === 400 && r.json.cellErrors.length === 1 && /not part of that test day/.test(r.json.cellErrors[0].error), r.json);
  r = await api(coach, 'POST', '/api/results/bulk', { testDayId: 'nope', entries: [] });
  check('bulk save for unknown test day is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/results/bulk', {
    testDayId: rDay1,
    entries: [
      { profileId: amyR, testKey: 'vertical-jump', value: 25 },
      { profileId: amyR, testKey: 'vertical-jump', value: 26 },
    ],
  });
  check('bulk save with a duplicated cell is 400', r.status === 400 && r.json.cellErrors.length === 1, r.json);
  r = await api(athlete, 'POST', '/api/results/bulk', { testDayId: rDay1, entries: [] });
  check('athlete is 403 on bulk save', r.status === 403, r.status);
  r = await api(coach, 'POST', '/api/results/bulk', {
    testDayId: rDay2,
    entries: [
      { profileId: amyR, testKey: 'back-squat', weight: 210, reps: 5 },
      { profileId: benR, testKey: 'back-squat', weight: 160, reps: 5 },
    ],
  });
  check('bulk save on day 2 is 200', r.status === 200 && r.json.saved === 2, r.json);
  r = await api(coach, 'POST', '/api/results/bulk', {
    testDayId: rDay1, clear: [{ profileId: amyR, testKey: 'vertical-jump' }],
  });
  check('bulk clear removes a saved cell', r.status === 200 && r.json.cleared === 1, r.json);
  r = await api(coach, 'GET', '/api/results?testDayId=' + rDay1);
  check('cleared cell is gone from the day',
    !r.json.results.some(x => x.profileId === amyR && x.testKey === 'vertical-jump'), r.json.results.length);

  /* ---- reports calculations ---- */
  r = await api(coach, 'GET', '/api/reports/team-trend');
  const ttSquat = r.json.tests.find(t => t.testKey === 'back-squat');
  const sqD1 = ttSquat.points.find(p => p.testDayId === rDay1);
  const sqD2 = ttSquat.points.find(p => p.testDayId === rDay2);
  check('team trend median across a test day (day 1 squat = 207 of 239+175)',
    !!sqD1 && sqD1.median === 207 && sqD1.count === 2, sqD1);
  check('team trend median across a test day (day 2 squat = 216 of 245+187)',
    !!sqD2 && sqD2.median === 216 && sqD2.count === 2, sqD2);
  const ttVj = r.json.tests.find(t => t.testKey === 'vertical-jump');
  const vjD1 = ttVj.points.find(p => p.testDayId === rDay1);
  check('team trend reflects the cleared cell (day 1 jump median 28, n=1)',
    !!vjD1 && vjD1.median === 28 && vjD1.count === 1, vjD1);
  await api(coach, 'POST', '/api/completions', { profileId: amyR, date: '2026-10-26' });
  await api(coach, 'POST', '/api/completions', { profileId: amyR, date: '2026-10-28' });
  r = await api(coach, 'GET', '/api/reports/completions');
  const repW1b = ((r.json.groups.find(g => g.group.id === gRep) || {}).weeks || []).find(w => w.monday === '2026-10-26');
  check('reports completions counts the group week (2 completions, 2 days, 6 assigned)',
    !!repW1b && repW1b.completions === 2 && repW1b.completedDays === 2 && repW1b.assigned === 6, repW1b);
  r = await api(coach, 'GET', '/api/reports/athlete/' + amyR);
  const amySquatTest = r.json.testing.find(t => t.testKey === 'back-squat') || {};
  check('athlete report: testing series, best and latest from Epley displays',
    r.status === 200 && (amySquatTest.series || []).length === 2 &&
    amySquatTest.best === 245 && amySquatTest.latest === 245, r.json.testing);
  check('athlete report: completion totals are honest (2 recorded; percent null or 0-100)',
    r.json.completions.total === 2 && (r.json.completions.percent === null ||
      (r.json.completions.percent >= 0 && r.json.completions.percent <= 100)), r.json.completions);
  r = await api(coach, 'POST', '/api/concerns', { profileId: amyR, area: 'knee', side: 'left', feeling: 'ache', pain: 4, started: '2026-12-01', impact: 'modified' });
  const amyConcern1 = r.json.concern.id;
  await api(coach, 'PUT', '/api/concerns/' + amyConcern1, { status: 'monitoring' });
  r = await api(coach, 'POST', '/api/concerns', { profileId: amyR, area: 'ankle', side: 'right', feeling: 'soreness', pain: 2, started: '2026-12-02', impact: 'none' });
  const amyConcern2 = r.json.concern.id;
  await api(coach, 'PUT', '/api/concerns/' + amyConcern2, { status: 'cleared' });
  r = await api(coach, 'GET', '/api/reports/athlete/' + amyR);
  check('athlete report: health counts by status',
    r.json.health.open === 0 && r.json.health.monitoring === 1 &&
    r.json.health.cleared === 1 && r.json.health.total === 2, r.json.health);
  r = await api(coach, 'GET', '/api/reports/health');
  check('health overview totals equal the sum of statuses and of months opened',
    r.json.total === r.json.byStatus.new + r.json.byStatus.monitoring + r.json.byStatus.cleared &&
    r.json.byMonth.reduce((s, m) => s + m.opened, 0) === r.json.total, r.json);

  /* ---- meet results ---- */
  r = await api(coach, 'GET', '/api/meet-events');
  check('meet events list has 19 events with directions',
    r.status === 200 && r.json.events.length === 19 &&
    r.json.events.find(e => e.key === '100m').better === 'lower' &&
    r.json.events.find(e => e.key === 'long-jump').better === 'higher', r.json.events.length);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2026-12-05', meet: 'Winter Invite', event: '100m', mark: '11.20' });
  check('meet result create is 201 with normalized seconds', r.status === 201 && r.json.result.value === 11.2, r.json);
  const amyRun1 = r.json.result.id;
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2026-12-12', meet: 'Holiday Classic', event: '100m', mark: '11.45' });
  const amyRun2 = r.json.result.id;
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2026-12-12', meet: 'Holiday Classic', event: 'long-jump', mark: '21-06.5' });
  check('feet-inches mark normalizes to inches (21-06.5 = 258.5)', r.status === 201 && r.json.result.value === 258.5, r.json);
  await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2027-01-09', meet: 'New Year Open', event: 'long-jump', mark: '20-11' });
  await api(coach, 'POST', '/api/meet-results', { profileId: benR, date: '2026-12-12', meet: 'Holiday Classic', event: 'long-jump', mark: '22-01' });
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2027-01-09', meet: 'New Year Open', event: '800m', mark: '1:55.20' });
  check('minutes:seconds time normalizes (1:55.20 = 115.2)', r.status === 201 && r.json.result.value === 115.2, r.json);
  r = await api(coach, 'GET', '/api/meet-results/prs?profileId=' + amyR);
  const amyPr100 = r.json.prs.find(p => p.event === '100m');
  const amyPrLj = r.json.prs.find(p => p.event === 'long-jump');
  check('a slower time never becomes the PR (100m PR stays 11.20)',
    !!amyPr100 && amyPr100.mark === '11.20' && amyPr100.value === 11.2, amyPr100);
  check('a shorter jump never becomes the PR (LJ PR stays 21-06.5)',
    !!amyPrLj && amyPrLj.mark === '21-06.5' && amyPrLj.value === 258.5, amyPrLj);
  const amyLjSeries = r.json.series.find(s => s.event === 'long-jump');
  check('PR progression series is chronological with both marks',
    !!amyLjSeries && amyLjSeries.points.length === 2 &&
    amyLjSeries.points[0].date === '2026-12-12' && amyLjSeries.points[1].date === '2027-01-09', amyLjSeries);
  r = await api(coach, 'GET', '/api/meet-results/board');
  const boardLj = r.json.board.find(b => b.event === 'long-jump');
  const board100 = r.json.board.find(b => b.event === '100m');
  check('team PR board takes the best per event across the roster',
    !!boardLj && boardLj.profileId === benR && boardLj.mark === '22-01' &&
    !!board100 && board100.profileId === amyR && board100.mark === '11.20', r.json.board);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2027-01-09', meet: 'X', event: '100m', mark: 'fast' });
  check('unparseable time is a clean 400', r.status === 400 && /could not be read/.test(r.json.error || ''), r.json);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2027-01-09', meet: 'X', event: 'long-jump', mark: '21-13' });
  check('impossible feet-inches (21-13) is a clean 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2027-01-09', meet: 'X', event: 'marathon', mark: '2:00:00' });
  check('unknown meet event is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: 'nope', date: '2027-01-09', meet: 'X', event: '100m', mark: '11.00' });
  check('meet result for unknown athlete is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2026-02-30', meet: 'X', event: '100m', mark: '11.00' });
  check('meet result with Feb 30 is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2027-01-09', meet: '', event: '100m', mark: '11.00' });
  check('meet result without a meet name is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/meet-results/' + amyRun2, { mark: '11.05' });
  check('meet edit re-normalizes the mark', r.status === 200 && r.json.result.value === 11.05, r.json);
  r = await api(coach, 'GET', '/api/meet-results/prs?profileId=' + amyR);
  check('edited mark becomes the PR', r.json.prs.find(p => p.event === '100m').mark === '11.05', r.json.prs);
  r = await api(coach, 'PUT', '/api/meet-results/' + amyRun2, { mark: 'bogus' });
  check('meet edit with an unparseable mark is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/meet-results/prs?profileId=' + amyR);
  check('failed edit changed nothing (PR still 11.05)', r.json.prs.find(p => p.event === '100m').mark === '11.05', r.json.prs);
  r = await api(coach, 'DELETE', '/api/meet-results/' + amyRun1);
  check('meet result delete is 200', r.status === 200, r.status);
  r = await api(coach, 'DELETE', '/api/meet-results/' + amyRun1);
  check('meet result delete twice is 404', r.status === 404, r.status);
  r = await api(athlete, 'POST', '/api/meet-results', { profileId: amyR, date: '2027-01-09', meet: 'X', event: '100m', mark: '11.00' });
  check('athlete is 403 on meet result create', r.status === 403, r.status);
  r = await api(athlete, 'GET', '/api/meet-results');
  check('athlete is 403 on meet results list', r.status === 403, r.status);
  r = await api(athlete, 'GET', '/api/reports/team-trend');
  check('athlete is 403 on reports', r.status === 403, r.status);
  r = await api(athlete, 'GET', '/api/meet-results/board');
  check('athlete is 403 on the PR board', r.status === 403, r.status);
  const meetCsv = await apiText(coach, '/api/export/meet-results.csv');
  check('meet results CSV exports with header and rows',
    meetCsv.status === 200 && meetCsv.type.includes('text/csv') &&
    meetCsv.text.startsWith('Date,Meet,Athlete,Group,Event,Mark') &&
    meetCsv.text.includes('Long Jump') && meetCsv.text.includes('22-01'), meetCsv.text.slice(0, 120));
  check('reports and meet views are in the served page',
    pageHtml.text.includes('id="view-reports"') && pageHtml.text.includes('id="view-meets"') &&
    pageHtml.text.includes('data-view="reports"') && pageHtml.text.includes('data-view="meets"'));
  check('reports/meet/grid wiring is in the served JS',
    appJs.text.includes('renderReports') && appJs.text.includes('renderMeets') &&
    appJs.text.includes('/api/results/bulk') && appJs.text.includes('/api/reports/athlete/') &&
    appJs.text.includes('/api/meet-results'));

  /* ---- school record board (top 10) ---- */
  r = await api(null, 'GET', '/api/record-events');
  check('record events are public: 23 events (19 meet + 4 relays)',
    r.status === 200 && r.json.events.length === 23 &&
    r.json.events.find(e => e.key === '1600m') && r.json.events.find(e => e.key === '3200m') &&
    r.json.events.filter(e => e.relay).map(e => e.key).join(',') === '4x100m,4x200m,4x400m,4x800m',
    r.json.events && r.json.events.length);
  r = await api(coach, 'GET', '/api/meet-events');
  check('meet events include 1600m/3200m but never the relays',
    r.status === 200 && r.json.events.some(e => e.key === '1600m') &&
    r.json.events.some(e => e.key === '3200m') &&
    !r.json.events.some(e => e.key.startsWith('4x')), r.json.events.length);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: amyR, date: '2027-01-09', meet: 'X', event: '4x100m', mark: '43.50' });
  check('a relay can never be entered as an individual meet result', r.status === 400, r.status);
  r = await api(null, 'GET', '/api/records/board');
  check('record board is public and starts empty',
    r.status === 200 && r.json.board.length === 23 &&
    r.json.board.every(b => Array.isArray(b.entries) && b.entries.length === 0), r.json.board && r.json.board.length);
  r = await api(null, 'GET', '/api/records');
  check('records list is a public read, empty at first', r.status === 200 && r.json.records.length === 0, r.status);

  /* Promotion source, before any records exist: Amy owns the 100m
     roster best (11.05 from the meet section), Ben the long jump. */
  r = await api(coach, 'GET', '/api/records/roster-best');
  const rb100 = r.json.best.find(b => b.event === '100m');
  const rbLj = r.json.best.find(b => b.event === 'long-jump');
  const rbRelay = r.json.best.find(b => b.event === '4x100m');
  check('roster best for the 100m is Amy at 11.05, would rank #1 on an empty board',
    !!rb100 && rb100.best && rb100.best.profileId === amyR && rb100.best.value === 11.05 &&
    rb100.rank === 1 && rb100.makesBoard === true, rb100);
  check('roster best for the long jump is Ben at 22-01',
    !!rbLj && rbLj.best && rbLj.best.profileId === benR && rbLj.best.mark === '22-01', rbLj);
  check('relays have no roster-best source', !!rbRelay && rbRelay.best === null && rbRelay.rank === null, rbRelay);
  r = await api(athlete, 'GET', '/api/records/roster-best');
  check('athlete is 403 on the roster-best helper', r.status === 403, r.status);

  /* The one-tap promotion, exactly as the client sends it. */
  r = await api(coach, 'POST', '/api/records', {
    event: '100m', mark: '11.05', name: 'Amy Report', profileId: amyR,
    meet: 'Holiday Classic', date: '2026-12-12', year: 2026,
  });
  check('promotion creates a record prefilled from the meet result',
    r.status === 201 && r.json.record.profileId === amyR && r.json.record.value === 11.05 &&
    r.json.record.meet === 'Holiday Classic' && r.json.record.year === 2026 &&
    r.json.record.eventName === '100m', r.json);
  r = await api(coach, 'POST', '/api/records', { event: '100m', mark: '10.95', name: 'Old Timer', year: 1998 });
  check('record with a faster historic time is 201', r.status === 201 && r.json.record.value === 10.95, r.json);
  r = await api(coach, 'POST', '/api/records', { event: '100m', mark: '11.50', name: 'Slow Sam' });
  const samRec = r.json.record.id;
  r = await api(null, 'GET', '/api/records/board');
  const recBoard100 = r.json.board.find(b => b.event === '100m');
  check('time records rank fastest first with ranks 1-2-3',
    !!recBoard100 && recBoard100.entries.map(e => e.mark).join(',') === '10.95,11.05,11.50' &&
    recBoard100.entries.map(e => e.rank).join(',') === '1,2,3', recBoard100 && recBoard100.entries);
  r = await api(coach, 'GET', '/api/records/roster-best');
  check('after promotion + a faster historic mark, Amy would rank #2',
    r.json.best.find(b => b.event === '100m').rank === 2, r.json.best.find(b => b.event === '100m'));

  /* Field direction: longer beats shorter. */
  await api(coach, 'POST', '/api/records', { event: 'long-jump', mark: '20-00', name: 'Shorter Sal' });
  await api(coach, 'POST', '/api/records', { event: 'long-jump', mark: '21-06.5', name: 'Historic Hank', year: 2005 });
  r = await api(null, 'GET', '/api/records/board');
  const recBoardLj = r.json.board.find(b => b.event === 'long-jump');
  check('field records rank longest first',
    !!recBoardLj && recBoardLj.entries.map(e => e.mark).join(',') === '21-06.5,20-00', recBoardLj && recBoardLj.entries);

  /* Relay records live on the board (team marks, no profile). */
  r = await api(coach, 'POST', '/api/records', { event: '4x100m', mark: '43.50', name: 'Cadets 2019', year: 2019, meet: 'WCAC Championships' });
  check('relay record is 201 with normalized seconds', r.status === 201 && r.json.record.value === 43.5, r.json);
  r = await api(null, 'GET', '/api/records/board');
  const recBoardRelay = r.json.board.find(b => b.event === '4x100m');
  check('relay record shows on the board', !!recBoardRelay && recBoardRelay.entries.length === 1 && recBoardRelay.entries[0].name === 'Cadets 2019', recBoardRelay);

  /* Validation: the shared parser guards every write. */
  r = await api(coach, 'POST', '/api/records', { event: '100m', mark: 'fast', name: 'X' });
  check('record with an unparseable time is a clean 400', r.status === 400 && /could not be read/.test(r.json.error || ''), r.json);
  r = await api(coach, 'POST', '/api/records', { event: 'long-jump', mark: '21-13', name: 'X' });
  check('record with impossible feet-inches (21-13) is a clean 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/records', { event: 'marathon', mark: '2:00:00', name: 'X' });
  check('record with an unknown event is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/records', { event: '100m', mark: '11.00', name: '' });
  check('record without a name is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/records', { event: '100m', mark: '11.00', name: 'X', year: 1800 });
  check('record with a year before 1950 is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/records', { event: '100m', mark: '11.00', name: 'X', profileId: 'nope' });
  check('record with an unknown profile is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/records', { event: '100m', mark: '11.00', name: 'X', date: '2026-02-30' });
  check('record with Feb 30 is 400', r.status === 400, r.status);

  /* Top-10 cut: eleven 200m marks, the slowest never shows. */
  for (let i = 0; i <= 10; i++) {
    await api(coach, 'POST', '/api/records', { event: '200m', mark: (21 + i * 0.1).toFixed(2), name: 'Two ' + i });
  }
  r = await api(null, 'GET', '/api/records/board');
  const recBoard200 = r.json.board.find(b => b.event === '200m');
  check('board caps an event at the top 10 and drops the 11th best',
    !!recBoard200 && recBoard200.entries.length === 10 &&
    recBoard200.entries[0].value === 21 && recBoard200.entries[9].value === 21.9 &&
    !recBoard200.entries.some(e => e.name === 'Two 10'), recBoard200 && recBoard200.entries.map(e => e.mark));

  /* Edit + delete, with the same validate-first discipline. */
  r = await api(coach, 'PUT', '/api/records/' + samRec, { mark: '11.30' });
  check('record edit re-normalizes the mark', r.status === 200 && r.json.record.value === 11.3, r.json);
  r = await api(null, 'GET', '/api/records/board');
  check('edited record re-ranks between its neighbours',
    r.json.board.find(b => b.event === '100m').entries.map(e => e.mark).join(',') === '10.95,11.05,11.30',
    r.json.board.find(b => b.event === '100m').entries);
  r = await api(coach, 'PUT', '/api/records/' + samRec, { mark: 'bogus' });
  check('record edit with an unparseable mark is 400', r.status === 400, r.status);
  r = await api(null, 'GET', '/api/records/board');
  check('failed record edit changed nothing',
    r.json.board.find(b => b.event === '100m').entries.map(e => e.mark).join(',') === '10.95,11.05,11.30');
  r = await api(coach, 'DELETE', '/api/records/' + samRec);
  check('record delete is 200', r.status === 200, r.status);
  r = await api(coach, 'DELETE', '/api/records/' + samRec);
  check('record delete twice is 404', r.status === 404, r.status);

  /* Gates: writes are coach-only; reads are for everyone. */
  r = await api(athlete, 'POST', '/api/records', { event: '100m', mark: '11.00', name: 'X' });
  check('athlete is 403 creating a record', r.status === 403, r.status);
  r = await api(athlete, 'PUT', '/api/records/' + samRec, { mark: '11.00' });
  check('athlete is 403 editing a record', r.status === 403, r.status);
  r = await api(athlete, 'DELETE', '/api/records/' + samRec);
  check('athlete is 403 deleting a record', r.status === 403, r.status);
  r = await api(athlete, 'GET', '/api/records/board');
  check('athlete can read the record board', r.status === 200, r.status);
  r = await api(null, 'POST', '/api/records', { event: '100m', mark: '11.00', name: 'X' });
  check('record create without login is 401', r.status === 401, r.status);
  check('records view is in the served page',
    pageHtml.text.includes('id="view-records"') && pageHtml.text.includes('data-view="records"'));
  check('records wiring is in the served JS',
    appJs.text.includes('renderRecords') && appJs.text.includes('/api/records'));

  /* ---- meet day hub ---- */
  r = await api(coach, 'GET', '/api/meets');
  check('meets list starts empty', r.status === 200 && r.json.meets.length === 0, r.json);
  r = await api(coach, 'POST', '/api/meets', { name: '', date: '2027-01-16' });
  check('meet without a name is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/meets', { name: 'X', date: '2026-02-30' });
  check('meet with Feb 30 is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/meets', { name: 'Winter Classic', date: '2027-01-16', location: 'Home Track' });
  check('meet create is 201 with its fields',
    r.status === 201 && r.json.meet.name === 'Winter Classic' &&
    r.json.meet.date === '2027-01-16' && r.json.meet.location === 'Home Track', r.json);
  const meet1 = r.json.meet.id;
  r = await api(coach, 'POST', '/api/meets', { name: 'Early Bird Open', date: '2027-01-23' });
  check('meet without a location is fine', r.status === 201 && r.json.meet.location === '', r.json);
  const meet2 = r.json.meet.id;
  r = await api(coach, 'PUT', '/api/meets/' + meet2, { location: 'Away Stadium' });
  check('meet edit updates the location', r.status === 200 && r.json.meet.location === 'Away Stadium', r.json);
  r = await api(coach, 'PUT', '/api/meets/' + meet2, { date: '2027-13-01' });
  check('meet edit with a bad date is 400 and changes nothing', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/meets/nope', { name: 'Ghost' });
  check('editing a missing meet is 404', r.status === 404, r.status);
  r = await api(coach, 'GET', '/api/meets/' + meet1);
  check('fresh meet detail is empty with an untouched checklist',
    r.status === 200 && r.json.entries.length === 0 && r.json.results.length === 0 &&
    r.json.checklist.entriesAdded === false && r.json.checklist.everyEventHasResult === false &&
    r.json.checklist.allResultsEntered === false &&
    r.json.summary.entries === 0 && r.json.summary.resultsEntered === 0 && r.json.summary.prs === 0, r.json);
  r = await api(coach, 'GET', '/api/meets/nope');
  check('missing meet detail is 404', r.status === 404, r.status);

  /* Entries */
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/entries', { profileId: amyR, event: '200m' });
  check('entry add is 201 with names resolved',
    r.status === 201 && r.json.entry.event === '200m' && r.json.entry.eventName === '200m' &&
    r.json.entry.athleteName === 'Amy Report', r.json);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/entries', { profileId: amyR, event: '200m' });
  check('duplicate entry (same athlete + event + meet) is a clear 400',
    r.status === 400 && /already entered/.test(r.json.error || ''), r.json);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/entries', { profileId: benR, event: '200m' });
  check('second athlete enters the same event fine', r.status === 201, r.status);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/entries', { profileId: amyR, event: 'shot-put' });
  check('same athlete can enter a second event', r.status === 201, r.status);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/entries', { profileId: amyR, event: 'marathon' });
  check('entry with an unknown event is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/entries', { profileId: 'nope', event: '200m' });
  check('entry for an unknown athlete is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/meets/nope/entries', { profileId: amyR, event: '200m' });
  check('entry on a missing meet is 404', r.status === 404, r.status);
  r = await api(coach, 'GET', '/api/meets/' + meet1);
  check('checklist after entries: first box only',
    r.json.checklist.entriesAdded === true &&
    r.json.checklist.everyEventHasResult === false &&
    r.json.checklist.allResultsEntered === false && r.json.summary.entries === 3, r.json.checklist);

  /* Quick results: validation rejects the whole batch */
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/results',
    { event: 'shot-put', marks: [{ profileId: benR, mark: '30-00' }] });
  check('a mark for an athlete not entered in the event is 400',
    r.status === 400 && /not entered/.test(r.json.error || ''), r.json);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/results',
    { event: '200m', marks: [{ profileId: amyR, mark: 'fast' }] });
  check('an unparseable quick mark is a clean 400', r.status === 400 && /could not be read/.test(r.json.error || ''), r.json);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/results', { event: '200m', marks: [] });
  check('an empty quick-results batch is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/meets/' + meet1);
  check('the rejected batches wrote nothing', r.json.results.length === 0 && r.json.summary.resultsEntered === 0, r.json.summary);

  /* Quick results land in meet results, flagged */
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/results',
    { event: '200m', marks: [{ profileId: amyR, mark: '24.10' }, { profileId: benR, mark: '24.50' }] });
  const save1 = Object.fromEntries((r.json.saved || []).map(s => [s.profileId, s]));
  check('first-ever marks flag as "first" for both athletes',
    r.status === 200 && save1[amyR] && save1[amyR].prStatus === 'first' &&
    save1[benR] && save1[benR].prStatus === 'first', r.json);
  check('quick save reports the running summary',
    r.json.summary.resultsEntered === 2 && r.json.checklist.everyEventHasResult === false, r.json);
  r = await api(coach, 'GET', '/api/meet-results?event=200m');
  check('quick results are visible through the meet-results endpoints',
    r.status === 200 && r.json.results.length === 2 &&
    r.json.results.every(x => x.meet === 'Winter Classic' && x.date === '2027-01-16'), r.json.results);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/results',
    { event: 'shot-put', marks: [{ profileId: amyR, mark: '30-06' }] });
  check('a first field mark flags as "first" (field direction)',
    r.status === 200 && r.json.saved[0].prStatus === 'first', r.json);
  r = await api(coach, 'GET', '/api/meets/' + meet1);
  check('checklist completes once every entry has a result; all three marks stand as PRs',
    r.json.checklist.everyEventHasResult === true && r.json.checklist.allResultsEntered === true &&
    r.json.summary.entries === 3 && r.json.summary.resultsEntered === 3 && r.json.summary.prs === 3, r.json);

  /* Ben picks up a shot-put mark at the first meet too — his
     previous best for the second-meet flag checks below. */
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/entries', { profileId: benR, event: 'shot-put' });
  check('Ben enters the shot at the first meet', r.status === 201, r.status);
  r = await api(coach, 'POST', '/api/meets/' + meet1 + '/results',
    { event: 'shot-put', marks: [{ profileId: benR, mark: '27-00' }] });
  check('Ben\'s first-ever shot mark flags "first"',
    r.status === 200 && r.json.saved[0].prStatus === 'first', r.json);

  /* A second meet: slower is null, a corrected mark updates in place, faster is a PR */
  await api(coach, 'POST', '/api/meets/' + meet2 + '/entries', { profileId: amyR, event: '200m' });
  await api(coach, 'POST', '/api/meets/' + meet2 + '/entries', { profileId: benR, event: 'shot-put' });
  await api(coach, 'POST', '/api/meets/' + meet2 + '/entries', { profileId: amyR, event: 'shot-put' });
  r = await api(coach, 'POST', '/api/meets/' + meet2 + '/results',
    { event: '200m', marks: [{ profileId: amyR, mark: '24.30' }] });
  check('a slower second mark flags null (not a PR)',
    r.status === 200 && r.json.saved[0].prStatus === null, r.json);
  r = await api(coach, 'POST', '/api/meets/' + meet2 + '/results',
    { event: 'shot-put', marks: [{ profileId: benR, mark: '28-00' }, { profileId: amyR, mark: '29-00' }] });
  const save2 = Object.fromEntries((r.json.saved || []).map(s => [s.profileId, s]));
  check('field flags: Ben\'s longer throw flags "pr", Amy\'s shorter throw flags null',
    save2[benR] && save2[benR].prStatus === 'pr' &&
    save2[amyR] && save2[amyR].prStatus === null, r.json);
  r = await api(coach, 'POST', '/api/meets/' + meet2 + '/results',
    { event: '200m', marks: [{ profileId: amyR, mark: '23.90' }] });
  check('re-saving a faster mark at the same meet flags "pr"',
    r.status === 200 && r.json.saved[0].prStatus === 'pr', r.json);
  r = await api(coach, 'GET', '/api/meet-results?profileId=' + amyR + '&event=200m');
  const amyM2 = r.json.results.filter(x => x.meet === 'Early Bird Open');
  check('the re-save updated in place — one result for the meet, at the new mark',
    amyM2.length === 1 && amyM2[0].mark === '23.90', amyM2);
  r = await api(coach, 'POST', '/api/meets/' + meet2 + '/results',
    { event: 'shot-put', marks: [{ profileId: benR, mark: '31-00' }] });
  check('a longer throw re-saved at the same meet flags "pr" (field direction)',
    r.status === 200 && r.json.saved[0].prStatus === 'pr', r.json);

  /* Entry removal */
  r = await api(coach, 'POST', '/api/meets/' + meet2 + '/entries', { profileId: caraR, event: '100m' });
  const caraEntry = r.json.entry.id;
  check('entry add for a third athlete is 201', r.status === 201, r.status);
  r = await api(coach, 'DELETE', '/api/meets/' + meet2 + '/entries/' + caraEntry);
  check('entry remove is 200', r.status === 200, r.status);
  r = await api(coach, 'DELETE', '/api/meets/' + meet2 + '/entries/' + caraEntry);
  check('entry remove twice is 404', r.status === 404, r.status);

  /* Deleting a meet removes the plan, never the record */
  r = await api(coach, 'POST', '/api/meets', { name: 'Throwaway Invite', date: '2027-01-30' });
  const meet3 = r.json.meet.id;
  await api(coach, 'POST', '/api/meets/' + meet3 + '/entries', { profileId: amyR, event: '400m' });
  r = await api(coach, 'POST', '/api/meets/' + meet3 + '/results',
    { event: '400m', marks: [{ profileId: amyR, mark: '58.00' }] });
  check('throwaway meet takes a result', r.status === 200 && r.json.saved[0].prStatus === 'first', r.json);
  r = await api(coach, 'DELETE', '/api/meets/' + meet3);
  check('meet delete is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/meets/' + meet3);
  check('the deleted meet and its entries are gone', r.status === 404, r.status);
  r = await api(coach, 'GET', '/api/meet-results?event=400m');
  check('its recorded result still stands in Meet Results under the meet name',
    r.status === 200 && r.json.results.length === 1 &&
    r.json.results[0].meet === 'Throwaway Invite' && r.json.results[0].mark === '58.00', r.json.results);

  /* Gates */
  r = await api(athlete, 'GET', '/api/meets');
  check('athlete is 403 on the meets list', r.status === 403, r.status);
  r = await api(athlete, 'POST', '/api/meets', { name: 'Nope', date: '2027-02-01' });
  check('athlete is 403 creating a meet', r.status === 403, r.status);
  r = await api(athlete, 'GET', '/api/meets/' + meet1);
  check('athlete is 403 on meet detail', r.status === 403, r.status);
  r = await api(athlete, 'POST', '/api/meets/' + meet1 + '/entries', { profileId: amyR, event: '100m' });
  check('athlete is 403 adding an entry', r.status === 403, r.status);
  r = await api(athlete, 'POST', '/api/meets/' + meet1 + '/results', { event: '200m', marks: [{ profileId: amyR, mark: '24.00' }] });
  check('athlete is 403 on quick results', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/meets');
  check('meets list without login is 401', r.status === 401, r.status);
  check('meet day view is in the served page',
    pageHtml.text.includes('id="view-meetday"') && pageHtml.text.includes('data-view="meetday"'));
  check('meet day wiring is in the served JS',
    appJs.text.includes('renderMeetDay') && appJs.text.includes('/api/meets'));

  /* ---------------- custom workouts + runner mode ---------------- */
  r = await api(coach, 'GET', '/api/custom-workouts');
  check('custom workouts list is 200 for a coach', r.status === 200, r.status);
  check('seed workout is planted exactly once',
    (r.json.workouts || []).length === 1 &&
    r.json.workouts[0].title === 'Strength Circuit — Runner Test',
    (r.json.workouts || []).map(w => w.title));
  const seed = r.json.workouts[0];
  check('seed has 3 blocks of 4 rounds with 90s / 180s rests',
    seed.blocks.length === 3 &&
    seed.blocks.every(b => b.rounds === 4 && b.restBetweenRounds === 90 && b.restAfterBlock === 180));
  check('seed block exercise counts are 3 / 4 / 5',
    seed.blocks.map(b => b.exercises.length).join(',') === '3,4,5',
    seed.blocks.map(b => b.exercises.length));
  check('seed exercises match AJ\'s mock, in order',
    seed.blocks[0].exercises.map(e => e.name).join('|') === 'Hang Clean|Band Jumps|MB Slam' &&
    seed.blocks[1].exercises.map(e => e.name).join('|') === 'Hex Bar Deadlift|Pull-Ups|Bulgarian Split Squat|DB Incline Press' &&
    seed.blocks[2].exercises.map(e => e.name).join('|') === 'Hip Thrust|DB Row|Back Extension|Ab Wheel|DB Incline');
  check('seed reps match the mock (incl. max and each-side)',
    seed.blocks[0].exercises[0].reps === '3' &&
    seed.blocks[0].exercises[2].reps === '5 each side' &&
    seed.blocks[1].exercises[1].reps === 'max' &&
    seed.blocks[1].exercises[2].reps === '5 each' &&
    seed.blocks[2].exercises[4].name === 'DB Incline' && seed.blocks[2].exercises[4].reps === '5');

  r = await api(athlete, 'GET', '/api/custom-workouts');
  check('athlete is 403 reading custom workouts', r.status === 403, r.status);
  r = await api(athlete, 'POST', '/api/custom-workouts',
    { title: 'Nope', blocks: [{ rounds: 1, restBetweenRounds: 0, restAfterBlock: 0, exercises: [{ name: 'X', reps: '1' }] }] });
  check('athlete is 403 creating a custom workout', r.status === 403, r.status);
  r = await api(athlete, 'PUT', '/api/custom-workouts/' + seed.id,
    { title: 'Nope', blocks: [{ rounds: 1, restBetweenRounds: 0, restAfterBlock: 0, exercises: [{ name: 'X', reps: '1' }] }] });
  check('athlete is 403 updating a custom workout', r.status === 403, r.status);
  r = await api(athlete, 'DELETE', '/api/custom-workouts/' + seed.id);
  check('athlete is 403 deleting a custom workout', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/custom-workouts');
  check('custom workouts without login are 401', r.status === 401, r.status);

  const cwBody = { title: 'Test Circuit', blocks: [{ rounds: 2, restBetweenRounds: 30, restAfterBlock: 60, exercises: [{ name: 'Squat', reps: '5' }, { name: 'Push-Up', reps: 'max' }] }] };
  r = await api(coach, 'POST', '/api/custom-workouts', cwBody);
  check('custom workout create is 201', r.status === 201, r.status);
  const cwId = r.json.workout.id;
  check('created workout round-trips its shape',
    r.json.workout.title === 'Test Circuit' && r.json.workout.blocks[0].rounds === 2 &&
    r.json.workout.blocks[0].exercises.length === 2 &&
    r.json.workout.blocks[0].exercises[1].reps === 'max', r.json.workout);
  r = await api(coach, 'PUT', '/api/custom-workouts/' + cwId,
    { title: 'Test Circuit v2', blocks: cwBody.blocks });
  check('custom workout update is 200 with the new title',
    r.status === 200 && r.json.workout.title === 'Test Circuit v2', r.status);
  r = await api(coach, 'PUT', '/api/custom-workouts/does-not-exist', cwBody);
  check('updating an unknown custom workout is 404', r.status === 404, r.status);
  r = await api(coach, 'DELETE', '/api/custom-workouts/' + cwId);
  check('custom workout delete is 200', r.status === 200, r.status);
  r = await api(coach, 'DELETE', '/api/custom-workouts/' + cwId);
  check('deleting a custom workout twice is 404', r.status === 404, r.status);

  const goodBlock = { rounds: 2, restBetweenRounds: 30, restAfterBlock: 30, exercises: [{ name: 'Squat', reps: '5' }] };
  const cwBad = async (label, body) => {
    const rr = await api(coach, 'POST', '/api/custom-workouts', body);
    check('custom workout validation: ' + label, rr.status === 400, rr.status);
  };
  await cwBad('blank title', { title: '  ', blocks: [goodBlock] });
  await cwBad('title over 80 chars', { title: 'x'.repeat(81), blocks: [goodBlock] });
  await cwBad('no blocks', { title: 'T', blocks: [] });
  await cwBad('9 blocks', { title: 'T', blocks: Array(9).fill(goodBlock) });
  await cwBad('blocks not an array', { title: 'T', blocks: 'nope' });
  await cwBad('rounds 0', { title: 'T', blocks: [{ ...goodBlock, rounds: 0 }] });
  await cwBad('rounds 11', { title: 'T', blocks: [{ ...goodBlock, rounds: 11 }] });
  await cwBad('rounds not whole', { title: 'T', blocks: [{ ...goodBlock, rounds: 2.5 }] });
  await cwBad('rest between rounds 601', { title: 'T', blocks: [{ ...goodBlock, restBetweenRounds: 601 }] });
  await cwBad('rest after block -1', { title: 'T', blocks: [{ ...goodBlock, restAfterBlock: -1 }] });
  await cwBad('no exercises in a block', { title: 'T', blocks: [{ ...goodBlock, exercises: [] }] });
  await cwBad('11 exercises in a block', { title: 'T', blocks: [{ ...goodBlock, exercises: Array(11).fill({ name: 'X', reps: '1' }) }] });
  await cwBad('blank exercise name', { title: 'T', blocks: [{ ...goodBlock, exercises: [{ name: ' ', reps: '1' }] }] });
  await cwBad('exercise name over 60 chars', { title: 'T', blocks: [{ ...goodBlock, exercises: [{ name: 'x'.repeat(61), reps: '1' }] }] });
  await cwBad('blank reps', { title: 'T', blocks: [{ ...goodBlock, exercises: [{ name: 'X', reps: '' }] }] });
  await cwBad('reps over 24 chars', { title: 'T', blocks: [{ ...goodBlock, exercises: [{ name: 'X', reps: 'x'.repeat(25) }] }] });
  r = await api(coach, 'GET', '/api/custom-workouts');
  check('failed validations created nothing (only the seed remains)',
    (r.json.workouts || []).length === 1, (r.json.workouts || []).length);

  /* Runner step sequence — verified against the pure core shipped
     in app.js (extracted between its markers and evaluated). */
  const coreMatch = appJs.text.match(/\/\* RUNNER-CORE-BEGIN \*\/([\s\S]*?)\/\* RUNNER-CORE-END \*\//);
  check('runner core section is in the shipped JS', !!coreMatch);
  if (coreMatch) {
    const core = new Function(coreMatch[1] +
      '\nreturn { buildRunnerSteps, sessionToRunnerPlan, parseRestSeconds };')();
    const steps = core.buildRunnerSteps(seed);
    const exSteps = steps.filter(s => s.type === 'exercise');
    const restSteps = steps.filter(s => s.type === 'rest');
    check('seed runner walk is 48 exercise steps', exSteps.length === 48, exSteps.length);
    check('seed runner walk inserts 11 rest steps (59 total)',
      restSteps.length === 11 && steps.length === 59, steps.length);
    check('first round flows circuit-style, then a 90s round rest',
      steps.slice(0, 3).map(s => s.name).join('|') === 'Hang Clean|Band Jumps|MB Slam' &&
      steps[3].type === 'rest' && steps[3].kind === 'round' && steps[3].seconds === 90);
    check('a 180s block rest follows block 1, then block 2 opens',
      steps[15].type === 'rest' && steps[15].kind === 'block' && steps[15].seconds === 180 &&
      steps[16].type === 'exercise' && steps[16].name === 'Hex Bar Deadlift');
    check('the walk ends on the last exercise (no trailing rest)',
      steps[steps.length - 1].type === 'exercise' && steps[steps.length - 1].name === 'DB Incline');
    check('exercise steps carry block and round positions',
      exSteps[0].block === 0 && exSteps[0].round === 1 &&
      exSteps[47].block === 2 && exSteps[47].round === 4);
    const acc = contentJson.sessions.find(s => s.id === 'ACC-01');
    const accPlan = core.sessionToRunnerPlan(acc);
    const accSteps = core.buildRunnerSteps(accPlan);
    check('ACC-01 maps to 8 rounds of one work step with 150s rests',
      accPlan.blocks.length === 1 && accPlan.blocks[0].rounds === 8 &&
      accPlan.blocks[0].exercises[0].name === 'Run 30m' &&
      accPlan.blocks[0].exercises[0].reps === '@ 98%' &&
      accPlan.blocks[0].restBetweenRounds === 150 &&
      accSteps.filter(s => s.type === 'exercise').length === 8, accPlan.blocks);
    const wup = contentJson.sessions.find(s => s.id === 'WUP-02');
    const wupSteps = core.buildRunnerSteps(core.sessionToRunnerPlan(wup));
    check('a prose warm-up session maps to a single runner step',
      wupSteps.length === 1 && wupSteps[0].type === 'exercise', wupSteps.length);
    check('rest parsing: 6-8 min is 420, walk back is 60, continuous is 0',
      core.parseRestSeconds('6-8 min') === 420 &&
      core.parseRestSeconds('walk back') === 60 &&
      core.parseRestSeconds('continuous flow') === 0);
  }
  check('custom workouts view + runner overlay are in the served page',
    pageHtml.text.includes('id="view-custom"') && pageHtml.text.includes('data-view="custom"') &&
    pageHtml.text.includes('id="runner-overlay"') && pageHtml.text.includes('id="runner-main"'));
  check('runner + custom workouts wiring is in the served JS',
    appJs.text.includes('renderCustomWorkouts') && appJs.text.includes('openRunner') &&
    appJs.text.includes('/api/custom-workouts') && appJs.text.includes('detail-run') &&
    appJs.text.includes('runnerAdvance') && appJs.text.includes('runnerTogglePause'));

  /* ---------------- Today screen Run button ----------------
     One big scarlet Run button on Today launches today's session
     in the runner — the same sessionToRunnerPlan + openRunner
     path as a session's own "Run this workout". Per group when
     a coach's groups have different sessions today, a single
     button when they share one, and no button at all on a rest
     day. The decisions are pure helpers in app.js, evaluated
     directly here against /api/coach/today-shaped fixtures. */
  const trMatch = appJs.text.match(/\/\* TODAY-RUN-BEGIN \*\/([\s\S]*?)\/\* TODAY-RUN-END \*\//);
  check('today-run section is in the shipped JS', !!trMatch);
  if (trMatch) {
    const tr = new Function(trMatch[1] +
      '\nreturn { todayRunTargets, featuredRunSessionId };')();
    const grp = (name, sessionId) => ({ group: { id: 'g-' + name, name }, assignment: { sessionId } });
    check('today-run: no groups means no buttons',
      Array.isArray(tr.todayRunTargets([])) && tr.todayRunTargets([]).length === 0 &&
      tr.todayRunTargets(null).length === 0);
    check('today-run: every group resting means no buttons',
      tr.todayRunTargets([grp('Sprinters', null), grp('Distance', null)]).length === 0);
    check('today-run: one group with a session is a single unnamed target',
      JSON.stringify(tr.todayRunTargets([grp('Sprinters', 'ACC-01')])) ===
      JSON.stringify([{ sessionId: 'ACC-01', groupName: null }]));
    check('today-run: groups sharing one session collapse to a single button',
      JSON.stringify(tr.todayRunTargets([grp('Sprinters', 'ACC-01'), grp('Jumpers', 'ACC-01')])) ===
      JSON.stringify([{ sessionId: 'ACC-01', groupName: null }]));
    const split = tr.todayRunTargets([grp('Sprinters', 'ACC-01'), grp('Distance', 'TEM-01'), grp('Throwers', 'ACC-01')]);
    check('today-run: different sessions give one named target per group',
      split.length === 3 &&
      split[0].groupName === 'Sprinters' && split[0].sessionId === 'ACC-01' &&
      split[1].groupName === 'Distance' && split[1].sessionId === 'TEM-01' &&
      split[2].groupName === 'Throwers' && split[2].sessionId === 'ACC-01', split);
    check('today-run: a resting group drops out when the others share a session',
      JSON.stringify(tr.todayRunTargets([grp('Sprinters', 'ACC-01'), grp('Distance', null)])) ===
      JSON.stringify([{ sessionId: 'ACC-01', groupName: null }]));
    check('today-run: the featured session is the day\'s first code',
      tr.featuredRunSessionId({ codes: ['ACC-01', 'STR-01'] }) === 'ACC-01' &&
      tr.featuredRunSessionId({ codes: ['TEM-01'] }) === 'TEM-01');
    check('today-run: a rest day (no codes) has no featured session',
      tr.featuredRunSessionId({ codes: [] }) === null &&
      tr.featuredRunSessionId({}) === null && tr.featuredRunSessionId(null) === null);
  }
  check('today-run buttons render and launch through the shared runner path',
    appJs.text.includes('runTodayButtonHtml') && appJs.text.includes('data-run-today') &&
    appJs.text.includes('wireRunTodayButtons') &&
    appJs.text.includes('openRunner(sessionToRunnerPlan(s))') &&
    appJs.text.includes('▶ Run today\'s workout') && appJs.text.includes('▶ Run — ') &&
    appJs.text.includes('todayRunTargets(data.groups)'));
  const stylesCss = await apiText(null, '/styles.css');
  check('today-run button style is served and at least 56px tall',
    stylesCss.status === 200 && /\.run-today-btn\s*\{[^}]*min-height:\s*56px/.test(stylesCss.text));
  check('TV board render path stays free of the Today Run buttons',
    !tvCode.includes('data-run-today') && !tvCode.includes('todayRunTargets') &&
    !tvCode.includes('run-today-btn') && !tvCode.includes('featuredRunSessionId'));

  /* ---------------- QA + polish pass (Oct 24) ----------------
     Regression guards for the audit fixes: undefined scarlet token,
     coach tabs lost on reload, pre-answered check-in defaults,
     direction-blind ranked tables, silent coach-panel failures. */
  check('qa: --scarlet token is defined (selected check-in buttons were white-on-white)',
    stylesCss.text.includes('--scarlet: var(--red)'));
  check('qa: boot restores the session through syncAuthUi so coach tabs survive a reload',
    appJs.text.includes('syncAuthUi (not the individual renders)'));
  check('qa: coach views re-render when entered, not only at login',
    appJs.text.includes("if (name === 'wellness') renderWellness();") &&
    appJs.text.includes("if (name === 'groups') renderGroups();") &&
    appJs.text.includes("if (name === 'coach') renderCoach();"));
  check('qa: a new check-in starts unanswered and Save stays disabled until it is not',
    appJs.text.includes('soreness: c ? c.soreness : null') &&
    appJs.text.includes('energy: c ? c.energy : null') &&
    appJs.text.includes('saveBtn.disabled = !ready'));
  check('qa: pain text is only sent while Something hurts is checked',
    appJs.text.includes("painText: $('#ci-hurts').checked ? $('#ci-pain').value : ''"));
  check('qa: check-in load failure shows an error with retry instead of a silent blank',
    appJs.text.includes('ci-retry'));
  check('qa: coach Today summary failure shows an error with retry instead of vanishing',
    appJs.text.includes('ct-retry'));
  check('qa: ranked testing tables sort by the test direction (fastest first for timed tests)',
    appJs.text.includes("t.better === 'lower' ? (a.display || 0) - (b.display || 0)"));
  check('qa: testing history picker keeps its own athlete state',
    appJs.text.includes('histAthleteId'));
  check('qa: sleep trend charts receive a real metric object, not the string week',
    appJs.text.includes("{ name: 'Avg sleep', unit: 'hrs', better: 'higher' }") &&
    !appJs.text.includes("], 'week', true)"));
  check('qa: a concern with no pain score offers a not-recorded option (never a silent 1/10)',
    appJs.text.includes('— not recorded —') && appJs.text.includes("value === '' ? undefined"));
  check('qa: wellness view triages flagged first and badges unlinked athletes',
    appJs.text.includes('NOT LINKED') && appJs.text.includes('const triage'));
  check('qa: roster cards show account-link status without opening Edit profile',
    appJs.text.includes('🔗 Linked:') && appJs.text.includes('Not linked — open Edit profile'));
  check('qa: checklist group cards carry the shared Run button',
    appJs.text.includes('runTodayButtonHtml({ sessionId: a.sessionId, groupName: blk.group.name })'));
  check('qa: library detail remembers its origin and filters can be cleared in one tap',
    appJs.text.includes('DETAIL_FROM_LABELS') && appJs.text.includes('lib-clear') &&
    pageHtml.text.includes('id="lib-filters"'));
  check('qa: testing grid confirms before clearing saved results',
    appJs.text.includes('CLEAR ${clear.length} saved result'));
  check('qa: digest week navigation is bounded at the latest week',
    appJs.text.includes('digestLatest'));
  check('qa: TV board stamps freshness, flags a stale board, and rests groups on their own page',
    pageHtml.text.includes('id="tv-updated"') && appJs.text.includes('tvStale') &&
    appJs.text.includes("label: g.group.name + ' · Rest day'"));
  check('qa: runner confirms before discarding a run in progress and holds a wake lock',
    appJs.text.includes('requestCloseRunner') && appJs.text.includes('wakeLock'));
  check('qa: records board opens on the first event with marks until one is picked',
    appJs.text.includes('recEventPicked') && appJs.text.includes('firstWith'));

  /* ---------------- athlete accounts + daily wellness check-in ----------------
     The first athlete-entered surface: a coach links an email to a
     roster profile; that account can then log sleep/soreness/energy
     once a day. Runs its own fixtures so the other sections' roster
     counts stay untouched. Boundary dates are computed from the
     server's own today (reportToday), never hardcoded. */
  const pad2w = (n) => String(n).padStart(2, '0');
  const fmtDw = (d) => d.getFullYear() + '-' + pad2w(d.getMonth() + 1) + '-' + pad2w(d.getDate());
  const reportToday = fmtDw(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return fmtDw(d); };
  const yDay = addDays(reportToday, -1);
  const y2Day = addDays(reportToday, -2);
  r = await api(coach, 'POST', '/api/groups', { name: 'Wellness Squad' });
  const wGroup = r.json.group;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Will', lastName: 'Wells', groupId: wGroup.id, events: ['sprinter'] });
  const willP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Wendy', lastName: 'Waves', groupId: wGroup.id, events: ['jumper'] });
  const wendyP = r.json.profile;

  /* Unlinked athlete: browses fine, check-in shows the clear
     "ask your coach" state (never an error wall). */
  r = await api(null, 'POST', '/api/register', { email: 'will@test.com', password: 'testpass123' });
  check('wellness athlete registers as athlete role', r.status === 201 && r.json.role === 'athlete', r.json);
  const will = cookieOf(r);
  r = await api(will, 'GET', '/api/checkin/today');
  check('unlinked athlete check-in state is linked:false, not an error',
    r.status === 200 && r.json.linked === false && r.json.checkin === null, r.json);
  r = await api(will, 'POST', '/api/checkin', { sleep: 8, soreness: 3, energy: 3 });
  check('unlinked athlete check-in POST is 403 with the notLinked flag',
    r.status === 403 && r.json.notLinked === true, r.json);
  r = await api(will, 'GET', '/api/checkin/mine');
  check('unlinked athlete history is empty with streak 0',
    r.status === 200 && r.json.linked === false && r.json.entries.length === 0 && r.json.streak === 0, r.json);
  r = await api(athlete, 'GET', '/api/checkin/today');
  check('the fixture athlete account is likewise unlinked by default',
    r.status === 200 && r.json.linked === false, r.json);

  /* Coach wellness view on an empty check-in store: clean zeros. */
  r = await api(coach, 'GET', '/api/wellness/today');
  check('wellness today (empty): participation math is clean',
    r.status === 200 && r.json.summary.checkedIn === 0 && r.json.summary.flagged === 0 &&
    r.json.summary.participation === 0 && r.json.summary.avgSleep === null &&
    r.json.rows.length === r.json.summary.total && r.json.summary.total >= 2, r.json.summary);
  r = await api(coach, 'GET', '/api/reports/health');
  check('reports health (empty): check-in aggregates are present and zero',
    r.status === 200 && !!r.json.checkins && r.json.checkins.totalCheckins === 0 &&
    r.json.checkins.participationByWeek.length === 0 && r.json.checkins.dailyTrend.length === 0,
    r.json.checkins);
  r = await api(coach, 'GET', '/api/coach/today');
  check('coach today (empty): wellness block present with zeros',
    r.status === 200 && !!r.json.wellness && r.json.wellness.checkedIn === 0 &&
    Array.isArray(r.json.wellness.flagged) && r.json.wellness.flagged.length === 0, r.json.wellness);

  /* Link management: validation + binding an EXISTING account. */
  r = await api(coach, 'PUT', '/api/profiles/' + wendyP.id + '/link', { email: 'not-an-email' });
  check('link with a bad email is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/profiles/nope/link', { email: 'x@test.com' });
  check('link for an unknown profile is 404', r.status === 404, r.status);
  r = await api(will, 'PUT', '/api/profiles/' + willP.id + '/link', { email: 'will@test.com' });
  check('athlete cannot link profiles (coach gate)', r.status === 403, r.status);
  r = await api(will, 'GET', '/api/wellness/today');
  check('athlete cannot read the coach wellness view', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/wellness/today');
  check('wellness view without login is 401', r.status === 401, r.status);
  r = await api(coach, 'PUT', '/api/profiles/' + willP.id + '/link', { email: 'Will@Test.com ' });
  check('link binds the existing account immediately (email normalized)',
    r.status === 200 && r.json.accountLinked === true && r.json.profile.linkedEmail === 'will@test.com', r.json);
  r = await api(will, 'GET', '/api/me');
  check('bound account carries its profileId', r.status === 200 && r.json.profileId === willP.id, r.json);
  r = await api(will, 'GET', '/api/checkin/today');
  check('bound athlete sees the linked check-in state',
    r.status === 200 && r.json.linked === true && r.json.profileId === willP.id && r.json.checkin === null, r.json);
  r = await api(coach, 'PUT', '/api/profiles/' + wendyP.id + '/link', { email: 'will@test.com' });
  check('linking an email already on another profile is 409', r.status === 409, r.status);

  /* Link BEFORE register: the account is born bound. */
  r = await api(coach, 'PUT', '/api/profiles/' + wendyP.id + '/link', { email: 'wendy@test.com' });
  check('link before register reports no account yet',
    r.status === 200 && r.json.accountLinked === false, r.json);
  r = await api(null, 'POST', '/api/register', { email: 'wendy@test.com', password: 'testpass123' });
  check('registering a linked email stays athlete role', r.status === 201 && r.json.role === 'athlete', r.json);
  const wendy = cookieOf(r);
  r = await api(wendy, 'GET', '/api/me');
  check('link-before-register binds at registration', r.status === 200 && r.json.profileId === wendyP.id, r.json);

  /* Validation: clean 400s, nothing half-saved. */
  const badCheckins = [
    [{ sleep: 2.5, soreness: 3, energy: 3 }, 'sleep below range'],
    [{ sleep: 13.5, soreness: 3, energy: 3 }, 'sleep above range'],
    [{ sleep: 7.3, soreness: 3, energy: 3 }, 'sleep off the half step'],
    [{ sleep: 8, soreness: 0, energy: 3 }, 'soreness below range'],
    [{ sleep: 8, soreness: 6, energy: 3 }, 'soreness above range'],
    [{ sleep: 8, soreness: 2.5, energy: 3 }, 'soreness not whole'],
    [{ sleep: 8, soreness: 3, energy: 0 }, 'energy below range'],
    [{ sleep: 8, soreness: 3, energy: 6 }, 'energy above range'],
    [{ sleep: 8, soreness: 3, energy: 3, hurts: true, painText: 'x'.repeat(241) }, 'pain text over 240 chars'],
    [{ sleep: 8, soreness: 3, energy: 3, note: 'x'.repeat(501) }, 'note over 500 chars'],
    [{ sleep: 8, soreness: 3, energy: 3, date: addDays(reportToday, 1) }, 'future date'],
    [{ sleep: 8, soreness: 3, energy: 3, date: '2026-02-30' }, 'impossible date'],
  ];
  for (const [body, label] of badCheckins) {
    r = await api(will, 'POST', '/api/checkin', body);
    check('check-in validation 400: ' + label, r.status === 400, r.status);
  }
  r = await api(null, 'POST', '/api/checkin', { sleep: 8, soreness: 3, energy: 3 });
  check('check-in without login is 401', r.status === 401, r.status);
  r = await api(will, 'GET', '/api/checkin/mine');
  check('failed validations saved nothing', r.status === 200 && r.json.entries.length === 0, r.json);

  /* Upsert: one entry per athlete per day; resubmitting edits it. */
  r = await api(will, 'POST', '/api/checkin', { sleep: 6, soreness: 3, energy: 3 });
  check('first check-in creates (201)', r.status === 201 && r.json.created === true, r.json);
  check('sleep exactly 6.0 is NOT flagged', r.json.checkin.flags.length === 0, r.json.checkin);
  r = await api(will, 'POST', '/api/checkin', { sleep: 5.5, soreness: 3, energy: 3 });
  check('same-day resubmit edits (200, not created)',
    r.status === 200 && r.json.created === false && r.json.checkin.sleep === 5.5, r.json);
  check('sleep 5.5 IS flagged low-sleep',
    JSON.stringify(r.json.checkin.flags) === JSON.stringify(['low-sleep']), r.json.checkin.flags);
  r = await api(will, 'GET', '/api/checkin/mine');
  check('still exactly one entry after the edit', r.status === 200 && r.json.entries.length === 1, r.json.entries);
  r = await api(will, 'POST', '/api/checkin', { sleep: 7, soreness: 2, energy: 4 });
  check('final fixture values save cleanly with no flags',
    r.status === 200 && r.json.checkin.sleep === 7 && r.json.checkin.flags.length === 0, r.json.checkin);

  /* Isolation: the server binds by the caller's account, so a
     profileId smuggled into the body is ignored, and Will's data
     is never visible to Wendy. */
  r = await api(wendy, 'POST', '/api/checkin',
    { sleep: 5.5, soreness: 4, energy: 2, profileId: willP.id });
  check('wendy check-in saves to HER profile (body profileId ignored)',
    r.status === 201 && r.json.checkin.flags.length === 3, r.json);
  r = await api(wendy, 'GET', '/api/checkin/today');
  check('wendy sees her own check-in on her profile',
    r.status === 200 && r.json.profileId === wendyP.id && r.json.checkin.sleep === 5.5, r.json);
  r = await api(wendy, 'GET', '/api/checkin/mine');
  check('wendy history holds only her own entry',
    r.status === 200 && r.json.entries.length === 1 && r.json.entries[0].sleep === 5.5, r.json.entries);
  r = await api(coach, 'GET', '/api/wellness/today');
  const willRow = r.json.rows.find(x => x.profile.id === willP.id);
  check('coach view shows will untouched by wendy submit',
    !!willRow && willRow.checkedIn && willRow.checkin.sleep === 7 && willRow.flags.length === 0, willRow);
  check('flag boundaries all hit at once (5.5 sleep, 4 soreness, 2 energy)',
    r.status === 200 && r.json.summary.checkedIn === 2 && r.json.summary.flagged === 1 &&
    r.json.summary.avgSleep === 6.25 && r.json.summary.avgSoreness === 3 && r.json.summary.avgEnergy === 3,
    r.json.summary);
  const wendyRow = r.json.rows.find(x => x.profile.id === wendyP.id);
  check('wendy row carries all three flags',
    !!wendyRow && JSON.stringify(wendyRow.flags) === JSON.stringify(['low-sleep', 'high-soreness', 'low-energy']),
    wendyRow && wendyRow.flags);
  r = await api(coach, 'GET', '/api/coach/today');
  check('coach today wellness line counts check-ins + flags the right athlete',
    r.status === 200 && r.json.wellness.checkedIn === 2 && r.json.wellness.flagged.length === 1 &&
    r.json.wellness.flagged[0].profileId === wendyP.id, r.json.wellness);

  /* Pain integration: exactly one athlete-reported concern per
     check-in day, edited not duplicated, removable while untouched. */
  r = await api(coach, 'GET', '/api/concerns');
  const concernsBefore = r.json.concerns.length;
  r = await api(will, 'POST', '/api/checkin',
    { sleep: 7, soreness: 2, energy: 4, hurts: true, painText: 'Right hamstring tight' });
  check('pain toggle saves on the check-in', r.status === 200 && r.json.checkin.hurts === true, r.json);
  r = await api(coach, 'GET', '/api/concerns');
  const athleteConcerns = r.json.concerns.filter(c => c.profileId === willP.id && c.source === 'athlete');
  check('pain toggle files exactly one athlete-reported concern',
    r.json.concerns.length === concernsBefore + 1 && athleteConcerns.length === 1 &&
    athleteConcerns[0].note === 'Right hamstring tight' && athleteConcerns[0].pain === null &&
    athleteConcerns[0].status === 'new', athleteConcerns);
  r = await api(will, 'POST', '/api/checkin',
    { sleep: 7, soreness: 2, energy: 4, hurts: true, painText: 'Left hamstring tight now' });
  check('editing the same day keeps one check-in', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/concerns');
  const athleteConcerns2 = r.json.concerns.filter(c => c.profileId === willP.id && c.source === 'athlete');
  check('same-day edit updates the same concern instead of duplicating',
    athleteConcerns2.length === 1 && athleteConcerns2[0].note === 'Left hamstring tight now', athleteConcerns2);
  r = await api(will, 'POST', '/api/checkin', { sleep: 7, soreness: 2, energy: 4, hurts: false });
  check('turning pain off saves cleanly', r.status === 200 && r.json.checkin.hurts === false, r.json);
  r = await api(coach, 'GET', '/api/concerns');
  check('pain off removes the still-new concern',
    r.json.concerns.filter(c => c.profileId === willP.id && c.source === 'athlete').length === 0,
    r.json.concerns.length);
  r = await api(will, 'GET', '/api/checkin/mine');
  check('will still has exactly one entry after the pain edits',
    r.status === 200 && r.json.entries.length === 1, r.json.entries && r.json.entries.length);

  /* Streak: past-day check-ins stack into a run. */
  r = await api(will, 'POST', '/api/checkin', { date: yDay, sleep: 8, soreness: 2, energy: 4 });
  check('yesterday check-in saves (201)', r.status === 201, r.status);
  r = await api(will, 'POST', '/api/checkin', { date: y2Day, sleep: 8, soreness: 2, energy: 4 });
  check('day-before check-in saves (201)', r.status === 201, r.status);
  r = await api(will, 'GET', '/api/checkin/mine');
  check('mine returns the last 7 days newest first with a 3-day streak',
    r.status === 200 && r.json.entries.length === 3 && r.json.entries[0].date === reportToday &&
    r.json.entries[2].date === y2Day && r.json.streak === 3, r.json);

  /* Coach trends + reports aggregates on the fixture data. */
  r = await api(coach, 'GET', '/api/wellness/trends?days=7');
  const wTrend = (r.json.athletes || []).find(a => a.profile.id === willP.id);
  check('trends cover 7 days with will on three of them',
    r.status === 200 && r.json.dates.length === 7 && r.json.dates[6] === reportToday && !!wTrend &&
    wTrend.days.filter(d => d.sleep !== null).length === 3, r.json.dates);
  const teamToday = (r.json.team || []).find(d => d.date === reportToday);
  check('team trend aggregates today across the roster',
    !!teamToday && teamToday.checkedIn === 2 && teamToday.avgSleep === 6.25, teamToday);
  r = await api(athlete, 'GET', '/api/wellness/trends?days=7');
  check('athlete cannot read wellness trends', r.status === 403, r.status);
  r = await api(coach, 'GET', '/api/reports/health');
  check('reports health aggregates the check-ins',
    r.status === 200 && r.json.checkins.totalCheckins === 4 &&
    r.json.checkins.dailyTrend.some(d => d.date === reportToday && d.count === 2) &&
    r.json.checkins.participationByWeek.length >= 1, r.json.checkins);

  /* Unlink unbinds; re-link restores. */
  r = await api(coach, 'DELETE', '/api/profiles/' + willP.id + '/link');
  check('unlink reports the previous link', r.status === 200 && r.json.wasLinked === true, r.json);
  r = await api(will, 'GET', '/api/me');
  check('unlinked account loses its profileId', r.status === 200 && r.json.profileId === null, r.json);
  r = await api(will, 'POST', '/api/checkin', { sleep: 8, soreness: 3, energy: 3 });
  check('unlinked athlete check-in is blocked again', r.status === 403 && r.json.notLinked === true, r.json);
  r = await api(coach, 'DELETE', '/api/profiles/' + willP.id + '/link');
  check('second unlink is a clean no-op', r.status === 200 && r.json.wasLinked === false, r.json);
  r = await api(coach, 'PUT', '/api/profiles/' + willP.id + '/link', { email: 'will@test.com' });
  check('re-link restores the binding', r.status === 200 && r.json.accountLinked === true, r.json);
  r = await api(will, 'GET', '/api/checkin/mine');
  check('check-in history is waiting after re-link',
    r.status === 200 && r.json.linked === true && r.json.entries.length === 3 && r.json.streak === 3, r.json);

  /* Privacy: check-in/wellness data never reaches the TV path or
     any public surface. */
  {
    const tvStart = appJs.text.indexOf('TV BOARD');
    const tvEnd = appJs.text.indexOf('/* ---------------- boot', tvStart);
    const tvCode = appJs.text.slice(tvStart, tvEnd);
    check('TV render path has no check-in or wellness references',
      tvStart >= 0 && tvEnd > tvStart && !tvCode.includes('checkin') && !tvCode.includes('wellness'),
      tvCode.length);
    check('wellness view + check-in card are in the served page',
      pageHtml.text.includes('id="view-wellness"') && pageHtml.text.includes('data-view="wellness"') &&
      pageHtml.text.includes('id="checkin-slot"') && pageHtml.text.includes('id="checkin-history"'));
    check('wellness + check-in wiring is in the served JS',
      appJs.text.includes('renderWellness') && appJs.text.includes('renderCheckin') &&
      appJs.text.includes('/api/checkin') && appJs.text.includes('/api/wellness/today'));
    r = await api(null, 'GET', '/api/checkin/today');
    check('check-in state without login is 401', r.status === 401, r.status);
  }

  /* ---------------- athlete goals ----------------
     Coach-set target marks with progress computed from real meet
     results: baseline = first recorded mark, current = PR. Fixtures
     are built so the expected percentages come out exact:
       Gail 100m:      12.00 -> 11.50, target 11.00  => 50%, gap 0.5s
       Gail long jump: 18-00 -> 19-06, target 21-00  => 50%, gap 18in
       Gail 800m:      one mark (2:10.00), target 2:00.00 => 0%     */
  r = await api(coach, 'POST', '/api/groups', { name: 'Goal Squad' });
  const gGoal = r.json.group.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Gail', lastName: 'Goals', groupId: gGoal, events: ['sprinter', 'jumper'] });
  const gailG = r.json.profile.id;
  await api(coach, 'POST', '/api/meet-results', { profileId: gailG, date: '2027-02-01', meet: 'Opener', event: '100m', mark: '12.00' });
  await api(coach, 'POST', '/api/meet-results', { profileId: gailG, date: '2027-02-15', meet: 'Classic', event: '100m', mark: '11.50' });
  await api(coach, 'POST', '/api/meet-results', { profileId: gailG, date: '2027-02-01', meet: 'Opener', event: 'long-jump', mark: '18-00' });
  await api(coach, 'POST', '/api/meet-results', { profileId: gailG, date: '2027-02-15', meet: 'Classic', event: 'long-jump', mark: '19-06' });
  await api(coach, 'POST', '/api/meet-results', { profileId: gailG, date: '2027-02-01', meet: 'Opener', event: '800m', mark: '2:10.00' });

  /* Create + progress math on a time event. */
  r = await api(coach, 'POST', '/api/goals', { profileId: gailG, event: '100m', target: '11.00' });
  check('goal create is 201 and not a replace',
    r.status === 201 && r.json.replaced === false && !!r.json.goal.id, r.json);
  const gailGoal100 = r.json.goal.id;
  check('goal progress (time): baseline is the first mark, current is the PR',
    r.json.goal.baseline.mark === '12.00' && r.json.goal.baseline.value === 12 &&
    r.json.goal.current.mark === '11.50' && r.json.goal.current.value === 11.5, r.json.goal);
  check('goal progress (time): halfway to target is 50%, gap is 0.5 sec',
    r.json.goal.progressPct === 50 && r.json.goal.gap === 0.5 && r.json.goal.gapUnit === 'sec' &&
    r.json.goal.achieved === false, r.json.goal);

  /* Replace on duplicate pair: the same id, the new target, and an
     achieved state when the PR already beats the target. */
  r = await api(coach, 'POST', '/api/goals', { profileId: gailG, event: '100m', target: '11.60' });
  check('re-setting the same pair replaces it in place',
    r.status === 200 && r.json.replaced === true && r.json.goal.id === gailGoal100 &&
    r.json.goal.targetText === '11.60', r.json);
  check('a PR already past the target reads achieved at 100%',
    r.json.goal.achieved === true && r.json.goal.progressPct === 100, r.json.goal);
  r = await api(coach, 'GET', '/api/goals?profileId=' + gailG);
  check('coach list still holds exactly one goal for the pair',
    r.status === 200 && r.json.goals.length === 1 && r.json.goals[0].event === '100m', r.json);
  r = await api(coach, 'PUT', '/api/goals/' + gailGoal100, { target: '11.00' });
  check('goal edit restores the 50% progress',
    r.status === 200 && r.json.goal.targetText === '11.00' && r.json.goal.progressPct === 50 &&
    r.json.goal.achieved === false, r.json);

  /* Field event math (higher is better, inches). */
  r = await api(coach, 'POST', '/api/goals', { profileId: gailG, event: 'long-jump', target: '21-00' });
  check('goal progress (field): halfway is 50%, gap is 18 in',
    r.status === 201 && r.json.goal.progressPct === 50 && r.json.goal.gap === 18 &&
    r.json.goal.gapUnit === 'in' && r.json.goal.baseline.value === 216 &&
    r.json.goal.current.value === 234 && r.json.goal.targetValue === 252, r.json.goal);
  const gailGoalLj = r.json.goal.id;

  /* Single mark: baseline == current, so progress is 0%. */
  r = await api(coach, 'POST', '/api/goals', { profileId: gailG, event: '800m', target: '2:00.00' });
  check('a lone first mark is the baseline: progress 0%',
    r.status === 201 && r.json.goal.progressPct === 0 && r.json.goal.achieved === false &&
    r.json.goal.baseline.value === 130 && r.json.goal.current.value === 130 &&
    r.json.goal.gap === 10, r.json.goal);

  /* No marks yet: progress is null, never a made-up number. */
  r = await api(coach, 'POST', '/api/goals', { profileId: gailG, event: 'shot-put', target: '30-00' });
  check('goal with no marks yet: progress null, current null, gap null',
    r.status === 201 && r.json.goal.progressPct === null && r.json.goal.current === null &&
    r.json.goal.baseline === null && r.json.goal.gap === null && r.json.goal.achieved === false,
    r.json.goal);
  const gailGoalSp = r.json.goal.id;

  /* Validation: shared-parser 400s, unknown athlete/event 400s, and
     a bad edit changes nothing. */
  const badGoals = [
    [{ profileId: gailG, event: '100m', target: 'fast' }, 'unparseable time target'],
    [{ profileId: gailG, event: 'long-jump', target: '21-13' }, 'inches over 12'],
    [{ profileId: gailG, event: 'marathon', target: '2:00:00' }, 'unknown event'],
    [{ profileId: 'nope', event: '100m', target: '11.00' }, 'unknown athlete'],
    [{ profileId: gailG, event: '100m', target: '' }, 'empty target'],
  ];
  for (const [body, label] of badGoals) {
    r = await api(coach, 'POST', '/api/goals', body);
    check('goal create 400: ' + label, r.status === 400, r.status);
  }
  r = await api(coach, 'PUT', '/api/goals/' + gailGoal100, { target: 'bogus' });
  check('goal edit with a bad mark is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/goals?profileId=' + gailG);
  check('the bad edit changed nothing',
    r.json.goals.find(g => g.id === gailGoal100).targetText === '11.00', r.json.goals);
  r = await api(coach, 'PUT', '/api/goals/nope', { target: '11.00' });
  check('goal edit on an unknown id is 404', r.status === 404, r.status);
  r = await api(coach, 'DELETE', '/api/goals/nope');
  check('goal delete on an unknown id is 404', r.status === 404, r.status);
  r = await api(coach, 'GET', '/api/goals?profileId=nope');
  check('coach goal list for an unknown athlete is 400', r.status === 400, r.status);

  /* Edit onto an occupied pair replaces the older goal: the shot-put
     goal moves to long jump at 20-00; the original long-jump goal
     (21-00) goes away, and progress recomputes (216 -> 234 of the
     way to 240 = 75%, gap 6 in). */
  r = await api(coach, 'PUT', '/api/goals/' + gailGoalSp, { event: 'long-jump', target: '20-00' });
  check('moving a goal onto an occupied pair succeeds',
    r.status === 200 && r.json.goal.event === 'long-jump' && r.json.goal.progressPct === 75 &&
    r.json.goal.gap === 6, r.json);
  r = await api(coach, 'GET', '/api/goals?profileId=' + gailG);
  check('the occupied pair still has exactly one goal, and it is the moved one',
    r.json.goals.length === 3 &&
    r.json.goals.filter(g => g.event === 'long-jump').length === 1 &&
    r.json.goals.find(g => g.event === 'long-jump').id === gailGoalSp &&
    !r.json.goals.some(g => g.id === gailGoalLj), r.json.goals.map(g => g.event));

  /* Athlete gates: the coach surface is closed to athletes. */
  r = await api(athlete, 'GET', '/api/goals');
  check('athlete is 403 on the coach goal list', r.status === 403, r.status);
  r = await api(athlete, 'POST', '/api/goals', { profileId: gailG, event: '100m', target: '11.00' });
  check('athlete is 403 creating a goal', r.status === 403, r.status);
  r = await api(athlete, 'PUT', '/api/goals/' + gailGoal100, { target: '10.00' });
  check('athlete is 403 editing a goal', r.status === 403, r.status);
  r = await api(athlete, 'DELETE', '/api/goals/' + gailGoal100);
  check('athlete is 403 deleting a goal', r.status === 403, r.status);

  /* /api/goals/mine: unlinked reads the clear not-linked state;
     a linked athlete reads ONLY their own goals. */
  r = await api(athlete, 'GET', '/api/goals/mine');
  check('unlinked athlete goals state is linked:false with no goals',
    r.status === 200 && r.json.linked === false && r.json.goals.length === 0, r.json);
  r = await api(will, 'GET', '/api/goals/mine');
  check('linked athlete with no goals reads an empty list',
    r.status === 200 && r.json.linked === true && r.json.profileId === willP.id &&
    r.json.goals.length === 0, r.json);
  r = await api(coach, 'POST', '/api/goals', { profileId: willP.id, event: '55m', target: '7.00' });
  check('coach sets a goal for the linked athlete', r.status === 201, r.status);
  r = await api(will, 'GET', '/api/goals/mine');
  check('athlete mine returns only their own goals',
    r.status === 200 && r.json.goals.length === 1 &&
    r.json.goals.every(g => g.profileId === willP.id) &&
    r.json.goals[0].event === '55m' && r.json.goals[0].progressPct === null, r.json);

  /* Report card: goals ride along additively; an athlete with no
     goals gets an empty array (the section omits itself client-side). */
  r = await api(coach, 'GET', '/api/reports/athlete/' + gailG);
  check('report card carries the goals with computed progress',
    r.status === 200 && Array.isArray(r.json.goals) && r.json.goals.length === 3 &&
    r.json.goals.find(g => g.event === '100m').progressPct === 50 &&
    r.json.goals.find(g => g.event === '100m').gap === 0.5 &&
    r.json.goals.find(g => g.event === '800m').progressPct === 0, r.json.goals);
  r = await api(coach, 'GET', '/api/reports/athlete/' + benR);
  check('report card for an athlete with no goals: empty goals array',
    r.status === 200 && Array.isArray(r.json.goals) && r.json.goals.length === 0, r.json.goals);

  /* Delete: removes exactly that goal; a second delete is 404. */
  r = await api(coach, 'DELETE', '/api/goals/' + gailGoalSp);
  check('goal delete works', r.status === 200 && r.json.ok === true, r.json);
  r = await api(coach, 'GET', '/api/goals?profileId=' + gailG);
  check('the deleted goal is gone from the list',
    r.json.goals.length === 2 && !r.json.goals.some(g => g.id === gailGoalSp), r.json.goals);
  r = await api(coach, 'DELETE', '/api/goals/' + gailGoalSp);
  check('deleting the same goal again is 404', r.status === 404, r.status);

  /* Served wiring + privacy: the Goals view/manager/athlete card
     ship in the page and JS, and goal data never reaches the TV
     board's render path. */
  {
    const tvStart2 = appJs.text.indexOf('TV BOARD');
    const tvEnd2 = appJs.text.indexOf('/* ---------------- boot', tvStart2);
    const tvCode2 = appJs.text.slice(tvStart2, tvEnd2);
    check('TV render path has no goal references',
      tvStart2 >= 0 && tvEnd2 > tvStart2 && !tvCode2.includes('/api/goals') &&
      !tvCode2.toLowerCase().includes('goal'), tvCode2.length);
    check('goals view + hub + sub-nav entries are in the served page',
      pageHtml.text.includes('id="view-goals"') && pageHtml.text.includes('id="goals-main"') &&
      pageHtml.text.includes('data-view="goals"') && pageHtml.text.includes('id="goals-slot"'),
      pageHtml.text.length);
    check('goals wiring is in the served JS',
      appJs.text.includes('renderGoals') && appJs.text.includes('renderMyGoals') &&
      appJs.text.includes('/api/goals') && appJs.text.includes("['goals', 'Goals']") &&
      appJs.text.includes("goals: 'coachhub'"));
  }

  return { coach, inventoryId: invBlocks, seedId: seed.id, willCookie: will, willProfileId: willP.id };
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
  let serverLog = '';
  const startServer = () => {
    const c = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
      env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR, SESSION_SECRET: 'test-secret' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    c.stdout.on('data', d => { serverLog += d; });
    c.stderr.on('data', d => { serverLog += d; });
    return c;
  };
  let child = startServer();
  try {
    if (!await waitForServer()) throw new Error('server did not start.\n' + serverLog);
    const ctx = await main();
    /* Restart on the same DATA_DIR: coach-entered data lives in the
       store file, so a fresh boot must still see it. */
    child.kill('SIGKILL');
    await new Promise(res => setTimeout(res, 300));
    child = startServer();
    if (!await waitForServer()) throw new Error('server did not restart.\n' + serverLog);
    const rr = await api(ctx.coach, 'GET', '/api/inventory');
    check('inventory survives a server restart',
      rr.status === 200 && rr.json.items.some(i => i.id === ctx.inventoryId),
      rr.json && rr.json.items && rr.json.items.length);
    const rw = await api(null, 'GET', '/api/warmup-cards');
    check('warm-up card edits survive a server restart',
      rw.status === 200 && !!rw.json.cards['wu-card-1'] &&
      JSON.stringify(rw.json.cards['wu-card-1']).includes('Test Marker Drill'),
      rw.json && Object.keys(rw.json.cards || {}));
    const rc = await api(ctx.coach, 'GET', '/api/custom-workouts');
    check('custom workouts survive a server restart, seed still exactly once',
      rc.status === 200 && (rc.json.workouts || []).length === 1 &&
      rc.json.workouts[0].id === ctx.seedId,
      rc.json && (rc.json.workouts || []).length);
    const rWell = await api(ctx.willCookie, 'GET', '/api/checkin/mine');
    check('check-ins + the account link survive a server restart',
      rWell.status === 200 && rWell.json.linked === true && rWell.json.entries.length === 3,
      rWell.json && rWell.json.entries && rWell.json.entries.length);
    const rWellCoach = await api(ctx.coach, 'GET', '/api/wellness/today');
    check('coach wellness view still aggregates after the restart',
      rWellCoach.status === 200 && rWellCoach.json.summary.checkedIn === 2,
      rWellCoach.json && rWellCoach.json.summary);
    /* Deleting the seed must not resurrect it: delete it, restart
       once more on the same store, and the list stays empty. */
    const rd = await api(ctx.coach, 'DELETE', '/api/custom-workouts/' + ctx.seedId);
    check('seed workout deletes before the resurrection check', rd.status === 200, rd.status);
    child.kill('SIGKILL');
    await new Promise(res => setTimeout(res, 300));
    child = startServer();
    if (!await waitForServer()) throw new Error('server did not restart (2nd).\n' + serverLog);
    const rc2 = await api(ctx.coach, 'GET', '/api/custom-workouts');
    check('deleted seed does NOT resurrect after a restart',
      rc2.status === 200 && (rc2.json.workouts || []).length === 0,
      rc2.json && (rc2.json.workouts || []).length);

    /* Env-seeded invites (COACH_INVITE_EMAILS): a fresh store gets the
       invites, a seeded email registers as coach, and a seeded invite
       the owner removes does NOT come back after a restart with the
       same env. Runs its own server/port/data dir so the main suite's
       store is untouched. */
    {
      const SEED_BASE = 'http://127.0.0.1:3218';
      const seedApi = async (cookie, method, p, body) => {
        const headers = {};
        if (cookie) headers.cookie = cookie;
        let data;
        if (body !== undefined) { data = JSON.stringify(body); headers['content-type'] = 'application/json'; }
        const res = await fetch(SEED_BASE + p, { method, headers, body: data });
        let json = null;
        try { json = await res.json(); } catch (_) { /* empty/non-json */ }
        let setCookie = [];
        try { setCookie = res.headers.getSetCookie(); } catch (_) {
          const sc = res.headers.get('set-cookie'); if (sc) setCookie = [sc];
        }
        return { status: res.status, json, setCookie };
      };
      const SEED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-seed-'));
      const seedEnv = Object.assign({}, process.env, {
        PORT: '3218', DATA_DIR: SEED_DIR, SESSION_SECRET: 'seed-secret',
        COACH_INVITE_EMAILS: ' Friend@Test.com , second@test.com ',
      });
      let seedLog = '';
      const startSeed = () => {
        const c = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
          env: seedEnv, stdio: ['ignore', 'pipe', 'pipe'],
        });
        c.stdout.on('data', d => { seedLog += d; });
        c.stderr.on('data', d => { seedLog += d; });
        return c;
      };
      const waitSeed = async () => {
        for (let i = 0; i < 60; i++) {
          try {
            const res = await fetch(SEED_BASE + '/api/content');
            if (res.status === 200) return true;
          } catch (_) { /* not up yet */ }
          await new Promise(r => setTimeout(r, 150));
        }
        return false;
      };
      let seedChild = startSeed();
      try {
        check('seed server starts with COACH_INVITE_EMAILS', await waitSeed(), seedLog);
        let sr = await seedApi(null, 'POST', '/api/register', { email: 'owner@test.com', password: 'testpass123' });
        check('seed store: first account is owner coach', sr.status === 201 && sr.json.role === 'coach' && sr.json.isOwner === true, sr.json);
        const seedOwner = cookieOf(sr);
        sr = await seedApi(seedOwner, 'GET', '/api/coach-invites');
        check('env invites are seeded, trimmed + lowercased',
          sr.status === 200 && (sr.json.invites || []).includes('friend@test.com') && (sr.json.invites || []).includes('second@test.com'),
          sr.json && sr.json.invites);
        sr = await seedApi(null, 'POST', '/api/register', { email: 'friend@test.com', password: 'testpass123' });
        check('a seeded invite registers as coach', sr.status === 201 && sr.json.role === 'coach', sr.json);
        sr = await seedApi(seedOwner, 'DELETE', '/api/coach-invites/second@test.com');
        check('owner can remove a seeded invite', sr.status === 200 && sr.json.removedInvite === true, sr.json);
        seedChild.kill('SIGKILL');
        await new Promise(r => setTimeout(r, 300));
        seedChild = startSeed();
        check('seed server restarts with the same env', await waitSeed(), seedLog);
        sr = await seedApi(null, 'POST', '/api/login', { email: 'owner@test.com', password: 'testpass123' });
        const seedOwner2 = cookieOf(sr);
        sr = await seedApi(seedOwner2, 'GET', '/api/coach-invites');
        check('removed seeded invite does NOT resurrect after restart',
          sr.status === 200 && !(sr.json.invites || []).includes('second@test.com') && (sr.json.invites || []).includes('friend@test.com'),
          sr.json && sr.json.invites);
        check('seeded list has no duplicates after restart',
          sr.status === 200 && (sr.json.invites || []).length === 1, sr.json && sr.json.invites);
        /* TV board empty state, data layer: on a fresh store the
           board's one source — coach today — has no groups yet,
           while the plan-based day still resolves a season week,
           so the board falls back to the plan workout page. The
           tracker and results stores are likewise empty. */
        sr = await seedApi(seedOwner2, 'GET', '/api/weekly/dashboard');
        check('fresh store: weekly dashboard is empty',
          sr.status === 200 && Array.isArray(sr.json.topAthletes) && sr.json.topAthletes.length === 0 &&
          Object.keys(sr.json.entries || {}).length === 0, sr.json && sr.json.topAthletes);
        sr = await seedApi(seedOwner2, 'GET', '/api/results');
        check('fresh store: results are empty',
          sr.status === 200 && Array.isArray(sr.json.results) && sr.json.results.length === 0,
          sr.json && sr.json.results && sr.json.results.length);
        sr = await seedApi(seedOwner2, 'GET', '/api/coach/today');
        check('fresh store: TV board today source still returns the plan day',
          sr.status === 200 && Number.isInteger(sr.json.week) && Array.isArray(sr.json.groups) &&
          sr.json.groups.length === 0, sr.json && sr.json.week);
        sr = await seedApi(null, 'POST', '/api/register', { email: 'second@test.com', password: 'testpass123' });
        check('registering a removed seeded invite is athlete', sr.status === 201 && sr.json.role === 'athlete', sr.json);
      } finally {
        seedChild.kill('SIGKILL');
        fs.rmSync(SEED_DIR, { recursive: true, force: true });
      }
    }

    /* Weekly coach digest: a fresh store with fixtures at known
       dates, so every aggregate can be asserted exactly. Check-ins
       accept past dates, so they land in the last completed week;
       testing results and concerns carry the server's own timestamps,
       so those sections key on the current week; fixed season dates
       carry the training and meet sections. */
    {
      const D_BASE = 'http://127.0.0.1:3219';
      const dApi = async (cookie, method, p, body) => {
        const headers = {};
        if (cookie) headers.cookie = cookie;
        let data;
        if (body !== undefined) { data = JSON.stringify(body); headers['content-type'] = 'application/json'; }
        const res = await fetch(D_BASE + p, { method, headers, body: data });
        let json = null;
        try { json = await res.json(); } catch (_) { /* empty/non-json */ }
        let setCookie = [];
        try { setCookie = res.headers.getSetCookie(); } catch (_) {
          const sc = res.headers.get('set-cookie'); if (sc) setCookie = [sc];
        }
        return { status: res.status, json, setCookie };
      };
      const dText = async (p) => {
        const res = await fetch(D_BASE + p);
        return { status: res.status, text: await res.text() };
      };
      const D_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-digest-'));
      let dLog = '';
      const dChild = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
        env: Object.assign({}, process.env, {
          PORT: '3219', DATA_DIR: D_DIR, SESSION_SECRET: 'digest-secret',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      dChild.stdout.on('data', d => { dLog += d; });
      dChild.stderr.on('data', d => { dLog += d; });
      const waitD = async () => {
        for (let i = 0; i < 60; i++) {
          try {
            const res = await fetch(D_BASE + '/api/content');
            if (res.status === 200) return true;
          } catch (_) { /* not up yet */ }
          await new Promise(r => setTimeout(r, 150));
        }
        return false;
      };
      const dPad = (n) => String(n).padStart(2, '0');
      const dFmt = (d) => d.getFullYear() + '-' + dPad(d.getMonth() + 1) + '-' + dPad(d.getDate());
      const dAdd = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return dFmt(d); };
      const dMonday = (s) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dFmt(d); };
      try {
        check('digest server starts', await waitD(), dLog);
        const dPage = await dText('/');
        check('digest view markers are in the served page',
          dPage.status === 200 && dPage.text.includes('id="view-digest"') &&
          dPage.text.includes('data-view="digest"') && dPage.text.includes('id="digest-main"'));
        const dJs = await dText('/app.js');
        check('digest wiring is in the served JS',
          dJs.status === 200 && dJs.text.includes('renderDigest') && dJs.text.includes('/api/digest'));

        let dr = await dApi(null, 'POST', '/api/register', { email: 'dcoach@test.com', password: 'testpass123' });
        check('digest store: first account is coach', dr.status === 201 && dr.json.role === 'coach', dr.json);
        const dCoach = cookieOf(dr);
        dr = await dApi(null, 'POST', '/api/register', { email: 'amy@test.com', password: 'testpass123' });
        const dAmy = cookieOf(dr);
        dr = await dApi(null, 'POST', '/api/register', { email: 'ben@test.com', password: 'testpass123' });
        const dBen = cookieOf(dr);

        dr = await dApi(dAmy, 'GET', '/api/digest');
        check('digest is 403 for athletes', dr.status === 403, dr.status);
        dr = await dApi(null, 'GET', '/api/digest');
        check('digest is 401 logged out', dr.status === 401, dr.status);
        dr = await dApi(dCoach, 'GET', '/api/digest?week=2026-02-30');
        check('digest rejects an impossible week date', dr.status === 400, dr.status);
        dr = await dApi(dCoach, 'GET', '/api/digest?week=banana');
        check('digest rejects a non-date week', dr.status === 400, dr.status);

        dr = await dApi(dCoach, 'POST', '/api/groups', { name: 'Digest Group' });
        const dGroup = dr.json.group;
        dr = await dApi(dCoach, 'POST', '/api/profiles', { firstName: 'Amy', lastName: 'Ace', groupId: dGroup.id, events: ['sprinter'] });
        const amyP = dr.json.profile;
        dr = await dApi(dCoach, 'POST', '/api/profiles', { firstName: 'Ben', lastName: 'Bolt', groupId: dGroup.id, events: ['sprinter'] });
        const benP = dr.json.profile;
        dr = await dApi(dCoach, 'PUT', '/api/profiles/' + amyP.id + '/link', { email: 'amy@test.com' });
        check('digest fixtures: amy linked to her profile', dr.status === 200 && dr.json.accountLinked === true, dr.json);
        await dApi(dCoach, 'PUT', '/api/profiles/' + benP.id + '/link', { email: 'ben@test.com' });

        /* --- check-ins, in the last completed week --- */
        const todayS = dFmt(new Date());
        const thisMon = dMonday(todayS);
        const lastMon = dAdd(thisMon, -7);
        const inLast = (n) => dAdd(lastMon, n);
        const ci = (cookie, date, body) => dApi(cookie, 'POST', '/api/checkin', Object.assign({ date }, body));
        let cr = await ci(dAmy, inLast(0), { sleep: 5, soreness: 5, energy: 2 });
        check('digest fixtures: amy monday check-in saves', cr.status === 201, cr.status);
        await ci(dAmy, inLast(2), { sleep: 5.5, soreness: 3, energy: 4 });
        await ci(dAmy, inLast(4), { sleep: 8, soreness: 2, energy: 5 });
        await ci(dBen, inLast(1), { sleep: 7, soreness: 4, energy: 3 });

        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + inLast(2));
        check('digest normalizes a Wednesday to its Monday',
          dr.status === 200 && dr.json.week === lastMon && dr.json.weekEnd === dAdd(lastMon, 6),
          dr.json && dr.json.week);
        const dci = dr.json.checkins;
        check('digest check-ins: participation is recorded / roster x 7',
          dci.recorded === 4 && dci.possible === 14 && dci.percent === 29 && dci.roster === 2, dci);
        check('digest check-ins: team averages',
          dci.avgSleep === 6.38 && dci.avgSoreness === 3.5 && dci.avgEnergy === 3.5, dci);
        check('digest check-ins: most-flagged first, with the main flag named',
          dci.flaggedCount === 2 && dci.flagged.length === 2 &&
          dci.flagged[0].name === 'Amy Ace' && dci.flagged[0].flaggedDays === 2 && dci.flagged[0].mainFlag === 'low-sleep' &&
          dci.flagged[1].name === 'Ben Bolt' && dci.flagged[1].mainFlag === 'high-soreness', dci.flagged);
        dr = await dApi(dCoach, 'GET', '/api/digest');
        check('digest default week is the most recent completed week',
          dr.status === 200 && dr.json.week === lastMon && dr.json.checkins.recorded === 4,
          dr.json && dr.json.week);

        /* --- training, on fixed season dates (week 2) --- */
        const W2 = '2026-11-02';
        await dApi(dCoach, 'POST', '/api/completions', { profileId: amyP.id, date: '2026-11-02' });
        await dApi(dCoach, 'POST', '/api/completions', { profileId: amyP.id, date: '2026-11-04' });
        await dApi(dCoach, 'POST', '/api/completions', { profileId: benP.id, date: '2026-11-02' });
        await dApi(dCoach, 'POST', '/api/completions', { profileId: amyP.id, date: '2026-10-26' });
        const dContent = (await dApi(null, 'GET', '/api/content')).json;
        const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const wk2 = dContent.weeks.find(w => w.start === W2);
        const assignedW2 = dayKeys.filter(k => /[A-Z]{2,3}-\d{2}/.test(String(wk2[k] || ''))).length;
        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + W2);
        const dtr = dr.json.training.groups.find(g => g.group.id === dGroup.id);
        check('digest training: completions counted per group for the week, other weeks excluded',
          !!dtr && dtr.completions === 3 && dtr.completedDays === 2, dtr);
        check('digest training: assigned days match the season plan for the week',
          !!dtr && assignedW2 > 0 && dtr.assigned === assignedW2, dtr && [dtr.assigned, assignedW2]);
        dr = await dApi(dCoach, 'GET', '/api/digest?week=2026-10-26');
        const dtr1 = dr.json.training.groups.find(g => g.group.id === dGroup.id);
        check('digest training: week 1 sees only its own completion',
          !!dtr1 && dtr1.completions === 1 && dtr1.completedDays === 1, dtr1);

        /* --- week ahead snapshot for the W2 digest --- */
        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + W2);
        const wa = dr.json.weekAhead;
        const wk3 = dContent.weeks.find(w => w.start === '2026-11-09');
        const sessById = {};
        for (const s of dContent.sessions) sessById[s.id] = s;
        let expTrain = 0, expHigh = 0;
        for (const k of dayKeys) {
          const text = String(wk3[k] || '');
          const codes = text.match(/[A-Z]{2,3}-\d{2}/g) || [];
          const isMeet = /\bMEET\b|championships/i.test(text);
          const isTest = /\bTEST\b/i.test(text);
          const isOff = !codes.length && !isMeet && !isTest && /off/i.test(text);
          if (!isOff) expTrain++;
          if (!isOff && (codes.some(c => sessById[c] && sessById[c].cns_demand === 'high') || isTest || isMeet)) expHigh++;
        }
        check('digest week ahead: plan snapshot matches the season plan',
          wa.week === '2026-11-09' && wa.weekEnd === '2026-11-15' && wa.seasonWeek === 3 &&
          wa.trainingDays === expTrain && wa.highDays === expHigh && wa.days.length === 7 &&
          wa.days[0].codes.join('+') === 'ACC-01+STR-01',
          { got: [wa.week, wa.seasonWeek, wa.trainingDays, wa.highDays], exp: [expTrain, expHigh] });

        /* --- meet results + the record board --- */
        const rec100 = ['10.80', '10.85', '10.90', '10.95', '11.00', '11.05', '11.10', '11.15', '11.20', '11.25'];
        for (let i = 0; i < rec100.length; i++) {
          await dApi(dCoach, 'POST', '/api/records', { event: '100m', mark: rec100[i], name: 'Record ' + (i + 1), year: 2000 + i });
        }
        await dApi(dCoach, 'POST', '/api/records', { event: '200m', mark: '22.50', name: 'Record A', year: 2001 });
        await dApi(dCoach, 'POST', '/api/records', { event: '200m', mark: '23.00', name: 'Record B', year: 2002 });
        const mr = (profileId, date, event, mark) =>
          dApi(dCoach, 'POST', '/api/meet-results', { profileId, date, meet: 'November Classic', event, mark });
        await mr(benP.id, '2026-10-31', '200m', '24.00');
        await mr(amyP.id, '2026-10-31', '200m', '23.40');
        await mr(amyP.id, '2026-11-07', '200m', '22.40');
        await mr(amyP.id, '2026-11-07', '100m', '11.30');
        await mr(benP.id, '2026-11-07', '100m', '11.40');
        await mr(amyP.id, '2026-11-08', '200m', '22.90');
        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + W2);
        const dperf = dr.json.performance;
        check('digest performance: meet results counted in window only',
          dperf.meetResults.count === 4, dperf.meetResults);
        check('digest performance: standing PRs only — beaten and non-PR marks excluded',
          dperf.meetResults.prs.length === 3 &&
          dperf.meetResults.prs.every(pr => pr.date >= '2026-11-02' && pr.date <= '2026-11-08'),
          dperf.meetResults.prs);
        const amy200 = dperf.meetResults.prs.find(pr => pr.profileId === amyP.id && pr.event === '200m');
        check('digest performance: a PR that cracks the record board is flagged with its rank',
          !!amy200 && amy200.recordBoard === true && amy200.recordRank === 1 && amy200.mark === '22.40', amy200);
        const amy100 = dperf.meetResults.prs.find(pr => pr.profileId === amyP.id && pr.event === '100m');
        check('digest performance: a PR off a deep board is not flagged',
          !!amy100 && amy100.recordBoard === false && amy100.recordRank === 11, amy100);

        /* Goals: amy's 200m target falls inside W2 (the 22.40);
           ben's fell the week before (his 24.00 on Oct 31). */
        await dApi(dCoach, 'POST', '/api/goals', { profileId: amyP.id, event: '200m', target: '22.50' });
        await dApi(dCoach, 'POST', '/api/goals', { profileId: benP.id, event: '200m', target: '24.50' });
        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + W2);
        const dGoals = dr.json.performance.goalsAchieved;
        check('digest performance: goals achieved that week, dated by the achieving result',
          Array.isArray(dGoals) && dGoals.length === 1 && dGoals[0].profileId === amyP.id &&
          dGoals[0].event === '200m' && dGoals[0].mark === '22.40' && dGoals[0].date === '2026-11-07',
          dGoals);
        dr = await dApi(dCoach, 'GET', '/api/digest?week=2026-10-26');
        const dGoals1 = dr.json.performance.goalsAchieved;
        check('digest performance: last week owns the goal that fell then, not this week\u2019s',
          Array.isArray(dGoals1) && dGoals1.length === 1 && dGoals1[0].profileId === benP.id &&
          dGoals1[0].date === '2026-10-31', dGoals1);

        /* --- testing entered this week (server timestamps) --- */
        dr = await dApi(dCoach, 'POST', '/api/test-days', { date: lastMon, title: 'Digest Test Day', testKeys: ['vertical-jump', 'broad-jump'] });
        const dDay = dr.json.testDay;
        await dApi(dCoach, 'POST', '/api/results', { profileId: amyP.id, testDayId: dDay.id, testKey: 'vertical-jump', value: 24 });
        await dApi(dCoach, 'POST', '/api/results', { profileId: benP.id, testDayId: dDay.id, testKey: 'vertical-jump', value: 22 });
        await dApi(dCoach, 'POST', '/api/results', { profileId: amyP.id, testDayId: dDay.id, testKey: 'broad-jump', value: 96 });
        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + todayS);
        const dtest = dr.json.performance.testing;
        check('digest performance: testing entered this week, counted by test',
          dtest.total === 3 && dtest.byTest.length === 2 &&
          (dtest.byTest.find(t => t.testKey === 'vertical-jump') || {}).count === 2 &&
          (dtest.byTest.find(t => t.testKey === 'broad-jump') || {}).count === 1, dtest);
        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + W2);
        check('digest performance: no testing leaks into another week',
          dr.json.performance.testing.total === 0, dr.json.performance.testing);

        /* --- health: opened/cleared this week + current snapshot --- */
        dr = await dApi(dCoach, 'POST', '/api/concerns', { profileId: amyP.id, area: 'knee', side: 'left', feeling: 'ache', impact: 'modified', started: todayS, pain: 5 });
        check('digest fixtures: concern opens', dr.status === 201, dr.status);
        dr = await dApi(dCoach, 'POST', '/api/concerns', { profileId: benP.id, area: 'shin', side: 'right', feeling: 'soreness', impact: 'none', started: todayS, pain: 3 });
        const benConcern = dr.json.concern;
        dr = await dApi(dCoach, 'PUT', '/api/concerns/' + benConcern.id, { status: 'cleared' });
        check('digest fixtures: concern clears', dr.status === 200 && dr.json.concern.status === 'cleared', dr.status);
        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + todayS);
        check('digest health: opened + cleared this week, with the current snapshot',
          dr.json.health.opened === 2 && dr.json.health.cleared === 1 &&
          dr.json.health.open === 1 && dr.json.health.monitoring === 0, dr.json.health);
        dr = await dApi(dCoach, 'GET', '/api/digest?week=' + W2);
        check('digest health: nothing opened or cleared in a fixed past week',
          dr.json.health.opened === 0 && dr.json.health.cleared === 0, dr.json.health);

        /* --- a week with nothing in it --- */
        dr = await dApi(dCoach, 'GET', '/api/digest?week=2027-06-09');
        check('digest: an untouched week returns every section empty, still 200',
          dr.status === 200 && dr.json.checkins.recorded === 0 && dr.json.checkins.avgSleep === null &&
          dr.json.checkins.flagged.length === 0 &&
          dr.json.training.groups.every(g => g.completions === 0) &&
          dr.json.performance.meetResults.count === 0 && dr.json.performance.meetResults.prs.length === 0 &&
          dr.json.performance.testing.total === 0 &&
          dr.json.health.opened === 0 && dr.json.health.cleared === 0 &&
          dr.json.weekAhead.days.length === 7, dr.json && dr.json.week);
      } finally {
        dChild.kill('SIGKILL');
        fs.rmSync(D_DIR, { recursive: true, force: true });
      }
    }
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
