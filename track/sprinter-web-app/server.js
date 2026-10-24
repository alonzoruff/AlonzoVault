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
 *   COACH_INVITE_EMAILS  Optional comma-separated emails to seed as
 *                   assistant-coach invites at startup (e.g. so a friend
 *                   is invited before the owner has even registered).
 *                   Seeding is idempotent and removal-wins: once an
 *                   email has been seeded it is never re-added, so an
 *                   invite the owner removes in the app stays removed.
 *
 * MODEL — coach-input only. Athletes never log in and never enter data.
 * The coach keeps a roster of athlete PROFILES (name, training group,
 * event tags, Top Athlete star) and records everything himself:
 * assignment completions, testing-day results, weekly tracker numbers,
 * and aches & pains concerns. Login accounts exist only for coaches.
 * The first account registered is the head coach (owner); the owner can
 * invite assistant coaches by email, and an invited email registers
 * with coach access to the same shared team data. Only the owner
 * manages invites, and the owner can never lose coach access. The
 * per-account practice log and cross-training swaps are the coach's
 * own notebook and work as they always have.
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
  inventory: [],
  warmupCardEdits: {},
  coachInvites: [],
  coachInvitesSeeded: [],
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
  db.inventory = Array.isArray(db.inventory) ? db.inventory : [];
  // Coach edits to the warm-up cards: { cardId: { sections: [...] } }.
  // Only cards a coach has actually edited appear here; anything else
  // renders the shipped card from public/index.html.
  db.warmupCardEdits = (db.warmupCardEdits && typeof db.warmupCardEdits === 'object' && !Array.isArray(db.warmupCardEdits))
    ? db.warmupCardEdits : {};
  // Assistant-coach invites: normalized (trimmed, lowercased) emails the
  // owner has granted coach access to. Kept deduped on every load.
  db.coachInvites = Array.isArray(db.coachInvites)
    ? [...new Set(db.coachInvites.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
    : [];
  // Emails already seeded from COACH_INVITE_EMAILS once — the memory
  // that makes env seeding removal-wins (see seedCoachInvitesFromEnv).
  db.coachInvitesSeeded = Array.isArray(db.coachInvitesSeeded)
    ? [...new Set(db.coachInvitesSeeded.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
    : [];
  db.users.forEach((u, i) => {
    if (u.role !== 'coach' && u.role !== 'athlete') u.role = i === 0 ? 'coach' : 'athlete';
    // The first account is the head coach (owner). Stores written
    // before invites existed have no marker — the first user owns it.
    if (u.isOwner === undefined) u.isOwner = i === 0;
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

/* Seed assistant-coach invites from COACH_INVITE_EMAILS (comma-
   separated). Idempotent and removal-wins: an email is merged into
   db.coachInvites only the first time it is ever seeded, and that
   first seeding is remembered in db.coachInvitesSeeded. After that
   the stored invite list is the source of truth — if the owner
   removes a seeded invite in the app, restarts never resurrect it.
   Invoked once below, just before the server starts listening. */
function seedCoachInvitesFromEnv() {
  const raw = process.env.COACH_INVITE_EMAILS || '';
  const emails = [...new Set(raw.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => EMAIL_RE.test(s)))];
  let changed = false;
  for (const email of emails) {
    if (db.coachInvitesSeeded.includes(email)) continue;
    db.coachInvitesSeeded.push(email);
    if (!db.coachInvites.includes(email)) db.coachInvites.push(email);
    changed = true;
  }
  if (changed) saveDb();
}

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
    videoLibrary: loadVideoLibrary(),
    glossary: loadGlossary(),
    coachEducation: loadCoachEducation(),
  };
}
/* The Videos section library (content/video_library.json). Loaded
   tolerantly, like the movement media base: a missing or malformed
   file means an empty library, never a crashed server. */
function loadVideoLibrary() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'video_library.json'), 'utf8'));
    if (Array.isArray(parsed)) {
      return parsed.filter(v => v && typeof v === 'object'
        && typeof v.id === 'string' && typeof v.url === 'string'
        && typeof v.title === 'string' && typeof v.category === 'string');
    }
  } catch (_) { /* no video library bundled — that is fine */ }
  return [];
}
/* The Definitions tab glossary (content/glossary.json). Same tolerant
   loading as the video library: a missing or malformed file means an
   empty glossary, never a crashed server. Entries without a term,
   category, or definition are dropped; the optional cues line is kept
   only when it is a non-empty string. */
function loadGlossary() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'glossary.json'), 'utf8'));
    if (Array.isArray(parsed)) {
      return parsed.filter(e => e && typeof e === 'object'
        && typeof e.term === 'string' && e.term.trim()
        && typeof e.category === 'string' && e.category.trim()
        && typeof e.definition === 'string' && e.definition.trim())
        .map(e => (typeof e.cues === 'string' && e.cues.trim())
          ? e
          : { term: e.term, category: e.category, definition: e.definition });
    }
  } catch (_) { /* no glossary bundled — that is fine */ }
  return [];
}
/* The Coach Education tab list (content/coach_education.json). Same
   tolerant loading as the glossary: a missing or malformed file means
   an empty list, never a crashed server. Entries missing any display
   field are dropped. */
function loadCoachEducation() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'coach_education.json'), 'utf8'));
    if (Array.isArray(parsed)) {
      const fields = ['name', 'provider', 'bucket', 'focus', 'format', 'location', 'url', 'notes'];
      return parsed.filter(e => e && typeof e === 'object'
        && fields.every(f => typeof e[f] === 'string' && e[f].trim()));
    }
  } catch (_) { /* no coach education bundled — that is fine */ }
  return [];
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

/* Equipment inventory: fixed category + condition lists. The coach
   records the program's gear; items live in the JSON store. */
const INVENTORY_CATEGORIES = ['Starting Blocks', 'Hurdles', 'Relay Batons', 'Throws Implements',
  'Timing & Tech', 'Medicine Balls', 'Bands & Mobility', 'Plyo & Training Aids',
  'Cones & Markers', 'Uniforms & Gear', 'First Aid & Medical', 'Other'];
const INVENTORY_CONDITIONS = ['Good', 'Fair', 'Replace'];
/* Shared create/update validation. With partial=true only the fields
   present in the body are checked (and returned); creates require the
   core fields. Returns { fields } or { error }. */
function validateInventory(body, partial) {
  const fields = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('name')) {
    fields.name = clean(body.name, 80);
    if (!fields.name) return { error: 'An inventory item needs a name.' };
  }
  if (!partial || has('category')) {
    fields.category = clean(body.category, 40);
    if (!INVENTORY_CATEGORIES.includes(fields.category)) {
      return { error: 'Pick a category from the list.' };
    }
  }
  if (!partial || has('quantity')) {
    const quantity = num(body.quantity);
    if (quantity === null || !Number.isInteger(quantity) || quantity < 0 || quantity > 100000) {
      return { error: 'Quantity must be a whole number from 0 to 100000.' };
    }
    fields.quantity = quantity;
  }
  if (!partial || has('condition')) {
    fields.condition = clean(body.condition, 10);
    if (!INVENTORY_CONDITIONS.includes(fields.condition)) {
      return { error: 'Condition must be Good, Fair, or Replace.' };
    }
  }
  if (!partial || has('location')) fields.location = clean(body.location, 80);
  if (!partial || has('note')) fields.note = clean(body.note, 500);
  return { fields };
}

/* Warm-up cards: the three cards (Light / Speed Day / Circuit Day)
   ship as fixed HTML in public/index.html — four list sections each.
   Coaches can edit the item lists in the app; a save replaces the
   card's items wholesale and lives here as an override, so future
   content rebuilds never touch it and deleting the override restores
   the shipped card exactly. */
const WARMUP_CARDS = {
  'wu-card-1': { sections: 4 },
  'wu-card-2': { sections: 4 },
  'wu-card-3': { sections: 4 },
};
const WU_MAX_PER_SECTION = 30;
const WU_MAX_PER_CARD = 80;
const WU_NAME_MAX = 80;
const WU_DETAIL_MAX = 240;
/* Validate a card-edit payload: { sections: [ { items: [{name,
   detail}] } ] } with one entry per shipped section. Returns
   { sections } (trimmed, stored shape) or { error }. */
function validateWarmupCardEdits(body, cardId) {
  const meta = WARMUP_CARDS[cardId];
  if (!meta) return { error: 'Unknown warm-up card.' };
  if (!body || !Array.isArray(body.sections) || body.sections.length !== meta.sections) {
    return { error: 'Card edits must cover all ' + meta.sections + ' sections of the card.' };
  }
  let total = 0;
  const sections = [];
  for (const sec of body.sections) {
    if (!sec || !Array.isArray(sec.items)) return { error: 'Each section needs an item list.' };
    if (sec.items.length > WU_MAX_PER_SECTION) {
      return { error: 'Too many items in one section (' + WU_MAX_PER_SECTION + ' max).' };
    }
    const items = [];
    for (const raw of sec.items) {
      if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) {
        return { error: 'Each item needs a name.' };
      }
      if (raw.name.trim().length > WU_NAME_MAX) {
        return { error: 'Item names are capped at ' + WU_NAME_MAX + ' characters.' };
      }
      let detail = '';
      if (raw.detail !== undefined && raw.detail !== null) {
        if (typeof raw.detail !== 'string') return { error: 'Item details must be text.' };
        detail = raw.detail.trim();
        if (detail.length > WU_DETAIL_MAX) {
          return { error: 'Item details are capped at ' + WU_DETAIL_MAX + ' characters.' };
        }
      }
      items.push({ name: raw.name.trim(), detail });
      total++;
    }
    sections.push({ items });
  }
  if (total > WU_MAX_PER_CARD) {
    return { error: 'Too many items on one card (' + WU_MAX_PER_CARD + ' max).' };
  }
  return { sections };
}

/* ------------------------------------------------------------------ */
/* Dates + season plan resolution                                      */
/* ------------------------------------------------------------------ */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function parseDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  const d = new Date(y, mo - 1, da);
  // Date() silently rolls impossible dates over (2026-02-30 becomes
  // Mar 2, month 13 becomes next January). Reject anything that does
  // not round-trip, so bad calendar dates get a clean 400 everywhere.
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d;
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
  if (!weeks.length) return null;
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
function publicUser(u) { return { id: u.id, email: u.email, role: u.role, isOwner: !!u.isOwner }; }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function userByEmail(email) { return db.users.find(u => u.email === email) || null; }
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
/* CSV downloads: quote any cell containing a comma, quote, or newline
   (RFC 4180 — inner quotes are doubled). */
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function sendCsv(res, filename, rows) {
  const body = rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
const numStr = (v) => (v === null || v === undefined ? '' : String(Math.round(v * 100) / 100));
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
      try {
        const parsed = JSON.parse(raw);
        // Bodies like `null`, `42`, or `[1,2]` are valid JSON but not a
        // usable request object — normalize them to {} so handlers answer
        // with their normal field-level 400s instead of throwing.
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch (_) { reject(new Error('bad json')); }
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

  /* Warm-up card edits are public to read (the cards themselves are
     public) — only cards a coach has edited appear here. */
  if (p === '/api/warmup-cards' && req.method === 'GET') {
    return sendJson(res, 200, { cards: db.warmupCardEdits });
  }

  if (p === '/api/register' && req.method === 'POST') {
    const body = await readBody(req);
    const email = clean(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!EMAIL_RE.test(email)) {
      return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    }
    if (password.length < 8) {
      return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
    }
    if (db.users.some(u => u.email === email)) {
      return sendJson(res, 409, { error: 'An account with that email already exists. Try logging in.' });
    }
    const firstAccount = db.users.length === 0;
    const user = {
      id: crypto.randomUUID(),
      email,
      passHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      // First account: head coach (owner). An email the owner invited
      // registers straight into coach access; everyone else is an
      // athlete-role account (no team-data access).
      role: firstAccount || db.coachInvites.includes(email) ? 'coach' : 'athlete',
      isOwner: firstAccount,
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
    if (target.isOwner && body.role !== 'coach') {
      return sendJson(res, 400, { error: 'The head coach account cannot lose coach access.' });
    }
    target.role = body.role;
    saveDb();
    return sendJson(res, 200, { user: publicUser(target) });
  }

  /* ---------- assistant coach invites (owner-managed) ----------
     The invite list is the standing grant of coach access: an invited
     email registers as a coach, and an invited existing account is
     upgraded on the spot. Removing an invite revokes it — a matching
     non-owner account drops back to athlete immediately, because the
     session resolves the user (and role) fresh from the store on
     every request. Only the owner manages invites; other coaches can
     view the list but get a 403 on add/remove. */
  function invitesPayload() {
    return {
      invites: db.coachInvites.slice(),
      coaches: db.users.filter(u => u.role === 'coach').map(publicUser),
    };
  }
  if (p === '/api/coach-invites' && req.method === 'GET') {
    return sendJson(res, 200, invitesPayload());
  }
  if (p === '/api/coach-invites' && req.method === 'POST') {
    if (!user.isOwner) {
      return sendJson(res, 403, { error: 'Only the head coach can invite assistant coaches.' });
    }
    const body = await readBody(req);
    const email = clean(body.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    }
    const existing = userByEmail(email);
    if (existing && existing.isOwner) {
      return sendJson(res, 400, { error: 'That is the head coach\'s own email — it already has coach access.' });
    }
    const alreadyInvited = db.coachInvites.includes(email);
    if (!alreadyInvited) db.coachInvites.push(email);
    let upgraded = false;
    if (existing && existing.role !== 'coach') { existing.role = 'coach'; upgraded = true; }
    saveDb();
    return sendJson(res, 200, Object.assign(
      { ok: true, email, alreadyInvited, upgraded, user: existing ? publicUser(existing) : null },
      invitesPayload()));
  }
  const inviteMatch = p.match(/^\/api\/coach-invites\/(.+)$/);
  if (inviteMatch && req.method === 'DELETE') {
    if (!user.isOwner) {
      return sendJson(res, 403, { error: 'Only the head coach can remove coach access.' });
    }
    const email = decodeURIComponent(inviteMatch[1]).trim().toLowerCase();
    const existing = userByEmail(email);
    if (existing && existing.isOwner) {
      return sendJson(res, 400, { error: 'The head coach cannot be removed.' });
    }
    const removedInvite = db.coachInvites.includes(email);
    if (!removedInvite && !existing) {
      return sendJson(res, 404, { error: 'No invite or account for that email.' });
    }
    db.coachInvites = db.coachInvites.filter(e => e !== email);
    let downgraded = false;
    if (existing && existing.role === 'coach') { existing.role = 'athlete'; downgraded = true; }
    saveDb();
    return sendJson(res, 200, Object.assign(
      { ok: true, email, removedInvite, downgraded }, invitesPayload()));
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
    const clash = groupByName(name);
    if (clash && clash.id !== g.id) {
      return sendJson(res, 409, { error: 'Another group already has that name.' });
    }
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
    if (text.split(/\r?\n/).filter(l => l.trim()).length > 500) {
      return sendJson(res, 400, { error: 'That is more than 500 roster lines — split it into smaller pastes.' });
    }
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
      const rawName = splitName(namePart);
      const firstName = clean(rawName.firstName, 40);
      const lastName = clean(rawName.lastName, 40);
      groupName = clean(groupName, 60);
      if (!firstName || !lastName || !groupName) {
        report.errors.push({ line: idx + 1, text: line, reason: 'Missing a first name, last name, or group.' });
        return;
      }
      // One profile per athlete, period: a name that is already on the
      // roster — in ANY group — is a duplicate, so re-importing a roster
      // (or importing one whose groups were renamed) can never split an
      // athlete's records across two profiles.
      let group = groupByName(groupName);
      const existingByName = db.profiles.find(pr =>
        pr.firstName.toLowerCase() === firstName.toLowerCase() &&
        pr.lastName.toLowerCase() === lastName.toLowerCase());
      if (existingByName) {
        const inThisGroup = !!group && existingByName.groupId === group.id;
        const otherGroup = existingByName.groupId ? groupById(existingByName.groupId) : null;
        report.skipped.push({
          line: idx + 1, text: line,
          reason: inThisGroup
            ? 'Already on the roster in that group — skipped.'
            : 'Already on the roster' + (otherGroup ? ' in ' + otherGroup.name : '') + ' — skipped. Move them in the app if the group changed.',
        });
        return;
      }
      if (!group) {
        group = { id: crypto.randomUUID(), name: groupName, createdAt: new Date().toISOString() };
        db.groups.push(group);
        report.groupsCreated++;
      }
      seenInImport.add((firstName + '|' + lastName + '|' + group.id).toLowerCase());
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

  /* ---------- coach Today summary (home panel) ---------- */
  if (p === '/api/coach/today' && req.method === 'GET') {
    const date = todayStr();
    const plan = planDayFor(date);
    const d = parseDateStr(date);
    const groups = db.groups.map(g => {
      const a = resolveAssignment(g.id, date);
      const members = db.profiles.filter(pr => !pr.archived && pr.groupId === g.id);
      const done = members.filter(pr => completionFor(pr.id, date)).length;
      return {
        group: { id: g.id, name: g.name },
        assignment: {
          sessionId: a.sessionId, sessionName: a.sessionName, source: a.source,
          note: a.note || '', planText: a.planText || '', warmup: a.warmup || null,
        },
        completed: done, total: members.length,
      };
    });
    // Open health flags: New or Monitoring concerns, worst first.
    const healthFlags = [];
    for (const pr of db.profiles) {
      if (pr.archived) continue;
      for (const c of db.concerns[pr.id] || []) {
        if (c.status !== 'new' && c.status !== 'monitoring') continue;
        healthFlags.push(Object.assign({}, c, {
          athleteName: pr.firstName + ' ' + pr.lastName,
          flagged: c.pain >= 7 || c.impact === 'stopped',
        }));
      }
    }
    healthFlags.sort((a, b) => {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    return sendJson(res, 200, {
      date,
      dayName: d ? d.toLocaleDateString('en-US', { weekday: 'long' }) : '',
      week: plan ? plan.week : null,
      phase: plan ? plan.phase : null,
      dayKey: plan ? plan.dayKey : null,
      planText: plan ? plan.planText : '',
      groups,
      healthFlags,
    });
  }

  /* ---------- CSV exports (coach-only downloads) ---------- */
  if (p === '/api/export/testing.csv' && req.method === 'GET') {
    const rows = [['Test Day', 'Date', 'Athlete', 'Group', 'Test', 'Raw Entry', 'Est. 1RM (lb)']];
    const days = db.testDays.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const day of days) {
      const dayRows = [];
      for (const pr of db.profiles) {
        const pub = publicProfile(pr);
        for (const r of db.testResults[pr.id] || []) {
          if (r.testDayId !== day.id) continue;
          const test = findTest(r.testKey);
          const raw = test && test.kind === 'lift'
            ? numStr(r.weight) + (r.reps ? ' × ' + r.reps : '')
            : numStr(r.value) + (test ? ' ' + test.unit : '');
          dayRows.push({
            testOrder: day.testKeys.indexOf(r.testKey),
            athlete: pub.name,
            row: [day.title, day.date, pub.name, pub.groupName || '', test ? test.name : r.testKey,
              raw, test && test.kind === 'lift' ? numStr(displayValue(r)) : ''],
          });
        }
      }
      dayRows.sort((a, b) => a.testOrder - b.testOrder || a.athlete.localeCompare(b.athlete));
      for (const dr of dayRows) rows.push(dr.row);
    }
    return sendCsv(res, 'testing-results.csv', rows);
  }

  if (p === '/api/export/weekly.csv' && req.method === 'GET') {
    const rows = [['Athlete', 'Metric', 'Week (Monday)', 'Value', 'Unit']];
    const entries = [];
    for (const pr of db.profiles) {
      const byMetric = db.weekly[pr.id] || {};
      for (const key of Object.keys(byMetric)) {
        const metric = findWeeklyMetric(key);
        for (const week of Object.keys(byMetric[key]).sort()) {
          entries.push({
            athlete: pr.firstName + ' ' + pr.lastName,
            metricName: metric ? metric.name : key,
            week,
            row: [pr.firstName + ' ' + pr.lastName, metric ? metric.name : key, week,
              numStr(byMetric[key][week]), metric ? metric.unit : ''],
          });
        }
      }
    }
    entries.sort((a, b) =>
      a.athlete.localeCompare(b.athlete) ||
      a.metricName.localeCompare(b.metricName) ||
      (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
    for (const e of entries) rows.push(e.row);
    return sendCsv(res, 'weekly-tracker.csv', rows);
  }

  if (p === '/api/export/roster.csv' && req.method === 'GET') {
    const rows = [['Name', 'Group', 'Events', 'Top Athlete']];
    const list = db.profiles.filter(pr => !pr.archived)
      .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
    for (const pr of list) {
      const pub = publicProfile(pr);
      rows.push([pub.name, pub.groupName || '', (pr.events || []).join('; '), pr.topAthlete ? 'yes' : 'no']);
    }
    return sendCsv(res, 'roster.csv', rows);
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
    if (profParam && !profileById(profParam)) {
      return sendJson(res, 404, { error: 'Profile not found.' });
    }
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

  /* ---------- warm-up card editor (coach-managed) ---------- */
  if (p === '/api/coach/warmup-cards' && req.method === 'GET') {
    const cards = Object.keys(WARMUP_CARDS).map(id => ({
      id,
      edited: Object.prototype.hasOwnProperty.call(db.warmupCardEdits, id),
      sections: db.warmupCardEdits[id] ? db.warmupCardEdits[id].sections : null,
    }));
    return sendJson(res, 200, { cards });
  }
  const wuEditMatch = p.match(/^\/api\/coach\/warmup-cards\/([^/]+)$/);
  if (wuEditMatch && req.method === 'PUT') {
    const cardId = decodeURIComponent(wuEditMatch[1]);
    if (!WARMUP_CARDS[cardId]) {
      return sendJson(res, 400, { error: 'Unknown warm-up card.' });
    }
    const body = await readBody(req);
    const v = validateWarmupCardEdits(body, cardId);
    if (v.error) return sendJson(res, 400, { error: v.error });
    db.warmupCardEdits[cardId] = { sections: v.sections };
    saveDb();
    return sendJson(res, 200, { ok: true, cardId, sections: v.sections });
  }
  if (wuEditMatch && req.method === 'DELETE') {
    const cardId = decodeURIComponent(wuEditMatch[1]);
    if (!WARMUP_CARDS[cardId]) {
      return sendJson(res, 400, { error: 'Unknown warm-up card.' });
    }
    const reset = Object.prototype.hasOwnProperty.call(db.warmupCardEdits, cardId);
    delete db.warmupCardEdits[cardId];
    saveDb();
    return sendJson(res, 200, { ok: true, cardId, reset });
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

  /* ---------- equipment inventory (coach-only tracker) ---------- */
  if (p === '/api/inventory' && req.method === 'GET') {
    const items = db.inventory.slice().sort((a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return sendJson(res, 200, { items });
  }
  if (p === '/api/inventory' && req.method === 'POST') {
    const body = await readBody(req);
    const v = validateInventory(body, false);
    if (v.error) return sendJson(res, 400, { error: v.error });
    const item = Object.assign({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }, v.fields, { updatedAt: new Date().toISOString() });
    db.inventory.push(item);
    saveDb();
    return sendJson(res, 201, { item });
  }
  const inventoryMatch = p.match(/^\/api\/inventory\/([^/]+)$/);
  if (inventoryMatch && req.method === 'PUT') {
    const item = db.inventory.find(i => i.id === decodeURIComponent(inventoryMatch[1]));
    if (!item) return sendJson(res, 404, { error: 'Inventory item not found.' });
    const body = await readBody(req);
    const v = validateInventory(body, true);
    if (v.error) return sendJson(res, 400, { error: v.error });
    Object.assign(item, v.fields, { updatedAt: new Date().toISOString() });
    saveDb();
    return sendJson(res, 200, { item });
  }
  if (inventoryMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(inventoryMatch[1]);
    if (!db.inventory.some(i => i.id === id)) {
      return sendJson(res, 404, { error: 'Inventory item not found.' });
    }
    db.inventory = db.inventory.filter(i => i.id !== id);
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

seedCoachInvitesFromEnv();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(() => {
      // The socket may already be gone (e.g., an oversized body was
      // destroyed mid-read) — never let the error reply itself throw.
      try { if (!res.headersSent) sendJson(res, 400, { error: 'Bad request.' }); } catch (_) { /* gone */ }
    });
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log(`Sprinter Workout App running at http://localhost:${PORT}`);
  console.log(`Content loaded: ${CONTENT.sessions.length} sessions, ${CONTENT.drills.length} drills, ${CONTENT.weeks.length} weeks.`);
});
