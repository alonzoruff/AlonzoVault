'use strict';
/*
 * Coach notifications by email, through Resend (https://resend.com).
 *
 * Every public or member-facing form in the app stores its record in
 * the JSON store; this module also tells Coach AJ about it, so he
 * does not have to open the app to find out someone reached out.
 *
 * Zero dependencies: one HTTPS POST with Node's built-in fetch.
 *
 * Environment:
 *   RESEND_API_KEY  Resend API key (re_...). Unset = notifications are
 *                   off: notifyCoach() logs one line and returns.
 *   NOTIFY_EMAIL    Where notifications go (comma-separated for more
 *                   than one). Unset = off, same as a missing key.
 *   RESEND_FROM     The sender. Default "Ruffin Performance
 *                   <onboarding@resend.dev>", Resend's shared test
 *                   sender, which only delivers to the email address
 *                   the Resend account was created with. To send from
 *                   your own domain, verify it in Resend and set this.
 *   RESEND_API_BASE Override for tests (default https://api.resend.com).
 *
 * A notification never blocks or fails the request that caused it:
 * notifyCoach() is fire-and-forget, catches everything, and logs the
 * outcome (never the key) so a failure shows in the host's logs.
 */

const DEFAULT_FROM = 'Ruffin Performance <onboarding@resend.dev>';

function config() {
  const key = (process.env.RESEND_API_KEY || '').trim();
  const to = (process.env.NOTIFY_EMAIL || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return {
    key,
    to,
    from: (process.env.RESEND_FROM || '').trim() || DEFAULT_FROM,
    base: (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, ''),
  };
}

function notificationsEnabled() {
  const c = config();
  return !!(c.key && c.to.length);
}

/* fields: [[label, value], ...] — empty values are left out. */
function formatBody(intro, fields, link) {
  const lines = [intro, ''];
  for (const [label, value] of fields || []) {
    const v = value === undefined || value === null ? '' : String(value).trim();
    if (v) lines.push(label + ': ' + v);
  }
  if (link) lines.push('', link);
  return lines.join('\n');
}

let warnedOff = false;

/* Send one notification. Returns a promise that always resolves:
   { sent: true, id } | { sent: false, reason }. Callers normally do
   not await it. */
async function notifyCoach({ subject, intro, fields, link, replyTo }) {
  const c = config();
  if (!c.key || !c.to.length) {
    if (!warnedOff) {
      warnedOff = true;
      console.log('[notify] Email notifications are off (set RESEND_API_KEY and NOTIFY_EMAIL to turn them on).');
    }
    return { sent: false, reason: 'not_configured' };
  }
  const payload = {
    from: c.from,
    to: c.to,
    subject: String(subject || 'Ruffin Performance notification').slice(0, 200),
    text: formatBody(intro || subject || '', fields, link),
  };
  if (replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) payload.reply_to = replyTo;
  try {
    const res = await fetch(c.base + '/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* non-JSON answer */ }
    if (!res.ok) {
      const msg = json && (json.message || (json.error && json.error.message) || json.name);
      console.error('[notify] Resend refused "' + payload.subject + '": ' + res.status + (msg ? ' ' + msg : ''));
      return { sent: false, reason: 'http_' + res.status };
    }
    console.log('[notify] Sent "' + payload.subject + '"' + (json && json.id ? ' (' + json.id + ')' : ''));
    return { sent: true, id: json && json.id };
  } catch (err) {
    console.error('[notify] Could not reach Resend for "' + payload.subject + '": ' + (err && err.message));
    return { sent: false, reason: 'network' };
  }
}

module.exports = { notifyCoach, notificationsEnabled, formatBody };
