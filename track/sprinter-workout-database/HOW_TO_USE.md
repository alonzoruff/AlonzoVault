# How to use this — in plain words

## What this folder is

A card catalog of sprint workouts. Every workout has a code (like ACC-03) and a card
that says what it is, how far, how hard, and how much rest. Nothing lives only in
somebody's head anymore — it is written down, searchable, and backed up on GitHub.

## The 9 workout types, in simple terms

- **ACC — first steps.** Getting out and up to speed. Starts, hills, sleds, T-APEX resisted runs.
- **MAX — top speed.** The fastest running there is. Short, full rest, stop when form slips.
- **SE — hold your speed.** Longer fast reps so speed does not fade at the end of the 100.
- **SPE — 200m strength.** The hard, fast, relaxed longer work that makes the last 50m of a 200 possible.
- **TEM — easy runs.** Slow, steady running at about 70%. These days are for recovery, not getting faster.
- **RM — practice the race.** Rehearsing pieces of the actual 100 or 200 at race speed.
- **STR — weights.** Lifting. Heavy days sit on the same days as fast sprinting.
- **PLY — jumps.** Hops, bounds, box work. Builds spring.
- **REC — rest.** Walking, mobility, easy movement. A real part of the plan, not a day off by accident.

## The one rule that runs everything

Hard days and easy days take turns. A hard day (fast sprinting, heavy lifting, hard jumps)
is always followed by an easy day. Two hard days in a row is how sprinters get hurt and slow.
That is the whole "high-low" idea, and the season plan is built on it.

## How to find a workout

Just ask Muse in plain words: "give me a top-speed workout for December" or
"low-effort day ideas." Muse searches the catalog for you.

If you ever want to search it yourself, open `sessions.csv` in any spreadsheet app,
or run the search tool, for example:

- `python3 search_sessions.py --quality max_velocity` — all top-speed workouts
- `python3 search_sessions.py --cns low` — all easy-day workouts
- `python3 search_sessions.py --text fly` — anything with "fly" in it

## How the season plan uses this

The season plan (`track/season-plan-2026-27/`) lays out 29 weeks. Each day just names a
code — the full workout lives here in the catalog. Plan says MAX-01 on Wednesday,
you look up MAX-01 here, and there is the whole session.

## Logging what you actually ran

`session_log.csv` is the diary. After a practice, tell Muse what you ran — the code,
any times, and how it felt — and it gets written into the log. Over a season this becomes
the most valuable file in the folder: what was planned vs what really happened, with times.
