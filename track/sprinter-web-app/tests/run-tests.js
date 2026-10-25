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
  check('service worker cache is bumped to v14',
    swJs.status === 200 && swJs.text.includes("sprinter-app-v15"), swJs.text.slice(0, 80));

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
  check('meet events list has 17 events with directions',
    r.status === 200 && r.json.events.length === 17 &&
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

  return { coach, inventoryId: invBlocks };
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
