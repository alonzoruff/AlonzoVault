/*
 * Meet entry rules, shared by the server (require) and the page (window.EntryRules).
 * Pure functions, no storage. Warnings never block a save: they only explain.
 *
 * A meet definition (portal/meets/<id>.json):
 *   { id, name, date, dateLabel, place, entriesClose, slots, note?, source?, rules: [], events: [{ id, name, kind, slots? }] }
 *   slots on the meet is the default per event; slots on an event overrides it.
 *
 * Rule types (only add one when the meet publishes it):
 *   { type: 'maxEvents', max: 3, note }                     each athlete may be in at most `max` events at this meet
 *   { type: 'group', label, events: [ids], max: 1, upTo: { athletes: 3, max: 2 }, note }
 *        each athlete may be in at most `max` of these events, except that up to `upTo.athletes`
 *        athletes may be in `upTo.max` of them (leave upTo out when there is no exception)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EntryRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KINDS = ['run', 'relay', 'field'];
  const MAX_SLOTS = 40;
  const MAX_NAME = 60;

  /* "  maya   TEST " and "Maya Test" are the same athlete */
  function key(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function clean(name) { return String(name || '').trim().replace(/\s+/g, ' '); }

  function slotCount(meet, ev) { return ev.slots !== undefined ? ev.slots : meet.slots; }

  /* Throws a plain Error with a readable message if a meet file is wrong. */
  function checkMeet(m, fileName) {
    const where = fileName ? fileName + ': ' : '';
    const bad = (msg) => { throw new Error(where + msg); };
    const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
    if (!m || typeof m !== 'object' || Array.isArray(m)) bad('the file must hold one meet object.');
    if (typeof m.id !== 'string' || !/^[a-z0-9-]{3,60}$/.test(m.id)) bad('id must be 3 to 60 lowercase letters, numbers or hyphens.');
    if (typeof m.name !== 'string' || !m.name.trim()) bad('name is missing.');
    if (typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) bad('date must look like 2026-11-30.');
    if (!isInt(m.slots, 1, MAX_SLOTS)) bad('slots must be a whole number from 1 to ' + MAX_SLOTS + '.');
    for (const f of ['dateLabel', 'place', 'entriesClose', 'note', 'source']) {
      if (m[f] !== undefined && typeof m[f] !== 'string') bad(f + ' must be text.');
    }
    if (!Array.isArray(m.events)) bad('events must be a list (it can be empty).');
    const ids = new Set();
    for (const e of m.events) {
      if (!e || typeof e.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(e.id)) bad('every event needs an id of lowercase letters, numbers or hyphens.');
      if (ids.has(e.id)) bad('event id "' + e.id + '" is used twice.');
      ids.add(e.id);
      if (typeof e.name !== 'string' || !e.name.trim()) bad('event ' + e.id + ' has no name.');
      if (!KINDS.includes(e.kind)) bad('event ' + e.id + ' kind must be one of: ' + KINDS.join(', ') + '.');
      if (e.slots !== undefined && !isInt(e.slots, 1, MAX_SLOTS)) bad('event ' + e.id + ' slots must be a whole number from 1 to ' + MAX_SLOTS + '.');
    }
    if (!Array.isArray(m.rules)) bad('rules must be a list (it can be empty).');
    for (const r of m.rules) {
      if (!r || (r.type !== 'maxEvents' && r.type !== 'group')) bad('rule type must be maxEvents or group.');
      if (!isInt(r.max, 1, 20)) bad('every rule needs max, a whole number from 1 to 20.');
      if (r.type === 'group') {
        if (typeof r.label !== 'string' || !r.label.trim()) bad('a group rule needs a label.');
        if (!Array.isArray(r.events) || !r.events.length) bad('a group rule needs its list of events.');
        for (const id of r.events) if (!ids.has(id)) bad('group rule "' + r.label + '" names an event that is not in this meet: ' + id + '.');
        if (r.upTo !== undefined && !(r.upTo && isInt(r.upTo.athletes, 1, 50) && isInt(r.upTo.max, r.max + 1, 20))) bad('group rule upTo needs athletes and a max above the rule max.');
      }
    }
    return m;
  }

  /*
   * names: { [eventId]: ["Name", "", ...] }   (index = slot)
   * Returns { events: { [eventId]: { filled, total, extra } }, filled, total, warnings: [...] }
   * A warning: { rule, athlete, message, events: [ids] }. `athlete` is the key() form.
   */
  function review(meet, names) {
    const out = { events: {}, filled: 0, total: 0, warnings: [] };
    const byAthlete = new Map();   /* key -> { display, events: Set } */
    for (const ev of meet.events) {
      const list = Array.isArray(names && names[ev.id]) ? names[ev.id] : [];
      const total = slotCount(meet, ev);
      let filled = 0, extra = 0;
      const seen = new Map();
      list.forEach((raw, i) => {
        const n = clean(raw);
        if (!n) return;
        if (i < total) filled++; else extra++;
        const k = key(n);
        seen.set(k, (seen.get(k) || 0) + 1);
        if (!byAthlete.has(k)) byAthlete.set(k, { display: n, events: new Set() });
        byAthlete.get(k).events.add(ev.id);
      });
      for (const [k, c] of seen) {
        if (c > 1) out.warnings.push({ rule: 'twice', athlete: k, events: [ev.id], message: byAthlete.get(k).display + ' is in ' + ev.name + ' ' + c + ' times.' });
      }
      out.events[ev.id] = { filled, total, extra };
      out.filled += filled;
      out.total += total;
    }
    const nameOf = (id) => { const e = meet.events.find((x) => x.id === id); return e ? e.name : id; };
    const list = (ids) => ids.map(nameOf).join(', ');
    for (const r of meet.rules || []) {
      if (r.type === 'maxEvents') {
        for (const [k, a] of byAthlete) {
          if (a.events.size > r.max) {
            const evs = [...a.events];
            out.warnings.push({ rule: 'maxEvents', athlete: k, events: evs,
              message: a.display + ' is in ' + evs.length + ' events. This meet allows ' + r.max + ' per athlete. (' + list(evs) + ')' });
          }
        }
      } else if (r.type === 'group') {
        const inGroup = new Set(r.events);
        const counts = [];
        for (const [k, a] of byAthlete) {
          const evs = [...a.events].filter((id) => inGroup.has(id));
          if (evs.length > r.max) counts.push({ k, a, evs });
        }
        const label = r.label.toLowerCase();
        const cap = r.upTo ? r.upTo.max : r.max;
        const doubles = counts.filter((c) => c.evs.length <= cap);
        for (const c of counts) {
          if (c.evs.length > cap) {
            out.warnings.push({ rule: 'group', athlete: c.k, events: c.evs,
              message: c.a.display + ' is in ' + c.evs.length + ' ' + label + '. The most anyone may run is ' + cap + '. (' + list(c.evs) + ')' });
          }
        }
        if (!r.upTo) continue;
        if (doubles.length > r.upTo.athletes) {
          const who = doubles.map((c) => c.a.display).join(', ');
          for (const c of doubles) {
            out.warnings.push({ rule: 'group', athlete: c.k, events: c.evs,
              message: doubles.length + ' athletes are doubling in ' + label + ' (' + who + '). Only ' + r.upTo.athletes + ' may run ' + r.upTo.max + '.' });
          }
        }
      }
    }
    return out;
  }

  /* One warning line per athlete per rule, for the summary at the top of the page. */
  function summary(warnings) {
    const seen = new Set();
    const lines = [];
    for (const w of warnings) {
      if (seen.has(w.message)) continue;
      seen.add(w.message);
      lines.push(w.message);
    }
    return lines;
  }

  return { key, clean, slotCount, checkMeet, review, summary, KINDS, MAX_SLOTS, MAX_NAME };
}));
