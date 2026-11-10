# Protocols content guide

Protocols pages are built from `content/protocols.json`. To add or change a protocol, run the importer on Char's draft (or edit that file) and redeploy. No code changes.

## The usual way: the importer

```
node scripts/protocols-import.js "Protocol - Hip Opening.md"
node scripts/protocols-import.js --dry-run *.md        (shows what would change, writes nothing)
node scripts/protocols-report.js                        (checks the file, prints the video gaps)
```

The importer reads Char's draft format. The headings must match:

| In the draft | Becomes |
|---|---|
| `# Protocol: <title>` | the title (the id is the title as a slug) |
| `## What this means` | Definitions (plain text) |
| `## Before you start` | a guardrail callout shown before the weeks |
| `## Coach check before moving on` | a guardrail callout shown before the weeks |
| `## Week-by-week plan` with `### <Label>: <title>` | one card per week. The words before the colon are the week label |
| `What to do:` and `Before moving on:` under each week | the week's text, and the line that gates the next week |
| `## Trainer guardrails` | a guardrail callout shown after the weeks |
| `## For the app` | an internal note. Kept in the file, never shown to anyone |

An unknown heading, a week missing "What to do" or "Before moving on", or anything that fails validation stops the run and writes nothing. It says why.

Re-running on an edited draft updates the words. It never touches status, order, group, summary, verified_by, verified_on, or the video slots on each week. A protocol new to the file arrives as `draft`, which no reader sees until it is set to `published`.

## The file

```json
{
  "intro": "Optional standing line shown above the list.",
  "trainer_line": "Optional standing athletic trainer line, shown on the list and on every page.",
  "protocols": [ ...one object per protocol... ]
}
```

Leave either standing line empty and it does not show.

## One protocol

| Field | Required | Notes |
|---|---|---|
| id | yes | lowercase with dashes. Never changes once live. |
| title | yes | The name on the list and the page. |
| status | yes | `placeholder` (shell text), `draft` (Char's text, not checked), `published` (live), `retired` (hidden). |
| order | no | Whole number. Lower shows first. |
| group | no | A heading to group list cards under. |
| summary | no | One or two sentences for the list card. Without it the card shows the first sentence of Definitions. |
| definitions | yes | Plain text (the importer's form), or a list `[{ "term": "...", "meaning": "..." }]`. |
| guardrails | no | `[{ "text": "...", "label": "Before you start", "place": "before_weeks" }]`. `place` is `top` or `before_weeks` (both show after Definitions, before the weeks) or `end` (after the last week, the default). `label` is the callout heading, default "Trainer guardrail". |
| weeks | yes | One object per card, in order. |
| internal_note | no | Never leaves the server. |
| verified_by, verified_on | published: yes | Who checked it, and `YYYY-MM-DD`. verified_by is never shown. verified_on shows as "Checked <date>". |
| updated, update_note | no | Shown under the page. |

## One week

| Field | Required | Notes |
|---|---|---|
| week | yes | 1, 2, 3 ... in order, no gaps. |
| label | no | What the card and the jump chip say, for example "Weeks 3 to 4". Default "Week N". |
| title | no | Short name for the week. |
| goal | no | What the week is for. |
| what_to_do | one of these two | The week's plan as text. Shown under a "What to do" label. |
| steps | one of these two | Numbered steps `{ "text", "dose"?, "guardrail"?, "video"? }`, for content that is written as steps. |
| videos | no | Video slots for the whole week (see below). |
| guardrails | no | `["text", ...]`, a callout inside the week. |
| advance_when | every week but the last | What has to be true before moving on. Its own line, labelled "Before moving on" ("Before you finish" on the last week). |

## A video slot

```json
{ "label": "90/90 hip switches", "shows": "What the clip should show, in plain words.", "url": "https://www.youtube.com/watch?v=...", "approved": false, "caption": "optional" }
```

Slots go in a week's `videos` list, or on a step as `video`. Add one only where a good video exists.

- `shows` is required. It is what AJ films or approves against.
- No `url`: the slot shows a dashed "Video needed" marker with the label and the `shows` text.
- A `url` with `approved` missing or false: "Video waiting for approval". The link is never sent to phones.
- A `url` with `"approved": true`: the clip plays. YouTube links use the app's usual privacy player. Any other https link plays as a video file.
- Setting `approved` to true is Luna's step, after AJ says yes.

## Text rules

Plain text only. A blank line makes a new paragraph. No HTML, no markdown. Anything typed is shown as written.

## Switches (Render environment settings)

- `PROTOCOLS_ENABLED=1` turns the section on. Unset means it does not exist: no nav item, no menu row, the API answers 404.
- `PROTOCOLS_SHOW_UNPUBLISHED=1` also shows `draft` and `placeholder` entries, tagged "Not published yet". Staging and QC only. Leave it off live, so only `published` protocols ever show. If none are published the section stays invisible.
