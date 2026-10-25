#!/usr/bin/env python3
"""Refresh the app's bundled content from the vault's source files.

Run this after editing the workout database or the season plan, then
commit the updated files in content/. The app itself never reads the
vault folders at runtime — it only reads its own content/ copies, so
the app stays self-contained and deployable anywhere.

Usage:  python3 scripts/build-content.py
"""
import csv
import json
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
VAULT_TRACK = os.path.dirname(APP)
DB = os.path.join(VAULT_TRACK, "sprinter-workout-database")
PLAN = os.path.join(VAULT_TRACK, "season-plan-2026-27")
OUT = os.path.join(APP, "content")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------------
# Instagram-mined workouts -> library sessions IG-01..IG-08.
# The mined source of truth is sprinter-workout-database/
# instagram_workouts.json (workouts AJ saved on Instagram, mined with
# every number exactly as the source post stated it). The transform
# below maps each workout onto the flat session schema: the spec
# fields summarize ONLY what the post stated, the full block/exercise
# structure ships as `structure` (rendered on the session detail) and
# as runner `blocks` in the runner's native plan shape, so an IG
# session launches in the runner like any library session. Where the
# post stated no sets/reps, the session says so — nothing is invented.
# ---------------------------------------------------------------------
def _ig_seconds(text):
    """'40 sec' -> 40, '2 min' -> 120, anything else -> 0."""
    if not text:
        return 0
    t = str(text).lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*min", t)
    if m:
        return int(float(m.group(1)) * 60)
    m = re.search(r"(\d+(?:\.\d+)?)\s*sec", t)
    if m:
        return int(float(m.group(1)))
    return 0


def _ig_ex_reps(ex, blk):
    """Runner reps text for one mined exercise: the stated reps (or
    the block's per-exercise reps), with the stated detail appended.
    Falls back to the pairing label (A1/A2) when nothing else exists."""
    parts = []
    if ex.get("reps") is not None:
        parts.append(str(ex["reps"]))
    elif blk.get("repsPerExercise") is not None:
        parts.append(str(blk["repsPerExercise"]))
    if ex.get("detail"):
        parts.append(str(ex["detail"]))
    if not parts and ex.get("label"):
        parts.append(str(ex["label"]))
    return " · ".join(parts)


def _ig_ex_line(ex, blk):
    """One faithful structure line for the session detail:
    'A1: Pin Front Squat Partial', 'Cable Rope Pushdown — 4 × 10
    (2 sec pause)', 'Rotating Hip Crossovers — 10 per side'."""
    line = ""
    if ex.get("label"):
        line += str(ex["label"]) + ": "
    line += str(ex["name"])
    rx = ""
    if ex.get("sets") is not None and ex.get("reps") is not None:
        rx = "%s × %s" % (ex["sets"], ex["reps"])
    elif ex.get("reps") is not None:
        rx = str(ex["reps"])
    elif blk.get("repsPerExercise") is not None:
        rx = "%s reps each" % blk["repsPerExercise"]
    if rx:
        line += " — " + rx
    if ex.get("detail"):
        line += " (%s)" % ex["detail"]
    return line


def _ig_block_meta(blk):
    """Block-level facts the post stated, for the detail view:
    rounds, per-exercise reps, and the rests, exactly as stated."""
    bits = []
    if blk.get("rounds") is not None:
        bits.append("%s rounds" % blk["rounds"])
    if blk.get("repsPerExercise") is not None:
        bits.append("%s reps per exercise" % blk["repsPerExercise"])
    if blk.get("restBetweenExercises"):
        bits.append("%s between exercises" % blk["restBetweenExercises"])
    if blk.get("restBetweenRounds"):
        bits.append("%s between rounds" % blk["restBetweenRounds"])
    if blk.get("rest"):
        bits.append("rest %s" % blk["rest"])
    return " · ".join(bits)


def _ig_runner_blocks(structure):
    """Map mined blocks onto runner blocks ({rounds,
    restBetweenRounds, restAfterBlock, exercises:[{name, reps}]}):
    - a block with stated rounds keeps them (circuit style);
    - exercises with stated sets become rounds — one shared set
      count stays one block, differing counts split into one block
      per exercise so every set is walked;
    - anything else is a single pass through the exercises.
    Rests are 0 unless the post stated them (the between-exercise
    rest of a circuit has no runner equivalent and stays detail-only).
    """
    blocks = []
    for blk in structure:
        exs = blk.get("exercises", [])
        block_rest = _ig_seconds(blk.get("rest"))
        if blk.get("rounds"):
            blocks.append({
                "rounds": int(blk["rounds"]),
                "restBetweenRounds": _ig_seconds(blk.get("restBetweenRounds")),
                "restAfterBlock": 0,
                "exercises": [{"name": e["name"], "reps": _ig_ex_reps(e, blk)} for e in exs],
            })
        elif exs and all(isinstance(e.get("sets"), int) for e in exs):
            counts = {e["sets"] for e in exs}
            if len(counts) == 1:
                blocks.append({
                    "rounds": exs[0]["sets"],
                    "restBetweenRounds": block_rest,
                    "restAfterBlock": block_rest,
                    "exercises": [{"name": e["name"], "reps": _ig_ex_reps(e, blk)} for e in exs],
                })
            else:
                for e in exs:
                    blocks.append({
                        "rounds": e["sets"],
                        "restBetweenRounds": block_rest,
                        "restAfterBlock": block_rest,
                        "exercises": [{"name": e["name"], "reps": _ig_ex_reps(e, blk)}],
                    })
        else:
            blocks.append({
                "rounds": 1,
                "restBetweenRounds": 0,
                "restAfterBlock": 0,
                "exercises": [{"name": e["name"], "reps": _ig_ex_reps(e, blk)} for e in exs],
            })
    return blocks


# Per-workout spec fields, keyed by IG id (staging order). Only facts
# the post stated; everything else takes the neutral default below.
IG_SPEC = {
    "IG-01": {  # Pro Athlete Pre-Lift Warm-Up (5 Movements) — @joeybergles
        "quality": "warm_up",
        "reps": "5 movements in sequence (no sets or reps stated)",
    },
    "IG-02": {  # High Day: Max Velocity, Plyos and Fly 10s — @mattgebert1
        "quality": "max_velocity", "cns_demand": "high", "min_hours_before_next_high": 48,
        "surface": "track",
        "reps": "Max velocity sprints (stop at 10% velocity decrement), plyometrics, "
                "S-curve runs, fly 10s (20 yd build-in), lower body lift "
                "(contents not specified in the post)",
    },
    "IG-03": {  # 5 Contrast Training Variations for Power — @overtimeathletes
        "quality": "plyometric",
        "reps": "5 variations, 2 movements each (sets and reps not stated)",
    },
    "IG-04": {  # Power Potentiation Pairing — @joeybergles
        "quality": "strength",
        "reps": "A1 pin front squat partial + A2 consecutive broad jumps, "
                "3 hops in a row (sets and reps not stated)",
    },
    "IG-05": {  # Quick First Step Routine, Part 1 — @basedfasho
        "quality": "acceleration",
        "equipment": "bands, barbell, hurdles, medicine ball",
        "reps": "6 movements in the order shown (sets and reps not stated)",
    },
    "IG-06": {  # 10-Minute Hip Mobility Routine — @apexmandan
        "quality": "recovery",
        "equipment": "lacrosse ball",
        "reps": "Rotating hip crossovers 10/side, couch stretch 1 min/leg, "
                "lacrosse ball rollout 1 min/foot, T-spine rotations 10/side, "
                "figure-4 stretch 1 min/leg",
    },
    "IG-07": {  # Tricep Blast (Cable Workout) — @marvinachi
        "quality": "strength",
        "equipment": "cable machine",
        "rest": "40 sec",
        "reps": "Rope pushdown 4 × 10, kickback 3 × 15/arm, pushdown 4 × 10, "
                "single-arm pull 4 × 12/arm, reverse single-arm pull 4 × 12/arm",
    },
    "IG-08": {  # Home Abs Workout (No Equipment) — @ryanspiteri
        "quality": "cross_training",
        "equipment": "none",
        "surface": "any",
        "rest": "60 sec between exercises, 2 min between rounds",
        "reps": "4 rounds × 15 reps per exercise (5 exercises)",
    },
}


def instagram_sessions():
    src = os.path.join(DB, "instagram_workouts.json")
    if not os.path.exists(src):
        print("instagram workouts: WARNING — mined source missing, sessions ship without the IG workouts")
        return []
    mined = json.load(open(src))
    out = []
    for i, w in enumerate(mined):
        sid = "IG-%02d" % (i + 1)
        spec = IG_SPEC.get(sid, {})
        structure = []
        for blk in w.get("structure", []):
            entry = {"block": blk.get("block", ""), "lines": [_ig_ex_line(e, blk) for e in blk.get("exercises", [])]}
            meta = _ig_block_meta(blk)
            if meta:
                entry["meta"] = meta
            structure.append(entry)
        session = {
            "id": sid,
            "name": w["title"],
            "quality": spec.get("quality", "cross_training"),
            "phase": "any",
            "level": "all",
            "reps": spec.get("reps", ""),
            "rep_distance_m": 0,
            "intensity_pct": 0,
            "rest": spec.get("rest", "Not stated in the post"),
            "total_volume_m": 0,
            "surface": spec.get("surface", ""),
            "footwear": spec.get("footwear", ""),
            "equipment": spec.get("equipment", ""),
            "cns_demand": spec.get("cns_demand", "low"),
            "min_hours_before_next_high": spec.get("min_hours_before_next_high", 0),
            "coaching_cues": w.get("intent", ""),
            "source": "Instagram — @%s (saved post)" % w.get("sourceUsername", ""),
            "source_url": w.get("sourceUrl", ""),
            "source_username": w.get("sourceUsername", ""),
            "structure": structure,
            "blocks": _ig_runner_blocks(w.get("structure", [])),
        }
        out.append(session)
    return out


# sessions.json -> bare list in content/, with the Instagram-mined
# workouts appended as IG-01..IG-08 (the 49 library sessions first,
# untouched and in order).
d = json.load(open(os.path.join(DB, "sessions.json")))
rows = d if isinstance(d, list) else d.get("sessions", [])
ig = instagram_sessions()
json.dump(rows + ig, open(os.path.join(OUT, "sessions.json"), "w"), indent=1)
print("sessions:", len(rows), "library +", len(ig), "instagram =", len(rows) + len(ig))

# drills.csv -> drills.json
with open(os.path.join(DB, "drills.csv"), newline="") as f:
    drills = list(csv.DictReader(f))
json.dump(drills, open(os.path.join(OUT, "drills.json"), "w"), indent=1)
print("drills:", len(drills))

# weeks.csv -> weeks.json
with open(os.path.join(PLAN, "weeks.csv"), newline="") as f:
    weeks = list(csv.DictReader(f))
for w in weeks:
    w["week"] = int(w["week"])
json.dump(weeks, open(os.path.join(OUT, "weeks.json"), "w"), indent=1)
print("weeks:", len(weeks))

# markdown docs ship as-is
shutil.copy(os.path.join(DB, "DUNHAM_400M_FRAMEWORK.md"), os.path.join(OUT, "framework400.md"))
shutil.copy(os.path.join(DB, "HOW_TO_USE.md"), os.path.join(OUT, "guide.md"))
shutil.copy(os.path.join(PLAN, "README.md"), os.path.join(OUT, "season.md"))
print("markdown copied")

# Movement demo media: the SOURCE OF TRUTH is the vault database copy
# (track/sprinter-workout-database/movement_media.json), never the file
# in content/. Copy it in like everything else — and if the source is
# ever missing, PRESERVE the bundled copy instead of dropping it. The
# 24 demo videos in this file were researched and verified one by one;
# a content refresh must never wipe them out.
media_src = os.path.join(DB, "movement_media.json")
media_out = os.path.join(OUT, "movement_media.json")
if os.path.exists(media_src):
    shutil.copy(media_src, media_out)
    print("movement media:", len(json.load(open(media_out))), "entries (from source of truth)")
elif os.path.exists(media_out):
    print("movement media: WARNING — source of truth missing, kept existing bundled copy with",
          len(json.load(open(media_out))), "entries")
else:
    print("movement media: none found (the app runs fine without it)")

# Video library: same deal as the movement media above. The SOURCE OF
# TRUTH is the vault database copy
# (track/sprinter-workout-database/video_library.json) — 100 demo
# videos for the Videos section, researched and verified one by one.
# If the source is ever missing, PRESERVE the bundled copy; a content
# refresh must never wipe the library out.
lib_src = os.path.join(DB, "video_library.json")
lib_out = os.path.join(OUT, "video_library.json")
if os.path.exists(lib_src):
    shutil.copy(lib_src, lib_out)
    print("video library:", len(json.load(open(lib_out))), "entries (from source of truth)")
elif os.path.exists(lib_out):
    print("video library: WARNING — source of truth missing, kept existing bundled copy with",
          len(json.load(open(lib_out))), "entries")
else:
    print("video library: none found (the app runs fine without it)")

# Glossary (Definitions tab): same source-of-truth pattern again. The
# vault database copy (track/sprinter-workout-database/glossary.json)
# is the one to edit — 138 plain-language definitions written for this
# program. If the source is ever missing, PRESERVE the bundled copy;
# a content refresh must never wipe the glossary out.
gloss_src = os.path.join(DB, "glossary.json")
gloss_out = os.path.join(OUT, "glossary.json")
if os.path.exists(gloss_src):
    shutil.copy(gloss_src, gloss_out)
    print("glossary:", len(json.load(open(gloss_out))), "entries (from source of truth)")
elif os.path.exists(gloss_out):
    print("glossary: WARNING — source of truth missing, kept existing bundled copy with",
          len(json.load(open(gloss_out))), "entries")
else:
    print("glossary: none found (the app runs fine without it)")

# Coach education (Coach Education tab): same source-of-truth pattern
# again. The vault database copy
# (track/sprinter-workout-database/coach_education.json) is the one to
# edit — 23 researched trainings (local DC metro, national, online).
# If the source is ever missing, PRESERVE the bundled copy; a content
# refresh must never wipe the list out.
edu_src = os.path.join(DB, "coach_education.json")
edu_out = os.path.join(OUT, "coach_education.json")
if os.path.exists(edu_src):
    shutil.copy(edu_src, edu_out)
    print("coach education:", len(json.load(open(edu_out))), "entries (from source of truth)")
elif os.path.exists(edu_out):
    print("coach education: WARNING — source of truth missing, kept existing bundled copy with",
          len(json.load(open(edu_out))), "entries")
else:
    print("coach education: none found (the app runs fine without it)")

# Instagram-mined exercise library (Exercise Library tab): same
# source-of-truth pattern again. The vault database copy
# (track/sprinter-workout-database/instagram_movements.json) is the
# one to edit — 85 movements mined from AJ's saved Instagram training
# posts, each with what it trains, its equipment, coaching cues, and
# its source post. If the source is ever missing, PRESERVE the
# bundled copy; a content refresh must never wipe the library out.
igm_src = os.path.join(DB, "instagram_movements.json")
igm_out = os.path.join(OUT, "instagram_movements.json")
if os.path.exists(igm_src):
    shutil.copy(igm_src, igm_out)
    print("instagram movements:", len(json.load(open(igm_out))), "entries (from source of truth)")
elif os.path.exists(igm_out):
    print("instagram movements: WARNING — source of truth missing, kept existing bundled copy with",
          len(json.load(open(igm_out))), "entries")
else:
    print("instagram movements: none found (the app runs fine without it)")
