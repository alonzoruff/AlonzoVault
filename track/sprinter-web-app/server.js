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
let db = { users: [], logs: {}, swaps: {} };

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.users)) db = parsed;
  } catch (_) { /* first run: keep the empty store */ }
  db.logs = db.logs || {};
  db.swaps = db.swaps || {};
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
const SESSION_IDS = new Set(CONTENT.sessions.map(s => s.id));
const XT_IDS = new Set(CONTENT.sessions.filter(s => s.id.startsWith('XT-')).map(s => s.id));

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
      if (size > 64 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
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
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
async function handleApi(req, res, url) {
  const p = url.pathname;

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
    };
    db.users.push(user);
    db.logs[user.id] = [];
    db.swaps[user.id] = {};
    saveDb();
    return sendJson(res, 201, { id: user.id, email: user.email },
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
    return sendJson(res, 200, { id: user.id, email: user.email },
      { 'Set-Cookie': sessionCookie(req, signSession(user.id), SESSION_DAYS * 24 * 3600) });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true },
      { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (p === '/api/me' && req.method === 'GET') {
    const user = readSession(req);
    if (!user) return sendJson(res, 401, { error: 'not logged in' });
    return sendJson(res, 200, { id: user.id, email: user.email });
  }

  /* Everything below requires a login. */
  const user = readSession(req);
  if (!user) return sendJson(res, 401, { error: 'Please log in first.' });

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
