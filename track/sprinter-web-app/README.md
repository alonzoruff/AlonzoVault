# Sprinter Workout App — the real web app version

St. John's College High School — Cadets Track & Field.

This is the standalone version of the Sprinter Workout App. It is a normal
website: anybody can open it at its web address, look through the workout
library and the season plan, create their own free account, and save their
own practice log and cross-training swaps. No Muse account needed, nothing
to install. On a phone it can be added to the home screen and it behaves
like an app.

You own this. The code lives in your GitHub (AlonzoVault), and the site
will live under your hosting account, in your name.

## What's inside

- **49 workouts** — the full sprint library, including the 12 QTR 400m
  sessions, 3 warm-up routines (WUP), and 5 cross-training days (XT).
- **16 warm-up drills**, the **29-week season plan** (mini peak Feb 20,
  2027 · major peak May 15, 2027), the **400m Training** section, and the
  plain-English guide.
- **Accounts**: each coach registers with an email and password. Passwords
  are scrambled with a strong one-way hash (scrypt) — the real password is
  never stored. Each person sees only their own log and swaps.
- **Saved per person**: practice log entries, and easy-day cross-training
  swaps on the season plan. Hard-day spacing (the 48-hour rule) is checked
  automatically on every week.

## Run it on your own computer (to look at it)

You need Node.js (version 18 or newer — it's a free download from
nodejs.org). Then, in this folder:

```
npm start
```

Open http://localhost:3000 in your browser. That's the whole thing —
there is nothing to install first, because the app uses zero outside
packages. Stop it with Ctrl+C.

The first account you register can be yours — there is no special admin
account; every account works the same way.

## Put it on the internet (deploy)

You only do this once. The recommended path is **Render** (free tier),
because it runs Node apps straight from GitHub:

1. Push this folder to AlonzoVault on GitHub (Muse can do this push
   with you).
2. Make a free account at render.com and sign in with GitHub.
3. Click **New → Web Service**, pick the AlonzoVault repository.
4. Set the **Root Directory** to `track/sprinter-web-app`.
5. Set the **Build Command** to `echo ok` (there is no build step) and
   the **Start Command** to `npm start`.
6. Under **Environment**, add `SESSION_SECRET` and set it to any long
   random string you make up (this is what keeps logins secure — do not
   reuse it anywhere else). Render sets `PORT` for you automatically.
7. Click **Create Web Service**. Render gives you a web address like
   `sprinter-workout-app.onrender.com`. That is the link you share.

Two honest notes about free tiers: the site may sleep after inactivity
and take ~30 seconds to wake on the first visit, and accounts/logs are
stored in a data file on the server's disk — on Render's free tier that
disk can be wiped when the service restarts, which would erase accounts.
If this becomes the team's real home, the fix is Render's paid disk
(a few dollars a month) or moving to a host with a permanent disk.

**Other places it can live** (same code, no changes): Railway, Fly.io,
or any small VPS (a $5/month server) — anywhere Node runs, `npm start`
is the whole recipe. On a VPS, also set `DATA_DIR` to a folder that gets
backed up.

## Settings (environment variables)

| Name | What it does | Default |
|---|---|---|
| `PORT` | Which port the site listens on. Hosts set this for you. | `3000` |
| `DATA_DIR` | Folder where accounts, logs, and swaps are stored. | `./data` (inside the app folder) |
| `SESSION_SECRET` | Secret that signs login cookies. Set a long random one when you deploy. If you skip it, the app makes one up and keeps it in the data folder. | auto-generated |

## The files, in plain words

- `server.js` — the whole engine: serves the pages, runs the accounts,
  saves the data. One file, no outside packages.
- `public/` — what people see: the pages, styling, and app logic, plus
  the official SJC logo in `public/assets/`.
- `content/` — the workouts, drills, season plan, and written guides,
  copied in so the app stands on its own.
- `scripts/build-content.py` — refreshes `content/` from the workout
  database and season plan folders after you edit them. Run it, then
  commit the updated `content/` files.
- `data/` — created the first time the app runs. Holds accounts, logs,
  and swaps. It is **never** committed to GitHub (it's in `.gitignore`)
  because it's private and it belongs to the live server.

## One known gap

The app icon uses the school's official logo as an SVG file (in
`public/assets/sjc-logo-header.svg`, referenced by the web app manifest).
Some phones prefer a PNG icon; if the home-screen icon ever looks off,
a 192×192 and 512×512 PNG can be exported from that same logo file and
dropped into `public/assets/` later — no other changes needed.
