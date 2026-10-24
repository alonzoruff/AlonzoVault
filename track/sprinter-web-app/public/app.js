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
    const main = ['home', 'library', 'season', 'log'].includes(name) ? name : 'more';
    t.classList.toggle('active', t.dataset.view === main);
  });
  window.scrollTo(0, 0);
}
$$('#main-tabs .tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => showView(b.dataset.goto)));

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
    <p>${statusLine}</p>
    <div class="card">
      <strong>${c.sessions.length} workouts · ${c.drills.length} drills · ${weeks.length} weeks</strong>
      <p class="muted" style="margin-bottom:0">Mini peak Sat Feb 20, 2027 · Major peak Sat May 15, 2027. Hard days and easy days take turns — never two hard days in a row.</p>
    </div>
    <div class="card">
      <label for="home-search">Find a workout fast</label>
      <input id="home-search" type="search" placeholder="Try “fly”, “tempo”, or a code like SE-02">
      <button class="btn primary" id="home-search-btn" type="button">Search the library</button>
    </div>
    <h2>Week ${wk.week} · ${esc(wk.phase)} · ${esc(wk.load)}</h2>
    <p class="muted">${fmtRange(wk)} — ${esc(wk.focus)}</p>
    ${daysHtml}
    <button class="btn" id="home-open-season" type="button">Open the full season plan</button>
    ${state.user ? '<h2>Your latest log entries</h2><div id="home-logs"></div>' : '<div class="card"><strong>Keep a practice log.</strong><p class="muted">Create a free account to save what your group actually ran, and to save cross-training swaps. <button class="btn secondary" data-goto="account" type="button">Go to account</button></p></div>'}
  `;
  $('#home-search-btn').addEventListener('click', () => {
    state.libQuery = $('#home-search').value;
    $('#lib-search').value = state.libQuery;
    showView('library'); renderLibrary();
  });
  $('#home-open-season').addEventListener('click', () => { state.week = wkNum; renderSeason(); showView('season'); });
  const gotoBtn = $('#home-content [data-goto]');
  if (gotoBtn) gotoBtn.addEventListener('click', () => showView(gotoBtn.dataset.goto));
  if (state.user) renderHomeLogs();
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
    ${byCat[cat].map(d => `<div class="card">
      <strong>${esc(d.id.replace('DRL-', 'Drill '))} · ${esc(d.name)}</strong>
      <div class="muted">${esc(d.distance_or_reps)}</div>
      <p style="margin-bottom:0">${esc(d.coaching_cue)}</p>
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
    ? '<h2>Your entries</h2>' + state.logs.map(logEntryHtml).join('')
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
  if (!state.user) { state.logs = []; state.swaps = {}; return; }
  try {
    const [logs, swaps] = await Promise.all([api('/api/logs'), api('/api/swaps')]);
    state.logs = logs.entries || [];
    state.swaps = swaps.swaps || {};
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
      <p class="muted">Your log entries and cross-training swaps save to this account and are only visible to you.</p>
      <button class="btn" id="acct-logout" type="button">Log out</button></div>`;
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
  renderAccount(); renderLog(); renderSeason(); renderHome();
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
