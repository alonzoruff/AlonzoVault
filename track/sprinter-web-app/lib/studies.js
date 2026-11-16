'use strict';
/*
 * Studies: the read-only research library (Learn > Studies).
 *
 * Entries live in content/studies.json. This module validates them and
 * decides which ones are public. It has no side effects and does not
 * touch the database: Studies is reference content only, with no
 * logging, no accounts and no stored state.
 */

const TOPICS = ['Acceleration', 'Max velocity', 'Strength and power', 'Plyometrics', 'Recovery', 'Injury research'];
const VERDICTS = ['works', 'mixed', 'doesnt_hold_up'];
const STATUSES = ['published', 'draft', 'retired'];
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TEXT_FIELDS = ['title', 'citation', 'tested', 'finding', 'key_number', 'verdict_reason', 'takeaway'];
/* Fields the reader sees. Anything not listed here (status, verified_by)
   never leaves the server. */
const PUBLIC_FIELDS = ['id', 'title', 'topic', 'citation', 'link', 'link_pending', 'tested', 'finding',
  'key_number', 'verdict', 'verdict_reason', 'takeaway', 'limits', 'is_injury_topic',
  'verified_on', 'updated', 'update_note'];

function isText(v) { return typeof v === 'string' && v.trim().length > 0; }

/* Returns a list of problems; an empty list means the entry is valid. */
function validateStudy(s) {
  const problems = [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['entry is not an object'];
  if (typeof s.id !== 'string' || !ID_RE.test(s.id)) problems.push('id must be a lowercase slug');
  for (const f of TEXT_FIELDS) if (!isText(s[f])) problems.push(f + ' is required');
  if (!TOPICS.includes(s.topic)) problems.push('topic must be one of the confirmed topics');
  if (!VERDICTS.includes(s.verdict)) problems.push('verdict must be works, mixed or doesnt_hold_up');
  if (!STATUSES.includes(s.status)) problems.push('status must be published, draft or retired');
  if (typeof s.is_injury_topic !== 'boolean') problems.push('is_injury_topic must be true or false');
  if (s.topic === 'Injury research' && s.is_injury_topic !== true) {
    problems.push('Injury research entries must set is_injury_topic to true');
  }
  if (s.limits !== undefined && typeof s.limits !== 'string') problems.push('limits must be text');
  if (s.update_note !== undefined && typeof s.update_note !== 'string') problems.push('update_note must be text');
  if (typeof s.link === 'string' && s.link !== '' && !/^https:\/\/[^\s]+$/.test(s.link)) {
    problems.push('link must be an https URL');
  }
  if (s.status === 'published') {
    if (!isText(s.link) && s.link_pending !== true) problems.push('a published entry needs a link, or link_pending set to true');
    if (!isText(s.verified_by)) problems.push('a published entry needs verified_by');
    if (typeof s.verified_on !== 'string' || !DATE_RE.test(s.verified_on)) problems.push('a published entry needs verified_on as YYYY-MM-DD');
    if (isText(s.takeaway) && s.takeaway.length > 400) problems.push('takeaway is too long (400 characters max)');
  }
  if (s.updated !== undefined && (typeof s.updated !== 'string' || !DATE_RE.test(s.updated))) {
    problems.push('updated must be YYYY-MM-DD');
  }
  return problems;
}

/* Validates a whole list. Returns the valid entries plus a report of
   anything skipped (and why), so a bad entry is logged and left out
   instead of taking the server down. Duplicate ids keep the first. */
function checkStudies(list) {
  const valid = [];
  const skipped = [];
  const seen = new Set();
  if (!Array.isArray(list)) return { valid, skipped: [{ id: '(file)', problems: ['studies.json must be a list'] }] };
  for (const entry of list) {
    const problems = validateStudy(entry);
    const id = entry && typeof entry.id === 'string' ? entry.id : '(no id)';
    if (!problems.length && seen.has(entry.id)) problems.push('duplicate id');
    if (problems.length) { skipped.push({ id, problems }); continue; }
    seen.add(entry.id);
    valid.push(entry);
  }
  return { valid, skipped };
}

/* Only published entries are ever shown. Drafts and retired entries
   never render, and the internal fields are stripped. */
function publicStudies(list) {
  const { valid } = checkStudies(list);
  return valid
    .filter(s => s.status === 'published')
    .map(s => {
      const out = {};
      for (const f of PUBLIC_FIELDS) if (s[f] !== undefined) out[f] = s[f];
      return out;
    });
}

module.exports = { TOPICS, VERDICTS, STATUSES, validateStudy, checkStudies, publicStudies };
