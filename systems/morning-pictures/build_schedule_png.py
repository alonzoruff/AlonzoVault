#!/usr/bin/env python3
"""AJ's daily schedule as a phone-friendly picture (PNG).

Usage: python3 build_schedule_png.py [YYYY-MM-DD] [output.png]
Defaults: today, ~/workspace/weekly-schedule/images/schedule_YYYY-MM-DD.png

Renders today's color-coded timeline + daily goals. No health data —
that ships in the 7:45 AM health PDF once Apple Health has synced.
"""
import sys
from datetime import datetime, date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_schedule_pdf import day_type, daily_goals, span, CATS  # noqa: E402

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

W = 1080
PAD = 48
BG = (255, 255, 255)
SCARLET = (166, 25, 46)
DARK = (51, 51, 51)
GREY = (107, 114, 128)
LIGHT_LINE = (229, 231, 235)

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
F_BOLD = lambda s: ImageFont.truetype(f"{FONT_DIR}/DejaVuSans-Bold.ttf", s)
F_REG = lambda s: ImageFont.truetype(f"{FONT_DIR}/DejaVuSans.ttf", s)


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


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
    label, blocks = day_type(target_date)
    goals = daily_goals(label, blocks, target_date.weekday(), target_date)

    f_title = F_BOLD(54)
    f_date = F_REG(32)
    f_daytype = F_REG(30)
    f_h = F_BOLD(36)
    f_time = F_BOLD(28)
    f_row = F_REG(28)
    f_goal = F_REG(30)
    f_note = F_REG(24)

    draw = ImageDraw.Draw(Image.new("RGB", (W, 10), BG))

    sections = []  # (kind, payload) — kinds: header, daytype, heading, row, goal, note, gap

    sections.append(("header", target_date.strftime("%A, %B %d, %Y")))
    sections.append(("daytype", label))
    sections.append(("heading", "SCHEDULE"))
    for s, e, text, cat in blocks:
        bg = hexrgb(CATS[cat][2])
        sections.append(("row", (span(s, e), text, bg)))
    sections.append(("heading", "DAILY GOALS"))
    for g in goals:
        sections.append(("goal", g))
    sections.append(("note", "Health & consistency report lands at 7:45 AM."))

    # measure
    row_time_w = 350
    label_w = W - PAD * 2 - row_time_w - 32
    y = 0
    heights = []
    for kind, payload in sections:
        if kind == "header":
            h = 170
        elif kind == "daytype":
            h = 40 * max(1, len(wrap(draw, payload, f_daytype, W - PAD * 2))) + 28
        elif kind == "heading":
            h = 92
        elif kind == "row":
            _, text, _ = payload
            lines = wrap(draw, text, f_row, label_w)
            h = max(76, 20 + 40 * len(lines))
        elif kind == "goal":
            lines = wrap(draw, payload, f_goal, W - PAD * 2 - 40)
            h = 16 + 42 * len(lines)
        elif kind == "note":
            h = 60
        heights.append(h)
        y += h
    y += PAD  # bottom padding

    img = Image.new("RGB", (W, y), BG)
    d = ImageDraw.Draw(img)
    cy = 0
    for (kind, payload), h in zip(sections, heights):
        if kind == "header":
            d.rectangle([0, cy, W, cy + h], fill=SCARLET)
            d.text((PAD, cy + 34), "AJ'S WEEK", font=f_title, fill=(255, 255, 255))
            d.text((PAD, cy + 100), payload, font=f_date, fill=(255, 255, 255))
        elif kind == "daytype":
            yy = cy + 14
            for ln in wrap(d, payload, f_daytype, W - PAD * 2):
                d.text((PAD, yy), ln, font=f_daytype, fill=GREY)
                yy += 40
        elif kind == "heading":
            d.text((PAD, cy + 30), payload, font=f_h, fill=SCARLET)
        elif kind == "row":
            tspan, text, bg = payload
            d.rectangle([PAD, cy + 4, W - PAD, cy + h - 4], fill=bg)
            d.text((PAD + 16, cy + (h - 36) // 2), tspan, font=f_time, fill=DARK)
            yy = cy + 12
            for ln in wrap(d, text, f_row, label_w):
                d.text((PAD + row_time_w + 32, yy), ln, font=f_row, fill=DARK)
                yy += 40
        elif kind == "goal":
            yy = cy + 8
            d.text((PAD, yy), "\u2022", font=f_goal, fill=SCARLET)
            for ln in wrap(d, payload, f_goal, W - PAD * 2 - 40):
                d.text((PAD + 40, yy), ln, font=f_goal, fill=DARK)
                yy += 42
        elif kind == "note":
            d.text((PAD, cy + 14), payload, font=f_note, fill=GREY)
        cy += h

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return out_path


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()
    target = datetime.strptime(arg, "%Y-%m-%d").date()
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else (
        Path.home() / "workspace" / "weekly-schedule" / "images" / f"schedule_{target.isoformat()}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    build_png(target, out)
    print(str(out))


if __name__ == "__main__":
    main()
