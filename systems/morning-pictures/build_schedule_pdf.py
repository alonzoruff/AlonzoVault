#!/usr/bin/env python3
"""AJ's daily schedule PDF — color-coded, Cadets themed.

Usage: python3 build_schedule_pdf.py [YYYY-MM-DD] [output.pdf]
Defaults: today, ~/workspace/weekly-schedule/pdfs/schedule_YYYY-MM-DD.pdf

Pages:
  1. Today — detailed color-coded timeline, daily goals, sleep & recovery ratings
  2. This week — 7-day at-a-glance grid
  3. Week overview — hours by category, legend, notes
"""
import json
import subprocess
import sys
from datetime import date, timedelta, datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, HRFlowable)

# ---------------------------------------------------------------- palette
SCARLET = colors.HexColor("#A6192E")
DARK_GREY = colors.HexColor("#333333")
MED_GREY = colors.HexColor("#6B7280")

CATS = {
    "sleep":    ("Sleep",            "#1B2A4A", "#DCE3F0"),
    "wake":     ("Wake up",          "#8A6D1B", "#FBF3D9"),
    "workout":  ("Workout (mine)",   "#C0392B", "#FADBD8"),
    "duty":     ("Weight room duty", "#2E6DA4", "#D6EAF8"),
    "teach":    ("Teaching",         "#6C3483", "#E8DAEF"),
    "coach":    ("Coaching",         "#1E8449", "#D5F5E3"),
    "meal":     ("Meals",            "#9A7D0A", "#FEF5DA"),
    "downtime": ("Downtime",         "#117A65", "#D1F2EB"),
    "travel":   ("Travel",           "#7E5109", "#FDEBD0"),
    "school":   ("School",           "#5D6D7E", "#EAEDED"),
    "free":     ("Free time",        "#909497", "#F2F3F4"),
    "event":    ("Event",            "#A6192E", "#F9EBEA"),
}
CAT_LABEL = {k: v[0] for k, v in CATS.items()}
CAT_BG = {k: colors.HexColor(v[2]) for k, v in CATS.items()}
CAT_FG = {k: colors.HexColor(v[1]) for k, v in CATS.items()}

# ---------------------------------------------------------------- helpers
def mins(h, m):
    return h * 60 + m

def fmt(m):
    h, mm = divmod(m, 60)
    if h >= 24:
        h -= 24
    ap = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{mm:02d} {ap}"

def span(s, e):
    return f"{fmt(s)} - {fmt(e)}"

def B(s_h, s_m, e_h, e_m, label, cat):
    return (mins(s_h, s_m), mins(e_h, e_m), label, cat)

# ---------------------------------------------------------------- day builders
def scarlet_school():
    return [
        B(8, 10, 9, 10, "Weight room (supervise)", "duty"),
        B(9, 15, 12, 15, "Free", "free"),
        B(12, 15, 13, 15, "Weight room (supervise)", "duty"),
        B(13, 20, 14, 20, "Sports Med class", "teach"),
    ]

def grey_school():
    return [
        B(8, 10, 9, 10, "Sports Med class", "teach"),
        B(9, 15, 10, 0, "Weight room (supervise)", "duty"),
        B(10, 5, 11, 5, "Sports Med class", "teach"),
        B(11, 10, 12, 10, "Lunch", "meal"),
        B(12, 15, 13, 15, "Weight room (supervise)", "duty"),
        B(13, 20, 14, 20, "Quinn field", "coach"),
    ]

def after_school(weekday=None):
    blocks = [
        B(14, 20, 14, 45, "Prep for practices", "coach"),
        B(14, 45, 15, 0, "Track pre-meeting", "coach"),
        B(15, 0, 15, 10, "Football warm-up (Grey team)", "coach"),
    ]
    # Tue/Thu (weekday 1/3): NO football lifts (Scarlet or Grey) and NO
    # basketball lift — AJ corrected this 2026-10-20. Warm-up stays (not a lift).
    if weekday in (1, 3):
        return blocks
    blocks += [
        B(15, 15, 16, 0, "Help football lift (Scarlet team)", "coach"),
        B(16, 0, 17, 0, "Basketball", "coach"),
        B(17, 0, 17, 30, "Football lift (Grey team)", "coach"),
    ]
    return blocks

def evening():
    return [
        B(17, 30, 18, 0, "Make dinner", "meal"),
        B(18, 0, 19, 30, "Entertainment (games / TV)", "downtime"),
        B(19, 30, 21, 45, "Wind down", "downtime"),
        B(21, 45, 24, 0, "In bed (goal: 9:45 PM)", "sleep"),
    ]

def morning(weekday):
    """weekday: 0=Mon..6=Sun. Returns wake + workout blocks."""
    blocks = [B(5, 45, 6, 15, "Wake up (no snooze)", "wake")]
    if weekday in (0, 2):  # Mon, Wed
        blocks.append(B(6, 15, 7, 15, "Gym — my workout (Onelife)", "workout"))
    elif weekday in (1, 3):  # Tue, Thu
        blocks.append(B(6, 0, 7, 15, "Weight room open + my workout", "duty"))
    else:
        blocks.append(B(6, 15, 7, 15, "Early morning — free", "free"))
    return blocks

def weekday_blocks(day_type, weekday):
    blocks = morning(weekday)
    blocks += scarlet_school() if day_type == "Scarlet" else grey_school()
    blocks += after_school(weekday)
    blocks += evening()
    return blocks

def weekend_blocks():
    return [
        B(5, 45, 6, 15, "Wake up early (no sleeping in)", "wake"),
        B(6, 15, 9, 0, "Free morning", "free"),
        B(9, 0, 12, 0, "Free", "free"),
        B(12, 0, 13, 0, "Lunch", "meal"),
        B(13, 0, 17, 30, "Free afternoon", "free"),
        B(17, 30, 18, 0, "Make dinner", "meal"),
        B(18, 0, 19, 30, "Entertainment (games / TV)", "downtime"),
        B(19, 30, 21, 45, "Wind down", "downtime"),
        B(21, 45, 24, 0, "In bed (goal: 9:45 PM)", "sleep"),
    ]

# ------------------------------------------------------- special overrides
def trip_friday():
    return [
        B(6, 30, 7, 15, "Arrive St. Johns (park in front; lifting gear under travel suit)", "travel"),
        B(7, 15, 7, 30, "Chick-fil-A delivery", "meal"),
        B(7, 30, 13, 45, "Bus to NY (Chick-fil-A on the bus)", "travel"),
        B(13, 45, 14, 5, "Jersey Mike's pickup + arrive Hilton Garden Inn Westbury", "travel"),
        B(14, 5, 15, 0, "Depart for practice", "travel"),
        B(15, 0, 16, 35, "Practice — Kennedy Memorial Park, Hempstead", "coach"),
        B(16, 35, 17, 45, "Return to hotel", "travel"),
        B(17, 45, 22, 0, "Dinner — Olive Garden, Westbury Plaza", "meal"),
        B(22, 0, 24, 0, "Bed check / lights out", "sleep"),
    ]

def trip_saturday():
    return [
        B(7, 30, 8, 30, "Wake up call", "wake"),
        B(8, 30, 10, 30, "Breakfast", "meal"),
        B(10, 30, 11, 30, "Chick-fil-A delivered", "meal"),
        B(11, 30, 12, 0, "Depart hotel (pregame meal on bus)", "travel"),
        B(12, 0, 12, 20, "Arrive LuHi Turf Field, Brookville NY", "travel"),
        B(12, 20, 12, 50, "Specialists", "coach"),
        B(12, 50, 13, 0, "Skills", "coach"),
        B(13, 0, 13, 10, "Bigs / Dynamic", "coach"),
        B(13, 10, 13, 20, "Indy", "coach"),
        B(13, 20, 13, 30, "7v7", "coach"),
        B(13, 30, 13, 40, "Team", "coach"),
        B(13, 40, 13, 45, "Field goal", "coach"),
        B(13, 45, 13, 46, "Punt", "coach"),
        B(13, 46, 14, 0, "Locker room", "coach"),
        B(14, 0, 17, 15, "KICKOFF — Beat Long Island Lutheran!", "event"),
        B(17, 15, 17, 30, "Chick-fil-A postgame meal", "meal"),
        B(17, 30, 23, 30, "Bus home (meal on bus)", "travel"),
        B(23, 30, 24, 0, "Arrive 27th St — lights out", "sleep"),
    ]

def sunday_open_house():
    blocks = [B(5, 45, 6, 15, "Wake up early (no sleeping in)", "wake"),
              B(6, 15, 9, 0, "Free morning", "free"),
              B(9, 0, 14, 30, "Open house at SJC", "event"),
              B(14, 30, 17, 30, "Hang with friends", "downtime"),
              B(17, 30, 18, 0, "Make dinner", "meal"),
              B(18, 0, 19, 30, "Entertainment (games / TV)", "downtime"),
              B(19, 30, 21, 45, "Wind down", "downtime"),
              B(21, 45, 24, 0, "In bed (goal: 9:45 PM)", "sleep")]
    return blocks

def monday_champs_week():
    # Oct 19, 2026: late-start Monday (Grey rotation). Track practice ADDED
    # alongside the usual after-school blocks — nothing removed.
    return [
        B(5, 45, 6, 15, "Wake up (no snooze)", "wake"),
        B(6, 15, 7, 15, "Gym — my workout (Onelife)", "workout"),
        B(7, 15, 10, 5, "Free morning (late start bonus)", "free"),
        B(10, 5, 10, 10, "Warning bell", "school"),
        B(10, 10, 10, 50, "Period 1", "school"),
        B(10, 55, 11, 5, "Homeroom", "school"),
        B(11, 10, 11, 50, "Period 2", "school"),
        B(11, 55, 12, 55, "Period 3", "school"),
        B(13, 0, 14, 0, "Period 4", "school"),
        B(14, 5, 14, 45, "Period 5", "school"),
        B(14, 45, 15, 0, "Prep for practices", "coach"),
        B(14, 45, 16, 30, "Track practice — meet next to the gymnasium", "coach"),
        B(15, 0, 15, 10, "Football warm-up (Grey team)", "coach"),
        B(15, 15, 16, 0, "Help football lift (Scarlet team)", "coach"),
        B(16, 0, 17, 0, "Basketball", "coach"),
        B(17, 0, 17, 30, "Football lift (Grey team)", "coach"),
        B(17, 30, 18, 0, "Make dinner", "meal"),
        B(18, 0, 19, 30, "Entertainment (games / TV)", "downtime"),
        B(19, 30, 21, 45, "Wind down", "downtime"),
        B(21, 45, 24, 0, "In bed (goal: 9:45 PM)", "sleep"),
    ]


def tue_thu_champs_week(weekday):
    # Oct 20 & 22, 2026 (Scarlet). Track practice + performance training.
    # Tue/Thu have NO football lifts (Scarlet or Grey) and NO basketball lift
    # (AJ corrected 2026-10-20) — those blocks are not included here.
    # Football warm-up stays (not a lift).
    blocks = morning(weekday)
    blocks += scarlet_school()
    blocks += [
        B(14, 20, 14, 45, "Prep for practices", "coach"),
        B(14, 45, 15, 0, "Track pre-meeting", "coach"),
        B(14, 45, 16, 30, "Track practice — meet next to the gymnasium", "coach"),
        B(15, 0, 15, 10, "Football warm-up (Grey team)", "coach"),
        B(16, 0, 17, 0, "Performance training — sprinters", "coach"),
        B(16, 30, 17, 15, "Performance training — cross country", "coach"),
    ]
    blocks += evening()
    return blocks


def wednesday_champs_week():
    # Oct 21, 2026 (Grey). Champs week academic day (no track practice).
    # Kairos prep meeting with Maddy 2:25-2:45 PM added alongside the usual
    # after-school blocks (additive, per AJ's standing rule).
    blocks = morning(2)
    blocks += grey_school()
    aft = after_school(2)
    aft.insert(1, B(14, 25, 14, 45, "Kairos prep — meeting with Maddy", "event"))
    blocks += aft
    blocks += evening()
    return blocks


def friday_champs_week():
    # Oct 23, 2026 (Grey). XC pre-champs team meeting ADDED alongside the
    # usual after-school blocks — nothing removed.
    blocks = morning(4)
    # Pep Rally day runs a fully modified period grid (Ian MacInnes email,
    # Oct 22) — not the normal Grey blocks.
    blocks += [
        B(8, 10, 9, 10, "Period 1 (modified schedule)", "school"),
        B(9, 15, 9, 25, "Community Time", "school"),
        B(9, 30, 10, 30, "Period 2", "school"),
        B(10, 35, 11, 35, "Period 3", "school"),
        B(11, 40, 12, 40, "Period 4", "school"),
        B(12, 45, 13, 45, "Period 5", "school"),
    ]
    blocks += [
        B(13, 50, 14, 35, "Pep Rally", "event"),
        B(14, 35, 14, 45, "Prep for practices", "coach"),
        B(14, 45, 15, 0, "Track pre-meeting", "coach"),
        B(15, 0, 15, 10, "Football warm-up (Grey team)", "coach"),
        B(15, 15, 16, 0, "Help football lift (Scarlet team)", "coach"),
        B(16, 0, 17, 0, "Basketball", "coach"),
        B(16, 0, 17, 15, "Cross Country Pre-Champs Team Meeting + Team Dinner", "event"),
        # No 5:00-5:30 football lift on Oct 23 (AJ, 2026-10-22).
    ]
    ev = evening()
    blocks += ev[:2]
    blocks += [
        B(19, 30, 21, 0, "CSCS study — Module 9 Nutrition + 20 questions", "free"),
        B(21, 0, 21, 45, "Wind down", "downtime"),
        ev[3],
    ]
    return blocks


def saturday_wcac():
    # Oct 24, 2026: WCAC Championships at Kenilworth Park.
    # (Email lists "12:00 AM"/"12:45 AM" — read as PM.)
    return [
        B(5, 45, 6, 15, "Wake up early (no sleeping in)", "wake"),
        B(6, 15, 7, 0, "Breakfast + pack for the meet", "meal"),
        B(7, 15, 8, 0, "Team bus to Kenilworth Park (leaves 7:45 AM)", "travel"),
        B(8, 0, 9, 30, "Course opens — team walks", "coach"),
        B(9, 30, 10, 0, "Coaches meeting", "coach"),
        B(10, 0, 10, 30, "Freshman Boys", "event"),
        B(10, 30, 11, 0, "Varsity B Girls", "event"),
        B(11, 0, 11, 30, "Varsity B Boys", "event"),
        B(11, 30, 12, 0, "Varsity A Girls", "event"),
        B(12, 0, 12, 30, "Varsity A Boys", "event"),
        B(12, 45, 13, 30, "Awards — Top 12 (Top 15 for Var B Girls)", "event"),
        B(13, 30, 14, 0, "Head to Fernandez Stadium", "travel"),
        B(14, 0, 16, 30, "Varsity football vs DeMatha", "event"),
        B(16, 30, 17, 30, "Free / reset", "free"),
        B(17, 30, 18, 0, "Make dinner", "meal"),
        B(18, 0, 19, 30, "Entertainment (games / TV)", "downtime"),
        B(19, 30, 21, 45, "Wind down", "downtime"),
        B(21, 45, 24, 0, "In bed (goal: 9:45 PM)", "sleep"),
    ]


def monday_late_start():
    # Oct 19, 2026 only. Grey rotation day but school runs late-start periods.
    # Weight room / Quinn blocks TBD — shown as school periods; AJ to confirm mapping.
    return [
        B(5, 45, 6, 15, "Wake up (no snooze)", "wake"),
        B(6, 15, 7, 15, "Gym — my workout (Onelife)", "workout"),
        B(7, 15, 10, 5, "Free morning (late start bonus)", "free"),
        B(10, 5, 10, 10, "Warning bell", "school"),
        B(10, 10, 10, 50, "Period 1", "school"),
        B(10, 55, 11, 5, "Homeroom", "school"),
        B(11, 10, 11, 50, "Period 2", "school"),
        B(11, 55, 12, 55, "Period 3", "school"),
        B(13, 0, 14, 0, "Period 4", "school"),
        B(14, 5, 14, 45, "Period 5", "school"),
        B(14, 45, 15, 0, "Prep for practices", "coach"),
        B(15, 0, 15, 10, "Football warm-up (Grey team)", "coach"),
        B(15, 15, 16, 0, "Help football lift (Scarlet team)", "coach"),
        B(16, 0, 17, 0, "Basketball", "coach"),
        B(17, 0, 17, 30, "Football lift (Grey team)", "coach"),
        B(17, 30, 18, 0, "Make dinner", "meal"),
        B(18, 0, 19, 30, "Entertainment (games / TV)", "downtime"),
        B(19, 30, 21, 45, "Wind down", "downtime"),
        B(21, 45, 24, 0, "In bed (goal: 9:45 PM)", "sleep"),
    ]

def thursday_oct22_aj():
    # Oct 22, 2026: AJ set this day himself (sent Oct 21). Free morning
    # replaces the Scarlet morning weight room; afternoon is track practice
    # with football warm-up and lift inside it, then track lift and XC lift.
    blocks = [
        B(5, 45, 6, 0, "Wake up (no snooze)", "wake"),
        B(6, 0, 7, 15, "Workout", "workout"),
        B(7, 15, 12, 15, "Free", "free"),
        B(12, 15, 13, 15, "Weight room (supervise)", "duty"),
        B(13, 20, 14, 20, "Sports Med class", "teach"),
        B(14, 45, 16, 0, "Track practice", "coach"),
        B(15, 0, 15, 10, "Football warm-up", "coach"),
        B(15, 15, 16, 0, "Football lift", "coach"),
        B(16, 0, 17, 0, "Track lift", "coach"),
        B(16, 30, 17, 15, "XC lift", "coach"),
    ]
    blocks += evening()
    return blocks


def friday_oct30_test_day():
    # Oct 30, 2026: NO school (AJ confirmed Oct 22). CSCS exam day —
    # 3:00 PM Pearson VUE, 9831 Greenbelt Rd Suite 311, Lanham, MD.
    # Taper morning only, drive out ~1:45 PM, exam 3:00-7:30 PM.
    blocks = [
        B(6, 0, 6, 15, "Wake up (no snooze)", "wake"),
        B(6, 15, 7, 15, "Workout", "workout"),
        B(7, 15, 8, 0, "Breakfast", "meal"),
        B(8, 0, 8, 30, "Numbers sheet skim (30 min max)", "free"),
        B(8, 30, 12, 0, "Free / rest — no cramming", "free"),
        B(12, 0, 12, 45, "Lunch", "meal"),
        B(12, 45, 13, 45, "Get ready — ID + confirmation check", "free"),
        B(13, 45, 14, 30, "Drive to Lanham test center", "free"),
        B(14, 30, 15, 0, "Check in (Pearson VUE, Greenbelt Rd)", "duty"),
        B(15, 0, 19, 30, "CSCS EXAM", "teach"),
        B(19, 30, 20, 15, "Drive home", "free"),
        B(20, 15, 20, 45, "Dinner (light)", "meal"),
        B(20, 45, 21, 45, "Wind down", "downtime"),
        B(21, 45, 24, 0, "In bed (goal: 9:45 PM)", "sleep"),
    ]
    return blocks


SPECIAL = {
    "2026-10-16": ("Football trip — Day 2 (NY)", trip_friday()),
    "2026-10-17": ("Football trip — Game day (NY)", trip_saturday()),
    "2026-10-18": ("Sunday — SJC open house", sunday_open_house()),
    "2026-10-19": ("Late start Monday (Grey) — track practice", monday_champs_week()),
    "2026-10-20": ("Tuesday (Scarlet) — track practice", tue_thu_champs_week(1)),
    "2026-10-21": ("Wednesday (Grey) — Kairos prep with Maddy", wednesday_champs_week()),
    "2026-10-22": ("Thursday (Scarlet) — AJ's plan", thursday_oct22_aj()),
    "2026-10-23": ("Friday (Grey) — XC pre-champs meeting", friday_champs_week()),
    "2026-10-24": ("Saturday — WCAC Championships", saturday_wcac()),
    "2026-10-30": ("Friday — NO SCHOOL · CSCS TEST DAY (3 PM, Lanham)", friday_oct30_test_day()),
}

# ------------------------------------------------------- scarlet/grey logic
ANCHOR = date(2026, 10, 19)  # Monday, Grey

def day_type(d):
    key = d.isoformat()
    if key in SPECIAL:
        return SPECIAL[key][0], SPECIAL[key][1]
    if d.weekday() >= 5:
        label = "Weekend"
        return label, weekend_blocks()
    # count weekdays from anchor (signed)
    n, cur = 0, ANCHOR
    step = 1 if d >= ANCHOR else -1
    while cur != d:
        cur += timedelta(days=step)
        if cur.weekday() < 5:
            n += step
    label = "Grey day" if n % 2 == 0 else "Scarlet day"
    return label, weekday_blocks("Grey" if n % 2 == 0 else "Scarlet", d.weekday())

# ------------------------------------------------------- wearable ratings
def run(cmd):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return json.loads(out.stdout) if out.returncode == 0 and out.stdout.strip() else None
    except Exception:
        return None

def last_night_sleep(today):
    """Best sleep record for the night ending this morning. Returns dict or None."""
    y = (today - timedelta(days=1)).isoformat()
    t = today.isoformat()
    data = run(["/opt/hatch/bin/health-cli", "query", "sessions",
                "--provider", "healthkit", "--category", "sleep",
                "--start-date", y, "--end-date", t])
    recs = (data or {}).get("records", [])
    # Only sessions ENDING this morning count as last night. Grouping by start
    # date lumps two different nights together (e.g. Thu night and Fri night
    # both start on the same calendar date), and the picker can grab the
    # wrong night entirely.
    cands = []
    for r in recs:
        try:
            bed_dt = datetime.fromisoformat(r["start_datetime"])
            end_dt = datetime.fromisoformat(r["end_datetime"])
        except Exception:
            continue
        if end_dt.date().isoformat() != t:
            continue
        in_bed = (end_dt - bed_dt).total_seconds() / 3600.0
        # dedupe overlapping device writes: stage time should not exceed time
        # in bed — keep the most self-consistent record
        stage = sum((r.get(k) or 0) for k in
                    ("sleep_core_duration_sec", "sleep_deep_duration_sec", "sleep_rem_duration_sec")) / 3600.0
        ref = (r.get("sleep_in_bed_duration_sec") or 0) / 3600.0 or in_bed
        err = abs(stage - ref)
        cands.append((err, r, in_bed))
    if not cands:
        return None
    _, r, in_bed = min(cands, key=lambda x: x[0])
    def hrs(k):
        return (r.get(k) or 0) / 3600.0
    stage_sum = hrs("sleep_core_duration_sec") + hrs("sleep_deep_duration_sec") + hrs("sleep_rem_duration_sec")
    try:
        bed = datetime.fromisoformat(r["start_datetime"])
        wake_t = datetime.fromisoformat(r["end_datetime"])
    except Exception:
        return None
    in_bed_h = hrs("sleep_in_bed_duration_sec") or in_bed
    asleep_h = min(stage_sum, in_bed_h)
    return {
        "bedtime": bed, "wake": wake_t,
        "in_bed_h": in_bed_h,
        "asleep_h": asleep_h,
        "deep_h": hrs("sleep_deep_duration_sec"),
        "rem_h": hrs("sleep_rem_duration_sec"),
        "efficiency": r.get("sleep_efficiency"),
        "quality": r.get("quality_score"),
        "awakenings": r.get("number_of_awakenings"),
    }

def week_workouts(today):
    """Workout sessions in the Mon-Sun week containing today. Returns (count, streak_days)."""
    monday = today - timedelta(days=today.weekday())
    data = run(["/opt/hatch/bin/health-cli", "query", "sessions",
                "--provider", "healthkit", "--category", "workout",
                "--start-date", monday.isoformat(), "--end-date", today.isoformat()])
    recs = (data or {}).get("records", [])
    days = set()
    for r in recs:
        try:
            days.add(r["start_datetime"][:10])
        except Exception:
            pass
    # streak: consecutive days with a workout ending today or yesterday
    streak, cur = 0, today
    while cur.isoformat() in days:
        streak += 1
        cur -= timedelta(days=1)
    if streak == 0 and (today - timedelta(days=1)).isoformat() in days:
        cur = today - timedelta(days=1)
        while cur.isoformat() in days:
            streak += 1
            cur -= timedelta(days=1)
    return len(days), streak

def yesterday_activity(today):
    """Yesterday's all-day activity metrics (steps, exercise, energy). Dict or None."""
    y = (today - timedelta(days=1)).isoformat()
    data = run(["/opt/hatch/bin/health-cli", "query", "metrics",
                "--provider", "healthkit", "--interval", "daily",
                "--start-date", y, "--end-date", y])
    recs = (data or {}).get("records", [])
    for r in recs:
        if r.get("date") == y:
            return {
                "steps": r.get("step_count"),
                "exercise_min": r.get("apple_exercise_time_sum"),
                "active_kcal": r.get("active_energy_burned_kcal"),
                "stand_min": r.get("apple_stand_time_sum"),
                "distance_km": (r.get("distance_walking_running_meters") or 0) / 1000.0,
            }
    return None


def activity_points(activity):
    """(steps_pts of 25, exercise_pts of 25). Full marks: 20,000 steps, 90 exercise minutes (AJ, 2026-10-20)."""
    if not activity:
        return 0, 0
    s_pts = round(min(activity.get("steps") or 0, 20000) / 20000.0 * 25)
    e_pts = round(min(activity.get("exercise_min") or 0, 90) / 90.0 * 25)
    return s_pts, e_pts


def yesterday_workouts(today):
    """Count of workout sessions yesterday."""
    y = (today - timedelta(days=1)).isoformat()
    data = run(["/opt/hatch/bin/health-cli", "query", "sessions",
                "--provider", "healthkit", "--category", "workout",
                "--start-date", y, "--end-date", y])
    recs = (data or {}).get("records", [])
    return sum(1 for r in recs if (r.get("start_datetime") or "")[:10] == y)


def bedtime_rating(bed):
    """Minutes late vs 9:45 PM goal (the most recent 9:45 PM before bedtime)."""
    goal = bed.replace(hour=21, minute=45, second=0, microsecond=0)
    if goal > bed:
        # bedtime fell after midnight — goal was 9:45 PM the previous evening
        goal -= timedelta(days=1)
    late = (bed - goal).total_seconds() / 60
    if late <= 15:
        return "On target", 25
    if late <= 60:
        return "Close", 15
    return "Missed", 5

def duration_rating(h):
    if h >= 7.5:
        return "Solid", 25
    if h >= 6.0:
        return "Short", 15
    return "Low", 5

def consistency_score(sleep, activity):
    """0-100, scored daily (AJ's call 2026-10-20): 50 sleep (bedtime 25 +
    duration 25, unchanged) + 50 daily activity (steps 25 + exercise min 25)."""
    if not sleep:
        return None, "No sleep data synced"
    _, b_pts = bedtime_rating(sleep["bedtime"])
    _, d_pts = duration_rating(sleep["asleep_h"] or sleep["in_bed_h"])
    s_pts, e_pts = activity_points(activity)
    total = round(b_pts + d_pts + s_pts + e_pts)
    if total >= 85:
        band = "Locked in"
    elif total >= 70:
        band = "On track"
    elif total >= 50:
        band = "Drifting"
    else:
        band = "Refocus"
    return total, band

# ------------------------------------------------------- daily goals
DONATION_WEEK = (date(2026, 10, 19), date(2026, 10, 24))


def daily_goals(day_label, blocks, weekday, target=None):
    goals = []
    cats = [b[3] for b in blocks]
    if "workout" in cats or "duty" in cats:
        goals.append("Get today's training in — consistency is the goal")
    else:
        goals.append("Move today — walk, stretch, or easy workout (no zero days)")
    goals.append("In bed by 9:45 PM")
    if "CSCS TEST DAY" in day_label:
        goals.append("CSCS EXAM 3:00 PM — Lanham, arrive 2:30 PM, ID in pocket")
    elif "Game day" in day_label:
        goals.append("2:00 PM kickoff — beat Long Island Lutheran")
    elif "open house" in day_label:
        goals.append("Open house 9:00 AM — represent SJC")
    elif "Championship" in day_label:
        goals.append("WCAC Championships — Kenilworth Park, first race 10:00 AM")
    elif "pre-champs" in day_label:
        goals.append("XC pre-champs team meeting 4:00 PM")
    elif "Late start" in day_label:
        goals.append("Use the bonus morning well — gym done, school 10:05")
    elif "Football trip" in day_label:
        goals.append("3:00 PM practice — Kennedy Memorial Park")
    elif weekday in (1, 3):
        goals.append("Weight room open 6:15 AM sharp")
    else:
        goals.append("Practice prep done by 2:45 PM")
    if target is not None and DONATION_WEEK[0] <= target <= DONATION_WEEK[1]:
        goals.append("Last week for team donations and pledges — bring them in")
    return goals[:4]

# ------------------------------------------------------- PDF rendering
def p_style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=10, leading=13, textColor=DARK_GREY)
    base.update(kw)
    return ParagraphStyle(name, **base)

def build_pdf(target_date, out_path):
    label, blocks = day_type(target_date)
    sleep = last_night_sleep(target_date)
    wdays, streak = week_workouts(target_date)
    score, band = consistency_score(sleep, wdays)
    goals = daily_goals(label, blocks, target_date.weekday(), target_date)

    doc = SimpleDocTemplate(str(out_path), pagesize=letter,
                            leftMargin=0.6 * inch, rightMargin=0.6 * inch,
                            topMargin=0.5 * inch, bottomMargin=0.5 * inch)
    W = letter[0] - 1.2 * inch
    story = []
    title_s = p_style("title", fontName="Helvetica-Bold", fontSize=22, textColor=SCARLET, leading=26)
    sub_s = p_style("sub", fontSize=11, textColor=MED_GREY)
    h1 = p_style("h1", fontName="Helvetica-Bold", fontSize=14, textColor=SCARLET, leading=17, spaceBefore=10)
    h2 = p_style("h2", fontName="Helvetica-Bold", fontSize=11, textColor=DARK_GREY, leading=14, spaceBefore=8)
    body = p_style("body")
    small = p_style("small", fontSize=8.5, leading=11)

    # ---- header band
    band_data = [[Paragraph('<font color="white"><b>AJ\'S WEEK</b></font>', p_style("b", textColor=colors.white, fontName="Helvetica-Bold", fontSize=16)),
                  Paragraph('<font color="white">Cadets schedule — color-coded</font>', p_style("b2", textColor=colors.white, fontSize=10))]]
    header_band = Table(band_data, colWidths=[W * 0.55, W * 0.45])
    header_band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SCARLET),
                              ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 12),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                              ("TOPPADDING", (0, 0), (-1, -1), 8),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.append(header_band)
    story.append(Spacer(1, 0.15 * inch))

    # ---- page 1: today
    story.append(Paragraph(f"Today — {target_date.strftime('%A, %B %d, %Y')}", title_s))
    story.append(Paragraph(f"Day type: <b>{label}</b>", sub_s))
    story.append(Spacer(1, 0.1 * inch))

    story.append(Paragraph("Schedule", h1))
    rows = [[Paragraph("<b>Time</b>", small), Paragraph("<b>Block</b>", small)]]
    tstyle = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
               ("VALIGN", (0, 0), (-1, -1), "TOP"),
               ("GRID", (0, 0), (-1, -1), 0.4, colors.white),
               ("LEFTPADDING", (0, 0), (-1, -1), 6),
               ("RIGHTPADDING", (0, 0), (-1, -1), 6),
               ("TOPPADDING", (0, 0), (-1, -1), 4),
               ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    for i, (s, e, text, cat) in enumerate(blocks, start=1):
        rows.append([Paragraph(span(s, e), small), Paragraph(text, small)])
        tstyle.append(("BACKGROUND", (0, i), (-1, i), CAT_BG[cat]))
    t = Table(rows, colWidths=[1.9 * inch, W - 1.9 * inch])
    t.setStyle(TableStyle(tstyle))
    story.append(t)

    story.append(Paragraph("Daily goals", h1))
    for g in goals:
        story.append(Paragraph(f"• &nbsp;{g}", body))

    story.append(Paragraph("Sleep & recovery", h1))
    if sleep:
        bt = sleep["bedtime"].strftime("%-I:%M %p")
        wt = sleep["wake"].strftime("%-I:%M %p")
        br_label, _ = bedtime_rating(sleep["bedtime"])
        dr_label, _ = duration_rating(sleep["asleep_h"] or sleep["in_bed_h"])
        srows = [
            [Paragraph("<b>Bedtime</b>", small), Paragraph(f"{bt} (goal 9:45 PM — {br_label})", small)],
            [Paragraph("<b>Wake</b>", small), Paragraph(wt, small)],
            [Paragraph("<b>Asleep</b>", small), Paragraph(f"{sleep['asleep_h']:.1f} h ({dr_label})", small)],
            [Paragraph("<b>Deep / REM</b>", small), Paragraph(f"{sleep['deep_h']:.1f} h / {sleep['rem_h']:.1f} h", small)],
        ]
        if sleep["efficiency"]:
            srows.append([Paragraph("<b>Efficiency</b>", small), Paragraph(f"{sleep['efficiency']:.0f}%", small)])
        st = Table(srows, colWidths=[1.9 * inch, W - 1.9 * inch])
        st.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#E5E7EB")),
                                ("GRID", (0, 0), (-1, -1), 0.4, colors.white),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                                ("TOPPADDING", (0, 0), (-1, -1), 4),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        story.append(st)
    else:
        story.append(Paragraph("No sleep data synced yet — check Apple Health / Oura sync.", small))
    wline = f"Workouts this week: <b>{wdays}</b> / 4 planned"
    if streak:
        wline += f" &nbsp;•&nbsp; streak: <b>{streak} day{'s' if streak != 1 else ''}</b>"
    story.append(Paragraph(wline, body))
    if score is not None:
        story.append(Paragraph(f"Consistency score: <b>{score}/100 — {band}</b>", p_style("score", fontName="Helvetica-Bold", fontSize=12, textColor=SCARLET)))
    else:
        story.append(Paragraph(f"Consistency score: {band}", small))

    # ---- page 2: week at a glance
    story.append(PageBreak())
    monday = target_date - timedelta(days=target_date.weekday())
    sunday = monday + timedelta(days=6)
    story.append(Paragraph(f"Week at a glance — {monday.strftime('%b %d')} to {sunday.strftime('%b %d, %Y')}", title_s))
    story.append(Spacer(1, 0.1 * inch))
    col_w = W / 7.0
    header = [Paragraph(f"<b>{(monday + timedelta(days=i)).strftime('%a')}</b><br/>{(monday + timedelta(days=i)).strftime('%-m/%-d')}", p_style("dh", fontSize=8.5, leading=10, alignment=1)) for i in range(7)]
    grid = [header]
    max_rows = 0
    day_cols = []
    for i in range(7):
        d = monday + timedelta(days=i)
        dl, db = day_type(d)
        short = []
        for s, e, text, cat in db:
            if cat in ("sleep", "wake"):
                continue
            t = text.split("(")[0].strip()
            if len(t) > 26:
                t = t[:24] + "…"
            short.append((f"{fmt(s).replace(':00 ', ' ')} {t}", cat))
        day_cols.append((dl, short))
        max_rows = max(max_rows, len(short))
    for r in range(max_rows):
        row = []
        for dl, short in day_cols:
            if r < len(short):
                txt, cat = short[r]
                row.append(Paragraph(f'<font color="{CATS[cat][1]}">■</font> {txt}', p_style("dc", fontSize=7, leading=8.5)))
            else:
                row.append(Paragraph("", small))
        grid.append(row)
    # day-type row
    typerow = [Paragraph(f"<i>{dl}</i>", p_style("dt", fontSize=7, leading=8.5, alignment=1, textColor=MED_GREY)) for dl, _ in day_cols]
    grid.insert(1, typerow)
    gt = Table(grid, colWidths=[col_w] * 7)
    gs = [("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
          ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
          ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#F3F4F6")),
          ("LEFTPADDING", (0, 0), (-1, -1), 3),
          ("RIGHTPADDING", (0, 0), (-1, -1), 3),
          ("TOPPADDING", (0, 0), (-1, -1), 3),
          ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    # highlight today
    ti = (target_date - monday).days
    if 0 <= ti < 7:
        gs.append(("BACKGROUND", (ti, 0), (ti, 0), colors.HexColor("#FDE68A")))
    gt.setStyle(TableStyle(gs))
    story.append(gt)
    story.append(Spacer(1, 0.12 * inch))
    story.append(Paragraph("■ = category color (see legend). Today highlighted.", small))

    # ---- page 3: overview
    story.append(PageBreak())
    story.append(Paragraph("Week overview", title_s))
    story.append(Paragraph("Hours by category (Mon–Sun)", h1))
    totals = {}
    for i in range(7):
        d = monday + timedelta(days=i)
        _, db = day_type(d)
        for s, e, text, cat in db:
            totals[cat] = totals.get(cat, 0) + (e - s)
    orows = [[Paragraph("<b>Category</b>", small), Paragraph("<b>Hours</b>", small)]]
    for cat in sorted(totals, key=lambda c: -totals[c]):
        orows.append([Paragraph(f'<font color="{CATS[cat][1]}">■</font> {CAT_LABEL[cat]}', small),
                      Paragraph(f"{totals[cat] / 60:.1f}", small)])
    ot = Table(orows, colWidths=[3.2 * inch, 1.6 * inch])
    ot.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
                            ("GRID", (0, 0), (-1, -1), 0.4, colors.white),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 6),
                            ("TOPPADDING", (0, 0), (-1, -1), 4),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(ot)

    story.append(Paragraph("Legend", h1))
    lrows = []
    for cat, (lbl, fg, bg) in CATS.items():
        lrows.append([Paragraph(f'<font color="{fg}">■■■■</font>', small), Paragraph(lbl, small)])
    lt = Table(lrows, colWidths=[0.7 * inch, 2.2 * inch])
    lt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 4),
                            ("TOPPADDING", (0, 0), (-1, -1), 2),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story.append(lt)

    story.append(Paragraph("Notes", h1))
    story.append(Paragraph("• &nbsp;Scarlet/Grey days alternate every weekday (anchor: Mon Oct 19 = Grey).", small))
    story.append(Paragraph("• &nbsp;One-off overrides: Oct 16–17 football trip (NY), Oct 18 SJC open house 9:00 AM–2:30 PM, Oct 19 late start (school 10:05 AM–2:45 PM).", small))
    story.append(Paragraph("• &nbsp;Sleep & recovery ratings come from Apple Health (Apple Watch) and Oura via Apple Health sync.", small))
    story.append(Paragraph("• &nbsp;Consistency score: 50 sleep (bedtime vs 9:45 PM + duration) + 50 daily activity (steps + exercise minutes).", small))

    doc.build(story)
    return out_path


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()
    target = datetime.strptime(arg, "%Y-%m-%d").date()
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / "workspace" / "weekly-schedule" / "pdfs" / f"schedule_{target.isoformat()}.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)
    build_pdf(target, out)
    print(str(out))


if __name__ == "__main__":
    main()
