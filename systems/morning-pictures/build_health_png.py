#!/usr/bin/env python3
"""AJ's health & consistency as a phone-friendly picture (PNG).

Usage: python3 build_health_png.py [YYYY-MM-DD] [output.png]
Defaults: today, ~/workspace/weekly-schedule/images/health_YYYY-MM-DD.png

Delivered at 7:45 AM once Apple Health has synced: consistency score with
breakdown (sleep 50 + yesterday's activity 50), last night's sleep &
recovery, yesterday's activity.
"""
import sys
from datetime import datetime, date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_schedule_pdf import (  # noqa: E402
    last_night_sleep, consistency_score,
    bedtime_rating, duration_rating,
    yesterday_activity, activity_points, yesterday_workouts,
)

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

import json  # noqa: E402

TAGS_PATH = Path.home() / "workspace" / "goals" / "consistency" / "hidden_files" / "oura_tags.json"


def tag_lines(target_date):
    """Oura tag section lines, built only from tags AJ reported himself.

    Store format: {"tags": [names as in the Oura app],
                   "nights": {"YYYY-MM-DD": {"tags": [...], "score": int}}}
    Nights with nothing reported read as untagged; nothing is inferred.
    """
    try:
        data = json.loads(TAGS_PATH.read_text())
    except Exception:
        data = {"tags": [], "nights": {}}
    tags = data.get("tags") or []
    nights = data.get("nights") or {}
    if not tags:
        return ["Tag tracking isn't set up yet. Send me the tags you use in "
                "the Oura app (the names as they appear there) and I'll line "
                "them up with your sleep and scores here."]
    lines = []
    entry = nights.get(target_date.isoformat())
    if entry and entry.get("tags"):
        lines.append("Last night you tagged: " + ", ".join(entry["tags"]))
    else:
        lines.append("Last night: no tags reported. Reply with last night's "
                     "tags and I'll log them against this score.")
    shown = 0
    for t in tags:
        scores = [n["score"] for n in nights.values()
                  if t in (n.get("tags") or []) and n.get("score") is not None]
        if len(scores) >= 3:
            lines.append(f"{t}: average score {round(sum(scores) / len(scores))} "
                         f"across {len(scores)} nights")
            shown += 1
    if not shown:
        lines.append("Averages show up here once a tag has 3 or more logged nights.")
    return lines

W = 1080
PAD = 48
BG = (255, 255, 255)
SCARLET = (166, 25, 46)
DARK = (51, 51, 51)
GREY = (107, 114, 128)
TRACK = (229, 231, 235)
ROW_BG = (245, 247, 250)

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
F_BOLD = lambda s: ImageFont.truetype(f"{FONT_DIR}/DejaVuSans-Bold.ttf", s)  # noqa: E731
F_REG = lambda s: ImageFont.truetype(f"{FONT_DIR}/DejaVuSans.ttf", s)  # noqa: E731


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        trial = (cur + " " + w_).strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines or [""]


def build_png(target_date, out_path):
    sleep = last_night_sleep(target_date)
    act = yesterday_activity(target_date)
    score, band = consistency_score(sleep, act)

    if sleep:
        _, b_pts = bedtime_rating(sleep["bedtime"])
        _, d_pts = duration_rating(sleep["asleep_h"] or sleep["in_bed_h"])
        bt = sleep["bedtime"].strftime("%-I:%M %p")
        wt = sleep["wake"].strftime("%-I:%M %p")
        br_label, _ = bedtime_rating(sleep["bedtime"])
        dr_label, _ = duration_rating(sleep["asleep_h"] or sleep["in_bed_h"])
    else:
        b_pts = d_pts = 0
        bt = wt = br_label = dr_label = None
    s_pts, e_pts = activity_points(act)

    f_title = F_BOLD(54)
    f_date = F_REG(32)
    f_h = F_BOLD(36)
    f_score = F_BOLD(96)
    f_band = F_BOLD(40)
    f_blabel = F_REG(28)
    f_bpts = F_BOLD(28)
    f_k = F_BOLD(28)
    f_v = F_REG(28)
    f_body = F_REG(30)
    f_note = F_REG(24)

    draw = ImageDraw.Draw(Image.new("RGB", (W, 10), BG))
    sections = []
    sections.append(("header", target_date.strftime("%A, %B %d, %Y")))
    sections.append(("heading", "CONSISTENCY SCORE"))
    sections.append(("score", (score, band)))
    sections.append(("bars", [("Bedtime vs 9:45 PM", b_pts, 25),
                              ("Sleep duration", d_pts, 25),
                              ("Steps yesterday", s_pts, 25),
                              ("Exercise minutes yesterday", e_pts, 25)]))
    sections.append(("heading", "LAST NIGHT — SLEEP & RECOVERY"))
    if sleep:
        rows = [
            ("Bedtime", f"{bt} (goal 9:45 PM — {br_label})"),
            ("Wake", wt),
            ("Time asleep", f"{sleep['asleep_h']:.1f} h ({dr_label})"),
            ("Time in bed", f"{sleep['in_bed_h']:.1f} h"),
            ("Deep / REM", f"{sleep['deep_h']:.1f} h / {sleep['rem_h']:.1f} h"),
        ]
        if sleep.get("efficiency"):
            rows.append(("Sleep efficiency", f"{sleep['efficiency']:.0f}%"))
        if sleep.get("awakenings") is not None:
            awak = sleep["awakenings"]
            awak_s = str(int(awak)) if float(awak).is_integer() else str(awak)
            rows.append(("Awakenings", awak_s))
        sections.append(("table", rows))
    else:
        sections.append(("body", "No sleep data synced yet — check Apple Health / Oura sync."))
    sections.append(("heading", "YESTERDAY — ACTIVITY"))
    if act:
        arows = [
            ("Steps", f"{int(act['steps']):,} (full marks at 20,000)" if act.get("steps") is not None else "—"),
            ("Exercise", f"{int(act['exercise_min'])} min (full marks at 90)" if act.get("exercise_min") is not None else "—"),
        ]
        if act.get("active_kcal") is not None:
            arows.append(("Active energy", f"{act['active_kcal']:.0f} kcal"))
        if act.get("distance_km"):
            arows.append(("Distance", f"{act['distance_km']:.1f} km"))
        if act.get("stand_min") is not None:
            arows.append(("Stand time", f"{act['stand_min'] / 60.0:.1f} h"))
        nwo = yesterday_workouts(target_date)
        if nwo:
            arows.append(("Workouts", f"{nwo} session{'s' if nwo != 1 else ''} logged"))
        sections.append(("table", arows))
    else:
        sections.append(("body", "No activity data synced yet for yesterday — check Apple Health sync."))
    sections.append(("heading", "OURA TAGS"))
    for tl in tag_lines(target_date):
        sections.append(("body", tl))
    sections.append(("heading", "NOTES"))
    sections.append(("note", "Sleep & recovery from Apple Health (Apple Watch) and Oura via Apple Health sync. Activity from Apple Health daily metrics."))
    sections.append(("note", "Score = 50 sleep (bedtime vs 9:45 PM: 25 + duration: 25) + 50 daily activity (steps up to 25 at 20,000 + exercise minutes up to 25 at 90)."))
    sections.append(("note", "Bands: 85+ Locked in · 70+ On track · 50+ Drifting · below 50 Refocus."))

    # measure
    heights = []
    y = 0
    bar_w = W - PAD * 2
    for kind, payload in sections:
        if kind == "header":
            h = 170
        elif kind == "heading":
            h = 92
        elif kind == "score":
            h = 150
        elif kind == "bars":
            h = 92 * len(payload) + 16
        elif kind == "table":
            h = 0
            for k, v in payload:
                vl = wrap(draw, v, f_v, bar_w - 380)
                h += max(72, 18 + 40 * len(vl))
            h += 12
        elif kind == "body":
            h = 42 * max(1, len(wrap(draw, payload, f_body, bar_w))) + 24
        elif kind == "note":
            h = 38 * max(1, len(wrap(draw, payload, f_note, bar_w))) + 16
        heights.append(h)
        y += h
    y += PAD

    img = Image.new("RGB", (W, y), BG)
    d = ImageDraw.Draw(img)
    cy = 0
    for (kind, payload), h in zip(sections, heights):
        if kind == "header":
            d.rectangle([0, cy, W, cy + h], fill=SCARLET)
            d.text((PAD, cy + 34), "HEALTH & CONSISTENCY", font=f_title, fill=(255, 255, 255))
            d.text((PAD, cy + 100), payload, font=f_date, fill=(255, 255, 255))
        elif kind == "heading":
            d.text((PAD, cy + 30), payload, font=f_h, fill=SCARLET)
        elif kind == "score":
            s, b = payload
            if s is not None:
                d.text((PAD, cy + 8), f"{s}/100", font=f_score, fill=SCARLET)
                bw = d.textlength(b, font=f_band)
                d.text((W - PAD - bw, cy + 48), b, font=f_band, fill=GREY)
            else:
                d.text((PAD, cy + 30), f"Unavailable — {b}", font=f_band, fill=GREY)
        elif kind == "bars":
            yy = cy + 8
            for blabel, pts, mx in payload:
                d.text((PAD, yy), blabel, font=f_blabel, fill=DARK)
                ptw = d.textlength(f"{pts}/{mx}", font=f_bpts)
                d.text((W - PAD - ptw, yy), f"{pts}/{mx}", font=f_bpts, fill=DARK)
                yy += 44
                bx, bw, bh = PAD, bar_w, 22
                d.rounded_rectangle([bx, yy, bx + bw, yy + bh], radius=11, fill=TRACK)
                fill_w = int(bw * pts / mx)
                if fill_w > 0:
                    d.rounded_rectangle([bx, yy, bx + fill_w, yy + bh], radius=11, fill=SCARLET)
                yy += 48
        elif kind == "table":
            yy = cy + 6
            for k, v in payload:
                vl = wrap(d, v, f_v, bar_w - 380)
                rh = max(72, 18 + 40 * len(vl))
                d.rectangle([PAD, yy, W - PAD, yy + rh - 6], fill=ROW_BG)
                d.text((PAD + 16, yy + (rh - 36) // 2), k, font=f_k, fill=DARK)
                vy = yy + 10
                for ln in vl:
                    d.text((PAD + 380, vy), ln, font=f_v, fill=DARK)
                    vy += 40
                yy += rh
        elif kind == "body":
            yy = cy + 10
            for ln in wrap(d, payload, f_body, bar_w):
                d.text((PAD, yy), ln, font=f_body, fill=DARK)
                yy += 42
        elif kind == "note":
            yy = cy + 8
            d.text((PAD, yy), "•", font=f_note, fill=SCARLET)
            for ln in wrap(d, payload, f_note, bar_w - 40):
                d.text((PAD + 36, yy), ln, font=f_note, fill=GREY)
                yy += 38
        cy += h

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return out_path


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()
    target = datetime.strptime(arg, "%Y-%m-%d").date()
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else (
        Path.home() / "workspace" / "weekly-schedule" / "images" / f"health_{target.isoformat()}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    build_png(target, out)
    print(str(out))


if __name__ == "__main__":
    main()
