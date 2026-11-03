# AJ Command Portal (hosted)

A game style dashboard with real saved state. Node 18 or newer, no dependencies, one process. Separate from the coaching app.

## Run it

    cd portal
    PORTAL_KEY=<long random> LUNA_KEY=<a different long random> node server.js

Open `http://localhost:3000/?key=<PORTAL_KEY>` once. The portal sets a cookie and drops the key from the address bar.

Environment variables

| Name | What it does |
|---|---|
| PORTAL_KEY | Opens the portal for AJ. At least 16 characters. Without it nobody gets in. |
| LUNA_KEY | Luna sends it in an `x-luna-key` header. Opens her endpoints only. At least 16 characters, and not the same as PORTAL_KEY. |
| DATA_DIR | Folder for `portal.json`. Default is `./data` next to server.js. |
| PORT | Default 3000. Render sets it for you. |

Make keys with `openssl rand -hex 24`. Never put either key in the repo.

Tests: `node tests/portal-tests.js` (boots the server on a test port with a throwaway folder and a movable clock, 54 checks).

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

## Files

    server.js            HTTP, keys, storage, routes
    lib/game.js          the rules (XP, unlocks, dial, bonuses, state for the front end)
    lib/content.js       checks and merging for what Luna edits
    lib/seed.js          starting content, taken from the design file
    public/              index.html, app.js, styles.css, manifest, icons
    tests/portal-tests.js
