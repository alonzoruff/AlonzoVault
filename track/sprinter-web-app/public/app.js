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

/* ---------------- navigation ---------------- */
function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('#main-tabs .tab').forEach(t => {
    const main = ['home', 'library', 'season', 'log', 'cards', 'nutrition', 'testing', 'top', 'health', 'groups', 'coach'].includes(name) ? name : 'more';
    t.classList.toggle('active', t.dataset.view === main);
  });
  window.scrollTo(0, 0);
}
$$('#main-tabs .tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
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
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const rowEl = e.target.closest('[data-session]');
  if (rowEl) { openSession(rowEl.dataset.session); return; }
  const codeEl = e.target.closest('[data-code]');
  if (codeEl) openSession(codeEl.dataset.code);
});

/* ---------------- home ---------------- */
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

  let daysHtml = DAY_KEYS.map(dk => {
    const info = dayInfo(wk, dk);
    const isToday = inSeason && dk === todayKey;
    return dayCardHtml(wk, dk, info, { highlight: isToday });
  }).join('');

  $('#home-content').innerHTML = `
    <h1>Today</h1>
    ${LANE_DIVIDER}
    <p>${statusLine}</p>
    ${isCoachUser() ? '<div id="coach-today"></div>' : ''}
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
    </div>`).join('') : '<p class="muted">No groups yet — set them up in Groups.</p>';
  const open = data.healthFlags || [];
  const healthHtml = open.length ? open.slice(0, 8).map(c => `
    <div class="roster-row">
      <span>${c.flagged ? '🚩 ' : ''}<strong>${esc(c.athleteName)}</strong> — ${esc(AREA_LABELS[c.area] || c.area)} (${esc(c.side)}), pain ${c.pain}/10${c.impact === 'stopped' ? ' · stopped training' : ''}</span>
      <span class="badge ${c.status === 'new' ? 'high' : 'plain'}">${esc(STATUS_LABELS[c.status] || c.status).toUpperCase()}</span>
    </div>`).join('') + (open.length > 8 ? `<p class="muted">…and ${open.length - 8} more open in Health.</p>` : '')
    : '<p class="muted">No open health flags. Good news.</p>';
  el.innerHTML = `<div class="card">
    <h2>Coach summary</h2>
    <p class="muted">${esc(fmtDate(parseDate(data.date)))} · ${planLabel}</p>
    <h3>Today's assignments</h3>
    ${groupsHtml}
    <p><button class="btn secondary" id="ct-open-coach" type="button">Open today's checklist</button></p>
    <h3>Health flags${open.length ? ` (${open.length} open)` : ''}</h3>
    ${healthHtml}
    <p><button class="btn secondary" id="ct-open-health" type="button">Open Health</button></p>
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
      <div id="coach-accounts"></div>`;
    renderCoachAccounts();
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
  renderGroups(); renderCoach(); renderTesting(); renderTop(); renderHealth();
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
      ${u.id !== state.user.id ? `<button class="btn secondary" data-role-toggle="${u.id}" data-role="${u.role === 'coach' ? 'athlete' : 'coach'}" type="button">${u.role === 'coach' ? 'Remove coach access' : 'Make coach'}</button>` : '<span class="muted">you</span>'}</div>`).join('')}
    </div>`;
    el.querySelectorAll('[data-role-toggle]').forEach(b => b.addEventListener('click', async () => {
      try {
        await apiPut('/api/users/' + encodeURIComponent(b.dataset.roleToggle) + '/role', { role: b.dataset.role });
        renderCoachAccounts();
      } catch (err) { alert(err.message); }
    }));
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
      <label>Date <input type="date" id="feed-date" value="${esc(state.feedDate)}"></label>
      <p class="muted">Each group gets the season plan's workout by default. Override it when the day calls for something else, then check off who completed it — marks and feel land on the athlete's record.</p>
    </div>
    ${feed.groups.map(groupCard).join('')}
    ${groupCard(feed.unassigned)}`;
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

/* ---------------- wiring ---------------- */
$('#lib-search').addEventListener('input', (e) => { state.libQuery = e.target.value; renderLibrary(); });
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
  $('#guide-doc').innerHTML = md(state.content.guide);
  $('#season-doc').innerHTML = md(state.content.season);
  $('#log-date').value = todayStr();
  try { state.user = await api('/api/me'); } catch (_) { state.user = null; }
  await refreshUserData();
  renderAccount();
  renderLog();
  renderLibrary();
  renderSeason();
  renderHome();
})();
