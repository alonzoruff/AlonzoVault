'use strict';
/*
 * Where the saved data lives, and how a request saves it safely.
 *
 * Two modes:
 *
 *   file     (the default) db.json in DATA_DIR, exactly as before.
 *            This is what Render uses. Nothing in this file runs.
 *
 *   upstash  One hosted Upstash Redis database, reached over its
 *            HTTPS (REST) address with Node's built-in fetch, so the
 *            app still has no outside packages. This is for Vercel,
 *            where there is no lasting disk and several short-lived
 *            copies of the app can run at the same moment.
 *
 * Upstash mode turns on only when BOTH a REST address and a token are
 * set. Either naming works (Vercel's Upstash integration sets the KV_
 * pair; Upstash's own console shows the UPSTASH_ pair):
 *
 *   UPSTASH_REDIS_REST_URL  + UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL         + KV_REST_API_TOKEN
 *
 *   STORE_PREFIX  Optional. Key prefix inside the database (each app
 *                 passes its own default). Lets a staging copy share a
 *                 database without touching the real keys, though a
 *                 separate database per app and per stage is better.
 *
 * How saving works in upstash mode (the fix for two saves clashing):
 *
 *   The whole store is kept under one key, next to a version number.
 *   Every API request runs as a small transaction:
 *     1. read the version; if this copy of the app already holds that
 *        version, reuse it, otherwise load the store fresh;
 *     2. run the normal request handler against it, with its reply
 *        held back (nothing reaches the browser yet);
 *     3. if the handler saved, write the store back ONLY IF the
 *        version is still the one we loaded (checked and written in
 *        one atomic step on the Redis side);
 *     4. if someone else saved first, throw the attempt away, load
 *        their version and run the request again from the start;
 *     5. only after the save is safe, run deferred work (emails) and
 *        send the reply.
 *   Inside one copy of the app, requests take turns, so they never
 *   share the in-memory store half-changed.
 */

const zlib = require('zlib');
const { Readable } = require('stream');
const { EventEmitter } = require('events');

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */
function configFromEnv(env, defaultPrefix) {
  const url = String(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '').trim();
  if (!url || !token) return null;
  const prefix = String(env.STORE_PREFIX || defaultPrefix || 'app').trim().replace(/[^A-Za-z0-9_.:-]/g, '') || 'app';
  return { url, token, prefix };
}

/* ------------------------------------------------------------------ */
/* Encoding: gzip + base64 keeps the one big value small.              */
/* ------------------------------------------------------------------ */
const GZ = 'gz1:';
function encode(obj) {
  return GZ + zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
}
function decode(text) {
  if (text === null || text === undefined || text === '') return null;
  const s = String(text);
  const json = s.startsWith(GZ)
    ? zlib.gunzipSync(Buffer.from(s.slice(GZ.length), 'base64')).toString('utf8')
    : s;
  return JSON.parse(json);
}

/* ------------------------------------------------------------------ */
/* Upstash REST client: just the four commands this needs.             */
/* ------------------------------------------------------------------ */
/* Write the store only if the version is still the one we loaded,
   then bump the version. Returns the new version, or -1 on a clash. */
const COMMIT_SCRIPT = [
  "local cur = redis.call('GET', KEYS[2])",
  "if (cur or '0') ~= ARGV[1] then return -1 end",
  "redis.call('SET', KEYS[1], ARGV[2])",
  "return redis.call('INCR', KEYS[2])",
].join('\n');

function createUpstash(cfg, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const dataKey = cfg.prefix + ':db';
  const verKey = cfg.prefix + ':ver';

  async function command(args) {
    const res = await doFetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    let out = null;
    try { out = await res.json(); } catch (_) { /* not JSON */ }
    if (!res.ok || !out || out.error) {
      /* Never include the token or the address in the message. */
      const why = out && out.error ? String(out.error).slice(0, 200) : 'HTTP ' + res.status;
      const err = new Error('data store request failed: ' + why);
      err.storeError = true;
      throw err;
    }
    return out.result;
  }

  function toVersion(v) {
    const n = parseInt(v === null || v === undefined ? '0' : v, 10);
    return Number.isFinite(n) ? n : 0;
  }

  return {
    mode: 'upstash',
    prefix: cfg.prefix,
    async getVersion() {
      return toVersion(await command(['GET', verKey]));
    },
    /* { version, data } — data is null for an empty store. */
    async load() {
      const [raw, ver] = await command(['MGET', dataKey, verKey]);
      return { version: toVersion(ver), data: decode(raw) };
    },
    /* New version number, or -1 if someone else saved first. */
    async commit(expectedVersion, data) {
      const r = await command(['EVAL', COMMIT_SCRIPT, '2', dataKey, verKey,
        String(expectedVersion), encode(data)]);
      return toVersion(r) === -1 ? -1 : toVersion(r);
    },
    /* A counter that resets itself: used for per-minute limits that
       must hold across every copy of the app. */
    async hit(key, ttlSeconds) {
      const k = cfg.prefix + ':hit:' + key;
      const n = await command(['INCR', k]);
      if (n === 1) await command(['EXPIRE', k, String(ttlSeconds)]);
      return n;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Held-back reply: the handler writes here; it reaches the browser    */
/* only after the save is safe.                                        */
/* ------------------------------------------------------------------ */
class HeldResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.headersSent = false;
    this.finished = false;
    this.writableEnded = false;
  }
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; }
  getHeader(name) { return this.headers[String(name).toLowerCase()]; }
  removeHeader(name) { delete this.headers[String(name).toLowerCase()]; }
  hasHeader(name) { return String(name).toLowerCase() in this.headers; }
  writeHead(status, a, b) {
    this.statusCode = status;
    const hdrs = typeof a === 'object' && a ? a : (typeof b === 'object' && b ? b : null);
    if (hdrs) for (const k of Object.keys(hdrs)) this.setHeader(k, hdrs[k]);
    this.headersSent = true;
    return this;
  }
  write(chunk, enc) {
    if (chunk !== undefined && chunk !== null) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof enc === 'string' ? enc : 'utf8'));
    }
    this.headersSent = true;
    return true;
  }
  end(chunk, enc) {
    if (this.finished) return this;
    if (typeof chunk === 'function') chunk = undefined;
    if (chunk !== undefined && chunk !== null) this.write(chunk, enc);
    this.headersSent = true;
    this.finished = true;
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }
  body() { return Buffer.concat(this.chunks); }
}

/* Replies bigger than this go out gzipped when the browser accepts it,
   which keeps backup downloads under Vercel's reply size cap longer. */
const GZIP_REPLY_OVER = 1024 * 1024;

function sendHeld(held, req, res) {
  let body = held.body();
  const headers = Object.assign({}, held.headers);
  const accepts = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (accepts && body.length > GZIP_REPLY_OVER && !headers['content-encoding']) {
    body = zlib.gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'Accept-Encoding';
  }
  if (headers['content-length'] !== undefined || body.length) headers['content-length'] = body.length;
  res.writeHead(held.statusCode, headers);
  res.end(body);
}

/* A request that can be read again on a retry. */
function replayableRequest(req, body) {
  const r = Readable.from(body.length ? [body] : [], { objectMode: false });
  r.headers = req.headers;
  r.rawHeaders = req.rawHeaders;
  r.method = req.method;
  r.url = req.url;
  r.httpVersion = req.httpVersion;
  r.socket = req.socket;
  r.connection = req.socket;
  return r;
}

function readWholeBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) { over = true; chunks.length = 0; return; }
      if (!over) chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function plainJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/* ------------------------------------------------------------------ */
/* The transaction runner                                              */
/* ------------------------------------------------------------------ */
/*
 * app = {
 *   setData(dataOrNull)  replace the in-memory store (null = empty)
 *                        and run the usual startup tidy-up and seeds
 *   getData()            the in-memory store to save
 *   handle(req, res)     the normal API handler (may return a promise)
 *   log(msg)             optional logger
 * }
 * Returns { run(req, res), markDirty(), defer(fn) }.
 */
function createTransactions(store, app, opts) {
  const o = Object.assign({ attempts: 5, timeoutMs: 25000, bodyCap: 11 * 1024 * 1024 }, opts || {});
  const log = app.log || ((m) => console.error(m));
  let cachedVersion = null;   /* version held in memory, or null = reload */
  let current = null;         /* the transaction now running */
  let queue = Promise.resolve();

  function markDirty() { if (current) current.dirty = true; }
  /* Work that must happen only once the save is safe (emails).
     Outside a transaction it just runs. */
  function defer(fn) {
    if (current) { current.after.push(fn); return; }
    Promise.resolve().then(fn).catch(() => {});
  }

  async function freshData() {
    const v = await store.getVersion();
    if (v === cachedVersion) return;
    const { version, data } = await store.load();
    app.setData(data);
    cachedVersion = version;
  }

  function runHandler(req, held) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('handler timed out')), o.timeoutMs);
      if (timer.unref) timer.unref();
      held.once('finish', () => { clearTimeout(timer); resolve(); });
      Promise.resolve()
        .then(() => app.handle(req, held))
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  }

  async function attempt(req, body) {
    const tx = { dirty: false, after: [] };
    /* Loading inside the transaction lets the startup seeds (which
       save) be written along with this request. */
    current = tx;
    const held = new HeldResponse();
    try {
      await freshData();
      await runHandler(replayableRequest(req, body), held);
    } catch (err) {
      cachedVersion = null; /* the in-memory store may be half-changed */
      throw err;
    } finally {
      current = null;
    }
    if (tx.dirty) {
      const next = await store.commit(cachedVersion, app.getData());
      if (next === -1) {
        cachedVersion = null; /* someone else saved first: reload, retry */
        return { clash: true };
      }
      cachedVersion = next;
    }
    /* The save is safe. Finish deferred work before replying, so the
       host cannot freeze the app with an email half-sent. */
    for (const fn of tx.after) {
      try { await fn(); } catch (err) { log('[store] after-save task failed: ' + (err && err.message)); }
    }
    return { held };
  }

  async function runOne(req, res) {
    const body = await readWholeBody(req, o.bodyCap);
    if (body === null) return plainJson(res, 413, { error: 'That upload is too large.' });
    for (let i = 0; i < o.attempts; i++) {
      let out;
      try {
        out = await attempt(req, body);
      } catch (err) {
        log('[store] request failed: ' + (err && err.message));
        return plainJson(res, err && err.storeError ? 503 : 500,
          { error: err && err.storeError ? 'The data store is not answering. Please try again in a moment.' : 'Something went wrong. Please try again.' });
      }
      if (out.held) return sendHeld(out.held, req, res);
      await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 60) * (i + 1)));
    }
    log('[store] gave up after ' + o.attempts + ' save clashes');
    return plainJson(res, 503, { error: 'Too many changes at once. Please try again.' });
  }

  function run(req, res) {
    const p = queue.then(() => runOne(req, res));
    queue = p.catch(() => {});
    return p.catch((err) => {
      try { if (!res.headersSent) plainJson(res, 500, { error: 'Something went wrong. Please try again.' }); } catch (_) { /* gone */ }
      log('[store] ' + (err && err.message));
    });
  }

  return { run, markDirty, defer, inTransaction: () => !!current };
}

module.exports = {
  configFromEnv,
  createUpstash,
  createTransactions,
  encode,
  decode,
  HeldResponse,
};
