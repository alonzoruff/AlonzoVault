'use strict';
/*
 * Protocols: the read-only injury and rehab protocol pages (Learn > Protocols).
 *
 * Entries live in content/protocols.json. This module validates them and
 * decides which ones are public. It has no side effects and does not
 * touch the database: Protocols is reference content only, with no
 * logging, no accounts and no stored state.
 *
 * Shape of one protocol (see PROTOCOLS_CONTENT_GUIDE.md for the full list):
 *   id, title, status, definitions, guardrails[], weeks[], internal_note
 *   guardrail: text, label, place (top, before_weeks or end)
 *   week:      week (1, 2, 3...), label, title, what_to_do, steps[], videos[],
 *              guardrails[], advance_when
 *   step:      text, dose, guardrail, video
 *   video:     shows (what the clip should show), label, url, approved, caption
 */

const STATUSES = ['placeholder', 'draft', 'published', 'retired'];
const PLACES = ['top', 'before_weeks', 'end'];
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YT_RE = /(?:[?&]v=|youtu\.be\/|\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})/;

function isText(v) { return typeof v === 'string' && v.trim().length > 0; }
function isHttps(v) { return typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function validateVideo(v, where, problems) {
  if (!isObj(v)) { problems.push(where + ': video must be an object'); return; }
  if (!isText(v.shows)) problems.push(where + ': video needs "shows" (what the clip should show)');
  if (v.label !== undefined && typeof v.label !== 'string') problems.push(where + ': video label must be text');
  if (v.url !== undefined && v.url !== '' && !isHttps(v.url)) problems.push(where + ': video url must be an https URL');
  if (v.approved !== undefined && typeof v.approved !== 'boolean') problems.push(where + ': video approved must be true or false');
  if (v.approved === true && !isHttps(v.url)) problems.push(where + ': an approved video needs a url');
  if (v.caption !== undefined && typeof v.caption !== 'string') problems.push(where + ': video caption must be text');
}

function validateGuardrail(g, where, problems) {
  if (!isObj(g)) { problems.push(where + ': guardrail must be an object with text'); return; }
  if (!isText(g.text)) problems.push(where + ': guardrail text is required');
  if (g.label !== undefined && typeof g.label !== 'string') problems.push(where + ': guardrail label must be text');
  if (g.place !== undefined && !PLACES.includes(g.place)) problems.push(where + ': guardrail place must be top, before_weeks or end');
}

/* Returns a list of problems; an empty list means the protocol is valid. */
function validateProtocol(p) {
  const problems = [];
  if (!isObj(p)) return ['entry is not an object'];
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) problems.push('id must be a lowercase slug');
  if (!isText(p.title)) problems.push('title is required');
  if (!STATUSES.includes(p.status)) problems.push('status must be placeholder, draft, published or retired');
  if (p.summary !== undefined && typeof p.summary !== 'string') problems.push('summary must be text');
  if (p.group !== undefined && typeof p.group !== 'string') problems.push('group must be text');
  if (p.order !== undefined && !Number.isInteger(p.order)) problems.push('order must be a whole number');
  if (p.internal_note !== undefined && typeof p.internal_note !== 'string') problems.push('internal_note must be text');

  /* Definitions: plain text (one or more paragraphs) or a list of terms. */
  const defs = p.definitions;
  if (typeof defs === 'string') {
    if (p.status === 'published' && !isText(defs)) problems.push('a published protocol needs definitions text');
  } else if (Array.isArray(defs)) {
    defs.forEach((d, i) => {
      if (!isObj(d) || !isText(d.term) || !isText(d.meaning)) problems.push('definitions[' + i + '] needs term and meaning');
    });
    if (p.status === 'published' && !defs.length) problems.push('a published protocol needs at least one definition');
  } else {
    problems.push('definitions must be text or a list of terms');
  }

  if (p.guardrails !== undefined) {
    if (!Array.isArray(p.guardrails)) problems.push('guardrails must be a list');
    else p.guardrails.forEach((g, i) => validateGuardrail(g, 'guardrails[' + i + ']', problems));
  }

  if (!Array.isArray(p.weeks) || !p.weeks.length) {
    problems.push('weeks must be a list with at least one week');
  } else {
    p.weeks.forEach((w, wi) => {
      const wh = 'week ' + (wi + 1);
      if (!isObj(w)) { problems.push(wh + ': must be an object'); return; }
      if (w.week !== wi + 1) problems.push(wh + ': "week" must be ' + (wi + 1) + ' (blocks run 1, 2, 3 in order)');
      if (w.label !== undefined && typeof w.label !== 'string') problems.push(wh + ': label must be text');
      if (w.title !== undefined && typeof w.title !== 'string') problems.push(wh + ': title must be text');
      if (w.goal !== undefined && typeof w.goal !== 'string') problems.push(wh + ': goal must be text');
      if (w.what_to_do !== undefined && typeof w.what_to_do !== 'string') problems.push(wh + ': what_to_do must be text');
      const isLast = wi === p.weeks.length - 1;
      if (!isLast && !isText(w.advance_when)) problems.push(wh + ': advance_when is required (what has to be true before moving on)');
      if (isLast && w.advance_when !== undefined && typeof w.advance_when !== 'string') problems.push(wh + ': advance_when must be text');
      if (w.guardrails !== undefined) {
        if (!Array.isArray(w.guardrails) || w.guardrails.some(g => !isText(g))) problems.push(wh + ': guardrails must be a list of text');
      }
      if (w.videos !== undefined) {
        if (!Array.isArray(w.videos)) problems.push(wh + ': videos must be a list');
        else w.videos.forEach((v, vi) => validateVideo(v, wh + ', video ' + (vi + 1), problems));
      }
      const hasSteps = Array.isArray(w.steps) && w.steps.length > 0;
      if (w.steps !== undefined && !Array.isArray(w.steps)) problems.push(wh + ': steps must be a list');
      if (!isText(w.what_to_do) && !hasSteps) problems.push(wh + ': needs what_to_do text or at least one step');
      if (Array.isArray(w.steps)) {
        w.steps.forEach((s, si) => {
          const sh = wh + ', step ' + (si + 1);
          if (!isObj(s) || !isText(s.text)) { problems.push(sh + ': text is required'); return; }
          if (s.dose !== undefined && typeof s.dose !== 'string') problems.push(sh + ': dose must be text');
          if (s.guardrail !== undefined && typeof s.guardrail !== 'string') problems.push(sh + ': guardrail must be text');
          if (s.video !== undefined) validateVideo(s.video, sh, problems);
        });
      }
    });
  }

  if (p.status === 'published') {
    if (!isText(p.verified_by)) problems.push('a published protocol needs verified_by');
    if (typeof p.verified_on !== 'string' || !DATE_RE.test(p.verified_on)) problems.push('a published protocol needs verified_on as YYYY-MM-DD');
  }
  if (p.updated !== undefined && (typeof p.updated !== 'string' || !DATE_RE.test(p.updated))) {
    problems.push('updated must be YYYY-MM-DD');
  }
  return problems;
}

/* Accepts the file's parsed JSON: either { intro, trainer_line, protocols: [...] }
   or a bare list. Returns the valid entries, a report of anything skipped (and
   why), and the two optional standing lines. A bad entry is logged and left out
   instead of taking the server down. Duplicate ids keep the first. */
function checkProtocols(raw) {
  const valid = [];
  const skipped = [];
  const seen = new Set();
  const list = Array.isArray(raw) ? raw : (isObj(raw) ? raw.protocols : null);
  const meta = {
    intro: isObj(raw) && typeof raw.intro === 'string' ? raw.intro : '',
    trainer_line: isObj(raw) && typeof raw.trainer_line === 'string' ? raw.trainer_line : '',
  };
  if (!Array.isArray(list)) {
    return { valid, skipped: [{ id: '(file)', problems: ['protocols.json must hold a list of protocols'] }], meta };
  }
  for (const entry of list) {
    const problems = validateProtocol(entry);
    const id = entry && typeof entry.id === 'string' ? entry.id : '(no id)';
    if (!problems.length && seen.has(entry.id)) problems.push('duplicate id');
    if (problems.length) { skipped.push({ id, problems }); continue; }
    seen.add(entry.id);
    valid.push(entry);
  }
  return { valid, skipped, meta };
}

/* What a video slot looks like to the reader. A video URL leaves the server
   only once it is approved. A pick that is not approved yet is reported as
   "pending" with no URL, and a slot with no pick is "needed". */
function publicVideo(v) {
  if (!isObj(v)) return undefined;
  const out = { shows: String(v.shows) };
  if (isText(v.label)) out.label = v.label;
  if (typeof v.caption === 'string' && v.caption.trim()) out.caption = v.caption;
  if (v.approved === true && isHttps(v.url)) {
    out.state = 'ready';
    out.url = v.url;
    const yt = v.url.match(YT_RE);
    if (yt) out.yt = yt[1];
  } else if (isHttps(v.url)) {
    out.state = 'pending';
  } else {
    out.state = 'needed';
  }
  return out;
}

function publicStep(s) {
  const out = { text: s.text };
  if (isText(s.dose)) out.dose = s.dose;
  if (isText(s.guardrail)) out.guardrail = s.guardrail;
  const v = publicVideo(s.video);
  if (v) out.video = v;
  return out;
}

function publicWeek(w) {
  const wk = { week: w.week, steps: Array.isArray(w.steps) ? w.steps.map(publicStep) : [] };
  if (isText(w.label)) wk.label = w.label;
  if (isText(w.title)) wk.title = w.title;
  if (isText(w.goal)) wk.goal = w.goal;
  if (isText(w.what_to_do)) wk.what_to_do = w.what_to_do;
  if (isText(w.advance_when)) wk.advance_when = w.advance_when;
  if (Array.isArray(w.guardrails) && w.guardrails.length) wk.guardrails = w.guardrails.slice();
  if (Array.isArray(w.videos) && w.videos.length) wk.videos = w.videos.map(publicVideo);
  return wk;
}

function publicProtocol(p) {
  const out = {
    id: p.id, title: p.title,
    placeholder: p.status === 'placeholder',
    unpublished: p.status !== 'published',
    summary: typeof p.summary === 'string' ? p.summary : '',
    definitions: typeof p.definitions === 'string'
      ? p.definitions
      : p.definitions.map(d => ({ term: d.term, meaning: d.meaning })),
    guardrails: (p.guardrails || []).map(g => {
      const out2 = { text: g.text, place: PLACES.includes(g.place) ? g.place : 'end' };
      if (isText(g.label)) out2.label = g.label;
      return out2;
    }),
    weeks: p.weeks.map(publicWeek),
  };
  if (isText(p.group)) out.group = p.group;
  if (isText(p.verified_on)) out.verified_on = p.verified_on;
  if (isText(p.updated)) out.updated = p.updated;
  if (isText(p.update_note)) out.update_note = p.update_note;
  return out;
}

/* Only published entries are shown. Entries that are not published yet
   (placeholder or draft) are shown only when asked for (a staging look at
   the shell and the drafts), so a live launch never shows an unfinished or
   unreviewed page. Retired entries never render, and internal fields
   (status, verified_by, internal_note, unapproved video links) never leave
   the server. */
function publicProtocols(raw, opts) {
  const withUnpublished = !!(opts && opts.unpublished);
  const { valid, meta } = checkProtocols(raw);
  const shown = valid
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.status === 'published' || (withUnpublished && (p.status === 'placeholder' || p.status === 'draft')))
    .sort((a, b) => {
      const ao = Number.isInteger(a.p.order) ? a.p.order : 1e9;
      const bo = Number.isInteger(b.p.order) ? b.p.order : 1e9;
      return ao - bo || a.i - b.i;
    })
    .map(({ p }) => publicProtocol(p));
  return { intro: meta.intro, trainer_line: meta.trainer_line, protocols: shown };
}

/* Every video slot that still needs a clip, for the staging note and for AJ:
   protocol, week, step (or "whole week"), what the clip should show, and why
   it is listed. Retired entries are skipped. */
function videoGaps(raw) {
  const { valid } = checkProtocols(raw);
  const gaps = [];
  const add = (p, w, step, v) => {
    const pv = publicVideo(v);
    if (pv.state === 'ready') return;
    gaps.push({
      protocol: p.title, id: p.id, week: w.week, weekLabel: isText(w.label) ? w.label : 'Week ' + w.week,
      step, label: pv.label || '', shows: pv.shows,
      state: pv.state === 'pending' ? 'pick waiting for AJ approval' : 'needs a video',
    });
  };
  for (const p of valid) {
    if (p.status === 'retired') continue;
    p.weeks.forEach(w => {
      (w.videos || []).forEach(v => add(p, w, 0, v));
      (w.steps || []).forEach((s, si) => { if (s.video) add(p, w, si + 1, s.video); });
    });
  }
  return gaps;
}

module.exports = { STATUSES, PLACES, validateProtocol, checkProtocols, publicProtocols, videoGaps };
