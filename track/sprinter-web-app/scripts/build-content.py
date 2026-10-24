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
