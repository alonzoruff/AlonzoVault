# Design System: Cadets Sprint — SJC Track & Field

**Skill:** stitch-design-taste · **Product:** Sprinter Workout App (St. John's College High School — Cadets Track & Field)
**Feel:** Sporty performance platform in the TeamBuildr mold — a weight-room HUD crossed with a timing console. Built for a coach running a session off an iPad and athletes checking in from their phones. Official SJC colors are locked: Scarlet is the one and only brand accent. Creativity goes into typography, lane geometry, and data presentation — never into new colors.

---

## Configuration — Set Your Style

| Dial | Level | Why here |
|------|-------|----------|
| **Creativity** | `9` | Full meet-day identity on brand surfaces: poster-scale jersey type, Floodlight scoreboard panels, lane geometry, diagonal banner cuts, and the runner as a living backdrop. Data still behaves; the frame around it is unmistakably designed. |
| **Density** | `7` | Cockpit-leaning. Coaches scan rosters, marks, and readiness for a whole squad at once. Data is the decoration. |
| **Variance** | `7` | Structured where data lives (grids stay grids — athletes' times must line up), boldly asymmetric where identity lives (headers, hero bands, sign-in, empty states get diagonal lane cuts and offset type). |
| **Motion Intent** | `7` | Sport is motion. Spring-physics feedback, a runner in stride, live count-ups on the TV board — but every animation must survive a sunlit weight room and a school iPad. |

---

## 1. Visual Theme & Atmosphere

A floodlit track at night rendered as software. The whole shell wears the Floodlight frame — a dark SJC header, scarlet lane accents, jersey-banner section headers, and a scarlet active navigation slab — while light working surfaces (Canvas Mist, Pure Surface cards) sit inside that frame for daily workflow. Deep HUD panels take over wherever performance is live: the Today scoreboard, sign-in poster, workout runner, weight-room TV board, and record boards. The mood is "meet day, organized": bold condensed type like a jersey back, lane lines as structural rules, every number treated like a split time — precise, monospaced, earned. Scarlet appears the way it does on a uniform: as the signal color, and it always means *go, now, this one*.

Density is balanced-high (Level 7): coach screens are control panels, athlete screens breathe a little more. Variance runs high on identity surfaces (Level 7): data grids are ruthlessly aligned; brand moments — the Today scoreboard, sign-in poster, Run button, section banners, and empty states — break the grid with diagonal cuts and oversized numerals. Motion is fluid and physical (Level 7): springs, strides, and count-ups, all hardware-accelerated, all honoring reduced-motion settings.

## 2. Color Palette & Roles

*Locked to the existing app palette. Scarlet is the single accent — no second brand color is permitted, ever.*

- **Canvas Mist** (#F6F6F7) — App background surface. Cool neutral, never warm
- **Pure Surface** (#FFFFFF) — Card and container fill on light surfaces
- **Cadet Ink** (#1C1C1E) — Primary text. Off-black, never pure black
- **Cadet Gray** (#8A939F) — The official SJC gray. Secondary brand tone: wordmark, metadata, inactive states
- **Muted Steel** (#68707B) — Small text and captions on light surfaces (the accessible step down from Cadet Gray)
- **Hairline** (#E3E3E6) — Card borders and structural 1px lines on light surfaces
- **Scarlet** (#CC0033) — THE accent. Primary actions (the Run button), active states, PR moments, focus rings. If everything is scarlet, nothing is
- **Scarlet Deep** (#990026) — Pressed/active depth for scarlet elements; gradient floor for the Run button
- **Floodlight Charcoal** (#101216) — HUD surface: runner mode, TV board, record board panels
- **HUD Line** (#2C313A) — Borders and lane rules on HUD surfaces
- **HUD Dim** (#C9CCD1) — Secondary text on HUD surfaces
- **Scarlet On Dark** (#FF7086) — Scarlet's voice on HUD surfaces (links, live indicators) where #CC0033 lacks contrast
- **Scarlet Soft On Dark** (#FFB3C2) — Highlights, PR badges, and soft emphasis on HUD surfaces

**Functional data colors — data semantics only, never decoration or branding:**
- **High Load** (#B3271E on #FDECEB) — CNS-high days, flagged wellness, hard intensity
- **Low / Go** (#1E7A34 on #E9F7EC) — Low-load days, cleared status, readiness green

### Banned Colors
- Any second brand accent (no blue links, no gold trophies, no purple anything)
- Pure black (#000000) — Cadet Ink and Floodlight Charcoal only
- Neon glows and oversaturated accents above 80% saturation
- Warm/cool gray drift — the gray family is Cadet Gray's, everywhere

## 3. Typography Rules

- **Display:** `Archivo` (Expanded weights for banners) — the jersey voice. Uppercase, track-tight (-0.02em), weight 800. Section headers read like the back of a warm-up shirt: TODAY, TRAIN, RECORDS. Fluid scale via `clamp()`, never screaming — hierarchy through weight and scarlet, not raw size
- **Body:** `Archivo` at weight 400–500 — Relaxed leading (1.55), 65ch max line length, Cadet Ink on light, HUD Dim on dark
- **Mono:** `JetBrains Mono` — ALL numbers that represent performance: times, marks, loads, percentages, dates, streaks. A 10.87 is a split time and must look like one. At this density, tabular numerals are non-negotiable — columns of marks align to the hundredth
- **The Big Numeral:** personal bests, readiness scores, and record marks may render as oversized mono display (up to 3.5rem) — a number an athlete earned gets presented like a scoreboard, not a spreadsheet cell
- **Banned:** Inter. Generic serifs anywhere (this is a sports platform, not a newspaper). Italic display type. Letter-spaced lowercase labels — labels are uppercase, tight, and short

## 4. Component Stylings

* **The Run Button:** the signature component. Full-width scarlet slab, minimum 64px tall, uppercase Archivo Expanded 800, a play chevron and today's session code in mono ("▶ RUN — ACC-01"). Subtle Scarlet-to-Scarlet-Deep vertical depth, -1px translate on press, spring return. It should feel like stepping onto the track: one tap, no dialog, you're running
* **Buttons:** Flat, no outer glow. Primary = scarlet fill, white text. Secondary = ghost with Hairline border. Every target ≥ 44px (chips 40px minimum, check-in rows 44px)
* **Cards:** 14px radius, Pure Surface, 1px Hairline border, whisper shadow only. Elevation is earned: the next-workout card and flagged-wellness card may lift; data rows may not
* **Lane Rules:** section dividers are track lanes — a 1px Hairline rule with a 24px scarlet segment at its left edge, like a lane number marking. On HUD surfaces, HUD Line with Scarlet On Dark segment
* **Athlete Rows:** name in Archivo 600, group chip in Cadet Gray, today's status as a mono pill (mark, check-in state, streak). Flagged rows get a High Load left border — 3px, unmissable at a glance across a weight room
* **Check-In Controls:** big segmented tap rows (Sleep / Soreness / Energy), 44px, selected state is scarlet fill with white text — a selection must be visible from arm's length. Nothing is ever pre-selected: an athlete's data starts empty and honest
* **Inputs/Forms:** Label above, mono for any numeric entry (marks, loads, times), error text below in High Load. Focus ring scarlet, 2px offset
* **Loaders:** Skeletal shimmer shaped like the real layout — roster-row skeletons, card skeletons. No circular spinners anywhere
* **Empty States:** composed like a blank lane assignment sheet — lane-rule header, one line of guidance ("No marks yet — the board is waiting"), one action. Never a naked "No data"
* **TV Board:** Floodlight Charcoal end to end. Group name as a jersey banner, the workout in full, type scaled to the room (nothing under 18px effective), a freshness stamp under the clock, and a scarlet "connection lost" warning state — the board must never silently lie

## 5. Layout Principles

- **Grid-First:** CSS Grid for all structural layouts; data columns align like lanes in a final — every athlete's mark in the same column, to the pixel
- **The Split Identity:** athlete-facing headers (Today, session detail) use an asymmetric split — oversized mono date/score on the right, title left — while coach data grids stay strictly symmetric. Identity breaks the grid; data never does
- **No 3-Equal-Cards:** feature and summary rows use a 2fr/1fr scoreboard split (the big number gets the big lane) or a horizontal lane-scroll
- **Containment:** max-width 1400px on desktop; phone and iPad are the primary canvases — design 390px and 768px first, widen second
- **Full-Height:** runner and TV surfaces use `min-height: 100dvh` — never `100vh`
- **Safe Areas:** bottom tab bar clears the home indicator with safe-area padding; nothing tappable ever hides under it

## 6. Motion & Interaction

> Stitch generates static screens — this section is the contract for whoever builds them live.

- **Physics:** spring exclusively (`stiffness: 100, damping: 20`). No linear easing. Buttons push, cards settle, tabs snap like a starting block releasing
- **The Runner:** one animated sprinter is the brand's living logo — a 12-second master cycle: block start (set, drive phase rising) into full stride, arms and legs in strict contralateral sync (opposite arm, opposite leg — a runner's form is not negotiable). Used on Today and the runner; cadence quickens subtly on CNS-high days. Under reduced-motion it holds a single mid-stride pose, blocks visible
- **Perpetual Micro-Loops:** only where live data justifies them — a pulsing live dot on the TV board clock during a session, shimmer on loading skeletons, a soft pulse on a new PR badge for its first view. Restraint is the rule: if it isn't live, it doesn't loop
- **Staggered Reveals:** lists cascade at 40ms per row (faster than editorial systems — this is sport), never blocking first paint of the header
- **Hardware Rules:** animate `transform` and `opacity` only. Never width/height/top/left. 60fps on a school iPad is the acceptance test, not a hope

## 7. Anti-Patterns (Banned)

- No emojis in UI (the one exception already in the product: none — keep it that way)
- No Inter, no generic serifs, no italic display type
- No pure black (#000000), no neon glows, no gradient text on headers
- No second brand color — scarlet or gray scale, functional red/green for data only
- No centered hero layouts — headers split or offset, always
- No 3-column equal card rows
- No filler UI text: "Scroll to explore", "Swipe down", bouncing chevrons
- No generic names: athletes are Cadets with real marks, never "John Doe / Acme"
- No fake round numbers: readiness is 87, a mark is 10.87, a streak is 6 days — organic, earned figures only
- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen" — the voice is a coach's: short, plain, direct
- No overlapping elements — clean spatial zones; type never sits on photography except the TV board's group banner, where a charcoal scrim guarantees contrast
- No circular loading spinners — skeletal shimmer only
- No pre-filled athlete data of any kind — check-ins, marks, and logs start empty; the app records what happened, never what usually happens
- No health data on the TV board — assignments and the workout only, in any design, ever
