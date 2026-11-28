# AJ Command Portal (hosted)

## Start here

**What it is:** AJ's personal dashboard for his phone, built like a game. AJ is the hero, each part of his life is a "land", and tasks are quests that earn XP and open new lands. AJ ticks quests and sends messages to the team from it. Luna keeps the quests, plans and status lines up to date through a private, key-protected connection.

**What it is not:** it has nothing to do with AYG Lab or the sprinter app. It shares no code, accounts or data with either.

**Where its data lives:** one file, `portal.json`, in the folder the `DATA_DIR` setting names, with the previous copy kept as `portal.json.bak`. It is never in GitHub.

**Where it runs:** the steps for Render are below. Whether it is running on Render right now is not recorded in the repo.

**Run it, test it:** see "Run it" below. Tests: `npm test` (or `node tests/portal-tests.js`) from this folder.

**How a change gets to the live site:** see [How a change ships](../docs/HOW-A-CHANGE-SHIPS.md).

The rest of this page is the technical detail.

Node 18 or newer, no dependencies, one process.

## Run it

    cd portal
    PORTAL_KEY=<long random> LUNA_KEY=<a different long random> node server.js

Open `http://localhost:3000/?key=<PORTAL_KEY>` once. The portal sets a cookie and drops the key from the address bar.

Environment variables

| Name | What it does |
|---|---|
| PORTAL_KEY | Opens the portal for AJ. At least 16 characters. Without it nobody gets in. |
| LUNA_KEY | Luna sends it in an `x-luna-key` header. Opens her endpoints only. At least 16 characters, and not the same as PORTAL_KEY. |
| DATA_DIR | Folder for `portal.json` and `entries.json`. Default is `./data` next to server.js. |
| PORT | Default 3000. Render sets it for you. |
| COOKIE_SECURE | Set to `1` to always mark the login cookie as https-only. Without it, the cookie is https-only whenever the request came in over https (as on Render). |

Make keys with `openssl rand -hex 24`. Never put either key in the repo.

Tests: `node tests/portal-tests.js` (boots the server on a test port with a throwaway folder and a movable clock, 65 checks). On main on Nov 24, 2026, 64 pass and 1 fails: the check that the home-screen icon `/icon-180.png` loads. See "Known gap" at the bottom.

## Render

1. New Web Service, root directory `portal`, runtime Node 18 or newer, build command empty, start command `node server.js`.
2. Add a persistent disk (1 GB is plenty), mount path `/var/data`, and set `DATA_DIR=/var/data`. Without a disk, every deploy wipes AJ's progress and messages.
3. Set `PORTAL_KEY` and `LUNA_KEY` in the Render environment.
4. Health check path `/healthz`. It returns `{"ok":true}` and nothing private.
5. Keep it to one instance. The data is one JSON file, so two instances would overwrite each other.
6. AJ's link is `https://<service>.onrender.com/?key=<PORTAL_KEY>`. Send it to him once, then he adds the page to his home screen. If the home screen version ever shows the locked page, the page has a key field: paste the key once.

`portal.json` is written to a temp file and renamed over the old one, and the previous copy is kept as `portal.json.bak`. If `portal.json` ever cannot be read, the server refuses to start and leaves the file alone, so nothing gets silently reset.

## What is in the data file

Three separate sections: `content` (everything Luna edits), `progress` (AJ's ticks, daily habits, bonuses, opened lands) and `outbox` (his messages). Luna's endpoints only write `content` and message statuses, so nothing she does can overwrite his progress.

## How the game works

* Level n needs 30 + 10n XP to reach level n+1 (40, then 50, 60 and so on).
* XP is set by Luna on each quest. The request that ticks a quest cannot change it.
* Lands branch: Health opens School and Track and Personal (2 cleared quests); School and Track opens The Lab (2); The Lab or Personal opens Money and Admin (1). Opening is permanent. The thresholds are data, set per land.
* A deadline due within 7 days, or an event happening today, shows in the Today strip and can be done even if its land is locked. It still counts toward its own land.
* An event cannot be ticked before its day (a range, before its last day). `opens` on a quest overrides that.
* Daily quests (`repeat: daily`) pay their small XP once a day and never count toward unlocking. Any day with a daily habit kept fills a segment on the weekly dial. Five of seven days pays +20 XP when Sunday arrives, once per week. The best week is saved and nothing ever resets.
* Luna's pick for the day (`focus`) earns +5 XP once if AJ completes it that day.
* The morning briefing shows once a day, when Luna has a pick, something due soon (3 days), or an overnight line. Tapping the button, the backdrop, Escape, or any tab dismisses it for the day.
* AJ can undo a tick on the day he made it, for mis-taps. Opened lands stay open.

## Talk to the Party

AJ sends a message and it is saved on the server at once with status `new`. Statuses and what AJ reads:

| Status | Label under his message |
|---|---|
| (on the phone, not yet saved) | Sending |
| new | Saved. Luna has not opened it yet. |
| picked_up | With Luna |
| routed | Sent to Claude (or Char) |
| working | Claude is on it |
| waiting | Waiting on you |
| done | Done |

A status changes only when Luna, or an owner using the same key, sets it. Reading the outbox changes nothing. If the phone is offline, the message waits on the phone ("Not sent yet") and sends itself when the connection is back, once, even if the request is retried. AJ can withdraw a message while it is still `new`.

## Luna's endpoints

Every call carries `x-luna-key: $LUNA_KEY` and a JSON body where one is needed. Replace the host with the real one.

    # read the outbox, oldest first. Optional: status=new,picked_up  since=<ISO time>  limit=<n>
    curl -H "x-luna-key: $LUNA_KEY" "$HOST/api/outbox?status=new"

    # set a status and/or reply. status: picked_up, routed, working, waiting, done
    curl -X POST -H "x-luna-key: $LUNA_KEY" -H "content-type: application/json" \
      -d '{"status":"routed","routedTo":"Char"}' "$HOST/api/outbox/<id>/status"
    curl -X POST ... -d '{"status":"done","by":"Char","reply":"Flyer is final."}' "$HOST/api/outbox/<id>/status"

    # Oura (numbers 0 to 100, or null)
    curl -X PUT ... -d '{"asOf":"Night of Nov 3-4","sleep":81,"readiness":77}' "$HOST/api/oura"

    # usage: services are keyed by id and merge; null removes a field or a service
    curl -X PUT ... -d '{"snapshot":"Wed Nov 4, 2026","services":{"luna":{"weekly":{"usedPct":84,"resets":"Nov 5, 10:42 AM EST"}}}}' "$HOST/api/usage"

    # party members, keyed by name
    curl -X PUT ... -d '{"Char":{"job":"Finishing the copy pack.","status":"Active","state":"active"}}' "$HOST/api/party"

    # quests, keyed by id. One quest, or many at once (all or nothing). null deletes.
    curl -X PUT ... -d '{"land":"school","title":"Confirm the team bus","owner":"AJ","xp":15,"due":"2026-11-20","dueLabel":"Nov 20"}' "$HOST/api/quests/s-bus"
    curl -X PUT ... -d '{"l-copy":{"status":"Done"},"l-step1":{"status":"Moving"}}' "$HOST/api/quests"
    curl -X DELETE ... "$HOST/api/quests/s-bus"

    # the morning pick and the overnight line
    curl -X PUT ... -d '{"focus":"h-days","overnight":"Claude finished the portal."}' "$HOST/api/briefing"

    # lands (unlock rules), plans, hero name
    curl -X PUT ... -d '{"school":{"unlock":{"anyOf":[{"land":"health","need":2}]}}}' "$HOST/api/lands"
    curl -X PUT ... -d '[{"title":"Consistency","summary":"...","items":["..."]}]' "$HOST/api/plans"

    # read everything back
    curl -H "x-luna-key: $LUNA_KEY" "$HOST/api/luna/content"
    curl -H "x-luna-key: $LUNA_KEY" "$HOST/api/luna/progress"

Quest fields: `land, title, owner (AJ, Luna, Char, Claude), xp (AJ quests, 0 to 100), status (party quests: Moving, Blocked, Waiting on AJ, Done), needs (a quest id), detail, date, end, time, place, opens, due, dueLabel, repeat ("daily"), order`. Unknown fields and impossible combinations come back as plain 400 errors, and a batch that has one bad entry changes nothing.

## Meet entries (`/entries`)

A second page in the portal for filling indoor meet entry slots: one page per meet, a name field per slot, and a filled / total count per event and for the whole meet. AJ opens `/entries` (or `/entries?key=<PORTAL_KEY>` the first time on a phone). Same key and cookie as the portal.

**Saving.** Each name saves to the server as soon as AJ pauses typing or leaves the field, into `entries.json` in `DATA_DIR`. That is a separate file from `portal.json`, written the same way (temp file, rename, `.bak` kept, the server refuses to start if it cannot read the file). Until the server confirms a name, the phone also keeps it, so closing the page while offline loses nothing: the name is sent the next time the page opens. The top bar says "All saved" or how many names are still waiting. If the same slot was changed on another device in the meantime, the save is refused rather than overwriting it, and the field shows what is there now.

**Warnings, never blocks.** A name in more events than the meet allows gets a "Heads up" line at the top and an amber mark on the field, and still saves. Only limits the meet publishes are set. Today that is the Episcopal meets (only 3 athletes may run 2 open distance races, everyone else 1; 1000m, 1600m and 3200m count as open distance) and the Hispanic Games (3 events per athlete). The same name twice in one event also warns.

**Adding a meet.** Add one file to `meets/`, named `<id>.json`, and deploy. Copy an existing file and change it:

    {
      "id": "spielman-2026-12-12",          lowercase, numbers, hyphens; must match the file name
      "name": "Jeff Spielman Invitational",
      "date": "2026-12-12",
      "dateLabel": "Sat, Dec 12",
      "place": "Hagerstown Community College, Hagerstown, MD",
      "entriesClose": "Not published",
      "slots": 5,                            default entries per event, relays included
      "source": "/Track/Meets/Meet File - Spielman - Dec 12 1123.md",
      "rules": [],                           published double limits only (see public/entries-rules.js)
      "events": [
        { "id": "g-55m-dash", "name": "Girls 55m Dash", "kind": "run" },
        { "id": "g-4x200m-relay", "name": "Girls 4x200m Relay", "kind": "relay", "slots": 2 }
      ]
    }

`kind` is `run`, `relay` or `field`. `slots` on an event overrides the meet's number. The server checks every meet file when it starts and refuses to start with a plain message if one is wrong, so a typo never shows up as a broken page. To change a slot count later, edit the number and deploy; lowering it never drops a name already typed (extra names show in a "+" row until AJ clears them). Never rename an event id once names are saved against it.

Luna can read entries with her key: `GET /api/luna/entries` and `GET /api/luna/entries/<meet id>`. She cannot change them.

Tests: `node tests/entries-tests.js` (made-up names only).

## Files

    server.js            HTTP, keys, storage, routes
    lib/game.js          the rules (XP, unlocks, dial, bonuses, state for the front end)
    lib/content.js       checks and merging for what Luna edits
    lib/seed.js          starting content, taken from the design file
    lib/entries.js       meet entries: loading meets/, saving entries.json, routes
    meets/               one JSON file per meet
    public/              index.html, app.js, styles.css, manifest, icons
    tests/portal-tests.js
    tests/entries-tests.js

## Known gap

The home-screen icons (`icon-180.png` and the other PNG icons the page asks for) are not in `public/`. The repo's top-level `.gitignore` blocks every `.png` file, so the icons were never committed. On a fresh copy of the portal the icon requests fail, and one test fails because of it. The fix is a small code change (allow these icon files in `.gitignore`, or switch the icons to SVG) and is its own task.
