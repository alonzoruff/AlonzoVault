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
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
VAULT_TRACK = os.path.dirname(APP)
DB = os.path.join(VAULT_TRACK, "sprinter-workout-database")
PLAN = os.path.join(VAULT_TRACK, "season-plan-2026-27")
OUT = os.path.join(APP, "content")
os.makedirs(OUT, exist_ok=True)

# sessions.json -> bare list in content/
d = json.load(open(os.path.join(DB, "sessions.json")))
rows = d if isinstance(d, list) else d.get("sessions", [])
json.dump(rows, open(os.path.join(OUT, "sessions.json"), "w"), indent=1)
print("sessions:", len(rows))

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
