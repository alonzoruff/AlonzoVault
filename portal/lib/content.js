'use strict';
/*
 * Validation and merging for the content document, the part of the data
 * that Luna edits. Everything here throws Bad (status 400) with a plain
 * sentence, so Luna sees what to fix. Nothing here touches AJ's progress.
 */
class Bad extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

const OWNERS = ['AJ', 'Luna', 'Char', 'Claude'];
const PARTY_STATUSES = ['Moving', 'Blocked', 'Waiting on AJ', 'Done'];
const PARTY_STATES = ['active', 'waiting', 'idle'];
const ICONS = ['heart', 'trophy', 'flask', 'coin', 'star'];
const SPRITES = ['moon', 'bubble', 'terminal', 'star', 'heart', 'trophy', 'flask', 'coin'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_RE = /^[A-Z][A-Za-z]{1,19}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function plain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function str(v, name, max) {
  if (typeof v !== 'string') throw new Bad(name + ' must be text.');
  const t = v.trim();
  if (!t || t.length > max) throw new Bad(name + ' must be 1 to ' + max + ' characters.');
  return t;
}
function whole(v, name, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Bad(name + ' must be a whole number from ' + lo + ' to ' + hi + '.');
  return v;
}
function oneOf(v, list, name) {
  if (!list.includes(v)) throw new Bad(name + ' must be one of: ' + list.join(', ') + '.');
  return v;
}
function onlyFields(obj, allowed, what) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new Bad('Unknown field "' + k.slice(0, 40) + '" on ' + what + '. Allowed: ' + allowed.join(', ') + '.');
  }
}
function needObject(v, what) {
  if (!plain(v)) throw new Bad(what + ' must be an object.');
  return v;
}
/* One level merge: a null value removes the field, anything else replaces it. */
function patch(base, change) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(change)) {
    if (change[k] === null) delete out[k]; else out[k] = change[k];
  }
  return out;
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ---------- quests ---------- */
const QUEST_FIELDS = ['land', 'title', 'owner', 'xp', 'status', 'needs', 'detail', 'date', 'end', 'time', 'place', 'opens', 'due', 'dueLabel', 'repeat', 'order'];

function checkQuest(id, q, content) {
  if (!ID_RE.test(id)) throw new Bad('Quest ids use lowercase letters, numbers and hyphens, up to 40 characters.');
  needObject(q, 'Quest ' + id);
  onlyFields(q, QUEST_FIELDS, 'quest ' + id);
  const out = {};
  out.land = str(q.land, 'land', 40);
  if (!content.lands[out.land]) throw new Bad('Quest ' + id + ' points at a land that does not exist: ' + out.land + '.');
  out.title = str(q.title, 'title', 120);
  out.owner = oneOf(q.owner, OWNERS, 'owner');
  if (q.detail !== undefined) out.detail = str(q.detail, 'detail', 160);
  if (q.time !== undefined) out.time = str(q.time, 'time', 20);
  if (q.place !== undefined) out.place = str(q.place, 'place', 80);
  if (q.dueLabel !== undefined) out.dueLabel = str(q.dueLabel, 'dueLabel', 40);
  if (q.order !== undefined) out.order = whole(q.order, 'order', 0, 9999);
  for (const f of ['date', 'end', 'opens', 'due']) {
    if (q[f] !== undefined) {
      if (!isDate(q[f])) throw new Bad(f + ' must be a real date written like 2026-11-30.');
      out[f] = q[f];
    }
  }
  if (out.end && !out.date) throw new Bad('end needs a date to start from.');
  if (out.end && out.end < out.date) throw new Bad('end cannot be before date.');
  if (q.repeat !== undefined) {
    out.repeat = oneOf(q.repeat, ['daily'], 'repeat');
    if (out.owner !== 'AJ') throw new Bad('Only AJ quests can repeat.');
    if (out.date || out.end || out.due || out.opens) throw new Bad('A daily quest cannot also carry dates.');
  }
  if (out.owner === 'AJ') {
    if (q.status !== undefined) throw new Bad('AJ quests have no status. They are open or done, and only AJ completes them.');
    if (q.needs !== undefined) throw new Bad('needs is for party quests.');
    out.xp = q.xp === undefined ? 10 : whole(q.xp, 'xp', 0, 100);
  } else {
    if (q.xp !== undefined) throw new Bad('Only AJ quests carry XP.');
    if (out.repeat) throw new Bad('Only AJ quests can repeat.');
    out.status = q.status === undefined ? 'Moving' : oneOf(q.status, PARTY_STATUSES, 'status');
    if (q.needs !== undefined) {
      if (q.needs === id) throw new Bad('A quest cannot wait on itself.');
      if (!content.quests[q.needs]) throw new Bad('needs points at a quest that does not exist: ' + String(q.needs).slice(0, 40) + '.');
      out.needs = q.needs;
      let hops = 0, cur = content.quests[q.needs];
      while (cur && cur.needs && hops < 50) {
        if (cur.needs === id) throw new Bad('Those quests wait on each other, so neither could ever start.');
        cur = content.quests[cur.needs]; hops++;
      }
    }
  }
  return out;
}

/* changes: { id: patchObject | null }. Returns a new content document. */
function applyQuestChanges(content, changes) {
  needObject(changes, 'The quest changes');
  const next = clone(content);
  const ids = Object.keys(changes);
  if (!ids.length) throw new Bad('No quests in that request.');
  if (ids.length > 100) throw new Bad('Send up to 100 quests at a time.');
  for (const id of ids) {
    if (!ID_RE.test(id)) throw new Bad('Quest ids use lowercase letters, numbers and hyphens, up to 40 characters.');
    const ch = changes[id];
    if (ch === null) {
      if (!next.quests[id]) throw new Bad('There is no quest ' + id + ' to remove.', 404);
      for (const [oid, oq] of Object.entries(next.quests)) {
        if (oq.needs === id) delete oq.needs;
      }
      if (next.briefing.focus === id) { next.briefing.focus = null; next.briefing.focusDate = null; }
      delete next.quests[id];
      continue;
    }
    needObject(ch, 'The change for ' + id);
    const merged = patch(next.quests[id] || {}, ch);
    if (!next.quests[id]) {
      for (const need of ['land', 'title', 'owner']) {
        if (merged[need] === undefined) throw new Bad('A new quest needs ' + need + '. (' + id + ')');
      }
    }
    /* switching owner clears fields that belong to the other kind */
    if (ch.owner !== undefined && next.quests[id]) {
      if (ch.owner === 'AJ') { delete merged.status; delete merged.needs; }
      else { delete merged.xp; delete merged.repeat; }
    }
    next.quests[id] = merged;   /* checked below, once the whole batch is in place */
  }
  if (Object.keys(next.quests).length > 300) throw new Bad('That is more than 300 quests. Remove some first.');
  /* check every quest against the finished document, so a batch can add a quest
     and the quest that waits on it together, and so removals cannot strand a pointer */
  for (const qid of Object.keys(next.quests)) next.quests[qid] = checkQuest(qid, next.quests[qid], next);
  return next;
}

/* ---------- lands ---------- */
const LAND_FIELDS = ['name', 'blurb', 'icon', 'order', 'unlock'];
function checkLand(id, l) {
  if (!ID_RE.test(id)) throw new Bad('Land ids use lowercase letters, numbers and hyphens, up to 40 characters.');
  needObject(l, 'Land ' + id);
  onlyFields(l, LAND_FIELDS, 'land ' + id);
  if (l.blurb !== undefined && (typeof l.blurb !== 'string' || l.blurb.length > 120)) throw new Bad('blurb must be text up to 120 characters.');
  const out = { name: str(l.name, 'name', 40), blurb: (l.blurb || '').trim(), icon: oneOf(l.icon, ICONS, 'icon'), order: whole(l.order, 'order', 0, 99) };
  out.unlock = null;
  if (l.unlock !== undefined && l.unlock !== null) {
    needObject(l.unlock, 'unlock');
    onlyFields(l.unlock, ['anyOf'], 'unlock');
    if (!Array.isArray(l.unlock.anyOf) || l.unlock.anyOf.length < 1 || l.unlock.anyOf.length > 3) throw new Bad('unlock.anyOf needs 1 to 3 entries.');
    out.unlock = { anyOf: l.unlock.anyOf.map((a) => {
      needObject(a, 'An unlock entry');
      onlyFields(a, ['land', 'need'], 'an unlock entry');
      return { land: str(a.land, 'unlock land', 40), need: whole(a.need, 'unlock need', 1, 20) };
    }) };
  }
  return out;
}
function applyLandChanges(content, changes) {
  needObject(changes, 'The land changes');
  const next = clone(content);
  const ids = Object.keys(changes);
  if (!ids.length) throw new Bad('No lands in that request.');
  for (const id of ids) {
    const ch = changes[id];
    if (ch === null) {
      if (!next.lands[id]) throw new Bad('There is no land ' + id + ' to remove.', 404);
      if (Object.values(next.quests).some((q) => q.land === id)) throw new Bad('Land ' + id + ' still has quests. Move or remove them first.');
      delete next.lands[id];
      continue;
    }
    needObject(ch, 'The change for ' + id);
    const merged = patch(next.lands[id] || { order: 99 }, ch);
    next.lands[id] = checkLand(id, merged);
  }
  if (!Object.keys(next.lands).length) throw new Bad('There has to be at least one land.');
  /* every unlock must point at a real, different land, with no loops */
  for (const [id, l] of Object.entries(next.lands)) {
    if (!l.unlock) continue;
    for (const a of l.unlock.anyOf) {
      if (!next.lands[a.land]) throw new Bad('Land ' + id + ' unlocks from ' + a.land + ', which does not exist.');
      if (a.land === id) throw new Bad('A land cannot unlock from itself.');
    }
  }
  const state = {};
  const visit = (id) => {
    if (state[id] === 2) return;
    if (state[id] === 1) throw new Bad('Those unlock rules loop back on themselves, so no land in the loop could ever open.');
    state[id] = 1;
    const l = next.lands[id];
    if (l.unlock) for (const a of l.unlock.anyOf) visit(a.land);
    state[id] = 2;
  };
  Object.keys(next.lands).forEach(visit);
  if (!Object.values(next.lands).some((l) => !l.unlock)) throw new Bad('At least one land has to be open from the start.');
  if (next.briefing.focus && !next.quests[next.briefing.focus]) { next.briefing.focus = null; next.briefing.focusDate = null; }
  return next;
}

/* ---------- oura ---------- */
function applyOura(content, body, nowIso) {
  needObject(body, 'The Oura update');
  onlyFields(body, ['asOf', 'sleep', 'readiness'], 'the Oura update');
  if (!Object.keys(body).length) throw new Bad('Send at least one of asOf, sleep, readiness.');
  const next = clone(content);
  const o = next.oura;
  if (body.asOf !== undefined) o.asOf = body.asOf === null ? null : str(body.asOf, 'asOf', 60);
  for (const f of ['sleep', 'readiness']) {
    if (body[f] !== undefined) o[f] = body[f] === null ? null : whole(body[f], f, 0, 100);
  }
  o.updatedAt = nowIso;
  return next;
}

/* ---------- party ---------- */
const PARTY_FIELDS = ['role', 'job', 'status', 'state', 'sprite'];
function applyParty(content, body) {
  let changes = body;
  if (Array.isArray(body)) {          /* accept the old array shape too */
    changes = {};
    for (const p of body) { needObject(p, 'A party entry'); const { name, ...rest } = p; changes[str(name, 'name', 20)] = rest; }
  }
  needObject(changes, 'The party update');
  const next = clone(content);
  if (!Object.keys(changes).length) throw new Bad('No party members in that request.');
  for (const name of Object.keys(changes)) {
    if (!NAME_RE.test(name)) throw new Bad('Party names are one capitalised word, like Luna.');
    const ch = changes[name];
    if (ch === null) { delete next.party[name]; continue; }
    needObject(ch, 'The change for ' + name);
    onlyFields(ch, PARTY_FIELDS, 'party member ' + name);
    const m = patch(next.party[name] || { state: 'active', sprite: 'star', status: 'Active' }, ch);
    for (const need of ['role', 'job']) if (m[need] === undefined) throw new Bad('A new party member needs ' + need + '. (' + name + ')');
    next.party[name] = {
      role: str(m.role, 'role', 60), job: str(m.job, 'job', 240), status: str(m.status, 'status', 40),
      state: oneOf(m.state, PARTY_STATES, 'state'), sprite: oneOf(m.sprite, SPRITES, 'sprite')
    };
  }
  if (Object.keys(next.party).length > 12) throw new Bad('That is more than 12 party members.');
  return next;
}

/* ---------- usage ---------- */
const SERVICE_FIELDS = ['name', 'plan', 'price', 'note', 'weekly', 'noLive'];
function applyUsage(content, body) {
  needObject(body, 'The usage update');
  onlyFields(body, ['snapshot', 'services'], 'the usage update');
  const next = clone(content);
  if (body.snapshot !== undefined) next.usage.snapshot = str(body.snapshot, 'snapshot', 60);
  if (body.services !== undefined) {
    needObject(body.services, 'services');
    for (const id of Object.keys(body.services)) {
      if (!ID_RE.test(id)) throw new Bad('Service ids use lowercase letters, numbers and hyphens.');
      const ch = body.services[id];
      if (ch === null) { delete next.usage.services[id]; continue; }
      needObject(ch, 'The change for ' + id);
      onlyFields(ch, SERVICE_FIELDS, 'service ' + id);
      const s = patch(next.usage.services[id] || {}, ch);
      for (const need of ['name', 'plan', 'price']) if (s[need] === undefined) throw new Bad('A new service needs ' + need + '. (' + id + ')');
      const out = { name: str(s.name, 'name', 60), plan: str(s.plan, 'plan', 40) };
      if (typeof s.price !== 'number' || !Number.isFinite(s.price) || s.price < 0 || s.price > 10000) throw new Bad('price must be a number of dollars a month.');
      out.price = Math.round(s.price * 100) / 100;
      if (s.note !== undefined) out.note = str(s.note, 'note', 240);
      if (s.noLive !== undefined) out.noLive = str(s.noLive, 'noLive', 240);
      if (s.weekly !== undefined) {
        needObject(s.weekly, 'weekly');
        onlyFields(s.weekly, ['usedPct', 'resets'], 'weekly');
        out.weekly = { usedPct: whole(s.weekly.usedPct, 'usedPct', 0, 100), resets: str(s.weekly.resets, 'resets', 60) };
      }
      next.usage.services[id] = out;
    }
  }
  if (Object.keys(next.usage.services).length > 12) throw new Bad('That is more than 12 services.');
  return next;
}

/* ---------- plans, hero, briefing, outbox texts ---------- */
function applyPlans(content, body) {
  const list = Array.isArray(body) ? body : (plain(body) ? body.plans : null);
  if (!Array.isArray(list)) throw new Bad('Send the plans as a list.');
  if (list.length > 20) throw new Bad('That is more than 20 plans.');
  const next = clone(content);
  next.plans = list.map((p, i) => {
    needObject(p, 'Plan ' + (i + 1));
    onlyFields(p, ['title', 'summary', 'facts', 'items'], 'plan ' + (i + 1));
    const out = { title: str(p.title, 'title', 80) };
    if (p.summary !== undefined) out.summary = str(p.summary, 'summary', 160);
    if (p.facts !== undefined) {
      if (!Array.isArray(p.facts) || p.facts.length > 10) throw new Bad('facts must be a list of up to 10.');
      out.facts = p.facts.map((f) => { needObject(f, 'A fact'); onlyFields(f, ['label', 'value'], 'a fact'); return { label: str(f.label, 'label', 60), value: str(f.value, 'value', 80) }; });
    }
    if (p.items !== undefined) {
      if (!Array.isArray(p.items) || p.items.length > 20) throw new Bad('items must be a list of up to 20.');
      out.items = p.items.map((t) => str(t, 'an item', 200));
    }
    return out;
  });
  return next;
}
function applyHero(content, body) {
  needObject(body, 'The hero update');
  onlyFields(body, ['name', 'title'], 'the hero update');
  if (!Object.keys(body).length) throw new Bad('Send name or title.');
  const next = clone(content);
  if (body.name !== undefined) next.hero.name = str(body.name, 'name', 12);
  if (body.title !== undefined) next.hero.title = str(body.title, 'title', 40);
  return next;
}
/* focus: a quest id (AJ's first quest of the day) or null. focusDate is the
   day the pick is for, defaulting to today, so yesterday's pick never earns today's bonus. */
function applyBriefing(content, body, today, nowIso) {
  needObject(body, 'The briefing update');
  onlyFields(body, ['focus', 'focusDate', 'overnight'], 'the briefing update');
  if (!Object.keys(body).length) throw new Bad('Send focus, focusDate or overnight.');
  const next = clone(content);
  const b = next.briefing;
  if (body.focus !== undefined) {
    if (body.focus === null) { b.focus = null; b.focusDate = null; }
    else {
      const q = next.quests[body.focus];
      if (!q) throw new Bad('That focus quest does not exist.');
      if (q.owner !== 'AJ') throw new Bad('The first quest of the day has to be one AJ can complete.');
      b.focus = body.focus; b.focusDate = today;
    }
  }
  if (body.focusDate !== undefined) {
    if (!b.focus) throw new Bad('Set a focus quest before its date.');
    if (!isDate(body.focusDate)) throw new Bad('focusDate must be a real date written like 2026-11-30.');
    b.focusDate = body.focusDate;
  }
  if (body.overnight !== undefined) {
    if (body.overnight === null) { b.overnight = null; b.overnightAt = null; }
    else { b.overnight = str(body.overnight, 'overnight', 240); b.overnightAt = nowIso; }
  }
  return next;
}

module.exports = {
  Bad, OWNERS, PARTY_STATUSES, SPRITES, ICONS, ID_RE, isDate, plain, clone,
  applyQuestChanges, applyLandChanges, applyOura, applyParty, applyUsage, applyPlans, applyHero, applyBriefing, checkQuest
};
