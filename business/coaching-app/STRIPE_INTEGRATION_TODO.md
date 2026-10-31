# Stripe Integration TODO — Ruffin Performance

The single source of truth for the Stripe Checkout integration in this
app. Current state: the server endpoint `POST /api/checkout/session`
exists and creates a hosted Stripe Checkout Session by calling the
Stripe REST API directly (zero-dependency — no Stripe SDK, no npm
packages). It is **inert by default**: until `STRIPE_SECRET_KEY` is
set in the environment it answers `503 {"error":"Payments are not
configured yet."}` and never attempts a Stripe call. Since v13 the
endpoint sells the three Lab tiers: the request body names a tier
(`{ "tier": "access" | "training" | "pass" }`) and the server
resolves that tier's price itself (see the tier table below) — a raw
price ID from the client is never accepted, and an unknown tier gets
a 400 before any Stripe call. The landing page carries the three
tier cards with a join button per tier. There is no
webhook handler yet — that is the remaining Build C step listed at
the bottom. Since v14 the app HAS the access system the webhook
will drive: every member account carries `tier`, `membershipStatus`,
`tierUpdatedAt`, reserved `stripeCustomerId` / `stripeSubscriptionId`
fields, and a `membershipHistory`; the coach sets tiers by hand on
the Access page today, and the member APIs enforce the tiers
server-side. The webhook stage below writes those same fields.

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
| line_items[].price | per tier (see below) | Resolved server-side from the tier named in the request body. Each tier's real Price ID is baked in as the default and can be overridden by its env var. A request with no tier keeps the original behavior: `STRIPE_PRICE_ID`, or the `price_...` placeholder while that is unset. |
| STRIPE_PRICE_LAB_ACCESS (env var) | price_1UWTZpAelNSvNtsvHAVExdYX (baked in) | Lab Access, $10/mo. Set the env var only to override the baked-in Price ID. |
| STRIPE_PRICE_LAB_TRAINING (env var) | price_1UWSwJAelNSvNtsvz0ctLK9z (baked in) | Lab Training, $49.99/mo. Set the env var only to override the baked-in Price ID. |
| STRIPE_PRICE_LAB_PASS (env var) | price_1UWSwiAelNSvNtsv5R2KyEu0 (baked in) | Lab Pass, $99/mo. Set the env var only to override the baked-in Price ID. |
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
DOMAIN=https://ruffin-performance.onrender.com
# Optional overrides — the tier prices are baked in (table above):
# STRIPE_PRICE_LAB_ACCESS=price_...
# STRIPE_PRICE_LAB_TRAINING=price_...
# STRIPE_PRICE_LAB_PASS=price_...
# STRIPE_PRICE_ID=price_...          # only for requests that name no tier
# STRIPE_API_BASE=https://api.stripe.com   # default; override only for tests
```

On the live host (Render): in the `ruffin-performance` service, open
**Environment**, add `STRIPE_SECRET_KEY` and
`DOMAIN=https://ruffin-performance.onrender.com`, then let the
service redeploy/restart so it picks them up. The three
`STRIPE_PRICE_LAB_*` variables are optional — the tier Price IDs are
already the code defaults. Until `STRIPE_SECRET_KEY` is added there,
the live endpoint correctly stays at 503. Note the current tier
prices are TEST-mode prices, so the key pasted must be the test
secret key (`sk_test_...`) for these prices to resolve; a live key
needs live-mode prices first.

### How the integration works

1. The client calls `POST /api/checkout/session` with a JSON body
   naming the tier (`{ "tier": "access" }`, `"training"`, or
   `"pass"`). The landing tier buttons send exactly this.
2. If `STRIPE_SECRET_KEY` is not set, the server answers
   `503 {"error":"Payments are not configured yet."}` and stops —
   payments are off. An unknown tier (with a key configured) answers
   `400 {"error":"Unknown tier."}` and never reaches Stripe.
3. Otherwise the server resolves the tier's price (env override or
   baked-in default) and POSTs the configured parameters (above) to
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

1. ~~**Finish Stripe account activation**~~ DONE Oct 30, 2026:
   the account is activated with charges and payouts on, in TEST
   mode.
2. ~~**Create the three products/prices**~~ DONE Oct 30, 2026:
   Lab Access $10/mo (`price_1UWTZpAelNSvNtsvHAVExdYX`), Lab Training
   $49.99/mo (`price_1UWSwJAelNSvNtsvz0ctLK9z`), Lab Pass $99/mo
   (`price_1UWSwiAelNSvNtsv5R2KyEu0`) — all TEST-mode prices, now the
   baked-in defaults in the server's tier map (v13).
3. **Set the env vars on the Render service:** `STRIPE_SECRET_KEY`
   (the TEST secret key, `sk_test_...`, matching the test-mode
   prices above) and `DOMAIN=https://ruffin-performance.onrender.com`.
   The `STRIPE_PRICE_LAB_*` overrides are optional. This is the only
   step between the current 503 and working tier checkout buttons.
4. **NEXT PAYMENT STEP — the 3-day trial** (decided Oct 30, 2026; length corrected by AJ Oct 31, 2026,
   deliberately NOT in the v13 build): 3 days at the Lab Access
   level, no card required to start. On the session this means
   `subscription_data[trial_period_days]=3` for the trial entry path
   plus `payment_method_collection` set so no card is collected up
   front for the trial — both change the fixed Checkout Studio
   parameter set, so they land as their own reviewed change, not
   silently inside another build.
5. **Build the next Build C stage (separate from this endpoint):**
   the webhook endpoint (`checkout.session.completed` etc.) with
   `STRIPE_WEBHOOK_SECRET` for fulfillment, plus the public join
   flow. Registration stays invite-only until that stage ships. The
   v14 access system defines exactly what this stage writes:
   - **Bind checkout to the account.** Checkout sessions carry no
     account identity today. When a signed-in member checks out,
     send `client_reference_id` = the member's user id (and/or the
     account email as `customer_email`) so the webhook can find the
     account that paid. The tier already travels in the session
     metadata path the endpoint resolves server-side.
   - **On `checkout.session.completed` / subscription activation:**
     find the user by `client_reference_id` (fall back to the
     customer email), then set the v14 fields on that user record:
     `tier` from the purchased price's tier, `membershipStatus`
     'active', `tierUpdatedAt`, `stripeCustomerId` from the
     session's customer, and `stripeSubscriptionId` from the
     session's subscription — through the same
     `applyMembershipChange` path the coach Access page uses, so the
     change lands in `membershipHistory` (actor 'stripe').
   - **On Stripe-side cancellation** (`customer.subscription.deleted`,
     or a subscription ending unpaid): when the account carries a
     matching `stripeSubscriptionId`, set `membershipStatus` to
     'cancelled' on the same record — the v14 gates end tier access
     from that field alone, and the coach Access page already
     reflects it. The member's in-app Cancel button covers the
     no-Stripe-subscription case today; once a
     `stripeSubscriptionId` exists, the cancel action should also
     cancel the subscription at Stripe so the two never disagree.
6. **Going live for real money:** create live-mode versions of the
   three prices, set the `STRIPE_PRICE_LAB_*` env vars (or bake new
   defaults), and swap in the live secret key.
7. **Resources:** https://support.stripe.com and
   https://docs.stripe.com/mcp
