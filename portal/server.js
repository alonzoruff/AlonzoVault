'use strict';
/*
 * AJ Command Portal: a hosted game dashboard with real saved state.
 * Node 18+, CommonJS, no dependencies, one process.
 *
 *   PORTAL_KEY   opens the portal for AJ (his link carries it once, then a cookie remembers)
 *   LUNA_KEY     sent by Luna in an x-luna-key header; opens only her endpoints
 *   DATA_DIR     where portal.json lives (default: ./data next to this file)
 *   PORT         default 3000
 *
 * Data is one JSON file with three separate parts: content (what Luna edits),
 * progress (AJ's ticks, habits and bonuses) and outbox (his messages). Every
 * change is written to a temp file and renamed over portal.json.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./lib/game');
const C = require('./lib/content');
const makeSeed = require('./lib/seed');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};
const OPEN_FILES = ['/manifest.webmanifest', '/icon-180.png', '/icon-192.png', '/icon-512.png'];  /* icons and manifest carry nothing private */
const MAX_BODY = 64 * 1024;
const MAX_OUTBOX = 2000;

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const LOCKED_HTML = (msg) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>AJ Command Portal</title><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0c1022"><meta name="robots" content="noindex">'
  + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1022;color:#e8ecfa;font:16px/1.5 system-ui,sans-serif;padding:24px}'
  + 'main{max-width:340px;text-align:center}h1{font:700 18px "Courier New",monospace;letter-spacing:1.2px;text-transform:uppercase;color:#ffd35a;margin:0 0 12px}'
  + 'p{color:#a2acd0;margin:0 0 16px}form{display:grid;gap:10px}input{font:inherit;font-size:16px;padding:12px;background:#0a0e22;color:#e8ecfa;border:2px solid #2f3b74}'
  + 'button{font:inherit;font-weight:600;padding:12px;background:#5aa9ff;color:#07121f;border:0;cursor:pointer}</style></head><body><main>'
  + '<h1>AJ Command Portal</h1><p>' + msg + '</p>'
  + '<form method="post" action="/unlock"><label for="k" style="color:#a2acd0;font-size:14px">Access key</label>'
  + '<input id="k" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit">Open</button></form></main></body></html>';

async function start(opts) {
  const o = opts || {};
  const dataDir = path.resolve(o.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
  const portalKey = o.portalKey !== undefined ? o.portalKey : (process.env.PORTAL_KEY || '');
  const lunaKey = o.lunaKey !== undefined ? o.lunaKey : (process.env.LUNA_KEY || '');
  const clock = o.now || (() => new Date());
  const quiet = !!o.quiet;
  const log = (...a) => { if (!quiet) console.log(...a); };

  for (const [name, k] of [['PORTAL_KEY', portalKey], ['LUNA_KEY', lunaKey]]) {
    if (k && k.length < 16) throw new Error(name + ' must be at least 16 characters.');
  }
  if (portalKey && lunaKey && portalKey === lunaKey) throw new Error('PORTAL_KEY and LUNA_KEY must be different.');
  if (!portalKey) log('Warning: PORTAL_KEY is not set, so nobody can open the portal yet.');
  if (!lunaKey) log('Warning: LUNA_KEY is not set, so Luna’s endpoints are switched off.');

  const sessionToken = portalKey ? crypto.createHmac('sha256', portalKey).update('aj-portal-session-v1').digest('hex') : '';

  /* ---------- storage ---------- */
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'portal.json');
  const tmpFile = dbFile + '.tmp';
  try { fs.rmSync(tmpFile, { force: true, recursive: false }); } catch (_) { /* a leftover from a crash; ignore if it cannot be removed */ }

  function writeAtomic(d) {
    const data = JSON.stringify(d, null, 1);
    const fd = fs.openSync(tmpFile, 'w');
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, dbFile + '.bak'); } catch (_) { /* the backup is a courtesy */ }
    fs.renameSync(tmpFile, dbFile);
  }
  function load() {
    if (!fs.existsSync(dbFile)) {
      const fresh = { schema: 1, content: makeSeed(clock().toISOString()), progress: G.emptyProgress(), outbox: [] };
      writeAtomic(fresh);
      return fresh;
    }
    let raw;
    try { raw = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch (e) {
      throw new Error('portal.json exists but cannot be read (' + e.message + '). Nothing was changed. Restore portal.json.bak or fix the file, then start again.');
    }
    if (!C.plain(raw) || !C.plain(raw.content)) throw new Error('portal.json has no content section. Nothing was changed.');
    const base = makeSeed(clock().toISOString());
    for (const k of Object.keys(base)) if (raw.content[k] === undefined) raw.content[k] = base[k];
    raw.progress = Object.assign(G.emptyProgress(), raw.progress || {});
    raw.outbox = Array.isArray(raw.outbox) ? raw.outbox : [];
    raw.schema = 1;
    return raw;
  }
  let db = load();

  /* Run a change; if the save fails, put everything back exactly as it was. */
  function mutate(fn) {
    const backup = JSON.stringify(db);
    try {
      const r = fn();
      writeAtomic(db);
      return r;
    } catch (e) {
      db = JSON.parse(backup);
      throw e;
    }
  }
  const nowIso = () => clock().toISOString();
  const today = () => G.etDate(clock());
  const questObj = (id) => (db.content.quests[id] ? Object.assign({ id }, db.content.quests[id]) : null);

  /* settle anything that moves with the calendar (weeks, unlocks) before we answer */
  function settleNow() {
    const probe = JSON.parse(JSON.stringify(db));
    if (G.settle(probe, today(), nowIso())) mutate(() => { G.settle(db, today(), nowIso()); });
  }
  const stateNow = () => G.buildState(db, clock());

  /* ---------- failed-key limiter (global, so a spoofed address cannot dodge it) ---------- */
  const failures = [];
  function keyAttemptsBlocked() {
    const cutoff = Date.now() - 60000;
    while (failures.length && failures[0] < cutoff) failures.shift();
    return failures.length >= 30;
  }
  const noteFailure = () => failures.push(Date.now());

  /* ---------- auth ---------- */
  function ajAuthed(req) {
    if (!portalKey) return false;
    const c = parseCookies(req.headers.cookie).portal_session;
    return !!c && safeEqual(c, sessionToken);
  }
  function lunaAuthed(req) {
    if (!lunaKey) return false;
    let k = req.headers['x-luna-key'];
    const auth = req.headers.authorization;
    if (!k && auth && /^Bearer /i.test(auth)) k = auth.slice(7);
    if (!k) return false;
    if (keyAttemptsBlocked()) throw new HttpError(429, 'Too many wrong keys. Wait a minute.');
    if (safeEqual(k, lunaKey)) return true;
    noteFailure();
    return false;
  }
  function cookieHeader(req) {
    const https = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.COOKIE_SECURE === '1';
    return 'portal_session=' + sessionToken + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + (https ? '; Secure' : '');
  }

  /* ---------- responses ---------- */
  const SEC = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"
  };
  function send(res, status, body, type, extra) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    res.writeHead(status, Object.assign({ 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store' }, SEC, extra || {}));
    res.end(buf);
  }
  const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
  function sendLocked(res, status, msg) {
    send(res, status, LOCKED_HTML(msg), 'text/html; charset=utf-8',
      { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'That request is too large.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  function parseJson(text, req) {
    if (!text.trim()) return {};
    const type = String(req.headers['content-type'] || '');
    if (!/json/i.test(type)) throw new HttpError(415, 'Send JSON with a content-type of application/json.');
    try { return JSON.parse(text); } catch (_) { throw new HttpError(400, 'That was not valid JSON.'); }
  }
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
  }

  /* ---------- AJ routes ---------- */
  const routes = [];
  const route = (method, re, who, fn) => routes.push({ method, re, who, fn });

  route('GET', /^\/api\/state$/, 'aj', () => { settleNow(); return { status: 200, body: stateNow() }; });

  route('POST', /^\/api\/quests\/([a-z0-9-]+)\/complete$/, 'aj', (ctx) => {
    const q = questObj(ctx.params[0]);
    if (!q) throw new HttpError(404, 'There is no quest by that id.');
    const chk = G.canComplete(db, q, today());
    if (!chk.ok) throw new HttpError(chk.status, chk.reason);
    if (chk.already) return { status: 200, body: { ok: true, alreadyDone: true, awarded: { xp: 0, bonuses: [], unlocked: [], levelFrom: null, levelTo: null }, state: stateNow() } };
    /* the request body is ignored on purpose: XP is whatever Luna set on the quest */
    const r = mutate(() => G.completeQuest(db, q, today(), nowIso()));
    r.unlocked = r.unlocked.map((id) => ({ id, name: db.content.lands[id].name }));
    return { status: 200, body: { ok: true, alreadyDone: false, awarded: r, state: stateNow() } };
  });

  route('POST', /^\/api\/quests\/([a-z0-9-]+)\/undo$/, 'aj', (ctx) => {
    const q = questObj(ctx.params[0]);
    if (!q) throw new HttpError(404, 'There is no quest by that id.');
    if (q.owner !== 'AJ') throw new HttpError(403, 'That one belongs to ' + q.owner + '.');
    const r = mutate(() => G.undoQuest(db, q, today()));
    if (!r.ok) throw new HttpError(r.status, r.reason);
    return { status: 200, body: { ok: true, state: stateNow() } };
  });

  route('POST', /^\/api\/briefing\/dismiss$/, 'aj', () => {
    mutate(() => { db.progress.briefingDismissed = today(); });
    return { status: 200, body: { ok: true } };
  });

  route('POST', /^\/api\/outbox$/, 'aj', (ctx) => {
    const b = ctx.body;
    if (!C.plain(b)) throw new HttpError(400, 'Send an object with a text field.');
    if (typeof b.text !== 'string' || !b.text.trim()) throw new HttpError(400, 'Write something first.');
    const text = b.text.trim();
    if (text.length > 2000) throw new HttpError(400, 'That message is over 2000 characters. Split it in two.');
    let clientId = null;
    if (b.clientId !== undefined) {
      if (typeof b.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.clientId)) throw new HttpError(400, 'clientId must be 8 to 64 letters, numbers, hyphens or underscores.');
      clientId = b.clientId;
      const dup = db.outbox.find((m) => m.clientId === clientId);
      if (dup) return { status: 200, body: { ok: true, duplicate: true, message: G.buildState(db, clock()).outbox.messages.find((m) => m.id === dup.id) } };
    }
    if (db.outbox.length >= MAX_OUTBOX) throw new HttpError(400, 'The outbox is full. Ask Luna to clear the old ones.');
    const hourAgo = new Date(clock().getTime() - 3600 * 1000).toISOString();
    if (db.outbox.filter((m) => m.at > hourAgo).length >= 30) throw new HttpError(429, 'That is a lot of messages in a row. Give it a few minutes.');
    const at = nowIso();
    const m = {
      id: crypto.randomBytes(6).toString('hex'), clientId, text, at, status: 'new', routedTo: null, workingBy: null,
      replies: [], updatedAt: at, updatedBy: 'AJ', history: [{ status: 'new', by: 'AJ', at }]
    };
    mutate(() => { db.outbox.push(m); });
    return { status: 201, body: { ok: true, duplicate: false, message: stateNow().outbox.messages.find((x) => x.id === m.id) } };
  });

  route('POST', /^\/api\/outbox\/seen$/, 'aj', () => {
    mutate(() => { db.progress.outboxSeenAt = nowIso(); });
    return { status: 200, body: { ok: true } };
  });

  route('POST', /^\/api\/outbox\/([a-f0-9]+)\/withdraw$/, 'aj', (ctx) => {
    const m = db.outbox.find((x) => x.id === ctx.params[0]);
    if (!m) throw new HttpError(404, 'There is no message by that id.');
    if (m.status !== 'new') throw new HttpError(409, 'Luna has already opened that one. Send a new message if you changed your mind.');
    mutate(() => {
      m.status = 'withdrawn'; m.updatedAt = nowIso(); m.updatedBy = 'AJ';
      m.history.push({ status: 'withdrawn', by: 'AJ', at: m.updatedAt });
    });
    return { status: 200, body: { ok: true } };
  });

  /* ---------- Luna routes ---------- */
  const messageForLuna = (m) => ({
    id: m.id, text: m.text, at: m.at, status: m.status, label: G.labelFor(m), routedTo: m.routedTo, workingBy: m.workingBy,
    replies: m.replies, updatedAt: m.updatedAt, history: m.history
  });
  const LUNA_STATUS_FILTER = G.OUTBOX_STATUSES.concat(['withdrawn']);

  route('GET', /^\/api\/outbox$/, 'luna', (ctx) => {
    let list = db.outbox.slice();
    const sf = ctx.query.get('status');
    if (sf) {
      const want = sf.split(',').map((s) => s.trim()).filter(Boolean);
      for (const s of want) if (!LUNA_STATUS_FILTER.includes(s)) throw new HttpError(400, 'Unknown status "' + s.slice(0, 20) + '". Use: ' + LUNA_STATUS_FILTER.join(', ') + '.');
      list = list.filter((m) => want.includes(m.status));
    }
    const since = ctx.query.get('since');
    if (since) {
      if (Number.isNaN(Date.parse(since))) throw new HttpError(400, 'since must be a date and time.');
      const iso = new Date(since).toISOString();
      list = list.filter((m) => m.updatedAt > iso);
    }
    let limit = 100;
    if (ctx.query.get('limit')) { limit = parseInt(ctx.query.get('limit'), 10); if (!(limit >= 1 && limit <= 500)) throw new HttpError(400, 'limit must be 1 to 500.'); }
    list.sort((a, b) => (a.at < b.at ? -1 : 1));
    const counts = {};
    for (const m of db.outbox) counts[m.status] = (counts[m.status] || 0) + 1;
    return { status: 200, body: { messages: list.slice(0, limit).map(messageForLuna), counts, total: db.outbox.length } };
  });

  route('POST', /^\/api\/outbox\/([a-f0-9]+)\/status$/, 'luna', (ctx) => {
    const m = db.outbox.find((x) => x.id === ctx.params[0]);
    if (!m) throw new HttpError(404, 'There is no message by that id.');
    const b = ctx.body;
    if (!C.plain(b)) throw new HttpError(400, 'Send an object.');
    for (const k of Object.keys(b)) if (!['status', 'routedTo', 'by', 'reply'].includes(k)) throw new HttpError(400, 'Unknown field "' + k.slice(0, 30) + '". Allowed: status, routedTo, by, reply.');
    if (b.status === undefined && b.reply === undefined) throw new HttpError(400, 'Send a status, a reply, or both.');
    if (m.status === 'withdrawn') throw new HttpError(409, 'AJ withdrew that message.');
    const names = Object.keys(db.content.party);
    const by = b.by === undefined ? 'Luna' : b.by;
    if (!names.includes(by)) throw new HttpError(400, 'by must be one of: ' + names.join(', ') + '.');
    if (b.status !== undefined && !G.OUTBOX_STATUSES.includes(b.status)) throw new HttpError(400, 'status must be one of: ' + G.OUTBOX_STATUSES.join(', ') + '.');
    if (b.routedTo !== undefined && b.routedTo !== null && !names.includes(b.routedTo)) throw new HttpError(400, 'routedTo must be one of: ' + names.join(', ') + '.');
    if (b.status === 'routed' && !(b.routedTo || m.routedTo)) throw new HttpError(400, 'Say who it was routed to with routedTo.');
    let reply = null;
    if (b.reply !== undefined) {
      if (typeof b.reply !== 'string' || !b.reply.trim() || b.reply.trim().length > 2000) throw new HttpError(400, 'reply must be 1 to 2000 characters.');
      reply = b.reply.trim();
    }
    mutate(() => {
      const at = nowIso();
      if (b.routedTo !== undefined) m.routedTo = b.routedTo;
      if (b.status !== undefined) {
        m.status = b.status;
        if (b.status === 'working') m.workingBy = b.by !== undefined ? by : (m.routedTo || 'Luna');
        m.history.push({ status: b.status, by, at, routedTo: m.routedTo || null });
        if (m.history.length > 50) m.history.splice(0, m.history.length - 50);
      }
      if (reply) m.replies.push({ from: by, text: reply, at });
      m.updatedAt = at; m.updatedBy = by;
    });
    return { status: 200, body: { ok: true, message: messageForLuna(m) } };
  });

  route('GET', /^\/api\/luna\/content$/, 'luna', () => ({ status: 200, body: { content: db.content } }));

  route('GET', /^\/api\/luna\/progress$/, 'luna', () => {
    const s = stateNow();
    const p = db.progress;
    const recent = Object.keys(p.habits).sort().slice(-14);
    return { status: 200, body: {
      today: s.today.date, level: s.hero.level, xp: s.hero.xp, dial: s.hero.dial,
      completions: p.completions, unlocked: p.unlocked, bonuses: p.bonuses,
      habits: Object.fromEntries(recent.map((d) => [d, p.habits[d]])),
      landsOpen: s.lands.filter((l) => l.open).map((l) => l.id),
      outboxCounts: db.outbox.reduce((n, m) => { n[m.status] = (n[m.status] || 0) + 1; return n; }, {})
    } };
  });

  /* Content edits: build the new document, check all of it, then swap it in one step. */
  function contentWrite(build, extra) {
    mutate(() => {
      const next = build(db.content);
      next.updatedAt = nowIso();
      db.content = next;
      G.settle(db, today(), nowIso());
    });
    return Object.assign({ ok: true, updatedAt: db.content.updatedAt }, extra || {});
  }
  route('PUT', /^\/api\/oura$/, 'luna', (ctx) => ({ status: 200, body: contentWrite((c) => C.applyOura(c, ctx.body, nowIso()), { oura: db.content.oura }) }));
  route('PUT', /^\/api\/usage$/, 'luna', (ctx) => ({ status: 200, body: contentWrite((c) => C.applyUsage(c, ctx.body)) }));
  route('PUT', /^\/api\/party$/, 'luna', (ctx) => ({ status: 200, body: contentWrite((c) => C.applyParty(c, ctx.body)) }));
  route('PUT', /^\/api\/plans$/, 'luna', (ctx) => ({ status: 200, body: contentWrite((c) => C.applyPlans(c, ctx.body)) }));
  route('PUT', /^\/api\/hero$/, 'luna', (ctx) => ({ status: 200, body: contentWrite((c) => C.applyHero(c, ctx.body)) }));
  route('PUT', /^\/api\/lands$/, 'luna', (ctx) => ({ status: 200, body: contentWrite((c) => C.applyLandChanges(c, ctx.body)) }));
  route('PUT', /^\/api\/briefing$/, 'luna', (ctx) => ({ status: 200, body: contentWrite((c) => C.applyBriefing(c, ctx.body, today(), nowIso())) }));
  route('PUT', /^\/api\/quests$/, 'luna', (ctx) => ({ status: 200, body: contentWrite((c) => C.applyQuestChanges(c, ctx.body)) }));
  route('PUT', /^\/api\/quests\/([a-z0-9-]+)$/, 'luna', (ctx) => ({
    status: 200, body: contentWrite((c) => C.applyQuestChanges(c, { [ctx.params[0]]: ctx.body }))
  }));
  route('DELETE', /^\/api\/quests\/([a-z0-9-]+)$/, 'luna', (ctx) => ({
    status: 200, body: contentWrite((c) => C.applyQuestChanges(c, { [ctx.params[0]]: null }))
  }));

  /* ---------- request handling ---------- */
  function serveStatic(res, pathname) {
    const name = pathname === '/' ? '/index.html' : pathname;
    if (!/^\/[A-Za-z0-9._-]+$/.test(name)) return false;
    const file = path.join(PUBLIC_DIR, name);
    if (path.dirname(file) !== PUBLIC_DIR || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    return true;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://portal.local');
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true });
    if (method === 'GET' && OPEN_FILES.includes(pathname)) { if (serveStatic(res, pathname)) return; }

    /* the link AJ opens: sets the cookie, then drops the key from the address bar */
    if (method === 'GET' && url.searchParams.has('key')) {
      if (!portalKey) return sendLocked(res, 503, 'The portal is not set up yet.');
      if (keyAttemptsBlocked()) return sendLocked(res, 429, 'Too many tries. Wait a minute and open the link again.');
      if (safeEqual(url.searchParams.get('key'), portalKey)) {
        res.writeHead(302, Object.assign({ Location: pathname === '/' || serveStaticExists(pathname) ? pathname : '/', 'Set-Cookie': cookieHeader(req), 'Cache-Control': 'no-store' }, SEC));
        return res.end();
      }
      noteFailure();
      return sendLocked(res, 401, 'That link did not work. Ask for a fresh one.');
    }
    if (method === 'POST' && pathname === '/unlock') {
      if (!portalKey) return sendLocked(res, 503, 'The portal is not set up yet.');
      if (keyAttemptsBlocked()) return sendLocked(res, 429, 'Too many tries. Wait a minute and try again.');
      const text = await readBody(req);
      const key = new URLSearchParams(text).get('key') || '';
      if (key && safeEqual(key, portalKey)) {
        res.writeHead(303, Object.assign({ Location: '/', 'Set-Cookie': cookieHeader(req), 'Cache-Control': 'no-store' }, SEC));
        return res.end();
      }
      noteFailure();
      return sendLocked(res, 401, 'That key did not work.');
    }

    let hit = null;
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.re);
      if (m) { hit = { r, params: m.slice(1) }; break; }
    }
    if (!hit) {
      if (pathname.startsWith('/api/')) {
        if (!ajAuthed(req) && !(lunaKey && req.headers['x-luna-key'])) return sendJson(res, 401, { error: 'This portal is private.' });
        return sendJson(res, 404, { error: 'There is nothing at that address.' });
      }
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'That method is not allowed.' });
      if (!ajAuthed(req)) return sendLocked(res, portalKey ? 401 : 503, portalKey ? 'This portal is private. Open it with the link AJ was given.' : 'The portal is not set up yet.');
      if (serveStatic(res, pathname)) return;
      return sendJson(res, 404, { error: 'There is nothing at that address.' });
    }

    if (hit.r.who === 'aj') {
      if (!ajAuthed(req)) return sendJson(res, 401, { error: 'This portal is private. Open it with the link AJ was given.' });
      if (method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'That request came from another site.' });
    } else {
      if (!lunaKey) return sendJson(res, 503, { error: 'Luna’s key is not set on this server.' });
      if (!lunaAuthed(req)) return sendJson(res, 401, { error: 'That key did not work.' });
    }
    let body = {};
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') body = parseJson(await readBody(req), req);
    const result = hit.r.fn({ params: hit.params, query: url.searchParams, body });
    return sendJson(res, result.status, result.body);
  }
  function serveStaticExists(p) { return /^\/[A-Za-z0-9._-]+$/.test(p) && fs.existsSync(path.join(PUBLIC_DIR, p)); }

  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    handle(req, res).catch((e) => {
      const status = e instanceof HttpError || e instanceof C.Bad ? e.status : 500;
      if (status === 500) {
        log('Error:', e && e.message);
        e = new Error('Something went wrong on our side. Nothing was changed.');
      }
      if (!res.headersSent) sendJson(res, status, { error: e.message });
      else res.end();
    }).finally(() => {
      log(req.method, new URL(req.url, 'http://x').pathname, res.statusCode, (Date.now() - t0) + 'ms');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port === undefined ? (parseInt(process.env.PORT, 10) || 3000) : o.port, o.host || '0.0.0.0', () => {
      const port = server.address().port;
      log('AJ Command Portal running on port ' + port + ', data in ' + dataDir);
      resolve({ server, port, dataDir, getDb: () => db, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

module.exports = { start };

if (require.main === module) {
  start().catch((e) => { console.error(e.message); process.exit(1); });
}
