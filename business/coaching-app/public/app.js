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
  exQuery: '',
  exCategory: 'All',
  exEquipment: 'All',
  exTags: [],
  coverageFilter: 'all',
  invItems: [],
  invCat: '',
  invQ: '',
  invEditId: null,
  announcements: [],
  annEditId: null,
  devTab: 'forcedecks',
  devPreviews: {},
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
  histAthleteId: null,
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
  reportTrendWeeks: 8,
  reportTrendGroup: 'all',
  reportCmpTest: null,
  reportCmpAFrom: null, reportCmpATo: null, reportCmpBFrom: null, reportCmpBTo: null,
  digestWeek: null,
  digestLatest: null,
  meetEvents: [],
  meetEditId: null,
  meetProgAthlete: null,
  goalAthleteId: null,
  goalEditId: null,
  myGoals: null,
  meetDayId: null,
  meetDayEvent: null,
  meetDayFlags: null,
  recEvents: [],
  recEvent: '100m',
  recEventPicked: false,
  recEditId: null,
  checkinToday: null,
  checkinMine: null,
  ciMsg: '',
  memberLogsData: null,
  memberLogEdit: null,
  mlMsg: '',
  intakeData: null,
  intakeEditing: false,
  intakeMsg: '',
  profiles: [],
  pfGroup: '',
  pfEvent: '',
  pfTop: false,
  pfQ: '',
  importReport: null,
  importText: '',
  amsProfileId: null,
  amsQ: '',
  amsGroup: '',
  amsStatus: '',
  amsRoster: null,
  progEditId: null,
  progDraft: null,
  progApplyId: null,
  progMsg: null,
  calMonth: null,
  calData: null,
  calDay: null,
  wrGroupId: '',
  wrWorkoutId: '',
  wrCols: 'auto',
  wrData: null,
  wrUpdatedAt: null,
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

/* ---------------- app version + update delivery ---------------- */
const APP_VERSION = '__APP_VERSION__';
const APP_BUILD_LABEL = '__BRAND_NAME__ · App __APP_VERSION__';
function appVersionHtml() {
  return `<p class="app-version" data-app-version="${APP_VERSION}">${APP_BUILD_LABEL}</p>`;
}
const hadServiceWorkerController = !!(
  'serviceWorker' in navigator && navigator.serviceWorker && navigator.serviceWorker.controller
);
let swUpdateReloadStarted = false;
if ('serviceWorker' in navigator && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadServiceWorkerController || swUpdateReloadStarted) return;
    swUpdateReloadStarted = true;
    try { sessionStorage.setItem('swa-app-updated', APP_VERSION); } catch (_) { /* private mode */ }
    window.location.reload();
  });
}
function showAppUpdatedToast() {
  let updatedTo = '';
  try {
    updatedTo = sessionStorage.getItem('swa-app-updated') || '';
    if (updatedTo) sessionStorage.removeItem('swa-app-updated');
  } catch (_) { /* private mode */ }
  if (!updatedTo) return;
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = 'Updated to the latest version';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5200);
}

/* ------------- in-place row updates -------------
   Coach data-entry saves update just the affected row in place
   instead of re-rendering the whole view, so scroll position,
   keyboard focus, and unsaved edits in other rows survive a save.
   A row is only ever painted as saved AFTER the server confirms;
   a failed save flags the row and leaves every typed value alone. */
function flashSaved(row) {
  if (!row) return;
  row.classList.remove('row-saved');
  void row.offsetWidth; /* restart the animation on repeat saves */
  row.classList.add('row-saved');
  setTimeout(() => row.classList.remove('row-saved'), 1800);
}
function showRowError(row, msg) {
  if (!row) return;
  clearRowError(row);
  const e = document.createElement('span');
  e.className = 'error row-err';
  e.textContent = msg;
  row.appendChild(e);
  row.classList.add('row-errored');
}
function clearRowError(row) {
  if (!row) return;
  row.querySelectorAll('.row-err').forEach(e => e.remove());
  row.classList.remove('row-errored');
}

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
  landing: 'landing', home: 'home', train: 'train', learn: 'learn', log: 'log', account: 'account', coachhub: 'coachhub',
  library: 'train', season: 'train', cards: 'train', drills: 'train', qtr: 'train', records: 'train', leaderboard: 'train',
  videos: 'learn', definitions: 'learn', exercises: 'learn', nutrition: 'learn', education: 'learn', guide: 'learn',
  coach: 'coachhub', groups: 'coachhub', testing: 'coachhub', top: 'coachhub', health: 'coachhub', inventory: 'coachhub', tv: 'coachhub', meets: 'coachhub', meetday: 'coachhub', goals: 'coachhub', reports: 'coachhub', digest: 'coachhub', custom: 'coachhub', wellness: 'coachhub', attendance: 'coachhub', ams: 'coachhub', programs: 'coachhub', calendar: 'coachhub', announce: 'coachhub', data: 'coachhub', devices: 'coachhub', coverage: 'coachhub', weightroom: 'coachhub',
};
const GROUP_SUBNAV = {
  train: [['library', 'Workouts'], ['season', 'Season Plan'], ['cards', 'Warm-Up Cards'], ['records', 'Club Records'], ['leaderboard', 'Leaderboard'], ['drills', 'Warm-Up Drills'], ['qtr', '400m Training']],
  learn: [['videos', 'Videos'], ['definitions', 'Definitions'], ['exercises', 'Exercise Library'], ['nutrition', 'Nutrition'], ['education', 'Coach Education'], ['guide', 'How to use this app']],
  coachhub: [['coach', "Today's Checklist"], ['groups', 'Roster & Groups'], ['ams', 'AMS'], ['attendance', 'Attendance'], ['testing', 'Testing'], ['top', 'Top Athletes'], ['meets', 'Meet Results'], ['meetday', 'Meet Day'], ['goals', 'Goals'], ['reports', 'Reports'], ['digest', 'Digest'], ['wellness', 'Wellness'], ['announce', 'Announcements'], ['health', 'Aches & Pains'], ['inventory', 'Inventory'], ['tv', 'TV Board'], ['weightroom', 'Weight Room'], ['custom', 'Custom Workouts'], ['programs', 'Programs'], ['calendar', 'Calendar'], ['data', 'Data'], ['devices', 'Devices'], ['coverage', 'Demo Coverage']],
};
function renderSubnav(name, area) {
  const items = GROUP_SUBNAV[area];
  const activeSection = document.getElementById('view-' + name);
  $$('.subnav-slot').forEach(slot => {
    if (!items || slot.closest('.view') !== activeSection) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<nav class="seg" aria-label="In this section">' + items.map(([v, label]) =>
      `<button type="button" class="seg-btn${v === name ? ' active' : ''}" data-view="${v}">${label}</button>`).join('') + '</nav>';
  });
  /* The active pill can sit off the right edge of the scrolling strip on
     phones; scroll the strip (never the page) so it's visible. */
  const actBtn = activeSection ? activeSection.querySelector('.seg-btn.active') : null;
  if (actBtn && actBtn.parentElement) {
    const nav = actBtn.parentElement;
    nav.scrollLeft += actBtn.getBoundingClientRect().left - nav.getBoundingClientRect().left - 24;
  }
}
/* ---------------- dropdown header navigation ----------------
   The header's primary wayfinding: Train, Learn and Coach are
   dropdown groups whose menus list the same views the hub pages
   carry, built from GROUP_SUBNAV so there is one source of truth;
   Today, My Log and Account are direct buttons. On narrow screens
   the bar collapses behind the Menu button, which opens a sheet
   with every group expanded. Menus close on selection, on an
   outside click, and on Escape. */
const NAV_GROUP_LABELS = { train: 'Train', learn: 'Learn', coachhub: 'Coach' };
function navMenuItemsHtml(area) {
  return `<button type="button" class="nav-item nav-overview" data-view="${area}">${NAV_GROUP_LABELS[area]} overview</button>` +
    GROUP_SUBNAV[area].map(([v, label]) =>
      `<button type="button" class="nav-item" data-view="${v}">${label}</button>`).join('');
}
function buildMainNav() {
  $$('.nav-menu').forEach(menu => { menu.innerHTML = navMenuItemsHtml(menu.dataset.menu); });
  const sheet = $('#nav-sheet');
  if (!sheet) return;
  const section = (area) => `
    <div class="sheet-section${area === 'coachhub' ? ' coach-tab' : ''}"${area === 'coachhub' ? ' hidden' : ''}>
      <div class="sheet-label">${NAV_GROUP_LABELS[area]}</div>
      ${navMenuItemsHtml(area)}
    </div>`;
  sheet.innerHTML = `
    <button type="button" class="nav-item sheet-top" data-view="home">Today</button>
    ${section('train')}
    ${section('learn')}
    <button type="button" class="nav-item sheet-top" data-view="log">My Log</button>
    ${section('coachhub')}
    <button type="button" class="nav-item sheet-top" data-view="account">Account</button>`;
}
function closeNavMenus() {
  $$('.nav-group.open').forEach(g => {
    g.classList.remove('open');
    const b = g.querySelector('.nav-group-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  });
  const sheet = $('#nav-sheet');
  if (sheet && !sheet.hidden) sheet.hidden = true;
  const toggle = $('#nav-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}
buildMainNav();
$$('.nav-group-btn').forEach(btn => btn.addEventListener('click', (e) => {
  e.stopPropagation();
  const group = btn.closest('.nav-group');
  const wasOpen = !!(group && group.classList.contains('open'));
  closeNavMenus();
  if (group && !wasOpen) { group.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
}));
const navToggleBtn = $('#nav-toggle');
if (navToggleBtn) navToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const sheet = $('#nav-sheet');
  const willOpen = !!(sheet && sheet.hidden);
  closeNavMenus();
  if (willOpen) { sheet.hidden = false; navToggleBtn.setAttribute('aria-expanded', 'true'); }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-view]')) { closeNavMenus(); return; }
  if (!e.target.closest('.mainnav') && !e.target.closest('.nav-sheet') && !e.target.closest('#nav-toggle')) closeNavMenus();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNavMenus(); });

function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  const area = VIEW_AREA[name] || 'home';
  $$('.primary-nav .tab').forEach(t => t.classList.toggle('active', t.dataset.view === area));
  $$('.nav-group-btn').forEach(b => b.classList.toggle('active', b.dataset.area === area));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  closeNavMenus();
  renderSubnav(name, area);
  /* The TV board takes over the whole screen: body.tv-mode hides
     the app chrome (CSS), and its timers run only while it shows. */
  document.body.classList.toggle('tv-mode', name === 'tv');
  if (name === 'tv') enterTvBoard(); else exitTvBoard();
  if (name === 'weightroom') enterWeightRoom(); else exitWeightRoom();
  if (name === 'home' || name === 'log') { renderCheckin(); renderMemberLogs(); }
  if (name === 'home' || name === 'account') renderMemberIntake();
  if (name === 'home') renderAnnouncePanel();
  if (name === 'announce') renderAnnouncements();
  if (name === 'coach') renderCoach();
  if (name === 'groups') renderGroups();
  if (name === 'testing') renderTesting();
  if (name === 'top') renderTop();
  if (name === 'health') renderHealth();
  if (name === 'inventory') renderInventory();
  if (name === 'wellness') renderWellness();
  if (name === 'attendance') renderAttendance();
  if (name === 'ams') renderAms();
  if (name === 'reports') renderReports();
  if (name === 'goals') renderGoals();
  if (name === 'digest') renderDigest();
  if (name === 'meets') renderMeets();
  if (name === 'meetday') renderMeetDay();
  if (name === 'records') renderRecords();
  if (name === 'leaderboard') renderLeaderboard();
  if (name === 'custom') renderCustomWorkouts();
  if (name === 'programs') renderPrograms();
  if (name === 'calendar') renderCalendar();
  if (name === 'data') renderData();
  if (name === 'devices') renderDevices();
  if (name === 'coverage') renderCoverage();
  if (name === 'exercises') renderExercises();
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
    ${thumbHtml(s.id)}
    <span class="row-main"><span class="code">${esc(s.id)}</span> · <span class="name">${esc(s.name)}</span> ${badge(s.cns_demand)}
    <span class="meta">${esc(labelQuality(s.quality))} · ${esc(labelPhase(s.phase))} · ${s.total_volume_m ? esc(s.total_volume_m) + ' m total' : 'no running volume'}</span></span>
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
/* The block/exercise structure carried by the Instagram-mined
   sessions (IG-01..IG-08): block headings, the block's stated
   rounds/rests line, and one faithful line per exercise — only the
   numbers the source post stated. Library sessions have no
   structure field and render exactly as before. */
function sessionStructureHtml(s) {
  if (!Array.isArray(s.structure) || !s.structure.length) return '';
  return s.structure.map(b => `
    <h3>${esc(b.block)}</h3>
    ${b.meta ? `<p class="muted">${esc(b.meta)}</p>` : ''}
    <ul class="nu-list">${(b.lines || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
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
    ${sessionStructureHtml(s)}
    <p class="muted">Source: ${esc(s.source)}</p>
    ${s.source_url ? `<p class="muted">From Instagram: <a href="${esc(s.source_url)}" target="_blank" rel="noopener">@${esc(s.source_username || '')}</a></p>` : ''}
  </div>`;
}
const DETAIL_FROM_LABELS = { home: 'Today', season: 'Season Plan', coach: "Today's Checklist", log: 'My Log' };
function openSession(id) {
  const s = state.sessions.get(id);
  if (!s) return;
  const activeView = (document.querySelector('.view.active') || {}).id || '';
  const from = activeView.replace('view-', '');
  const fromLabel = DETAIL_FROM_LABELS[from];
  showView('library');
  $('#lib-list').innerHTML = '';
  $('#lib-count').textContent = '';
  const filtersCard = $('#lib-filters');
  if (filtersCard) filtersCard.hidden = true;
  $('#lib-detail').innerHTML = sessionDetailHtml(s);
  const backBtn = $('#detail-back');
  if (fromLabel) backBtn.textContent = `← Back to ${fromLabel}`;
  backBtn.addEventListener('click', () => {
    $('#lib-detail').innerHTML = '';
    renderLibrary();
    if (fromLabel) showView(from);
  });
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
    /* Non-coaches get one big Run button for the day's featured
       session, right under the day card. (Coaches get theirs —
       one per group when groups differ — in the summary card.)
       A rest day has no session code, so no button at all. */
    const runSid = isCoachUser() ? null : featuredRunSessionId(info);
    const runSession = runSid ? state.sessions.get(runSid) : null;
    todayHtml = `
    <h2>Today — ${DAY_NAMES[todayKey]}, ${fmtDate(info.date)}</h2>
    ${LANE_DIVIDER}
    ${dayCardHtml(wk, todayKey, info, { highlight: true })}
    ${runSession ? runTodayButtonHtml({ sessionId: runSession.id, groupName: null }) : ''}
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

  $('#home-content').removeAttribute('aria-busy');
  $('#home-content').innerHTML = `
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
    ${state.user && !isCoachUser() ? '<div id="home-loads"></div>' : ''}
  `;
  const runHomeSearch = () => {
    state.libQuery = $('#home-search').value;
    $('#lib-search').value = state.libQuery;
    showView('library'); renderLibrary();
  };
  $('#home-search-btn').addEventListener('click', runHomeSearch);
  $('#home-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runHomeSearch(); } });
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
  wireRunTodayButtons($('#home-content'));
  const gotoBtn = $('#home-content [data-goto]');
  if (gotoBtn) gotoBtn.addEventListener('click', () => showView(gotoBtn.dataset.goto));
  if (state.user) renderHomeLogs();
  if (state.user && !isCoachUser()) renderHomeLoads();
  if (isCoachUser()) renderCoachToday();
  renderAnnouncePanel();
}

/* The member's own lifting loads: for every custom workout with
   % of max steps, the weight computed from THEIR best max — the
   one athlete-facing window onto coach-built workouts, fed by
   /api/my/loads, which only ever computes the caller's numbers.
   Renders nothing when the account is unlinked or no workout
   carries a % step yet. */
async function renderHomeLoads() {
  const el = $('#home-loads');
  if (!el) return;
  let data;
  try { data = await api('/api/my/loads'); } catch (_) { el.innerHTML = ''; return; }
  if (!data.linked || !data.workouts || !data.workouts.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<h2>Your lifting loads</h2>' + LANE_DIVIDER + data.workouts.map(w => `
    <div class="card">
      <h3>${esc(w.title)}</h3>
      ${w.steps.map(s => `<p class="cw-block-line"><strong>${esc(s.name)}</strong> — ${s.sets} × ${s.reps} @ ${s.weight !== null
        ? `<strong>${s.weight} lb</strong> <span class="muted">(${s.percent}% of ${s.max} est. max)</span>`
        : '<span class="muted">No max on file — ask coach</span>'}</p>`).join('')}
    </div>`).join('');
}

/* Coach summary panel on Today: today's assignments + completion
   counts per group, and open health flags, worst first. */
async function renderCoachToday() {
  const el = $('#coach-today');
  if (!el) return;
  let data;
  try { data = await api('/api/coach/today'); }
  catch (err) {
    el.innerHTML = `<div class="card"><p class="error">Could not load today's coach summary: ${esc(err.message)}</p><button class="btn secondary" id="ct-retry" type="button">Retry</button></div>`;
    const rb = $('#ct-retry'); if (rb) rb.addEventListener('click', renderCoachToday);
    return;
  }
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
  /* Big Run button(s) for today's sessions: one per group when
     the groups' sessions differ, a single shared one when they
     match, and none when nobody trains today. If no group
     resolves a session (no groups set up yet) but the plan itself
     trains today, fall back to the plan's featured session so
     the one-tap run is still there. */
  let runTargets = todayRunTargets(data.groups).filter(t => state.sessions.get(t.sessionId));
  if (!runTargets.length) {
    const sid = featuredRunSessionId(tvTodayInfo());
    if (sid && state.sessions.get(sid)) runTargets = [{ sessionId: sid, groupName: null }];
  }
  const runHtml = runTargets.map(runTodayButtonHtml).join('');
  const open = data.healthFlags || [];
  const healthHtml = open.length ? open.slice(0, 8).map(c => `
    <div class="roster-row">
      <span>${c.flagged ? '🚩 ' : ''}<strong>${esc(c.athleteName)}</strong> — ${c.source === 'athlete' ? 'athlete reported: ' + esc(c.note || 'something hurts') : `${esc(AREA_LABELS[c.area] || c.area)} (${esc(c.side)}), pain ${c.pain}/10`}${c.impact === 'stopped' ? ' · stopped training' : ''}</span>
      <span class="badge ${c.status === 'new' ? 'high' : 'plain'}">${esc(STATUS_LABELS[c.status] || c.status).toUpperCase()}</span>
    </div>`).join('') + (open.length > 8 ? `<p class="muted">…and ${open.length - 8} more open in Aches &amp; Pains.</p>` : '')
    : '<p class="muted">No open health flags. Good news.</p>';
  const w = data.wellness || { checkedIn: 0, total: 0, flagged: [] };
  const wellHtml = w.total
    ? `<p>Wellness: <strong>${w.checkedIn}/${w.total} checked in</strong>${w.flagged.length ? ` · ${w.flagged.length} flagged` : ''}</p>`
      + w.flagged.map(f => `<div class="roster-row"><span>🚩 <strong>${esc(f.name)}</strong></span><span class="muted">${f.flags.map(fl => esc(CHECKIN_FLAG_LABELS[fl] || fl)).join(' · ')}</span></div>`).join('')
    : '<p class="muted">No roster yet — check-ins appear here once athletes are linked.</p>';
  el.innerHTML = `<div class="card">
    <h2>Coach summary</h2>
    <p class="muted">${esc(fmtDate(parseDate(data.date)))} · ${planLabel}</p>
    <h3>Today's assignments</h3>
    ${groupsHtml}
    ${runHtml}
    <p><button class="btn secondary" id="ct-open-coach" type="button">Open today's checklist</button></p>
    <h3>Health flags${open.length ? ` (${open.length} open)` : ''}</h3>
    ${healthHtml}
    <p><button class="btn secondary" id="ct-open-health" type="button">Open Aches &amp; Pains</button></p>
    <h3>Daily wellness</h3>
    ${wellHtml}
    <p><button class="btn secondary" id="ct-open-wellness" type="button">Open Wellness</button></p>
  </div>`;
  $('#ct-open-coach').addEventListener('click', () => { state.feedDate = data.date; renderCoach(); showView('coach'); });
  wireRunTodayButtons(el);
  $('#ct-open-health').addEventListener('click', () => { renderHealth(); showView('health'); });
  $('#ct-open-wellness').addEventListener('click', () => { renderWellness(); showView('wellness'); });
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
  const filtersCard = $('#lib-filters');
  if (filtersCard) filtersCard.hidden = false;
  $('#lib-list').innerHTML = list.length ? list.map(sessionRow).join('') : '<p class="muted">No workouts match those filters.</p><button class="btn secondary" id="lib-clear" type="button">Clear search &amp; filters</button>';
  const clearBtn = $('#lib-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    state.libQuery = '';
    $('#lib-search').value = '';
    $('#lib-quality').value = ''; $('#lib-phase').value = ''; $('#lib-cns').value = '';
    renderLibrary();
  });
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
    ${byCat[cat].map(d => `<div class="card drill-card">
      ${thumbHtml(d.id, 'thumb-lg')}
      <div class="drill-main">
      <strong>${esc(d.id.replace('DRL-', 'Drill '))} · ${esc(d.name)}</strong>
      <div class="muted">${esc(d.distance_or_reps)}</div>
      <p style="margin-bottom:0">${esc(d.coaching_cue)}</p>
      ${demoHtml(d.id, d.name)}
      </div>
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

/* ---------------- exercise library ----------------
   Movements mined from AJ's saved Instagram training posts
   (content/instagram_movements.json, served as exerciseLibrary).
   Every movement ships with a category, trains tags and equipment
   tags derived at content-build time (scripts/build-content.py).
   This view filters over them: a text search (name, trains, cues),
   one category, one equipment value, and any number of trains
   tags — a movement must carry every selected tag. The cards are
   unchanged: name, what it trains, the equipment, the coaching
   cues, and a link back to the source post (with a note when a
   movement was saved from more than one post). */
const EX_CATEGORIES = ['Sprint Mechanics', 'Plyometrics', 'Olympic Lifts', 'Strength',
  'Isometrics', 'Core', 'Mobility'];

/* Pure filter core: extracted by the test suite and exercised
   against the real library data. Keep it free of DOM and state:
   exerciseMatches(movement, {query, category, equipment, tags}). */
/* EXERCISE-FILTER-BEGIN */
function exerciseMatches(m, f) {
  if (f.category && f.category !== 'All' && m.category !== f.category) return false;
  if (f.equipment && f.equipment !== 'All'
    && !(Array.isArray(m.equipmentTags) && m.equipmentTags.includes(f.equipment))) return false;
  const tags = Array.isArray(f.tags) ? f.tags : [];
  for (const t of tags) {
    if (!(Array.isArray(m.trainsTags) && m.trainsTags.includes(t))) return false;
  }
  const q = String(f.query || '').trim().toLowerCase();
  if (q && !(String(m.name || '').toLowerCase().includes(q)
    || String(m.trains || '').toLowerCase().includes(q)
    || String(m.cues || '').toLowerCase().includes(q))) return false;
  return true;
}
/* EXERCISE-FILTER-END */

function exCardHtml(m) {
  const count = Array.isArray(m.sources) ? m.sources.length : 0;
  const more = count > 1
    ? ` <span class="muted">(+${count - 1} more ${count === 2 ? 'source' : 'sources'})</span>`
    : '';
  return `<article class="def-card">
    <div class="def-head">
      <h3 class="def-term">${esc(m.name)}</h3>
    </div>
    <p class="def-text"><strong>Trains:</strong> ${esc(m.trains)}</p>
    <p class="def-text"><strong>Equipment:</strong> ${esc(m.equipment)}</p>
    <p class="def-cue"><strong>Cues:</strong> ${esc(m.cues)}</p>
    <p class="muted">Source: <a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener">@${esc(m.sourceUsername)}</a>${more}</p>
  </article>`;
}
function renderExercises() {
  const list = $('#ex-list');
  if (!list) return;
  const lib = ((state.content && state.content.exerciseLibrary) || []).slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const catCounts = {}, eqCounts = {}, tagCounts = {};
  for (const m of lib) {
    if (m.category) catCounts[m.category] = (catCounts[m.category] || 0) + 1;
    for (const t of m.equipmentTags || []) eqCounts[t] = (eqCounts[t] || 0) + 1;
    for (const t of m.trainsTags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const cats = EX_CATEGORIES.filter(c => catCounts[c]);
  for (const c of Object.keys(catCounts)) if (!cats.includes(c)) cats.push(c);
  const eqs = Object.keys(eqCounts).sort((a, b) => a.localeCompare(b));
  const tags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b));
  if (state.exCategory !== 'All' && !catCounts[state.exCategory]) state.exCategory = 'All';
  if (state.exEquipment !== 'All' && !eqCounts[state.exEquipment]) state.exEquipment = 'All';
  state.exTags = (state.exTags || []).filter(t => tagCounts[t]);
  $('#ex-chips').innerHTML =
    '<span class="muted">Category</span>' +
    `<button type="button" class="chip ${state.exCategory === 'All' ? 'active' : ''}" data-excat="All">All (${lib.length})</button>` +
    cats.map(c => `<button type="button" class="chip ${state.exCategory === c ? 'active' : ''}" data-excat="${esc(c)}">${esc(c)} (${catCounts[c]})</button>`).join('');
  $('#ex-eq-chips').innerHTML =
    '<span class="muted">Equipment</span>' +
    `<button type="button" class="chip ${state.exEquipment === 'All' ? 'active' : ''}" data-exequip="All">All</button>` +
    eqs.map(t => `<button type="button" class="chip ${state.exEquipment === t ? 'active' : ''}" data-exequip="${esc(t)}">${esc(t)} (${eqCounts[t]})</button>`).join('');
  $('#ex-tag-chips').innerHTML =
    '<span class="muted">Trains</span>' +
    tags.map(t => `<button type="button" class="chip ${state.exTags.includes(t) ? 'active' : ''}" data-extag="${esc(t)}">${esc(t)} (${tagCounts[t]})</button>`).join('');
  const rows = lib.filter(m => exerciseMatches(m, {
    query: state.exQuery, category: state.exCategory,
    equipment: state.exEquipment, tags: state.exTags,
  }));
  const countEl = $('#ex-count');
  if (countEl) {
    countEl.textContent = lib.length
      ? `Showing ${rows.length} of ${lib.length} movements.`
      : 'The exercise library has not loaded.';
  }
  const clearBtn = $('#ex-clear');
  if (clearBtn) {
    clearBtn.hidden = !(state.exCategory !== 'All' || state.exEquipment !== 'All'
      || state.exTags.length > 0 || (state.exQuery || '').trim() !== '');
  }
  if (!lib.length) {
    list.innerHTML = '<p class="muted">No movements yet.</p>';
    return;
  }
  list.innerHTML = rows.length
    ? rows.map(exCardHtml).join('')
    : '<p class="muted">No movements match — clear filters</p>'
      + '<button type="button" class="btn secondary" id="ex-clear-list">Clear filters</button>';
  const listClear = $('#ex-clear-list');
  if (listClear) listClear.addEventListener('click', clearExerciseFilters);
}
function clearExerciseFilters() {
  state.exQuery = '';
  state.exCategory = 'All';
  state.exEquipment = 'All';
  state.exTags = [];
  const search = $('#ex-search');
  if (search) search.value = '';
  renderExercises();
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
    <div class="head"><strong>${esc(fmtDate(parseDate(e.date)))}${e.sessionId ? ' · ' + esc(e.sessionId) : ''}</strong>
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
  renderCheckin();
  renderMyGoals();
  const gate = $('#log-gate');
  const main = $('#log-main');
  if (!state.user) {
    gate.innerHTML = `<div class="card"><strong>Your log is private to your account.</strong>
      <p class="muted">Log in to save entries. Membership is invite-only during the founding pilot — if your coach invited you, create your account with the email they invited.</p>
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
      <p class="muted">${state.user.role === 'coach' ? 'Coach account: you run the roster, assignments, testing results, weekly numbers, and health concerns.' : 'Member account: once your coach links this email to your name on the member roster, you can log the daily wellness check-in (sleep, soreness, energy) on the Today page. The rest of the program side stays coach-run.'} Your personal log entries and cross-training swaps save to this account.</p>
      <button class="btn" id="acct-logout" type="button">Log out</button>
      ${appVersionHtml()}</div>
      <div id="coach-accounts"></div>
      <div id="coach-invites"></div>
      <div id="client-invites"></div>`;
    renderCoachAccounts();
    renderCoachInvites();
    renderClientInvites();
    const out = async () => {
      try { await apiPost('/api/logout'); }
      catch (err) { alert('Log out failed: ' + err.message); return; }
      state.user = null; await refreshUserData(); syncAuthUi(); showView('landing');
    };
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
        <p class="muted">Forgot your password? There is no self-service reset yet — members, ask your coach; coaches, ask the app owner.</p>
      </form>
      <form id="register-form" class="card">
        <h2>Create an account</h2>
        <p class="muted">Membership is invite-only during the founding pilot. If your coach invited you, create your account with the exact email they invited — it is how your coach links you for the daily check-in, and it holds your practice log and cross-training swaps. Coach accounts unlock the coach tools.</p>
        <label>Email <input type="email" id="rg-email" required autocomplete="email"></label>
        <label>Password (8+ characters) <input type="password" id="rg-pass" required autocomplete="new-password" minlength="8"></label>
        <button class="btn primary" type="submit">Create account</button>
        <p class="error" id="rg-err"></p>
      </form>
      ${appVersionHtml()}`;
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        state.user = await apiPost('/api/login', { email: $('#li-email').value, password: $('#li-pass').value });
        await refreshUserData(); syncAuthUi(); showView(state.user.role === 'coach' ? 'coachhub' : 'home');
      } catch (err) { $('#li-err').textContent = err.message; }
    });
    $('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        state.user = await apiPost('/api/register', { email: $('#rg-email').value, password: $('#rg-pass').value });
        await refreshUserData(); syncAuthUi(); showView(state.user.role === 'coach' ? 'coachhub' : 'home');
      } catch (err) { $('#rg-err').textContent = err.message; }
    });
  }
}
function syncAuthUi() {
  document.body.classList.toggle('logged-out', !state.user);
  const isCoach = !!(state.user && state.user.role === 'coach');
  $$('.coach-tab').forEach(t => { t.hidden = !isCoach; });
  renderAccount(); renderLog(); renderSeason(); renderHome();
  renderGroups(); renderCoach(); renderTesting(); renderTop(); renderHealth(); renderInventory();
  renderMemberIntake();
  renderMeets(); renderMeetDay(); renderReports(); renderDigest(); renderWellness(); renderAnnouncements(); renderCustomWorkouts();
  renderPrograms(); renderCalendar();
  renderWarmupCards();
  if (isCoach) loadMedia();
}

/* ================================================================
   DAILY WELLNESS CHECK-IN — the one thing an athlete logs.
   One short screen: sleep, soreness, energy, and an optional
   "something hurts". Coaches read it in the Wellness view and on
   Coach Today. Check-in data is health data: it never appears on
   any public or TV surface.
   ================================================================ */
const CHECKIN_FLAG_LABELS = { 'low-sleep': 'Low sleep', 'high-soreness': 'Very sore', 'low-energy': 'Low energy' };
function isAthleteUser() { return !!(state.user && state.user.role === 'athlete'); }
function checkinLine(c) {
  return `Slept ${c.sleep}h · Soreness ${c.soreness}/5 · Energy ${c.energy}/5`
    + (c.hurts && c.painText ? ` · Hurts: ${esc(c.painText)}` : '');
}

async function renderCheckin() {
  const slot = $('#checkin-slot');
  const hist = $('#checkin-history');
  if (!isAthleteUser()) {
    if (slot) slot.innerHTML = '';
    if (hist) hist.innerHTML = '';
    return;
  }
  try {
    const [today, mine] = await Promise.all([api('/api/checkin/today'), api('/api/checkin/mine')]);
    state.checkinToday = today; state.checkinMine = mine;
  } catch (err) {
    if (slot) slot.innerHTML = `<div class="card checkin-card"><h2>Daily Check-In</h2><p class="error">Could not load your check-in: ${esc(err.message)}</p><button class="btn secondary" id="ci-retry" type="button">Retry</button></div>`;
    const rb = slot && slot.querySelector('#ci-retry'); if (rb) rb.addEventListener('click', renderCheckin);
    if (hist) hist.innerHTML = '';
    return;
  }
  const today = state.checkinToday;
  const mine = state.checkinMine;
  if (slot) {
    if (!today.linked) {
      slot.innerHTML = `<div class="card checkin-card">
        <h2>Daily Check-In</h2>
        <p><strong>Ask your coach to link your account.</strong></p>
        <p class="muted">Once your coach links this email (${esc(state.user.email)}) to your name on the member roster, you can log your daily check-in here — sleep, soreness, and energy in under 20 seconds.</p>
      </div>`;
    } else {
      const c = today.checkin;
      const tapRow = (name, val) => [1, 2, 3, 4, 5].map(n =>
        `<button type="button" class="tap-btn ${n === val ? 'on' : ''}" data-ci="${name}" data-val="${n}">${n}</button>`).join('');
      slot.innerHTML = `<div class="card checkin-card">
        <h2>Daily Check-In ${c ? '<span class="badge low">DONE TODAY ✓</span>' : ''}</h2>
        <p class="muted">${esc(today.athleteName || '')} · ${esc(fmtDate(parseDate(today.date)))} — takes under 20 seconds. Your coaches see this before practice.</p>
        ${mine && mine.streak ? `<p class="checkin-streak">🔥 Checked in ${mine.streak} day${mine.streak === 1 ? '' : 's'} in a row</p>` : ''}
        <div class="ci-label">Sleep last night</div>
        <div class="ci-stepper">
          <button type="button" class="tap-btn" id="ci-sleep-minus" aria-label="Less sleep">−</button>
          <span class="ci-sleep-val" id="ci-sleep-val">${c ? c.sleep + ' hrs' : '— hrs'}</span>
          <button type="button" class="tap-btn" id="ci-sleep-plus" aria-label="More sleep">+</button>
        </div>
        <div class="ci-label">How sore are you? <span class="muted">(1 = fresh, 5 = very sore)</span></div>
        <div class="ci-taps">${tapRow('soreness', c ? c.soreness : null)}</div>
        <div class="ci-label">Energy today <span class="muted">(1 = drained, 5 = full)</span></div>
        <div class="ci-taps">${tapRow('energy', c ? c.energy : null)}</div>
        <label class="check-line ci-hurts"><input type="checkbox" id="ci-hurts" ${c && c.hurts ? 'checked' : ''}> Something hurts</label>
        <div id="ci-pain-wrap" ${c && c.hurts ? '' : 'hidden'}>
          <label>What hurts, and where? <input type="text" id="ci-pain" maxlength="240" value="${esc(c ? c.painText : '')}" placeholder="e.g. Right hamstring feels tight"></label>
        </div>
        <label>Anything else? (optional) <input type="text" id="ci-note" maxlength="500" value="${esc(c ? c.note : '')}" placeholder="Short note for your coach"></label>
        ${c ? '' : '<p class="muted" id="ci-hint">Tap each answer to fill it in — nothing is pre-filled, so what saves is really yours.</p>'}
        <button class="btn primary ci-save" id="ci-save" type="button">${c ? 'Update check-in' : 'Save check-in'}</button>
        ${state.ciMsg ? `<p class="muted">${esc(state.ciMsg)}</p>` : ''}
      </div>`;
      /* A brand-new check-in starts EMPTY (sleep null, nothing picked):
         the old defaults (8h / 3 / 3) let an athlete save measured-looking
         data without answering, which feeds the coach's flags. Editing
         today's saved check-in still starts from its real values. */
      let sleep = c ? c.sleep : null;
      const picked = { soreness: c ? c.soreness : null, energy: c ? c.energy : null };
      const saveBtn = $('#ci-save');
      const updateSave = () => {
        const ready = sleep != null && picked.soreness != null && picked.energy != null;
        saveBtn.disabled = !ready;
        saveBtn.style.opacity = ready ? '' : '.55';
      };
      const setSleep = (v) => {
        sleep = Math.min(13, Math.max(3, Math.round(v * 2) / 2));
        $('#ci-sleep-val').textContent = sleep + ' hrs';
        $('#ci-sleep-minus').disabled = sleep <= 3;
        $('#ci-sleep-plus').disabled = sleep >= 13;
        updateSave();
      };
      $('#ci-sleep-minus').addEventListener('click', () => setSleep((sleep == null ? 8 : sleep) - 0.5));
      $('#ci-sleep-plus').addEventListener('click', () => setSleep((sleep == null ? 8 : sleep) + 0.5));
      slot.querySelectorAll('[data-ci]').forEach(b => b.addEventListener('click', () => {
        picked[b.dataset.ci] = parseInt(b.dataset.val, 10);
        slot.querySelectorAll(`[data-ci="${b.dataset.ci}"]`).forEach(x => x.classList.toggle('on', x === b));
        updateSave();
      }));
      $('#ci-hurts').addEventListener('change', (e) => {
        $('#ci-pain-wrap').hidden = !e.target.checked;
        if (!e.target.checked) $('#ci-pain').value = '';
      });
      updateSave();
      saveBtn.addEventListener('click', async () => {
        if (sleep == null || picked.soreness == null || picked.energy == null) return;
        try {
          await apiPost('/api/checkin', {
            sleep, soreness: picked.soreness, energy: picked.energy,
            hurts: $('#ci-hurts').checked, painText: $('#ci-hurts').checked ? $('#ci-pain').value : '', note: $('#ci-note').value,
          });
          state.ciMsg = 'Saved — your coaches can see it. ✓';
          await renderCheckin();
        } catch (err) { alert(err.message); }
      });
    }
  }
  if (hist) {
    if (!mine || !mine.linked) {
      hist.innerHTML = '';
    } else {
      hist.innerHTML = `<div class="card">
        <h2>Your check-ins — last 7 days</h2>
        ${mine.entries.length
          ? mine.entries.map(e => `<div class="roster-row"><span><strong>${esc(fmtDate(parseDate(e.date)))}</strong></span><span class="muted">${esc(checkinLine(e))}</span></div>`).join('')
          : '<p class="muted">No check-ins yet — your first one takes under 20 seconds on the Today page.</p>'}
        ${mine.streak ? `<p class="checkin-streak">🔥 ${mine.streak} day${mine.streak === 1 ? '' : 's'} in a row</p>` : ''}
      </div>`;
    }
  }
}

/* ---------------- member workout logs ----------------
   Members log their own training (this product's deliberate
   difference from the school app): fast on a phone, free-text
   sets/reps/load per exercise, prefilled from today's assigned
   session or straight out of the runner. The server binds every
   read and write to the member's own linked profile, so this UI
   only ever handles the caller's own logs. Coaches read them in
   AMS; the member's Today card and My Log list both live here. */
function memberLogStatusBadge(l) {
  return l.status === 'partial'
    ? '<span class="badge plain">PARTIAL</span>'
    : '<span class="badge low">DONE</span>';
}
function memberLogMetaLine(l) {
  const bits = [];
  if (l.rpe != null) bits.push('RPE ' + l.rpe);
  if (l.durationMin != null) bits.push(l.durationMin + ' min');
  return bits.join(' · ');
}
async function renderMemberLogs() {
  const todaySlot = $('#memberlog-slot');
  const listSlot = $('#member-logs-slot');
  if (!isAthleteUser()) {
    if (todaySlot) todaySlot.innerHTML = '';
    if (listSlot) listSlot.innerHTML = '';
    return;
  }
  let data;
  try {
    data = await api('/api/my/logs');
    state.memberLogsData = data;
  } catch (err) {
    if (todaySlot) todaySlot.innerHTML = '';
    if (listSlot) listSlot.innerHTML = `<div class="card"><h2>My workout logs</h2><p class="error">Could not load your workout logs: ${esc(err.message)}</p><button class="btn secondary" id="ml-retry" type="button">Retry</button></div>`;
    const rb = listSlot && listSlot.querySelector('#ml-retry');
    if (rb) rb.addEventListener('click', renderMemberLogs);
    return;
  }
  paintMemberLogToday(data);
  paintMemberLogsList(data);
}
function paintMemberLogToday(data) {
  const slot = $('#memberlog-slot');
  if (!slot) return;
  if (!data.linked) { slot.innerHTML = ''; return; }
  const today = dateStrOf(todayLocal());
  const todaysLog = (data.logs || []).find(l => l.date === today) || null;
  const weekLine = data.weekCount > 0
    ? `<p class="checkin-streak">🏋️ ${data.weekCount} workout${data.weekCount === 1 ? '' : 's'} logged this week</p>` : '';
  let body;
  if (todaysLog) {
    body = `<p><strong>Today's workout is logged ✓</strong></p>
      <p>${esc(todaysLog.title)} ${memberLogStatusBadge(todaysLog)}</p>
      ${memberLogMetaLine(todaysLog) ? `<p class="muted">${esc(memberLogMetaLine(todaysLog))}</p>` : ''}
      <button class="btn secondary" id="ml-today-edit" type="button">Edit today's log</button>`;
  } else if (data.todayAssignment) {
    body = `<p><strong>${esc(data.todayAssignment.title)}</strong></p>
      <p class="muted">Done it? Log it — sets, reps and loads in your own words. Your coach sees these.</p>
      <button class="btn primary" id="ml-today-log" type="button">Log today's workout</button>`;
  } else {
    body = `<p class="muted">No session is assigned today. Trained anyway? Log it — your coach sees these.</p>
      <button class="btn secondary" id="ml-today-log" type="button">Log a workout</button>`;
  }
  slot.innerHTML = `<div class="card memberlog-card">
    <h2>Workout Log</h2>
    ${weekLine}
    ${body}
  </div>`;
  const logBtn = $('#ml-today-log');
  if (logBtn) logBtn.addEventListener('click', () => {
    openMemberLogEditor(data.todayAssignment ? memberLogPrefillForAssignment(data.todayAssignment) : { date: today });
  });
  const editBtn = $('#ml-today-edit');
  if (editBtn && todaysLog) editBtn.addEventListener('click', () => openMemberLogEditorFromLog(todaysLog));
}
/* Prefill for "log today's workout": the assignment's session,
   with the exercise list shaped from the session's runner steps
   (best-effort, like the runner itself). */
function memberLogPrefillForAssignment(a) {
  const prefill = { date: dateStrOf(todayLocal()), sessionCode: a.sessionCode, title: a.title, entries: [] };
  const s = state.sessions.get(a.sessionCode);
  if (s) prefill.entries = memberLogEntriesFromSteps(buildRunnerSteps(sessionToRunnerPlan(s)));
  return prefill;
}
function openMemberLogEditor(prefill) {
  state.memberLogEdit = Object.assign({
    id: null, date: dateStrOf(todayLocal()), sessionCode: '', title: '',
    status: 'done', rpe: '', durationMin: '', entries: [], note: '',
  }, prefill || {});
  state.mlMsg = '';
  showView('log');
  renderMemberLogs();
  setTimeout(() => {
    const el = $('#ml-editor');
    if (el) el.scrollIntoView({ block: 'start' });
  }, 450);
}
function openMemberLogEditorFromLog(l) {
  openMemberLogEditor({
    id: l.id, date: l.date, sessionCode: l.sessionCode || '', title: l.title || '',
    status: l.status, rpe: l.rpe == null ? '' : String(l.rpe),
    durationMin: l.durationMin == null ? '' : String(l.durationMin),
    entries: (l.entries || []).map(e => ({ exercise: e.exercise, detail: e.detail || '' })),
    note: l.note || '',
  });
}
function paintMemberLogsList(data) {
  const slot = $('#member-logs-slot');
  if (!slot) return;
  if (!data.linked) {
    slot.innerHTML = `<div class="card">
      <h2>My workout logs</h2>
      <p><strong>Ask your coach to link your account.</strong></p>
      <p class="muted">Once your coach links this email (${esc(state.user.email)}) to your name on the member roster, you can log your workouts here — and your coach can follow your training between sessions.</p>
    </div>`;
    return;
  }
  const logs = data.logs || [];
  slot.innerHTML = `<div class="card">
    <h2>My workout logs</h2>
    <p class="muted">Your coach sees these — they're how your coach follows your training between sessions. Everything here is yours: edit or delete anything you wrote.</p>
    <button class="btn primary" id="ml-add" type="button" style="width:auto">Log a workout</button>
    ${state.mlMsg ? `<p class="muted">${esc(state.mlMsg)}</p>` : ''}
    <div id="ml-editor"></div>
    ${logs.length ? logs.map(l => `
    <div class="roster-row" style="display:block">
      <p><strong>${esc(fmtDate(parseDate(l.date)))}</strong> · ${esc(l.title)} ${memberLogStatusBadge(l)}
      <button class="btn secondary" data-ml-edit="${l.id}" type="button" style="width:auto">Edit</button>
      <button class="btn secondary" data-ml-del="${l.id}" type="button" style="width:auto">Delete</button></p>
      ${memberLogMetaLine(l) ? `<p class="muted">${esc(memberLogMetaLine(l))}</p>` : ''}
      ${(l.entries || []).length ? `<p class="muted">${l.entries.map(e => esc(e.exercise) + (e.detail ? ' — ' + esc(e.detail) : '')).join('<br>')}</p>` : ''}
      ${l.note ? `<p class="muted">${esc(l.note)}</p>` : ''}
    </div>`).join('') : '<p class="muted">No workouts logged yet — your first log takes under a minute.</p>'}
  </div>`;
  $('#ml-add').addEventListener('click', () => {
    const today = dateStrOf(todayLocal());
    const already = logs.some(l => l.date === today);
    openMemberLogEditor(!already && data.todayAssignment
      ? memberLogPrefillForAssignment(data.todayAssignment) : { date: today });
  });
  slot.querySelectorAll('[data-ml-edit]').forEach(b => b.addEventListener('click', () => {
    const l = logs.find(x => x.id === b.dataset.mlEdit);
    if (l) openMemberLogEditorFromLog(l);
  }));
  slot.querySelectorAll('[data-ml-del]').forEach(b => b.addEventListener('click', async () => {
    if (!window.confirm('Delete this workout log?')) return;
    try {
      await apiDel('/api/my/logs/' + encodeURIComponent(b.dataset.mlDel));
      if (state.memberLogEdit && state.memberLogEdit.id === b.dataset.mlDel) state.memberLogEdit = null;
      state.mlMsg = 'Log deleted.';
      renderMemberLogs();
    } catch (err) { alert(err.message); }
  }));
  paintMemberLogEditor();
}
function collectMemberLogRows() {
  const ed = state.memberLogEdit;
  if (!ed) return;
  const rows = $$('#ml-entries .ml-row');
  if (!rows.length) return;
  ed.entries = rows.map(row => ({
    exercise: row.querySelector('[data-ml-ex]').value,
    detail: row.querySelector('[data-ml-detail]').value,
  }));
}
function paintMemberLogEditor() {
  const slot = $('#ml-editor');
  if (!slot) return;
  const ed = state.memberLogEdit;
  if (!ed) { slot.innerHTML = ''; return; }
  const rowHtml = (e) => `<div class="ml-row filter-row">
      <label>Exercise <input type="text" data-ml-ex maxlength="120" value="${esc(e.exercise || '')}" placeholder="e.g. Back Squat"></label>
      <label>Sets / reps / load <input type="text" data-ml-detail maxlength="200" value="${esc(e.detail || '')}" placeholder="e.g. 3x5 @ 185"></label>
      <button class="btn secondary" data-ml-row-del type="button" style="width:auto">Remove</button>
    </div>`;
  slot.innerHTML = `<div class="card" style="margin-top:12px">
    <h3>${ed.id ? 'Edit workout log' : 'Log a workout'}</h3>
    <label>Date <input type="date" id="ml-date" value="${esc(ed.date)}"></label>
    <label>Session code (optional) <input type="text" id="ml-code" maxlength="40" value="${esc(ed.sessionCode || '')}" placeholder="e.g. ACC-01"></label>
    <label>Title <input type="text" id="ml-title" maxlength="120" value="${esc(ed.title || '')}" placeholder="What did you train?"></label>
    <div class="filter-row">
      <label>Status <select id="ml-status">
        <option value="done" ${ed.status === 'done' ? 'selected' : ''}>Done</option>
        <option value="partial" ${ed.status === 'partial' ? 'selected' : ''}>Partial — didn't finish it all</option>
      </select></label>
      <label>RPE (optional) <select id="ml-rpe">
        <option value="">—</option>
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}" ${String(ed.rpe) === String(n) ? 'selected' : ''}>${n}${n === 1 ? ' — easy' : ''}${n === 10 ? ' — max effort' : ''}</option>`).join('')}
      </select></label>
      <label>Minutes (optional) <input type="number" id="ml-duration" min="1" max="600" value="${esc(ed.durationMin === '' || ed.durationMin == null ? '' : String(ed.durationMin))}" placeholder="e.g. 45"></label>
    </div>
    <div id="ml-entries">${(ed.entries || []).map(rowHtml).join('')}</div>
    <button class="btn secondary" id="ml-add-row" type="button" style="width:auto">Add an exercise</button>
    <label>Note (optional) <input type="text" id="ml-note" maxlength="500" value="${esc(ed.note || '')}" placeholder="Anything your coach should know"></label>
    <p>
      <button class="btn primary" id="ml-save" type="button" style="width:auto">${ed.id ? 'Save changes' : 'Save log'}</button>
      <button class="btn secondary" id="ml-cancel" type="button" style="width:auto">Cancel</button>
    </p>
  </div>`;
  $('#ml-add-row').addEventListener('click', () => {
    collectMemberLogRows();
    state.memberLogEdit.entries.push({ exercise: '', detail: '' });
    paintMemberLogEditor();
  });
  slot.querySelectorAll('[data-ml-row-del]').forEach(b => b.addEventListener('click', () => {
    collectMemberLogRows();
    const rows = $$('#ml-entries .ml-row');
    const idx = rows.indexOf(b.closest('.ml-row'));
    if (idx >= 0) state.memberLogEdit.entries.splice(idx, 1);
    paintMemberLogEditor();
  }));
  $('#ml-cancel').addEventListener('click', () => {
    state.memberLogEdit = null;
    paintMemberLogsList(state.memberLogsData);
  });
  $('#ml-save').addEventListener('click', async () => {
    collectMemberLogRows();
    const cur = state.memberLogEdit;
    const payload = {
      date: $('#ml-date').value,
      sessionCode: $('#ml-code').value.trim(),
      title: $('#ml-title').value.trim(),
      status: $('#ml-status').value,
      rpe: $('#ml-rpe').value === '' ? null : parseInt($('#ml-rpe').value, 10),
      durationMin: $('#ml-duration').value === '' ? null : parseInt($('#ml-duration').value, 10),
      entries: (cur.entries || []).filter(e => (e.exercise || '').trim()),
      note: $('#ml-note').value,
    };
    try {
      if (cur.id) await apiPut('/api/my/logs/' + encodeURIComponent(cur.id), payload);
      else await apiPost('/api/my/logs', payload);
      state.memberLogEdit = null;
      state.mlMsg = 'Saved — your coach can see it. ✓';
      renderMemberLogs();
    } catch (err) { alert(err.message); }
  });
}

/* ---------------- member intake (intake + waiver + consent) ----------------
   The one form a member completes for their coach: goals, sports,
   equipment access, training age, an injury-history screen, and
   the waiver — with a parent or guardian's consent and signature
   added when the member is under 18. The server binds every read
   and write to the member's own linked profile, so this UI only
   ever handles the caller's own intake. Coaches read it in AMS.
   The Today card is only a prompt; the form itself lives in the
   member's Account area, where the member forms live. */
const MEMBER_EQUIPMENT_OPTIONS = [
  ['full-gym', 'Full gym'],
  ['dumbbells-only', 'Dumbbells only'],
  ['track-only', 'Track only'],
  ['minimal', 'Minimal / no equipment'],
];
function equipmentLabel(v) {
  const hit = MEMBER_EQUIPMENT_OPTIONS.find(([val]) => val === v);
  return hit ? hit[1] : v;
}
const WAIVER_LINES = [
  'Training with Ruffin Performance involves speed and strength training. Like any physical training, it carries an inherent risk of injury, including strains, sprains, and other injuries.',
  'This is coaching. It is not medical care, physical therapy, or medical advice.',
  'If you are injured, in pain, or have a medical concern, stop and tell your coach. Your coach will refer you to a medical professional. Coaches do not diagnose or treat injuries.',
  'By signing, you say you understand these risks, you will follow your coach\u2019s instructions, and you will report pain or an injury promptly.',
  'For a member under 18, a parent or guardian must also read this, agree to it, and sign below.',
];
function intakeSummaryHtml(t) {
  const equip = (t.equipmentAccess || []).map(equipmentLabel).join(', ') || '—';
  const when = t.waiverAcceptedAt ? fmtDate(parseDate(String(t.waiverAcceptedAt).slice(0, 10))) : '';
  return `<p>Goals: ${esc(t.goals)}</p>
    <p>Sport(s): ${esc((t.sports || []).join(', ') || '—')}</p>
    <p>Equipment access: ${esc(equip)}</p>
    <p>Training age: ${t.trainingAge == null ? '—' : esc(String(t.trainingAge)) + ' year' + (t.trainingAge === 1 ? '' : 's')}</p>
    <p>Injury in the last 12 months, or anything your coach should know: ${t.hasInjury ? 'Yes' : 'No'}${t.injuryDetail ? ' — ' + esc(t.injuryDetail) : ''}</p>
    <p>Age: ${t.isAdult ? '18 or older' : 'Under 18'}</p>
    <p>Waiver accepted${when ? ' on ' + esc(when) : ''} — signed by ${esc(t.waiverSignature)} (waiver version ${esc(t.waiverVersion || 'v1')})</p>
    ${!t.isAdult && t.parentName ? `<p>Parent or guardian: ${esc(t.parentName)} — agreed and signed by ${esc(t.parentSignature)}${t.parentConsentAt ? ' on ' + esc(fmtDate(parseDate(String(t.parentConsentAt).slice(0, 10)))) : ''}</p>` : ''}`;
}
async function renderMemberIntake() {
  const todaySlot = $('#intake-slot');
  const acctSlot = $('#intake-main');
  if (!isAthleteUser()) {
    if (todaySlot) todaySlot.innerHTML = '';
    if (acctSlot) acctSlot.innerHTML = '';
    return;
  }
  let data;
  try {
    data = await api('/api/my/intake');
    state.intakeData = data;
  } catch (err) {
    if (todaySlot) todaySlot.innerHTML = '';
    if (acctSlot) acctSlot.innerHTML = `<div class="card"><h2>Member intake</h2><p class="error">Could not load your intake: ${esc(err.message)}</p><button class="btn secondary" id="in-retry" type="button">Retry</button></div>`;
    const rb = acctSlot && acctSlot.querySelector('#in-retry');
    if (rb) rb.addEventListener('click', renderMemberIntake);
    return;
  }
  /* Today: a clear prompt until the intake is done, then nothing. */
  if (todaySlot) {
    if (data.linked && !data.completed) {
      todaySlot.innerHTML = `<div class="card">
        <h2>Finish your member intake</h2>
        <p>Your coach needs your intake and waiver before training — goals, equipment, injury history, and a signed waiver. It takes a few minutes, once.</p>
        <button class="btn primary" id="in-today-open" type="button">Complete your intake</button>
      </div>`;
      const ob = $('#in-today-open');
      if (ob) ob.addEventListener('click', () => { state.intakeEditing = true; showView('account'); });
    } else {
      todaySlot.innerHTML = '';
    }
  }
  if (!acctSlot) return;
  if (!data.linked) {
    acctSlot.innerHTML = `<div class="card">
      <h2>Member intake</h2>
      <p><strong>Ask your coach to link your account.</strong></p>
      <p class="muted">Once your coach links this email (${esc(state.user.email)}) to your name on the member roster, you can complete your intake and waiver here.</p>
    </div>`;
    return;
  }
  const t = data.intake;
  if (data.completed && t && !state.intakeEditing) {
    acctSlot.innerHTML = `<div class="card">
      <h2>Member intake <span class="badge low">DONE</span></h2>
      ${intakeSummaryHtml(t)}
      ${state.intakeMsg ? `<p class="muted">${esc(state.intakeMsg)}</p>` : ''}
      <button class="btn secondary" id="in-edit" type="button">Update intake</button>
    </div>`;
    const eb = $('#in-edit');
    if (eb) eb.addEventListener('click', () => { state.intakeEditing = true; renderMemberIntake(); });
    return;
  }
  const f = t || {};
  acctSlot.innerHTML = `<div class="card">
    <h2>Member intake</h2>
    <p class="muted">Tell your coach what you are training for and what you have access to, answer the injury screen honestly, then read and sign the waiver.</p>
    <label>Your goals <textarea id="in-goals" rows="3" maxlength="1000" placeholder="What do you want out of training?">${esc(f.goals || '')}</textarea></label>
    <label>Sport(s) <input type="text" id="in-sports" maxlength="200" value="${esc((f.sports || []).join(', '))}" placeholder="e.g. Track and field, Basketball"></label>
    <div class="ci-label">Equipment access</div>
    ${MEMBER_EQUIPMENT_OPTIONS.map(([val, label]) => `<label class="check-line"><input type="checkbox" data-in-equip value="${val}" ${(f.equipmentAccess || []).includes(val) ? 'checked' : ''}> ${label}</label>`).join('')}
    <label>Training age — years you have been training <input type="number" id="in-age" min="0" max="70" step="1" value="${f.trainingAge == null ? '' : esc(String(f.trainingAge))}" placeholder="e.g. 3"></label>
    <label>Have you had an injury in the last 12 months, or is there anything your coach should know?
      <select id="in-injury">
        <option value="">— pick one —</option>
        <option value="no" ${t && !f.hasInjury ? 'selected' : ''}>No</option>
        <option value="yes" ${t && f.hasInjury ? 'selected' : ''}>Yes</option>
      </select></label>
    <div id="in-injury-wrap" ${t && f.hasInjury ? '' : 'hidden'}>
      <label>Short note for your coach <input type="text" id="in-injury-detail" maxlength="1000" value="${esc(f.injuryDetail || '')}" placeholder="What happened, and where things stand now"></label>
    </div>
    <label>Are you 18 or older?
      <select id="in-adult">
        <option value="">— pick one —</option>
        <option value="yes" ${t && f.isAdult ? 'selected' : ''}>Yes, I am 18 or older</option>
        <option value="no" ${t && !f.isAdult ? 'selected' : ''}>No, I am under 18</option>
      </select></label>
    <h3>Waiver</h3>
    ${WAIVER_LINES.map(line => `<p class="muted">${esc(line)}</p>`).join('')}
    <label class="check-line"><input type="checkbox" id="in-waiver-accept" ${t && f.waiverAccepted ? 'checked' : ''}> I have read the waiver and I agree to it</label>
    <label>Type your full name to sign <input type="text" id="in-waiver-sign" maxlength="120" value="${esc(t ? f.waiverSignature || '' : '')}" placeholder="Your full name"></label>
    <div id="in-parent-wrap" ${t && !f.isAdult ? '' : 'hidden'}>
      <h3>Parent or guardian — for members under 18</h3>
      <label>Parent or guardian full name <input type="text" id="in-parent-name" maxlength="120" value="${esc(f.parentName || '')}"></label>
      <label class="check-line"><input type="checkbox" id="in-parent-consent" ${t && f.parentConsent ? 'checked' : ''}> I am this member\u2019s parent or guardian, I have read the waiver, and I agree to it</label>
      <label>Parent or guardian — type your full name to sign <input type="text" id="in-parent-sign" maxlength="120" value="${esc(t ? f.parentSignature || '' : '')}"></label>
    </div>
    <button class="btn primary" id="in-save" type="button">Save intake</button>
    <p class="error" id="in-err"></p>
    ${state.intakeMsg ? `<p class="muted">${esc(state.intakeMsg)}</p>` : ''}
  </div>`;
  $('#in-injury').addEventListener('change', (e) => {
    $('#in-injury-wrap').hidden = e.target.value !== 'yes';
  });
  $('#in-adult').addEventListener('change', (e) => {
    $('#in-parent-wrap').hidden = e.target.value !== 'no';
  });
  $('#in-save').addEventListener('click', async () => {
    const isAdultSel = $('#in-adult').value;
    const injurySel = $('#in-injury').value;
    const payload = {
      goals: $('#in-goals').value,
      sports: $('#in-sports').value.split(',').map(s => s.trim()).filter(Boolean),
      equipmentAccess: Array.from(acctSlot.querySelectorAll('[data-in-equip]:checked')).map(x => x.value),
      trainingAge: $('#in-age').value === '' ? null : parseInt($('#in-age').value, 10),
      hasInjury: injurySel === '' ? undefined : injurySel === 'yes',
      injuryDetail: injurySel === 'yes' ? $('#in-injury-detail').value : '',
      isAdult: isAdultSel === '' ? undefined : isAdultSel === 'yes',
      waiverAccepted: $('#in-waiver-accept').checked,
      waiverSignature: $('#in-waiver-sign').value,
      parentName: $('#in-parent-name') ? $('#in-parent-name').value : '',
      parentConsent: $('#in-parent-consent') ? $('#in-parent-consent').checked : false,
      parentSignature: $('#in-parent-sign') ? $('#in-parent-sign').value : '',
    };
    try {
      await apiPost('/api/my/intake', payload);
      state.intakeEditing = false;
      state.intakeMsg = 'Saved — your coach can see it. Thank you.';
      renderMemberIntake();
    } catch (err) { $('#in-err').textContent = err.message; }
  });
}

/* Reports → Health: the check-in aggregates block. Shows the
   participation-by-week bars and the team-average trend when
   check-ins exist; a clean "not yet" line when they don't. */
function checkinReportHtml(ci) {
  if (!ci || !ci.totalCheckins) {
    return '<h3>Daily check-ins</h3><p class="muted">No daily check-ins yet — participation and team averages appear here once athletes start checking in.</p>';
  }
  const part = ci.participationByWeek.length
    ? chartLegend([{ name: 'Check-ins', cls: 'bar-a' }])
      + barChart(ci.participationByWeek.map(w => ({ label: 'Wk of ' + w.week.slice(5) })),
        [{ name: 'Check-ins', cls: 'bar-a', values: ci.participationByWeek.map(w => w.checkins) }], false)
      + `<p class="muted">${ci.participationByWeek.map(w => `${esc(w.week)}: ${w.percent}% (${w.checkins} of ${w.possible})`).join(' · ')}</p>`
    : '';
  const pts = ci.dailyTrend.filter(d => d.avgSleep != null).map(d => ({ week: d.date, value: d.avgSleep }));
  const trend = pts.length
    ? lineChart([{ points: pts, color: '#cc0033' }], { name: 'Avg sleep', unit: 'hrs', better: 'higher' }, true)
    : '';
  return `<h3>Daily check-ins</h3>
    <p class="muted">${ci.totalCheckins} check-in${ci.totalCheckins === 1 ? '' : 's'} logged so far.</p>
    ${part}
    ${trend ? `<h3>Team average sleep by day</h3>${trend}` : ''}`;
}

/* Coach Wellness view: who checked in today, the flags, and the
   last 7 days per athlete plus team averages. Coach-only. */
async function renderWellness() {
  const el = $('#wellness-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Daily wellness check-ins live here.'); return; }
  let today, trends;
  try {
    [today, trends] = await Promise.all([api('/api/wellness/today'), api('/api/wellness/trends?days=7')]);
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const s = today.summary;
  const flagBadges = (flags) => flags.length
    ? flags.map(f => `<span class="badge high">${esc(CHECKIN_FLAG_LABELS[f] || f).toUpperCase()}</span>`).join(' ')
    : '<span class="badge low">OK</span>';
  const triage = (rw) => rw.flags.length ? 0 : (rw.checkedIn ? 2 : 1);
  const sortedRows = today.rows.slice().sort((a, b) => triage(a) - triage(b));
  const rowsHtml = sortedRows.length ? sortedRows.map(rw => `
    <div class="roster-row wellness-row ${rw.flags.length ? 'flagged' : ''}">
      <span><strong>${esc(rw.profile.name)}</strong>${rw.profile.groupName ? ` <span class="muted">· ${esc(rw.profile.groupName)}</span>` : ''}</span>
      ${rw.checkedIn
        ? `<span class="muted">Slept ${rw.checkin.sleep}h · Sore ${rw.checkin.soreness}/5 · Energy ${rw.checkin.energy}/5${rw.checkin.hurts && rw.checkin.painText ? ` · <strong>Hurts:</strong> ${esc(rw.checkin.painText)}` : ''}</span><span>${flagBadges(rw.flags)}</span>`
        : (rw.profile.linkedEmail
          ? '<span class="muted">No check-in yet</span><span><span class="badge plain">MISSING</span></span>'
          : '<span class="muted">No account linked — they cannot check in yet</span><span><span class="badge high">NOT LINKED</span></span>')}
    </div>`).join('') : '<p class="muted">No athletes on the roster yet. Add them in Roster &amp; Groups and link their accounts so they can check in.</p>';
  const sparkFor = (a) => {
    const vals = a.days.map(d => d.sleep);
    const pts = vals.map((v, i) => v == null ? null
      : `${(2 + (i * 116) / Math.max(1, vals.length - 1)).toFixed(1)},${(30 - (v / 13) * 26).toFixed(1)}`).filter(Boolean).join(' ');
    return pts ? `<svg width="120" height="32" viewBox="0 0 120 32" role="img" aria-label="Sleep hours, last 7 days"><polyline points="${pts}" fill="none" stroke="var(--scarlet)" stroke-width="2"/></svg>` : '<span class="muted">—</span>';
  };
  const trendsHtml = trends.athletes.length ? trends.athletes.map(a => `
    <div class="roster-row">
      <span><strong>${esc(a.profile.name)}</strong></span>
      <span>${sparkFor(a)}</span>
      <span class="muted">${a.days.map(d => d.sleep == null ? '–' : d.sleep).join(' · ')}</span>
    </div>`).join('') : '<p class="muted">Nothing to trend yet.</p>';
  const teamSleepPts = trends.team.filter(d => d.avgSleep != null).map(d => ({ week: d.date, value: d.avgSleep }));
  const teamTrendHtml = teamSleepPts.length
    ? lineChart([{ points: teamSleepPts, color: '#cc0033' }], { name: 'Avg sleep', unit: 'hrs', better: 'higher' }, true)
    : '<p class="muted">No check-ins yet — the team trend appears once athletes start checking in.</p>';
  el.innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><span class="stat-num">${s.checkedIn}/${s.total}</span><span class="stat-label">Checked in today (${s.participation}%)</span></div>
      <div class="stat-card"><span class="stat-num">${s.avgSleep == null ? '—' : s.avgSleep}</span><span class="stat-label">Avg sleep (hrs)</span></div>
      <div class="stat-card"><span class="stat-num">${s.avgSoreness == null ? '—' : s.avgSoreness}</span><span class="stat-label">Avg soreness /5</span></div>
      <div class="stat-card"><span class="stat-num">${s.avgEnergy == null ? '—' : s.avgEnergy}</span><span class="stat-label">Avg energy /5</span></div>
      <div class="stat-card"><span class="stat-num">${s.flagged}</span><span class="stat-label">Flagged today</span></div>
    </div>
    <div class="card">
      <h2>Today — ${esc(fmtDate(parseDate(today.date)))}</h2>
      <p class="muted">Flags: slept under 6 hours · soreness 4–5 · energy 1–2. A "hurts" report also lands in Aches &amp; Pains for follow-up.</p>
      ${rowsHtml}
    </div>
    <div class="card">
      <h2>Last 7 days</h2>
      <p class="muted">Sleep hours per athlete, oldest to newest.</p>
      ${trendsHtml}
      <h3>Team average sleep by day</h3>
      ${teamTrendHtml}
    </div>`;
}

/* ---------------- attendance (coach roll-book) ----------------
   One mark per athlete per day: present, late, excused, absent.
   Tapping a status saves just that athlete, in place (the Phase 1
   pattern — the row and the day counts repaint only after the
   server confirms); tapping the active status again clears the
   mark back to unmarked. The per-athlete record below runs over
   marked days only, so a day nobody took roll never counts
   against anyone. */
const ATT_STATUS_LIST = [['present', 'Present'], ['late', 'Late'], ['excused', 'Excused'], ['absent', 'Absent']];
async function renderAttendance() {
  const el = $('#attendance-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'The daily attendance roll-book lives here.'); return; }
  if (!state.attendanceDate) state.attendanceDate = todayStr();
  const date = state.attendanceDate;
  let data, summary;
  try {
    [data, summary] = await Promise.all([
      api('/api/attendance?date=' + encodeURIComponent(date)),
      api('/api/attendance/summary'),
    ]);
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const marks = new Map();
  const blocks = data.groups.concat(data.unassigned && data.unassigned.members.length ? [data.unassigned] : []);
  for (const blk of blocks) for (const m of blk.members) {
    marks.set(m.profile.id, m.attendance ? m.attendance.status : null);
  }
  const countsHtml = () => {
    const c = { present: 0, late: 0, excused: 0, absent: 0, unmarked: 0 };
    for (const s of marks.values()) { if (s) c[s]++; else c.unmarked++; }
    return [['Present', c.present], ['Late', c.late], ['Excused', c.excused], ['Absent', c.absent], ['Unmarked', c.unmarked]]
      .map(([label, n]) => `<div class="hero-stat"><span class="stat-num">${n}</span><span class="stat-label">${label}</span></div>`).join('');
  };
  const paintCounts = () => { const s = $('#att-counts'); if (s) s.innerHTML = countsHtml(); };
  const paintAttRow = (row, status) => {
    row.querySelectorAll('[data-att-status]').forEach(b =>
      b.classList.toggle('active', b.dataset.attStatus === status));
  };
  const wireAttRow = (row) => {
    row.querySelectorAll('[data-att-status]').forEach(btn => btn.addEventListener('click', async () => {
      const pid = btn.dataset.attPid;
      const tapped = btn.dataset.attStatus;
      const next = marks.get(pid) === tapped ? null : tapped;
      clearRowError(row);
      try {
        await apiPut('/api/attendance/' + encodeURIComponent(date) + '/' + encodeURIComponent(pid), { status: next });
        marks.set(pid, next);
        paintAttRow(row, next);
        paintCounts();
        flashSaved(row);
      } catch (err) { showRowError(row, err.message); }
    }));
  };
  const attRowHtml = (m) => `
    <div class="roster-row att-row" data-att-row="${m.profile.id}">
      <span class="att-name"><strong>${esc(m.profile.name)}</strong>${m.profile.topAthlete ? ' <span class="badge star">★</span>' : ''}</span>
      <span class="seg att-seg" role="group" aria-label="Attendance for ${esc(m.profile.name)}">${ATT_STATUS_LIST.map(([s, label]) =>
        `<button type="button" class="seg-btn${marks.get(m.profile.id) === s ? ' active' : ''}" data-att-status="${s}" data-att-pid="${m.profile.id}">${label}</button>`).join('')}</span>
    </div>`;
  const blockHtml = (blk) => `
    <div class="card">
      <h3>${blk.group ? esc(blk.group.name) : 'No group'}</h3>
      ${blk.members.length ? blk.members.map(attRowHtml).join('') : '<p class="muted">No athletes here yet.</p>'}
    </div>`;
  const sumTable = (title, key) => {
    const rows = summary.athletes.map(a => {
      const w = a[key];
      return `<tr><td>${esc(a.profile.name)}</td><td>${w.marked}</td><td>${w.present}</td><td>${w.late}</td><td>${w.excused}</td><td>${w.absent}</td><td>${w.percent == null ? '—' : w.percent + '%'}</td></tr>`;
    }).join('');
    return `<h3>${esc(title)}</h3>
      <div class="table-wrap"><table class="ranked">
        <thead><tr><th>Athlete</th><th>Marked</th><th>Present</th><th>Late</th><th>Excused</th><th>Absent</th><th>Attended</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No athletes on the roster yet.</td></tr>'}</tbody>
      </table></div>`;
  };
  el.innerHTML = `
    <div class="card">
      <label>Date <input type="date" id="att-date" value="${esc(date)}"></label>
      ${date !== todayStr() ? '<button class="btn secondary" id="att-today" type="button" style="width:auto">Back to today</button>' : ''}
      <p class="muted">Roll for ${esc(fmtDate(parseDate(date)))}. Tap a status to save it; tap the same status again to clear the mark. Past days can be fixed up here, and future days can be pre-marked.</p>
      <div class="hero-stats" id="att-counts">${countsHtml()}</div>
      <p><button class="btn primary" id="att-all-present" type="button" style="width:auto">Mark all present</button>
      <span class="muted">Fills in everyone still unmarked — anyone already late, excused, or absent keeps their mark.</span></p>
    </div>
    ${blocks.map(blockHtml).join('')}
    <div class="card">
      <h2>Attendance record</h2>
      <p class="muted">Attended counts present plus late. The percentage runs over marked days only — unmarked days never count against an athlete.</p>
      ${sumTable('Last 30 days', 'last30')}
      ${sumTable('Season to date', 'season')}
    </div>`;
  $('#att-date').addEventListener('change', (e) => { state.attendanceDate = e.target.value; renderAttendance(); });
  const attTodayBtn = $('#att-today');
  if (attTodayBtn) attTodayBtn.addEventListener('click', () => { state.attendanceDate = todayStr(); renderAttendance(); });
  el.querySelectorAll('[data-att-row]').forEach(wireAttRow);
  $('#att-all-present').addEventListener('click', async () => {
    const btn = $('#att-all-present');
    btn.disabled = true;
    try {
      await apiPost('/api/attendance/' + encodeURIComponent(date) + '/mark-all-present', {});
      for (const [pid, s] of marks) if (!s) marks.set(pid, 'present');
      el.querySelectorAll('[data-att-row]').forEach(row => paintAttRow(row, marks.get(row.dataset.attRow)));
      paintCounts();
    } catch (err) { alert(err.message); }
    btn.disabled = false;
  });
}

/* ---------------- AMS (athlete management system) ----------------
   The coach-side home for one athlete: a roster table with the
   coach-set status and the server's attention flags, and a profile
   page aggregating wellness, testing, meet PRs, attendance, health,
   goals, and the private coach-notes thread. All of it reads the
   /api/ams endpoints (coach-only); Roster & Groups stays the place
   for roster editing and import. */
const AMS_STATUS_LABELS = { active: 'Active', injured: 'Injured', inactive: 'Inactive' };
function amsFlagBadges(flags) {
  if (!flags || !flags.length) return '<span class="muted">—</span>';
  return flags.map(f =>
    `<span class="badge high" title="${esc(f.detail)}">${esc(f.label)}${f.count != null ? ' · ' + f.count : ''}</span>`).join(' ');
}
async function renderAms() {
  const el = $('#ams-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'The athlete-management system lives here.'); return; }
  if (state.amsProfileId) { await renderAmsProfile(el, state.amsProfileId); return; }
  let data;
  try { data = await api('/api/ams/roster'); }
  catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  state.amsRoster = data.athletes || [];
  const groupOpts = [];
  const seenGroups = new Set();
  for (const a of state.amsRoster) {
    const gid = a.profile.groupId || '';
    if (seenGroups.has(gid)) continue;
    seenGroups.add(gid);
    groupOpts.push([gid, a.profile.groupName || 'No group']);
  }
  el.innerHTML = `
    <div class="card">
      <div class="filter-row">
        <label>Search <input type="search" id="ams-q" value="${esc(state.amsQ)}" placeholder="Athlete name"></label>
        <label>Group <select id="ams-group">
          <option value="">All groups</option>
          ${groupOpts.map(([gid, name]) => `<option value="${esc(gid)}" ${state.amsGroup === gid ? 'selected' : ''}>${esc(name)}</option>`).join('')}
        </select></label>
        <label>Status <select id="ams-status-filter">
          <option value="">Any status</option>
          ${Object.keys(AMS_STATUS_LABELS).map(s => `<option value="${s}" ${state.amsStatus === s ? 'selected' : ''}>${AMS_STATUS_LABELS[s]}</option>`).join('')}
        </select></label>
      </div>
      <p class="muted">Attention flags are computed from the data already in the app: Readiness = 2+ flagged check-ins in the last 7 days · No check-in = a linked athlete with none in the last 3 days · Attendance = 2+ absences in the last 14 days · Health = an open aches &amp; pains concern · No logs this week = a linked member who has logged workouts before but none in the last 7 days · Intake needed = a linked member who has not completed their intake and waiver · plus the device flags from the latest ForceDecks / NordBord sessions (imbalance, asymmetry, jump drop-off). Tap an athlete for their full page.</p>
      <div id="ams-table"></div>
    </div>`;
  const paintTable = () => {
    const slot = $('#ams-table');
    if (!slot) return;
    const q = state.amsQ.trim().toLowerCase();
    const rows = state.amsRoster.filter(a => {
      if (q && !a.profile.name.toLowerCase().includes(q)) return false;
      if (state.amsGroup !== '' && (a.profile.groupId || '') !== state.amsGroup) return false;
      if (state.amsStatus && a.status !== state.amsStatus) return false;
      return true;
    });
    slot.innerHTML = `<div class="table-wrap"><table class="ranked">
      <thead><tr><th>Athlete</th><th>Group</th><th>Events</th><th>Status</th><th>Account</th><th>Last log</th><th>Attention</th></tr></thead>
      <tbody>${rows.length ? rows.map(a => `<tr>
        <td><button type="button" class="code-link" data-ams-open="${a.profile.id}">${esc(a.profile.name)}</button>${a.profile.topAthlete ? ' <span class="badge star">★</span>' : ''}${a.profile.archived ? ' <span class="badge plain">ARCHIVED</span>' : ''}</td>
        <td>${esc(a.profile.groupName || 'No group')}</td>
        <td>${esc((a.profile.events || []).join(', ') || '—')}</td>
        <td>${esc(AMS_STATUS_LABELS[a.status] || a.status)}</td>
        <td>${a.linked ? esc(a.profile.linkedEmail) : '<span class="badge plain">NOT LINKED</span>'}</td>
        <td>${a.lastLogDate ? esc(fmtDate(parseDate(a.lastLogDate))) : '<span class="muted">No logs yet</span>'}</td>
        <td>${amsFlagBadges(a.flags)}</td>
      </tr>`).join('') : '<tr><td colspan="7">No athletes match.</td></tr>'}</tbody>
    </table></div>`;
    slot.querySelectorAll('[data-ams-open]').forEach(b => b.addEventListener('click', () => {
      state.amsProfileId = b.dataset.amsOpen;
      renderAms();
      window.scrollTo(0, 0);
    }));
  };
  paintTable();
  $('#ams-q').addEventListener('input', (e) => { state.amsQ = e.target.value; paintTable(); });
  $('#ams-group').addEventListener('change', (e) => { state.amsGroup = e.target.value; paintTable(); });
  $('#ams-status-filter').addEventListener('change', (e) => { state.amsStatus = e.target.value; paintTable(); });
}
async function renderAmsProfile(el, profileId) {
  let d;
  try { d = await api('/api/ams/athlete/' + encodeURIComponent(profileId)); }
  catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const p = d.profile;
  const w = d.wellness;
  const att = d.attendance;
  const ml = d.memberLogs || { recent: [], total: 0, lastLogDate: null, last7Count: 0 };
  const attLine = (label, win) => `<p><strong>${label}:</strong> ${win.marked} marked · ${win.attended} attended · ${win.absent} absent${win.percent == null ? '' : ' · ' + win.percent + '% attended'}</p>`;
  /* Devices strip: the latest session per device (server-computed
     from the same testing store the Testing card reads), shown only
     for devices this athlete actually has data on. */
  const devNames = { forcedecks: 'ForceDecks', nordbord: 'NordBord', tapex: 'T-APEX' };
  const devEntries = Object.keys(devNames)
    .filter(k => d.devices && d.devices[k])
    .map(k => {
      const s = d.devices[k];
      const metrics = (s.metrics || [])
        .map(m => `${esc(m.name.replace(/^[^·]+·\s*/, ''))} <strong>${esc(fmtNum(m.value))}</strong>`)
        .join(' · ');
      const pair = k === 'nordbord' && s.left != null && s.right != null
        ? ` <span class="muted">(L ${esc(fmtNum(s.left))} / R ${esc(fmtNum(s.right))})</span>` : '';
      return `<div class="roster-row"><span><strong>${devNames[k]}</strong> — latest ${esc(s.date)}</span><span>${metrics}${pair}</span></div>`;
    });
  const devicesHtml = devEntries.length ? `
    <div class="card">
      <h2>Devices — latest sessions</h2>
      ${devEntries.join('')}
    </div>` : '';
  el.innerHTML = `
    <button class="btn secondary back" id="ams-back" type="button">← AMS roster</button>
    <div class="card">
      <h2>${esc(p.name)}${p.topAthlete ? ' <span class="badge star">★ Top athlete</span>' : ''}${p.archived ? ' <span class="badge plain">ARCHIVED</span>' : ''}</h2>
      <p class="muted">${esc(p.groupName || 'No group')}${(p.events || []).length ? ' · ' + esc(p.events.join(', ')) : ''}</p>
      <p>${d.linked
        ? `Account linked: <strong>${esc(d.linkedEmail)}</strong>`
        : '<span class="badge plain">NOT LINKED</span> <span class="muted">No account linked — this athlete cannot check in yet. Link their email in Roster &amp; Groups.</span>'}</p>
      <div class="filter-row">
        <label>Status <select id="ams-status">
          ${Object.keys(AMS_STATUS_LABELS).map(s => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${AMS_STATUS_LABELS[s]}</option>`).join('')}
        </select></label>
      </div>
      <p>Attention: ${amsFlagBadges(d.flags)}</p>
    </div>
    <div class="card">
      <h2>Member intake</h2>
      ${p.intake ? intakeSummaryHtml(p.intake) : '<p class="muted">No intake on file yet. A linked member completes their intake and waiver in their Account area — until then this member carries the Intake needed flag.</p>'}
    </div>
    <div class="card">
      <h2>Wellness — last 14 days</h2>
      ${w.recent.length ? `
      <p class="muted">${w.summary.days} check-ins · avg sleep ${w.summary.avgSleep == null ? '—' : w.summary.avgSleep}h · avg soreness ${w.summary.avgSoreness == null ? '—' : w.summary.avgSoreness}/5 · avg energy ${w.summary.avgEnergy == null ? '—' : w.summary.avgEnergy}/5 · ${w.summary.flaggedDays} flagged day${w.summary.flaggedDays === 1 ? '' : 's'}</p>
      <div class="table-wrap"><table class="ranked">
        <thead><tr><th>Date</th><th>Sleep</th><th>Soreness</th><th>Energy</th><th>Flags</th></tr></thead>
        <tbody>${w.recent.slice().reverse().map(c => `<tr>
          <td>${esc(fmtDate(parseDate(c.date)))}</td><td>${c.sleep}h</td><td>${c.soreness}/5</td><td>${c.energy}/5</td>
          <td>${c.flags.length ? c.flags.map(f => `<span class="badge high">${esc(CHECKIN_FLAG_LABELS[f] || f).toUpperCase()}</span>`).join(' ') : '<span class="badge low">OK</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">No check-ins in the last 14 days.</p>'}
    </div>
    <div class="card">
      <h2>Testing</h2>
      ${d.testing.length ? `<div class="table-wrap"><table class="ranked">
        <thead><tr><th>Test</th><th>Latest</th><th>Best</th><th>Latest date</th></tr></thead>
        <tbody>${d.testing.map(t => `<tr><td>${esc(t.name)}</td><td>${t.latest == null ? '—' : esc(fmtNum(t.latest)) + ' ' + esc(t.unit)}</td><td>${t.best == null ? '—' : esc(fmtNum(t.best)) + ' ' + esc(t.unit)}</td><td>${esc(t.latestDate || '—')}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">No testing results yet.</p>'}
    </div>${devicesHtml}
    <div class="card">
      <h2>Meet results &amp; PRs</h2>
      ${d.meetPrs.length ? `<div class="table-wrap"><table class="ranked">
        <thead><tr><th>Event</th><th>PR</th><th>Meet</th><th>Date</th></tr></thead>
        <tbody>${d.meetPrs.map(pr => `<tr><td>${esc(pr.name)}</td><td>${esc(pr.mark)}</td><td>${esc(pr.meet)}</td><td>${esc(pr.date)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">No meet results yet.</p>'}
      ${d.recentResults.length ? `<h3>Most recent results</h3>${d.recentResults.map(r => `
        <div class="roster-row"><span>${esc(r.date)} · ${esc(r.eventName)} — <strong>${esc(r.mark)}</strong></span><span class="muted">${esc(r.meet)}</span></div>`).join('')}` : ''}
    </div>
    <div class="card">
      <h2>Attendance</h2>
      ${attLine('Last 30 days', att.last30)}
      ${attLine('Season to date', att.season)}
      ${att.recent.length ? att.recent.map(m => `
        <div class="roster-row"><span>${esc(fmtDate(parseDate(m.date)))}</span><span class="badge ${m.status === 'absent' ? 'high' : 'plain'}">${esc(m.status).toUpperCase()}</span></div>`).join('') : '<p class="muted">No attendance marks yet.</p>'}
    </div>
    <div class="card">
      <h2>Member logs</h2>
      <p class="muted">${ml.total} logged total · ${ml.last7Count} in the last 7 days · last log ${ml.lastLogDate ? esc(fmtDate(parseDate(ml.lastLogDate))) : 'never'}</p>
      <p class="muted">Members write their own workout logs. Coaches can't create or edit them — you can delete one here if it's wrong or inappropriate.</p>
      ${ml.recent.length ? ml.recent.map(l => `
        <div class="roster-row" style="display:block">
          <p><strong>${esc(fmtDate(parseDate(l.date)))}</strong> · ${esc(l.title)} ${memberLogStatusBadge(l)}${memberLogMetaLine(l) ? ' · ' + esc(memberLogMetaLine(l)) : ''}
          <button class="btn secondary" data-ams-log-del="${l.id}" type="button" style="width:auto">Delete</button></p>
          ${(l.entries || []).length ? `<p class="muted">${l.entries.map(e => esc(e.exercise) + (e.detail ? ' — ' + esc(e.detail) : '')).join('<br>')}</p>` : ''}
          ${l.note ? `<p class="muted">${esc(l.note)}</p>` : ''}
        </div>`).join('') : '<p class="muted">No workouts logged yet.</p>'}
    </div>
    <div class="card">
      <h2>Health — aches &amp; pains</h2>
      <p class="muted">${d.health.counts.open} new · ${d.health.counts.monitoring} monitoring · ${d.health.counts.cleared} cleared · ${d.health.counts.total} total</p>
      ${d.health.concerns.length ? d.health.concerns.map(c => `
        <div class="roster-row">
          <span><strong>${esc(AREA_LABELS[c.area] || c.area)}</strong> (${esc(c.side)}) · ${esc(FEELING_LABELS[c.feeling] || c.feeling)} · started ${esc(c.started)}${c.source === 'athlete' ? ' · athlete reported' : ''}</span>
          <span class="badge ${c.status === 'cleared' ? 'low' : 'plain'}">${esc(STATUS_LABELS[c.status] || c.status).toUpperCase()}</span>
        </div>${c.note ? `<p class="muted">${esc(c.note)}</p>` : ''}`).join('') : '<p class="muted">No concerns on file.</p>'}
    </div>
    <div class="card">
      <h2>Goals</h2>
      ${d.goals.length ? d.goals.map(g => `
        <div class="roster-row">
          <span><strong>${esc(g.eventName)}</strong> — target ${esc(g.targetText)}${g.current ? ' · PR ' + esc(g.current.mark) : ''}</span>
          <span>${g.achieved ? '<span class="badge done">ACHIEVED</span>' : (g.progressPct == null ? '<span class="muted">No marks yet</span>' : `<span class="badge plain">${g.progressPct}%</span>`)}</span>
        </div>`).join('') : '<p class="muted">No goals set yet — add them in Goals.</p>'}
    </div>
    <div class="card">
      <h2>Coach notes <span class="badge plain">COACHES ONLY</span></h2>
      <p class="muted">Private to the coaching staff. Athletes never see these — not in the app, not on the TV board, not in exports.</p>
      <label>New note <textarea id="ams-note-text" rows="3" maxlength="2000" placeholder="What does the staff need to remember about this athlete?"></textarea></label>
      <button class="btn primary" id="ams-note-add" type="button" style="width:auto">Add note</button>
      <div id="ams-notes">
      ${d.notes.length ? d.notes.map(n => `
        <div class="roster-row" data-ams-note="${n.id}" style="display:block">
          <p>${esc(n.text)}</p>
          <p class="muted">${esc(n.authorEmail)} · ${esc(String(n.createdAt).slice(0, 10))}${n.updatedAt !== n.createdAt ? ' · edited ' + esc(String(n.updatedAt).slice(0, 10)) : ''}
          <button class="btn secondary" data-ams-note-edit="${n.id}" type="button" style="width:auto">Edit</button>
          <button class="btn secondary" data-ams-note-del="${n.id}" type="button" style="width:auto">Delete</button></p>
        </div>`).join('') : '<p class="muted">No notes yet.</p>'}
      </div>
    </div>`;
  $('#ams-back').addEventListener('click', () => { state.amsProfileId = null; renderAms(); window.scrollTo(0, 0); });
  el.querySelectorAll('[data-ams-log-del]').forEach(b => b.addEventListener('click', async () => {
    if (!window.confirm('Delete this member log? Logs are the member\'s own record — this is a moderation action.')) return;
    try {
      await apiDel('/api/ams/athlete/' + encodeURIComponent(profileId) + '/logs/' + encodeURIComponent(b.dataset.amsLogDel));
      renderAms();
    } catch (err) { alert(err.message); }
  }));
  $('#ams-status').addEventListener('change', async (e) => {
    try {
      await apiPut('/api/profiles/' + encodeURIComponent(profileId), { status: e.target.value });
      state.amsRoster = null;
      renderAms();
    } catch (err) { alert(err.message); }
  });
  $('#ams-note-add').addEventListener('click', async () => {
    const text = $('#ams-note-text').value.trim();
    if (!text) { alert('Write the note first.'); return; }
    try {
      await apiPost('/api/ams/athlete/' + encodeURIComponent(profileId) + '/notes', { text });
      renderAms();
    } catch (err) { alert(err.message); }
  });
  el.querySelectorAll('[data-ams-note-del]').forEach(b => b.addEventListener('click', async () => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await apiDel('/api/ams/athlete/' + encodeURIComponent(profileId) + '/notes/' + encodeURIComponent(b.dataset.amsNoteDel));
      renderAms();
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-ams-note-edit]').forEach(b => b.addEventListener('click', async () => {
    const row = b.closest('[data-ams-note]');
    const note = d.notes.find(n => n.id === b.dataset.amsNoteEdit);
    if (!row || !note) return;
    row.innerHTML = `
      <label>Edit note <textarea id="ams-note-edit-text" rows="3" maxlength="2000">${esc(note.text)}</textarea></label>
      <button class="btn primary" id="ams-note-save" type="button" style="width:auto">Save</button>
      <button class="btn secondary" id="ams-note-cancel" type="button" style="width:auto">Cancel</button>`;
    $('#ams-note-cancel').addEventListener('click', () => renderAms());
    $('#ams-note-save').addEventListener('click', async () => {
      const text = $('#ams-note-edit-text').value.trim();
      if (!text) { alert('Write the note first.'); return; }
      try {
        await apiPut('/api/ams/athlete/' + encodeURIComponent(profileId) + '/notes/' + encodeURIComponent(note.id), { text });
        renderAms();
      } catch (err) { alert(err.message); }
    });
  }));
}

/* ================================================================
   COACH SYSTEM — profiles, assignments, testing, weekly tracker,
   health concerns, demo media. Coach-input, with one exception:
   the daily wellness check-in an athlete logs themselves, once a
   coach links their account to a roster profile.
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
  const who = !state.user
    ? 'Log in with a coach account to use it. Members: your side of the app is the daily check-in on Today and your log.'
    : 'You are signed in as a member — this area is coach-only. Your side of the app is the daily check-in on Today and your log.';
  el.innerHTML = `<div class="card"><strong>Coaches only.</strong><p class="muted">${what} ${who} <button class="btn secondary" data-goto="account" type="button">Go to account</button></p></div>`;
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
    /* A demo saved from the media modal lands here with fresh
       state; if the coverage map is on screen, re-render it so
       the row's status flips in place. */
    const covView = document.getElementById('view-coverage');
    if (covView && covView.classList.contains('active')) renderCoverage();
  } catch (_) { /* media is optional */ }
}
/* Thumbnail for a movement's demo, when one exists: a YouTube demo
   shows the video's own poster frame, an uploaded demo shows a
   still Cloudinary derives from the video itself, and a GIF demo
   is its own thumbnail. No demo, no thumbnail — the row stays
   clean text. Self-contained on purpose: the suite extracts this
   function and exercises it directly. */
/* THUMB-BEGIN */
function thumbUrlFor(m) {
  if (!m || !m.url) return '';
  if (m.type === 'upload') {
    const u = String(m.url);
    const still = u.replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg$2');
    return still !== u ? still : '';
  }
  if (m.type === 'gif') return String(m.url);
  const match = String(m.url).match(/(?:[?&]v=|youtu\.be\/|\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})/);
  return match ? 'https://i.ytimg.com/vi/' + match[1] + '/hqdefault.jpg' : '';
}
/* THUMB-END */
function thumbHtml(id, cls) {
  const url = thumbUrlFor(state.media[id]);
  if (!url) return '';
  return `<span class="row-thumb ${cls || ''}" aria-hidden="true"><img loading="lazy" src="${esc(url)}" alt=""></span>`;
}
function demoHtml(id, title) {
  if (!isCoachUser()) return '';
  const m = state.media[id];
  const view = m ? `<button class="btn secondary demo-btn" type="button" data-demo="${esc(id)}" data-demo-title="${esc(title || id)}">▶ Demo</button>` : '';
  return `<span class="demo-zone">${view}<button class="btn secondary demo-edit-btn" type="button" data-demo-edit="${esc(id)}" data-demo-title="${esc(title || id)}">${m ? 'Edit demo' : 'Add demo'}</button></span>`;
}
/* The one player every demo surface uses: a YouTube embed for a
   YouTube demo, a native video element for the coach's own uploaded
   video (type 'upload', hosted on Cloudinary), an img for a GIF. */
function mediaPlayerHtml(m) {
  if (m.type === 'youtube') {
    return `<div class="media-frame"><iframe src="${esc(m.embedUrl)}" title="Demo video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if (m.type === 'upload') {
    return `<video class="media-video" src="${esc(m.url)}" controls playsinline preload="metadata"></video>`;
  }
  return `<img class="media-gif" src="${esc(m.url)}" alt="Demo animation">`;
}
/* Upload one video file straight from the browser to the coach's
   Cloudinary account with the unsigned preset the server ships in
   the content payload. Resolves with the secure_url to save as the
   movement's demo; rejects with Cloudinary's own message so the
   coach sees exactly what it said. Nothing is saved on failure. */
function uploadDemoVideo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const vu = (state.content && state.content.videoUpload) || null;
    if (!vu) { reject(new Error('Video upload is not set up yet.')); return; }
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', vu.preset);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + vu.cloudName + '/video/upload');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      let json = null;
      try { json = JSON.parse(xhr.responseText); } catch (_) { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && json && json.secure_url) {
        resolve(json.secure_url);
        return;
      }
      const msg = (json && json.error && json.error.message)
        || ('Upload failed (HTTP ' + xhr.status + ').');
      reject(new Error(msg));
    });
    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed — check your connection and try again.'));
    });
    xhr.send(form);
  });
}
let mediaTarget = null;
function openMedia(id, title, editOnly) {
  mediaTarget = id;
  const m = state.media[id];
  $('#media-title').textContent = (title || id) + ' — demo';
  const player = $('#media-player');
  if (m && !editOnly) {
    player.innerHTML = mediaPlayerHtml(m);
  } else {
    player.innerHTML = m ? '' : '<p class="muted">No demo attached to this movement yet.</p>';
  }
  const ed = $('#media-edit');
  if (isCoachUser()) {
    const vu = (state.content && state.content.videoUpload) || null;
    ed.innerHTML = `<label>Demo link — YouTube or a .gif
      <input type="url" id="media-url" value="${m ? esc(m.url) : ''}" placeholder="https://www.youtube.com/watch?v=…"></label>
      <div class="filter-row">
        <button class="btn primary" id="media-save" type="button" style="width:auto">Save demo</button>
        ${m ? '<button class="btn danger" id="media-remove" type="button" style="width:auto">Remove</button>' : ''}
      </div>
      ${vu ? `<label>Upload your video
        <input type="file" id="media-file" accept="video/*"></label>
      <p class="muted" id="media-upload-status">Your own demo video (up to 100 MB) — it plays right in the app, for you and your athletes.</p>` : ''}
      <p class="error" id="media-err"></p>`;
    $('#media-save').addEventListener('click', async () => {
      try {
        await apiPut('/api/media/' + encodeURIComponent(mediaTarget), { url: $('#media-url').value });
        closeMedia();
        await loadMedia();
      } catch (err) { $('#media-err').textContent = err.message; }
    });
    const fileInput = $('#media-file');
    if (fileInput) fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const errEl = $('#media-err');
      const status = $('#media-upload-status');
      errEl.textContent = '';
      if (file.type && !file.type.startsWith('video/')) {
        errEl.textContent = 'That file is not a video.';
        fileInput.value = '';
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        errEl.textContent = 'That video is over 100 MB — trim it or export a smaller file.';
        fileInput.value = '';
        return;
      }
      try {
        const secureUrl = await uploadDemoVideo(file, (pct) => {
          if (status) status.textContent = 'Uploading… ' + pct + '%';
        });
        await apiPut('/api/media/' + encodeURIComponent(mediaTarget), { url: secureUrl, type: 'upload' });
        closeMedia();
        await loadMedia();
      } catch (err) {
        if (status) status.textContent = 'Your own demo video (up to 100 MB) — it plays right in the app, for you and your athletes.';
        errEl.textContent = err.message;
        fileInput.value = '';
      }
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
const CHART_COLORS = ['#c9ccd4', '#e8eaed', '#8a939f', '#c9a227', '#7d99ae', '#a58fc0'];
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

/* ---------------- member invites (owner-managed) ----------------
   Registration is invite-only during the founding pilot: an email
   on this list can create a member account. Mirrors the assistant-
   coach invites above, member-side. */
async function renderClientInvites() {
  const el = $('#client-invites');
  if (!el || !isCoachUser()) return;
  try {
    const data = await api('/api/client-invites');
    const isOwner = !!(state.user && state.user.isOwner);
    const members = data.members || [];
    const memberEmails = new Set(members.map(u => u.email));
    const pending = (data.invites || []).filter(e => !memberEmails.has(e));
    let html = `<div class="card"><h3>Member invites</h3>
      <p class="muted">Registration is invite-only during the founding pilot. Invite a member by email; when they create an account with that exact email, they land as a member. Removing an invite blocks future sign-ups with that email — members who already joined keep their access.</p>`;
    if (isOwner) {
      html += `<form id="client-invite-form">
        <label>Email <input type="email" id="client-invite-email" required autocomplete="email" placeholder="member@example.com"></label>
        <button class="btn primary" type="submit">Invite member</button>
        <p class="error" id="client-invite-err"></p>
      </form>`;
    } else {
      html += `<p class="muted">Only the head coach manages member invites.</p>`;
    }
    html += members.map(u => `<div class="roster-row"><span>${esc(u.email)} <span class="badge low">MEMBER</span></span>
      <span class="muted">registered</span></div>`).join('');
    html += pending.map(e => `<div class="roster-row"><span>${esc(e)} <span class="badge plain">INVITED — NOT REGISTERED YET</span></span>
      ${isOwner ? `<button class="btn secondary" data-client-invite-remove="${esc(e)}" type="button">Remove invite</button>` : ''}</div>`).join('');
    html += `</div>`;
    el.innerHTML = html;
    if (isOwner) {
      $('#client-invite-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await apiPost('/api/client-invites', { email: $('#client-invite-email').value });
          renderClientInvites();
        } catch (err) { $('#client-invite-err').textContent = err.message; }
      });
      el.querySelectorAll('[data-client-invite-remove]').forEach(b => b.addEventListener('click', async () => {
        try {
          await apiDel('/api/client-invites/' + encodeURIComponent(b.dataset.clientInviteRemove));
          renderClientInvites();
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
  const groupSections = [...state.groups.map(g => g.id), '__none'].filter(k => k === '__none' ? byGroup.has(k) : true).map(k => {
    const gname = k === '__none' ? 'No group' : (state.groups.find(g => g.id === k) || {}).name;
    const members = byGroup.get(k) || [];
    return `<h3>${esc(gname || '')}</h3>` + (members.length ? '' : '<p class="muted">No athletes in this group yet.</p>') + members.map(pr => `
      <div class="card roster-card">
        <div class="roster-row">
          <span><strong>${esc(pr.name)}</strong> ${pr.topAthlete ? '<span class="badge star">★ TOP</span>' : ''} ${eventBadges(pr)}</span>
          <span class="roster-actions">
            <button class="btn secondary" data-star="${pr.id}" type="button">${pr.topAthlete ? 'Unstar' : '★ Star'}</button>
            <button class="btn secondary" data-archive="${pr.id}" type="button">Archive</button>
          </span>
        </div>
        <p class="muted">${pr.linkedEmail ? `🔗 Linked: ${esc(pr.linkedEmail)} — this athlete can check in` : '⚠ Not linked — open Edit profile below to link this athlete\'s account for the daily check-in'}</p>
        <label>Group <select data-move="${pr.id}">${groupOpts(pr.groupId)}</select></label>
        <details>
          <summary>Edit profile</summary>
          <label>First name <input type="text" id="ef-${pr.id}" value="${esc(pr.firstName)}"></label>
          <label>Last name <input type="text" id="el-${pr.id}" value="${esc(pr.lastName)}"></label>
          <label>Events (comma list — sprinter, jumper, hurdler…)
            <input type="text" id="ee-${pr.id}" value="${esc((pr.events || []).join(', '))}"></label>
          <button class="btn primary" data-save-profile="${pr.id}" type="button">Save profile</button>
          <h3>Account link — daily check-in</h3>
          <p class="muted">Link the email this athlete uses for their account and they can log the daily check-in (sleep, soreness, energy) themselves. Nothing else opens up.</p>
          <label>Account email <input type="email" id="lk-${pr.id}" value="${esc(pr.linkedEmail || '')}" placeholder="athlete@example.com"></label>
          <button class="btn primary" data-link-profile="${pr.id}" type="button">${pr.linkedEmail ? 'Update link' : 'Link account'}</button>
          ${pr.linkedEmail ? `<button class="btn danger" data-unlink-profile="${pr.id}" type="button">Unlink</button>
          <p class="muted">Linked to ${esc(pr.linkedEmail)} — this athlete can check in.</p>` : ''}
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
      <label>Roster lines <textarea id="import-text" rows="6" placeholder="Doe, John | 100/200 | sprinter | yes">${esc(state.importText || '')}</textarea></label>
      <button class="btn primary" id="import-btn" type="button">Import roster</button>
      <div id="import-report">${state.importReport ? importReportHtml(state.importReport) : ''}</div>
    </div>
    <div id="archived-zone"></div>`;
  $('#pf-group').addEventListener('change', (e) => { state.pfGroup = e.target.value; renderGroups(); });
  $('#pf-event').addEventListener('change', (e) => { state.pfEvent = e.target.value; renderGroups(); });
  $('#pf-top').addEventListener('change', (e) => { state.pfTop = e.target.checked; renderGroups(); });
  $('#pf-q').addEventListener('input', (e) => {
    state.pfQ = e.target.value;
    const q = e.target.value.trim().toLowerCase();
    const main = $('#groups-main');
    if (!main) return;
    main.querySelectorAll('.roster-card').forEach(card => {
      const nameEl = card.querySelector('.roster-row strong');
      card.style.display = !q || (nameEl && nameEl.textContent.toLowerCase().includes(q)) ? '' : 'none';
    });
  });
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
  el.querySelectorAll('[data-link-profile]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.linkProfile;
    try {
      await apiPut('/api/profiles/' + encodeURIComponent(id) + '/link', { email: $('#lk-' + CSS.escape(id)).value });
      renderGroups();
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-unlink-profile]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Unlink this account? The athlete keeps their account but can no longer check in.')) return;
    try { await apiDel('/api/profiles/' + encodeURIComponent(b.dataset.unlinkProfile) + '/link'); renderGroups(); }
    catch (err) { alert(err.message); }
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
      state.importText = $('#import-text').value;
      const data = await apiPost('/api/profiles/import', { text: state.importText });
      state.importReport = data.report;
      await renderGroups();
      state.importReport = null;
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
  /* Checklist rows update in place: mark/unmark swaps only this
     row's contents after the server confirms, so scroll, focus,
     and half-typed marks in other rows survive the save. */
  const memberById = new Map();
  for (const blk of feed.groups) for (const m of blk.members || []) memberById.set(m.profile.id, m);
  const checkRowInner = (m) => `
          <span>${m.completed ? '✅' : '⬜'} <strong>${esc(m.profile.name)}</strong> ${m.profile.topAthlete ? '<span class="badge star">★</span>' : ''}
          ${m.completed && m.completion ? `<span class="muted">${esc(m.completion.marks || '')}${m.completion.feel ? ' · felt ' + m.completion.feel + '/5' : ''}</span>` : ''}</span>
          ${m.completed
            ? `<button class="btn secondary" data-unmark="${m.profile.id}" type="button">Undo</button>`
            : `<span class="check-inputs"><input type="text" id="cm-${m.profile.id}" placeholder="marks (optional)">
               <select id="cf-${m.profile.id}">${FEEL_OPTIONS}</select>
               <button class="btn primary" data-mark="${m.profile.id}" type="button" style="width:auto">Mark done</button></span>`}`;
  const checkRowHtml = (m) => `<div class="roster-row check-row" data-check-row="${m.profile.id}">${checkRowInner(m)}</div>`;
  const wireCheckRow = (row) => {
    const markBtn = row.querySelector('[data-mark]');
    if (markBtn) markBtn.addEventListener('click', async () => {
      const pid = markBtn.dataset.mark;
      const m = memberById.get(pid);
      const marksEl = row.querySelector('input[type="text"]');
      const feelEl = row.querySelector('select');
      const marks = marksEl ? marksEl.value : '';
      const feel = feelEl && feelEl.value ? parseInt(feelEl.value, 10) : null;
      clearRowError(row);
      try {
        await apiPost('/api/completions', { profileId: pid, date: state.feedDate, marks, feel });
        if (m) { m.completed = true; m.completion = { marks, feel }; }
        row.innerHTML = checkRowInner(m || { profile: { id: pid, name: '' }, completed: true, completion: { marks, feel } });
        wireCheckRow(row);
        flashSaved(row);
        const rows = Array.from(el.querySelectorAll('[data-check-row]'));
        const idx = rows.indexOf(row);
        const next = rows.slice(idx + 1).concat(rows.slice(0, idx)).find(r => r.querySelector('[data-mark]'));
        const target = next ? next.querySelector('input[type="text"]') : row.querySelector('[data-unmark]');
        if (target) target.focus();
      } catch (err) { showRowError(row, err.message); }
    });
    const unmarkBtn = row.querySelector('[data-unmark]');
    if (unmarkBtn) unmarkBtn.addEventListener('click', async () => {
      const pid = unmarkBtn.dataset.unmark;
      const m = memberById.get(pid);
      clearRowError(row);
      try {
        await apiPost('/api/completions', { profileId: pid, date: state.feedDate, completed: false });
        if (m) { m.completed = false; m.completion = null; }
        row.innerHTML = checkRowInner(m || { profile: { id: pid, name: '' }, completed: false });
        wireCheckRow(row);
        flashSaved(row);
        const inp = row.querySelector('input[type="text"]');
        if (inp) inp.focus();
      } catch (err) { showRowError(row, err.message); }
    });
  };
  const groupCard = (blk) => {
    if (!blk.group) {
      return `<div class="card"><h3>No group</h3>
        ${blk.members.length ? blk.members.map(m => `<div class="roster-row"><span>${esc(m.profile.name)}</span><span class="muted">assign a group in Groups</span></div>`).join('') : '<p class="muted">Everyone is in a group.</p>'}
        <p><button class="btn secondary" id="coach-goto-groups" type="button">Open Roster &amp; Groups</button></p>
      </div>`;
    }
    const a = blk.assignment;
    return `<div class="card">
      <h3>${esc(blk.group.name)}</h3>
      <p class="plan">${a.sessionId ? `<a class="code-link" data-code="${a.sessionId}">${a.sessionId}</a> ${esc(a.sessionName)}` : esc(a.planText || 'Rest day')}
        ${a.source === 'override' ? '<span class="badge plain">YOUR PICK</span>' : '<span class="badge plain">FROM THE PLAN</span>'}</p>
      ${a.note ? `<p><strong>Your note:</strong> ${esc(a.note)}</p>` : ''}
      ${a.warmup ? `<div class="warmup">Warm-up: ${esc(a.warmup)}</div>` : ''}
      ${a.sessionId && state.sessions.get(a.sessionId) ? runTodayButtonHtml({ sessionId: a.sessionId, groupName: blk.group.name }) : ''}
      <details>
        <summary>Change today's workout for this group</summary>
        <label>Workout <select id="ov-${blk.group.id}">${sessionOpts(a.sessionId)}</select></label>
        <label>Note (optional) <input type="text" id="ovn-${blk.group.id}" value="${esc(a.note || '')}" placeholder="e.g. Keep it at 90% today"></label>
        <div class="filter-row">
          <button class="btn primary" data-override="${blk.group.id}" type="button" style="width:auto">Save override</button>
          <button class="btn secondary" data-clear-override="${blk.group.id}" type="button" style="width:auto">Clear override (back to the plan)</button>
        </div>
      </details>
      <h4>Who got it done</h4>
      ${blk.members.length ? blk.members.map(m => checkRowHtml(m)).join('') : '<p class="muted">No athletes in this group yet.</p>'}
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
      ${state.feedDate !== todayStr() ? '<button class="btn secondary" id="feed-today" type="button" style="width:auto">Back to today</button>' : ''}
      <p class="muted">Each group gets the season plan's workout by default. Override it when the day calls for something else, then check off who completed it — marks and feel land on the athlete's record.</p>
    </div>
    ${feed.groups.map(groupCard).join('')}
    ${groupCard(feed.unassigned)}`;
  $('#coach-open-tv').addEventListener('click', () => showView('tv'));
  wireRunTodayButtons(el);
  const ggBtn = $('#coach-goto-groups');
  if (ggBtn) ggBtn.addEventListener('click', () => showView('groups'));
  const ftBtn = $('#feed-today');
  if (ftBtn) ftBtn.addEventListener('click', () => { state.feedDate = todayStr(); renderCoach(); });
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
      if (!confirm('Clear this override and go back to the season plan for this group?')) return;
      await apiPost('/api/assignments/override', { groupId: b.dataset.clearOverride, date: state.feedDate, sessionId: null });
      renderCoach();
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll('[data-check-row]').forEach(wireCheckRow);
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
    const cur = current ? `<div class="muted rapid-now">Now: ${resultRawText(current, test)}${test.kind === 'lift' ? ` · est. 1RM ${fmtNum(current.display || current.est1rm)} lb` : ''}</div>` : '';
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
  /* Ranked tables are a derived zone: saves refresh ONLY this
     zone in place (see refreshRankedInPlace), never the whole
     Testing view, so entry focus/scroll elsewhere is untouched. */
  const renderRankedHtml = () => dayTests.map(t => {
        const rows = dayResults.filter(r => r.testKey === t.key).slice()
          .sort((a, b) => t.better === 'lower' ? (a.display || 0) - (b.display || 0) : (b.display || 0) - (a.display || 0));
        return `<h3><span class="row-lead">${thumbHtml(t.key, 'thumb-sm')}<span>${esc(t.name)}</span></span> ${demoHtml(t.key, t.name)}</h3>
        ${rows.length ? `<div class="table-wrap"><table class="ranked">
          <thead><tr><th>#</th><th>Athlete</th><th>Result</th>${t.kind === 'lift' ? '<th>Est. 1RM</th>' : ''}</tr></thead>
          <tbody>${rows.map((r, i) => {
            const pr = state.profiles.find(x => x.id === r.profileId);
            return `<tr><td>${i + 1}</td><td>${esc(pr ? pr.name : '?')}</td><td>${resultRawText(r, t)}</td>${t.kind === 'lift' ? `<td><strong>${fmtNum(r.display)} lb</strong></td>` : ''}</tr>`;
          }).join('')}</tbody></table></div>` : '<p class="muted">No results yet.</p>'}`;
      }).join('');
  const refreshRankedInPlace = () => {
    const z = $('#ranked-zone');
    if (z) z.innerHTML = renderRankedHtml();
  };
  const setProgressCell = (pid, key, has) => {
    const td = el.querySelector('[data-progress-cell="' + pid + ':' + key + '"]');
    if (td) td.innerHTML = has ? '✅' : '<span class="muted">·</span>';
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
        ${activeProfiles().map(pr => `<tr><td>${esc(pr.name)}</td>${dayTests.map(t => `<td data-progress-cell="${pr.id}:${t.key}">${resultFor(pr.id, t.key) ? '✅' : '<span class="muted">·</span>'}</td>`).join('')}</tr>`).join('')}
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
      <p class="muted" id="grid-ok"></p>
    </div>
    <div class="card">
      <h2>Ranked — ${esc(day.title)}</h2>
      <div id="ranked-zone">${renderRankedHtml()}</div>
    </div>
    <div class="card">
      <h2>Athlete history</h2>
      <label>Athlete <select id="hist-athlete">${profileOptions(state.histAthleteId, true)}</select></label>
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
  /* Rapid entry saves update only the saved test's block in
     place (plus the progress cell and the ranked zone) — other
     tests' half-typed values, scroll, and focus all survive. */
  const applyResultInPlace = (pid, test, result) => {
    const saved = Object.assign({}, result, {
      display: result.display != null ? result.display
        : (result.est1rm != null ? result.est1rm : result.value),
    });
    const i = dayResults.findIndex(r => r.profileId === pid && r.testKey === test.key);
    if (i >= 0) dayResults[i] = saved; else dayResults.push(saved);
    setProgressCell(pid, test.key, true);
    refreshRankedInPlace();
  };
  const wireRapidBlock = (block) => {
    const b = block.querySelector('[data-save-result]');
    if (!b) return;
    b.addEventListener('click', async () => {
      const [p2, key] = b.dataset.saveResult.split(':');
      const test = tests.find(t => t.key === key);
      const body = { profileId: p2, testDayId: day.id, testKey: key };
      clearRowError(block);
      try {
        if (test.kind === 'lift') {
          body.weight = block.querySelector('[id^="rw-"]').value;
          const reps = block.querySelector('[id^="rr-"]').value;
          if (reps) body.reps = parseInt(reps, 10);
        } else {
          body.value = block.querySelector('[id^="rv-"]').value;
        }
        const out = await apiPost('/api/results', body);
        applyResultInPlace(p2, test, out.result);
        block.innerHTML = `
          <div class="roster-row"><span class="row-lead">${thumbHtml(test.key, 'thumb-sm')}<strong>${esc(test.name)}</strong></span> ${demoHtml(test.key, test.name)}</div>
          ${testInputs(test, resultFor(p2, key), p2)}`;
        wireRapidBlock(block);
        flashSaved(block);
        if (state.histAthleteId === p2) renderHist();
        const blocks = Array.from(document.querySelectorAll('[data-rapid-block]'));
        const idx = blocks.indexOf(block);
        const next = blocks.slice(idx + 1).concat(blocks.slice(0, idx))
          .find(bl => bl !== block);
        const target = (next && next.querySelector('input')) || block.querySelector('input');
        if (target) target.focus();
      } catch (err) { showRowError(block, err.message); }
    });
  };
  const renderRapid = () => {
    const zone = $('#rapid-zone');
    const pid = $('#rapid-athlete').value;
    state.rapidAthleteId = pid || null;
    if (!pid) { zone.innerHTML = '<p class="muted">Pick an athlete to start entering.</p>'; return; }
    const pr = state.profiles.find(x => x.id === pid);
    zone.innerHTML = `<h3>${esc(pr ? pr.name : '')}</h3>` + dayTests.map(t => `
      <div class="rapid-test" data-rapid-block="${pid}:${t.key}">
        <div class="roster-row"><span class="row-lead">${thumbHtml(t.key, 'thumb-sm')}<strong>${esc(t.name)}</strong></span> ${demoHtml(t.key, t.name)}</div>
        ${testInputs(t, resultFor(pid, t.key), pid)}
      </div>`).join('');
    zone.querySelectorAll('[data-rapid-block]').forEach(wireRapidBlock);
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
    const okPrev = $('#grid-ok');
    if (okPrev) okPrev.textContent = '';
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
    if (clear.length && !confirm(`Save ${entries.length} result${entries.length === 1 ? '' : 's'} and CLEAR ${clear.length} saved result${clear.length === 1 ? '' : 's'}? Cleared results are deleted.`)) return;
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
          const firstBad = gridZone.querySelector('td.cell-error input');
          if (firstBad) firstBad.focus();
        }
        return;
      }
      /* Bulk save confirmed (all-or-nothing server-side): fold
         the confirmed results into the local day data and refresh
         only the derived zones — the grid inputs themselves are
         never repainted, so unsaved cells, scroll, and focus
         survive; nothing was painted as saved before this point. */
      for (const r of (data.results || [])) {
        const saved = Object.assign({}, r, {
          display: r.display != null ? r.display : (r.est1rm != null ? r.est1rm : r.value),
        });
        const i = dayResults.findIndex(x => x.profileId === r.profileId && x.testKey === r.testKey);
        if (i >= 0) dayResults[i] = saved; else dayResults.push(saved);
        setProgressCell(r.profileId, r.testKey, true);
      }
      for (const c of clear) {
        const i = dayResults.findIndex(x => x.profileId === c.profileId && x.testKey === c.testKey);
        if (i >= 0) dayResults.splice(i, 1);
        setProgressCell(c.profileId, c.testKey, false);
      }
      refreshRankedInPlace();
      if (state.histAthleteId) renderHist();
      const okEl = $('#grid-ok');
      if (okEl) okEl.textContent = `Saved ${data.saved} result${data.saved === 1 ? '' : 's'}${data.cleared ? `, cleared ${data.cleared}` : ''} — progress and standings above are updated.`;
      flashSaved(gridZone);
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
  if (ha) ha.addEventListener('change', () => { state.histAthleteId = ha.value || null; });
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
  /* This athlete's own charts block — rebuilt in place after a
     weekly save (it sits below the entry rows, so entry scroll
     and focus are untouched). */
  const athleteChartsHtml = (pr) => {
    const charts = metrics.map(m => {
      const pts = seriesFromEntries(dash.entries[pr.id], m.key);
      if (!pts.length) return '';
      const stats = seriesStats(pts, m);
      return `<h4>${esc(m.name)} <span class="muted">best ${stats.best !== null ? fmtNum(stats.best) + ' ' + esc(m.unit) : '—'}</span> ${deltaHtml(m, stats)}</h4>
        ${lineChart([{ label: pr.name, color: '#c9ccd4', points: pts }], m, true)}`;
    }).join('');
    return `<h3>${esc(pr.name)} ${eventBadges(pr)}</h3>${charts || '<p class="muted">No weekly numbers yet.</p>'}`;
  };
  const refreshAthleteChartsInPlace = (pr) => {
    const box = el.querySelector('[data-athlete-charts="' + pr.id + '"]');
    if (box) box.innerHTML = athleteChartsHtml(pr);
  };
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
      <p class="muted" id="compare-cue"></p>
    </div>
    <div class="card">
      <h2>Enter this week's numbers</h2>
      <div class="filter-row">
        <label>Week of (Monday) <input type="date" id="top-week" value="${esc(state.topWeek)}"></label>
        <label>Metric <select id="top-entry-metric">${metrics.map(m => `<option value="${m.key}" ${m.key === state.entryMetric ? 'selected' : ''}>${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select></label>
      </div>
      ${tops.map(pr => {
        const cur = ((dash.entries[pr.id] || {})[state.entryMetric] || {})[state.topWeek];
        return `<div class="roster-row" data-weekly-row="${pr.id}"><span>${esc(pr.name)} <span class="muted weekly-now" data-weekly-now="${pr.id}">${cur !== undefined ? `now ${fmtNum(cur)} ${esc(entryMetricObj.unit)}` : ''}</span></span>
          <span class="check-inputs"><input type="number" step="any" min="0" id="wv-${pr.id}" value="${cur !== undefined ? esc(cur) : ''}" placeholder="${esc(entryMetricObj.unit)}">
          <button class="btn primary" data-weekly-save="${pr.id}" type="button" style="width:auto">Save</button></span></div>`;
      }).join('')}
      <p class="muted">Saving overwrites that week's number — one value per athlete per week.</p>
      <p><a class="btn secondary" href="/api/export/weekly.csv">Download weekly tracker (CSV)</a></p>
    </div>
    <div class="card">
      <h2>Each athlete</h2>
      ${tops.map(pr => `<div data-athlete-charts="${pr.id}">${athleteChartsHtml(pr)}</div>`).join('')}
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
  /* Weekly saves update just the athlete's row in place (plus
     that athlete's own charts below) — the compare overlay above
     the entry card is NOT rebuilt, because repainting it would
     shift the entry rows mid-entry; when the saved metric is the
     compared one, a visible cue says it refreshes on re-entry. */
  el.querySelectorAll('[data-weekly-save]').forEach(b => b.addEventListener('click', async () => {
    const pid = b.dataset.weeklySave;
    const row = b.closest('[data-weekly-row]');
    const inp = row ? row.querySelector('input') : null;
    const val = inp ? inp.value : '';
    clearRowError(row);
    try {
      const out = await apiPut('/api/weekly/entry', { profileId: pid, metricId: state.entryMetric, week: state.topWeek, value: val === '' ? '' : Number(val) });
      dash.entries[pid] = dash.entries[pid] || {};
      dash.entries[pid][state.entryMetric] = dash.entries[pid][state.entryMetric] || {};
      dash.entries[pid][state.entryMetric][state.topWeek] = out.value;
      const nowEl = row ? row.querySelector('[data-weekly-now]') : null;
      if (nowEl) nowEl.textContent = `now ${fmtNum(out.value)} ${entryMetricObj.unit}`;
      const prObj = tops.find(x => x.id === pid);
      if (prObj) refreshAthleteChartsInPlace(prObj);
      if (state.topMetric === state.entryMetric) {
        const cue = $('#compare-cue');
        if (cue) cue.textContent = 'Standings updated — the compare chart refreshes when you reopen this view.';
      }
      flashSaved(row);
      const rows = Array.from(el.querySelectorAll('[data-weekly-row]'));
      const idx = rows.indexOf(row);
      const next = rows[idx + 1] || rows[idx - 1];
      const target = next ? next.querySelector('input') : inp;
      if (target) target.focus();
    } catch (err) { showRowError(row, err.message); }
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
        <span>${c.pain == null ? '<span class="badge plain">NO SCORE YET</span>' : `<span class="badge ${c.pain >= 7 ? 'high' : 'plain'}">PAIN ${c.pain}/10</span>`}
        ${c.impact === 'stopped' ? '<span class="badge high">STOPPED</span>' : `<span class="badge plain">${esc(IMPACT_LABELS[c.impact] || c.impact)}</span>`}
        ${c.source === 'athlete' ? '<span class="badge star">ATHLETE REPORTED</span>' : ''}
        <span class="badge ${c.status === 'cleared' ? 'low' : 'plain'}">${esc(STATUS_LABELS[c.status] || c.status).toUpperCase()}</span></span>
      </div>
      <p class="muted">Started ${esc(c.started)} · filed ${esc(String(c.createdAt).slice(0, 10))}</p>
      ${c.note ? `<p>${esc(c.note)}</p>` : ''}
      <div class="filter-row">
        <label>Status <select id="cs-${c.id}">
          ${Object.keys(STATUS_LABELS).map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select></label>
        <label>Pain now <select id="cp-${c.id}">
          <option value="" ${c.pain == null ? 'selected' : ''}>— not recorded —</option>
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
        <label>Pain (1-10) <select id="hc-pain"><option value="" selected>— pick —</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
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
      ${byAthlete[name].map(c => `<div class="roster-row"><span>${esc(AREA_LABELS[c.area] || c.area)} (${esc(c.side)}) · ${esc(FEELING_LABELS[c.feeling] || c.feeling)} · started ${esc(c.started)}${c.source === 'athlete' ? ' · athlete reported' : ''}</span>
        <span><span class="badge ${c.pain != null && c.pain >= 7 ? 'high' : 'plain'}">${c.pain == null ? 'no score' : c.pain + '/10'}</span> <span class="badge plain">${esc(STATUS_LABELS[c.status] || c.status)}</span></span></div>`).join('')}
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
        pain: $('#cp-' + CSS.escape(id)).value === '' ? undefined : parseInt($('#cp-' + CSS.escape(id)).value, 10),
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
   restAfterBlock, exercises: [{ name, reps, load? }] }] } — exactly
   the shape of a coach-built custom workout, and the shape library
   sessions are mapped into by sessionToRunnerPlan below. A custom
   workout's % of max prescription rides along on the step as
   `load` ({ testKey, percent, sets, reps }), untouched, so the
   runner display can name the prescription; library exercises
   never carry one.
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
          round, rounds, exIndex: ei, name: ex.name, reps: ex.reps, load: ex.load || null,
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
  /* Sessions that carry their own runner blocks (the Instagram-
     mined workouts, whose block structure the spec fields cannot
     express) launch with those blocks verbatim. Spec sessions have
     no blocks field and take the best-effort mapping below. */
  if (s && Array.isArray(s.blocks) && s.blocks.length) {
    return { title: s.id + ' · ' + s.name, blocks: s.blocks };
  }
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

/* TODAY-RUN-BEGIN */
/* Which Run buttons belong on the Today screen. Pure decisions,
   no DOM: the renderers turn these into buttons, and the test
   suite evaluates this section directly.
   todayRunTargets takes the groups array from /api/coach/today
   (plan default + coach override already resolved server-side):
   - no group has a session today -> no buttons at all
   - every group shares one session -> one unnamed target
   - groups differ -> one target per group, named, so the coach
     runs the right session for the group in front of him
   featuredRunSessionId is the plan's featured session for a day,
   resolved the way the server resolves an assignment: the first
   code in the day's text. A rest day has no codes, so no button. */
function todayRunTargets(groups) {
  const live = (groups || []).filter(g => g && g.assignment && g.assignment.sessionId);
  if (!live.length) return [];
  const distinct = [...new Set(live.map(g => g.assignment.sessionId))];
  if (distinct.length === 1) return [{ sessionId: distinct[0], groupName: null }];
  return live.map(g => ({ sessionId: g.assignment.sessionId, groupName: (g.group && g.group.name) || '' }));
}
function featuredRunSessionId(info) {
  if (!info || !info.codes || !info.codes.length) return null;
  return info.codes[0];
}
/* TODAY-RUN-END */

/* MEMBER-LOG-RUNNER-BEGIN */
/* The runner -> member-log handoff, as pure data shaping (the test
   suite evaluates this section directly). The exercise list is the
   run's exercise steps deduped by name — the first reps label wins
   — and the payload is one 'done' log for the day: the plan's
   title, its session code when the title names one ("CODE · Name",
   matched by the session-code shape so a custom workout's title
   can never masquerade as a code), and the elapsed whole minutes. */
function memberLogEntriesFromSteps(steps) {
  const seen = new Set();
  const entries = [];
  for (const s of steps || []) {
    if (!s || s.type !== 'exercise' || !s.name) continue;
    const key = String(s.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ exercise: s.name, detail: s.reps ? String(s.reps) : '' });
    if (entries.length >= 40) break;
  }
  return entries;
}
function memberLogFromRunner(plan, steps, elapsedMs, today) {
  const title = (plan && plan.title) || 'Workout';
  const codePart = title.split(' · ')[0];
  return {
    date: today,
    sessionCode: /^[A-Z]{2,3}-\d{2}$/.test(codePart) ? codePart : '',
    title,
    status: 'done',
    rpe: null,
    durationMin: Math.max(1, Math.round((elapsedMs || 0) / 60000)),
    entries: memberLogEntriesFromSteps(steps),
    note: '',
  };
}
/* MEMBER-LOG-RUNNER-END */

/* The big scarlet Run button for the Today screen. The button
   carries data-run-today with a session id; wireRunTodayButtons
   launches the runner through the same sessionToRunnerPlan +
   openRunner path as a session's own "Run this workout" button. */
function runTodayButtonHtml(target) {
  const label = target.groupName
    ? `▶ Run — ${esc(target.groupName)} · ${esc(target.sessionId)}`
    : `▶ Run today's workout · ${esc(target.sessionId)}`;
  return `<button class="btn primary run-today-btn" type="button" data-run-today="${esc(target.sessionId)}">${label}</button>`;
}
function wireRunTodayButtons(root) {
  if (!root) return;
  root.querySelectorAll('[data-run-today]').forEach(b => b.addEventListener('click', () => {
    const s = state.sessions.get(b.dataset.runToday);
    if (s) openRunner(sessionToRunnerPlan(s));
  }));
}

/* ---------------- runner mode (display) ----------------
   A full-screen walk through a workout: the current exercise huge,
   one big advance button, honest rest timers (timestamp-based, so
   a backgrounded tab cannot corrupt them). Opened from a custom
   workout's Run it button or a library session's Run this workout. */
const runner = {
  open: false, plan: null, steps: [], idx: 0,
  startedAt: 0, endsAt: 0, remaining: 0, paused: false, tickId: null, audioCtx: null,
  wakeLock: null,
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
  /* Keep the screen awake through rests (best effort; unsupported
     browsers just skip it). */
  try {
    if (navigator.wakeLock) {
      navigator.wakeLock.request('screen').then(l => { runner.wakeLock = l; }).catch(() => {});
    }
  } catch (_) {}
  renderRunnerStep();
}
function requestCloseRunner() {
  /* Exiting mid-workout used to discard the run with one stray tap. */
  if (runner.open && runner.idx > 0 && runner.idx < runner.steps.length) {
    if (!confirm('End this workout run? Your place in the workout will be lost.')) return;
  }
  closeRunner();
}
function closeRunner() {
  runnerStopTick();
  if (runner.wakeLock) { try { runner.wakeLock.release(); } catch (_) {} runner.wakeLock = null; }
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
  if (e.key === 'Escape') { requestCloseRunner(); return; }
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
/* The demo for a runner exercise, when one is attached to the
   movement it names. Runner steps carry free-text names, so the
   match is exact on the normalized name against the drills and the
   test battery — the movements the media map is keyed by. What the
   runner shows is the movement's current demo, uploaded videos
   included, through the same player as everywhere else. */
/* Display name for a lift test key (a % prescription's target).
   The loaded test battery wins; the five preloaded lifts are the
   fallback so the runner can name a prescription even when the
   Testing view was never opened this session. */
const LIFT_NAME_FALLBACK = {
  'back-squat': 'Back Squat', 'trap-bar-deadlift': 'Trap Bar Deadlift',
  'bench-press': 'Bench Press', 'hang-clean': 'Hang Clean', 'power-clean': 'Power Clean',
};
function liftNameForKey(key) {
  const t = (state.tests || []).find(x => x.key === key);
  return t ? t.name : (LIFT_NAME_FALLBACK[key] || key);
}
function demoForRunnerExercise(name) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const target = norm(name);
  if (!target) return null;
  const drills = (state.content && state.content.drills) || [];
  for (const d of drills) {
    if (norm(d.name) === target && state.media[d.id]) return state.media[d.id];
  }
  for (const t of state.tests || []) {
    if (norm(t.name) === target && state.media[t.key]) return state.media[t.key];
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
        ${isAthleteUser() ? '<button class="btn runner-btn" id="runner-log-btn" type="button">Log this workout</button>' : ''}
      </div>`;
    $('#runner-done-btn').addEventListener('click', closeRunner);
    const runnerLogBtn = $('#runner-log-btn');
    if (runnerLogBtn) runnerLogBtn.addEventListener('click', async () => {
      runnerLogBtn.disabled = true;
      try {
        const payload = memberLogFromRunner(runner.plan, runner.steps,
          Date.now() - runner.startedAt, dateStrOf(todayLocal()));
        await apiPost('/api/my/logs', payload);
        runnerLogBtn.textContent = 'Logged ✓';
        state.memberLogsData = null;
      } catch (err) {
        runnerLogBtn.disabled = false;
        alert(err.message);
      }
    });
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
    const demo = demoForRunnerExercise(step.name);
    const loadHtml = step.load ? `
      <p class="runner-load">${esc(step.name)} — ${step.load.percent}% of ${esc(liftNameForKey(step.load.testKey))} max</p>
      ${runner.plan && runner.plan.workoutId ? '<button class="btn secondary" id="runner-loadchart" type="button">Load chart — every member\'s weight</button>' : ''}` : '';
    main.innerHTML = head + `
      <p class="runner-where">Block ${step.block + 1} of ${step.blocks} · Round ${step.round} of ${step.rounds}</p>
      <h2 class="runner-ex-name">${esc(step.name)}</h2>
      <p class="runner-ex-reps">× ${esc(repsLabel(step.reps))}</p>
      ${loadHtml}
      <p class="runner-next">${nextText}</p>
      ${demo ? `<div class="runner-demo"><button class="btn secondary" id="runner-demo-btn" type="button">▶ Watch demo</button><div id="runner-demo-slot"></div></div>` : ''}
      <div class="runner-controls">
        <button class="btn runner-btn secondary" id="runner-back" type="button" ${runner.idx === 0 ? 'disabled' : ''}>← Back</button>
        <button class="btn runner-btn primary" id="runner-advance" type="button">Done — next →</button>
      </div>`;
    const chartBtn = $('#runner-loadchart');
    if (chartBtn) chartBtn.addEventListener('click', () => {
      const wid = runner.plan && runner.plan.workoutId;
      closeRunner();
      if (wid) { state.cwOpenChart = wid; showView('custom'); }
    });
    const demoBtn = $('#runner-demo-btn');
    if (demoBtn) demoBtn.addEventListener('click', () => {
      $('#runner-demo-slot').innerHTML = mediaPlayerHtml(demo);
      demoBtn.remove();
    });
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
  if (exit) exit.addEventListener('click', requestCloseRunner);
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
    exercises: Array.from(blockEl.querySelectorAll('.cw-ex-row')).map(row => {
      const ex = {
        name: row.querySelector('.cw-ex-name').value,
        reps: row.querySelector('.cw-ex-reps').value,
      };
      const mode = row.querySelector('.cw-ex-mode');
      if (mode && mode.value === 'pct') {
        const pctRaw = row.querySelector('.cw-ex-pct').value;
        ex.load = {
          testKey: row.querySelector('.cw-ex-test').value,
          percent: pctRaw === '' ? '' : Number(pctRaw),
          sets: cwNum(row.querySelector('.cw-ex-sets').value),
          reps: cwNum(row.querySelector('.cw-ex-lreps').value),
        };
      }
      return ex;
    }),
  }));
}
/* The lifts a % prescription can target, as <option>s: the loaded
   battery's lift-kind tests, or the five preloaded lifts when the
   battery has not loaded. */
function cwLiftOptions(selectedKey) {
  const lifts = (state.tests || []).filter(t => t.kind === 'lift');
  const list = lifts.length
    ? lifts.map(t => ({ key: t.key, name: t.name }))
    : Object.entries(LIFT_NAME_FALLBACK).map(([key, name]) => ({ key, name }));
  return list.map(t =>
    `<option value="${esc(t.key)}" ${t.key === selectedKey ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}
/* The %-prescribed steps of a workout draft/stored workout, for
   deciding whether the Load chart button belongs on its card. */
function cwHasPctSteps(w) {
  return (w.blocks || []).some(b => (b.exercises || []).some(e => e.load));
}
function loadCellText(cell, percent) {
  if (!cell) return '—';
  return `<strong>${cell.weight} lb</strong> <span class="muted">(${percent}% of ${cell.max} est. max)</span>`;
}
/* The coach load chart for one custom workout: one row per athlete,
   one column per %-prescribed exercise, each cell the athlete's
   own working weight with the max it came from. Fetched fresh from
   the server (the only place roster-wide loads exist); the group
   picker re-fetches for the picked group. */
async function renderCwLoadChart(workoutId, groupId) {
  const slot = document.getElementById('cw-chart-' + workoutId);
  if (!slot) return;
  if (!state.groups || !state.groups.length) await refreshProfiles();
  slot.innerHTML = '<p class="muted">Loading the load chart…</p>';
  let data;
  try {
    data = await api('/api/custom-workouts/' + encodeURIComponent(workoutId) + '/load-chart'
      + (groupId ? '?groupId=' + encodeURIComponent(groupId) : ''));
  } catch (err) {
    slot.innerHTML = '<p class="error">Could not load the load chart: ' + esc(err.message) + '</p>';
    return;
  }
  if (!data.columns.length) {
    slot.innerHTML = '<p class="muted">No % of max exercises in this workout yet — switch an exercise\'s Load to "% of max" in the editor and the chart fills in.</p>';
    return;
  }
  const groupOptions = ['<option value="">All roster</option>']
    .concat((state.groups || []).map(g =>
      `<option value="${esc(g.id)}" ${g.id === data.groupId ? 'selected' : ''}>${esc(g.name)}</option>`)).join('');
  const head = data.columns.map(c =>
    `<th>${esc(c.name)}<br><span class="muted">${c.percent}% of ${esc(c.testName)} · ${c.sets} × ${c.reps}</span></th>`).join('');
  const body = data.rows.map(row => `
    <tr><td><strong>${esc(row.name)}</strong>${row.groupName ? `<br><span class="muted">${esc(row.groupName)}</span>` : ''}</td>
    ${row.cells.map((cell, i) => `<td>${loadCellText(cell, data.columns[i].percent)}</td>`).join('')}</tr>`).join('');
  const needs = data.needsMax.length
    ? `<p class="cw-needs-max"><strong>Needs a max test:</strong> ${data.needsMax.map(n =>
        esc(n.name) + ' (' + n.lifts.map(esc).join(', ') + ')').join(' · ')}</p>`
    : '';
  slot.innerHTML = `
    <div class="filter-row">
      <label>Group <select class="cw-chart-group">${groupOptions}</select></label>
    </div>
    ${data.rows.length
      ? `<div class="cw-chart-scroll"><table class="cw-chart-table">
           <thead><tr><th>Athlete</th>${head}</tr></thead><tbody>${body}</tbody>
         </table></div>`
      : '<p class="muted">No athletes in this group yet.</p>'}
    ${needs}`;
  const sel = slot.querySelector('.cw-chart-group');
  if (sel) sel.addEventListener('change', () => renderCwLoadChart(workoutId, sel.value || null));
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
  /* The % of max editor names its lifts from the test battery;
     load it once if this session has not been to Testing yet. */
  if (!state.tests) {
    try { const t = await api('/api/tests'); state.tests = t.tests || []; } catch (_) { /* the editor falls back to the preloaded lifts */ }
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
      `<p class="cw-block-line"><strong>Block ${i + 1}</strong> — ${b.exercises.map(e => esc(e.name) + ' × ' + esc(e.reps) + (e.load ? ' @ ' + e.load.percent + '% of max' : '')).join(', ')} · ${b.rounds} rounds · rest ${b.restBetweenRounds}s between rounds, ${b.restAfterBlock}s after</p>`).join('');
    return `
    <div class="card cw-card">
      <div class="roster-row">
        <span><strong>${esc(w.title)}</strong></span>
        <span class="roster-actions">
          <button class="btn primary" data-cw-run="${w.id}" type="button">Run it</button>
          ${cwHasPctSteps(w) ? `<button class="btn secondary" data-cw-chart="${w.id}" type="button">Load chart</button>` : ''}
          <button class="btn secondary" data-cw-edit="${w.id}" type="button">Edit</button>
          <button class="btn danger" data-cw-del="${w.id}" type="button">Delete</button>
        </span>
      </div>
      <p class="muted">${w.blocks.length} blocks · ${exSteps} exercise steps in runner mode</p>
      ${summaries}
      <div class="cw-chart-slot" id="cw-chart-${w.id}"></div>
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
        <div class="cw-ex-row">
          <div class="filter-row">
            <label>Exercise <input type="text" class="cw-ex-name" value="${esc(e.name)}" placeholder="e.g. Hang Clean"></label>
            <label>Load <select class="cw-ex-mode">
              <option value="" ${e.load ? '' : 'selected'}>Reps (free text)</option>
              <option value="pct" ${e.load ? 'selected' : ''}>% of max</option>
            </select></label>
            <label class="cw-reps-wrap" ${e.load ? 'hidden' : ''}>Reps <input type="text" class="cw-ex-reps" value="${esc(e.reps)}" placeholder="3, max, 5 each…"></label>
            <button class="btn danger" data-cw-delex="${i}:${j}" type="button">Remove</button>
          </div>
          <div class="filter-row cw-load-fields" ${e.load ? '' : 'hidden'}>
            <label>Lift <select class="cw-ex-test">${cwLiftOptions(e.load ? e.load.testKey : 'back-squat')}</select></label>
            <label>% of max <input type="number" class="cw-ex-pct" min="30" max="110" step="any" value="${e.load ? e.load.percent : 80}"></label>
            <label>Sets <input type="number" class="cw-ex-sets" min="1" max="10" value="${e.load ? e.load.sets : 4}"></label>
            <label>Reps per set <input type="number" class="cw-ex-lreps" min="1" max="30" value="${e.load ? e.load.reps : 5}"></label>
          </div>
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
    if (w) openRunner({ title: w.title, blocks: w.blocks, workoutId: w.id });
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
  el.querySelectorAll('[data-cw-chart]').forEach(b => b.addEventListener('click', () => {
    const slot = document.getElementById('cw-chart-' + b.dataset.cwChart);
    if (slot && slot.innerHTML.trim()) { slot.innerHTML = ''; return; }
    renderCwLoadChart(b.dataset.cwChart, null);
  }));
  if (state.cwOpenChart) {
    const wid = state.cwOpenChart;
    state.cwOpenChart = null;
    if (workouts.some(w => w.id === wid)) renderCwLoadChart(wid, null);
  }
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
  /* Load mode per exercise row: free-text reps or a % of max
     prescription. Toggling swaps which fields show, in place —
     no re-render, so nothing typed is lost. */
  el.querySelectorAll('.cw-ex-mode').forEach(sel => sel.addEventListener('change', () => {
    const row = sel.closest('.cw-ex-row');
    if (!row) return;
    const pct = sel.value === 'pct';
    const repsWrap = row.querySelector('.cw-reps-wrap');
    const loadFields = row.querySelector('.cw-load-fields');
    if (repsWrap) repsWrap.hidden = pct;
    if (loadFields) loadFields.hidden = !pct;
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

/* ---------------- programs (coach) ----------------
   Reusable week-grid templates, plus the list of their applications
   onto the team calendar. Building a program changes nothing on any
   calendar; applying one writes the overrides (the server does that),
   and an application is removed from the same screen — days a coach
   hand-edited after the apply are kept, and the message says so. */
const PROG_DAY_LABELS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
function progBlankWeek() { return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }; }
function progSessionOptions() {
  const sessions = (state.content && state.content.sessions) || [];
  return '<option value="">+ add a session…</option>' + sessions.map(s =>
    `<option value="${esc(s.id)}">${esc(s.id)} · ${esc(s.name)}</option>`).join('');
}
/* Read the editor's name/note back into the draft before any
   re-render, so add/remove clicks never lose what was typed. */
function progScrapeForm() {
  if (!$('#prog-form') || !state.progDraft) return;
  const nameEl = $('#prog-name');
  const noteEl = $('#prog-note');
  if (nameEl) state.progDraft.name = nameEl.value;
  if (noteEl) state.progDraft.note = noteEl.value;
}
async function renderPrograms() {
  const el = $('#programs-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Training programs live here.'); return; }
  if ($('#prog-form')) progScrapeForm();
  await refreshProfiles();
  let programs, applications;
  try {
    const [p, a] = await Promise.all([api('/api/programs'), api('/api/program-applications')]);
    programs = p.programs || [];
    applications = a.applications || [];
  } catch (err) {
    el.innerHTML = '<p class="error">Could not load programs: ' + esc(err.message) + '</p>';
    return;
  }
  const editing = state.progEditId && state.progEditId !== 'new'
    ? programs.find(x => x.id === state.progEditId) : null;
  if (state.progEditId && state.progEditId !== 'new' && !editing) { state.progEditId = null; state.progDraft = null; }
  if (state.progEditId && !state.progDraft) {
    state.progDraft = editing
      ? JSON.parse(JSON.stringify({ name: editing.name, note: editing.note, weeks: editing.weeks }))
      : { name: '', note: '', weeks: [progBlankWeek()] };
  }
  const msgHtml = state.progMsg
    ? (state.progMsg.type === 'ok'
      ? `<p class="ok-note">${esc(state.progMsg.text)}</p>`
      : `<p class="error">${esc(state.progMsg.text)}</p>`)
    : '';
  const programCard = (pr) => {
    const codedDays = pr.weeks.reduce((n, w) =>
      n + PROG_DAY_LABELS.filter(([k]) => (w[k] || []).length).length, 0);
    const applyHtml = state.progApplyId === pr.id ? `
    <form class="prog-apply-form" data-prog-applyform="${pr.id}">
      <div class="filter-row">
        <label>Start date <input type="date" class="pa-date" value="${mondayStr()}" required></label>
        <label>Apply to <select class="pa-target">
          <option value="all">All groups</option>
          ${state.groups.map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('')}
        </select></label>
      </div>
      <p class="muted">Week 1 starts on the Monday of that week. Applying replaces those groups' assignments on the program's days with the program's sessions — as coach overrides, the same as picking the days by hand.</p>
      <button class="btn primary" type="submit">Apply program</button>
      <button class="btn secondary" data-prog-applycancel type="button">Cancel</button>
      <p class="error pa-err"></p>
    </form>` : '';
    return `
    <div class="card">
      <div class="roster-row">
        <span><strong>${esc(pr.name)}</strong></span>
        <span class="roster-actions">
          <button class="btn primary" data-prog-apply="${pr.id}" type="button">Apply</button>
          <button class="btn secondary" data-prog-edit="${pr.id}" type="button">Edit</button>
          <button class="btn secondary" data-prog-dup="${pr.id}" type="button">Duplicate</button>
          <button class="btn danger" data-prog-del="${pr.id}" type="button">Delete</button>
        </span>
      </div>
      <p class="muted">${pr.weeks.length} week${pr.weeks.length === 1 ? '' : 's'} · ${codedDays} training day${codedDays === 1 ? '' : 's'} a week</p>
      ${pr.note ? `<p>${esc(pr.note)}</p>` : ''}
      ${pr.weeks.map((w, i) => `<p class="muted"><strong>Week ${i + 1}:</strong> ${PROG_DAY_LABELS.map(([k, label]) =>
        (w[k] || []).length ? label + ' ' + (w[k]).join(' + ') : '').filter(Boolean).join(' · ') || 'no sessions'}</p>`).join('')}
      ${applyHtml}
    </div>`;
  };
  let formHtml = '';
  if (state.progEditId) {
    const d = state.progDraft;
    const weekHtml = (w, i) => `
      <div class="card">
        <div class="roster-row">
          <strong>Week ${i + 1}</strong>
          ${d.weeks.length > 1 ? `<button class="btn danger" data-prog-delweek="${i}" type="button">Remove week</button>` : ''}
        </div>
        ${PROG_DAY_LABELS.map(([k, label]) => `
        <div class="roster-row">
          <span><strong>${label}</strong> ${(w[k] || []).map((c, ci) =>
            `<span class="badge plain">${esc(c)}</span> <button class="btn danger" style="width:auto;padding:0 8px;min-height:28px" data-prog-delcode="${i}:${k}:${ci}" type="button" aria-label="Remove ${esc(c)}">×</button>`).join(' ')
            || '<span class="muted">rest</span>'}</span>
          <span style="min-width:210px"><select class="prog-add-day" data-prog-add="${i}:${k}">${progSessionOptions()}</select></span>
        </div>`).join('')}
      </div>`;
    formHtml = `
    <form class="card" id="prog-form">
      <h2>${state.progEditId === 'new' ? 'New program' : 'Edit program'}</h2>
      <label>Name <input type="text" id="prog-name" value="${esc(d.name)}" placeholder="e.g. November build — sprinters" required></label>
      <label>Note (optional) <input type="text" id="prog-note" value="${esc(d.note)}" placeholder="What this block is for"></label>
      ${d.weeks.map(weekHtml).join('')}
      ${d.weeks.length < 16 ? '<button class="btn secondary" id="prog-addweek" type="button">+ Add week</button>' : ''}
      <button class="btn primary" type="submit">${state.progEditId === 'new' ? 'Save program' : 'Save changes'}</button>
      <button class="btn secondary" id="prog-cancel" type="button">Cancel</button>
      <p class="error" id="prog-err"></p>
    </form>`;
  }
  el.innerHTML = `
    ${msgHtml}
    ${programs.length === 0
      ? '<div class="card"><h2>No programs yet</h2><p class="muted">Build the first one below: name it, lay sessions onto the days of each week, then apply it to a group whenever you are ready. A program on its own changes nothing — only applying it writes to the calendar.</p></div>'
      : programs.map(programCard).join('')}
    ${state.progEditId ? '' : '<button class="btn primary" id="prog-new" type="button">+ New program</button>'}
    ${formHtml}
    <div class="card">
      <h2>On the calendar now</h2>
      ${applications.length ? applications.map(a => `
      <div class="roster-row">
        <span><strong>${esc(a.programName)}</strong> → ${a.target === 'all' ? 'All groups' : esc(a.target)} · from Mon ${esc(a.startDate)} · ${a.daysWritten} day-write${a.daysWritten === 1 ? '' : 's'} across ${a.dates.length} date${a.dates.length === 1 ? '' : 's'}</span>
        <span class="roster-actions"><button class="btn danger" data-progapp-del="${a.id}" type="button">Remove</button></span>
      </div>`).join('')
        : '<p class="muted">Nothing applied right now. When you apply a program it shows up here, and removing it here takes exactly its days back off — days you changed by hand afterwards stay changed.</p>'}
    </div>`;
  const newBtn = $('#prog-new');
  if (newBtn) newBtn.addEventListener('click', () => {
    state.progEditId = 'new';
    state.progDraft = null;
    state.progMsg = null;
    renderPrograms();
  });
  el.querySelectorAll('[data-prog-edit]').forEach(b => b.addEventListener('click', () => {
    state.progEditId = b.dataset.progEdit;
    state.progDraft = null;
    state.progApplyId = null;
    state.progMsg = null;
    renderPrograms();
  }));
  el.querySelectorAll('[data-prog-dup]').forEach(b => b.addEventListener('click', async () => {
    const pr = programs.find(x => x.id === b.dataset.progDup);
    if (!pr) return;
    try {
      await apiPost('/api/programs', { name: pr.name + ' (copy)', note: pr.note, weeks: pr.weeks });
      state.progMsg = { type: 'ok', text: 'Duplicated "' + pr.name + '" — the copy is in the list, ready to edit.' };
    } catch (err) { state.progMsg = { type: 'err', text: err.message }; }
    renderPrograms();
  }));
  el.querySelectorAll('[data-prog-del]').forEach(b => b.addEventListener('click', async () => {
    const pr = programs.find(x => x.id === b.dataset.progDel);
    if (!confirm('Delete the program "' + (pr ? pr.name : '') + '"? Applications already on the calendar stay — remove those separately below.')) return;
    try {
      await apiDel('/api/programs/' + encodeURIComponent(b.dataset.progDel));
      if (state.progEditId === b.dataset.progDel) { state.progEditId = null; state.progDraft = null; }
      state.progMsg = { type: 'ok', text: 'Program deleted. Anything it had applied stays on the calendar until you remove the application.' };
    } catch (err) { state.progMsg = { type: 'err', text: err.message }; }
    renderPrograms();
  }));
  el.querySelectorAll('[data-prog-apply]').forEach(b => b.addEventListener('click', () => {
    state.progApplyId = state.progApplyId === b.dataset.progApply ? null : b.dataset.progApply;
    state.progMsg = null;
    renderPrograms();
  }));
  el.querySelectorAll('[data-prog-applycancel]').forEach(b => b.addEventListener('click', () => {
    state.progApplyId = null;
    renderPrograms();
  }));
  el.querySelectorAll('.prog-apply-form').forEach(f => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = f.dataset.progApplyform;
    const body = {
      startDate: f.querySelector('.pa-date').value,
      target: f.querySelector('.pa-target').value,
    };
    try {
      const r = await apiPost('/api/programs/' + encodeURIComponent(pid) + '/apply', body);
      state.progApplyId = null;
      state.progMsg = {
        type: 'ok',
        text: 'Applied — ' + r.applied + ' day' + (r.applied === 1 ? '' : 's') + ' written, starting Monday ' + r.startDate
          + (r.normalized ? ' (your date ' + r.requestedStart + ' sits in that week)' : '') + '. See it on the Calendar.',
      };
    } catch (err) {
      const errEl = f.querySelector('.pa-err');
      if (errEl) errEl.textContent = err.message;
      return;
    }
    renderPrograms();
  }));
  el.querySelectorAll('[data-progapp-del]').forEach(b => b.addEventListener('click', async () => {
    const a = applications.find(x => x.id === b.dataset.progappDel);
    if (!confirm('Remove "' + (a ? a.programName : 'this application') + '" from the calendar? Its days fall back to the plan — except any day you changed by hand after applying, which stays.')) return;
    try {
      const r = await apiDel('/api/program-applications/' + encodeURIComponent(b.dataset.progappDel));
      state.progMsg = {
        type: 'ok',
        text: 'Application removed — ' + r.removed + ' day' + (r.removed === 1 ? '' : 's') + ' taken back off the calendar'
          + (r.kept ? '; ' + r.kept + ' day' + (r.kept === 1 ? '' : 's') + ' you had changed since were left as you set them' : '') + '.',
      };
    } catch (err) { state.progMsg = { type: 'err', text: err.message }; }
    renderPrograms();
  }));
  if (!state.progEditId) return;
  const cancel = $('#prog-cancel');
  if (cancel) cancel.addEventListener('click', () => {
    state.progEditId = null; state.progDraft = null; state.progMsg = null; renderPrograms();
  });
  const addWeek = $('#prog-addweek');
  if (addWeek) addWeek.addEventListener('click', () => {
    progScrapeForm();
    state.progDraft.weeks.push(progBlankWeek());
    renderPrograms();
  });
  el.querySelectorAll('[data-prog-delweek]').forEach(b => b.addEventListener('click', () => {
    progScrapeForm();
    state.progDraft.weeks.splice(parseInt(b.dataset.progDelweek, 10), 1);
    renderPrograms();
  }));
  el.querySelectorAll('[data-prog-delcode]').forEach(b => b.addEventListener('click', () => {
    progScrapeForm();
    const [wi, k, ci] = b.dataset.progDelcode.split(':');
    state.progDraft.weeks[parseInt(wi, 10)][k].splice(parseInt(ci, 10), 1);
    renderPrograms();
  }));
  el.querySelectorAll('.prog-add-day').forEach(sel => sel.addEventListener('change', () => {
    if (!sel.value) return;
    progScrapeForm();
    const [wi, k] = sel.dataset.progAdd.split(':');
    const day = state.progDraft.weeks[parseInt(wi, 10)][k];
    if (!day.includes(sel.value)) day.push(sel.value);
    renderPrograms();
  }));
  $('#prog-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    progScrapeForm();
    const d = state.progDraft;
    try {
      if (state.progEditId === 'new') await apiPost('/api/programs', d);
      else await apiPut('/api/programs/' + encodeURIComponent(state.progEditId), d);
      state.progMsg = { type: 'ok', text: 'Program "' + d.name + '" saved. Apply it whenever you are ready — saving alone changes no calendar.' };
      state.progEditId = null;
      state.progDraft = null;
    } catch (err) { $('#prog-err').textContent = err.message; return; }
    renderPrograms();
  });
}

/* ---------------- team calendar (coach) ----------------
   A month of the whole team at a glance, resolved on the server
   (GET /api/calendar) through the same resolveAssignment the rest of
   the app uses — the grid never invents its own answer. Clicking a
   day opens its detail: per group, the resolved sessions, where each
   came from, and the way into the session or the runner. */
async function renderCalendar() {
  const el = $('#calendar-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'The team calendar lives here.'); return; }
  if (!state.calMonth) state.calMonth = todayStr().slice(0, 7);
  try {
    state.calData = await api('/api/calendar?month=' + encodeURIComponent(state.calMonth));
  } catch (err) {
    el.innerHTML = '<p class="error">Could not load the calendar: ' + esc(err.message) + '</p>';
    return;
  }
  if (!state.calDay || !state.calData.days.some(d => d.date === state.calDay)) {
    const t = state.calData.days.find(d => d.today);
    state.calDay = t ? t.date : state.calData.start;
  }
  paintCalendar();
}
function calDayLines(day) {
  const withCodes = day.groups.filter(g => g.codes.length);
  if (!withCodes.length) return day.isOff ? ['<span class="muted">Off</span>'] : [];
  const byCodes = new Map();
  for (const g of withCodes) {
    const key = g.codes.map(c => c.id).join('+');
    if (!byCodes.has(key)) byCodes.set(key, { codes: g.codes.map(c => c.id), names: [] });
    byCodes.get(key).names.push(g.group.name);
  }
  const entries = [...byCodes.values()];
  if (entries.length === 1) return [entries[0].codes.join(' + ')];
  const lines = entries.slice(0, 2).map(e => esc(e.names[0]) + ': ' + e.codes.join(' + '));
  const covered = entries.slice(0, 2).reduce((n, e) => n + e.names.length, 0);
  const rest = withCodes.length - covered;
  if (rest > 0) lines.push('+' + rest + ' group' + (rest === 1 ? '' : 's'));
  return lines;
}
function paintCalendar() {
  const el = $('#calendar-main');
  const data = state.calData;
  if (!el || !data) return;
  const monthName = parseDate(data.start).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstDow = (parseDate(data.start).getDay() + 6) % 7; /* Mon = 0 */
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (const d of data.days) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  const cellHtml = (day) => {
    if (!day) return '<td></td>';
    const markers = (day.isMeet ? ' <span class="badge high">MEET</span>' : '')
      + (day.isTest ? ' <span class="badge plain">TEST</span>' : '');
    const lines = calDayLines(day).map(l => `<div>${l}</div>`).join('');
    return `<td data-cal-day="${day.date}" style="white-space:normal;vertical-align:top;cursor:pointer;min-width:86px${day.date === state.calDay ? ';background:#fdf0f3' : ''}">
      <div><strong>${parseInt(day.date.slice(8), 10)}</strong>${day.today ? ' <span class="badge plain">Today</span>' : ''}${markers}</div>
      ${lines || '<div class="muted">—</div>'}
    </td>`;
  };
  const day = data.days.find(d => d.date === state.calDay);
  let detailHtml = '';
  if (day) {
    detailHtml = `
    <div class="card">
      <h2>${fmtDate(parseDate(day.date))}${day.today ? ' · Today' : ''}</h2>
      <p class="muted">Season week ${day.week == null ? '—' : day.week}${day.phase ? ' · ' + esc(day.phase) : ''}${day.planText ? ' · Plan: ' + esc(day.planText) : ''}</p>
      ${day.isMeet ? '<p><span class="badge high">MEET</span></p>' : ''}${day.isTest ? '<p><span class="badge plain">TEST DAY</span></p>' : ''}
      ${day.groups.length ? day.groups.map(g => `
      <h3>${esc(g.group.name)}</h3>
      <p>${g.source === 'override' ? '<span class="badge plain">YOUR PICK</span>' : '<span class="badge plain">FROM THE PLAN</span>'}
      ${g.note ? ' <span class="muted">' + esc(g.note) + '</span>' : ''}</p>
      ${g.codes.length ? g.codes.map(c => `
      <div class="roster-row">
        <span><span class="code-link">${esc(c.id)}</span> · ${esc(c.name)}</span>
        <span class="roster-actions">
          <button class="btn secondary" data-session="${esc(c.id)}" type="button" style="width:auto;padding:2px 10px">Open</button>
          <button class="btn primary" data-cal-run="${esc(c.id)}" type="button" style="width:auto;padding:2px 10px">Run it</button>
        </span>
      </div>`).join('') : '<p class="muted">No session this day.</p>'}`).join('')
      : '<p class="muted">No groups yet — the calendar fills in once the roster has groups.</p>'}
    </div>`;
  }
  el.innerHTML = `
    <div class="card digest-head">
      <div class="digest-nav">
        <button type="button" class="btn" id="cal-prev">← Prev</button>
        <h2>${esc(monthName)}</h2>
        <button type="button" class="btn" id="cal-next">Next →</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap"><table class="matrix" style="table-layout:fixed">
        <thead><tr>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<th style="text-align:left">${d}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => '<tr>' + r.map(cellHtml).join('') + '</tr>').join('')}</tbody>
      </table></div>
      <p class="muted">Every group's resolved sessions — plan, your picks, and applied programs alike. Tap a day for the full detail.</p>
    </div>
    ${detailHtml}`;
  const stepMonth = (delta) => {
    const d = parseDate(data.month + '-01');
    d.setMonth(d.getMonth() + delta);
    state.calMonth = dateStrOf(d).slice(0, 7);
    state.calDay = null;
    renderCalendar();
  };
  const pv = $('#cal-prev');
  if (pv) pv.addEventListener('click', () => stepMonth(-1));
  const nx = $('#cal-next');
  if (nx) nx.addEventListener('click', () => stepMonth(1));
  el.querySelectorAll('[data-cal-day]').forEach(td => td.addEventListener('click', () => {
    state.calDay = td.dataset.calDay;
    paintCalendar();
  }));
  el.querySelectorAll('[data-cal-run]').forEach(b => b.addEventListener('click', () => {
    const s = state.sessions.get(b.dataset.calRun);
    if (s) openRunner(sessionToRunnerPlan(s));
  }));
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
$('#ex-search').addEventListener('input', (e) => { state.exQuery = e.target.value; renderExercises(); });
$('#ex-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-excat]');
  if (!chip) return;
  state.exCategory = chip.dataset.excat;
  renderExercises();
});
$('#ex-eq-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-exequip]');
  if (!chip) return;
  state.exEquipment = chip.dataset.exequip;
  renderExercises();
});
$('#ex-tag-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-extag]');
  if (!chip) return;
  const t = chip.dataset.extag;
  state.exTags = state.exTags.includes(t)
    ? state.exTags.filter(x => x !== t)
    : state.exTags.concat([t]);
  renderExercises();
});
$('#ex-clear').addEventListener('click', clearExerciseFilters);
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
  const hasContent = ['#log-session', '#log-group', '#log-happened', '#log-marks', '#log-notes']
    .some(sel => { const f = $(sel); return f && f.value.trim(); });
  if (!hasContent) {
    msg.textContent = 'Add something first — a workout, what happened, or a note.';
    msg.classList.add('error');
    return;
  }
  msg.classList.remove('error');
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
    msg.classList.remove('error');
    msg.textContent = 'Saved.';
    e.target.reset();
    $('#log-date').value = todayStr();
    renderLog(); renderHome();
  } catch (err) { msg.classList.add('error'); msg.textContent = err.message; }
});
$('#log-form').addEventListener('input', () => { const m = $('#log-form-msg'); if (m) m.textContent = ''; });

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
  let trend, comp, load, health, assessment;
  try {
    [trend, comp, load, health, assessment] = await Promise.all([
      api('/api/reports/team-trend'), api('/api/reports/completions'),
      api('/api/reports/load'), api('/api/reports/health'),
      api('/api/reports/assessment'),
    ]);
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  if (state.reportTrendGroup !== 'all' && !comp.groups.some(g => g.group.id === state.reportTrendGroup)) {
    state.reportTrendGroup = 'all';
  }
  let compTrend = null, compTrendErr = '';
  try {
    compTrend = await api('/api/reports/completion-trend?weeks=' + state.reportTrendWeeks
      + (state.reportTrendGroup !== 'all'
        ? '&groupId=' + encodeURIComponent(state.reportTrendGroup) : ''));
  } catch (err) { compTrendErr = err.message; }
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
        { name: trendTest.name, unit: trendTest.unit, better: trendTest.better || 'higher' })
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
  /* Completion trend: the by-group math above, aggregated into a
     percentage per week over the last N weeks. */
  let trendWeeksHtml;
  if (compTrendErr) {
    trendWeeksHtml = `<p class="error">${esc(compTrendErr)}</p>`;
  } else if (!compTrend || !compTrend.weeks.length) {
    trendWeeksHtml = '<p class="muted">No season weeks in this window yet.</p>';
  } else {
    trendWeeksHtml = barChart(
      compTrend.weeks.map(w => ({ label: 'W' + w.week })),
      [{ name: 'Completion %', cls: 'bar-a', values: compTrend.weeks.map(w => w.percent || 0) }], false)
      + `<div class="table-wrap"><table class="ranked"><thead><tr><th>Week</th><th>Completion</th><th>Assigned days</th><th>Days covered</th></tr></thead><tbody>${compTrend.weeks.map(w => `<tr><td>W${w.week} · ${esc(w.monday)}</td><td>${w.percent === null ? '—' : `<strong>${w.percent}%</strong> — ${w.completions} of ${w.possible}`}</td><td>${w.assigned}</td><td>${w.completedDays}</td></tr>`).join('')}</tbody></table></div>`
      + '<p class="muted">The denominator is assigned session days × athletes in scope — the report card\'s per-athlete math, summed. Future weeks in the window show the plan only.</p>';
  }
  /* Period comparison: defaults split the season at its midpoint —
     first half vs second half through today — all editable. */
  const dstr = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (load.weeks.length) {
    const midWeek = load.weeks[Math.floor(load.weeks.length / 2)];
    if (!state.reportCmpAFrom) state.reportCmpAFrom = load.weeks[0].start;
    if (!state.reportCmpATo) { const d = parseDate(midWeek.start); d.setDate(d.getDate() - 1); state.reportCmpATo = dstr(d); }
    if (!state.reportCmpBFrom) state.reportCmpBFrom = midWeek.start;
    if (!state.reportCmpBTo) state.reportCmpBTo = dstr(new Date());
  }
  if (!state.reportCmpTest || !trend.tests.some(t => t.testKey === state.reportCmpTest)) {
    state.reportCmpTest = ((testsWithData[0] || trend.tests[0] || {}).testKey) || null;
  }
  let cmpHtml;
  if (!trend.tests.length) {
    cmpHtml = '<p class="muted">No tests in the battery yet.</p>';
  } else if (!state.reportCmpTest) {
    cmpHtml = '<p class="muted">Pick a test to compare two periods.</p>';
  } else {
    let cmp = null, cmpErr = '';
    try {
      cmp = await api('/api/reports/compare?testKey=' + encodeURIComponent(state.reportCmpTest)
        + (state.reportCmpAFrom ? '&aFrom=' + state.reportCmpAFrom : '')
        + (state.reportCmpATo ? '&aTo=' + state.reportCmpATo : '')
        + (state.reportCmpBFrom ? '&bFrom=' + state.reportCmpBFrom : '')
        + (state.reportCmpBTo ? '&bTo=' + state.reportCmpBTo : ''));
    } catch (err) { cmpErr = err.message; }
    if (cmpErr) {
      cmpHtml = `<p class="error">${esc(cmpErr)}</p>`;
    } else {
      const u = cmp.test.unit;
      const mark = (v) => v === null ? '—' : `<strong>${fmtNum(v)} ${esc(u)}</strong>`;
      const change = (row) => {
        if (row.delta === null) return '—';
        if (row.delta === 0) return 'No change';
        return `${row.delta > 0 ? '+' : ''}${fmtNum(row.delta)} ${esc(u)} — ${row.improved ? 'improved' : 'declined'}`;
      };
      const s = cmp.summary;
      cmpHtml = `<div class="table-wrap"><table class="ranked"><thead><tr><th>Athlete</th><th>Group</th><th>Best — period A</th><th>Best — period B</th><th>Change</th></tr></thead><tbody>${cmp.rows.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.groupName || '—')}</td><td>${mark(row.bestA)}</td><td>${mark(row.bestB)}</td><td>${change(row)}</td></tr>`).join('')}</tbody></table></div>`
        + `<p class="muted">Period A average: <strong>${s.avgA === null ? '—' : fmtNum(s.avgA) + ' ' + esc(u)}</strong> (${s.athletesWithA} athlete${s.athletesWithA === 1 ? '' : 's'}) · Period B average: <strong>${s.avgB === null ? '—' : fmtNum(s.avgB) + ' ' + esc(u)}</strong> (${s.athletesWithB} athlete${s.athletesWithB === 1 ? '' : 's'}) · <strong>${s.improved}</strong> improved, <strong>${s.declined}</strong> declined, <strong>${s.unchanged}</strong> unchanged.</p>`;
    }
  }
  /* Team assessment by quality: best marks matrix + average row. */
  const assessmentHtml = !assessment.qualities.length
    ? '<p class="muted">No tests are tagged to a quality yet.</p>'
    : assessment.qualities.map(q => `
      <h3>${esc(q.label)}</h3>
      <div class="table-wrap"><table class="ranked"><thead><tr><th>Athlete</th>${q.tests.map(t => `<th>${esc(t.name)} (${esc(t.unit)})</th>`).join('')}</tr></thead><tbody>${q.rows.map(row => `<tr><td>${esc(row.name)}${row.groupName ? ` <span class="muted">· ${esc(row.groupName)}</span>` : ''}</td>${q.tests.map(t => `<td>${row.marks[t.key] === null ? '—' : `<strong>${fmtNum(row.marks[t.key])}</strong>`}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td><strong>Team average</strong></td>${q.tests.map(t => `<td>${q.averages[t.key] === null ? '—' : `<strong>${fmtNum(q.averages[t.key])}</strong> <span class="muted">(n=${q.counts[t.key]})</span>`}</td>`).join('')}</tr></tfoot></table></div>`).join('');
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
      : '<p class="muted">No aches &amp; pains recorded yet.</p>')
    + checkinReportHtml(health.checkins);
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
      <h2>Completion trend</h2>
      <p class="muted">Completion percentage week by week — the share of assigned athlete-sessions the coach marked complete, from the same weekly counts as the chart above.</p>
      <label>Last <select id="report-trend-weeks">${[4, 8, 12].map(n => `<option value="${n}" ${state.reportTrendWeeks === n ? 'selected' : ''}>${n} weeks</option>`).join('')}</select></label>
      <label>Scope <select id="report-trend-group"><option value="all" ${state.reportTrendGroup === 'all' ? 'selected' : ''}>Whole team</option>${comp.groups.map(g => `<option value="${g.group.id}" ${state.reportTrendGroup === g.group.id ? 'selected' : ''}>${esc(g.group.name)}</option>`).join('')}</select></label>
      <div id="report-trend-weeks-zone">${trendWeeksHtml}</div>
    </div>
    <div class="card">
      <h2>Period comparison</h2>
      <p class="muted">One test, two date ranges: every athlete's best mark in each period and the change, judged by the test's own direction (lower is better for timed tests).</p>
      <label>Test <select id="report-cmp-test">${trend.tests.map(t => `<option value="${t.testKey}" ${state.reportCmpTest === t.testKey ? 'selected' : ''}>${esc(t.name)}${t.points.length ? '' : ' (no results yet)'}</option>`).join('')}</select></label>
      <label>Period A from <input type="date" id="report-cmp-afrom" value="${esc(state.reportCmpAFrom || '')}"></label>
      <label>to <input type="date" id="report-cmp-ato" value="${esc(state.reportCmpATo || '')}"></label>
      <label>Period B from <input type="date" id="report-cmp-bfrom" value="${esc(state.reportCmpBFrom || '')}"></label>
      <label>to <input type="date" id="report-cmp-bto" value="${esc(state.reportCmpBTo || '')}"></label>
      <div id="report-cmp">${cmpHtml}</div>
    </div>
    <div class="card">
      <h2>Team assessment by quality</h2>
      <p class="muted">Best marks grouped by what they measure — speed (timed tests), power (jumps), strength (lifts) — with the team average under each test. A test with no results yet still shows, so the gaps are visible.</p>
      <div id="report-assessment">${assessmentHtml}</div>
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
  const rtw = $('#report-trend-weeks');
  if (rtw) rtw.addEventListener('change', () => { state.reportTrendWeeks = parseInt(rtw.value, 10) || 8; renderReports(); });
  const rtg = $('#report-trend-group');
  if (rtg) rtg.addEventListener('change', () => { state.reportTrendGroup = rtg.value; renderReports(); });
  const rct = $('#report-cmp-test');
  if (rct) rct.addEventListener('change', () => { state.reportCmpTest = rct.value; renderReports(); });
  const bindCmpDate = (id, key) => {
    const inp = $(id);
    if (inp) inp.addEventListener('change', () => { state[key] = inp.value || null; renderReports(); });
  };
  bindCmpDate('#report-cmp-afrom', 'reportCmpAFrom');
  bindCmpDate('#report-cmp-ato', 'reportCmpATo');
  bindCmpDate('#report-cmp-bfrom', 'reportCmpBFrom');
  bindCmpDate('#report-cmp-bto', 'reportCmpBTo');
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
    || data.completions.total || data.health.total || (data.goals && data.goals.length));
  const compLine = data.completions.percent !== null
    ? `<strong>${data.completions.count}</strong> of <strong>${data.completions.denominator}</strong> assigned session days completed (<strong>${data.completions.percent}%</strong>) since they joined the roster`
    : `<strong>${data.completions.total}</strong> sessions marked complete — no assigned-day window to compare against yet`;
  const testingRows = data.testing.map(t => `<tr><td>${esc(t.name)}</td><td><strong>${fmtNum(t.best)} ${esc(t.unit)}</strong></td><td>${fmtNum(t.latest)} ${esc(t.unit)}</td><td>${esc(t.latestDate || '')}</td></tr>`).join('');
  const testingCharts = data.testing.filter(t => t.series.length >= 2).map(t =>
    `<h4>${esc(t.name)} — progression</h4>` + lineChart(
      [{ label: t.name, points: t.series.map(r => ({ week: r.date, value: r.display })) }],
      { name: t.name, unit: t.unit, better: t.better || 'higher' }, true)).join('');
  const weeklyRows = data.weekly.map(w => `<tr><td>${esc(w.metric.name)}</td><td>${w.best !== null && w.best !== undefined ? fmtNum(w.best) + ' ' + esc(w.metric.unit) : '—'}</td><td>${fmtNum(w.latest)} ${esc(w.metric.unit)}</td><td>${deltaHtml(w.metric, w)}</td></tr>`).join('');
  const meetRows = data.meetPrs.map(m => `<tr><td>${esc(m.name)}</td><td><strong>${esc(m.mark)}</strong></td><td>${esc(m.date)}</td><td>${esc(m.meet)}</td></tr>`).join('');
  const goalRows = (data.goals || []).map(g => `<tr><td>${esc(g.eventName)}</td><td><strong>${esc(g.targetText)}</strong></td><td>${g.current ? esc(g.current.mark) : '—'}</td><td>${g.progressPct === null ? 'No marks yet' : g.progressPct + '%' + (g.achieved ? ' ★ Goal hit' : '')}</td><td>${esc(goalGapText(g) || '')}</td></tr>`).join('');
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
      ${data.goals && data.goals.length ? `<h4>Goals</h4>
      <div class="table-wrap"><table class="ranked"><thead><tr><th>Event</th><th>Target</th><th>Current PR</th><th>Progress</th><th>Gap</th></tr></thead><tbody>${goalRows}</tbody></table></div>` : ''}
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

/* ---------------- weekly digest (coach) ----------------
   One week of the program on a single screen, read from
   GET /api/digest. state.digestWeek is the Monday being viewed;
   null lets the server pick its default (the most recent completed
   week). Prev/next step seven days from the week on screen. */
const digestDayLabel = (ds) => parseDate(ds).toLocaleDateString(undefined, { weekday: 'short' });
const digestRangeLabel = (a, b) => fmtDate(parseDate(a)) + ' – ' + fmtDate(parseDate(b));
async function renderDigest() {
  const el = $('#digest-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'The weekly digest lives here.'); return; }
  let data;
  try {
    data = await api('/api/digest' + (state.digestWeek ? '?week=' + encodeURIComponent(state.digestWeek) : ''));
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  state.digestWeek = data.week;
  if (!state.digestLatest) state.digestLatest = data.week;
  const ci = data.checkins;
  const ciHtml = ci.recorded
    ? `<div class="hero-stats">
        <div class="hero-stat"><div class="stat-num">${ci.recorded}/${ci.possible}</div><div class="stat-label">Check-ins (${ci.percent}%)</div></div>
        <div class="hero-stat"><div class="stat-num">${ci.avgSleep}h</div><div class="stat-label">Avg sleep</div></div>
        <div class="hero-stat"><div class="stat-num">${ci.avgSoreness}</div><div class="stat-label">Avg soreness</div></div>
        <div class="hero-stat"><div class="stat-num">${ci.avgEnergy}</div><div class="stat-label">Avg energy</div></div>
      </div>`
      + (ci.flagged.length
        ? `<p><strong>${ci.flaggedCount} athlete${ci.flaggedCount === 1 ? '' : 's'} flagged</strong> — most flagged:</p><ul class="digest-list">${ci.flagged.map(f =>
          `<li><strong>${esc(f.name)}</strong> — flagged ${f.flaggedDays} day${f.flaggedDays === 1 ? '' : 's'}, mostly ${esc(CHECKIN_FLAG_LABELS[f.mainFlag] || f.mainFlag)}</li>`).join('')}</ul>`
        : '<p class="muted">Nobody flagged all week — sleep, soreness, and energy stayed in range.</p>')
    : '<p class="muted">No check-ins recorded that week.</p>';
  const trHtml = data.training.groups.length
    ? `<div class="table-wrap"><table class="ranked"><thead><tr><th>Group</th><th>Days done</th><th>Assigned days</th><th>Completions</th></tr></thead><tbody>${data.training.groups.map(g =>
      `<tr><td>${esc(g.group.name)}</td><td><strong>${g.completedDays}</strong></td><td>${g.assigned}</td><td>${g.completions}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No groups yet — completions by group appear here once the roster has groups.</p>';
  const perf = data.performance;
  const prHtml = perf.meetResults.prs.length
    ? `<ul class="digest-list">${perf.meetResults.prs.map(pr =>
      `<li><strong>${esc(pr.athleteName)}</strong> — ${esc(pr.eventName)}: <strong>${esc(pr.mark)}</strong> (${esc(pr.meet)}, ${esc(pr.date)})${pr.recordBoard ? ` <span class="digest-badge">Top 10 all-time — would rank #${pr.recordRank}</span>` : ''}</li>`).join('')}</ul>`
    : '';
  const testHtml = perf.testing.total
    ? `<p>${perf.testing.byTest.map(t => `<strong>${t.count}</strong> × ${esc(t.name)}`).join(' · ')} entered this week.</p>`
    : '';
  const goalsHtml = (perf.goalsAchieved && perf.goalsAchieved.length)
    ? `<p><strong>Goals hit this week:</strong></p><ul class="digest-list">${perf.goalsAchieved.map(g =>
      `<li><strong>${esc(g.athleteName)}</strong> — ${esc(g.eventName)} goal of ${esc(g.target)} reached with <strong>${esc(g.mark)}</strong> (${esc(g.meet)}, ${esc(g.date)})</li>`).join('')}</ul>`
    : '';
  const perfHtml = (perf.meetResults.count || perf.testing.total || goalsHtml)
    ? `<p class="muted">${perf.meetResults.count} meet result${perf.meetResults.count === 1 ? '' : 's'} recorded this week${perf.meetResults.prs.length ? `, ${perf.meetResults.prs.length} standing as PRs` : ''}.</p>${prHtml}${testHtml}${goalsHtml}`
    : '<p class="muted">No meet results or testing entered that week.</p>';
  const h = data.health;
  const healthHtml = `<div class="hero-stats">
      <div class="hero-stat"><div class="stat-num">${h.opened}</div><div class="stat-label">Opened this week</div></div>
      <div class="hero-stat"><div class="stat-num">${h.cleared}</div><div class="stat-label">Cleared this week</div></div>
      <div class="hero-stat"><div class="stat-num">${h.open}</div><div class="stat-label">Open now</div></div>
      <div class="hero-stat"><div class="stat-num">${h.monitoring}</div><div class="stat-label">Monitoring now</div></div>
    </div>`
    + (!h.opened && !h.cleared && !h.open && !h.monitoring
      ? '<p class="muted">No aches &amp; pains on the books — nothing opened, nothing outstanding.</p>' : '');
  const wa = data.weekAhead;
  const waHtml = `<p><strong>Season week ${wa.seasonWeek}${wa.phase ? ' · ' + esc(wa.phase) : ''}</strong> — ${wa.trainingDays} training day${wa.trainingDays === 1 ? '' : 's'}, ${wa.highDays} high-CNS.</p>`
    + `<div class="table-wrap"><table class="ranked"><thead><tr><th>Day</th><th>Sessions</th><th></th></tr></thead><tbody>${wa.days.map(d =>
      `<tr><td>${digestDayLabel(d.date)} ${esc(d.date.slice(5))}</td><td>${d.isOff ? '<span class="muted">Off</span>' : d.codes.map(esc).join(' + ')}</td><td>${d.isMeet ? 'Meet' : d.isTest ? 'Test day' : d.isHigh ? 'High' : d.isOff ? '' : 'Low'}</td></tr>`).join('')}</tbody></table></div>`;
  el.innerHTML = `
    <div class="card digest-head">
      <div class="digest-nav">
        <button type="button" class="btn" id="digest-prev">← Prev week</button>
        <h2>Week of ${digestRangeLabel(data.week, data.weekEnd)}</h2>
        <button type="button" class="btn" id="digest-next" ${state.digestLatest && data.week >= state.digestLatest ? 'disabled' : ''}>Next week →</button>
        ${state.digestLatest && data.week < state.digestLatest ? '<button type="button" class="btn secondary" id="digest-latest">Latest week</button>' : ''}
      </div>
    </div>
    <div class="card">
      <h2>Check-ins</h2>
      <p class="muted">Daily sleep, soreness, and energy from the athletes — ${ci.roster} on the roster.</p>
      ${ciHtml}
    </div>
    <div class="card">
      <h2>Training</h2>
      <p class="muted">Assigned session days vs the days each group got work marked complete.</p>
      ${trHtml}
    </div>
    <div class="card">
      <h2>Performance</h2>
      ${perfHtml}
    </div>
    <div class="card">
      <h2>Health</h2>
      ${healthHtml}
    </div>
    <div class="card">
      <h2>The week coming — ${digestRangeLabel(wa.week, wa.weekEnd)}</h2>
      ${waHtml}
    </div>`;
  const stepWeek = (delta) => {
    const d = parseDate(data.week);
    d.setDate(d.getDate() + delta);
    const next = dateStrOf(d);
    if (state.digestLatest && next > state.digestLatest) return;
    state.digestWeek = next;
    renderDigest();
  };
  const pv = $('#digest-prev');
  if (pv) pv.addEventListener('click', () => stepWeek(-7));
  const nx = $('#digest-next');
  if (nx) nx.addEventListener('click', () => stepWeek(7));
  const lt = $('#digest-latest');
  if (lt) lt.addEventListener('click', () => { state.digestWeek = null; renderDigest(); });
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
        <label>Meet <input type="text" id="mf-meet" placeholder="e.g. Spring Invitational" value="${edit ? esc(edit.meet) : ''}" required></label>
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
   MEET DAY — one screen to run a meet: entries grouped by event,
   a checklist the server computes from the data itself, and quick
   results that write through the meet-results path and come back
   with PR flags. Editing a mark later happens in Meet Results.
   ================================================================ */
async function renderMeetDay() {
  const el = $('#meetday-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Meet day lives here.'); return; }
  await refreshProfiles();
  let meets, events;
  try {
    const [ms, ev] = await Promise.all([api('/api/meets'), api('/api/meet-events')]);
    meets = ms.meets; events = ev.events;
    state.meetEvents = events;
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  if (state.meetDayId && !meets.some(m => m.id === state.meetDayId)) {
    state.meetDayId = null; state.meetDayFlags = null;
  }
  if (!state.meetDayId && meets.length) state.meetDayId = meets[0].id;
  let detail = null;
  if (state.meetDayId) {
    try { detail = await api('/api/meets/' + encodeURIComponent(state.meetDayId)); }
    catch (err) { state.meetDayId = null; detail = null; }
  }
  const markHint = (type) => type === 'time'
    ? 'Time: seconds (10.87) or minutes:seconds (1:55.20).'
    : 'Mark: feet-inches (21-06.5), 21\'6.5, a plain number in feet, or meters with an m (6.45m).';
  let html = `
    <form class="card" id="md-create-form">
      <h2>New meet</h2>
      <div class="filter-row">
        <label>Meet name <input type="text" id="md-name" placeholder="e.g. Spring Invitational" required></label>
        <label>Date <input type="date" id="md-date" value="${todayStr()}" required></label>
        <label>Location <input type="text" id="md-location" placeholder="optional"></label>
      </div>
      <button class="btn primary" type="submit">Create meet</button>
      <p class="error" id="md-create-err"></p>
    </form>
    <div class="card">
      <h2>Meets</h2>
      ${meets.length ? `<div class="table-wrap"><table class="ranked">
        <thead><tr><th>Meet</th><th>Date</th><th>Location</th><th>Entries</th><th>Results</th><th>PRs</th><th></th></tr></thead>
        <tbody>${meets.map(m => `<tr${m.id === state.meetDayId ? ' class="selected"' : ''}><td><strong>${esc(m.name)}</strong></td><td>${esc(m.date)}</td><td>${esc(m.location || '')}</td><td data-meet-count="entries:${m.id}">${m.summary.entries}</td><td data-meet-count="results:${m.id}">${m.summary.resultsEntered}</td><td data-meet-count="prs:${m.id}">${m.summary.prs}</td>
          <td><button class="btn secondary" data-md-open="${m.id}" type="button" style="width:auto;padding:2px 10px">Open</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">No meets yet — create the first one above.</p>'}
    </div>`;
  if (detail) {
    const m = detail.meet;
    const c = detail.checklist;
    const s = detail.summary;
    const enteredEvents = events.filter(ev => detail.entries.some(e => e.event === ev.key));
    const qrEvent = enteredEvents.some(ev => ev.key === state.meetDayEvent)
      ? state.meetDayEvent : (enteredEvents.length ? enteredEvents[0].key : null);
    const qrEv = qrEvent ? events.find(ev => ev.key === qrEvent) : null;
    const resultFor = (pid, evKey) => detail.results.find(r => r.profileId === pid && r.event === evKey) || null;
    const flagBadge = (pid) => {
      if (!state.meetDayFlags || state.meetDayFlags.event !== qrEvent) return '';
      const st = state.meetDayFlags.byProfile[pid];
      if (st === 'pr') return ' <span class="badge star">PR ★</span>';
      if (st === 'first') return ' <span class="badge plain">First mark</span>';
      return '';
    };
    html += `
    <div class="card">
      <h2>${esc(m.name)}</h2>
      <p class="rc-line" id="md-summary-line">${esc(m.date)}${m.location ? ' · ' + esc(m.location) : ''} — <strong>${s.resultsEntered}</strong> result${s.resultsEntered === 1 ? '' : 's'} in · <strong>${s.prs}</strong> PR${s.prs === 1 ? '' : 's'} · <strong>${s.entries}</strong> entr${s.entries === 1 ? 'y' : 'ies'}</p>
      <label class="check-line"><input type="checkbox" disabled data-md-check="entriesAdded" ${c.entriesAdded ? 'checked' : ''}> Entries added</label>
      <label class="check-line"><input type="checkbox" disabled data-md-check="everyEventHasResult" ${c.everyEventHasResult ? 'checked' : ''}> Every entered event has at least one result</label>
      <label class="check-line"><input type="checkbox" disabled data-md-check="allResultsEntered" ${c.allResultsEntered ? 'checked' : ''}> All results entered</label>
      <form id="md-edit-form">
        <div class="filter-row">
          <label>Name <input type="text" id="md-edit-name" value="${esc(m.name)}" required></label>
          <label>Date <input type="date" id="md-edit-date" value="${esc(m.date)}" required></label>
          <label>Location <input type="text" id="md-edit-location" value="${esc(m.location || '')}"></label>
        </div>
        <button class="btn secondary" type="submit">Save meet details</button>
        <button class="btn danger" id="md-delete" type="button">Delete meet</button>
        <p class="error" id="md-edit-err"></p>
      </form>
    </div>
    <div class="card">
      <h2>Entries</h2>
      <form id="md-entry-form">
        <div class="filter-row">
          <label>Athlete <select id="md-entry-athlete">${profileOptions(null, true)}</select></label>
          <label>Event <select id="md-entry-event">${events.map(ev => `<option value="${ev.key}">${esc(ev.name)}</option>`).join('')}</select></label>
        </div>
        <button class="btn primary" type="submit">Add entry</button>
        <p class="error" id="md-entry-err"></p>
      </form>
      ${enteredEvents.length ? enteredEvents.map(ev => `
        <h3>${esc(ev.name)}</h3>
        <div class="table-wrap"><table class="ranked"><tbody>
          ${detail.entries.filter(e => e.event === ev.key).map(e => {
            const r = resultFor(e.profileId, ev.key);
            return `<tr><td>${esc(e.athleteName)}</td><td data-entry-result-for="${e.profileId}:${ev.key}">${r ? '<strong>' + esc(r.mark) + '</strong>' : '<span class="muted">no result yet</span>'}</td>
            <td><button class="btn danger" data-md-entry-del="${e.id}" type="button" style="width:auto;padding:2px 10px">Remove</button></td></tr>`;
          }).join('')}
        </tbody></table></div>`).join('')
        : '<p class="muted">No entries yet — add who is racing, jumping, or throwing above.</p>'}
    </div>
    <div class="card">
      <h2>Quick results</h2>
      ${qrEv ? `
      <div class="filter-row">
        <label>Event <select id="md-qr-event">${enteredEvents.map(ev => `<option value="${ev.key}" ${ev.key === qrEvent ? 'selected' : ''}>${esc(ev.name)}</option>`).join('')}</select></label>
      </div>
      <p class="muted" id="md-qr-hint">${markHint(qrEv.type)}</p>
      ${detail.entries.filter(e => e.event === qrEvent).map(e => {
        const r = resultFor(e.profileId, qrEvent);
        return `<div class="filter-row" data-qr-row="${e.profileId}"><label>${esc(e.athleteName)}<span data-qr-badge="${e.profileId}">${flagBadge(e.profileId)}</span> <input type="text" data-md-mark="${e.profileId}" value="${r ? esc(r.mark) : ''}" placeholder="mark"></label></div>`;
      }).join('')}
      <button class="btn primary" id="md-qr-save" type="button">Save results</button>
      <p class="error" id="md-qr-err"></p>
      <p class="muted">Saving a mark that is already in updates it in place. To change a mark after the day, or fix anything else, <button class="btn secondary" data-view="meets" type="button" style="width:auto;padding:2px 10px">open Meet Results</button>.</p>`
      : '<p class="muted">Add entries first — quick results cover the athletes entered in each event.</p>'}
    </div>`;
  }
  el.innerHTML = html;

  $('#md-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const out = await apiPost('/api/meets', {
        name: $('#md-name').value,
        date: $('#md-date').value,
        location: $('#md-location').value,
      });
      state.meetDayId = out.meet.id;
      state.meetDayEvent = null;
      state.meetDayFlags = null;
      renderMeetDay();
    } catch (err) { $('#md-create-err').textContent = err.message; }
  });
  el.querySelectorAll('[data-md-open]').forEach(b => b.addEventListener('click', () => {
    state.meetDayId = b.dataset.mdOpen;
    state.meetDayEvent = null;
    state.meetDayFlags = null;
    renderMeetDay();
  }));
  if (!detail) return;
  $('#md-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPut('/api/meets/' + encodeURIComponent(state.meetDayId), {
        name: $('#md-edit-name').value,
        date: $('#md-edit-date').value,
        location: $('#md-edit-location').value,
      });
      renderMeetDay();
    } catch (err) { $('#md-edit-err').textContent = err.message; }
  });
  $('#md-delete').addEventListener('click', async () => {
    if (!confirm('Delete this meet? Its entries go with it — results already recorded stay in Meet Results.')) return;
    try {
      await apiDel('/api/meets/' + encodeURIComponent(state.meetDayId));
      state.meetDayId = null;
      state.meetDayFlags = null;
      renderMeetDay();
    } catch (err) { alert(err.message); }
  });
  $('#md-entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/api/meets/' + encodeURIComponent(state.meetDayId) + '/entries', {
        profileId: $('#md-entry-athlete').value,
        event: $('#md-entry-event').value,
      });
      renderMeetDay();
    } catch (err) { $('#md-entry-err').textContent = err.message; }
  });
  el.querySelectorAll('[data-md-entry-del]').forEach(b => b.addEventListener('click', async () => {
    try {
      await apiDel('/api/meets/' + encodeURIComponent(state.meetDayId) + '/entries/' + encodeURIComponent(b.dataset.mdEntryDel));
      renderMeetDay();
    } catch (err) { alert(err.message); }
  }));
  const qrSel = $('#md-qr-event');
  if (qrSel) qrSel.addEventListener('change', () => {
    state.meetDayEvent = qrSel.value;
    state.meetDayFlags = null;
    renderMeetDay();
  });
  const qrSave = $('#md-qr-save');
  if (qrSave) qrSave.addEventListener('click', async () => {
    const marks = [];
    el.querySelectorAll('[data-md-mark]').forEach(inp => {
      const mark = inp.value.trim();
      if (mark) marks.push({ profileId: inp.dataset.mdMark, mark });
    });
    const errEl = $('#md-qr-err');
    if (!marks.length) { errEl.textContent = 'Type at least one mark first.'; return; }
    errEl.textContent = '';
    try {
      const out = await apiPost('/api/meets/' + encodeURIComponent(state.meetDayId) + '/results', {
        event: qrSel.value,
        marks,
      });
      const byProfile = {};
      for (const sv of out.saved) byProfile[sv.profileId] = sv.prStatus;
      state.meetDayFlags = { event: qrSel.value, byProfile };
      state.meetDayEvent = qrSel.value;
      /* In place: badges, entry-table marks, summary counts, and
         checklist all update from the server's own response —
         the typed marks, scroll, and focus are never repainted.
         (The batch is validated whole server-side, so on error
         nothing above runs and every typed mark survives.) */
      el.querySelectorAll('[data-qr-badge]').forEach(slot => {
        const st = byProfile[slot.dataset.qrBadge];
        slot.innerHTML = st === 'pr' ? ' <span class="badge star">PR ★</span>'
          : st === 'first' ? ' <span class="badge plain">First mark</span>' : '';
      });
      for (const sv of out.saved) {
        const td = el.querySelector('[data-entry-result-for="' + sv.profileId + ':' + qrSel.value + '"]');
        if (td) td.innerHTML = '<strong>' + esc(sv.mark) + '</strong>';
        const i = detail.results.findIndex(r => r.profileId === sv.profileId && r.event === qrSel.value);
        if (i >= 0) detail.results[i] = sv; else detail.results.push(sv);
        flashSaved(el.querySelector('[data-qr-row="' + sv.profileId + '"]'));
      }
      if (out.summary) {
        const line = $('#md-summary-line');
        if (line) line.innerHTML = `${esc(m.date)}${m.location ? ' · ' + esc(m.location) : ''} — <strong>${out.summary.resultsEntered}</strong> result${out.summary.resultsEntered === 1 ? '' : 's'} in · <strong>${out.summary.prs}</strong> PR${out.summary.prs === 1 ? '' : 's'} · <strong>${out.summary.entries}</strong> entr${out.summary.entries === 1 ? 'y' : 'ies'}`;
        const setCount = (kind, v) => {
          const cell = el.querySelector('[data-meet-count="' + kind + ':' + state.meetDayId + '"]');
          if (cell) cell.textContent = v;
        };
        setCount('entries', out.summary.entries);
        setCount('results', out.summary.resultsEntered);
        setCount('prs', out.summary.prs);
      }
      if (out.checklist) {
        for (const k of ['entriesAdded', 'everyEventHasResult', 'allResultsEntered']) {
          const cb = el.querySelector('[data-md-check="' + k + '"]');
          if (cb) cb.checked = !!out.checklist[k];
        }
      }
      const empty = Array.from(el.querySelectorAll('[data-md-mark]')).find(i => !i.value.trim());
      if (empty) empty.focus();
    } catch (err) { errEl.textContent = err.message; }
  });
}

/* ================================================================
   CLUB RECORDS — the all-time top 10 board. Everyone can read
   it (it is program history, under Train); only coaches manage
   it. The board itself comes from the public /api/records/board;
   the manager below it (form, full list, and the roster-best
   promotion helper) renders for coaches only.
   ================================================================ */
async function renderRecords() {
  const main = $('#records-main');
  const manage = $('#records-manage');
  if (!main) return;
  let events, board;
  try {
    const [e, b] = await Promise.all([api('/api/record-events'), api('/api/records/board')]);
    events = e.events; board = b.board;
    state.recEvents = events;
  } catch (err) { main.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  if (!events.some(ev => ev.key === state.recEvent)) state.recEvent = events.length ? events[0].key : '100m';
  if (!state.recEventPicked) {
    const firstWith = board.find(b => b.entries.length);
    if (firstWith) state.recEvent = firstWith.event;
  }
  const sel = board.find(b => b.event === state.recEvent);
  const anyMarks = board.some(b => b.entries.length);
  main.innerHTML = `
    <div class="chip-row" role="group" aria-label="Pick an event">
      ${events.map(ev => {
        const n = (board.find(b => b.event === ev.key) || { entries: [] }).entries.length;
        return `<button type="button" class="chip${ev.key === state.recEvent ? ' active' : ''}" data-rec-event="${ev.key}">${esc(ev.name)} (${n})</button>`;
      }).join('')}
    </div>
    <div class="card">
      <h2>${esc(sel ? sel.name : '')} — Top 10</h2>
      ${sel && sel.entries.length ? `<div class="table-wrap"><table class="ranked">
        <thead><tr><th>#</th><th>Athlete</th><th>Mark</th><th>Year</th><th>Meet</th></tr></thead>
        <tbody>${sel.entries.map(r => `<tr><td>${r.rank}</td><td><strong>${esc(r.name)}</strong></td><td><strong>${esc(r.mark)}</strong></td><td>${r.year ? esc(r.year) : '—'}</td><td>${esc(r.meet || '—')}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="muted">No records yet${sel ? ' for the ' + esc(sel.name) : ''} — the board fills in as real marks are added.</p>`}
      ${anyMarks ? '' : '<p class="muted">The board starts empty on purpose: every mark here is a real __BRAND_NAME__ mark, added by a coach.</p>'}
    </div>`;
  main.querySelectorAll('[data-rec-event]').forEach(b => b.addEventListener('click', () => {
    state.recEvent = b.dataset.recEvent;
    state.recEventPicked = true;
    renderRecords();
  }));

  if (!manage) return;
  if (!isCoachUser()) { manage.innerHTML = ''; return; }
  await refreshProfiles();
  let records, rosterBest;
  try {
    const [r, rb] = await Promise.all([api('/api/records'), api('/api/records/roster-best')]);
    records = r.records; rosterBest = rb.best;
  } catch (err) { manage.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const edit = state.recEditId ? records.find(r => r.id === state.recEditId) : null;
  if (state.recEditId && !edit) state.recEditId = null;
  const markHint = (type) => type === 'time'
    ? 'Time: seconds (10.87) or minutes:seconds (1:55.20).'
    : 'Mark: feet-inches (21-06.5), 21\'6.5, a plain number in feet, or meters with an m (6.45m).';
  const editEvent = edit ? events.find(e2 => e2.key === edit.event) : null;
  const promoRows = rosterBest.filter(rb => rb.best);
  manage.innerHTML = `
    <div class="card">
      <h2>From today's roster</h2>
      <p class="muted">The best meet mark the current roster owns in each event, and where it would land on the board. Adding is always your tap — nothing is promoted automatically.</p>
      ${promoRows.length ? `<div class="table-wrap"><table class="ranked">
        <thead><tr><th>Event</th><th>Roster best</th><th>Mark</th><th>On the board</th><th></th></tr></thead>
        <tbody>${promoRows.map(rb => {
          const already = records.some(r => r.event === rb.event && r.profileId === rb.best.profileId && r.value === rb.best.value);
          return `<tr><td>${esc(rb.name)}</td><td>${esc(rb.best.athleteName)}</td><td><strong>${esc(rb.best.mark)}</strong></td>
          <td>${rb.makesBoard ? 'Would rank #' + rb.rank : 'Outside the top 10'}</td>
          <td>${already ? '<span class="muted">On the board ✓</span>' : `<button class="btn secondary" data-rec-promote="${rb.event}" type="button" style="width:auto;padding:2px 10px">Add to board</button>`}</td></tr>`;
        }).join('')}</tbody></table></div>`
        : '<p class="muted">No meet results yet — roster bests appear here as results are entered.</p>'}
    </div>
    <form class="card" id="record-form">
      <h2>${edit ? 'Edit record' : 'Add a record'}</h2>
      <div class="filter-row">
        <label>Event <select id="rf-event">${events.map(ev => `<option value="${ev.key}" ${edit && edit.event === ev.key ? 'selected' : ''}>${esc(ev.name)}${ev.relay ? ' (relay)' : ''}</option>`).join('')}</select></label>
        <label>Name <input type="text" id="rf-name" placeholder="Who set it — or the relay team" value="${edit ? esc(edit.name) : ''}" required></label>
      </div>
      <div class="filter-row">
        <label>Mark <input type="text" id="rf-mark" placeholder="10.87 · 43.50 · 21-06.5" value="${edit ? esc(edit.mark) : ''}" required></label>
        <label>Year <input type="number" id="rf-year" min="1950" max="2100" placeholder="optional" value="${edit && edit.year ? edit.year : ''}"></label>
      </div>
      <div class="filter-row">
        <label>Meet <input type="text" id="rf-meet" placeholder="optional" value="${edit ? esc(edit.meet || '') : ''}"></label>
        <label>Date <input type="date" id="rf-date" value="${edit ? esc(edit.date || '') : ''}"></label>
      </div>
      <label>Current athlete (optional — links this record to a roster profile)
        <select id="rf-profile">${profileOptions(edit ? edit.profileId : null, true)}</select></label>
      <p class="muted" id="rf-hint">${markHint(editEvent ? editEvent.type : 'time')}</p>
      <button class="btn primary" type="submit">${edit ? 'Save changes' : 'Add record'}</button>
      ${edit ? '<button class="btn secondary" id="rf-cancel" type="button">Cancel edit</button>' : ''}
      <p class="error" id="rf-err"></p>
    </form>
    <div class="card">
      <h2>All records (${records.length})</h2>
      ${records.length ? events.map(ev => {
        const rows = records.filter(r => r.event === ev.key);
        if (!rows.length) return '';
        const ranked = rows.slice().sort((a, b) => (ev.type === 'time' ? a.value - b.value : b.value - a.value));
        return `<h3>${esc(ev.name)}</h3><div class="table-wrap"><table class="ranked">
          <thead><tr><th>#</th><th>Athlete</th><th>Mark</th><th>Year</th><th>Meet</th><th></th></tr></thead>
          <tbody>${ranked.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td><strong>${esc(r.mark)}</strong></td><td>${r.year ? esc(r.year) : '—'}</td><td>${esc(r.meet || '—')}</td>
            <td><button class="btn secondary" data-rec-edit="${r.id}" type="button" style="width:auto;padding:2px 10px">Edit</button>
            <button class="btn danger" data-rec-del="${r.id}" type="button" style="width:auto;padding:2px 10px">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
      }).join('')
        : '<p class="muted">No records on the board yet.</p>'}
    </div>`;
  const evSel = $('#rf-event');
  if (evSel) evSel.addEventListener('change', () => {
    const ev = state.recEvents.find(e2 => e2.key === evSel.value);
    $('#rf-hint').textContent = markHint(ev ? ev.type : 'time');
  });
  $('#record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const yearRaw = $('#rf-year').value;
    const body = {
      event: $('#rf-event').value,
      name: $('#rf-name').value,
      mark: $('#rf-mark').value,
      year: yearRaw === '' ? null : Number(yearRaw),
      meet: $('#rf-meet').value,
      date: $('#rf-date').value || null,
      profileId: $('#rf-profile').value || null,
    };
    try {
      if (state.recEditId) await apiPut('/api/records/' + encodeURIComponent(state.recEditId), body);
      else await apiPost('/api/records', body);
      state.recEditId = null;
      renderRecords();
    } catch (err) { $('#rf-err').textContent = err.message; }
  });
  const cancel = $('#rf-cancel');
  if (cancel) cancel.addEventListener('click', () => { state.recEditId = null; renderRecords(); });
  manage.querySelectorAll('[data-rec-edit]').forEach(b => b.addEventListener('click', async () => {
    state.recEditId = b.dataset.recEdit;
    await renderRecords();
    const form = $('#record-form');
    if (form) form.scrollIntoView({ block: 'start' });
  }));
  manage.querySelectorAll('[data-rec-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this record?')) return;
    try { await apiDel('/api/records/' + encodeURIComponent(b.dataset.recDel)); renderRecords(); }
    catch (err) { alert(err.message); }
  }));
  manage.querySelectorAll('[data-rec-promote]').forEach(b => b.addEventListener('click', async () => {
    const rb = rosterBest.find(x => x.event === b.dataset.recPromote);
    if (!rb || !rb.best) return;
    try {
      await apiPost('/api/records', {
        event: rb.event, mark: rb.best.mark, name: rb.best.athleteName,
        profileId: rb.best.profileId, meet: rb.best.meet, date: rb.best.date || null,
        year: rb.best.date ? Number(rb.best.date.slice(0, 4)) : null,
      });
      renderRecords();
    } catch (err) { alert(err.message); }
  }));
}

/* ================================================================
   LEADERBOARD — the team's best marks, ranked. Everyone signed in
   reads it (a motivation surface, under Train next to School
   Records); the server computes it from testing results and meet
   PRs only — /api/leaderboard carries no check-in, health,
   attendance, notes, or goals data. Read-only: nothing is edited
   here. The viewer's own row is highlighted when their account is
   linked to a roster profile (the ranked table's .selected row,
   the same treatment the Meet Day list gives its current meet).
   ================================================================ */
async function renderLeaderboard() {
  const main = $('#leaderboard-main');
  if (!main) return;
  let data;
  try { data = await api('/api/leaderboard'); }
  catch (err) { main.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const mine = state.user ? state.user.profileId : null;
  const rowCls = (e) => (mine && e.profileId === mine) ? ' class="selected"' : '';
  const youTag = (e) => (mine && e.profileId === mine) ? ' <span class="muted">(you)</span>' : '';
  const testingCards = (data.testing || []).map(b => `
    <div class="card">
      <h3>${esc(b.name)}</h3>
      <div class="table-wrap"><table class="ranked">
        <thead><tr><th>#</th><th>Athlete</th><th>Best</th><th>Date</th></tr></thead>
        <tbody>${b.leaders.map(e => `<tr${rowCls(e)}><td>${e.rank}</td><td><strong>${esc(e.name)}</strong>${youTag(e)}</td><td><strong>${fmtNum(e.value)} ${esc(b.unit || '')}</strong></td><td>${e.testDayDate ? esc(e.testDayDate) : '—'}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('');
  const meetCards = (data.meets || []).map(b => `
    <div class="card">
      <h3>${esc(b.name)}</h3>
      <div class="table-wrap"><table class="ranked">
        <thead><tr><th>#</th><th>Athlete</th><th>PR</th><th>Meet</th><th>Date</th></tr></thead>
        <tbody>${b.leaders.map(e => `<tr${rowCls(e)}><td>${e.rank}</td><td><strong>${esc(e.name)}</strong>${youTag(e)}</td><td><strong>${esc(e.mark)}</strong>${e.schoolRecord ? ' <span class="badge star">CLUB RECORD</span>' : ''}</td><td>${esc(e.meet)}</td><td>${esc(e.date)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('');
  if (!testingCards && !meetCards) {
    main.innerHTML = '<div class="card"><p class="muted">Leaderboards appear once at least two athletes have results.</p></div>';
    return;
  }
  main.innerHTML = `
    ${testingCards ? `<h2>Testing Leaders</h2>${LANE_DIVIDER}${testingCards}` : ''}
    ${meetCards ? `<h2>Meet PR Leaders</h2>${LANE_DIVIDER}${meetCards}` : ''}`;
}

/* ================================================================
   GOALS — coach-set target marks, one active goal per athlete per
   event. The server computes progress from the athlete's real meet
   results (first mark = baseline, PR = current) through the shared
   meet parser, so a goal reads the same in this manager, on the
   athlete's own Today page, and on the printed report card.
   ================================================================ */
function goalGapText(g) {
  if (!g.current || g.gap === null || g.gap === undefined) return '';
  if (g.achieved) return 'Target hit';
  return fmtNum(g.gap) + ' ' + (g.type === 'time' ? 'sec' : 'in') + ' to go';
}
function goalProgressInner(g) {
  if (!g.current) {
    return '<p class="muted">No marks yet — first race sets the baseline.</p>';
  }
  return `<p class="rc-line">PR: <strong>${esc(g.current.mark)}</strong>`
    + (g.baseline ? ` · Started at ${esc(g.baseline.mark)}` : '')
    + (goalGapText(g) ? ` · ${esc(goalGapText(g))}` : '') + '</p>'
    + `<div class="goal-bar"><div class="goal-bar-fill" style="width:${g.progressPct}%"></div></div>`
    + `<p class="muted">${g.progressPct}% of the way from the first mark to the goal.</p>`;
}

async function renderGoals() {
  const el = $('#goals-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Athlete goals live here.'); return; }
  await refreshProfiles();
  let events, goals;
  try {
    const [e, g] = await Promise.all([api('/api/meet-events'), api('/api/goals')]);
    events = e.events; goals = g.goals;
    state.meetEvents = events;
  } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const roster = state.profiles.filter(p => !p.archived);
  if (!state.goalAthleteId || !roster.some(p => p.id === state.goalAthleteId)) {
    state.goalAthleteId = roster.length ? roster[0].id : null;
  }
  const pid = state.goalAthleteId;
  const prof = pid ? state.profiles.find(p => p.id === pid) : null;
  const mine = goals.filter(g => g.profileId === pid);
  const edit = state.goalEditId ? mine.find(g => g.id === state.goalEditId) : null;
  if (state.goalEditId && !edit) state.goalEditId = null;
  const markHint = (type) => type === 'time'
    ? 'Time: seconds (10.87) or minutes:seconds (1:55.20).'
    : 'Mark: feet-inches (21-06.5), 21\'6.5, a plain number in feet, or meters with an m (6.45m).';
  const editEvent = edit ? events.find(e2 => e2.key === edit.event) : null;
  el.innerHTML = `
    <div class="card">
      <h2>Pick an athlete</h2>
      <label>Athlete <select id="goal-athlete">${profileOptions(pid, true)}</select></label>
    </div>
    <form class="card" id="goal-form">
      <h2>${edit ? 'Edit goal' : 'Set a goal'}${prof ? ' — ' + esc(prof.name) : ''}</h2>
      <div class="filter-row">
        <label>Event <select id="gf-event">${events.map(ev => `<option value="${ev.key}" ${edit && edit.event === ev.key ? 'selected' : ''}>${esc(ev.name)} (${ev.type === 'time' ? 'time' : 'field'})</option>`).join('')}</select></label>
        <label>Target mark <input type="text" id="gf-target" placeholder="10.87 · 1:55.20 · 21-06.5" value="${edit ? esc(edit.targetText) : ''}" required></label>
      </div>
      <p class="muted" id="gf-hint">${markHint(editEvent ? editEvent.type : 'time')}</p>
      <p class="muted">One goal per athlete per event — setting a target for an event that already has one replaces it.</p>
      <button class="btn primary" type="submit">${edit ? 'Save changes' : 'Set goal'}</button>
      ${edit ? '<button class="btn secondary" id="gf-cancel" type="button">Cancel edit</button>' : ''}
      <p class="error" id="gf-err"></p>
    </form>
    <div class="card">
      <h2>${prof ? esc(prof.name) + ' — goals' : 'Goals'}</h2>
      ${mine.length ? mine.map(g => `
        <div class="goal-row">
          <div class="goal-head"><strong>${esc(g.eventName)}</strong> <span class="muted">Target: <strong>${esc(g.targetText)}</strong></span>
          ${g.achieved ? '<span class="badge star">GOAL HIT ★</span>' : ''}</div>
          ${goalProgressInner(g)}
          <p><button class="btn secondary" data-goal-edit="${g.id}" type="button" style="width:auto;padding:2px 10px">Edit</button>
          <button class="btn danger" data-goal-del="${g.id}" type="button" style="width:auto;padding:2px 10px">Delete</button></p>
        </div>`).join('')
        : '<p class="muted">No goals yet for this athlete — set the first target above.</p>'}
    </div>`;
  const athSel = $('#goal-athlete');
  if (athSel) athSel.addEventListener('change', () => {
    state.goalAthleteId = athSel.value || null;
    state.goalEditId = null;
    renderGoals();
  });
  const evSel = $('#gf-event');
  if (evSel) evSel.addEventListener('change', () => {
    const ev = events.find(e2 => e2.key === evSel.value);
    $('#gf-hint').textContent = markHint(ev ? ev.type : 'time');
  });
  $('#goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pid) { $('#gf-err').textContent = 'Pick an athlete first.'; return; }
    const body = { event: $('#gf-event').value, target: $('#gf-target').value };
    try {
      if (state.goalEditId) await apiPut('/api/goals/' + encodeURIComponent(state.goalEditId), body);
      else await apiPost('/api/goals', Object.assign({ profileId: pid }, body));
      state.goalEditId = null;
      renderGoals();
    } catch (err) { $('#gf-err').textContent = err.message; }
  });
  const cancel = $('#gf-cancel');
  if (cancel) cancel.addEventListener('click', () => { state.goalEditId = null; renderGoals(); });
  el.querySelectorAll('[data-goal-edit]').forEach(b => b.addEventListener('click', () => {
    state.goalEditId = b.dataset.goalEdit;
    renderGoals();
    window.scrollTo(0, 0);
  }));
  el.querySelectorAll('[data-goal-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this goal?')) return;
    try {
      await apiDel('/api/goals/' + encodeURIComponent(b.dataset.goalDel));
      if (state.goalEditId === b.dataset.goalDel) state.goalEditId = null;
      renderGoals();
    } catch (err) { alert(err.message); }
  }));
}

/* The athlete's own goals card (Today page). Read-only, and only
   for a linked athlete — an unlinked account sees nothing here. */
async function renderMyGoals() {
  const slot = $('#goals-slot');
  if (!slot) return;
  if (!isAthleteUser()) { slot.innerHTML = ''; state.myGoals = null; return; }
  let data;
  try { data = await api('/api/goals/mine'); }
  catch (_) { slot.innerHTML = ''; return; }
  state.myGoals = data;
  if (!data.linked) { slot.innerHTML = ''; return; }
  slot.innerHTML = `<div class="card">
    <h2>My Goals</h2>
    ${data.goals.length
      ? '<p class="muted">The target marks your coach set for you — and how close your PR is getting.</p>'
        + data.goals.map(g => `
        <div class="goal-row">
          <div class="goal-head"><strong>${esc(g.eventName)}</strong> <span class="muted">Target: <strong>${esc(g.targetText)}</strong></span>
          ${g.achieved ? '<span class="badge star">GOAL HIT ★</span>' : ''}</div>
          ${goalProgressInner(g)}
        </div>`).join('')
      : '<p class="muted">No goals set yet — when your coach sets a target mark for you, it shows up here with your progress toward it.</p>'}
  </div>`;
}

/* ================================================================
   ANNOUNCEMENTS — one-way posts from the coaching staff.
   Coaches write them in the Announcements view (whole team or
   one group, optionally pinned); everyone signed in reads the
   feed the server filtered for them on the Today page. There
   are no replies, comments, or read receipts — by design.
   ================================================================ */
function announcePostHtml(a, manage) {
  return `<div class="card">
    <div class="roster-row">
      <span>${a.pinned ? '<span class="badge plain">📌 PINNED</span> ' : ''}<strong>${a.audience === 'team' ? 'Whole team' : esc(a.groupName || 'Group')}</strong></span>
      <span class="muted">${esc(fmtDate(parseDate(String(a.createdAt).slice(0, 10))))}</span>
    </div>
    ${a.title ? `<p><strong>${esc(a.title)}</strong></p>` : ''}
    <p>${esc(a.body).replace(/\n/g, '<br>')}</p>
    <p class="muted">${esc(a.authorLabel)}${a.updatedAt !== a.createdAt ? ' · edited ' + esc(fmtDate(parseDate(String(a.updatedAt).slice(0, 10)))) : ''}</p>
    ${manage ? `<p><button class="btn secondary" data-ann-edit="${a.id}" type="button">Edit</button>
      <button class="btn danger" data-ann-del="${a.id}" type="button">Delete</button></p>` : ''}
  </div>`;
}

/* The Today-page panel. Athletes and coaches alike read the
   feed the server filtered for them; a caller with nothing to
   see gets no card at all (coaches get the quiet "post one"
   prompt instead of an empty box). */
async function renderAnnouncePanel() {
  const slot = $('#announce-slot');
  if (!slot) return;
  if (!state.user) { slot.innerHTML = ''; return; }
  let data;
  try { data = await api('/api/announcements'); }
  catch (_) { slot.innerHTML = ''; return; }
  const posts = (data.announcements || []).slice(0, 5);
  if (!posts.length) {
    slot.innerHTML = isCoachUser()
      ? `<div class="card"><h2>Announcements</h2><p class="muted">No announcements yet — post the first one for the team.</p><p><button class="btn secondary" id="ann-panel-new" type="button">New announcement</button></p></div>`
      : '';
  } else {
    slot.innerHTML = `<h2>Announcements</h2>${LANE_DIVIDER}`
      + posts.map(a => announcePostHtml(a, false)).join('')
      + (isCoachUser() ? '<p><button class="btn secondary" id="ann-panel-new" type="button">New announcement</button></p>' : '');
  }
  const nb = $('#ann-panel-new');
  if (nb) nb.addEventListener('click', () => showView('announce'));
}

/* ---------------- data: backup, restore, spreadsheets ----------------
   The whole team dataset leaves as one JSON backup and comes back
   the same way. A restore MERGES — records in the file are added or
   updated and nothing is ever deleted — and the file never carries
   accounts or passwords, so it is safe to keep anywhere. The client
   reads the picked file first and shows what is in it; the import
   only runs on the coach's explicit click. */
let pendingBackup = null;
function backupCollectionCounts(data) {
  const rows = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (Array.isArray(v)) rows.push([k, String(v.length)]);
    else if (v && typeof v === 'object') rows.push([k, String(Object.keys(v).length)]);
    else if (typeof v === 'boolean') rows.push([k, v ? 'on' : 'off']);
  }
  return rows;
}
/* ---------------- demo coverage ----------------
   The filming map for the goal of a coach video on every
   movement. The server classifies each drill and test from
   mergedMedia() — an uploaded video is 'yours', a YouTube/GIF
   stand-in is a 'placeholder', no entry is 'none' — and this
   view filters and lists the rows. Every row carries the same
   demo buttons (demoHtml) the drills list uses, so watching,
   adding, or swapping a demo is the same modal as everywhere
   else; loadMedia re-renders this view after a modal save, so
   a fixed row flips its status in place. */
const COVERAGE_FILTERS = [['all', 'All'], ['yours', 'Yours'], ['placeholder', 'Placeholder'], ['none', 'None']];
function coverageBadge(status) {
  if (status === 'yours') return '<span class="badge done">YOUR VIDEO</span>';
  if (status === 'placeholder') return '<span class="badge plain">PLACEHOLDER</span>';
  return '<span class="badge">NO DEMO</span>';
}
async function renderCoverage() {
  const main = $('#coverage-main');
  if (!main) return;
  if (!isCoachUser()) { gateHtml(main, 'Demo coverage lives here.'); return; }
  let data;
  try {
    data = await api('/api/demo-coverage');
  } catch (err) {
    main.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const rows = data.rows || [];
  const s = data.summary || { total: rows.length, yours: 0, placeholder: 0, none: 0 };
  if (!COVERAGE_FILTERS.some(([v]) => v === state.coverageFilter)) state.coverageFilter = 'all';
  const counts = { all: s.total, yours: s.yours, placeholder: s.placeholder, none: s.none };
  const shown = rows.filter(r => state.coverageFilter === 'all' || r.status === state.coverageFilter);
  main.innerHTML = `
    <div class="card">
      <p style="margin:0"><strong>${s.yours} of ${s.total} movements have your video</strong> · ${s.placeholder} placeholders · ${s.none} with no demo</p>
    </div>
    <div class="chip-row">${COVERAGE_FILTERS.map(([v, label]) =>
      `<button type="button" class="chip ${state.coverageFilter === v ? 'active' : ''}" data-covfilter="${v}">${label} (${counts[v]})</button>`).join('')}
    </div>
    <div id="coverage-list">${shown.length ? shown.map(r => `
      <div class="roster-row"><span class="row-lead">${thumbHtml(r.id, 'thumb-sm')}<strong>${esc(r.name)}</strong></span> <span class="badge plain">${esc(r.kind)}</span> ${coverageBadge(r.status)} ${demoHtml(r.id, r.name)}</div>`).join('')
      : '<p class="muted">Nothing in this bucket yet.</p>'}
    </div>`;
  main.querySelectorAll('[data-covfilter]').forEach(b => b.addEventListener('click', () => {
    state.coverageFilter = b.dataset.covfilter;
    renderCoverage();
  }));
}

async function renderData() {
  const main = $('#data-main');
  if (!main) return;
  if (!isCoachUser()) { gateHtml(main, 'Team data lives here.'); return; }
  pendingBackup = null;
  main.innerHTML = `
    <div class="card">
      <h3>Full backup</h3>
      <p class="muted">One JSON file with the whole team dataset: roster and groups, assignments and completions, testing, weekly numbers, health concerns, inventory, warm-up card edits, meet results, school records, goals, check-ins, attendance, coach notes, custom workouts, programs, and announcements. Accounts and passwords are never in the file.</p>
      <p><a class="btn" href="/api/export/backup">Download full backup</a></p>
    </div>
    <div class="card">
      <h3>Restore from a backup</h3>
      <p class="muted">Restoring merges into what's already here: records in the file are added or updated, and nothing is ever deleted. Accounts are not part of a backup — athlete sign-ins keep working because account links are stored by email and re-attach on their own.</p>
      <p><input type="file" id="data-file" accept=".json,application/json"></p>
      <div id="data-import-box"></div>
    </div>
    <div class="card">
      <h3>Spreadsheets (CSV)</h3>
      <p>
        <a class="btn secondary" href="/api/export/attendance.csv">Attendance</a>
        <a class="btn secondary" href="/api/export/checkins.csv">Check-ins</a>
        <a class="btn secondary" href="/api/export/records.csv">School records</a>
      </p>
      <p>
        <a class="btn secondary" href="/api/export/testing-detail.csv">Testing results (full detail)</a>
        <a class="btn secondary" href="/api/export/testing.csv">Testing results (summary)</a>
        <a class="btn secondary" href="/api/export/weekly.csv">Weekly tracker</a>
      </p>
      <p>
        <a class="btn secondary" href="/api/export/meet-results.csv">Meet results</a>
        <a class="btn secondary" href="/api/export/roster.csv">Roster</a>
      </p>
      <p>
        <a class="btn secondary" href="/api/export/completions.csv">Session completions (raw)</a>
      </p>
    </div>`;
  const fileInput = $('#data-file');
  fileInput.addEventListener('change', async () => {
    const box = $('#data-import-box');
    pendingBackup = null;
    box.innerHTML = '';
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (_) {
      box.innerHTML = '<p class="error">That file is not valid JSON.</p>';
      return;
    }
    if (!parsed || parsed.app !== 'ruffin-performance-app' || parsed.kind !== 'backup'
      || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      box.innerHTML = '<p class="error">That is not a sprinter app backup file.</p>';
      return;
    }
    pendingBackup = parsed;
    const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : 'an unknown date';
    const counts = backupCollectionCounts(parsed.data)
      .map(([k, n]) => '<tr><td>' + esc(k) + '</td><td>' + esc(n) + '</td></tr>').join('');
    box.innerHTML =
      '<p>Backup from <strong>' + esc(when) + '</strong> — importing merges it into the current data:</p>'
      + '<table class="ranked"><tbody>' + counts + '</tbody></table>'
      + '<p><button type="button" class="btn" id="data-import-go">Import this backup</button> '
      + '<button type="button" class="btn secondary" id="data-import-cancel">Cancel</button></p>'
      + '<div id="data-import-result"></div>';
    $('#data-import-cancel').addEventListener('click', () => {
      pendingBackup = null;
      box.innerHTML = '';
      fileInput.value = '';
    });
    $('#data-import-go').addEventListener('click', async () => {
      const out = $('#data-import-result');
      out.innerHTML = '<p class="muted">Importing…</p>';
      try {
        const r = await apiPost('/api/import/backup', pendingBackup);
        const lines = Object.entries(r.counts || {})
          .filter(([, c]) => c.added || c.updated)
          .map(([k, c]) => '<tr><td>' + esc(k) + '</td><td>' + c.added + ' added · ' + c.updated + ' updated</td></tr>').join('');
        out.innerHTML = '<p><strong>Import complete:</strong> ' + r.totalAdded + ' added, ' + r.totalUpdated + ' updated.</p>'
          + (lines
            ? '<table class="ranked"><tbody>' + lines + '</tbody></table>'
            : '<p class="muted">Everything in the file was already here, unchanged.</p>');
        pendingBackup = null;
      } catch (err) {
        out.innerHTML = '<p class="error">' + esc(err.message) + '</p>';
      }
    });
  });
}

/* ================================================================
   DEVICES — ForceDecks, NordBord, T-APEX, and the VALD API status.
   Imports are two steps on purpose: pick a file and the app shows
   how every row matched the roster BEFORE anything is filed;
   unmatched rows get a roster dropdown so the coach maps them by
   hand, and rows still unmapped at commit are skipped and counted
   by the server — never guessed. The T-APEX tab leads with its
   quick-entry card (the tablet has no feed, so hand entry is the
   guaranteed path) and also takes the same file import. Device
   results are testing results, so they read in Testing, report
   cards, and the AMS profile with no extra wiring here.
   ================================================================ */
const DEVICE_TABS = [
  ['forcedecks', 'ForceDecks'], ['nordbord', 'NordBord'],
  ['tapex', 'T-APEX'], ['valdapi', 'VALD API'],
];
const DEVICE_NAMES = { forcedecks: 'ForceDecks', nordbord: 'NordBord', tapex: 'T-APEX' };
const TAPEX_FIELD_LABELS = {
  load: 'Load (kg)', peakSpeed: 'Peak Speed (m/s)',
  maxForce: 'Max Force (N)', distance: 'Distance (m)',
};
let devFlash = '';

async function renderDevices() {
  const el = $('#devices-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Device results live here.'); return; }
  await refreshProfiles();
  const tab = state.devTab;
  el.innerHTML = `
    <nav class="seg" aria-label="Devices">${DEVICE_TABS.map(([id, label]) =>
      `<button type="button" class="seg-btn${tab === id ? ' active' : ''}" data-dev-tab="${id}">${label}</button>`).join('')}
    </nav>
    ${devFlash ? `<div class="card"><p>${esc(devFlash)}</p></div>` : ''}
    <div id="devices-panel"></div>`;
  devFlash = '';
  el.querySelectorAll('[data-dev-tab]').forEach(b => b.addEventListener('click', () => {
    state.devTab = b.dataset.devTab;
    renderDevices();
  }));
  const panel = $('#devices-panel');
  if (tab === 'valdapi') { renderValdApiPanel(panel); return; }
  if (tab === 'tapex') paintTapexPanel(panel);
  else panel.innerHTML = deviceImportCardHtml(tab);
  wireDeviceFile(tab);
  paintDevicePreview(tab);
  loadDeviceSummary(tab);
}
function deviceImportCardHtml(device) {
  const name = DEVICE_NAMES[device];
  const from = device === 'tapex'
    ? 'If the tablet app gives you a session export file, it imports here the same way.'
    : 'Export the results file from VALD Hub, then pick it here.';
  return `
    <div class="card">
      <h2>Import ${esc(name)} results</h2>
      <p class="muted">${from} Nothing is filed until you review the matches and confirm: rows are matched to the roster by name, any row the file cannot name waits for you to map it by hand below, and anything left unmapped is skipped and counted — never guessed.</p>
      <p><input type="file" id="dev-file" accept=".csv,text/csv"></p>
      <div id="dev-preview-slot"></div>
    </div>
    <div class="card">
      <h2>Recent ${esc(name)} sessions</h2>
      <div id="dev-summary-slot"><p class="muted">Loading…</p></div>
    </div>`;
}
function wireDeviceFile(device) {
  const input = $('#dev-file');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const slot = $('#dev-preview-slot');
    slot.innerHTML = '<p class="muted">Reading the file…</p>';
    try {
      const text = await file.text();
      state.devPreviews[device] = await apiPost('/api/devices/' + device + '/preview', { csv: text });
      paintDevicePreview(device);
    } catch (err) {
      slot.innerHTML = '<p class="error">' + esc(err.message) + '</p>';
    }
  });
}
function paintDevicePreview(device) {
  const slot = $('#dev-preview-slot');
  if (!slot) return;
  const pv = state.devPreviews[device];
  if (!pv) { slot.innerHTML = ''; return; }
  const nameOf = (pid) => {
    const pr = state.profiles.find(x => x.id === pid);
    return pr ? pr.name : pid;
  };
  const matched = pv.rows.filter(r => r.matchStatus === 'matched').length;
  const unmapped = pv.rows.length - matched;
  slot.innerHTML = `
    <p><strong>${pv.rows.length + pv.errors.length} rows read</strong> — ${matched} matched to the roster${unmapped ? ' · ' + unmapped + ' to map by hand' : ''}${pv.errors.length ? ' · ' + pv.errors.length + ' could not be read' : ''}.</p>
    ${pv.errors.length ? pv.errors.map(e => `<p class="error">Row ${e.rowIndex}${e.rawName ? ' (' + esc(e.rawName) + ')' : ''}: ${esc(e.reason)}</p>`).join('') : ''}
    ${pv.rows.length ? `<div class="table-wrap"><table class="ranked">
      <thead><tr><th>Athlete in file</th><th>Date</th><th>Results</th><th>Files to</th></tr></thead>
      <tbody>${pv.rows.map(r => `<tr>
        <td>${esc(r.rawName)}${r.matchNote ? `<br><span class="muted">${esc(r.matchNote)}</span>` : ''}</td>
        <td>${esc(r.date)}</td>
        <td>${Object.entries(r.metrics).map(([k, v]) => esc(k) + ' ' + esc(fmtNum(v))).join(' · ')}</td>
        <td>${r.matchStatus === 'matched'
          ? esc(nameOf(r.profileId))
          : `<select data-dev-map="${r.rowIndex}">${profileOptions('', true)}</select>`}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p><button type="button" class="btn primary" id="dev-commit" style="width:auto">File these results</button>
    <button type="button" class="btn secondary" id="dev-discard" style="width:auto">Discard</button></p>
    <div id="dev-commit-result"></div>` : '<p class="muted">No readable rows in this file.</p>'}`;
  const discard = $('#dev-discard');
  if (discard) discard.addEventListener('click', () => {
    state.devPreviews[device] = null;
    paintDevicePreview(device);
    const f = $('#dev-file');
    if (f) f.value = '';
  });
  const commit = $('#dev-commit');
  if (commit) commit.addEventListener('click', async () => {
    const rows = pv.rows.map(r => {
      let pid = r.profileId;
      if (!pid) {
        const sel = slot.querySelector('[data-dev-map="' + r.rowIndex + '"]');
        pid = sel && sel.value ? sel.value : null;
      }
      return { profileId: pid, date: r.date, metrics: r.metrics };
    });
    const out = $('#dev-commit-result');
    out.innerHTML = '<p class="muted">Filing…</p>';
    try {
      const res = await apiPost('/api/devices/' + device + '/commit', { rows });
      state.devPreviews[device] = null;
      devFlash = 'Filed ' + res.filed + ' athlete row' + (res.filed === 1 ? '' : 's')
        + ' (' + res.results + ' results) from the ' + DEVICE_NAMES[device] + ' file'
        + (res.skipped ? ' · ' + res.skipped + ' skipped — left unmapped or unreadable' : '') + '.';
      renderDevices();
    } catch (err) {
      out.innerHTML = '<p class="error">' + esc(err.message) + '</p>';
    }
  });
}
async function loadDeviceSummary(device) {
  const slot = $('#dev-summary-slot');
  if (!slot) return;
  try {
    const data = await api('/api/devices/' + device + '/summary');
    slot.innerHTML = data.days.length
      ? data.days.map(d => `<div class="roster-row"><span><strong>${esc(d.date)}</strong> — ${esc(d.title)}</span><span class="muted">${d.athletes} athlete${d.athletes === 1 ? '' : 's'} · ${d.results} results</span></div>`).join('')
      : '<p class="muted">No ' + esc(DEVICE_NAMES[device]) + ' sessions filed yet.</p>';
  } catch (err) {
    slot.innerHTML = '<p class="error">' + esc(err.message) + '</p>';
  }
}
function paintTapexPanel(panel) {
  panel.innerHTML = `
    <div class="card">
      <h2>T-APEX quick entry</h2>
      <p class="muted">The T-APEX lives on its own tablet — no feed, no sync — so key the session in here. Fill in whichever numbers the session produced; at least one is required. Entries file onto the athlete's T-APEX test day, in their testing history.</p>
      <div class="filter-row">
        <label>Athlete <select id="ta-athlete">${profileOptions('', true)}</select></label>
        <label>Date <input type="date" id="ta-date" value="${esc(dateStrOf(todayLocal()))}"></label>
      </div>
      <div class="filter-row">
        <label>Load (kg) <input type="number" id="ta-load" min="0" step="any" inputmode="decimal"></label>
        <label>Peak speed (m/s) <input type="number" id="ta-speed" min="0" step="any" inputmode="decimal"></label>
        <label>Max force (N) <input type="number" id="ta-force" min="0" step="any" inputmode="decimal"></label>
        <label>Distance (m) <input type="number" id="ta-distance" min="0" step="any" inputmode="decimal"></label>
      </div>
      <button class="btn primary" id="ta-save" type="button" style="width:auto">Save entry</button>
      <p class="error" id="ta-err"></p>
    </div>
    <div class="card">
      <h2>Recent T-APEX entries</h2>
      <div id="ta-entries-slot"><p class="muted">Loading…</p></div>
    </div>
    ${deviceImportCardHtml('tapex')}`;
  loadTapexEntries();
  $('#ta-save').addEventListener('click', async () => {
    const errEl = $('#ta-err');
    errEl.textContent = '';
    const payload = { profileId: $('#ta-athlete').value, date: $('#ta-date').value };
    const fields = [['load', '#ta-load'], ['peakSpeed', '#ta-speed'], ['maxForce', '#ta-force'], ['distance', '#ta-distance']];
    for (const [field, sel] of fields) {
      const v = $(sel).value.trim();
      if (v !== '') payload[field] = Number(v);
    }
    if (!payload.profileId) { errEl.textContent = 'Pick the athlete first.'; return; }
    try {
      await apiPost('/api/devices/tapex/entry', payload);
      const pr = state.profiles.find(x => x.id === payload.profileId);
      devFlash = 'T-APEX entry saved for ' + (pr ? pr.name : 'the athlete') + ' (' + payload.date + ').';
      renderDevices();
    } catch (err) { errEl.textContent = err.message; }
  });
}
async function loadTapexEntries() {
  const slot = $('#ta-entries-slot');
  if (!slot) return;
  try {
    const data = await api('/api/devices/tapex/entries');
    slot.innerHTML = data.entries.length ? data.entries.map((e, i) => {
      const vals = Object.entries(e.values)
        .map(([f, v]) => esc(TAPEX_FIELD_LABELS[f] || f) + ' <strong>' + esc(fmtNum(v)) + '</strong>').join(' · ');
      const extra = (e.extra || [])
        .map(x => esc(x.name) + ' <strong>' + esc(fmtNum(x.value)) + '</strong>').join(' · ');
      return `<div class="roster-row"><span><strong>${esc(e.athleteName)}</strong> · ${esc(e.date)}</span>
        <span>${[vals, extra].filter(Boolean).join(' · ')}
        <button class="btn secondary" data-ta-del="${i}" type="button" style="width:auto">Delete</button></span></div>`;
    }).join('') : '<p class="muted">No T-APEX entries yet.</p>';
    slot.querySelectorAll('[data-ta-del]').forEach(b => b.addEventListener('click', async () => {
      const entry = data.entries[Number(b.dataset.taDel)];
      if (!entry) return;
      if (!confirm('Delete the T-APEX entry for ' + entry.athleteName + ' on ' + entry.date + '?')) return;
      try {
        for (const id of entry.resultIds) {
          await apiDel('/api/results/' + encodeURIComponent(id));
        }
        devFlash = 'Deleted the T-APEX entry for ' + entry.athleteName + ' (' + entry.date + ').';
        renderDevices();
      } catch (err) { alert(err.message); }
    }));
  } catch (err) {
    slot.innerHTML = '<p class="error">' + esc(err.message) + '</p>';
  }
}
function renderValdApiPanel(panel) {
  panel.innerHTML = `
    <div class="card">
      <h2>VALD API <span class="badge plain">NOT CONNECTED</span></h2>
      <p>API credentials have been requested from VALD. When they arrive, this panel is where the connection gets configured — and once it is live, ForceDecks and NordBord results will sync automatically instead of being imported from files.</p>
      <p class="muted">Until then, use the ForceDecks and NordBord tabs: export the results file from VALD Hub and import it here — every number lands in the athlete's testing history, labeled by device, exactly as a sync would file it.</p>
    </div>`;
}

/* The coach manager: compose form on top, every post below with
   its audience, author, date, and pin state. Any coach can post
   and manage; the feed endpoint already returns coaches the
   full, unfiltered list in feed order (pinned, then newest). */
async function renderAnnouncements() {
  const el = $('#announce-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'Team announcements live here.'); return; }
  try {
    const data = await api('/api/announcements');
    state.announcements = data.announcements || [];
  } catch (err) {
    el.innerHTML = '<p class="error">Could not load announcements: ' + esc(err.message) + '</p>';
    return;
  }
  const posts = state.announcements;
  const editing = state.annEditId ? posts.find(a => a.id === state.annEditId) : null;
  if (state.annEditId && !editing) state.annEditId = null;
  const audOpts = (sel) => `<option value="team" ${sel === 'team' ? 'selected' : ''}>Whole team</option>`
    + state.groups.map(g => `<option value="${g.id}" ${sel === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
  el.innerHTML = `
    <form class="card" id="ann-form">
      <h2>${editing ? 'Edit announcement' : 'New announcement'}</h2>
      <label>Title <span class="muted">(optional)</span> <input type="text" id="ann-title" maxlength="80" value="${editing ? esc(editing.title) : ''}" placeholder="e.g. Practice moved to 4 PM"></label>
      <label>Message <textarea id="ann-body" rows="4" maxlength="2000" required placeholder="What does the team need to know?">${editing ? esc(editing.body) : ''}</textarea></label>
      <div class="filter-row">
        <label>Send to <select id="ann-audience">${audOpts(editing ? editing.audience : 'team')}</select></label>
      </div>
      <label class="check-line"><input type="checkbox" id="ann-pinned" ${editing && editing.pinned ? 'checked' : ''}> Pin to the top of the feed</label>
      <button class="btn primary" type="submit">${editing ? 'Save changes' : 'Post announcement'}</button>
      ${editing ? '<button class="btn secondary" id="ann-cancel" type="button">Cancel edit</button>' : ''}
      <p class="error" id="ann-err"></p>
    </form>
    ${posts.length
      ? posts.map(a => announcePostHtml(a, true)).join('')
      : '<div class="card"><h2>No announcements yet</h2><p class="muted">Posts to the whole team — or to one group — show up here and on every athlete\'s Today page. Meet-week reminders, schedule changes, what to bring: one post and the whole team has it.</p></div>'}`;
  el.querySelectorAll('[data-ann-edit]').forEach(b => b.addEventListener('click', () => {
    state.annEditId = b.dataset.annEdit;
    renderAnnouncements();
    const f = $('#ann-form');
    if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  el.querySelectorAll('[data-ann-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this announcement? Athletes will no longer see it.')) return;
    try {
      await apiDel('/api/announcements/' + encodeURIComponent(b.dataset.annDel));
      if (state.annEditId === b.dataset.annDel) state.annEditId = null;
      renderAnnouncements();
      renderAnnouncePanel();
    } catch (err) { alert(err.message); }
  }));
  const cancelBtn = $('#ann-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { state.annEditId = null; renderAnnouncements(); });
  $('#ann-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: $('#ann-title').value,
      body: $('#ann-body').value,
      audience: $('#ann-audience').value,
      pinned: $('#ann-pinned').checked,
    };
    try {
      if (state.annEditId) await apiPut('/api/announcements/' + encodeURIComponent(state.annEditId), payload);
      else await apiPost('/api/announcements', payload);
      state.annEditId = null;
      renderAnnouncements();
      renderAnnouncePanel();
    } catch (err) { $('#ann-err').textContent = err.message; }
  });
}

/* ================================================================
   WEIGHT ROOM — the multi-athlete floor view. Coach-only. One
   panel per athlete, big enough to read across the room: today's
   session resolved server-side exactly like the checklist
   (resolveAssignment), or one custom workout the coach puts on
   every panel — with each athlete's own % of max load computed
   server-side per panel. The coach walks each panel with Prev /
   Next (position persists in db.floorProgress via
   /api/weight-room/progress) and marks the session done through
   the same POST /api/completions the checklist uses — there is
   no second completion store. Nothing here is athlete-entered,
   and no wellness, health, or notes data is ever fetched.
   ================================================================ */
const WR_REFRESH_MS = 60 * 1000;   /* re-resolve while the floor view is open */
let wrRefreshTimer = null;

function enterWeightRoom() {
  renderWeightRoom();
  if (wrRefreshTimer) clearInterval(wrRefreshTimer);
  wrRefreshTimer = setInterval(() => { renderWeightRoom(); }, WR_REFRESH_MS);
}
function exitWeightRoom() {
  if (wrRefreshTimer) { clearInterval(wrRefreshTimer); wrRefreshTimer = null; }
}

/* The step walk a panel shows, built with the runner's own core:
   a custom workout walks as itself; a library session walks via
   sessionToRunnerPlan, the same mapping the runner uses. */
function wrStepsFor(panel, floorWorkout) {
  if (floorWorkout) return buildRunnerSteps(floorWorkout);
  const a = panel.assignment;
  if (!a || !a.sessionId) return [];
  const s = state.sessions.get(a.sessionId);
  return s ? buildRunnerSteps(sessionToRunnerPlan(s)) : [];
}
function wrWorkoutKey(panel, floorWorkout) {
  if (floorWorkout) return 'cw:' + floorWorkout.id;
  const a = panel.assignment;
  return a && a.sessionId ? 'session:' + a.sessionId : null;
}
/* A runner step's % prescription, matched to the panel's own
   server-computed load (loadsForProfile's collapsed shape). */
function wrLoadFor(panel, step) {
  if (!step || !step.load || !Array.isArray(panel.loads)) return null;
  const L = step.load;
  return panel.loads.find(x => x.name === step.name && x.testKey === L.testKey &&
    x.percent === L.percent && x.sets === L.sets && x.reps === L.reps) || null;
}
function wrStepLine(panel, step) {
  if (step.type === 'rest') return `<span class="muted">Rest ${esc(step.seconds)}s</span>`;
  const load = wrLoadFor(panel, step);
  let loadHtml = '';
  if (step.load) {
    loadHtml = load && load.weight !== null && load.weight !== undefined
      ? ' — ' + loadCellText({ weight: load.weight, max: load.max }, step.load.percent)
      : ' — <span class="muted">No max on file</span>';
  }
  return `<strong>${esc(step.name)}</strong>${step.reps ? ` <span class="muted">× ${esc(step.reps)}</span>` : ''}${loadHtml}`;
}

async function renderWeightRoom() {
  const el = $('#weightroom-main');
  if (!el) return;
  if (!isCoachUser()) { gateHtml(el, 'The weight room floor view lives here.'); return; }
  const date = todayStr();
  const params = new URLSearchParams({ date });
  if (state.wrGroupId) params.set('groupId', state.wrGroupId);
  if (state.wrWorkoutId) params.set('workoutId', state.wrWorkoutId);
  let data, workouts;
  try {
    [data, workouts] = await Promise.all([
      api('/api/weight-room?' + params.toString()),
      api('/api/custom-workouts'),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">Could not load the weight room: ${esc(err.message)}</p><button class="btn secondary" id="wr-retry" type="button">Retry</button></div>`;
    const rb = $('#wr-retry'); if (rb) rb.addEventListener('click', renderWeightRoom);
    return;
  }
  state.wrData = data;
  state.wrUpdatedAt = new Date();
  state.cwWorkouts = workouts.workouts || [];
  const floorWorkout = state.wrWorkoutId
    ? state.cwWorkouts.find(w => w.id === state.wrWorkoutId) || null : null;
  if (state.wrWorkoutId && !floorWorkout) state.wrWorkoutId = '';

  const groupOpts = ['<option value="">All groups</option>'].concat(
    (data.groups || []).map(g =>
      `<option value="${esc(g.id)}" ${g.id === state.wrGroupId ? 'selected' : ''}>${esc(g.name)}</option>`)).join('');
  const workoutOpts = ['<option value="">Today\'s assignment</option>'].concat(
    state.cwWorkouts.map(w =>
      `<option value="${esc(w.id)}" ${w.id === state.wrWorkoutId ? 'selected' : ''}>${esc(w.title)}</option>`)).join('');
  const colsOpts = [['auto', 'Auto'], ['2', '2 across'], ['3', '3 across']].map(([v, label]) =>
    `<option value="${v}" ${v === state.wrCols ? 'selected' : ''}>${label}</option>`).join('');

  el.innerHTML = `
    <div class="card wr-setup">
      <div class="filter-row">
        <label>Group <select id="wr-group">${groupOpts}</select></label>
        <label>On the floor <select id="wr-workout">${workoutOpts}</select></label>
        <label>Panels <select id="wr-cols">${colsOpts}</select></label>
        <button class="btn secondary" id="wr-refresh" type="button">Refresh</button>
      </div>
      <p class="muted" style="margin-bottom:0">${esc(fmtDate(parseDate(data.date)))} · ${data.panels.length} member${data.panels.length === 1 ? '' : 's'} on the floor · updated ${state.wrUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · re-checks itself every minute while open</p>
    </div>
    ${data.panels.length
      ? `<div class="wr-grid" data-cols="${esc(state.wrCols)}">${data.panels.map(p => wrPanelHtml(p, floorWorkout)).join('')}</div>`
      : '<div class="card"><p class="muted">No members in this group yet — add them in Roster &amp; Groups.</p></div>'}`;
  $('#wr-group').addEventListener('change', (e) => { state.wrGroupId = e.target.value; renderWeightRoom(); });
  $('#wr-workout').addEventListener('change', (e) => { state.wrWorkoutId = e.target.value; renderWeightRoom(); });
  $('#wr-cols').addEventListener('change', (e) => { state.wrCols = e.target.value; renderWeightRoom(); });
  $('#wr-refresh').addEventListener('click', renderWeightRoom);
  el.querySelectorAll('[data-wr-panel]').forEach(panelEl => wrWirePanel(panelEl, data, floorWorkout));
}

function wrPanelHtml(panel, floorWorkout) {
  const pr = panel.profile;
  const key = wrWorkoutKey(panel, floorWorkout);
  const steps = wrStepsFor(panel, floorWorkout);
  const prog = key && panel.progress ? panel.progress[key] : null;
  const cur = prog ? Math.min(prog.step, steps.length) : 0;
  const a = panel.assignment;
  /* What this panel is running: the floor workout when one is
     picked, else the athlete's own resolved assignment. */
  let titleHtml, stepsWorkout = !!floorWorkout;
  if (floorWorkout) {
    titleHtml = `<strong>${esc(floorWorkout.title)}</strong> <span class="badge plain">CUSTOM WORKOUT</span>`;
  } else if (a && a.sessionId) {
    const others = (a.codes || []).filter(c => c.id !== a.sessionId);
    titleHtml = `<strong>${esc(a.sessionId)} · ${esc(a.sessionName)}</strong>
      ${a.source === 'override' ? '<span class="badge plain">YOUR PICK</span>' : '<span class="badge plain">FROM THE PLAN</span>'}
      ${others.length ? `<br><span class="muted">Also today: ${others.map(c => esc(c.id)).join(', ')}</span>` : ''}`;
  } else {
    titleHtml = '';
    stepsWorkout = false;
  }
  const statusChip = panel.completed
    ? '<span class="badge low">COMPLETED ✓</span>'
    : steps.length
      ? `<span class="badge plain">STEP ${Math.min(cur + 1, steps.length)} OF ${steps.length}</span>`
      : '';
  const stepsHtml = steps.length ? `
    <ol class="wr-steps">
      ${steps.map((s, i) => `<li class="wr-step${i === cur && !panel.completed ? ' current' : ''}${panel.completed || i < cur ? ' done' : ''}">${wrStepLine(panel, s)}</li>`).join('')}
    </ol>` : '';
  const controls = panel.completed
    ? `<div class="filter-row"><button class="btn secondary" data-wr-undo="${esc(pr.id)}" type="button">Undo completion</button></div>`
    : stepsWorkout && steps.length
      ? `<div class="filter-row">
           <button class="btn secondary" data-wr-prev="${esc(pr.id)}" type="button" ${cur === 0 ? 'disabled' : ''}>← Prev</button>
           <button class="btn secondary" data-wr-next="${esc(pr.id)}" type="button" ${cur >= steps.length ? 'disabled' : ''}>Next →</button>
           <button class="btn primary" data-wr-complete="${esc(pr.id)}" type="button">Complete session</button>
         </div>`
      : '';
  const emptyHtml = !floorWorkout && !(a && a.sessionId)
    ? `<p class="muted">${a && a.isOff ? 'Off day in the plan — no session today.' : 'No session assigned today.'}</p>
       <p><button class="btn secondary" data-wr-checklist="${esc(pr.id)}" type="button">Open Today's Checklist to assign</button></p>`
    : '';
  return `
  <div class="card wr-panel" data-wr-panel="${esc(pr.id)}">
    <div class="roster-row">
      <span><strong>${esc(pr.name)}</strong>${pr.groupName ? ` <span class="muted">· ${esc(pr.groupName)}</span>` : ''}</span>
      ${statusChip}
    </div>
    ${titleHtml ? `<p class="wr-title">${titleHtml}</p>` : ''}
    ${!floorWorkout && a && a.note ? `<p class="muted">Note: ${esc(a.note)}</p>` : ''}
    ${emptyHtml}
    ${stepsHtml}
    ${controls}
    <p class="error" data-wr-err hidden></p>
  </div>`;
}

function wrWirePanel(panelEl, data, floorWorkout) {
  const pid = panelEl.dataset.wrPanel;
  const panel = (data.panels || []).find(p => p.profile.id === pid);
  if (!panel) return;
  const errEl = panelEl.querySelector('[data-wr-err]');
  const fail = (err) => { if (errEl) { errEl.textContent = err.message; errEl.hidden = false; } };
  const key = wrWorkoutKey(panel, floorWorkout);
  const steps = wrStepsFor(panel, floorWorkout);
  const prog = key && panel.progress ? panel.progress[key] : null;
  const cur = prog ? Math.min(prog.step, steps.length) : 0;
  const move = async (nextStep) => {
    try {
      await apiPost('/api/weight-room/progress', {
        profileId: pid, date: data.date, workoutKey: key, step: nextStep, total: steps.length,
      });
      renderWeightRoom();
    } catch (err) { fail(err); }
  };
  const prevBtn = panelEl.querySelector('[data-wr-prev]');
  if (prevBtn) prevBtn.addEventListener('click', () => move(Math.max(0, cur - 1)));
  const nextBtn = panelEl.querySelector('[data-wr-next]');
  if (nextBtn) nextBtn.addEventListener('click', () => move(Math.min(steps.length, cur + 1)));
  const doneBtn = panelEl.querySelector('[data-wr-complete]');
  if (doneBtn) doneBtn.addEventListener('click', async () => {
    try {
      /* The checklist's own write: the completion record it has
         always used, with the floor workout named in marks when
         the panel was running one. */
      const marks = floorWorkout ? 'Weight room · ' + floorWorkout.title : '';
      await apiPost('/api/completions', { profileId: pid, date: data.date, marks });
      renderWeightRoom();
    } catch (err) { fail(err); }
  });
  const undoBtn = panelEl.querySelector('[data-wr-undo]');
  if (undoBtn) undoBtn.addEventListener('click', async () => {
    try {
      await apiPost('/api/completions', { profileId: pid, date: data.date, completed: false });
      renderWeightRoom();
    } catch (err) { fail(err); }
  });
  const listBtn = panelEl.querySelector('[data-wr-checklist]');
  if (listBtn) listBtn.addEventListener('click', () => { state.feedDate = data.date; showView('coach'); });
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
let tvClockTimer = null;
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
      if (!a.sessionId) {
        units.push({
          name: g.group.name, label: g.group.name + ' · Rest day', rest: true,
          source: a.source, sessionId: null, sessionName: '',
          sessions: [], planText: a.planText || '', cardId: 'rest', warmup: null,
        });
        continue;
      }
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
  if (unit.rest) {
    const next = tvNextTrainingDay();
    const nextLine = next
      ? `Next up: ${next.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} \u2014 ${esc(next.names)}`
      : 'The next training day will appear here once it is on the plan.';
    return `<div class="tv-fit">
    ${tvWodHeaderHtml()}
    <div class="tv-page-group">${esc(unit.name)}</div>
    <div class="tv-empty">
      <p class="tv-empty-big">Rest day</p>
      <p class="tv-empty-sub">No workout for this group today. ${nextLine}</p>
    </div>
  </div>`;
  }
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
    const today = await api('/api/coach/today?board=1');
    state.tvData = { today };
    state.tvLastOk = new Date();
    state.tvStale = false;
  } catch (_) {
    /* A failed refresh keeps the last good board on screen — and says so. */
    state.tvStale = true;
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
  const upd = $('#tv-updated');
  if (upd) {
    if (state.tvStale) {
      upd.textContent = `⚠ Connection lost — showing the board from ${state.tvLastOk ? state.tvLastOk.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'earlier'}`;
      upd.classList.add('stale');
    } else if (state.tvLastOk) {
      upd.textContent = 'Updated ' + state.tvLastOk.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      upd.classList.remove('stale');
    }
  }
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
  /* The clock keeps time even when reduced motion stops the rotation. */
  tvClockTimer = setInterval(tvUpdateClock, 30000);
}
function tvStopTimers() {
  if (tvRotateTimer) { clearInterval(tvRotateTimer); tvRotateTimer = null; }
  if (tvRefreshTimer) { clearInterval(tvRefreshTimer); tvRefreshTimer = null; }
  if (tvClockTimer) { clearInterval(tvClockTimer); tvClockTimer = null; }
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
  renderExercises();
  renderEducation();
  $('#guide-doc').innerHTML = md(state.content.guide);
  $('#season-doc').innerHTML = md(state.content.season);
  $('#log-date').value = todayStr();
  try { state.user = await api('/api/me'); } catch (_) { state.user = null; }
  try { state.wuOverrides = (await api('/api/warmup-cards')).cards || {}; } catch (_) { state.wuOverrides = {}; }
  await refreshUserData();
  /* syncAuthUi (not the individual renders) is what un-hides the Coach
     tabs for a coach whose session survived a reload. */
  syncAuthUi();
  if (state.user) showView('home');
  showAppUpdatedToast();
  renderLibrary();
})();
