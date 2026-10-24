# The 400m Framework — and how AJ's 100/200 plan grew out of it

This document does three things, and keeps them in separate buckets on purpose:

1. **From AJ's files** — what the 100/200 plan on disk actually took from Desmond Dunham's
   400m framework (quoted/traced from `track/build_100_200_plan.py` and this database),
   plus Dunham's own "400m Training" (USTFCCCA) slide deck, which AJ holds and
   re-supplied on Oct 23, 2026 — see the addendum at the end of Part 1.
2. **From published sources** — what can be verified about Dunham's coaching and about the
   classic Clyde Hart 400m model from public material, with links.
3. **The 400m extension** — the new QTR sessions in this database, and what changes when a
   group trains for the 400 itself instead of borrowing its base for the short sprints.

Nothing in bucket 2 is presented as Dunham's words unless it is in the linked source.
Bucket 1 is the authority for what AJ's plan uses; the plan file even carries the credit
line itself: *"Base framework credit: Desmond Dunham, 400m Training (USTFCCCA)."*

---

## Part 1 — From AJ's files: the Dunham DNA in the 100/200 plan

The plan generator (`build_100_200_plan.py`) states its source in the docstring and
subtitle: adapted from Desmond Dunham's 400m training framework (Woodrow Wilson SHS),
with the premise that **"the 400m is a controlled sprint built on a fitness base"** —
the 100/200 keeps the base and shifts the emphasis to acceleration, max velocity, and
short speed endurance.

Elements traceable to the 400m framework in the plan as written:

- **The five health-related components.** The plan keeps the 400m plan's five components
  verbatim as its foundation: muscular endurance, muscular strength, cardio-respiratory
  fitness, flexibility, and body composition. What changes is the stress profile.
- **A real fitness base, built first.** Phase 1 (Base / GPP, 4–6 weeks) is general
  preparation: work capacity, general strength, tempo, hills, low plyos — before any
  race-specific speed. The base sample workouts carried in the plan are classic
  400m-base material: 10 × 30–90 sec tempo runs, 6–8 × 2–3 min moderate runs,
  fartlek up to 30 min (1-1-2-2-2-2-1-1 pattern), and 6–12 × 400m fartlek reps mixing
  walk / jog / stride / sprint 100s (these live in the database as TEM-03 and TEM-04).
- **Long speed endurance — removed, and the removal is the adaptation.** The plan says
  explicitly: replace the 400m plan's 300s, 500s, and 600s with 80–150m repeats, split
  runs, and fly runs, keeping total high-quality work at 200–500m per session. So the
  original Dunham speed-endurance menu (long reps at 300–600m) is the thing that was
  cut — QTR-06 puts the 500s back for a true 400m group.
- **The speed-endurance ladder.** Phase 2's ladder is Dunham-style ascending anaerobic
  stress, shortened for the 200: 4–6 × 100m accelerations to 90% (SE-06), 8 × 200m fast
  and relaxed with 100m walk / 100m jog (SPE-02), 5–6 × 300m build-ups for 200m runners
  early in the phase (SPE-01). SPE-01 and SPE-02 are the most visibly 400m-derived rows
  in the whole database.
- **Broken runs as race simulation.** Phase 3's broken runs (200 fast / jog / 200 fast;
  300 + jog 100 + 100; 100 + jog 100 + 300; 150m simulations) are in the database as
  RM-03/RM-04, and QTR-10 extends the same family to the full broken 400.
- **The 400m predictor.** The plan's time-prediction note works backwards from the 400:
  average the athlete's 3–5 best 200m efforts, double it, add ~4 seconds for a 400m
  target. (Compare Hart's published version in Part 2: double the open 200 PB and add
  3.5 seconds. AJ's file uses ~4 — the high-school rounding of the same formula.)
- **Four-phase architecture and weekly rhythm.** Base (4–6 wk) → Pre-Competitive (4 wk)
  → Competitive (4–6 wk) → Championship (2–3 wk), each with a Mon–Sun session table,
  hard work separated by recovery days, weights paired with sprint days, pre-meet
  primers on Friday, racing Saturday. The season plan (2026-27) later re-expressed this
  as the Francis-style high-low week, but the skeleton — build, sharpen, race, peak —
  is the framework's.
- **The standard warm-up protocol** (Parts A/B/C, 20–25 min) and race execution models
  ship with the plan and are unchanged from framework-style teaching: every session
  starts the same way, and races are run to a segment model, not on feel.

What AJ's adaptation **added** (also in the files, so the credit stays straight):
acceleration and max velocity trained year-round and only when fresh; longer recoveries
(5–12 min) to protect top-end speed; curve running as a trained 200m skill; and the
season-plan layer on top (Charlie Francis high-low CNS spacing, 10-day tapers, Haugen
et al. ranges) documented in `track/season-plan-2026-27/README.md`.

### Addendum (Oct 23, 2026) — from Dunham's deck itself

AJ holds the actual source deck: **"400m Training," presented by Desmond Dunham
(USTFCCCA)**, Woodrow Wilson SHS, Washington DC (filed at `track/400m_Training_Dunham_USTFCCCA.pdf`).
The overnight research could not locate this deck in public sources; AJ's copy is the
document the plan's credit line refers to. Verified directly against the slides:

- **The five health-related components** are the deck's own foundation slide, in its
  order: muscular strength (marked secondary), muscular endurance, cardio-respiratory,
  flexibility, body composition. Base work on the slides matches Part 1 exactly
  (10 × 30–90s tempo, 6–8 × 2–3 min runs, fartlek patterns 1-1-2-2-2-2-1-1, 6–12 × 400m
  fartlek reps), plus hills 100–150m for endurance and 30–60m hill repeats for strength.
- **Lifting progression:** fall moderate 3–4 × 10–12; winter/early spring heavy
  3–4 × 6–8 with 1–3 rep max work. Flexibility rule: all dynamic before, all static after.
- **The deck's own season template** runs Nov–Jun in blocks with named sharpening and
  "Rest / Refreshing" cycles before indoor states (late Feb), outdoor states (mid May),
  and a June peaking block for nationals — the same double-peak rhythm AJ's 2026-27
  season plan uses.
- **Speed endurance is menu'd by anaerobic stress.** Low: 3–4 × 150 / 100 / 50 to 90%,
  8 × 200 fast and relaxed, 10 × 150 accelerations to 90%, 5–6 × 300 build-ups, 6–12 × 400
  fartlek. Moderate-high: 3–4 × 300 (5–8 min rest), 1 × 600 + 1 × 500 (20–30 min rest,
  very fast), 500-300-200 progressions. High: 300-200 at race pace with 1 min rest,
  1 × 500 or 1 × 600 full speed. So QTR-05 (600s) and QTR-06 (500s) are Dunham's own
  sessions, not just Hart-style borrowings — the sourcing in Part 3 is updated to match.
- **Speed samples:** ~200–500m of total work; flyin' 30–60m; dead starts 10–60m;
  downhill flyin' 30–60m; ins-and-outs; parachute and harness/sled power speed — the
  same 200–500m quality cap the 100/200 plan states.
- **The predictor, in his words' structure:** average the top 3–5 best 200s, double it,
  add ~4 seconds; the goal is a first 200 within 1–1.5 seconds of that average best.
- **"Find the race at practice":** broken 400s at race pace (200 fast / jog / 200 fast;
  300 fast / jog 100 / 100 fast; 100 fast / jog 100 / 300 fast) and 250m simulations —
  QTR-10's family, straight from the deck.
- **Race execution model:** drive phase → comfortable sprint (2nd effort) → relax,
  focus on technique, commit to the effort. Conclusion slide: the 400m is a controlled
  sprint, one of the toughest races in track and field, and novices get a trial-and-error
  period.

---

## Part 2 — From published sources

### Desmond Dunham (verified public record)

- Dunham coached at Eleanor Roosevelt HS (MD) and Woodrow Wilson SHS in Washington, DC
  (now Jackson-Reed), and at the University of Maryland; he was the 2019 NFHS Girls
  National Coach of the Year and the **2022 USTFCCCA National High School Girls Track &
  Field Coach of the Year** (with St. John's College HS). He is the author of *Running
  Against The Odds* and founder of Kids Elite Sports; his degree is in exercise
  physiology (Howard University).
  Sources: [DC Council ceremonial resolution (2023)](https://live-dc-council.pantheonsite.io/wp-content/uploads/2023/02/Ceremonial-Desmond-Dunham.pdf) ·
  [USTFCCCA 2022 National HS Coaches of the Year](https://www.ustfccca.org/2022/08/featured/2022-ustfccca-national-high-school-track-field-coaches-of-the-year) ·
  [MileSplit profile of the memoir](https://www.milesplit.com/articles/303449/running-against-the-odds-desmond-dunham-inspires-community)

- Correction (Oct 23, 2026): this research originally reported that no published Dunham
  "400m Training" text could be located. That was a research miss, now fixed: AJ holds
  Dunham's own **"400m Training" (USTFCCCA)** deck and re-supplied it — it is documented
  in the Part 1 addendum and is the primary Dunham source for this framework.
- The other published Dunham **training** document found in this research is
  his USTFCCCA 2015 symposium deck, *"800m Training & Race Tactics"* (Woodrow Wilson
  SHS). Note honestly: it is an 800m/4×800 deck, not a 400m plan. But its engine room is 400m-relevant,
  because Dunham builds the 800 from the 400 down:
  - His closing "Your Job" slide: understand the athlete as a person first; train the
    energy systems in a **"hard–easy" format** allowing proper recovery; develop pacing
    and race strategy; emphasize speed. That hard–easy alternation is the same rhythm
    AJ's plan and the season plan run on.
  - Training targets are named as adaptations: lactate removal (threshold), VO2max,
    **peak lactate tolerance**, running economy, and **top (400m) speed**.
  - Peak lactate tolerance, two ways: *short rest* — 3 × 3 × 300m with 30–45 sec rests
    to keep lactate elevated (now QTR-01); *long rest* — 2 × 400m / 2 × 300m / 2 × 200m
    with full recoveries to repeatedly spike peak lactate (now QTR-02).
  - Improving top 400m speed: creatine-phosphate work of 30–80m with full recovery, plus
    high-volume repeats of **10–15 × 100m at 400m speed** with near-full recovery
    (now QTR-03).
  - Competitive-phase weeks put CP/speed work inside the warm-up, keep tempo runs in
    the week, core work 5–6 days, lifting/circuits 2–3 days — a structure that mirrors
    AJ's Phase 2/3 tables closely.
  Source: [Dunham, USTFCCCA Symposium 2015 (PDF)](https://www.ustfccca.org/assets/symposiums/2015/Durham-Desmond-Symposium2015.pdf)

### Clyde Hart (Baylor) — the comparison model

AJ's season plan already borrows Hart's tempo discipline; his published 1996 clinic
notes are the canonical 400m text:

- **"The 400 meters is not a full sprint."** Success is pace *distribution*: the
  outstanding 400m runner's first 200m is ~1 second slower than their open 200m best;
  a less experienced runner should hold ~2 seconds in reserve (the differential now
  coached in QTR-11).
- **Predictor:** potential 400m = best open 200m × 2 + 3.5 sec.
- **Blend:** where convention said 90% anaerobic / 10% aerobic, Hart trained roughly
  60/40 anaerobic-to-aerobic — "you put money in the bank when you train; anaerobic is
  withdrawing money, aerobic is putting it back." That is the logic behind QTR-04
  (tempo endurance 200s) and QTR-05 (over-distance 600s) in this extension.
  Sources: [Hart, "Guide to 400 meter training," 1996 Super Clinic notes (RunBlogRun)](https://www.runblogrun.com/2023/04/clyde-harts-guide-to-400-meter-training-from-1996-super-clinic-notes-world-coaches-notes.html) ·
  [Sprintzone interview summary](https://www.tapatalk.com/groups/sprintzone/viewtopic.php?f=6&t=1026)

### Split runs (research note)

A peer-reviewed high-school 400m study (summarized at Forever Fit Science) supports the
split-run format added as QTR-07/QTR-08: special-endurance split runs of 320m and 480m
broken into 160m segments, each segment faster than 400m race pace (>95%, set from the
athlete's best 200m), 30 seconds between segments, performed **once per 10-day cycle**
and **never within 2 days of a meet** — the spacing rules are written into the session
cards themselves.
Source: [Building Faster 400m Athletes With Split Runs — Forever Fit Science](https://foreverfitscience.com/sprinting/building-faster-400m-athletes-with-split-runs/)

---

## Part 3 — The 400m extension: what a true 400m group adds

The 100/200 plan borrows the 400m base and cuts the long work. A group that actually
races the 400 puts the long work back — in this order:

| Need | Sessions | Where it comes from |
|---|---|---|
| Lactate tolerance (the last-100m problem) | QTR-01 (short rest), QTR-02 (long rest) | Dunham symposium deck |
| Repeated 400m-pace speed | QTR-03 (10–15 × 100m), QTR-12 (300s at pace) | Dunham deck / classic pace work |
| Aerobic bank for the finish | QTR-04 (tempo 200s) + existing TEM rows | Hart model |
| Over-distance strength | QTR-05 (600s), QTR-06 (500s) | Dunham 400m deck (verified Oct 23) — the originals AJ cut |
| Split-run race-pace grit | QTR-08 (320) → QTR-07 (480) | Split-run research |
| Race distribution & modeling | QTR-11 (differential 200s), QTR-09 (350 event run), QTR-10 (broken 400) | Hart differential / AJ broken-run family |

**A 400m group's week (competitive phase), built from this database:**

- **Mon (high):** ACC-03 or MAX-01 + QTR-11 — speed and distribution while fresh
- **Tue (low):** QTR-04 tempo 200s + STR-01 circuit
- **Wed (high):** the week's one big special-endurance dose — QTR-06, QTR-07, or QTR-01
  (rotate; QTR-01 and QTR-07 at most once per 10-day cycle)
- **Thu (low):** REC-01 or TEM-01
- **Fri (high, short):** QTR-09 event run or QTR-10 broken 400 — or RM-05 primer if racing
- **Sat:** race (the 400 and the 4×400 — the relay is a training stimulus in this system,
  exactly as it was in Dunham's Wilson/Roosevelt programs)

Rules that carry over unchanged from the 100/200 system: high days never touch; the
stop rule (3% off standard or broken mechanics ends the high session); lactate sessions
are the first thing cut in a two-meet week, never the speed work; and a 400m runner
still trains acceleration and max velocity — the 400 is lost in the last 100m but it is
*won* by the speed reserve built in the first 200.

---

*Sessions QTR-01 – QTR-12 were added to `sessions.csv` / `sessions.json` with this
document. Sources for each session are in its `source` field. Frameworks are credited;
all session descriptions are original wording, per this database's rules.*
