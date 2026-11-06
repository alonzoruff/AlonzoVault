(function () {
  'use strict';
  /*
   * The World screen: a map of the lands, Zo who walks it, the arrival panel
   * for a quest, and Quick Add. It draws what /api/state returns and asks
   * app.js (window.Portal) to do anything that touches the server. It never
   * works out XP, unlocks or what can be ticked; the server decides those.
   *
   * Wording comes from copy.js. The few extra strings in T below are not in
   * Luna's approved set and are placeholders for Char's pack.
   *
   * No inline style attributes anywhere (the CSP forbids them): positions are
   * SVG attributes, and anything else is set through element.style.
   */
  var P = window.Portal, COPY = window.COPY;
  if (!P || !COPY) return;

  var T = {
    noQuests: 'No quests here yet.',
    cleared: 'cleared',
    newTag: 'NEW',
    mapLabel: 'Map of your lands. Tap a place or a quest and Zo walks there.',
    startedNote: 'Marked in progress on this phone.',
    gone: 'That quest is no longer on the map.',
    opensOn: 'Opens',
    due: 'Due',
    landOpenNow: 'This land is open now.'
  };

  var NS = 'http://www.w3.org/2000/svg';
  var W = 360, PX = 24, PW = 312, HEAD = 38, PLAZA = 26, ROW = 64, GAP = 36, PAD = 10, TOP = 20, BOT = 20;
  var COLS = 4, PITCH = 74, GX = 50, LANE_L = 12, LANE_R = 348;
  var WALK_SPEED = 140, MAX_CROSS = 3, KEY_SPEED = 110, NEAR = 46;

  /* ---------- small helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function sv(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function trunc(t, n) { return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+$/, '') + '…'; }
  function wrapText(t, n) {
    var words = String(t).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      if (cur && (cur + ' ' + w).length > n) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function reduced() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function addDays(ymd, n) {
    var a = ymd.split('-');
    return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n)).toISOString().slice(0, 10);
  }

  /* ---------- state ---------- */
  var S = null;            /* the latest server state */
  var M = null;            /* the drawn model (layout) */
  var sig = '';
  var root, hud, wrap, svg, floats, bubble, bubbleTimer;
  var zoG, zoWalk, zoCheer;
  var zo = { x: 0, y: 0, land: null, dx: 0, dy: 0, dir: 1 };
  var walk = null, keys = {}, raf = 0, lastT = 0;
  var sheetMode = null, sheetId = null;
  var near = null;
  var lastActive = Date.now();
  var prevOpen = null;
  var barW = {};           /* last drawn fill of each land bar, so the bar can grow */
  var ring = null, ringLen = 0;

  /* "In progress" for AJ's own quests is kept on this device only. The server
     has no such state for his quests (they are open or done). */
  function startedMap() { return P.local('started') || {}; }
  function isStarted(id) { return !!startedMap()[id]; }
  function setStarted(id, on) {
    var m = startedMap();
    if (on) m[id] = P.state().today.date; else delete m[id];
    P.local('started', m);
  }

  /* ---------- node status words ---------- */
  function statusOf(q, nextId) {
    var W_ = COPY.status;
    if (q.done) return { key: 'done', word: W_.done };
    if (q.owner !== 'AJ') {
      if (q.label === 'Blocked') return { key: 'blocked', word: W_.blocked };
      if (q.label === 'Ready') return { key: 'ready', word: W_.ready };
      if (q.label === 'Moving') return { key: 'prog', word: W_.inProgress };
      return { key: 'wait', word: q.label };            /* "Waiting on AJ" is shown as it is */
    }
    if (q.state === 'gated' || !q.canComplete) return { key: 'locked', word: W_.locked };
    if (q.due && q.daysLeft < 0) return { key: 'overdue', word: W_.overdue };
    if (isStarted(q.id)) return { key: 'prog', word: W_.inProgress };
    if (nextId === q.id) return { key: 'next', word: W_.upNext };
    var flag = P.flagFor ? P.flagFor(q.id) : null;
    if (flag === 'fresh') return { key: 'fresh', word: W_.fresh };
    if (flag === 'updated') return { key: 'updated', word: W_.updated };
    return { key: 'ready', word: W_.ready };
  }

  /* ---------- layout ---------- */
  function buildModel() {
    var lands = S.lands.map(function (l, i) { return Object.assign({ idx: i }, l); });
    var byLand = {};
    lands.forEach(function (l) { byLand[l.id] = l; });
    var depth = {};
    function dep(id) {
      if (depth[id] !== undefined) return depth[id];
      depth[id] = 0;
      var fr = (byLand[id].from || []).filter(function (f) { return byLand[f] && f !== id; });
      if (fr.length) { var m = 99; fr.forEach(function (f) { m = Math.min(m, dep(f)); }); depth[id] = m + 1; }
      return depth[id];
    }
    lands.forEach(function (l) { dep(l.id); });
    lands.sort(function (a, b) { return depth[a.id] - depth[b.id] || a.idx - b.idx; });   /* Health first */

    var nextId = S.today.suggested ? S.today.suggested.quest.id : null;
    var urgentBy = {};
    (S.today.urgent || []).forEach(function (q) { (urgentBy[q.land] = urgentBy[q.land] || []).push(q); });

    var contentTop = HEAD + PLAZA + 6;
    var plots = lands.slice().reverse().map(function (l) {      /* deepest land at the top of the map */
      var qs = l.open ? (l.quests || []) : (urgentBy[l.id] || []);
      qs = qs.filter(function (q) { return !q.daily; }).concat(qs.filter(function (q) { return q.daily; }));
      var lockLines = l.open ? [] : wrapText(l.lockMessage || '', 50);
      var msgH = l.open ? (qs.length ? 0 : 22) : lockLines.length * 14 + 8;
      var rows = Math.ceil(qs.length / COLS);
      return {
        id: l.id, name: l.name, open: l.open, fresh: !!l.fresh, icon: l.icon,
        cleared: l.cleared, total: l.total, xp: l.xp, xpTotal: l.xpTotal,
        lockLines: lockLines, qs: qs, rows: rows, msgH: msgH,
        h: contentTop + msgH + rows * ROW + PAD,
        solid: !l.open && qs.length === 0
      };
    });
    var y = TOP;
    plots.forEach(function (p) {
      p.x = PX; p.w = PW; p.y = y; p.py = y + HEAD + 13;
      y += p.h + GAP;
      var gy = p.y + contentTop + p.msgH;
      p.nodes = p.qs.map(function (q, i) {
        var cx = PX + GX + (i % COLS) * PITCH, cy = gy + Math.floor(i / COLS) * ROW + 16;
        var st = statusOf(q, nextId);
        return { id: q.id, q: q, st: st, cx: cx, cy: cy, sx: cx - 27, sy: cy + 4, next: nextId === q.id };
      });
      delete p.qs;
    });
    var byId = {};
    plots.forEach(function (p) { byId[p.id] = p; });
    var roads = [], n = 0;
    lands.forEach(function (l) {
      (l.from || []).forEach(function (a) {
        if (!byId[a]) return;
        var left = n % 2 === 0, A = byId[a], B = byId[l.id];
        var dx = left ? PX + 10 : PX + PW - 10, lx = left ? LANE_L : LANE_R;
        roads.push({ a: a, b: l.id, left: left, ya: A.py, yb: B.py, pts: [[dx, A.py], [lx, A.py], [lx, B.py], [dx, B.py]] });
        n++;
      });
    });
    return { H: y - GAP + BOT, plots: plots, byId: byId, roads: roads, nextId: nextId };
  }

  function nodeById(id) {
    if (!M) return null;
    for (var i = 0; i < M.plots.length; i++) for (var j = 0; j < M.plots[i].nodes.length; j++) if (M.plots[i].nodes[j].id === id) return M.plots[i].nodes[j];
    return null;
  }
  function plotAt(y) {
    var best = null, bd = 1e9;
    M.plots.forEach(function (p) {
      var d = y < p.y - GAP / 2 ? p.y - GAP / 2 - y : y > p.y + p.h + GAP / 2 ? y - (p.y + p.h + GAP / 2) : 0;
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  }
  function plotContaining(x, y) {
    for (var i = 0; i < M.plots.length; i++) {
      var p = M.plots[i];
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
    }
    return null;
  }

  /* ---------- drawing ---------- */
  function pixelsInto(g, name, cx, cy, px) {
    var s = P.SPRITES[name] || P.SPRITES.star, rows = s.r, hh = rows.length, ww = rows[0].length;
    for (var j = 0; j < hh; j++) {
      var i = 0;
      while (i < ww) {
        var ch = rows[j].charAt(i);
        if (ch === '0' || !s.c[ch]) { i++; continue; }
        var k = i;
        while (k + 1 < ww && rows[j].charAt(k + 1) === ch) k++;
        g.appendChild(sv('rect', { x: cx + (i - ww / 2) * px, y: cy + (j - hh / 2) * px, width: (k - i + 1) * px, height: px, fill: s.c[ch] }));
        i = k + 1;
      }
    }
  }
  function glyph(g, n) {
    var q = n.q, k = n.st.key, cx = n.cx, cy = n.cy;
    if (k === 'done') g.appendChild(sv('path', { d: 'M' + (cx - 6) + ' ' + cy + ' L' + (cx - 2) + ' ' + (cy + 5) + ' L' + (cx + 6) + ' ' + (cy - 5), class: 'wm-glyph wm-check' }));
    else if (k === 'locked') { g.appendChild(sv('rect', { x: cx - 5, y: cy - 1, width: 10, height: 8, class: 'wm-glyph wm-fillg' })); g.appendChild(sv('path', { d: 'M' + (cx - 3) + ' ' + (cy - 1) + ' v-3 a3 3 0 0 1 6 0 v3', class: 'wm-glyph' })); }
    else if (q.owner !== 'AJ') pixelsInto(g, { Luna: 'moon', Char: 'bubble', Claude: 'terminal' }[q.owner] || 'star', cx, cy, 1.5);
    else if (k === 'overdue' || k === 'blocked') g.appendChild(sv('text', { x: cx, y: cy + 5, class: 'wm-bang', 'text-anchor': 'middle' }, '!'));
    else g.appendChild(sv('circle', { cx: cx, cy: cy, r: 4, class: 'wm-glyph wm-dot' }));
  }
  function drawNode(n) {
    var q = n.q, label = q.title + '. ' + n.st.word + (q.owner === 'AJ' && q.xp && !q.done ? '. Plus ' + q.xp + ' XP' : '') + '.';
    var cls = 'wm-node st-' + n.st.key + (q.urgent ? ' urgent' : '') + (n.next ? ' next' : '') + (q.daily ? ' daily' : '');
    var g = sv('g', { class: cls, 'data-q': q.id, role: 'button', tabindex: '0', 'aria-label': label });
    g.appendChild(sv('title', {}, q.title));
    g.appendChild(sv('circle', { cx: n.cx, cy: n.cy, r: 24, class: 'wm-hit' }));
    if (n.next) g.appendChild(sv('circle', { cx: n.cx, cy: n.cy, r: 14, class: 'wm-pulse' }));
    g.appendChild(sv('circle', { cx: n.cx, cy: n.cy, r: 14, class: 'wm-c' }));
    glyph(g, n);
    g.appendChild(sv('text', { x: n.cx, y: n.cy + 27, class: 'wm-t', 'text-anchor': 'middle' }, trunc(q.title, 13)));
    var sub = n.st.word + (q.owner === 'AJ' && q.xp && !q.done ? ' +' + q.xp + ' XP' : '');
    g.appendChild(sv('text', { x: n.cx, y: n.cy + 38, class: 'wm-s', 'text-anchor': 'middle' }, sub));
    return g;
  }
  function drawPlot(p, justOpened) {
    var g = sv('g', { class: 'wm-plotg ' + (p.open ? 'open' : 'locked') + (justOpened ? ' swing' : ''), 'data-land': p.id });
    g.appendChild(sv('rect', { x: p.x, y: p.y, width: p.w, height: p.h, class: 'wm-plot' }));
    g.appendChild(sv('path', { d: 'M' + p.x + ' ' + p.py + ' H' + (p.x + p.w), class: 'wm-plaza' }));
    var name = sv('text', { x: p.x + 10, y: p.y + 17, class: 'wm-name' }, p.name);
    g.appendChild(name);
    if (p.fresh) g.appendChild(sv('text', { x: p.x + 20 + p.name.length * 8.4, y: p.y + 16, class: 'wm-new' }, T.newTag));
    if (p.open) {
      var sub = p.cleared + ' of ' + p.total + ' ' + T.cleared + ', ' + p.xp + ' of ' + p.xpTotal + ' XP';
      g.appendChild(sv('text', { x: p.x + p.w - 10, y: p.y + 17, class: 'wm-sub', 'text-anchor': 'end' }, p.total ? sub : T.noQuests));
      g.appendChild(sv('rect', { x: p.x + 10, y: p.y + 24, width: p.w - 20, height: 6, class: 'wm-bar' }));
      var frac = p.xpTotal ? clamp(p.xp / p.xpTotal, 0, 1) : 0;
      var fill = sv('rect', { x: p.x + 10, y: p.y + 24, width: p.w - 20, height: 6, class: 'wm-barfill' });
      var was = barW[p.id];
      fill.style.transform = 'scaleX(' + (was === undefined ? frac : was) + ')';
      if (was !== undefined && was !== frac) requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.transform = 'scaleX(' + frac + ')'; }); });
      barW[p.id] = frac;
      g.appendChild(fill);
      if (!p.nodes.length) g.appendChild(sv('text', { x: p.x + 10, y: p.y + HEAD + PLAZA + 18, class: 'wm-empty' }, T.noQuests));
    } else {
      g.appendChild(sv('text', { x: p.x + p.w - 10, y: p.y + 17, class: 'wm-sub', 'text-anchor': 'end' }, COPY.status.locked));
      p.lockLines.forEach(function (line, i) {
        g.appendChild(sv('text', { x: p.x + 10, y: p.y + HEAD + PLAZA + 16 + i * 14, class: 'wm-lock' }, line));
      });
    }
    return g;
  }

  function buildZo() {
    var g = sv('g', { class: 'zo' });
    var flip = sv('g', { class: 'zo-flip' }), bob = sv('g', { class: 'zo-bob' });
    bob.appendChild(sv('ellipse', { cx: 0, cy: 13, rx: 9, ry: 3, class: 'zo-shadow' }));
    pixelsInto(bob, 'hero', 0, 0, 2);
    flip.appendChild(bob); g.appendChild(flip);
    zoG = g; zoWalk = bob; zoCheer = flip;
    return g;
  }

  function render() {
    var old = svg ? svg.querySelector('.wm-node:focus') : null;
    var focusId = old ? old.getAttribute('data-q') : null;
    var s = sv('svg', { viewBox: '0 0 ' + W + ' ' + M.H, class: 'wm', role: 'group', 'aria-label': T.mapLabel, preserveAspectRatio: 'xMidYMin meet' });
    var roads = sv('g', { class: 'wm-roads' });
    M.roads.forEach(function (r) {
      var d = 'M' + PX + ' ' + r.ya + ' L' + r.pts[1][0] + ' ' + r.pts[1][1] + ' L' + r.pts[2][0] + ' ' + r.pts[2][1] + ' L' + PX + ' ' + r.yb;
      if (!r.left) d = 'M' + (PX + PW) + ' ' + r.ya + ' L' + r.pts[1][0] + ' ' + r.pts[1][1] + ' L' + r.pts[2][0] + ' ' + r.pts[2][1] + ' L' + (PX + PW) + ' ' + r.yb;
      roads.appendChild(sv('path', { d: d, class: 'wm-road' }));
    });
    s.appendChild(roads);
    M.plots.forEach(function (p) {
      var just = prevOpen && p.open && !prevOpen[p.id];
      s.appendChild(drawPlot(p, just));
    });
    var nodes = sv('g', { class: 'wm-nodes' });
    M.plots.forEach(function (p) { p.nodes.forEach(function (n) { nodes.appendChild(drawNode(n)); }); });
    s.appendChild(nodes);
    s.appendChild(zoG || buildZo());
    if (svg) wrap.replaceChild(s, svg); else wrap.insertBefore(s, wrap.firstChild);
    svg = s;
    prevOpen = {}; M.plots.forEach(function (p) { prevOpen[p.id] = p.open; });
    if (focusId) { var again = svg.querySelector('.wm-node[data-q="' + focusId + '"]'); if (again) again.focus(); }
    near = null;
  }

  /* ---------- Zo's position ---------- */
  function applyAnchor() {
    var p = M.byId[zo.land] || M.plots[M.plots.length - 1];
    zo.land = p.id;
    zo.x = p.x + zo.dx; zo.y = p.y + zo.dy;
  }
  function syncAnchor() {
    var p = plotAt(zo.y);
    zo.land = p.id; zo.dx = zo.x - p.x; zo.dy = zo.y - p.y;
  }
  function saveZo() { P.local('zo', { land: zo.land, dx: Math.round(zo.dx * 10) / 10, dy: Math.round(zo.dy * 10) / 10, dir: zo.dir }); }
  function placeZo() {
    zoG.setAttribute('transform', 'translate(' + zo.x.toFixed(1) + ' ' + zo.y.toFixed(1) + ')');
    zoCheer.setAttribute('transform', zo.dir < 0 ? 'scale(-1 1)' : 'scale(1 1)');
    positionBubble();
  }
  function setWalking(on) { zoG.setAttribute('class', 'zo' + (on ? ' walking' : '')); }

  /* ---------- the bubble (never blocks a tap) ---------- */
  function positionBubble() {
    if (!bubble || bubble.hidden || !svg) return;
    var s = svg.clientWidth / W;
    bubble.style.left = clamp(zo.x * s, 60, svg.clientWidth - 60) + 'px';
    bubble.style.top = Math.max(2, (zo.y - 30) * s) + 'px';
  }
  function say(kind, ms) {
    var text = COPY.say(kind);
    if (!text || !bubble) return;
    bubble.textContent = text; bubble.hidden = false;
    positionBubble();
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bubble.hidden = true; }, ms || 1800);
  }

  /* ---------- routes ---------- */
  function route(fromId, toId) {
    if (fromId === toId) return [];
    var prev = {}, queue = [fromId], seen = {};
    seen[fromId] = 1;
    while (queue.length) {
      var c = queue.shift();
      if (c === toId) break;
      M.roads.forEach(function (r) {
        var n = r.a === c ? r.b : (r.b === c ? r.a : null);
        if (!n || seen[n]) return;
        if (n !== toId && !M.byId[n].open) return;
        seen[n] = 1; prev[n] = { from: c, road: r, fwd: r.a === c }; queue.push(n);
      });
    }
    if (!seen[toId]) return null;
    var steps = [], cur = toId;
    while (cur !== fromId) { var p = prev[cur]; steps.unshift(p); cur = p.from; }
    return steps;
  }
  function plan(tx, ty, target, gate) {
    var A = plotAt(zo.y), pts = [];
    if (!target || A.id === target.id) { pts.push([tx, ty]); return pts; }
    var steps = route(A.id, target.id);
    if (!steps) { pts.push([tx, ty]); return pts; }
    pts.push([zo.x, A.py]);
    steps.forEach(function (st, i) {
      var sp = st.fwd ? st.road.pts : st.road.pts.slice().reverse();
      if (gate && i === steps.length - 1) pts.push(sp[0], sp[1], sp[2]);
      else sp.forEach(function (pt) { pts.push(pt); });
    });
    if (!gate) { pts.push([tx, target.py]); pts.push([tx, ty]); }
    return pts;
  }

  /* ---------- walking ---------- */
  function cancelWalk() {
    if (walk) { clearTimeout(walk.timer); walk = null; }
    if (zoG) setWalking(false);
  }
  function startWalk(pts, target, onArrive) {
    cancelWalk();
    var all = [[zo.x, zo.y]].concat(pts), total = 0;
    for (var i = 1; i < all.length; i++) total += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
    var end = all[all.length - 1];
    touch();
    if (total < 3 || reduced()) {
      zo.x = end[0]; zo.y = end[1]; syncAnchor(); placeZo(); saveZo();
      if (onArrive) setTimeout(onArrive, reduced() ? 120 : 0);
      return;
    }
    var speed = Math.max(WALK_SPEED, total / MAX_CROSS);
    var w = { pts: all, i: 1, speed: speed, target: target, onArrive: onArrive };
    /* if the tab is throttled and the walk never finishes, still arrive */
    w.timer = setTimeout(function () {
      if (walk !== w) return;
      walk = null; zo.x = end[0]; zo.y = end[1]; syncAnchor(); placeZo(); saveZo(); setWalking(false);
      if (onArrive) onArrive();
    }, (total / speed) * 1250 + 1000);
    walk = w;
    setWalking(true);
    kick();
  }
  function finishWalk() {
    var w = walk;
    clearTimeout(w.timer); walk = null;
    setWalking(false); syncAnchor(); placeZo(); saveZo();
    if (w.onArrive) w.onArrive();
  }

  function solidHit(x, y) {
    for (var i = 0; i < M.plots.length; i++) {
      var p = M.plots[i];
      if (p.solid && x > p.x - 6 && x < p.x + p.w + 6 && y > p.y - 6 && y < p.y + p.h + 6) return true;
    }
    return false;
  }
  function keyStep(dt) {
    var dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (!dx && !dy) return false;
    var len = Math.hypot(dx, dy), d = KEY_SPEED * dt;
    var nx = clamp(zo.x + dx / len * d, 10, W - 10), ny = clamp(zo.y + dy / len * d, 10, M.H - 10);
    if (!solidHit(nx, zo.y)) zo.x = nx;
    if (!solidHit(zo.x, ny)) zo.y = ny;
    if (dx) zo.dir = dx > 0 ? 1 : -1;
    syncAnchor();
    return true;
  }

  function followScroll() {
    if (!svg || root.offsetParent === null) return;
    var r = svg.getBoundingClientRect(), s = r.width / W, sy = r.top + zo.y * s;
    var hdr = document.querySelector('header.top'), nav = $('tabs'), sh = $('sheet');
    var top = (hdr ? hdr.offsetHeight : 60) + 70;
    var bottom = window.innerHeight - (nav ? nav.offsetHeight : 62) - (sh && !sh.hidden ? sh.offsetHeight : 0) - 70;
    var diff = sy < top ? sy - top : sy > bottom ? sy - bottom : 0;
    if (Math.abs(diff) > 1) window.scrollBy(0, Math.abs(diff) < 6 ? diff : diff * 0.2);
  }
  function updateNear() {
    if (!M) return;
    var best = null, bd = NEAR;
    M.plots.forEach(function (p) { p.nodes.forEach(function (n) { var d = Math.hypot(n.cx - zo.x, n.cy - zo.y); if (d < bd) { bd = d; best = n; } }); });
    if (best === near) return;
    var o = near && svg.querySelector('.wm-node[data-q="' + near.id + '"]'); if (o) o.classList.remove('near');
    near = best;
    var e = near && svg.querySelector('.wm-node[data-q="' + near.id + '"]'); if (e) e.classList.add('near');
  }

  function frame(t) {
    raf = 0;
    var dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    var moving = false;
    if (walk) {
      moving = true;
      var step = walk.speed * dt;
      while (step > 0 && walk) {
        var tg = walk.pts[walk.i], dx = tg[0] - zo.x, dy = tg[1] - zo.y, d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.5) zo.dir = dx > 0 ? 1 : -1;
        if (d <= step) {
          zo.x = tg[0]; zo.y = tg[1]; step -= d; walk.i++;
          if (walk.i >= walk.pts.length) { placeZo(); finishWalk(); moving = false; break; }
        } else { zo.x += dx / d * step; zo.y += dy / d * step; step = 0; }
      }
    } else if (keyStep(dt)) {
      moving = true; setWalking(true); touch();
    }
    if (!moving && !walk) setWalking(false);
    if (zoG) placeZo();
    if (moving) { followScroll(); if (!walk) updateNear(); }
    if (walk || anyKey()) raf = requestAnimationFrame(frame);
    else { saveZo(); updateNear(); }
  }
  function anyKey() { return keys.up || keys.down || keys.left || keys.right; }
  function kick() { if (!raf && M) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
  function touch() { lastActive = Date.now(); }

  /* ---------- moving to things ---------- */
  function goQuest(id) {
    var n = nodeById(id);
    if (!n) { openQuest(id); return; }              /* no spot on the map: still open it */
    if (sheetMode === 'quest' || sheetMode === 'land') closeSheet();
    var tl = M.byId[landOfNode(id)];
    try {
      say('walking');
      startWalk(plan(n.sx, n.sy, tl, false), { kind: 'quest', id: id }, function () { say('arriving'); openQuest(id); });
    } catch (e) { openQuest(id); }                  /* movement failing never blocks the quest */
  }
  function landOfNode(id) {
    for (var i = 0; i < M.plots.length; i++) for (var j = 0; j < M.plots[i].nodes.length; j++) if (M.plots[i].nodes[j].id === id) return M.plots[i].id;
    return null;
  }
  function goGate(landId) {
    var tl = M.byId[landId];
    if (sheetMode === 'quest' || sheetMode === 'land') closeSheet();
    var pts = plan(tl.x - 12, tl.py, tl, true);
    say('walking');
    startWalk(pts, { kind: 'land', id: landId }, function () { openLandSheet(landId); });
  }
  function goPoint(x, y) {
    var pl = plotContaining(x, y);
    if (pl && pl.solid) { goGate(pl.id); return; }
    if (sheetMode === 'quest' || sheetMode === 'land') closeSheet();
    x = clamp(x, 10, W - 10); y = clamp(y, 10, M.H - 10);
    var tl = pl || plotAt(y);
    say('walking');
    startWalk(plan(x, y, tl, false), { kind: 'point' }, null);
  }
  function toMap(cx, cy) {
    var m = svg.getScreenCTM();
    if (!m) return null;
    var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    var r = pt.matrixTransform(m.inverse());
    return { x: r.x, y: r.y };
  }

  /* ---------- the sheet: arrival panel, land gate, Quick Add ---------- */
  function sheetEl() { return $('sheet'); }
  function closeSheet() {
    var s = sheetEl(); s.hidden = true; s.innerHTML = '';
    sheetMode = null; sheetId = null;
  }
  function showSheet(card, label) {
    var s = sheetEl(); s.innerHTML = '';
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', label);
    s.appendChild(card); s.hidden = false;
    setTimeout(followScrollOnce, 30);
  }
  function followScrollOnce() {
    if (!svg) return;
    var r = svg.getBoundingClientRect(), s = r.width / W, sy = r.top + zo.y * s;
    var sh = sheetEl(), nav = $('tabs');
    var bottom = window.innerHeight - (nav ? nav.offsetHeight : 62) - (sh.hidden ? 0 : sh.offsetHeight) - 60;
    if (sy > bottom) window.scrollBy({ top: sy - bottom, behavior: reduced() ? 'auto' : 'smooth' });
  }
  function findQuest(id) {
    var i, j;
    for (i = 0; i < S.lands.length; i++) { var qs = S.lands[i].quests || []; for (j = 0; j < qs.length; j++) if (qs[j].id === id) return qs[j]; }
    var u = S.today.urgent || [];
    for (i = 0; i < u.length; i++) if (u[i].id === id) return u[i];
    return null;
  }
  function landName(id) { for (var i = 0; i < S.lands.length; i++) if (S.lands[i].id === id) return S.lands[i].name; return ''; }
  function oneLine(q) {
    if (q.detail) return q.detail;
    var bits = [];
    if (q.dateLabel) bits.push(q.dateLabel);
    if (q.time) bits.push(q.time);
    if (q.place) bits.push(q.place);
    if (bits.length) return bits.join(', ');
    if (q.due) return (q.dueLabel || T.due) + ', ' + q.leftLabel + '.';
    if (q.waitingOn) return 'Waiting on: ' + q.waitingOn + '.';
    return '';
  }
  function detailRows(q) {
    var d = h('dl', 'sdetail');
    function row(k, v) { if (v) add(d, h('dt', '', k), h('dd', '', v)); }
    row('Owner', q.owner);
    row('When', [q.dateLabel, q.time].filter(Boolean).join(', '));
    row('Where', q.place);
    row('Deadline', q.due ? (q.dueLabel || T.due) + ', ' + q.leftLabel : '');
    row('Note', q.detail);
    row('Waiting on', q.waitingOn);
    if (q.state === 'gated') row('Status', q.label);
    return d;
  }

  function openQuest(id) {
    var q = findQuest(id);
    if (!q) return;
    sheetMode = 'quest'; sheetId = id;
    if (P.clearFlag) P.clearFlag(id);
    renderQuestSheet();
  }
  function renderQuestSheet() {
    var q = findQuest(sheetId);
    if (!q) { closeSheet(); return; }
    var st = statusOf(q, M && M.nextId);
    var card = h('div', 'sheet-card');
    var top = h('div', 'sheet-top');
    var title = h('h3', 'sheet-title', q.title);
    var x = h('button', 'sheet-x', COPY.panel.close); x.type = 'button';
    x.addEventListener('click', closeSheet);
    add(top, title, x);
    var chips = h('div', 'sheet-chips');
    add(chips, h('span', 'schip st-' + st.key, st.word), h('span', 'schip', COPY.panel.landLabel + ': ' + landName(q.land)));
    if (q.owner === 'AJ' && q.xp) chips.appendChild(h('span', 'schip xp', '+' + q.xp + ' XP'));
    if (q.owner !== 'AJ') chips.appendChild(h('span', 'schip', q.owner));
    add(card, top, chips);
    var line = oneLine(q);
    if (line && !(isStarted(q.id) && q.owner === 'AJ' && !q.done)) card.appendChild(h('p', 'sheet-line', line));
    if (q.owner === 'AJ' && !q.done && isStarted(q.id)) {
      card.appendChild(detailRows(q));
      card.appendChild(h('p', 'sheet-note', T.startedNote));
    }
    var row = h('div', 'row sheet-row');
    if (q.owner === 'AJ' && !q.done) {
      if (!isStarted(q.id) && q.canComplete) {
        var start = h('button', 'btn ghost small', COPY.panel.start); start.type = 'button';
        start.addEventListener('click', function () { setStarted(q.id, true); refresh(); });
        row.appendChild(start);
      }
      var done = h('button', 'btn small', COPY.panel.complete); done.type = 'button';
      if (!q.canComplete) { done.disabled = true; row.appendChild(done); card.appendChild(row); card.appendChild(h('p', 'sheet-note', q.state === 'gated' ? q.label + '.' : 'Not available yet.')); showSheet(card, q.title); return; }
      done.addEventListener('click', function () {
        done.disabled = true;
        P.complete(q).then(function () { if (sheetMode === 'quest') renderQuestSheet(); });
      });
      row.appendChild(done);
    }
    if (q.canUndo) {
      var u = h('button', 'linkbtn', COPY.panel.undo); u.type = 'button';
      u.addEventListener('click', function () { P.undo(q).then(function () { if (sheetMode === 'quest') renderQuestSheet(); }); });
      row.appendChild(u);
    }
    if (row.children.length) card.appendChild(row);
    showSheet(card, q.title);
  }
  function openLandSheet(id) {
    sheetMode = 'land'; sheetId = id;
    renderLandSheet();
  }
  function renderLandSheet() {
    var l = null;
    for (var i = 0; i < S.lands.length; i++) if (S.lands[i].id === sheetId) l = S.lands[i];
    if (!l) { closeSheet(); return; }
    var card = h('div', 'sheet-card');
    var top = h('div', 'sheet-top');
    var x = h('button', 'sheet-x', COPY.panel.close); x.type = 'button'; x.addEventListener('click', closeSheet);
    add(top, h('h3', 'sheet-title', l.name), x);
    var chips = h('div', 'sheet-chips');
    chips.appendChild(h('span', 'schip st-' + (l.open ? 'ready' : 'locked'), l.open ? 'Open' : COPY.status.locked));
    add(card, top, chips, h('p', 'sheet-line', l.open ? T.landOpenNow : l.lockMessage));
    showSheet(card, l.name);
  }

  /* ---------- Quick Add: writes a note to Luna's outbox ---------- */
  function norm(t) { return String(t).toLowerCase().replace(/\s+/g, ' ').replace(/[.!?\s]+$/, '').trim(); }
  function knownTitles() {
    var set = {};
    S.lands.forEach(function (l) { (l.quests || []).forEach(function (q) { set[norm(q.title)] = 1; }); });
    (S.today.urgent || []).forEach(function (q) { set[norm(q.title)] = 1; });
    var texts = S.outbox.messages.filter(function (m) { return m.status !== 'withdrawn'; }).map(function (m) { return m.text; });
    if (P.pendingTexts) texts = texts.concat(P.pendingTexts());
    texts.forEach(function (t) {
      var m = /^Add this quest: (.*?)\. Where: /.exec(t);
      if (m) set[norm(m[1])] = 1;
    });
    return set;
  }
  function openQuickAdd() {
    if (!S) return;
    sheetMode = 'add'; sheetId = null;
    var here = M ? plotAt(zo.y) : null;
    var hereOk = here && here.open;
    var card = h('div', 'sheet-card');
    var top = h('div', 'sheet-top');
    var x = h('button', 'sheet-x', COPY.panel.close); x.type = 'button'; x.addEventListener('click', closeSheet);
    add(top, h('h3', 'sheet-title', COPY.quickAdd.title), x);
    var form = h('form', 'qa');
    var lab = h('label', 'qa-lab', COPY.quickAdd.nameLabel); lab.setAttribute('for', 'qa-name');
    var inp = h('input', 'qa-in'); inp.id = 'qa-name'; inp.type = 'text'; inp.maxLength = 120; inp.autocomplete = 'off';
    var err = h('p', 'qa-err'); err.setAttribute('role', 'alert');
    function group(legend, name, options, def) {
      var fs = h('fieldset', 'qa-group');
      fs.appendChild(h('legend', '', legend));
      options.forEach(function (o) {
        var l = h('label', 'qa-opt' + (o.off ? ' off' : ''));
        var r = h('input'); r.type = 'radio'; r.name = name; r.value = o.value; r.checked = o.value === def; r.disabled = !!o.off;
        add(l, r, h('span', '', o.text));
        fs.appendChild(l);
      });
      return fs;
    }
    var whereOpts = [
      { value: 'here', text: COPY.quickAdd.whereHere + (hereOk ? ' (' + here.name + ')' : ''), off: !hereOk },
      { value: 'inbox', text: COPY.quickAdd.whereInbox }
    ];
    var whenOpts = [
      { value: 'none', text: COPY.quickAdd.whenNone }, { value: 'today', text: COPY.quickAdd.whenToday }, { value: 'tomorrow', text: COPY.quickAdd.whenTomorrow }
    ];
    var go = h('button', 'btn small', COPY.quickAdd.submit); go.type = 'submit';
    add(form, lab, inp, group(COPY.quickAdd.whereLabel, 'qa-where', whereOpts, hereOk ? 'here' : 'inbox'), group(COPY.quickAdd.whenLabel, 'qa-when', whenOpts, 'none'), err, h('div', 'row sheet-row'));
    form.lastChild.appendChild(go);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = inp.value.replace(/\s+/g, ' ').trim();
      err.textContent = '';
      if (!name) { err.textContent = COPY.quickAdd.needName; inp.focus(); return; }
      if (knownTitles()[norm(name)]) { err.textContent = COPY.quickAdd.duplicate; inp.focus(); return; }
      var where = form.querySelector('input[name="qa-where"]:checked').value === 'here' && hereOk ? here.name : COPY.quickAdd.whereInbox;
      var wv = form.querySelector('input[name="qa-when"]:checked').value, when = COPY.quickAdd.whenNone;
      if (wv === 'today') when = COPY.quickAdd.whenToday + ' (' + S.today.date + ')';
      if (wv === 'tomorrow') when = COPY.quickAdd.whenTomorrow + ' (' + addDays(S.today.date, 1) + ')';
      go.disabled = true;
      P.sendNote(COPY.quickAdd.message(name, where, when)).then(function () {
        closeSheet(); P.toast('ok', COPY.quickAdd.sent);
      }, function () { go.disabled = false; err.textContent = COPY.quickAdd.error; });
    });
    add(card, top, form);
    showSheet(card, COPY.quickAdd.title);
    inp.focus();
  }

  /* ---------- the HUD above the map ---------- */
  function buildHud() {
    hud = h('div', 'wm-hud');
    var ringBox = h('div', 'wm-ring');
    var rs = sv('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
    rs.appendChild(sv('circle', { cx: 32, cy: 32, r: 28, class: 'wm-ring-track' }));
    ring = sv('circle', { cx: 32, cy: 32, r: 28, class: 'wm-ring-fill', transform: 'rotate(-90 32 32)' });
    ringLen = 2 * Math.PI * 28;
    ring.style.strokeDasharray = ringLen.toFixed(2);
    ring.style.strokeDashoffset = ringLen.toFixed(2);
    rs.appendChild(ring);
    var spr = P.sprite('hero', 3); spr.className += ' wm-ring-zo';
    add(ringBox, rs, spr, h('span', 'wm-lv pix'));
    var meta = h('div', 'wm-meta');
    add(meta, h('h2', 'pix wm-name'), h('p', 'wm-xp'), h('p', 'wm-next'));
    var add_ = h('button', 'btn small wm-add', COPY.quickAdd.open); add_.type = 'button';
    add_.addEventListener('click', openQuickAdd);
    var low = h('div', 'wm-low');
    add(low, h('div', 'dial wm-dial'), h('p', 'dialnote wm-dialnote'), h('p', 'wm-totals'));
    add(hud, ringBox, meta, add_, low);
  }
  function patchHud() {
    var hero = S.hero;
    hud.querySelector('.wm-lv').textContent = 'LV ' + hero.level;
    hud.querySelector('.wm-name').textContent = hero.name;
    hud.querySelector('.wm-xp').textContent = hero.into + ' of ' + hero.need + ' XP, ' + hero.xpToNext + ' to go';
    hud.querySelector('.wm-next').textContent = hero.next ? hero.next.text : '';
    ring.style.strokeDashoffset = (ringLen * (1 - hero.into / hero.need)).toFixed(2);
    var d = hero.dial, dial = hud.querySelector('.wm-dial');
    dial.innerHTML = '';
    d.days.forEach(function (day) {
      var seg = h('div', 'seg' + (day.kept ? ' kept' : '') + (day.today ? ' today' : '') + (day.future ? ' future' : ''));
      add(seg, h('i'), document.createTextNode(day.letter));
      dial.appendChild(seg);
    });
    dial.setAttribute('role', 'img'); dial.setAttribute('aria-label', 'Weekly dial. ' + d.label);
    hud.querySelector('.wm-dialnote').textContent = d.label;
    hud.querySelector('.wm-totals').textContent = hero.xp + ' XP total, ' + hero.questsDone + ' of ' + hero.questsTotal + ' quests done, ' + hero.landsOpen + ' of ' + hero.landsTotal + ' lands open.';
  }

  /* ---------- XP moments ---------- */
  function floatAt(x, y, text, cls) {
    if (!svg || root.offsetParent === null) return;
    var s = svg.clientWidth / W;
    var f = h('div', 'xpf' + (cls ? ' ' + cls : ''), text);
    f.style.left = (x * s) + 'px'; f.style.top = (y * s) + 'px';
    floats.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1800);
  }
  function celebrate(q, awarded) {
    if (!M) return;
    var n = nodeById(q.id), x = n ? n.cx : zo.x, y = n ? n.cy - 14 : zo.y - 16;
    if (awarded && awarded.xp > 0) floatAt(x, y, '+' + awarded.xp + ' XP', '');
    ((awarded && awarded.bonuses) || []).forEach(function (b, i) {
      setTimeout(function () { floatAt(x, y - 8, '+' + b.xp + ' XP', 'bonus'); }, 420 * (i + 1));
    });
    if (zoG) { zoG.setAttribute('class', 'zo cheer'); setTimeout(function () { setWalking(!!walk); }, 700); }
    say('finished', 2200);
    touch();
  }

  /* ---------- keyboard ---------- */
  var KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', a: 'left', s: 'down', d: 'right', W: 'up', A: 'left', S: 'down', D: 'right' };
  function worldActive() {
    if (!root || root.offsetParent === null || !M) return false;
    var a = document.activeElement, tag = a && a.tagName;
    return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheetMode) { closeSheet(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || !worldActive()) return;
    var k = KEYMAP[e.key];
    if (k) {
      e.preventDefault();
      if (walk) { cancelWalk(); }
      keys[k] = true; touch(); kick();
    } else if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === document.body && near) {
      e.preventDefault(); openQuest(near.id);
    }
  });
  document.addEventListener('keyup', function (e) { var k = KEYMAP[e.key]; if (k) delete keys[k]; });
  window.addEventListener('blur', function () { keys = {}; });

  /* ---------- idle lines ---------- */
  setInterval(function () {
    if (document.hidden || !root || root.offsetParent === null || walk || anyKey() || sheetMode) return;
    if (Date.now() - lastActive > 30000) { say('idle', 2400); lastActive = Date.now(); }
  }, 8000);

  /* ---------- mount and update ---------- */
  function mount(into) {
    root = into; root.className = 'wm-root';
    buildHud();
    wrap = h('div', 'wm-wrap');
    floats = h('div', 'wm-floats'); floats.setAttribute('aria-hidden', 'true');
    bubble = h('div', 'wm-bubble'); bubble.hidden = true; bubble.setAttribute('aria-hidden', 'true');
    add(wrap, floats, bubble);
    add(root, hud, wrap);
    wrap.addEventListener('click', function (e) {
      var nodeEl = e.target.closest && e.target.closest('.wm-node');
      if (nodeEl) { touch(); goQuest(nodeEl.getAttribute('data-q')); return; }
      if (!svg || !M) return;
      var pt = toMap(e.clientX, e.clientY);
      if (pt && pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= M.H) { touch(); goPoint(pt.x, pt.y); }
    });
    wrap.addEventListener('keydown', function (e) {
      var nodeEl = e.target.closest && e.target.closest('.wm-node');
      if (nodeEl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); goQuest(nodeEl.getAttribute('data-q')); }
    });
    window.addEventListener('resize', positionBubble);
    window.addEventListener('pagehide', function () { if (M) saveZo(); });
  }

  /* Rebuild from the state we already have (used after a local change such as Start quest). */
  function refresh() { if (S) update(S); }

  function update(state) {
    S = state;
    var next = buildModel();
    var nextSig = JSON.stringify(next);
    var first = !M;
    if (first || nextSig !== sig) {
      var target = walk && walk.target && walk.target.kind === 'quest' ? walk.target.id : null;
      var cb = walk ? walk.onArrive : null;
      if (walk) { clearTimeout(walk.timer); walk = null; setWalking(false); }
      M = next; sig = nextSig;
      if (first) {
        var saved = P.local('zo');
        var start = saved && M.byId[saved.land] ? saved : null;
        if (start) { zo.land = start.land; zo.dx = start.dx; zo.dy = start.dy; zo.dir = start.dir || 1; }
        else { var bottom = M.plots[M.plots.length - 1]; zo.land = bottom.id; zo.dx = 40; zo.dy = HEAD + 13; }
        if (!zoG) buildZo();
      }
      applyAnchor();
      render(); placeZo();
      if (target && nodeById(target)) {          /* a refresh arrived mid-walk: keep going to the same place */
        var n = nodeById(target);
        startWalk(plan(n.sx, n.sy, M.byId[landOfNode(target)], false), { kind: 'quest', id: target }, cb);
      }
      if (sheetMode === 'quest') { if (findQuest(sheetId)) renderQuestSheet(); else closeSheet(); }
      else if (sheetMode === 'land') {
        var l = null; for (var i = 0; i < S.lands.length; i++) if (S.lands[i].id === sheetId) l = S.lands[i];
        if (l && l.open) closeSheet(); else renderLandSheet();
      }
    }
    patchHud();
  }

  P.world = { mount: mount, update: update, celebrate: celebrate, goQuest: goQuest, openQuickAdd: openQuickAdd, closeSheet: closeSheet };
})();
