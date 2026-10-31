# Ruffin Speed Lab — Stripe integration plan (test mode)

## Confirmed Stripe sandbox prices
- Lab Access: $9.99/month — `price_1UWSw9AelNSvNtsvbyOhieHb`
- Lab Training: $49.99/month — `price_1UWSwJAelNSvNtsvz0ctLK9z`
- Lab Pass: $99.00/month — `price_1UWSwiAelNSvNtsv5R2KyEu0`

These are **test-mode** Price IDs only. Never use them with live credentials. Supersede all old $49/$99/$149 tier assumptions in STRIPE_INTEGRATION_TODO.md.

## Implementation acceptance criteria
1. Preserve invite-only registration and existing user data. Do not enable live billing.
2. On the authenticated server, accept only an allowlisted tier key (`lab_access`, `lab_training`, `lab_pass`); map it to a server-side configured Stripe Price ID. Never trust arbitrary client-supplied price IDs.
3. Create Stripe-hosted Checkout Sessions in subscription mode with the correct tier, user association, and verified return URLs. Prevent open redirects and duplicate unintended sessions.
4. Add `POST /api/stripe/webhook` with raw-body signature verification and `STRIPE_WEBHOOK_SECRET`. Handle checkout completion, subscription creation/update/deletion, and invoice payment failures idempotently. Reconcile Stripe subscription state to the correct local member account; never grant access from a success redirect alone.
5. Provide billing portal session creation only for authenticated owners of the Stripe customer; configure return URL and test plan changes/cancellations.
6. Define entitlements for each tier against Muse HQ's current business plan before enforcing access restrictions.
7. Test three tier checkouts, success/cancel, invalid tier, duplicate events, forged webhook, failed renewal, cancellation, and unauthorized portal access.
8. Add test-only Render environment values and webhook configuration after code review; no secrets in GitHub or Notion. Do not alter SJC Sprinter.
9. Open a pull request, run tests, review deployment and rollback plan, then request AJ approval before production merge or live charges.

## Current code limitation
`server.js` currently exposes a single `STRIPE_PRICE_ID` checkout route without a webhook or paywall. Do not enable it with production keys in its present state.
