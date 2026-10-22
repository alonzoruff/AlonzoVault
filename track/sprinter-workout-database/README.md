# Sprinter Workout Database

A searchable library of sprint **sessions** — not lifts. Built for AJ's Cadets sprint group, seeded from his 100m/200m plan (adapted from Desmond Dunham's 400m framework) and the sprint-training ranges in Haugen et al., *The Training and Development of Elite Sprint Performance* (Sports Medicine – Open, 2019).

## Why this exists

Weight-room platforms (TeamBuildr, TrainHeroic, Athlete Analyzer) catalog exercises. Sprinter apps (Athlevate, Metric) log and test. Coaching systems (Feed the Cats, Complete Track and Field) sell courses. Nothing lets a coach search: *max velocity, pre-competitive phase, low volume, full recovery* — and get the session. This does.

## How a session is described (the schema)

Every session in `sessions.csv` / `sessions.json` carries:

| Field | Meaning |
|---|---|
| `id` | Stable short ID, e.g. `ACC-01` (quality prefix + number) |
| `name` | Coach-readable session name |
| `quality` | acceleration / max_velocity / speed_endurance / special_endurance / tempo / strength / plyometric / race_modeling / recovery |
| `phase` | base / pre_competitive / competitive / championship / any |
| `level` | beginner / intermediate / advanced / all |
| `reps` | Rep scheme as written, e.g. `4-6` |
| `rep_distance_m` | Distance of one rep (or the fly/run segment), metres |
| `intensity_pct` | Target intensity, % of max velocity (or % effort for tempo) |
| `rest` | Recovery between reps, as written |
| `total_volume_m` | Total high-quality metres in the main set (approximate where a range is given) |
| `surface` | track / grass / hill / any |
| `footwear` | spikes / trainers / either |
| `equipment` | blocks, sled, harness, hurdles, none |
| `cns_demand` | high / low — high = needs freshness, protects the next 48h |
| `min_hours_before_next_high` | 0, 24, 48, or 72 |
| `coaching_cues` | The 1–3 cues that make the session work |
| `source` | Where the session comes from (AJ plan phase, or literature range) |

Drills (warm-up and technical) live in `drills.csv` with: `id, name, category, distance_or_reps, coaching_cue, source`.

## Searching it

```
python3 search_sessions.py --quality max_velocity
python3 search_sessions.py --quality acceleration --phase base
python3 search_sessions.py --cns low
python3 search_sessions.py --text fly
```

## Reference ranges (Haugen et al. 2019, Table 2)

- Acceleration: 10–50m, >98%, 2–7 min rest, 100–300m total, 48h before next high session, spikes on track
- Maximal velocity: 10–30m (flying start excluded), >98%, 4–15 min rest, 50–150m total, 48–72h
- Sprint-specific endurance: 80–150m, >95%, 8–30 min rest, 300–900m total, 48–72h
- Speed endurance: 60–80m, 90–95%, 2–4 (8–15 between sets) min rest, 600–2000m total, 48–72h
- Resisted sprints: 10–30m, 80–95%, 3–6 min rest, 50–200m total, 48h
- Tempo: 100–300m, 60–70%, 1–3 min rest, 1000–2000m total, 24h, trainers on grass

Feed the Cats' simpler taxonomy (speed / x-factor / lactate / off) maps onto `quality` + `cns_demand`: speed = high-CNS quality work, off/tempo = low.

## Roadmap

1. **v0 (this):** schema + 18 seed sessions + 16 drills, CSV/JSON, command-line search.
2. **v1:** AJ's own sessions as he runs them at St. John's — every real practice logged back into the database with what actually happened.
3. **v2:** Week builder — pick a phase and a quality per day, get a full week that respects CNS spacing automatically.
4. **v3:** Search app (same pattern as the CSCS Practice Quiz) + weight-room side seeded from free-exercise-db (800+ exercises, public domain).

## Rules

- Original session descriptions only. Frameworks and ranges are credited; no copying course material word-for-word.
- No athlete personal data in this database — sessions only.
