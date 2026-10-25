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
# its source post. The shipped copy is NOT a verbatim copy: the
# builder derives the Exercise Library's depth fields from the mined
# facts — exactly one `category` per movement (the explicit mapping
# below), `trainsTags` (muscle/focus tags keyword-derived from the
# trains text) and `equipmentTags` (the equipment text split and
# normalized through the segment map below). The mined fields ship
# untouched; the derived fields are added, never renamed or removed.
# The build FAILS LOUDLY (exit 1) when a movement has no category
# mapping, a mapping names a movement that is not in the source, a
# category value is outside the fixed set, an equipment segment is
# unmapped, or a movement ends up with no tags — a new mined movement
# must be categorized and mapped here before it can ship.
# If the source is ever missing, PRESERVE the bundled copy; a
# content refresh must never wipe the library out.

# The fixed category set, in display order. Finalized from what the
# 85 mined movements actually contain: a large isometric cluster
# earns its own category, and the only conditioning-flavored pieces
# are the sprint drills, which live in Sprint Mechanics.
EXERCISE_CATEGORIES = [
    "Sprint Mechanics", "Plyometrics", "Olympic Lifts", "Strength",
    "Isometrics", "Core", "Mobility",
]

# Exactly one category per movement, keyed by the movement's exact
# name in the source. This table is the editorial decision; the
# keyword rules below only derive tags, never categories.
EXERCISE_CATEGORY_BY_NAME = {
    # Sprint Mechanics — drills, starts and sprints (6)
    "Wall Drill (Acceleration Wall Series)": "Sprint Mechanics",
    "Kneeling Start Sprint": "Sprint Mechanics",
    "Band-Resisted Acceleration March (Low Position)": "Sprint Mechanics",
    "Agility Ladder Footwork": "Sprint Mechanics",
    "Flying 10-Yard Sprint": "Sprint Mechanics",
    "Block Start": "Sprint Mechanics",
    # Plyometrics — jumps, hops and reactive/elastic work (16)
    "Step Box Jump": "Plyometrics",
    "Single-Leg Ball-Drop Plyometric on 45-Degree Hyperextension Bench": "Plyometrics",
    "Kneeling Medicine Ball Catch": "Plyometrics",
    "Banded Quick Step-Up": "Plyometrics",
    "Hurdle Hops": "Plyometrics",
    "Box Jump": "Plyometrics",
    "Vertical Jump + Single-Leg Broad Jump": "Plyometrics",
    "Broad Jump + Pogo Hop": "Plyometrics",
    "Consecutive Single-Leg Broad Jump with Bounce": "Plyometrics",
    "Split Stance Pogo Hops": "Plyometrics",
    "Lateral Box Jump": "Plyometrics",
    "Hurdle Slalom Hops": "Plyometrics",
    "Skater Tuck Jump": "Plyometrics",
    "Rapid Plate Hops": "Plyometrics",
    "Hurdle Skater Hop": "Plyometrics",
    "Platform Drop Reactive Landing": "Plyometrics",
    # Olympic Lifts (2)
    "Clean (Teaching Progression)": "Olympic Lifts",
    "Single-Leg Clean": "Olympic Lifts",
    # Strength — loaded, eccentric and single-leg strength work (24)
    "Single-Leg Eccentric Hamstring Curl": "Strength",
    "Single-Leg Eccentric Calf Raise": "Strength",
    "Nordic Hamstring Curl": "Strength",
    "Cable-Resisted Eccentric Leg Extension in High Hip Flexion": "Strength",
    "Straight Leg Bridge": "Strength",
    "Rear Foot Elevated Split Squat (Eccentric Overload)": "Strength",
    "Supine Feet-Elevated Banded Hip Flexion": "Strength",
    "Banded Glute Bridge": "Strength",
    "Band Lying Hamstring Curl": "Strength",
    "Glute Bridge": "Strength",
    "Band Seated Hamstring Curl": "Strength",
    "Cable Knee Drive": "Strength",
    "Hip Flexor Crunch": "Strength",
    "Banded Hip Flexor In-and-Out": "Strength",
    "ATG Split Squat": "Strength",
    "Slider Hip Flexion": "Strength",
    "Banded Explosive Lunge": "Strength",
    "Barbell Step-Up": "Strength",
    "Barbell Split Squat": "Strength",
    "Band-Assisted Pull-Up": "Strength",
    "Single-Leg Dumbbell Romanian Deadlift": "Strength",
    "Single-Leg Raise": "Strength",
    "Single-Leg Bridge": "Strength",
    "Explosive Step-Up": "Strength",
    # Isometrics — the isometric cluster (8)
    "Long-Duration Isometric Lunge": "Isometrics",
    "Trap Bar Isometric Hold": "Isometrics",
    "Hip Flexion Overcoming Isometric into Pad (3-Bucket Position)": "Isometrics",
    "Yielding Isometric Hold": "Isometrics",
    "Overcoming Isometric": "Isometrics",
    "Ballistic Pulse Isometric": "Isometrics",
    "Ballistic Catch Isometric": "Isometrics",
    "Oscillating Isometric": "Isometrics",
    # Core — trunk stability and control (10)
    "Copenhagen Plank Hold": "Core",
    "Medicine Ball Slam": "Core",
    "Suitcase March on Foam": "Core",
    "Anti-Rotation Back Pedal": "Core",
    "Plank Press-Up": "Core",
    "Plank Bird Dog": "Core",
    "Hyperextension with Reach": "Core",
    "Plank Walkout": "Core",
    "Stir the Pot": "Core",
    "Stability Ball Mountain Climber": "Core",
    # Mobility — stretches, CARs and positional mobility (19)
    "Butterfly PAILs/RAILs": "Mobility",
    "ELDOA L5-S1": "Mobility",
    "Acupuncture Mat Standing": "Mobility",
    "Prone Shoulder Abduction with Internal Rotation": "Mobility",
    "Psoas Fascial Stretch": "Mobility",
    "Banded Hip Flexor Stretch": "Mobility",
    "Kneeling Hip Hinge": "Mobility",
    "Side-Lying Hip Stretch": "Mobility",
    "Down Dog to Lunge Reach": "Mobility",
    "Standing Hip Flexor Stretch with Rotation": "Mobility",
    "Kneeling Hip Stretch": "Mobility",
    "Hip Rockers": "Mobility",
    "External Hip Hold": "Mobility",
    "Kneeling Switches": "Mobility",
    "Elevated Pigeon Stretch": "Mobility",
    "90/90 Hip Stretch": "Mobility",
    "Kettlebell Hip Shift": "Mobility",
    "World's Greatest Stretch (Modified)": "Mobility",
    "Quadruped Hip CARs": "Mobility",
}

# Muscle tags, keyword-derived from the trains text ONLY (a name
# like "Anti-Rotation Back Pedal" must not fake a back tag). Rules
# run in order; a movement collects every tag whose pattern hits.
EXERCISE_MUSCLE_TAG_RULES = [
    ("Hamstrings", [r"hamstring"]),
    ("Glutes", [r"glute"]),
    ("Hip Flexors", [r"hip flexor", r"iliopsoas", r"psoas"]),
    ("Calves & Ankles", [r"calf", r"achilles", r"ankle", r"\bfoot\b", r"\bfeet\b"]),
    ("Adductors", [r"adductor", r"groin"]),
    ("Posterior Chain", [r"posterior chain", r"hinge"]),
    ("Core & Trunk", [r"core", r"trunk", r"anti-rotation"]),
    ("Shoulders", [r"shoulder"]),
    ("Back & Spine", [r"low back", r"spine", r"spinal", r"\bback\b"]),
    # "knee flexion" (hamstring curls) and "knee drive" (hip flexor
    # work) are not quad/knee training — the lookahead excludes them.
    ("Quads & Knees", [r"\bknee\b(?!\s+(flexion|drive))"]),
    ("Hip Mobility", [r"hip mobility", r"hip internal", r"hip external",
                      r"hip joint", r"\bhips\b"]),
]

# Focus tags, keyword-derived from name + trains (the contraction
# type is often stated in the name itself: "Overcoming Isometric").
EXERCISE_FOCUS_TAG_RULES = [
    ("Isometric", [r"isometric"]),
    ("Eccentric", [r"eccentric"]),
    ("Single-Leg", [r"single-leg", r"unilateral", r"one leg"]),
    ("Reactive & Elastic", [r"reactive", r"elastic", r"plyometric", r"stiffness"]),
    ("Power", [r"power", r"explosive"]),
    # Bare "sprint" is excluded on purpose: half the library is FOR
    # sprinters. The tag means the movement trains sprinting itself.
    ("Sprint & Acceleration", [r"acceleration", r"first step", r"front-side",
                               r"max velocity", r"block start", r"out of the blocks"]),
]

# Equipment normalization: the mined equipment text is a list of
# ";" segments. Each segment (lowercased) maps to the canonical
# equipment tags it stands for. Segments that name a helper or a
# loading note rather than gear ("partner", "trainer assist", ...)
# map to an empty list — the movement's real gear segment carries
# its tags. An unmapped segment fails the build.
EXERCISE_EQUIPMENT_MAP = {
    "45-degree hyperextension bench": ["Bench"],
    "acupuncture mat": ["Mat"],
    "agility ladder": ["Agility Ladder"],
    "band or cable": ["Resistance Band", "Cable Machine"],
    "bar and pad": ["Immovable Object"],
    "barbell": ["Barbell"],
    "barbell or dumbbell": ["Barbell", "Dumbbells"],
    "bench": ["Bench"],
    "bench or partner anchor": ["Bench"],
    "box": ["Box / Platform"],
    "cable machine": ["Cable Machine"],
    "chair, desk, table or floor": ["Chair / Table"],
    "coach to hold band": [],
    "cones": ["Cones"],
    "dumbbell": ["Dumbbells"],
    "dumbbells": ["Dumbbells"],
    "foam block": ["Foam Pad / Block"],
    "foam pad": ["Foam Pad / Block"],
    "heavy load or machine": ["Machine"],
    "hurdle": ["Hurdles"],
    "hurdles": ["Hurdles"],
    "hyperextension bench or floor": ["Bench"],
    "immovable object": ["Immovable Object"],
    "immovable object (rack, pins or wall)": ["Immovable Object"],
    "kettlebell": ["Kettlebell"],
    "leg curl machine": ["Machine"],
    "mat": ["Mat"],
    "medicine ball": ["Medicine Ball"],
    "none": ["No Equipment"],
    "none (floor)": ["No Equipment"],
    "none (floor or turf)": ["No Equipment"],
    "none or light load": ["No Equipment"],
    "partner": [],
    "partner or trainer assist": [],
    "platform or curb": ["Box / Platform"],
    "plyo box": ["Box / Platform"],
    "plyo boxes": ["Box / Platform"],
    "pull-up bar": ["Pull-Up Bar"],
    "raised step or platform": ["Box / Platform"],
    "resistance band": ["Resistance Band"],
    "resistance band anchored to a sled": ["Resistance Band"],
    "resistance band on the foot": ["Resistance Band"],
    "sliders": ["Sliders"],
    "smith machine or support for balance": ["Machine"],
    "stability ball": ["Stability Ball"],
    "starting blocks": ["Starting Blocks"],
    "track": ["Track / Turf"],
    "trainer assist": [],
    "trap bar": ["Trap Bar"],
    "turf/track": ["Track / Turf"],
    "two heavy dumbbells": ["Dumbbells"],
    "wall": ["Wall"],
    "wall/floor": ["Wall"],
    "weight in one hand": [],
    "weight plates": ["Weight Plates"],
    "wooden boxes": ["Box / Platform"],
}

# Canonical equipment tag order for the shipped lists.
EXERCISE_EQUIPMENT_ORDER = [
    "No Equipment", "Barbell", "Dumbbells", "Kettlebell", "Trap Bar",
    "Cable Machine", "Machine", "Resistance Band", "Medicine Ball",
    "Box / Platform", "Bench", "Hurdles", "Wall", "Immovable Object",
    "Pull-Up Bar", "Sliders", "Stability Ball", "Foam Pad / Block",
    "Mat", "Agility Ladder", "Starting Blocks", "Cones",
    "Weight Plates", "Chair / Table", "Track / Turf",
]


def _tags_for(rules, text):
    return [tag for tag, pats in rules
            if any(re.search(p, text) for p in pats)]


def exercise_library(movements):
    """Derive category / trainsTags / equipmentTags for every mined
    movement. Returns the shipped list; exits loudly on any gap."""
    names = [m["name"] for m in movements]
    if len(set(names)) != len(names):
        raise SystemExit("instagram movements: duplicate movement names — "
                         "the category mapping is keyed by name")
    missing = [n for n in names if n not in EXERCISE_CATEGORY_BY_NAME]
    if missing:
        raise SystemExit("instagram movements: NO CATEGORY MAPPED for: "
                         + "; ".join(missing)
                         + " — add each to EXERCISE_CATEGORY_BY_NAME in build-content.py")
    stale = [n for n in EXERCISE_CATEGORY_BY_NAME if n not in names]
    if stale:
        raise SystemExit("instagram movements: category mapping names movements "
                         "not in the source (renamed?): " + "; ".join(stale))
    out = []
    for m in movements:
        category = EXERCISE_CATEGORY_BY_NAME[m["name"]]
        if category not in EXERCISE_CATEGORIES:
            raise SystemExit("instagram movements: %r maps to unknown category %r"
                             % (m["name"], category))
        trains_tags = _tags_for(EXERCISE_MUSCLE_TAG_RULES, m["trains"].lower())
        focus_tags = _tags_for(EXERCISE_FOCUS_TAG_RULES,
                               (m["name"] + " " + m["trains"]).lower())
        trains_tags += [t for t in focus_tags if t not in trains_tags]
        equip = []
        for seg in m["equipment"].split(";"):
            key = seg.strip().lower()
            if key not in EXERCISE_EQUIPMENT_MAP:
                raise SystemExit("instagram movements: UNMAPPED equipment segment "
                                 "%r on %r — add it to EXERCISE_EQUIPMENT_MAP "
                                 "in build-content.py" % (seg.strip(), m["name"]))
            for tag in EXERCISE_EQUIPMENT_MAP[key]:
                if tag not in equip:
                    equip.append(tag)
        equip.sort(key=EXERCISE_EQUIPMENT_ORDER.index)
        if not trains_tags:
            raise SystemExit("instagram movements: %r derived NO trains tags — "
                             "extend the tag rules in build-content.py" % m["name"])
        if not equip:
            raise SystemExit("instagram movements: %r derived NO equipment tags — "
                             "check its equipment segments" % m["name"])
        entry = dict(m)
        entry["category"] = category
        entry["trainsTags"] = trains_tags
        entry["equipmentTags"] = equip
        out.append(entry)
    return out


igm_src = os.path.join(DB, "instagram_movements.json")
igm_out = os.path.join(OUT, "instagram_movements.json")
if os.path.exists(igm_src):
    mined = json.load(open(igm_src))
    built = exercise_library(mined)
    json.dump(built, open(igm_out, "w"), indent=1)
    dist = {}
    for m in built:
        dist[m["category"]] = dist.get(m["category"], 0) + 1
    print("instagram movements:", len(built), "entries (from source of truth,",
          "categories:", ", ".join("%s %d" % (c, dist.get(c, 0)) for c in EXERCISE_CATEGORIES), ")")
elif os.path.exists(igm_out):
    print("instagram movements: WARNING — source of truth missing, kept existing bundled copy with",
          len(json.load(open(igm_out))), "entries")
else:
    print("instagram movements: none found (the app runs fine without it)")
