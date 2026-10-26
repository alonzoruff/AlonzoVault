# Stripe Integration TODO — Ruffin Performance

The single source of truth for the Stripe Checkout integration in this
app. Current state: the server endpoint `POST /api/checkout/session`
exists and creates a hosted Stripe Checkout Session by calling the
Stripe REST API directly (zero-dependency — no Stripe SDK, no npm
packages). It is **inert by default**: until `STRIPE_SECRET_KEY` is
set in the environment it answers `503 {"error":"Payments are not
configured yet."}` and never attempts a Stripe call. There is no
paywall, no public join-flow change, and no webhook handler yet —
those are the remaining Build C steps listed at the bottom.

## Values to Replace

The following values are placeholders and must be updated before
going live.

**Files containing placeholders:**

- [server.js](server.js)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | subscription | Set to "payment" for one-time charges or "subscription" for recurring billing. Memberships are recurring, so it stays "subscription" unless the product type changes. |
| success_url | https://example.com/checkout/success?session_id={CHECKOUT_SESSION_ID} | Your actual post-payment success page URL — with DOMAIN set it becomes `https://ruffin-performance.onrender.com/checkout/success?session_id={CHECKOUT_SESSION_ID}`. Keep the {CHECKOUT_SESSION_ID} template. |
| cancel_url | https://example.com/ | Your actual cancel/return page URL — with DOMAIN set it becomes `https://ruffin-performance.onrender.com/`. |
| line_items[].price | price_... | Your actual Stripe Price ID from the Dashboard (https://dashboard.stripe.com/prices) or API. Set it through the `STRIPE_PRICE_ID` environment variable (see below) — the code falls back to the `price_...` placeholder only while the variable is unset. |
| DOMAIN (env var) | https://example.com (code default) | `https://ruffin-performance.onrender.com` on the live Render service. The success_url and cancel_url are built from it. |
| STRIPE_SECRET_KEY (env var) | unset (endpoint answers 503) | The live secret key (`sk_live_...`) from the Stripe Dashboard, set only in the host's environment — never in code or in this repo. A test key (`sk_test_...`) works for test-mode runs. |
| STRIPE_PRICE_ID (env var) | unset (falls back to `price_...`) | The real Price ID of the membership being sold (see the products step below). |

## Configured Parameters

These parameters were configured in Checkout Studio and are already
set correctly in the checkout-session request the server builds.

**Files containing these parameters:**

- [server.js](server.js)

| Parameter | Value |
|-----------|-------|
| ui_mode | hosted_page |
| mode | subscription |
| billing_address_collection | auto |
| phone_number_collection[enabled] | false |
| automatic_tax[enabled] | false |
| allow_promotion_codes | false |
| payment_method_collection | always |
| submit_type | auto |
| metadata[integration_identifier] | hosted_web_0001 |
| metadata[origin_context] | web |
| line_items[0][quantity] | 1 |

Notes:

- **ui_mode:** no Stripe SDK is installed in this app (the integration
  is a direct REST call), so the SDK-version rule does not apply and
  `hosted_page` is used per the default.
- **payment_method_collection** is included because mode is
  `subscription`.
- **integration_identifier** (`hosted_web_0001`) and **origin_context**
  (`web`) have no native Checkout Session parameter, so they are sent
  as session metadata.
- `integration_identifier` / `origin_context` mapping decided for this
  integration: metadata keys `integration_identifier` and
  `origin_context` on the Checkout Session.

## Setup and Next Steps

### Environment variables

The server reads these from `process.env` (names in code and here
match exactly). Locally, export them in your shell before
`node server.js`; never commit real keys.

```bash
STRIPE_SECRET_KEY=sk_test_...        # secret key — server only, never in code
STRIPE_PRICE_ID=price_...            # the Price ID the checkout sells
DOMAIN=https://ruffin-performance.onrender.com
# STRIPE_API_BASE=https://api.stripe.com   # default; override only for tests
```

On the live host (Render): in the `ruffin-performance` service, open
**Environment**, add `STRIPE_SECRET_KEY` (live key), `STRIPE_PRICE_ID`
(real Price ID), and `DOMAIN=https://ruffin-performance.onrender.com`,
then let the service redeploy/restart so it picks them up. Until
`STRIPE_SECRET_KEY` is added there, the live endpoint correctly stays
at 503.

### How the integration works

1. The client calls `POST /api/checkout/session`.
2. If `STRIPE_SECRET_KEY` is not set, the server answers
   `503 {"error":"Payments are not configured yet."}` and stops —
   payments are off.
3. Otherwise the server POSTs the configured parameters (above) to
   `https://api.stripe.com/v1/checkout/sessions` with the secret key
   as a Bearer token, form-encoded.
4. On success the server answers `200 {"url": "<hosted checkout
   URL>"}` and the client sends the member to that Stripe-hosted page
   to pay. On a Stripe error it answers a generic `502` JSON error.
5. Stripe redirects the member to `success_url` after payment, or to
   `cancel_url` if they back out.

### Testing

Run Stripe in **test mode** (test keys, `sk_test_...`) while
developing. Use the standard test card **4242 4242 4242 4242** with
any future expiry date and any CVC — it always succeeds in test mode.
No real money moves with test keys.

### Remaining steps (in order)

1. **Finish Stripe account activation** in the Dashboard: business
   details, identity verification, and a payout bank account, until
   the account shows `charges_enabled` true. (The account is
   currently in test mode with charges off.)
2. **Create the three products/prices** in Stripe — $99 Membership,
   $149 Membership + Coaching, $49 Founding Pilot — and note their
   real Price IDs.
3. **Set the live env vars on the Render service:**
   `STRIPE_SECRET_KEY` (live key), `STRIPE_PRICE_ID` (the real Price
   ID to sell first), and `DOMAIN=https://ruffin-performance.onrender.com`.
4. **Build the next Build C stage (separate from this endpoint):**
   the webhook endpoint (`checkout.session.completed` etc.) with
   `STRIPE_WEBHOOK_SECRET` for fulfillment, plus the paywall and the
   public join flow. Registration stays invite-only until that stage
   ships.
5. **Resources:** https://support.stripe.com and
   https://docs.stripe.com/mcp
