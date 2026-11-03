'use strict';
/*
 * The starting content, taken from the PORTAL_DATA in the design file
 * (including the Oura snapshot Luna set for the night of Nov 2-3) and
 * reshaped for the hosted app: quests, lands and party are keyed by id
 * so Luna can patch one record at a time. This runs once, when there is
 * no portal.json yet. After that, content only changes through Luna's
 * endpoints.
 */
module.exports = function seed(nowIso) {
  return {
    updatedAt: nowIso,

    hero: { name: 'ZO', title: 'The Hero' },

    oura: { asOf: 'Night of Nov 2-3', sleep: 67, readiness: 66, updatedAt: nowIso },

    briefing: { focus: null, focusDate: null, overnight: null, overnightAt: null },

    lands: {
      health: { order: 1, name: 'Health', blurb: 'Body, sleep, and the daily routine.', icon: 'heart', unlock: null },
      school: { order: 2, name: 'School and Track', blurb: 'Classes, athletes, and the track season.', icon: 'trophy',
        unlock: { anyOf: [{ land: 'health', need: 2 }] } },
      personal: { order: 3, name: 'Personal', blurb: 'Faith, people, and the rest of life.', icon: 'star',
        unlock: { anyOf: [{ land: 'health', need: 2 }] } },
      lab: { order: 4, name: 'The Lab', blurb: 'Ruffin Performance, the business.', icon: 'flask',
        unlock: { anyOf: [{ land: 'school', need: 2 }] } },
      money: { order: 5, name: 'Money and Admin', blurb: 'Accounts, renewals, and paperwork.', icon: 'coin',
        unlock: { anyOf: [{ land: 'lab', need: 1 }, { land: 'personal', need: 1 }] } }
    },

    quests: {
      /* Health. The two daily habits pay a little each day and feed the weekly dial.
         The two setup quests are placeholders Luna can rename or replace. */
      'h-fit': { land: 'health', title: 'Keep the fitness routine', owner: 'AJ', repeat: 'daily', xp: 5, detail: 'Part of the Consistency plan.' },
      'h-sleep': { land: 'health', title: 'Be in bed by 9:45 PM', owner: 'AJ', repeat: 'daily', xp: 5, detail: 'Part of the Consistency plan.' },
      'h-days': { land: 'health', title: 'Pick the weekly fitness days', owner: 'AJ', xp: 10, detail: 'Setup for the Consistency plan.' },
      'h-alarm': { land: 'health', title: 'Set the 9:45 PM bedtime alarm', owner: 'AJ', xp: 10, detail: 'Setup for the Consistency plan.' },
      'h-swim': { land: 'health', title: 'Swim strength starts', owner: 'AJ', xp: 15, date: '2026-11-06', time: '6:30 AM' },

      /* School and Track */
      's-fix': { land: 'school', title: 'Tryout schedule date fixes and med ball weight', owner: 'AJ', xp: 15 },
      's-roster': { land: 'school', title: 'Sprinter roster corrections', owner: 'AJ', xp: 15, detail: 'One pass.' },
      's-email': { land: 'school', title: 'Two school email drafts', owner: 'AJ', xp: 10, detail: 'Waiting on his tap.' },
      's-states': { land: 'school', title: 'DCSAA States', owner: 'AJ', xp: 20, date: '2026-11-07', place: 'Kenilworth Park' },
      's-tryouts': { land: 'school', title: 'Indoor track tryouts', owner: 'AJ', xp: 25, date: '2026-11-09', end: '2026-11-12' },
      's-cscs-reg': { land: 'school', title: 'CSCS registration opens', owner: 'AJ', xp: 15, opens: '2026-11-29', detail: 'Opens about Nov 29.' },
      's-cscs-letter': { land: 'school', title: 'CSCS accommodations letter', owner: 'AJ', xp: 15, detail: 'Target is the end of December.' },

      /* Personal */
      'p-kairos': { land: 'personal', title: 'Kairos ends', owner: 'AJ', xp: 15, date: '2026-11-05' },
      'p-prayer': { land: 'personal', title: 'Lead Prayer for Maddie', owner: 'AJ', xp: 15, date: '2026-11-05', time: '1:00 PM' },

      /* The Lab */
      'l-render': { land: 'lab', title: 'Render paste', owner: 'AJ', xp: 20, detail: 'The Stripe key, entered in Render by AJ.' },
      'l-step1': { land: 'lab', title: 'Ruffin Performance Step 1 build', owner: 'Claude', status: 'Moving' },
      'l-copy': { land: 'lab', title: 'Copy pack', owner: 'Char', status: 'Moving' },
      'l-portal': { land: 'lab', title: 'This portal', owner: 'Claude', status: 'Moving' },
      'l-checkout': { land: 'lab', title: 'Live checkout', owner: 'Claude', status: 'Blocked', needs: 'l-render' },

      /* Money and Admin */
      'm-md': { land: 'money', title: 'MD claims document upload', owner: 'AJ', xp: 15, detail: 'No deadline stated.' },
      'm-license': { land: 'money', title: 'Driver’s license renewal', owner: 'AJ', xp: 20, due: '2026-11-27', dueLabel: 'before Nov 27' },
      'm-phone': { land: 'money', title: 'Return the iPhone 15 Pro to T-Mobile', owner: 'AJ', xp: 20, due: '2026-11-08', dueLabel: 'by Nov 8' },
      'm-claude': { land: 'money', title: 'Claude Pro: keep or cancel', owner: 'AJ', xp: 20, due: '2026-11-30', dueLabel: 'Nov 30' }
    },

    party: {
      Luna: { role: 'Commander', job: 'Running the Ruffin Performance build and this portal. Briefs, reviews, ships.', status: 'Active', state: 'active', sprite: 'moon' },
      Char: { role: 'Words, ideas, planning', job: 'Ruffin Performance copy pack, plus the fuller content pack that fills this portal in.', status: 'Active', state: 'active', sprite: 'bubble' },
      Claude: { role: 'Code', job: 'Ruffin Performance Step 1 build, then this portal.', status: 'Active', state: 'active', sprite: 'terminal' }
    },

    usage: {
      snapshot: 'Tue Nov 3, 2026',
      services: {
        luna: { name: 'Luna / Muse', plan: 'Power', price: 20, note: 'Weekly limit, as of the snapshot.',
          weekly: { usedPct: 71, resets: 'Nov 5, 10:42 AM EST' } },
        claude: { name: 'Claude', plan: 'Pro', price: 20,
          note: 'On a November trial. AJ decides on Nov 30, based on whether real code ships weekly.',
          noLive: 'Claude does not show live usage here, so there is no usage figure.' },
        chatgpt: { name: 'Char / ChatGPT', plan: 'Plus', price: 21.2, note: 'Monthly plan.',
          noLive: 'ChatGPT does not show live usage here, so there is no usage figure.' }
      }
    },

    plans: [
      { title: 'Consistency', summary: 'The fitness and sleep routine.',
        facts: [{ label: 'Bedtime', value: '9:45 PM' }],
        items: ['Fitness routine', 'Sleep routine, anchored on the 9:45 PM bedtime'] },
      { title: 'CSCS retake', summary: 'Practical and Applied section first.',
        facts: [{ label: 'Registration opens', value: 'about Nov 29' }, { label: 'Accommodations letter', value: 'target end of December' }],
        items: ['Start with the Practical/Applied section', 'Booking is gated: pass both official practice tests twice, under timing, before booking the retake'] },
      { title: 'Ruffin Performance launch', summary: 'The invite only coaching membership app.',
        items: ['Step 1 build is moving', 'Live checkout waits on the Stripe key paste into Render', 'Copy pack is with Char'] },
      { title: 'Indoor track season and tryouts', summary: 'Tryouts run Nov 9 to 12.',
        items: ['Tryout schedule date fixes and the med ball weight still need AJ', 'Sprinter roster needs one pass of corrections'] }
    ],

    outbox: {
      title: 'Talk to the Party',
      label: 'Luna routes it.',
      placeholder: 'Write what the party should know or do.',
      note: 'Messages are saved in the portal. Luna reads them, routes them, and the status under each one changes only when she or the owner updates it.'
    }
  };
};
