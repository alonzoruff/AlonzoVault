/*
 * Every line of new wording in the v3 World screen lives here, so wording
 * changes never touch game logic. Land names, quest titles, XP numbers and
 * unlock requirements are NEVER written in this file: the app reads them from
 * the server state (the real lands and the real rules). Lines below are the
 * set Luna approved from Char's pack, used as written.
 *
 * Loaded by the browser as window.COPY, and by the tests as a normal module.
 */
(function (root) {
  'use strict';

  var COPY = {
    /* Zo's speech bubbles. Rotated by say(), never the same line twice in a row. */
    walking: ['On my way.', 'Heading over.', 'Got it.', 'Let’s see what’s here.', 'Almost there.', 'This way.', 'Making moves.', 'Alright, let’s go.', 'One thing at a time.'],
    arriving: ['We’re here.', 'This is the one.', 'Ready when you are.', 'Here’s the next move.', 'Let’s knock this out.', 'Made it.', 'Alright, what’s first?', 'Your call.'],
    idle: ['I’m chilling.', 'No rush.', 'Still here.', 'I’ll be right here.', 'We got options.', 'Just say the word.'],
    finished: ['That’s done.', 'Nice work.', 'One less thing.', 'We’re moving.', 'That counts.', 'On to the next?', 'Good progress.', 'Another one down.'],

    /* Banners (never full screen) */
    levelUp: {
      title: function (n) { return 'Level ' + n + ' reached'; },
      lines: ['Your progress is adding up.', 'Keep it moving.', 'You’ve been putting in work.', 'New level. Same mission.', 'More progress, more to explore.']
    },
    unlock: {
      title: function (landName) { return 'New land unlocked: ' + landName; },
      via: function (questTitle) { return 'Opened by finishing ' + questTitle + '.'; },
      noQuests: 'You can now add quests here.'
    },

    /* Toasts. Success ones go away by themselves; error ones stay until dismissed. */
    toast: {
      newQuest: 'New quest added',
      questUpdated: 'Quest updated',
      saved: 'Changes saved',
      upToDate: 'You’re up to date',
      lunaAddedTask: 'Luna added a task',
      fromLuna: 'New update from Luna',
      many: function (n) { return n + ' new updates'; }
    },
    error: {
      save: 'Couldn’t save. Try again.',
      load: 'Update didn’t load',
      offline: 'You’re offline',
      waiting: 'Changes waiting to sync'
    },

    /* Quest node status words */
    status: { ready: 'Ready', inProgress: 'In progress', done: 'Done', blocked: 'Blocked', locked: 'Locked', overdue: 'Overdue', fresh: 'New', upNext: 'Up next', updated: 'Updated' },

    /* Arrival panel */
    panel: { start: 'Start quest', complete: 'Mark complete', undo: 'Undo', close: 'Close', landLabel: 'Land' },

    /* Quick Add. It writes a note to Luna's outbox, so the confirmation says it was sent. */
    quickAdd: {
      open: '+ Add quest',
      title: 'New quest',
      nameLabel: 'What needs to get done?',
      whereLabel: 'Where does it belong?',
      whereHere: 'This land',
      whereInbox: 'Inbox',
      whenLabel: 'When?',
      whenNone: 'No date',
      whenToday: 'Today',
      whenTomorrow: 'Tomorrow',
      submit: 'Add quest',
      needName: 'Give this quest a name',
      duplicate: 'A quest with this name already exists',
      error: 'Couldn’t add quest. Try again.',
      sent: 'Sent to Luna. She’ll place it.',
      /* The note Luna reads in the outbox. where is a real land name or "Inbox"; when is plain text. */
      message: function (name, where, when) { return 'Add this quest: ' + name + '. Where: ' + where + '. When: ' + when + '.'; }
    }
  };

  /* Pick a line from a list, never the same one twice in a row for the same kind. */
  var last = {};
  COPY.say = function (kind) {
    var list = COPY[kind];
    if (!list || !list.length) return '';
    var i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === last[kind]) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    last[kind] = i;
    return list[i];
  };
  COPY.levelLines = COPY.levelUp.lines;   /* so say('levelLines') rotates them too */

  root.COPY = COPY;
  if (typeof module !== 'undefined' && module.exports) module.exports = COPY;
})(typeof window !== 'undefined' ? window : globalThis);
