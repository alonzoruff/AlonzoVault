#!/usr/bin/env python3
"""Build the 100m/200m Sprint Training Plan PDF.

Adapted from Desmond Dunham's 400m training framework for the short sprints.
Usage: build_100_200_plan.py <output.pdf>
"""
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, HRFlowable, KeepTogether,
                                PageBreak)

ACCENT = colors.HexColor("#0b5cad")
DARK = colors.HexColor("#1f2328")
GRAY = colors.HexColor("#57606a")
LIGHT_BG = colors.HexColor("#f0f6fc")
RULE = colors.HexColor("#d0d7de")
WHITE = colors.white

S_TITLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=22,
                         leading=26, textColor=DARK, spaceAfter=4)
S_SUB = ParagraphStyle("sub", fontName="Helvetica", fontSize=11, leading=15,
                      textColor=GRAY, spaceAfter=12)
S_H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, leading=19,
                      textColor=ACCENT, spaceBefore=14, spaceAfter=6)
S_H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, leading=16,
                      textColor=DARK, spaceBefore=10, spaceAfter=4)
S_BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=10,
                        leading=14.5, textColor=DARK, spaceAfter=6)
S_BULLET = ParagraphStyle("bullet", parent=S_BODY, leftIndent=18,
                          firstLineIndent=0, spaceAfter=3,
                          bulletIndent=8)
S_NOTE = ParagraphStyle("note", parent=S_BODY, textColor=GRAY, fontSize=9.5,
                        leading=13.5, spaceAfter=6)
S_CELL = ParagraphStyle("cell", fontName="Helvetica", fontSize=9,
                        leading=12.5, textColor=DARK)
S_CELL_B = ParagraphStyle("cellb", parent=S_CELL, fontName="Helvetica-Bold")
S_CELL_H = ParagraphStyle("cellh", parent=S_CELL, fontName="Helvetica-Bold",
                          textColor=WHITE, fontSize=9.5)
S_CENTER = ParagraphStyle("center", parent=S_BODY, alignment=TA_CENTER,
                          textColor=GRAY, fontSize=9)


def bullet(text):
    return Paragraph(text, S_BULLET, bulletText="\u2022")


def phase_table(rows):
    data = [[Paragraph("Day", S_CELL_H), Paragraph("Session", S_CELL_H),
             Paragraph("Details", S_CELL_H)]]
    for day, session, details in rows:
        data.append([Paragraph(day, S_CELL_B), Paragraph(session, S_CELL),
                     Paragraph(details, S_CELL)])
    t = Table(data, colWidths=[0.85 * inch, 2.0 * inch, 4.15 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def main(out):
    doc = SimpleDocTemplate(out, pagesize=letter,
                            leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.7 * inch, bottomMargin=0.7 * inch)
    story = []
    A = story.append

    A(Paragraph("100m / 200m Sprint Training Plan", S_TITLE))
    A(Paragraph("Phased training for the short sprints, adapted from Desmond "
               "Dunham's 400m training framework (Woodrow Wilson SHS). "
               "The 400m is a controlled sprint built on a fitness base; the "
               "100m and 200m keep that base but shift the emphasis to "
               "acceleration, maximum velocity, and short speed endurance.",
               S_SUB))
    A(HRFlowable(width="100%", thickness=1, color=RULE, spaceAfter=8))

    A(Paragraph("How the 100/200 Differs from the 400", S_H1))
    A(Paragraph("The 400m plan's five health-related components still apply: "
                "muscular endurance, muscular strength, cardio-respiratory "
                "fitness, flexibility, and body composition. What changes is "
                "the stress profile:", S_BODY))
    A(bullet("<b>Speed endurance gets shorter.</b> Replace 300s, 500s, and "
             "600s with 80-150m repeats, split runs, and fly runs. Total "
             "work per session stays in the 200-500m range."))
    A(bullet("<b>Acceleration and max velocity move to the front.</b> Block "
             "starts, 10-40m drives, and 20-40m fly runs are trained year "
             "round, at least once every 10 days, and only when fresh."))
    A(bullet("<b>Recovery gets longer.</b> Full recovery (5-12 minutes) "
             "between high-quality reps protects top-end speed."))
    A(bullet("<b>Curve running is a 200m skill.</b> It must be practiced, "
             "not assumed."))

    # ---------------- Phase 1 ----------------
    A(Paragraph("Phase 1: Base / General Preparation (4-6 weeks)", S_H1))
    A(Paragraph("<b>Goal:</b> Build the fitness base that lets athletes "
                "handle real sprint training without breaking down. "
                "Emphasis on work capacity, general strength, acceleration "
                "mechanics, and tempo.", S_BODY))
    A(phase_table([
        ("Mon", "Acceleration + Weights",
         "Block starts and 10-30m drives (6-8 reps, full recovery). "
         "Weights: moderate, 3-4 x 10-12 reps."),
        ("Tue", "Tempo + Circuits",
         "Extensive tempo: 8-10 x 100m at ~70% with 30-45 sec recovery. "
         "Full-body circuit, core, mini-band drills."),
        ("Wed", "Recovery",
         "Rest or light activity: easy jog, foam roll, static stretch."),
        ("Thu", "Hills + Weights",
         "Hill repeats 60-100m (6-8 reps). Weights: moderate, 3-4 x 10-12."),
        ("Fri", "Tempo + Plyos (low)",
         "6-8 x 100m tempo. Low-impact plyos: pogos, box step-ups, "
         "hurdle walkovers."),
        ("Sat", "Rest", "Full rest."),
        ("Sun", "Rest / Light", "Optional easy 15-20 min jog."),
    ]))
    A(Paragraph("Sample base workouts: 10 x 30-90 sec tempo runs with 1-2 "
                "min recovery; 6-8 x 2-3 min moderate runs; fartlek up to "
                "30 min (e.g., 1-1-2-2-2-2-1-1 with 1 min recovery); "
                "6-12 x 400m fartlek mixing walk, jog, stride, and sprint "
                "100s.", S_NOTE))

    # ---------------- Phase 2 ----------------
    A(Paragraph("Phase 2: Pre-Competitive / Speed Development (4 weeks)",
               S_H1))
    A(Paragraph("<b>Goal:</b> Develop top-end speed and the power to reach "
                "it. Volume drops, intensity rises, recoveries lengthen.",
                S_BODY))
    A(phase_table([
        ("Mon", "Max Velocity",
         "Fly runs: 20m build + 20-40m fly (4-6 reps, 6-8 min recovery). "
         "Ins-and-outs: 30-30-30m (blast, float, blast)."),
        ("Tue", "Weights + Tempo",
         "Weights: heavier, 3-4 x 6-8 reps. Easy tempo 6 x 100m for "
         "recovery."),
        ("Wed", "Recovery", "Rest or light movement and mobility."),
        ("Thu", "Acceleration + Power",
         "Block starts to 30-40m (5-6 reps). Sled or harness pulls "
         "2 x 20-40m, then 2 x 30-50m free sprints. High-impact plyos."),
        ("Fri", "Short Speed Endurance",
         "3-4 x 120-150m at 90-95% with 6-8 min recovery, or 2 x (120m + "
         "80m) split runs."),
        ("Sat", "Rest / Competition",
         "Rest, or an early-season low-key meet."),
        ("Sun", "Rest", "Full rest."),
    ]))
    A(Paragraph("Speed endurance ladder for this phase (low to moderate "
                "anaerobic stress): 4-6 x 100m accelerations to 90% (1-2 min "
                "rest); 8 x 200m fast and relaxed with 100m walk / 100m jog "
                "recovery; 5-6 x 300m build-ups only for 200m runners early "
                "in the phase.", S_NOTE))

    # ---------------- Phase 3 ----------------
    A(Paragraph("Phase 3: Competitive (4-6 weeks)", S_H1))
    A(Paragraph("<b>Goal:</b> Race modeling and sharpening. Sessions get "
                "faster and more specific; total volume stays low and "
                "recoveries stay long.", S_BODY))
    A(phase_table([
        ("Mon", "Race Modeling",
         "100m: block start to 60m (4 reps). 200m: block start through the "
         "curve to 80-120m (3-4 reps). Full recovery."),
        ("Tue", "Weights (maintenance)",
         "Moderate load, 2-3 x 6-8 reps. Keep it short."),
        ("Wed", "Recovery", "Rest or light tempo."),
        ("Thu", "Speed Endurance (fast)",
         "2-3 x 150m at 95-100% with 10-12 min recovery, or 1 x 200m + "
         "1 x 120m at race effort."),
        ("Fri", "Pre-meet",
         "Light block starts (3 x 20m), strides, mobility."),
        ("Sat", "Competition", "Race day."),
        ("Sun", "Rest", "Full rest."),
    ]))
    A(Paragraph("Broken-run race simulations: 200m fast, jog across the "
                "field, 200m fast; 300m fast, jog 100m, 100m fast; 100m "
                "fast, jog 100m, 300m fast. For the 200m: 150m simulations "
                "x 3-4 (100m push, 50m power).", S_NOTE))

    # ---------------- Phase 4 ----------------
    A(Paragraph("Phase 4: Championship / Peaking (2-3 weeks)", S_H1))
    A(Paragraph("<b>Goal:</b> Arrive fresh. Fitness is banked; this phase "
                "protects it.", S_BODY))
    A(phase_table([
        ("Mon", "Speed / Technique (light)",
         "3-4 x 30m fly runs or block starts. Nothing to exhaustion."),
        ("Tue", "Rest / Light", "Easy movement, mobility, massage/foam roll."),
        ("Wed", "Speed Endurance (light)",
         "2 x 120m at 90% with full recovery, or strides only."),
        ("Thu", "Rest", "Full rest."),
        ("Fri", "Pre-meet", "Starts, strides, shakeout."),
        ("Sat-Sun", "Championship racing",
         "2-3 days competition; light shakeout between rounds."),
    ]))

    # ---------------- Race models ----------------
    A(Paragraph("Race Execution Models", S_H1))
    A(Paragraph("<b>100m:</b> Drive phase (0-30m, aggressive push from the "
                "blocks) - Transition (30-60m, gradually rise to upright) - "
                "Maximum velocity (60-80m, relaxed sprinting, fast turnover) "
                "- Maintenance (80-100m, hold form, commit to the line).",
                S_BODY))
    A(Paragraph("<b>200m:</b> Attack the curve (0-50m, strong drive with "
                "lean) - Float the turn (50-110m, relaxed speed, maintain "
                "lane position) - Transition off the curve - Attack the "
                "home straight (110-200m, re-accelerate and hold).",
                S_BODY))
    A(Paragraph("Predicting times: average the athlete's 3-5 best 200m "
                "efforts, double it, and add roughly 4 seconds for a 400m "
                "target; for the 100/200, the goal is to run one 200m "
                "within 1-1.5 seconds of average best.", S_NOTE))

    # ---------------- Warm-up ----------------
    A(Paragraph("Standard Warm-Up Protocol (every session)", S_H1))
    A(Paragraph("Never skip the warm-up. The full routine takes 20-25 "
                "minutes before speed work, 12-15 before tempo.", S_BODY))
    A(Paragraph("Part A: General Warm-Up (8-10 minutes)", S_H2))
    A(bullet("<b>Jog 800m</b> easy, finishing with 4 x 60m progressive "
             "strides (each one slightly faster, last one near 80%)."))
    A(bullet("<b>Skipping series</b> x 20m each: regular skip, skip with "
             "arm swing, skip for height, skip for distance."))
    A(Paragraph("Part B: Dynamic Stretches (10-12 minutes)", S_H2))
    A(Paragraph("Move continuously through each drill over 15-20 meters "
                "unless noted. 1 x 10 reps per side for stationary drills.",
                S_NOTE))
    A(bullet("<b>Forward leg swings</b> (stationary, hold a fence): 10 per "
             "leg, swing the full range from hip flexor stretch to "
             "hamstring stretch. Cue: tall posture, no trunk swing."))
    A(bullet("<b>Lateral leg swings</b> (facing the fence): 10 per leg, "
             "open and close across the body. Cue: hips stay square."))
    A(bullet("<b>Walking knee hugs:</b> pull the knee to the chest, rise "
             "onto the toe of the stance leg. Opens the glute and hip."))
    A(bullet("<b>Walking quad pulls:</b> grab the ankle, pull the heel to "
             "the glute, reach tall with the opposite arm."))
    A(bullet("<b>Walking lunges with twist:</b> deep lunge, rotate the "
             "torso over the front knee. Cue: front knee tracks over the "
             "ankle."))
    A(bullet("<b>Inchworms:</b> walk hands out to a plank, walk feet to "
             "hands, stand. Keep legs straight to load the hamstrings."))
    A(bullet("<b>A-skips:</b> skip with high knee drive, dorsiflexed toe, "
             "pawing foot strike under the hip. Cue: down, not out."))
    A(bullet("<b>B-skips:</b> extend the knee out, then paw back down "
             "under the hip. Teaches the full sprint cycle."))
    A(bullet("<b>High knees:</b> rapid knee drive, upright torso, fast "
             "ground contact. 20m x 2."))
    A(bullet("<b>Butt kicks:</b> heels to glutes with quick turnover, "
             "knees pointing down. 20m x 2."))
    A(bullet("<b>Straight-leg bounds:</b> long strides with straight legs, "
             "striking the ground under the hips. Hamstring and hip "
             "flexor primer."))
    A(bullet("<b>Karaoke (grapevine):</b> lateral crossover steps both "
             "directions. Opens the hips for curve running."))
    A(bullet("<b>Hip circles:</b> lift the knee to 90 degrees, rotate it "
             "out and around, 5 each direction per leg."))
    A(bullet("<b>Ankle dribbles:</b> short, quick steps staying on the "
             "balls of the feet, 20m. Wakes up the calves and Achilles."))
    A(Paragraph("Part C: Event-Specific (5 minutes)", S_H2))
    A(bullet("<b>Sprinters:</b> 2-3 x 20-30m accelerations from blocks or "
             "a standing start, building to near full speed."))
    A(bullet("<b>200m runners:</b> 1-2 curve accelerations (60-80m) to "
             "rehearse lean and lane discipline."))
    A(Paragraph("Cool-down: 800m easy jog, then static stretching held "
                "20-30 seconds per muscle group (hamstrings, quads, hip "
                "flexors, calves). Foam roller, massage roller, or lacrosse "
                "ball work on problem spots.", S_NOTE))

    A(Spacer(1, 0.15 * inch))
    A(HRFlowable(width="100%", thickness=1, color=RULE, spaceAfter=8))
    A(Paragraph("Built for the Cadets sprint group. Base framework credit: "
                "Desmond Dunham, 400m Training (USTFCCCA). Train fast only "
                "when fresh; race with a plan.", S_CENTER))

    doc.build(story)
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1])
