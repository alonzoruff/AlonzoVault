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
- **Accounts are for coaches only.** Athletes never log in and never enter
  data — the coach records everything. The first account registered becomes
  the coach account; a coach can promote other accounts from the Account
  page. Passwords are scrambled with a strong one-way hash (scrypt) — the
  real password is never stored. Any non-coach account gets a firm "no" from
  every team-data screen.
- **Saved per coach account**: your own practice log entries, and easy-day
  cross-training swaps on the season plan. Hard-day spacing (the 48-hour
  rule) is checked automatically on every week.

## The coach system

Everything below lives behind a coach login and hangs off **athlete
profiles** — roster entries you manage (name, training group, event tags
like sprinter / jumper / hurdler, and a Top Athlete star). No athlete
accounts, no athlete typing.

- **Groups & roster**: create training groups, add athletes one at a time,
  or use the **bulk roster import** in the Groups view — paste lines like
  `Last, First | Group | sprinter, hurdler | yes` (or a CSV with a
  `name,group,events,top` header) and the app creates the groups and
  profiles in one go. It reports what it created, what it skipped as a
  duplicate, and any line it could not read — one bad line never blocks
  the rest. Re-importing the same list creates no duplicates. Filter the
  roster by group, event, or Top Athletes; archive athletes who leave
  (their records stay saved).
- **Assignments & the daily checklist**: every group automatically gets
  the season plan's workout for each day — zero setup. In the Coach view
  you can override any group's workout for any date (with a short note),
  then check off who completed it, with optional marks and a 1–5 "how it
  felt" per athlete. Completions land on the athlete's profile record.
- **Testing**: build test days (for example "Fall Weight Room Testing")
  from the preloaded battery — back squat, trap bar deadlift, bench press,
  hang clean, power clean, vertical jump, broad jump, pull-ups — or add
  your own tests. Enter results walking the roster with your phone: lifts
  can go in as a top single or as weight × reps, and the app stores an
  estimated 1RM (Epley formula) next to the raw lift. You get a live
  progress grid, a ranked table per test, and each athlete's history with
  personal bests flagged.
- **Top Athletes weekly tracker**: starred athletes get weekly numbers —
  fly 30m time, vertical jump, broad jump, estimated 1RMs for squat, hang
  clean and bench, body weight (plus any metric you add). One value per
  athlete per week (weeks start on Mondays); saving again overwrites.
  Graphs are drawn right in the app: one chart per athlete per metric with
  their best marked and the change since their first week colored by
  whether lower or higher is better, plus an overlay chart that puts
  every Top Athlete's line for a metric on one graph.
- **Aches & pains**: when an athlete tells you something hurts, you file
  it under their profile — body area, side, what it feels like, pain 1–10,
  when it started, whether it changed or stopped their training, and a
  note. High pain (7+) and "stopped me" concerns float to the top until
  you work them through New → Monitoring → Cleared, with room for a coach
  note ("sent to athletic trainer"). It is a private coach notebook;
  athletes never see it.
- **Demo videos**: any drill or test can carry a demo — paste a YouTube
  link (or a .gif link) onto the movement and a Demo button appears;
  tapping it plays the video in the app without loading anything heavy
  until you tap. Handy mid-test-day: two taps and the athlete sees the
  lift done right.
- **Warm-Up Cards & Nutrition**: the three printable warm-up cards (Light,
  Speed Day, Circuit Day) live in their own section, each with a print
  button that prints just that card on one Letter page, ready to laminate.
  The Nutrition section is six plain-language fueling cards for high
  school sprinters — the everyday plate (fuel follows the training day),
  the pre-practice timing ladder, recovery fueling, hydration, a meet-day
  timeline, and weight-room day fueling — plus an honest note on
  supplements: food first, and no supplement pushing for school athletes.

## Run it on your own computer (to look at it)

You need Node.js (version 18 or newer — it's a free download from
nodejs.org). Then, in this folder:

```
npm start
```

Open http://localhost:3000 in your browser. That's the whole thing —
there is nothing to install first, because the app uses zero outside
packages. Stop it with Ctrl+C.

Register the first account with your own email — that account is the
coach account and unlocks the whole coach system described below.

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
