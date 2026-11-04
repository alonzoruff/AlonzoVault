'use strict';
/*
 * Stripe helpers for the membership webhook (zero dependencies).
 *
 * Pure functions only: nothing in here touches the database, the
 * network, or the environment, so every function can be tested on its
 * own. server.js owns the route; this file owns the checks.
 */
const crypto = require('crypto');

const DEFAULT_TOLERANCE_SECONDS = 300;

/* "t=1700000000,v1=abc...,v1=def..." -> { t: '1700000000', v1: [...] }.
   Unknown keys (v0 and the like) are ignored. */
function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  if (typeof header !== 'string') return out;
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') out.t = v;
    else if (k === 'v1') out.v1.push(v);
  }
  return out;
}

/* Verify a Stripe-Signature header against the EXACT bytes Stripe
   sent. Stripe signs "<timestamp>.<raw body>" with HMAC-SHA256 using
   the endpoint's signing secret; a header may carry several v1
   signatures (during secret rotation), and any one matching is
   enough. The signature is checked first, then the timestamp is held
   to a tolerance window so a captured request cannot be replayed
   later. Returns { ok: true, timestamp } or { ok: false, reason };
   the reason is for the server log only, never for the response. */
function verifyWebhookSignature(rawBody, header, secret, opts) {
  const o = opts || {};
  const tolerance = typeof o.toleranceSeconds === 'number'
    ? o.toleranceSeconds : DEFAULT_TOLERANCE_SECONDS;
  const nowMs = typeof o.now === 'number' ? o.now : Date.now();
  if (!secret) return { ok: false, reason: 'no signing secret configured' };
  if (typeof header !== 'string' || !header) return { ok: false, reason: 'missing signature header' };
  const parsed = parseSignatureHeader(header);
  if (!parsed.t || !/^\d+$/.test(parsed.t)) return { ok: false, reason: 'bad timestamp in signature header' };
  if (parsed.v1.length === 0) return { ok: false, reason: 'no v1 signature in header' };
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', secret)
    .update(parsed.t + '.', 'utf8')
    .update(payload)
    .digest();
  let matched = false;
  for (const sig of parsed.v1) {
    if (sig.length !== expected.length * 2 || !/^[0-9a-fA-F]+$/.test(sig)) continue;
    if (crypto.timingSafeEqual(Buffer.from(sig, 'hex'), expected)) matched = true;
  }
  if (!matched) return { ok: false, reason: 'signature mismatch' };
  const ageSeconds = Math.abs(nowMs / 1000 - Number(parsed.t));
  if (ageSeconds > tolerance) return { ok: false, reason: 'timestamp outside tolerance' };
  return { ok: true, timestamp: Number(parsed.t) };
}

/* A small, log-safe summary of an event: ids, types, and which
   identity fields are present. It never carries an email address or
   any other personal detail, only whether one was there. Never
   throws, whatever it is handed. */
function describeEvent(event) {
  const e = event && typeof event === 'object' ? event : {};
  const obj = e.data && e.data.object && typeof e.data.object === 'object' ? e.data.object : {};
  const meta = obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {};
  const str = (v) => (typeof v === 'string' && v ? v : null);
  let subscriptionId = null;
  if (obj.object === 'subscription') subscriptionId = str(obj.id);
  else subscriptionId = str(obj.subscription);
  const details = obj.customer_details && typeof obj.customer_details === 'object' ? obj.customer_details : {};
  return {
    id: str(e.id),
    type: str(e.type),
    livemode: e.livemode === true,
    created: typeof e.created === 'number' ? e.created : null,
    object: str(obj.object),
    objectId: str(obj.id),
    status: str(obj.status),
    clientReferenceId: str(obj.client_reference_id),
    metadataUserId: str(meta.user_id),
    customerId: str(obj.customer),
    subscriptionId,
    hasEmail: !!(str(obj.customer_email) || str(details.email)),
  };
}

/* ------------------------------------------------------------------ */
/* Membership mapping (step 1c). Still pure: no db, network, or env.   */
/* ------------------------------------------------------------------ */

/* Stripe's subscription status -> the app's two membership statuses.
   Anything that still gives the member their paid access stays
   active (trialing, past_due while Stripe retries the card); only a
   final end is cancelled. Statuses that mean the checkout never
   completed (incomplete, incomplete_expired) and any status this
   code does not know return null: no change to the account. */
function mapSubscriptionStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return 'active';
    case 'canceled':
    case 'unpaid':
      return 'cancelled';
    default:
      return null;
  }
}

/* A Stripe subscription id is "sub_" plus letters, digits, and
   underscores. Checked before one is placed in a URL path. */
function isSubscriptionId(v) {
  return typeof v === 'string' && /^sub_[A-Za-z0-9_]{1,200}$/.test(v);
}

/* priceMap is { access: 'price_...', training: ..., pass: ... },
   built by the server from its own tier table. */
function tierForPrice(priceId, priceMap) {
  if (typeof priceId !== 'string' || !priceId || !priceMap) return null;
  for (const tier of Object.keys(priceMap)) {
    if (priceMap[tier] === priceId) return tier;
  }
  return null;
}

/* Seconds since the epoch -> ISO string, or null. */
function isoFromSeconds(sec) {
  return typeof sec === 'number' && Number.isFinite(sec) && sec > 0
    ? new Date(sec * 1000).toISOString() : null;
}

/* The end of the paid period. Stripe moved current_period_end from
   the subscription onto its items in newer API versions, so both
   places are read. Returns seconds or null. */
function periodEndSeconds(sub) {
  const s = sub && typeof sub === 'object' ? sub : {};
  if (typeof s.current_period_end === 'number') return s.current_period_end;
  const items = s.items && Array.isArray(s.items.data) ? s.items.data : [];
  for (const it of items) {
    if (it && typeof it.current_period_end === 'number') return it.current_period_end;
  }
  return null;
}

/* What the membership code needs from a subscription object. The
   tier comes only from the price, through the server's own map. */
function subscriptionFacts(sub, priceMap) {
  const s = sub && typeof sub === 'object' ? sub : {};
  const str = (v) => (typeof v === 'string' && v ? v : null);
  const meta = s.metadata && typeof s.metadata === 'object' ? s.metadata : {};
  const items = s.items && Array.isArray(s.items.data) ? s.items.data : [];
  let priceId = null;
  let tier = null;
  for (const it of items) {
    const pid = it && it.price && typeof it.price === 'object' ? str(it.price.id) : null;
    if (!pid) continue;
    if (!priceId) priceId = pid;
    const t = tierForPrice(pid, priceMap);
    if (t) { priceId = pid; tier = t; break; }
  }
  const customerId = typeof s.customer === 'string' ? str(s.customer)
    : (s.customer && typeof s.customer === 'object' ? str(s.customer.id) : null);
  /* When the member has asked to stop at the end of the period,
     Stripe sets cancel_at; older payloads may carry only the flag. */
  let cancelAt = isoFromSeconds(s.cancel_at);
  if (!cancelAt && s.cancel_at_period_end === true) cancelAt = isoFromSeconds(periodEndSeconds(s));
  return {
    id: str(s.id),
    customerId,
    stripeStatus: str(s.status),
    status: mapSubscriptionStatus(s.status),
    priceId,
    tier,
    userId: str(meta.user_id),
    cancelAt,
  };
}

/* What the membership code needs from a Checkout Session. */
function sessionFacts(session) {
  const s = session && typeof session === 'object' ? session : {};
  const str = (v) => (typeof v === 'string' && v ? v : null);
  const meta = s.metadata && typeof s.metadata === 'object' ? s.metadata : {};
  const details = s.customer_details && typeof s.customer_details === 'object' ? s.customer_details : {};
  const subscriptionId = typeof s.subscription === 'string' ? str(s.subscription)
    : (s.subscription && typeof s.subscription === 'object' ? str(s.subscription.id) : null);
  const customerId = typeof s.customer === 'string' ? str(s.customer)
    : (s.customer && typeof s.customer === 'object' ? str(s.customer.id) : null);
  return {
    mode: str(s.mode),
    paymentStatus: str(s.payment_status),
    subscriptionId,
    customerId,
    userId: str(s.client_reference_id) || str(meta.user_id),
    email: (str(s.customer_email) || str(details.email) || '').toLowerCase() || null,
  };
}

module.exports = {
  DEFAULT_TOLERANCE_SECONDS,
  parseSignatureHeader,
  verifyWebhookSignature,
  describeEvent,
  mapSubscriptionStatus,
  isSubscriptionId,
  tierForPrice,
  isoFromSeconds,
  periodEndSeconds,
  subscriptionFacts,
  sessionFacts,
};
