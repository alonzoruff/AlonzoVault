'use strict';
/*
 * The game rules, as plain functions over the database object:
 *   db = { content, progress, outbox }
 * content is what Luna edits. progress is AJ's own table (completions,
 * daily habits, bonuses, unlocked lands). They never share a key, so no
 * edit to content can touch progress.
 *
 * All dates are New York calendar days, written YYYY-MM-DD.
 */
const TZ = 'America/New_York';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const FIRST_QUEST_BONUS = 5;
const WEEK_BONUS = 20;
const WEEK_NEED = 5;
const URGENT_DAYS = 7;
const SOON_DAYS = 3;

function etDate(d) { return dayFmt.format(d); }
function dayNum(s) { const a = s.split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]) / 86400000; }
function addDays(s, n) { return new Date((dayNum(s) + n) * 86400000).toISOString().slice(0, 10); }
function weekday(s) { return new Date(dayNum(s) * 86400000).getUTCDay(); }           /* 0 = Sunday */
function weekStart(s) { return addDays(s, -((weekday(s) + 6) % 7)); }                  /* Monday */
function shortDate(s) { const a = s.split('-'); return MONTHS[+a[1] - 1] + ' ' + (+a[2]); }
function dateWithDay(s) { return DAYS[weekday(s)] + ' ' + shortDate(s); }
function longDate(s) { const a = s.split('-'); return LONG_DAYS[weekday(s)] + ', ' + LONG_MONTHS[+a[1] - 1] + ' ' + (+a[2]); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

/* Level n needs 30 + 10n XP to reach level n+1. */
function levelFor(xp) {
  let level = 1, rem = xp, need = 30 + 10 * level;
  while (rem >= need) { rem -= need; level += 1; need = 30 + 10 * level; }
  return { level, into: rem, need };
}

function emptyProgress() {
  return { completions: {}, habits: {}, bonuses: {}, unlocked: {}, bestWeek: 0, briefingDismissed: null, outboxSeenAt: null };
}

/* ---------- XP ---------- */
function totalXP(db) {
  const p = db.progress;
  let n = 0;
  for (const c of Object.values(p.completions)) n += c.xp;
  for (const day of Object.values(p.habits)) for (const h of Object.values(day)) n += h.xp;
  for (const b of Object.values(p.bonuses)) n += b.xp;
  return n;
}

/* ---------- quests ---------- */
const isDaily = (q) => q.repeat === 'daily';
const isAJ = (q) => q.owner === 'AJ';
function gateDate(q) { return q.opens || (q.date ? (q.end || q.date) : null); }
function isUrgent(q, today) {
  if (q.due && q.due <= addDays(today, URGENT_DAYS)) return true;
  if (q.date && q.date <= today && today <= (q.end || q.date)) return true;
  return false;
}
function doneToday(db, q, today) {
  const day = db.progress.habits[today];
  return !!(day && day[q.id]);
}
function questDone(db, q, today) {
  if (isAJ(q)) return isDaily(q) ? doneToday(db, q, today) : !!db.progress.completions[q.id];
  return q.status === 'Done';
}
function withIds(content) {
  return Object.entries(content.quests).map(([id, q]) => Object.assign({ id }, q));
}
function questsIn(content, landId) {
  return withIds(content).filter((q) => q.land === landId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}
/* quests that count toward unlocking: everything except daily habits */
function unlockQuests(content, landId) { return questsIn(content, landId).filter((q) => !isDaily(q)); }
function cleared(db, landId, today) {
  return unlockQuests(db.content, landId).filter((q) => questDone(db, q, today)).length;
}

/* ---------- lands ---------- */
function landList(content) {
  return Object.entries(content.lands).map(([id, l]) => Object.assign({ id }, l))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}
function landOpen(db, landId) {
  const l = db.content.lands[landId];
  if (!l) return false;
  return !l.unlock || !!db.progress.unlocked[landId];
}
/* A land opens when any one of its alternatives is met: enough cleared
   quests in a land that is itself open. Opening is permanent. */
function alternatives(db, land) {
  const out = [];
  for (const a of land.unlock ? land.unlock.anyOf : []) {
    const src = db.content.lands[a.land];
    if (!src) continue;
    const count = unlockQuests(db.content, a.land).length;
    if (!count) continue;                       /* nothing there can ever count */
    out.push({ land: a.land, name: src.name, need: Math.min(a.need, count) });
  }
  return out;
}
function settleUnlocks(db, today, nowIso) {
  const opened = [];
  let again = true;
  while (again) {
    again = false;
    for (const land of landList(db.content)) {
      if (!land.unlock || db.progress.unlocked[land.id]) continue;
      const met = alternatives(db, land).some((a) => landOpen(db, a.land) && cleared(db, a.land, today) >= a.need);
      if (met) { db.progress.unlocked[land.id] = nowIso; opened.push(land.id); again = true; }
    }
  }
  return opened;
}
function lockMessage(db, land, today) {
  const alts = alternatives(db, land);
  if (!alts.length) return 'This land has no way to open yet. Ask Luna.';
  const live = alts.filter((a) => landOpen(db, a.land));
  if (!live.length) return 'Locked. Open ' + alts.map((a) => a.name).join(' or ') + ' first.';
  const parts = live.map((a, i) => {
    const more = Math.max(0, a.need - cleared(db, a.land, today));
    return (i === 0 ? 'Clear ' : '') + plural(more, 'more quest', 'more quests') + ' in ' + a.name;
  });
  return 'Locked. ' + parts.join(', or ') + ' to open it.';
}

/* ---------- completing ---------- */
function canComplete(db, q, today) {
  if (!isAJ(q)) return { ok: false, status: 403, reason: 'That one belongs to ' + q.owner + '. It moves when they report progress.' };
  if (questDone(db, q, today)) return { ok: true, already: true };
  const gate = gateDate(q);
  if (gate && gate > today) return { ok: false, status: 409, reason: 'This one opens on ' + shortDate(gate) + '.' };
  if (!landOpen(db, q.land) && !isUrgent(q, today)) {
    return { ok: false, status: 403, reason: 'That land is still locked. Clear a few more quests to open it.' };
  }
  return { ok: true };
}

/* Awards XP and records the tick. Returns what happened, for the toasts. */
function completeQuest(db, q, today, nowIso) {
  const p = db.progress;
  const before = levelFor(totalXP(db)).level;
  const result = { xp: q.xp || 0, bonuses: [], unlocked: [] };
  if (isDaily(q)) {
    if (!p.habits[today]) p.habits[today] = {};
    p.habits[today][q.id] = { at: nowIso, xp: q.xp || 0 };
  } else {
    p.completions[q.id] = { at: nowIso, xp: q.xp || 0 };
  }
  const b = db.content.briefing;
  const key = 'first-' + today;
  if (b.focus === q.id && b.focusDate === today && !p.bonuses[key]) {
    p.bonuses[key] = { xp: FIRST_QUEST_BONUS, at: nowIso, quest: q.id, kind: 'first' };
    result.bonuses.push({ kind: 'first', xp: FIRST_QUEST_BONUS });
  }
  result.unlocked = settleUnlocks(db, today, nowIso);
  const weeks = settleWeeks(db, today, nowIso);
  for (const w of weeks) result.bonuses.push({ kind: 'week', xp: w.xp });
  result.levelFrom = before;
  result.levelTo = levelFor(totalXP(db)).level;
  return result;
}

/* Only today's ticks can be undone: it is there for a mis-tap, not for rewriting history. */
function undoQuest(db, q, today) {
  const p = db.progress;
  if (isDaily(q)) {
    if (!doneToday(db, q, today)) return { ok: false, status: 409, reason: 'That one is not ticked for today.' };
    delete p.habits[today][q.id];
    if (!Object.keys(p.habits[today]).length) delete p.habits[today];
  } else {
    const c = p.completions[q.id];
    if (!c) return { ok: false, status: 409, reason: 'That one is not done.' };
    if (etDate(new Date(c.at)) !== today) return { ok: false, status: 409, reason: 'Only today’s ticks can be undone.' };
    delete p.completions[q.id];
  }
  const key = 'first-' + today;
  if (p.bonuses[key] && p.bonuses[key].quest === q.id) delete p.bonuses[key];
  return { ok: true };
}

/* ---------- the weekly dial ---------- */
function keptDays(db, wk) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const day = db.progress.habits[addDays(wk, i)];
    if (day && Object.keys(day).length) n++;
  }
  return n;
}
/* Pays the weekly bonus for any week that has reached Sunday with 5 or more
   days kept. Safe to call any number of times: each week pays once. The best
   week only ever goes up, and nothing is ever taken back. */
function settleWeeks(db, today, nowIso) {
  const p = db.progress;
  const paid = [];
  const starts = new Set(Object.keys(p.habits).map(weekStart));
  starts.add(weekStart(today));
  for (const wk of starts) {
    const count = keptDays(db, wk);
    if (count > p.bestWeek) p.bestWeek = count;
    const key = 'week-' + wk;
    if (today >= addDays(wk, 6) && count >= WEEK_NEED && !p.bonuses[key]) {
      p.bonuses[key] = { xp: WEEK_BONUS, at: nowIso, kind: 'week', days: count };
      paid.push({ week: wk, xp: WEEK_BONUS });
    }
  }
  return paid;
}
function dialView(db, today) {
  const wk = weekStart(today);
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(wk, i);
    const day = db.progress.habits[d];
    days.push({ date: d, letter: letters[i], kept: !!(day && Object.keys(day).length), today: d === today, future: d > today });
  }
  const count = days.filter((d) => d.kept).length;
  const paid = !!db.progress.bonuses['week-' + wk];
  let label;
  if (paid) label = 'Weekly bonus earned. +' + WEEK_BONUS + ' XP.';
  else if (count >= WEEK_NEED) label = count + ' of 7 days. The +' + WEEK_BONUS + ' XP bonus lands on Sunday.';
  else label = count + ' of 7 days. ' + WEEK_NEED + ' of 7 earns +' + WEEK_BONUS + ' XP on Sunday.';
  return { days, count, need: WEEK_NEED, bonus: WEEK_BONUS, paid, best: db.progress.bestWeek, label };
}

/* Everything that may change on its own as days pass or Luna edits content.
   Returns true if it changed something worth saving. */
function settle(db, today, nowIso) {
  const bestBefore = db.progress.bestWeek;
  const opened = settleUnlocks(db, today, nowIso).length;
  const paid = settleWeeks(db, today, nowIso).length;
  return opened > 0 || paid > 0 || bestBefore !== db.progress.bestWeek;
}

/* ---------- views ---------- */
function daysUntil(s, today) { return dayNum(s) - dayNum(today); }
function leftLabel(n) { return n < 0 ? 'overdue' : n === 0 ? 'today' : n === 1 ? '1 day left' : n + ' days left'; }

function partyQuestLabel(db, q, today) {
  if (q.status === 'Done') return { label: 'Done', kind: 'good' };
  if (q.needs) {
    const dep = db.content.quests[q.needs];
    if (dep) {
      const depQ = Object.assign({ id: q.needs }, dep);
      if (!questDone(db, depQ, today)) return { label: 'Blocked', kind: 'warn', waitingOn: dep.title };
      return { label: 'Ready', kind: 'good' };
    }
  }
  return { label: q.status, kind: q.status === 'Blocked' ? 'warn' : q.status === 'Moving' ? 'good' : 'wait' };
}

function questView(db, q, today) {
  const v = { id: q.id, land: q.land, title: q.title, owner: q.owner };
  for (const f of ['detail', 'date', 'end', 'time', 'place', 'due', 'dueLabel']) if (q[f]) v[f] = q[f];
  if (q.date) v.dateLabel = q.end ? shortDate(q.date) + ' to ' + (q.end.slice(0, 7) === q.date.slice(0, 7) ? +q.end.slice(8) : shortDate(q.end)) : dateWithDay(q.date);
  if (q.due) { v.daysLeft = daysUntil(q.due, today); v.leftLabel = leftLabel(v.daysLeft); }
  v.daily = isDaily(q);
  if (!isAJ(q)) {
    const pl = partyQuestLabel(db, q, today);
    v.state = 'party'; v.label = pl.label; v.kind = pl.kind; v.canComplete = false; v.done = q.status === 'Done';
    if (pl.waitingOn) v.waitingOn = pl.waitingOn;
    return v;
  }
  v.xp = q.xp || 0;
  v.done = questDone(db, q, today);
  v.urgent = !v.done && isUrgent(q, today);
  const gate = gateDate(q);
  if (v.done) {
    v.state = 'done'; v.label = isDaily(q) ? 'Done today' : 'Done'; v.kind = 'good';
    const at = isDaily(q) ? db.progress.habits[today][q.id].at : db.progress.completions[q.id].at;
    v.canUndo = etDate(new Date(at)) === today;
  } else if (gate && gate > today) {
    v.state = 'gated'; v.label = 'Opens ' + shortDate(gate); v.kind = 'wait';
  } else {
    v.state = 'open'; v.label = isDaily(q) ? 'Today' : 'Open'; v.kind = '';
  }
  v.canComplete = !v.done && canComplete(db, q, today).ok;
  return v;
}

function labelFor(m) {
  switch (m.status) {
    case 'new': return 'Saved. Luna has not opened it yet.';
    case 'picked_up': return 'With Luna';
    case 'routed': return 'Sent to ' + (m.routedTo || 'the party');
    case 'working': return (m.workingBy || m.routedTo || 'Luna') + ' is on it';
    case 'waiting': return 'Waiting on you';
    case 'done': return 'Done';
    case 'withdrawn': return 'Withdrawn';
    default: return m.status;
  }
}
const OUTBOX_STATUSES = ['new', 'picked_up', 'routed', 'working', 'waiting', 'done'];

function suggested(db, today) {
  const c = db.content;
  const all = withIds(c);
  const b = c.briefing;
  if (b.focus && b.focusDate === today && c.quests[b.focus]) {
    const q = Object.assign({ id: b.focus }, c.quests[b.focus]);
    if (!questDone(db, q, today) && canComplete(db, q, today).ok) return { quest: questView(db, q, today), picked: true };
  }
  for (const land of landList(c)) {
    if (!landOpen(db, land.id)) continue;
    const q = all.filter((x) => x.land === land.id && isAJ(x) && !isDaily(x) && !questDone(db, x, today) && canComplete(db, x, today).ok)
      .sort((a, b2) => (a.order || 0) - (b2.order || 0))[0];
    if (q) return { quest: questView(db, q, today), picked: false };
  }
  const daily = all.filter((x) => isAJ(x) && isDaily(x) && !questDone(db, x, today) && canComplete(db, x, today).ok)[0];
  return daily ? { quest: questView(db, daily, today), picked: false } : null;
}


/* ---------- v3 additions: per-land XP, roads, what's next, live stamps ---------- */
/* XP shown on a land's bar: only one-off AJ quests (the same set that counts toward unlocks).
   Earned is what was actually paid when the quest was done; total is what the quests pay now. */
function landXp(db, landId) {
  const qs = unlockQuests(db.content, landId).filter(isAJ);
  let earned = 0, total = 0;
  for (const q of qs) {
    total += q.xp || 0;
    const c = db.progress.completions[q.id];
    if (c) earned += c.xp;
  }
  return { xp: earned, xpTotal: total };
}
/* The nearest land that is still shut, as one plain sentence. Looks only at ways in from lands
   that are already open, and picks the one with the fewest quests still to clear. */
function nextGoal(db, today) {
  let best = null;
  for (const land of landList(db.content)) {
    if (!land.unlock || landOpen(db, land.id)) continue;
    for (const a of alternatives(db, land)) {
      if (!landOpen(db, a.land)) continue;
      const more = Math.max(0, a.need - cleared(db, a.land, today));
      if (!more) continue;
      if (!best || more < best.more) best = { land: land.id, name: land.name, from: a.land, fromName: a.name, more };
    }
  }
  if (!best) return null;
  best.text = 'Clear ' + plural(best.more, 'more quest', 'more quests') + ' in ' + best.fromName + ' to open ' + best.name + '.';
  return best;
}
/* Stamps the app compares between visits to tell when Luna changed something.
   AJ's own ticks and messages never move them. */
function liveStamps(db) {
  let replies = null;
  for (const m of db.outbox) {
    if (m.updatedBy && m.updatedBy !== 'AJ' && (!replies || m.updatedAt > replies)) replies = m.updatedAt;
  }
  const b = db.content.briefing;
  return { content: db.content.updatedAt || null, overnight: b.overnightAt || null, replies };
}

function buildState(db, now) {
  const today = etDate(now);
  const c = db.content;
  const xp = totalXP(db);
  const lv = levelFor(xp);
  const all = withIds(c);
  const ajOnce = all.filter((q) => isAJ(q) && !isDaily(q));

  const lands = landList(c).map((l) => {
    const open = landOpen(db, l.id);
    const qs = unlockQuests(c, l.id);
    const view = {
      id: l.id, name: l.name, blurb: l.blurb, icon: l.icon, open,
      cleared: cleared(db, l.id, today), total: qs.length,
      from: l.unlock ? l.unlock.anyOf.map((a) => a.land).filter((id) => c.lands[id]) : []
    };
    Object.assign(view, landXp(db, l.id));
    if (open) {
      view.quests = questsIn(c, l.id).map((q) => questView(db, q, today));
      const at = db.progress.unlocked[l.id];
      if (at && now - new Date(at) < 48 * 3600 * 1000) view.fresh = true;
    } else {
      view.lockMessage = lockMessage(db, l, today);
    }
    return view;
  });

  const urgent = all.filter((q) => isAJ(q) && !isDaily(q) && !questDone(db, q, today) && isUrgent(q, today)
    && !(gateDate(q) && gateDate(q) > today))
    .map((q) => questView(db, q, today))
    .sort((a, b) => ((a.due || a.date) < (b.due || b.date) ? -1 : 1));
  const habits = all.filter((q) => isAJ(q) && isDaily(q)).map((q) => questView(db, q, today));
  const sug = suggested(db, today);

  const owned = (name) => {
    const mine = all.filter((q) => q.owner === name);
    const views = mine.map((q) => questView(db, q, today));
    return {
      total: mine.length,
      moving: views.filter((v) => !v.done && v.kind !== 'warn').length,
      blocked: views.filter((v) => v.kind === 'warn').length,
      done: views.filter((v) => v.done).length,
      active: views.filter((v) => !v.done).map((v) => ({ title: v.title, label: v.label }))
    };
  };
  const party = Object.entries(c.party).map(([name, m]) => Object.assign({ name }, m, { owned: owned(name) }));

  /* briefing: Luna's pick, what is due soon, one overnight line. Shown once a day, dismissible. */
  const soon = all.filter((q) => isAJ(q) && !isDaily(q) && !questDone(db, q, today)).map((q) => {
    const key = q.due || q.date;
    return key ? { q, n: daysUntil(q.end && q.date <= today ? q.end : key, today) } : null;
  }).filter((x) => x && x.n >= 0 && x.n <= SOON_DAYS).sort((a, b) => a.n - b.n)
    .map((x) => Object.assign(questView(db, x.q, today), { inDays: x.n, inLabel: x.n === 0 ? 'today' : x.n === 1 ? 'tomorrow' : 'in ' + x.n + ' days' }));
  const b = c.briefing;
  let focusView = null;
  if (b.focus && b.focusDate === today && c.quests[b.focus]) focusView = questView(db, Object.assign({ id: b.focus }, c.quests[b.focus]), today);
  const overnight = b.overnight ? { text: b.overnight, at: b.overnightAt } : null;
  const hasBriefing = !!(focusView || soon.length || overnight);
  const briefing = {
    show: hasBriefing && db.progress.briefingDismissed !== today,
    focus: focusView, bonus: FIRST_QUEST_BONUS, soon, overnight
  };

  const msgs = db.outbox.map((m) => ({
    id: m.id, text: m.text, at: m.at, status: m.status, label: labelFor(m), routedTo: m.routedTo || null,
    replies: m.replies, updatedAt: m.updatedAt, canWithdraw: m.status === 'new',
    unread: !!(m.updatedBy !== 'AJ' && (!db.progress.outboxSeenAt || m.updatedAt > db.progress.outboxSeenAt))
  }));

  const services = Object.entries(c.usage.services).map(([id, s]) => Object.assign({ id }, s));
  const total = services.reduce((n, s) => n + s.price, 0);

  return {
    today: {
      date: today, dateLabel: longDate(today),
      oura: c.oura, suggested: sug, urgent, habits, party: party.map((m) => ({ name: m.name, status: m.status, state: m.state, job: m.job, active: m.owned.active })),
      bonusFirst: FIRST_QUEST_BONUS
    },
    hero: {
      name: c.hero.name, title: c.hero.title, level: lv.level, into: lv.into, need: lv.need, xp,
      questsDone: ajOnce.filter((q) => questDone(db, q, today)).length, questsTotal: ajOnce.length,
      landsOpen: lands.filter((l) => l.open).length, landsTotal: lands.length,
      dial: dialView(db, today),
      xpToNext: lv.need - lv.into, next: nextGoal(db, today)
    },
    briefing, lands, party,
    usage: { snapshot: c.usage.snapshot, services, total, totalLabel: 'about $' + Math.round(total) + ' a month' },
    plans: c.plans, oura: c.oura, outboxText: c.outbox,
    outbox: { messages: msgs, unread: msgs.filter((m) => m.unread).length },
    updatedAt: c.updatedAt,
    live: liveStamps(db)
  };
}

module.exports = {
  etDate, dayNum, addDays, weekStart, shortDate, levelFor, emptyProgress, totalXP, questsIn, landList, landOpen,
  canComplete, completeQuest, undoQuest, settle, settleUnlocks, settleWeeks, buildState, labelFor, withIds,
  landXp, nextGoal, liveStamps, OUTBOX_STATUSES, FIRST_QUEST_BONUS, WEEK_BONUS, WEEK_NEED, dialView, questDone, isUrgent
};
