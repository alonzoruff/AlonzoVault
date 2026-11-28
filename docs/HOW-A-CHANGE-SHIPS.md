# How a change ships

This page is the map from "I want the app to do X" to "X is live on the
website." Every change to AYG Lab, the sprinter app, or the portal goes
down the same road. Most steps are done by Claude and Luna. The steps
marked **AJ** are yours, and nothing goes live without them.

## The map at a glance

```
 1. Idea          AJ asks for something
        |
 2. Branch        Claude makes a private working copy of the code
        |
 3. Commits       Claude makes the change and saves it in small steps
        |
 4. Pull request  Claude asks to add the change to main ("PR")
        |
 5. Tests         Claude runs the automatic checks; Luna runs them again
        |
 6. Review        Luna checks the work; AJ looks it over      <- AJ
        |
 7. Merge         AJ presses Merge on GitHub                  <- AJ
        |
 8. Deploy        Render sees the new main and puts it live
        |
 9. Check         Someone opens the live site and tries the change
```

## Words you will see

- **Repo (repository):** the whole project folder on GitHub, with its
  full history. Ours is `alonzoruff/AlonzoVault`.
- **main:** the official version of the code. **What is on main is what
  is live.** There is no practice copy of the site in between.
- **Branch:** a separate working copy of main where one change is built,
  so main is never touched while work is in progress.
- **Commit:** one saved step of work, with a short note saying what
  changed. The history is a list of commits.
- **Pull request (PR):** a request to add a branch's changes to main.
  It shows exactly which lines changed and is where review happens.
- **Diff:** the before-and-after view of the changed lines. Red lines
  were removed, green lines were added.
- **Merge:** accepting a PR, so its changes become part of main.
- **Deploy:** the host (Render) taking the newest main and running it as
  the live website.
- **Environment variable (setting):** a value typed into Render, not into
  the code, such as a key that turns payments on. Each app's README lists
  its settings by name.

## Each step, in plain words

### 1. Idea

AJ asks for something, usually through Luna. Luna turns it into a short
brief: what to build, which app, and any limits.

### 2. Branch

Claude makes a branch off main with a name that says what it is for,
such as `claude/ayg-filming-tracker` or `claude/repo-guide-1124`. One
branch holds one change. That keeps each PR small enough to check.

### 3. Commits

Claude makes the change on the branch and saves it as commits. Each
commit note says what changed in plain words.

### 4. Pull request

Claude pushes the branch to GitHub and opens a PR. The PR description
says what was wrong before, what is different after, and how it was
done. **Claude never merges its own PR.** Opening a PR changes nothing
on the live site.

You can see every open PR on GitHub: open the repo, then the **Pull
requests** tab.

### 5. Tests

Each app has automatic checks that start a private copy of the app,
click through it by code, and report `passed` and `failed` counts. They
never touch the live site or real data.

- AYG Lab: `node tests/run-tests.js` and the other files in
  `business/coaching-app/tests/` (listed in its README)
- Sprinter app: `node tests/run-tests.js` in `track/sprinter-web-app`
- Portal: `npm test` in `portal`

Right now **nothing runs the tests automatically on GitHub.** Claude
runs them before opening a PR and reports the numbers in it, and Luna
runs them again before anything ships. A PR whose tests fail does not
get merged.

### 6. Review (AJ)

Luna checks the work against the brief and runs the tests. Then it comes
to AJ. To look at a PR yourself:

1. Open the PR on GitHub.
2. Read the description at the top: the "Before" and "After" say what
   changes for people using the app.
3. Click **Files changed** to see the diff if you want the detail.

If something should be different, say so to Luna, or leave a comment on
the PR. Claude updates the same PR; it does not start over.

### 7. Merge (AJ)

When AJ is happy, he presses the green **Merge pull request** button on
the PR, then **Confirm merge**. This is the moment the change joins main.
Nobody else presses it.

**When two PRs change the same file:** whichever is merged second may
show "This branch has conflicts that must be resolved." That is normal
when several pieces of work happen at once (as now, with backup,
security, tracker and Vercel PRs all open). It is not a sign anything
broke. Ask Claude to update that PR against the new main, then merge it
as usual.

### 8. Deploy

Render watches main. Once a merge lands, Render builds and starts the new
version of that app on its own, usually within a few minutes. While it
switches over, the site may be slow for a moment. Nothing needs to be
pressed in Render.

Saved data (members, roster, check-ins) is not in GitHub, so a merge
never overwrites it. It lives in the app's data file on the host, and
each app's README says where. On a host with a permanent disk the data
survives every deploy; AYG Lab has one. For the sprinter app that has
not been confirmed yet, so download a backup from the app before
merging a change to it.

A move from Render to Vercel is being planned. If it happens, this step
changes, and this page will be updated then. Until AJ decides, Render is
the live home.

### 9. Check

Someone opens the live site and tries the change, on a phone as well as
a computer. If it looks right, the job is done.

## If something goes wrong after a merge

1. **Tell Luna right away** what you saw and on which app.
2. **Undo the change:** on GitHub, open the merged PR and press
   **Revert**. That makes a new PR that takes the change back out. Merge
   that one and Render puts the old version back up within minutes.
3. Claude then finds the cause and fixes it on a new branch, and the
   fix goes down the same road.

Render also keeps earlier versions of each app that can be put back from
the Render dashboard. That is AJ's step in his Render account, and the
GitHub **Revert** above is usually the simpler path.

## What never happens

- Claude never merges, never deploys by hand, and never changes Render
  or Vercel settings.
- No passwords, keys or secret values are ever put in the code or in a
  PR. Settings are typed into Render by AJ.
- AYG Lab and the sprinter app never share code changes, data, or
  settings. A PR touches one app at a time.
