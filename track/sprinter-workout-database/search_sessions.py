#!/usr/bin/env python3
"""Search the sprinter workout database.

Usage:
  python3 search_sessions.py --quality max_velocity
  python3 search_sessions.py --quality acceleration --phase base
  python3 search_sessions.py --cns low
  python3 search_sessions.py --max-volume 300
  python3 search_sessions.py --text fly
  python3 search_sessions.py            (lists everything)

Filters combine (AND). --text matches name, cues, equipment and source.
Data comes from sessions.json in the same folder as this script.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    with open(os.path.join(HERE, "sessions.json")) as f:
        return json.load(f)


def show(rows):
    if not rows:
        print("No sessions match.")
        return
    for s in rows:
        vol = f"{s['total_volume_m']}m total" if s["total_volume_m"] else "n/a volume"
        inten = f"{s['intensity_pct']}%" if s["intensity_pct"] else "-"
        print(f"{s['id']}  {s['name']}")
        print(f"     {s['quality']} | phase: {s['phase']} | level: {s['level']} | CNS: {s['cns_demand']}"
              f" (next high in {s['min_hours_before_next_high']}h)")
        print(f"     {s['reps']} x {s['rep_distance_m']}m @ {inten}, rest {s['rest']} | {vol}"
              f" | {s['surface']}, {s['footwear']}, kit: {s['equipment']}")
        print(f"     cues: {s['coaching_cues']}")
        print(f"     source: {s['source']}")
    print(f"\n{len(rows)} session(s)")


def main():
    p = argparse.ArgumentParser(description="Search sprinter sessions")
    p.add_argument("--quality", help="acceleration, max_velocity, speed_endurance, "
                                     "special_endurance, tempo, strength, plyometric, "
                                     "race_modeling, recovery")
    p.add_argument("--phase", help="base, pre_competitive, competitive, championship, any")
    p.add_argument("--level", help="beginner, intermediate, advanced, all")
    p.add_argument("--cns", choices=["high", "low"], help="CNS demand")
    p.add_argument("--surface", help="track, grass, hill, any")
    p.add_argument("--max-volume", type=int, help="max total volume in metres")
    p.add_argument("--text", help="free text: name, cues, equipment, source")
    args = p.parse_args()

    rows = load()
    if args.quality:
        rows = [r for r in rows if r["quality"] == args.quality]
    if args.phase:
        rows = [r for r in rows if r["phase"] in (args.phase, "any")]
    if args.level:
        rows = [r for r in rows if r["level"] in (args.level, "all")]
    if args.cns:
        rows = [r for r in rows if r["cns_demand"] == args.cns]
    if args.surface:
        rows = [r for r in rows if r["surface"] in (args.surface, "any")]
    if args.max_volume is not None:
        rows = [r for r in rows if 0 < r["total_volume_m"] <= args.max_volume]
    if args.text:
        t = args.text.lower()
        rows = [r for r in rows if t in (r["name"] + " " + r["coaching_cues"] + " "
                                         + r["equipment"] + " " + r["source"]).lower()]
    show(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
