'use strict';
/*
 * The limit on password guesses.
 *
 * In plain words: after 5 wrong passwords in a row for one email
 * (within 15 minutes), sign-in for that email is paused for 15
 * minutes. During the pause even the right password is turned away,
 * so a guesser learns nothing. A right password before the pause
 * starts clears the count, so a member who mistypes twice and then
 * gets it right starts fresh.
 *
 * One web address (one network) gets a bigger allowance across every
 * email it tries: 30 wrong passwords in 15 minutes pauses sign-in
 * from that address for 15 minutes. That stops one machine walking
 * down a list of emails.
 *
 * Where the count lives:
 *   - Render (file mode, one copy of the app): in memory. A restart
 *     clears it, which is fine for a 15-minute pause. Nothing is
 *     written to db.json.
 *   - Vercel (store mode, many short-lived copies): in the Upstash
 *     store, so every copy sees the same count. Each counter deletes
 *     itself when its time is up.
 * Emails and addresses are never stored as typed: only a keyed
 * one-way hash (HMAC with the app's session secret) is used as the
 * name of a counter.
 *
 * If the store cannot be reached, sign-in is not blocked by this
 * limit (the rest of the app would be down anyway).
 */
const crypto = require('crypto');

const EMAIL_LIMIT = 5;
const ADDRESS_LIMIT = 30;
const WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 15 * 60;
const MEMORY_CAP = 5000;

function createGuessLimit(opts) {
  const store = opts.store || null;
  const secret = opts.secret || 'guess-limit';
  const now = opts.now || (() => Date.now());

  const tag = (kind, value) => kind + ':' + crypto.createHmac('sha256', secret)
    .update(kind + '|' + String(value)).digest('hex').slice(0, 24);

  /* ---------- memory backend (Render) ---------- */
  const mem = new Map(); /* key -> { count, until } (until in ms) */
  function memGet(key) {
    const e = mem.get(key);
    if (!e) return 0;
    if (e.until <= now()) { mem.delete(key); return 0; }
    return e.count;
  }
  function memHit(key, ttl) {
    if (mem.size > MEMORY_CAP) {
      const t = now();
      for (const [k, e] of mem) if (e.until <= t) mem.delete(k);
      /* Still full: drop running counts first and keep the pauses,
         so a flood of new emails cannot lift a pause early. */
      if (mem.size > MEMORY_CAP) for (const k of mem.keys()) if (k.startsWith('gl:fail:')) mem.delete(k);
      if (mem.size > MEMORY_CAP) mem.clear();
    }
    const cur = memGet(key);
    if (!cur) { mem.set(key, { count: 1, until: now() + ttl * 1000 }); return 1; }
    const e = mem.get(key);
    e.count += 1;
    return e.count;
  }

  /* ---------- the four small steps, either backend ---------- */
  async function get(key) {
    if (!store) return memGet(key);
    return store.peekHit(key);
  }
  async function hit(key, ttl) {
    if (!store) return memHit(key, ttl);
    return store.hit(key, ttl);
  }
  async function clear(key) {
    if (!store) { mem.delete(key); return; }
    await store.clearHit(key);
  }

  const lockKey = (t) => 'gl:lock:' + t;
  const failKey = (t) => 'gl:fail:' + t;

  /* Is sign-in paused for this email or this address? */
  async function isLocked(email, address) {
    try {
      const keys = [tag('e', email)];
      if (address) keys.push(tag('a', address));
      for (const t of keys) {
        if ((await get(lockKey(t))) > 0) return true;
      }
      return false;
    } catch (err) {
      console.error('[guess-limit] check failed, not blocking: ' + (err && err.message));
      return false;
    }
  }

  /* Count one wrong password. Starts the pause when a limit is hit. */
  async function recordFailure(email, address) {
    try {
      const pairs = [[tag('e', email), EMAIL_LIMIT]];
      if (address) pairs.push([tag('a', address), ADDRESS_LIMIT]);
      for (const [t, limit] of pairs) {
        const n = await hit(failKey(t), WINDOW_SECONDS);
        if (n >= limit) {
          await hit(lockKey(t), LOCK_SECONDS);
          await clear(failKey(t));
        }
      }
    } catch (err) {
      console.error('[guess-limit] count failed: ' + (err && err.message));
    }
  }

  /* A right password: the email's count starts over. The address
     count is left alone, so a guesser cannot reset it by signing in
     to an account of their own. */
  async function recordSuccess(email) {
    try { await clear(failKey(tag('e', email))); }
    catch (err) { console.error('[guess-limit] reset failed: ' + (err && err.message)); }
  }

  return { isLocked, recordFailure, recordSuccess };
}

/* The address a request came from. Vercel and Render both put the
   visitor's address first in x-forwarded-for. */
function requestAddress(req) {
  const fwd = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || '';
}

module.exports = {
  createGuessLimit, requestAddress,
  EMAIL_LIMIT, ADDRESS_LIMIT, WINDOW_SECONDS, LOCK_SECONDS,
};
