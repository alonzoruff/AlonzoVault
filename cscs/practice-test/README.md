# CSCS Practice Test

Timed practice sets for the CSCS exam. One question at a time, exactly 3 answer choices each, and a score at the end broken down by topic, weakest topic first, so you can see right away what to study.

The questions in `questions.txt` were written by Claude for AJ's study. They are practice questions in the exam's style, not real NSCA exam items, and none were copied from any exam.

## How a set works

1. Pick a section: Applied, Scientific Foundations, or Mixed.
2. Pick how many questions: 10, 20, or All.
3. Pick the pace: 45, 60 or 90 seconds per question. The clock is the total for the whole set (10 questions at 60 seconds is 10:00), so you can spend more time on hard ones and less on easy ones.
4. Answer one question at a time. Tap a choice, then Next. Skip moves on without answering. Back lets you change an answer.
5. When the clock hits 0:00 the set ends on its own. Unanswered questions count as wrong.
6. The results page shows your score, then each topic with how many you got right, weakest first. Topics under 60% are marked "Study this". Under that is every question you missed, with your answer, the right answer and why.

Questions and the order of the 3 choices are shuffled every set, so you learn the content and not the letter. The last 10 sets are remembered on that phone or computer only (nothing is sent anywhere).

## Run it

Node 18 or newer, nothing to install.

    cd cscs/practice-test
    node server.js

Then open http://localhost:3100 on the same computer. To use it on a phone, it needs to be hosted somewhere; it is a plain static page plus one text file, so any static host works.

Tests: `node tests/practice-tests.js`

## Where the questions live

Everything is in one plain text file: `cscs/practice-test/questions.txt`. You can edit it on github.com (open the file, tap the pencil icon) or in any text editor. The app reads it fresh every time the page loads.

Right now it holds 30 questions: 20 Applied and 10 Scientific Foundations.

## How to add a question

Go to the bottom of `questions.txt`, add a line with three dashes, then the question. Copy this pattern:

    ---
    Section: Applied
    Topic: Program Design
    Q: An athlete's 1RM bench press is 200 lb. Which load fits a set of 10?
    A) 150 lb
    B) 190 lb
    C) 120 lb
    Answer: A
    Why: About 10 reps matches roughly 75% of 1RM, and 200 x 0.75 = 150 lb.

The rules:

| Line | What goes there |
|---|---|
| `---` | Goes between questions. Every new question starts after one. |
| `Section:` | `Applied` or `Scientific Foundations`. |
| `Topic:` | Any name. Questions with the same topic are scored together, so spell it the same way each time. The starter set uses Exercise Technique, Program Design, Testing and Evaluation, Organization and Administration, Exercise Science, Nutrition and Sport Psychology. |
| `Q:` | The question. |
| `A)` `B)` `C)` | Exactly three choices. Not two, not four. |
| `Answer:` | One letter: A, B or C. |
| `Why:` | Optional, but it shows up in the review of missed questions, so it is worth a sentence. |

A few more things:

* A long question can wrap onto the next line. Any line without a label joins onto the line above it.
* Lines starting with `#` are notes to yourself. The app skips them.
* Labels are not case sensitive, and `A.` works the same as `A)`.
* The order of A, B and C in the file does not matter to the test, because choices are shuffled each set.

## If something is wrong in the file

The app tells you. If a question is missing a choice, has four choices, or has an answer that is not A, B or C, the start screen shows a red box naming the line where that question starts. That question is skipped and everything else still works.

To check the file without opening the app:

    node scripts/check-questions.js

It prints how many questions there are per section and topic, and lists anything that needs fixing.

## Files

| File | What it does |
|---|---|
| `questions.txt` | The question bank. The only file you need to edit. |
| `public/` | The page itself (`index.html`, `app.js`, `styles.css`). |
| `lib/questions.js` | Reads `questions.txt`. Used by the page and the tests. |
| `lib/quiz.js` | Builds a set, shuffles, and scores by topic. |
| `server.js` | Small local server. Serves only the files above. |
| `scripts/check-questions.js` | Checks `questions.txt` and prints a report. |
| `tests/practice-tests.js` | Tests for the format, scoring and server. |
