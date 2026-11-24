<!--
Fill in each part below. Keep it in plain words, the way you'd explain it to AJ at practice.
Delete any line that doesn't apply. Grey notes like this one don't show on the PR.
-->

## What this does, in plain words

Before: <!-- what someone saw or could do before this change -->

After: <!-- what they see or can do now -->

How: <!-- one or two sentences on what was changed under the hood -->

## What this does NOT change

<!-- Name the things a reader might worry about that stay exactly the same.
Example: "Sign-in, prices and the sprinter app are untouched." -->

-

## Which app

- [ ] AYG Lab (`business/coaching-app`)
- [ ] Sprinter app (`track/sprinter-web-app`)
- [ ] Portal (`portal`)
- [ ] Something else: <!-- say what -->

## QC checklist

**Tests**
- [ ] Tests pass. Command I ran and the result:
  <!-- e.g. `node tests/run-tests.js`: 1916 passed, 0 failed -->
- [ ] New or changed behavior has a test, or I said here why it doesn't need one.

**Phone check (any change people can see)**
- [ ] Phone screenshots are attached below (drag the picture into this box; pictures are kept out of the repo on purpose).
- [ ] **Or**, if screenshots weren't possible, "how to check it on a phone" steps are written below.
- [ ] No design change in this PR, so no phone check needed.

**House rules**
- [ ] AYG Lab and the sprinter app stay separate (no shared code, logins or data between them).
- [ ] No price, tier, trial or Stripe changes, unless AJ asked for exactly that.
- [ ] No passwords, keys or real athlete or student information. Tests use made-up data only.
- [ ] I checked other open PRs for edits to the same files and named any below.

## Phone screenshots, or how to check it on a phone

<!-- Either drop screenshots here, or write numbered steps AJ can follow on his phone, like:
1. Open the AYG Lab site on your phone and sign in.
2. Tap Library, then pick any movement.
3. You should see ___. If you see ___ instead, something is wrong.
-->

## Other open PRs that touch the same files

<!-- "None" is a fine answer. -->

## Labels

<!-- Add the labels that fit on the right side of the PR page: design, data, docs, blocked, needs-AJ.
Use needs-AJ when the PR is waiting on AJ to decide or do something. -->
