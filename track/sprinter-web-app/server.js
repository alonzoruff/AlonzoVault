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
 * MODEL — team data is coach-input only, with one athlete surface.
 * The coach keeps a roster of athlete PROFILES (name, training group,
 * event tags, Top Athlete star) and records almost everything himself:
 * assignment completions, testing-day results, weekly tracker numbers,
 * and aches & pains concerns. The single exception is the daily
 * wellness check-in: an athlete whose account email a coach has
 * linked to their roster profile can log sleep, soreness, and energy
 * once a day — and flag that something hurts, which files an
 * athlete-reported concern for the coaches to pick up. Everything
 * else an athlete account can do is read-only browsing, plus the
 * personal practice log and cross-training swaps.
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
  meetResults: [],
  meets: [],
  meetEntries: [],
  schoolRecords: [],
  goals: [],
  programs: [],
  programApplications: [],
  coachInvites: [],
  coachInvitesSeeded: [],
  athleteLinks: {},
  checkins: {},
  attendance: {},
  coachNotes: {},
  announcements: [],
};

/* Coach-set athlete status (the AMS layer): every profile carries
   one; anything missing or unrecognized reads as active. */
const PROFILE_STATUSES = ['active', 'injured', 'inactive'];

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
  // Meet results: one flat list of { id, profileId, date, meet, event,
  // mark, value, notes } — mark is the raw text the coach typed, value
  // is the normalized number (seconds for times, inches for field
  // marks) that PR comparisons run on.
  db.meetResults = Array.isArray(db.meetResults) ? db.meetResults : [];
  // Meet Day hub: meets a coach is running ({ id, name, date,
  // location, createdAt }) and who is entered where ({ id, meetId,
  // profileId, event }). Entries are the plan for the day; results
  // live in db.meetResults as always, keyed by the meet's name + date.
  db.meets = Array.isArray(db.meets) ? db.meets : [];
  db.meetEntries = Array.isArray(db.meetEntries) ? db.meetEntries : [];
  // School record board: one flat list of { id, event, mark, value,
  // name, profileId, year, meet, date, createdAt } — the all-time
  // top 10 per event. name is free text (most record holders are not
  // on the current roster); profileId links a current athlete when
  // the mark is theirs. Starts empty — real SJC history only.
  db.schoolRecords = Array.isArray(db.schoolRecords) ? db.schoolRecords : [];
  // Coach-built custom workouts for runner mode: a flat list of
  // { id, title, blocks: [{ rounds, restBetweenRounds, restAfterBlock,
  // exercises: [{ name, reps }] }], createdAt, updatedAt }. The seeded
  // flag remembers that AJ's runner-test workout was planted once, so
  // deleting it never brings it back.
  db.customWorkouts = Array.isArray(db.customWorkouts) ? db.customWorkouts : [];
  db.customWorkoutsSeeded = db.customWorkoutsSeeded === true;
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
  // Athlete account links: { normalizedEmail: profileId }. A coach
  // attaches an email to a roster profile; the account with that
  // email is bound to the profile (user.profileId below) and can use
  // the daily check-in. Keys are normalized on every load.
  const rawLinks = (db.athleteLinks && typeof db.athleteLinks === 'object' && !Array.isArray(db.athleteLinks))
    ? db.athleteLinks : {};
  db.athleteLinks = {};
  for (const [e, pid] of Object.entries(rawLinks)) {
    const email = String(e || '').trim().toLowerCase();
    if (email && typeof pid === 'string' && pid) db.athleteLinks[email] = pid;
  }
  // Daily check-ins: { profileId: { 'YYYY-MM-DD': checkin } }.
  db.checkins = (db.checkins && typeof db.checkins === 'object' && !Array.isArray(db.checkins))
    ? db.checkins : {};
  // Attendance roll-book: { 'YYYY-MM-DD': { profileId: { status,
  // updatedAt, updatedBy } } } — one coach-entered mark per athlete
  // per day, status one of present / late / excused / absent. Its own
  // record: never an alias for a completion, never athlete-facing.
  db.attendance = (db.attendance && typeof db.attendance === 'object' && !Array.isArray(db.attendance))
    ? db.attendance : {};
  // Private coach notes (the AMS layer): { profileId: [ { id, text,
  // authorId, authorEmail, createdAt, updatedAt } ] } — a per-athlete
  // thread only coaches can read or write. Athlete-facing payloads
  // never include it; the notes live behind the coach gate, full stop.
  db.coachNotes = (db.coachNotes && typeof db.coachNotes === 'object' && !Array.isArray(db.coachNotes))
    ? db.coachNotes : {};
  for (const pid of Object.keys(db.coachNotes)) {
    if (!Array.isArray(db.coachNotes[pid])) db.coachNotes[pid] = [];
  }
  // Athlete goals: one flat list of { id, profileId, event,
  // targetText, targetValue, createdAt, updatedAt } — coach-set
  // target marks, one ACTIVE goal per athlete per event (setting a
  // new target for a pair replaces the old one; no goal history).
  db.goals = Array.isArray(db.goals) ? db.goals : [];
  // Coach announcements: one flat list of { id, title, body,
  // audience, pinned, authorId, authorEmail, createdAt, updatedAt } —
  // one-way coach-to-team posts. audience is 'team' or a group id;
  // the read endpoint filters per caller, so a group post never
  // reaches an athlete outside that group.
  db.announcements = Array.isArray(db.announcements) ? db.announcements : [];
  // Coach-built training programs (reusable week-grid templates) and
  // their applications onto the team calendar. An application carries
  // an exact snapshot of every override it wrote, so removing it
  // deletes precisely those overrides and nothing else.
  db.programs = Array.isArray(db.programs) ? db.programs : [];
  db.programApplications = Array.isArray(db.programApplications) ? db.programApplications : [];
  db.users.forEach((u, i) => {
    if (u.role !== 'coach' && u.role !== 'athlete') u.role = i === 0 ? 'coach' : 'athlete';
    // The first account is the head coach (owner). Stores written
    // before invites existed have no marker — the first user owns it.
    if (u.isOwner === undefined) u.isOwner = i === 0;
    // The roster binding is a pure projection of the links table, so
    // linking/unlinking takes effect on the very next request (the
    // same fresh-from-store resolution coach invites rely on).
    const lp = db.athleteLinks[u.email];
    u.profileId = lp && db.profiles.some(pr => pr.id === lp) ? lp : null;
    if (!db.logs[u.id]) db.logs[u.id] = [];
    if (!db.swaps[u.id]) db.swaps[u.id] = {};
  });
  for (const prof of db.profiles) {
    if (!Array.isArray(prof.events)) prof.events = [];
    if (prof.topAthlete === undefined) prof.topAthlete = false;
    if (prof.archived === undefined) prof.archived = false;
    if (prof.groupId === undefined) prof.groupId = null;
    if (!PROFILE_STATUSES.includes(prof.status)) prof.status = 'active';
  }
}
function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let raw;
  try {
    raw = fs.readFileSync(DB_FILE, 'utf8');
  } catch (_) {
    migrate(); /* first run: no file yet, keep the empty store */
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.users)) throw new Error('unexpected store shape');
    db = Object.assign(db, parsed);
  } catch (err) {
    const quarantine = DB_FILE + '.corrupt-' + Date.now();
    try { fs.renameSync(DB_FILE, quarantine); } catch (_) {}
    console.error('DATA STORE CORRUPT: original preserved at ' + quarantine
      + ' — booting from an empty store. Restore that file to recover. (' + err.message + ')');
  }
  migrate();
}
function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
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

/* Seed custom workout: the lifting circuit AJ handed over to test
   runner mode with. Planted exactly once — the customWorkoutsSeeded
   flag is the memory. If a coach deletes it, it stays deleted;
   restarts never resurrect it. Rests are editable like everything
   else: 90 seconds between rounds, 3 minutes after each block. */
const CUSTOM_WORKOUT_SEED = {
  title: 'Strength Circuit — Runner Test',
  blocks: [
    { rounds: 4, restBetweenRounds: 90, restAfterBlock: 180, exercises: [
      { name: 'Hang Clean', reps: '3' },
      { name: 'Band Jumps', reps: '10' },
      { name: 'MB Slam', reps: '5 each side' },
    ] },
    { rounds: 4, restBetweenRounds: 90, restAfterBlock: 180, exercises: [
      { name: 'Hex Bar Deadlift', reps: '5' },
      { name: 'Pull-Ups', reps: 'max' },
      { name: 'Bulgarian Split Squat', reps: '5 each' },
      { name: 'DB Incline Press', reps: '5 each' },
    ] },
    { rounds: 4, restBetweenRounds: 90, restAfterBlock: 180, exercises: [
      { name: 'Hip Thrust', reps: '5' },
      { name: 'DB Row', reps: '5 each' },
      { name: 'Back Extension', reps: '8' },
      { name: 'Ab Wheel', reps: '5' },
      { name: 'DB Incline', reps: '5' },
    ] },
  ],
};
function seedCustomWorkouts() {
  if (db.customWorkoutsSeeded) return;
  db.customWorkoutsSeeded = true;
  const now = new Date().toISOString();
  db.customWorkouts.push(Object.assign(
    { id: crypto.randomUUID(), createdAt: now, updatedAt: now },
    JSON.parse(JSON.stringify(CUSTOM_WORKOUT_SEED))));
  saveDb();
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
    exerciseLibrary: loadExerciseLibrary(),
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
/* The Exercise Library list (content/instagram_movements.json) —
   movements mined from AJ's saved Instagram training posts. Same
   tolerant loading as the glossary: a missing or malformed file
   means an empty library, never a crashed server. Entries missing a
   display field or a usable source link are dropped; the sources
   array is kept (cleaned) so the card can note how many posts a
   movement was saved from. */
function loadExerciseLibrary() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'instagram_movements.json'), 'utf8'));
    if (Array.isArray(parsed)) {
      return parsed.filter(m => m && typeof m === 'object'
        && typeof m.name === 'string' && m.name.trim()
        && typeof m.trains === 'string' && m.trains.trim()
        && typeof m.equipment === 'string' && m.equipment.trim()
        && typeof m.cues === 'string' && m.cues.trim()
        && typeof m.sourceUrl === 'string' && /^https:\/\//.test(m.sourceUrl)
        && typeof m.sourceUsername === 'string' && m.sourceUsername.trim())
        .map(m => ({
          ...m,
          sources: (Array.isArray(m.sources) ? m.sources : [])
            .filter(s => s && typeof s.sourceUrl === 'string' && /^https:\/\//.test(s.sourceUrl)
              && typeof s.sourceUsername === 'string' && s.sourceUsername.trim()),
        }));
    }
  } catch (_) { /* no exercise library bundled — that is fine */ }
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
const round2 = (v) => Math.round(v * 100) / 100;
function medianOf(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round2(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}
function addDaysStr(dateString, n) {
  const d = parseDateStr(dateString);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

/* The value rules for one testing result, shared verbatim by the
   single-result endpoint and the test-day rapid-entry bulk save, so a
   number that is valid in one is valid in the other. Returns
   { fields: { value, weight, reps, est1rm } } or { error }. */
function validateResultFields(test, body) {
  let value = null, weight = null, reps = null, est1rm = null;
  if (test.kind === 'lift') {
    const w = num(body.weight !== undefined ? body.weight : body.value);
    if (w === null || w <= 0) return { error: 'Enter a valid weight in lb.' };
    if (w > 1500) return { error: 'That weight is beyond the plausible range (max 1500 lb).' };
    weight = w;
    if (body.reps !== undefined && body.reps !== null && body.reps !== '') {
      const r = num(body.reps);
      if (r === null || !Number.isInteger(r) || r < 1 || r > 30) {
        return { error: 'Reps must be a whole number from 1 to 30.' };
      }
      reps = r;
      est1rm = epley(w, r);
    } else {
      est1rm = Math.round(w);
    }
  } else {
    const v = num(body.value);
    if (v === null || v < 0 || (test.kind === 'measure' && v === 0)) return { error: 'Enter a valid result.' };
    value = v;
  }
  return { fields: { value, weight, reps, est1rm } };
}
/* Insert or replace the one result for an athlete + test day + test
   (the same upsert the single-result endpoint has always done). */
function upsertResult(prof, day, testKey, fields, userId) {
  db.testResults[prof.id] = db.testResults[prof.id] || [];
  const existing = db.testResults[prof.id].find(r => r.testDayId === day.id && r.testKey === testKey);
  const result = existing || {
    id: crypto.randomUUID(), profileId: prof.id, testDayId: day.id, testKey,
    createdAt: new Date().toISOString(),
  };
  Object.assign(result, fields, { enteredBy: userId, updatedAt: new Date().toISOString() });
  if (!existing) db.testResults[prof.id].push(result);
  return { result, created: !existing };
}

/* ------------------------------------------------------------------ */
/* Meet results: events, mark parsing, PRs                             */
/* ------------------------------------------------------------------ */
/* type 'time' normalizes to seconds (lower is better); type 'field'
   normalizes to inches (higher is better). */
const MEET_EVENTS = [
  { key: '55m', name: '55m', type: 'time' },
  { key: '60m', name: '60m', type: 'time' },
  { key: '100m', name: '100m', type: 'time' },
  { key: '200m', name: '200m', type: 'time' },
  { key: '300m', name: '300m', type: 'time' },
  { key: '400m', name: '400m', type: 'time' },
  { key: '800m', name: '800m', type: 'time' },
  { key: '1600m', name: '1600m', type: 'time' },
  { key: '3200m', name: '3200m', type: 'time' },
  { key: '55m-hurdles', name: '55m Hurdles', type: 'time' },
  { key: '110m-hurdles', name: '110m Hurdles', type: 'time' },
  { key: '300m-hurdles', name: '300m Hurdles', type: 'time' },
  { key: 'long-jump', name: 'Long Jump', type: 'field' },
  { key: 'triple-jump', name: 'Triple Jump', type: 'field' },
  { key: 'high-jump', name: 'High Jump', type: 'field' },
  { key: 'shot-put', name: 'Shot Put', type: 'field' },
  { key: 'discus', name: 'Discus', type: 'field' },
  { key: 'javelin', name: 'Javelin', type: 'field' },
  { key: 'pole-vault', name: 'Pole Vault', type: 'field' },
];
function findMeetEvent(key) { return MEET_EVENTS.find(e => e.key === key) || null; }
function meetEventView(ev) {
  return { key: ev.key, name: ev.name, type: ev.type, better: ev.type === 'time' ? 'lower' : 'higher' };
}
/* Times: plain seconds ("10.87") or minutes:seconds ("1:55.20").
   Returns normalized seconds, or null when the text is not a time. */
function parseTimeMark(raw) {
  const t = String(raw || '').trim();
  const colon = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(t);
  if (colon) {
    const secs = Number(colon[1]) * 60 + Number(colon[2]);
    return secs > 0 ? round2(secs) : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(t)) {
    const v = Number(t);
    return v > 0 && v < 3600 ? round2(v) : null;
  }
  return null;
}
/* Field marks normalize to inches. Accepted shapes: feet-inches with
   a dash ("21-06.5") or an apostrophe (21'6.5), a plain number in
   feet ("21.5"), or a number with an m suffix in meters ("6.45m").
   The inches part must be under 12 — "21-13" is a typo, not a mark. */
function parseFieldMark(raw) {
  const t = String(raw || '').trim().replace(/["\u201d]/g, '');
  let m = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(t) || /^(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const inches = Number(m[2]);
    if (inches >= 12) return null;
    const v = Number(m[1]) * 12 + inches;
    return v > 0 ? round2(v) : null;
  }
  m = /^(\d+(?:\.\d+)?)\s*m$/i.exec(t);
  if (m) {
    const v = Number(m[1]) * 39.3701;
    return v > 0 ? round2(v) : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(t)) {
    const v = Number(t) * 12;
    return v > 0 ? round2(v) : null;
  }
  return null;
}
/* Parse a raw mark under an event's rules. Returns { value } or
   { error } with a message a coach can act on. */
function parseMeetMark(ev, raw) {
  const mark = String(raw || '').trim();
  if (!mark) return { error: 'Enter a mark.' };
  const value = ev.type === 'time' ? parseTimeMark(mark) : parseFieldMark(mark);
  if (value === null) {
    return {
      error: ev.type === 'time'
        ? 'That time could not be read — use seconds (10.87) or minutes:seconds (1:55.20).'
        : 'That mark could not be read — use feet-inches (21-06.5), 21\'6.5, a plain number in feet, or meters with an m (6.45m).',
    };
  }
  return { value };
}
function publicMeetResult(r) {
  const pr = profileById(r.profileId);
  const ev = findMeetEvent(r.event);
  return Object.assign({}, r, {
    athleteName: pr ? pr.firstName + ' ' + pr.lastName : '',
    eventName: ev ? ev.name : r.event,
  });
}
/* Best result per event for one athlete, by the event's direction —
   a slower time or a shorter jump can never become the PR. */
function meetPrsFor(profileId) {
  const byEvent = {};
  for (const r of db.meetResults) {
    if (r.profileId !== profileId) continue;
    const ev = findMeetEvent(r.event);
    if (!ev) continue;
    const cur = byEvent[r.event];
    if (!cur || (ev.type === 'time' ? r.value < cur.value : r.value > cur.value)) {
      byEvent[r.event] = r;
    }
  }
  return MEET_EVENTS.filter(ev => byEvent[ev.key]).map(ev => {
    const r = byEvent[ev.key];
    return {
      event: ev.key, name: ev.name, type: ev.type,
      better: ev.type === 'time' ? 'lower' : 'higher',
      resultId: r.id, mark: r.mark, value: r.value, date: r.date, meet: r.meet,
    };
  });
}
/* Chronological series per event for one athlete (PR progression). */
function meetSeriesFor(profileId) {
  const out = [];
  for (const ev of MEET_EVENTS) {
    const points = db.meetResults
      .filter(r => r.profileId === profileId && r.event === ev.key)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1
        : (a.createdAt < b.createdAt ? -1 : 1)))
      .map(r => ({ resultId: r.id, date: r.date, meet: r.meet, mark: r.mark, value: r.value }));
    if (points.length) {
      out.push({ event: ev.key, name: ev.name, type: ev.type, better: ev.type === 'time' ? 'lower' : 'higher', points });
    }
  }
  return out;
}
/* Validate one meet-result input in the order POST /api/meet-results
   always has (profile → date → meet name → event → parseable mark).
   Returns the normalized pieces, or { status, error }. This is the
   ONLY validation for meet marks — the Meet Day hub runs its quick
   results through it too, so a mark means the same thing wherever it
   was typed. */
function validateMeetResultInput(input) {
  const prof = profileById(clean(input.profileId, 80));
  if (!prof) return { status: 404, error: 'Profile not found.' };
  const date = clean(input.date, 10);
  if (!parseDateStr(date)) return { status: 400, error: 'Date must be YYYY-MM-DD.' };
  const meet = clean(input.meet, 80);
  if (!meet) return { status: 400, error: 'Name the meet.' };
  const ev = findMeetEvent(clean(input.event, 30));
  if (!ev) return { status: 400, error: 'Unknown event.' };
  const rawMark = typeof input.mark === 'string' ? input.mark.trim().slice(0, 20) : '';
  const parsed = parseMeetMark(ev, rawMark);
  if (parsed.error) return { status: 400, error: parsed.error };
  return { prof, date, meet, ev, rawMark, value: parsed.value };
}
/* Insert one already-validated meet result and return the record.
   The single write path behind both POST /api/meet-results and the
   Meet Day hub's quick results. Callers saveDb(). */
function insertMeetResult(v, notes, enteredBy) {
  const now = new Date().toISOString();
  const existing = db.meetResults.find(x => x.profileId === v.prof.id
    && x.date === v.date && x.meet === v.meet && x.event === v.ev.key);
  if (existing) {
    Object.assign(existing, {
      mark: v.rawMark, value: v.value, notes: clean(notes, 500), updatedAt: now,
    });
    return existing;
  }
  const r = {
    id: crypto.randomUUID(), profileId: v.prof.id, date: v.date, meet: v.meet,
    event: v.ev.key, mark: v.rawMark, value: v.value,
    notes: clean(notes, 500), enteredBy: enteredBy || null,
    createdAt: now, updatedAt: now,
  };
  db.meetResults.push(r);
  return r;
}

/* ------------------------------------------------------------------ */
/* Athlete goals: coach-set target marks, honest progress            */
/* ------------------------------------------------------------------ */
/* Progress is computed from the athlete's real meet results only —
   the shared helpers above, never a forked parser or PR rule.
   Baseline is the athlete's FIRST recorded mark in the event
   (meetSeriesFor's first point); current is their PR (meetPrsFor).
   The percentage is how far the PR has travelled from the baseline
   toward the target along the event's direction, clamped 0-100;
   the plain gap to the target (seconds or inches still to make up)
   rides along so the number never hides behind a percentage. */
function goalProgressFor(goal) {
  const ev = findMeetEvent(goal.event);
  const target = { mark: goal.targetText, value: goal.targetValue };
  const series = meetSeriesFor(goal.profileId).find(s => s.event === goal.event);
  const pr = meetPrsFor(goal.profileId).find(x => x.event === goal.event) || null;
  if (!ev || !series || !series.points.length || !pr) {
    return { baseline: null, current: null, target, progressPct: null, achieved: false, gap: null };
  }
  const first = series.points[0];
  const baseline = { mark: first.mark, value: first.value, date: first.date };
  const current = { mark: pr.mark, value: pr.value, date: pr.date };
  const lower = ev.type === 'time';
  const achieved = lower ? current.value <= target.value : current.value >= target.value;
  let progressPct;
  if (achieved) {
    progressPct = 100;
  } else {
    const denom = lower ? baseline.value - target.value : target.value - baseline.value;
    if (denom === 0) {
      // Degenerate: the baseline already IS the target, and the PR
      // has not met it (the best mark sits on the wrong side of the
      // first one) — no travel to measure, so 0.
      progressPct = 0;
    } else {
      const num = lower ? baseline.value - current.value : current.value - baseline.value;
      progressPct = Math.max(0, Math.min(100, Math.round((num / denom) * 100)));
    }
  }
  const gap = round2(lower ? current.value - target.value : target.value - current.value);
  return { baseline, current, target, progressPct, achieved, gap };
}

function publicGoal(goal) {
  const prof = profileById(goal.profileId);
  const ev = findMeetEvent(goal.event);
  const prog = goalProgressFor(goal);
  return {
    id: goal.id, profileId: goal.profileId,
    athleteName: prof ? prof.firstName + ' ' + prof.lastName : '',
    event: goal.event, eventName: ev ? ev.name : goal.event,
    type: ev ? ev.type : null,
    better: ev ? (ev.type === 'time' ? 'lower' : 'higher') : null,
    targetText: goal.targetText, targetValue: goal.targetValue,
    baseline: prog.baseline, current: prog.current,
    progressPct: prog.progressPct, achieved: prog.achieved, gap: prog.gap,
    gapUnit: ev ? (ev.type === 'time' ? 'sec' : 'in') : null,
    createdAt: goal.createdAt, updatedAt: goal.updatedAt,
  };
}

function goalsForProfile(profileId) {
  return db.goals.filter(g => g.profileId === profileId).map(publicGoal);
}

/* Validate a goal create in one pass. Unknown athlete/event and an
   unparseable target are all clean 400s a coach can act on; the
   target runs through parseMeetMark, the same parser as results. */
function validateGoalInput(body) {
  const prof = profileById(clean(body.profileId, 80));
  if (!prof) return { status: 400, error: 'Unknown athlete.' };
  const ev = findMeetEvent(clean(body.event, 30));
  if (!ev) return { status: 400, error: 'Unknown event.' };
  const rawTarget = typeof body.target === 'string' ? body.target.trim().slice(0, 20) : '';
  const parsed = parseMeetMark(ev, rawTarget);
  if (parsed.error) return { status: 400, error: parsed.error };
  return { prof, ev, rawTarget, value: parsed.value };
}

/* ------------------------------------------------------------------ */
/* Coach announcements (one-way coach -> team posts)                   */
/* ------------------------------------------------------------------ */
/* The wire shape of one announcement. `audience` is 'team' or a
   group id; the label resolves the group's CURRENT name (a post
   whose group was later deleted falls back to a neutral label).
   The author presents the way the app presents coaches elsewhere:
   by their coach email. */
function publicAnnouncement(a) {
  const g = a.audience !== 'team' ? groupById(a.audience) : null;
  return {
    id: a.id, title: a.title || '', body: a.body,
    audience: a.audience,
    audienceLabel: a.audience === 'team' ? 'Whole team' : (g ? g.name : 'A group'),
    groupName: g ? g.name : null,
    pinned: !!a.pinned,
    authorId: a.authorId, authorEmail: a.authorEmail,
    authorLabel: 'Coach · ' + a.authorEmail,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}
/* Feed order: pinned first, then newest first. */
function announcementOrder(a, b) {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}
/* Who sees a post. Coaches see everything. An athlete sees team
   posts plus posts addressed to their linked profile's group; an
   unlinked athlete, or one whose profile has no group, sees team
   posts only. Filtering happens here, server-side — a post an
   athlete should not see never appears in their response. */
function announcementVisibleTo(a, user) {
  if (user.role === 'coach') return true;
  if (a.audience === 'team') return true;
  const prof = linkedProfileFor(user);
  return !!prof && !!prof.groupId && prof.groupId === a.audience;
}
function announcementsFor(user) {
  return db.announcements.filter(a => announcementVisibleTo(a, user))
    .slice().sort(announcementOrder).map(publicAnnouncement);
}
/* Validate an announcement payload. full (base=null) for creates:
   a non-empty body is required and the audience defaults to the
   whole team. Edits pass the existing post; only the fields
   present are re-validated, into a candidate first, so a bad
   field changes nothing — the meet-results pattern. */
function validateAnnouncementInput(body, base) {
  const next = base
    ? { title: base.title || '', body: base.body, audience: base.audience, pinned: !!base.pinned }
    : { title: '', body: '', audience: 'team', pinned: false };
  if (!base || body.title !== undefined) next.title = clean(body.title, 80);
  if (!base || body.body !== undefined) {
    const raw = typeof body.body === 'string' ? body.body.trim() : '';
    if (!raw) return { error: 'An announcement needs a message.' };
    if (raw.length > 2000) return { error: 'Announcements are capped at 2000 characters.' };
    next.body = raw;
  }
  if (!base || body.audience !== undefined) {
    if (body.audience === undefined) {
      next.audience = 'team';
    } else {
      const aud = clean(body.audience, 80);
      if (aud !== 'team' && !groupById(aud)) {
        return { error: 'Audience must be the whole team or one of your groups.' };
      }
      next.audience = aud;
    }
  }
  if (body.pinned !== undefined) next.pinned = !!body.pinned;
  return { fields: next };
}

/* ------------------------------------------------------------------ */
/* Meet Day hub: meets, entries, checklist                           */
/* ------------------------------------------------------------------ */
function meetById(id) { return db.meets.find(m => m.id === id) || null; }
function publicMeet(m) {
  return { id: m.id, name: m.name, date: m.date, location: m.location || '', createdAt: m.createdAt };
}
function publicMeetEntry(e) {
  const pr = profileById(e.profileId);
  const ev = findMeetEvent(e.event);
  return {
    id: e.id, meetId: e.meetId, profileId: e.profileId,
    athleteName: pr ? pr.firstName + ' ' + pr.lastName : '',
    event: e.event, eventName: ev ? ev.name : e.event,
  };
}
function meetEntriesFor(meetId) { return db.meetEntries.filter(e => e.meetId === meetId); }
/* A meet's results: meet results carry the meet's NAME and DATE as
   plain text (that is the meet-results model), so a meet's results
   are the records whose meet + date match its own. */
function meetResultsFor(meet) {
  return db.meetResults.filter(r => r.meet === meet.name && r.date === meet.date);
}
/* The meet-day checklist is read off the data, never stored as
   toggles: entries added → every entered event has at least one
   result → every entry has its result. */
function meetChecklist(meet) {
  const entries = meetEntriesFor(meet.id);
  const results = meetResultsFor(meet);
  const enteredEvents = [...new Set(entries.map(e => e.event))];
  const eventsWithResults = enteredEvents.filter(k => results.some(r => r.event === k));
  const entriesWithResults = entries.filter(e =>
    results.some(r => r.profileId === e.profileId && r.event === e.event));
  return {
    entriesAdded: entries.length > 0,
    everyEventHasResult: entries.length > 0 && eventsWithResults.length === enteredEvents.length,
    allResultsEntered: entries.length > 0 && entriesWithResults.length === entries.length,
  };
}
function meetSummary(meet) {
  const entries = meetEntriesFor(meet.id);
  const results = meetResultsFor(meet);
  // PR count: marks from this meet that still stand as the athlete's
  // PR in that event.
  let prs = 0;
  for (const r of results) {
    const pr = meetPrsFor(r.profileId).find(x => x.event === r.event);
    if (pr && pr.resultId === r.id) prs++;
  }
  return { entries: entries.length, resultsEntered: results.length, prs };
}
/* How a just-saved mark stacks up for quick-results flagging:
   'first' when it is the athlete's first recorded mark in the event,
   'pr' when it beats their previous best by the event's direction,
   else null. The athlete's own earlier mark AT THIS MEET (excludeId)
   is being replaced by the save, so it never competes with itself. */
function meetPrStatus(profileId, ev, value, excludeId) {
  const others = db.meetResults.filter(r =>
    r.profileId === profileId && r.event === ev.key && r.id !== excludeId);
  if (!others.length) return 'first';
  let best = others[0].value;
  for (const r of others) {
    best = ev.type === 'time' ? Math.min(best, r.value) : Math.max(best, r.value);
  }
  return (ev.type === 'time' ? value < best : value > best) ? 'pr' : null;
}

/* ------------------------------------------------------------------ */
/* School record board: all-time top 10 per event                      */
/* ------------------------------------------------------------------ */
/* Records events = the meet events PLUS relay events. The split is
   deliberate and load-bearing: relays are TEAM marks, so they live
   only in RECORD_ONLY_EVENTS and are only ever looked up through
   findRecordEvent (the records endpoints). findMeetEvent — which
   drives meet-result entry and all individual PR logic — never sees
   them, so a relay mark can never be entered as an individual's
   result or skew a PR board. Marks parse through the same shared
   parseMeetMark / parseTimeMark / parseFieldMark used by meet
   results; record events carry the same { key, name, type } shape. */
const RECORD_ONLY_EVENTS = [
  { key: '4x100m', name: '4x100m Relay', type: 'time' },
  { key: '4x200m', name: '4x200m Relay', type: 'time' },
  { key: '4x400m', name: '4x400m Relay', type: 'time' },
  { key: '4x800m', name: '4x800m Relay', type: 'time' },
];
const RECORD_EVENTS = MEET_EVENTS.concat(RECORD_ONLY_EVENTS);
function findRecordEvent(key) { return RECORD_EVENTS.find(e => e.key === key) || null; }
function recordEventView(ev) {
  return Object.assign(meetEventView(ev), {
    relay: RECORD_ONLY_EVENTS.some(e => e.key === ev.key),
  });
}
/* Direction-aware comparison on normalized values: negative when a
   is the better mark. Ties keep the earlier entry first. */
function compareMarkValues(ev, a, b) {
  return ev.type === 'time' ? a - b : b - a;
}
function rankedRecords(eventKey, limit) {
  const ev = findRecordEvent(eventKey);
  if (!ev) return [];
  return db.schoolRecords
    .filter(r => r.event === eventKey)
    .slice()
    .sort((a, b) => compareMarkValues(ev, a.value, b.value)
      || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .slice(0, limit || 10);
}
/* The rank a mark WOULD take on the board: 1 + the number of records
   strictly better than it. rank <= 10 means it makes the board. */
function recordWouldRank(ev, value) {
  let better = 0;
  for (const r of db.schoolRecords) {
    if (r.event !== ev.key) continue;
    if (ev.type === 'time' ? r.value < value : r.value > value) better++;
  }
  return better + 1;
}
function publicRecord(r) {
  const ev = findRecordEvent(r.event);
  const out = Object.assign({}, r, { eventName: ev ? ev.name : r.event });
  delete out.enteredBy;
  return out;
}
/* Best current-roster meet mark for an event (the promotion source).
   Individual events only — relays have no meet-result source and
   return null. Mirrors the team PR board: archived profiles out. */
function rosterBestForEvent(eventKey) {
  const ev = findMeetEvent(eventKey);
  if (!ev) return null;
  let best = null;
  for (const r of db.meetResults) {
    if (r.event !== eventKey) continue;
    const pr = profileById(r.profileId);
    if (!pr || pr.archived) continue;
    if (!best || compareMarkValues(ev, r.value, best.value) < 0) best = r;
  }
  if (!best) return null;
  const pr = profileById(best.profileId);
  return {
    profileId: best.profileId,
    athleteName: pr.firstName + ' ' + pr.lastName,
    mark: best.mark, value: best.value, date: best.date, meet: best.meet,
  };
}

/* ------------------------------------------------------------------ */
/* Team leaderboard: testing leaders + meet PR leaders                 */
/* ------------------------------------------------------------------ */
/* A motivation surface, computed fresh per request from the same
   stores and helpers everything else reads — testing bests come
   out of testingHistoryFor (displayValue + the test's own
   direction), meet PRs out of meetPrsFor, and the school-record
   tag compares parsed values against rankedRecords — so a number
   here can never disagree with the number anywhere else. Nothing
   is stored. Performance data only: no check-ins, health,
   attendance, notes, or goals ever enter this payload. Archived
   profiles sit out, matching the team PR board and the
   roster-best promotion source. A board exists only when at
   least two athletes own a mark on it, and each board keeps its
   top 5. Ties rank by who got there first (the earlier date),
   then by name, so the order is stable across loads. */
function rankLeaderEntries(entries, lower) {
  return entries.slice().sort((a, b) =>
    (lower ? a.value - b.value : b.value - a.value)
    || (a.sortDate < b.sortDate ? -1 : a.sortDate > b.sortDate ? 1 : 0)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, 5)
    .map((e, i) => {
      const out = Object.assign({}, e, { rank: i + 1 });
      delete out.sortDate;
      return out;
    });
}
function leaderboardData() {
  const active = db.profiles.filter(pr => !pr.archived);
  /* Testing: one candidate per athlete per test — their best,
     with the date of the test day it happened on. */
  const testBuckets = new Map();
  for (const pr of active) {
    const name = pr.firstName + ' ' + pr.lastName;
    for (const h of testingHistoryFor(pr.id)) {
      const bestPoint = h.series.find(s => s.display === h.best);
      if (!bestPoint) continue;
      if (!testBuckets.has(h.testKey)) testBuckets.set(h.testKey, []);
      testBuckets.get(h.testKey).push({
        profileId: pr.id, name, value: h.best,
        testDayDate: bestPoint.date, sortDate: bestPoint.date,
      });
    }
  }
  const testing = [];
  for (const t of allTests()) {
    const entries = testBuckets.get(t.key) || [];
    if (entries.length < 2) continue;
    testing.push({
      testKey: t.key, name: t.name, unit: t.unit, kind: t.kind,
      better: t.better || 'higher',
      leaders: rankLeaderEntries(entries, t.better === 'lower'),
    });
  }
  /* Meet PRs: one candidate per athlete per event — their PR. */
  const meetBuckets = new Map();
  for (const pr of active) {
    const name = pr.firstName + ' ' + pr.lastName;
    for (const prEntry of meetPrsFor(pr.id)) {
      if (!meetBuckets.has(prEntry.event)) meetBuckets.set(prEntry.event, []);
      meetBuckets.get(prEntry.event).push({
        profileId: pr.id, name, mark: prEntry.mark, value: prEntry.value,
        meet: prEntry.meet, date: prEntry.date, sortDate: prEntry.date,
      });
    }
  }
  const meets = [];
  for (const ev of MEET_EVENTS) {
    const entries = meetBuckets.get(ev.key) || [];
    if (entries.length < 2) continue;
    const leaders = rankLeaderEntries(entries, ev.type === 'time');
    /* The school-record tag: the leader's parsed value equals the
       record board's top parsed value for the event — exact
       equality on normalized values, never a string comparison,
       so a near miss (a quarter inch, a hundredth) never tags. */
    const topRecord = rankedRecords(ev.key, 1)[0];
    for (const l of leaders) {
      l.schoolRecord = l.rank === 1 && !!topRecord && topRecord.value === l.value;
    }
    meets.push({
      event: ev.key, name: ev.name, type: ev.type,
      better: ev.type === 'time' ? 'lower' : 'higher',
      leaders,
    });
  }
  return { testing, meets };
}

/* ------------------------------------------------------------------ */
/* Movement demo media: optional base file + coach overrides           */
/* ------------------------------------------------------------------ */
/* Cloudinary video uploads: the coach's own demo videos, uploaded
   straight from the browser with an unsigned preset and played
   natively in the app. The cloud name and preset are public
   identifiers — they ship to the client in the content payload —
   and the account API secret is never used anywhere in this app.
   An upload entry is accepted ONLY as an https URL on
   res.cloudinary.com under this account's cloud, so a link pasted
   into the demo editor can never smuggle in an outside host, a
   different account, or a non-https URL under an upload's name. */
const VIDEO_UPLOAD = { cloudName: 'l8qblw99', preset: 'sjc-demos' };
function uploadEntry(url, title) {
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com') return null;
  if (!u.pathname.startsWith('/' + VIDEO_UPLOAD.cloudName + '/')) return null;
  return { type: 'upload', url, embedUrl: url, title: clean(title, 120) };
}
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
  /* Uploads are decided first and strictly: any URL on the
     Cloudinary host — and anything claiming type 'upload' — must
     be this account's https delivery URL or it is not an entry. */
  let host = '';
  try { host = new URL(url).hostname; } catch (_) { /* not a URL */ }
  if (host === 'res.cloudinary.com' || raw.type === 'upload') return uploadEntry(url, raw.title);
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

/* Custom workouts (runner mode): a title plus ordered blocks. Each
   block has ordered exercises ({ name, reps }) — reps is short free
   text ("3", "max", "5 each side") — a rounds count, and two rests in
   seconds: between rounds, and after the block. One shared validator
   for create and update (updates replace the workout wholesale, the
   editor always sends the whole thing). Returns { fields } holding
   the trimmed, stored shape, or { error }. */
function validateCustomWorkout(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 80) {
    return { error: 'A custom workout needs a title of 1 to 80 characters.' };
  }
  if (!Array.isArray(body.blocks) || body.blocks.length < 1 || body.blocks.length > 8) {
    return { error: 'A custom workout needs 1 to 8 blocks.' };
  }
  const blocks = [];
  for (let i = 0; i < body.blocks.length; i++) {
    const b = body.blocks[i] && typeof body.blocks[i] === 'object' ? body.blocks[i] : {};
    const where = 'Block ' + (i + 1);
    const rounds = num(b.rounds);
    if (rounds === null || !Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
      return { error: where + ': rounds must be a whole number from 1 to 10.' };
    }
    const restBetweenRounds = num(b.restBetweenRounds);
    if (restBetweenRounds === null || !Number.isInteger(restBetweenRounds)
      || restBetweenRounds < 0 || restBetweenRounds > 600) {
      return { error: where + ': rest between rounds must be a whole number of seconds from 0 to 600.' };
    }
    const restAfterBlock = num(b.restAfterBlock);
    if (restAfterBlock === null || !Number.isInteger(restAfterBlock)
      || restAfterBlock < 0 || restAfterBlock > 600) {
      return { error: where + ': rest after the block must be a whole number of seconds from 0 to 600.' };
    }
    if (!Array.isArray(b.exercises) || b.exercises.length < 1 || b.exercises.length > 10) {
      return { error: where + ' needs 1 to 10 exercises.' };
    }
    const exercises = [];
    for (let j = 0; j < b.exercises.length; j++) {
      const e = b.exercises[j] && typeof b.exercises[j] === 'object' ? b.exercises[j] : {};
      const name = typeof e.name === 'string' ? e.name.trim() : '';
      if (!name || name.length > 60) {
        return { error: where + ', exercise ' + (j + 1) + ': a name of 1 to 60 characters is required.' };
      }
      const reps = typeof e.reps === 'string' ? e.reps.trim() : '';
      if (!reps || reps.length > 24) {
        return { error: where + ', exercise ' + (j + 1) + ': reps of 1 to 24 characters are required (try "3", "max", or "5 each").' };
      }
      exercises.push({ name, reps });
    }
    blocks.push({ rounds, restBetweenRounds, restAfterBlock, exercises });
  }
  return { fields: { title, blocks } };
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
const NY_TODAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
function todayStr() { return NY_TODAY_FMT.format(new Date()); }
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
function profileNameTaken(firstName, lastName, exceptId) {
  const f = String(firstName).toLowerCase(), l = String(lastName).toLowerCase();
  return db.profiles.some(pr => !pr.archived && pr.id !== exceptId
    && pr.firstName.toLowerCase() === f && pr.lastName.toLowerCase() === l);
}
function groupByName(name) {
  const n = String(name || '').trim().toLowerCase();
  return db.groups.find(g => g.name.toLowerCase() === n) || null;
}
function profileById(id) { return db.profiles.find(pr => pr.id === id) || null; }
/* The account email a coach has linked to a roster profile, if any. */
function linkedEmailForProfile(profileId) {
  for (const [email, pid] of Object.entries(db.athleteLinks)) {
    if (pid === profileId) return email;
  }
  return null;
}
function publicProfile(pr) {
  const g = pr.groupId ? groupById(pr.groupId) : null;
  return {
    id: pr.id, firstName: pr.firstName, lastName: pr.lastName,
    name: (pr.firstName + ' ' + pr.lastName).trim(),
    groupId: pr.groupId || null, groupName: g ? g.name : null,
    events: pr.events || [], topAthlete: !!pr.topAthlete, archived: !!pr.archived,
    status: PROFILE_STATUSES.includes(pr.status) ? pr.status : 'active',
    linkedEmail: linkedEmailForProfile(pr.id),
  };
}
function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role, isOwner: !!u.isOwner, profileId: u.profileId || null };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function userByEmail(email) { return db.users.find(u => u.email === email) || null; }
/* An assignment = coach override if one exists, else the plan default.
   `codes` is the full session list for the day: an override record
   carries a single primary sessionId (its codes list rides along when
   a program application wrote it), and a plan day's text can name two
   sessions — so codes is how multi-session days survive resolution.
   It is additive: every older reader keeps using sessionId alone. */
function resolveAssignment(groupId, dateString) {
  const ov = db.overrides[groupId + '|' + dateString];
  const plan = planDayFor(dateString);
  if (ov) {
    const s = SESSION_BY_ID.get(ov.sessionId);
    return {
      date: dateString, source: 'override', sessionId: ov.sessionId,
      codes: Array.isArray(ov.codes) && ov.codes.length ? ov.codes.slice() : [ov.sessionId],
      sessionName: s ? s.name : ov.sessionId, note: ov.note || '',
      planText: plan ? plan.planText : '', warmup: plan ? plan.warmup : null,
      cns: s ? s.cns_demand : null,
    };
  }
  if (!plan) return { date: dateString, source: 'plan', sessionId: null, sessionName: '', note: '', planText: '', warmup: null, cns: null, codes: [] };
  const s = plan.sessionId ? SESSION_BY_ID.get(plan.sessionId) : null;
  return {
    date: dateString, source: 'plan', sessionId: plan.sessionId,
    codes: plan.codes.slice(),
    sessionName: s ? s.name : '', note: '', planText: plan.planText,
    warmup: plan.warmup, cns: s ? s.cns_demand : null, isOff: plan.isOff,
  };
}
function completionFor(profileId, dateString) {
  return db.completions[profileId + '|' + dateString] || null;
}

/* ------------------------------------------------------------------ */
/* Programs: reusable templates + calendar applications                */
/* ------------------------------------------------------------------ */
/* A program is a template only: 1–16 weeks, each a Mon–Sun grid of
   session codes from the library (multiple codes per day, mirroring
   how a plan day's text can carry two sessions). Building or editing
   one changes nothing anywhere. APPLYING a program is the write: it
   lays ordinary coach overrides — the same store the per-day
   override endpoint writes — over the program's dates for the target
   group(s), so Today, the checklist, the TV board and the reports
   resolve applied days exactly like hand-set overrides, through
   resolveAssignment and nothing else. The season plan content is
   never touched. Each application snapshots the exact value of every
   override it wrote (db.programApplications[].writes); removing the
   application deletes an override only when its current value still
   equals that snapshot, so a day a coach hand-edited afterwards is
   kept, and counted as kept. */
const PROGRAM_MAX_WEEKS = 16;
function validateProgram(body) {
  const name = clean(body.name, 80);
  if (!name) return { error: 'A program needs a name.' };
  const note = clean(body.note, 500);
  if (!Array.isArray(body.weeks) || body.weeks.length < 1 || body.weeks.length > PROGRAM_MAX_WEEKS) {
    return { error: 'A program runs 1 to ' + PROGRAM_MAX_WEEKS + ' weeks — send a weeks list of that length.' };
  }
  const weeks = [];
  for (let wi = 0; wi < body.weeks.length; wi++) {
    const w = body.weeks[wi] && typeof body.weeks[wi] === 'object' ? body.weeks[wi] : {};
    const week = {};
    for (const dayKey of DAY_KEYS) {
      const raw = w[dayKey] === undefined ? [] : w[dayKey];
      if (!Array.isArray(raw)) {
        return { error: 'Week ' + (wi + 1) + ': ' + dayKey + ' must be a list of session codes.' };
      }
      const codes = [];
      for (const c of raw) {
        const code = clean(c, 20);
        if (!SESSION_IDS.has(code)) {
          return { error: 'Week ' + (wi + 1) + ': unknown session code "' + String(c) + '".' };
        }
        if (!codes.includes(code)) codes.push(code);
      }
      week[dayKey] = codes;
    }
    weeks.push(week);
  }
  return { fields: { name, note, weeks } };
}
function publicProgram(pr) {
  return {
    id: pr.id, name: pr.name, note: pr.note || '', weeks: pr.weeks,
    createdBy: pr.createdBy || null, createdAt: pr.createdAt, updatedAt: pr.updatedAt,
  };
}
function publicProgramApplication(a) {
  return {
    id: a.id, programId: a.programId, programName: a.programName,
    target: a.target, startDate: a.startDate, dates: a.dates,
    groups: [...new Set((a.writes || []).map(w => w.groupName))],
    daysWritten: (a.writes || []).length,
    createdAt: a.createdAt,
  };
}
/* The value of an override, for undo comparison: which session(s) it
   assigns and its note. by/at are bookkeeping, not value — who saved
   the same pick again is not an edit worth protecting, but a changed
   session or note is, and the override is then kept. */
function overrideSemantic(ov) {
  if (!ov) return null;
  const codes = Array.isArray(ov.codes) && ov.codes.length ? ov.codes.slice() : [ov.sessionId];
  return { sessionId: ov.sessionId, codes, note: ov.note || '' };
}

/* ------------------------------------------------------------------ */
/* Daily wellness check-in (the one athlete-entered surface)         */
/* ------------------------------------------------------------------ */
/* Flag rules, shared by the athlete view, the coach Wellness view,
   and the Coach Today line so a flag means the same thing everywhere:
   slept under 6 hours, soreness 4 or 5, energy 1 or 2. */
function checkinFlags(c) {
  const flags = [];
  if (c.sleep < 6) flags.push('low-sleep');
  if (c.soreness >= 4) flags.push('high-soreness');
  if (c.energy <= 2) flags.push('low-energy');
  return flags;
}
function publicCheckin(c) {
  return {
    date: c.date, sleep: c.sleep, soreness: c.soreness, energy: c.energy,
    hurts: !!c.hurts, painText: c.painText || '', note: c.note || '',
    flags: checkinFlags(c), updatedAt: c.updatedAt,
  };
}
/* The roster profile this account is bound to, if a coach linked it. */
function linkedProfileFor(user) {
  return user && user.profileId ? profileById(user.profileId) : null;
}
/* Consecutive checked-in days ending today — or yesterday, when
   today's check-in simply has not happened yet. */
function checkinStreak(profileId) {
  const byDate = db.checkins[profileId] || {};
  let cursor = todayStr();
  if (!byDate[cursor]) cursor = addDaysStr(cursor, -1);
  if (!cursor || !byDate[cursor]) return 0;
  let n = 0;
  while (cursor && byDate[cursor]) { n++; cursor = addDaysStr(cursor, -1); }
  return n;
}
/* File an athlete-reported concern in the existing Aches & Pains
   store. The athlete only gives words ("right hamstring is tight"),
   so the structured coach fields take neutral values: area/feeling
   "other", no pain score (null — the coach sets one when they pick
   it up), and source 'athlete' marks it as self-reported wherever
   concerns are shown. Returns the new concern's id. */
function createAthleteConcern(prof, date, painText, userId) {
  const now = new Date().toISOString();
  const concern = {
    id: crypto.randomUUID(), profileId: prof.id,
    area: 'other', side: 'na', feeling: 'other', pain: null,
    started: date, impact: 'none',
    note: painText, status: 'new', coachNote: '',
    source: 'athlete', reportedBy: userId || null, checkinDate: date,
    createdAt: now, updatedAt: now,
  };
  db.concerns[prof.id] = db.concerns[prof.id] || [];
  db.concerns[prof.id].push(concern);
  return concern.id;
}
/* The check-in validation rules, in one place: sleep 3–13 hours in
   half-hour steps, soreness/energy whole numbers 1–5, pain text up
   to 240 chars, note up to 500. Returns { fields } or { error }. */
function validateCheckin(body) {
  const sleep = num(body.sleep);
  if (sleep === null || sleep < 3 || sleep > 13
    || Math.abs(sleep * 2 - Math.round(sleep * 2)) > 1e-9) {
    return { error: 'Sleep must be between 3 and 13 hours, in half-hour steps.' };
  }
  const soreness = num(body.soreness);
  if (soreness === null || !Number.isInteger(soreness) || soreness < 1 || soreness > 5) {
    return { error: 'Soreness must be a whole number from 1 to 5.' };
  }
  const energy = num(body.energy);
  if (energy === null || !Number.isInteger(energy) || energy < 1 || energy > 5) {
    return { error: 'Energy must be a whole number from 1 to 5.' };
  }
  if (body.painText !== undefined && body.painText !== null && typeof body.painText !== 'string') {
    return { error: 'Say what hurts in words.' };
  }
  if (typeof body.painText === 'string' && body.painText.length > 240) {
    return { error: 'Keep the pain note to 240 characters or less.' };
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    return { error: 'The note must be text.' };
  }
  if (typeof body.note === 'string' && body.note.length > 500) {
    return { error: 'Keep the note to 500 characters or less.' };
  }
  return {
    fields: {
      sleep, soreness, energy,
      hurts: !!body.hurts,
      painText: clean(body.painText, 240),
      note: clean(body.note, 500),
    },
  };
}
/* Today's check-in headline for the Coach Today summary. */
function wellnessTodaySummary() {
  const date = todayStr();
  const roster = db.profiles.filter(pr => !pr.archived);
  let checkedIn = 0;
  const flagged = [];
  for (const pr of roster) {
    const c = (db.checkins[pr.id] || {})[date];
    if (!c) continue;
    checkedIn++;
    const flags = checkinFlags(c);
    if (flags.length) {
      flagged.push({ profileId: pr.id, name: pr.firstName + ' ' + pr.lastName, flags });
    }
  }
  return { date, checkedIn, total: roster.length, flagged };
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

/* One athlete's testing history, per test: the chronological series
   plus latest/best — the block the athlete report card renders, and
   the same block the AMS profile page reads. One computation, two
   readers, so a "best" means the same thing on both pages. */
function testingHistoryFor(profileId) {
  const dayById = new Map(db.testDays.map(d => [d.id, d]));
  return allTests().map(t => {
    const series = (db.testResults[profileId] || [])
      .filter(r => r.testKey === t.key)
      .map(r => {
        const day = dayById.get(r.testDayId);
        return {
          resultId: r.id, testDayId: r.testDayId,
          date: day ? day.date : '', title: day ? day.title : '',
          display: displayValue(r),
          value: r.value, weight: r.weight, reps: r.reps, est1rm: r.est1rm,
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const displays = series.map(r => r.display).filter(d => d !== null && d !== undefined);
    return {
      testKey: t.key, name: t.name, unit: t.unit, kind: t.kind, better: t.better || 'higher', series,
      best: displays.length ? (t.better === 'lower' ? Math.min : Math.max).apply(null, displays) : null,
      latest: series.length ? series[series.length - 1].display : null,
      latestDate: series.length ? series[series.length - 1].date : null,
    };
  }).filter(t => t.series.length);
}

/* ------------------------------------------------------------------ */
/* AMS attention flags (coach-side only)                               */
/* ------------------------------------------------------------------ */
/* Four flags, each computed from data the app already holds, with
   the same rules everywhere they appear (the AMS roster table and
   the AMS profile page read this one function):
   - Readiness: 2+ check-ins flagged by checkinFlags in the last
     7 days (today and the 6 days before it).
   - No check-in: a LINKED athlete with no check-in in the last
     3 days (today and the 2 days before it). Unlinked athletes
     never earn this flag — they get the neutral "Not linked"
     indicator instead, since they cannot check in at all.
   - Attendance: 2+ Absent marks in the last 14 days.
   - Health: 1+ aches & pains concerns currently new/open/monitoring
     (the concern store's live statuses are new/monitoring/cleared;
     'open' is accepted defensively so a future status rename can
     never silently hide an active concern).
   Plus three device flags from the athlete's latest ForceDecks /
   NordBord sessions — NordBord imbalance (>10% left/right max
   force apart), ForceDecks asymmetry (an 'asym' metric over 10),
   and Jump drop-off (latest jump height >10% under the best prior
   session) — specified where they are computed, below.
   Every flag carries the count behind it, stated in its detail. */
function amsFlagsFor(pr, today) {
  const flags = [];
  const byDate = db.checkins[pr.id] || {};
  const weekStart = addDaysStr(today, -6);
  let flaggedDays = 0;
  for (const ds of Object.keys(byDate)) {
    if (ds >= weekStart && ds <= today && checkinFlags(byDate[ds]).length) flaggedDays++;
  }
  if (flaggedDays >= 2) {
    flags.push({
      key: 'readiness', label: 'Readiness', count: flaggedDays,
      detail: flaggedDays + ' flagged check-ins this week',
    });
  }
  if (linkedEmailForProfile(pr.id)) {
    const start3 = addDaysStr(today, -2);
    let lastCheckin = null;
    for (const ds of Object.keys(byDate)) {
      if (ds <= today && (!lastCheckin || ds > lastCheckin)) lastCheckin = ds;
    }
    if (!lastCheckin || lastCheckin < start3) {
      flags.push({
        key: 'no-checkin', label: 'No check-in',
        count: lastCheckin ? Math.round((parseDateStr(today) - parseDateStr(lastCheckin)) / 86400000) : null,
        detail: lastCheckin
          ? 'Last check-in ' + lastCheckin + ' — none in the last 3 days'
          : 'No check-ins recorded — none in the last 3 days',
      });
    }
  }
  const start14 = addDaysStr(today, -13);
  let absents = 0;
  for (const ds of Object.keys(db.attendance)) {
    if (ds < start14 || ds > today) continue;
    const rec = db.attendance[ds][pr.id];
    if (rec && rec.status === 'absent') absents++;
  }
  if (absents >= 2) {
    flags.push({
      key: 'attendance', label: 'Attendance', count: absents,
      detail: absents + ' absences in the last 14 days',
    });
  }
  const openConcerns = (db.concerns[pr.id] || [])
    .filter(c => c.status === 'new' || c.status === 'open' || c.status === 'monitoring').length;
  if (openConcerns >= 1) {
    flags.push({
      key: 'health', label: 'Health', count: openConcerns,
      detail: openConcerns + (openConcerns === 1 ? ' open concern' : ' open concerns'),
    });
  }
  /* Device flags, each read off the athlete's LATEST session for
     that device (deviceSessionsFor):
     - NordBord imbalance: the latest NordBord session's left/right
       max-force pair differs by more than 10% of the stronger side.
     - ForceDecks asymmetry: the latest ForceDecks session carries
       an asymmetry metric (label contains 'asym') reading over 10
       in either direction — VALD reports asymmetry signed, so the
       magnitude is what counts.
     - Jump drop-off: the latest ForceDecks jump-height value sits
       more than 10% below the best value from any PRIOR session of
       the same test (a first-ever session can never flag). */
  const nbSessions = deviceSessionsFor(pr.id, 'nordbord');
  if (nbSessions.length) {
    const latestNb = nbSessions[nbSessions.length - 1];
    const pair = nordbordPairFor(latestNb);
    if (pair && Math.max(pair.left, pair.right) > 0) {
      const asym = Math.abs(pair.left - pair.right) / Math.max(pair.left, pair.right);
      if (asym > 0.10) {
        flags.push({
          key: 'nordbord-imbalance', label: 'NordBord imbalance',
          count: Math.round(asym * 100),
          detail: 'NordBord max force is ' + Math.round(asym * 100)
            + '% different left vs right (L ' + pair.left + ' / R ' + pair.right
            + ', latest ' + latestNb.date + ')',
        });
      }
    }
  }
  const fdSessions = deviceSessionsFor(pr.id, 'forcedecks');
  if (fdSessions.length) {
    const latestFd = fdSessions[fdSessions.length - 1];
    const asymMetrics = latestFd.metrics.filter(m => m.name.toLowerCase().includes('asym'));
    const worstAsym = asymMetrics.length
      ? asymMetrics.reduce((acc, m) => (Math.abs(m.value) > Math.abs(acc.value) ? m : acc))
      : null;
    if (worstAsym && Math.abs(worstAsym.value) > 10) {
      flags.push({
        key: 'forcedecks-asymmetry', label: 'ForceDecks asymmetry',
        count: Math.round(Math.abs(worstAsym.value)),
        detail: worstAsym.name + ' reads ' + worstAsym.value
          + ' (latest ForceDecks session, ' + latestFd.date + ')',
      });
    }
    for (const m of latestFd.metrics) {
      if (!m.name.toLowerCase().includes('jump height')) continue;
      let bestPrior = null;
      for (const s of fdSessions.slice(0, -1)) {
        for (const pm of s.metrics) {
          if (pm.testKey === m.testKey && (bestPrior === null || pm.value > bestPrior)) {
            bestPrior = pm.value;
          }
        }
      }
      if (bestPrior !== null && bestPrior > 0 && m.value < bestPrior * 0.9) {
        const drop = Math.round((1 - m.value / bestPrior) * 100);
        flags.push({
          key: 'jump-dropoff', label: 'Jump drop-off', count: drop,
          detail: m.name + ' is ' + drop + '% below this athlete\'s best of '
            + bestPrior + ' (latest ' + m.value + ', ' + latestFd.date + ')',
        });
        break;
      }
    }
  }
  return flags;
}
/* The wire shape of one private coach note. */
function publicCoachNote(n) {
  return {
    id: n.id, text: n.text,
    authorId: n.authorId, authorEmail: n.authorEmail,
    createdAt: n.createdAt, updatedAt: n.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Devices: ForceDecks, NordBord, T-APEX                               */
/* ------------------------------------------------------------------ */
/* Device results are TESTING results: a VALD Hub CSV (or the T-APEX
   tablet's export, or the T-APEX quick-entry card) files each number
   as a result on a per-device test day, under a custom test whose
   name carries the device label — so device history shows up in the
   Testing views, the report card, and the AMS profile with no
   special cases downstream. The device itself is remembered on the
   test day (day.device), which is how find-or-create stays
   idempotent and how the AMS device strip + flags find a device's
   sessions again. */
const DEVICES = {
  forcedecks: { id: 'forcedecks', name: 'ForceDecks', prefix: 'fd' },
  nordbord: { id: 'nordbord', name: 'NordBord', prefix: 'nb' },
  tapex: { id: 'tapex', name: 'T-APEX', prefix: 'ta' },
};
/* The T-APEX quick-entry card's four fields, with the metric label
   each one files under (unit stated, so it lands in the test name). */
const TAPEX_METRICS = [
  { field: 'load', label: 'Load (kg)' },
  { field: 'peakSpeed', label: 'Peak Speed (m/s)' },
  { field: 'maxForce', label: 'Max Force (N)' },
  { field: 'distance', label: 'Distance (m)' },
];

/* A small RFC-4180 CSV reader: quoted fields, commas and newlines
   inside quotes, doubled-quote escapes, CRLF or LF endings, and a
   leading BOM (spreadsheet exports carry one). Returns rows of
   trimmed strings; the caller drops fully blank rows. */
function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  const pushField = () => { row.push(field.trim()); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') pushRow();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}
/* A cell's numeric value, or null: thousands separators and a
   trailing % are presentation, not data. */
function deviceMetricValue(cell) {
  const t = String(cell === null || cell === undefined ? '' : cell)
    .trim().replace(/,/g, '').replace(/%$/, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/* Device exports write dates as YYYY-MM-DD or M/D/YYYY; anything
   else is the caller's error to surface, never a guessed date. */
function parseDeviceDate(raw) {
  const t = String(raw || '').trim();
  if (parseDateStr(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const iso = m[3] + '-' + String(Number(m[1])).padStart(2, '0')
      + '-' + String(Number(m[2])).padStart(2, '0');
    if (parseDateStr(iso)) return iso;
  }
  return null;
}
/* Name matching is normalized EXACT only — lowercase, collapse
   whitespace, strip punctuation. A "Last, First" cell is tried in
   both orders (a formatting variant, not a guess). No fuzzy
   matching ever: a name that does not land exactly comes back
   unmatched for the coach to map by hand. Two roster athletes with
   the same name make a row ambiguous — also unmatched, with a note. */
function normalizePersonName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function matchProfileByName(rawName) {
  const raw = String(rawName || '').trim();
  if (!raw) return { profile: null, ambiguous: false };
  const candidates = [normalizePersonName(raw)];
  const comma = raw.indexOf(',');
  if (comma > 0) {
    candidates.push(normalizePersonName(raw.slice(comma + 1) + ' ' + raw.slice(0, comma)));
  }
  const hits = db.profiles.filter(pr => !pr.archived
    && candidates.includes(normalizePersonName(pr.firstName + ' ' + pr.lastName)));
  if (hits.length === 1) return { profile: hits[0], ambiguous: false };
  return { profile: null, ambiguous: hits.length > 1 };
}

const DEVICE_NAME_HEADERS = ['name', 'athlete', 'athlete name', 'player', 'player name', 'full name'];
const DEVICE_DATE_HEADERS = ['date', 'test date', 'session date', 'date tested'];
const DEVICE_UNITS = ['cm', 'mm', 'm', 's', 'ms', 'n', 'kg', 'lb', 'lbs', '%', 'w', 'reps', 'hz', 'in'];
function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
/* A metric label is the file's own column header, tidied. The unit
   (when the header states one — in parens/brackets, or as a trailing
   unit word) is split off so the test name can carry it in the
   standard place. The label is also the metric's identity: the
   custom-test key derives from it, so re-importing the same export
   lands on the same tests. */
function deviceMetricParts(label) {
  let base = String(label || '').replace(/\s+/g, ' ').trim();
  let unit = '';
  const paren = /^(.*?)\s*[\[(]\s*([^\]\)]{1,12}?)\s*[\]\)]\s*$/.exec(base);
  if (paren) { base = paren[1].trim(); unit = paren[2].trim(); }
  else {
    const toks = base.split(' ');
    const last = toks[toks.length - 1].toLowerCase();
    if (toks.length > 1 && DEVICE_UNITS.includes(last)) { unit = toks.pop(); base = toks.join(' '); }
  }
  return { base, unit };
}
function deviceTestKey(device, label) {
  const slug = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return device.prefix + '_' + (slug || 'metric');
}
function deviceTestFor(device, label) {
  const key = deviceTestKey(device, label);
  let test = db.customTests.find(t => t.key === key);
  if (!test) {
    const parts = deviceMetricParts(label);
    test = {
      key,
      name: device.name + ' · ' + parts.base + (parts.unit ? ' (' + parts.unit + ')' : ''),
      unit: parts.unit, kind: 'measure',
      better: /asym/i.test(label) ? 'lower' : 'higher',
    };
    db.customTests.push(test);
  }
  return test;
}
/* One test day per device + date, found or created. Repeat imports
   of the same export reuse the day (and upsertResult overwrites the
   same athlete + test), so importing twice never duplicates. */
function deviceTestDayFor(device, date, testKeys) {
  let day = db.testDays.find(d => d.device === device.id && d.date === date);
  if (!day) {
    day = {
      id: crypto.randomUUID(), date,
      title: device.name + ' — ' + date,
      testKeys: [], device: device.id,
      createdAt: new Date().toISOString(),
    };
    db.testDays.push(day);
  }
  for (const k of testKeys) if (!day.testKeys.includes(k)) day.testKeys.push(k);
  return day;
}
/* File validated rows ({ profileId, date, metrics }) for one
   device. Returns { filed, skipped, results }: a row files when its
   athlete exists, its date parses, and it carries at least one
   finite number; anything else is counted as skipped — visible to
   the coach in the response, never dropped silently. */
function fileDeviceRows(device, rows, userId) {
  let filed = 0, skipped = 0, results = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row && typeof row === 'object' ? row : {};
    const prof = profileById(clean(r.profileId, 80));
    const date = parseDeviceDate(r.date);
    const entries = (isPlainObj(r.metrics) ? Object.entries(r.metrics) : [])
      .map(([label, v]) => [label, num(v)])
      .filter(([, v]) => v !== null);
    if (!prof || !date || !entries.length) { skipped++; continue; }
    const tests = entries.map(([label]) => deviceTestFor(device, label));
    const day = deviceTestDayFor(device, date, tests.map(t => t.key));
    entries.forEach(([label, v], i) => {
      upsertResult(prof, day, tests[i].key,
        { value: v, weight: null, reps: null, est1rm: null }, userId);
      results++;
    });
    filed++;
  }
  return { filed, skipped, results };
}
/* Parse + map a device CSV WITHOUT writing anything: the coach
   reviews the matches, maps the rows the file could not name, and
   only a separate commit files data. */
function previewDeviceCsv(device, csvText) {
  const rows = parseCsv(csvText).filter(r => r.some(c => String(c).trim() !== ''));
  if (!rows.length) return { error: 'That file looks empty.' };
  if (rows.length - 1 > 2000) {
    return { error: 'That file has more than 2,000 data rows — split it and import in parts.' };
  }
  const headers = rows[0].map(h => String(h || '').replace(/\s+/g, ' ').trim());
  const norm = headers.map(normalizeHeader);
  const nameIdx = norm.findIndex(h => DEVICE_NAME_HEADERS.includes(h));
  if (nameIdx < 0) {
    return { error: 'That file has no athlete name column — the import needs a column headed Name or Athlete.' };
  }
  const dateIdx = norm.findIndex(h => DEVICE_DATE_HEADERS.includes(h));
  if (dateIdx < 0) {
    return { error: 'That file has no date column — the import needs a column headed Date, Test Date, or Session Date.' };
  }
  /* Metric columns: every other column that carries at least one
     number somewhere in the file — recognized VALD headers and
     unknown ones alike. An unrecognized numeric column is captured
     under its own header name, never discarded; a text-only column
     (a notes or team column) is not a metric. Duplicate headers:
     the first column wins. */
  const seenLabels = new Set();
  const metricCols = [];
  headers.forEach((h, i) => {
    if (i === nameIdx || i === dateIdx || !h || seenLabels.has(h)) return;
    if (!rows.slice(1).some(r => deviceMetricValue(r[i]) !== null)) return;
    seenLabels.add(h);
    metricCols.push({ idx: i, label: h });
  });
  const out = { columns: headers, rows: [], errors: [] };
  rows.slice(1).forEach((cells, i) => {
    const rowIndex = i + 1;
    const rawName = String(cells[nameIdx] || '').trim();
    if (!rawName) {
      out.errors.push({ rowIndex, rawName: '', reason: 'No athlete name in this row.' });
      return;
    }
    const date = parseDeviceDate(cells[dateIdx]);
    if (!date) {
      out.errors.push({
        rowIndex, rawName,
        reason: 'Unrecognized date "' + String(cells[dateIdx] || '').trim()
          + '" — dates must be YYYY-MM-DD or M/D/YYYY.',
      });
      return;
    }
    const metrics = {};
    for (const mc of metricCols) {
      const v = deviceMetricValue(cells[mc.idx]);
      if (v !== null) metrics[mc.label] = v;
    }
    if (!Object.keys(metrics).length) {
      out.errors.push({ rowIndex, rawName, reason: 'No test numbers in this row.' });
      return;
    }
    const match = matchProfileByName(rawName);
    const row = {
      rowIndex, rawName, date,
      profileId: match.profile ? match.profile.id : null,
      matchStatus: match.profile ? 'matched' : 'unmatched',
      metrics,
    };
    if (match.ambiguous) {
      row.matchNote = 'More than one athlete on the roster has this name — map the row by hand.';
    }
    out.rows.push(row);
  });
  return out;
}
/* One device's sessions for one athlete, oldest first: a session is
   a device test day on which the athlete has at least one result. */
function deviceSessionsFor(profileId, deviceId) {
  const dayById = new Map();
  for (const d of db.testDays) if (d.device === deviceId) dayById.set(d.id, d);
  if (!dayById.size) return [];
  const byDay = new Map();
  for (const r of db.testResults[profileId] || []) {
    const day = dayById.get(r.testDayId);
    if (!day) continue;
    const v = displayValue(r);
    if (v === null || v === undefined) continue;
    if (!byDay.has(day.id)) byDay.set(day.id, { dayId: day.id, date: day.date, metrics: [] });
    const test = findTest(r.testKey);
    byDay.get(day.id).metrics.push({
      testKey: r.testKey, name: test ? test.name : r.testKey, value: v,
    });
  }
  return [...byDay.values()].filter(s => s.metrics.length)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
/* The NordBord left/right max-force pair out of one session, when
   the session carries both sides. The import labels the sides
   however the export did, so they are read off the test names
   ("Max Force Left", "Max Force L", …). */
function nordbordPairFor(session) {
  let left = null, right = null;
  for (const m of session.metrics) {
    const n = m.name.toLowerCase();
    if (!n.includes('max force') && !n.includes('nordic')) continue;
    if (n.includes('left') || /(^|[\s(·])l([\s)]|$)/.test(n)) { if (left === null) left = m.value; }
    else if (n.includes('right') || /(^|[\s(·])r([\s)]|$)/.test(n)) { if (right === null) right = m.value; }
  }
  return left !== null && right !== null ? { left, right } : null;
}
/* The AMS athlete page's Devices strip: the latest session per
   device, only for devices the athlete actually has data on. */
function deviceSummaryFor(profileId) {
  const out = {};
  for (const deviceId of Object.keys(DEVICES)) {
    const sessions = deviceSessionsFor(profileId, deviceId);
    if (!sessions.length) continue;
    const latest = sessions[sessions.length - 1];
    const entry = { date: latest.date, metrics: latest.metrics };
    if (deviceId === 'nordbord') {
      const pair = nordbordPairFor(latest);
      if (pair) { entry.left = pair.left; entry.right = pair.right; }
    }
    out[deviceId] = entry;
  }
  return out;
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
  let s = v === null || v === undefined ? '' : String(v);
  /* A text cell starting with = + - @ is a formula when the export is
     opened in Excel/Sheets — an athlete named "=2+5" must stay text. */
  if (typeof v === 'string' && /^\s*[=+\-@]/.test(s)) s = "'" + s;
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

/* ------------------------------------------------------------------ */
/* Backup export / import (the Data page)                              */
/* ------------------------------------------------------------------ */
/* A backup carries the coach's team data ONLY — never user accounts,
   password hashes, or the session secret — so the file is safe to
   keep anywhere. The collections are the whole team-data store minus
   accounts (users) and the per-account practice logs (logs / swaps,
   which belong to individual logins, not the team dataset). */
const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/* Id-keyed collections and the field their records upsert by.
   customTests / customWeeklyMetrics are keyed by `key`, not `id`;
   coachInvites is a plain list of emails and merges as a set. */
const BACKUP_ARRAY_KEYS = {
  groups: 'id', profiles: 'id', customTests: 'key', testDays: 'id',
  customWeeklyMetrics: 'key', inventory: 'id', meetResults: 'id',
  meets: 'id', meetEntries: 'id', schoolRecords: 'id', goals: 'id',
  customWorkouts: 'id', programs: 'id', programApplications: 'id',
  announcements: 'id',
};
/* Keyed-object collections: these merge leaf by leaf (see
   mergeLeaves), so a restore touches only the paths it names. */
const BACKUP_OBJECT_KEYS = [
  'overrides', 'completions', 'testResults', 'weekly', 'concerns',
  'mediaOverrides', 'warmupCardEdits', 'athleteLinks', 'checkins',
  'attendance', 'coachNotes',
];
function buildBackupData() {
  return {
    groups: db.groups, profiles: db.profiles, overrides: db.overrides,
    completions: db.completions, customTests: db.customTests,
    testDays: db.testDays, testResults: db.testResults,
    customWeeklyMetrics: db.customWeeklyMetrics, weekly: db.weekly,
    concerns: db.concerns, mediaOverrides: db.mediaOverrides,
    inventory: db.inventory, warmupCardEdits: db.warmupCardEdits,
    meetResults: db.meetResults, meets: db.meets,
    meetEntries: db.meetEntries, schoolRecords: db.schoolRecords,
    goals: db.goals, coachInvites: db.coachInvites,
    athleteLinks: db.athleteLinks, checkins: db.checkins,
    attendance: db.attendance, coachNotes: db.coachNotes,
    customWorkouts: db.customWorkouts,
    customWorkoutsSeeded: db.customWorkoutsSeeded === true,
    programs: db.programs, programApplications: db.programApplications,
    announcements: db.announcements,
  };
}
/* Validate an import payload's data object WITHOUT touching the
   store: every collection present must match the shape migrate()
   expects (list vs object), and every record in a list must carry
   its upsert key. Returns an error string, or null when the payload
   is safe to merge. Unknown keys are not an error — the merge
   ignores them, so they are ignored here too. */
function validateBackupData(data) {
  for (const [k, keyField] of Object.entries(BACKUP_ARRAY_KEYS)) {
    if (data[k] === undefined) continue;
    if (!Array.isArray(data[k])) return 'The backup\'s "' + k + '" should be a list.';
    for (const rec of data[k]) {
      if (!isPlainObj(rec) || typeof rec[keyField] !== 'string' || !rec[keyField]) {
        return 'A record in "' + k + '" is missing its ' + keyField + ' — the file looks damaged.';
      }
    }
  }
  if (data.coachInvites !== undefined
    && (!Array.isArray(data.coachInvites)
      || data.coachInvites.some(e => typeof e !== 'string'))) {
    return 'The backup\'s "coachInvites" should be a list of emails.';
  }
  for (const k of BACKUP_OBJECT_KEYS) {
    if (data[k] === undefined) continue;
    if (!isPlainObj(data[k])) return 'The backup\'s "' + k + '" should be an object.';
  }
  if (data.customWorkoutsSeeded !== undefined
    && typeof data.customWorkoutsSeeded !== 'boolean') {
    return 'The backup\'s "customWorkoutsSeeded" should be true or false.';
  }
  return null;
}
/* Merge one keyed-object collection leaf by leaf: where both sides
   hold a plain object at the same path the merge recurses, and any
   other imported value replaces the leaf at its path. Leaves the
   import never mentions survive untouched — an import deletes
   nothing, ever. Counts track leaf writes: a path that did not exist
   is an add; a path whose value changed is an update. */
function mergeLeaves(target, source, counts) {
  for (const [k, v] of Object.entries(source)) {
    const cur = target[k];
    if (isPlainObj(v) && isPlainObj(cur)) { mergeLeaves(cur, v, counts); continue; }
    if (cur === undefined) { target[k] = v; counts.added++; }
    else if (JSON.stringify(cur) !== JSON.stringify(v)) { target[k] = v; counts.updated++; }
  }
}
/* Merge a validated backup into the live store (never a replace:
   records absent from the file stay exactly as they are). Arrays
   upsert by their key field; keyed objects merge at the leaf level;
   coachInvites union as a set of emails. */
function mergeBackupData(data) {
  const counts = {};
  let totalAdded = 0, totalUpdated = 0;
  const tally = (k, c) => { counts[k] = c; totalAdded += c.added; totalUpdated += c.updated; };
  for (const [k, keyField] of Object.entries(BACKUP_ARRAY_KEYS)) {
    if (data[k] === undefined) continue;
    const c = { added: 0, updated: 0 };
    const byKey = new Map(db[k].map(rec => [rec[keyField], rec]));
    for (const rec of data[k]) {
      const existing = byKey.get(rec[keyField]);
      if (!existing) {
        db[k].push(rec); byKey.set(rec[keyField], rec); c.added++;
      } else if (JSON.stringify(existing) !== JSON.stringify(rec)) {
        db[k][db[k].indexOf(existing)] = rec;
        byKey.set(rec[keyField], rec);
        c.updated++;
      }
    }
    tally(k, c);
  }
  if (data.coachInvites !== undefined) {
    const c = { added: 0, updated: 0 };
    for (const email of data.coachInvites) {
      const norm = String(email).trim().toLowerCase();
      if (norm && !db.coachInvites.includes(norm)) { db.coachInvites.push(norm); c.added++; }
    }
    tally('coachInvites', c);
  }
  for (const k of BACKUP_OBJECT_KEYS) {
    if (data[k] === undefined) continue;
    const c = { added: 0, updated: 0 };
    mergeLeaves(db[k], data[k], c);
    tally(k, c);
  }
  if (data.customWorkoutsSeeded !== undefined) {
    const c = { added: 0, updated: 0 };
    if (db.customWorkoutsSeeded !== data.customWorkoutsSeeded) {
      db.customWorkoutsSeeded = data.customWorkoutsSeeded;
      c.updated = 1;
    }
    tally('customWorkoutsSeeded', c);
  }
  return { counts, totalAdded, totalUpdated };
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
/* readBody with a caller-chosen cap and a status-tagged oversize
   failure, for the one endpoint whose legitimate payloads dwarf the
   256 KB default: backup imports. Oversize rejects with status 413;
   the stream is still drained (chunks discarded past the cap) so the
   client receives its response instead of a reset connection. */
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0, over = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { over = true; chunks.length = 0; return; }
      if (!over) chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) {
        const err = new Error('body too large');
        err.status = 413;
        return reject(err);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error('bad json')); }
    });
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
    return sendJson(res, 200, Object.assign({}, CONTENT, { videoUpload: VIDEO_UPLOAD }));
  }

  /* Warm-up card edits are public to read (the cards themselves are
     public) — only cards a coach has edited appear here. */
  if (p === '/api/warmup-cards' && req.method === 'GET') {
    return sendJson(res, 200, { cards: db.warmupCardEdits });
  }

  /* School record board reads are public like other content reads —
     the board is program history, on display for students. Writes
     are coach-only (below the coach gate). */
  if (p === '/api/record-events' && req.method === 'GET') {
    return sendJson(res, 200, { events: RECORD_EVENTS.map(recordEventView) });
  }

  if (p === '/api/records' && req.method === 'GET') {
    const evParam = clean(q.get('event') || '', 30);
    const records = db.schoolRecords
      .filter(r => !evParam || r.event === evParam)
      .slice()
      .sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1
        : (a.createdAt < b.createdAt ? -1 : 1)))
      .map(publicRecord);
    return sendJson(res, 200, { records });
  }

  if (p === '/api/records/board' && req.method === 'GET') {
    // One entry per record event, each with its ranked top 10
    // (empty until a coach adds real marks).
    const board = RECORD_EVENTS.map(ev => ({
      event: ev.key, name: ev.name, type: ev.type,
      better: ev.type === 'time' ? 'lower' : 'higher',
      relay: RECORD_ONLY_EVENTS.some(e => e.key === ev.key),
      entries: rankedRecords(ev.key, 10).map((r, i) =>
        Object.assign(publicRecord(r), { rank: i + 1 })),
    }));
    return sendJson(res, 200, { board });
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
      profileId: null,
    };
    // If a coach already linked this email to a roster profile, the
    // new account is born bound to it (daily check-in works at once).
    const linkPid = db.athleteLinks[email];
    if (linkPid && profileById(linkPid)) user.profileId = linkPid;
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
    if (!parseDateStr(date)) {
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

  /* ---------- daily wellness check-in (athlete-entered) ----------
     The one thing an athlete writes about the team: how they slept,
     how sore they are, their energy — once a day. It only works for
     an account a coach has linked to a roster profile; the profile
     always comes from the caller's own binding, never from the
     request, so writing (or reading) anyone else's check-in is
     impossible by construction. */
  if (p === '/api/checkin/today' && req.method === 'GET') {
    const prof = linkedProfileFor(user);
    const date = todayStr();
    if (!prof) return sendJson(res, 200, { linked: false, date, checkin: null });
    const entry = (db.checkins[prof.id] || {})[date] || null;
    return sendJson(res, 200, {
      linked: true, profileId: prof.id,
      athleteName: prof.firstName + ' ' + prof.lastName,
      date, checkin: entry ? publicCheckin(entry) : null,
    });
  }

  if (p === '/api/checkin/mine' && req.method === 'GET') {
    const prof = linkedProfileFor(user);
    if (!prof) return sendJson(res, 200, { linked: false, entries: [], streak: 0 });
    const entries = Object.values(db.checkins[prof.id] || {})
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 7)
      .map(publicCheckin);
    return sendJson(res, 200, { linked: true, entries, streak: checkinStreak(prof.id) });
  }

  if (p === '/api/checkin' && req.method === 'POST') {
    const prof = linkedProfileFor(user);
    if (prof && prof.archived) {
      return sendJson(res, 403, {
        error: 'This roster profile is archived. Ask your coach to restore it before checking in.',
        notLinked: false,
      });
    }
    if (!prof) {
      return sendJson(res, 403, {
        error: 'Your account is not linked to the team roster yet. Ask your coach to link it (they do it from Roster & Groups), then you can check in.',
        notLinked: true,
      });
    }
    const body = await readBody(req);
    const date = body.date !== undefined ? clean(body.date, 10) : todayStr();
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    if (date > todayStr()) return sendJson(res, 400, { error: 'You cannot check in for a day that has not happened yet.' });
    const v = validateCheckin(body);
    if (v.error) return sendJson(res, 400, { error: v.error });
    if (date < addDaysStr(todayStr(), -14)) {
      return sendJson(res, 400, { error: 'Check-ins can only be logged or changed within the last two weeks.' });
    }
    const f = v.fields;
    db.checkins[prof.id] = db.checkins[prof.id] || {};
    const existing = db.checkins[prof.id][date] || null;
    const now = new Date().toISOString();
    const entry = existing || {
      profileId: prof.id, date, concernId: null, createdAt: now,
    };
    Object.assign(entry, {
      sleep: f.sleep, soreness: f.soreness, energy: f.energy,
      hurts: f.hurts, painText: f.hurts ? f.painText : '',
      note: f.note, updatedAt: now,
    });
    /* Pain integration: "something hurts" + words files ONE
       athlete-reported concern per check-in day. Re-submitting the
       same day updates that same concern's text instead of filing a
       second one. If the athlete edits the report away, the linked
       concern is removed too — but only while a coach has not
       picked it up yet (status still 'new'); once it is being
       monitored, the record stands on its own. */
    if (f.hurts) {
      let concern = entry.concernId
        ? (db.concerns[prof.id] || []).find(c => c.id === entry.concernId)
        : null;
      if (concern && concern.status === 'cleared') concern = null;
      if (concern) {
        concern.note = f.painText;
        concern.updatedAt = now;
      } else {
        entry.concernId = createAthleteConcern(prof, date, f.painText, user.id);
      }
    } else if (entry.concernId) {
      const list = db.concerns[prof.id] || [];
      const idx = list.findIndex(c => c.id === entry.concernId);
      if (idx >= 0 && list[idx].status === 'new') {
        list.splice(idx, 1);
        entry.concernId = null;
      } else if (idx < 0) {
        entry.concernId = null;
      }
      /* A concern a coach is already monitoring keeps its link, so
         re-flagging later updates it instead of filing a duplicate. */
    }
    db.checkins[prof.id][date] = entry;
    saveDb();
    return sendJson(res, existing ? 200 : 201, {
      ok: true, created: !existing, checkin: publicCheckin(entry),
    });
  }

  /* ---------- athlete goals (read-only, own goals only) ----------
     Targets are coach-set; a linked athlete reads their own, with
     progress computed from their meet results. The profile always
     comes from the caller's own binding, never from the request,
     so another athlete's goals are unreachable by construction. */
  if (p === '/api/goals/mine' && req.method === 'GET') {
    const prof = linkedProfileFor(user);
    if (!prof) return sendJson(res, 200, { linked: false, goals: [] });
    return sendJson(res, 200, {
      linked: true, profileId: prof.id,
      athleteName: prof.firstName + ' ' + prof.lastName,
      goals: goalsForProfile(prof.id),
    });
  }

  /* ---------- coach announcements (the read side) ----------
     One-way posts from the coaching staff. Everyone signed in
     reads the feed; the server filters it per caller (coaches see
     all, athletes see the whole-team posts plus their own group's
     — see announcementVisibleTo). The writes live in the coach
     section below, behind the coach gate, so an athlete's POST /
     PUT / DELETE lands on the same 403 as every other write. */
  if (p === '/api/announcements' && req.method === 'GET') {
    return sendJson(res, 200, { announcements: announcementsFor(user) });
  }

  /* ---------- team leaderboard (everyone signed in) ----------
     Performance only: the team's best testing numbers and meet
     PRs, ranked — computed per request by leaderboardData from
     the shared helpers. Athletes seeing teammates' marks is the
     point of the surface; nothing private rides along, and there
     is no write side at all. */
  if (p === '/api/leaderboard' && req.method === 'GET') {
    return sendJson(res, 200, leaderboardData());
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
    if (!user.isOwner) {
      return sendJson(res, 403, { error: 'Only the head coach can change account roles.' });
    }
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
    if (!removedInvite) {
      return sendJson(res, 404, { error: 'That email has no invite to remove. To remove a coach account, use the role control in Coach Accounts.' });
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
    if (profileNameTaken(firstName, lastName, null)) {
      return sendJson(res, 409, { error: 'An athlete with that name is already on the roster.' });
    }
    const gid = body.groupId ? clean(body.groupId, 80) : null;
    if (gid && !groupById(gid)) return sendJson(res, 400, { error: 'Unknown group.' });
    let status = 'active';
    if (body.status !== undefined) {
      status = clean(body.status, 20);
      if (!PROFILE_STATUSES.includes(status)) {
        return sendJson(res, 400, { error: 'Status must be active, injured, or inactive.' });
      }
    }
    const prof = {
      id: crypto.randomUUID(), firstName, lastName,
      groupId: gid, events: cleanEvents(body.events),
      topAthlete: !!body.topAthlete, archived: false, status,
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
    if (body.status !== undefined && !PROFILE_STATUSES.includes(clean(body.status, 20))) {
      return sendJson(res, 400, { error: 'Status must be active, injured, or inactive.' });
    }
    const nextFirst = body.firstName !== undefined ? (clean(body.firstName, 40) || prof.firstName) : prof.firstName;
    const nextLast = body.lastName !== undefined ? (clean(body.lastName, 40) || prof.lastName) : prof.lastName;
    if ((nextFirst !== prof.firstName || nextLast !== prof.lastName)
      && profileNameTaken(nextFirst, nextLast, prof.id)) {
      return sendJson(res, 409, { error: 'Another athlete on the roster already has that name.' });
    }
    prof.firstName = nextFirst;
    prof.lastName = nextLast;
    if (body.groupId !== undefined) {
      const gid = body.groupId ? clean(body.groupId, 80) : null;
      if (gid && !groupById(gid)) return sendJson(res, 400, { error: 'Unknown group.' });
      prof.groupId = gid;
    }
    if (body.events !== undefined) prof.events = cleanEvents(body.events);
    if (body.topAthlete !== undefined) prof.topAthlete = !!body.topAthlete;
    if (body.archived !== undefined) prof.archived = !!body.archived;
    if (body.status !== undefined) prof.status = clean(body.status, 20);
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

  /* ---------- athlete account links (coach-managed) ----------
     Attach an email to a roster profile and that athlete's account
     is bound to the profile: an existing account binds on the spot,
     a future registration with that email is born bound. One email
     links to exactly one profile, and one profile carries one
     email — re-linking a profile replaces its old email. Unlinking
     keeps the account; it just loses the binding (and with it,
     check-in access) on the next request. */
  const profileLinkMatch = p.match(/^\/api\/profiles\/([^/]+)\/link$/);
  if (profileLinkMatch && req.method === 'PUT') {
    const prof = profileById(decodeURIComponent(profileLinkMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const body = await readBody(req);
    const email = clean(body.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    }
    const holder = db.athleteLinks[email];
    if (holder && holder !== prof.id) {
      return sendJson(res, 409, { error: 'That email is already linked to another athlete on the roster.' });
    }
    for (const e of Object.keys(db.athleteLinks)) {
      if (db.athleteLinks[e] === prof.id) delete db.athleteLinks[e];
    }
    db.athleteLinks[email] = prof.id;
    const acct = userByEmail(email);
    if (acct) acct.profileId = prof.id;
    saveDb();
    return sendJson(res, 200, {
      ok: true, email, accountLinked: !!acct, profile: publicProfile(prof),
    });
  }
  if (profileLinkMatch && req.method === 'DELETE') {
    const prof = profileById(decodeURIComponent(profileLinkMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    let wasLinked = false;
    for (const e of Object.keys(db.athleteLinks)) {
      if (db.athleteLinks[e] === prof.id) { delete db.athleteLinks[e]; wasLinked = true; }
    }
    for (const u of db.users) if (u.profileId === prof.id) u.profileId = null;
    saveDb();
    return sendJson(res, 200, { ok: true, wasLinked, profile: publicProfile(prof) });
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
    if (!a.sessionId && a.isOff) {
      return sendJson(res, 400, { error: 'That day is an off day in the plan — there is no session to mark complete.' });
    }
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
    const boardOnly = q.get('board') === '1';
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
      healthFlags: boardOnly ? [] : healthFlags,
      wellness: boardOnly ? null : wellnessTodaySummary(),
    });
  }

  /* ---------- attendance (coach roll-book) ----------
     One mark per athlete per day — present, late, excused, absent —
     entered by the coach only. Attendance is its own record: it
     never touches assignments or completions, and it never reaches
     an athlete-facing payload (these endpoints live below the coach
     gate, and the TV board never reads them). Dates are unbounded
     beyond sane parsing: past days can be fixed up, future days can
     be pre-marked. */
  const ATTENDANCE_STATUSES = ['present', 'late', 'excused', 'absent'];
  function attendanceCountsFor(date, memberIds) {
    const marks = db.attendance[date] || {};
    const counts = { present: 0, late: 0, excused: 0, absent: 0, unmarked: 0 };
    for (const id of memberIds) {
      const rec = marks[id];
      if (rec && ATTENDANCE_STATUSES.includes(rec.status)) counts[rec.status]++;
      else counts.unmarked++;
    }
    return counts;
  }
  /* The summary windows and their per-athlete counting, shared by
     the summary endpoint and the AMS profile page so both read the
     same numbers: last 30 days ending today, and season-to-date
     (the season opens on the plan's first week). Attended counts
     present + late; the percentage runs over marked days only —
     unmarked days never count against an athlete (null when the
     athlete has no marks in the window at all). */
  function attendanceWindows() {
    const today = todayStr();
    const seasonStart = (CONTENT.weeks && CONTENT.weeks.length && CONTENT.weeks[0].start)
      || addDaysStr(today, -29);
    return {
      today,
      last30: { from: addDaysStr(today, -29), to: today },
      season: { from: seasonStart, to: today },
    };
  }
  function attendanceCountsInWindow(profileId, win) {
    const counts = { marked: 0, present: 0, late: 0, excused: 0, absent: 0, attended: 0, percent: null };
    for (const date of Object.keys(db.attendance)) {
      if (date < win.from || date > win.to) continue;
      const rec = db.attendance[date][profileId];
      if (!rec || !ATTENDANCE_STATUSES.includes(rec.status)) continue;
      counts.marked++;
      counts[rec.status]++;
    }
    counts.attended = counts.present + counts.late;
    counts.percent = counts.marked ? Math.round((counts.attended / counts.marked) * 1000) / 10 : null;
    return counts;
  }
  /* An athlete's most recent attendance marks, newest first. */
  function attendanceRecentMarks(profileId, limit) {
    const out = [];
    for (const date of Object.keys(db.attendance).sort().reverse()) {
      const rec = db.attendance[date][profileId];
      if (rec && ATTENDANCE_STATUSES.includes(rec.status)) {
        out.push({ date, status: rec.status });
      }
      if (out.length >= limit) break;
    }
    return out;
  }
  if (p === '/api/attendance' && req.method === 'GET') {
    const date = clean(q.get('date') || todayStr(), 10);
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    const marks = db.attendance[date] || {};
    const blockFor = (g) => {
      const members = db.profiles.filter(pr => !pr.archived && (g ? pr.groupId === g.id : !pr.groupId));
      return {
        group: g ? { id: g.id, name: g.name } : null,
        members: members.map(pr => ({
          profile: publicProfile(pr),
          attendance: marks[pr.id]
            ? { status: marks[pr.id].status, updatedAt: marks[pr.id].updatedAt, updatedBy: marks[pr.id].updatedBy }
            : null,
        })),
      };
    };
    const active = db.profiles.filter(pr => !pr.archived);
    return sendJson(res, 200, {
      date,
      counts: attendanceCountsFor(date, active.map(pr => pr.id)),
      groups: db.groups.map(blockFor),
      unassigned: blockFor(null),
    });
  }

  const attRoute = p.match(/^\/api\/attendance\/([^/]+)\/([^/]+)$/);
  if (attRoute && req.method === 'POST' && attRoute[2] === 'mark-all-present') {
    const date = attRoute[1];
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    db.attendance[date] = db.attendance[date] || {};
    let marked = 0, skipped = 0;
    for (const pr of db.profiles) {
      if (pr.archived) continue;
      if (db.attendance[date][pr.id]) { skipped++; continue; }
      db.attendance[date][pr.id] = { status: 'present', updatedAt: new Date().toISOString(), updatedBy: user.id };
      marked++;
    }
    saveDb();
    return sendJson(res, 200, { ok: true, date, marked, skipped });
  }
  if (attRoute && req.method === 'PUT') {
    const date = attRoute[1];
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    const prof = profileById(decodeURIComponent(attRoute[2]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const body = await readBody(req);
    if (body.status === null || body.status === undefined) {
      if (db.attendance[date]) {
        delete db.attendance[date][prof.id];
        if (!Object.keys(db.attendance[date]).length) delete db.attendance[date];
      }
      saveDb();
      return sendJson(res, 200, { ok: true, cleared: true, date, profileId: prof.id });
    }
    const status = clean(body.status, 20);
    if (!ATTENDANCE_STATUSES.includes(status)) {
      return sendJson(res, 400, { error: 'Status must be present, late, excused, or absent — or null to clear.' });
    }
    db.attendance[date] = db.attendance[date] || {};
    const rec = { status, updatedAt: new Date().toISOString(), updatedBy: user.id };
    db.attendance[date][prof.id] = rec;
    saveDb();
    return sendJson(res, 200, { ok: true, date, profileId: prof.id, attendance: rec });
  }

  /* Per-athlete attendance over trailing windows: the last 30 days
     and season-to-date by default (the season opens on the plan's
     first week), plus an exact custom window when ?from&to are
     given — the shape the future AMS layer reuses. Attended counts
     present + late; the percentage runs over marked days only, so
     unmarked days never count against an athlete (null when an
     athlete has no marks in the window at all). */
  if (p === '/api/attendance/summary' && req.method === 'GET') {
    const aw = attendanceWindows();
    const today = aw.today;
    const windows = { last30: aw.last30, season: aw.season };
    const customFrom = clean(q.get('from') || '', 10);
    const customTo = clean(q.get('to') || '', 10);
    if (customFrom || customTo) {
      if (!parseDateStr(customFrom) || !parseDateStr(customTo) || customFrom > customTo) {
        return sendJson(res, 400, { error: 'A custom window needs from and to as YYYY-MM-DD, from on or before to.' });
      }
      windows.custom = { from: customFrom, to: customTo };
    }
    const athletes = db.profiles.filter(pr => !pr.archived).map(pr => {
      const row = { profile: publicProfile(pr) };
      for (const key of Object.keys(windows)) row[key] = attendanceCountsInWindow(pr.id, windows[key]);
      return row;
    });
    return sendJson(res, 200, { today, windows, athletes });
  }

  /* ---------- AMS (athlete management system) ----------
     The coach-side home for everything the app holds on one
     athlete: a roster table with coach-set status and computed
     attention flags, one aggregate page per athlete (wellness,
     testing, meet PRs, attendance, health, goals), and a private
     coach-notes thread. Everything here sits below the coach
     gate: athletes get 403, logged-out 401. Notes in particular
     are coach-only data — they are served ONLY by these endpoints
     and are never folded into any athlete-facing payload, the TV
     board, or an export. */
  if (p === '/api/ams/roster' && req.method === 'GET') {
    const today = todayStr();
    const includeArchived = q.get('includeArchived') === '1';
    const athletes = db.profiles
      .filter(pr => includeArchived || !pr.archived)
      .slice()
      .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName))
      .map(pr => {
        const pub = publicProfile(pr);
        return {
          profile: pub,
          status: pub.status,
          linked: !!pub.linkedEmail,
          flags: amsFlagsFor(pr, today),
        };
      });
    return sendJson(res, 200, { today, athletes });
  }

  const amsAthleteMatch = p.match(/^\/api\/ams\/athlete\/([^/]+)$/);
  if (amsAthleteMatch && req.method === 'GET') {
    const prof = profileById(decodeURIComponent(amsAthleteMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const today = todayStr();
    /* Wellness: the last 14 days of check-ins, oldest first, with
       the window's averages and flagged-day count (checkinFlags,
       the same rules as everywhere else). */
    const byDate = db.checkins[prof.id] || {};
    const recent = [];
    for (let i = 13; i >= 0; i--) {
      const c = byDate[addDaysStr(today, -i)];
      if (c) recent.push(publicCheckin(c));
    }
    const avgOf = (key) => (recent.length
      ? round2(recent.reduce((s, c) => s + c[key], 0) / recent.length) : null);
    const wellness = {
      recent,
      summary: {
        days: recent.length,
        avgSleep: avgOf('sleep'), avgSoreness: avgOf('soreness'), avgEnergy: avgOf('energy'),
        flaggedDays: recent.filter(c => c.flags.length).length,
      },
    };
    const aw = attendanceWindows();
    const attendance = {
      last30: attendanceCountsInWindow(prof.id, aw.last30),
      season: attendanceCountsInWindow(prof.id, aw.season),
      recent: attendanceRecentMarks(prof.id, 10),
    };
    const concerns = (db.concerns[prof.id] || []).slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const healthCounts = { open: 0, monitoring: 0, cleared: 0, total: concerns.length };
    for (const c of concerns) {
      if (c.status === 'new') healthCounts.open++;
      else if (c.status === 'monitoring') healthCounts.monitoring++;
      else if (c.status === 'cleared') healthCounts.cleared++;
    }
    const recentResults = db.meetResults
      .filter(r => r.profileId === prof.id)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1
        : (a.createdAt < b.createdAt ? 1 : -1)))
      .slice(0, 10)
      .map(publicMeetResult);
    const notes = (db.coachNotes[prof.id] || []).slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(publicCoachNote);
    const pub = publicProfile(prof);
    return sendJson(res, 200, {
      profile: pub,
      status: pub.status,
      linked: !!pub.linkedEmail,
      linkedEmail: pub.linkedEmail,
      flags: amsFlagsFor(prof, today),
      wellness,
      testing: testingHistoryFor(prof.id),
      devices: deviceSummaryFor(prof.id),
      meetPrs: meetPrsFor(prof.id),
      recentResults,
      attendance,
      health: { counts: healthCounts, concerns },
      goals: goalsForProfile(prof.id),
      notes,
    });
  }

  /* Private coach notes: a per-athlete thread. Any coach on the
     staff can add, edit, or delete; the author is recorded on
     every note. Coach-only by the gate above, and read back only
     through the AMS endpoints. */
  const amsNotesMatch = p.match(/^\/api\/ams\/athlete\/([^/]+)\/notes$/);
  if (amsNotesMatch && req.method === 'POST') {
    const prof = profileById(decodeURIComponent(amsNotesMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const body = await readBody(req);
    const text = clean(body.text, 2000);
    if (!text) return sendJson(res, 400, { error: 'Write the note first.' });
    const now = new Date().toISOString();
    const note = {
      id: crypto.randomUUID(), text,
      authorId: user.id, authorEmail: user.email,
      createdAt: now, updatedAt: now,
    };
    db.coachNotes[prof.id] = db.coachNotes[prof.id] || [];
    db.coachNotes[prof.id].push(note);
    saveDb();
    return sendJson(res, 201, { note: publicCoachNote(note) });
  }
  const amsNoteMatch = p.match(/^\/api\/ams\/athlete\/([^/]+)\/notes\/([^/]+)$/);
  if (amsNoteMatch && req.method === 'PUT') {
    const prof = profileById(decodeURIComponent(amsNoteMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const note = (db.coachNotes[prof.id] || [])
      .find(n => n.id === decodeURIComponent(amsNoteMatch[2]));
    if (!note) return sendJson(res, 404, { error: 'Note not found.' });
    const body = await readBody(req);
    const text = clean(body.text, 2000);
    if (!text) return sendJson(res, 400, { error: 'Write the note first.' });
    note.text = text;
    note.updatedAt = new Date().toISOString();
    saveDb();
    return sendJson(res, 200, { note: publicCoachNote(note) });
  }
  if (amsNoteMatch && req.method === 'DELETE') {
    const prof = profileById(decodeURIComponent(amsNoteMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const list = db.coachNotes[prof.id] || [];
    const next = list.filter(n => n.id !== decodeURIComponent(amsNoteMatch[2]));
    if (next.length === list.length) return sendJson(res, 404, { error: 'Note not found.' });
    db.coachNotes[prof.id] = next;
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- Devices: ForceDecks, NordBord, T-APEX ----------
     Coach-only like everything below the gate. File imports are
     two steps — preview (parse + match, writes NOTHING) and commit
     (file the rows the coach confirmed) — because athlete matching
     is exact-only by design: rows the file cannot name wait for the
     coach to map them by hand in the preview, and rows still
     unmapped at commit are skipped and counted, never guessed. */
  const devicePreviewMatch = p.match(/^\/api\/devices\/([a-z]+)\/preview$/);
  if (devicePreviewMatch && req.method === 'POST') {
    const device = DEVICES[devicePreviewMatch[1]];
    if (!device) return sendJson(res, 404, { error: 'Unknown device.' });
    let body;
    try {
      body = await readJsonBody(req, 5 * 1024 * 1024);
    } catch (err) {
      if (err && err.status === 413) {
        return sendJson(res, 413, { error: 'That file is too large — device exports over 5 MB are not accepted.' });
      }
      return sendJson(res, 400, { error: 'That request was not valid JSON.' });
    }
    const csv = isPlainObj(body) && typeof body.csv === 'string' ? body.csv : '';
    if (!csv.trim()) return sendJson(res, 400, { error: 'Choose a CSV file first.' });
    const preview = previewDeviceCsv(device, csv);
    if (preview.error) return sendJson(res, 400, { error: preview.error });
    return sendJson(res, 200, {
      device: device.id, columns: preview.columns,
      rows: preview.rows, errors: preview.errors,
    });
  }
  const deviceCommitMatch = p.match(/^\/api\/devices\/([a-z]+)\/commit$/);
  if (deviceCommitMatch && req.method === 'POST') {
    const device = DEVICES[deviceCommitMatch[1]];
    if (!device) return sendJson(res, 404, { error: 'Unknown device.' });
    let body;
    try {
      body = await readJsonBody(req, 5 * 1024 * 1024);
    } catch (err) {
      if (err && err.status === 413) {
        return sendJson(res, 413, { error: 'That import is too large.' });
      }
      return sendJson(res, 400, { error: 'That request was not valid JSON.' });
    }
    const rows = isPlainObj(body) && Array.isArray(body.rows) ? body.rows : null;
    if (!rows) return sendJson(res, 400, { error: 'There are no rows to file.' });
    if (rows.length > 2000) {
      return sendJson(res, 400, { error: 'That import has more than 2,000 rows — split it into smaller files.' });
    }
    const out = fileDeviceRows(device, rows, user.id);
    if (out.filed) saveDb();
    return sendJson(res, 200, {
      ok: true, filed: out.filed, skipped: out.skipped, results: out.results,
    });
  }
  const deviceSummaryMatch = p.match(/^\/api\/devices\/([a-z]+)\/summary$/);
  if (deviceSummaryMatch && req.method === 'GET') {
    const device = DEVICES[deviceSummaryMatch[1]];
    if (!device) return sendJson(res, 404, { error: 'Unknown device.' });
    const days = db.testDays.filter(d => d.device === device.id)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 12)
      .map(d => {
        const athletes = new Set();
        let count = 0;
        for (const [pid, list] of Object.entries(db.testResults)) {
          for (const r of list) if (r.testDayId === d.id) { athletes.add(pid); count++; }
        }
        return { id: d.id, date: d.date, title: d.title, athletes: athletes.size, results: count };
      });
    return sendJson(res, 200, { device: device.id, name: device.name, days });
  }

  /* T-APEX quick entry: the device lives on its own tablet with no
     feed, so the coach keys a session in by hand. It files through
     the same path as the importers — a T-APEX test day plus the
     labeled custom tests — so a hand-entered session and an
     imported file read identically everywhere results show. */
  if (p === '/api/devices/tapex/entry' && req.method === 'POST') {
    const body = await readBody(req);
    const prof = profileById(clean(body.profileId, 80));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const date = clean(body.date, 10);
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    const metrics = {};
    for (const m of TAPEX_METRICS) {
      const raw = body[m.field];
      if (raw === undefined || raw === null || raw === '') continue;
      const v = num(raw);
      if (v === null || v < 0) {
        return sendJson(res, 400, {
          error: 'Enter a valid ' + m.label.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase() + '.',
        });
      }
      metrics[m.label] = v;
    }
    if (!Object.keys(metrics).length) {
      return sendJson(res, 400, {
        error: 'Enter at least one number — load, peak speed, max force, or distance.',
      });
    }
    const out = fileDeviceRows(DEVICES.tapex, [{ profileId: prof.id, date, metrics }], user.id);
    saveDb();
    return sendJson(res, 201, { ok: true, filed: out.filed, results: out.results });
  }
  if (p === '/api/devices/tapex/entries' && req.method === 'GET') {
    const days = new Map(db.testDays.filter(d => d.device === 'tapex').map(d => [d.id, d]));
    const byKey = new Map();
    for (const pr of db.profiles) {
      for (const r of db.testResults[pr.id] || []) {
        const day = days.get(r.testDayId);
        if (!day) continue;
        const key = pr.id + '|' + day.id;
        if (!byKey.has(key)) {
          byKey.set(key, {
            profileId: pr.id, athleteName: pr.firstName + ' ' + pr.lastName,
            date: day.date, testDayId: day.id, values: {}, extra: [], resultIds: [],
          });
        }
        const entry = byKey.get(key);
        const tm = TAPEX_METRICS.find(m => deviceTestKey(DEVICES.tapex, m.label) === r.testKey);
        const v = displayValue(r);
        if (tm) entry.values[tm.field] = v;
        else {
          const test = findTest(r.testKey);
          entry.extra.push({ name: test ? test.name : r.testKey, value: v });
        }
        entry.resultIds.push(r.id);
      }
    }
    const entries = [...byKey.values()]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1
        : a.athleteName.localeCompare(b.athleteName)))
      .slice(0, 30);
    return sendJson(res, 200, { entries });
  }

  /* ---------- Data page: backup export / import + more CSVs ---------- */
  if (p === '/api/export/backup' && req.method === 'GET') {
    const body = JSON.stringify({
      app: 'sprinter-workout-app', kind: 'backup', version: 1,
      exportedAt: new Date().toISOString(), data: buildBackupData(),
    }, null, 1);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sprinter-backup-' + todayStr() + '.json"',
      'Content-Length': Buffer.byteLength(body),
    });
    return res.end(body);
  }

  if (p === '/api/import/backup' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req, 10 * 1024 * 1024);
    } catch (err) {
      if (err && err.status === 413) {
        return sendJson(res, 413, { error: 'That file is too large — backups over 10 MB are not accepted.' });
      }
      return sendJson(res, 400, { error: 'That file is not valid JSON.' });
    }
    if (!isPlainObj(body) || body.app !== 'sprinter-workout-app' || body.kind !== 'backup'
      || !isPlainObj(body.data)) {
      return sendJson(res, 400, { error: 'That is not a sprinter app backup file.' });
    }
    /* Everything is validated before anything is merged: a bad
       collection refuses the whole import with the store untouched. */
    const invalid = validateBackupData(body.data);
    if (invalid) return sendJson(res, 400, { error: invalid });
    const merged = mergeBackupData(body.data);
    migrate();
    saveDb();
    return sendJson(res, 200, {
      ok: true, counts: merged.counts,
      totalAdded: merged.totalAdded, totalUpdated: merged.totalUpdated,
    });
  }

  if (p === '/api/export/attendance.csv' && req.method === 'GET') {
    const rows = [['Date', 'Athlete', 'Group', 'Status']];
    const entries = [];
    for (const [date, byProfile] of Object.entries(db.attendance)) {
      for (const [pid, mark] of Object.entries(byProfile || {})) {
        const prof = profileById(pid);
        const pub = prof ? publicProfile(prof) : null;
        entries.push({
          date, name: pub ? pub.name : pid,
          row: [date, pub ? pub.name : pid, pub ? (pub.groupName || '') : '',
            mark && mark.status ? mark.status : ''],
        });
      }
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
    for (const e of entries) rows.push(e.row);
    return sendCsv(res, 'attendance.csv', rows);
  }

  if (p === '/api/export/testing-detail.csv' && req.method === 'GET') {
    const rows = [['Athlete', 'Test Date', 'Test', 'Value', 'Weight (lb)', 'Reps', 'Est. 1RM (lb)']];
    const entries = [];
    for (const pr of db.profiles) {
      const pub = publicProfile(pr);
      for (const r of db.testResults[pr.id] || []) {
        const day = db.testDays.find(d => d.id === r.testDayId);
        const test = findTest(r.testKey);
        entries.push({
          date: day ? day.date : '', name: pub.name, testName: test ? test.name : r.testKey,
          row: [pub.name, day ? day.date : '', test ? test.name : r.testKey,
            numStr(r.value), numStr(r.weight),
            r.reps === null || r.reps === undefined ? '' : String(r.reps), numStr(r.est1rm)],
        });
      }
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1
      : a.name.localeCompare(b.name) || a.testName.localeCompare(b.testName)));
    for (const e of entries) rows.push(e.row);
    return sendCsv(res, 'testing-detail.csv', rows);
  }

  if (p === '/api/export/checkins.csv' && req.method === 'GET') {
    const rows = [['Athlete', 'Date', 'Sleep (hrs)', 'Soreness', 'Energy', 'Something Hurts']];
    const entries = [];
    for (const [pid, byDate] of Object.entries(db.checkins)) {
      const prof = profileById(pid);
      const name = prof ? publicProfile(prof).name : pid;
      for (const [date, c] of Object.entries(byDate || {})) {
        entries.push({
          name, date,
          row: [name, date, numStr(c.sleep),
            c.soreness === null || c.soreness === undefined ? '' : String(c.soreness),
            c.energy === null || c.energy === undefined ? '' : String(c.energy),
            c.hurts ? 'yes' : 'no'],
        });
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name)
      || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const e of entries) rows.push(e.row);
    return sendCsv(res, 'checkins.csv', rows);
  }

  if (p === '/api/export/records.csv' && req.method === 'GET') {
    const rows = [['Event', 'Mark', 'Name', 'Year', 'Meet']];
    const evs = RECORD_EVENTS.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const ev of evs) {
      for (const r of rankedRecords(ev.key, 100000)) {
        rows.push([ev.name, r.mark, r.name,
          r.year === null || r.year === undefined ? '' : String(r.year), r.meet || '']);
      }
    }
    return sendCsv(res, 'school-records.csv', rows);
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
    const better = (body.better === 'lower' || body.better === 'higher')
      ? body.better : (unit === 'sec' ? 'lower' : 'higher');
    const test = { key: 'custom-' + crypto.randomUUID().slice(0, 8), name, unit, kind, better };
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
    const v = validateResultFields(test, body);
    if (v.error) return sendJson(res, 400, { error: v.error });
    const up = upsertResult(prof, day, testKey, v.fields, user.id);
    saveDb();
    return sendJson(res, up.created ? 201 : 200, { result: up.result });
  }

  /* Test-day rapid entry: one save for a whole grid of cells. Every
     cell is validated with the exact rules of the single-result
     endpoint BEFORE anything is written — if any cell is bad, the
     save is refused whole (400 with a per-cell error list) and the
     store is left untouched. `clear` cells remove existing results,
     which is how the grid doubles as the edit path. */
  if (p === '/api/results/bulk' && req.method === 'POST') {
    const body = await readBody(req);
    const day = db.testDays.find(d => d.id === clean(body.testDayId, 80));
    if (!day) return sendJson(res, 404, { error: 'Test day not found.' });
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const clears = Array.isArray(body.clear) ? body.clear : [];
    if (entries.length + clears.length > 4000) {
      return sendJson(res, 400, { error: 'That save is too large — split the grid into smaller saves.' });
    }
    const cellErrors = [];
    const validEntries = [];
    const validClears = [];
    const seenCells = new Set();
    const checkCell = (raw, sink) => {
      const cell = raw && typeof raw === 'object' ? raw : {};
      const profileId = clean(cell.profileId, 80);
      const testKey = clean(cell.testKey, 40);
      const prof = profileById(profileId);
      if (!prof) { cellErrors.push({ profileId, testKey, error: 'Athlete not found.' }); return; }
      const test = findTest(testKey);
      if (!test) { cellErrors.push({ profileId, testKey, error: 'Unknown test.' }); return; }
      const cellKey = profileId + '|' + testKey;
      if (seenCells.has(cellKey)) {
        cellErrors.push({ profileId, testKey, error: 'That cell appears twice in one save.' });
        return;
      }
      seenCells.add(cellKey);
      sink({ prof, test, cell });
    };
    for (const raw of entries) {
      checkCell(raw, ({ prof, test, cell }) => {
        if (!day.testKeys.includes(test.key)) {
          cellErrors.push({ profileId: prof.id, testKey: test.key, error: test.name + ' is not part of that test day.' });
          return;
        }
        const v = validateResultFields(test, cell);
        if (v.error) {
          cellErrors.push({ profileId: prof.id, testKey: test.key, error: v.error });
          return;
        }
        validEntries.push({ prof, testKey: test.key, fields: v.fields });
      });
    }
    for (const raw of clears) {
      checkCell(raw, ({ prof, test }) => {
        validClears.push({ prof, testKey: test.key });
      });
    }
    if (cellErrors.length) {
      return sendJson(res, 400, {
        error: 'Some cells could not be saved, so nothing was written. Fix the highlighted cells and save again.',
        cellErrors,
      });
    }
    let created = 0, updated = 0, cleared = 0;
    const results = [];
    for (const ve of validEntries) {
      const up = upsertResult(ve.prof, day, ve.testKey, ve.fields, user.id);
      if (up.created) created++; else updated++;
      results.push(up.result);
    }
    for (const vc of validClears) {
      const list = db.testResults[vc.prof.id] || [];
      const idx = list.findIndex(r => r.testDayId === day.id && r.testKey === vc.testKey);
      if (idx >= 0) { list.splice(idx, 1); cleared++; }
    }
    saveDb();
    return sendJson(res, 200, {
      ok: true, saved: validEntries.length, created, updated, cleared, results,
    });
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
        const tDef = findTest(r.testKey);
        const isLower = !!tDef && tDef.better === 'lower';
        if (!pbs[r.testKey] || (isLower ? d < pbs[r.testKey].display : d > pbs[r.testKey].display)) {
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
    if (value === null || value < 0 || (value === 0 && metric.better === 'lower')) {
      return sendJson(res, 400, { error: 'Enter a valid number above zero.' });
    }
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
      if (body.status === 'cleared' && found.status !== 'cleared') {
        found.clearedAt = new Date().toISOString();
      }
      if (body.status !== 'cleared') found.clearedAt = null;
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

  /* ---------- daily wellness (coach view of the check-ins) ---------- */
  function wellnessRoster() {
    return db.profiles.filter(pr => !pr.archived)
      .slice()
      .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  }
  function wellnessAvg(rows, key) {
    if (!rows.length) return null;
    return round2(rows.reduce((s, c) => s + c[key], 0) / rows.length);
  }
  if (p === '/api/wellness/today' && req.method === 'GET') {
    const date = todayStr();
    const rows = wellnessRoster().map(pr => {
      const c = (db.checkins[pr.id] || {})[date] || null;
      return {
        profile: publicProfile(pr),
        checkedIn: !!c,
        checkin: c ? publicCheckin(c) : null,
        flags: c ? checkinFlags(c) : [],
      };
    });
    const done = rows.filter(rw => rw.checkedIn).map(rw => rw.checkin);
    return sendJson(res, 200, {
      date,
      summary: {
        total: rows.length,
        checkedIn: done.length,
        participation: rows.length ? Math.round((done.length / rows.length) * 100) : 0,
        flagged: rows.filter(rw => rw.flags.length).length,
        avgSleep: wellnessAvg(done, 'sleep'),
        avgSoreness: wellnessAvg(done, 'soreness'),
        avgEnergy: wellnessAvg(done, 'energy'),
      },
      rows,
    });
  }
  if (p === '/api/wellness/trends' && req.method === 'GET') {
    let days = parseInt(q.get('days') || '7', 10);
    if (!Number.isInteger(days) || days < 1) days = 7;
    if (days > 31) days = 31;
    const dates = [];
    for (let i = days - 1; i >= 0; i--) dates.push(addDaysStr(todayStr(), -i));
    const roster = wellnessRoster();
    const athletes = roster.map(pr => ({
      profile: publicProfile(pr),
      days: dates.map(d => {
        const c = (db.checkins[pr.id] || {})[d] || null;
        return {
          date: d,
          sleep: c ? c.sleep : null, soreness: c ? c.soreness : null, energy: c ? c.energy : null,
          flags: c ? checkinFlags(c) : [],
        };
      }),
    }));
    const team = dates.map(d => {
      const cs = roster.map(pr => (db.checkins[pr.id] || {})[d]).filter(Boolean);
      return {
        date: d, checkedIn: cs.length,
        avgSleep: wellnessAvg(cs, 'sleep'),
        avgSoreness: wellnessAvg(cs, 'soreness'),
        avgEnergy: wellnessAvg(cs, 'energy'),
      };
    });
    return sendJson(res, 200, { days, dates, athletes, team });
  }

  /* ---------- meet results (coach entry only) ---------- */
  if (p === '/api/meet-events' && req.method === 'GET') {
    return sendJson(res, 200, { events: MEET_EVENTS.map(meetEventView) });
  }

  if (p === '/api/meet-results' && req.method === 'GET') {
    const profParam = clean(q.get('profileId') || '', 80);
    if (profParam && !profileById(profParam)) {
      return sendJson(res, 404, { error: 'Profile not found.' });
    }
    const evParam = clean(q.get('event') || '', 30);
    const results = db.meetResults
      .filter(r => !profParam || r.profileId === profParam)
      .filter(r => !evParam || r.event === evParam)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1
        : (a.createdAt < b.createdAt ? 1 : -1)))
      .map(publicMeetResult);
    return sendJson(res, 200, { results });
  }

  if (p === '/api/meet-results' && req.method === 'POST') {
    const body = await readBody(req);
    const v = validateMeetResultInput(body);
    if (v.error) return sendJson(res, v.status, { error: v.error });
    const r = insertMeetResult(v, body.notes, user.id);
    saveDb();
    return sendJson(res, 201, { result: publicMeetResult(r) });
  }

  const meetResultMatch = p.match(/^\/api\/meet-results\/([^/]+)$/);
  if (meetResultMatch && req.method === 'PUT') {
    const r = db.meetResults.find(x => x.id === decodeURIComponent(meetResultMatch[1]));
    if (!r) return sendJson(res, 404, { error: 'Meet result not found.' });
    const body = await readBody(req);
    // Validate the whole update first; a bad field changes nothing.
    const next = {
      profileId: r.profileId, date: r.date, meet: r.meet,
      event: r.event, mark: r.mark, value: r.value, notes: r.notes,
    };
    if (body.profileId !== undefined) {
      const prof = profileById(clean(body.profileId, 80));
      if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
      next.profileId = prof.id;
    }
    if (body.date !== undefined) {
      const d = clean(body.date, 10);
      if (!parseDateStr(d)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
      next.date = d;
    }
    if (body.meet !== undefined) {
      const m = clean(body.meet, 80);
      if (!m) return sendJson(res, 400, { error: 'Name the meet.' });
      next.meet = m;
    }
    if (body.notes !== undefined) next.notes = clean(body.notes, 500);
    if (body.event !== undefined || body.mark !== undefined) {
      const ev = findMeetEvent(clean(body.event !== undefined ? body.event : r.event, 30));
      if (!ev) return sendJson(res, 400, { error: 'Unknown event.' });
      const rawMark = body.mark !== undefined
        ? (typeof body.mark === 'string' ? body.mark.trim().slice(0, 20) : '')
        : r.mark;
      const parsed = parseMeetMark(ev, rawMark);
      if (parsed.error) return sendJson(res, 400, { error: parsed.error });
      next.event = ev.key;
      next.mark = rawMark;
      next.value = parsed.value;
    }
    Object.assign(r, next, { updatedAt: new Date().toISOString() });
    saveDb();
    return sendJson(res, 200, { result: publicMeetResult(r) });
  }
  if (meetResultMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(meetResultMatch[1]);
    if (!db.meetResults.some(r => r.id === id)) {
      return sendJson(res, 404, { error: 'Meet result not found.' });
    }
    db.meetResults = db.meetResults.filter(r => r.id !== id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/meet-results/prs' && req.method === 'GET') {
    const prof = profileById(clean(q.get('profileId') || '', 80));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    return sendJson(res, 200, {
      profileId: prof.id,
      prs: meetPrsFor(prof.id),
      series: meetSeriesFor(prof.id),
    });
  }

  if (p === '/api/meet-results/board' && req.method === 'GET') {
    // Team PR board: the single best mark per event across the active
    // roster, by each event's direction.
    const board = [];
    for (const ev of MEET_EVENTS) {
      let best = null;
      for (const r of db.meetResults) {
        if (r.event !== ev.key) continue;
        const pr = profileById(r.profileId);
        if (!pr || pr.archived) continue;
        if (!best || (ev.type === 'time' ? r.value < best.value : r.value > best.value)) best = r;
      }
      if (best) {
        const pr = profileById(best.profileId);
        board.push({
          event: ev.key, name: ev.name, type: ev.type,
          better: ev.type === 'time' ? 'lower' : 'higher',
          profileId: best.profileId,
          athleteName: pr.firstName + ' ' + pr.lastName,
          mark: best.mark, value: best.value, date: best.date, meet: best.meet,
        });
      }
    }
    return sendJson(res, 200, { board });
  }

  if (p === '/api/export/meet-results.csv' && req.method === 'GET') {
    const rows = [['Date', 'Meet', 'Athlete', 'Group', 'Event', 'Mark']];
    const sorted = db.meetResults.slice().sort((a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const r of sorted) {
      const pr = profileById(r.profileId);
      const pub = pr ? publicProfile(pr) : null;
      const ev = findMeetEvent(r.event);
      rows.push([r.date, r.meet, pub ? pub.name : '', pub ? (pub.groupName || '') : '',
        ev ? ev.name : r.event, r.mark]);
    }
    return sendCsv(res, 'meet-results.csv', rows);
  }

  /* ---------- athlete goals (coach-set target marks) ---------- */
  if (p === '/api/goals' && req.method === 'GET') {
    const profParam = clean(q.get('profileId') || '', 80);
    if (profParam && !profileById(profParam)) {
      return sendJson(res, 400, { error: 'Unknown athlete.' });
    }
    const goals = db.goals
      .filter(g => !profParam || g.profileId === profParam)
      .map(publicGoal);
    return sendJson(res, 200, { goals });
  }

  if (p === '/api/goals' && req.method === 'POST') {
    const body = await readBody(req);
    const v = validateGoalInput(body);
    if (v.error) return sendJson(res, v.status, { error: v.error });
    const now = new Date().toISOString();
    /* One ACTIVE goal per athlete per event: setting a new target
       for a pair that already has one replaces it in place — the
       goal keeps its id and createdAt, only the target moves. */
    const existing = db.goals.find(g => g.profileId === v.prof.id && g.event === v.ev.key);
    if (existing) {
      existing.targetText = v.rawTarget;
      existing.targetValue = v.value;
      existing.updatedAt = now;
      saveDb();
      return sendJson(res, 200, { goal: publicGoal(existing), replaced: true });
    }
    const goal = {
      id: crypto.randomUUID(), profileId: v.prof.id, event: v.ev.key,
      targetText: v.rawTarget, targetValue: v.value, createdAt: now, updatedAt: now,
    };
    db.goals.push(goal);
    saveDb();
    return sendJson(res, 201, { goal: publicGoal(goal), replaced: false });
  }

  const goalMatch = p.match(/^\/api\/goals\/([^/]+)$/);
  if (goalMatch && req.method === 'PUT') {
    const goal = db.goals.find(g => g.id === decodeURIComponent(goalMatch[1]));
    if (!goal) return sendJson(res, 404, { error: 'Goal not found.' });
    const body = await readBody(req);
    /* Validate the whole update into a candidate first; a bad field
       changes nothing — the meet-results pattern. */
    const ev = findMeetEvent(body.event !== undefined ? clean(body.event, 30) : goal.event);
    if (!ev) return sendJson(res, 400, { error: 'Unknown event.' });
    const next = { event: ev.key, targetText: goal.targetText, targetValue: goal.targetValue };
    if (body.event !== undefined || body.target !== undefined) {
      const rawTarget = body.target !== undefined
        ? (typeof body.target === 'string' ? body.target.trim().slice(0, 20) : '')
        : goal.targetText;
      const parsed = parseMeetMark(ev, rawTarget);
      if (parsed.error) return sendJson(res, 400, { error: parsed.error });
      next.targetText = rawTarget;
      next.targetValue = parsed.value;
    }
    /* Keep one active goal per pair: if this edit moves the goal
       onto an event the athlete already targets, that older goal is
       replaced (removed) — the edit the coach just made wins. */
    if (next.event !== goal.event) {
      db.goals = db.goals.filter(g =>
        !(g.profileId === goal.profileId && g.event === next.event && g.id !== goal.id));
    }
    Object.assign(goal, next, { updatedAt: new Date().toISOString() });
    saveDb();
    return sendJson(res, 200, { goal: publicGoal(goal) });
  }
  if (goalMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(goalMatch[1]);
    if (!db.goals.some(g => g.id === id)) {
      return sendJson(res, 404, { error: 'Goal not found.' });
    }
    db.goals = db.goals.filter(g => g.id !== id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- coach announcements (the write side) ----------
     Any coach (owner or assistant) can post and manage; the
     author is recorded on the post itself. One-way only: there
     is deliberately no reply, comment, or read-receipt surface. */
  if (p === '/api/announcements' && req.method === 'POST') {
    const body = await readBody(req);
    const v = validateAnnouncementInput(body, null);
    if (v.error) return sendJson(res, 400, { error: v.error });
    const now = new Date().toISOString();
    const a = Object.assign({
      id: crypto.randomUUID(), authorId: user.id, authorEmail: user.email,
      createdAt: now, updatedAt: now,
    }, v.fields);
    db.announcements.push(a);
    saveDb();
    return sendJson(res, 201, { announcement: publicAnnouncement(a) });
  }

  const announcementMatch = p.match(/^\/api\/announcements\/([^/]+)$/);
  if (announcementMatch && req.method === 'PUT') {
    const a = db.announcements.find(x => x.id === decodeURIComponent(announcementMatch[1]));
    if (!a) return sendJson(res, 404, { error: 'Announcement not found.' });
    const body = await readBody(req);
    const v = validateAnnouncementInput(body, a);
    if (v.error) return sendJson(res, 400, { error: v.error });
    Object.assign(a, v.fields, { updatedAt: new Date().toISOString() });
    saveDb();
    return sendJson(res, 200, { announcement: publicAnnouncement(a) });
  }
  if (announcementMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(announcementMatch[1]);
    if (!db.announcements.some(x => x.id === id)) {
      return sendJson(res, 404, { error: 'Announcement not found.' });
    }
    db.announcements = db.announcements.filter(x => x.id !== id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- school records (coach writes; reads are public) --- */
  /* Validate + normalize one record payload. full=true for creates
     (event, name, mark required); edits pass the existing record and
     only the fields present are re-validated, into a candidate, so a
     bad field changes nothing — the meet-results pattern. */
  function validateRecordFields(body, base) {
    const next = base ? Object.assign({}, base) : {
      event: '', mark: '', value: null, name: '',
      profileId: null, year: null, meet: '', date: '',
    };
    if (!base || body.event !== undefined) {
      const ev = findRecordEvent(clean(body.event, 30));
      if (!ev) return { error: 'Unknown event.', status: 400 };
      next.event = ev.key;
    }
    if (!base || body.name !== undefined) {
      const name = clean(body.name, 60);
      if (!name) return { error: 'Name who set the mark.', status: 400 };
      next.name = name;
    }
    if (!base || body.event !== undefined || body.mark !== undefined) {
      const ev = findRecordEvent(next.event);
      const rawMark = body.mark !== undefined
        ? (typeof body.mark === 'string' ? body.mark.trim().slice(0, 20) : '')
        : next.mark;
      const parsed = parseMeetMark(ev, rawMark);
      if (parsed.error) return { error: parsed.error, status: 400 };
      next.mark = rawMark;
      next.value = parsed.value;
    }
    if (body.profileId !== undefined) {
      if (body.profileId === null || body.profileId === '') {
        next.profileId = null;
      } else {
        const prof = profileById(clean(body.profileId, 80));
        if (!prof) return { error: 'Profile not found.', status: 404 };
        next.profileId = prof.id;
      }
    }
    if (body.year !== undefined) {
      if (body.year === null || body.year === '') {
        next.year = null;
      } else {
        const y = Number(body.year);
        if (!Number.isInteger(y) || y < 1950 || y > 2100) {
          return { error: 'Year must be between 1950 and 2100.', status: 400 };
        }
        next.year = y;
      }
    }
    if (body.meet !== undefined) next.meet = clean(body.meet, 80);
    if (body.date !== undefined) {
      if (body.date === null || body.date === '') {
        next.date = '';
      } else {
        const d = clean(body.date, 10);
        if (!parseDateStr(d)) return { error: 'Date must be YYYY-MM-DD.', status: 400 };
        next.date = d;
      }
    }
    return { fields: next };
  }

  if (p === '/api/records' && req.method === 'POST') {
    const body = await readBody(req);
    const v = validateRecordFields(body, null);
    if (v.error) return sendJson(res, v.status, { error: v.error });
    const f = v.fields;
    if (db.schoolRecords.some(x => x.event === f.event && x.name === f.name
      && x.mark === f.mark && (x.year || null) === (f.year || null))) {
      return sendJson(res, 409, { error: 'That exact record is already on the board.' });
    }
    const now = new Date().toISOString();
    const r = Object.assign({
      id: crypto.randomUUID(), enteredBy: user.id, createdAt: now, updatedAt: now,
    }, v.fields);
    db.schoolRecords.push(r);
    saveDb();
    return sendJson(res, 201, { record: publicRecord(r) });
  }

  const recordMatch = p.match(/^\/api\/records\/([^/]+)$/);
  if (recordMatch && req.method === 'PUT') {
    const r = db.schoolRecords.find(x => x.id === decodeURIComponent(recordMatch[1]));
    if (!r) return sendJson(res, 404, { error: 'Record not found.' });
    const body = await readBody(req);
    const base = {
      event: r.event, mark: r.mark, value: r.value, name: r.name,
      profileId: r.profileId, year: r.year, meet: r.meet, date: r.date,
    };
    const v = validateRecordFields(body, base);
    if (v.error) return sendJson(res, v.status, { error: v.error });
    Object.assign(r, v.fields, { updatedAt: new Date().toISOString() });
    saveDb();
    return sendJson(res, 200, { record: publicRecord(r) });
  }
  if (recordMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(recordMatch[1]);
    if (!db.schoolRecords.some(r => r.id === id)) {
      return sendJson(res, 404, { error: 'Record not found.' });
    }
    db.schoolRecords = db.schoolRecords.filter(r => r.id !== id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/records/roster-best' && req.method === 'GET') {
    // Promotion helper source: per individual event, the best mark
    // the current roster owns in meet results, and the rank it would
    // take on the record board. The coach's tap does the adding —
    // nothing is ever promoted automatically.
    const best = RECORD_EVENTS.map(ev => {
      const rb = rosterBestForEvent(ev.key);
      return {
        event: ev.key, name: ev.name, type: ev.type,
        better: ev.type === 'time' ? 'lower' : 'higher',
        best: rb,
        rank: rb ? recordWouldRank(ev, rb.value) : null,
        makesBoard: rb ? recordWouldRank(ev, rb.value) <= 10 : false,
      };
    });
    return sendJson(res, 200, { best });
  }

  /* ---------- meet day hub (coach) ---------- */
  if (p === '/api/meets' && req.method === 'GET') {
    const meets = db.meets.slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1
        : (a.createdAt < b.createdAt ? 1 : -1)))
      .map(m => Object.assign(publicMeet(m), { summary: meetSummary(m) }));
    return sendJson(res, 200, { meets });
  }

  if (p === '/api/meets' && req.method === 'POST') {
    const body = await readBody(req);
    const name = clean(body.name, 80);
    if (!name) return sendJson(res, 400, { error: 'Name the meet.' });
    const date = clean(body.date, 10);
    if (!parseDateStr(date)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
    if (db.meets.some(x => x.name === name && x.date === date)) {
      return sendJson(res, 409, { error: 'A meet with that name and date already exists.' });
    }
    const m = {
      id: crypto.randomUUID(), name, date,
      location: clean(body.location, 80),
      createdAt: new Date().toISOString(),
    };
    db.meets.push(m);
    saveDb();
    return sendJson(res, 201, { meet: publicMeet(m) });
  }

  const meetMatch = p.match(/^\/api\/meets\/([^/]+)$/);
  if (meetMatch && req.method === 'GET') {
    const m = meetById(decodeURIComponent(meetMatch[1]));
    if (!m) return sendJson(res, 404, { error: 'Meet not found.' });
    return sendJson(res, 200, {
      meet: publicMeet(m),
      entries: meetEntriesFor(m.id).map(publicMeetEntry),
      results: meetResultsFor(m).map(publicMeetResult),
      checklist: meetChecklist(m),
      summary: meetSummary(m),
    });
  }
  if (meetMatch && req.method === 'PUT') {
    const m = meetById(decodeURIComponent(meetMatch[1]));
    if (!m) return sendJson(res, 404, { error: 'Meet not found.' });
    const body = await readBody(req);
    // Validate the whole update first; a bad field changes nothing.
    const next = { name: m.name, date: m.date, location: m.location || '' };
    if (body.name !== undefined) {
      const n = clean(body.name, 80);
      if (!n) return sendJson(res, 400, { error: 'Name the meet.' });
      next.name = n;
    }
    if (body.date !== undefined) {
      const d = clean(body.date, 10);
      if (!parseDateStr(d)) return sendJson(res, 400, { error: 'Date must be YYYY-MM-DD.' });
      next.date = d;
    }
    if (body.location !== undefined) next.location = clean(body.location, 80);
    const oldName = m.name, oldDate = m.date;
    Object.assign(m, next);
    if (next.name !== oldName || next.date !== oldDate) {
      for (const r of db.meetResults) {
        if (r.meet === oldName && r.date === oldDate) { r.meet = next.name; r.date = next.date; }
      }
    }
    saveDb();
    return sendJson(res, 200, { meet: publicMeet(m) });
  }
  if (meetMatch && req.method === 'DELETE') {
    const m = meetById(decodeURIComponent(meetMatch[1]));
    if (!m) return sendJson(res, 404, { error: 'Meet not found.' });
    // Deleting a meet deletes the meet and its entries only. Results
    // already recorded stand in Meet Results under the meet's name and
    // date — the meet-day plan is disposable, the record is not.
    db.meets = db.meets.filter(x => x.id !== m.id);
    db.meetEntries = db.meetEntries.filter(e => e.meetId !== m.id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  const meetEntriesMatch = p.match(/^\/api\/meets\/([^/]+)\/entries$/);
  if (meetEntriesMatch && req.method === 'POST') {
    const m = meetById(decodeURIComponent(meetEntriesMatch[1]));
    if (!m) return sendJson(res, 404, { error: 'Meet not found.' });
    const body = await readBody(req);
    const prof = profileById(clean(body.profileId, 80));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const ev = findMeetEvent(clean(body.event, 30));
    if (!ev) return sendJson(res, 400, { error: 'Unknown event.' });
    if (db.meetEntries.some(e => e.meetId === m.id && e.profileId === prof.id && e.event === ev.key)) {
      return sendJson(res, 400, {
        error: prof.firstName + ' ' + prof.lastName + ' is already entered in ' + ev.name + ' at this meet.',
      });
    }
    const entry = { id: crypto.randomUUID(), meetId: m.id, profileId: prof.id, event: ev.key };
    db.meetEntries.push(entry);
    saveDb();
    return sendJson(res, 201, { entry: publicMeetEntry(entry) });
  }

  const meetEntryMatch = p.match(/^\/api\/meets\/([^/]+)\/entries\/([^/]+)$/);
  if (meetEntryMatch && req.method === 'DELETE') {
    const meetId = decodeURIComponent(meetEntryMatch[1]);
    const entryId = decodeURIComponent(meetEntryMatch[2]);
    if (!meetById(meetId)) return sendJson(res, 404, { error: 'Meet not found.' });
    if (!db.meetEntries.some(e => e.id === entryId && e.meetId === meetId)) {
      return sendJson(res, 404, { error: 'Entry not found.' });
    }
    db.meetEntries = db.meetEntries.filter(e => e.id !== entryId);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  const meetQuickMatch = p.match(/^\/api\/meets\/([^/]+)\/results$/);
  if (meetQuickMatch && req.method === 'POST') {
    const m = meetById(decodeURIComponent(meetQuickMatch[1]));
    if (!m) return sendJson(res, 404, { error: 'Meet not found.' });
    const body = await readBody(req);
    const ev = findMeetEvent(clean(body.event, 30));
    if (!ev) return sendJson(res, 400, { error: 'Unknown event.' });
    const marks = Array.isArray(body.marks) ? body.marks : null;
    if (!marks || !marks.length) return sendJson(res, 400, { error: 'Enter at least one mark.' });
    if (marks.length > 100) return sendJson(res, 400, { error: 'Too many marks in one save (max 100).' });
    // Validate the whole batch through the shared meet-result rules
    // first — one bad mark saves nothing.
    const seen = new Set();
    const validated = [];
    for (const mk of marks) {
      const profileId = clean(mk && mk.profileId, 80);
      if (seen.has(profileId)) {
        return sendJson(res, 400, { error: 'Two marks for the same athlete in one save.' });
      }
      seen.add(profileId);
      const prof = profileById(profileId);
      if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
      if (!db.meetEntries.some(e => e.meetId === m.id && e.profileId === profileId && e.event === ev.key)) {
        return sendJson(res, 400, {
          error: prof.firstName + ' ' + prof.lastName + ' is not entered in ' + ev.name + ' at this meet.',
        });
      }
      const v = validateMeetResultInput({
        profileId, date: m.date, meet: m.name, event: ev.key, mark: mk && mk.mark,
      });
      if (v.error) return sendJson(res, v.status, { error: v.error });
      validated.push(v);
    }
    // Flags are read against the marks on record before this save,
    // then each mark writes through the shared path. An athlete who
    // already has a mark for this meet + event gets it updated in
    // place — re-saving a corrected mark never duplicates the record.
    const saved = [];
    for (const v of validated) {
      const existing = db.meetResults.find(r =>
        r.meet === m.name && r.date === m.date && r.profileId === v.prof.id && r.event === ev.key);
      const prStatus = meetPrStatus(v.prof.id, ev, v.value, existing ? existing.id : null);
      let r;
      if (existing) {
        existing.mark = v.rawMark;
        existing.value = v.value;
        existing.updatedAt = new Date().toISOString();
        r = existing;
      } else {
        r = insertMeetResult(v, '', user.id);
      }
      saved.push(Object.assign(publicMeetResult(r), { prStatus }));
    }
    saveDb();
    return sendJson(res, 200, {
      saved,
      checklist: meetChecklist(m),
      summary: meetSummary(m),
    });
  }

  /* ---------- reports (coach-only analytics) ---------- */
  if (p === '/api/reports/team-trend' && req.method === 'GET') {
    // Team median per test per test day — is the room getting stronger?
    const days = db.testDays.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const tests = allTests().map(t => {
      const points = [];
      for (const day of days) {
        if (!day.testKeys.includes(t.key)) continue;
        const vals = [];
        for (const pr of db.profiles) {
          const r = (db.testResults[pr.id] || []).find(x => x.testDayId === day.id && x.testKey === t.key);
          if (r) {
            const d = displayValue(r);
            if (d !== null && d !== undefined) vals.push(d);
          }
        }
        if (vals.length) {
          points.push({ testDayId: day.id, date: day.date, title: day.title, median: medianOf(vals), count: vals.length });
        }
      }
      return { testKey: t.key, name: t.name, unit: t.unit, kind: t.kind, better: t.better || 'higher', points };
    });
    return sendJson(res, 200, { tests });
  }

  if (p === '/api/reports/completions' && req.method === 'GET') {
    // Per group per season week: assigned = days that week whose
    // resolved assignment has a session (plan or coach override);
    // completed = the coach-marked completions recorded for the group
    // that week, with the distinct days they cover.
    const today = todayStr();
    const groups = db.groups.map(g => {
      const daySets = new Map();
      const weeks = CONTENT.weeks.map(w => {
        let assigned = 0;
        for (let i = 0; i < 7; i++) {
          const ds = addDaysStr(w.start, i);
          if (!ds) continue;
          const a = resolveAssignment(g.id, ds);
          if (a && a.sessionId) assigned++;
        }
        daySets.set(w.start, new Set());
        return {
          week: w.week, monday: w.start, assigned,
          completedDays: 0, completions: 0, upcoming: w.start > today,
        };
      });
      const byMonday = new Map(weeks.map(x => [x.monday, x]));
      for (const c of Object.values(db.completions)) {
        if (c.groupId !== g.id) continue;
        const mon = mondayOf(c.date);
        const wk = mon ? byMonday.get(mon) : null;
        if (!wk) continue; // outside the season weeks — not charted
        wk.completions++;
        daySets.get(wk.monday).add(c.date);
      }
      for (const wk of weeks) wk.completedDays = daySets.get(wk.monday).size;
      return { group: { id: g.id, name: g.name }, weeks };
    });
    return sendJson(res, 200, { groups });
  }

  if (p === '/api/reports/load' && req.method === 'GET') {
    // PLANNED load only: what the season plan itself calls for each
    // week (coach overrides are not folded in — the label says so).
    const weeks = CONTENT.weeks.map(w => {
      let high = 0, low = 0, off = 0, meet = 0, test = 0;
      for (let i = 0; i < 7; i++) {
        const ds = addDaysStr(w.start, i);
        const plan = ds ? planDayFor(ds) : null;
        if (!plan) continue;
        if (plan.isOff) { off++; continue; }
        if (plan.isHigh) high++; else low++;
        if (plan.isMeet) meet++;
        if (plan.isTest) test++;
      }
      return { week: w.week, phase: w.phase, start: w.start, high, low, off, meet, test };
    });
    return sendJson(res, 200, { weeks });
  }

  if (p === '/api/reports/health' && req.method === 'GET') {
    const byStatus = { new: 0, monitoring: 0, cleared: 0 };
    const monthCounts = {};
    let total = 0;
    for (const pid of Object.keys(db.concerns)) {
      for (const c of db.concerns[pid] || []) {
        total++;
        if (byStatus[c.status] !== undefined) byStatus[c.status]++;
        const month = String(c.createdAt || '').slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(month)) monthCounts[month] = (monthCounts[month] || 0) + 1;
      }
    }
    const byMonth = Object.keys(monthCounts).sort().map(m => ({ month: m, opened: monthCounts[m] }));
    /* Daily check-in aggregates, additive to the payload above:
       participation per season-style week (Monday bucket) against
       the current roster size, and a per-day team-average trend for
       every day anyone checked in. */
    const rosterCount = db.profiles.filter(pr => !pr.archived).length;
    const activeIds = new Set(db.profiles.filter(pr => !pr.archived).map(pr => pr.id));
    const weekCounts = {};
    const dayEntries = {};
    let ciTotal = 0;
    for (const pid of Object.keys(db.checkins)) {
      for (const c of Object.values(db.checkins[pid] || {})) {
        ciTotal++;
        const mon = mondayOf(c.date);
        if (mon && activeIds.has(pid)) weekCounts[mon] = (weekCounts[mon] || 0) + 1;
        (dayEntries[c.date] = dayEntries[c.date] || []).push(c);
      }
    }
    const participationByWeek = Object.keys(weekCounts).sort().map(mon => {
      const count = weekCounts[mon];
      const possible = rosterCount * 7;
      return {
        week: mon, checkins: count, possible,
        percent: possible ? Math.round((count / possible) * 100) : 0,
      };
    });
    const dailyTrend = Object.keys(dayEntries).sort().map(d => {
      const cs = dayEntries[d];
      const avgOf = (k) => round2(cs.reduce((s, c) => s + c[k], 0) / cs.length);
      return {
        date: d, count: cs.length,
        avgSleep: avgOf('sleep'), avgSoreness: avgOf('soreness'), avgEnergy: avgOf('energy'),
      };
    });
    return sendJson(res, 200, {
      total, byStatus, byMonth,
      checkins: { totalCheckins: ciTotal, participationByWeek, dailyTrend },
    });
  }

  const athleteReportMatch = p.match(/^\/api\/reports\/athlete\/([^/]+)$/);
  if (athleteReportMatch && req.method === 'GET') {
    const prof = profileById(decodeURIComponent(athleteReportMatch[1]));
    if (!prof) return sendJson(res, 404, { error: 'Profile not found.' });
    const testing = testingHistoryFor(prof.id);
    const weekly = allWeeklyMetrics().map(m => {
      const s = weeklySeriesFor(prof.id, m);
      return { metric: m, points: s.points, best: s.best, latest: s.latest, delta: s.delta, improved: s.improved };
    }).filter(w => w.points.length);
    /* Completion percentage, stated honestly: the denominator is the
       number of days their CURRENT group had an assigned session from
       the later of (the day the profile was created, the season
       start) through today (capped at the season end); the numerator
       is their coach-marked completions inside that same window.
       Group moves are not tracked historically, so when there is no
       group or no assigned day in the window, percent stays null and
       the card shows the raw completion count instead. */
    const mine = Object.values(db.completions).filter(c => c.profileId === prof.id);
    let denominator = 0;
    let counted = mine.length;
    let percent = null;
    if (prof.groupId && CONTENT.weeks.length) {
      const seasonStart = CONTENT.weeks[0].start;
      const seasonEnd = CONTENT.weeks[CONTENT.weeks.length - 1].end;
      const joined = String(prof.createdAt || '').slice(0, 10);
      const from = joined > seasonStart ? joined : seasonStart;
      const today = todayStr();
      const to = today < seasonEnd ? today : seasonEnd;
      counted = 0;
      if (parseDateStr(from) && from <= to) {
        let ds = from;
        while (ds && ds <= to) {
          const a = resolveAssignment(prof.groupId, ds);
          if (a && a.sessionId) denominator++;
          ds = addDaysStr(ds, 1);
        }
        counted = mine.filter(c => c.date >= from && c.date <= to).length;
        if (denominator > 0) percent = Math.round((counted / denominator) * 100);
      }
    }
    const health = { open: 0, monitoring: 0, cleared: 0, total: 0 };
    for (const c of db.concerns[prof.id] || []) {
      health.total++;
      if (c.status === 'new') health.open++;
      else if (c.status === 'monitoring') health.monitoring++;
      else if (c.status === 'cleared') health.cleared++;
    }
    return sendJson(res, 200, {
      profile: publicProfile(prof),
      testing, weekly,
      completions: { count: counted, total: mine.length, denominator, percent },
      health,
      meetPrs: meetPrsFor(prof.id),
      meetSeries: meetSeriesFor(prof.id),
      goals: goalsForProfile(prof.id),
    });
  }

  if (p === '/api/digest' && req.method === 'GET') {
    /* Weekly coach digest: one week of the program, assembled from
       the same stores and helpers the other coach views read — no
       new data, never forked math. ?week= is any date in the week to
       summarize (normalized to its Monday); omitted, it defaults to
       the most recent COMPLETED week (last week's Monday). Sections
       are computed independently and simply come back empty when a
       week has none of their data. */
    const rawWeek = q.get('week');
    let monday;
    if (rawWeek === null || rawWeek === '') {
      monday = addDaysStr(mondayOf(todayStr()), -7);
    } else {
      if (!parseDateStr(rawWeek)) {
        return sendJson(res, 400, { error: 'Week must be a date (YYYY-MM-DD).' });
      }
      monday = mondayOf(rawWeek);
    }
    const sunday = addDaysStr(monday, 6);
    const inWeek = (ds) => !!ds && ds >= monday && ds <= sunday;

    /* --- check-ins: participation against the live roster (the
       roster × 7 denominator the Reports health aggregates use),
       team averages, and who kept flagging. Flags mean what
       checkinFlags says everywhere else. --- */
    const roster = db.profiles.filter(pr => !pr.archived);
    let ciRecorded = 0;
    const ciWeek = [];
    const flagByAthlete = new Map();
    for (const pr of roster) {
      const byDate = db.checkins[pr.id] || {};
      for (const ds of Object.keys(byDate)) {
        if (!inWeek(ds)) continue;
        const c = byDate[ds];
        ciRecorded++;
        ciWeek.push(c);
        const flags = checkinFlags(c);
        if (!flags.length) continue;
        let rec = flagByAthlete.get(pr.id);
        if (!rec) {
          rec = { profileId: pr.id, name: pr.firstName + ' ' + pr.lastName, flaggedDays: 0, counts: {} };
          flagByAthlete.set(pr.id, rec);
        }
        rec.flaggedDays++;
        for (const f of flags) rec.counts[f] = (rec.counts[f] || 0) + 1;
      }
    }
    const ciAvg = (key) => (ciWeek.length
      ? round2(ciWeek.reduce((s, c) => s + c[key], 0) / ciWeek.length) : null);
    const flagged = [...flagByAthlete.values()].map(rec => {
      let mainFlag = null, most = -1;
      for (const f of ['low-sleep', 'high-soreness', 'low-energy']) {
        if ((rec.counts[f] || 0) > most) { most = rec.counts[f] || 0; mainFlag = f; }
      }
      return {
        profileId: rec.profileId, name: rec.name,
        flaggedDays: rec.flaggedDays, mainFlag, flags: rec.counts,
      };
    }).sort((a, b) => b.flaggedDays - a.flaggedDays || a.name.localeCompare(b.name)).slice(0, 5);
    const ciPossible = roster.length * 7;
    const checkins = {
      recorded: ciRecorded, possible: ciPossible,
      percent: ciPossible ? Math.round((ciRecorded / ciPossible) * 100) : 0,
      roster: roster.length,
      avgSleep: ciAvg('sleep'), avgSoreness: ciAvg('soreness'), avgEnergy: ciAvg('energy'),
      flaggedCount: flagByAthlete.size,
      flagged,
    };

    /* --- training: per group, the Reports-completions counting for
       this one week — assigned = days whose resolved assignment has
       a session; completions = coach-marked records that week, with
       the distinct days they cover. --- */
    const training = {
      groups: db.groups.map(g => {
        let assigned = 0;
        for (let i = 0; i < 7; i++) {
          const a = resolveAssignment(g.id, addDaysStr(monday, i));
          if (a && a.sessionId) assigned++;
        }
        const days = new Set();
        let completions = 0;
        for (const c of Object.values(db.completions)) {
          if (c.groupId !== g.id || !inWeek(c.date)) continue;
          completions++;
          days.add(c.date);
        }
        return {
          group: { id: g.id, name: g.name },
          assigned, completedDays: days.size, completions,
        };
      }),
    };

    /* --- performance: meet results dated that week whose mark still
       stands as the athlete's PR (the meetPrsFor / Meet Day summary
       definition of a PR), each with its would-be rank on the school
       record board; plus testing results ENTERED that week (their
       createdAt week), counted by test. --- */
    const weekResults = db.meetResults.filter(r => inWeek(r.date));
    const prs = [];
    for (const r of weekResults) {
      const ev = findMeetEvent(r.event);
      if (!ev) continue;
      const standing = meetPrsFor(r.profileId).find(x => x.event === r.event);
      if (!standing || standing.resultId !== r.id) continue;
      const prof = profileById(r.profileId);
      const recEv = findRecordEvent(r.event) || ev;
      const rank = recordWouldRank(recEv, r.value);
      prs.push({
        profileId: r.profileId,
        athleteName: prof ? prof.firstName + ' ' + prof.lastName : '',
        event: r.event, eventName: ev.name,
        mark: r.mark, value: r.value, date: r.date, meet: r.meet,
        recordBoard: rank <= 10, recordRank: rank,
      });
    }
    prs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const byTestCount = new Map();
    let testingTotal = 0;
    for (const pid of Object.keys(db.testResults)) {
      for (const r of db.testResults[pid] || []) {
        if (!inWeek(String(r.createdAt || '').slice(0, 10))) continue;
        testingTotal++;
        byTestCount.set(r.testKey, (byTestCount.get(r.testKey) || 0) + 1);
      }
    }
    /* Goals achieved that week: a goal counts when it stands
       achieved (goalProgressFor, the tracker's own definition) and
       the first result that carried the athlete's running best to
       the target is dated inside this week. */
    let goalsAchieved = null;
    if (Array.isArray(db.goals)) {
      goalsAchieved = [];
      for (const g of db.goals) {
        if (!goalProgressFor(g).achieved) continue;
        const ev = findMeetEvent(g.event);
        const series = meetSeriesFor(g.profileId).find(s => s.event === g.event);
        if (!ev || !series) continue;
        let best = null, hit = null;
        for (const pt of series.points) {
          if (best === null || (ev.type === 'time' ? pt.value < best : pt.value > best)) best = pt.value;
          if (ev.type === 'time' ? best <= g.targetValue : best >= g.targetValue) { hit = pt; break; }
        }
        if (hit && inWeek(hit.date)) {
          const prof = profileById(g.profileId);
          goalsAchieved.push({
            profileId: g.profileId,
            athleteName: prof ? prof.firstName + ' ' + prof.lastName : '',
            event: g.event, eventName: ev.name,
            target: g.targetText, mark: hit.mark, date: hit.date, meet: hit.meet,
          });
        }
      }
    }
    const performance = {
      meetResults: { count: weekResults.length, prs },
      testing: {
        total: testingTotal,
        byTest: allTests().filter(t => byTestCount.has(t.key))
          .map(t => ({ testKey: t.key, name: t.name, unit: t.unit, count: byTestCount.get(t.key) })),
      },
      goalsAchieved,
    };

    /* --- health: concerns opened that week (createdAt), concerns
       cleared that week (status cleared and its updatedAt — the
       moment the status last changed — inside the week), and the
       current open/monitoring snapshot. --- */
    let opened = 0, cleared = 0, openNow = 0, monitoringNow = 0;
    for (const pid of Object.keys(db.concerns)) {
      for (const c of db.concerns[pid] || []) {
        if (c.status === 'new') openNow++;
        else if (c.status === 'monitoring') monitoringNow++;
        if (inWeek(String(c.createdAt || '').slice(0, 10))) opened++;
        if (c.status === 'cleared' && inWeek(String(c.clearedAt || c.updatedAt || '').slice(0, 10))) cleared++;
      }
    }
    const health = { opened, cleared, open: openNow, monitoring: monitoringNow };

    /* --- the week after the one summarized: the plan snapshot, so
       the digest reads "last week / the week coming". planDayFor
       clamps outside the season edges, as everywhere else. --- */
    const aheadMonday = addDaysStr(monday, 7);
    const aheadDays = [];
    let trainingDays = 0, highDays = 0;
    for (let i = 0; i < 7; i++) {
      const ds = addDaysStr(aheadMonday, i);
      const plan = ds ? planDayFor(ds) : null;
      if (!plan) {
        aheadDays.push({ date: ds, dayKey: DAY_KEYS[i], codes: [], isHigh: false, isOff: true, isMeet: false, isTest: false });
        continue;
      }
      if (!plan.isOff) trainingDays++;
      if (plan.isHigh) highDays++;
      aheadDays.push({
        date: ds, dayKey: plan.dayKey, codes: plan.codes,
        isHigh: plan.isHigh, isOff: plan.isOff, isMeet: plan.isMeet, isTest: plan.isTest,
      });
    }
    const aheadPlan = planDayFor(aheadMonday);
    const weekAhead = {
      week: aheadMonday, weekEnd: addDaysStr(aheadMonday, 6),
      seasonWeek: aheadPlan ? aheadPlan.week : null,
      phase: aheadPlan ? aheadPlan.phase : '',
      trainingDays, highDays, days: aheadDays,
    };

    return sendJson(res, 200, {
      week: monday, weekEnd: sunday,
      checkins, training, performance, health, weekAhead,
    });
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
      const uploadAttempt = body.type === 'upload' || /cloudinary\.com/i.test(url);
      return sendJson(res, 400, { error: uploadAttempt
        ? 'That is not a video from your Cloudinary account. Add your own video with the Upload your video button instead.'
        : 'That link is not a YouTube video or a GIF. Paste a YouTube watch/share link or a direct .gif link.' });
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

  /* ---------- custom workouts (coach-built, for runner mode) ------
     Coach-only like everything in this section: athletes get a 403
     on read and write alike. Runner mode itself is a client-side
     display over this data, so it inherits the same gate. */
  if (p === '/api/custom-workouts' && req.method === 'GET') {
    const workouts = db.customWorkouts.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return sendJson(res, 200, { workouts });
  }
  if (p === '/api/custom-workouts' && req.method === 'POST') {
    const body = await readBody(req);
    const v = validateCustomWorkout(body);
    if (v.error) return sendJson(res, 400, { error: v.error });
    const workout = Object.assign({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }, v.fields, { updatedAt: new Date().toISOString() });
    db.customWorkouts.push(workout);
    saveDb();
    return sendJson(res, 201, { workout });
  }
  const customWorkoutMatch = p.match(/^\/api\/custom-workouts\/([^/]+)$/);
  if (customWorkoutMatch && req.method === 'PUT') {
    const workout = db.customWorkouts.find(w => w.id === decodeURIComponent(customWorkoutMatch[1]));
    if (!workout) return sendJson(res, 404, { error: 'Custom workout not found.' });
    const body = await readBody(req);
    const v = validateCustomWorkout(body);
    if (v.error) return sendJson(res, 400, { error: v.error });
    Object.assign(workout, v.fields, { updatedAt: new Date().toISOString() });
    saveDb();
    return sendJson(res, 200, { workout });
  }
  if (customWorkoutMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(customWorkoutMatch[1]);
    if (!db.customWorkouts.some(w => w.id === id)) {
      return sendJson(res, 404, { error: 'Custom workout not found.' });
    }
    db.customWorkouts = db.customWorkouts.filter(w => w.id !== id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- programs (coach-built templates) + applications -----
     Coach-only like everything in this section: athletes get a 403,
     logged-out callers a 401. A program is a template — CRUD on it
     never touches a calendar. Applying writes coach overrides (see
     the helper note above); removing an application undoes exactly
     its own writes. */
  if (p === '/api/programs' && req.method === 'GET') {
    const programs = db.programs.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(publicProgram);
    return sendJson(res, 200, { programs });
  }
  if (p === '/api/programs' && req.method === 'POST') {
    const body = await readBody(req);
    const v = validateProgram(body);
    if (v.error) return sendJson(res, 400, { error: v.error });
    const now = new Date().toISOString();
    const program = Object.assign(
      { id: crypto.randomUUID(), createdBy: user.id, createdAt: now },
      v.fields, { updatedAt: now });
    db.programs.push(program);
    saveDb();
    return sendJson(res, 201, { program: publicProgram(program) });
  }
  const programApplyMatch = p.match(/^\/api\/programs\/([^/]+)\/apply$/);
  if (programApplyMatch && req.method === 'POST') {
    const program = db.programs.find(x => x.id === decodeURIComponent(programApplyMatch[1]));
    if (!program) return sendJson(res, 404, { error: 'Program not found.' });
    const body = await readBody(req);
    const startRaw = clean(body.startDate, 10);
    if (!parseDateStr(startRaw)) return sendJson(res, 400, { error: 'Start date must be YYYY-MM-DD.' });
    /* A program always starts on a Monday: any start date normalizes
       to the Monday of its week, and week 1 lands there. */
    const monday = mondayOf(startRaw);
    const targetRaw = clean(body.target, 80);
    let targetGroups, targetLabel;
    if (targetRaw.toLowerCase() === 'all') {
      targetGroups = db.groups.slice();
      targetLabel = 'all';
    } else {
      const g = groupByName(targetRaw) || groupById(targetRaw);
      if (!g) return sendJson(res, 400, { error: 'Unknown target group — name a group, or use "all".' });
      targetGroups = [g];
      targetLabel = g.name;
    }
    if (!targetGroups.length) {
      return sendJson(res, 400, { error: 'There are no groups yet — add a group before applying a program.' });
    }
    /* Collect every write before touching the store, so a program
       with nothing in it fails cleanly instead of half-applying.
       Days with no codes write nothing: a program's empty day is not
       an override, the plan keeps showing through there. */
    const writes = [];
    program.weeks.forEach((week, wi) => {
      DAY_KEYS.forEach((dayKey, di) => {
        const codes = week[dayKey] || [];
        if (!codes.length) return;
        const date = addDaysStr(monday, wi * 7 + di);
        for (const g of targetGroups) {
          writes.push({
            groupId: g.id, groupName: g.name, date,
            value: { sessionId: codes[0], codes: codes.slice(), note: 'Program: ' + program.name },
          });
        }
      });
    });
    if (!writes.length) {
      return sendJson(res, 400, { error: 'This program has no sessions in it yet — put at least one session on a day before applying.' });
    }
    const now = new Date().toISOString();
    for (const w of writes) {
      db.overrides[w.groupId + '|' + w.date] = {
        sessionId: w.value.sessionId, codes: w.value.codes.slice(),
        note: w.value.note, by: user.id, at: now,
      };
    }
    const application = {
      id: crypto.randomUUID(), programId: program.id, programName: program.name,
      target: targetLabel, startDate: monday,
      dates: [...new Set(writes.map(w => w.date))].sort(),
      writes, createdBy: user.id, createdAt: now,
    };
    db.programApplications.push(application);
    saveDb();
    return sendJson(res, 201, {
      ok: true, application: publicProgramApplication(application),
      applied: writes.length, startDate: monday,
      requestedStart: startRaw, normalized: startRaw !== monday,
    });
  }
  const programMatch = p.match(/^\/api\/programs\/([^/]+)$/);
  if (programMatch && req.method === 'GET') {
    const program = db.programs.find(x => x.id === decodeURIComponent(programMatch[1]));
    if (!program) return sendJson(res, 404, { error: 'Program not found.' });
    return sendJson(res, 200, { program: publicProgram(program) });
  }
  if (programMatch && req.method === 'PUT') {
    const program = db.programs.find(x => x.id === decodeURIComponent(programMatch[1]));
    if (!program) return sendJson(res, 404, { error: 'Program not found.' });
    const body = await readBody(req);
    const v = validateProgram(body);
    if (v.error) return sendJson(res, 400, { error: v.error });
    Object.assign(program, v.fields, { updatedAt: new Date().toISOString() });
    saveDb();
    return sendJson(res, 200, { program: publicProgram(program) });
  }
  if (programMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(programMatch[1]);
    if (!db.programs.some(x => x.id === id)) {
      return sendJson(res, 404, { error: 'Program not found.' });
    }
    /* Deleting a template never un-applies it: applications carry
       their own snapshot and stay removable afterwards. */
    db.programs = db.programs.filter(x => x.id !== id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/program-applications' && req.method === 'GET') {
    const applications = db.programApplications.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(publicProgramApplication);
    return sendJson(res, 200, { applications });
  }
  const programAppMatch = p.match(/^\/api\/program-applications\/([^/]+)$/);
  if (programAppMatch && req.method === 'DELETE') {
    const app = db.programApplications.find(a => a.id === decodeURIComponent(programAppMatch[1]));
    if (!app) return sendJson(res, 404, { error: 'Application not found.' });
    let removed = 0, kept = 0;
    for (const w of app.writes || []) {
      const key = w.groupId + '|' + w.date;
      const cur = db.overrides[key];
      if (!cur) continue; /* already cleared by hand: nothing to undo */
      const wrote = { sessionId: w.value.sessionId, codes: w.value.codes, note: w.value.note || '' };
      if (JSON.stringify(overrideSemantic(cur)) === JSON.stringify(wrote)) {
        delete db.overrides[key];
        removed++;
      } else {
        kept++; /* a coach changed that day after the apply — it stays */
      }
    }
    db.programApplications = db.programApplications.filter(a => a.id !== app.id);
    saveDb();
    return sendJson(res, 200, { ok: true, removed, kept });
  }

  /* ---------- team calendar (coach) ----------
     One month, resolved on the server through resolveAssignment —
     plan default, hand overrides and applied programs alike — so the
     grid can never disagree with Today or the checklist. Meet/test
     markers come from planDayFor, the same detection the plan uses. */
  if (p === '/api/calendar' && req.method === 'GET') {
    const monthRaw = clean(q.get('month') || todayStr().slice(0, 7), 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthRaw)) {
      return sendJson(res, 400, { error: 'Month must be YYYY-MM.' });
    }
    const first = monthRaw + '-01';
    const d0 = parseDateStr(first);
    const lastDay = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
    const today = todayStr();
    const days = [];
    for (let i = 0; i < lastDay; i++) {
      const date = addDaysStr(first, i);
      const plan = planDayFor(date);
      days.push({
        date, dayKey: plan ? plan.dayKey : null, today: date === today,
        week: plan ? plan.week : null, phase: plan ? plan.phase : null,
        planText: plan ? plan.planText : '',
        isMeet: !!(plan && plan.isMeet), isTest: !!(plan && plan.isTest),
        isOff: !!(plan && plan.isOff),
        groups: db.groups.map(g => {
          const a = resolveAssignment(g.id, date);
          return {
            group: { id: g.id, name: g.name },
            source: a.source, sessionId: a.sessionId, sessionName: a.sessionName,
            note: a.note || '',
            codes: (a.codes || []).map(code => {
              const s = SESSION_BY_ID.get(code);
              return { id: code, name: s ? s.name : code };
            }),
          };
        }),
      });
    }
    return sendJson(res, 200, {
      month: monthRaw, start: first, end: addDaysStr(first, lastDay - 1), today, days,
    });
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
const SHELL_NO_CACHE_PATHS = new Set(['/', '/index.html', '/app.js', '/styles.css', '/sw.js']);
function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  const shellHeaders = SHELL_NO_CACHE_PATHS.has(url.pathname)
    ? { 'Cache-Control': 'no-cache' }
    : {};
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: unknown paths get the app shell.
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, Object.assign(
      { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' },
      shellHeaders
    ));
    res.end(data);
  });
}

seedCoachInvitesFromEnv();
seedCustomWorkouts();

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
