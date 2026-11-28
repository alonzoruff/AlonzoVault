'use strict';
/*
 * Meet entry tracker: the server side.
 *
 * Meets are data files in portal/meets/<id>.json (see public/entries-rules.js for the shape).
 * Names AJ types are saved in DATA_DIR/entries.json, a separate file from portal.json, written
 * the same way: temp file, fsync, keep the old copy as .bak, rename over. If entries.json cannot
 * be read the server refuses to start and leaves the file alone.
 *
 * entries.json: { schema: 1, meets: { [meetId]: { names: { [eventId]: [..] }, updatedAt } } }
 * Names are kept even if a meet's slot count is lowered or an event is removed later, so
 * nothing AJ typed is ever dropped by a data change.
 */
const fs = require('fs');
const path = require('path');
const R = require('../public/entries-rules');

const MEETS_DIR = path.join(__dirname, '..', 'meets');

function loadMeets(dir) {
  const meets = [];
  if (!fs.existsSync(dir)) return meets;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error('meets/' + f + ' is not valid JSON (' + e.message + ').'); }
    R.checkMeet(m, 'meets/' + f);
    if (m.id + '.json' !== f) throw new Error('meets/' + f + ': the file name must be the meet id plus .json (' + m.id + '.json).');
    meets.push(m);
  }
  meets.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return meets;
}

function create(opts) {
  const dataDir = opts.dataDir;
  const clock = opts.now || (() => new Date());
  const HttpError = opts.HttpError;
  const meets = loadMeets(opts.meetsDir || MEETS_DIR);
  const meetById = new Map(meets.map((m) => [m.id, m]));

  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'entries.json');
  const tmp = file + '.tmp';
  try { fs.rmSync(tmp, { force: true }); } catch (_) { /* leftover from a crash */ }

  function writeAtomic(d) {
    const data = JSON.stringify(d, null, 1);
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch (_) { /* the backup is a courtesy */ }
    fs.renameSync(tmp, file);
  }
  let db;
  if (!fs.existsSync(file)) {
    db = { schema: 1, meets: {} };
  } else {
    try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      throw new Error('entries.json exists but cannot be read (' + e.message + '). Nothing was changed. Restore entries.json.bak or fix the file, then start again.');
    }
    if (!db || typeof db !== 'object' || !db.meets || typeof db.meets !== 'object') throw new Error('entries.json has no meets section. Nothing was changed.');
  }

  function namesFor(meetId) { return (db.meets[meetId] && db.meets[meetId].names) || {}; }
  function meetOr404(id) {
    const m = meetById.get(id);
    if (!m) throw new HttpError(404, 'There is no meet by that id.');
    return m;
  }
  function full(m) {
    const names = namesFor(m.id);
    const view = R.review(m, names);
    return { meet: m, names, updatedAt: (db.meets[m.id] && db.meets[m.id].updatedAt) || null, filled: view.filled, total: view.total, warnings: R.summary(view.warnings) };
  }

  function list() {
    return meets.map((m) => {
      const v = R.review(m, namesFor(m.id));
      return { id: m.id, name: m.name, date: m.date, dateLabel: m.dateLabel || m.date, entriesClose: m.entriesClose || null,
        events: m.events.length, filled: v.filled, total: v.total, warnings: R.summary(v.warnings).length };
    });
  }

  /* Set one slot. `was` (optional) is what the phone last saw there; if someone else changed
     it in the meantime the save is refused with 409 and the current name, so nothing is overwritten blind. */
  function setSlot(meetId, eventId, slotText, body) {
    const m = meetOr404(meetId);
    const ev = m.events.find((e) => e.id === eventId);
    if (!ev) throw new HttpError(404, 'That meet has no event by that id.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send an object with a name field.');
    for (const k of Object.keys(body)) if (k !== 'name' && k !== 'was') throw new HttpError(400, 'Unknown field "' + k.slice(0, 30) + '". Allowed: name, was.');
    if (typeof body.name !== 'string') throw new HttpError(400, 'name must be text (send "" to clear the slot).');
    if (body.was !== undefined && typeof body.was !== 'string') throw new HttpError(400, 'was must be text.');
    const name = R.clean(body.name);
    if (name.length > R.MAX_NAME) throw new HttpError(400, 'Names can be at most ' + R.MAX_NAME + ' characters.');
    if (/[\u0000-\u001f\u007f<>]/.test(name)) throw new HttpError(400, 'Names cannot hold < > or control characters.');
    const slot = Number(slotText);
    const current = (namesFor(m.id)[ev.id] || []).slice();
    const limit = Math.max(R.slotCount(m, ev), current.length);
    if (!Number.isInteger(slot) || slot < 0 || slot >= limit) throw new HttpError(400, ev.name + ' has ' + R.slotCount(m, ev) + ' slots. Slot numbers start at 0.');
    const before = current[slot] || '';
    if (body.was !== undefined && R.clean(body.was) !== before) {
      const err = new HttpError(409, before ? 'That slot was changed somewhere else. It now says ' + before + '.' : 'That slot was cleared somewhere else.');
      err.extra = { current: before };
      throw err;
    }
    if (before !== name) {
      const backup = JSON.stringify(db);
      try {
        const rec = db.meets[m.id] || (db.meets[m.id] = { names: {}, updatedAt: null });
        while (current.length <= slot) current.push('');
        current[slot] = name;
        while (current.length && !current[current.length - 1]) current.pop();
        rec.names[ev.id] = current;
        rec.updatedAt = clock().toISOString();
        writeAtomic(db);
      } catch (e) {
        db = JSON.parse(backup);
        throw e;
      }
    }
    return full(m);
  }

  function register(route) {
    route('GET', /^\/api\/entries$/, 'aj', () => ({ status: 200, body: { meets: list() } }));
    route('GET', /^\/api\/entries\/([a-z0-9-]+)$/, 'aj', (ctx) => ({ status: 200, body: full(meetOr404(ctx.params[0])) }));
    route('PUT', /^\/api\/entries\/([a-z0-9-]+)\/([a-z0-9-]+)\/(\d{1,3})$/, 'aj', (ctx) => ({
      status: 200, body: Object.assign({ ok: true }, setSlot(ctx.params[0], ctx.params[1], ctx.params[2], ctx.body))
    }));
    /* Luna can read entries (to file them on MileSplit or Athletic.net); she cannot change them. */
    route('GET', /^\/api\/luna\/entries$/, 'luna', () => ({ status: 200, body: { meets: list() } }));
    route('GET', /^\/api\/luna\/entries\/([a-z0-9-]+)$/, 'luna', (ctx) => ({ status: 200, body: full(meetOr404(ctx.params[0])) }));
  }

  return { register, meets, getDb: () => db };
}

module.exports = { create, loadMeets, MEETS_DIR };
