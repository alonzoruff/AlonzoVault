/* Sprinter Workout App — front end (vanilla JS, no build step). */
'use strict';

/* ---------------- state ---------------- */
const state = {
  content: null,
  sessions: new Map(),
  user: null,
  logs: [],
  swaps: {},
  week: 1,
  libQuery: '',
  vidCat: 'All',
  vidQuery: '',
  defCat: 'All',
  defQuery: '',
  eduBucket: 'All',
  eduFocus: '',
  eduQuery: '',
  invItems: [],
  invCat: '',
  invQ: '',
  invEditId: null,
  cwWorkouts: [],
  cwEditId: null,
  cwDraft: null,
  detailId: null,
  groups: [],
  roster: null,
  assignment: null,
  feedDate: null,
  tests: [],
  testDays: [],
  testDayId: null,
  rapidAthleteId: null,
  topMetric: 'fly-30m',
  entryMetric: 'fly-30m',
  topWeek: null,
  concerns: [],
  media: {},
  wuOverrides: {},
  wuEdit: null,
  tvPanel: 0,
  tvPaused: false,
  tvData: null,
  tvUnits: [],
  tvPageLabels: [],
  gridGroupId: '',
  reportTest: null,
  reportGroup: null,
  reportAthleteId: null,
  meetEvents: [],
  meetEditId: null,
  meetProgAthlete: null,
  checkinToday: null,
  checkinMine: null,
  ciMsg: '',
  profiles: [],
  pfGroup: '',
  pfEvent: '',
  pfTop: false,
  pfQ: '',
  importReport: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}));
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty */ }
  if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
  return data;
}
const apiPost = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
});
const apiPut = (path, body) => api(path, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
});
const apiDel = (path) => api(path, { method: 'DELETE' });

/* ---------------- dates ---------------- */
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDate(d) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtRange(w) { return fmtDate(parseDate(w.start)) + ' – ' + fmtDate(parseDate(w.end)); }
function todayLocal() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function todayStr() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}

/* ---------------- day analysis ---------------- */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DAY_OFFSET = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

function dayInfo(weekRow, dayKey) {
  const text = String(weekRow[dayKey] || '').trim();
  const codes = text.match(/[A-Z]{2,3}-\d{2}/g) || [];
  const isMeet = /\bMEET\b|championships/i.test(text);
  const isTest = /\bTEST\b/i.test(text);
  const isOff = !codes.length && !isMeet && !isTest && /off/i.test(text);
  const anyHighCode = codes.some(c => {
    const s = state.sessions.get(c);
    return s && s.cns_demand === 'high';
  });
  const isHigh = !isOff && (anyHighCode || isTest || isMeet);
  const date = parseDate(weekRow.start);
  date.setDate(date.getDate() + DAY_OFFSET[dayKey]);
  let warmup = null;
  if (!isOff) warmup = isMeet ? 'WUP-02' : (isHigh ? 'WUP-01' : 'WUP-03');
  return { text, codes, isMeet, isTest, isOff, isHigh, date, warmup };
}

/* All hard days across the season, with the pairs that break the 48h rule. */
function spacingViolations() {
  const highs = [];
  for (const w of state.content.weeks) {
    for (const dk of DAY_KEYS) {
      const info = dayInfo(w, dk);
      if (info.isHigh) highs.push({ week: w.week, day: dk, date: info.date });
    }
  }
  highs.sort((a, b) => a.date - b.date);
  const bad = new Set();
  for (let i = 1; i < highs.length; i++) {
    const gapDays = Math.round((highs[i].date - highs[i - 1].date) / 86400000);
    if (gapDays < 2) {
      bad.add(highs[i - 1].week + ':' + highs[i - 1].day);
      bad.add(highs[i].week + ':' + highs[i].day);
    }
  }
  return bad;
}

function currentWeekNum() {
  const t = todayLocal();
  const weeks = state.content.weeks;
  for (const w of weeks) {
    if (t >= parseDate(w.start) && t <= parseDate(w.end)) return w.week;
  }
  if (t < parseDate(weeks[0].start)) return 1;
  return weeks[weeks.length - 1].week;
}

/* ---------------- tiny markdown renderer ---------------- */
function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(src) {
  const lines = esc(src).split('\n');
  let html = '';
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => { if (para.length) { html += '<p>' + inlineMd(para.join(' ')) + '</p>'; para = []; } };
  const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // table
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flushPara(); closeList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inlineMd(c.trim()));
      html += '<table><thead><tr>' + cells(line).map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        html += '<tr>' + cells(lines[i]).map(c => '<td>' + c + '</td>').join('') + '</tr>';
        i++;
      }
      html += '</tbody></table>';
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) { flushPara(); closeList(); const lvl = Math.min(h[1].length + 1, 6); html += `<h${lvl}>` + inlineMd(h[2]) + `</h${lvl}>`; i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { flushPara(); closeList(); html += '<hr>'; i++; continue; }
    if (/^\s*>\s?/.test(line)) { flushPara(); closeList(); html += '<blockquote>' + inlineMd(line.replace(/^\s*>\s?/, '')) + '</blockquote>'; i++; continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { closeList(); html += '<' + kind + '>'; list = kind; }
      html += '<li>' + inlineMd((ul || ol)[1]) + '</li>';
      i++; continue;
    }
    if (!line.trim()) { flushPara(); closeList(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flushPara(); closeList();
  return html;
}

/* ---------------- navigation ----------------
   Five primary destinations — Today, Train, Learn, My Log, Account —
   plus a Coach area only coaches ever see. Grouped views (Workouts,
   Season Plan, Warm-Up Cards, …) live under Train / Learn / Coach and
   share a segmented sub-navigation rendered into each view's
   .subnav-slot. Every nav control carries data-view; one delegated
   listener below routes them all. */
const VIEW_AREA = {
  home: 'home', train: 'train', learn: 'learn', log: 'log', account: 'account', coachhub: 'coachhub',
  library: 'train', season: 'train', cards: 'train', drills: 'train', qtr: 'train',
  videos: 'learn', definitions: 'learn', nutrition: 'learn', education: 'learn', guide: 'learn',
  coach: 'coachhub', groups: 'coachhub', testing: 'coachhub', top: 'coachhub', health: 'coachhub', inventory: 'coachhub', tv: 'coachhub', meets: 'coachhub', reports: 'coachhub', custom: 'coachhub', wellness: 'coachhub',
};
const GROUP_SUBNAV = {
  train: [['library', 'Workouts'], ['season', 'Season Plan'], ['cards', 'Warm-Up Cards'], ['drills', 'Warm-Up Drills'], ['qtr', '400m Training']],
  learn: [['videos', 'Videos'], ['definitions', 'Definitions'], ['nutrition', 'Nutrition'], ['education', 'Coach Education'], ['guide', 'How to use this app']],
  coachhub: [['coach', "Today's Checklist"], ['groups', 'Roster & Groups'], ['testing', 'Testing'], ['top', 'Top Athletes'], ['meets', 'Meet Results'], ['reports', 'Reports'], ['wellness', 'Wellness'], ['health', 'Aches & Pains'], ['inventory', 'Inventory'], ['tv', 'TV Board'], ['custom', 'Custom Workouts']],
};
function renderSubnav(name, area) {
  const items = GROUP_SUBNAV[area];
  const activeSection = document.getElementById('view-' + name);
  $$('.subnav-slot').forEach(slot => {
    if (!items || slot.closest('.view') !== activeSection) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<nav class="seg" aria-label="In this section">' + items.map(([v, label]) =>
      `<button type="button" class="seg-btn${v === name ? ' active' : ''}" data-view="${v}">${label}</button>`).join('') + '</nav>';
  });
}
function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  const area = VIEW_AREA[name] || 'home';
  $$('.primary-nav .tab').forEach(t => t.classList.toggle('active', t.dataset.view === area));
  renderSubnav(name, area);
  /* The TV board takes over the whole screen: body.tv-mode hides
     the app chrome (CSS), and its timers run only while it shows. */
  document.body.classList.toggle('tv-mode', name === 'tv');
  if (name === 'tv') enterTvBoard(); else exitTvBoard();
  if (name === 'reports') renderReports();
  if (name === 'meets') renderMeets();
  if (name === 'custom') renderCustomWorkouts();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) showView(b.dataset.view);
});
$$('[data-goto]').forEach(b => b.addEventListener('click', () => showView(b.dataset.goto)));

/* ---------------- motion helpers ---------------- */
const LANE_DIVIDER = '<div class="lane-divider" aria-hidden="true"><div class="lane-strip"></div></div>';
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el) {
  const target = parseInt(el.dataset.count, 10);
  if (isNaN(target)) return;
  if (prefersReducedMotion) { el.textContent = String(target); return; }
  const dur = 900;
  const start = performance.now();
  (function tick(now) {
    const p = Math.min(1, ((now || start) - start) / dur);
    el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}

/* ---------------- shared session rendering ---------------- */
function badge(cns) {
  return cns === 'high'
    ? '<span class="badge high">HARD · HIGH CNS</span>'
    : '<span class="badge low">EASY · LOW CNS</span>';
}
function sessionRow(s) {
  return `<button class="session-row" data-session="${esc(s.id)}">
    <span class="code">${esc(s.id)}</span> · <span class="name">${esc(s.name)}</span> ${badge(s.cns_demand)}
    <div class="meta">${esc(labelQuality(s.quality))} · ${esc(labelPhase(s.phase))} · ${s.total_volume_m ? esc(s.total_volume_m) + ' m total' : 'no running volume'}</div>
  </button>`;
}
function labelQuality(q) {
  return ({
    acceleration: 'Acceleration', max_velocity: 'Max velocity', speed_endurance: 'Speed endurance',
    special_endurance: 'Special endurance', tempo: 'Tempo', race_modeling: 'Race modeling',
    strength: 'Strength', plyometric: 'Plyometrics', recovery: 'Recovery',
    warm_up: 'Warm-up', cross_training: 'Cross-training',
  })[q] || q;
}
function labelPhase(p) {
  return ({ base: 'Base phase', pre_competitive: 'Pre-competitive', competitive: 'Competitive', championship: 'Championship', any: 'Any phase' })[p] || p;
}
function sessionDetailHtml(s) {
  const row = (k, v) => v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '';
  return `<div class="card">
    <button class="btn secondary" id="detail-back" type="button">← Back to list</button>
    <button class="btn primary" id="detail-run" type="button">Run this workout</button>
    <h2><span class="code-link">${esc(s.id)}</span> · ${esc(s.name)}</h2>
    <p>${badge(s.cns_demand)} <span class="badge plain">${esc(labelQuality(s.quality))}</span> <span class="badge plain">${esc(labelPhase(s.phase))}</span></p>
    <dl class="detail-grid">
      ${row('Reps', s.reps)}
      ${row('Rep distance', s.rep_distance_m ? s.rep_distance_m + ' m' : '')}
      ${row('Intensity', s.intensity_pct ? s.intensity_pct + '%' : '')}
      ${row('Rest', s.rest)}
      ${row('Total volume', s.total_volume_m ? s.total_volume_m + ' m' : '')}
      ${row('Surface', s.surface)}
      ${row('Footwear', s.footwear)}
      ${row('Equipment', s.equipment)}
      ${row('Level', s.level)}
      ${row('Before next hard day', s.min_hours_before_next_high ? 'wait ' + s.min_hours_before_next_high + ' h' : '')}
    </dl>
    <h3>Coaching cues</h3><p>${esc(s.coaching_cues)}</p>
    <p class="muted">Source: ${esc(s.source)}</p>
  </div>`;
}
function openSession(id) {
  const s = state.sessions.get(id);
  if (!s) return;
  showView('library');
  $('#lib-list').innerHTML = '';
  $('#lib-count').textContent = '';
  $('#lib-detail').innerHTML = sessionDetailHtml(s);
  $('#detail-back').addEventListener('click', () => { $('#lib-detail').innerHTML = ''; renderLibrary(); });
  const runBtn = $('#detail-run');
  if (runBtn) runBtn.addEventListener('click', () => openRunner(sessionToRunnerPlan(s)));
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const rowEl = e.target.closest('[data-session]');
  if (rowEl) { openSession(rowEl.dataset.session); return; }
  const codeEl = e.target.closest('[data-code]');
  if (codeEl) openSession(codeEl.dataset.code);
});

/* ---------------- home ---------------- */
/* "Start here" strip: three plain first steps for a new visitor.
   Dismissal is remembered on this device. */
function startHereDismissed() {
  try { return localStorage.getItem('swa-start-here') === 'dismissed'; } catch (_) { return false; }
}
function dismissStartHere() {
  try { localStorage.setItem('swa-start-here', 'dismissed'); } catch (_) { /* private mode: just hide it for now */ }
}
/* The printed warm-up card that matches each warm-up session:
   WUP-01 is the Speed Day card, WUP-03 is the Light card. */
const WARMUP_CARD_FOR = { 'WUP-01': 'wu-card-2', 'WUP-03': 'wu-card-1' };
function openWarmupCard() {
  showView('cards');
  const t = todayLocal();
  const wk = state.content.weeks.find(w => w.week === currentWeekNum());
  if (!wk) return;
  const info = dayInfo(wk, DAY_KEYS[(t.getDay() + 6) % 7]);
  const cardId = info && info.warmup ? WARMUP_CARD_FOR[info.warmup] : null;
  if (!cardId) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(cardId);
    if (el) el.scrollIntoView({ block: 'start' });
  });
}

function renderHome() {
  const c = state.content;
  const t = todayLocal();
  const weeks = c.weeks;
  const first = weeks[0], last = weeks[weeks.length - 1];
  const wkNum = currentWeekNum();
  const wk = weeks.find(w => w.week === wkNum);
  let statusLine;
  if (t < parseDate(first.start)) statusLine = `The season starts <strong>${fmtDate(parseDate(first.start))}</strong>. Here is Week 1 so you can see what's coming.`;
  else if (t > parseDate(last.end)) statusLine = `The season wrapped up ${fmtDate(parseDate(last.end))}. Showing the final week.`;
  else statusLine = `You are in <strong>Week ${wkNum}</strong> of the season.`;

  const todayKey = DAY_KEYS[(t.getDay() + 6) % 7]; // Mon=0
  const inSeason = t >= parseDate(wk.start) && t <= parseDate(wk.end);

  /* Today's session is featured on its own, up top, with the day's
     warm-up card right under it. The rest of the week follows under
     the week heading — every day card still shows. */
  let todayHtml = '';
  let restKeys = DAY_KEYS;
  if (inSeason) {
    const info = dayInfo(wk, todayKey);
    restKeys = DAY_KEYS.filter(dk => dk !== todayKey);
    const w = info.warmup ? state.sessions.get(info.warmup) : null;
    todayHtml = `
    <h2>Today — ${DAY_NAMES[todayKey]}, ${fmtDate(info.date)}</h2>
    ${LANE_DIVIDER}
    ${dayCardHtml(wk, todayKey, info, { highlight: true })}
    ${w ? `<div class="card warmup-panel">
      <h3>Today's warm-up</h3>
      <p><a class="code-link" data-code="${w.id}">${w.id}</a> ${esc(w.name)} — run this before the session starts.</p>
      <button class="btn primary" id="home-warmup-card" type="button">Open today's warm-up card</button>
    </div>` : ''}`;
  }
  const daysHtml = restKeys.map(dk => dayCardHtml(wk, dk, dayInfo(wk, dk), { highlight: false })).join('');

  const startStrip = startHereDismissed() ? '' : `
    <div class="card start-strip" id="start-strip">
      <div class="start-head">
        <h2>New here? Start in 3 steps</h2>
        <button class="btn secondary" id="start-dismiss" type="button">Dismiss</button>
      </div>
      <ol class="start-steps">
        <li><strong>See today's workout.</strong> It is right on this page, every day.</li>
        <li><strong>Watch the demo videos.</strong> Short clips of every drill and lift, in Learn. <button class="btn secondary" id="start-videos" type="button">Watch demos</button></li>
        <li><strong>Check your warm-up card.</strong> The right warm-up for today, ready to print. <button class="btn secondary" id="start-cards" type="button">See warm-up cards</button></li>
      </ol>
    </div>`;

  $('#home-content').innerHTML = `
    <h1>Today</h1>
    ${LANE_DIVIDER}
    <p>${statusLine}</p>
    ${isCoachUser() ? '<div id="coach-today"></div>' : ''}
    ${todayHtml}
    ${startStrip}
    <div class="card">
      <div class="hero-stats">
        <div class="hero-stat"><span class="stat-num" data-count="${c.sessions.length}">0</span><span class="stat-label">workouts</span></div>
        <div class="hero-stat"><span class="stat-num" data-count="${c.drills.length}">0</span><span class="stat-label">drills</span></div>
        <div class="hero-stat"><span class="stat-num" data-count="${weeks.length}">0</span><span class="stat-label">weeks</span></div>
      </div>
      <p class="muted" style="margin-bottom:0">Mini peak Sat Feb 20, 2027 · Major peak Sat May 15, 2027. Hard days and easy days take turns — never two hard days in a row.</p>
    </div>
    <div class="card">
      <label for="home-search">Find a workout fast</label>
      <input id="home-search" type="search" placeholder="Try “fly”, “tempo”, or a code like SE-02">
      <button class="btn primary" id="home-search-btn" type="button">Search the library</button>
    </div>
    <h2>Week ${wk.week} · ${esc(wk.phase)} · ${esc(wk.load)}</h2>
    ${LANE_DIVIDER}
    <p class="muted">${fmtRange(wk)} — ${esc(wk.focus)}</p>
    ${daysHtml}
    <button class="btn" id="home-open-season" type="button">Open the full season plan</button>
    ${state.user ? '<h2>Your latest log entries</h2>' + LANE_DIVIDER + '<div id="home-logs"></div>' : '<div class="card"><strong>Keep a practice log.</strong><p class="muted">Create a free account to save what your group actually ran, and to save cross-training swaps. <button class="btn secondary" data-goto="account" type="button">Go to account</button></p></div>'}
  `;
  $('#home-search-btn').addEventListener('click', () => {
    state.libQuery = $('#home-search').value;
    $('#lib-search').value = state.libQuery;
    showView('library'); renderLibrary();
  });
  $('#home-open-season').addEventListener('click', () => { state.week = wkNum; renderSeason(); showView('season'); });
  const warmBtn = $('#home-warmup-card');
  if (warmBtn) warmBtn.addEventListener('click', openWarmupCard);
  const dismissBtn = $('#start-dismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', () => {
    dismissStartHere();
    const strip = $('#start-strip');
    if (strip) strip.remove();
  });
  const startVideos = $('#start-videos');
  if (startVideos) startVideos.addEventListener('click', () => showView('videos'));
  const startCards = $('#start-cards');
  if (startCards) startCards.addEventListener('click', () => showView('cards'));
  $$('#home-content .stat-num').forEach(countUp);
  const gotoBtn = $('#home-content [data-goto]');
  if (gotoBtn) gotoBtn.addEventListener('click', () => showView(gotoBtn.dataset.goto));
  if (state.user) renderHomeLogs();
  if (isCoachUser()) renderCoachToday();
}

/* Coach summary panel on Today: today's assignments + completion
   counts per group, and open health flags, worst first. */
async function renderCoachToday() {
  const el = $('#coach-today');
  if (!el) return;
  let data;
  try { data = await api('/api/coach/today'); }
  catch (_) { el.innerHTML = ''; return; }
  const planLabel = data.week
    ? `Week ${data.week} · ${esc(data.phase || '')} · ${esc(data.dayName || '')}`
    : 'Outside the season plan';
  const groupsHtml = data.groups.length ? data.groups.map(g => `
    <div class="roster-row">
      <span><strong>${esc(g.group.name)}</strong> — ${g.assignment.sessionId
        ? `<a class="code-link" data-code="${esc(g.assignment.sessionId)}">${esc(g.assignment.sessionId)}</a> ${esc(g.assignment.sessionName)}`
        : esc(g.assignment.planText || 'Rest day')}
      ${g.assignment.source === 'override' ? '<span class="badge plain">YOUR PICK</span>' : ''}</span>
      <span class="muted">${g.completed} of ${g.total} done</span>
    </div>`).join('') : '<p class="muted">No groups yet — set them up in Roster &amp; Groups.</p>';
  const open = data.healthFlags || [];
  const healthHtml = open.length ? open.slice(0, 8).map(c => `
    <div class="roster-row">
      <span>${c.flagged ? '🚩 ' : ''}<strong>${esc(c.athleteName)}</strong> — ${esc(AREA_LABELS[c.area] || c.area)} (${esc(c.side)}), pain ${c.pain}/10${c.impact === 'stopped' ? ' · stopped training' : ''}</span>
      <span class="badge ${c.status === 'new' ? 'high' : 'plain'}">${esc(STATUS_LABELS[c.status] || c.status).toUpperCase()}</span>
    </div>`).join('') + (open.length > 8 ? `<p class="muted">…and ${open.length - 8} more open in Aches &amp; Pains.</p>` : '')
    : '<p class="muted">No open health flags. Good news.</p>';
  el.innerHTML = `<div class="card">
    <h2>Coach summary</h2>
    <p class="muted">${esc(fmtDate(parseDate(data.date)))} · ${planLabel}</p>
    <h3>Today's assignments</h3>
    ${groupsHtml}
    <p><button class="btn secondary" id="ct-open-coach" type="button">Open today's checklist</button></p>
    <h3>Health flags${open.length ? ` (${open.length} open)` : ''}</h3>
    ${healthHtml}
    <p><button class="btn secondary" id="ct-open-health" type="button">Open Aches &amp; Pains</button></p>
  </div>`;
  $('#ct-open-coach').addEventListener('click', () => { state.feedDate = data.date; renderCoach(); showView('coach'); });
  $('#ct-open-health').addEventListener('click', () => { renderHealth(); showView('health'); });
}
function renderHomeLogs() {
  const el = $('#home-logs');
  if (!el) return;
  if (!state.logs.length) { el.innerHTML = '<p class="muted">No entries yet. Add your first one in My Log.</p>'; return; }
  el.innerHTML = state.logs.slice(0, 3).map(logEntryHtml).join('');
}

/* ---------------- day card (shared by home + season) ---------------- */
function dayCardHtml(weekRow, dayKey, info, opts) {
  opts = opts || {};
  const swapKey = weekRow.week + ':' + dayKey;
  const swapId = state.swaps[swapKey];
  const swapSession = swapId ? state.sessions.get(swapId) : null;

  let planHtml = esc(info.text);
  for (const code of new Set(info.codes)) {
    planHtml = planHtml.split(code).join(`<a class="code-link" data-code="${code}">${code}</a>`);
  }
  let cls = info.isOff ? '' : (info.isHigh ? 'high' : 'low');
  let badgeHtml = info.isOff ? '<span class="badge plain">OFF</span>'
    : (info.isHigh ? '<span class="badge high">HARD</span>' : '<span class="badge low">EASY</span>');
  if (info.isMeet) badgeHtml += ' <span class="badge plain">MEET</span>';
  if (info.isTest) badgeHtml += ' <span class="badge plain">TEST</span>';

  let warmHtml = '';
  if (info.warmup) {
    const w = state.sessions.get(info.warmup);
    if (w) warmHtml = `<div class="warmup">Warm-up: <a class="code-link" data-code="${w.id}">${w.id}</a> ${esc(w.name)}</div>`;
  }

  let swapHtml = '';
  if (!info.isHigh && !info.isOff) {
    if (swapSession) {
      swapHtml = `<div class="swap-note">Swapped to <a class="code-link" data-code="${swapSession.id}">${swapSession.id}</a> ${esc(swapSession.name)} — still an EASY day.</div>`;
    }
    if (opts.swappable) {
      const xts = Array.from(state.sessions.values()).filter(s => s.id.startsWith('XT-'));
      const options = ['<option value="">No swap (keep the plan)</option>']
        .concat(xts.map(x => `<option value="${x.id}" ${x.id === swapId ? 'selected' : ''}>${x.id} · ${esc(x.name)}</option>`)).join('');
      swapHtml += `<label>Cross-training swap
        <select data-swap="${swapKey}" ${state.user ? '' : 'disabled'}>
          ${options}
        </select></label>
        ${state.user ? '' : '<div class="swap-note">Log in to save swaps.</div>'}`;
    }
  }

  return `<div class="card day-card ${cls}" ${opts.highlight ? 'style="outline:2px solid var(--red)"' : ''}>
    <div class="day-head"><span class="day-name">${DAY_NAMES[dayKey]}${opts.highlight ? ' · today' : ''}</span>
    <span class="muted">${fmtDate(info.date)}</span> ${badgeHtml}</div>
    <p class="plan">${swapSession && opts.swappable ? '<s>' + planHtml + '</s>' : planHtml}</p>
    ${warmHtml}${swapHtml}
  </div>`;
}

/* ---------------- library ---------------- */
function renderLibrary() {
  const q = (state.libQuery || '').toLowerCase();
  const quality = $('#lib-quality').value;
  const phase = $('#lib-phase').value;
  const cns = $('#lib-cns').value;
  const list = state.content.sessions.filter(s => {
    if (q && !(s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.coaching_cues.toLowerCase().includes(q))) return false;
    if (quality && s.quality !== quality) return false;
    if (phase && s.phase !== phase) return false;
    if (cns && s.cns_demand !== cns) return false;
    return true;
  });
  $('#lib-count').textContent = `Showing ${list.length} of ${state.content.sessions.length} workouts.`;
  $('#lib-detail').innerHTML = '';
  $('#lib-list').innerHTML = list.length ? list.map(sessionRow).join('') : '<p class="muted">No workouts match. Try clearing a filter.</p>';
}
function fillLibFilters() {
  const qualities = [...new Set(state.content.sessions.map(s => s.quality))];
  const phases = [...new Set(state.content.sessions.map(s => s.phase))];
  $('#lib-quality').innerHTML = '<option value="">All types</option>' + qualities.map(q => `<option value="${esc(q)}">${esc(labelQuality(q))}</option>`).join('');
  $('#lib-phase').innerHTML = '<option value="">All phases</option>' + phases.map(p => `<option value="${esc(p)}">${esc(labelPhase(p))}</option>`).join('');
  const sel = $('#log-session');
  sel.innerHTML = '<option value="">— pick a workout —</option>' + state.content.sessions.map(s => `<option value="${s.id}">${s.id} · ${esc(s.name)}</option>`).join('');
}

/* ---------------- drills + 400m ---------------- */
function renderDrills() {
  const byCat = {};
  for (const d of state.content.drills) { (byCat[d.category] = byCat[d.category] || []).push(d); }
  const catName = { general: 'Part A — general warm-up', dynamic_stretch: 'Part B — dynamic mobility', sprint_drill: 'Part B — sprint drills' };
  $('#drill-list').innerHTML = Object.keys(byCat).map(cat => `
    <h2>${esc(catName[cat] || cat)}</h2>
    ${LANE_DIVIDER}
    ${byCat[cat].map(d => `<div class="card">
      <strong>${esc(d.id.replace('DRL-', 'Drill '))} · ${esc(d.name)}</strong>
      <div class="muted">${esc(d.distance_or_reps)}</div>
      <p style="margin-bottom:0">${esc(d.coaching_cue)}</p>
      ${demoHtml(d.id, d.name)}
    </div>`).join('')}
  `).join('');
}
function renderQtr() {
  const qtrs = state.content.sessions.filter(s => s.id.startsWith('QTR-'));
  $('#qtr-list').innerHTML = qtrs.map(sessionRow).join('');
  $('#qtr-doc').innerHTML = md(state.content.framework400);
}

/* ---------------- videos ---------------- */
const VID_CATEGORIES = ['Warm-Ups & Drills', 'Lifts & Weight Room', 'Sprint Mechanics & Speed',
  'Plyometrics', 'Hip Mobility & Strength', 'Core & Trunk', 'Recovery & Mobility'];
function ytVideoId(url) {
  const m = String(url || '').match(/(?:[?&]v=|youtu\.be\/|\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function videoCardHtml(v) {
  const yid = ytVideoId(v.url);
  const thumb = yid
    ? `<div class="vid-thumb" data-play="${yid}" role="button" tabindex="0" aria-label="Play: ${esc(v.title)}">
         <img loading="lazy" src="https://i.ytimg.com/vi/${yid}/hqdefault.jpg" alt="">
         <span class="vid-play" aria-hidden="true">▶</span>
       </div>`
    : '';
  return `<article class="vid-card">
    ${thumb}
    <div class="vid-body">
      <div class="vid-movement">${esc(v.movement)}</div>
      <h3 class="vid-title">${esc(v.title)}</h3>
      <div class="muted vid-source">${esc(v.source)}</div>
      <p class="vid-note">${esc(v.note)}</p>
    </div>
  </article>`;
}
function renderVideos() {
  const grid = $('#vid-grid');
  if (!grid) return;
  const lib = (state.content && state.content.videoLibrary) || [];
  const counts = {};
  for (const v of lib) counts[v.category] = (counts[v.category] || 0) + 1;
  const cats = VID_CATEGORIES.filter(c => counts[c]);
  for (const c of Object.keys(counts)) if (!cats.includes(c)) cats.push(c);
  if (state.vidCat !== 'All' && !counts[state.vidCat]) state.vidCat = 'All';
  $('#vid-chips').innerHTML =
    `<button type="button" class="chip ${state.vidCat === 'All' ? 'active' : ''}" data-vidcat="All">All (${lib.length})</button>` +
    cats.map(c => `<button type="button" class="chip ${state.vidCat === c ? 'active' : ''}" data-vidcat="${esc(c)}">${esc(c)} (${counts[c]})</button>`).join('');
  const q = (state.vidQuery || '').trim().toLowerCase();
  const list = lib.filter(v => {
    if (state.vidCat !== 'All' && v.category !== state.vidCat) return false;
    if (q && !(v.title.toLowerCase().includes(q) || v.movement.toLowerCase().includes(q)
      || v.source.toLowerCase().includes(q) || v.note.toLowerCase().includes(q))) return false;
    return true;
  });
  $('#vid-count').textContent = lib.length
    ? `Showing ${list.length} of ${lib.length} videos.`
    : 'The video library has not loaded.';
  grid.innerHTML = list.length
    ? list.map(videoCardHtml).join('')
    : '<p class="muted">No videos match. Try a different search or category.</p>';
}

/* ---------------- definitions ---------------- */
const DEF_CATEGORIES = ['Types of Running', 'Sprint Drills & Warm-Up', 'Lifts & Strength',
  'Plyometrics & Power', 'Mobility, Activation & Core', 'Program Terms'];
function defCardHtml(e) {
  const cue = e.cues ? `<p class="def-cue"><strong>Cue:</strong> ${esc(e.cues)}</p>` : '';
  return `<article class="def-card">
    <div class="def-head">
      <h3 class="def-term">${esc(e.term)}</h3>
      <span class="def-cat">${esc(e.category)}</span>
    </div>
    <p class="def-text">${esc(e.definition)}</p>
    ${cue}
  </article>`;
}
function renderDefinitions() {
  const list = $('#def-list');
  if (!list) return;
  const gloss = (state.content && state.content.glossary) || [];
  const counts = {};
  for (const e of gloss) counts[e.category] = (counts[e.category] || 0) + 1;
  const cats = DEF_CATEGORIES.filter(c => counts[c]);
  for (const c of Object.keys(counts)) if (!cats.includes(c)) cats.push(c);
  if (state.defCat !== 'All' && !counts[state.defCat]) state.defCat = 'All';
  $('#def-chips').innerHTML =
    `<button type="button" class="chip ${state.defCat === 'All' ? 'active' : ''}" data-defcat="All">All (${gloss.length})</button>` +
    cats.map(c => `<button type="button" class="chip ${state.defCat === c ? 'active' : ''}" data-defcat="${esc(c)}">${esc(c)} (${counts[c]})</button>`).join('');
  const q = (state.defQuery || '').trim().toLowerCase();
  const rows = gloss.filter(e => {
    if (state.defCat !== 'All' && e.category !== state.defCat) return false;
    if (q && !(e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q)
      || (e.cues || '').toLowerCase().includes(q))) return false;
    return true;
  });
  $('#def-count').textContent = gloss.length
    ? `Showing ${rows.length} of ${gloss.length} definitions.`
    : 'The glossary has not loaded.';
  list.innerHTML = rows.length
    ? rows.map(defCardHtml).join('')
    : '<p class="muted">No definitions match. Try a different search or category.</p>';
}

/* ---------------- coach education ---------------- */
const EDU_BUCKETS = ['Local (DC Metro)', 'National (U.S.)', 'Online'];
function eduCardHtml(e) {
  return `<article class="edu-card">
    <div class="def-head">
      <h3 class="def-term">${esc(e.name)}</h3>
      <span class="def-cat">${esc(e.bucket)}</span>
    </div>
    <div class="muted edu-provider">${esc(e.provider)} · ${esc(e.location)}</div>
    <div class="edu-tags">
      <span class="badge plain">${esc(e.focus)}</span>
      <span class="badge plain">${esc(e.format)}</span>
    </div>
    <p class="def-text">${esc(e.notes)}</p>
    <p class="edu-link"><a class="btn secondary" href="${esc(e.url)}" target="_blank" rel="noopener">Visit site</a></p>
  </article>`;
}
function renderEducation() {
  const list = $('#edu-list');
  if (!list) return;
  const edu = (state.content && state.content.coachEducation) || [];
  const counts = {};
  for (const e of edu) counts[e.bucket] = (counts[e.bucket] || 0) + 1;
  const buckets = EDU_BUCKETS.filter(b => counts[b]);
  for (const b of Object.keys(counts)) if (!buckets.includes(b)) buckets.push(b);
  if (state.eduBucket !== 'All' && !counts[state.eduBucket]) state.eduBucket = 'All';
  $('#edu-chips').innerHTML =
    `<button type="button" class="chip ${state.eduBucket === 'All' ? 'active' : ''}" data-edubucket="All">All (${edu.length})</button>` +
    buckets.map(b => `<button type="button" class="chip ${state.eduBucket === b ? 'active' : ''}" data-edubucket="${esc(b)}">${esc(b)} (${counts[b]})</button>`).join('');
  const q = (state.eduQuery || '').trim().toLowerCase();
  const rows = edu.filter(e => {
    if (state.eduBucket !== 'All' && e.bucket !== state.eduBucket) return false;
    if (state.eduFocus && e.focus !== state.eduFocus) return false;
    if (q && !(e.name.toLowerCase().includes(q) || e.provider.toLowerCase().includes(q)
      || e.notes.toLowerCase().includes(q) || e.location.toLowerCase().includes(q))) return false;
    return true;
  });
  $('#edu-count').textContent = edu.length
    ? `Showing ${rows.length} of ${edu.length} trainings.`
    : 'The coach education list has not loaded.';
  list.innerHTML = rows.length
    ? rows.map(eduCardHtml).join('')
    : '<p class="muted">No trainings match. Try a different search, bucket, or focus.</p>';
}

/* ---------------- season ---------------- */
function renderSeason() {
  const weeks = state.content.weeks;
  const wk = weeks.find(w => w.week === state.week) || weeks[0];
  $('#week-jump').value = String(wk.week);
  const violations = spacingViolations();
  const weekBad = DAY_KEYS.filter(dk => violations.has(wk.week + ':' + dk));
  const spacingHtml = weekBad.length
    ? `<div class="flag">⚠️ Spacing check: hard days on ${weekBad.map(d => DAY_NAMES[d]).join(' and ')} sit less than 48 hours apart. Swap one to an easy day.</div>`
    : `<div class="ok-note">✓ Spacing check passed: every hard day this week is at least 48 hours from the next one.</div>`;
  $('#season-week').innerHTML = `
    <h2>Week ${wk.week} · ${esc(wk.phase)} · ${esc(wk.load)}</h2>
    ${LANE_DIVIDER}
    <p class="muted">${fmtRange(wk)} — ${esc(wk.focus)}</p>
    ${spacingHtml}
    ${DAY_KEYS.map(dk => dayCardHtml(wk, dk, dayInfo(wk, dk), { swappable: true })).join('')}
  `;
  $$('#season-week [data-swap]').forEach(sel => sel.addEventListener('change', onSwapChange));
}
async function onSwapChange(e) {
  const [week, day] = e.target.dataset.swap.split(':');
  const xt = e.target.value || null;
  try {
    const data = await apiPut('/api/swaps', { week: parseInt(week, 10), day, xt });
    state.swaps = data.swaps || {};
    renderSeason();
    if (parseInt(week, 10) === currentWeekNum()) renderHome();
  } catch (err) {
    alert(err.message);
    renderSeason();
  }
}
function fillWeekJump() {
  $('#week-jump').innerHTML = state.content.weeks.map(w =>
    `<option value="${w.week}">Week ${w.week} · ${esc(w.start)} · ${esc(w.phase)}</option>`).join('');
}

/* ---------------- log ---------------- */
function logEntryHtml(e) {
  const s = e.sessionId ? state.sessions.get(e.sessionId) : null;
  return `<div class="card log-entry">
    <div class="head"><strong>${esc(e.date)}${e.sessionId ? ' · ' + esc(e.sessionId) : ''}</strong>
    ${e.feel ? `<span class="badge plain">felt ${e.feel}/5</span>` : ''}</div>
    ${s ? `<div>${esc(s.name)}</div>` : ''}
    ${e.group ? `<div class="muted">${esc(e.group)}</div>` : ''}
    ${e.happened ? `<p>${esc(e.happened)}</p>` : ''}
    ${e.marks ? `<p><strong>Marks:</strong> ${esc(e.marks)}</p>` : ''}
    ${e.notes ? `<p class="muted">${esc(e.notes)}</p>` : ''}
    ${state.user ? `<button class="btn danger" data-del-log="${esc(e.id)}" type="button">Delete</button>` : ''}
  </div>`;
}
function renderLog() {
  const gate = $('#log-gate');
  const main = $('#log-main');
  if (!state.user) {
    gate.innerHTML = `<div class="card"><strong>Your log is private to your account.</strong>
      <p class="muted">Log in or create a free account to save entries. Browsing the workouts and the season plan never needs an account.</p>
      <button class="btn primary" data-goto="account" type="button">Go to account</button></div>`;
    gate.querySelector('[data-goto]').addEventListener('click', () => showView('account'));
    main.hidden = true;
    return;
  }
  gate.innerHTML = '';
  main.hidden = false;
  $('#log-list').innerHTML = state.logs.length
    ? '<h2>Your entries</h2>' + LANE_DIVIDER + state.logs.map(logEntryHtml).join('')
    : '<p class="muted">No entries yet. Your first practice is a good place to start.</p>';
  $$('#log-list [data-del-log]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this entry?')) return;
    try {
      await api('/api/logs/' + encodeURIComponent(b.dataset.delLog), { method: 'DELETE' });
      state.logs = state.logs.filter(x => x.id !== b.dataset.delLog);
      renderLog(); renderHome();
    } catch (err) { alert(err.message); }
  }));
}
async function refreshUserData() {
  if (!state.user) { state.logs = []; state.swaps = {}; state.groups = []; return; }
  try {
    const [logs, swaps, groups] = await Promise.all([
      api('/api/logs'), api('/api/swaps'),
      api('/api/groups').catch(() => ({ groups: [] })),
    ]);
    state.logs = logs.entries || [];
    state.swaps = swaps.swaps || {};
    state.groups = groups.groups || [];
  } catch (_) { state.logs = []; state.swaps = {}; }
}

/* ---------------- account ---------------- */
function renderAccount() {
  const chip = $('#account-chip');
  const note = $('#menu-account-note');
  if (state.user) {
    chip.innerHTML = `${esc(state.user.email)} · <button class="btn secondary" id="chip-logout" type="button" style="padding:2px 10px">Log out</button>`;
    note.textContent = 'Logged in as ' + state.user.email;
    $('#account-main').innerHTML = `<div class="card">
      <p>Logged in as <strong>${esc(state.user.email)}</strong>.</p>
      <p>${state.user.role === 'coach' ? '<span class="badge high">COACH ACCOUNT</span>' : '<span class="badge low">NOT A COACH ACCOUNT</span>'}</p>
      <p class="muted">Accounts are for coaches only — athletes never log in. The coach records everything: groups and rosters, assignments, testing results, weekly numbers, and health concerns. Your personal log entries and cross-training swaps save to this account.</p>
      <button class="btn" id="acct-logout" type="button">Log out</button></div>
      <div id="coach-accounts"></div>
      <div id="coach-invites"></div>`;
    renderCoachAccounts();
    renderCoachInvites();
    const out = async () => { await apiPost('/api/logout'); state.user = null; await refreshUserData(); syncAuthUi(); };
    $('#chip-logout').addEventListener('click', out);
    $('#acct-logout').addEventListener('click', out);
  } else {
    chip.textContent = 'Not logged in';
    note.textContent = 'Log in or create an account';
    $('#account-main').innerHTML = `
      <form id="login-form" class="card">
        <h2>Log in</h2>
        <label>Email <input type="email" id="li-email" required autocomplete="email"></label>
        <label>Password <input type="password" id="li-pass" required autocomplete="current-password"></label>
        <button class="btn primary" type="submit">Log in</button>
        <p class="error" id="li-err"></p>
      </form>
      <form id="register-form" class="card">
        <h2>Create an account</h2>
        <p class="muted">Free. You only need an account to save a practice log and cross-training swaps — everything else is open.</p>
        <label>Email <input type="email" id="rg-email" required autocomplete="email"></label>
        <label>Password (8+ characters) <input type="password" id="rg-pass" required autocomplete="new-password" minlength="8"></label>
        <button class="btn primary" type="submit">Create account</button>
        <p class="error" id="rg-err"></p>
      </form>`;
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        state.user = await apiPost('/api/login', { email: $('#li-email').value, password: $('#li-pass').value });
        await refreshUserData(); syncAuthUi(); showView('log');
      } catch (err) { $('#li-err').textContent = err.message; }
    });
    $('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        state.user = await apiPost('/api/register', { email: $('#rg-email').value, password: $('#rg-pass').value });
        await refreshUserData(); syncAuthUi(); showView('log');
      } catch (err) { $('#rg-err').textContent = err.message; }
    });
  }
}
function syncAuthUi() {
  const isCoach = !!(state.user && state.user.role === 'coach');
  $$('.coach-tab').forEach(t => { t.hidden = !isCoach; });
  renderAccount(); renderLog(); renderSeason(); renderHome();
  renderGroups(); renderCoach(); renderTesting(); renderTop(); renderHealth(); renderInventory();
  renderMeets(); renderReports(); renderCustomWorkouts();
  renderWarmupCards();
  if (isCoach) loadMedia();
}

/* ================================================================
   COACH SYSTEM — profiles, assignments, testing, weekly tracker,
   health concerns, demo media. Coach-input only: athletes never
   log in; the coach records everything.
   ================================================================ */
const isCoachUser = () => !!(state.user && state.user.role === 'coach');
const FEEL_OPTIONS = '<option value="">—</option><option value="1">1 — rough</option><option value="2">2</option><option value="3">3 — solid</option><option value="4">4</option><option value="5">5 — great</option>';
const EVENT_SUGGESTIONS = ['sprinter', 'jumper', 'hurdler'];
function mondayStr() {
  const t = todayLocal();
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return dateStrOf(t);
}
function dateStrOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function fmtNum(v) { return String(Math.round(v * 100) / 100); }
async function refreshProfiles() {
  if (!isCoachUser()) { state.profiles = []; return; }
  try {
    const [profs, groups] = await Promise.all([api('/api/profiles?includeArchived=1'), api('/api/groups')]);
    state.profiles = profs.profiles || [];
    state.groups = groups.groups || [];
  } catch (_) { /* keep old */ }
}
const activeProfiles = () => state.profiles.filter(pr => !pr.archived);
function profileOptions(selectedId, includeBlank) {
  const byGroup = {};
  for (const pr of activeProfiles()) {
    const gname = pr.groupName || 'No group';
    (byGroup[gname] = byGroup[gname] || []).push(pr);
  }
  let html = includeBlank ? '<option value="">— pick an athlete —</option>' : '';
  for (const gname of Object.keys(byGroup).sort()) {
    html += `<optgroup label="${esc(gname)}">` + byGroup[gname].map(pr =>
      `<option value="${pr.id}" ${pr.id === selectedId ? 'selected' : ''}>${esc(pr.name)}${pr.topAthlete ? ' ★' : ''}</option>`).join('') + '</optgroup>';
  }
  return html;
}
function eventBadges(pr) {
  return (pr.events || []).map(e => `<span class="badge plain">${esc(e)}</span>`).join(' ');
}
function gateHtml(el, what) {
  el.innerHTML = `<div class="card"><strong>Coaches only.</strong><p class="muted">${what} This system is run by the coach — athletes do not log in or enter data. <button class="btn secondary" data-goto="account" type="button">Go to account</button></p></div>`;
  const b = el.querySelector('[data-goto]');
  if (b) b.addEventListener('click', () => showView('account'));
}

/* ---------------- demo media ---------------- */
async function loadMedia() {
  try {
    const data = await api('/api/media');
    state.media = data.media || {};
    renderDrills();
    if (state.testDays.length) renderTesting();
  } catch (_) { /* media is optional */ }
}
function demoHtml(id, title) {
  if (!isCoachUser()) return '';
  const m = state.media[id];
  const view = m ? `<button class="btn secondary demo-btn" type="button" data-demo="${esc(id)}" data-demo-title="${esc(title || id)}">▶ Demo</button>` : '';
  return `<span class="demo-zone">${view}<button class="btn secondary demo-edit-btn" type="button" data-demo-edit="${esc(id)}" data-demo-title="${esc(title || id)}">${m ? 'Edit demo' : 'Add demo'}</button></span>`;
}
let mediaTarget = null;
function openMedia(id, title, editOnly) {
  mediaTarget = id;
  const m = state.media[id];
  $('#media-title').textContent = (title || id) + ' — demo';
  const player = $('#media-player');
  if (m && !editOnly) {
    player.innerHTML = m.type === 'youtube'
      ? `<div class="media-frame"><iframe src="${esc(m.embedUrl)}" title="Demo video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
      : `<img class="media-gif" src="${esc(m.url)}" alt="Demo animation">`;
  } else {
    player.innerHTML = m ? '' : '<p class="muted">No demo attached to this movement yet.</p>';
  }
  const ed = $('#media-edit');
  if (isCoachUser()) {
    ed.innerHTML = `<label>Demo link — YouTube or a .gif
      <input type="url" id="media-url" value="${m ? esc(m.url) : ''}" placeholder="https://www.youtube.com/watch?v=…"></label>
      <div class="filter-row">
        <button class="btn primary" id="media-save" type="button" style="width:auto">Save demo</button>
        ${m ? '<button class="btn danger" id="media-remove" type="button" style="width:auto">Remove</button>' : ''}
      </div>
      <p class="error" id="media-err"></p>`;
    $('#media-save').addEventListener('click', async () => {
      try {
        await apiPut('/api/media/' + encodeURIComponent(mediaTarget), { url: $('#media-url').value });
        closeMedia();
        await loadMedia();
      } catch (err) { $('#media-err').textContent = err.message; }
    });
    const rm = $('#media-remove');
    if (rm) rm.addEventListener('click', async () => {
      try {
        await apiDel('/api/media/' + encodeURIComponent(mediaTarget));
        closeMedia();
        await loadMedia();
      } catch (err) { $('#media-err').textContent = err.message; }
    });
  } else {
    ed.innerHTML = '';
  }
  $('#media-modal').hidden = false;
}
function closeMedia() {
  $('#media-modal').hidden = true;
  $('#media-player').innerHTML = '';
  mediaTarget = null;
}
document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-demo]');
  if (d) { openMedia(d.dataset.demo, d.dataset.demoTitle, false); return; }
  const de = e.target.closest('[data-demo-edit]');
  if (de) { openMedia(de.dataset.demoEdit, de.dataset.demoTitle, true); return; }
  const pc = e.target.closest('[data-print-card]');
  if (pc) {
    const card = document.getElementById(pc.dataset.printCard);
    if (card) {
      card.classList.add('print-target');
      document.body.classList.add('printing-card');
      const cleanup = () => {
        card.classList.remove('print-target');
        document.body.classList.remove('printing-card');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      setTimeout(cleanup, 1500);
      window.print();
    }
  }
});

/* ---------------- warm-up card editor ----------------
   The three cards ship as fixed HTML in index.html. A coach can edit
   a card's item lists in the app; the edit is stored server-side as
   an override (db.warmupCardEdits) and layered over the shipped card
   for every viewer. With no override, the shipped DOM is never
   touched, so the default cards render exactly as published. */
const WU_CARD_IDS = ['wu-card-1', 'wu-card-2', 'wu-card-3'];
let wuDefaultsCache = null;
const wuDomEdited = new Set();

function parseWuItem(li) {
  const text = li.textContent.replace(/\s+/g, ' ').trim();
  const strong = li.querySelector('strong');
  if (!strong) return { name: text, detail: '' };
  const name = strong.textContent.replace(/\s+/g, ' ').trim();
  const rest = text.slice(text.indexOf(name) + name.length).replace(/^[\s\u2014\u2013-]+/, '').trim();
  return { name, detail: rest };
}
/* The shipped defaults are parsed out of the static HTML itself, so
   the editor's "original" always matches the published card. Parsed
   once, before any override is applied to the DOM. */
function parseWuDefaults() {
  if (wuDefaultsCache) return wuDefaultsCache;
  const out = {};
  for (const id of WU_CARD_IDS) {
    const card = document.getElementById(id);
    if (!card) continue;
    const sections = [];
    card.querySelectorAll('.wu-sec').forEach(sec => {
      const ul = sec.querySelector('ul.wu-list');
      if (!ul) return;
      const h3 = sec.querySelector('h3');
      sections.push({
        title: h3 ? h3.textContent.replace(/\s+/g, ' ').trim() : 'Section',
        items: Array.from(ul.querySelectorAll(':scope > li')).map(parseWuItem),
      });
    });
    out[id] = sections;
  }
  wuDefaultsCache = out;
  return out;
}
function wuItemsHtml(items) {
  return (items || []).map(it =>
    `<li><strong>${esc(it.name)}</strong>${it.detail ? ' \u2014 ' + esc(it.detail) : ''}</li>`).join('');
}
function renderWuCardItems(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const ov = state.wuOverrides[cardId];
  if (!ov && !wuDomEdited.has(cardId)) return; /* shipped HTML stays untouched */
  const sections = ov ? ov.sections : (parseWuDefaults()[cardId] || []);
  const uls = card.querySelectorAll('.wu-sec ul.wu-list');
  (sections || []).forEach((sec, i) => {
    if (uls[i]) uls[i].innerHTML = wuItemsHtml(sec.items);
  });
  if (ov) wuDomEdited.add(cardId); else wuDomEdited.delete(cardId);
}
function renderWarmupCards() {
  parseWuDefaults();
  for (const id of WU_CARD_IDS) renderWuCardItems(id);
  $$('.wu-edit-ui').forEach(el => el.remove());
  state.wuEdit = null;
  if (!isCoachUser()) return;
  for (const id of WU_CARD_IDS) {
    const card = document.getElementById(id);
    if (!card) continue;
    const bar = document.createElement('div');
    bar.className = 'wu-edit-ui';
    bar.innerHTML = `
      <button class="btn secondary" type="button" data-wu-edit="${id}">Edit this card</button>
      ${state.wuOverrides[id] ? '<span class="badge plain">Edited by a coach</span>' : ''}
      <div class="wu-editor" id="wu-editor-${id}" hidden></div>`;
    const printBtn = card.querySelector('[data-print-card]');
    if (printBtn) card.insertBefore(bar, printBtn); else card.appendChild(bar);
    bar.querySelector('[data-wu-edit]').addEventListener('click', () => openWuEditor(id));
  }
}
function openWuEditor(cardId) {
  $$('.wu-editor').forEach(p => { p.hidden = true; p.innerHTML = ''; });
  const panel = document.getElementById('wu-editor-' + cardId);
  if (!panel) return;
  const src = state.wuOverrides[cardId]
    ? state.wuOverrides[cardId].sections
    : (parseWuDefaults()[cardId] || []);
  state.wuEdit = {
    cardId,
    work: (src || []).map(s => ({ items: (s.items || []).map(it => ({ name: it.name, detail: it.detail || '' })) })),
  };
  panel.hidden = false;
  drawWuEditor();
}
function closeWuEditor() {
  state.wuEdit = null;
  $$('.wu-editor').forEach(p => { p.hidden = true; p.innerHTML = ''; });
}
/* Pull whatever is currently typed in the open editor back into the
   working copy before any structural change re-renders the panel. */
function syncWuEditorInputs() {
  if (!state.wuEdit) return;
  const panel = document.getElementById('wu-editor-' + state.wuEdit.cardId);
  if (!panel) return;
  panel.querySelectorAll('[data-wu-name]').forEach(inp => {
    const sec = state.wuEdit.work[Number(inp.dataset.wuName)];
    if (sec && sec.items[Number(inp.dataset.wuIdx)]) sec.items[Number(inp.dataset.wuIdx)].name = inp.value;
  });
  panel.querySelectorAll('[data-wu-detail]').forEach(inp => {
    const sec = state.wuEdit.work[Number(inp.dataset.wuDetail)];
    if (sec && sec.items[Number(inp.dataset.wuIdx)]) sec.items[Number(inp.dataset.wuIdx)].detail = inp.value;
  });
}
function drawWuEditor() {
  if (!state.wuEdit) return;
  const { cardId, work } = state.wuEdit;
  const panel = document.getElementById('wu-editor-' + cardId);
  if (!panel) return;
  const defaults = parseWuDefaults()[cardId] || [];
  const drills = (state.content && state.content.drills) || [];
  const drillOptions = '<option value="">Quick-pick a drill...</option>' + drills.map(d =>
    `<option value="${esc(d.id)}">${esc(d.id)} \u00B7 ${esc(d.name)}</option>`).join('');
  panel.innerHTML = `
    <p class="muted">Editing this card. Your saved version is what everyone sees; the printed card updates too. Reset restores the original shipped card.</p>
    ${work.map((sec, si) => `
      <div class="wu-ed-sec">
        <h4>${esc((defaults[si] && defaults[si].title) || ('Section ' + (si + 1)))}</h4>
        ${sec.items.map((it, ii) => `
          <div class="wu-ed-row">
            <input class="wu-ed-name" type="text" data-wu-name="${si}" data-wu-idx="${ii}" value="${esc(it.name)}" placeholder="Item name" aria-label="Item name">
            <input class="wu-ed-detail" type="text" data-wu-detail="${si}" data-wu-idx="${ii}" value="${esc(it.detail)}" placeholder="Sets / distance / cues (optional)" aria-label="Item detail">
            <span class="wu-ed-btns">
              <button class="btn secondary" type="button" data-wu-move="-1" data-sec="${si}" data-idx="${ii}" aria-label="Move item up">Up</button>
              <button class="btn secondary" type="button" data-wu-move="1" data-sec="${si}" data-idx="${ii}" aria-label="Move item down">Down</button>
              <button class="btn danger" type="button" data-wu-remove data-sec="${si}" data-idx="${ii}">Remove</button>
            </span>
          </div>`).join('')}
        <div class="wu-ed-add">
          <select class="wu-add-drill" data-sec="${si}" aria-label="Quick-pick a drill">${drillOptions}</select>
          <input class="wu-add-name" type="text" data-sec="${si}" placeholder="New item name" aria-label="New item name">
          <input class="wu-add-detail" type="text" data-sec="${si}" placeholder="Sets / distance / cues (optional)" aria-label="New item detail">
          <button class="btn secondary" type="button" data-wu-add="${si}">Add item</button>
        </div>
      </div>`).join('')}
    <div class="wu-ed-actions">
      <button class="btn primary" type="button" data-wu-save>Save card</button>
      <button class="btn" type="button" data-wu-cancel>Cancel</button>
      ${state.wuOverrides[cardId] ? '<button class="btn danger" type="button" data-wu-reset>Reset to original</button>' : ''}
    </div>
    <p class="error" data-wu-err></p>`;
  panel.querySelectorAll('.wu-add-drill').forEach(sel => sel.addEventListener('change', () => {
    const d = drills.find(x => x.id === sel.value);
    if (!d) return;
    const si = sel.dataset.sec;
    const nameInp = panel.querySelector('.wu-add-name[data-sec="' + si + '"]');
    const detInp = panel.querySelector('.wu-add-detail[data-sec="' + si + '"]');
    if (nameInp) nameInp.value = d.name || '';
    if (detInp) detInp.value = [d.distance_or_reps, d.coaching_cue].filter(x => x && String(x).trim()).join(' \u2014 ');
  }));
  panel.querySelectorAll('[data-wu-move]').forEach(b => b.addEventListener('click', () => {
    syncWuEditorInputs();
    const si = Number(b.dataset.sec), ii = Number(b.dataset.idx), dir = Number(b.dataset.wuMove);
    const items = state.wuEdit.work[si].items;
    const j = ii + dir;
    if (j < 0 || j >= items.length) return;
    [items[ii], items[j]] = [items[j], items[ii]];
    drawWuEditor();
  }));
  panel.querySelectorAll('[data-wu-remove]').forEach(b => b.addEventListener('click', () => {
    syncWuEditorInputs();
    state.wuEdit.work[Number(b.dataset.sec)].items.splice(Number(b.dataset.idx), 1);
    drawWuEditor();
  }));
  panel.querySelectorAll('[data-wu-add]').forEach(b => b.addEventListener('click', () => {
    syncWuEditorInputs();
    const si = Number(b.dataset.wuAdd);
    const nameInp = panel.querySelector('.wu-add-name[data-sec="' + si + '"]');
    const detInp = panel.querySelector('.wu-add-detail[data-sec="' + si + '"]');
    const name = (nameInp.value || '').trim();
    if (!name) { panel.querySelector('[data-wu-err]').textContent = 'Give the new item a name first.'; return; }
    state.wuEdit.work[si].items.push({ name, detail: (detInp.value || '').trim() });
    drawWuEditor();
  }));
  const saveBtn = panel.querySelector('[data-wu-save]');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    syncWuEditorInputs();
    const errEl = panel.querySelector('[data-wu-err]');
    try {
      const data = await apiPut('/api/coach/warmup-cards/' + encodeURIComponent(cardId),
        { sections: state.wuEdit.work });
      state.wuOverrides[cardId] = { sections: data.sections };
      closeWuEditor();
      renderWarmupCards();
    } catch (err) { if (errEl) errEl.textContent = err.message; }
  });
  const cancelBtn = panel.querySelector('[data-wu-cancel]');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { closeWuEditor(); });
  const resetBtn = panel.querySelector('[data-wu-reset]');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    if (!confirm('Reset this card to the original shipped version?')) return;
    const errEl = panel.querySelector('[data-wu-err]');
    try {
      await apiDel('/api/coach/warmup-cards/' + encodeURIComponent(cardId));
      delete state.wuOverrides[cardId];
      closeWuEditor();
      renderWarmupCards();
    } catch (err) { if (errEl) errEl.textContent = err.message; }
  });
}

/* ---------------- SVG line charts (hand-rolled) ---------------- */
const CHART_COLORS = ['#CC0033', '#20242a', '#8A939F', '#C9A227', '#46647a', '#6a4a7a'];
function seriesFromEntries(entriesForProfile, metricKey) {
  const byWeek = (entriesForProfile || {})[metricKey] || {};
  return Object.keys(byWeek).sort().map(week => ({ week, value: byWeek[week] }));
}
function seriesStats(points, metric) {
  let best = null;
  if (points.length && metric.better !== 'neutral') {
    best = points.reduce((acc, pt) => acc === null ? pt.value : (metric.better === 'lower' ? Math.min(acc, pt.value) : Math.max(acc, pt.value)), null);
  }
  const first = points.length ? points[0].value : null;
  const latest = points.length ? points[points.length - 1].value : null;
  const delta = points.length > 1 ? Math.round((latest - first) * 100) / 100 : null;
  let improved = null;
  if (delta !== null && delta !== 0 && metric.better !== 'neutral') improved = metric.better === 'lower' ? delta < 0 : delta > 0;
  return { best, first, latest, delta, improved };
}
function deltaHtml(metric, stats) {
  if (!stats || stats.delta === null) return '<span class="muted">not enough weeks yet</span>';
  const arrow = stats.delta < 0 ? '▼' : (stats.delta > 0 ? '▲' : '—');
  const cls = stats.improved === null ? 'flat' : (stats.improved ? 'good' : 'bad');
  const sign = stats.delta > 0 ? '+' : '';
  return `<span class="delta ${cls}">${arrow} ${sign}${fmtNum(stats.delta)} ${esc(metric.unit)} since first week</span>`;
}
function lineChart(seriesList, metric, small) {
  const allWeeks = [...new Set(seriesList.flatMap(s => s.points.map(pt => pt.week)))].sort();
  const allVals = seriesList.flatMap(s => s.points.map(pt => pt.value));
  if (!allWeeks.length || !allVals.length) return '<p class="muted">No numbers yet.</p>';
  const W = 340, H = small ? 120 : 180, PL = 36, PR = 12, PT = 16, PB = 20;
  let min = Math.min(...allVals), max = Math.max(...allVals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.15;
  min -= pad; max += pad;
  const x = (week) => {
    const i = allWeeks.indexOf(week);
    return allWeeks.length === 1 ? (PL + W - PR) / 2 : PL + (i * (W - PL - PR)) / (allWeeks.length - 1);
  };
  const y = (v) => PT + (1 - (v - min) / (max - min)) * (H - PT - PB);
  let svg = '';
  for (let g = 0; g <= 3; g++) {
    const gv = min + ((max - min) * g) / 3;
    const gy = y(gv);
    svg += `<line x1="${PL}" y1="${gy}" x2="${W - PR}" y2="${gy}" class="chart-grid"/><text x="${PL - 4}" y="${gy + 3}" class="chart-axis" text-anchor="end">${fmtNum(gv)}</text>`;
  }
  allWeeks.forEach((wk, i) => {
    if (allWeeks.length <= 5 || i === 0 || i === allWeeks.length - 1) {
      svg += `<text x="${x(wk)}" y="${H - 5}" class="chart-axis" text-anchor="middle">${esc(wk.slice(5))}</text>`;
    }
  });
  seriesList.forEach((s, si) => {
    if (!s.points.length) return;
    const color = s.color || CHART_COLORS[si % CHART_COLORS.length];
    const line = s.points.map(pt => `${x(pt.week).toFixed(1)},${y(pt.value).toFixed(1)}`).join(' ');
    svg += `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    const stats = seriesStats(s.points, metric);
    for (const pt of s.points) {
      const isBest = stats.best !== null && pt.value === stats.best;
      svg += `<circle cx="${x(pt.week)}" cy="${y(pt.value)}" r="${isBest ? 5 : 3.5}" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${esc(s.label || '')} ${esc(pt.week)}: ${fmtNum(pt.value)} ${esc(metric.unit)}</title></circle>`;
      if (isBest) svg += `<text x="${x(pt.week)}" y="${y(pt.value) - 9}" class="chart-best" text-anchor="middle" fill="${color}">★ ${fmtNum(pt.value)}</text>`;
    }
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metric.name)} chart">${svg}</svg>`;
}

/* ---------------- coach accounts ---------------- */
async function renderCoachAccounts() {
  const el = $('#coach-accounts');
  if (!el || !isCoachUser()) return;
  try {
    const data = await api('/api/coaches');
    el.innerHTML = `<div class="card"><h3>Coach accounts</h3>
      <p class="muted">Accounts are for coaches only. Promote another account here if a second coach needs access.</p>
      ${data.users.map(u => `<div class="roster-row"><span>${esc(u.email)} ${u.role === 'coach' ? '<span class="badge high">COACH</span>' : '<span class="badge plain">NO ACCESS</span>'}</span>
      ${u.isOwner ? '<span class="muted">head coach</span>' : (u.id !== state.user.id ? `<button class="btn secondary" data-role-toggle="${u.id}" data-role="${u.role === 'coach' ? 'athlete' : 'coach'}" type="button">${u.role === 'coach' ? 'Remove coach access' : 'Make coach'}</button>` : '<span class="muted">you</span>')}</div>`).join('')}
    </div>`;
    el.querySelectorAll('[data-role-toggle]').forEach(b => b.addEventListener('click', async () => {
      try {
        await apiPut('/api/users/' + encodeURIComponent(b.dataset.roleToggle) + '/role', { role: b.dataset.role });
        renderCoachAccounts();
      } catch (err) { alert(err.message); }
    }));
  } catch (_) { el.innerHTML = ''; }
}

/* ---------------- assistant coaches (owner-managed invites) ---------------- */
async function renderCoachInvites() {
  const el = $('#coach-invites');
  if (!el || !isCoachUser()) return;
  try {
    const data = await api('/api/coach-invites');
    const isOwner = !!(state.user && state.user.isOwner);
    const coaches = data.coaches || [];
    const coachEmails = new Set(coaches.map(u => u.email));
    const pending = (data.invites || []).filter(e => !coachEmails.has(e));
    let html = `<div class="card"><h3>Assistant coaches</h3>
      <p class="muted">An invited coach shares full access to this team's data — roster, testing, weekly numbers, and health concerns. Invite by email; when they create an account with that email, they land as a coach.</p>`;
    if (isOwner) {
      html += `<form id="invite-form">
        <label>Email <input type="email" id="invite-email" required autocomplete="email" placeholder="assistant@school.edu"></label>
        <button class="btn primary" type="submit">Invite coach</button>
        <p class="error" id="invite-err"></p>
      </form>`;
    } else {
      html += `<p class="muted">Only the head coach manages invites.</p>`;
    }
    html += coaches.map(u => `<div class="roster-row"><span>${esc(u.email)} <span class="badge high">COACH</span>${u.isOwner ? ' <span class="badge plain">HEAD COACH</span>' : ''}</span>
      ${isOwner && !u.isOwner ? `<button class="btn secondary" data-invite-remove="${esc(u.email)}" type="button">Remove coach access</button>` : (u.isOwner ? '<span class="muted">owner</span>' : '<span class="muted">invited coach</span>')}</div>`).join('');
    html += pending.map(e => `<div class="roster-row"><span>${esc(e)} <span class="badge plain">INVITED — NOT REGISTERED YET</span></span>
      ${isOwner ? `<button class="btn secondary" data-invite-remove="${esc(e)}" type="button">Remove invite</button>` : ''}</div>`).join('');
    html += `</div>`;
    el.innerHTML = html;
    if (isOwner) {
      $('#invite-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await apiPost('/api/coach-invites', { email: $('#invite-email').value });
          renderCoachInvites(); renderCoachAccounts();
        } catch (err) { $('#invite-err').textContent = err.message; }
      });
      el.querySelectorAll('[data-invite-remove]').forEach(b => b.addEventListener('click', async () => {
        try {
          await apiDel('/api/coach-invites/' + encodeURIComponent(b.dataset.inviteRemove));
          renderCoachInvites(); renderCoachAccounts();
        } catch (err) { alert(err.message); }
      }));
    }
  } catch (_) { el.innerHTML = ''; }
}

/* ---------------- groups + roster ---------------- */
async function renderGroups() {
  const el = $('#groups-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Rosters and groups live here.'); return; }
  await refreshProfiles();
  const allEvents = [...new Set(state.profiles.flatMap(pr => pr.events || []))].sort();
  const groupOpts = (sel) => '<option value="">No group</option>' + state.groups.map(g =>
    `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
  let list = activeProfiles();
  if (state.pfGroup === '__none') list = list.filter(pr => !pr.groupId);
  else if (state.pfGroup) list = list.filter(pr => pr.groupId === state.pfGroup);
  if (state.pfEvent) list = list.filter(pr => (pr.events || []).includes(state.pfEvent));
  if (state.pfTop) list = list.filter(pr => pr.topAthlete);
  if (state.pfQ) list = list.filter(pr => pr.name.toLowerCase().includes(state.pfQ.toLowerCase()));
  const byGroup = new Map();
  for (const pr of list) {
    const key = pr.groupId || '__none';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(pr);
  }
  const groupSections = [...state.groups.map(g => g.id), '__none'].filter(k => byGroup.has(k)).map(k => {
    const gname = k === '__none' ? 'No group' : (state.groups.find(g => g.id === k) || {}).name;
    return `<h3>${esc(gname || '')}</h3>` + byGroup.get(k).map(pr => `
      <div class="card roster-card">
        <div class="roster-row">
          <span><strong>${esc(pr.name)}</strong> ${pr.topAthlete ? '<span class="badge star">★ TOP</span>' : ''} ${eventBadges(pr)}</span>
          <span class="roster-actions">
            <button class="btn secondary" data-star="${pr.id}" type="button">${pr.topAthlete ? 'Unstar' : '★ Star'}</button>
            <button class="btn secondary" data-archive="${pr.id}" type="button">Archive</button>
          </span>
        </div>
        <label>Group <select data-move="${pr.id}">${groupOpts(pr.groupId)}</select></label>
        <details>
          <summary>Edit profile</summary>
          <label>First name <input type="text" id="ef-${pr.id}" value="${esc(pr.firstName)}"></label>
          <label>Last name <input type="text" id="el-${pr.id}" value="${esc(pr.lastName)}"></label>
          <label>Events (comma list — sprinter, jumper, hurdler…)
            <input type="text" id="ee-${pr.id}" value="${esc((pr.events || []).join(', '))}"></label>
          <button class="btn primary" data-save-profile="${pr.id}" type="button">Save profile</button>
        </details>
      </div>`).join('');
  }).join('');
  el.innerHTML = `
    <div class="card">
      <h2>Filters</h2>
      <div class="filter-row">
        <select id="pf-group">
          <option value="">All groups</option>
          <option value="__none" ${state.pfGroup === '__none' ? 'selected' : ''}>No group</option>
          ${state.groups.map(g => `<option value="${g.id}" ${state.pfGroup === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
        </select>
        <select id="pf-event">
          <option value="">All events</option>
          ${[...new Set([...EVENT_SUGGESTIONS, ...allEvents])].map(e => `<option value="${esc(e)}" ${state.pfEvent === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}
        </select>
      </div>
      <label>Search <input type="search" id="pf-q" value="${esc(state.pfQ)}" placeholder="Athlete name"></label>
      <label class="check-line"><input type="checkbox" id="pf-top" ${state.pfTop ? 'checked' : ''}> Top Athletes only</label>
      <p class="muted">${list.length} athlete${list.length === 1 ? '' : 's'} shown · ${activeProfiles().length} on the roster</p>
      <p><a class="btn secondary" href="/api/export/roster.csv">Download roster (CSV)</a></p>
    </div>
    ${groupSections || '<p class="muted">No athletes match. Add one below or import the roster.</p>'}
    <form class="card" id="profile-form">
      <h2>Add an athlete</h2>
      <div class="filter-row">
        <label>First name <input type="text" id="np-first" required></label>
        <label>Last name <input type="text" id="np-last" required></label>
      </div>
      <label>Group <select id="np-group">${groupOpts(null)}</select></label>
      <label>Events (comma list) <input type="text" id="np-events" placeholder="sprinter, hurdler"></label>
      <label class="check-line"><input type="checkbox" id="np-top"> Top Athlete ★</label>
      <button class="btn primary" type="submit">Add athlete</button>
      <p class="error" id="np-err"></p>
    </form>
    <form class="card" id="group-form">
      <h2>Groups</h2>
      ${state.groups.map(g => `<div class="roster-row"><span>${esc(g.name)}</span><span>
        <button class="btn secondary" data-rename-group="${g.id}" type="button">Rename</button>
        <button class="btn danger" data-delete-group="${g.id}" type="button">Delete</button></span></div>`).join('')}
      <label>New group name <input type="text" id="ng-name" placeholder="e.g. 100/200"></label>
      <button class="btn primary" type="submit">Create group</button>
      <p class="error" id="ng-err"></p>
    </form>
    <div class="card">
      <h2>Bulk roster import</h2>
      <p class="muted">One athlete per line: <code>Last, First | Group | events (comma list) | Top (optional: yes)</code><br>
      Example: <code>Doe, John | 100/200 | sprinter, hurdler | yes</code><br>
      A simple CSV with a <code>name,group,events,top</code> header also works. Groups are created as needed; duplicate names in the same group are skipped and reported.</p>
      <label>Roster lines <textarea id="import-text" rows="6" placeholder="Doe, John | 100/200 | sprinter | yes"></textarea></label>
      <button class="btn primary" id="import-btn" type="button">Import roster</button>
      <div id="import-report">${state.importReport ? importReportHtml(state.importReport) : ''}</div>
    </div>
    <div id="archived-zone"></div>`;
  $('#pf-group').addEventListener('change', (e) => { state.pfGroup = e.target.value; renderGroups(); });
  $('#pf-event').addEventListener('change', (e) => { state.pfEvent = e.target.value; renderGroups(); });
  $('#pf-top').addEventListener('change', (e) => { state.pfTop = e.target.checked; renderGroups(); });
  $('#pf-q').addEventListener('input', (e) => { state.pfQ = e.target.value; clearTimeout(state._pfT); state._pfT = setTimeout(renderGroups, 250); });
  el.querySelectorAll('[data-move]').forEach(sel => sel.addEventListener('change', async () => {
    try { await apiPut('/api/profiles/' + encodeURIComponent(sel.dataset.move), { groupId: sel.value || null }); renderGroups(); }
    catch (err) { alert(err.message); renderGroups(); }
  }));
  el.querySelectorAll('[data-star]').forEach(b => b.addEventListener('click', async () => {
    const pr = state.profiles.find(x => x.id === b.dataset.star);
    try { await apiPut('/api/profiles/' + encodeURIComponent(b.dataset.star), { topAthlete: !(pr && pr.topAthlete) }); renderGroups(); }
    catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-archive]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Archive this athlete? Their records stay saved and you can restore them later.')) return;
    try { await apiDel('/api/profiles/' + encodeURIComponent(b.dataset.archive)); renderGroups(); }
    catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-save-profile]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.saveProfile;
    try {
      await apiPut('/api/profiles/' + encodeURIComponent(id), {
        firstName: $('#ef-' + CSS.escape(id)).value,
        lastName: $('#el-' + CSS.escape(id)).value,
        events: $('#ee-' + CSS.escape(id)).value.split(',').map(s => s.trim()).filter(Boolean),
      });
      renderGroups();
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-rename-group]').forEach(b => b.addEventListener('click', async () => {
    const g = state.groups.find(x => x.id === b.dataset.renameGroup);
    const name = prompt('New name for this group:', g ? g.name : '');
    if (!name) return;
    try { await apiPut('/api/groups/' + encodeURIComponent(b.dataset.renameGroup), { name }); renderGroups(); }
    catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-delete-group]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this group? Athletes in it become unassigned; their records stay.')) return;
    try { await apiDel('/api/groups/' + encodeURIComponent(b.dataset.deleteGroup)); renderGroups(); }
    catch (err) { alert(err.message); }
  }));
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/api/profiles', {
        firstName: $('#np-first').value, lastName: $('#np-last').value,
        groupId: $('#np-group').value || null,
        events: $('#np-events').value.split(',').map(s => s.trim()).filter(Boolean),
        topAthlete: $('#np-top').checked,
      });
      renderGroups();
    } catch (err) { $('#np-err').textContent = err.message; }
  });
  $('#group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/api/groups', { name: $('#ng-name').value });
      renderGroups();
    } catch (err) { $('#ng-err').textContent = err.message; }
  });
  $('#import-btn').addEventListener('click', async () => {
    try {
      const data = await apiPost('/api/profiles/import', { text: $('#import-text').value });
      state.importReport = data.report;
      renderGroups();
    } catch (err) { alert(err.message); }
  });
  renderArchived();
}
function importReportHtml(r) {
  return `<div class="ok-note">Import done: <strong>${r.created}</strong> athlete${r.created === 1 ? '' : 's'} created, <strong>${r.groupsCreated}</strong> group${r.groupsCreated === 1 ? '' : 's'} created.</div>
    ${r.skipped.length ? `<div class="flag">Skipped ${r.skipped.length}:<br>${r.skipped.map(s => `Line ${s.line}: ${esc(s.text)} — ${esc(s.reason)}`).join('<br>')}</div>` : ''}
    ${r.errors.length ? `<div class="flag">Could not read ${r.errors.length} line${r.errors.length === 1 ? '' : 's'}:<br>${r.errors.map(s => `Line ${s.line}: ${esc(s.text)} — ${esc(s.reason)}`).join('<br>')}</div>` : ''}`;
}
async function renderArchived() {
  const el = $('#archived-zone');
  if (!el) return;
  const archived = state.profiles.filter(pr => pr.archived);
  if (!archived.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card"><h3>Archived athletes</h3>
    ${archived.map(pr => `<div class="roster-row"><span>${esc(pr.name)}</span>
      <button class="btn secondary" data-restore="${pr.id}" type="button">Restore</button></div>`).join('')}</div>`;
  el.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
    try { await apiPut('/api/profiles/' + encodeURIComponent(b.dataset.restore), { archived: false }); renderGroups(); }
    catch (err) { alert(err.message); }
  }));
}

/* ---------------- coach view: assignments + completions ---------------- */
async function renderCoach() {
  const el = $('#coach-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Daily assignments and checklists live here.'); return; }
  if (!state.feedDate) state.feedDate = todayStr();
  await refreshProfiles();
  let feed;
  try { feed = await api('/api/coach/feed?date=' + encodeURIComponent(state.feedDate)); }
  catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const sessionOpts = (sel) => '<option value="">— pick a workout —</option>' + state.content.sessions.map(s =>
    `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${s.id} · ${esc(s.name)}</option>`).join('');
  const groupCard = (blk) => {
    if (!blk.group) {
      return `<div class="card"><h3>No group</h3>
        ${blk.members.length ? blk.members.map(m => `<div class="roster-row"><span>${esc(m.profile.name)}</span><span class="muted">assign a group in Groups</span></div>`).join('') : '<p class="muted">Everyone is in a group.</p>'}
      </div>`;
    }
    const a = blk.assignment;
    return `<div class="card">
      <h3>${esc(blk.group.name)}</h3>
      <p class="plan">${a.sessionId ? `<a class="code-link" data-code="${a.sessionId}">${a.sessionId}</a> ${esc(a.sessionName)}` : esc(a.planText || 'Rest day')}
        ${a.source === 'override' ? '<span class="badge plain">YOUR PICK</span>' : '<span class="badge plain">FROM THE PLAN</span>'}</p>
      ${a.note ? `<p><strong>Your note:</strong> ${esc(a.note)}</p>` : ''}
      ${a.warmup ? `<div class="warmup">Warm-up: ${esc(a.warmup)}</div>` : ''}
      <details>
        <summary>Change today's workout for this group</summary>
        <label>Workout <select id="ov-${blk.group.id}">${sessionOpts(a.sessionId)}</select></label>
        <label>Note (optional) <input type="text" id="ovn-${blk.group.id}" value="${esc(a.note || '')}" placeholder="e.g. Keep it at 90% today"></label>
        <div class="filter-row">
          <button class="btn primary" data-override="${blk.group.id}" type="button" style="width:auto">Save override</button>
          <button class="btn secondary" data-clear-override="${blk.group.id}" type="button" style="width:auto">Back to the plan</button>
        </div>
      </details>
      <h4>Who got it done</h4>
      ${blk.members.length ? blk.members.map(m => `
        <div class="roster-row check-row">
          <span>${m.completed ? '✅' : '⬜'} <strong>${esc(m.profile.name)}</strong> ${m.profile.topAthlete ? '<span class="badge star">★</span>' : ''}
          ${m.completed && m.completion ? `<span class="muted">${esc(m.completion.marks || '')}${m.completion.feel ? ' · felt ' + m.completion.feel + '/5' : ''}</span>` : ''}</span>
          ${m.completed
            ? `<button class="btn secondary" data-unmark="${m.profile.id}" type="button">Undo</button>`
            : `<span class="check-inputs"><input type="text" id="cm-${m.profile.id}" placeholder="marks (optional)">
               <select id="cf-${m.profile.id}">${FEEL_OPTIONS}</select>
               <button class="btn primary" data-mark="${m.profile.id}" type="button" style="width:auto">Mark done</button></span>`}
        </div>`).join('') : '<p class="muted">No athletes in this group yet.</p>'}
    </div>`;
  };
  el.innerHTML = `
    <div class="card">
      <h3>Weight room TV</h3>
      <p class="muted">Put the full Workout of the Day on the weight-room TV — every group's workout in full, warm-up included, one page per group, rotating on its own.</p>
      <p><button class="btn secondary" id="coach-open-tv" type="button">Open the TV board</button></p>
    </div>
    <div class="card">
      <label>Date <input type="date" id="feed-date" value="${esc(state.feedDate)}"></label>
      <p class="muted">Each group gets the season plan's workout by default. Override it when the day calls for something else, then check off who completed it — marks and feel land on the athlete's record.</p>
    </div>
    ${feed.groups.map(groupCard).join('')}
    ${groupCard(feed.unassigned)}`;
  $('#coach-open-tv').addEventListener('click', () => showView('tv'));
  $('#feed-date').addEventListener('change', (e) => { state.feedDate = e.target.value; renderCoach(); });
  el.querySelectorAll('[data-override]').forEach(b => b.addEventListener('click', async () => {
    const gid = b.dataset.override;
    try {
      await apiPost('/api/assignments/override', {
        groupId: gid, date: state.feedDate,
        sessionId: $('#ov-' + CSS.escape(gid)).value,
        note: $('#ovn-' + CSS.escape(gid)).value,
      });
      renderCoach();
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-clear-override]').forEach(b => b.addEventListener('click', async () => {
    try {
      await apiPost('/api/assignments/override', { groupId: b.dataset.clearOverride, date: state.feedDate, sessionId: null });
      renderCoach();
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-mark]').forEach(b => b.addEventListener('click', async () => {
    const pid = b.dataset.mark;
    try {
      await apiPost('/api/completions', {
        profileId: pid, date: state.feedDate,
        marks: $('#cm-' + CSS.escape(pid)).value,
        feel: $('#cf-' + CSS.escape(pid)).value ? parseInt($('#cf-' + CSS.escape(pid)).value, 10) : null,
      });
      renderCoach();
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-unmark]').forEach(b => b.addEventListener('click', async () => {
    try {
      await apiPost('/api/completions', { profileId: b.dataset.unmark, date: state.feedDate, completed: false });
      renderCoach();
    } catch (err) { alert(err.message); }
  }));
}

/* ---------------- testing tracker ---------------- */
function resultRawText(r, test) {
  if (test && test.kind === 'lift') {
    if (r.reps) return `${fmtNum(r.weight)} × ${r.reps}`;
    return `${fmtNum(r.weight)}`;
  }
  return `${fmtNum(r.value)} ${test ? esc(test.unit) : ''}`;
}
async function renderTesting() {
  const el = $('#testing-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Testing days and results live here.'); return; }
  await refreshProfiles();
  let tests, days;
  try {
    const [t, d] = await Promise.all([api('/api/tests'), api('/api/test-days')]);
    tests = t.tests; days = d.testDays;
    state.tests = tests; state.testDays = days;
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  if (!state.testDayId || !days.some(d => d.id === state.testDayId)) {
    state.testDayId = days.length ? days[0].id : null;
  }
  const day = days.find(d => d.id === state.testDayId) || null;
  let dayResults = [];
  if (day) {
    try { dayResults = (await api('/api/results?testDayId=' + encodeURIComponent(day.id))).results; }
    catch (_) { dayResults = []; }
  }
  const resultFor = (pid, key) => dayResults.find(r => r.profileId === pid && r.testKey === key);
  const dayTests = day ? day.testKeys.map(k => tests.find(t => t.key === k)).filter(Boolean) : [];
  const testInputs = (test, current, pid) => {
    const cur = current ? `<div class="muted">Now: ${resultRawText(current, test)}${test.kind === 'lift' ? ` · est. 1RM ${fmtNum(current.display || current.est1rm)} lb` : ''}</div>` : '';
    if (test.kind === 'lift') {
      return `${cur}<div class="filter-row">
        <label>Weight (lb) <input type="number" step="any" min="0" id="rw-${pid}-${test.key}" value="${current ? esc(current.weight) : ''}"></label>
        <label>Reps (blank = top single) <input type="number" step="1" min="1" max="30" id="rr-${pid}-${test.key}" value="${current && current.reps ? esc(current.reps) : ''}"></label>
        <button class="btn primary" data-save-result="${pid}:${test.key}" type="button" style="width:auto">Save</button></div>`;
    }
    return `${cur}<div class="filter-row">
      <label>Result (${esc(test.unit)}) <input type="number" step="any" min="0" id="rv-${pid}-${test.key}" value="${current ? esc(current.value) : ''}"></label>
      <button class="btn primary" data-save-result="${pid}:${test.key}" type="button" style="width:auto">Save</button></div>`;
  };
  el.innerHTML = `
    <form class="card" id="testday-form">
      <h2>New test day</h2>
      <div class="filter-row">
        <label>Date <input type="date" id="td-date" value="${todayStr()}" required></label>
        <label>Title <input type="text" id="td-title" placeholder="Fall Weight Room Testing" required></label>
      </div>
      <div class="test-checks">
        ${tests.map(t => `<label class="check-line"><input type="checkbox" class="td-test" value="${t.key}" ${['back-squat', 'hang-clean', 'bench-press'].includes(t.key) ? 'checked' : ''}> ${esc(t.name)} (${esc(t.unit)})</label>`).join('')}
      </div>
      <button class="btn primary" type="submit">Create test day</button>
      <p class="error" id="td-err"></p>
    </form>
    <form class="card" id="customtest-form">
      <h2>Add a custom test</h2>
      <div class="filter-row">
        <label>Name <input type="text" id="ct-name" placeholder="e.g. Med ball throw"></label>
        <label>Unit <input type="text" id="ct-unit" placeholder="lb, in, reps, sec…"></label>
        <label>Type <select id="ct-kind"><option value="lift">Lift (lb, est. 1RM)</option><option value="measure">Measured</option><option value="reps">Reps</option></select></label>
      </div>
      <button class="btn primary" type="submit">Add test</button>
      <p class="error" id="ct-err"></p>
    </form>
    ${days.length ? `
    <div class="card">
      <label>Test day
        <select id="td-pick">${days.map(d => `<option value="${d.id}" ${day && d.id === day.id ? 'selected' : ''}>${esc(d.date)} · ${esc(d.title)}</option>`).join('')}</select>
      </label>
      ${day ? `<button class="btn danger" id="td-delete" type="button">Delete this test day</button>` : ''}
    </div>` : '<div class="card"><p class="muted">No test days yet. Create the first one above.</p></div>'}
    <div class="card">
      <h2>Export</h2>
      <p class="muted">Every result from every test day in one spreadsheet — raw entries plus estimated 1RMs.</p>
      <a class="btn secondary" href="/api/export/testing.csv">Download testing results (CSV)</a>
    </div>
    ${day ? `
    <div class="card">
      <h2>${esc(day.title)} — progress</h2>
      <p class="muted">${esc(day.date)} · tap an athlete below and walk the room.</p>
      <div class="table-wrap"><table class="matrix">
        <thead><tr><th>Athlete</th>${dayTests.map(t => `<th>${esc(t.name)}</th>`).join('')}</tr></thead>
        <tbody>
        ${activeProfiles().map(pr => `<tr><td>${esc(pr.name)}</td>${dayTests.map(t => `<td>${resultFor(pr.id, t.key) ? '✅' : '<span class="muted">·</span>'}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table></div>
    </div>
    <div class="card">
      <h2>Rapid entry</h2>
      <label>Athlete <select id="rapid-athlete">${profileOptions(state.rapidAthleteId, true)}</select></label>
      <div id="rapid-zone"></div>
    </div>
    <div class="card">
      <h2>Test-day grid — whole group, one save</h2>
      <p class="muted">Every athlete in the group as a row, every test on this day as a column, prefilled with what is already saved — so this is also where you fix a number. Change anything and save once: the whole grid writes together, or not at all. If a cell is invalid, nothing is saved and the bad cells are flagged. Blank a saved cell completely to clear it.</p>
      <label>Group <select id="grid-group">
        <option value="" ${!state.gridGroupId ? 'selected' : ''}>All athletes</option>
        ${state.groups.map(g => `<option value="${g.id}" ${state.gridGroupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select></label>
      <div id="grid-zone"></div>
      <p><button class="btn primary" id="grid-save" type="button" style="width:auto">Save the whole grid</button></p>
      <p class="error" id="grid-err"></p>
      <ul class="grid-err-list" id="grid-err-list"></ul>
    </div>
    <div class="card">
      <h2>Ranked — ${esc(day.title)}</h2>
      ${dayTests.map(t => {
        const rows = dayResults.filter(r => r.testKey === t.key).slice()
          .sort((a, b) => (b.display || 0) - (a.display || 0));
        return `<h3>${esc(t.name)} ${demoHtml(t.key, t.name)}</h3>
        ${rows.length ? `<div class="table-wrap"><table class="ranked">
          <thead><tr><th>#</th><th>Athlete</th><th>Result</th>${t.kind === 'lift' ? '<th>Est. 1RM</th>' : ''}</tr></thead>
          <tbody>${rows.map((r, i) => {
            const pr = state.profiles.find(x => x.id === r.profileId);
            return `<tr><td>${i + 1}</td><td>${esc(pr ? pr.name : '?')}</td><td>${resultRawText(r, t)}</td>${t.kind === 'lift' ? `<td><strong>${fmtNum(r.display)} lb</strong></td>` : ''}</tr>`;
          }).join('')}</tbody></table></div>` : '<p class="muted">No results yet.</p>'}`;
      }).join('')}
    </div>
    <div class="card">
      <h2>Athlete history</h2>
      <label>Athlete <select id="hist-athlete">${profileOptions(state.rapidAthleteId, true)}</select></label>
      <div id="hist-zone"></div>
    </div>` : ''}`;
  $('#testday-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const keys = Array.from(el.querySelectorAll('.td-test')).filter(c => c.checked).map(c => c.value);
    try {
      const data = await apiPost('/api/test-days', { date: $('#td-date').value, title: $('#td-title').value, testKeys: keys });
      state.testDayId = data.testDay.id;
      renderTesting();
    } catch (err) { $('#td-err').textContent = err.message; }
  });
  $('#customtest-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/api/tests', { name: $('#ct-name').value, unit: $('#ct-unit').value, kind: $('#ct-kind').value });
      renderTesting();
    } catch (err) { $('#ct-err').textContent = err.message; }
  });
  const pick = $('#td-pick');
  if (pick) pick.addEventListener('change', () => { state.testDayId = pick.value; renderTesting(); });
  const del = $('#td-delete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Delete this test day and all its results?')) return;
    try { await apiDel('/api/test-days/' + encodeURIComponent(day.id)); state.testDayId = null; renderTesting(); }
    catch (err) { alert(err.message); }
  });
  if (!day) return;
  const renderRapid = () => {
    const zone = $('#rapid-zone');
    const pid = $('#rapid-athlete').value;
    state.rapidAthleteId = pid || null;
    if (!pid) { zone.innerHTML = '<p class="muted">Pick an athlete to start entering.</p>'; return; }
    const pr = state.profiles.find(x => x.id === pid);
    zone.innerHTML = `<h3>${esc(pr ? pr.name : '')}</h3>` + dayTests.map(t => `
      <div class="rapid-test">
        <div class="roster-row"><strong>${esc(t.name)}</strong> ${demoHtml(t.key, t.name)}</div>
        ${testInputs(t, resultFor(pid, t.key), pid)}
      </div>`).join('');
    zone.querySelectorAll('[data-save-result]').forEach(b => b.addEventListener('click', async () => {
      const [p2, key] = b.dataset.saveResult.split(':');
      const test = tests.find(t => t.key === key);
      const body = { profileId: p2, testDayId: day.id, testKey: key };
      try {
        if (test.kind === 'lift') {
          body.weight = $('#rw-' + CSS.escape(p2) + '-' + CSS.escape(key)).value;
          const reps = $('#rr-' + CSS.escape(p2) + '-' + CSS.escape(key)).value;
          if (reps) body.reps = parseInt(reps, 10);
        } else {
          body.value = $('#rv-' + CSS.escape(p2) + '-' + CSS.escape(key)).value;
        }
        await apiPost('/api/results', body);
        renderTesting();
      } catch (err) { alert(err.message); }
    }));
  };
  const ra = $('#rapid-athlete');
  if (ra) { ra.addEventListener('change', renderRapid); renderRapid(); }
  const gridZone = $('#grid-zone');
  const gridRows = () => activeProfiles().filter(pr => !state.gridGroupId || pr.groupId === state.gridGroupId);
  const renderGrid = () => {
    if (!gridZone) return;
    const rows = gridRows();
    if (!rows.length) { gridZone.innerHTML = '<p class="muted">No athletes in this group yet.</p>'; return; }
    const cellInputs = (pr, t) => {
      const cur = resultFor(pr.id, t.key);
      const cellKey = pr.id + ':' + t.key;
      if (t.kind === 'lift') {
        return `<input type="number" step="any" min="0" class="grid-in grid-w" data-cell="${cellKey}" placeholder="lb" value="${cur ? esc(cur.weight) : ''}">`
          + `<input type="number" step="1" min="1" max="30" class="grid-in grid-r" data-cell="${cellKey}" placeholder="reps" value="${cur && cur.reps ? esc(cur.reps) : ''}">`;
      }
      return `<input type="number" step="any" min="0" class="grid-in grid-v" data-cell="${cellKey}" placeholder="${esc(t.unit)}" value="${cur ? esc(cur.value) : ''}">`;
    };
    gridZone.innerHTML = `<div class="table-wrap"><table class="matrix grid-table">
      <thead><tr><th>Athlete</th>${dayTests.map(t => `<th>${esc(t.name)}${t.kind === 'lift' ? ' (lb × reps)' : ' (' + esc(t.unit) + ')'}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(pr => `<tr><td>${esc(pr.name)}</td>${dayTests.map(t => `<td data-cellwrap="${pr.id}:${t.key}">${cellInputs(pr, t)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  };
  const gg = $('#grid-group');
  if (gg) gg.addEventListener('change', () => { state.gridGroupId = gg.value; renderGrid(); });
  renderGrid();
  const gridSave = $('#grid-save');
  if (gridSave) gridSave.addEventListener('click', async () => {
    const errEl = $('#grid-err');
    const listEl = $('#grid-err-list');
    errEl.textContent = '';
    listEl.innerHTML = '';
    gridZone.querySelectorAll('.cell-error').forEach(td => td.classList.remove('cell-error'));
    const entries = [], clear = [];
    for (const pr of gridRows()) {
      for (const t of dayTests) {
        const key = pr.id + ':' + t.key;
        const existing = resultFor(pr.id, t.key);
        if (t.kind === 'lift') {
          const wEl = gridZone.querySelector('.grid-w[data-cell="' + key + '"]');
          const rEl = gridZone.querySelector('.grid-r[data-cell="' + key + '"]');
          const wv = wEl ? wEl.value.trim() : '';
          const rv = rEl ? rEl.value.trim() : '';
          if (!wv && !rv) { if (existing) clear.push({ profileId: pr.id, testKey: t.key }); continue; }
          const entry = { profileId: pr.id, testKey: t.key, weight: wv };
          if (rv) entry.reps = rv;
          entries.push(entry);
        } else {
          const inp = gridZone.querySelector('.grid-v[data-cell="' + key + '"]');
          const vv = inp ? inp.value.trim() : '';
          if (!vv) { if (existing) clear.push({ profileId: pr.id, testKey: t.key }); continue; }
          entries.push({ profileId: pr.id, testKey: t.key, value: vv });
        }
      }
    }
    if (!entries.length && !clear.length) {
      errEl.textContent = 'Nothing to save — the grid matches what is already stored.';
      return;
    }
    try {
      const res = await fetch('/api/results/bulk', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testDayId: day.id, entries, clear }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errEl.textContent = data.error || 'The grid could not be saved.';
        if (Array.isArray(data.cellErrors)) {
          listEl.innerHTML = data.cellErrors.map(ce => {
            const pr = state.profiles.find(x => x.id === ce.profileId);
            const t = tests.find(x => x.key === ce.testKey);
            const td = gridZone.querySelector('[data-cellwrap="' + ce.profileId + ':' + ce.testKey + '"]');
            if (td) td.classList.add('cell-error');
            return `<li>${esc(pr ? pr.name : ce.profileId)} — ${esc(t ? t.name : ce.testKey)}: ${esc(ce.error)}</li>`;
          }).join('');
        }
        return;
      }
      renderTesting();
    } catch (err) { errEl.textContent = err.message; }
  });
  const renderHist = async () => {
    const zone = $('#hist-zone');
    const pid = $('#hist-athlete').value;
    if (!pid) { zone.innerHTML = '<p class="muted">Pick an athlete to see their testing history.</p>'; return; }
    try {
      const data = await api('/api/results?profileId=' + encodeURIComponent(pid));
      const byDay = {};
      for (const r of data.results) { (byDay[r.testDayId] = byDay[r.testDayId] || []).push(r); }
      const dayList = state.testDays.filter(d => byDay[d.id]);
      zone.innerHTML = dayList.length ? dayList.map(d => `
        <h4>${esc(d.date)} · ${esc(d.title)}</h4>
        ${byDay[d.id].map(r => {
          const t = tests.find(x => x.key === r.testKey);
          const pb = data.personalBests[r.testKey];
          const isPb = pb && pb.display === r.display;
          return `<div class="roster-row"><span>${esc(t ? t.name : r.testKey)}</span>
            <span>${resultRawText(r, t)}${t && t.kind === 'lift' ? ` · est. <strong>${fmtNum(r.display)} lb</strong>` : ''} ${isPb ? '<span class="badge star">PB ★</span>' : ''}</span></div>`;
        }).join('')}`).join('') : '<p class="muted">No results yet for this athlete.</p>';
    } catch (err) { zone.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };
  const ha = $('#hist-athlete');
  if (ha) { ha.addEventListener('change', renderHist); renderHist(); }
}

/* ---------------- Top Athletes weekly tracker ---------------- */
async function renderTop() {
  const el = $('#top-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'The Top Athletes tracker lives here.'); return; }
  let dash;
  try { dash = await api('/api/weekly/dashboard'); }
  catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const metrics = dash.metrics;
  if (!metrics.some(m => m.key === state.topMetric)) state.topMetric = metrics[0] ? metrics[0].key : 'fly-30m';
  if (!metrics.some(m => m.key === state.entryMetric)) state.entryMetric = state.topMetric;
  if (!state.topWeek) state.topWeek = mondayStr();
  const metric = metrics.find(m => m.key === state.topMetric);
  const entryMetricObj = metrics.find(m => m.key === state.entryMetric);
  let overlay = { athletes: [] };
  try { overlay = await api('/api/weekly/overlay?metricId=' + encodeURIComponent(state.topMetric)); } catch (_) { /* ignore */ }
  const tops = dash.topAthletes;
  el.innerHTML = `
    ${tops.length ? `
    <div class="card">
      <h2>Compare Top Athletes</h2>
      <label>Metric <select id="top-metric">${metrics.map(m => `<option value="${m.key}" ${m.key === state.topMetric ? 'selected' : ''}>${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select></label>
      ${lineChart(overlay.athletes.map((a, i) => ({ label: a.name, color: CHART_COLORS[i % CHART_COLORS.length], points: a.points })), metric)}
      <div class="legend">
        ${overlay.athletes.map((a, i) => `<div class="roster-row"><span><span class="swatch" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span> ${esc(a.name)}${a.best !== null ? ` · best ${fmtNum(a.best)} ${esc(metric.unit)}` : ''}</span>${deltaHtml(metric, a)}</div>`).join('')}
      </div>
    </div>
    <div class="card">
      <h2>Enter this week's numbers</h2>
      <div class="filter-row">
        <label>Week of (Monday) <input type="date" id="top-week" value="${esc(state.topWeek)}"></label>
        <label>Metric <select id="top-entry-metric">${metrics.map(m => `<option value="${m.key}" ${m.key === state.entryMetric ? 'selected' : ''}>${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select></label>
      </div>
      ${tops.map(pr => {
        const cur = ((dash.entries[pr.id] || {})[state.entryMetric] || {})[state.topWeek];
        return `<div class="roster-row"><span>${esc(pr.name)} ${cur !== undefined ? `<span class="muted">now ${fmtNum(cur)} ${esc(entryMetricObj.unit)}</span>` : ''}</span>
          <span class="check-inputs"><input type="number" step="any" min="0" id="wv-${pr.id}" value="${cur !== undefined ? esc(cur) : ''}" placeholder="${esc(entryMetricObj.unit)}">
          <button class="btn primary" data-weekly-save="${pr.id}" type="button" style="width:auto">Save</button></span></div>`;
      }).join('')}
      <p class="muted">Saving overwrites that week's number — one value per athlete per week.</p>
      <p><a class="btn secondary" href="/api/export/weekly.csv">Download weekly tracker (CSV)</a></p>
    </div>
    <div class="card">
      <h2>Each athlete</h2>
      ${tops.map(pr => {
        const charts = metrics.map(m => {
          const pts = seriesFromEntries(dash.entries[pr.id], m.key);
          if (!pts.length) return '';
          const stats = seriesStats(pts, m);
          return `<h4>${esc(m.name)} <span class="muted">best ${stats.best !== null ? fmtNum(stats.best) + ' ' + esc(m.unit) : '—'}</span> ${deltaHtml(m, stats)}</h4>
            ${lineChart([{ label: pr.name, color: '#CC0033', points: pts }], m, true)}`;
        }).join('');
        return `<h3>${esc(pr.name)} ${eventBadges(pr)}</h3>${charts || '<p class="muted">No weekly numbers yet.</p>'}`;
      }).join('')}
    </div>` : `<div class="card"><strong>No Top Athletes yet.</strong>
      <p class="muted">Star athletes in the Groups view (★ Star on a profile) and they will show up here with their weekly graphs.</p></div>`}
    <form class="card" id="custommetric-form">
      <h2>Add a custom weekly metric</h2>
      <div class="filter-row">
        <label>Name <input type="text" id="cm-name" placeholder="e.g. 150m time"></label>
        <label>Unit <input type="text" id="cm-unit" placeholder="sec, in, lb…"></label>
        <label>Better is <select id="cm-better"><option value="higher">Higher</option><option value="lower">Lower</option><option value="neutral">Neither (just track it)</option></select></label>
      </div>
      <button class="btn primary" type="submit">Add metric</button>
      <p class="error" id="cm-err"></p>
    </form>`;
  const tm = $('#top-metric');
  if (tm) tm.addEventListener('change', () => { state.topMetric = tm.value; renderTop(); });
  const tw = $('#top-week');
  if (tw) tw.addEventListener('change', () => { state.topWeek = tw.value; renderTop(); });
  const tem = $('#top-entry-metric');
  if (tem) tem.addEventListener('change', () => { state.entryMetric = tem.value; renderTop(); });
  el.querySelectorAll('[data-weekly-save]').forEach(b => b.addEventListener('click', async () => {
    const pid = b.dataset.weeklySave;
    const val = $('#wv-' + CSS.escape(pid)).value;
    try {
      await apiPut('/api/weekly/entry', { profileId: pid, metricId: state.entryMetric, week: state.topWeek, value: val === '' ? '' : Number(val) });
      renderTop();
    } catch (err) { alert(err.message); }
  }));
  $('#custommetric-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/api/weekly/metrics', { name: $('#cm-name').value, unit: $('#cm-unit').value, better: $('#cm-better').value });
      renderTop();
    } catch (err) { $('#cm-err').textContent = err.message; }
  });
}

/* ---------------- aches & pains ---------------- */
const AREA_LABELS = { ankle: 'Ankle', achilles: 'Achilles', calf: 'Calf', shin: 'Shin', knee: 'Knee', hamstring: 'Hamstring', quad: 'Quad', 'hip-flexor': 'Hip flexor', hip: 'Hip', groin: 'Groin', glute: 'Glute', 'lower-back': 'Lower back', foot: 'Foot', shoulder: 'Shoulder', other: 'Other' };
const FEELING_LABELS = { ache: 'Ache', sharp: 'Sharp pain', tightness: 'Tightness', soreness: 'Soreness', stiffness: 'Stiffness', swelling: 'Swelling', other: 'Other' };
const IMPACT_LABELS = { none: 'No effect', modified: 'Modified training', stopped: 'Stopped me' };
const STATUS_LABELS = { new: 'New', monitoring: 'Monitoring', cleared: 'Cleared' };
async function renderHealth() {
  const el = $('#health-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Health concerns live here.'); return; }
  await refreshProfiles();
  let concerns = [];
  try { concerns = (await api('/api/concerns')).concerns; state.concerns = concerns; }
  catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const concernCard = (c) => `
    <div class="card concern-card ${c.flagged ? 'flagged' : ''}">
      <div class="roster-row">
        <span><strong>${esc(c.athleteName)}</strong> · ${esc(AREA_LABELS[c.area] || c.area)} (${esc(c.side)}) — ${esc(FEELING_LABELS[c.feeling] || c.feeling)}</span>
        <span><span class="badge ${c.pain >= 7 ? 'high' : 'plain'}">PAIN ${c.pain}/10</span>
        ${c.impact === 'stopped' ? '<span class="badge high">STOPPED</span>' : `<span class="badge plain">${esc(IMPACT_LABELS[c.impact] || c.impact)}</span>`}
        <span class="badge ${c.status === 'cleared' ? 'low' : 'plain'}">${esc(STATUS_LABELS[c.status] || c.status).toUpperCase()}</span></span>
      </div>
      <p class="muted">Started ${esc(c.started)} · filed ${esc(String(c.createdAt).slice(0, 10))}</p>
      ${c.note ? `<p>${esc(c.note)}</p>` : ''}
      <div class="filter-row">
        <label>Status <select id="cs-${c.id}">
          ${Object.keys(STATUS_LABELS).map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select></label>
        <label>Pain now <select id="cp-${c.id}">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}" ${c.pain === n ? 'selected' : ''}>${n}/10</option>`).join('')}
        </select></label>
      </div>
      <label>Coach note <input type="text" id="cn-${c.id}" value="${esc(c.coachNote || '')}" placeholder="e.g. Sent to athletic trainer"></label>
      <button class="btn primary" data-concern-save="${c.id}" type="button">Save update</button>
    </div>`;
  const byAthlete = {};
  for (const c of concerns) { (byAthlete[c.athleteName] = byAthlete[c.athleteName] || []).push(c); }
  el.innerHTML = `
    <form class="card" id="concern-form">
      <h2>Record a concern</h2>
      <p class="muted">An athlete tells you something hurts — you write it down here so the plan can adjust.</p>
      <label>Athlete <select id="hc-athlete">${profileOptions(null, true)}</select></label>
      <div class="filter-row">
        <label>Body area <select id="hc-area">${Object.keys(AREA_LABELS).map(a => `<option value="${a}">${AREA_LABELS[a]}</option>`).join('')}</select></label>
        <label>Side <select id="hc-side"><option value="left">Left</option><option value="right">Right</option><option value="both">Both</option><option value="na">N/A</option></select></label>
      </div>
      <div class="filter-row">
        <label>Feels like <select id="hc-feeling">${Object.keys(FEELING_LABELS).map(f => `<option value="${f}">${FEELING_LABELS[f]}</option>`).join('')}</select></label>
        <label>Pain (1-10) <select id="hc-pain">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}" ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="filter-row">
        <label>When it started <input type="date" id="hc-started" value="${todayStr()}"></label>
        <label>Effect on training <select id="hc-impact"><option value="none">No effect</option><option value="modified">Modified</option><option value="stopped">Stopped me</option></select></label>
      </div>
      <label>Note <textarea id="hc-note" rows="2" placeholder="What the athlete said, in their words if you can"></textarea></label>
      <button class="btn primary" type="submit">File concern</button>
      <p class="error" id="hc-err"></p>
    </form>
    <h2>All concerns</h2>
    ${LANE_DIVIDER}
    <p class="muted">High pain (7+) and "stopped" concerns sit at the top until cleared.</p>
    ${concerns.length ? concerns.map(concernCard).join('') : '<p class="muted">No concerns on file. Good news.</p>'}
    <h2>History by athlete</h2>
    ${LANE_DIVIDER}
    ${Object.keys(byAthlete).sort().map(name => `
      <details class="card"><summary><strong>${esc(name)}</strong> — ${byAthlete[name].length} concern${byAthlete[name].length === 1 ? '' : 's'}</summary>
      ${byAthlete[name].map(c => `<div class="roster-row"><span>${esc(AREA_LABELS[c.area] || c.area)} (${esc(c.side)}) · ${esc(FEELING_LABELS[c.feeling] || c.feeling)} · started ${esc(c.started)}</span>
        <span><span class="badge ${c.pain >= 7 ? 'high' : 'plain'}">${c.pain}/10</span> <span class="badge plain">${esc(STATUS_LABELS[c.status] || c.status)}</span></span></div>`).join('')}
      </details>`).join('') || '<p class="muted">Nothing yet.</p>'}`;
  $('#concern-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/api/concerns', {
        profileId: $('#hc-athlete').value,
        area: $('#hc-area').value, side: $('#hc-side').value, feeling: $('#hc-feeling').value,
        pain: parseInt($('#hc-pain').value, 10), started: $('#hc-started').value,
        impact: $('#hc-impact').value, note: $('#hc-note').value,
      });
      renderHealth();
    } catch (err) { $('#hc-err').textContent = err.message; }
  });
  el.querySelectorAll('[data-concern-save]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.concernSave;
    try {
      await apiPut('/api/concerns/' + encodeURIComponent(id), {
        status: $('#cs-' + CSS.escape(id)).value,
        pain: parseInt($('#cp-' + CSS.escape(id)).value, 10),
        coachNote: $('#cn-' + CSS.escape(id)).value,
      });
      renderHealth();
    } catch (err) { alert(err.message); }
  }));
}

/* ---------------- equipment inventory ---------------- */
const INV_CATEGORIES = ['Starting Blocks', 'Hurdles', 'Relay Batons', 'Throws Implements',
  'Timing & Tech', 'Medicine Balls', 'Bands & Mobility', 'Plyo & Training Aids',
  'Cones & Markers', 'Uniforms & Gear', 'First Aid & Medical', 'Other'];
const INV_CONDITIONS = ['Good', 'Fair', 'Replace'];
function invConditionBadge(c) {
  if (c === 'Replace') return '<span class="badge high">REPLACE</span>';
  if (c === 'Good') return '<span class="badge done">GOOD</span>';
  return '<span class="badge plain">FAIR</span>';
}
async function renderInventory() {
  const el = $('#inventory-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'The equipment inventory lives here.'); return; }
  try {
    const data = await api('/api/inventory');
    state.invItems = data.items || [];
  } catch (err) {
    el.innerHTML = '<p class="error">Could not load the inventory: ' + esc(err.message) + '</p>';
    return;
  }
  const items = state.invItems;
  const totalUnits = items.reduce((s, i) => s + (i.quantity || 0), 0);
  const replaceCount = items.filter(i => i.condition === 'Replace').length;
  const editing = state.invEditId ? items.find(i => i.id === state.invEditId) : null;
  if (state.invEditId && !editing) state.invEditId = null;
  let list = items.slice();
  if (state.invCat) list = list.filter(i => i.category === state.invCat);
  if (state.invQ) {
    const q = state.invQ.toLowerCase();
    list = list.filter(i => i.name.toLowerCase().includes(q)
      || (i.location || '').toLowerCase().includes(q) || (i.note || '').toLowerCase().includes(q));
  }
  const catOpts = (sel, blankLabel) => (blankLabel ? `<option value="">${blankLabel}</option>` : '')
    + INV_CATEGORIES.map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const condOpts = (sel) => INV_CONDITIONS.map(c =>
    `<option value="${c}" ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
  const itemCard = (i) => `
    <div class="card inv-card">
      <div class="roster-row">
        <span><strong>${esc(i.name)}</strong> · ×${i.quantity}${i.location ? ' · ' + esc(i.location) : ''}</span>
        <span class="roster-actions">
          ${invConditionBadge(i.condition)}
          <button class="btn secondary" data-inv-edit="${i.id}" type="button">Edit</button>
          <button class="btn danger" data-inv-del="${i.id}" type="button">Delete</button>
        </span>
      </div>
      ${i.note ? `<p class="inv-note">${esc(i.note)}</p>` : ''}
      <p class="muted inv-updated">Updated ${esc(String(i.updatedAt || '').slice(0, 10))}</p>
    </div>`;
  const groupSections = INV_CATEGORIES.filter(c => list.some(i => i.category === c))
    .map(c => `<h3>${esc(c)}</h3>` + list.filter(i => i.category === c).map(itemCard).join('')).join('');
  el.innerHTML = `
    <div class="hero-stats">
      <div class="hero-stat"><span class="stat-num">${items.length}</span><span class="stat-label">Item types</span></div>
      <div class="hero-stat"><span class="stat-num">${totalUnits}</span><span class="stat-label">Total units</span></div>
      <div class="hero-stat ${replaceCount ? 'inv-flag' : ''}"><span class="stat-num">${replaceCount}</span><span class="stat-label">Flagged Replace</span></div>
    </div>
    <div class="card">
      <h2>Filters</h2>
      <div class="filter-row">
        <select id="inv-filter-cat">${catOpts(state.invCat, 'All categories')}</select>
      </div>
      <label>Search <input type="search" id="inv-filter-q" value="${esc(state.invQ)}" placeholder="Item, location, or note"></label>
      <p class="muted">${list.length} of ${items.length} item types shown.</p>
    </div>
    ${items.length === 0
      ? '<div class="card"><h2>No equipment logged yet</h2><p class="muted">This is your inventory book for the whole program — blocks, hurdles, implements, timing gear, all of it. Add the first item below: what it is, how many you have, what shape it is in, and where it lives. Once it is in here, counts and replacement flags stay one glance away.</p></div>'
      : (groupSections || '<p class="muted">No items match those filters.</p>')}
    <form class="card" id="inv-form">
      <h2>${editing ? 'Edit item' : 'Add an item'}</h2>
      <label>Name <input type="text" id="inv-name" required value="${editing ? esc(editing.name) : ''}" placeholder="e.g. Championship starting blocks"></label>
      <div class="filter-row">
        <label>Category <select id="inv-category">${catOpts(editing ? editing.category : 'Starting Blocks')}</select></label>
        <label>Quantity <input type="number" id="inv-quantity" min="0" step="1" required value="${editing ? editing.quantity : ''}" placeholder="0"></label>
      </div>
      <div class="filter-row">
        <label>Condition <select id="inv-condition">${condOpts(editing ? editing.condition : 'Good')}</select></label>
        <label>Location <input type="text" id="inv-location" value="${editing ? esc(editing.location || '') : ''}" placeholder="e.g. Track shed"></label>
      </div>
      <label>Note <textarea id="inv-note" rows="2" placeholder="Anything worth knowing — sizes, a broken part, who borrowed it">${editing ? esc(editing.note || '') : ''}</textarea></label>
      <button class="btn primary" type="submit">${editing ? 'Save changes' : 'Add item'}</button>
      ${editing ? '<button class="btn secondary" id="inv-cancel" type="button">Cancel edit</button>' : ''}
      <p class="error" id="inv-err"></p>
    </form>`;
  $('#inv-filter-cat').addEventListener('change', (e) => { state.invCat = e.target.value; renderInventory(); });
  $('#inv-filter-q').addEventListener('input', (e) => { state.invQ = e.target.value; clearTimeout(state._invT); state._invT = setTimeout(renderInventory, 250); });
  el.querySelectorAll('[data-inv-edit]').forEach(b => b.addEventListener('click', () => {
    state.invEditId = b.dataset.invEdit;
    renderInventory();
    const f = $('#inv-form');
    if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  el.querySelectorAll('[data-inv-del]').forEach(b => b.addEventListener('click', async () => {
    const item = state.invItems.find(i => i.id === b.dataset.invDel);
    if (!confirm('Delete "' + (item ? item.name : 'this item') + '" from the inventory?')) return;
    try {
      await apiDel('/api/inventory/' + encodeURIComponent(b.dataset.invDel));
      if (state.invEditId === b.dataset.invDel) state.invEditId = null;
      renderInventory();
    } catch (err) { alert(err.message); }
  }));
  const cancelBtn = $('#inv-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { state.invEditId = null; renderInventory(); });
  $('#inv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: $('#inv-name').value,
      category: $('#inv-category').value,
      quantity: parseInt($('#inv-quantity').value, 10),
      condition: $('#inv-condition').value,
      location: $('#inv-location').value,
      note: $('#inv-note').value,
    };
    try {
      if (state.invEditId) await apiPut('/api/inventory/' + encodeURIComponent(state.invEditId), payload);
      else await apiPost('/api/inventory', payload);
      state.invEditId = null;
      renderInventory();
    } catch (err) { $('#inv-err').textContent = err.message; }
  });
}

/* RUNNER-CORE-BEGIN */
/* Runner mode — pure step-building. No DOM in this section: the
   test suite loads it directly to verify the step sequences.
   A runner plan is { title, blocks: [{ rounds, restBetweenRounds,
   restAfterBlock, exercises: [{ name, reps }] }] } — exactly the
   shape of a coach-built custom workout, and the shape library
   sessions are mapped into by sessionToRunnerPlan below.
   buildRunnerSteps flattens a plan into the walk: every exercise
   of every round, a rest step after each round (the block's
   rest-between-rounds) and after each block except the last (the
   block's rest-after). Zero-second rests are skipped entirely, so
   a no-rest block flows straight through. */
function buildRunnerSteps(plan) {
  const steps = [];
  const blocks = (plan && plan.blocks) || [];
  blocks.forEach((block, bi) => {
    const exercises = block.exercises || [];
    const rounds = Math.max(1, block.rounds || 1);
    for (let round = 1; round <= rounds; round++) {
      exercises.forEach((ex, ei) => {
        steps.push({
          type: 'exercise', block: bi, blocks: blocks.length,
          round, rounds, exIndex: ei, name: ex.name, reps: ex.reps,
        });
      });
      if (round < rounds && block.restBetweenRounds > 0) {
        steps.push({ type: 'rest', kind: 'round', block: bi, blocks: blocks.length, afterRound: round, seconds: block.restBetweenRounds });
      }
    }
    if (bi < blocks.length - 1 && block.restAfterBlock > 0) {
      steps.push({ type: 'rest', kind: 'block', block: bi, blocks: blocks.length, seconds: block.restAfterBlock });
    }
  });
  return steps;
}
/* Best-effort seconds from a session's free-text rest ("2-3 min",
   "30-45 sec between reps, 6 min between sets", "walk back",
   "full"). A minutes figure wins when one exists — on multi-part
   rests it is the between-sets / full recovery that ends a round. */
function parseRestSeconds(text) {
  const t = String(text || '').toLowerCase();
  const mins = [...t.matchAll(/(\d+)\s*(?:-\s*(\d+))?\s*min/g)];
  if (mins.length) {
    const m = mins[mins.length - 1];
    const lo = parseInt(m[1], 10);
    const hi = m[2] ? parseInt(m[2], 10) : lo;
    return Math.round(((lo + hi) / 2) * 60);
  }
  const secs = t.match(/(\d+)\s*(?:-\s*(\d+))?\s*sec/);
  if (secs) {
    const lo = parseInt(secs[1], 10);
    const hi = secs[2] ? parseInt(secs[2], 10) : lo;
    return Math.round((lo + hi) / 2);
  }
  if (/walk ?back/.test(t)) return 60;
  if (/full/.test(t)) return 180;
  if (/continuous|circuit|n\/a|none|as needed/.test(t)) return 0;
  return 120;
}
/* Map a library session onto a runner plan. Sessions are spec
   sheets, not exercise lists, so the mapping is best-effort:
   - "N sets x M" (no '+' and no distance after the x): N rounds of
     M work steps — or one work step per set when the session has no
     rep distance, since its work is described in prose.
   - A leading count or range ("6-8", "8", "2 sets"): that many
     rounds (upper bound of a range) of one work step — "Run 30m
     @ 98%" built from the rep distance and intensity.
   - Anything else (warm-ups, recovery, prose circuits): a single
     step that puts the session itself on the screen. */
function sessionToRunnerPlan(s) {
  const title = s.id + ' · ' + s.name;
  const dist = s.rep_distance_m ? s.rep_distance_m + 'm' : '';
  const workName = dist ? 'Run ' + dist : s.name;
  const workReps = s.intensity_pct ? '@ ' + s.intensity_pct + '%' : '';
  const restSec = parseRestSeconds(s.rest);
  const repsText = String(s.reps || '');
  const hi = (a, b) => parseInt(b || a, 10);
  if (!/\+/.test(repsText) && !/x\s*\d+\s*m/i.test(repsText)) {
    const m = repsText.match(/(\d+)\s*(?:-\s*(\d+))?\s*(?:sets?\s*(?:of\s*)?)?x\s*(\d+)\s*(?:-\s*(\d+))?/i);
    if (m) {
      const sets = Math.min(10, Math.max(1, hi(m[1], m[2])));
      const per = dist ? Math.min(10, Math.max(1, hi(m[3], m[4]))) : 1;
      const exercises = [];
      for (let i = 0; i < per; i++) exercises.push({ name: workName, reps: workReps || repsText });
      return { title, blocks: [{ rounds: sets, restBetweenRounds: restSec, restAfterBlock: 0, exercises }] };
    }
  }
  const m2 = repsText.match(/^(\d+)\s*(?:-\s*(\d+))?\s*(sets?|rounds?)?\b/i);
  if (m2) {
    const count = hi(m2[1], m2[2]);
    if (count >= 2 && count <= 20) {
      return { title, blocks: [{ rounds: count, restBetweenRounds: restSec, restAfterBlock: 0, exercises: [{ name: workName, reps: workReps || repsText }] }] };
    }
  }
  return { title, blocks: [{ rounds: 1, restBetweenRounds: 0, restAfterBlock: 0, exercises: [{ name: s.name, reps: repsText }] }] };
}
/* RUNNER-CORE-END */

/* ---------------- runner mode (display) ----------------
   A full-screen walk through a workout: the current exercise huge,
   one big advance button, honest rest timers (timestamp-based, so
   a backgrounded tab cannot corrupt them). Opened from a custom
   workout's Run it button or a library session's Run this workout. */
const runner = {
  open: false, plan: null, steps: [], idx: 0,
  startedAt: 0, endsAt: 0, remaining: 0, paused: false, tickId: null, audioCtx: null,
};
function repsLabel(reps) {
  const r = String(reps || '').trim();
  if (/^\d+$/.test(r)) return r + ' reps';
  if (/^max$/i.test(r)) return 'MAX reps';
  return r;
}
function fmtCountdown(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function fmtElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function runnerBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = runner.audioCtx || (runner.audioCtx = new Ctx());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    o.start(); o.stop(ctx.currentTime + 0.45);
  } catch (_) { /* sound is a nicety, never an error */ }
}
function openRunner(plan) {
  runner.plan = plan;
  runner.steps = buildRunnerSteps(plan);
  runner.idx = 0;
  runner.startedAt = Date.now();
  runner.paused = false;
  runner.open = true;
  const ov = $('#runner-overlay');
  if (!ov) return;
  ov.hidden = false;
  document.body.classList.add('runner-mode');
  $('#runner-workout').textContent = plan.title;
  document.addEventListener('keydown', runnerKey);
  renderRunnerStep();
}
function closeRunner() {
  runnerStopTick();
  runner.open = false;
  const ov = $('#runner-overlay');
  if (ov) ov.hidden = true;
  document.body.classList.remove('runner-mode');
  document.removeEventListener('keydown', runnerKey);
}
function runnerStopTick() {
  if (runner.tickId) { clearInterval(runner.tickId); runner.tickId = null; }
}
function runnerKey(e) {
  if (!runner.open) return;
  if (e.key === 'Escape') { closeRunner(); return; }
  if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); runnerAdvance(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); runnerBack(); }
  else if (e.key === 'p' || e.key === 'P') { runnerTogglePause(); }
}
function runnerAdvance() {
  if (!runner.open) return;
  runnerStopTick();
  runner.paused = false;
  runner.idx++;
  renderRunnerStep();
}
function runnerBack() {
  if (!runner.open) return;
  runnerStopTick();
  runner.paused = false;
  if (runner.idx > 0) runner.idx--;
  renderRunnerStep();
}
function runnerTogglePause() {
  const step = runner.steps[runner.idx];
  if (!step || step.type !== 'rest') return;
  const btn = $('#runner-pause');
  if (runner.paused) {
    runner.endsAt = Date.now() + runner.remaining * 1000;
    runner.paused = false;
    runnerStartTick();
    if (btn) btn.textContent = 'Pause';
  } else {
    runner.remaining = Math.max(0, (runner.endsAt - Date.now()) / 1000);
    runnerStopTick();
    runner.paused = true;
    if (btn) btn.textContent = 'Resume';
  }
}
function runnerAddTime(sec) {
  const step = runner.steps[runner.idx];
  if (!step || step.type !== 'rest') return;
  if (runner.paused) {
    runner.remaining += sec;
  } else {
    runner.endsAt += sec * 1000;
  }
  runnerPaintCountdown();
}
function runnerStartTick() {
  runnerStopTick();
  runnerPaintCountdown();
  runner.tickId = setInterval(() => {
    const left = (runner.endsAt - Date.now()) / 1000;
    if (left <= 0) {
      runnerStopTick();
      runnerBeep();
      runnerAdvance();
      return;
    }
    runnerPaintCountdown();
  }, 200);
}
function runnerPaintCountdown() {
  const el = $('#runner-count');
  if (!el) return;
  const left = runner.paused ? runner.remaining : (runner.endsAt - Date.now()) / 1000;
  el.textContent = fmtCountdown(left);
}
function runnerNextExercise(fromIdx) {
  for (let i = fromIdx + 1; i < runner.steps.length; i++) {
    if (runner.steps[i].type === 'exercise') return runner.steps[i];
  }
  return null;
}
function renderRunnerStep() {
  runnerStopTick();
  const main = $('#runner-main');
  if (!main) return;
  const total = runner.steps.length;
  if (runner.idx >= total) {
    const exCount = runner.steps.filter(s => s.type === 'exercise').length;
    main.innerHTML = `
      <div class="runner-done">
        <p class="runner-where">${esc(runner.plan.title)}</p>
        <h2 class="runner-done-title">Workout complete</h2>
        <p class="runner-done-stats">${exCount} exercises · Total time ${fmtElapsed(Date.now() - runner.startedAt)}</p>
        <button class="btn runner-btn primary" id="runner-done-btn" type="button">Done</button>
      </div>`;
    $('#runner-done-btn').addEventListener('click', closeRunner);
    runnerBeep();
    return;
  }
  const step = runner.steps[runner.idx];
  const pct = Math.round((runner.idx / total) * 100);
  const head = `
    <div class="runner-progress"><div class="runner-progress-bar" style="width:${pct}%"></div></div>
    <p class="runner-step-count">Step ${runner.idx + 1} of ${total}</p>`;
  if (step.type === 'exercise') {
    const nxt = runner.steps[runner.idx + 1];
    const nxtEx = runnerNextExercise(runner.idx);
    let nextText;
    if (!nxt) nextText = 'Last one — finish strong.';
    else if (nxt.type === 'rest' && nxtEx) nextText = 'Next: rest ' + fmtCountdown(nxt.seconds) + ', then ' + esc(nxtEx.name) + ' × ' + esc(repsLabel(nxtEx.reps));
    else if (nxtEx) nextText = 'Next: ' + esc(nxtEx.name) + ' × ' + esc(repsLabel(nxtEx.reps));
    else nextText = '';
    main.innerHTML = head + `
      <p class="runner-where">Block ${step.block + 1} of ${step.blocks} · Round ${step.round} of ${step.rounds}</p>
      <h2 class="runner-ex-name">${esc(step.name)}</h2>
      <p class="runner-ex-reps">× ${esc(repsLabel(step.reps))}</p>
      <p class="runner-next">${nextText}</p>
      <div class="runner-controls">
        <button class="btn runner-btn secondary" id="runner-back" type="button" ${runner.idx === 0 ? 'disabled' : ''}>← Back</button>
        <button class="btn runner-btn primary" id="runner-advance" type="button">Done — next →</button>
      </div>`;
    $('#runner-advance').addEventListener('click', runnerAdvance);
    const back = $('#runner-back');
    if (back) back.addEventListener('click', runnerBack);
  } else {
    const nxtEx = runnerNextExercise(runner.idx);
    const nextText = nxtEx
      ? 'Up next: Block ' + (nxtEx.block + 1) + ' · Round ' + nxtEx.round + ' — ' + esc(nxtEx.name) + ' × ' + esc(repsLabel(nxtEx.reps))
      : 'Up next: finish.';
    main.innerHTML = head + `
      <p class="runner-where">Block ${step.block + 1} of ${step.blocks} · ${step.kind === 'round' ? 'Round ' + step.afterRound + ' done' : 'Block done — nice work'}</p>
      <h2 class="runner-rest-label">REST</h2>
      <p class="runner-count" id="runner-count">${fmtCountdown(step.seconds)}</p>
      <p class="runner-next">${nextText}</p>
      <div class="runner-controls">
        <button class="btn runner-btn secondary" id="runner-back" type="button">← Back</button>
        <button class="btn runner-btn secondary" id="runner-pause" type="button">Pause</button>
        <button class="btn runner-btn secondary" id="runner-plus10" type="button">+10s</button>
        <button class="btn runner-btn primary" id="runner-skip" type="button">Skip rest →</button>
      </div>`;
    $('#runner-back').addEventListener('click', runnerBack);
    $('#runner-pause').addEventListener('click', runnerTogglePause);
    $('#runner-plus10').addEventListener('click', () => runnerAddTime(10));
    $('#runner-skip').addEventListener('click', runnerAdvance);
    runner.remaining = step.seconds;
    runner.endsAt = Date.now() + step.seconds * 1000;
    runner.paused = false;
    runnerStartTick();
  }
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('#runner-overlay')) ae.blur();
}
(function wireRunner() {
  const exit = $('#runner-exit');
  if (exit) exit.addEventListener('click', closeRunner);
})();

/* ---------------- custom workouts (coach) ---------------- */
function cwBlankDraft() {
  return { title: '', blocks: [{ rounds: 4, restBetweenRounds: 90, restAfterBlock: 120, exercises: [{ name: '', reps: '' }] }] };
}
function cwNum(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? '' : n;
}
/* Read the editor form back into the draft, so re-renders (auth
   syncs, add/remove clicks) never lose what the coach has typed. */
function cwScrapeForm() {
  const form = $('#cw-form');
  if (!form || !state.cwDraft) return;
  const titleEl = $('#cw-title');
  if (titleEl) state.cwDraft.title = titleEl.value;
  state.cwDraft.blocks = $$('#cw-form .cw-block').map(blockEl => ({
    rounds: cwNum(blockEl.querySelector('.cw-rounds').value),
    restBetweenRounds: cwNum(blockEl.querySelector('.cw-rest-round').value),
    restAfterBlock: cwNum(blockEl.querySelector('.cw-rest-block').value),
    exercises: Array.from(blockEl.querySelectorAll('.cw-ex-row')).map(row => ({
      name: row.querySelector('.cw-ex-name').value,
      reps: row.querySelector('.cw-ex-reps').value,
    })),
  }));
}
async function renderCustomWorkouts() {
  const el = $('#custom-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Custom workouts live here.'); return; }
  if ($('#cw-form')) cwScrapeForm();
  try {
    const data = await api('/api/custom-workouts');
    state.cwWorkouts = data.workouts || [];
  } catch (err) {
    el.innerHTML = '<p class="error">Could not load custom workouts: ' + esc(err.message) + '</p>';
    return;
  }
  const workouts = state.cwWorkouts;
  const editing = state.cwEditId && state.cwEditId !== 'new'
    ? workouts.find(w => w.id === state.cwEditId) : null;
  if (state.cwEditId && state.cwEditId !== 'new' && !editing) { state.cwEditId = null; state.cwDraft = null; }
  if (state.cwEditId && !state.cwDraft) {
    state.cwDraft = editing
      ? JSON.parse(JSON.stringify({ title: editing.title, blocks: editing.blocks }))
      : cwBlankDraft();
  }
  const card = (w) => {
    const steps = buildRunnerSteps(w);
    const exSteps = steps.filter(s => s.type === 'exercise').length;
    const summaries = w.blocks.map((b, i) =>
      `<p class="cw-block-line"><strong>Block ${i + 1}</strong> — ${b.exercises.map(e => esc(e.name) + ' × ' + esc(e.reps)).join(', ')} · ${b.rounds} rounds · rest ${b.restBetweenRounds}s between rounds, ${b.restAfterBlock}s after</p>`).join('');
    return `
    <div class="card cw-card">
      <div class="roster-row">
        <span><strong>${esc(w.title)}</strong></span>
        <span class="roster-actions">
          <button class="btn primary" data-cw-run="${w.id}" type="button">Run it</button>
          <button class="btn secondary" data-cw-edit="${w.id}" type="button">Edit</button>
          <button class="btn danger" data-cw-del="${w.id}" type="button">Delete</button>
        </span>
      </div>
      <p class="muted">${w.blocks.length} blocks · ${exSteps} exercise steps in runner mode</p>
      ${summaries}
    </div>`;
  };
  let formHtml = '';
  if (state.cwEditId) {
    const d = state.cwDraft;
    const blockHtml = (b, i) => `
      <div class="cw-block card">
        <div class="roster-row">
          <strong>Block ${i + 1}</strong>
          <button class="btn danger" data-cw-delblock="${i}" type="button">Remove block</button>
        </div>
        <div class="filter-row">
          <label>Rounds <input type="number" class="cw-rounds" min="1" max="10" value="${b.rounds}"></label>
          <label>Rest between rounds (sec) <input type="number" class="cw-rest-round" min="0" max="600" value="${b.restBetweenRounds}"></label>
          <label>Rest after block (sec) <input type="number" class="cw-rest-block" min="0" max="600" value="${b.restAfterBlock}"></label>
        </div>
        ${b.exercises.map((e, j) => `
        <div class="cw-ex-row filter-row">
          <label>Exercise <input type="text" class="cw-ex-name" value="${esc(e.name)}" placeholder="e.g. Hang Clean"></label>
          <label>Reps <input type="text" class="cw-ex-reps" value="${esc(e.reps)}" placeholder="3, max, 5 each…"></label>
          <button class="btn danger" data-cw-delex="${i}:${j}" type="button">Remove</button>
        </div>`).join('')}
        <button class="btn secondary" data-cw-addex="${i}" type="button">+ Add exercise</button>
      </div>`;
    formHtml = `
    <form class="card" id="cw-form">
      <h2>${state.cwEditId === 'new' ? 'New custom workout' : 'Edit workout'}</h2>
      <label>Title <input type="text" id="cw-title" value="${esc(d.title)}" placeholder="e.g. Friday lift — heavy circuit"></label>
      ${d.blocks.map(blockHtml).join('')}
      <button class="btn secondary" id="cw-addblock" type="button">+ Add block</button>
      <button class="btn primary" type="submit">${state.cwEditId === 'new' ? 'Save workout' : 'Save changes'}</button>
      <button class="btn secondary" id="cw-cancel" type="button">Cancel</button>
      <p class="error" id="cw-err"></p>
    </form>`;
  }
  el.innerHTML = `
    ${workouts.length === 0
      ? '<div class="card"><h2>No custom workouts yet</h2><p class="muted">Build the first one below: give it a title, lay out the blocks and rounds, set the rests — then Run it and the screen walks the room through it.</p></div>'
      : workouts.map(card).join('')}
    ${state.cwEditId ? '' : '<button class="btn primary" id="cw-new" type="button">+ New custom workout</button>'}
    ${formHtml}`;
  el.querySelectorAll('[data-cw-run]').forEach(b => b.addEventListener('click', () => {
    const w = state.cwWorkouts.find(x => x.id === b.dataset.cwRun);
    if (w) openRunner({ title: w.title, blocks: w.blocks });
  }));
  el.querySelectorAll('[data-cw-edit]').forEach(b => b.addEventListener('click', () => {
    state.cwEditId = b.dataset.cwEdit;
    state.cwDraft = null;
    renderCustomWorkouts();
  }));
  el.querySelectorAll('[data-cw-del]').forEach(b => b.addEventListener('click', async () => {
    const w = state.cwWorkouts.find(x => x.id === b.dataset.cwDel);
    if (!confirm('Delete "' + (w ? w.title : 'this workout') + '"?')) return;
    try {
      await apiDel('/api/custom-workouts/' + encodeURIComponent(b.dataset.cwDel));
      if (state.cwEditId === b.dataset.cwDel) { state.cwEditId = null; state.cwDraft = null; }
      renderCustomWorkouts();
    } catch (err) { alert(err.message); }
  }));
  const newBtn = $('#cw-new');
  if (newBtn) newBtn.addEventListener('click', () => {
    state.cwEditId = 'new';
    state.cwDraft = null;
    renderCustomWorkouts();
  });
  if (!state.cwEditId) return;
  const cancel = $('#cw-cancel');
  if (cancel) cancel.addEventListener('click', () => { state.cwEditId = null; state.cwDraft = null; renderCustomWorkouts(); });
  const addBlock = $('#cw-addblock');
  if (addBlock) addBlock.addEventListener('click', () => {
    cwScrapeForm();
    state.cwDraft.blocks.push({ rounds: 4, restBetweenRounds: 90, restAfterBlock: 120, exercises: [{ name: '', reps: '' }] });
    renderCustomWorkouts();
  });
  el.querySelectorAll('[data-cw-delblock]').forEach(b => b.addEventListener('click', () => {
    cwScrapeForm();
    state.cwDraft.blocks.splice(parseInt(b.dataset.cwDelblock, 10), 1);
    renderCustomWorkouts();
  }));
  el.querySelectorAll('[data-cw-addex]').forEach(b => b.addEventListener('click', () => {
    cwScrapeForm();
    state.cwDraft.blocks[parseInt(b.dataset.cwAddex, 10)].exercises.push({ name: '', reps: '' });
    renderCustomWorkouts();
  }));
  el.querySelectorAll('[data-cw-delex]').forEach(b => b.addEventListener('click', () => {
    cwScrapeForm();
    const [bi, ei] = b.dataset.cwDelex.split(':').map(n => parseInt(n, 10));
    state.cwDraft.blocks[bi].exercises.splice(ei, 1);
    renderCustomWorkouts();
  }));
  $('#cw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    cwScrapeForm();
    const d = state.cwDraft;
    const payload = {
      title: d.title,
      blocks: d.blocks.map(b => ({
        rounds: b.rounds, restBetweenRounds: b.restBetweenRounds, restAfterBlock: b.restAfterBlock,
        exercises: b.exercises,
      })),
    };
    try {
      if (state.cwEditId === 'new') await apiPost('/api/custom-workouts', payload);
      else await apiPut('/api/custom-workouts/' + encodeURIComponent(state.cwEditId), payload);
      state.cwEditId = null;
      state.cwDraft = null;
      renderCustomWorkouts();
    } catch (err) { $('#cw-err').textContent = err.message; }
  });
}

/* ---------------- wiring ---------------- */
$('#lib-search').addEventListener('input', (e) => { state.libQuery = e.target.value; renderLibrary(); });
$('#vid-search').addEventListener('input', (e) => { state.vidQuery = e.target.value; renderVideos(); });
$('#vid-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-vidcat]');
  if (!chip) return;
  state.vidCat = chip.dataset.vidcat;
  renderVideos();
});
$('#def-search').addEventListener('input', (e) => { state.defQuery = e.target.value; renderDefinitions(); });
$('#def-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-defcat]');
  if (!chip) return;
  state.defCat = chip.dataset.defcat;
  renderDefinitions();
});
$('#edu-search').addEventListener('input', (e) => { state.eduQuery = e.target.value; renderEducation(); });
$('#edu-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-edubucket]');
  if (!chip) return;
  state.eduBucket = chip.dataset.edubucket;
  renderEducation();
});
$('#edu-focus').addEventListener('change', (e) => { state.eduFocus = e.target.value; renderEducation(); });
function playVideoThumb(thumb) {
  const yid = thumb.dataset.play;
  if (!yid || thumb.dataset.playing) return;
  thumb.dataset.playing = '1';
  thumb.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${yid}?autoplay=1&rel=0" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
}
$('#vid-grid').addEventListener('click', (e) => {
  const thumb = e.target.closest('[data-play]');
  if (thumb) playVideoThumb(thumb);
});
$('#vid-grid').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const thumb = e.target.closest('[data-play]');
  if (thumb) { e.preventDefault(); playVideoThumb(thumb); }
});
['lib-quality', 'lib-phase', 'lib-cns'].forEach(id => $('#' + id).addEventListener('change', renderLibrary));
$('#week-jump').addEventListener('change', (e) => { state.week = parseInt(e.target.value, 10); renderSeason(); });
$('#week-today').addEventListener('click', () => { state.week = currentWeekNum(); renderSeason(); });
$('#log-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#log-form-msg');
  try {
    const feelVal = $('#log-feel').value;
    const data = await apiPost('/api/logs', {
      date: $('#log-date').value,
      sessionId: $('#log-session').value,
      group: $('#log-group').value,
      happened: $('#log-happened').value,
      marks: $('#log-marks').value,
      feel: feelVal ? parseInt(feelVal, 10) : null,
      notes: $('#log-notes').value,
    });
    state.logs.unshift(data.entry);
    state.logs.sort((a, b) => (a.date < b.date ? 1 : -1));
    msg.textContent = 'Saved.';
    e.target.reset();
    $('#log-date').value = todayStr();
    renderLog(); renderHome();
  } catch (err) { msg.textContent = err.message; }
});

/* ================================================================
   REPORTS + MEET RESULTS — coach analytics. Reports turns the data
   the coach already records (testing, completions, the plan,
   concerns) into charts and a printable athlete report card. Meet
   Results is the meet-day record: marks, PRs by direction, a team
   PR board, and per-athlete PR progression charts.
   ================================================================ */
function barChart(items, seriesList, stacked) {
  if (!items.length) return '<p class="muted">No data yet.</p>';
  const W = 340, H = 176, PL = 30, PR = 8, PT = 14, PB = 24;
  const totals = items.map((_, i) => stacked
    ? seriesList.reduce((s, sr) => s + (sr.values[i] || 0), 0)
    : Math.max(0, ...seriesList.map(sr => sr.values[i] || 0)));
  const max = Math.max(1, ...totals);
  const y = (v) => PT + (1 - v / max) * (H - PT - PB);
  let svg = '';
  for (let g = 0; g <= 3; g++) {
    const gv = (max * g) / 3;
    const gy = y(gv);
    svg += `<line x1="${PL}" y1="${gy}" x2="${W - PR}" y2="${gy}" class="chart-grid"/><text x="${PL - 4}" y="${gy + 3}" class="chart-axis" text-anchor="end">${fmtNum(gv)}</text>`;
  }
  const slot = (W - PL - PR) / items.length;
  const labelEvery = items.length > 10 ? Math.ceil(items.length / 8) : 1;
  items.forEach((it, i) => {
    const x0 = PL + i * slot;
    if (stacked) {
      let acc = 0;
      seriesList.forEach(sr => {
        const v = sr.values[i] || 0;
        if (!v) return;
        const yTop = y(acc + v), yBot = y(acc);
        svg += `<rect x="${(x0 + slot * 0.18).toFixed(1)}" y="${yTop.toFixed(1)}" width="${(slot * 0.64).toFixed(1)}" height="${Math.max(0, yBot - yTop).toFixed(1)}" class="${sr.cls}"><title>${esc(it.label)} — ${esc(sr.name)}: ${v}</title></rect>`;
        acc += v;
      });
    } else {
      const bw = (slot * 0.8) / Math.max(seriesList.length, 1);
      seriesList.forEach((sr, si) => {
        const v = sr.values[i] || 0;
        if (!v) return;
        svg += `<rect x="${(x0 + slot * 0.1 + si * bw).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.85).toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" class="${sr.cls}"><title>${esc(it.label)} — ${esc(sr.name)}: ${v}</title></rect>`;
      });
    }
    if (i % labelEvery === 0 || i === items.length - 1) {
      svg += `<text x="${(x0 + slot / 2).toFixed(1)}" y="${H - 8}" class="chart-axis" text-anchor="middle">${esc(it.label)}</text>`;
    }
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${svg}</svg>`;
}
function chartLegend(seriesList) {
  return `<div class="chart-legend">${seriesList.map(sr => `<span class="legend-item"><span class="legend-swatch ${sr.cls}"></span>${esc(sr.name)}</span>`).join('')}</div>`;
}
const monthLabel = (s) => {
  const d = parseDate(s + '-01');
  return d.toLocaleDateString(undefined, { month: 'short' }) + ' ’' + s.slice(2, 4);
};

async function renderReports() {
  const el = $('#reports-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Reports and athlete report cards live here.'); return; }
  await refreshProfiles();
  let trend, comp, load, health;
  try {
    [trend, comp, load, health] = await Promise.all([
      api('/api/reports/team-trend'), api('/api/reports/completions'),
      api('/api/reports/load'), api('/api/reports/health'),
    ]);
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const testsWithData = trend.tests.filter(t => t.points.length);
  if (!state.reportTest || !trend.tests.some(t => t.testKey === state.reportTest)) {
    state.reportTest = (testsWithData[0] || {}).testKey || null;
  }
  const trendTest = trend.tests.find(t => t.testKey === state.reportTest) || null;
  const trendHtml = !testsWithData.length
    ? '<p class="muted">No testing results yet — the team median for each test appears here after the first test day is saved.</p>'
    : (trendTest && trendTest.points.length
      ? lineChart(
        [{ label: trendTest.name + ' — team median', points: trendTest.points.map(p => ({ week: p.date, value: p.median })) }],
        { name: trendTest.name, unit: trendTest.unit, better: 'higher' })
      + `<div class="table-wrap"><table class="ranked"><thead><tr><th>Date</th><th>Test day</th><th>Team median</th><th>Athletes</th></tr></thead><tbody>${trendTest.points.map(p => `<tr><td>${esc(p.date)}</td><td>${esc(p.title)}</td><td><strong>${fmtNum(p.median)} ${esc(trendTest.unit)}</strong></td><td>${p.count}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No results for this test yet.</p>');
  if (!state.reportGroup || !comp.groups.some(g => g.group.id === state.reportGroup)) {
    state.reportGroup = comp.groups.length ? comp.groups[0].group.id : null;
  }
  const compGroup = comp.groups.find(g => g.group.id === state.reportGroup) || null;
  let compHtml;
  if (!comp.groups.length) {
    compHtml = '<p class="muted">No groups yet — create a group on the Roster &amp; Groups page and completions will chart here.</p>';
  } else if (compGroup) {
    const series = [
      { name: 'Assigned session days', cls: 'bar-b', values: compGroup.weeks.map(w => w.assigned) },
      { name: 'Days with completions', cls: 'bar-a', values: compGroup.weeks.map(w => w.completedDays) },
    ];
    const totA = compGroup.weeks.reduce((s, w) => s + w.assigned, 0);
    const totC = compGroup.weeks.reduce((s, w) => s + w.completedDays, 0);
    const totN = compGroup.weeks.reduce((s, w) => s + w.completions, 0);
    compHtml = chartLegend(series)
      + barChart(compGroup.weeks.map(w => ({ label: 'W' + w.week })), series, false)
      + `<p class="muted">Across the season: <strong>${totN}</strong> coach-marked completions covering <strong>${totC}</strong> days, against <strong>${totA}</strong> assigned session days. Weeks still ahead show the plan only.</p>`;
  } else {
    compHtml = '<p class="muted">Pick a group to see its completion chart.</p>';
  }
  const loadSeries = [
    { name: 'High-CNS days', cls: 'bar-a', values: load.weeks.map(w => w.high) },
    { name: 'Low-CNS days', cls: 'bar-b', values: load.weeks.map(w => w.low) },
  ];
  const loadTotals = load.weeks.reduce((a, w) => ({
    high: a.high + w.high, low: a.low + w.low, off: a.off + w.off, meet: a.meet + w.meet,
  }), { high: 0, low: 0, off: 0, meet: 0 });
  const loadHtml = chartLegend(loadSeries)
    + barChart(load.weeks.map(w => ({ label: 'W' + w.week })), loadSeries, true)
    + `<p class="muted">Planned for the season: <strong>${loadTotals.high}</strong> high-CNS days, <strong>${loadTotals.low}</strong> low days, <strong>${loadTotals.off}</strong> days off, <strong>${loadTotals.meet}</strong> meet days. This is the plan as written — coach overrides are not folded in.</p>`;
  const healthHtml = `<div class="hero-stats">
      <div class="hero-stat"><div class="stat-num">${health.byStatus.new}</div><div class="stat-label">New</div></div>
      <div class="hero-stat"><div class="stat-num">${health.byStatus.monitoring}</div><div class="stat-label">Monitoring</div></div>
      <div class="hero-stat"><div class="stat-num">${health.byStatus.cleared}</div><div class="stat-label">Cleared</div></div>
      <div class="hero-stat"><div class="stat-num">${health.total}</div><div class="stat-label">Total recorded</div></div>
    </div>`
    + (health.byMonth.length
      ? barChart(health.byMonth.map(m => ({ label: monthLabel(m.month) })),
        [{ name: 'Concerns opened', cls: 'bar-a', values: health.byMonth.map(m => m.opened) }], false)
      : '<p class="muted">No aches &amp; pains recorded yet.</p>');
  el.innerHTML = `
    <div class="card">
      <h2>Team strength trend</h2>
      <p class="muted">The team median on every test day — the honest middle of the room, not the best kid. Lifts use estimated 1RM.</p>
      <label>Test <select id="report-test">${trend.tests.map(t => `<option value="${t.key}" ${trendTest && t.key === trendTest.testKey ? 'selected' : ''}>${esc(t.name)}${t.points.length ? '' : ' (no results yet)'}</option>`).join('')}</select></label>
      <div id="report-trend">${trendHtml}</div>
    </div>
    <div class="card">
      <h2>Completions by group</h2>
      <p class="muted">Assigned session days vs the days the group actually got work marked complete, per season week.</p>
      ${comp.groups.length ? `<label>Group <select id="report-group">${comp.groups.map(g => `<option value="${g.group.id}" ${compGroup && g.group.id === compGroup.group.id ? 'selected' : ''}>${esc(g.group.name)}</option>`).join('')}</select></label>` : ''}
      <div id="report-comp">${compHtml}</div>
    </div>
    <div class="card">
      <h2>Planned load</h2>
      <p class="muted">High-CNS vs low-CNS days per week, straight from the season plan.</p>
      <div id="report-load">${loadHtml}</div>
    </div>
    <div class="card">
      <h2>Health overview</h2>
      <div id="report-health">${healthHtml}</div>
    </div>
    <div class="card rc-host">
      <h2>Athlete report card</h2>
      <p class="muted">One printable page per athlete: testing, weekly numbers, completions, meet PRs, and health status.</p>
      <label>Athlete <select id="report-athlete">${profileOptions(state.reportAthleteId, true)}</select></label>
      <div id="report-card-zone"></div>
    </div>`;
  const rt = $('#report-test');
  if (rt) rt.addEventListener('change', () => { state.reportTest = rt.value; renderReports(); });
  const rg = $('#report-group');
  if (rg) rg.addEventListener('change', () => { state.reportGroup = rg.value; renderReports(); });
  const ra = $('#report-athlete');
  if (ra) {
    ra.addEventListener('change', () => { state.reportAthleteId = ra.value || null; renderReportCard(); });
    renderReportCard();
  }
}

async function renderReportCard() {
  const zone = $('#report-card-zone');
  if (!zone) return;
  const pid = state.reportAthleteId;
  if (!pid) { zone.innerHTML = '<p class="muted">Pick an athlete to build their report card.</p>'; return; }
  let data;
  try { data = await api('/api/reports/athlete/' + encodeURIComponent(pid)); }
  catch (err) { zone.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const pr = data.profile;
  const hasData = !!(data.testing.length || data.weekly.length || data.meetPrs.length
    || data.completions.total || data.health.total);
  const compLine = data.completions.percent !== null
    ? `<strong>${data.completions.count}</strong> of <strong>${data.completions.denominator}</strong> assigned session days completed (<strong>${data.completions.percent}%</strong>) since they joined the roster`
    : `<strong>${data.completions.total}</strong> sessions marked complete — no assigned-day window to compare against yet`;
  const testingRows = data.testing.map(t => `<tr><td>${esc(t.name)}</td><td><strong>${fmtNum(t.best)} ${esc(t.unit)}</strong></td><td>${fmtNum(t.latest)} ${esc(t.unit)}</td><td>${esc(t.latestDate || '')}</td></tr>`).join('');
  const testingCharts = data.testing.filter(t => t.series.length >= 2).map(t =>
    `<h4>${esc(t.name)} — progression</h4>` + lineChart(
      [{ label: t.name, points: t.series.map(r => ({ week: r.date, value: r.display })) }],
      { name: t.name, unit: t.unit, better: 'higher' }, true)).join('');
  const weeklyRows = data.weekly.map(w => `<tr><td>${esc(w.metric.name)}</td><td>${w.best !== null && w.best !== undefined ? fmtNum(w.best) + ' ' + esc(w.metric.unit) : '—'}</td><td>${fmtNum(w.latest)} ${esc(w.metric.unit)}</td><td>${deltaHtml(w.metric, w)}</td></tr>`).join('');
  const meetRows = data.meetPrs.map(m => `<tr><td>${esc(m.name)}</td><td><strong>${esc(m.mark)}</strong></td><td>${esc(m.date)}</td><td>${esc(m.meet)}</td></tr>`).join('');
  zone.innerHTML = `
    <div class="report-card" id="report-card-print">
      <div class="rc-head">
        <h3>${esc(pr.name)}</h3>
        <p class="muted">${esc(pr.groupName || 'No group')} · ${(pr.events || []).map(esc).join(', ') || 'No events tagged'}${pr.topAthlete ? ' · Top Athlete ★' : ''}</p>
      </div>
      ${hasData ? `
      <p class="rc-line">${compLine}.</p>
      <h4>Testing</h4>
      ${data.testing.length
        ? `<div class="table-wrap"><table class="ranked"><thead><tr><th>Test</th><th>Best</th><th>Latest</th><th>Latest date</th></tr></thead><tbody>${testingRows}</tbody></table></div>${testingCharts}`
        : '<p class="muted">No testing results yet.</p>'}
      ${data.weekly.length ? `<h4>Weekly tracker</h4><div class="table-wrap"><table class="ranked"><thead><tr><th>Metric</th><th>Best</th><th>Latest</th><th>Change</th></tr></thead><tbody>${weeklyRows}</tbody></table></div>` : ''}
      <h4>Meet PRs</h4>
      ${data.meetPrs.length
        ? `<div class="table-wrap"><table class="ranked"><thead><tr><th>Event</th><th>PR</th><th>Date</th><th>Meet</th></tr></thead><tbody>${meetRows}</tbody></table></div>`
        : '<p class="muted">No meet results yet.</p>'}
      <h4>Health (coach record)</h4>
      <p class="rc-line">Open: <strong>${data.health.open}</strong> · Monitoring: <strong>${data.health.monitoring}</strong> · Cleared: <strong>${data.health.cleared}</strong> · Total recorded: <strong>${data.health.total}</strong></p>`
      : '<p class="muted">No data recorded yet for this athlete — testing, weekly numbers, completions, and meet results will build this card.</p>'}
      <p><button class="btn primary no-print" id="report-print" type="button" style="width:auto">Print this report card</button></p>
    </div>`;
  const pb = $('#report-print');
  if (pb) pb.addEventListener('click', () => {
    const card = $('#report-card-print');
    document.body.classList.add('printing-report');
    if (card) card.classList.add('print-target');
    const cleanup = () => {
      document.body.classList.remove('printing-report');
      if (card) card.classList.remove('print-target');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 1000);
    window.print();
  });
}

async function renderMeets() {
  const el = $('#meets-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Meet results live here.'); return; }
  await refreshProfiles();
  let events, results, board;
  try {
    const [e, r, b] = await Promise.all([
      api('/api/meet-events'), api('/api/meet-results'), api('/api/meet-results/board'),
    ]);
    events = e.events; results = r.results; board = b.board;
    state.meetEvents = events;
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const edit = state.meetEditId ? results.find(r => r.id === state.meetEditId) : null;
  if (state.meetEditId && !edit) state.meetEditId = null;
  const markHint = (type) => type === 'time'
    ? 'Time: seconds (10.87) or minutes:seconds (1:55.20).'
    : 'Mark: feet-inches (21-06.5), 21\'6.5, a plain number in feet, or meters with an m (6.45m).';
  const editEvent = edit ? events.find(e2 => e2.key === edit.event) : null;
  el.innerHTML = `
    <form class="card" id="meet-form">
      <h2>${edit ? 'Edit result' : 'Add a result'}</h2>
      <div class="filter-row">
        <label>Athlete <select id="mf-athlete">${profileOptions(edit ? edit.profileId : null, true)}</select></label>
        <label>Date <input type="date" id="mf-date" value="${edit ? esc(edit.date) : todayStr()}" required></label>
      </div>
      <div class="filter-row">
        <label>Meet <input type="text" id="mf-meet" placeholder="e.g. WCAC Championships" value="${edit ? esc(edit.meet) : ''}" required></label>
        <label>Event <select id="mf-event">${events.map(ev => `<option value="${ev.key}" ${edit && edit.event === ev.key ? 'selected' : ''}>${esc(ev.name)} (${ev.type === 'time' ? 'time' : 'field'})</option>`).join('')}</select></label>
      </div>
      <div class="filter-row">
        <label>Mark <input type="text" id="mf-mark" placeholder="10.87 · 1:55.20 · 21-06.5" value="${edit ? esc(edit.mark) : ''}" required></label>
        <label>Notes <input type="text" id="mf-notes" placeholder="optional — wind, round, FAT…" value="${edit ? esc(edit.notes || '') : ''}"></label>
      </div>
      <p class="muted" id="mf-hint">${markHint(editEvent ? editEvent.type : 'time')}</p>
      <button class="btn primary" type="submit">${edit ? 'Save changes' : 'Add result'}</button>
      ${edit ? '<button class="btn secondary" id="mf-cancel" type="button">Cancel edit</button>' : ''}
      <p class="error" id="mf-err"></p>
    </form>
    <div class="card">
      <h2>Team PR board</h2>
      ${board.length ? `<div class="table-wrap"><table class="ranked">
        <thead><tr><th>Event</th><th>Athlete</th><th>PR</th><th>Meet</th><th>Date</th></tr></thead>
        <tbody>${board.map(b => `<tr><td>${esc(b.name)}</td><td>${esc(b.athleteName)}</td><td><strong>${esc(b.mark)}</strong></td><td>${esc(b.meet)}</td><td>${esc(b.date)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">No meet results yet — the board fills in as results are entered.</p>'}
    </div>
    <div class="card">
      <h2>PR progression</h2>
      <label>Athlete <select id="mp-athlete">${profileOptions(state.meetProgAthlete, true)}</select></label>
      <div id="mp-zone"></div>
    </div>
    <div class="card">
      <h2>All results</h2>
      <p class="muted">Newest first${results.length > 200 ? ' — showing the 200 most recent' : ''}.</p>
      ${results.length ? `<div class="table-wrap"><table class="ranked">
        <thead><tr><th>Date</th><th>Meet</th><th>Athlete</th><th>Event</th><th>Mark</th><th></th></tr></thead>
        <tbody>${results.slice(0, 200).map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.meet)}</td><td>${esc(r.athleteName)}</td><td>${esc(r.eventName)}</td><td><strong>${esc(r.mark)}</strong></td>
          <td><button class="btn secondary" data-meet-edit="${r.id}" type="button" style="width:auto;padding:2px 10px">Edit</button>
          <button class="btn danger" data-meet-del="${r.id}" type="button" style="width:auto;padding:2px 10px">Delete</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">No meet results recorded yet.</p>'}
      <p><a class="btn secondary" href="/api/export/meet-results.csv">Download meet results (CSV)</a></p>
    </div>`;
  const evSel = $('#mf-event');
  if (evSel) evSel.addEventListener('change', () => {
    const ev = state.meetEvents.find(e2 => e2.key === evSel.value);
    $('#mf-hint').textContent = markHint(ev ? ev.type : 'time');
  });
  $('#meet-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      profileId: $('#mf-athlete').value,
      date: $('#mf-date').value,
      meet: $('#mf-meet').value,
      event: $('#mf-event').value,
      mark: $('#mf-mark').value,
      notes: $('#mf-notes').value,
    };
    try {
      if (state.meetEditId) await apiPut('/api/meet-results/' + encodeURIComponent(state.meetEditId), body);
      else await apiPost('/api/meet-results', body);
      state.meetEditId = null;
      renderMeets();
    } catch (err) { $('#mf-err').textContent = err.message; }
  });
  const cancel = $('#mf-cancel');
  if (cancel) cancel.addEventListener('click', () => { state.meetEditId = null; renderMeets(); });
  el.querySelectorAll('[data-meet-edit]').forEach(b => b.addEventListener('click', () => {
    state.meetEditId = b.dataset.meetEdit;
    renderMeets();
    window.scrollTo(0, 0);
  }));
  el.querySelectorAll('[data-meet-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this meet result?')) return;
    try { await apiDel('/api/meet-results/' + encodeURIComponent(b.dataset.meetDel)); renderMeets(); }
    catch (err) { alert(err.message); }
  }));
  const renderProg = async () => {
    const zone = $('#mp-zone');
    const pid = $('#mp-athlete').value;
    state.meetProgAthlete = pid || null;
    if (!pid) { zone.innerHTML = '<p class="muted">Pick an athlete to see their PR progression.</p>'; return; }
    try {
      const data = await api('/api/meet-results/prs?profileId=' + encodeURIComponent(pid));
      if (!data.series.length) { zone.innerHTML = '<p class="muted">No meet results yet for this athlete.</p>'; return; }
      zone.innerHTML = data.series.map(s => {
        const pr = data.prs.find(p => p.event === s.event);
        const metric = { name: s.name, unit: s.type === 'time' ? 'sec' : 'in', better: s.better };
        return `<h3>${esc(s.name)}</h3>
          <p class="rc-line">PR: <strong>${esc(pr ? pr.mark : '')}</strong>${pr ? ` — ${esc(pr.meet)}, ${esc(pr.date)}` : ''}</p>
          ${s.points.length >= 2
            ? lineChart([{ label: s.name, points: s.points.map(pt => ({ week: pt.date, value: pt.value })) }], metric, true)
            : '<p class="muted">One result so far — the chart starts with the second.</p>'}
          <div class="table-wrap"><table class="ranked"><thead><tr><th>Date</th><th>Meet</th><th>Mark</th></tr></thead>
          <tbody>${s.points.map(pt => `<tr><td>${esc(pt.date)}</td><td>${esc(pt.meet)}</td><td>${esc(pt.mark)}${pr && pt.resultId === pr.resultId ? ' <span class="badge star">PR ★</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
      }).join('');
    } catch (err) { zone.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };
  const mp = $('#mp-athlete');
  if (mp) { mp.addEventListener('change', renderProg); renderProg(); }
}

/* ================================================================
   TV BOARD — the weight-room display. Coach-only. The board is
   the Workout of the Day and nothing else: one full-screen page
   per group, each page carrying the group's warm-up (the app's
   own warm-up card, coach edits included) and the complete
   session — every part of it, exactly as the session detail
   renders it. Pages rotate about every 20 seconds when there is
   more than one group. The only data read here is today's
   assignments from the coach today endpoint, plus the app's own
   session and plan content: nothing about an athlete's health
   is ever fetched or shown on this screen. A coach signs in on
   the TV browser once and the session cookie keeps the board
   live; the board re-fetches its data every few minutes while
   it is open.
   ================================================================ */
const TV_ROTATE_MS = 20000;            /* ~20 seconds per page */
const TV_REFRESH_MS = 5 * 60 * 1000;   /* re-fetch every ~5 min */
const TV_SCROLL_MS = 50;               /* auto-scroll tick */
const TV_MIN_SCALE = 0.62;             /* smallest type scale before scrolling */
const TV_SCALES = [1, 0.92, 0.84, 0.76, 0.68, TV_MIN_SCALE];
let tvRotateTimer = null;
let tvRefreshTimer = null;
let tvScrollTimer = null;
let tvScrollHold = 0;
let tvWired = false;

/* Today's plan cell, resolved exactly the way the home view does
   it (the current week is clamped to the season edges). */
function tvTodayInfo() {
  if (!state.content) return null;
  const wk = state.content.weeks.find(w => w.week === currentWeekNum());
  if (!wk) return null;
  return dayInfo(wk, DAY_KEYS[(todayLocal().getDay() + 6) % 7]);
}
/* Which printed warm-up card fits today, mirroring the "Use on"
   line printed on each card: the speed card on high and meet
   days, the circuit card on strength days, the light card on
   everything else. Null on a rest day. */
function tvCardIdForToday() {
  const info = tvTodayInfo();
  if (!info || info.isOff) return null;
  if (info.isMeet || info.isHigh) return 'wu-card-2';
  const main = info.codes.map(c => state.sessions.get(c)).find(Boolean);
  if (main && main.quality === 'strength') return 'wu-card-3';
  if (info.warmup && WARMUP_CARD_FOR[info.warmup]) return WARMUP_CARD_FOR[info.warmup];
  return 'wu-card-1';
}
/* A group's own warm-up card: the card for the warm-up its
   assignment names, falling back to the day's card (meet days,
   where the warm-up has no printed card of its own). */
function tvCardIdForGroup(a) {
  if (a && a.warmup && WARMUP_CARD_FOR[a.warmup]) return WARMUP_CARD_FOR[a.warmup];
  return tvCardIdForToday();
}
/* The next day on the plan that actually trains, for the
   rest-day page. Scans forward from tomorrow through the end
   of the season. */
function tvNextTrainingDay() {
  if (!state.content) return null;
  const start = todayLocal();
  for (let off = 1; off <= 370; off++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + off);
    const wk = state.content.weeks.find(w => d >= parseDate(w.start) && d <= parseDate(w.end));
    if (!wk) continue;
    const info = dayInfo(wk, DAY_KEYS[(d.getDay() + 6) % 7]);
    if (!info.codes.length) continue;
    const names = info.codes.map(c => {
      const s = state.sessions.get(c);
      return s ? c + ' ' + s.name : c;
    }).join(' + ');
    return { date: info.date, names };
  }
  return null;
}

/* One session, complete — the same fields the session detail
   view renders (spec grid, cues, badges), in TV type. */
function tvSessionHtml(s, fallbackId, fallbackName) {
  if (!s) {
    return `<div class="tv-session">
      <h3 class="tv-session-title"><span class="tv-code">${esc(fallbackId || '')}</span> ${esc(fallbackName || '')}</h3>
    </div>`;
  }
  const row = (k, v) => v ? `<div class="tv-spec"><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '';
  return `<div class="tv-session">
    <h3 class="tv-session-title"><span class="tv-code">${esc(s.id)}</span> ${esc(s.name)} ${badge(s.cns_demand)}</h3>
    <div class="tv-session-tags">${esc(labelQuality(s.quality))} · ${esc(labelPhase(s.phase))}</div>
    <dl class="tv-spec-grid">
      ${row('Reps', s.reps)}
      ${row('Rep distance', s.rep_distance_m ? s.rep_distance_m + ' m' : '')}
      ${row('Intensity', s.intensity_pct ? s.intensity_pct + '%' : '')}
      ${row('Rest', s.rest)}
      ${row('Total volume', s.total_volume_m ? s.total_volume_m + ' m' : '')}
      ${row('Surface', s.surface)}
      ${row('Footwear', s.footwear)}
      ${row('Equipment', s.equipment)}
      ${row('Level', s.level)}
      ${row('Before next hard day', s.min_hours_before_next_high ? 'wait ' + s.min_hours_before_next_high + ' h' : '')}
    </dl>
    ${s.coaching_cues ? `<div class="tv-cues"><span class="tv-cues-label">Coaching cues</span><p>${esc(s.coaching_cues)}</p></div>` : ''}
    ${s.source ? `<p class="tv-session-source">Source: ${esc(s.source)}</p>` : ''}
  </div>`;
}

/* The warm-up block for a group page: a heading plus a slot the
   live printed card is cloned into after the page is drawn, so
   coach card edits show up here exactly as printed. */
function tvWarmupHtml(unit) {
  if (!unit.cardId) return '';
  const code = unit.warmup ? ` <span class="tv-code">${esc(unit.warmup)}</span>` : '';
  return `<div class="tv-wu-block">
    <h3 class="tv-block-h">Warm-Up${code}</h3>
    <div class="tv-wu-slot" data-card="${esc(unit.cardId)}"></div>
  </div>`;
}
function tvFillWarmupClones(root) {
  (root || document).querySelectorAll('.tv-wu-slot').forEach(slot => {
    if (slot.firstChild) return;
    const src = document.getElementById(slot.dataset.card);
    if (!src) { slot.innerHTML = '<p class="tv-wu-none">Warm-up card unavailable today.</p>'; return; }
    const clone = src.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    clone.querySelectorAll('.wu-edit-ui, [data-print-card]').forEach(n => n.remove());
    clone.classList.add('tv-wu-clone');
    slot.appendChild(clone);
  });
}

/* The units the board is built from: one per group with an
   assignment today. A plan assignment means the whole plan day
   (most days carry two sessions — all of them show); a coach
   override means the coach's chosen session. With no groups
   yet, the plan day itself is the single unit. */
function tvGroupUnits() {
  const t = state.tvData.today;
  const info = tvTodayInfo();
  const planSessions = info ? info.codes.map(c => state.sessions.get(c)).filter(Boolean) : [];
  const units = [];
  if (t.groups && t.groups.length) {
    for (const g of t.groups) {
      const a = g.assignment || {};
      if (!a.sessionId) continue;
      const own = state.sessions.get(a.sessionId);
      const sessions = a.source === 'override'
        ? (own ? [own] : [])
        : (planSessions.length ? planSessions : (own ? [own] : []));
      units.push({
        name: g.group.name, label: g.group.name, source: a.source,
        sessionId: a.sessionId, sessionName: a.sessionName || '',
        sessions, planText: a.planText || '',
        cardId: tvCardIdForGroup(a), warmup: a.warmup || (info ? info.warmup : null),
      });
    }
  }
  if (!units.length && planSessions.length) {
    units.push({
      name: 'Today\u2019s Workout', label: 'Today\u2019s Workout', source: 'plan',
      sessionId: planSessions[0].id, sessionName: planSessions[0].name,
      sessions: planSessions, planText: t.planText || (info ? info.text : ''),
      cardId: tvCardIdForToday(), warmup: info ? info.warmup : null, everyone: true,
    });
  }
  return units;
}

function tvWodHeaderHtml() {
  const t = state.tvData.today;
  const dateLine = parseDate(t.date).toLocaleDateString(undefined,
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const weekLine = t.week ? `Week ${t.week} · ${esc(t.phase || '')}` : 'Outside the season plan';
  return `<div class="tv-wod-head">
    <div class="tv-wod-kicker">Workout of the Day</div>
    <div class="tv-date">${esc(dateLine)}</div>
    <div class="tv-weekline">${weekLine}</div>
  </div>`;
}

/* One group's page. mode 'full' carries the warm-up and the
   workout; the fit pass can split a long page into 'warm' and
   'sess' pages for the same group rather than shrink the type
   past the readable floor. */
function tvPageHtml(unit, mode) {
  const pick = unit.source === 'override' ? ' <span class="tv-pick">Coach\u2019s pick</span>' : '';
  const planLine = unit.source !== 'override' && unit.planText
    ? `<div class="tv-plan-line">On the plan: ${esc(unit.planText)}</div>` : '';
  const everyone = unit.everyone
    ? '<div class="tv-plan-line">One workout for everyone today — set up groups in Roster &amp; Groups to split this board by group.</div>' : '';
  const warm = mode !== 'sess' ? tvWarmupHtml(unit) : '';
  const sess = mode !== 'warm'
    ? `<div class="tv-sessions">${unit.sessions.length
        ? unit.sessions.map(s => tvSessionHtml(s)).join('')
        : tvSessionHtml(null, unit.sessionId, unit.sessionName)}</div>`
    : '';
  return `<div class="tv-fit">
    ${tvWodHeaderHtml()}
    <div class="tv-page-group">${esc(unit.name)}${pick}</div>
    ${planLine}${everyone}
    ${warm}
    ${sess}
  </div>`;
}
function tvPageEl(unit, mode, unitIdx) {
  const wrap = document.createElement('div');
  wrap.innerHTML = tvPageHtml(unit, mode);
  const page = document.createElement('div');
  page.className = 'tv-panel tv-page';
  page.dataset.tvUnit = unitIdx;
  page.dataset.tvMode = mode;
  page.appendChild(wrap.firstElementChild);
  return page;
}

function tvRestPageHtml() {
  const next = tvNextTrainingDay();
  const nextLine = next
    ? `Next up: ${next.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} \u2014 ${next.names}`
    : 'The next training day will appear here once it is on the plan.';
  return `<div class="tv-fit">
    ${tvWodHeaderHtml()}
    <div class="tv-empty">
      <p class="tv-empty-big">No workout today</p>
      <p class="tv-empty-sub">${esc(nextLine)}</p>
    </div>
  </div>`;
}

/* Fit pass: shrink each page's type (via --tv-scale) until the
   content fits the screen; split a still-overflowing full page
   into warm-up and workout pages for the same group; only when
   a single block still cannot fit at the minimum scale does the
   page get the slow auto-scroll. Nothing is ever clipped. */
function tvFitOne(page) {
  const fit = page.querySelector('.tv-fit');
  if (!fit) return true;
  page.classList.add('tv-measuring');
  const budget = page.clientHeight - 56;
  let fits = false;
  for (const s of TV_SCALES) {
    fit.style.setProperty('--tv-scale', s);
    if (fit.scrollHeight <= budget) { fits = true; break; }
  }
  page.classList.remove('tv-measuring');
  if (!fits) fit.style.setProperty('--tv-scale', TV_MIN_SCALE);
  return fits;
}
function tvFitPages() {
  const main = $('#tv-main');
  if (!main) return;
  const labels = state.tvPageLabels.slice();
  let pages = Array.from(main.querySelectorAll('.tv-page'));
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (tvFitOne(page)) continue;
    const unit = state.tvUnits[Number(page.dataset.tvUnit)];
    if (!unit || page.dataset.tvMode !== 'full') { page.classList.add('tv-autoscroll'); continue; }
    const warm = tvPageEl(unit, 'warm', Number(page.dataset.tvUnit));
    const sess = tvPageEl(unit, 'sess', Number(page.dataset.tvUnit));
    page.replaceWith(warm, sess);
    tvFillWarmupClones(warm);
    if (!tvFitOne(warm)) warm.classList.add('tv-autoscroll');
    if (!tvFitOne(sess)) sess.classList.add('tv-autoscroll');
    labels.splice(i, 1, unit.label + ' \u00B7 Warm-Up', unit.label + ' \u00B7 Workout');
    pages = Array.from(main.querySelectorAll('.tv-page'));
    i += 1; /* the sess page was just fitted */
  }
  state.tvPageLabels = labels;
}

async function renderTvBoard() {
  const el = $('#tv-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'The weight-room TV board lives here.'); return; }
  try {
    const today = await api('/api/coach/today');
    state.tvData = { today };
  } catch (_) {
    /* A failed refresh keeps the last good board on screen. */
    if (!state.tvData) {
      el.innerHTML = `<div class="tv-empty">
        <p class="tv-empty-big">The board could not load.</p>
        <p class="tv-empty-sub">Check the connection — it retries on its own every few minutes.</p>
      </div>`;
      return;
    }
  }
  drawTvBoard();
}
function drawTvBoard() {
  const el = $('#tv-main');
  if (!el || !state.tvData) return;
  const units = tvGroupUnits();
  state.tvUnits = units;
  el.innerHTML = '';
  if (!units.length) {
    const page = document.createElement('div');
    page.className = 'tv-panel tv-page';
    page.dataset.tvMode = 'rest';
    page.innerHTML = tvRestPageHtml();
    el.appendChild(page);
    state.tvPageLabels = ['Rest day'];
  } else {
    units.forEach((u, i) => el.appendChild(tvPageEl(u, 'full', i)));
    state.tvPageLabels = units.map(u => u.label);
  }
  tvFillWarmupClones();
  tvFitPages();
  tvWireControls();
  drawTvPanels();
  tvUpdateClock();
}
function drawTvPanels() {
  const pages = $$('#tv-main .tv-page');
  if (state.tvPanel >= pages.length) state.tvPanel = 0;
  pages.forEach((p, i) => p.classList.toggle('active', i === state.tvPanel));
  const active = pages[state.tvPanel];
  if (active) active.scrollTop = 0;
  tvScrollHold = 0;
  const dots = $('#tv-dots');
  if (dots) {
    dots.innerHTML = state.tvPageLabels.map((n, i) =>
      `<button type="button" class="tv-dot${i === state.tvPanel ? ' active' : ''}" data-tv-dot="${i}">${esc(n)}</button>`).join('');
    dots.querySelectorAll('[data-tv-dot]').forEach(b => b.addEventListener('click', () => {
      state.tvPanel = Number(b.dataset.tvDot);
      state.tvPaused = true; tvSyncPauseBtn(); drawTvPanels();
    }));
  }
}
function tvPageCount() { return $$('#tv-main .tv-page').length; }
function tvSetPage(i) {
  const n = tvPageCount();
  if (!n) return;
  state.tvPanel = ((i % n) + n) % n;
  drawTvPanels();
}
function tvAdvance(dir) { tvSetPage(state.tvPanel + dir); }
function tvUpdateClock() {
  const c = $('#tv-clock');
  if (c) c.textContent = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function tvSyncPauseBtn() {
  const b = $('#tv-pause');
  if (b) b.textContent = state.tvPaused ? 'Resume rotation' : 'Pause';
}
/* Slow auto-scroll for a page whose single block cannot fit
   even at the minimum type scale: drift down, hold at the
   bottom, return to the top. Pauses with the rotation, and
   never runs under reduced motion. */
function tvScrollTick() {
  if (state.tvPaused) return;
  const page = document.querySelector('#tv-main .tv-page.active.tv-autoscroll');
  if (!page) return;
  const max = page.scrollHeight - page.clientHeight;
  if (max <= 4) return;
  if (tvScrollHold > 0) { tvScrollHold--; return; }
  if (page.scrollTop >= max - 1) { page.scrollTop = 0; tvScrollHold = 30; return; }
  page.scrollTop = Math.min(max, page.scrollTop + 1);
  if (page.scrollTop >= max - 1) tvScrollHold = 60;
}
function tvWireControls() {
  if (tvWired) return;
  tvWired = true;
  const exit = $('#tv-exit');
  if (exit) exit.addEventListener('click', () => showView('coachhub'));
  const prev = $('#tv-prev');
  if (prev) prev.addEventListener('click', () => { state.tvPaused = true; tvSyncPauseBtn(); tvAdvance(-1); });
  const next = $('#tv-next');
  if (next) next.addEventListener('click', () => { state.tvPaused = true; tvSyncPauseBtn(); tvAdvance(1); });
  const pause = $('#tv-pause');
  if (pause) pause.addEventListener('click', () => { state.tvPaused = !state.tvPaused; tvSyncPauseBtn(); });
  const full = $('#tv-full');
  if (full) full.addEventListener('click', () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch (_) { /* full screen is a nicety, never an error */ }
  });
  /* A tap anywhere on the pages pauses the rotation, so a coach
     can hold a page up while the room reads it. */
  const view = $('#view-tv');
  if (view) view.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tv-bottom') || e.target.closest('.tv-top')) return;
    if (!state.tvPaused) { state.tvPaused = true; tvSyncPauseBtn(); }
  });
}
function enterTvBoard() {
  state.tvPanel = 0;
  state.tvPaused = false;
  tvSyncPauseBtn();
  renderTvBoard();
  tvStartTimers();
}
function exitTvBoard() { tvStopTimers(); }
function tvStartTimers() {
  tvStopTimers();
  /* Reduced motion: no auto-rotation and no auto-scroll at
     all — pages move only when someone taps Prev / Next or a
     group name. */
  if (!prefersReducedMotion) {
    tvRotateTimer = setInterval(() => {
      if (!state.tvPaused && tvPageCount() > 1) tvAdvance(1);
      tvUpdateClock();
    }, TV_ROTATE_MS);
    tvScrollTimer = setInterval(tvScrollTick, TV_SCROLL_MS);
  }
  tvRefreshTimer = setInterval(() => { renderTvBoard(); }, TV_REFRESH_MS);
}
function tvStopTimers() {
  if (tvRotateTimer) { clearInterval(tvRotateTimer); tvRotateTimer = null; }
  if (tvRefreshTimer) { clearInterval(tvRefreshTimer); tvRefreshTimer = null; }
  if (tvScrollTimer) { clearInterval(tvScrollTimer); tvScrollTimer = null; }
}

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    state.content = await api('/api/content');
  } catch (err) {
    $('#home-content').innerHTML = '<p class="error">Could not load the app content. Please reload.</p>';
    return;
  }
  for (const s of state.content.sessions) state.sessions.set(s.id, s);
  state.week = currentWeekNum();
  fillLibFilters();
  fillWeekJump();
  renderDrills();
  renderQtr();
  renderVideos();
  renderDefinitions();
  renderEducation();
  $('#guide-doc').innerHTML = md(state.content.guide);
  $('#season-doc').innerHTML = md(state.content.season);
  $('#log-date').value = todayStr();
  try { state.user = await api('/api/me'); } catch (_) { state.user = null; }
  try { state.wuOverrides = (await api('/api/warmup-cards')).cards || {}; } catch (_) { state.wuOverrides = {}; }
  await refreshUserData();
  renderAccount();
  renderLog();
  renderLibrary();
  renderSeason();
  renderHome();
  renderWarmupCards();
})();
