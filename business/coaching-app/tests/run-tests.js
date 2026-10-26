#!/usr/bin/env node
/*
 * Ruffin Performance — server test suite.
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
    cache: res.headers.get('cache-control') || '',
  };
}

async function main() {
  /* ---------------- content + auth ---------------- */
  let r = await api(null, 'GET', '/api/content');
  check('content loads', r.status === 200);
  check('content counts are 57/17/29 (49 library + 8 Instagram sessions)',
    r.json.sessions.length === 57 && r.json.drills.length === 17 && r.json.weeks.length === 29,
    [r.json.sessions.length, r.json.drills.length, r.json.weeks.length]);
  const drl17 = (r.json.drills || []).find(d => d.id === 'DRL-17');
  check('DRL-17 is the 90/90 Hip Switches drill with the exact fields',
    !!drl17 && drl17.name === '90/90 Hip Switches' && drl17.category === 'dynamic_stretch' &&
    drl17.distance_or_reps === '8-10 switches' &&
    drl17.coaching_cue === "Hips square, sit tall — rotate, don't lean" &&
    drl17.source === 'AJ demo, Oct 2026', drl17);
  r = await api(null, 'GET', '/');
  check('home page serves', r.status === 200);

  /* The fork ships NO school data: the club record board starts
     empty and fills only with marks a coach adds here. */
  r = await api(null, 'GET', '/api/records');
  check('club records list starts empty', r.status === 200 &&
    Array.isArray(r.json.records) && r.json.records.length === 0, r.json);
  r = await api(null, 'GET', '/api/records/board');
  check('club record board starts empty in every event', r.status === 200 &&
    Array.isArray(r.json.board) && r.json.board.length > 0 &&
    r.json.board.every(b => Array.isArray(b.entries) && b.entries.length === 0),
    r.json && r.json.board && r.json.board.length);

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
    /* DRL-17 (90/90 Hip Switches) is AJ's own demo drill, added for its
       video; the glossary covers the movement as "90/90 Hip Rotations",
       so the define-every-drill guard below keeps its original scope
       (the 16 AJ-plan drills) while the count moves to the new truth. */
    const definedDrillNames = drillNames.filter(n => n !== '90/90 Hip Switches');
    check('all 16 AJ-plan drill names appear as glossary terms (17 drills total)',
      drillNames.length === 17 && definedDrillNames.length === 16 &&
      definedDrillNames.every(n => glossNorms.has(normTerm(n))),
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

  /* ---------------- instagram-mined content ----------------
     The Exercise Library (Learn) serves the 85 movements mined
     from AJ's saved Instagram training posts, and the 8 mined
     workouts ride along as library sessions IG-01..IG-08 — the
     original 49 sessions untouched, in front, in order. Every
     number in an IG session is one the source post stated. */
  const exlib = contentJson.exerciseLibrary;
  check('exercise library serves an array', Array.isArray(exlib), typeof exlib);
  check('exercise library has 85 movements', Array.isArray(exlib) && exlib.length === 85,
    Array.isArray(exlib) ? exlib.length : 'not an array');
  if (Array.isArray(exlib)) {
    check('every movement has name/trains/equipment/cues and an https instagram source link',
      exlib.every(m => ['name', 'trains', 'equipment', 'cues', 'sourceUsername']
        .every(f => typeof m[f] === 'string' && m[f].trim().length > 0)
        && /^https:\/\/www\.instagram\.com\//.test(m.sourceUrl || '')),
      exlib.find(m => !/^https:\/\/www\.instagram\.com\//.test(m.sourceUrl || '')));
    check('movement names are unique', new Set(exlib.map(m => m.name)).size === 85);
    check('movements keep their trains/equipment as clean fields (later tagging stage)',
      exlib.every(m => typeof m.trains === 'string' && typeof m.equipment === 'string'));
    const nordic = exlib.find(m => m.name === 'Nordic Hamstring Curl');
    check('a movement saved from two posts keeps both sources, primary first',
      !!nordic && Array.isArray(nordic.sources) && nordic.sources.length === 2 &&
      nordic.sourceUrl === nordic.sources[0].sourceUrl &&
      nordic.sourceUsername === 'brayllln' &&
      nordic.sources[1].sourceUsername === 'dereksamuelmpt',
      nordic && nordic.sources);
    check('spot movements are in the library (wall drill, block start, band-assisted pull-up)',
      ['Wall Drill (Acceleration Wall Series)', 'Block Start', 'Band-Assisted Pull-Up']
        .every(n => exlib.some(m => m.name === n)));
  }
  check('exercise library view markers are in the served page',
    pageHtml.status === 200 && pageHtml.text.includes('id="view-exercises"') &&
    pageHtml.text.includes('data-view="exercises"') && pageHtml.text.includes('id="ex-list"') &&
    pageHtml.text.includes('id="ex-count"'));
  check('exercise library wiring is in the served JS (alphabetical render, source links, multi-source note)',
    appJs.status === 200 && appJs.text.includes('renderExercises') &&
    appJs.text.includes('exCardHtml') && appJs.text.includes('exerciseLibrary') &&
    appJs.text.includes('localeCompare') && appJs.text.includes('more') &&
    appJs.text.includes("name === 'exercises'"));
  /* Exercise Library depth (stage 6): every movement ships one
     category from the fixed set, keyword-derived trains tags and
     normalized equipment tags — all derived at content-build time
     in scripts/build-content.py. The view filters over them with
     the pure EXERCISE-FILTER core, exercised here at the data
     level against the real library, runner-core style. */
  if (Array.isArray(exlib)) {
    const EX_CATS = ['Sprint Mechanics', 'Plyometrics', 'Olympic Lifts', 'Strength',
      'Isometrics', 'Core', 'Mobility'];
    check('every movement ships a fixed-set category plus non-empty tag lists',
      exlib.every(m => EX_CATS.includes(m.category)
        && Array.isArray(m.trainsTags) && m.trainsTags.length > 0
        && m.trainsTags.every(t => typeof t === 'string' && t.trim())
        && Array.isArray(m.equipmentTags) && m.equipmentTags.length > 0
        && m.equipmentTags.every(t => typeof t === 'string' && t.trim())));
    const catDist = {};
    for (const m of exlib) catDist[m.category] = (catDist[m.category] || 0) + 1;
    check('category distribution covers all 85 movements, each category >= 2',
      EX_CATS.every(c => (catDist[c] || 0) >= 2)
      && Object.values(catDist).reduce((a, b) => a + b, 0) === 85,
      catDist);
    check('original mined fields survive alongside the derived depth fields',
      exlib.every(m => ['name', 'trains', 'equipment', 'cues', 'sources',
        'sourceUrl', 'sourceUsername', 'postId']
        .every(f => m[f] !== undefined)));
    const byName6 = n => exlib.find(m => m.name === n);
    const nordic6 = byName6('Nordic Hamstring Curl');
    check('spot check: Nordic is Strength, Hamstrings + Eccentric tags, Bench gear',
      !!nordic6 && nordic6.category === 'Strength'
      && nordic6.trainsTags.includes('Hamstrings') && nordic6.trainsTags.includes('Eccentric')
      && nordic6.equipmentTags.includes('Bench'), nordic6);
    const clean6 = byName6('Clean (Teaching Progression)');
    check('spot check: the Clean progression is Olympic Lifts with Barbell gear',
      !!clean6 && clean6.category === 'Olympic Lifts'
      && clean6.equipmentTags.includes('Barbell'), clean6);
    const hip9090 = byName6('90/90 Hip Stretch');
    check('spot check: 90/90 is Mobility, Hip Mobility tag, Mat gear',
      !!hip9090 && hip9090.category === 'Mobility'
      && hip9090.trainsTags.includes('Hip Mobility')
      && hip9090.equipmentTags.includes('Mat'), hip9090);
    const block6 = byName6('Block Start');
    check('spot check: Block Start is Sprint Mechanics with Starting Blocks gear',
      !!block6 && block6.category === 'Sprint Mechanics'
      && block6.equipmentTags.includes('Starting Blocks'), block6);
    const bridge6 = byName6('Glute Bridge');
    check('spot check: a floor movement normalizes to exactly No Equipment',
      !!bridge6 && bridge6.equipmentTags.length === 1
      && bridge6.equipmentTags[0] === 'No Equipment', bridge6);
    const pedal6 = byName6('Anti-Rotation Back Pedal');
    check('spot check: back-pedal earns no Back & Spine tag (muscle rules read trains only)',
      !!pedal6 && pedal6.trainsTags.includes('Core & Trunk')
      && !pedal6.trainsTags.includes('Back & Spine'), pedal6);
  }
  check('exercise depth controls are in the served page (search, three chip rows, clear)',
    pageHtml.text.includes('id="ex-search"') && pageHtml.text.includes('id="ex-chips"') &&
    pageHtml.text.includes('id="ex-eq-chips"') && pageHtml.text.includes('id="ex-tag-chips"') &&
    pageHtml.text.includes('id="ex-clear"'));
  check('exercise depth wiring is in the served JS (filter core, facets, clear, empty state)',
    appJs.text.includes('EXERCISE-FILTER-BEGIN') && appJs.text.includes('exerciseMatches') &&
    appJs.text.includes('EX_CATEGORIES') && appJs.text.includes('data-excat') &&
    appJs.text.includes('data-exequip') && appJs.text.includes('data-extag') &&
    appJs.text.includes('clearExerciseFilters') &&
    appJs.text.includes('No movements match — clear filters'));
  const exCoreMatch = appJs.text.match(/\/\* EXERCISE-FILTER-BEGIN \*\/([\s\S]*?)\/\* EXERCISE-FILTER-END \*\//);
  check('exercise filter core is extractable for data-level tests', !!exCoreMatch);
  if (exCoreMatch && Array.isArray(exlib)) {
    const exCore = new Function(exCoreMatch[1] + '\nreturn { exerciseMatches };')();
    const runEx = f => exlib.filter(m => exCore.exerciseMatches(m, f));
    check('filter: no facets returns the whole library',
      runEx({ query: '', category: 'All', equipment: 'All', tags: [] }).length === 85);
    const mobCount = exlib.filter(m => m.category === 'Mobility').length;
    check('filter: a category returns exactly its members',
      runEx({ query: '', category: 'Mobility', equipment: 'All', tags: [] }).length === mobCount,
      mobCount);
    const interCount = exlib.filter(m => m.trainsTags.includes('Hamstrings')
      && m.trainsTags.includes('Eccentric')).length;
    check('filter: multiple tags must ALL match (AND semantics)',
      runEx({ query: '', category: 'All', equipment: 'All', tags: ['Hamstrings', 'Eccentric'] }).length === interCount
      && interCount > 0
      && interCount < exlib.filter(m => m.trainsTags.includes('Hamstrings')).length,
      interCount);
    const bandCount = exlib.filter(m => m.equipmentTags.includes('Resistance Band')).length;
    check('filter: an equipment value returns exactly its carriers',
      runEx({ query: '', category: 'All', equipment: 'Resistance Band', tags: [] }).length === bandCount,
      bandCount);
    check('filter: search hits name, trains and cues',
      runEx({ query: 'nordic', category: 'All', equipment: 'All', tags: [] }).length === 1
      && runEx({ query: 'nordic', category: 'All', equipment: 'All', tags: [] })[0].name === 'Nordic Hamstring Curl'
      && runEx({ query: 'iliopsoas', category: 'All', equipment: 'All', tags: [] }).length >= 1
      && runEx({ query: 'partner helps', category: 'All', equipment: 'All', tags: [] })
        .some(m => m.name === 'Single-Leg Eccentric Hamstring Curl'));
    check('filter: facets combine (category AND equipment AND search)',
      runEx({ query: 'band', category: 'Strength', equipment: 'Resistance Band', tags: [] }).length >= 1
      && runEx({ query: 'band', category: 'Strength', equipment: 'Resistance Band', tags: [] })
        .every(m => m.category === 'Strength' && m.equipmentTags.includes('Resistance Band'))
      && runEx({ query: 'band', category: 'Mobility', equipment: 'Barbell', tags: [] }).length === 0);
  }
  const allSessions = contentJson.sessions;
  const igSessions = allSessions.filter(s => s.id.startsWith('IG-'));
  const origIds = ['ACC-01', 'ACC-02', 'ACC-03', 'ACC-04', 'MAX-01', 'MAX-02', 'MAX-03',
    'SE-01', 'SE-02', 'SE-03', 'SE-04', 'SE-05', 'SE-06', 'SPE-01', 'SPE-02',
    'TEM-01', 'TEM-02', 'TEM-03', 'TEM-04', 'RM-01', 'RM-02', 'RM-03', 'RM-04', 'RM-05',
    'STR-01', 'STR-02', 'PLY-01', 'PLY-02', 'REC-01',
    'QTR-01', 'QTR-02', 'QTR-03', 'QTR-04', 'QTR-05', 'QTR-06', 'QTR-07', 'QTR-08',
    'QTR-09', 'QTR-10', 'QTR-11', 'QTR-12', 'WUP-01', 'WUP-02', 'WUP-03',
    'XT-01', 'XT-02', 'XT-03', 'XT-04', 'XT-05'];
  check('the original 49 sessions are intact and first, in order',
    allSessions.slice(0, 49).map(s => s.id).join(',') === origIds.join(','),
    allSessions.slice(0, 49).map(s => s.id).join(','));
  check('IG-01..IG-08 follow the library sessions',
    igSessions.map(s => s.id).join(',') === 'IG-01,IG-02,IG-03,IG-04,IG-05,IG-06,IG-07,IG-08',
    igSessions.map(s => s.id));
  check('every IG session carries its instagram source, structure and runner blocks',
    igSessions.length === 8 && igSessions.every(s =>
      /^https:\/\/www\.instagram\.com\//.test(s.source_url || '') &&
      typeof s.source_username === 'string' && s.source_username.length > 0 &&
      Array.isArray(s.structure) && s.structure.length > 0 &&
      s.structure.every(b => typeof b.block === 'string' && Array.isArray(b.lines) && b.lines.length > 0) &&
      Array.isArray(s.blocks) && s.blocks.length > 0),
    igSessions.map(s => s.id));
  const ig07 = igSessions.find(s => s.id === 'IG-07');
  check('IG-07 structure lines carry only the stated numbers (4 x 10 with the 2 sec pause)',
    !!ig07 && ig07.structure[0].lines[0] === 'Cable Rope Pushdown — 4 × 10 (2 sec pause)' &&
    ig07.structure[0].lines[1] === 'Cable Kickback — 3 × 15 per arm' &&
    ig07.rest === '40 sec', ig07 && ig07.structure[0].lines);
  const ig01 = igSessions.find(s => s.id === 'IG-01');
  check('IG-01 states plainly that no sets/reps were given',
    !!ig01 && /no sets or reps stated/.test(ig01.reps) && ig01.quality === 'warm_up', ig01 && ig01.reps);
  const ig02 = igSessions.find(s => s.id === 'IG-02');
  check('IG-02 is the high-CNS max-velocity day its post describes',
    !!ig02 && ig02.quality === 'max_velocity' && ig02.cns_demand === 'high' &&
    /10% velocity decrement/.test(ig02.reps), ig02 && ig02.reps);
  check('IG session detail renders structure and a linked From Instagram line',
    appJs.text.includes('sessionStructureHtml') && appJs.text.includes('From Instagram:') &&
    appJs.text.includes('s.source_url'));
  /* IG runner walks, through the same extracted runner core the
     custom-workout tests use: sessions carrying blocks launch with
     those blocks verbatim. */
  const igCoreMatch = appJs.text.match(/\/\* RUNNER-CORE-BEGIN \*\/([\s\S]*?)\/\* RUNNER-CORE-END \*\//);
  if (igCoreMatch) {
    const igCore = new Function(igCoreMatch[1] +
      '\nreturn { buildRunnerSteps, sessionToRunnerPlan };')();
    const absSteps = igCore.buildRunnerSteps(igCore.sessionToRunnerPlan(
      igSessions.find(s => s.id === 'IG-08')));
    check('IG-08 runs as 4 rounds of 5 exercises with 120s round rests (23 steps)',
      absSteps.filter(s => s.type === 'exercise').length === 20 &&
      absSteps.filter(s => s.type === 'rest').length === 3 &&
      absSteps.filter(s => s.type === 'rest').every(s => s.seconds === 120) &&
      absSteps.length === 23, absSteps.length);
    const triSteps = igCore.buildRunnerSteps(igCore.sessionToRunnerPlan(
      igSessions.find(s => s.id === 'IG-07')));
    check('IG-07 runs every stated set (19 exercise steps, 40s rests)',
      triSteps.filter(s => s.type === 'exercise').length === 19 &&
      triSteps[0].name === 'Cable Rope Pushdown' && triSteps[0].reps === '10 · 2 sec pause' &&
      triSteps.filter(s => s.type === 'rest').every(s => s.seconds === 40), triSteps.length);
    const conSteps = igCore.buildRunnerSteps(igCore.sessionToRunnerPlan(
      igSessions.find(s => s.id === 'IG-03')));
    check('IG-03 runs as a single pass through all 5 contrast variations (10 steps, no invented rests)',
      conSteps.length === 10 && conSteps.every(s => s.type === 'exercise'), conSteps.length);
    check('IG sessions launch through their own blocks, not the spec mapping',
      igCore.sessionToRunnerPlan(igSessions.find(s => s.id === 'IG-06')).blocks ===
      igSessions.find(s => s.id === 'IG-06').blocks);
  }
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
  check('service worker cache is the RP v3 cache',
    swJs.status === 200 && swJs.text.includes("ruffin-performance-v3"), swJs.text.slice(0, 80));
  check('service worker navigations go network-first (rollback: shell no longer carries fonts.css)',
    !swJs.text.includes('/fonts.css') && swJs.text.includes('networkFirstNavigation') &&
    swJs.text.includes("request.mode === 'navigate'"));
  const fontsCssRes = await apiText(null, '/fonts.css');
  check('rollback: fonts.css is gone (the embedded Archivo/JetBrains faces left with the design pass)',
    !fontsCssRes.type.includes('text/css') && !fontsCssRes.text.includes('@font-face') &&
    !fontsCssRes.text.includes('Archivo') && !pageHtml.text.includes('/fonts.css'));
  check('shell files revalidate (Cache-Control: no-cache on /, sw.js, app.js, styles.css)',
    /no-cache/.test(pageHtml.cache) && /no-cache/.test(swJs.cache) &&
    /no-cache/.test(appJs.cache) && /no-cache/.test((await apiText(null, '/styles.css')).cache));

  /* ---- In-place row updates regression guards ----
     Each save handler segment is sliced out of the served app.js.
     If a handler ever falls back to re-rendering its whole view,
     these checks fail — a full re-render drops scroll position,
     keyboard focus, and unsaved edits in other rows. */
  const seg = (startMark, endMark) => {
    const a = appJs.text.indexOf(startMark);
    const b = endMark ? appJs.text.indexOf(endMark, a + 1) : -1;
    return a >= 0 && (endMark == null || b > a) ? appJs.text.slice(a, endMark == null ? undefined : b) : '';
  };
  check('app JS parses as valid JavaScript',
    (() => { try { new (require('vm').Script)(appJs.text); return true; } catch (_) { return false; } })());
  check('in-place helpers exist (saved flash + per-row error flag)',
    appJs.text.includes('function flashSaved(') &&
    appJs.text.includes('function showRowError(') &&
    appJs.text.includes('function clearRowError('));
  const checkSeg = seg('const wireCheckRow', 'const groupCard');
  check('checklist: rows carry data-check-row identity',
    appJs.text.includes('data-check-row="${m.profile.id}"'));
  check('checklist: mark/unmark saves in place (no full renderCoach in handler)',
    checkSeg.includes("apiPost('/api/completions'") && checkSeg.includes('flashSaved(row)') &&
    checkSeg.includes('showRowError(row') && !checkSeg.includes('renderCoach('), checkSeg.slice(0, 120));
  const applySeg = seg('const applyResultInPlace', 'const wireRapidBlock');
  check('testing: saved result folds into day data + progress cell + ranked zone in place',
    applySeg.includes('dayResults') && applySeg.includes('setProgressCell') &&
    applySeg.includes('refreshRankedInPlace()'));
  const rapidSeg = seg('const wireRapidBlock', 'const renderRapid');
  check('testing rapid: single save updates only its block (no full renderTesting in handler)',
    rapidSeg.includes("apiPost('/api/results'") && rapidSeg.includes('applyResultInPlace') &&
    rapidSeg.includes('showRowError(block') && rapidSeg.includes('flashSaved(block)') &&
    !rapidSeg.includes('renderTesting('), rapidSeg.slice(0, 120));
  const gridSeg = seg("gridSave.addEventListener", 'const renderHist');
  check('testing grid: bulk success updates derived zones in place (no full renderTesting)',
    gridSeg.includes('refreshRankedInPlace()') && gridSeg.includes('setProgressCell') &&
    gridSeg.includes('grid-ok') && !gridSeg.includes('renderTesting('), gridSeg.slice(0, 120));
  check('testing grid: bulk failure focuses the first errored cell in place',
    gridSeg.includes('td.cell-error input') && gridSeg.includes('firstBad.focus()'));
  const weeklySeg = seg("querySelectorAll('[data-weekly-save]')", "$('#custommetric-form')");
  check('top athletes: weekly save updates its row + athlete charts in place (no full renderTop)',
    weeklySeg.includes("apiPut('/api/weekly/entry'") && weeklySeg.includes('data-weekly-now') &&
    weeklySeg.includes('refreshAthleteChartsInPlace') && weeklySeg.includes('showRowError(row') &&
    !weeklySeg.includes('renderTop('), weeklySeg.slice(0, 120));
  check('top athletes: compare chart refresh is deferred with a visible cue',
    weeklySeg.includes('compare-cue') && weeklySeg.includes('Standings updated'));
  const qrSeg = seg("qrSave.addEventListener", 'async function renderRecords');
  check('meet day: quick-result save updates badges/marks/summary/checklist in place (no full renderMeetDay)',
    qrSeg.includes('data-qr-badge') && qrSeg.includes('data-entry-result-for') &&
    qrSeg.includes('out.summary') && qrSeg.includes('out.checklist') &&
    qrSeg.includes("state.meetDayFlags") && !qrSeg.includes('renderMeetDay('), qrSeg.slice(0, 120));

  r = await api(null, 'POST', '/api/register', { email: 'coach@test.com', password: 'testpass123' });
  check('first register is 201', r.status === 201, r.status);
  check('first account is coach', r.json.role === 'coach', r.json.role);
  const coach = cookieOf(r);
  r = await api(null, 'POST', '/api/register', { email: 'stranger@test.com', password: 'testpass123' });
  check('uninvited registration is 403 (invite-only pilot)',
    r.status === 403 && /invite-only/.test(r.json.error || ''), r.status);
  r = await api(coach, 'POST', '/api/client-invites', { email: 'athlete@test.com' });
  check('owner can invite a member by email',
    r.status === 200 && (r.json.invites || []).includes('athlete@test.com'), r.json);
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
  check('media serves all 25 base entries', Object.keys(media).length === 25, Object.keys(media).length);
  check("DRL-17 serves as AJ's uploaded 90/90 demo (type upload, exact Cloudinary URL, source base)",
    !!media['DRL-17'] && media['DRL-17'].type === 'upload' &&
    media['DRL-17'].url === 'https://res.cloudinary.com/l8qblw99/video/upload/v1792951016/aj-90-90-floating-words-v1.mp4' &&
    media['DRL-17'].source === 'base' && media['DRL-17'].title === '90/90 Hip Switches — Coach AJ',
    media['DRL-17']);
  /* The runner demo matcher is a client function over state; extract
     it the way the suite extracts its other pure cores and feed it
     the live content + media, so the name AJ's athletes run under
     resolves to his uploaded video. */
  const runnerDemoMatch = appJs.text.match(/function demoForRunnerExercise\(name\) \{[\s\S]*?\n\}/);
  check('runner demo matcher is extractable from the served JS', !!runnerDemoMatch);
  if (runnerDemoMatch) {
    const demoFor = new Function('state', runnerDemoMatch[0] + '\nreturn demoForRunnerExercise;')(
      { content: contentJson, media, tests: [] });
    const resolved = demoFor('90/90 Hip Switches');
    check('runner resolves "90/90 Hip Switches" to the DRL-17 upload',
      !!resolved && resolved.type === 'upload' &&
      resolved.url === 'https://res.cloudinary.com/l8qblw99/video/upload/v1792951016/aj-90-90-floating-words-v1.mp4',
      resolved);
  }
  check('ankle dribbles embed URL is correct', media['DRL-16'] && media['DRL-16'].embedUrl === 'https://www.youtube.com/embed/fPzTm57KOKk', media['DRL-16']);
  check('base media is marked source=base', media['back-squat'] && media['back-squat'].source === 'base', media['back-squat']);
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

  /* ---------------- uploaded demo videos (Cloudinary) ----------------
     The coach's own videos, uploaded from the browser with an
     unsigned preset and saved as type 'upload' overrides. The
     server accepts ONLY an https res.cloudinary.com URL under
     AJ's cloud (l8qblw99) for an upload — a different cloud, a
     different host, or plain http is a 400 and saves nothing. */
  r = await api(coach, 'GET', '/api/content');
  check('content payload carries the video upload config',
    !!r.json.videoUpload && r.json.videoUpload.cloudName === 'l8qblw99' &&
    r.json.videoUpload.preset === 'sjc-demos', r.json.videoUpload);
  const CDN_OK = 'https://res.cloudinary.com/l8qblw99/video/upload/v1700000000/sjc-demos/9090-demo.mp4';
  r = await api(coach, 'PUT', '/api/media/upload-move-1', { url: CDN_OK, type: 'upload' });
  check('coach upload save is 200 and typed upload',
    r.status === 200 && r.json.media && r.json.media.type === 'upload' && r.json.media.url === CDN_OK, r.json);
  r = await api(coach, 'GET', '/api/media');
  check('upload override serves as source=coach with the upload type',
    r.json.media['upload-move-1'] && r.json.media['upload-move-1'].type === 'upload' &&
    r.json.media['upload-move-1'].source === 'coach', r.json.media['upload-move-1']);
  r = await api(coach, 'PUT', '/api/media/upload-move-2',
    { url: 'https://res.cloudinary.com/someoneelse/video/upload/v1/sjc-demos/x.mp4', type: 'upload' });
  check('upload from a different cloud is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/media/upload-move-2',
    { url: 'https://videos.example.com/l8qblw99/demo.mp4', type: 'upload' });
  check('upload claim on a non-Cloudinary host is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/media/upload-move-2',
    { url: 'http://res.cloudinary.com/l8qblw99/video/upload/v1/sjc-demos/x.mp4', type: 'upload' });
  check('non-https Cloudinary URL is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/media');
  check('rejected uploads saved nothing',
    !('upload-move-2' in r.json.media) && r.json.media['upload-move-1'].url === CDN_OK,
    Object.keys(r.json.media).length);
  r = await api(athlete, 'PUT', '/api/media/upload-move-1', { url: CDN_OK, type: 'upload' });
  check('athlete upload save is 403', r.status === 403, r.status);
  r = await api(coach, 'GET', '/api/media');
  check('athlete attempt changed nothing', r.json.media['upload-move-1'].url === CDN_OK);
  r = await api(coach, 'DELETE', '/api/media/upload-move-1');
  check('upload override delete is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/media');
  check('clearing the upload restores the movement default (no demo)',
    !('upload-move-1' in r.json.media));
  /* An upload can replace a base YouTube demo and be removed again
     through the same editor paths; the YouTube save is untouched. */
  r = await api(coach, 'PUT', '/api/media/DRL-03', { url: CDN_OK, type: 'upload' });
  check('upload can replace a base demo', r.status === 200 && r.json.media.type === 'upload', r.json);
  r = await api(coach, 'PUT', '/api/media/DRL-03', { url: 'https://www.youtube.com/watch?v=EBmvMaPc1kg' });
  check('YouTube save still works over an upload (regression)',
    r.status === 200 && r.json.media.type === 'youtube', r.json);
  /* Served bundle: the upload call, the native-video playback
     branch, the editor file input, and the runner demo wiring. */
  check('served JS uploads to the Cloudinary endpoint with the preset field',
    appJs.text.includes('https://api.cloudinary.com/v1_1/') && appJs.text.includes('upload_preset') &&
    appJs.text.includes('videoUpload'));
  check('served JS plays uploads with a native video element',
    appJs.text.includes("m.type === 'upload'") && appJs.text.includes('<video class="media-video"') &&
    appJs.text.includes('playsinline') && appJs.text.includes('mediaPlayerHtml'));
  check('served JS has the coach upload file input and client guards',
    appJs.text.includes('id="media-file"') && appJs.text.includes('accept="video/*"') &&
    appJs.text.includes('100 * 1024 * 1024'));
  check('served JS wires the runner demo to the same player',
    appJs.text.includes('runner-demo-btn') && appJs.text.includes('demoForRunnerExercise'));
  const upTvStart = appJs.text.indexOf('TV BOARD');
  const upTvEnd = appJs.text.indexOf('/* ---------------- boot', upTvStart);
  const upTvCode = upTvStart >= 0 && upTvEnd > upTvStart ? appJs.text.slice(upTvStart, upTvEnd) : '';
  check('TV board render path has no upload UI or Cloudinary reference',
    upTvCode.length > 500 && !upTvCode.includes('media-file') &&
    !upTvCode.includes('Upload your video') && !upTvCode.toLowerCase().includes('cloudinary'),
    upTvCode.length);

  /* ---------------- demo coverage ----------------
     The filming map: every drill + test classified from the merged
     media by entry type — upload = yours, youtube/gif = placeholder,
     no entry (incl. a tombstone) = none. Coach-only; computed per
     request, so overrides flip a row's status immediately. */
  r = await api(null, 'GET', '/api/demo-coverage');
  check('demo coverage logged-out is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/demo-coverage');
  check('demo coverage athlete is 403', r.status === 403, r.status);
  r = await api(coach, 'GET', '/api/content');
  const covDrills = r.json.drills;
  r = await api(coach, 'GET', '/api/tests');
  const covTests = r.json.tests;
  r = await api(coach, 'GET', '/api/demo-coverage');
  check('demo coverage is 200 for a coach', r.status === 200, r.status);
  const cov = r.json;
  const covRow = (id) => (cov.rows || []).find(x => x.id === id);
  check('coverage universe is every drill in content order, then every test in battery order',
    !!cov.rows && cov.rows.length === covDrills.length + covTests.length &&
    cov.rows.slice(0, covDrills.length).every((x, i) => x.id === covDrills[i].id && x.kind === 'Drill' && x.name === covDrills[i].name) &&
    cov.rows.slice(covDrills.length).every((x, i) => x.id === covTests[i].key && x.kind === 'Test' && x.name === covTests[i].name),
    [cov.rows && cov.rows.length, covDrills.length, covTests.length]);
  check('coverage summary counts match the rows',
    !!cov.summary && cov.summary.total === cov.rows.length &&
    cov.summary.yours === cov.rows.filter(x => x.status === 'yours').length &&
    cov.summary.placeholder === cov.rows.filter(x => x.status === 'placeholder').length &&
    cov.summary.none === cov.rows.filter(x => x.status === 'none').length, cov.summary);
  check('a base YouTube demo classifies as placeholder',
    !!covRow('DRL-01') && covRow('DRL-01').status === 'placeholder', covRow('DRL-01'));
  check('the base uploaded demo (DRL-17) classifies as yours',
    !!covRow('DRL-17') && covRow('DRL-17').status === 'yours', covRow('DRL-17'));
  check('back squat and bench press base demos attach to their battery keys (placeholder)',
    !!covRow('back-squat') && covRow('back-squat').status === 'placeholder' &&
    !!covRow('bench-press') && covRow('bench-press').status === 'placeholder',
    [covRow('back-squat'), covRow('bench-press')]);
  check('coverage shape: 1 yours, 24 placeholders, and only demo-less tests are none',
    cov.summary.yours === 1 && cov.summary.placeholder === 24 &&
    cov.rows.filter(x => x.status === 'none')
      .every(x => covTests.some(t => t.key === x.id && t.custom)), cov.summary);
  const covCustomTest = covTests.find(t => t.custom);
  check('a test with no demo classifies as none',
    !!covCustomTest && !!covRow(covCustomTest.key) && covRow(covCustomTest.key).status === 'none',
    covCustomTest && covRow(covCustomTest.key));
  /* An upload override flips placeholder -> yours, live. */
  r = await api(coach, 'PUT', '/api/media/DRL-02', { url: CDN_OK, type: 'upload' });
  check('coverage setup: upload override on DRL-02 saves', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/demo-coverage');
  check('an upload override flips placeholder to yours',
    ((r.json.rows || []).find(x => x.id === 'DRL-02') || {}).status === 'yours',
    (r.json.rows || []).find(x => x.id === 'DRL-02'));
  check('the flip moves the summary counts too',
    r.json.summary.yours === cov.summary.yours + 1 &&
    r.json.summary.placeholder === cov.summary.placeholder - 1, r.json.summary);
  r = await api(coach, 'PUT', '/api/media/DRL-02', { url: 'https://www.youtube.com/watch?v=WpypmqTmIeA' });
  check('coverage setup: DRL-02 restored to its YouTube demo', r.status === 200, r.status);
  /* A tombstone flips placeholder -> none. */
  r = await api(coach, 'DELETE', '/api/media/DRL-04');
  check('coverage setup: DRL-04 delete is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/demo-coverage');
  check('a tombstone flips placeholder to none',
    ((r.json.rows || []).find(x => x.id === 'DRL-04') || {}).status === 'none',
    (r.json.rows || []).find(x => x.id === 'DRL-04'));
  r = await api(coach, 'PUT', '/api/media/DRL-04', { url: 'https://www.youtube.com/watch?v=6aw8CAH_65Y' });
  check('coverage setup: DRL-04 restored', r.status === 200, r.status);
  /* A YouTube override on a none test flips none -> placeholder,
     and removing it (no base entry) returns the test to none.
     (Back squat and bench press now carry base demos under their
     battery keys, so this cycle runs on the custom test, which has
     no base entry.) */
  const noneKey = covCustomTest.key;
  r = await api(coach, 'PUT', '/api/media/' + noneKey, { url: 'https://www.youtube.com/watch?v=BUIu720DQH4' });
  check('coverage setup: YouTube override on a demo-less test saves', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/demo-coverage');
  check('a YouTube override flips none to placeholder',
    ((r.json.rows || []).find(x => x.id === noneKey) || {}).status === 'placeholder',
    (r.json.rows || []).find(x => x.id === noneKey));
  r = await api(coach, 'DELETE', '/api/media/' + noneKey);
  check('coverage setup: demo-less test override removed', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/demo-coverage');
  check('removing the override returns the test to none',
    ((r.json.rows || []).find(x => x.id === noneKey) || {}).status === 'none',
    (r.json.rows || []).find(x => x.id === noneKey));
  /* Served wiring: view, nav, endpoint, and the TV slice stays clean. */
  check('served page has the coverage view',
    pageHtml.text.includes('id="view-coverage"') && pageHtml.text.includes('id="coverage-main"'));
  check('coverage is reachable from the Coach hub and the coach sub-nav',
    pageHtml.text.includes('data-view="coverage"') &&
    appJs.text.includes("['coverage', 'Demo Coverage']") &&
    appJs.text.includes("coverage: 'coachhub'"));
  check('served JS fetches the coverage endpoint and reuses demoHtml',
    appJs.text.includes("api('/api/demo-coverage')") && appJs.text.includes('renderCoverage') &&
    appJs.text.includes('coverageBadge'));
  const covTvStart = appJs.text.indexOf('TV BOARD');
  const covTvEnd = appJs.text.indexOf('/* ---------------- boot', covTvStart);
  const covTvCode = covTvStart >= 0 && covTvEnd > covTvStart ? appJs.text.slice(covTvStart, covTvEnd) : '';
  check('TV board render path stays free of demo coverage',
    covTvCode.length > 500 && !covTvCode.toLowerCase().includes('coverage') &&
    !covTvCode.includes('/api/demo-coverage'), covTvCode.length);

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
  const nowD = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const today = nowD.getFullYear() + '-' + pad2(nowD.getMonth() + 1) + '-' + pad2(nowD.getDate());

  // A flagged, still-open concern for Jane (pain 9, stopped training).
  r = await api(coach, 'POST', '/api/concerns', {
    profileId: jane, area: 'knee', side: 'right', feeling: 'sharp', pain: 9,
    started: today, impact: 'stopped', note: 'Summary flag check',
  });
  check('summary setup: flagged concern created', r.status === 201, r.status);
  // Give Jane's group a session today via override so "today" is completable
  // on any weekday (a plan Sunday is an off day, and off days reject marks).
  r = await api(coach, 'POST', '/api/assignments/override', { groupId: gSprint, date: today, sessionId: 'SE-02', note: 'summary test setup' });
  check('summary setup: today has an assigned session', r.status === 200, r.status);
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
  r = await api(coach, 'POST', '/api/client-invites', { email: 'pending@test.com' });
  check('the revoked-coach email can still be invited as a member', r.status === 200, r.status);
  r = await api(null, 'POST', '/api/register', { email: 'pending@test.com', password: 'testpass123' });
  check('registering after the coach invite was revoked is athlete (member invite stands)',
    r.status === 201 && r.json.role === 'athlete', r.json);
  r = await api(coach, 'DELETE', '/api/coach-invites/ghost@test.com');
  check('removing an unknown email is 404', r.status === 404, r.status);

  /* ---------------- member (client) invites ----------------
     The pilot gate: registration is invite-only. The owner invites
     member emails; only they can register (as members). Mirrors the
     coach-invite matrix above, member-side. */
  r = await api(athlete, 'GET', '/api/client-invites');
  check('member is 403 on the member-invite list', r.status === 403, r.status);
  r = await api(assistant, 'POST', '/api/client-invites', { email: 'sneak2@test.com' });
  check('non-owner coach cannot invite members (403)', r.status === 403, r.status);
  r = await api(assistant, 'GET', '/api/client-invites');
  check('non-owner coach can view member invites', r.status === 200 && Array.isArray(r.json.invites), r.json);
  r = await api(coach, 'POST', '/api/client-invites', { email: 'not-an-email' });
  check('member invite with a bad email is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/client-invites', { email: 'coach@test.com' });
  check('member-inviting the owner email is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/client-invites', { email: 'newcoach@test.com' });
  check('member-inviting an existing coach is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/client-invites', { email: '  Member@Test.com ' });
  check('member invite is 200, trimmed + lowercased',
    r.status === 200 && (r.json.invites || []).includes('member@test.com'), r.json);
  r = await api(coach, 'POST', '/api/client-invites', { email: 'MEMBER@test.com' });
  check('duplicate member invite is a no-op', r.status === 200 && r.json.alreadyInvited === true, r.json);
  r = await api(null, 'POST', '/api/register', { email: 'member@test.com', password: 'testpass123' });
  check('invited member registers as athlete role', r.status === 201 && r.json.role === 'athlete', r.json);
  r = await api(coach, 'GET', '/api/client-invites');
  check('registered member shows in the members list',
    (r.json.members || []).some(u => u.email === 'member@test.com'), r.json);
  // Removal wins for future registrations.
  r = await api(coach, 'POST', '/api/client-invites', { email: 'gone@test.com' });
  check('second member invite is added', r.status === 200, r.status);
  r = await api(coach, 'DELETE', '/api/client-invites/' + encodeURIComponent('GONE@test.com'));
  check('member invite removal is 200', r.status === 200 && r.json.removedInvite === true, r.json);
  r = await api(null, 'POST', '/api/register', { email: 'gone@test.com', password: 'testpass123' });
  check('registering after the member invite was removed is 403', r.status === 403, r.status);
  r = await api(coach, 'DELETE', '/api/client-invites/ghost2@test.com');
  check('removing an unknown member invite is 404', r.status === 404, r.status);

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

  /* ---- club record board (top 10) ---- */
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
  r = await api(coach, 'POST', '/api/records', { event: '4x100m', mark: '43.50', name: 'RP Relay 2019', year: 2019, meet: 'Club Championships' });
  check('relay record is 201 with normalized seconds', r.status === 201 && r.json.record.value === 43.5, r.json);
  r = await api(null, 'GET', '/api/records/board');
  const recBoardRelay = r.json.board.find(b => b.event === '4x100m');
  check('relay record shows on the board', !!recBoardRelay && recBoardRelay.entries.length === 1 && recBoardRelay.entries[0].name === 'RP Relay 2019', recBoardRelay);

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
  check('today-run button style is served at the restored pre-design treatment (56px)',
    stylesCss.status === 200 && /\.btn\.run-today-btn\s*\{[^}]*min-height:\s*56px/.test(stylesCss.text));

  /* ---------------- Design rollback (Oct 25) ----------------
     AJ reviewed the DESIGN.md design pass live and directed a
     rollback to the previous look. These checks pin the RESTORED
     pre-design presentation and the absence of the design-pass
     markers (fonts, 64px Run slab, lane rules, split heads,
     scoreboard hero, flagged-row accents, cascade motion). */
  check('rollback: system font stacks restored; no Archivo/JetBrains anywhere in the shell',
    stylesCss.text.includes('font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto') &&
    !/Archivo|JetBrains/.test(stylesCss.text + pageHtml.text + appJs.text) &&
    !stylesCss.text.includes('--font-display') && !stylesCss.text.includes('--font-mono') &&
    stylesCss.text.includes('--red: #c9ccd4'));
  check('rollback: no external font fetch anywhere',
    !/fonts\.googleapis|fonts\.gstatic/.test(pageHtml.text + stylesCss.text + appJs.text));
  check('rollback: run button label is plain text with the session code (no mono run-code span)',
    appJs.text.includes("`▶ Run today's workout · ${esc(target.sessionId)}`") &&
    appJs.text.includes("`▶ Run — ${esc(target.groupName)} · ${esc(target.sessionId)}`") &&
    !appJs.text.includes('run-code') && !stylesCss.text.includes('.run-code'));
  check('rollback: run button has no slab gradient or spring-press treatment',
    !/\.btn\.run-today-btn\s*\{[^}]*linear-gradient/.test(stylesCss.text) &&
    !stylesCss.text.includes('.run-today-btn:active { transform: translateY(1px) scale(.99)'));
  check('rollback: lane rule is the animated dashed stripe again',
    /\.lane-divider\s*\{[^}]*height:\s*4px/.test(stylesCss.text) &&
    /\.lane-divider \.lane-strip\s*\{[^}]*repeating-linear-gradient\(90deg, var\(--red\) 0 34px, transparent 34px 56px\)/.test(stylesCss.text));
  check('rollback: Today + session detail headers are the plain headings again (no split heads)',
    appJs.text.includes('<h2>Today — ${DAY_NAMES[todayKey]}, ${fmtDate(info.date)}</h2>') &&
    appJs.text.includes('<h2><span class="code-link">${esc(s.id)}</span> · ${esc(s.name)}</h2>') &&
    !appJs.text.includes('split-head') && !stylesCss.text.includes('.split-head'));
  check('rollback: mark/result cells render in the body font (no mono num cells)',
    appJs.text.includes('<td><strong>${esc(r.mark)}</strong></td>') &&
    appJs.text.includes('<td><strong>${esc(b.mark)}</strong></td>') &&
    appJs.text.includes('<td>${resultRawText(r, t)}</td>') &&
    appJs.text.includes('<td><strong>${esc(m.mark)}</strong></td>') &&
    !appJs.text.includes('class="num"'));
  check('rollback: club record board has no scoreboard hero; the empty state is the plain note',
    !appJs.text.includes('record-hero') && !appJs.text.includes('big-num') &&
    !stylesCss.text.includes('.big-num') && !stylesCss.text.includes('.record-hero') &&
    appJs.text.includes('<p class="muted">No records yet') &&
    !appJs.text.includes('lane-empty') && !stylesCss.text.includes('.lane-empty'));
  check('rollback: TV group name is the plain header again (no jersey banner)',
    /\.tv-page-group\s*\{[^}]*font-weight:\s*800/.test(stylesCss.text) &&
    !stylesCss.text.includes('.tv-page-group::after') &&
    !/\.tv-page-group\s*\{[^}]*text-transform/.test(stylesCss.text));
  check('rollback: flagged rows use the pre-design styling (wellness 4px scarlet edge; summary rows unflagged)',
    /\.wellness-row\.flagged\s*\{[^}]*border-left:\s*4px solid var\(--scarlet\)/.test(stylesCss.text) &&
    /\.concern-card\.flagged\s*\{[^}]*border:\s*2px solid var\(--red\)/.test(stylesCss.text) &&
    !stylesCss.text.includes('.roster-row.flagged') &&
    !appJs.text.includes('class="roster-row flagged"'));
  check('rollback: check-in selected state is scarlet/white without the added full-weight shout',
    /\.tap-btn\.on\s*\{[^}]*background:\s*var\(--scarlet\)/.test(stylesCss.text) &&
    !/\.tap-btn\.on\s*\{[^}]*font-weight:\s*800/.test(stylesCss.text));
  check('rollback: no card cascade motion was left behind',
    !stylesCss.text.includes('cascadeIn'));
  check('TV board render path stays free of the Today Run buttons',
    !tvCode.includes('data-run-today') && !tvCode.includes('todayRunTargets') &&
    !tvCode.includes('run-today-btn') && !tvCode.includes('featuredRunSessionId'));
  check('TV board render path stays free of announcements',
    !tvCode.toLowerCase().includes('announce'));

  /* ---------------- Update delivery (kept through the rollback) -----
     The v28 update mechanics were functional, not part of the design
     pass: version pinning, the one-time reload on controllerchange,
     the update toast, and the version stamp all stay. The Floodlight
     hero / poster / theme from that commit are rolled back below. */
  check('app version constant is pinned to the SW version',
    appJs.text.includes("const APP_VERSION = 'v3'") &&
    swJs.text.includes("ruffin-performance-v3"));
  check('update loop reloads once on controllerchange and toasts after reload',
    appJs.text.includes('hadServiceWorkerController') &&
    appJs.text.includes('controllerchange') &&
    appJs.text.includes('swa-app-updated') &&
    appJs.text.includes('Updated to the latest version'));
  check('version stamp ships in the shell and the account view',
    pageHtml.text.includes('data-app-version="v3"') &&
    pageHtml.text.includes('Ruffin Performance · App v3') &&
    appJs.text.includes('appVersionHtml'));
  /* ---------------- Ruffin Performance: landing + brand + theme ----
     The logged-out home is the landing page for AJ's own membership.
     The brand lives in ONE config block server-side (BRAND) and is
     substituted into the shell at serve time — these checks read the
     SERVED files, so a rename that misses a surface fails here. */
  const manifestTxt = await apiText(null, '/manifest.json');
  check('landing page is the logged-out home (hero + sign in + pilot note)',
    pageHtml.text.includes('id="view-landing"') &&
    pageHtml.text.includes('Ruffin Performance') &&
    pageHtml.text.includes('Member sign in') &&
    pageHtml.text.includes('Founding pilot — membership is invite-only while we launch.'),
    pageHtml.text.slice(0, 120));
  check('landing shows the membership tiers as information (no checkout)',
    pageHtml.text.includes('$99') && pageHtml.text.includes('$149') && pageHtml.text.includes('$49') &&
    pageHtml.text.includes('Membership + Coaching') &&
    !pageHtml.text.includes('checkout') && !pageHtml.text.includes('stripe'),
    pageHtml.text.slice(0, 120));
  check('landing names the coach without school or CSCS claims',
    pageHtml.text.includes('Alonzo') && pageHtml.text.includes('Ruffin') &&
    pageHtml.text.includes('Maryland/DC-area sprint coach') &&
    !pageHtml.text.includes('CSCS'),
    pageHtml.text.slice(0, 120));
  check('the AYG connection is exactly one line, exactly one link',
    pageHtml.text.split('accelerateyourgame.com').length - 1 === 1 &&
    pageHtml.text.split('Accelerate Your Game').length - 1 === 1 &&
    pageHtml.text.includes('Connected with'),
    (pageHtml.text.match(/accelerateyourgame\.com/g) || []).length);
  check('brand tokens are fully substituted in every served shell file',
    !/__BRAND_|__APP_VERSION__/.test(pageHtml.text) &&
    !/__BRAND_|__APP_VERSION__/.test(appJs.text) &&
    !/__BRAND_|__APP_VERSION__/.test(swJs.text) &&
    !/__BRAND_|__APP_VERSION__/.test(manifestTxt.text));
  check('manifest carries the RP brand + dark theme colors',
    manifestTxt.text.includes('Ruffin Performance') && manifestTxt.text.includes('#0d0d0f'),
    manifestTxt.text.slice(0, 120));
  check('content payload carries the brand from the one config block',
    !!contentJson.brand && contentJson.brand.name === 'Ruffin Performance' &&
    contentJson.brand.tagline === 'Speed & strength coaching',
    contentJson.brand);
  check('dark theme palette is the shipped one (black/grey + silver)',
    stylesCss.text.includes('--bg: #0d0d0f') && stylesCss.text.includes('--card: #17181c') &&
    stylesCss.text.includes('--red: #c9ccd4') && !stylesCss.text.includes('#CC0033'),
    stylesCss.text.slice(0, 200));
  check('member-facing labels say Member (account + invites + records)',
    appJs.text.includes('Member account:') && appJs.text.includes('Member invites') &&
    appJs.text.includes('renderClientInvites') && pageHtml.text.includes('Club Records'));

  /* Sanitization: NO school identity anywhere in the shipped app —
     not in content, not in the public shell, not in the server. The
     single documented exception is the upload preset default in
     server.js ('sjc-demos', the coach's existing Cloudinary preset
     name — a config value, verified and stripped before scanning).
     The scrub substitutions in scripts/build-content.py and this
     list itself necessarily name what they remove; neither ships
     in the app surface scanned here. */
  const FORBIDDEN_STRINGS = ['St. John', "St John's", 'Cadets', 'WCAC', 'SJC'];
  const FORBIDDEN_NAMES = ['Eric Harrison', 'Jade Smith', 'Alicia Dawson', 'Camille Nesmith',
    'Nile Brown', 'Maxwell Thomas', 'Luke Freishtat', 'Reina Saunders', 'Gaston'];
  const scanFiles = ['server.js', 'package.json'];
  for (const dir of ['content', 'public']) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    for (const f of walk(path.join(APP_DIR, dir))) scanFiles.push(path.relative(APP_DIR, f));
  }
  const dirty = [];
  for (const rel of scanFiles) {
    let text = fs.readFileSync(path.join(APP_DIR, rel), 'utf8');
    if (rel === 'server.js') {
      check('the only sjc string in server.js is the upload preset default',
        (text.match(/sjc-demos/g) || []).length === 1 &&
        !(text.replace(/sjc-demos/g, '').match(/sjc/i) || []).length, rel);
      text = text.replace(/sjc-demos/g, '');
    }
    for (const bad of [...FORBIDDEN_STRINGS, ...FORBIDDEN_NAMES]) {
      if (text.includes(bad)) dirty.push(rel + ' contains ' + JSON.stringify(bad));
    }
    if (/sjc/i.test(text)) dirty.push(rel + ' contains an sjc string');
  }
  check('sanitization: no school strings or athlete names in shipped files', dirty.length === 0, dirty);
  const servedDirty = [...FORBIDDEN_STRINGS, ...FORBIDDEN_NAMES]
    .filter(bad => pageHtml.text.includes(bad) || appJs.text.includes(bad) || stylesCss.text.includes(bad));
  check('sanitization: served bundle is clean too', servedDirty.length === 0, servedDirty);

  check('rollback: Today hero is the decorative pre-design hero (no scoreboard panel)',
    pageHtml.text.includes('<div class="hero" aria-hidden="true">') &&
    !pageHtml.text.includes('today-scoreboard') && !pageHtml.text.includes('today-hero') &&
    !appJs.text.includes('updateTodayHero') && !appJs.text.includes('nextPlanSession') &&
    !stylesCss.text.includes('.today-hero'));
  check('rollback: sign-in has no Floodlight poster; the login form is a plain card',
    !appJs.text.includes('signinPosterHtml') && !appJs.text.includes('signin-poster') &&
    !stylesCss.text.includes('.signin-poster') &&
    appJs.text.includes('<form id="login-form" class="card">'));
  check('rollback: Floodlight theme layer is gone (no jersey banners, card lane bars, tab slab)',
    !stylesCss.text.includes('Floodlight') && !stylesCss.text.includes('.view > h1') &&
    !/\.tabbar \.tab\.active\s*\{[^}]*linear-gradient\(180deg, var\(--red\)/.test(stylesCss.text) &&
    !/\.menu-item\s*\{[^}]*var\(--hud-bg\)/.test(stylesCss.text));
  check('runner animation + Phase 1 in-place guards untouched by the rollback',
    stylesCss.text.includes('@keyframes athleteMove') &&
    stylesCss.text.includes('athleteMove 12s') &&
    appJs.text.includes('function flashSaved('));

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
  const reportToday = fmtDw(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })));
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
  await api(coach, 'POST', '/api/client-invites', { email: 'will@test.com' });
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
  await api(coach, 'POST', '/api/client-invites', { email: 'wendy@test.com' });
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

  /* ---------------- server hardening pass (Oct 24, late) ----------------
     Regression guards for the server audit: host-UTC "today", role
     changes by non-owners, the pain-concern lifecycle, duplicate
     creates, and exports that spreadsheets would execute. */
  const nyToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  r = await api(coach, 'GET', '/api/coach/today');
  check('server today is the America/New_York date, not the host date',
    r.status === 200 && r.json.date === nyToday, r.json.date + ' vs ' + nyToday);
  r = await api(coach, 'GET', '/api/coach/today?board=1');
  check('the TV board payload carries no health data',
    r.status === 200 && Array.isArray(r.json.healthFlags) && r.json.healthFlags.length === 0
    && r.json.wellness === null && Array.isArray(r.json.groups), r.json);
  await api(coach, 'POST', '/api/client-invites', { email: 'qa-assistant@test.com' });
  r = await api(null, 'POST', '/api/register', { email: 'qa-assistant@test.com', password: 'testpass123' });
  const asst = cookieOf(r);
  r = await api(coach, 'GET', '/api/coaches');
  const asstUser = r.json.users.find(u => u.email === 'qa-assistant@test.com');
  const willUser = r.json.users.find(u => u.email === 'will@test.com');
  r = await api(coach, 'PUT', '/api/users/' + asstUser.id + '/role', { role: 'coach' });
  check('the head coach can promote an assistant', r.status === 200 && r.json.user.role === 'coach', r.json);
  r = await api(asst, 'PUT', '/api/users/' + willUser.id + '/role', { role: 'coach' });
  check('an assistant coach cannot change account roles', r.status === 403, r.status);
  r = await api(coach, 'PUT', '/api/users/' + asstUser.id + '/role', { role: 'athlete' });
  check('the head coach can demote the assistant back', r.status === 200 && r.json.user.role === 'athlete', r.json);
  r = await api(coach, 'POST', '/api/profiles', { firstName: '=2+5', lastName: 'Hacker' });
  check('a formula-named profile can be created', r.status === 201, r.status);
  const hackerP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: '=2+5', lastName: 'Hacker' });
  check('a duplicate roster profile is refused with 409', r.status === 409, r.status);
  const rosterCsv = await apiText(coach, '/api/export/roster.csv');
  check('roster CSV neutralizes spreadsheet formulas in names',
    rosterCsv.status === 200 && rosterCsv.text.includes("'=2+5"), rosterCsv.text.slice(0, 200));
  r = await api(coach, 'PUT', '/api/profiles/' + hackerP.id, { archived: true });
  check('the formula-named profile archives cleanly', r.status === 200 && r.json.profile.archived === true, r.json);
  r = await api(will, 'POST', '/api/logs', { date: '2026-02-30', happened: 'x' });
  check('the personal log rejects impossible calendar dates', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/completions', { profileId: jane, date: '2026-11-01' });
  check('a completion cannot be marked on a plan off day', r.status === 400, r.status);
  r = await api(will, 'POST', '/api/checkin', { sleep: 7, soreness: 2, energy: 4, hurts: true, painText: '' });
  check('hurts with no words still saves the check-in', r.status === 200 || r.status === 201, r.status);
  r = await api(coach, 'GET', '/api/concerns');
  let willConcerns = r.json.concerns.filter(c => c.profileId === willP.id && c.source === 'athlete');
  check('hurts with no words still files a concern', willConcerns.length === 1, willConcerns);
  const qaConcernId = willConcerns[0].id;
  r = await api(coach, 'PUT', '/api/concerns/' + qaConcernId, { status: 'monitoring' });
  check('coach can move the concern to monitoring', r.status === 200 && r.json.concern.status === 'monitoring', r.json);
  r = await api(will, 'POST', '/api/checkin', { sleep: 7, soreness: 2, energy: 4, hurts: false });
  r = await api(coach, 'GET', '/api/concerns');
  willConcerns = r.json.concerns.filter(c => c.profileId === willP.id && c.source === 'athlete');
  check('un-flagging keeps a monitored concern (link not severed)',
    willConcerns.length === 1 && willConcerns[0].status === 'monitoring', willConcerns);
  r = await api(will, 'POST', '/api/checkin', { sleep: 7, soreness: 2, energy: 4, hurts: true, painText: 'Still tight' });
  r = await api(coach, 'GET', '/api/concerns');
  willConcerns = r.json.concerns.filter(c => c.profileId === willP.id && c.source === 'athlete');
  check('re-flagging updates the same concern instead of filing a duplicate',
    willConcerns.length === 1 && willConcerns[0].note === 'Still tight', willConcerns);
  r = await api(coach, 'PUT', '/api/concerns/' + qaConcernId, { status: 'new' });
  r = await api(will, 'POST', '/api/checkin', { sleep: 7, soreness: 2, energy: 4, hurts: false });
  r = await api(coach, 'GET', '/api/concerns');
  check('lifecycle cleanup: un-flagging a still-new concern removes it',
    r.json.concerns.filter(c => c.profileId === willP.id && c.source === 'athlete').length === 0,
    r.json.concerns.length);
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Qa', lastName: 'Racer' });
  const qaP = r.json.profile;
  r = await api(coach, 'POST', '/api/meets', { name: 'QA Rename Meet', date: '2026-12-05' });
  const qaMeet = r.json.meet;
  check('meet created for the rename test', r.status === 201 && !!qaMeet, r.json);
  r = await api(coach, 'POST', '/api/meets', { name: 'QA Rename Meet', date: '2026-12-05' });
  check('a duplicate meet (same name and date) is refused with 409', r.status === 409, r.status);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: qaP.id, date: '2026-12-05', meet: 'QA Rename Meet', event: '100m', mark: '11.20' });
  check('meet result saved under the original name', r.status === 201, r.status);
  const qaResultId = r.json.result.id;
  r = await api(coach, 'POST', '/api/meet-results', { profileId: qaP.id, date: '2026-12-05', meet: 'QA Rename Meet', event: '100m', mark: '11.20' });
  r = await api(coach, 'GET', '/api/meet-results?profileId=' + qaP.id);
  check('re-posting the same meet result updates it instead of duplicating',
    r.json.results.length === 1, r.json.results && r.json.results.length);
  r = await api(coach, 'PUT', '/api/meets/' + qaMeet.id, { name: 'QA Renamed Meet' });
  check('meet rename saves', r.status === 200 && r.json.meet.name === 'QA Renamed Meet', r.json);
  r = await api(coach, 'GET', '/api/meets/' + qaMeet.id);
  check('renaming a meet carries its results into the hub',
    r.status === 200 && r.json.results.length === 1 && r.json.results[0].mark === '11.20', r.json);
  r = await api(coach, 'DELETE', '/api/meet-results/' + qaResultId);
  r = await api(coach, 'DELETE', '/api/meets/' + qaMeet.id);
  r = await api(coach, 'PUT', '/api/profiles/' + qaP.id, { archived: true });

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

  /* ---------------- attendance (coach roll-book) ----------------
     Coach-only daily marks — present / late / excused / absent —
     in their own store: never a completion alias, never visible
     to athletes, never on the TV board. Fixtures are a dedicated
     squad; day counts on a guaranteed-untouched future date are
     exact for the marked statuses. */
  check('attendance view is in the served page',
    pageHtml.text.includes('id="view-attendance"') && pageHtml.text.includes('id="attendance-main"') &&
    pageHtml.text.includes('data-view="attendance"'));
  check('attendance wiring is in the served JS',
    appJs.text.includes("['attendance', 'Attendance']") && appJs.text.includes("attendance: 'coachhub'") &&
    appJs.text.includes("if (name === 'attendance') renderAttendance();") &&
    appJs.text.includes('/api/attendance'));
  const attTvStart = appJs.text.indexOf('TV BOARD');
  const attTvEnd = appJs.text.indexOf('/* ---------------- boot', attTvStart);
  const attTvCode = attTvStart >= 0 && attTvEnd > attTvStart ? appJs.text.slice(attTvStart, attTvEnd) : '';
  check('TV board render path never references attendance',
    attTvCode.length > 500 && !attTvCode.toLowerCase().includes('attendance'), attTvCode.length);
  const attSeg = seg('const wireAttRow', 'const attRowHtml');
  check('attendance: status taps save in place (no full renderAttendance in the row handler)',
    attSeg.includes("apiPut('/api/attendance/'") && attSeg.includes('flashSaved(row)') &&
    attSeg.includes('showRowError(row') && !attSeg.includes('renderAttendance('), attSeg.slice(0, 120));

  r = await api(coach, 'POST', '/api/groups', { name: 'Attendance Squad' });
  const gAtt = r.json.group.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Att', lastName: 'Anna', groupId: gAtt, events: ['sprinter'] });
  const annaA = r.json.profile.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Att', lastName: 'Boris', groupId: gAtt, events: ['sprinter'] });
  const borisA = r.json.profile.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Att', lastName: 'Cleo' });
  const cleoA = r.json.profile.id;

  /* Auth gates: attendance is coach-only data. */
  r = await api(null, 'GET', '/api/attendance?date=2026-10-26');
  check('attendance day without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/attendance?date=2026-10-26');
  check('attendance day for an athlete is 403', r.status === 403, r.status);
  r = await api(null, 'PUT', '/api/attendance/2026-10-26/' + annaA, { status: 'present' });
  check('attendance mark without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'PUT', '/api/attendance/2026-10-26/' + annaA, { status: 'present' });
  check('attendance mark for an athlete is 403', r.status === 403, r.status);
  r = await api(athlete, 'POST', '/api/attendance/2026-10-26/mark-all-present', {});
  check('mark-all-present for an athlete is 403', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/attendance/summary');
  check('attendance summary without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/attendance/summary');
  check('attendance summary for an athlete is 403', r.status === 403, r.status);

  /* A fresh (future) day: everyone unmarked, roster composed by group. */
  const ATT_DAY = '2050-01-03';
  const attMember = (resp, pid) => {
    for (const blk of resp.groups.concat([resp.unassigned])) {
      const m = (blk.members || []).find(x => x.profile.id === pid);
      if (m) return m;
    }
    return null;
  };
  r = await api(coach, 'GET', '/api/attendance?date=' + ATT_DAY);
  check('attendance: a fresh future day loads (pre-planning is allowed)',
    r.status === 200 && r.json.date === ATT_DAY, r.status);
  check('attendance: fresh day counts are all unmarked',
    r.json.counts.present === 0 && r.json.counts.late === 0 && r.json.counts.excused === 0 &&
    r.json.counts.absent === 0 && r.json.counts.unmarked > 0, r.json.counts);
  const attSquad = r.json.groups.find(g => g.group && g.group.id === gAtt);
  check('attendance: grouped athletes sit under their group, ungrouped under no-group',
    !!attSquad && attSquad.members.length === 2 &&
    attMember(r.json, annaA).attendance === null && attMember(r.json, borisA).attendance === null &&
    !!attMember(r.json, cleoA) && r.json.unassigned.members.some(m => m.profile.id === cleoA), r.json.groups.length);

  /* Mark / change / clear round-trip. */
  r = await api(coach, 'PUT', '/api/attendance/' + ATT_DAY + '/' + annaA, { status: 'present' });
  check('attendance: marking present saves with who/when',
    r.status === 200 && r.json.attendance.status === 'present' &&
    typeof r.json.attendance.updatedBy === 'string' && !!r.json.attendance.updatedAt, r.json);
  r = await api(coach, 'GET', '/api/attendance?date=' + ATT_DAY);
  check('attendance: the saved mark reads back, counts move',
    attMember(r.json, annaA).attendance.status === 'present' && r.json.counts.present === 1 &&
    r.json.counts.late === 0, r.json.counts);
  r = await api(coach, 'PUT', '/api/attendance/' + ATT_DAY + '/' + annaA, { status: 'late' });
  check('attendance: a mark can be changed', r.status === 200 && r.json.attendance.status === 'late', r.json);
  r = await api(coach, 'GET', '/api/attendance?date=' + ATT_DAY);
  check('attendance: the change reads back in counts',
    r.json.counts.present === 0 && r.json.counts.late === 1, r.json.counts);
  r = await api(coach, 'PUT', '/api/attendance/' + ATT_DAY + '/' + annaA, { status: null });
  check('attendance: null status clears the mark', r.status === 200 && r.json.cleared === true, r.json);
  r = await api(coach, 'GET', '/api/attendance?date=' + ATT_DAY);
  check('attendance: the cleared athlete is unmarked again',
    attMember(r.json, annaA).attendance === null && r.json.counts.late === 0, r.json.counts);

  /* Validation. */
  r = await api(coach, 'PUT', '/api/attendance/' + ATT_DAY + '/' + annaA, { status: 'sleepy' });
  check('attendance: an unknown status is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/attendance/' + ATT_DAY + '/no-such-profile', { status: 'present' });
  check('attendance: an unknown athlete is 404', r.status === 404, r.status);
  r = await api(coach, 'PUT', '/api/attendance/2050-13-40/' + annaA, { status: 'present' });
  check('attendance: an impossible date is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/attendance?date=not-a-date');
  check('attendance: a malformed day fetch is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/attendance?date=2050-02-30');
  check('attendance: Feb 30 is 400, not rolled over', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/attendance/2050-13-40/mark-all-present', {});
  check('attendance: mark-all on an impossible date is 400', r.status === 400, r.status);

  /* Mark all present fills only the unmarked; existing marks stand. */
  r = await api(coach, 'PUT', '/api/attendance/' + ATT_DAY + '/' + borisA, { status: 'excused' });
  check('attendance fixtures: Boris is excused first', r.status === 200, r.status);
  r = await api(coach, 'POST', '/api/attendance/' + ATT_DAY + '/mark-all-present', {});
  check('attendance: mark-all-present skips already-marked athletes',
    r.status === 200 && r.json.skipped === 1 && r.json.marked >= 2, r.json);
  r = await api(coach, 'GET', '/api/attendance?date=' + ATT_DAY);
  check('attendance: mark-all filled Anna + Cleo, Boris stays excused',
    attMember(r.json, annaA).attendance.status === 'present' &&
    attMember(r.json, cleoA).attendance.status === 'present' &&
    attMember(r.json, borisA).attendance.status === 'excused' &&
    r.json.counts.excused === 1, r.json.counts);

  /* Summary math: an exact custom window (late counts as attended). */
  for (const [d, s] of [['2026-03-02', 'present'], ['2026-03-03', 'late'], ['2026-03-04', 'excused'], ['2026-03-05', 'absent']]) {
    r = await api(coach, 'PUT', '/api/attendance/' + d + '/' + cleoA, { status: s });
  }
  check('attendance fixtures: Cleo has one of each status in March 2026', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/attendance/summary?from=2026-03-01&to=2026-03-31');
  const cleoSum = (r.json.athletes || []).find(a => a.profile.id === cleoA);
  check('attendance summary: custom window counts are exact',
    r.status === 200 && !!cleoSum && cleoSum.custom.marked === 4 && cleoSum.custom.present === 1 &&
    cleoSum.custom.late === 1 && cleoSum.custom.excused === 1 && cleoSum.custom.absent === 1, cleoSum);
  check('attendance summary: late counts as attended (2 of 4 = 50%)',
    !!cleoSum && cleoSum.custom.attended === 2 && cleoSum.custom.percent === 50, cleoSum && cleoSum.custom);
  check('attendance summary: default windows are last30 + season ending today',
    !!r.json.windows && !!r.json.windows.last30 && !!r.json.windows.season &&
    r.json.windows.last30.to === r.json.today && r.json.windows.season.to === r.json.today, r.json.windows);
  r = await api(coach, 'GET', '/api/attendance/summary?from=2026-03-31&to=2026-03-01');
  check('attendance summary: a backwards custom window is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/attendance/summary?from=banana&to=2026-03-01');
  check('attendance summary: a malformed custom window is 400', r.status === 400, r.status);

  /* Last-30-days window edges: today counts, 30 days ago does not. */
  const attPad2 = (n) => String(n).padStart(2, '0');
  const dstrOf = (d) => d.getFullYear() + '-' + attPad2(d.getMonth() + 1) + '-' + attPad2(d.getDate());
  const attNow = new Date();
  const todayS2 = dstrOf(attNow);
  const oldS = dstrOf(new Date(attNow.getFullYear(), attNow.getMonth(), attNow.getDate() - 30));
  await api(coach, 'PUT', '/api/attendance/' + todayS2 + '/' + annaA, { status: 'present' });
  await api(coach, 'PUT', '/api/attendance/' + oldS + '/' + annaA, { status: 'absent' });
  r = await api(coach, 'GET', '/api/attendance/summary');
  const annaSum = (r.json.athletes || []).find(a => a.profile.id === annaA);
  check('attendance summary: last30 includes today and excludes 30 days ago',
    !!annaSum && annaSum.last30.marked === 1 && annaSum.last30.present === 1 &&
    annaSum.last30.absent === 0 && annaSum.last30.percent === 100, annaSum && annaSum.last30);
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Att', lastName: 'Dana' });
  const danaA = r.json.profile.id;
  r = await api(coach, 'GET', '/api/attendance/summary');
  const danaSum = (r.json.athletes || []).find(a => a.profile.id === danaA);
  check('attendance summary: an athlete with no marks gets zeros and a null percent',
    !!danaSum && danaSum.last30.marked === 0 && danaSum.last30.percent === null &&
    danaSum.season.marked === 0 && danaSum.season.percent === null, danaSum);

  /* ---------------- AMS (athlete management system) ----------------
     Coach-side only: a roster table with coach-set status and
     computed attention flags, one aggregate page per athlete, and a
     private coach-notes thread that must never reach an athlete
     payload, the TV board, or an export. Fixtures are a dedicated
     squad; flag windows run off the server's own today (reportToday)
     so the boundaries are exact:
       Amy — 2 flagged check-ins 4-5 days ago (Readiness fires),
             none in the last 3 days (No check-in fires), 2 absences
             in 14 days (Attendance fires), 1 open concern (Health
             fires): all four flags.
       Ben — exactly 1 flagged check-in yesterday (Readiness does
             NOT fire), 1 absence (Attendance does NOT fire), one
             cleared concern (Health does NOT fire): zero flags.
       Cid — unlinked with no check-ins at all: NO No check-in flag
             (unlinked athletes get the neutral Not linked state). */
  check('ams view is in the served page',
    pageHtml.text.includes('id="view-ams"') && pageHtml.text.includes('id="ams-main"') &&
    pageHtml.text.includes('data-view="ams"'));
  check('ams wiring is in the served JS',
    appJs.text.includes("['ams', 'AMS']") && appJs.text.includes("ams: 'coachhub'") &&
    appJs.text.includes("if (name === 'ams') renderAms();") &&
    appJs.text.includes('/api/ams/roster') && appJs.text.includes('/api/ams/athlete/'));
  {
    const amsTvStart = appJs.text.indexOf('TV BOARD');
    const amsTvEnd = appJs.text.indexOf('/* ---------------- boot', amsTvStart);
    const amsTvCode = amsTvStart >= 0 && amsTvEnd > amsTvStart ? appJs.text.slice(amsTvStart, amsTvEnd) : '';
    check('TV board render path never references AMS or coach notes',
      amsTvCode.length > 500 && !amsTvCode.toLowerCase().includes('ams') &&
      !amsTvCode.includes('coachNotes') && !amsTvCode.includes('/api/ams'), amsTvCode.length);
  }

  r = await api(coach, 'POST', '/api/groups', { name: 'AMS Squad' });
  const gAms = r.json.group.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Amy', lastName: 'Ams', groupId: gAms, events: ['sprinter'] });
  const amyP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Ben', lastName: 'Ams', groupId: gAms, events: ['jumper'] });
  const benP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Cid', lastName: 'Ams', events: [] });
  const cidP = r.json.profile;
  check('profiles are born with status active',
    amyP.status === 'active' && benP.status === 'active' && cidP.status === 'active', amyP);

  /* Status: validated on create and on edit, persisted, and a bad
     edit changes nothing. */
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Dee', lastName: 'Ams', status: 'injured' });
  check('profile create accepts a valid status', r.status === 201 && r.json.profile.status === 'injured', r.json);
  const deeP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Eli', lastName: 'Ams', status: 'benched' });
  check('profile create with an unknown status is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/profiles/' + amyP.id, { status: 'benched' });
  check('profile edit with an unknown status is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/profiles');
  check('the bad status edit changed nothing',
    (r.json.profiles || []).find(x => x.id === amyP.id).status === 'active', r.json.profiles.length);
  r = await api(coach, 'PUT', '/api/profiles/' + amyP.id, { status: 'injured' });
  check('profile status edit saves', r.status === 200 && r.json.profile.status === 'injured', r.json);
  r = await api(coach, 'PUT', '/api/profiles/' + amyP.id, { status: 'active' });
  check('profile status edit back to active saves', r.status === 200 && r.json.profile.status === 'active', r.json);

  /* Link Amy + Ben so they can check in. */
  await api(coach, 'POST', '/api/client-invites', { email: 'amy@test.com' });
  await api(coach, 'POST', '/api/client-invites', { email: 'ben@test.com' });
  r = await api(null, 'POST', '/api/register', { email: 'amy@test.com', password: 'testpass123' });
  const amyAcct = cookieOf(r);
  r = await api(null, 'POST', '/api/register', { email: 'ben@test.com', password: 'testpass123' });
  const benAcct = cookieOf(r);
  await api(coach, 'PUT', '/api/profiles/' + amyP.id + '/link', { email: 'amy@test.com' });
  await api(coach, 'PUT', '/api/profiles/' + benP.id + '/link', { email: 'ben@test.com' });

  /* Amy: two flagged check-ins, 4 and 5 days ago. */
  r = await api(amyAcct, 'POST', '/api/checkin', { sleep: 5, soreness: 3, energy: 3, date: addDays(reportToday, -4) });
  check('ams fixtures: Amy flagged check-in 4 days ago', r.status === 201, r.status);
  r = await api(amyAcct, 'POST', '/api/checkin', { sleep: 8, soreness: 5, energy: 3, date: addDays(reportToday, -5) });
  check('ams fixtures: Amy flagged check-in 5 days ago', r.status === 201, r.status);
  /* Ben: exactly one flagged check-in, yesterday. */
  r = await api(benAcct, 'POST', '/api/checkin', { sleep: 5.5, soreness: 3, energy: 3, date: yDay });
  check('ams fixtures: Ben flagged check-in yesterday', r.status === 201, r.status);

  /* Attendance: Amy absent twice inside 14 days; Ben once. */
  await api(coach, 'PUT', '/api/attendance/' + addDays(reportToday, -1) + '/' + amyP.id, { status: 'absent' });
  await api(coach, 'PUT', '/api/attendance/' + addDays(reportToday, -3) + '/' + amyP.id, { status: 'absent' });
  await api(coach, 'PUT', '/api/attendance/' + addDays(reportToday, -2) + '/' + amyP.id, { status: 'present' });
  await api(coach, 'PUT', '/api/attendance/' + addDays(reportToday, -5) + '/' + benP.id, { status: 'absent' });

  /* Health: Amy one open concern; Ben one concern, then cleared. */
  r = await api(coach, 'POST', '/api/concerns', { profileId: amyP.id, area: 'hamstring', side: 'left', feeling: 'tightness', impact: 'modified', started: addDays(reportToday, -2), pain: 5 });
  check('ams fixtures: Amy open concern filed', r.status === 201 && r.json.concern.status === 'new', r.status);
  r = await api(coach, 'POST', '/api/concerns', { profileId: benP.id, area: 'ankle', side: 'right', feeling: 'ache', impact: 'none', started: addDays(reportToday, -9), pain: 3 });
  const benConcern = r.json.concern.id;
  r = await api(coach, 'PUT', '/api/concerns/' + benConcern, { status: 'cleared' });
  check('ams fixtures: Ben concern cleared', r.status === 200 && r.json.concern.status === 'cleared', r.json);

  /* Ben's aggregate fixtures: a test result, a meet PR, a goal. */
  r = await api(coach, 'POST', '/api/test-days', { date: '2026-11-09', title: 'AMS Testing', testKeys: ['bench-press'] });
  const amsDay = r.json.testDay.id;
  r = await api(coach, 'POST', '/api/results', { profileId: benP.id, testDayId: amsDay, testKey: 'bench-press', weight: 185, reps: 5 });
  check('ams fixtures: Ben bench result saved', r.status === 201, r.status);
  r = await api(coach, 'POST', '/api/meet-results', { profileId: benP.id, date: '2026-11-07', meet: 'AMS Opener', event: '100m', mark: '11.20' });
  check('ams fixtures: Ben meet result saved', r.status === 201, r.status);
  r = await api(coach, 'POST', '/api/goals', { profileId: benP.id, event: '100m', target: '11.00' });
  check('ams fixtures: Ben goal set', r.status === 201, r.status);

  /* Auth gates: AMS is coach-only data. */
  r = await api(null, 'GET', '/api/ams/roster');
  check('ams roster without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/ams/roster');
  check('ams roster for an athlete is 403', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/ams/athlete/' + benP.id);
  check('ams athlete page without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/ams/athlete/' + benP.id);
  check('ams athlete page for an athlete is 403', r.status === 403, r.status);
  r = await api(amyAcct, 'GET', '/api/ams/athlete/' + amyP.id);
  check('a linked athlete cannot read even their own AMS page', r.status === 403, r.status);
  r = await api(null, 'POST', '/api/ams/athlete/' + benP.id + '/notes', { text: 'x' });
  check('ams note create without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'POST', '/api/ams/athlete/' + benP.id + '/notes', { text: 'x' });
  check('ams note create for an athlete is 403', r.status === 403, r.status);

  /* Roster: shape + every flag rule firing and not firing. */
  r = await api(coach, 'GET', '/api/ams/roster');
  check('ams roster loads with today', r.status === 200 && r.json.today === reportToday, r.json.today);
  const amsRow = (pid) => (r.json.athletes || []).find(a => a.profile.id === pid);
  const flagKeys = (row) => (row ? row.flags.map(f => f.key) : null);
  const amyRow = amsRow(amyP.id);
  check('ams roster: Amy row shape (status, link, group)',
    !!amyRow && amyRow.status === 'active' && amyRow.linked === true &&
    amyRow.profile.linkedEmail === 'amy@test.com' && amyRow.profile.groupName === 'AMS Squad', amyRow);
  check('ams flags: Amy earns all four flags, in order',
    JSON.stringify(flagKeys(amyRow)) === JSON.stringify(['readiness', 'no-checkin', 'attendance', 'health']),
    flagKeys(amyRow));
  const amyFlag = (k) => amyRow.flags.find(f => f.key === k);
  check('ams flags: readiness carries its count (2 flagged check-ins)',
    amyFlag('readiness').count === 2 && amyFlag('readiness').detail.includes('2 flagged'), amyFlag('readiness'));
  check('ams flags: no-checkin fires with the last check-in 4 days out',
    amyFlag('no-checkin').count === 4 && amyFlag('no-checkin').detail.includes('last 3 days'), amyFlag('no-checkin'));
  check('ams flags: attendance carries its count (2 absences)',
    amyFlag('attendance').count === 2 && amyFlag('attendance').detail.includes('2 absences'), amyFlag('attendance'));
  check('ams flags: health carries its count (1 open concern)',
    amyFlag('health').count === 1 && amyFlag('health').detail.includes('1 open concern'), amyFlag('health'));
  const benRow = amsRow(benP.id);
  check('ams flags: exactly 1 flagged check-in / 1 absence / a cleared concern = NO flags for Ben',
    !!benRow && benRow.flags.length === 0, benRow && benRow.flags);
  const cidRow = amsRow(cidP.id);
  check('ams flags: unlinked Cid gets no No check-in flag (neutral Not linked instead)',
    !!cidRow && cidRow.linked === false && cidRow.flags.length === 0, cidRow);
  const deeRow = amsRow(deeP.id);
  check('ams roster: coach-set status shows on the row',
    !!deeRow && deeRow.status === 'injured' && deeRow.profile.status === 'injured', deeRow);

  /* Aggregate page: every block present, from the shared helpers. */
  r = await api(coach, 'GET', '/api/ams/athlete/nope');
  check('ams athlete page for an unknown profile is 404', r.status === 404, r.status);
  r = await api(coach, 'GET', '/api/ams/athlete/' + benP.id);
  check('ams athlete page: header block',
    r.status === 200 && r.json.profile.name === 'Ben Ams' && r.json.status === 'active' &&
    r.json.linked === true && r.json.linkedEmail === 'ben@test.com' && r.json.flags.length === 0, r.json.profile);
  check('ams athlete page: wellness window (1 check-in, averages, 1 flagged day)',
    r.json.wellness.recent.length === 1 && r.json.wellness.summary.days === 1 &&
    r.json.wellness.summary.avgSleep === 5.5 && r.json.wellness.summary.flaggedDays === 1 &&
    r.json.wellness.recent[0].flags.includes('low-sleep'), r.json.wellness.summary);
  check('ams athlete page: testing reuses the report-card block (bench 185x5 -> 216)',
    r.json.testing.length === 1 && r.json.testing[0].testKey === 'bench-press' &&
    r.json.testing[0].latest === 216 && r.json.testing[0].best === 216 &&
    r.json.testing[0].latestDate === '2026-11-09', r.json.testing);
  check('ams athlete page: meet PRs + recent results',
    r.json.meetPrs.length === 1 && r.json.meetPrs[0].event === '100m' && r.json.meetPrs[0].mark === '11.20' &&
    r.json.recentResults.length === 1 && r.json.recentResults[0].meet === 'AMS Opener', r.json.meetPrs);
  check('ams athlete page: attendance windows + recent marks',
    r.json.attendance.last30.absent === 1 && r.json.attendance.last30.marked === 1 &&
    typeof r.json.attendance.season.marked === 'number' &&
    r.json.attendance.recent.length === 1 &&
    r.json.attendance.recent[0].status === 'absent', r.json.attendance);
  check('ams athlete page: health counts the cleared concern, lists it',
    r.json.health.counts.total === 1 && r.json.health.counts.cleared === 1 &&
    r.json.health.counts.open === 0 && r.json.health.concerns.length === 1 &&
    r.json.health.concerns[0].area === 'ankle', r.json.health.counts);
  check('ams athlete page: goals with progress',
    r.json.goals.length === 1 && r.json.goals[0].event === '100m' &&
    r.json.goals[0].current.mark === '11.20', r.json.goals);
  check('ams athlete page: notes start empty', Array.isArray(r.json.notes) && r.json.notes.length === 0, r.json.notes);
  r = await api(coach, 'GET', '/api/ams/athlete/' + amyP.id);
  check('ams athlete page: Amy wellness trend (2 check-ins, both flagged)',
    r.status === 200 && r.json.wellness.summary.days === 2 && r.json.wellness.summary.flaggedDays === 2 &&
    r.json.wellness.summary.avgSleep === 6.5 && r.json.flags.length === 4, r.json.wellness.summary);

  /* Coach notes: CRUD + validation. */
  const NOTE_TEXT = 'AMS private note — check on the hamstring before Friday.';
  r = await api(coach, 'POST', '/api/ams/athlete/' + benP.id + '/notes', { text: NOTE_TEXT });
  check('ams note create is 201 with author + timestamps',
    r.status === 201 && r.json.note.text === NOTE_TEXT &&
    r.json.note.authorEmail === 'coach@test.com' && typeof r.json.note.authorId === 'string' &&
    !!r.json.note.createdAt && r.json.note.createdAt === r.json.note.updatedAt, r.json);
  const benNote = r.json.note.id;
  r = await api(coach, 'POST', '/api/ams/athlete/' + benP.id + '/notes', { text: '   ' });
  check('ams note create with blank text is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/ams/athlete/nope/notes', { text: 'x' });
  check('ams note create for an unknown athlete is 404', r.status === 404, r.status);
  r = await api(coach, 'GET', '/api/ams/athlete/' + benP.id);
  check('ams note reads back on the athlete page',
    r.json.notes.length === 1 && r.json.notes[0].id === benNote, r.json.notes);
  r = await api(coach, 'PUT', '/api/ams/athlete/' + benP.id + '/notes/' + benNote, { text: 'Edited: cleared by the trainer.' });
  check('ams note edit saves with a fresh updatedAt',
    r.status === 200 && r.json.note.text === 'Edited: cleared by the trainer.' &&
    r.json.note.updatedAt >= r.json.note.createdAt, r.json);
  r = await api(coach, 'PUT', '/api/ams/athlete/' + benP.id + '/notes/' + benNote, { text: '' });
  check('ams note edit to blank is 400', r.status === 400, r.status);
  r = await api(coach, 'PUT', '/api/ams/athlete/' + benP.id + '/notes/nope', { text: 'x' });
  check('ams note edit on an unknown note is 404', r.status === 404, r.status);
  r = await api(coach, 'PUT', '/api/ams/athlete/nope/notes/' + benNote, { text: 'x' });
  check('ams note edit on an unknown athlete is 404', r.status === 404, r.status);
  r = await api(coach, 'PUT', '/api/ams/athlete/' + benP.id + '/notes/' + benNote, { text: NOTE_TEXT });
  check('ams note restored for the privacy checks', r.status === 200 && r.json.note.text === NOTE_TEXT, r.json);

  /* Notes privacy: athletes get 403 on every note route, and no
     athlete-facing (or public, or report-card) payload carries the
     note text. */
  r = await api(athlete, 'PUT', '/api/ams/athlete/' + benP.id + '/notes/' + benNote, { text: 'hacked' });
  check('ams note edit for an athlete is 403', r.status === 403, r.status);
  r = await api(athlete, 'DELETE', '/api/ams/athlete/' + benP.id + '/notes/' + benNote);
  check('ams note delete for an athlete is 403', r.status === 403, r.status);
  r = await api(benAcct, 'GET', '/api/ams/athlete/' + benP.id);
  check('the athlete a note is ABOUT still cannot read the AMS page', r.status === 403, r.status);
  const noteLeak = (label, resp) => check('coach notes never leak into ' + label,
    !JSON.stringify(resp.json || resp.text || '').includes('AMS private note'), label);
  r = await api(benAcct, 'GET', '/api/checkin/mine');
  noteLeak('the athlete check-in history', r);
  r = await api(benAcct, 'GET', '/api/goals/mine');
  noteLeak('the athlete goals view', r);
  r = await api(benAcct, 'GET', '/api/checkin/today');
  noteLeak('the athlete check-in state', r);
  r = await api(coach, 'GET', '/api/reports/athlete/' + benP.id);
  noteLeak('the athlete report card payload', r);
  r = await api(coach, 'GET', '/api/profiles/' + benP.id + '/records');
  noteLeak('the profile records payload', r);
  const boardPub = await apiText(null, '/api/records/board');
  noteLeak('the public record board', boardPub);
  const amsRosterCsv = await apiText(coach, '/api/export/roster.csv');
  noteLeak('the roster CSV export', amsRosterCsv);

  /* Delete closes the CRUD loop. */
  r = await api(coach, 'DELETE', '/api/ams/athlete/' + benP.id + '/notes/' + benNote);
  check('ams note delete is 200', r.status === 200 && r.json.ok === true, r.json);
  r = await api(coach, 'GET', '/api/ams/athlete/' + benP.id);
  check('ams note is gone after delete', r.json.notes.length === 0, r.json.notes);
  r = await api(coach, 'DELETE', '/api/ams/athlete/' + benP.id + '/notes/' + benNote);
  check('ams note delete twice is 404', r.status === 404, r.status);

  /* ---------------- programs + team calendar ----------------
     Templates (CRUD + atomic validation), applications that write
     ordinary coach overrides through resolveAssignment, precise
     undo that keeps hand-edited days, and a server-resolved month
     grid. Fixtures are two dedicated groups; the season week of
     2026-11-02 plans ACC-01 + STR-01 on Monday, so the program's
     MAX-01 + PLY-01 Monday can only have come from the apply. */
  check('programs + calendar views are in the served page',
    pageHtml.text.includes('id="view-programs"') && pageHtml.text.includes('id="programs-main"') &&
    pageHtml.text.includes('id="view-calendar"') && pageHtml.text.includes('id="calendar-main"') &&
    pageHtml.text.includes('data-view="programs"') && pageHtml.text.includes('data-view="calendar"'));
  check('programs + calendar wiring is in the served JS',
    appJs.text.includes("['programs', 'Programs']") && appJs.text.includes("['calendar', 'Calendar']") &&
    appJs.text.includes("programs: 'coachhub'") && appJs.text.includes("calendar: 'coachhub'") &&
    appJs.text.includes("if (name === 'programs') renderPrograms();") &&
    appJs.text.includes("if (name === 'calendar') renderCalendar();") &&
    appJs.text.includes('/api/programs') && appJs.text.includes('/api/program-applications') &&
    appJs.text.includes('/api/calendar?month='));
  {
    const pcTvStart = appJs.text.indexOf('TV BOARD');
    const pcTvEnd = appJs.text.indexOf('/* ---------------- boot', pcTvStart);
    const pcTvCode = pcTvStart >= 0 && pcTvEnd > pcTvStart ? appJs.text.slice(pcTvStart, pcTvEnd) : '';
    check('TV render path has no program or calendar references',
      pcTvCode.length > 500 && !pcTvCode.includes('/api/programs') &&
      !pcTvCode.includes('/api/calendar') && !pcTvCode.includes('renderPrograms') &&
      !pcTvCode.includes('renderCalendar'), pcTvCode.length);
  }
  r = await api(coach, 'POST', '/api/groups', { name: 'Program Sprinters' });
  const gProgS = r.json.group.id;
  r = await api(coach, 'POST', '/api/groups', { name: 'Program Distance' });
  const gProgD = r.json.group.id;

  /* CRUD + validation, on a throwaway program. */
  r = await api(coach, 'POST', '/api/programs', { weeks: [{ mon: ['ACC-01'] }] });
  check('program without a name is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/programs', { name: 'Empty', weeks: [] });
  check('program with zero weeks is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/programs', {
    name: 'Too long', weeks: Array.from({ length: 17 }, () => ({})),
  });
  check('program over 16 weeks is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/programs');
  const progCountBefore = r.json.programs.length;
  r = await api(coach, 'POST', '/api/programs', { name: 'Bad code', weeks: [{ mon: ['XXX-99'] }] });
  check('program with an unknown session code is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/programs');
  check('a rejected program saves nothing (atomic validation)',
    r.json.programs.length === progCountBefore, r.json.programs.length);
  r = await api(coach, 'POST', '/api/programs', {
    name: 'CRUD Block', note: 'throwaway',
    weeks: [{ mon: ['ACC-01'] }, { fri: ['TEM-01', 'PLY-01'] }],
  });
  check('program create is 201 with normalized weeks',
    r.status === 201 && !!r.json.program.id && r.json.program.weeks.length === 2 &&
    Array.isArray(r.json.program.weeks[0].tue) && r.json.program.weeks[0].tue.length === 0 &&
    JSON.stringify(r.json.program.weeks[1].fri) === JSON.stringify(['TEM-01', 'PLY-01']), r.json);
  const progCrud = r.json.program.id;
  r = await api(coach, 'GET', '/api/programs/' + progCrud);
  check('program reads back by id', r.status === 200 && r.json.program.name === 'CRUD Block', r.status);
  r = await api(coach, 'PUT', '/api/programs/' + progCrud, {
    name: 'CRUD Block', weeks: [{ mon: ['NOPE-01'] }],
  });
  check('program edit with an unknown code is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/programs/' + progCrud);
  check('a rejected edit changes nothing',
    r.json.program.weeks.length === 2 && r.json.program.name === 'CRUD Block', r.json.program);
  r = await api(coach, 'PUT', '/api/programs/' + progCrud, {
    name: 'CRUD Block v2', note: '', weeks: [{ wed: ['MAX-01'] }],
  });
  check('program edit saves wholesale',
    r.status === 200 && r.json.program.name === 'CRUD Block v2' && r.json.program.weeks.length === 1, r.json);
  r = await api(coach, 'DELETE', '/api/programs/' + progCrud);
  check('program delete is 200', r.status === 200 && r.json.ok === true, r.status);
  r = await api(coach, 'GET', '/api/programs/' + progCrud);
  check('a deleted program is 404', r.status === 404, r.status);

  /* Apply: Wednesday start normalizes to its Monday; two-code days
     survive; resolution everywhere agrees. */
  const progWeeks = [
    { mon: ['MAX-01', 'PLY-01'], wed: ['TEM-03'] },
    { mon: ['ACC-02'], fri: ['STR-01', 'TEM-01'] },
  ];
  r = await api(coach, 'POST', '/api/programs', { name: 'Test Block', weeks: progWeeks });
  const progBlock = r.json.program.id;
  r = await api(coach, 'POST', '/api/programs/' + progBlock + '/apply', { startDate: '2026-11-04', target: 'Program Distance' });
  check('apply to one group writes its four coded days',
    r.status === 201 && r.json.applied === 4 && r.json.application.target === 'Program Distance', r.json);
  const appDist = r.json.application.id;
  check('apply normalizes a Wednesday start to that Monday',
    r.json.startDate === '2026-11-02' && r.json.normalized === true &&
    r.json.application.startDate === '2026-11-02' &&
    JSON.stringify(r.json.application.dates) === JSON.stringify(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-13']),
    r.json.application);
  r = await api(coach, 'DELETE', '/api/program-applications/' + appDist);
  check('undo of an untouched application removes all its writes',
    r.status === 200 && r.json.removed === 4 && r.json.kept === 0, r.json);
  r = await api(coach, 'POST', '/api/programs/' + progBlock + '/apply', { startDate: '2026-11-04', target: 'Program Sprinters' });
  const appSprint = r.json.application.id;
  check('re-apply to the other group also lands', r.status === 201 && r.json.applied === 4, r.json);
  r = await api(coach, 'GET', '/api/coach/feed?date=2026-11-02');
  const feedSprint = (r.json.groups || []).find(g => g.group && g.group.id === gProgS);
  check('coach feed resolves an applied day as an override of its first code',
    !!feedSprint && feedSprint.assignment.source === 'override' &&
    feedSprint.assignment.sessionId === 'MAX-01', feedSprint && feedSprint.assignment);
  r = await api(coach, 'GET', '/api/calendar?month=2026-11');
  check('calendar returns the whole month, resolved server-side',
    r.status === 200 && r.json.month === '2026-11' && r.json.days.length === 30 &&
    r.json.days.every(d => Array.isArray(d.groups)), r.json && r.json.days && r.json.days.length);
  const calDay = (ds) => r.json.days.find(d => d.date === ds);
  const calGroup = (d, gid) => (d.groups || []).find(g => g.group.id === gid) || {};
  const mon2 = calGroup(calDay('2026-11-02'), gProgS);
  check('calendar: the applied Monday carries both codes, as an override, with titles',
    mon2.source === 'override' && mon2.codes.length === 2 &&
    mon2.codes[0].id === 'MAX-01' && mon2.codes[1].id === 'PLY-01' &&
    mon2.codes[0].name.length > 0 && mon2.note === 'Program: Test Block', mon2);
  const mon2D = calGroup(calDay('2026-11-02'), gProgD);
  check('calendar: the unapplied group still resolves the plan that day',
    mon2D.source === 'plan' && mon2D.codes.map(c => c.id).join('+') === 'ACC-01+STR-01', mon2D);
  const tue3 = calGroup(calDay('2026-11-03'), gProgS);
  check('calendar: a program rest day writes nothing — the plan shows through',
    tue3.source === 'plan' && tue3.codes.map(c => c.id).join('+') === 'TEM-01+PLY-01', tue3);
  const fri13 = calGroup(calDay('2026-11-13'), gProgS);
  check('calendar: week 2 lands on the right weekday with both codes',
    fri13.source === 'override' && fri13.codes.map(c => c.id).join('+') === 'STR-01+TEM-01', fri13);
  check('calendar: the plan test day carries its marker',
    calDay('2026-11-18').isTest === true && calDay('2026-11-18').isMeet === false, calDay('2026-11-18'));
  r = await api(coach, 'GET', '/api/calendar?month=2026-12');
  check('calendar: the plan meet day carries its marker',
    r.status === 200 && r.json.days.find(d => d.date === '2026-12-19').isMeet === true,
    r.json && r.json.days && r.json.days.length);
  r = await api(coach, 'GET', '/api/calendar?month=2026-13');
  check('calendar: an impossible month is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/calendar');
  check('calendar: no month param defaults to the current month',
    r.status === 200 && r.json.days.length >= 28 && /^\d{4}-\d{2}$/.test(r.json.month), r.json && r.json.month);

  /* Apply to ALL groups + deleting the template keeps the
     application removable. */
  r = await api(coach, 'GET', '/api/groups');
  const groupCount = r.json.groups.length;
  r = await api(coach, 'POST', '/api/programs', { name: 'All Block', weeks: [{ tue: ['TEM-02'] }] });
  const progAll = r.json.program.id;
  r = await api(coach, 'POST', '/api/programs/' + progAll + '/apply', { startDate: '2026-12-07', target: 'all' });
  check('apply to all groups writes one day per group, Monday start un-normalized',
    r.status === 201 && r.json.applied === groupCount && r.json.normalized === false &&
    JSON.stringify(r.json.application.dates) === JSON.stringify(['2026-12-08']), r.json);
  const appAll = r.json.application.id;
  r = await api(coach, 'GET', '/api/calendar?month=2026-12');
  const dec8 = (r.json.days.find(d => d.date === '2026-12-08').groups || []).find(g => g.group.id === gProgS);
  check('calendar: the all-groups apply reached every group',
    !!dec8 && dec8.source === 'override' && dec8.codes.map(c => c.id).join('+') === 'TEM-02', dec8);
  r = await api(coach, 'DELETE', '/api/programs/' + progAll);
  check('deleting an applied program is 200', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/program-applications');
  check('the application outlives its template',
    r.status === 200 && r.json.applications.some(a => a.id === appAll), r.json);
  r = await api(coach, 'DELETE', '/api/program-applications/' + appAll);
  check('undo still works after the template is gone',
    r.status === 200 && r.json.removed === groupCount && r.json.kept === 0, r.json);

  /* Apply errors. */
  r = await api(coach, 'POST', '/api/programs/' + progBlock + '/apply', { startDate: 'not-a-date', target: 'all' });
  check('apply with a bad start date is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/programs/' + progBlock + '/apply', { startDate: '2026-11-02', target: 'No Such Group' });
  check('apply to an unknown group is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/programs', { name: 'Blank Block', weeks: [{}, {}] });
  const progBlank = r.json.program.id;
  r = await api(coach, 'POST', '/api/programs/' + progBlank + '/apply', { startDate: '2026-11-02', target: 'all' });
  check('applying a program with no sessions in it is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/programs/does-not-exist/apply', { startDate: '2026-11-02', target: 'all' });
  check('applying a missing program is 404', r.status === 404, r.status);

  /* Undo keeps a hand-edited day: change one applied day through the
     ordinary override endpoint, then remove the application. */
  r = await api(coach, 'POST', '/api/assignments/override', { groupId: gProgS, date: '2026-11-04', sessionId: 'TEM-01', note: 'Coach swapped it' });
  check('hand-edit of an applied day saves as a normal override',
    r.status === 200 && r.json.assignment.sessionId === 'TEM-01', r.json);
  r = await api(coach, 'DELETE', '/api/program-applications/' + appSprint);
  check('undo removes exactly its own writes and keeps the hand-edited day',
    r.status === 200 && r.json.removed === 3 && r.json.kept === 1, r.json);
  r = await api(coach, 'GET', '/api/calendar?month=2026-11');
  const afterMon = (r.json.days.find(d => d.date === '2026-11-02').groups || []).find(g => g.group.id === gProgS);
  const afterWed = (r.json.days.find(d => d.date === '2026-11-04').groups || []).find(g => g.group.id === gProgS);
  check('after undo, untouched applied days fall back to the plan',
    !!afterMon && afterMon.source === 'plan' && afterMon.codes.map(c => c.id).join('+') === 'ACC-01+STR-01', afterMon);
  check('after undo, the hand-edited day keeps the coach pick',
    !!afterWed && afterWed.source === 'override' && afterWed.sessionId === 'TEM-01' &&
    afterWed.note === 'Coach swapped it', afterWed);
  r = await api(coach, 'DELETE', '/api/program-applications/' + appSprint);
  check('removing the same application twice is 404', r.status === 404, r.status);

  /* Auth gates: planning surfaces are coach-only. */
  for (const [method, pth] of [
    ['GET', '/api/programs'], ['POST', '/api/programs'],
    ['GET', '/api/programs/' + progBlock], ['PUT', '/api/programs/' + progBlock],
    ['DELETE', '/api/programs/' + progBlock],
    ['POST', '/api/programs/' + progBlock + '/apply'],
    ['GET', '/api/program-applications'], ['DELETE', '/api/program-applications/' + appSprint],
    ['GET', '/api/calendar?month=2026-11'],
  ]) {
    r = await api(athlete, method, pth, method === 'POST' || method === 'PUT' ? {} : undefined);
    check('athlete is 403 on ' + method + ' ' + pth.split('?')[0], r.status === 403, r.status);
    r = await api(null, method, pth, method === 'POST' || method === 'PUT' ? {} : undefined);
    check('logged-out is 401 on ' + method + ' ' + pth.split('?')[0], r.status === 401, r.status);
  }

  /* ---------------- coach announcements ----------------
     One-way coach-to-team posts. The read endpoint filters
     server-side per caller: coaches see all; an athlete sees the
     team posts plus their own group's; an unlinked athlete, or a
     linked one with no group, sees the team posts only. Own
     fixtures (two groups, three linked athletes, one unlinked
     account) so every feed count is exact. */
  check('announcements view + Today slot are in the served page',
    pageHtml.text.includes('id="view-announce"') && pageHtml.text.includes('id="announce-main"') &&
    pageHtml.text.includes('id="announce-slot"') && pageHtml.text.includes('data-view="announce"'));
  check('announcements wiring is in the served JS',
    appJs.text.includes("['announce', 'Announcements']") && appJs.text.includes("announce: 'coachhub'") &&
    appJs.text.includes('renderAnnouncements') && appJs.text.includes('renderAnnouncePanel') &&
    appJs.text.includes('/api/announcements'));
  const annPause = () => new Promise(res => setTimeout(res, 15));
  r = await api(coach, 'POST', '/api/groups', { name: 'Announce A' });
  const annGrpA = r.json.group;
  r = await api(coach, 'POST', '/api/groups', { name: 'Announce B' });
  const annGrpB = r.json.group;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Ana', lastName: 'Alpha', groupId: annGrpA.id, events: ['sprinter'] });
  const anaP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Bob', lastName: 'Beta', groupId: annGrpB.id, events: ['sprinter'] });
  const bobP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Uma', lastName: 'Free', events: [] });
  const umaP = r.json.profile;
  check('announcement fixtures: ungrouped profile carries no group',
    !!umaP && (umaP.groupId === null || umaP.groupId === undefined), umaP);
  await api(coach, 'PUT', '/api/profiles/' + anaP.id + '/link', { email: 'ana@test.com' });
  await api(coach, 'PUT', '/api/profiles/' + bobP.id + '/link', { email: 'bob@test.com' });
  await api(coach, 'PUT', '/api/profiles/' + umaP.id + '/link', { email: 'uma@test.com' });
  for (const e of ['ana@test.com', 'bob@test.com', 'uma@test.com', 'unl@test.com']) {
    await api(coach, 'POST', '/api/client-invites', { email: e });
  }
  r = await api(null, 'POST', '/api/register', { email: 'ana@test.com', password: 'testpass123' });
  const ana = cookieOf(r);
  r = await api(null, 'POST', '/api/register', { email: 'bob@test.com', password: 'testpass123' });
  const bob = cookieOf(r);
  r = await api(null, 'POST', '/api/register', { email: 'uma@test.com', password: 'testpass123' });
  const uma = cookieOf(r);
  r = await api(null, 'POST', '/api/register', { email: 'unl@test.com', password: 'testpass123' });
  const unl = cookieOf(r);

  /* Empty feed + auth gates. */
  r = await api(coach, 'GET', '/api/announcements');
  check('announcements feed starts empty for the coach',
    r.status === 200 && Array.isArray(r.json.announcements) && r.json.announcements.length === 0, r.json);
  r = await api(ana, 'GET', '/api/announcements');
  check('announcements feed starts empty for an athlete too',
    r.status === 200 && r.json.announcements.length === 0, r.json);
  r = await api(null, 'GET', '/api/announcements');
  check('announcements feed without login is 401', r.status === 401, r.status);
  r = await api(null, 'POST', '/api/announcements', { body: 'hello' });
  check('announcement create without login is 401', r.status === 401, r.status);
  r = await api(ana, 'POST', '/api/announcements', { body: 'athlete post' });
  check('athlete cannot create an announcement (403)', r.status === 403, r.status);

  /* Validation: clean 400s, nothing half-saved. */
  r = await api(coach, 'POST', '/api/announcements', {});
  check('announcement with no body is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/announcements', { body: '   ' });
  check('announcement with a blank body is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/announcements', { body: 'x'.repeat(2001) });
  check('announcement body over 2000 chars is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/announcements', { body: 'fine', audience: 'no-such-group' });
  check('announcement to an unknown audience is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/announcements');
  check('failed announcement creates saved nothing', r.json.announcements.length === 0, r.json.announcements.length);

  /* Creates: one team post, one group-A post, one pinned team
     post (in that order, so feed order proves pinned-beats-newer
     and newest-first among the unpinned). */
  r = await api(coach, 'POST', '/api/announcements', { body: 'Team post one', title: 'Welcome' });
  check('team announcement creates 201 with author + team audience recorded',
    r.status === 201 && r.json.announcement.body === 'Team post one' &&
    r.json.announcement.title === 'Welcome' && r.json.announcement.audience === 'team' &&
    r.json.announcement.audienceLabel === 'Whole team' && r.json.announcement.pinned === false &&
    r.json.announcement.authorEmail === 'coach@test.com' &&
    (r.json.announcement.authorLabel || '').includes('coach@test.com'), r.json);
  const annTeamOld = r.json.announcement;
  await annPause();
  r = await api(coach, 'POST', '/api/announcements', { body: 'Group A only', audience: annGrpA.id });
  check('group announcement creates 201 with the group label resolved',
    r.status === 201 && r.json.announcement.audience === annGrpA.id &&
    r.json.announcement.audienceLabel === 'Announce A' && r.json.announcement.groupName === 'Announce A', r.json);
  const annPostA = r.json.announcement;
  await annPause();
  r = await api(assistant, 'POST', '/api/announcements', { body: 'Pinned team post', pinned: true });
  check('an assistant coach can post, and is recorded as the author',
    r.status === 201 && r.json.announcement.pinned === true &&
    r.json.announcement.authorEmail === 'newcoach@test.com', r.json);
  const annPinned = r.json.announcement;
  await annPause();
  r = await api(coach, 'POST', '/api/announcements', { body: 'Group B only', audience: annGrpB.id });
  const annPostB = r.json.announcement;
  check('group B announcement creates 201', r.status === 201 && !!annPostB.id, r.status);
  await annPause();
  r = await api(coach, 'POST', '/api/announcements', { body: 'Long title post', title: 't'.repeat(120) });
  check('an overlong title is cleaned to 80 chars, not rejected',
    r.status === 201 && r.json.announcement.title.length === 80, r.json.announcement && r.json.announcement.title.length);
  const annLongTitle = r.json.announcement;

  /* The audience-filter matrix. */
  const feedIds = async (ck) => (await api(ck, 'GET', '/api/announcements')).json.announcements.map(a => a.id);
  r = await api(coach, 'GET', '/api/announcements');
  check('coach feed: all 5 posts, pinned first, then newest first',
    r.json.announcements.length === 5 &&
    r.json.announcements[0].id === annPinned.id &&
    r.json.announcements[1].id === annLongTitle.id &&
    r.json.announcements[2].id === annPostB.id &&
    r.json.announcements[3].id === annPostA.id &&
    r.json.announcements[4].id === annTeamOld.id,
    r.json.announcements.map(a => a.id));
  check('group A athlete sees team posts + group A post, never group B',
    JSON.stringify(await feedIds(ana)) ===
    JSON.stringify([annPinned.id, annLongTitle.id, annPostA.id, annTeamOld.id]));
  check('group B athlete sees team posts + group B post, never group A',
    JSON.stringify(await feedIds(bob)) ===
    JSON.stringify([annPinned.id, annLongTitle.id, annPostB.id, annTeamOld.id]));
  check('linked athlete with no group sees team posts only',
    JSON.stringify(await feedIds(uma)) ===
    JSON.stringify([annPinned.id, annLongTitle.id, annTeamOld.id]));
  check('unlinked athlete sees team posts only',
    JSON.stringify(await feedIds(unl)) ===
    JSON.stringify([annPinned.id, annLongTitle.id, annTeamOld.id]));
  r = await api(ana, 'GET', '/api/announcements');
  check('athlete feed carries the display shape (pin, audience label, author, dates)',
    r.json.announcements[0].pinned === true &&
    r.json.announcements[0].authorLabel.includes('newcoach@test.com') &&
    typeof r.json.announcements[0].createdAt === 'string' &&
    r.json.announcements.every(a => typeof a.body === 'string' && typeof a.audienceLabel === 'string'),
    r.json.announcements[0]);

  /* Athlete write attempts stay 403 on edit/delete too. */
  r = await api(ana, 'PUT', '/api/announcements/' + annTeamOld.id, { body: 'hijack' });
  check('athlete cannot edit an announcement (403)', r.status === 403, r.status);
  r = await api(ana, 'DELETE', '/api/announcements/' + annTeamOld.id);
  check('athlete cannot delete an announcement (403)', r.status === 403, r.status);
  r = await api(null, 'PUT', '/api/announcements/' + annTeamOld.id, { body: 'hijack' });
  check('announcement edit without login is 401', r.status === 401, r.status);

  /* Edit: retarget the group-A post to group B and the filtered
     feeds move with it; a bad edit changes nothing. */
  r = await api(coach, 'PUT', '/api/announcements/' + annPostA.id, { audience: annGrpB.id, body: 'Now for group B' });
  check('coach retargets a post to another group',
    r.status === 200 && r.json.announcement.audience === annGrpB.id &&
    r.json.announcement.body === 'Now for group B' && r.json.announcement.audienceLabel === 'Announce B', r.json);
  check('after the retarget, group A athlete loses the post',
    !(await feedIds(ana)).includes(annPostA.id));
  check('after the retarget, group B athlete gains the post',
    (await feedIds(bob)).includes(annPostA.id));
  r = await api(coach, 'PUT', '/api/announcements/' + annPostA.id, { body: '' });
  check('an edit with an empty body is 400', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/announcements');
  check('the failed edit changed nothing',
    (r.json.announcements.find(a => a.id === annPostA.id) || {}).body === 'Now for group B', r.json.announcements.length);
  r = await api(coach, 'PUT', '/api/announcements/no-such-id', { body: 'x' });
  check('editing a missing announcement is 404', r.status === 404, r.status);

  /* Pin toggle reorders the feed: pin the oldest team post and
     it joins the top, ahead of the newer unpinned posts but
     behind nothing pinned earlier... both pinned sort newest
     first among themselves is NOT assumed — the pinned pair is
     checked as a set at the top. */
  r = await api(coach, 'PUT', '/api/announcements/' + annTeamOld.id, { pinned: true });
  check('pin toggle saves', r.status === 200 && r.json.announcement.pinned === true, r.json);
  r = await api(ana, 'GET', '/api/announcements');
  const anaTop2 = r.json.announcements.slice(0, 2).map(a => a.id).sort();
  check('athlete feed: both pinned posts sit on top',
    JSON.stringify(anaTop2) === JSON.stringify([annPinned.id, annTeamOld.id].sort()) &&
    r.json.announcements.slice(2).every(a => !a.pinned), r.json.announcements.map(a => a.id));
  r = await api(coach, 'PUT', '/api/announcements/' + annTeamOld.id, { pinned: false });
  check('unpin saves', r.status === 200 && r.json.announcement.pinned === false, r.json);

  /* Delete: the post leaves every feed at once. */
  r = await api(coach, 'DELETE', '/api/announcements/' + annLongTitle.id);
  check('coach deletes an announcement', r.status === 200 && r.json.ok === true, r.json);
  check('deleted post is gone from coach and athlete feeds',
    !(await feedIds(coach)).includes(annLongTitle.id) && !(await feedIds(ana)).includes(annLongTitle.id));
  r = await api(coach, 'DELETE', '/api/announcements/' + annLongTitle.id);
  check('deleting the same announcement twice is 404', r.status === 404, r.status);

  /* ---------------- data: backup export / import + CSVs ---------------- */
  check('data view is in the served page',
    pageHtml.text.includes('id="view-data"') && pageHtml.text.includes('id="data-main"') &&
    pageHtml.text.includes('data-view="data"'));
  check('data wiring is in the served JS',
    appJs.text.includes("['data', 'Data']") && appJs.text.includes("data: 'coachhub'") &&
    appJs.text.includes('renderData') && appJs.text.includes('/api/export/backup') &&
    appJs.text.includes('/api/import/backup') && appJs.text.includes('/api/export/attendance.csv') &&
    appJs.text.includes('/api/export/testing-detail.csv') && appJs.text.includes('/api/export/checkins.csv') &&
    appJs.text.includes('/api/export/records.csv'));

  /* Auth matrix: every data endpoint is coach-only. */
  r = await api(null, 'GET', '/api/export/backup');
  check('backup export without login is 401', r.status === 401, r.status);
  r = await api(ana, 'GET', '/api/export/backup');
  check('backup export for an athlete is 403', r.status === 403, r.status);
  r = await api(null, 'POST', '/api/import/backup', {});
  check('backup import without login is 401', r.status === 401, r.status);
  r = await api(ana, 'POST', '/api/import/backup', {});
  check('backup import for an athlete is 403', r.status === 403, r.status);
  for (const csvPath of ['/api/export/attendance.csv', '/api/export/testing-detail.csv',
    '/api/export/checkins.csv', '/api/export/records.csv']) {
    const noAuth = await apiText(null, csvPath);
    check('GET ' + csvPath + ' without login is 401', noAuth.status === 401, noAuth.status);
    const ath = await apiText(ana, csvPath);
    check('GET ' + csvPath + ' for an athlete is 403', ath.status === 403, ath.status);
  }

  /* Fixtures of our own, so the CSV and merge assertions below are
     exact rather than depending on earlier blocks' data. */
  r = await api(coach, 'POST', '/api/groups', { name: 'Data Group' });
  check('data fixture group creates', r.status === 201 && !!r.json.group.id, r.status);
  const dataGrp = r.json.group;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Data', lastName: 'Subject', groupId: dataGrp.id });
  check('data fixture athlete creates', r.status === 201 && !!r.json.profile.id, r.status);
  const dataP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: '=2+5', lastName: 'Formula', groupId: dataGrp.id });
  check('hostile-name fixture athlete creates', r.status === 201 && !!r.json.profile.id, r.status);
  const hostileP = r.json.profile;
  r = await api(coach, 'PUT', '/api/attendance/2027-01-04/' + dataP.id, { status: 'present' });
  check('data fixture attendance mark saves', r.status === 200, r.status);
  r = await api(coach, 'PUT', '/api/attendance/2027-01-04/' + hostileP.id, { status: 'late' });
  check('hostile-name attendance mark saves', r.status === 200, r.status);
  r = await api(coach, 'POST', '/api/test-days', { date: '2027-01-05', title: 'Data Day', testKeys: ['back-squat'] });
  check('data fixture test day creates', r.status === 201 && !!r.json.testDay.id, r.status);
  const dataDay = r.json.testDay;
  r = await api(coach, 'POST', '/api/results', { profileId: dataP.id, testDayId: dataDay.id, testKey: 'back-squat', weight: 200, reps: 5 });
  check('data fixture testing result saves', r.status === 201 || r.status === 200, r.status);
  r = await api(coach, 'POST', '/api/records', { event: '100m', mark: '9.99', name: 'Data Record', year: 2027, meet: 'Data Meet' });
  check('data fixture club record saves', r.status === 201 || r.status === 200, r.status);
  await api(coach, 'POST', '/api/client-invites', { email: 'data@test.com' });
  r = await api(null, 'POST', '/api/register', { email: 'data@test.com', password: 'testpass123' });
  check('data fixture athlete account registers', r.status === 201, r.status);
  const dataUser = cookieOf(r);
  r = await api(coach, 'PUT', '/api/profiles/' + dataP.id + '/link', { email: 'data@test.com' });
  check('data fixture account links to the profile', r.status === 200, r.status);
  /* Dated ten days back on purpose: a check-in today would change
     the wellness-today counts the restart block asserts later. */
  const dataCheckinDate = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  r = await api(dataUser, 'POST', '/api/checkin', { date: dataCheckinDate, sleep: 7.5, soreness: 2, energy: 4 });
  check('data fixture check-in saves', r.status === 201 || r.status === 200, r.status);

  /* The backup export: envelope, full collection set, no secrets. */
  const bk = await apiText(coach, '/api/export/backup');
  check('backup export downloads as JSON with a dated filename',
    bk.status === 200 && bk.type.includes('application/json') &&
    bk.disp.includes('ruffin-performance-backup-') && bk.disp.includes('.json'), bk.disp);
  const bkEnv = JSON.parse(bk.text);
  check('backup envelope markers are right',
    bkEnv.app === 'ruffin-performance-app' && bkEnv.kind === 'backup' && bkEnv.version === 1 &&
    typeof bkEnv.exportedAt === 'string' && !!bkEnv.data, bkEnv.app + '/' + bkEnv.kind + '/' + bkEnv.version);
  const BK_ARRAYS = ['groups', 'profiles', 'customTests', 'testDays', 'customWeeklyMetrics',
    'inventory', 'meetResults', 'meets', 'meetEntries', 'schoolRecords', 'goals', 'coachInvites', 'clientInvites',
    'customWorkouts', 'programs', 'programApplications', 'announcements', 'memberLogs'];
  const BK_OBJECTS = ['overrides', 'completions', 'testResults', 'weekly', 'concerns',
    'mediaOverrides', 'warmupCardEdits', 'athleteLinks', 'checkins', 'attendance', 'coachNotes'];
  check('backup carries every team-data collection with the right shape',
    BK_ARRAYS.every(k => Array.isArray(bkEnv.data[k])) &&
    BK_OBJECTS.every(k => !!bkEnv.data[k] && typeof bkEnv.data[k] === 'object' && !Array.isArray(bkEnv.data[k])) &&
    typeof bkEnv.data.customWorkoutsSeeded === 'boolean',
    Object.keys(bkEnv.data));
  check('backup data matches the live store (announcements + fixture profile present)',
    bkEnv.data.announcements.length === 4 &&
    bkEnv.data.profiles.some(p => p.id === dataP.id) &&
    bkEnv.data.attendance['2027-01-04'] && bkEnv.data.attendance['2027-01-04'][dataP.id].status === 'present',
    bkEnv.data.announcements.length);
  check('backup contains no accounts or secrets',
    !('users' in bkEnv.data) && !bk.text.includes('passHash') && !bk.text.includes('"users"') &&
    !bk.text.includes('test-secret') && !bk.text.includes('"logs"'),
    bk.text.slice(0, 120));

  /* The new CSVs: headers, rows, and the formula guard. */
  let cx = await apiText(coach, '/api/export/attendance.csv');
  check('attendance CSV downloads with its header',
    cx.status === 200 && cx.type.includes('text/csv') && cx.disp.includes('attendance.csv') &&
    cx.text.startsWith('Date,Athlete,Group,Status'), cx.text.slice(0, 60));
  check('attendance CSV carries the fixture rows',
    cx.text.includes('2027-01-04,Data Subject,Data Group,present'), cx.text.slice(0, 200));
  check('attendance CSV neutralizes a formula-looking athlete name',
    cx.text.includes("'=2+5 Formula,Data Group,late"), cx.text.slice(0, 200));
  cx = await apiText(coach, '/api/export/testing-detail.csv');
  check('testing detail CSV downloads with the spec header',
    cx.status === 200 && cx.disp.includes('testing-detail.csv') &&
    cx.text.startsWith('Athlete,Test Date,Test,Value,Weight (lb),Reps,Est. 1RM (lb)'), cx.text.slice(0, 80));
  check('testing detail CSV splits value / weight / reps / est 1RM into columns',
    cx.text.includes('Data Subject,2027-01-05,Back Squat,,200,5,233'), cx.text.slice(0, 200));
  cx = await apiText(coach, '/api/export/checkins.csv');
  check('check-ins CSV downloads with its header',
    cx.status === 200 && cx.disp.includes('checkins.csv') &&
    cx.text.startsWith('Athlete,Date,Sleep (hrs),Soreness,Energy,Something Hurts'), cx.text.slice(0, 80));
  check('check-ins CSV carries the fixture check-in',
    cx.text.split('\r\n').some(l => l.startsWith('Data Subject,') && l.includes(',7.5,2,4,no')),
    cx.text.slice(0, 200));
  cx = await apiText(coach, '/api/export/records.csv');
  check('club records CSV downloads with its header',
    cx.status === 200 && cx.disp.includes('club-records.csv') &&
    cx.text.startsWith('Event,Mark,Name,Year,Meet'), cx.text.slice(0, 60));
  check('club records CSV carries the fixture record',
    cx.text.includes('100m,9.99,Data Record,2027,Data Meet'), cx.text.slice(0, 200));

  /* Import: merge semantics — add new, update same-id, delete
     nothing, leave unrelated records exactly as they were. */
  const pinnedRec = bkEnv.data.announcements.find(a => a.id === annPinned.id);
  const importOne = {
    app: 'ruffin-performance-app', kind: 'backup', version: 1, exportedAt: bkEnv.exportedAt,
    data: {
      profiles: [{ id: 'data-import-prof', firstName: 'Imported', lastName: 'Athlete', groupId: null, events: [], topAthlete: false, archived: false, status: 'active' }],
      announcements: [Object.assign({}, pinnedRec, { body: 'Pinned post (edited by import)' })],
      attendance: { '2027-01-04': { 'data-import-prof': { status: 'excused', updatedAt: '2027-01-04T12:00:00.000Z', updatedBy: 'import-test' } } },
    },
  };
  r = await api(coach, 'POST', '/api/import/backup', importOne);
  check('import merges and reports per-collection counts',
    r.status === 200 && r.json.ok === true &&
    r.json.counts.profiles.added === 1 && r.json.counts.profiles.updated === 0 &&
    r.json.counts.announcements.added === 0 && r.json.counts.announcements.updated === 1 &&
    r.json.counts.attendance.added === 1 && r.json.counts.attendance.updated === 0 &&
    r.json.totalAdded === 2 && r.json.totalUpdated === 1, r.json);
  r = await api(coach, 'GET', '/api/announcements');
  check('the imported edit landed and every other post is untouched',
    r.json.announcements.length === 4 &&
    (r.json.announcements.find(a => a.id === annPinned.id) || {}).body === 'Pinned post (edited by import)' &&
    (r.json.announcements.find(a => a.id === annPostB.id) || {}).body === 'Group B only' &&
    (r.json.announcements.find(a => a.id === annTeamOld.id) || {}).body === 'Team post one',
    r.json.announcements.map(a => a.body));
  r = await api(coach, 'GET', '/api/profiles');
  check('the imported profile is on the roster',
    r.json.profiles.some(p => p.id === 'data-import-prof'), r.json.profiles.length);
  cx = await apiText(coach, '/api/export/attendance.csv');
  check('leaf merge: the imported attendance leaf landed beside the existing ones',
    cx.text.includes('2027-01-04,Imported Athlete,,excused') &&
    cx.text.includes('2027-01-04,Data Subject,Data Group,present'), cx.text.slice(0, 200));
  r = await api(coach, 'POST', '/api/import/backup', importOne);
  check('re-importing the identical file adds and updates nothing',
    r.status === 200 && r.json.totalAdded === 0 && r.json.totalUpdated === 0, r.json);

  /* Import: atomic rejection — validate everything, mutate nothing. */
  const profCountBefore = (await api(coach, 'GET', '/api/profiles')).json.profiles.length;
  r = await api(coach, 'POST', '/api/import/backup', {
    app: 'ruffin-performance-app', kind: 'backup', version: 1,
    data: {
      profiles: 'not-a-list',
      announcements: [{ id: 'brand-new-ann', title: '', body: 'should not land', audience: 'team', pinned: false, authorId: 'x', authorEmail: 'x@test.com', createdAt: '2027-01-01T00:00:00.000Z', updatedAt: '2027-01-01T00:00:00.000Z' }],
    },
  });
  check('a bad collection type refuses the whole import (400)', r.status === 400, r.status);
  r = await api(coach, 'GET', '/api/announcements');
  check('the refused import saved nothing (announcement absent)',
    !r.json.announcements.some(a => a.id === 'brand-new-ann'), r.json.announcements.length);
  r = await api(coach, 'GET', '/api/profiles');
  check('the refused import saved nothing (profile count unchanged)',
    r.json.profiles.length === profCountBefore, r.json.profiles.length);
  r = await api(coach, 'POST', '/api/import/backup', { app: 'other-app', kind: 'backup', data: {} });
  check('a foreign envelope is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/import/backup', { kind: 'backup', data: {} });
  check('an envelope missing the app marker is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/import/backup', { app: 'ruffin-performance-app', kind: 'backup', data: [] });
  check('a backup whose data is a list is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/import/backup', { app: 'ruffin-performance-app', kind: 'backup', data: { profiles: [{ firstName: 'No', lastName: 'Id' }] } });
  check('a record missing its id is 400', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/import/backup', undefined, { raw: 'this is not json', contentType: 'application/json' });
  check('a non-JSON import body is 400', r.status === 400, r.status);
  const bigBody = '{"app":"sprinter-workout-app","kind":"backup","data":{"pad":"'
    + 'x'.repeat(11 * 1024 * 1024) + '"}}';
  r = await api(coach, 'POST', '/api/import/backup', undefined, { raw: bigBody, contentType: 'application/json' });
  check('an import over 10 MB is 413', r.status === 413, r.status);

  /* ---------------- devices: ForceDecks / NordBord / T-APEX --------
     Device results are testing results filed from VALD-style CSV
     exports (preview -> confirm, exact-name matching only) or the
     T-APEX quick-entry card. Own squad, so every count is exact:
       Dana  FD jump 38.2 -> 33.5 across two sessions (drop-off),
             FD asymmetry 12.5 in session 1 only (latest-session rule),
             NordBord-free; T-APEX entry + a T-APEX file import.
       Evan  FD once (no prior session -> no drop-off), NordBord
             300/260 (13% apart -> imbalance flag).
       Fay   NordBord 300/290 (3% -> no flag); receives Zed's
             unmatched row by manual mapping. */
  r = await api(coach, 'POST', '/api/groups', { name: 'Device Squad' });
  const gDev = r.json.group.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Dana', lastName: 'Device', groupId: gDev, events: ['sprinter'] });
  const danaD = r.json.profile.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Evan', lastName: 'Device', groupId: gDev, events: ['jumper'] });
  const evanD = r.json.profile.id;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Fay', lastName: 'Device', groupId: gDev, events: ['sprinter'] });
  const fayD = r.json.profile.id;

  check('devices view is in the served page',
    pageHtml.text.includes('id="view-devices"') && pageHtml.text.includes('id="devices-main"') &&
    pageHtml.text.includes('data-view="devices"'));
  check('devices wiring is in the served JS (tabs, importers, VALD API status)',
    appJs.text.includes('renderDevices') && appJs.text.includes('/api/devices/') &&
    appJs.text.includes("devices: 'coachhub'") && appJs.text.includes("['devices', 'Devices']") &&
    appJs.text.includes('renderValdApiPanel') && appJs.text.includes('NOT CONNECTED') &&
    appJs.text.includes('paintTapexPanel'));
  {
    const tvStart = appJs.text.indexOf('TV BOARD');
    const tvEnd = appJs.text.indexOf('/* ---------------- boot', tvStart);
    const tvCode = appJs.text.slice(tvStart, tvEnd);
    check('TV render path has no device references',
      tvStart >= 0 && tvEnd > tvStart && !tvCode.includes('/api/devices') &&
      !tvCode.toLowerCase().includes('forcedecks') && !tvCode.toLowerCase().includes('nordbord') &&
      !tvCode.toLowerCase().includes('t-apex'), tvCode.length);
  }

  /* Auth matrix: every device endpoint is coach-only. */
  r = await api(athlete, 'POST', '/api/devices/forcedecks/preview', { csv: 'Name,Date\nX,2026-01-01' });
  check('athlete is 403 on device preview', r.status === 403, r.status);
  r = await api(null, 'POST', '/api/devices/forcedecks/preview', { csv: 'Name,Date\nX,2026-01-01' });
  check('device preview without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'POST', '/api/devices/nordbord/commit', { rows: [] });
  check('athlete is 403 on device commit', r.status === 403, r.status);
  r = await api(null, 'POST', '/api/devices/nordbord/commit', { rows: [] });
  check('device commit without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/devices/forcedecks/summary');
  check('athlete is 403 on device summary', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/devices/forcedecks/summary');
  check('device summary without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'POST', '/api/devices/tapex/entry', { profileId: danaD, date: '2026-10-22', load: 10 });
  check('athlete is 403 on tapex entry', r.status === 403, r.status);
  r = await api(null, 'POST', '/api/devices/tapex/entry', { profileId: danaD, date: '2026-10-22', load: 10 });
  check('tapex entry without login is 401', r.status === 401, r.status);
  r = await api(athlete, 'GET', '/api/devices/tapex/entries');
  check('athlete is 403 on tapex entries', r.status === 403, r.status);
  r = await api(null, 'GET', '/api/devices/tapex/entries');
  check('tapex entries without login is 401', r.status === 401, r.status);
  r = await api(coach, 'GET', '/api/devices/wat/summary');
  check('an unknown device is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/devices/wat/preview', { csv: 'Name,Date\nX,2026-01-01' });
  check('an unknown device preview is 404', r.status === 404, r.status);

  /* ForceDecks import 1: quoted fields, a thousands separator, an
     unrecognized numeric column, one unmatched name, one bad date. */
  const fdCsv1 = [
    'Athlete,Date,Jump Height (cm),Peak Force (N),Flight Time (ms),L/R Asymmetry (%),Mystery Score,Session Notes',
    'Dana Device,10/20/2026,38.2,"2,150",512,12.5,88,"felt good, strong"',
    'Evan Device,2026-10-20,35.0,1980,498,4.0,81,ok',
    'Zed Stranger,10/20/2026,30.1,1800,470,3.0,77,guest',
    'Dana Device,13/40/2026,39.0,2200,520,5.0,90,bad date',
  ].join('\n');
  const devResultsBefore = (await api(coach, 'GET', '/api/results')).json.results.length;
  const devDaysBefore = (await api(coach, 'GET', '/api/test-days')).json.testDays.length;
  const devTestsBefore = (await api(coach, 'GET', '/api/tests')).json.tests.length;
  r = await api(coach, 'POST', '/api/devices/forcedecks/preview', { csv: fdCsv1 });
  check('forcedecks preview parses the export', r.status === 200, r.status);
  const fdPv1 = r.json;
  check('preview: 3 readable rows + 1 bad-date error with a plain reason',
    fdPv1.rows.length === 3 && fdPv1.errors.length === 1 && /date/i.test(fdPv1.errors[0].reason),
    fdPv1.errors);
  const pvDana = fdPv1.rows.find(x => x.rawName === 'Dana Device');
  const pvEvan = fdPv1.rows.find(x => x.rawName === 'Evan Device');
  const pvZed = fdPv1.rows.find(x => x.rawName === 'Zed Stranger');
  check('preview: exact-name matches land on the roster profiles, M/D/YYYY normalized',
    !!pvDana && pvDana.profileId === danaD && pvDana.matchStatus === 'matched' &&
    pvDana.date === '2026-10-20' && !!pvEvan && pvEvan.profileId === evanD, fdPv1.rows);
  check('preview: an unknown name is unmatched with no profile guessed',
    !!pvZed && pvZed.matchStatus === 'unmatched' && pvZed.profileId === null, pvZed);
  check('preview: quoted thousands value parses; unrecognized numeric column captured; text column is not a metric',
    !!pvDana && pvDana.metrics['Peak Force (N)'] === 2150 &&
    pvDana.metrics['Mystery Score'] === 88 && pvDana.metrics['Jump Height (cm)'] === 38.2 &&
    pvDana.metrics['Session Notes'] === undefined, pvDana && pvDana.metrics);
  r = await api(coach, 'GET', '/api/results');
  check('preview writes nothing (results unchanged)',
    r.json.results.length === devResultsBefore, r.json.results.length);
  r = await api(coach, 'GET', '/api/test-days');
  check('preview writes nothing (no test day created)',
    r.json.testDays.length === devDaysBefore, r.json.testDays.length);
  r = await api(coach, 'GET', '/api/tests');
  check('preview writes nothing (no custom tests created)',
    r.json.tests.length === devTestsBefore, r.json.tests.length);
  r = await api(coach, 'POST', '/api/devices/forcedecks/preview',
    { csv: 'Date,Jump Height (cm)\n2026-10-20,38.2' });
  check('a file with no name column is a plain 400',
    r.status === 400 && /name column/i.test(r.json.error), r.json);
  r = await api(coach, 'POST', '/api/devices/forcedecks/preview', { csv: '   ' });
  check('an empty file is 400', r.status === 400, r.status);

  const fdCommitRows = () => fdPv1.rows.map(x => ({ profileId: x.profileId, date: x.date, metrics: x.metrics }));
  r = await api(coach, 'POST', '/api/devices/forcedecks/commit', { rows: fdCommitRows() });
  check('commit files the matched rows and counts the unmatched one as skipped',
    r.status === 200 && r.json.filed === 2 && r.json.skipped === 1 && r.json.results === 10, r.json);
  r = await api(coach, 'GET', '/api/results?profileId=' + danaD);
  const danaFd1 = r.json.results.filter(x => x.testKey.startsWith('fd_'));
  check('dana has the 5 forcedecks results on a single device test day',
    danaFd1.length === 5 && new Set(danaFd1.map(x => x.testDayId)).size === 1, danaFd1);
  r = await api(coach, 'GET', '/api/test-days');
  const fdDay1 = r.json.testDays.find(d => d.id === (danaFd1[0] || {}).testDayId);
  check('the device test day is titled with the device name',
    !!fdDay1 && fdDay1.title === 'ForceDecks — 2026-10-20' && fdDay1.date === '2026-10-20', fdDay1);
  r = await api(coach, 'GET', '/api/tests');
  const fdJumpTest = r.json.tests.find(t => t.key === 'fd_jump_height_cm');
  check('device metrics became device-labeled custom tests (unit in the name)',
    !!fdJumpTest && fdJumpTest.name === 'ForceDecks · Jump Height (cm)' && fdJumpTest.custom === true,
    fdJumpTest);
  check('the unrecognized column became its own labeled test',
    r.json.tests.some(t => t.key === 'fd_mystery_score' && t.name === 'ForceDecks · Mystery Score'),
    r.json.tests.filter(t => t.key.startsWith('fd_')).map(t => t.key));
  r = await api(coach, 'GET', '/api/devices/forcedecks/summary');
  check('forcedecks summary lists the import day with athlete + result counts',
    r.status === 200 && r.json.days.length === 1 && r.json.days[0].date === '2026-10-20' &&
    r.json.days[0].athletes === 2 && r.json.days[0].results === 10, r.json);

  /* Idempotency: the same file committed again overwrites in place. */
  const danaResCount = (await api(coach, 'GET', '/api/results?profileId=' + danaD)).json.results.length;
  const fdDayCount = (await api(coach, 'GET', '/api/test-days')).json.testDays
    .filter(d => d.title.startsWith('ForceDecks')).length;
  r = await api(coach, 'POST', '/api/devices/forcedecks/commit', { rows: fdCommitRows() });
  check('re-committing the same file still reports the rows filed',
    r.status === 200 && r.json.filed === 2 && r.json.skipped === 1, r.json);
  r = await api(coach, 'GET', '/api/results?profileId=' + danaD);
  check('re-commit overwrites results instead of duplicating them',
    r.json.results.length === danaResCount, r.json.results.length);
  r = await api(coach, 'GET', '/api/test-days');
  check('re-commit reuses the same device + date test day',
    r.json.testDays.filter(d => d.title.startsWith('ForceDecks')).length === fdDayCount,
    r.json.testDays.filter(d => d.title.startsWith('ForceDecks')).length);

  /* AMS after import 1: asymmetry flag on, no drop-off yet, strip on. */
  r = await api(coach, 'GET', '/api/ams/athlete/' + danaD);
  check('ams flags: a latest-session asymmetry over 10 flags',
    r.json.flags.some(f => f.key === 'forcedecks-asymmetry' && f.count === 13), r.json.flags);
  check('ams flags: a first-ever session can never flag a jump drop-off',
    !r.json.flags.some(f => f.key === 'jump-dropoff'), r.json.flags);
  check('ams devices strip shows the forcedecks session with its metrics',
    !!r.json.devices.forcedecks && r.json.devices.forcedecks.date === '2026-10-20' &&
    r.json.devices.forcedecks.metrics.some(m => m.name === 'ForceDecks · Jump Height (cm)' && m.value === 38.2),
    r.json.devices);
  check('ams testing history carries the device-labeled tests',
    r.json.testing.some(t => t.name === 'ForceDecks · Jump Height (cm)' && t.latest === 38.2),
    r.json.testing.map(t => t.name));
  r = await api(coach, 'GET', '/api/ams/athlete/' + evanD);
  check('ams flags: evan (asymmetry 4.0, one jump session) has no device flags',
    !r.json.flags.some(f => ['forcedecks-asymmetry', 'jump-dropoff', 'nordbord-imbalance'].includes(f.key)),
    r.json.flags);

  /* ForceDecks import 2: Dana's jump drops >10% from her prior best. */
  const fdCsv2 = [
    'Athlete,Test Date,Jump Height (cm),Peak Force (N),L/R Asymmetry (%)',
    'Dana Device,11/3/2026,33.5,2050,4.0',
  ].join('\n');
  r = await api(coach, 'POST', '/api/devices/forcedecks/preview', { csv: fdCsv2 });
  const fdPv2 = r.json;
  check('second preview: the Test Date synonym works and the date normalizes',
    r.status === 200 && fdPv2.rows.length === 1 && fdPv2.rows[0].date === '2026-11-03' &&
    fdPv2.rows[0].profileId === danaD, fdPv2);
  r = await api(coach, 'POST', '/api/devices/forcedecks/commit',
    { rows: fdPv2.rows.map(x => ({ profileId: x.profileId, date: x.date, metrics: x.metrics })) });
  check('second import files', r.status === 200 && r.json.filed === 1 && r.json.skipped === 0, r.json);
  r = await api(coach, 'GET', '/api/ams/athlete/' + danaD);
  check('ams flags: a jump >10% under the best prior session flags a drop-off',
    r.json.flags.some(f => f.key === 'jump-dropoff' && f.count === 12), r.json.flags);
  check('ams flags: asymmetry reads off the latest session only (4.0 now — flag cleared)',
    !r.json.flags.some(f => f.key === 'forcedecks-asymmetry'), r.json.flags);
  check('ams devices strip moves to the latest forcedecks session',
    r.json.devices.forcedecks.date === '2026-11-03', r.json.devices.forcedecks);

  /* Manual mapping: Zed's unmatched row, committed to Fay by hand. */
  const zedCsv = ['Athlete,Date,Jump Height (cm)', 'Zed Stranger,10/22/2026,31.0'].join('\n');
  r = await api(coach, 'POST', '/api/devices/forcedecks/preview', { csv: zedCsv });
  const zedPv = r.json;
  check('manual-map fixture previews unmatched',
    r.status === 200 && zedPv.rows.length === 1 && zedPv.rows[0].matchStatus === 'unmatched', zedPv);
  r = await api(coach, 'POST', '/api/devices/forcedecks/commit',
    { rows: [{ profileId: fayD, date: zedPv.rows[0].date, metrics: zedPv.rows[0].metrics }] });
  check('a coach-mapped row files to the chosen athlete',
    r.status === 200 && r.json.filed === 1 && r.json.skipped === 0, r.json);
  r = await api(coach, 'GET', '/api/results?profileId=' + fayD);
  check('the mapped result is on fay\'s record',
    r.json.results.some(x => x.testKey === 'fd_jump_height_cm' && x.value === 31), r.json.results);

  /* Commit hygiene: unusable rows are counted as skipped, not filed. */
  r = await api(coach, 'POST', '/api/devices/forcedecks/commit', {
    rows: [
      { profileId: 'no-such-athlete', date: '2026-10-20', metrics: { 'Jump Height (cm)': 30 } },
      { profileId: null, date: '2026-10-20', metrics: { 'Jump Height (cm)': 30 } },
      { profileId: danaD, date: 'not a date', metrics: { 'Jump Height (cm)': 30 } },
      { profileId: danaD, date: '2026-10-20', metrics: {} },
    ],
  });
  check('commit counts every unusable row as skipped and files none',
    r.status === 200 && r.json.filed === 0 && r.json.skipped === 4, r.json);

  /* NordBord: a "Last, First" quoted name, L/R max force pairs. */
  const nbCsv = [
    'Name,Date,Max Force Left (N),Max Force Right (N),Impulse (Ns)',
    '"Device, Evan",2026-10-21,300,260,1520',
    'Fay Device,10/21/2026,300,290,1490',
  ].join('\n');
  r = await api(coach, 'POST', '/api/devices/nordbord/preview', { csv: nbCsv });
  const nbPv = r.json;
  check('nordbord preview: a "Last, First" name form still matches exactly',
    r.status === 200 && nbPv.rows.length === 2 &&
    nbPv.rows[0].profileId === evanD && nbPv.rows[1].profileId === fayD, nbPv);
  r = await api(coach, 'POST', '/api/devices/nordbord/commit',
    { rows: nbPv.rows.map(x => ({ profileId: x.profileId, date: x.date, metrics: x.metrics })) });
  check('nordbord commit files both athletes (3 metrics each)',
    r.status === 200 && r.json.filed === 2 && r.json.skipped === 0 && r.json.results === 6, r.json);
  r = await api(coach, 'GET', '/api/devices/nordbord/summary');
  check('nordbord summary lists its day with counts',
    r.status === 200 && r.json.days.length === 1 && r.json.days[0].athletes === 2 &&
    r.json.days[0].results === 6, r.json);
  r = await api(coach, 'GET', '/api/ams/athlete/' + evanD);
  check('ams flags: nordbord L/R more than 10% apart flags an imbalance',
    r.json.flags.some(f => f.key === 'nordbord-imbalance' && f.count === 13), r.json.flags);
  check('ams devices strip shows the nordbord session with its L/R pair',
    !!r.json.devices.nordbord && r.json.devices.nordbord.date === '2026-10-21' &&
    r.json.devices.nordbord.left === 300 && r.json.devices.nordbord.right === 260, r.json.devices);
  check('ams testing history carries the nordbord tests',
    r.json.testing.some(t => t.name === 'NordBord · Max Force Left (N)' && t.latest === 300),
    r.json.testing.map(t => t.name));
  r = await api(coach, 'GET', '/api/ams/athlete/' + fayD);
  check('ams flags: a 3% nordbord difference stays under the imbalance threshold',
    !r.json.flags.some(f => f.key === 'nordbord-imbalance'), r.json.flags);
  r = await api(coach, 'GET', '/api/ams/roster');
  const rosterDana = r.json.athletes.find(a => a.profile.id === danaD);
  const rosterEvan = r.json.athletes.find(a => a.profile.id === evanD);
  check('ams roster carries the device flags alongside the others',
    !!rosterDana && rosterDana.flags.some(f => f.key === 'jump-dropoff') &&
    !!rosterEvan && rosterEvan.flags.some(f => f.key === 'nordbord-imbalance'),
    r.json.athletes.length);
  r = await api(coach, 'GET', '/api/ams/athlete/' + caraR);
  check('ams devices strip is empty for an athlete with no device data',
    r.status === 200 && (!r.json.devices || Object.keys(r.json.devices).length === 0), r.json.devices);

  /* T-APEX quick entry: validation, filing, listing, delete. */
  r = await api(coach, 'POST', '/api/devices/tapex/entry',
    { profileId: danaD, date: '2026-10-22', load: 20, peakSpeed: 8.4, maxForce: 950, distance: 30 });
  check('tapex quick entry files all four metrics',
    r.status === 201 && r.json.filed === 1 && r.json.results === 4, r.json);
  r = await api(coach, 'GET', '/api/results?profileId=' + danaD);
  const danaTa = r.json.results.filter(x => x.testKey.startsWith('ta_'));
  check('tapex results carry the four labeled tests',
    danaTa.length === 4 &&
    danaTa.some(x => x.testKey === 'ta_peak_speed_m_s' && x.value === 8.4) &&
    danaTa.some(x => x.testKey === 'ta_load_kg' && x.value === 20), danaTa);
  r = await api(coach, 'GET', '/api/tests');
  check('tapex custom tests are labeled with their units',
    r.json.tests.some(t => t.key === 'ta_load_kg' && t.name === 'T-APEX · Load (kg)') &&
    r.json.tests.some(t => t.key === 'ta_max_force_n' && t.name === 'T-APEX · Max Force (N)') &&
    r.json.tests.some(t => t.key === 'ta_distance_m' && t.name === 'T-APEX · Distance (m)'),
    r.json.tests.filter(t => t.key.startsWith('ta_')).map(t => t.name));
  r = await api(coach, 'POST', '/api/devices/tapex/entry', { profileId: danaD, date: '2026-10-22' });
  check('tapex entry with no numbers is 400', r.status === 400, r.json);
  r = await api(coach, 'POST', '/api/devices/tapex/entry',
    { profileId: 'nobody', date: '2026-10-22', load: 10 });
  check('tapex entry for a missing athlete is 404', r.status === 404, r.status);
  r = await api(coach, 'POST', '/api/devices/tapex/entry',
    { profileId: danaD, date: '10/22/2026', load: 10 });
  check('tapex entry requires an ISO date', r.status === 400, r.status);
  r = await api(coach, 'POST', '/api/devices/tapex/entry',
    { profileId: danaD, date: '2026-10-22', load: -5 });
  check('tapex entry rejects a negative number', r.status === 400, r.json);
  r = await api(coach, 'POST', '/api/devices/tapex/entry',
    { profileId: evanD, date: '2026-10-22', peakSpeed: 9.1 });
  check('tapex entry allows a single metric', r.status === 201 && r.json.results === 1, r.json);
  r = await api(coach, 'GET', '/api/devices/tapex/entries');
  const taDana = r.json.entries.find(e => e.profileId === danaD && e.date === '2026-10-22');
  const taEvan = r.json.entries.find(e => e.profileId === evanD && e.date === '2026-10-22');
  check('tapex entries list groups values per athlete + day, with result ids',
    !!taDana && taDana.values.load === 20 && taDana.values.peakSpeed === 8.4 &&
    taDana.values.maxForce === 950 && taDana.values.distance === 30 &&
    taDana.resultIds.length === 4 &&
    !!taEvan && taEvan.values.peakSpeed === 9.1 && taEvan.values.load === undefined,
    r.json.entries);
  for (const id of (taEvan || { resultIds: [] }).resultIds) {
    r = await api(coach, 'DELETE', '/api/results/' + id);
  }
  check('tapex entry deletes through the existing result delete path', r.status === 200, r.status);
  r = await api(coach, 'GET', '/api/devices/tapex/entries');
  check('the deleted entry leaves the recent list (the other stays)',
    !r.json.entries.some(e => e.profileId === evanD) &&
    r.json.entries.some(e => e.profileId === danaD), r.json.entries);

  /* T-APEX file import: same two-step path as the VALD devices. */
  const taCsv = [
    'Athlete,Session Date,Load (kg),Peak Speed (m/s)',
    'Dana Device,2026-10-23,25,8.9',
  ].join('\n');
  r = await api(coach, 'POST', '/api/devices/tapex/preview', { csv: taCsv });
  const taPv = r.json;
  check('tapex file preview uses the Session Date synonym',
    r.status === 200 && taPv.rows.length === 1 && taPv.rows[0].date === '2026-10-23' &&
    taPv.rows[0].profileId === danaD, taPv);
  r = await api(coach, 'POST', '/api/devices/tapex/commit',
    { rows: taPv.rows.map(x => ({ profileId: x.profileId, date: x.date, metrics: x.metrics })) });
  check('tapex file commit files onto the tapex day',
    r.status === 200 && r.json.filed === 1 && r.json.results === 2, r.json);
  r = await api(coach, 'GET', '/api/ams/athlete/' + danaD);
  check('ams devices strip shows the latest tapex session',
    !!r.json.devices.tapex && r.json.devices.tapex.date === '2026-10-23' &&
    r.json.devices.tapex.metrics.some(m => m.name === 'T-APEX · Peak Speed (m/s)' && m.value === 8.9),
    r.json.devices);

  /* ---------------- member workout logs (Build B) ----------------
     This product's members log their own training — the deliberate
     opposite of the school app. Logs belong to roster profiles and
     are written only from the linked account; coaches read them in
     AMS (roster Last log + the profile page's Member logs card),
     can delete one for moderation, and can never create or edit
     one. Fixtures are a dedicated squad; every window runs off the
     server's own today (reportToday):
       Logan — logs today, -1, -3, -6, -7, -10 (counts + CRUD).
       Lena  — one log 8 days ago ("gone quiet" flag), then one at
               -6 (inside the window: the flag clears).
       Lou   — linked, never logs (never flagged, Last log null).
       Nina  — registered but NOT linked (every write is 403). */
  check('member logs slots are in the served page',
    pageHtml.text.includes('id="memberlog-slot"') && pageHtml.text.includes('id="member-logs-slot"'));
  check('member logs wiring is in the served JS',
    appJs.text.includes('renderMemberLogs') && appJs.text.includes('/api/my/logs') &&
    appJs.text.includes('Log this workout') && appJs.text.includes('data-ams-log-del') &&
    appJs.text.includes('memberLogPrefillForAssignment'));
  {
    const mlTvStart = appJs.text.indexOf('TV BOARD');
    const mlTvEnd = appJs.text.indexOf('/* ---------------- boot', mlTvStart);
    const mlTvCode = appJs.text.slice(mlTvStart, mlTvEnd);
    check('TV render path has no member-log references',
      mlTvStart >= 0 && mlTvEnd > mlTvStart && !mlTvCode.includes('memberLog') &&
      !mlTvCode.includes('/api/my/logs'), mlTvCode.length);
  }

  /* The runner handoff, evaluated from the shipped pure section:
     dedupe by exercise name, session code from the plan title, a
     custom workout never masquerading as a coded session. */
  const mlMatch = appJs.text.match(/\/\* MEMBER-LOG-RUNNER-BEGIN \*\/([\s\S]*?)\/\* MEMBER-LOG-RUNNER-END \*\//);
  check('member-log runner section is in the shipped JS', !!mlMatch);
  if (mlMatch) {
    const mlc = new Function(mlMatch[1] +
      '\nreturn { memberLogEntriesFromSteps, memberLogFromRunner };')();
    const rSteps = [
      { type: 'exercise', name: 'Back Squat', reps: '3x5' },
      { type: 'rest', seconds: 90 },
      { type: 'exercise', name: 'Back Squat', reps: '3x5' },
      { type: 'exercise', name: 'Bench Press', reps: '' },
    ];
    const rEntries = mlc.memberLogEntriesFromSteps(rSteps);
    check('runner log entries dedupe by exercise name, first reps wins, rests skipped',
      rEntries.length === 2 && rEntries[0].exercise === 'Back Squat' && rEntries[0].detail === '3x5' &&
      rEntries[1].exercise === 'Bench Press' && rEntries[1].detail === '', rEntries);
    const rPayload = mlc.memberLogFromRunner(
      { title: 'ACC-01 · Block starts and short drives' }, rSteps, 47 * 60000 + 20000, reportToday);
    check('runner handoff payload: a done log with session code, title, elapsed minutes',
      rPayload.date === reportToday && rPayload.sessionCode === 'ACC-01' &&
      rPayload.title === 'ACC-01 · Block starts and short drives' && rPayload.status === 'done' &&
      rPayload.durationMin === 47 && rPayload.entries.length === 2, rPayload);
    const cwPayload = mlc.memberLogFromRunner({ title: 'My Custom Workout' }, rSteps, 600000, reportToday);
    check('runner handoff for a custom workout carries no session code',
      cwPayload.sessionCode === '' && cwPayload.title === 'My Custom Workout' && cwPayload.durationMin === 10,
      cwPayload);
  }

  /* Fixtures: squad, accounts, links. */
  r = await api(coach, 'POST', '/api/groups', { name: 'Log Squad' });
  const logGroup = r.json.group;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Logan', lastName: 'Logs', groupId: logGroup.id, events: ['sprinter'] });
  const loganP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Lena', lastName: 'Logs', groupId: logGroup.id, events: ['sprinter'] });
  const lenaP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Lou', lastName: 'Logs', groupId: logGroup.id, events: [] });
  const louP = r.json.profile;
  r = await api(coach, 'POST', '/api/profiles', { firstName: 'Nina', lastName: 'Logs', groupId: logGroup.id, events: [] });
  const ninaP = r.json.profile;
  for (const em of ['logan@test.com', 'lena@test.com', 'lou@test.com', 'nina@test.com']) {
    await api(coach, 'POST', '/api/client-invites', { email: em });
  }
  const regMember = async (em) => cookieOf(await api(null, 'POST', '/api/register', { email: em, password: 'testpass123' }));
  const logan = await regMember('logan@test.com');
  const lena = await regMember('lena@test.com');
  const lou = await regMember('lou@test.com');
  const nina = await regMember('nina@test.com');
  await api(coach, 'PUT', '/api/profiles/' + loganP.id + '/link', { email: 'logan@test.com' });
  await api(coach, 'PUT', '/api/profiles/' + lenaP.id + '/link', { email: 'lena@test.com' });
  await api(coach, 'PUT', '/api/profiles/' + louP.id + '/link', { email: 'lou@test.com' });
  check('member-log fixtures: three members linked, Nina deliberately not',
    !!loganP.id && !!lenaP.id && !!louP.id && !!ninaP.id);

  /* Auth + the unlinked wall. */
  r = await api(null, 'GET', '/api/my/logs');
  check('member logs without login are 401', r.status === 401, r.status);
  r = await api(null, 'POST', '/api/my/logs', { title: 'X' });
  check('member log create without login is 401', r.status === 401, r.status);
  r = await api(nina, 'GET', '/api/my/logs');
  check('unlinked member reads an empty, unlinked log state',
    r.status === 200 && r.json.linked === false && r.json.logs.length === 0 && r.json.weekCount === 0, r.json);
  r = await api(nina, 'POST', '/api/my/logs', { title: 'Should not save' });
  check('unlinked member cannot create a log (403, notLinked)',
    r.status === 403 && r.json.notLinked === true, r.json);
  r = await api(nina, 'PUT', '/api/my/logs/anything', { title: 'X' });
  check('unlinked member cannot edit a log', r.status === 403, r.status);
  r = await api(nina, 'DELETE', '/api/my/logs/anything');
  check('unlinked member cannot delete a log', r.status === 403, r.status);
  r = await api(coach, 'POST', '/api/my/logs', { title: 'Coach-written log' });
  check('a coach cannot create a member log (the record is the member\'s own)',
    r.status === 403 && r.json.notLinked === true, r.json);
  r = await api(lou, 'GET', '/api/my/logs');
  check('linked member with no logs reads a clean empty state',
    r.status === 200 && r.json.linked === true && r.json.logs.length === 0 &&
    r.json.weekCount === 0 && r.json.lastLogDate === null, r.json);

  /* Today's assignment prefill: a coach override on the squad's
     group resolves through the same assignment path as everywhere. */
  r = await api(coach, 'POST', '/api/assignments/override',
    { groupId: logGroup.id, date: reportToday, sessionId: 'ACC-01' });
  check('member-log fixture: override sets today\'s session for the squad', r.status === 200, r.status);
  r = await api(logan, 'GET', '/api/my/logs');
  check('today assignment prefill carries the session code + name',
    !!r.json.todayAssignment && r.json.todayAssignment.sessionCode === 'ACC-01' &&
    r.json.todayAssignment.title === 'ACC-01 · Block starts and short drives', r.json.todayAssignment);

  /* Create: a bare session code borrows the library session's name. */
  r = await api(logan, 'POST', '/api/my/logs', { sessionCode: 'ACC-01' });
  check('member log create is 201 with the session name as its title',
    r.status === 201 && r.json.log.athleteId === loganP.id && r.json.log.date === reportToday &&
    r.json.log.sessionCode === 'ACC-01' && r.json.log.title === 'ACC-01 · Block starts and short drives' &&
    r.json.log.status === 'done' && r.json.log.rpe === null && r.json.log.entries.length === 0, r.json.log);

  /* Validation: clean 400s, nothing half-saved. */
  const badLogs = [
    [{ title: 'X', status: 'skipped' }, 'unknown status'],
    [{ title: 'X', rpe: 0 }, 'rpe below range'],
    [{ title: 'X', rpe: 11 }, 'rpe above range'],
    [{ title: 'X', rpe: 5.5 }, 'rpe not whole'],
    [{ title: 'X', durationMin: 0 }, 'duration below range'],
    [{ title: 'X', durationMin: 601 }, 'duration above range'],
    [{ title: 'X', date: addDays(reportToday, 1) }, 'future date'],
    [{ title: 'X', date: addDays(reportToday, -31) }, 'date over 30 days back'],
    [{ title: 'X', date: '2026-02-30' }, 'impossible date'],
    [{}, 'no title and no session code'],
    [{ title: 'X', entries: 'nope' }, 'entries not a list'],
    [{ title: 'X', note: 'x'.repeat(501) }, 'note over 500 chars'],
  ];
  for (const [body, label] of badLogs) {
    r = await api(logan, 'POST', '/api/my/logs', body);
    check('member log validation 400: ' + label, r.status === 400, r.status);
  }
  r = await api(logan, 'POST', '/api/my/logs', { title: 'Blank rows', entries: [{ exercise: '  ', detail: 'x' }, { exercise: 'Pogo Hops', detail: '3x20' }] });
  check('a blank exercise row is dropped, the named row is kept',
    r.status === 201 && r.json.log.entries.length === 1 && r.json.log.entries[0].exercise === 'Pogo Hops', r.json.log);
  const blankRowLogId = r.json.log.id;
  r = await api(logan, 'DELETE', '/api/my/logs/' + blankRowLogId);
  check('member deletes their own log', r.status === 200, r.status);
  r = await api(logan, 'DELETE', '/api/my/logs/' + blankRowLogId);
  check('deleting the same log twice is 404', r.status === 404, r.status);
  r = await api(logan, 'GET', '/api/my/logs');
  check('failed validations saved nothing (only the ACC-01 log stands)',
    r.status === 200 && r.json.logs.length === 1, r.json.logs.length);

  /* Counts: five more logs at known offsets; the week window is
     the Mon–Sun week containing today, computed here with the
     same rule so the expectation is exact on any weekday. */
  const mondayOfT = (s) => { let d = s; while (new Date(d + 'T12:00:00').getDay() !== 1) d = addDays(d, -1); return d; };
  const logOffs = [-1, -3, -6, -7, -10];
  for (const off of logOffs) {
    r = await api(logan, 'POST', '/api/my/logs', { date: addDays(reportToday, off), title: 'Session ' + off, status: 'done' });
    check('member-log counts fixture saves at offset ' + off, r.status === 201, r.status);
  }
  const allOffs = [0, ...logOffs];
  const monT = mondayOfT(reportToday);
  const expectedWeek = allOffs.filter(o => { const d = addDays(reportToday, o); return d >= monT && d <= addDays(monT, 6); }).length;
  r = await api(logan, 'GET', '/api/my/logs');
  check('member logs list: all six logs, newest first',
    r.status === 200 && r.json.logs.length === 6 && r.json.logs[0].date === reportToday &&
    r.json.logs[5].date === addDays(reportToday, -10), r.json.logs.map(l => l.date));
  check('member week count matches the Mon-Sun window exactly',
    r.json.weekCount === expectedWeek, { weekCount: r.json.weekCount, expectedWeek });
  check('member last log date is today', r.json.lastLogDate === reportToday, r.json.lastLogDate);
  r = await api(coach, 'GET', '/api/ams/athlete/' + loganP.id);
  check('ams page member logs: totals, last-7 count (today, -1, -3, -6), last date',
    r.status === 200 && r.json.memberLogs.total === 6 && r.json.memberLogs.last7Count === 4 &&
    r.json.memberLogs.lastLogDate === reportToday && r.json.memberLogs.recent.length === 6 &&
    r.json.memberLogs.recent[0].date === reportToday, r.json.memberLogs);
  r = await api(coach, 'GET', '/api/ams/roster');
  const logRow = (pid) => (r.json.athletes || []).find(a => a.profile.id === pid);
  check('ams roster: Logan last log is today, Lou has none yet',
    !!logRow(loganP.id) && logRow(loganP.id).lastLogDate === reportToday &&
    !!logRow(louP.id) && logRow(louP.id).lastLogDate === null,
    { logan: logRow(loganP.id) && logRow(loganP.id).lastLogDate, lou: logRow(louP.id) && logRow(louP.id).lastLogDate });
  check('ams flags: neither the active logger nor the never-logger earns No logs this week',
    !logRow(loganP.id).flags.some(f => f.key === 'no-logs') &&
    !logRow(louP.id).flags.some(f => f.key === 'no-logs'),
    { logan: logRow(loganP.id).flags.map(f => f.key), lou: logRow(louP.id).flags.map(f => f.key) });

  /* CRUD + isolation: Lena cannot touch Logan's log — it does not
     exist from where she stands. */
  r = await api(logan, 'POST', '/api/my/logs', {
    date: yDay, title: 'Edit me', status: 'partial', rpe: 7, durationMin: 45,
    entries: [{ exercise: 'Back Squat', detail: '3x5 @ 185' }], note: 'Felt strong',
  });
  check('member log full create round-trips every field',
    r.status === 201 && r.json.log.status === 'partial' && r.json.log.rpe === 7 &&
    r.json.log.durationMin === 45 && r.json.log.entries.length === 1 &&
    r.json.log.entries[0].detail === '3x5 @ 185' && r.json.log.note === 'Felt strong', r.json.log);
  const editLogId = r.json.log.id;
  r = await api(lena, 'PUT', '/api/my/logs/' + editLogId, { title: 'Hijacked' });
  check('another member editing Logan\'s log is 404 (invisible, not forbidden)', r.status === 404, r.status);
  r = await api(lena, 'DELETE', '/api/my/logs/' + editLogId);
  check('another member deleting Logan\'s log is 404', r.status === 404, r.status);
  r = await api(lena, 'GET', '/api/my/logs');
  check('Lena\'s own list holds none of Logan\'s logs',
    r.status === 200 && r.json.logs.length === 0, r.json.logs.length);
  r = await api(logan, 'PUT', '/api/my/logs/' + editLogId, {
    date: yDay, title: 'Edited title', status: 'done', rpe: 8, durationMin: 50,
    entries: [{ exercise: 'Back Squat', detail: '4x5 @ 185' }], note: '',
  });
  check('member edits their own log',
    r.status === 200 && r.json.log.title === 'Edited title' && r.json.log.status === 'done' &&
    r.json.log.rpe === 8 && r.json.log.durationMin === 50 && r.json.log.entries[0].detail === '4x5 @ 185', r.json.log);
  r = await api(logan, 'PUT', '/api/my/logs/' + editLogId, { title: 'Edited title', rpe: 99 });
  check('a bad edit is 400', r.status === 400, r.status);
  r = await api(logan, 'GET', '/api/my/logs');
  check('the bad edit changed nothing',
    (r.json.logs.find(l => l.id === editLogId) || {}).rpe === 8, r.json.logs.length);
  r = await api(logan, 'DELETE', '/api/my/logs/' + editLogId);
  check('member deletes the edited log', r.status === 200, r.status);
  r = await api(logan, 'GET', '/api/my/logs');
  check('the deleted log is gone from the member list',
    !r.json.logs.some(l => l.id === editLogId) && r.json.logs.length === 6, r.json.logs.length);

  /* A log is training data: words about soreness in a note never
     file a health concern (that flow is the check-in's alone). */
  r = await api(coach, 'GET', '/api/concerns');
  const loganConcernsBefore = r.json.concerns.filter(c => c.profileId === loganP.id).length;
  r = await api(logan, 'POST', '/api/my/logs', { title: 'Sore day', note: 'Hamstring felt tight the whole session' });
  check('a log with a pain-flavored note still saves as a log', r.status === 201, r.status);
  const soreLogId = r.json.log.id;
  r = await api(coach, 'GET', '/api/concerns');
  check('logging a workout files NO health concern',
    r.json.concerns.filter(c => c.profileId === loganP.id).length === loganConcernsBefore,
    r.json.concerns.filter(c => c.profileId === loganP.id).length);
  r = await api(logan, 'DELETE', '/api/my/logs/' + soreLogId);
  check('cleanup: the sore-day log is deleted again', r.status === 200, r.status);

  /* Gone quiet: Lena logged 8 days ago and nothing since — flagged.
     Lou never logged — not flagged. A fresh log inside the window
     clears Lena's flag (the -6 edge is inside the last 7 days). */
  r = await api(lena, 'POST', '/api/my/logs', { date: addDays(reportToday, -8), title: 'Last week session' });
  check('lena fixture log (8 days ago) saves', r.status === 201, r.status);
  const lenaOldLogId = r.json.log.id;
  r = await api(coach, 'GET', '/api/ams/athlete/' + lenaP.id);
  check('ams page member logs: Lena totals (1 total, 0 in the last 7 days)',
    r.json.memberLogs.total === 1 && r.json.memberLogs.last7Count === 0 &&
    r.json.memberLogs.lastLogDate === addDays(reportToday, -8), r.json.memberLogs);
  r = await api(coach, 'GET', '/api/ams/roster');
  const lenaRow = (r.json.athletes || []).find(a => a.profile.id === lenaP.id);
  const lenaQuiet = lenaRow && lenaRow.flags.find(f => f.key === 'no-logs');
  check('ams flags: logged before but quiet for 8 days = No logs this week',
    !!lenaQuiet && lenaQuiet.count === 8 && lenaQuiet.detail.includes('no workouts logged in the last 7 days'),
    lenaRow && lenaRow.flags);
  check('ams roster: Lena last log date is 8 days ago',
    !!lenaRow && lenaRow.lastLogDate === addDays(reportToday, -8), lenaRow && lenaRow.lastLogDate);
  r = await api(lena, 'POST', '/api/my/logs', { date: addDays(reportToday, -6), title: 'Back at it' });
  check('lena fixture log (6 days ago, inside the window) saves', r.status === 201, r.status);
  const lenaNewLogId = r.json.log.id;
  r = await api(coach, 'GET', '/api/ams/roster');
  const lenaRow2 = (r.json.athletes || []).find(a => a.profile.id === lenaP.id);
  check('ams flags: a log 6 days ago clears the quiet flag (window edge)',
    !!lenaRow2 && !lenaRow2.flags.some(f => f.key === 'no-logs'), lenaRow2 && lenaRow2.flags);

  /* Coach moderation: delete works, exactly once, on the right
     profile; athletes cannot use the coach path at all. */
  r = await api(lena, 'DELETE', '/api/ams/athlete/' + lenaP.id + '/logs/' + lenaOldLogId);
  check('an athlete cannot use the coach log-delete path', r.status === 403, r.status);
  r = await api(coach, 'DELETE', '/api/ams/athlete/' + loganP.id + '/logs/' + lenaOldLogId);
  check('coach delete under the wrong profile is 404', r.status === 404, r.status);
  r = await api(coach, 'DELETE', '/api/ams/athlete/' + lenaP.id + '/logs/' + lenaOldLogId);
  check('coach deletes a member log for moderation', r.status === 200, r.status);
  r = await api(lena, 'GET', '/api/my/logs');
  check('the moderated log is gone from the member\'s own list',
    r.status === 200 && r.json.logs.length === 1 && r.json.logs[0].id === lenaNewLogId, r.json.logs);
  r = await api(coach, 'DELETE', '/api/ams/athlete/' + lenaP.id + '/logs/' + lenaOldLogId);
  check('moderating the same log twice is 404', r.status === 404, r.status);
  r = await api(coach, 'DELETE', '/api/ams/athlete/nope/logs/' + lenaNewLogId);
  check('coach log delete for an unknown profile is 404', r.status === 404, r.status);

  /* The backup carries member logs (roster data, not login data). */
  const bk2 = JSON.parse((await apiText(coach, '/api/export/backup')).text);
  check('backup carries the member logs with their profile binding',
    Array.isArray(bk2.data.memberLogs) &&
    bk2.data.memberLogs.some(l => l.athleteId === loganP.id && l.title === 'ACC-01 · Block starts and short drives') &&
    bk2.data.memberLogs.some(l => l.id === lenaNewLogId) &&
    !('users' in bk2.data), bk2.data.memberLogs && bk2.data.memberLogs.length);

  return { coach, inventoryId: invBlocks, seedId: seed.id, willCookie: will, willProfileId: willP.id, backup: bkEnv, dataProfileId: dataP.id, deviceProfileId: danaD };
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
    const rAnn = await api(ctx.coach, 'GET', '/api/announcements');
    check('announcements survive a server restart',
      rAnn.status === 200 && rAnn.json.announcements.length === 4 &&
      rAnn.json.announcements.some(a => a.body === 'Team post one') &&
      rAnn.json.announcements.some(a => a.body === 'Now for group B'),
      rAnn.json && rAnn.json.announcements && rAnn.json.announcements.length);
    const rDev = await api(ctx.coach, 'GET', '/api/ams/athlete/' + ctx.deviceProfileId);
    check('device results survive a server restart (AMS strip + flags intact)',
      rDev.status === 200 && !!rDev.json.devices &&
      !!rDev.json.devices.forcedecks && rDev.json.devices.forcedecks.date === '2026-11-03' &&
      !!rDev.json.devices.tapex &&
      rDev.json.flags.some(f => f.key === 'jump-dropoff'),
      rDev.json && rDev.json.devices);
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

    /* Backup round-trip: the main suite's exported backup imports
       into a completely empty store and reproduces the team dataset;
       a restart of that store keeps it (the merge saved once, for
       real). Runs its own server/port/data dir like the seed and
       digest blocks below. */
    {
      const RT_BASE = 'http://127.0.0.1:3220';
      const rtApi = async (cookie, method, p, body) => {
        const headers = {};
        if (cookie) headers.cookie = cookie;
        let data;
        if (body !== undefined) { data = JSON.stringify(body); headers['content-type'] = 'application/json'; }
        const res = await fetch(RT_BASE + p, { method, headers, body: data });
        let json = null;
        try { json = await res.json(); } catch (_) { /* empty/non-json */ }
        let setCookie = [];
        try { setCookie = res.headers.getSetCookie(); } catch (_) {
          const sc = res.headers.get('set-cookie'); if (sc) setCookie = [sc];
        }
        return { status: res.status, json, setCookie };
      };
      const RT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-roundtrip-'));
      let rtLog = '';
      const startRt = () => {
        const c = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
          env: Object.assign({}, process.env, {
            PORT: '3220', DATA_DIR: RT_DIR, SESSION_SECRET: 'roundtrip-secret',
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        c.stdout.on('data', d => { rtLog += d; });
        c.stderr.on('data', d => { rtLog += d; });
        return c;
      };
      const waitRt = async () => {
        for (let i = 0; i < 60; i++) {
          try {
            const res = await fetch(RT_BASE + '/api/content');
            if (res.status === 200) return true;
          } catch (_) { /* not up yet */ }
          await new Promise(r => setTimeout(r, 150));
        }
        return false;
      };
      let rtChild = startRt();
      try {
        check('round-trip server starts on an empty store', await waitRt(), rtLog);
        let sr = await rtApi(null, 'POST', '/api/register', { email: 'rt-coach@test.com', password: 'testpass123' });
        check('round-trip store: first account is the coach', sr.status === 201 && sr.json.role === 'coach', sr.json);
        const rtCoach = cookieOf(sr);
        sr = await rtApi(rtCoach, 'POST', '/api/import/backup', ctx.backup);
        check('round-trip import lands in the empty store',
          sr.status === 200 && sr.json.ok === true &&
          sr.json.counts.profiles.added === ctx.backup.data.profiles.length &&
          sr.json.counts.announcements.added === ctx.backup.data.announcements.length &&
          sr.json.totalAdded > 0, sr.json && sr.json.counts && sr.json.counts.profiles);
        sr = await rtApi(rtCoach, 'GET', '/api/export/backup');
        check('round-trip store reproduces the source dataset',
          sr.status === 200 &&
          sr.json.data.profiles.length === ctx.backup.data.profiles.length &&
          sr.json.data.announcements.length === ctx.backup.data.announcements.length &&
          sr.json.data.schoolRecords.length === ctx.backup.data.schoolRecords.length &&
          Object.keys(sr.json.data.attendance).length === Object.keys(ctx.backup.data.attendance).length &&
          sr.json.data.profiles.some(p => p.id === ctx.dataProfileId),
          sr.json && sr.json.data && sr.json.data.profiles && sr.json.data.profiles.length);
        rtChild.kill('SIGKILL');
        await new Promise(r => setTimeout(r, 300));
        rtChild = startRt();
        check('round-trip server restarts', await waitRt(), rtLog);
        sr = await rtApi(rtCoach, 'GET', '/api/export/backup');
        check('the imported dataset survives a restart of the new store',
          sr.status === 200 &&
          sr.json.data.profiles.length === ctx.backup.data.profiles.length &&
          sr.json.data.announcements.length === ctx.backup.data.announcements.length,
          sr.json && sr.json.data && sr.json.data.profiles && sr.json.data.profiles.length);
      } finally {
        rtChild.kill('SIGKILL');
        fs.rmSync(RT_DIR, { recursive: true, force: true });
      }
    }

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
        sr = await seedApi(seedOwner2, 'POST', '/api/client-invites', { email: 'second@test.com' });
        check('removed seeded email can be invited as a member instead', sr.status === 200, sr.status);
        sr = await seedApi(null, 'POST', '/api/register', { email: 'second@test.com', password: 'testpass123' });
        check('registering a removed seeded invite is athlete (member invite stands)',
          sr.status === 201 && sr.json.role === 'athlete', sr.json);
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
        await dApi(dCoach, 'POST', '/api/client-invites', { email: 'amy@test.com' });
        await dApi(dCoach, 'POST', '/api/client-invites', { email: 'ben@test.com' });
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
        const todayS = dFmt(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })));
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

    /* Team leaderboard: a fresh store with exact fixtures — six
       athletes deep on one test (top-5 truncation), a timed custom
       test and ForceDecks-labeled tests (direction both ways), a
       one-athlete test and event (no board under the >=2 gate),
       meet PRs in a time event and a field event, and school
       records set to an exact match (tags) and a quarter-inch
       near miss (does not). The endpoint is computed, not stored,
       so there is no persistence case to restart for. */
    {
      const LB_BASE = 'http://127.0.0.1:3221';
      const lbApi = async (cookie, method, p, body) => {
        const headers = {};
        if (cookie) headers.cookie = cookie;
        let data;
        if (body !== undefined) { data = JSON.stringify(body); headers['content-type'] = 'application/json'; }
        const res = await fetch(LB_BASE + p, { method, headers, body: data });
        let json = null;
        try { json = await res.json(); } catch (_) { /* empty/non-json */ }
        let setCookie = [];
        try { setCookie = res.headers.getSetCookie(); } catch (_) {
          const sc = res.headers.get('set-cookie'); if (sc) setCookie = [sc];
        }
        return { status: res.status, json, setCookie };
      };
      const lbText = async (p) => {
        const res = await fetch(LB_BASE + p);
        return { status: res.status, text: await res.text() };
      };
      const LB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-leaderboard-'));
      let lbLog = '';
      const lbChild = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
        env: Object.assign({}, process.env, {
          PORT: '3221', DATA_DIR: LB_DIR, SESSION_SECRET: 'leaderboard-secret',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      lbChild.stdout.on('data', d => { lbLog += d; });
      lbChild.stderr.on('data', d => { lbLog += d; });
      const waitLb = async () => {
        for (let i = 0; i < 60; i++) {
          try {
            const res = await fetch(LB_BASE + '/api/content');
            if (res.status === 200) return true;
          } catch (_) { /* not up yet */ }
          await new Promise(r => setTimeout(r, 150));
        }
        return false;
      };
      try {
        check('leaderboard server starts', await waitLb(), lbLog);

        /* Served wiring (the shell is the same files on any store). */
        const lbPage = await lbText('/');
        check('leaderboard view is in the served page',
          lbPage.status === 200 && lbPage.text.includes('id="view-leaderboard"') &&
          lbPage.text.includes('id="leaderboard-main"') && lbPage.text.includes('data-view="leaderboard"'));
        const lbJs = await lbText('/app.js');
        check('leaderboard wiring is in the served JS (nav, sub-nav, render, endpoint)',
          lbJs.status === 200 && lbJs.text.includes('renderLeaderboard') &&
          lbJs.text.includes('/api/leaderboard') && lbJs.text.includes("['leaderboard', 'Leaderboard']") &&
          lbJs.text.includes("leaderboard: 'train'") && lbJs.text.includes('Leaderboards appear once at least two athletes have results.'));
        const lbTvStart = lbJs.text.indexOf('TV BOARD');
        const lbTvEnd = lbJs.text.indexOf('/* ---------------- boot', lbTvStart);
        const lbTvCode = lbTvStart >= 0 && lbTvEnd > lbTvStart ? lbJs.text.slice(lbTvStart, lbTvEnd) : '';
        check('TV board render path stays free of the leaderboard',
          lbTvCode.length > 500 && !lbTvCode.toLowerCase().includes('leaderboard') &&
          !lbTvCode.includes('/api/leaderboard'), lbTvCode.length);

        /* Accounts: the coach, then two athletes linked below. */
        let lr = await lbApi(null, 'POST', '/api/register', { email: 'lcoach@test.com', password: 'testpass123' });
        check('leaderboard store: first account is coach', lr.status === 201 && lr.json.role === 'coach', lr.json);
        const lbCoach = cookieOf(lr);
        await lbApi(lbCoach, 'POST', '/api/client-invites', { email: 'lia@test.com' });
        await lbApi(lbCoach, 'POST', '/api/client-invites', { email: 'max@test.com' });
        lr = await lbApi(null, 'POST', '/api/register', { email: 'lia@test.com', password: 'testpass123' });
        const lbLia = cookieOf(lr);
        lr = await lbApi(null, 'POST', '/api/register', { email: 'max@test.com', password: 'testpass123' });
        const lbMax = cookieOf(lr);

        /* Auth + the empty state + the read-only surface. */
        lr = await lbApi(null, 'GET', '/api/leaderboard');
        check('leaderboard without login is 401', lr.status === 401, lr.status);
        lr = await lbApi(lbCoach, 'GET', '/api/leaderboard');
        check('leaderboard starts empty (no board qualifies yet)',
          lr.status === 200 && Array.isArray(lr.json.testing) && lr.json.testing.length === 0 &&
          Array.isArray(lr.json.meets) && lr.json.meets.length === 0, lr.json);
        lr = await lbApi(lbLia, 'GET', '/api/leaderboard');
        check('leaderboard is 200 for an athlete too', lr.status === 200, lr.status);
        lr = await lbApi(lbLia, 'POST', '/api/leaderboard', {});
        check('leaderboard write attempt by an athlete is 403 (read-only)', lr.status === 403, lr.status);
        lr = await lbApi(lbCoach, 'POST', '/api/leaderboard', {});
        check('leaderboard write attempt by a coach is 404 (no write side at all)', lr.status === 404, lr.status);

        /* Roster fixtures. */
        const mkProfile = async (firstName, lastName) => {
          const pr = await lbApi(lbCoach, 'POST', '/api/profiles', { firstName, lastName, events: ['sprinter'] });
          return pr.json.profile;
        };
        const liaP = await mkProfile('Lia', 'Leader');
        const maxP = await mkProfile('Max', 'Second');
        const pamP = await mkProfile('Pam', 'Third');
        const quinnP = await mkProfile('Quinn', 'Fourth');
        const rajP = await mkProfile('Raj', 'Fifth');
        const sidP = await mkProfile('Sid', 'Sixth');
        const tomP = await mkProfile('Tom', 'Solo');
        check('leaderboard fixtures: seven profiles created',
          [liaP, maxP, pamP, quinnP, rajP, sidP, tomP].every(p => p && p.id));
        await lbApi(lbCoach, 'PUT', '/api/profiles/' + liaP.id + '/link', { email: 'lia@test.com' });
        await lbApi(lbCoach, 'PUT', '/api/profiles/' + maxP.id + '/link', { email: 'max@test.com' });

        /* A timed custom test (unit sec -> lower is better). */
        lr = await lbApi(lbCoach, 'POST', '/api/tests', { name: '30m Sprint', unit: 'sec' });
        check('leaderboard fixtures: timed custom test is lower-better',
          lr.status === 201 && lr.json.test.better === 'lower', lr.json);
        const sprintKey = lr.json.test.key;

        /* Test day A: six deep on vertical jump, three on the
           sprint and the bench, one on pull-ups. */
        lr = await lbApi(lbCoach, 'POST', '/api/test-days', {
          date: '2026-11-02', title: 'Leaderboard Day A',
          testKeys: ['vertical-jump', sprintKey, 'bench-press', 'pull-ups'],
        });
        const lbDayA = lr.json.testDay.id;
        const postResult = (profileId, testDayId, testKey, fields) =>
          lbApi(lbCoach, 'POST', '/api/results', Object.assign({ profileId, testDayId, testKey }, fields));
        const vjA = [[liaP, 28], [maxP, 26], [pamP, 25], [quinnP, 24], [rajP, 23], [sidP, 22]];
        for (const [p, v] of vjA) await postResult(p.id, lbDayA, 'vertical-jump', { value: v });
        await postResult(liaP.id, lbDayA, sprintKey, { value: 4.5 });
        await postResult(maxP.id, lbDayA, sprintKey, { value: 4.2 });
        await postResult(pamP.id, lbDayA, sprintKey, { value: 4.8 });
        await postResult(liaP.id, lbDayA, 'bench-press', { weight: 100, reps: 1 });
        await postResult(maxP.id, lbDayA, 'bench-press', { weight: 150 });
        await postResult(tomP.id, lbDayA, 'pull-ups', { value: 12 });

        /* Test day B: a later, weaker jump for Lia (her best stays
           on day A) and a better one for Max (his best moves). */
        lr = await lbApi(lbCoach, 'POST', '/api/test-days', {
          date: '2026-12-01', title: 'Leaderboard Day B', testKeys: ['vertical-jump'],
        });
        const lbDayB = lr.json.testDay.id;
        await postResult(liaP.id, lbDayB, 'vertical-jump', { value: 27 });
        await postResult(maxP.id, lbDayB, 'vertical-jump', { value: 26.5 });

        /* Device-labeled tests, filed the real way (ForceDecks
           commit): jump height reads higher-better, the asymmetry
           metric lower-better, two athletes deep. */
        lr = await lbApi(lbCoach, 'POST', '/api/devices/forcedecks/commit', {
          rows: [
            { profileId: liaP.id, date: '2026-11-05', metrics: { 'Jump Height (cm)': 55, 'Asymmetry (%)': 12 } },
            { profileId: maxP.id, date: '2026-11-05', metrics: { 'Jump Height (cm)': 60, 'Asymmetry (%)': 8 } },
          ],
        });
        check('leaderboard fixtures: forcedecks commit files both rows',
          lr.status === 200 && lr.json.filed === 2 && lr.json.results === 4, lr.json);

        /* Meet results: a time event, a field event, and a
           one-athlete event that must not produce a board. */
        const postMeet = (profileId, date, meet, event, mark) =>
          lbApi(lbCoach, 'POST', '/api/meet-results', { profileId, date, meet, event, mark });
        await postMeet(liaP.id, '2026-11-20', 'Early Bird', '100m', '11.30');
        await postMeet(liaP.id, '2026-12-05', 'Opener', '100m', '10.90');
        await postMeet(maxP.id, '2026-12-05', 'Opener', '100m', '11.20');
        await postMeet(pamP.id, '2026-12-05', 'Opener', '100m', '11.50');
        await postMeet(maxP.id, '2026-12-05', 'Opener', 'long-jump', '21-06');
        await postMeet(liaP.id, '2026-12-05', 'Opener', 'long-jump', '20-00');
        await postMeet(tomP.id, '2026-12-05', 'Opener', 'long-jump', '19-00');
        await postMeet(liaP.id, '2026-12-05', 'Opener', '400m', '55.00');

        /* School records: an EXACT match for the 100m leader
           (tags) and a quarter-inch near miss in the long jump
           (must not tag). */
        lr = await lbApi(lbCoach, 'POST', '/api/records', { event: '100m', name: 'Past Cadet', mark: '10.90', year: 2001, meet: 'States' });
        check('leaderboard fixtures: 100m record posts', lr.status === 201, lr.status);
        lr = await lbApi(lbCoach, 'POST', '/api/records', { event: 'long-jump', name: 'Past Cadet', mark: '21-06.5', year: 1999, meet: 'States' });
        check('leaderboard fixtures: long jump record posts', lr.status === 201, lr.status);

        /* --- the boards --- */
        lr = await lbApi(lbCoach, 'GET', '/api/leaderboard');
        check('leaderboard computes for the coach', lr.status === 200, lr.status);
        const lb = lr.json;
        const tBoard = (key) => lb.testing.find(b => b.testKey === key);
        const mBoard = (key) => lb.meets.find(b => b.event === key);

        check('testing boards come in canonical test order (defaults, then customs in creation order)',
          JSON.stringify(lb.testing.map(b => b.name)) ===
          JSON.stringify(['Bench Press', 'Vertical Jump', '30m Sprint', 'ForceDecks · Jump Height (cm)', 'ForceDecks · Asymmetry (%)']),
          lb.testing.map(b => b.name));
        check('meet boards come in canonical event order',
          JSON.stringify(lb.meets.map(b => b.event)) === JSON.stringify(['100m', 'long-jump']),
          lb.meets.map(b => b.event));

        const vj = tBoard('vertical-jump');
        check('vertical jump board: top 5 of 6 athletes, best marks ranked high-to-low',
          !!vj && vj.leaders.length === 5 &&
          vj.leaders.map(e => e.name).join('|') === 'Lia Leader|Max Second|Pam Third|Quinn Fourth|Raj Fifth' &&
          vj.leaders.map(e => e.value).join('|') === '28|26.5|25|24|23' &&
          vj.leaders.map(e => e.rank).join('|') === '1|2|3|4|5',
          vj && vj.leaders);
        check('vertical jump board: the 6th athlete is truncated off',
          !!vj && !vj.leaders.some(e => e.profileId === sidP.id), vj && vj.leaders.map(e => e.name));
        check('best-mark selection: Lia keeps her day-A best (28) over a later 27, with day A\'s date',
          !!vj && vj.leaders[0].profileId === liaP.id && vj.leaders[0].value === 28 &&
          vj.leaders[0].testDayDate === '2026-11-02', vj && vj.leaders[0]);
        check('best-mark selection: Max\'s best moves to day B (26.5) with day B\'s date',
          !!vj && vj.leaders[1].profileId === maxP.id && vj.leaders[1].value === 26.5 &&
          vj.leaders[1].testDayDate === '2026-12-01', vj && vj.leaders[1]);

        const sprint = tBoard(sprintKey);
        check('timed custom test ranks lower-is-better (4.2 beats 4.5 beats 4.8)',
          !!sprint && sprint.better === 'lower' &&
          sprint.leaders.map(e => e.name).join('|') === 'Max Second|Lia Leader|Pam Third' &&
          sprint.leaders.map(e => e.value).join('|') === '4.2|4.5|4.8',
          sprint && sprint.leaders);
        const bench = tBoard('bench-press');
        check('lift board ranks by the shared display value (est. 1RM: 150 over 103)',
          !!bench && bench.leaders.length === 2 &&
          bench.leaders[0].profileId === maxP.id && bench.leaders[0].value === 150 &&
          bench.leaders[1].profileId === liaP.id && bench.leaders[1].value === 103,
          bench && bench.leaders);
        const fdJump = lb.testing.find(b => b.name === 'ForceDecks · Jump Height (cm)');
        check('device test board: ForceDecks jump height ranks higher-is-better',
          !!fdJump && fdJump.leaders.length === 2 &&
          fdJump.leaders[0].profileId === maxP.id && fdJump.leaders[0].value === 60 &&
          fdJump.leaders[0].testDayDate === '2026-11-05' &&
          fdJump.leaders[1].profileId === liaP.id && fdJump.leaders[1].value === 55,
          fdJump && fdJump.leaders);
        const fdAsym = lb.testing.find(b => b.name === 'ForceDecks · Asymmetry (%)');
        check('device test board: ForceDecks asymmetry ranks lower-is-better',
          !!fdAsym && fdAsym.better === 'lower' && fdAsym.leaders.length === 2 &&
          fdAsym.leaders[0].profileId === maxP.id && fdAsym.leaders[0].value === 8 &&
          fdAsym.leaders[1].profileId === liaP.id && fdAsym.leaders[1].value === 12,
          fdAsym && fdAsym.leaders);
        check('>=2 gate: a one-athlete test (pull-ups) produces no board',
          !tBoard('pull-ups'), lb.testing.map(b => b.testKey));

        const m100 = mBoard('100m');
        check('100m board: PRs ranked low-to-high, PR (not latest) mark with its meet + date',
          !!m100 && m100.leaders.length === 3 &&
          m100.leaders.map(e => e.name).join('|') === 'Lia Leader|Max Second|Pam Third' &&
          m100.leaders[0].mark === '10.90' && m100.leaders[0].meet === 'Opener' &&
          m100.leaders[0].date === '2026-12-05',
          m100 && m100.leaders);
        check('school record tag: the leader whose PR exactly equals the record is tagged',
          !!m100 && m100.leaders[0].schoolRecord === true &&
          m100.leaders[1].schoolRecord === false && m100.leaders[2].schoolRecord === false,
          m100 && m100.leaders);
        const mlj = mBoard('long-jump');
        check('long jump board: field event ranks high-to-low by parsed mark',
          !!mlj && mlj.leaders.length === 3 &&
          mlj.leaders.map(e => e.name).join('|') === 'Max Second|Lia Leader|Tom Solo' &&
          mlj.leaders[0].mark === '21-06' && mlj.leaders[0].value === 258,
          mlj && mlj.leaders);
        check('school record tag: a quarter-inch near miss does NOT tag',
          !!mlj && mlj.leaders.every(e => e.schoolRecord === false),
          mlj && mlj.leaders);
        check('>=2 gate: a one-athlete event (400m) produces no board',
          !mBoard('400m'), lb.meets.map(b => b.event));

        /* Athletes read the same boards (their own profileIds ride
           along — that is what the client highlights as "you"). */
        lr = await lbApi(lbLia, 'GET', '/api/leaderboard');
        check('athlete reads the same boards as the coach',
          lr.status === 200 && lr.json.testing.length === lb.testing.length &&
          lr.json.meets.length === lb.meets.length &&
          lr.json.testing.find(b => b.testKey === 'vertical-jump').leaders[0].profileId === liaP.id,
          lr.json && lr.json.testing.length);
        lr = await lbApi(lbMax, 'GET', '/api/leaderboard');
        check('a second athlete reads the boards too',
          lr.status === 200 && lr.json.meets.find(b => b.event === '100m').leaders.length === 3, lr.status);

        /* Payload purity: performance keys only — no check-in,
           health, attendance, notes, or goals data anywhere. */
        const lbKeys = new Set();
        (function walk(o) {
          if (Array.isArray(o)) { o.forEach(walk); return; }
          if (o && typeof o === 'object') {
            for (const k of Object.keys(o)) { lbKeys.add(k); walk(o[k]); }
          }
        })(lb);
        const forbidden = ['checkins', 'checkin', 'attendance', 'concerns', 'health',
          'notes', 'coachNotes', 'goals', 'sleep', 'soreness', 'energy', 'wellness',
          'email', 'password', 'passHash'];
        check('leaderboard payload carries performance data only (no health/attendance/notes/goals keys)',
          forbidden.every(k => !lbKeys.has(k)), [...lbKeys]);
        check('leaderboard payload leaks no account emails',
          !JSON.stringify(lb).includes('@test.com'), JSON.stringify(lb).slice(0, 120));

        /* Deterministic: a second read returns the identical body. */
        const lbAgain = (await lbApi(lbCoach, 'GET', '/api/leaderboard')).json;
        check('leaderboard order is stable across reads',
          JSON.stringify(lbAgain) === JSON.stringify(lb));
      } finally {
        lbChild.kill('SIGKILL');
        fs.rmSync(LB_DIR, { recursive: true, force: true });
      }
    }

    /* Stripe Checkout endpoint (Build C, endpoint only): inert by
       default — with no STRIPE_SECRET_KEY the endpoint answers 503
       and never calls Stripe; with a key it creates a hosted
       Checkout Session against STRIPE_API_BASE, which here is a
       local stub that captures the exact form body so every
       configured parameter can be asserted. Runs its own
       server/port/data dir plus the stub, like the blocks above. */
    {
      const http = require('http');
      const CO_BASE = 'http://127.0.0.1:3222';
      let stubHits = [];
      const stub = http.createServer((req2, res2) => {
        let raw = '';
        req2.on('data', (d) => { raw += d; });
        req2.on('end', () => {
          stubHits.push({
            method: req2.method, url: req2.url,
            auth: req2.headers.authorization || '',
            type: req2.headers['content-type'] || '',
            params: Object.fromEntries(new URLSearchParams(raw)),
          });
          res2.writeHead(200, { 'content-type': 'application/json' });
          res2.end(JSON.stringify({ id: 'cs_test_stub', url: 'https://checkout.example.test/pay/cs_test_stub' }));
        });
      });
      await new Promise(r => stub.listen(3223, '127.0.0.1', r));
      const CO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-checkout-'));
      const coEnvBase = Object.assign({}, process.env, {
        PORT: '3222', DATA_DIR: CO_DIR, SESSION_SECRET: 'checkout-secret',
      });
      delete coEnvBase.STRIPE_SECRET_KEY;
      delete coEnvBase.STRIPE_PRICE_ID;
      delete coEnvBase.DOMAIN;
      delete coEnvBase.STRIPE_API_BASE;
      let coLog = '';
      const startCo = (extraEnv) => {
        const c = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
          env: Object.assign({}, coEnvBase, extraEnv || {}),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        c.stdout.on('data', d => { coLog += d; });
        c.stderr.on('data', d => { coLog += d; });
        return c;
      };
      const waitCo = async () => {
        for (let i = 0; i < 60; i++) {
          try {
            const res = await fetch(CO_BASE + '/api/content');
            if (res.status === 200) return true;
          } catch (_) { /* not up yet */ }
          await new Promise(r => setTimeout(r, 150));
        }
        return false;
      };
      const coApi = async (method, p, body) => {
        const headers = {};
        let data;
        if (body !== undefined) { data = JSON.stringify(body); headers['content-type'] = 'application/json'; }
        const res = await fetch(CO_BASE + p, { method, headers, body: data });
        let json = null;
        try { json = await res.json(); } catch (_) { /* empty/non-json */ }
        return { status: res.status, json, text: json ? '' : await res.text().catch(() => '') };
      };
      let coChild = startCo();
      try {
        check('checkout server starts (no Stripe key configured)', await waitCo(), coLog);
        let cr = await coApi('POST', '/api/checkout/session', {});
        check('checkout endpoint is inert without STRIPE_SECRET_KEY (503 JSON)',
          cr.status === 503 && !!cr.json && cr.json.error === 'Payments are not configured yet.',
          cr.status + ' ' + JSON.stringify(cr.json));
        check('no Stripe call is attempted while unconfigured', stubHits.length === 0, stubHits.length);
        const coPage = await (await fetch(CO_BASE + '/')).text();
        check('landing page still carries no checkout/stripe wording',
          !coPage.includes('checkout') && !coPage.includes('stripe'));

        coChild.kill('SIGKILL');
        await new Promise(r => setTimeout(r, 300));
        stubHits = [];
        coChild = startCo({
          STRIPE_SECRET_KEY: 'sk_test_stub_key',
          STRIPE_API_BASE: 'http://127.0.0.1:3223',
        });
        check('checkout server restarts with a Stripe key', await waitCo(), coLog);
        cr = await coApi('POST', '/api/checkout/session', {});
        check('checkout endpoint returns the hosted session URL',
          cr.status === 200 && !!cr.json && cr.json.url === 'https://checkout.example.test/pay/cs_test_stub',
          cr.status + ' ' + JSON.stringify(cr.json));
        check('exactly one Stripe API call was made, to the sessions path',
          stubHits.length === 1 && stubHits[0].method === 'POST' && stubHits[0].url === '/v1/checkout/sessions',
          stubHits.map(h => h.method + ' ' + h.url));
        const hp = (stubHits[0] && stubHits[0].params) || {};
        check('the Stripe call carries the bearer key, form-encoded',
          stubHits.length === 1 && stubHits[0].auth === 'Bearer sk_test_stub_key' &&
          stubHits[0].type.includes('application/x-www-form-urlencoded'),
          stubHits[0] && stubHits[0].auth);
        check('checkout params: fixed hosted/subscription values are exact',
          hp.ui_mode === 'hosted_page' && hp.mode === 'subscription' &&
          hp.billing_address_collection === 'auto' &&
          hp['phone_number_collection[enabled]'] === 'false' &&
          hp['automatic_tax[enabled]'] === 'false' &&
          hp.allow_promotion_codes === 'false' &&
          hp.payment_method_collection === 'always' &&
          hp.submit_type === 'auto', hp);
        check('checkout params: Studio identifiers ride as metadata',
          hp['metadata[integration_identifier]'] === 'hosted_web_0001' &&
          hp['metadata[origin_context]'] === 'web', hp);
        check('checkout params: placeholder price, quantity and DOMAIN URLs',
          hp['line_items[0][price]'] === 'price_...' && hp['line_items[0][quantity]'] === '1' &&
          hp.success_url === 'https://example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}' &&
          hp.cancel_url === 'https://example.com/', hp);

        coChild.kill('SIGKILL');
        await new Promise(r => setTimeout(r, 300));
        stubHits = [];
        coChild = startCo({
          STRIPE_SECRET_KEY: 'sk_test_stub_key',
          STRIPE_API_BASE: 'http://127.0.0.1:3223',
          STRIPE_PRICE_ID: 'price_test_123',
          DOMAIN: 'https://ruffin-performance.onrender.com',
        });
        check('checkout server restarts with price + DOMAIN configured', await waitCo(), coLog);
        cr = await coApi('POST', '/api/checkout/session', {});
        const ep = (stubHits[0] && stubHits[0].params) || {};
        check('configured env wins: real price ID and DOMAIN URLs are sent',
          cr.status === 200 && ep['line_items[0][price]'] === 'price_test_123' &&
          ep.success_url === 'https://ruffin-performance.onrender.com/checkout/success?session_id={CHECKOUT_SESSION_ID}' &&
          ep.cancel_url === 'https://ruffin-performance.onrender.com/', ep);
      } finally {
        coChild.kill('SIGKILL');
        stub.close();
        fs.rmSync(CO_DIR, { recursive: true, force: true });
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
