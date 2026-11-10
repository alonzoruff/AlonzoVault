#!/usr/bin/env node
'use strict';
/*
 * Protocols importer. Reads Char's protocol drafts (the "Protocol - <name>.md"
 * files) and writes them into content/protocols.json, so dropping a draft in
 * is one command and never hand-typing.
 *
 *   node scripts/protocols-import.js [--dry-run] [--file path/to/protocols.json] draft.md [draft.md ...]
 *
 * The draft format it reads (headings must match):
 *
 *   # Protocol: <title>
 *   ## What this means            -> the Definitions block (plain text)
 *   ## Before you start           -> a guardrail callout, shown before the weeks
 *   ## Coach check before moving on -> a guardrail callout, shown before the weeks
 *   ## Week-by-week plan
 *   ### <Week label>: <title>     -> one week card (label is the words before the colon)
 *   What to do: ...
 *   Before moving on: ...         -> the line that gates the next week
 *   ## Trainer guardrails         -> a guardrail callout, shown after the weeks
 *   ## For the app                -> kept as an internal note, never shown to readers
 *
 * A heading it does not know, a week with no "What to do" or no "Before
 * moving on", or an entry that fails validation stops the run before
 * anything is written (exit 1) and says why.
 *
 * Re-running on a draft that changed updates the text. What an import never
 * touches on an existing protocol: status, order, group, summary, who checked
 * it and when (verified_by, verified_on), and the video slots on each week
 * (kept when the week label still matches, reported if one would be dropped).
 * A protocol that is new to the file arrives as status "draft", which never
 * shows to readers until it is set to published.
 */
const fs = require('fs');
const path = require('path');
const lib = require('../lib/protocols');

const args = process.argv.slice(2);
let dry = false;
let file = path.join(__dirname, '..', 'content', 'protocols.json');
const drafts = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dry = true;
  else if (args[i] === '--file') file = path.resolve(args[++i] || '');
  else drafts.push(args[i]);
}
if (!drafts.length) {
  console.error('Usage: node scripts/protocols-import.js [--dry-run] [--file protocols.json] draft.md [draft.md ...]');
  process.exit(1);
}

const KNOWN = ['What this means', 'Before you start', 'Coach check before moving on', 'Week-by-week plan', 'Trainer guardrails', 'For the app'];
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function paragraphs(lines) {
  const out = [];
  let cur = [];
  for (const l of lines) {
    if (!l.trim()) { if (cur.length) { out.push(cur.join('\n').trim()); cur = []; } } else cur.push(l.replace(/\s+$/, ''));
  }
  if (cur.length) out.push(cur.join('\n').trim());
  return out;
}

/* Parses one draft. Returns { entry, problems }. */
function parseDraft(text, name) {
  const problems = [];
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const head = lines.findIndex(l => l.trim());
  const m = head >= 0 && /^#\s+Protocol:\s*(.+?)\s*$/.exec(lines[head]);
  if (!m) return { entry: null, problems: [name + ': the first line must be "# Protocol: <title>"'] };
  const title = m[1];
  const sections = {};
  const order = [];
  let cur = null;
  for (const l of lines.slice(head + 1)) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h && !/^###/.test(l)) { cur = h[1]; order.push(cur); sections[cur] = []; continue; }
    if (cur) sections[cur].push(l);
  }
  for (const s of order) if (!KNOWN.includes(s)) problems.push(name + ': unknown section "' + s + '"');
  const body = (s) => paragraphs(sections[s] || []).join('\n\n');
  for (const s of ['What this means', 'Week-by-week plan']) if (!sections[s]) problems.push(name + ': missing section "' + s + '"');

  const guardrails = [];
  const guard = (s, place) => { if (sections[s] && body(s)) guardrails.push({ label: s, text: body(s), place }); };
  guard('Before you start', 'before_weeks');
  guard('Coach check before moving on', 'before_weeks');
  guard('Trainer guardrails', 'end');

  const weeks = [];
  if (sections['Week-by-week plan']) {
    let wk = null;
    const flush = () => { if (wk) weeks.push(wk); };
    for (const l of sections['Week-by-week plan']) {
      const wh = /^###\s+(.+?)\s*$/.exec(l);
      if (wh) {
        flush();
        const t = wh[1];
        const c = t.indexOf(':');
        wk = { label: (c >= 0 ? t.slice(0, c) : t).trim(), title: c >= 0 ? t.slice(c + 1).trim() : '', lines: [] };
      } else if (wk) wk.lines.push(l);
      else if (l.trim()) problems.push(name + ': text before the first week heading');
    }
    flush();
  }
  const outWeeks = weeks.map((w, i) => {
    const ps = paragraphs(w.lines);
    let mode = null;
    const todo = [];
    const gate = [];
    for (const p of ps) {
      const a = /^What to do:\s*([\s\S]*)$/.exec(p);
      const b = /^Before moving on:\s*([\s\S]*)$/.exec(p);
      if (a) { mode = 'todo'; if (a[1]) todo.push(a[1]); } else if (b) { mode = 'gate'; if (b[1]) gate.push(b[1]); } else if (mode === 'todo') todo.push(p);
      else if (mode === 'gate') gate.push(p);
      else problems.push(name + ', ' + w.label + ': unexpected text before "What to do:"');
    }
    if (!todo.length) problems.push(name + ', ' + w.label + ': no "What to do:" text');
    if (!gate.length) problems.push(name + ', ' + w.label + ': no "Before moving on:" text');
    const wk = { week: i + 1, label: w.label };
    if (w.title) wk.title = w.title;
    wk.what_to_do = todo.join('\n\n');
    if (gate.length) wk.advance_when = gate.join('\n\n');
    return wk;
  });

  const entry = {
    id: slug(title), title, definitions: body('What this means'),
    guardrails, weeks: outWeeks,
  };
  if (sections['For the app'] && body('For the app')) entry.internal_note = body('For the app');
  return { entry, problems };
}

/* Merges a parsed entry into an existing one, keeping what an import must not touch. */
function merge(existing, fresh, notes) {
  const out = {
    id: fresh.id, title: fresh.title,
    order: existing.order, status: existing.status,
  };
  if (existing.group !== undefined) out.group = existing.group;
  if (existing.summary !== undefined) out.summary = existing.summary;
  out.definitions = fresh.definitions;
  out.guardrails = fresh.guardrails;
  out.weeks = fresh.weeks.map((w, i) => {
    const old = existing.weeks && existing.weeks[i];
    const keep = old && old.label === w.label ? old : null;
    const wk = Object.assign({}, w);
    if (keep && keep.videos) wk.videos = keep.videos;
    if (keep && keep.steps) wk.steps = keep.steps;
    return wk;
  });
  (existing.weeks || []).forEach((old, i) => {
    const now = out.weeks[i];
    const lost = (old.videos && old.videos.length) || (old.steps && old.steps.length);
    if (lost && (!now || now.label !== old.label)) {
      notes.push('WARNING ' + fresh.title + ': the week "' + old.label + '" changed or went away, and its video slots or steps were not carried over. Check the file.');
    }
  });
  if (fresh.internal_note !== undefined) out.internal_note = fresh.internal_note;
  for (const k of ['verified_by', 'verified_on', 'updated', 'update_note']) if (existing[k] !== undefined) out[k] = existing[k];
  return out;
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  doc = { intro: '', trainer_line: '', protocols: [] };
  if (fs.existsSync(file)) { console.error('Could not read ' + file + ': ' + err.message); process.exit(1); }
}
if (Array.isArray(doc)) doc = { intro: '', trainer_line: '', protocols: doc };
doc.protocols = Array.isArray(doc.protocols) ? doc.protocols : [];

const allProblems = [];
const notes = [];
const summary = [];
let nextOrder = doc.protocols.reduce((m, p) => Math.max(m, Number.isInteger(p.order) ? p.order : 0), 0) + 1;
for (const d of drafts) {
  let text;
  try { text = fs.readFileSync(d, 'utf8'); } catch (err) { allProblems.push(d + ': ' + err.message); continue; }
  const { entry, problems } = parseDraft(text, path.basename(d));
  if (!entry) { allProblems.push(...problems); continue; }
  allProblems.push(...problems);
  const at = doc.protocols.findIndex(p => p && p.id === entry.id);
  let next;
  if (at >= 0) {
    next = merge(doc.protocols[at], entry, notes);
    const same = JSON.stringify(next) === JSON.stringify(doc.protocols[at]);
    summary.push((same ? 'unchanged  ' : 'updated    ') + entry.title);
    doc.protocols[at] = next;
  } else {
    next = Object.assign({ id: entry.id, title: entry.title, order: nextOrder++, status: 'draft' }, entry);
    summary.push('new (draft) ' + entry.title);
    doc.protocols.push(next);
  }
  const v = lib.validateProtocol(next);
  for (const p of v) allProblems.push(entry.title + ': ' + p);
}

for (const s of summary) console.log(s);
for (const n of notes) console.log(n);
if (allProblems.length) {
  console.log('\nProblems. Nothing was written:');
  for (const p of allProblems) console.log('  - ' + p);
  process.exit(1);
}
if (dry) {
  console.log('\nDry run. Nothing was written.');
} else {
  fs.writeFileSync(file, JSON.stringify(doc, null, 1) + '\n');
  console.log('\nWrote ' + file);
}
