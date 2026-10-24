#!/usr/bin/env node
/*
 * Sprinter Workout App — standalone web app server.
 *
 * Zero external dependencies: only Node's built-in http, fs, path, crypto.
 * Runs anywhere Node runs:  node server.js   (or: npm start)
 *
 * Environment variables:
 *   PORT            Port to listen on            (default 3000)
 *   DATA_DIR        Where user data is stored    (default ./data)
 *   SESSION_SECRET  Secret used to sign login cookies. If not set, a random
 *                   one is generated once and kept in DATA_DIR so logins
 *                   survive restarts.
 *
 * MODEL — coach-input only. Athletes never log in and never enter data.
 * The coach keeps a roster of athlete PROFILES (name, training group,
 * event tags, Top Athlete star) and records everything himself:
 * assignment completions, testing-day results, weekly tracker numbers,
 * and aches & pains concerns. Login accounts exist only for coaches
 * (the first account registered is the coach; a coach can promote other
 * accounts). The per-account practice log and cross-training swaps are
 * the coach's own notebook and work as they always have.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONTENT_DIR = path.join(__dirname, 'content');
const COOKIE_NAME = 'swa_session';
const SESSION_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Session secret                                                      */
/* ------------------------------------------------------------------ */
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const f = path.join(DATA_DIR, '.session-secret');
  try {
    const s = fs.readFileSync(f, 'utf8').trim();
    if (s) return s;
  } catch (_) { /* first run */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

/* ------------------------------------------------------------------ */
/* Tiny JSON file store                                                */
/* ------------------------------------------------------------------ */
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = {
  users: [], logs: {}, swaps: {},
  groups: [], profiles: [], overrides: {}, completions: {},
  customTests: [], testDays: [], testResults: {},
  customWeeklyMetrics: [], weekly: {},
  concerns: {},
  mediaOverrides: {},
};

function migrate() {
  db.users = Array.isArray(db.users) ? db.users : [];
  db.logs = db.logs || {};
  db.swaps = db.swaps || {};
  db.groups = Array.isArray(db.groups) ? db.groups : [];
  db.profiles = Array.isArray(db.profiles) ? db.profiles : [];
  db.overrides = db.overrides || {};
  db.completions = db.completions || {};
  db.customTests = Array.isArray(db.customTests) ? db.customTests : [];
  db.testDays = Array.isArray(db.testDays) ? db.testDays : [];
  db.testResults = db.testResults || {};
  db.customWeeklyMetrics = Array.isArray(db.customWeeklyMetrics) ? db.customWeeklyMetrics : [];
  db.weekly = db.weekly || {};
  db.concerns = db.concerns || {};
  db.mediaOverrides = db.mediaOverrides || {};
  db.users.forEach((u, i) => {
    if (u.role !== 'coach' && u.role !== 'athlete') u.role = i === 0 ? 'coach' : 'athlete';
    if (!db.logs[u.id]) db.logs[u.id] = [];
    if (!db.swaps[u.id]) db.swaps[u.id] = {};
  });
  for (const prof of db.profiles) {
    if (!Array.isArray(prof.events)) prof.events = [];
    if (prof.topAthlete === undefined) prof.topAthlete = false;
    if (prof.archived === undefined) prof.archived = false;
    if (prof.groupId === undefined) prof.groupId = null;
  }
}
function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.users)) db = Object.assign(db, parsed);
  } catch (_) { /* first run: keep the empty store */ }
  migrate();
}
function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
loadDb();

/* ------------------------------------------------------------------ */
/* Passwords (scrypt) and sessions (signed cookie)                     */
/* ------------------------------------------------------------------ */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function checkPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function readSession(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k !== COOKIE_NAME) continue;
    const value = rest.join('=');
    const dot = value.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!data.uid || !data.exp || data.exp < Date.now()) return null;
      return db.users.find(u => u.id === data.uid) || null;
    } catch (_) { return null; }
  }
  return null;
}
function sessionCookie(req, value, maxAgeSeconds) {
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || !!(req.socket && req.socket.encrypted);
  let c = `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  if (isHttps) c += '; Secure';
  return c;
}

/* ------------------------------------------------------------------ */
/* Bundled content (read once at startup)                              */
/* ------------------------------------------------------------------ */
function loadContent() {
  const read = (name) => fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8');
  return {
    sessions: JSON.parse(read('sessions.json')),
    drills: JSON.parse(read('drills.json')),
    weeks: JSON.parse(read('weeks.json')),
    framework400: read('framework400.md'),
    guide: read('guide.md'),
    season: read('season.md'),
  };
}
const CONTENT = loadContent();
const SESSION_BY_ID = new Map(CONTENT.sessions.map(s => [s.id, s]));
const SESSION_IDS = new Set(SESSION_BY_ID.keys());
const XT_IDS = new Set(CONTENT.sessions.filter(s => s.id.startsWith('XT-')).map(s => s.id));

/* ------------------------------------------------------------------ */
/* Preloaded test battery + weekly metrics                             */
/* ------------------------------------------------------------------ */
const DEFAULT_TESTS = [
  { key: 'back-squat', name: 'Back Squat', unit: 'lb', kind: 'lift', custom: false },
  { key: 'trap-bar-deadlift', name: 'Trap Bar Deadlift', unit: 'lb', kind: 'lift', custom: false },
  { key: 'bench-press', name: 'Bench Press', unit: 'lb', kind: 'lift', custom: false },
  { key: 'hang-clean', name: 'Hang Clean', unit: 'lb', kind: 'lift', custom: false },
  { key: 'power-clean', name: 'Power Clean', unit: 'lb', kind: 'lift', custom: false },
  { key: 'vertical-jump', name: 'Vertical Jump', unit: 'in', kind: 'measure', custom: false },
  { key: 'broad-jump', name: 'Broad Jump', unit: 'in', kind: 'measure', custom: false },
  { key: 'pull-ups', name: 'Pull-ups', unit: 'reps', kind: 'reps', custom: false },
];
function allTests() {
  return DEFAULT_TESTS.concat(db.customTests.map(t => Object.assign({}, t, { custom: true })));
}
function findTest(key) { return allTests().find(t => t.key === key) || null; }

const DEFAULT_WEEKLY_METRICS = [
  { key: 'fly-30m', name: 'Fly 30m time', unit: 'sec', better: 'lower', custom: false },
  { key: 'vertical-jump', name: 'Vertical Jump', unit: 'in', better: 'higher', custom: false },
  { key: 'broad-jump', name: 'Broad Jump', unit: 'in', better: 'higher', custom: false },
  { key: 'back-squat-1rm', name: 'Back Squat est. 1RM', unit: 'lb', better: 'higher', custom: false },
  { key: 'hang-clean-1rm', name: 'Hang Clean est. 1RM', unit: 'lb', better: 'higher', custom: false },
  { key: 'bench-press-1rm', name: 'Bench Press est. 1RM', unit: 'lb', better: 'higher', custom: false },
  { key: 'body-weight', name: 'Body Weight', unit: 'lb', better: 'neutral', custom: false },
];
function allWeeklyMetrics() {
  return DEFAULT_WEEKLY_METRICS.concat(db.customWeeklyMetrics.map(m => Object.assign({}, m, { custom: true })));
}
function findWeeklyMetric(key) { return allWeeklyMetrics().find(m => m.key === key) || null; }

/* Epley estimate: weight x (1 + reps/30), rounded to the nearest pound. */
function epley(weight, reps) { return Math.round(weight * (1 + reps / 30)); }
function displayValue(result) {
  if (result.est1rm != null) return result.est1rm;
  return result.value;
}

/* ------------------------------------------------------------------ */
/* Movement demo media: optional base file + coach overrides           */
/* ------------------------------------------------------------------ */
function loadMediaBase() {
  try {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, 'movement_media.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_) { /* no base media file yet — that is fine */ }
  return {};
}
const MEDIA_BASE = loadMediaBase();
function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v') || '';
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
      }
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch (_) { /* not a URL */ }
  return null;
}
function mediaEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') return null;
  const url = raw.url.trim();
  const yid = youtubeId(url);
  if (yid) return { type: 'youtube', url, embedUrl: 'https://www.youtube.com/embed/' + yid, title: clean(raw.title, 120) };
  if (/^https?:\/\//i.test(url) && /\.gif($|\?)/i.test(url)) {
    return { type: 'gif', url, embedUrl: url, title: clean(raw.title, 120) };
  }
  if (raw.type === 'gif' && /^https?:\/\//i.test(url)) {
    return { type: 'gif', url, embedUrl: url, title: clean(raw.title, 120) };
  }
  return null;
}
function mergedMedia() {
  const out = {};
  for (const [id, raw] of Object.entries(MEDIA_BASE)) {
    const e = mediaEntry(raw);
    if (e) out[id] = Object.assign({}, e, { source: 'base' });
  }
  for (const [id, raw] of Object.entries(db.mediaOverrides)) {
    if (raw === null) { delete out[id]; continue; }
    const e = mediaEntry(raw);
    if (e) out[id] = Object.assign({}, e, { source: 'coach' });
  }
  return out;
}

const CONCERN_AREAS = ['ankle', 'achilles', 'calf', 'shin', 'knee', 'hamstring', 'quad', 'hip-flexor', 'hip', 'groin', 'glute', 'lower-back', 'foot', 'shoulder', 'other'];
const CONCERN_FEELINGS = ['ache', 'sharp', 'tightness', 'soreness', 'stiffness', 'swelling', 'other'];
const EVENT_TAGS = ['sprinter', 'jumper', 'hurdler'];

/* ------------------------------------------------------------------ */
/* Dates + season plan resolution                                      */
/* ------------------------------------------------------------------ */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function parseDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function dateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function todayStr() { return dateStr(new Date()); }
function mondayOf(dateString) {
  const d = parseDateStr(dateString);
  if (!d) return null;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dateStr(d);
}
function isMonday(dateString) {
  const d = parseDateStr(dateString);
  return !!d && d.getDay() === 1;
}
/* Plan cell for a date: the week containing it, clamped to the season
   edges (before Week 1 you see Week 1's matching weekday, and so on). */
function planDayFor(dateString) {
  const d = parseDateStr(dateString);
  if (!d) return null;
  const weeks = CONTENT.weeks;
  let wk = weeks.find(w => dateString >= w.start && dateString <= w.end);
  if (!wk) wk = dateString < weeks[0].start ? weeks[0] : weeks[weeks.length - 1];
  const dayKey = DAY_KEYS[(d.getDay() + 6) % 7];
  const text = String(wk[dayKey] || '').trim();
  const codes = text.match(/[A-Z]{2,3}-\d{2}/g) || [];
  const isMeet = /\bMEET\b|championships/i.test(text);
  const isTest = /\bTEST\b/i.test(text);
  const isOff = !codes.length && !isMeet && !isTest && /off/i.test(text);
  const anyHigh = codes.some(c => { const s = SESSION_BY_ID.get(c); return s && s.cns_demand === 'high'; });
  const isHigh = !isOff && (anyHigh || isTest || isMeet);
  let warmup = null;
  if (!isOff) warmup = isMeet ? 'WUP-02' : (isHigh ? 'WUP-01' : 'WUP-03');
  return { week: wk.week, phase: wk.phase, dayKey, planText: text, codes, sessionId: codes[0] || null, isOff, isHigh, isMeet, isTest, warmup };
}
function groupById(id) { return db.groups.find(g => g.id === id) || null; }
function groupByName(name) {
  const n = String(name || '').trim().toLowerCase();
  return db.groups.find(g => g.name.toLowerCase() === n) || null;
}
function profileById(id) { return db.profiles.find(pr => pr.id === id) || null; }
function publicProfile(pr) {
  const g = pr.groupId ? groupById(pr.groupId) : null;
  return {
    id: pr.id, firstName: pr.firstName, lastName: pr.lastName,
    name: (pr.firstName + ' ' + pr.lastName).trim(),
    groupId: pr.groupId || null, groupName: g ? g.name : null,
    events: pr.events || [], topAthlete: !!pr.topAthlete, archived: !!pr.archived,
  };
}
function publicUser(u) { return { id: u.id, email: u.email, role: u.role }; }
/* An assignment = coach override if one exists, else the plan default. */
function resolveAssignment(groupId, dateString) {
  const ov = db.overrides[groupId + '|' + dateString];
  const plan = planDayFor(dateString);
  if (ov) {
    const s = SESSION_BY_ID.get(ov.sessionId);
    return {
      date: dateString, source: 'override', sessionId: ov.sessionId,
      sessionName: s ? s.name : ov.sessionId, note: ov.note || '',
      planText: plan ? plan.planText : '', warmup: plan ? plan.warmup : null,
      cns: s ? s.cns_demand : null,
    };
  }
  if (!plan) return { date: dateString, source: 'plan', sessionId: null, sessionName: '', note: '', planText: '', warmup: null, cns: null };
  const s = plan.sessionId ? SESSION_BY_ID.get(plan.sessionId) : null;
  return {
    date: dateString, source: 'plan', sessionId: plan.sessionId,
    sessionName: s ? s.name : '', note: '', planText: plan.planText,
    warmup: plan.warmup, cns: s ? s.cns_demand : null, isOff: plan.isOff,
  };
}
function completionFor(profileId, dateString) {
  return db.completions[profileId + '|' + dateString] || null;
}
function weeklySeriesFor(profileId, metric) {
  const byWeek = (db.weekly[profileId] || {})[metric.key] || {};
  const points = Object.keys(byWeek).sort().map(week => ({ week, value: byWeek[week] }));
  let best = null;
  if (points.length && metric.better !== 'neutral') {
    best = points.reduce((acc, pt) => {
      if (acc === null) return pt.value;
      return metric.better === 'lower' ? Math.min(acc, pt.value) : Math.max(acc, pt.value);
    }, null);
  }
  const first = points.length ? points[0].value : null;
  const latest = points.length ? points[points.length - 1].value : null;
  const delta = points.length > 1 ? Math.round((latest - first) * 100) / 100 : null;
  let improved = null;
  if (delta !== null && delta !== 0 && metric.better !== 'neutral') {
    improved = metric.better === 'lower' ? delta < 0 : delta > 0;
  }
  return { points, best, first, latest, delta, improved };
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */
function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }, extraHeaders || {}));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
function readTextBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 512 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const cleanEvents = (v) => {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const e of v) {
    const t = String(e || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 6);
};

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/api/content' && req.method === 'GET') {
    return sendJson(res, 200, CONTENT);
  }

  if (p === '/api/register' && req.method === 'POST') {
    const body = await readBody(req);
    const email = clean(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    }
    if (password.length < 8) {
      return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
    }
    if (db.users.some(u => u.email === email)) {
      return sendJson(res, 409, { error: 'An account with that email already exists. Try logging in.' });
    }
    const user = {
      id: crypto.randomUUID(),
      email,
      passHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      role: db.users.length === 0 ? 'coach' : 'athlete',
    };
    db.users.push(user);
    db.logs[user.id] = [];
    db.swaps[user.id] = {};
    saveDb();
    return sendJson(res, 201, publicUser(user),
      { 'Set-Cookie': sessionCookie(req, signSession(user.id), SESSION_DAYS * 24 * 3600) });
  }

  if (p === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = clean(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const user = db.users.find(u => u.email === email);
    if (!user || !checkPassword(password, user.passHash)) {
      return sendJson(res, 401, { error: 'Email or password did not match.' });
    }
    return sendJson(res, 200, publicUser(user),
      { 'Set-Cookie': sessionCookie(req, signSession(user.id), SESSION_DAYS * 24 * 3600) });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true },
      { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (p === '/api/me' && req.method === 'GET') {
    const me = readSession(req);
    if (!me) return sendJson(res, 401, { error: 'not logged in' });
    return sendJson(res, 200, publicUser(me));
  }

  /* Everything below requires a login. */
  const user = readSession(req);
  if (!user) return sendJson(res, 401, { error: 'Please log in first.' });

  /* ---------- the coach's own practice log (unchanged) ---------- */
  if (p === '/api/logs' && req.method === 'GET') {
    const entries = (db.logs[user.id] || []).slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return sendJson(res, 200, { entries });
  }

  if (p === '/api/logs' && req.method === 'POST') {
    const body = await readBody(req);
    const date = clean(body.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    }
    const sessionId = clean(body.sessionId, 20);
    if (sessionId && !SESSION_IDS.has(sessionId)) {
      return sendJson(res, 400, { error: 'Unknown session code.' });
    }
    let feel = parseInt(body.feel, 10);
    if (Number.isNaN(feel) || feel < 1 || feel > 5) feel = null;
    const entry = {
      id: crypto.randomUUID(),
      date,
      sessionId,
      group: clean(body.group, 120),
      happened: clean(body.happened, 1000),
      marks: clean(body.marks, 500),
      feel,
      notes: clean(body.notes, 1000),
      createdAt: new Date().toISOString(),
    };
    db.logs[user.id] = db.logs[user.id] || [];
    db.logs[user.id].push(entry);
    saveDb();
    return sendJson(res, 201, { entry });
  }

  if (p.startsWith('/api/logs/') && req.method === 'DELETE') {
    const id = decodeURIComponent(p.slice('/api/logs/'.length));
    const list = db.logs[user.id] || [];
    const next = list.filter(e => e.id !== id);
    if (next.length === list.length) return sendJson(res, 404, { error: 'Entry not found.' });
    db.logs[user.id] = next;
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- cross-training swaps (unchanged) ---------- */
  if (p === '/api/swaps' && req.method === 'GET') {
    return sendJson(res, 200, { swaps: db.swaps[user.id] || {} });
  }

  if (p === '/api/swaps' && req.method === 'PUT') {
    const body = await readBody(req);
    const week = parseInt(body.week, 10);
    const day = clean(body.day, 4).toLowerCase();
    const xt = body.xt === null || body.xt === '' ? null : clean(body.xt, 20);
    if (!week || week < 1 || week > 29) return sendJson(res, 400, { error: 'Week must be 1-29.' });
    if (!['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(day)) {
      return sendJson(res, 400, { error: 'Bad day.' });
    }
    if (xt !== null && !XT_IDS.has(xt)) {
      return sendJson(res, 400, { error: 'Swap target must be a cross-training (XT) session.' });
    }
    db.swaps[user.id] = db.swaps[user.id] || {};
    const key = week + ':' + day;
    if (xt === null) delete db.swaps[user.id][key];
    else db.swaps[user.id][key] = xt;
    saveDb();
    return sendJson(res, 200, { swaps: db.swaps[user.id] });
  }

  /* ================================================================ */
  /* TEAM DATA — coaches only from here. Athlete-role accounts and    */
  /* anyone else get a 403 on every endpoint below.                   */
  /* ================================================================ */
  if (user.role !== 'coach') {
    return sendJson(res, 403, { error: 'Coaches only. Athletes do not use this system — the coach records everything.' });
  }
  const coachOnly = () => sendJson(res, 403, { error: 'Coaches only.' });

  /* ---------- coach accounts ---------- */
  if (p === '/api/coaches' && req.method === 'GET') {
    return sendJson(res, 200, { users: db.users.map(publicUser) });
  }
  const userRoleMatch = p.match(/^\/api\/users\/([^/]+)\/role$/);
  if (userRoleMatch && req.method === 'PUT') {
    const target = db.users.find(u => u.id === decodeURIComponent(userRoleMatch[1]));
    if (!target) return sendJson(res, 404, { error: 'User not found.' });
    const body = await readBody(req);
    if (body.role !== 'coach' && body.role !== 'athlete') {
      return sendJson(res, 400, { error: 'Role must be coach or athlete.' });
    }
    target.role = body.role;
    saveDb();
    return sendJson(res, 200, { user: publicUser(target) });
  }

  /* ---------- groups ---------- */
  if (p === '/api/groups' && req.method === 'GET') {
    return sendJson(res, 200, { groups: db.groups.map(g => ({ id: g.id, name: g.name })) });
  }
  if (p === '/api/groups' && req.method === 'POST') {
    const body = await readBody(req);
    const name = clean(body.name, 60);
    if (!name) return sendJson(res, 400, { error: 'Group needs a name.' });
    if (groupByName(name)) return sendJson(res, 409, { error: 'A group with that name already exists.' });
    const group = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
    db.groups.push(group);
    saveDb();
    return sendJson(res, 201, { group: { id: group.id, name: group.name } });
  }
  const groupMatch = p.match(/^\/api\/groups\/([^/]+)$/);
  if (groupMatch && req.method === 'PUT') {
    const g = groupById(decodeURIComponent(groupMatch[1]));
    if (!g) return sendJson(res, 404, { error: 'Group not found.' });
    const body = await readBody(req);
    const name = clean(body.name, 60);
    if (!name) return sendJson(res, 400, { error: 'Group needs a name.' });
    g.name = name;
    saveDb();
    return sendJson(res, 200, { group: { id: g.id, name: g.name } });
  }
  if (groupMatch && req.method === 'DELETE') {
    const gid = decodeURIComponent(groupMatch[1]);
    if (!groupById(gid)) return sendJson(res, 404, { error: 'Group not found.' });
    db.groups = db.groups.filter(x => x.id !== gid);
    for (const pr of db.profiles) if (pr.groupId === gid) pr.groupId = null;
    for (const k of Object.keys(db.overrides)) if (k.startsWith(gid + '|')) delete db.overrides[k];
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- athlete profiles ---------- */
  if (p === '/api/profiles' && req.method === 'GET') {
    let list = db.profiles.slice();
    if (q.get('includeArchived') !== '1') list = list.filter(pr => !pr.archived);
    const gf = clean(q.get('groupId') || '', 80);
    if (gf) list = list.filter(pr => pr.groupId === gf);
    const ev = clean(q.get('event') || '', 30).toLowerCase();
    if (ev) list = list.filter(pr => (pr.events || []).includes(ev));
    if (q.get('top') === '1') list = list.filter(pr => pr.topAthlete);
    const text = clean(q.get('q') || '', 60).toLowerCase();
    if (text) list = list.filter(pr => (pr.firstName + ' ' + pr.lastName).toLowerCase().includes(text));
    list.sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
    return sendJson(res, 200, { profiles: list.map(publicProfile) });
  }
  if (p === '/api/profiles' && req.method === 'POST') {
    const body = await readBody(req);
    const firstName = clean(body.firstName, 40);
    const lastName = clean(body.lastName, 40);
    if (!firstName || !lastName) return sendJson(res, 400, { error: 'A profile needs a first and last name.' });
    const gid = body.groupId ? clean(body.groupId, 80) : null;
    if (gid && !groupById(gid)) return sendJson(res, 400, { error: 'Unknown group.' });
    const prof = {
      id: crypto.randomUUID(), firstName, lastName,
      groupId: gid, events: cleanEvents(body.events),
      topAthlete: !!body.topAthlete, archived: false,
      createdAt: new Date().toISOString(),
    };
    db.profiles.push(prof);
    saveDb();
    return sendJson(res, 201, { profile: publicProfile(prof) });
  }
  if (p === '/api/profiles/import' && req.method === 'POST') {
    let text = '';
    const ctype = String(req.headers['content-type'] || '');
    if (ctype.includes('application/json')) {
      const body = await readBody(req);
      text = typeof body.text === 'string' ? body.text : '';
    } else {
      text = await readTextBody(req);
    }
    if (!text.trim()) return sendJson(res, 400, { error: 'Paste the roster lines first.' });
    const parseCsvLine = (line) => {
      const out = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') inQ = false;
          else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const splitName = (namePart) => {
      const toks = String(namePart || '').split(',').map(s => s.trim());
      if (toks.length >= 2 && toks[0] && toks[1]) return { lastName: toks[0], firstName: toks.slice(1).join(' ') };
      const words = String(namePart || '').trim().split(/\s+/).filter(Boolean);
      if (words.length >= 2) return { firstName: words[0], lastName: words.slice(1).join(' ') };
      return { firstName: '', lastName: '' };
    };
    const report = { created: 0, groupsCreated: 0, skipped: [], errors: [] };
    const seenInImport = new Set();
    let csvMode = false;
    text.split(/\r?\n/).forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!line) return;
      let namePart = '', groupName = '', eventsPart = '', topPart = '';
      if (line.includes('|')) {
        const parts = line.split('|').map(s => s.trim());
        if (parts.length < 2) {
          report.errors.push({ line: idx + 1, text: line, reason: 'Expected "Last, First | Group | events | Top".' });
          return;
        }
        [namePart, groupName, eventsPart = '', topPart = ''] = parts;
      } else if (/^name\s*,/i.test(line)) {
        csvMode = true;
        return; // header row
      } else if (csvMode) {
        const f = parseCsvLine(line);
        if (f.length < 2) {
          report.errors.push({ line: idx + 1, text: line, reason: 'CSV rows need at least a name and a group.' });
          return;
        }
        [namePart, groupName, eventsPart = '', topPart = ''] = f;
      } else {
        report.errors.push({ line: idx + 1, text: line, reason: 'Use "Last, First | Group | events | Top" per line, or start with a name,group,events,top CSV header.' });
        return;
      }
      const { firstName, lastName } = splitName(namePart);
      if (!firstName || !lastName || !groupName) {
        report.errors.push({ line: idx + 1, text: line, reason: 'Missing a first name, last name, or group.' });
        return;
      }
      let group = groupByName(groupName);
      if (!group) {
        group = { id: crypto.randomUUID(), name: groupName, createdAt: new Date().toISOString() };
        db.groups.push(group);
        report.groupsCreated++;
      }
      const dupeKey = (firstName + '|' + lastName + '|' + group.id).toLowerCase();
      const exists = db.profiles.some(pr =>
        pr.firstName.toLowerCase() === firstName.toLowerCase() &&
        pr.lastName.toLowerCase() === lastName.toLowerCase() &&
        pr.groupId === group.id);
      if (exists || seenInImport.has(dupeKey)) {
        report.skipped.push({ line: idx + 1, text: line, reason: 'Already on the roster in that group — skipped.' });
        return;
      }
      seenInImport.add(dupeKey);
      const events = cleanEvents(String(eventsPart).split(/[,;]/).map(s => s.trim()).filter(Boolean));
      const topAthlete = /^(yes|y|true|top|★|\*)$/i.test(String(topPart || '').trim());
      db.profiles.push({
        id: crypto.randomUUID(), firstName, lastName,
        groupId: group.id, events, topAthlete, archived: false,
        createdAt: new Date().toISOString(),
      });
      report.created++;
    });
    saveDb();
    return sendJson(res, 200, { report });
  }
  const profileMatch = p.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileMatch && req.method === 'PUT') {
    const prof = profileById(decodeURIComponent(profileMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const body = await readBody(req);
    if (body.firstName !== undefined) prof.firstName = clean(body.firstName, 40) || prof.firstName;
    if (body.lastName !== undefined) prof.lastName = clean(body.lastName, 40) || prof.lastName;
    if (body.groupId !== undefined) {
      const gid = body.groupId ? clean(body.groupId, 80) : null;
      if (gid && !groupById(gid)) return sendJson(res, 400, { error: 'Unknown group.' });
      prof.groupId = gid;
    }
    if (body.events !== undefined) prof.events = cleanEvents(body.events);
    if (body.topAthlete !== undefined) prof.topAthlete = !!body.topAthlete;
    if (body.archived !== undefined) prof.archived = !!body.archived;
    saveDb();
    return sendJson(res, 200, { profile: publicProfile(prof) });
  }
  if (profileMatch && req.method === 'DELETE') {
    const prof = profileById(decodeURIComponent(profileMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    prof.archived = true;
    saveDb();
    return sendJson(res, 200, { ok: true, archived: true });
  }
  const profileRecordsMatch = p.match(/^\/api\/profiles\/([^/]+)\/records$/);
  if (profileRecordsMatch && req.method === 'GET') {
    const prof = profileById(decodeURIComponent(profileRecordsMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const completions = Object.values(db.completions)
      .filter(c => c.profileId === prof.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const results = (db.testResults[prof.id] || []).map(r => Object.assign({}, r, { display: displayValue(r) }));
    const concerns = (db.concerns[prof.id] || []).slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return sendJson(res, 200, {
      profile: publicProfile(prof), completions, results,
      weekly: db.weekly[prof.id] || {}, concerns,
    });
  }

  /* ---------- assignments + coach-marked completions ---------- */
  if (p === '/api/assignments/override' && req.method === 'POST') {
    const body = await readBody(req);
    const groupId = clean(body.groupId, 80);
    const date = clean(body.date, 10);
    if (!groupById(groupId)) return sendJson(res, 400, { error: 'Unknown group.' });
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    const key = groupId + '|' + date;
    if (body.sessionId === null || body.sessionId === '') {
      delete db.overrides[key];
      saveDb();
      return sendJson(res, 200, { ok: true, cleared: true, assignment: resolveAssignment(groupId, date) });
    }
    const sessionId = clean(body.sessionId, 20);
    if (!SESSION_IDS.has(sessionId)) return sendJson(res, 400, { error: 'Unknown session code.' });
    db.overrides[key] = { sessionId, note: clean(body.note, 300), by: user.id, at: new Date().toISOString() };
    saveDb();
    return sendJson(res, 200, { ok: true, assignment: resolveAssignment(groupId, date) });
  }

  if (p === '/api/completions' && req.method === 'POST') {
    const body = await readBody(req);
    const prof = profileById(clean(body.profileId, 80));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const date = clean(body.date || todayStr(), 10);
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    const key = prof.id + '|' + date;
    if (body.completed === false) {
      delete db.completions[key];
      saveDb();
      return sendJson(res, 200, { ok: true, removed: true });
    }
    if (!prof.groupId) return sendJson(res, 400, { error: 'That athlete is not in a group, so there is no assignment to complete.' });
    const a = resolveAssignment(prof.groupId, date);
    let feel = parseInt(body.feel, 10);
    if (Number.isNaN(feel) || feel < 1 || feel > 5) feel = null;
    const rec = {
      profileId: prof.id, groupId: prof.groupId, date,
      sessionId: a.sessionId || '',
      marks: clean(body.marks, 500),
      feel,
      notes: clean(body.notes, 1000),
      by: user.id, at: new Date().toISOString(),
    };
    db.completions[key] = rec;
    saveDb();
    return sendJson(res, 200, { ok: true, completion: rec });
  }

  if (p === '/api/coach/feed' && req.method === 'GET') {
    const date = clean(q.get('date') || todayStr(), 10);
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Bad date.' });
    const feedFor = (g) => {
      const members = db.profiles.filter(pr => !pr.archived && (g ? pr.groupId === g.id : !pr.groupId));
      return {
        group: g ? { id: g.id, name: g.name } : null,
        assignment: g ? resolveAssignment(g.id, date) : null,
        members: members.map(pr => {
          const c = completionFor(pr.id, date);
          return {
            profile: publicProfile(pr),
            completed: !!c,
            completion: c ? { sessionId: c.sessionId, marks: c.marks, feel: c.feel, notes: c.notes } : null,
          };
        }),
      };
    };
    return sendJson(res, 200, { date, groups: db.groups.map(feedFor), unassigned: feedFor(null) });
  }

  /* ---------- testing tracker (coach entry only) ---------- */
  if (p === '/api/tests' && req.method === 'GET') {
    return sendJson(res, 200, { tests: allTests() });
  }
  if (p === '/api/tests' && req.method === 'POST') {
    const body = await readBody(req);
    const name = clean(body.name, 60);
    const unit = clean(body.unit, 12);
    if (!name || !unit) return sendJson(res, 400, { error: 'A custom test needs a name and a unit.' });
    let kind = clean(body.kind, 12);
    if (!['lift', 'measure', 'reps'].includes(kind)) kind = unit === 'lb' ? 'lift' : (unit === 'reps' ? 'reps' : 'measure');
    const test = { key: 'custom-' + crypto.randomUUID().slice(0, 8), name, unit, kind };
    db.customTests.push(test);
    saveDb();
    return sendJson(res, 201, { test: Object.assign({}, test, { custom: true }) });
  }

  if (p === '/api/test-days' && req.method === 'GET') {
    const days = db.testDays.slice().sort((a, b) => (a.date < b.date ? 1 : -1))
      .map(d => ({ id: d.id, date: d.date, title: d.title, testKeys: d.testKeys }));
    return sendJson(res, 200, { testDays: days });
  }
  if (p === '/api/test-days' && req.method === 'POST') {
    const body = await readBody(req);
    const date = clean(body.date, 10);
    const title = clean(body.title, 80);
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    if (!title) return sendJson(res, 400, { error: 'Give the test day a title.' });
    const keys = Array.isArray(body.testKeys) ? body.testKeys.map(k => clean(k, 40)).filter(Boolean) : [];
    if (!keys.length) return sendJson(res, 400, { error: 'Pick at least one test.' });
    for (const k of keys) if (!findTest(k)) return sendJson(res, 400, { error: 'Unknown test: ' + k });
    const day = { id: crypto.randomUUID(), date, title, testKeys: [...new Set(keys)], createdAt: new Date().toISOString() };
    db.testDays.push(day);
    saveDb();
    return sendJson(res, 201, { testDay: { id: day.id, date: day.date, title: day.title, testKeys: day.testKeys } });
  }
  const testDayMatch = p.match(/^\/api\/test-days\/([^/]+)$/);
  if (testDayMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(testDayMatch[1]);
    if (!db.testDays.some(d => d.id === id)) return sendJson(res, 404, { error: 'Test day not found.' });
    db.testDays = db.testDays.filter(d => d.id !== id);
    for (const pid of Object.keys(db.testResults)) {
      db.testResults[pid] = db.testResults[pid].filter(r => r.testDayId !== id);
    }
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/results' && req.method === 'POST') {
    const body = await readBody(req);
    const prof = profileById(clean(body.profileId, 80));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const day = db.testDays.find(d => d.id === clean(body.testDayId, 80));
    if (!day) return sendJson(res, 404, { error: 'Test day not found.' });
    const testKey = clean(body.testKey, 40);
    const test = findTest(testKey);
    if (!test) return sendJson(res, 400, { error: 'Unknown test.' });
    if (!day.testKeys.includes(testKey)) {
      return sendJson(res, 400, { error: test.name + ' is not part of that test day.' });
    }
    let value = null, weight = null, reps = null, est1rm = null;
    if (test.kind === 'lift') {
      const w = num(body.weight !== undefined ? body.weight : body.value);
      if (w === null || w <= 0) return sendJson(res, 400, { error: 'Enter a valid weight in lb.' });
      weight = w;
      if (body.reps !== undefined && body.reps !== null && body.reps !== '') {
        const r = num(body.reps);
        if (r === null || !Number.isInteger(r) || r < 1 || r > 30) {
          return sendJson(res, 400, { error: 'Reps must be a whole number from 1 to 30.' });
        }
        reps = r;
        est1rm = epley(w, r);
      } else {
        est1rm = Math.round(w);
      }
    } else {
      const v = num(body.value);
      if (v === null || v < 0) return sendJson(res, 400, { error: 'Enter a valid result.' });
      value = v;
    }
    db.testResults[prof.id] = db.testResults[prof.id] || [];
    const existing = db.testResults[prof.id].find(r => r.testDayId === day.id && r.testKey === testKey);
    const result = existing || { id: crypto.randomUUID(), profileId: prof.id, testDayId: day.id, testKey, createdAt: new Date().toISOString() };
    Object.assign(result, { value, weight, reps, est1rm, enteredBy: user.id, updatedAt: new Date().toISOString() });
    if (!existing) db.testResults[prof.id].push(result);
    saveDb();
    return sendJson(res, existing ? 200 : 201, { result });
  }

  if (p === '/api/results' && req.method === 'GET') {
    const dayParam = clean(q.get('testDayId') || '', 80);
    const profParam = clean(q.get('profileId') || '', 80);
    let results = [];
    const ids = profParam ? [profParam] : db.profiles.map(pr => pr.id);
    for (const pid of ids) {
      results = results.concat((db.testResults[pid] || [])
        .filter(r => !dayParam || r.testDayId === dayParam)
        .map(r => Object.assign({}, r, { display: displayValue(r) })));
    }
    const pbs = {};
    if (profParam) {
      for (const r of db.testResults[profParam] || []) {
        const d = displayValue(r);
        if (d === null) continue;
        if (!pbs[r.testKey] || d > pbs[r.testKey].display) {
          pbs[r.testKey] = { display: d, testDayId: r.testDayId, resultId: r.id };
        }
      }
    }
    return sendJson(res, 200, { results, personalBests: pbs });
  }

  const resultMatch = p.match(/^\/api\/results\/([^/]+)$/);
  if (resultMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(resultMatch[1]);
    for (const pid of Object.keys(db.testResults)) {
      const idx = db.testResults[pid].findIndex(r => r.id === id);
      if (idx >= 0) {
        db.testResults[pid].splice(idx, 1);
        saveDb();
        return sendJson(res, 200, { ok: true });
      }
    }
    return sendJson(res, 404, { error: 'Result not found.' });
  }

  /* ---------- Top Athletes weekly tracker (coach entry only) ---------- */
  if (p === '/api/weekly/metrics' && req.method === 'GET') {
    return sendJson(res, 200, { metrics: allWeeklyMetrics() });
  }
  if (p === '/api/weekly/metrics' && req.method === 'POST') {
    const body = await readBody(req);
    const name = clean(body.name, 60);
    const unit = clean(body.unit, 12);
    const better = clean(body.better, 10);
    if (!name || !unit) return sendJson(res, 400, { error: 'A custom metric needs a name and a unit.' });
    if (!['lower', 'higher', 'neutral'].includes(better)) {
      return sendJson(res, 400, { error: 'Say whether lower, higher, or neither is better.' });
    }
    const metric = { key: 'custom-' + crypto.randomUUID().slice(0, 8), name, unit, better };
    db.customWeeklyMetrics.push(metric);
    saveDb();
    return sendJson(res, 201, { metric: Object.assign({}, metric, { custom: true }) });
  }

  if (p === '/api/weekly/entry' && req.method === 'PUT') {
    const body = await readBody(req);
    const prof = profileById(clean(body.profileId, 80));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const metric = findWeeklyMetric(clean(body.metricId, 40));
    if (!metric) return sendJson(res, 400, { error: 'Unknown metric.' });
    const week = clean(body.week, 10);
    if (!parseDateStr(week) || !isMonday(week)) {
      return sendJson(res, 400, { error: 'Week must be a Monday date (YYYY-MM-DD).' });
    }
    const value = num(body.value);
    if (value === null || value < 0) return sendJson(res, 400, { error: 'Enter a valid number.' });
    db.weekly[prof.id] = db.weekly[prof.id] || {};
    db.weekly[prof.id][metric.key] = db.weekly[prof.id][metric.key] || {};
    db.weekly[prof.id][metric.key][week] = value;
    saveDb();
    return sendJson(res, 200, { ok: true, profileId: prof.id, metricId: metric.key, week, value });
  }

  if (p === '/api/weekly/series' && req.method === 'GET') {
    const prof = profileById(clean(q.get('profileId') || '', 80));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const metric = findWeeklyMetric(clean(q.get('metricId') || '', 40));
    if (!metric) return sendJson(res, 400, { error: 'Unknown metric.' });
    const s = weeklySeriesFor(prof.id, metric);
    return sendJson(res, 200, {
      profileId: prof.id, name: prof.firstName + ' ' + prof.lastName, metric,
      points: s.points, best: s.best, first: s.first, latest: s.latest, delta: s.delta, improved: s.improved,
    });
  }

  if (p === '/api/weekly/overlay' && req.method === 'GET') {
    const metric = findWeeklyMetric(clean(q.get('metricId') || '', 40));
    if (!metric) return sendJson(res, 400, { error: 'Unknown metric.' });
    const athletes = db.profiles.filter(pr => pr.topAthlete && !pr.archived).map(pr => {
      const s = weeklySeriesFor(pr.id, metric);
      return { profileId: pr.id, name: pr.firstName + ' ' + pr.lastName, points: s.points, best: s.best, delta: s.delta, improved: s.improved };
    });
    return sendJson(res, 200, { metric, athletes });
  }

  if (p === '/api/weekly/dashboard' && req.method === 'GET') {
    const tops = db.profiles.filter(pr => pr.topAthlete && !pr.archived).map(publicProfile);
    const entries = {};
    for (const t of tops) entries[t.id] = db.weekly[t.id] || {};
    return sendJson(res, 200, { topAthletes: tops, metrics: allWeeklyMetrics(), entries });
  }

  /* ---------- Aches & pains (coach records what athletes report) ---------- */
  if (p === '/api/concerns' && req.method === 'POST') {
    const body = await readBody(req);
    const prof = profileById(clean(body.profileId, 80));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const area = clean(body.area, 20);
    const side = clean(body.side, 6);
    const feeling = clean(body.feeling, 16);
    const impact = clean(body.impact, 10);
    const started = clean(body.started, 10);
    if (!CONCERN_AREAS.includes(area)) return sendJson(res, 400, { error: 'Pick a body area from the list.' });
    if (!['left', 'right', 'both', 'na'].includes(side)) return sendJson(res, 400, { error: 'Pick a side: left, right, both, or n/a.' });
    if (!CONCERN_FEELINGS.includes(feeling)) return sendJson(res, 400, { error: 'Pick what it feels like from the list.' });
    if (!['none', 'modified', 'stopped'].includes(impact)) return sendJson(res, 400, { error: 'Say whether it affects training.' });
    if (!parseDateStr(started)) return sendJson(res, 400, { error: 'When it started must be a date (YYYY-MM-DD).' });
    const pain = num(body.pain);
    if (pain === null || !Number.isInteger(pain) || pain < 1 || pain > 10) {
      return sendJson(res, 400, { error: 'Pain level must be a whole number from 1 to 10.' });
    }
    const concern = {
      id: crypto.randomUUID(), profileId: prof.id,
      area, side, feeling, pain, started, impact,
      note: clean(body.note, 500),
      status: 'new', coachNote: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    db.concerns[prof.id] = db.concerns[prof.id] || [];
    db.concerns[prof.id].push(concern);
    saveDb();
    return sendJson(res, 201, { concern });
  }

  if (p === '/api/concerns' && req.method === 'GET') {
    // Coach-only list of every concern, severity first, then newest.
    const all = [];
    for (const pr of db.profiles) {
      for (const c of db.concerns[pr.id] || []) {
        all.push(Object.assign({}, c, { athleteName: pr.firstName + ' ' + pr.lastName }));
      }
    }
    const isFlagged = (c) => (c.pain >= 7 || c.impact === 'stopped') && c.status !== 'cleared';
    all.sort((a, b) => {
      const fa = isFlagged(a) ? 0 : 1, fb = isFlagged(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    return sendJson(res, 200, { concerns: all.map(c => Object.assign({}, c, { flagged: isFlagged(c) })) });
  }

  const concernMatch = p.match(/^\/api\/concerns\/([^/]+)$/);
  if (concernMatch && req.method === 'PUT') {
    const id = decodeURIComponent(concernMatch[1]);
    let found = null;
    for (const pid of Object.keys(db.concerns)) {
      found = (db.concerns[pid] || []).find(c => c.id === id) || found;
      if (found) break;
    }
    if (!found) return sendJson(res, 404, { error: 'Concern not found.' });
    const body = await readBody(req);
    if (body.status !== undefined) {
      if (!['new', 'monitoring', 'cleared'].includes(body.status)) {
        return sendJson(res, 400, { error: 'Status must be New, Monitoring, or Cleared.' });
      }
      found.status = body.status;
    }
    if (body.coachNote !== undefined) found.coachNote = clean(body.coachNote, 500);
    if (body.pain !== undefined) {
      const pain = num(body.pain);
      if (pain === null || !Number.isInteger(pain) || pain < 1 || pain > 10) {
        return sendJson(res, 400, { error: 'Pain level must be a whole number from 1 to 10.' });
      }
      found.pain = pain;
    }
    found.updatedAt = new Date().toISOString();
    saveDb();
    return sendJson(res, 200, { concern: found });
  }

  /* ---------- movement demo media (coach-managed) ---------- */
  if (p === '/api/media' && req.method === 'GET') {
    return sendJson(res, 200, { media: mergedMedia() });
  }
  const mediaMatch = p.match(/^\/api\/media\/([^/]+)$/);
  if (mediaMatch && req.method === 'PUT') {
    const movementId = decodeURIComponent(mediaMatch[1]);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(movementId)) {
      return sendJson(res, 400, { error: 'Bad movement id.' });
    }
    const body = await readBody(req);
    const url = clean(body.url, 500);
    const entry = mediaEntry({ url, type: body.type, title: body.title });
    if (!entry) {
      return sendJson(res, 400, { error: 'That link is not a YouTube video or a GIF. Paste a YouTube watch/share link or a direct .gif link.' });
    }
    db.mediaOverrides[movementId] = { type: entry.type, url: entry.url, title: entry.title || '' };
    saveDb();
    return sendJson(res, 200, { ok: true, movementId, media: entry });
  }
  if (mediaMatch && req.method === 'DELETE') {
    const movementId = decodeURIComponent(mediaMatch[1]);
    if (Object.prototype.hasOwnProperty.call(MEDIA_BASE, movementId)) {
      db.mediaOverrides[movementId] = null; // tombstone beats the base file
    } else {
      delete db.mediaOverrides[movementId];
    }
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  void coachOnly;
  return sendJson(res, 404, { error: 'not found' });
}

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: unknown paths get the app shell.
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(() => {
      if (!res.headersSent) sendJson(res, 400, { error: 'Bad request.' });
    });
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log(`Sprinter Workout App running at http://localhost:${PORT}`);
  console.log(`Content loaded: ${CONTENT.sessions.length} sessions, ${CONTENT.drills.length} drills, ${CONTENT.weeks.length} weeks.`);
});
