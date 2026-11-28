# AlonzoVault

AJ Ruffin's private repo: his apps, plus teaching, coaching, CSCS, and
life systems. Private. Every change is saved in the history, so no file
is ever lost and any change can be rolled back.

**New here? Start with [How a change ships](docs/HOW-A-CHANGE-SHIPS.md).**
It explains, step by step, how an idea becomes a change on the live site.

## The apps

Each app lives in its own folder, has its own README, and runs as its
own website. They share no accounts, data or settings.

| App | Folder | What it is | Where it runs |
|---|---|---|---|
| AYG Lab | `business/coaching-app/` | Members' site for AJ's speed and strength coaching business (formerly Ruffin Performance) | Render, service `ruffin-performance` |
| Sprinter Workout App | `track/sprinter-web-app/` | Coaching tool for the school track program's sprinters, hurdlers and jumpers | Render, service `sprinter-workout-app` |
| AJ Command Portal | `portal/` | AJ's game-style phone dashboard that Luna keeps up to date | See its README |
| Govee Lights | `govee-site/` | Small site for controlling AJ's Govee lights from a wall iPad | See its README |

A move of AYG Lab and the sprinter app from Render to Vercel is being
planned. Render stays the live home until AJ decides.

## Everything else

| Folder | What it holds |
|---|---|
| `sports-med/` | Sports Med class materials: lecture decks (generators), worksheets, rubrics, assignments |
| `track/` | Track and field: training plans, the season plan, and the sprinter app |
| `track/sprinter-workout-database/` | Searchable database of sprint sessions; the sprinter app copies its content from here |
| `cscs/` | CSCS exam prep: study plan, resource pack, quiz data |
| `life-admin/` | Budget, templates, personal systems (no passwords, no sensitive ID numbers, ever) |
| `systems/morning-pictures/` | The builders behind AJ's two daily morning pictures |

## Rules for this repo

- Private, always. No student or athlete personal information (names with marks/grades/health data stay out).
- No passwords, API keys, or account numbers. Those live in the Secure Vault, and an app's secret settings are typed into its host (Render), never into the repo.
- Big files (textbook PDFs, photo libraries) do not belong here; this is for text, data, and code. The `.gitignore` file blocks PDFs, images and Office files for that reason.
- Every meaningful change gets a clear commit message, so the history reads like a logbook.
- Changes reach `main` through a pull request that AJ approves. See [How a change ships](docs/HOW-A-CHANGE-SHIPS.md).
