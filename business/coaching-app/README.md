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

A move from Render to Vercel is being planned. If it happens, saved
data would move from the disk file to a hosted data store. Until then,
Render is the live home and nothing here changes.

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

Payments are switched off on purpose right now: with no Stripe key set,
checkout answers "Payments are not configured yet." That is expected,
not a bug. Prices, tiers, and the trial are AJ's decisions and do not
change in code without his word.

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
```

Each one ends with a line like `2057 passed, 0 failed`. On main on
Nov 24, 2026 every file passed. `tests/harness.js` is a shared helper,
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

## Tests

```sh
node tests/run-tests.js
```

Starts the server on a throwaway port with a temporary `DATA_DIR`,
exercises the API end to end, and cleans up.
