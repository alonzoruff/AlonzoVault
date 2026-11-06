(function () {
  'use strict';
  /* The server decides everything: levels, unlocks, what can be ticked, what each
     message status says. This file only draws what /api/state returns. */
  var S = null;
  var busy = {};
  var closedBriefing = false;
  var briefingFocused = false;
  var ready = false;

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function local(key, val) {
    try {
      if (val === undefined) { var v = localStorage.getItem('portal:' + key); return v === null ? null : JSON.parse(v); }
      localStorage.setItem('portal:' + key, JSON.stringify(val));
    } catch (e) { /* storage can be blocked; the portal still works */ }
    return null;
  }
  function stamp(iso) {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function money(n) { return (Math.round(n * 100) % 100 === 0) ? String(Math.round(n)) : n.toFixed(2); }
  function api(method, url, body) {
    var opt = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(url, opt).then(function (res) {
      return res.text().then(function (t) {
        var json = null; try { json = JSON.parse(t); } catch (e) { /* not json */ }
        return { ok: res.ok, status: res.status, json: json };
      });
    }, function () { return { ok: false, status: 0, json: null, network: true }; });
  }

  /* ---------- pixel sprites ---------- */
  var SPRITES = {
    hero: { c: { '6': '#5aa9ff', '2': '#c58f5f', '5': '#1b1b1b', '3': '#e8ecfa', '4': '#34405a' },
      r: ['000066660000','000666666000','006666666600','000222222000','002522252200','002222222200','000222222000','033333333330','033333333330','003333333300','000444444000','000440044000'] },
    heart: { c: { '1': '#ff6b81', '2': '#ffb3bf' }, r: ['01100110','12111111','11111111','11111111','01111110','00111100','00011000','00000000'] },
    trophy: { c: { '1': '#ffd35a', '2': '#fff0b0' }, r: ['11111111','12111101','11111101','01111110','00111100','00011000','00011000','00111100'] },
    flask: { c: { '1': '#5fd39a', '2': '#c9f5df' }, r: ['00111100','00012000','00011000','00111100','01111110','11111111','11122111','01111110'] },
    coin: { c: { '1': '#f0b84a', '2': '#fff0b0' }, r: ['00111100','01122110','11211111','11211111','11111111','11111111','01111110','00111100'] },
    star: { c: { '1': '#b99cff', '2': '#e4d9ff' }, r: ['00011000','00012000','11111111','01111110','00111100','01111110','01100110','11000011'] },
    lock: { c: { '1': '#a2acd0', '2': '#2f3b74' }, r: ['00111100','01000010','01000010','11111111','11122111','11122111','11111111','11111111'] },
    moon: { c: { '1': '#b99cff' }, r: ['00111100','01111000','11110000','11100000','11100000','11110000','01111000','00111100'] },
    bubble: { c: { '1': '#ffb454' }, r: ['01111110','11111111','11111111','11111111','11111111','01111110','00111000','00010000'] },
    terminal: { c: { '1': '#ff9a78', '2': '#0a0e22' }, r: ['11111111','12222221','12122221','12212221','12122221','12221121','12222221','11111111'] }
  };
  function sprite(name, scale) {
    var s = SPRITES[name] || SPRITES.star;
    var h = s.r.length, w = s.r[0].length;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h; cv.className = 'sprite';
    cv.style.width = (w * scale) + 'px'; cv.style.height = (h * scale) + 'px';
    cv.setAttribute('aria-hidden', 'true');
    var x = cv.getContext('2d');
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var ch = s.r[j].charAt(i);
      if (ch !== '0' && s.c[ch]) { x.fillStyle = s.c[ch]; x.fillRect(i, j, 1, 1); }
    }
    return cv;
  }
  var OWNER_SPRITE = { Luna: 'moon', Char: 'bubble', Claude: 'terminal' };
  var Portal = window.Portal = { SPRITES: SPRITES, sprite: sprite, local: local };

  /* ---------- top offsets: banners and toasts sit under the sticky header ---------- */
  function layoutTop() {
    var hdr = document.querySelector('header.top'), bn = $('banners');
    var root = document.documentElement.style;
    root.setProperty('--hdr', (hdr ? hdr.offsetHeight : 56) + 'px');
    root.setProperty('--bnr', (bn ? bn.offsetHeight : 0) + 'px');
  }
  window.addEventListener('resize', layoutTop);

  /* ---------- toasts: good news goes away in about 4 seconds, errors stay until dismissed ---------- */
  var toasts = {};
  function removeToast(key) {
    var t = toasts[key];
    if (!t) return;
    clearTimeout(t.timer);
    if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
    delete toasts[key];
  }
  function toast(kind, text, key) {
    var box = $('toasts');
    key = key || (kind + ':' + text);
    removeToast(key);
    var isErr = kind === 'error';
    var t = el('div', 'toast ' + (isErr ? 'err' : 'ok'));
    t.appendChild(el('span', 'tt', text));
    if (isErr) {
      t.setAttribute('role', 'alert');
      var x = el('button', 'toastx', 'Dismiss'); x.type = 'button';
      x.addEventListener('click', function () { removeToast(key); layoutTop(); });
      t.appendChild(x);
    }
    box.appendChild(t);
    toasts[key] = { el: t, timer: isErr ? null : setTimeout(function () { removeToast(key); }, 4000) };
    var okKeys = Object.keys(toasts).filter(function (k) { return toasts[k].timer; });   /* only good-news toasts are capped; errors stay */
    while (okKeys.length > 3) removeToast(okKeys.shift());
  }

  /* ---------- banners: level up and new land. In the page flow, never full screen. ---------- */
  function banner(kind, title, line) {
    var box = $('banners');
    var b = el('div', 'banner ' + kind);
    var body = el('div', 'bnb');
    body.appendChild(el('div', 'pix bnt', title));
    if (line) body.appendChild(el('div', 'bnl', line));
    var x = el('button', 'bnx', 'Dismiss'); x.type = 'button';
    function gone() { clearTimeout(timer); if (b.parentNode) b.parentNode.removeChild(b); layoutTop(); }
    x.addEventListener('click', gone);
    add(b, body, x);
    box.appendChild(b);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    var timer = setTimeout(gone, 10000);
    layoutTop();
  }

  /* ---------- what Luna changed: flags, and one combined toast ---------- */
  var flags = local('flags') || {};
  function saveFlags() { local('flags', flags); }
  Portal.flagFor = function (id) { return flags[id] || null; };
  Portal.clearFlag = function (id) {
    if (!flags[id]) return;
    delete flags[id]; saveFlags();
    if (S && Portal.world) Portal.world.update(S);
  };
  function sigOf(q) {
    return JSON.stringify([q.title, q.owner, q.land, q.xp || 0, q.detail || '', q.date || '', q.end || '', q.time || '', q.place || '', q.due || '', q.dueLabel || '', q.owner === 'AJ' ? '' : q.label]);
  }
  function questSnapshot(st) {
    var sigs = {}, land = {}, open = {};
    st.lands.forEach(function (l) {
      open[l.id] = !!l.open;
      (l.quests || []).forEach(function (q) { sigs[q.id] = sigOf(q); land[q.id] = l.id; });
    });
    (st.today.urgent || []).forEach(function (q) { if (!sigs[q.id]) { sigs[q.id] = sigOf(q); land[q.id] = q.land; } });
    return { sigs: sigs, land: land, open: open };
  }
  /* Compares what the server says now with what this device saw last time. Luna's change
     stamps decide whether to look; AJ's own ticks and messages never move them. */
  function liveCheck(st) {
    var C = window.COPY, lv = st.live || {};
    var seen = local('liveSeen'), snap = local('qsnap'), cur = questSnapshot(st);
    var items = [];
    if (seen && snap) {
      if (lv.content !== seen.content) {
        Object.keys(cur.sigs).forEach(function (id) {
          if (!(id in snap.sigs)) {
            if (snap.open && snap.open[cur.land[id]] === false) return;     /* only revealed by an unlock */
            flags[id] = 'fresh';
            var mine = false;
            st.lands.forEach(function (l) { (l.quests || []).forEach(function (q) { if (q.id === id && q.owner === 'AJ') mine = true; }); });
            items.push(mine ? C.toast.lunaAddedTask : C.toast.newQuest);
          } else if (snap.sigs[id] !== cur.sigs[id]) {
            flags[id] = 'updated'; items.push(C.toast.questUpdated);
          }
        });
        if (!items.length) items.push(C.toast.fromLuna);
      }
      if (lv.replies && lv.replies !== seen.replies) items.push(C.toast.fromLuna);
    }
    local('liveSeen', { content: lv.content || null, overnight: lv.overnight || null, replies: lv.replies || null });
    local('qsnap', cur);
    if (items.length) {
      saveFlags();
      toast('ok', items.length === 1 ? items[0] : C.toast.many(items.length), 'live');
    }
  }

  /* ---------- actions ---------- */
  function failToast(r, fallback) {
    if (r.network) toast('error', window.COPY.error.offline, 'offline');
    else if (r.status >= 500 || !r.json || !r.json.error) toast('error', fallback);
    else toast('error', r.json.error);          /* a plain sentence from the server, such as "That land is still locked." */
  }
  function complete(q) {
    if (busy[q.id]) return Promise.resolve({ ok: false });
    busy[q.id] = true;
    return api('POST', '/api/quests/' + q.id + '/complete', {}).then(function (r) {
      delete busy[q.id];
      if (!r.ok) { failToast(r, window.COPY.error.save); if (!r.network) load(); return { ok: false }; }
      S = r.json.state;
      var a = r.json.awarded;
      renderAll();
      if (!r.json.alreadyDone) {
        toast('ok', window.COPY.toast.saved, 'saved');
        if (a.levelTo > a.levelFrom) banner('level', window.COPY.levelUp.title(a.levelTo), window.COPY.say('levelLines'));
        a.unlocked.forEach(function (u) {
          var land = null;
          S.lands.forEach(function (l) { if (l.id === u.id) land = l; });
          var line = window.COPY.unlock.via(q.title);
          if (land && land.total === 0) line += ' ' + window.COPY.unlock.noQuests;
          banner('unlock', window.COPY.unlock.title(u.name), line);
        });
        if (Portal.world) Portal.world.celebrate(q, a);
      }
      return { ok: true, awarded: a };
    });
  }
  function undo(q) {
    if (busy[q.id]) return Promise.resolve({ ok: false });
    busy[q.id] = true;
    return api('POST', '/api/quests/' + q.id + '/undo', {}).then(function (r) {
      delete busy[q.id];
      if (!r.ok) { failToast(r, window.COPY.error.save); if (!r.network) load(); return { ok: false }; }
      S = r.json.state; toast('ok', window.COPY.toast.saved, 'saved'); renderAll();
      return { ok: true };
    });
  }

  /* ---------- quest rows, used in the Today strip, the briefing and the lands ---------- */
  function questRow(q) {
    var row = el('div', 'quest' + (q.done ? ' done' : '') + (q.urgent ? ' urgent' : ''));
    if (q.owner === 'AJ') {
      var t = el('button', 'tick' + (q.done ? ' on' : '')); t.type = 'button';
      t.appendChild(el('i'));
      if (q.canComplete) {
        t.setAttribute('aria-label', 'Mark done: ' + q.title);
        t.addEventListener('click', function () { complete(q); });
      } else {
        t.disabled = true;
        t.setAttribute('aria-label', q.title + ', ' + q.label);
      }
      row.appendChild(t);
    } else {
      var sp = el('div', 'sprite-slot'); sp.appendChild(sprite(OWNER_SPRITE[q.owner] || 'star', 3)); row.appendChild(sp);
    }
    var b = el('div', 'qb');
    b.appendChild(el('div', 'qt', q.title));
    var meta = [];
    if (q.dateLabel) meta.push(q.dateLabel);
    if (q.time) meta.push(q.time);
    if (q.place) meta.push(q.place);
    if (meta.length) b.appendChild(el('div', 'qd', meta.join(', ')));
    var more = [];
    if (q.detail) more.push(q.detail);
    if (q.waitingOn) more.push('Waiting on: ' + q.waitingOn + '.');
    if (more.length) b.appendChild(el('div', 'qd', more.join(' ')));
    var tags = el('div', 'tags');
    tags.appendChild(el('span', 'own ' + q.owner, q.owner));
    tags.appendChild(el('span', 'st ' + (q.kind || ''), q.label));
    if (q.due && !q.done) tags.appendChild(el('span', 'st ' + (q.daysLeft < 0 ? 'late' : q.daysLeft <= 7 ? 'warn' : ''), (q.dueLabel || 'Due') + ', ' + q.leftLabel));
    if (q.owner === 'AJ' && q.xp) tags.appendChild(el('span', 'xpv', '+' + q.xp + ' XP'));
    b.appendChild(tags);
    if (q.canUndo) {
      var u = el('button', 'undo', 'Undo'); u.type = 'button';
      u.addEventListener('click', function () { undo(q); });
      b.appendChild(u);
    }
    row.appendChild(b);
    return row;
  }

  /* ---------- header ---------- */
  function renderHeader() {
    var h = S.hero;
    $('toplv').textContent = h.name + '  LV ' + h.level;
    var b = $('topbar');
    b.firstChild.style.width = Math.round(h.into / h.need * 100) + '%';
    b.setAttribute('role', 'progressbar');
    b.setAttribute('aria-valuemin', '0'); b.setAttribute('aria-valuemax', String(h.need)); b.setAttribute('aria-valuenow', String(h.into));
    b.setAttribute('aria-label', 'XP into level ' + h.level);
  }

  /* ---------- world: today strip, hero, lands ---------- */
  function ouraBars(o, big) {
    var wrap = el('div', big ? 'ouras' : 'stats');
    var any = false;
    [['Sleep', o.sleep], ['Readiness', o.readiness]].forEach(function (s) {
      if (typeof s[1] !== 'number') return;
      any = true;
      var tone = s[1] >= 85 ? 'good' : s[1] >= 70 ? '' : 'warn';
      var bar = el('div', 'bar ' + tone); bar.appendChild(el('i'));
      bar.firstChild.style.width = s[1] + '%';
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(s[1])); bar.setAttribute('aria-label', s[0] + ' score');
      if (big) {
        var c = el('div', 'oc');
        add(c, el('div', 'lab', s[0]), el('div', 'big', String(s[1])), bar);
        wrap.appendChild(c);
      } else {
        var w = el('div'); var lab = el('div', 'barlabel');
        add(lab, el('span', '', s[0]), el('b', '', String(s[1])));
        add(w, lab, bar); wrap.appendChild(w);
      }
    });
    return any ? wrap : null;
  }
  function todayStrip() {
    var T = S.today;
    var c = el('article', 'panel today');
    var dl = el('div', 'dateline');
    add(dl, el('h2', 'pix', T.dateLabel), el('span', 'fresh', S.updatedAt ? 'Luna updated ' + stamp(S.updatedAt) : ''));
    c.appendChild(dl);
    var ob = ouraBars(T.oura, true);
    if (ob) {
      c.appendChild(ob);
      if (T.oura.asOf) c.appendChild(el('p', 'asof', 'Oura: ' + T.oura.asOf + '.'));
    } else {
      c.appendChild(el('p', 'asof', 'No Oura reading in the portal yet. Luna adds sleep and readiness here.'));
    }

    if (S.briefing && S.briefing.overnight) {
      var ov = el('div', 'sect'); ov.appendChild(el('h3', 'pix', 'Overnight'));
      ov.appendChild(el('p', '', S.briefing.overnight.text));
      c.appendChild(ov);
    }
    var sect = el('div', 'sect');
    var head = el('h3', 'pix', 'Start here');
    sect.appendChild(head);
    if (T.suggested) {
      var s = el('div', 'stack');
      s.appendChild(questRow(T.suggested.quest));
      sect.appendChild(s);
      if (T.suggested.picked) {
        var tag = el('span', 'pick', 'Luna’s pick, +' + T.bonusFirst + ' XP bonus');
        tag.style.marginLeft = '8px'; head.appendChild(tag);
      }
    } else {
      sect.appendChild(el('p', 'note', 'Nothing open right now. Nice.'));
    }
    c.appendChild(sect);

    if (T.habits.length) {
      var hs = el('div', 'sect'); hs.appendChild(el('h3', 'pix', 'Daily'));
      var hst = el('div', 'stack'); T.habits.forEach(function (q) { hst.appendChild(questRow(q)); });
      hs.appendChild(hst); c.appendChild(hs);
    }
    if (T.urgent.length) {
      var us = el('div', 'sect'); us.appendChild(el('h3', 'pix', 'Due within a week'));
      var ust = el('div', 'stack'); T.urgent.forEach(function (q) { ust.appendChild(questRow(q)); });
      us.appendChild(ust);
      us.appendChild(el('p', 'note', 'These can be done from here even if their land is still locked.'));
      c.appendChild(us);
    }
    var ps = el('div', 'sect'); ps.appendChild(el('h3', 'pix', 'The party right now'));
    T.party.forEach(function (m) {
      var line = el('div', 'partyline');
      var text = m.active.length ? m.active.map(function (a) { return a.title + ' (' + a.label + ')'; }).join(', ')
        : (m.job.length > 110 ? m.job.slice(0, 107) + '...' : m.job);
      add(line, el('b', '', m.name), el('span', '', text));
      ps.appendChild(line);
    });
    c.appendChild(ps);
    return c;
  }
  var expanded = local('lands-open') || {};
  function frontierId() {
    for (var i = 0; i < S.lands.length; i++) {
      var l = S.lands[i];
      if (l.open && l.cleared < l.total) return l.id;
    }
    return null;
  }
  function isExpanded(l, fid) { return expanded[l.id] !== undefined ? !!expanded[l.id] : l.id === fid; }
  function landCard(l, fid) {
    var open = l.open, exp = open && isExpanded(l, fid);
    var card = el('article', 'land ' + (open ? 'opened' : 'locked'));
    var head = el(open ? 'button' : 'div', 'head');
    if (open) { head.type = 'button'; head.setAttribute('aria-expanded', String(exp)); }
    head.appendChild(sprite(open ? l.icon : 'lock', 4));
    var info = el('div', 'info');
    var nm = el('div', 'pix nmx', l.name);
    if (l.fresh) nm.appendChild(el('span', 'newtag', 'NEW'));
    add(info, nm, el('div', 'bl', l.blurb));
    if (open) {
      var bar = el('div', 'bar good thin prog'); bar.appendChild(el('i'));
      bar.firstChild.style.width = (l.total ? Math.round(l.cleared / l.total * 100) : 0) + '%';
      info.appendChild(bar);
      info.appendChild(el('div', 'lockmsg', l.cleared + ' of ' + l.total + ' quests cleared'));
    } else {
      info.appendChild(el('div', 'lockmsg', l.lockMessage));
    }
    head.appendChild(info);
    if (open) head.appendChild(el('span', 'caret', exp ? '-' : '+'));
    card.appendChild(head);
    if (exp) {
      var body = el('div', 'body');
      if (l.id === 'health') {
        var box = el('div', 'stats');
        box.appendChild(el('div', 'pix tt', 'Character stats' + (S.oura.asOf ? ', Oura ' + S.oura.asOf : ', Oura')));
        var bars = ouraBars(S.oura, false);
        if (bars) { while (bars.firstChild) box.appendChild(bars.firstChild); }
        else box.appendChild(el('p', 'nostat', 'No Oura reading in the portal yet. Luna adds sleep and readiness here.'));
        body.appendChild(box);
      }
      var daily = l.quests.filter(function (q) { return q.daily; });
      if (daily.length) { body.appendChild(el('div', 'daily-label', 'Daily')); daily.forEach(function (q) { body.appendChild(questRow(q)); }); }
      l.quests.filter(function (q) { return !q.daily; }).forEach(function (q) { body.appendChild(questRow(q)); });
      card.appendChild(body);
    }
    if (open) head.addEventListener('click', function () {
      expanded[l.id] = !isExpanded(l, fid); local('lands-open', expanded); renderWorld();
    });
    return card;
  }
  var wmRoot = null, stripBox = null, listBox = null;
  function renderWorld() {
    var v = $('v-world');
    if (!wmRoot) {
      v.innerHTML = '';
      wmRoot = el('div'); stripBox = el('div'); listBox = el('div');
      stripBox.style.marginTop = '14px';
      add(v, wmRoot, stripBox, listBox);
      Portal.world.mount(wmRoot);
    }
    Portal.world.update(S);
    stripBox.innerHTML = ''; stripBox.appendChild(todayStrip());
    listBox.innerHTML = '';
    var d = el('details', 'listview');
    d.open = !!local('list-open');
    var sum = el('summary', 'pix pixsec', 'List view');
    d.appendChild(sum);
    var fid = frontierId(), st = el('div', 'stack');
    S.lands.forEach(function (l) { st.appendChild(landCard(l, fid)); });
    d.appendChild(st);
    d.addEventListener('toggle', function () { local('list-open', d.open); });
    listBox.appendChild(d);
  }

  /* ---------- party, stats, plans ---------- */
  function renderParty() {
    var v = $('v-party'); v.innerHTML = '';
    add(v, el('h2', 'pix', 'The Party'), el('p', 'lede', 'Companions on the road with ' + S.hero.name + '.'));
    var s = el('div', 'stack');
    S.party.forEach(function (p) {
      var c = el('article', 'panel mate');
      var sp = el('div', 'sp'); sp.appendChild(sprite(p.sprite, 6));
      var m = el('div', 'mm');
      add(m, el('h3', 'pix', p.name), el('p', 'role', p.role), el('p', 'k', 'Working on now'), el('p', '', p.job));
      var st = el('span', 'status'); add(st, el('span', 'dot ' + p.state), document.createTextNode(p.status));
      m.appendChild(st);
      var o = p.owned;
      if (o.total) {
        var bits = [o.total + (o.total === 1 ? ' quest' : ' quests')];
        if (o.moving) bits.push(o.moving + ' moving');
        if (o.blocked) bits.push(o.blocked + ' blocked');
        if (o.done) bits.push(o.done + ' done');
        m.appendChild(el('p', 'owned', bits.join(', ')));
      }
      add(c, sp, m); s.appendChild(c);
    });
    v.appendChild(s);
  }
  function renderStats() {
    var v = $('v-stats'); v.innerHTML = '';
    var u = S.usage;
    add(v, el('h2', 'pix', 'Stats'), el('p', 'lede', 'Snapshot from ' + u.snapshot + '. Luna updates these figures. They do not refresh on their own.'));
    var s = el('div', 'stack');
    u.services.forEach(function (x) {
      var c = el('article', 'panel');
      add(c, el('h3', 'pix', x.name), el('p', 'role', x.plan + ' plan'));
      var pr = el('p', 'price', '$' + money(x.price) + ' '); pr.appendChild(el('small', '', 'a month')); c.appendChild(pr);
      if (x.note) c.appendChild(el('p', 'note', x.note));
      if (x.weekly) {
        var w = el('div'); w.style.marginTop = '12px';
        var lab = el('div', 'barlabel'); add(lab, el('span', '', 'Weekly limit used'), el('b', '', x.weekly.usedPct + '%'));
        var bar = el('div', 'bar' + (x.weekly.usedPct >= 85 ? ' warn' : '')); bar.appendChild(el('i'));
        bar.firstChild.style.width = x.weekly.usedPct + '%';
        bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', String(x.weekly.usedPct)); bar.setAttribute('aria-label', x.name + ' weekly limit used');
        add(w, lab, bar); c.appendChild(w);
        c.appendChild(el('p', 'note', 'Resets ' + x.weekly.resets + '.'));
      } else if (x.noLive) c.appendChild(el('p', 'note', x.noLive));
      s.appendChild(c);
    });
    var t = el('article', 'panel'); var row = el('div', 'total');
    add(row, el('span', '', 'Total across the party'), el('span', 'pix big', u.totalLabel));
    t.appendChild(row); s.appendChild(t); v.appendChild(s);
  }
  function renderPlans() {
    var v = $('v-plans'); v.innerHTML = '';
    v.appendChild(el('h2', 'pix', 'Plans'));
    var s = el('div', 'stack');
    S.plans.forEach(function (p) {
      var c = el('article', 'panel');
      c.appendChild(el('h3', 'pix', p.title));
      if (p.summary) c.appendChild(el('p', 'role', p.summary));
      if (p.facts && p.facts.length) {
        var fs = el('div', 'facts');
        p.facts.forEach(function (f) { fs.appendChild(add(el('div', 'fact'), el('span', '', f.label), el('span', '', f.value))); });
        c.appendChild(fs);
      }
      if (p.items && p.items.length) { var ul = el('ul', 'plain'); p.items.forEach(function (i) { ul.appendChild(el('li', '', i)); }); c.appendChild(ul); }
      s.appendChild(c);
    });
    v.appendChild(s);
  }

  /* ---------- talk to the party ---------- */
  var pending = local('pending') || [];
  var flushing = false;
  function savePending() { local('pending', pending); }
  function uid() {
    var a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i = 0; i < 12; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function flushPending() {
    if (flushing || !pending.length) return;
    flushing = true;
    var next = pending[0];
    api('POST', '/api/outbox', { text: next.text, clientId: next.clientId }).then(function (r) {
      flushing = false;
      if (r.ok) {
        pending.shift(); savePending();
        if (!pending.length) removeToast('sync');
        load().then(function () { if (pending.length) flushPending(); });
        return;
      }
      if (r.network || r.status >= 500 || r.status === 429) {
        next.failed = true; savePending(); renderThread();
        toast('error', window.COPY.error.waiting, 'sync');
        return;
      }
      pending.shift(); savePending();
      toast('error', (r.json && r.json.error) || window.COPY.error.save);
      removeToast('sync'); renderThread();
    });
  }
  function withdraw(m) {
    api('POST', '/api/outbox/' + m.id + '/withdraw', {}).then(function (r) {
      if (!r.ok) toast('error', (r.json && r.json.error) || window.COPY.error.save);
      load();
    });
  }
  Portal.sendNote = function (text) {
    pending.push({ clientId: uid(), text: text, at: new Date().toISOString() });
    savePending(); renderThread(); flushPending();
    return Promise.resolve({ queued: true });
  };
  Portal.pendingTexts = function () { return pending.map(function (p) { return p.text; }); };
  var composerBuilt = false;
  function buildTalk() {
    var v = $('v-talk'); v.innerHTML = '';
    var o = S.outboxText;
    v.appendChild(el('h2', 'pix', o.title));
    var thread = el('div', 'thread'); thread.id = 'thread'; v.appendChild(thread);
    var c = el('div', 'panel composer');
    var form = el('form');
    var lab = el('label', 'lab'); lab.setAttribute('for', 'msg');
    lab.appendChild(document.createTextNode('Message for the party. '));
    lab.appendChild(el('small', '', o.label));
    var ta = el('textarea'); ta.id = 'msg'; ta.placeholder = o.placeholder; ta.maxLength = 2000;
    var row = el('div', 'row');
    var send = el('button', 'btn', 'Send'); send.type = 'submit';
    var info = el('span'); info.id = 'sent'; info.setAttribute('role', 'status');
    add(row, send, info); add(form, lab, ta, row);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      if (!text) { info.textContent = 'Write something first.'; return; }
      pending.push({ clientId: uid(), text: text, at: new Date().toISOString() });
      savePending(); ta.value = ''; info.textContent = '';
      renderThread(true); flushPending();
    });
    c.appendChild(form);
    c.appendChild(el('p', 'note', o.note));
    v.appendChild(c);
    composerBuilt = true;
    renderThread();
  }
  function statusKind(label) {
    if (label === 'Done') return 'good';
    if (label === 'Waiting on you') return 'late';
    if (label.indexOf('is on it') > -1 || label.indexOf('Sent to') === 0) return 'warn';
    return '';
  }
  function renderThread(scroll) {
    var t = $('thread'); if (!t) return;
    t.innerHTML = '';
    var msgs = S.outbox.messages;
    if (!msgs.length && !pending.length) t.appendChild(el('p', 'empty', 'Nothing sent yet. Write to the party and Luna will route it.'));
    msgs.forEach(function (m) {
      var b = el('div', 'bubble aj');
      add(b, el('p', '', m.text), el('div', 'ts', stamp(m.at)));
      t.appendChild(b);
      var st = el('div', 'mstatus ' + (m.status === 'withdrawn' ? '' : statusKind(m.label)));
      add(st, el('span', 'dot'), el('span', '', m.label));
      if (m.canWithdraw) {
        var w = el('button', 'linkbtn', 'Withdraw'); w.type = 'button';
        w.addEventListener('click', function () { withdraw(m); });
        st.appendChild(w);
      }
      t.appendChild(st);
      m.replies.forEach(function (r) {
        var rb = el('div', 'bubble party');
        add(rb, el('div', 'from', r.from), el('p', '', r.text), el('div', 'ts', stamp(r.at)));
        t.appendChild(rb);
      });
    });
    pending.forEach(function (p) {
      var b = el('div', 'bubble aj');
      add(b, el('p', '', p.text), el('div', 'ts', stamp(p.at)));
      t.appendChild(b);
      var st = el('div', 'mstatus' + (p.failed ? ' late' : ''));
      add(st, el('span', 'dot'), el('span', '', p.failed ? 'Not sent yet. It is kept on this phone and will send when you are back online.' : 'Sending'));
      t.appendChild(st);
    });
    if (scroll) window.scrollTo(0, document.body.scrollHeight);
  }
  function markSeen() {
    if (!S || !S.outbox.unread) return;
    S.outbox.unread = 0; renderNav();
    api('POST', '/api/outbox/seen', {});
  }

  /* ---------- briefing ---------- */
  function renderBriefing() {
    var box = $('briefing'), b = S.briefing;
    if (!b.show || closedBriefing) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = '';
    var sheet = el('div', 'sheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Morning briefing');
    add(sheet, el('h2', 'pix', 'Morning briefing'), el('p', 'when', S.today.dateLabel));
    if (b.focus) {
      var f = el('div', 'sect'); f.appendChild(el('h3', 'pix', 'First quest of the day'));
      var fs = el('div', 'stack'); fs.appendChild(questRow(b.focus)); f.appendChild(fs);
      if (!b.focus.done) f.appendChild(el('p', 'bonus', 'Luna picked this one. Finishing it earns +' + b.bonus + ' XP on top.'));
      sheet.appendChild(f);
    }
    if (b.soon.length) {
      var so = el('div', 'sect'); so.appendChild(el('h3', 'pix', 'Soon'));
      b.soon.forEach(function (q) {
        var line = el('div', 'partyline');
        add(line, el('b', '', q.inLabel.charAt(0).toUpperCase() + q.inLabel.slice(1)), el('span', '', q.title));
        so.appendChild(line);
      });
      sheet.appendChild(so);
    }
    if (b.overnight) {
      var ov = el('div', 'sect'); ov.appendChild(el('h3', 'pix', 'Overnight'));
      ov.appendChild(el('p', '', b.overnight.text));
      sheet.appendChild(ov);
    }
    var row = el('div', 'row');
    var go = el('button', 'btn', 'Start the day'); go.type = 'button'; go.id = 'briefing-go';
    go.addEventListener('click', dismissBriefing);
    row.appendChild(go); sheet.appendChild(row);
    box.appendChild(sheet);
    box.hidden = false;
    if (!briefingFocused) { briefingFocused = true; go.focus(); }
  }
  function dismissBriefing() {
    closedBriefing = true; $('briefing').hidden = true;
    api('POST', '/api/briefing/dismiss', {});
  }
  $('briefing').addEventListener('click', function (e) { if (e.target === $('briefing')) dismissBriefing(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('briefing').hidden) dismissBriefing(); });

  /* ---------- nav ---------- */
  var ICON = {
    world: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
    party: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M17 14.5c2.4 0 4 1.8 4 4.5"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    plans: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    talk: '<path d="M4 5h16v11H9l-5 4z"/>'
  };
  var TABS = [['world', 'World'], ['party', 'Party'], ['stats', 'Stats'], ['plans', 'Plans'], ['talk', 'Talk']];
  var current = 'world';
  var tabsEl = $('tabs');
  TABS.forEach(function (t) {
    var b = el('button'); b.type = 'button'; b.setAttribute('data-tab', t[0]);
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[t[0]] + '</svg>';
    b.appendChild(el('span', '', t[1]));
    b.addEventListener('click', function () { if (!$('briefing').hidden) dismissBriefing(); show(t[0]); });
    tabsEl.appendChild(b);
  });
  function renderNav() {
    var old = tabsEl.querySelector('.nav-badge'); if (old) old.remove();
    if (S && S.outbox.unread > 0) tabsEl.querySelector('[data-tab="talk"]').appendChild(el('span', 'nav-badge', String(S.outbox.unread)));
  }
  function show(name) {
    current = name;
    TABS.forEach(function (t) {
      $('v-' + t[0]).hidden = t[0] !== name;
      var b = tabsEl.querySelector('[data-tab="' + t[0] + '"]');
      if (t[0] === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    local('tab', name);
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* fine */ }
    window.scrollTo(0, 0);
    if (name === 'talk') { markSeen(); renderThread(true); }
  }

  /* ---------- loading ---------- */
  function renderAll() {
    renderHeader(); renderWorld(); renderParty(); renderStats(); renderPlans();
    if (!composerBuilt) buildTalk(); else renderThread();
    renderNav(); renderBriefing();
    if (current === 'talk') markSeen();
  }
  function lockedNotice() {
    document.body.innerHTML = '';
    var m = el('main'); m.style.paddingTop = '40px';
    add(m, el('h2', 'pix', 'Portal locked'), el('p', '', 'This device is not signed in. Open the link AJ was given, or enter the access key on the front page.'));
    var a = el('a', 'btn', 'Go to the front page'); a.href = '/'; a.style.display = 'inline-flex'; a.style.alignItems = 'center'; a.style.textDecoration = 'none';
    m.appendChild(a); document.body.appendChild(m);
  }
  var wasDown = false;
  function load() {
    return api('GET', '/api/state').then(function (r) {
      if (r.status === 401) { lockedNotice(); return; }
      if (!r.ok) {
        $('offline').hidden = false; wasDown = true;
        if (r.network) toast('error', window.COPY.error.offline, 'offline');
        else toast('error', window.COPY.error.load, 'loadfail');
        return;
      }
      $('offline').hidden = true;
      removeToast('offline'); removeToast('loadfail');
      if (wasDown) { wasDown = false; toast('ok', window.COPY.toast.upToDate, 'live'); }
      S = r.json;
      liveCheck(S);
      if (!ready) { ready = true; renderAll(); startUp(); } else renderAll();
      layoutTop();
    });
  }
  function startUp() {
    var start = (location.hash || '').replace('#', '');
    if (!TABS.some(function (t) { return t[0] === start; })) start = local('tab');
    if (!TABS.some(function (t) { return t[0] === start; })) start = 'world';
    show(start);
    flushPending();
  }
  setInterval(function () { if (!document.hidden) { load(); flushPending(); } }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { load(); flushPending(); } });
  window.addEventListener('online', function () { load(); flushPending(); });
  Portal.state = function () { return S; };
  Portal.complete = complete; Portal.undo = undo;
  Portal.toast = function (kind, text, key) { toast(kind === 'error' ? 'error' : 'ok', text, key); };
  $('v-world').appendChild(el('p', 'note', 'Opening the portal...'));
  $('v-world').hidden = false;
  document.addEventListener('DOMContentLoaded', function () { layoutTop(); load(); });
})();
