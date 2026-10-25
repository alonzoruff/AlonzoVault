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
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_UPLOAD_PRESET` — demo-video upload
  identifiers (defaults are the coach's existing account values)

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
