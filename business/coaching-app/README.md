# AYG Lab: coaching membership app

## What it is

This is the members' website for **AYG Lab**, AJ Ruffin's speed and
strength coaching business. AYG Lab was called Ruffin Performance until
November 2026, so the live web address, the Render service, and some
names inside the code still say `ruffin-performance`. That is on
purpose: renaming them would break links and logins.

- **Live address:** ruffin-performance.onrender.com (hosted on Render,
  service name `ruffin-performance`).
- **Who uses it:** AJ as owner and head coach, any assistant coaches he
  invites, and members. Sign-up is invite-only during the founding pilot.
- **What members do:** see their program, the exercise video library,
  their testing and progress numbers, and fill in a daily check-in.
- **What it is not:** it is not the SJC sprinter app. The two started
  from the same code in October 2026 and are now completely separate.
  They share no accounts, no data, and no settings, and a change to one
  never touches the other.

The business name and tagline live in one spot: the `BRAND` block near
the top of `server.js`. Change it there and every page follows.

## The parts, in plain words

- `server.js`: the whole engine. It serves the pages, runs logins,
  saves data, and answers every button press. One file, no outside
  packages (only what comes built into Node).
- `public/`: what people see in the browser. `index.html` is the page,
  `app.js` is what makes it interactive, `styles.css` is the look,
  `sw.js` lets it work like a phone app.
- `content/`: the coaching material bundled with the app (sessions,
  drills, the video library, the glossary, Lab programs). These are
  plain files in the repo, not member data.
- `lib/`: helpers. `notify.js` sends AJ email alerts, `stripe.js` talks
  to Stripe for payments, `logo-data.js` holds the logo.
- `scripts/build-content.py`: refreshes `content/` from the vault's
  shared workout files. Run it, then commit the changed `content/` files.
- `tests/`: automatic checks (see "Tests at a glance" below).
- `STRIPE_INTEGRATION_TODO.md`: notes on the payments setup.

## Run it on your own computer

You need Node.js version 18 or newer (free from nodejs.org). Then:

```sh
cd business/coaching-app
npm start
```

Open http://localhost:3000. The first account you register becomes the
owner. Stop it with Ctrl+C. Running it on your computer makes its own
empty `data/` folder there and never touches the live site's data.

## Where its data lives

Everything people save (accounts, members, check-ins, testing, notes)
is kept in **one file, `db.json`**, inside the folder named by the
`DATA_DIR` setting. The login-signing secret sits next to it in
`.session-secret` when one is not set by hand.

- **On the live site:** Render keeps that folder on a 1 GB permanent
  disk mounted at `/var/data` (`DATA_DIR` is set to `/var/data`), so the
  data survives restarts and new deploys.
- **Never in GitHub:** the `data/` folder is private and is not part of
  the repo.
- **Backups:** the coach can download a full backup file from inside the
  app, and restore one the same way. Download one before any hosting
  change.

The app can also run on Vercel. There, saved data lives in a hosted
Upstash Redis store instead of `db.json` (see "Running on Vercel" below).
Render stays the live home until AJ gives the final word on the move.

## Settings (environment variables)

Settings are typed into the host (Render), never into the code. Only the
names are listed here. Values, and above all keys and secrets, are never
written in the repo.

| Name | What it does | If it is not set |
|---|---|---|
| `PORT` | Which port the site listens on. Render sets it. | 3000 |
| `DATA_DIR` | Folder that holds `db.json`. | `./data` in the app folder |
| `SESSION_SECRET` | Signs login cookies so they can't be faked. | One is made once and kept in `DATA_DIR` |
| `DOMAIN` | The site's public address, used for payment return links. | A placeholder address |
| `CONTACT_EMAIL` | Public contact address in the footer and password-help link. | No address is shown |
| `TRIAL_DAYS` | Length of the free trial shown on the site (1 to 60). | 3 |
| `CALENDLY_URL` | The Calendly event the booking page shows. | AJ's 30-minute event |
| `COACH_INVITE_EMAILS` | Emails to invite as assistant coaches at startup (comma-separated). | No one is pre-invited |
| `RESEND_API_KEY` | Turns on email alerts to AJ (needs `NOTIFY_EMAIL` too). | No emails are sent |
| `NOTIFY_EMAIL` | Where the email alerts go. | No emails are sent |
| `RESEND_FROM` | The "from" line on those emails. | A Resend test sender |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET` | Where coach demo videos upload. Public names, not secrets. | AJ's existing account |
| `STRIPE_SECRET_KEY` | Turns on payments. | Checkout answers "Payments are not configured yet." |
| `STRIPE_WEBHOOK_SECRET` | Lets Stripe tell the app when a membership changes. | Stripe's messages are refused |
| `STRIPE_PRICE_LAB_ACCESS`, `STRIPE_PRICE_LAB_TRAINING`, `STRIPE_PRICE_LAB_PASS` | Override the Stripe price for each tier. | The built-in tier prices |
| `STRIPE_PRICE_ID` | Older single-price setting, kept for compatibility. | A placeholder |
| `STRIPE_API_BASE`, `RESEND_API_BASE` | Used only by the tests, to point at a pretend Stripe or Resend. | The real services |
| `SITE_URL` | The public address written into page tags, the sitemap and the robots file. | `https://ruffin-performance.onrender.com` |
| `READ_ONLY_MODE` | Set to `1` for a short pause during a move: sign-in and reading work, every change is refused. | Normal (changes allowed) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`, `KV_REST_API_TOKEN`) | Turns on the hosted data store (Vercel). | Data stays in `db.json` |
| `OWNER_SETUP_EMAIL` | On an empty hosted store, the only email allowed to create the first (owner) account. | No one can claim an empty hosted store |
| `STORE_PREFIX` | Key prefix in the hosted store. | `ayg-lab` |

Payments are switched off on purpose right now: with no Stripe key set,
checkout answers "Payments are not configured yet." That is expected,
not a bug. Prices, tiers, and the trial are AJ's decisions and do not
change in code without his word.

## Running on Vercel (hosted data store)

Render keeps working exactly as above. Vercel has no lasting disk, so on
Vercel the data lives in a hosted Upstash Redis store instead of `db.json`.
That mode turns on only when both store settings are present:

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`
  + `KV_REST_API_TOKEN`, the names Vercel's Upstash integration uses)
- `SESSION_SECRET` — required in this mode (the API answers 503 without it).
  Use the same value as Render so nobody is signed out by the move.
- `OWNER_SETUP_EMAIL` — on an empty store, only this email may create the
  first (head coach) account. Leave it unset once real data is copied in.
- `STORE_PREFIX` — optional key prefix (default `ayg-lab`)

In this mode every API request loads the store fresh (or reuses it when
nothing changed), runs, and saves with a version check, so two saves at
the same moment can never erase each other: the later one is re-run on
top of the earlier. Coach emails go out after the save and before the
reply. See `lib/store.js`.

Vercel project settings: Root Directory `business/coaching-app`, Framework
"Other", no build command. `vercel.json` sends every path to
`api/index.js` (the same handler Render runs) and keeps `vercel-static/`
empty on purpose, so pages still get the brand and address filled in.
On Vercel, imports are capped at 4 MB (Vercel's request limit is about
4.5 MB) and big downloads are gzipped.

One-time move of the real data (with Render paused by `READ_ONLY_MODE=1`):

```sh
UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/copy-to-store.js db.json
```

It refuses to overwrite a store that already has data (add `--replace` on
purpose) and prints a count check for every collection.

## Tests at a glance

Each file in `tests/` starts its own copy of the app on a spare port
with a throwaway data folder, checks it, and cleans up. Nothing touches
the live site. Run them from `business/coaching-app`:

```sh
node tests/run-tests.js              # the big one, about 2,000 checks
node tests/stripe-step1-tests.js     # payments, part 1
node tests/stripe-step1c-tests.js    # payments, part 2
node tests/stripe-step1d-tests.js    # payments, cancelling
node tests/notify-tests.js           # email alerts and booking page
node tests/access-page-tests.js      # coach's member access page
node tests/membership-card-tests.js  # member's membership card
node tests/growth-tests.js           # sign-up funnel and scoreboard
node tests/security-headers-tests.js # security headers and the bad-request crash fix
node tests/filming-tests.js          # Filming Tracker
node tests/risky-areas-tests.js      # the riskiest areas, with a coverage report
node tests/store-tests.js            # hosted data store (uses a pretend Upstash)
node tests/run-tests-store-mode.js   # the big suite again, in hosted-store mode
```

Each one ends with a line like `2057 passed, 0 failed`. `npm test` runs
the big suite, the store tests and the store-mode suite together. `tests/harness.js` is a shared helper,
not a test to run.

For how a change gets from an idea to the live site, see
[How a change ships](../../docs/HOW-A-CHANGE-SHIPS.md).

## Model

- **Registration is invite-only** (founding pilot). First account =
  owner/head coach. After that, an email registers only if invited —
  as a coach (`/api/coach-invites`) or as a member (`/api/client-invites`).
- Coach-run program data with one member surface: the daily wellness
  check-in. Members also keep a personal practice log and swaps.
- Content (sessions, drills, season plan, videos, definitions) is the
  coach's own, bundled in `content/`; refresh it from the vault's
  shared sources with `python3 scripts/build-content.py` (the script
  scrubs school identifiers from the two copied markdown files).

## Filming tracker

Coach Hub > Filming Tracker lists every AYG Lab movement (102 from the
Nov 20 Exercises List, in `content/filming_list.json`) under Mobility,
Running, and Strengthening. Tap the circle to mark a movement filmed;
type in its note field and the note saves when you leave the field.
Statuses and notes save to `db.json` in `DATA_DIR` (keys `filming` and
`filmingExtras`), the same store every other coach record uses, and
ride along in the full backup. To add a movement later, use the
"Add a movement" form at the bottom of the page. Movements you add
can be removed; the ones from the list stay.

## Tests

```sh
node tests/run-tests.js            # the main suite (Render file mode)
node tests/store-tests.js          # hosted-store mode and the Vercel entry
node tests/run-tests-store-mode.js # the main suite again, in hosted-store mode
npm test                           # all three
```

Starts the server on a throwaway port with a temporary `DATA_DIR`,
exercises the API end to end, and cleans up. The smaller files in
`tests/` (Stripe, notifications, access page, growth, membership card,
security headers) run the same way, one file at a time.
