/* Meet entry tracker page. Every name saves to the server as it is typed (short pause or
   leaving the field). Until the server confirms, the name is also kept on the phone, so
   closing the page offline loses nothing: it is sent the next time the page opens. */
(function () {
  'use strict';
  const R = window.EntryRules;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const PENDING_KEY = 'entries-pending-v1';
  const FILTER_KEY = 'entries-filter-v1';

  let meets = [];
  let cur = null;          /* { meet, server: names as saved, names: what the page shows } */
  let filter = readLocal(FILTER_KEY) || 'all';
  const timers = new Map();
  const inflight = new Set();
  const slotErrors = new Map();
  let retryTimer = null;

  /* ---------- small helpers ---------- */
  function readLocal(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function writeLocal(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode: server save still works */ } }
  function pendingAll() { try { return JSON.parse(readLocal(PENDING_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function setPending(k, v) { const p = pendingAll(); if (v === null) delete p[k]; else p[k] = v; writeLocal(PENDING_KEY, JSON.stringify(p)); }
  const slotKey = (meetId, evId, i) => meetId + '|' + evId + '|' + i;
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') n.textContent = v; else if (k === 'cls') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  async function api(method, url, body) {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) { /* not json */ }
    return { status: res.status, json };
  }
  function todayET() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); }
  }
  function gender(ev) { return /^Girls\b/.test(ev.name) ? 'g' : /^Boys\b/.test(ev.name) ? 'b' : 'x'; }

  /* ---------- save status in the top bar ---------- */
  function showStatus() {
    const s = $('#save');
    const waiting = Object.keys(pendingAll()).length;
    s.className = 'save';
    if (inflight.size) { s.textContent = 'Saving…'; return; }
    if (waiting) { s.textContent = waiting === 1 ? '1 name not saved yet' : waiting + ' names not saved yet'; s.classList.add('bad'); return; }
    if (cur) { s.textContent = 'All saved'; s.classList.add('ok'); } else s.textContent = '';
  }

  /* ---------- loading ---------- */
  async function start() {
    let r;
    try { r = await api('GET', '/api/entries'); } catch (_) { return fatal('Cannot reach the portal right now. Check the connection and reload.'); }
    if (r.status === 401) return fatal('This page is private. Open your portal link once on this phone, then come back.', true);
    if (r.status !== 200) return fatal((r.json && r.json.error) || 'Could not load the meets.');
    meets = r.json.meets;
    const sel = $('#meet');
    sel.textContent = '';
    for (const m of meets) sel.appendChild(el('option', { value: m.id, text: shortDate(m) + ' · ' + m.name }));
    const fromHash = decodeURIComponent(location.hash.slice(1));
    const today = todayET();
    const next = meets.find((m) => m.date >= today) || meets[meets.length - 1];
    const id = meets.some((m) => m.id === fromHash) ? fromHash : next && next.id;
    if (!id) return fatal('No meets have been added yet.');
    sel.value = id;
    sel.addEventListener('change', () => { location.hash = sel.value; });
    window.addEventListener('hashchange', () => { const h = decodeURIComponent(location.hash.slice(1)); if (h && (!cur || h !== cur.meet.id)) openMeet(h); });
    window.addEventListener('online', flushAll);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushAll(); });
    await openMeet(id);
    flushAll();   /* names left over from other meets, too */
  }
  function shortDate(m) {
    const d = new Date(m.date + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fatal(msg, withLink) {
    const main = $('#main');
    main.textContent = '';
    main.appendChild(el('p', { cls: 'empty', text: msg }));
    if (withLink) main.appendChild(el('p', {}, [el('a', { href: '/', cls: 'back', text: 'Go to the portal' })]));
  }

  async function openMeet(id) {
    $('#meet').value = id;
    let r;
    try { r = await api('GET', '/api/entries/' + encodeURIComponent(id)); } catch (_) { return fatal('Cannot reach the portal right now. Names typed earlier are still on this phone and will be sent when it reconnects.'); }
    if (r.status === 401) return fatal('This page is private. Open your portal link once on this phone, then come back.', true);
    if (r.status !== 200) return fatal((r.json && r.json.error) || 'Could not load that meet.');
    const server = clone(r.json.names);
    const names = clone(r.json.names);
    /* anything typed here that the server has not confirmed yet wins on screen */
    const pend = pendingAll();
    for (const [k, v] of Object.entries(pend)) {
      const [mId, evId, i] = k.split('|');
      if (mId !== id) continue;
      (names[evId] = names[evId] || [])[Number(i)] = v.name;
    }
    cur = { meet: r.json.meet, server, names };
    if (document.title) document.title = 'Entries · ' + cur.meet.name;
    render();
    flushMeet(id);
  }
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));

  /* ---------- rendering ---------- */
  function render() {
    const m = cur.meet;
    const main = $('#main');
    main.textContent = '';
    const head = el('section', { cls: 'meet' });
    head.appendChild(el('h1', { text: m.name }));
    const facts = el('ul', { cls: 'facts' });
    facts.appendChild(el('li', {}, [el('b', { text: m.dateLabel || m.date }), m.place ? ' · ' + m.place : '']));
    if (m.entriesClose) {
      const soon = daysUntil(m.date) <= 7 && daysUntil(m.date) >= 0;
      facts.appendChild(el('li', { cls: soon ? 'close-soon' : null }, ['Entries close: ', el('b', { text: m.entriesClose })]));
    }
    head.appendChild(facts);
    if (m.events.length) {
      head.appendChild(el('div', { cls: 'total' }, [el('span', { cls: 'num', id: 'tot' }), el('span', { cls: 'of', id: 'totof' })]));
      head.appendChild(el('div', { cls: 'meter', 'aria-hidden': 'true' }, [el('i', { id: 'meter' })]));
    }
    if (m.note) head.appendChild(el('p', { cls: 'note', text: m.note }));
    head.appendChild(el('div', { id: 'heads' }));
    const rules = (m.rules || []).map((r) => r.note).filter(Boolean);
    head.appendChild(el('p', { cls: 'limits', text: rules.length ? 'Double limits: ' + rules.join(' ') + ' The page warns but never stops a save.' : 'This meet has not published a double limit, so no double warnings here.' }));
    main.appendChild(head);
    if (!m.events.length) { refresh(); return; }

    const gs = new Set(m.events.map(gender));
    if (gs.has('g') && gs.has('b')) {
      const bar = el('div', { cls: 'filter', role: 'group', 'aria-label': 'Show events' });
      for (const [v, label] of [['all', 'All'], ['g', 'Girls'], ['b', 'Boys']]) {
        const b = el('button', { type: 'button', 'aria-pressed': String(filter === v), text: label });
        b.addEventListener('click', () => { filter = v; writeLocal(FILTER_KEY, v); render(); });
        bar.appendChild(b);
      }
      main.appendChild(bar);
    }
    const groups = [['field', 'Field events'], ['run', 'Running events'], ['relay', 'Relays']];
    for (const [kind, title] of groups) {
      const evs = m.events.filter((e) => e.kind === kind && (filter === 'all' || gender(e) === filter || gender(e) === 'x'));
      if (!evs.length) continue;
      main.appendChild(el('h2', { cls: 'group', text: title }));
      for (const ev of evs) main.appendChild(eventCard(ev));
    }
    refresh();
  }
  function daysUntil(ymd) { return Math.round((Date.parse(ymd + 'T12:00:00Z') - Date.parse(todayET() + 'T12:00:00Z')) / 86400000); }

  function eventCard(ev) {
    const m = cur.meet;
    const total = R.slotCount(m, ev);
    const list = cur.names[ev.id] || [];
    const rows = Math.max(total, list.length);
    const card = el('section', { cls: 'ev', 'data-ev': ev.id, 'aria-label': ev.name });
    card.appendChild(el('div', { cls: 'ev-head' }, [el('h3', { text: ev.name }), el('span', { cls: 'count', 'data-count': ev.id })]));
    const slots = el('div', { cls: 'slots' });
    for (let i = 0; i < rows; i++) {
      const extra = i >= total;
      const input = el('input', {
        type: 'text', value: list[i] || '', placeholder: extra ? 'Over the limit' : (ev.kind === 'relay' ? 'Relay runner' : 'Athlete'),
        autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'next', maxlength: String(R.MAX_NAME),
        list: 'athletes', 'aria-label': ev.name + ', entry ' + (i + 1) + (extra ? ' (over the limit)' : '')
      });
      input.dataset.ev = ev.id; input.dataset.i = String(i);
      input.addEventListener('input', onInput);
      input.addEventListener('blur', onBlur);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(input); } });
      const row = el('div', { cls: 'slot' + (extra ? ' extra' : ''), 'data-slot': ev.id + '|' + i }, [el('span', { cls: 'n', text: extra ? '+' : String(i + 1) }), input]);
      slots.appendChild(row);
    }
    card.appendChild(slots);
    if (rows > total) card.appendChild(el('p', { cls: 'ev-note', text: 'This event now has ' + total + ' slots. Names in the + rows are kept until you clear them.' }));
    return card;
  }
  function focusNext(input) {
    const all = [...document.querySelectorAll('.slot input')];
    const n = all[all.indexOf(input) + 1];
    if (n) n.focus(); else input.blur();
  }

  /* counts, warnings and the datalist, without rebuilding the inputs (keeps focus and keyboard) */
  function refresh() {
    if (!cur) return;
    const m = cur.meet;
    const v = R.review(m, cur.names);
    if ($('#tot')) {
      $('#tot').textContent = v.filled + ' / ' + v.total;
      $('#totof').textContent = 'entry slots filled across ' + m.events.length + ' events';
      $('#meter').style.width = (v.total ? Math.round(100 * v.filled / v.total) : 0) + '%';
    }
    const heads = $('#heads');
    heads.textContent = '';
    const lines = R.summary(v.warnings);
    if (lines.length) {
      heads.appendChild(el('div', { cls: 'heads', role: 'status' }, [el('h2', { text: 'Heads up' }), el('ul', {}, lines.map((t) => el('li', { text: t })))]));
    }
    const pend = pendingAll();
    for (const ev of m.events) {
      const card = document.querySelector('.ev[data-ev="' + ev.id + '"]');
      if (!card) continue;
      const c = v.events[ev.id];
      card.querySelector('[data-count]').textContent = c.filled + ' / ' + c.total + (c.extra ? ' (+' + c.extra + ')' : '');
      card.classList.toggle('full', c.filled === c.total);
      let warned = false;
      for (const row of card.querySelectorAll('.slot')) {
        const input = row.querySelector('input');
        const i = Number(input.dataset.i);
        const k = R.key(input.value);
        const msgs = k ? v.warnings.filter((w) => w.athlete === k && w.events.includes(ev.id)).map((w) => w.message) : [];
        const err = slotErrors.get(ev.id + '|' + i);
        if (err) msgs.push(err);
        row.classList.toggle('warned', msgs.length > 0);
        row.classList.toggle('unsaved', !!pend[slotKey(m.id, ev.id, i)]);
        let msg = row.querySelector('.slot-msg');
        const text = [...new Set(msgs)].join(' ');
        if (text) {
          if (!msg) { msg = el('div', { cls: 'slot-msg' }); row.appendChild(msg); }
          msg.textContent = text;
        } else if (msg) msg.remove();
        if (msgs.length) warned = true;
      }
      card.classList.toggle('warned', warned);
    }
    const dl = $('#athletes');
    dl.textContent = '';
    const seen = new Map();
    for (const list of Object.values(cur.names)) for (const n of list || []) { const c = R.clean(n); if (c && !seen.has(R.key(c))) seen.set(R.key(c), c); }
    for (const n of [...seen.values()].sort()) dl.appendChild(el('option', { value: n }));
    showStatus();
  }

  /* ---------- typing and saving ---------- */
  function onInput(e) {
    const input = e.target;
    const evId = input.dataset.ev, i = Number(input.dataset.i);
    const k = slotKey(cur.meet.id, evId, i);
    (cur.names[evId] = cur.names[evId] || [])[i] = input.value;
    slotErrors.delete(evId + '|' + i);
    const was = (cur.server[evId] || [])[i] || '';
    const old = pendingAll()[k];
    if (R.clean(input.value) === was) setPending(k, null);
    else setPending(k, { name: input.value, was: old ? old.was : was });
    clearTimeout(timers.get(k));
    timers.set(k, setTimeout(() => save(k), 700));
    refresh();
  }
  function onBlur(e) {
    const input = e.target;
    const k = slotKey(cur.meet.id, input.dataset.ev, Number(input.dataset.i));
    if (pendingAll()[k]) { clearTimeout(timers.get(k)); save(k); }
  }

  async function save(k) {
    const p = pendingAll()[k];
    if (!p || inflight.has(k)) return;
    const [meetId, evId, i] = k.split('|');
    inflight.add(k); showStatus();
    let r;
    try {
      r = await api('PUT', '/api/entries/' + encodeURIComponent(meetId) + '/' + encodeURIComponent(evId) + '/' + i, { name: p.name, was: p.was });
    } catch (_) { r = null; }
    inflight.delete(k);
    const latest = pendingAll()[k];
    const onScreen = cur && cur.meet.id === meetId;
    if (r && r.status === 200) {
      if (latest && latest.name !== p.name) {
        /* typed more while that was saving: send the newer text against what was just saved */
        setPending(k, { name: latest.name, was: R.clean(p.name) });
        setTimeout(() => save(k), 0);
      } else setPending(k, null);
      if (onScreen) mergeServer(r.json.names);
    } else if (r && r.status === 409) {
      setPending(k, null);
      const now = (r.json && r.json.current) || '';
      if (onScreen) {
        (cur.server[evId] = cur.server[evId] || [])[Number(i)] = now;
        (cur.names[evId] = cur.names[evId] || [])[Number(i)] = now;
        const input = document.querySelector('.slot[data-slot="' + evId + '|' + i + '"] input');
        if (input) input.value = now;
        slotErrors.set(evId + '|' + i, (r.json && r.json.error) || 'Changed somewhere else.');
      }
    } else if (r && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) {
      setPending(k, null);
      if (onScreen) slotErrors.set(evId + '|' + i, (r.json && r.json.error) || 'That name could not be saved.');
    } else {
      /* offline, signed out or a server hiccup: keep it on the phone and try again */
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flushAll, 10000);
    }
    if (onScreen) refresh(); else showStatus();
  }
  function mergeServer(names) {
    cur.server = clone(names);
    const pend = pendingAll();
    const focused = document.activeElement;
    for (const [evId, list] of Object.entries(names)) {
      for (let i = 0; i < list.length; i++) {
        if (pend[slotKey(cur.meet.id, evId, i)]) continue;
        const input = document.querySelector('.slot[data-slot="' + evId + '|' + i + '"] input');
        if (input === focused) continue;
        (cur.names[evId] = cur.names[evId] || [])[i] = list[i];
        if (input && input.value !== list[i]) input.value = list[i];
      }
    }
  }
  function flushMeet(id) { for (const k of Object.keys(pendingAll())) if (k.startsWith(id + '|')) save(k); }
  function flushAll() { for (const k of Object.keys(pendingAll())) save(k); }

  start();
}());
