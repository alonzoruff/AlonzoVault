# Ruffin Performance — coaching membership app

The online membership app for **Ruffin Performance**, AJ Ruffin's own
speed & strength coaching business (brand name and tagline live in one
place: the `BRAND` block at the top of `server.js` — rename there and
every surface follows).

Forked from the coach's school-program sprinter app engine on Oct 25, 2026. From the fork
on, the two apps evolve separately: this codebase contains **no school
data, branding, or accounts**, and its store starts empty. The landing
page carries exactly one connection to the family's gym — a single
line linking to accelerateyourgame.com — and nothing more.

## Running it

```sh
node server.js        # or: npm start
```

Zero dependencies (Node >= 18 built-ins only). Environment:

- `PORT` — default 3000
- `DATA_DIR` — where the JSON store + session secret live (default `./data`)
- `SESSION_SECRET` — optional; generated into `DATA_DIR` when unset
- `COACH_INVITE_EMAILS` — optional comma-separated assistant-coach invite seeds
- `RESEND_API_KEY` — Resend API key; with `NOTIFY_EMAIL` it turns on
  coach email notifications (invitation requests, uninvited sign-up
  attempts, new accounts, form checks, in-person requests). Unset = off.
- `NOTIFY_EMAIL` — where notifications go (comma-separated for several)
- `RESEND_FROM` — sender; default `Ruffin Performance <onboarding@resend.dev>`,
  which only delivers to the address the Resend account was made with.
  Verify a domain in Resend to send from it.
- `CALENDLY_URL` — the Calendly event the public booking page embeds
  (default `https://calendly.com/alonzo-ruffinjr/30min`)
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_UPLOAD_PRESET` — demo-video upload
  identifiers (defaults are the coach's existing account values)
- `SITE_URL` — the public address written into the page tags, sitemap and
  robots file (default `https://ruffin-performance.onrender.com`)
- `READ_ONLY_MODE` — set to `1` for a short pause during a move: sign-in and
  reading work, every change is refused and nothing is saved

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

## Sign-in protections

- **Limit on password guesses.** After 5 wrong passwords in a row for one
  email (within 15 minutes), sign-in for that email is paused for 15
  minutes, even with the right password. One address gets 30 wrong
  passwords across all emails in 15 minutes before it is paused the same
  way. A right password before the pause clears the count. Wrong current
  passwords on the change-password form count too. On Render the count is
  kept in memory (a restart clears it); on Vercel it is kept in the
  Upstash store so every copy of the app sees it. Only a keyed hash of the
  email or address names a counter; nothing goes into the saved data. See
  `lib/guess-limit.js`.
- **Sign out everywhere** (Account page). Ends every sign-in for the
  account on every device, this one too. Each account has a sign-in
  number inside its cookies; this raises it, so older cookies stop
  working. Cookies made before this feature count as number 0, so nobody
  was signed out by the change itself.
- **Change password** (Account page). Needs the current password; the new
  one needs 8 or more characters. It signs the account out on every other
  device and keeps this one signed in.

## Tests

```sh
node tests/run-tests.js            # the main suite (Render file mode)
node tests/store-tests.js          # hosted-store mode and the Vercel entry
node tests/run-tests-store-mode.js # the main suite again, in hosted-store mode
node tests/sign-in-protection-tests.js # guess limit, sign out everywhere, change password
npm test                           # all of the above
```

Starts the server on a throwaway port with a temporary `DATA_DIR`,
exercises the API end to end, and cleans up. The smaller files in
`tests/` (Stripe, notifications, access page, growth, membership card,
security headers) run the same way, one file at a time.
