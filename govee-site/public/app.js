'use strict';
/*
 * Govee Lights — wall dashboard page logic.
 *
 * The page NEVER talks to Govee. It polls the server's cached snapshot
 * (GET /api/lights) every 10 seconds and renders from it, and sends taps
 * to POST /api/control, updating the tile from the server's response.
 */

var POLL_MS = 10000;

var COLOR_SWATCHES = [
  { label: 'Red',    rgb: { r: 255, g: 0,   b: 0   }, css: '#ff2a1a' },
  { label: 'Orange', rgb: { r: 255, g: 122, b: 0   }, css: '#ff7a00' },
  { label: 'Yellow', rgb: { r: 255, g: 200, b: 0   }, css: '#ffc800' },
  { label: 'Green',  rgb: { r: 0,   g: 200, b: 83  }, css: '#00c853' },
  { label: 'Blue',   rgb: { r: 41,  g: 98,  b: 255 }, css: '#2962ff' },
  { label: 'Purple', rgb: { r: 142, g: 36,  b: 170 }, css: '#8e24aa' },
  { label: 'Pink',   rgb: { r: 255, g: 64,  b: 129 }, css: '#ff4081' }
];

var TEMP_PRESETS = [
  { label: 'Warm', kelvin: 2700 },
  { label: 'Neutral', kelvin: 4000 },
  { label: 'Daylight', kelvin: 6500 }
];

var snapshot = { setupNeeded: false, updatedAt: null, devices: [] };
var deviceById = {};          // device id -> device object from the snapshot
var tileById = {};            // device id -> {root, ...} tile elements
var groupEls = {};            // group name -> {root, tilesEl}
var sliderActive = {};        // device id -> true while its slider is being dragged

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function deviceSuffix(device) {
  var clean = String(device.device || '').replace(/[^A-Za-z0-9]/g, '');
  return clean.slice(-4).toUpperCase();
}

function nameCounts(devices) {
  var counts = {};
  devices.forEach(function (d) { counts[d.name] = (counts[d.name] || 0) + 1; });
  return counts;
}

function stateText(d) {
  if (!d.powerState) return 'State unknown';
  if (d.powerState === 'off') return 'Off';
  var parts = ['On'];
  if (d.brightness != null) parts.push(d.brightness + '%');
  if (d.colorTem) parts.push(d.colorTem + 'K');
  else if (d.color) parts.push('Color');
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Control                                                             */
/* ------------------------------------------------------------------ */

function sendControl(device, cmd, tile) {
  if (tile) tile.power.classList.add('busy');
  return fetch('/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: device.device, model: device.model, cmd: cmd })
  }).then(function (res) {
    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
  }).then(function (result) {
    if (tile) tile.power.classList.remove('busy');
    if (result.ok && result.data.device) {
      replaceDevice(result.data.device);
      if (result.data.updatedAt) snapshot.updatedAt = result.data.updatedAt;
      patchTile(result.data.device);
      renderUpdatedLine();
    } else {
      showNotice('That command did not go through. The light may be offline.');
      fetchLights();
    }
  }).catch(function () {
    if (tile) tile.power.classList.remove('busy');
    showNotice('Could not reach the dashboard server.');
  });
}

function replaceDevice(updated) {
  for (var i = 0; i < snapshot.devices.length; i++) {
    if (snapshot.devices[i].device === updated.device) {
      snapshot.devices[i] = updated;
      break;
    }
  }
  deviceById[updated.device] = updated;
}

function groupControl(devices, value) {
  devices.forEach(function (d) {
    sendControl(d, { name: 'turn', value: value }, tileById[d.device]);
  });
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

function buildTile(d) {
  var root = el('section', 'tile');
  root.setAttribute('data-device', d.device);

  var head = el('div', 'tile-head');
  var nameWrap = el('span');
  var nameEl = el('span', 'tile-name', d.name);
  nameWrap.appendChild(nameEl);
  var badge = el('span', 'tile-badge');
  head.appendChild(nameWrap);
  head.appendChild(badge);
  root.appendChild(head);

  var state = el('div', 'tile-state');
  root.appendChild(state);

  var power = el('button', 'power', 'Turn on');
  power.type = 'button';
  power.addEventListener('click', function () {
    var cur = deviceById[d.device];
    if (!cur) return;
    var next = cur.powerState === 'on' ? 'off' : 'on';
    sendControl(cur, { name: 'turn', value: next }, tileById[d.device]);
  });
  root.appendChild(power);

  /* Brightness slider + readout */
  var brow = el('div', 'row brightness-row');
  var slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '1';
  slider.max = '100';
  slider.step = '1';
  slider.setAttribute('aria-label', 'Brightness');
  var bval = el('span', 'bval', '');
  slider.addEventListener('pointerdown', function () { sliderActive[d.device] = true; });
  slider.addEventListener('pointerup', function () { sliderActive[d.device] = false; });
  slider.addEventListener('input', function () { bval.textContent = slider.value + '%'; });
  slider.addEventListener('change', function () {
    sliderActive[d.device] = false;
    var cur = deviceById[d.device];
    if (cur) sendControl(cur, { name: 'brightness', value: parseInt(slider.value, 10) }, tileById[d.device]);
  });
  brow.appendChild(slider);
  brow.appendChild(bval);
  root.appendChild(brow);

  /* Brightness presets */
  var prow = el('div', 'row presets');
  [25, 50, 100].forEach(function (pct) {
    var b = el('button', null, pct + '%');
    b.type = 'button';
    b.addEventListener('click', function () {
      var cur = deviceById[d.device];
      if (cur) sendControl(cur, { name: 'brightness', value: pct }, tileById[d.device]);
    });
    prow.appendChild(b);
  });
  root.appendChild(prow);

  /* Color temperature presets */
  var trow = el('div', 'row temps');
  trow.appendChild(el('span', 'row-label', 'Tone'));
  TEMP_PRESETS.forEach(function (t) {
    var b = el('button', null, t.label);
    b.type = 'button';
    b.setAttribute('data-kelvin', String(t.kelvin));
    b.addEventListener('click', function () {
      var cur = deviceById[d.device];
      if (cur) sendControl(cur, { name: 'colorTem', value: t.kelvin }, tileById[d.device]);
    });
    trow.appendChild(b);
  });
  root.appendChild(trow);

  /* Color swatches */
  var srow = el('div', 'row swatches');
  srow.appendChild(el('span', 'row-label', 'Color'));
  COLOR_SWATCHES.forEach(function (s) {
    var b = el('button', 'sw');
    b.type = 'button';
    b.style.setProperty('--c', s.css);
    b.setAttribute('aria-label', s.label);
    b.addEventListener('click', function () {
      var cur = deviceById[d.device];
      if (cur) sendControl(cur, { name: 'color', value: s.rgb }, tileById[d.device]);
    });
    srow.appendChild(b);
  });
  root.appendChild(srow);

  return { root: root, nameEl: nameEl, badge: badge, state: state, power: power, slider: slider, bval: bval, trow: trow };
}

function patchTile(d) {
  var tile = tileById[d.device];
  if (!tile) return;
  var isOn = d.powerState === 'on';
  tile.root.classList.toggle('is-on', isOn);
  tile.power.textContent = isOn ? 'Turn off' : 'Turn on';
  tile.state.textContent = stateText(d);
  tile.badge.textContent = d.online === false ? 'Last known state' : '';
  if (!sliderActive[d.device] && document.activeElement !== tile.slider) {
    if (d.brightness != null) {
      tile.slider.value = String(d.brightness);
      tile.bval.textContent = d.brightness + '%';
    }
  }
  var tempBtns = tile.trow.querySelectorAll('button[data-kelvin]');
  tempBtns.forEach(function (b) {
    b.classList.toggle('active', d.colorTem === parseInt(b.getAttribute('data-kelvin'), 10));
  });
}

/* ------------------------------------------------------------------ */
/* Groups + render                                                     */
/* ------------------------------------------------------------------ */

function buildGroup(name, devices) {
  var root = el('section', 'group');
  var head = el('div', 'group-head');
  head.appendChild(el('span', 'group-name', name));
  if (devices.length > 1) {
    var actions = el('div', 'group-actions');
    var onBtn = el('button', null, 'All on');
    onBtn.type = 'button';
    onBtn.addEventListener('click', function () {
      groupControl(snapshot.devices.filter(function (d) { return d.name === name; }), 'on');
    });
    var offBtn = el('button', null, 'All off');
    offBtn.type = 'button';
    offBtn.addEventListener('click', function () {
      groupControl(snapshot.devices.filter(function (d) { return d.name === name; }), 'off');
    });
    actions.appendChild(onBtn);
    actions.appendChild(offBtn);
    head.appendChild(actions);
  }
  root.appendChild(head);
  var tilesEl = el('div', 'tiles');
  root.appendChild(tilesEl);
  return { root: root, tilesEl: tilesEl };
}

function render() {
  var groupsRoot = document.getElementById('groups');
  var setupPanel = document.getElementById('setup-panel');
  var empty = document.getElementById('empty');

  if (snapshot.setupNeeded) {
    setupPanel.hidden = false;
    groupsRoot.innerHTML = '';
    groupEls = {};
    tileById = {};
    empty.hidden = true;
    return;
  }
  setupPanel.hidden = true;

  var devices = snapshot.devices;
  empty.hidden = devices.length !== 0;

  /* Group by name, keeping the API's order. Bathroom (x3) lands together. */
  var order = [];
  var byName = {};
  devices.forEach(function (d) {
    if (!byName[d.name]) { byName[d.name] = []; order.push(d.name); }
    byName[d.name].push(d);
  });
  var counts = nameCounts(devices);

  /* Drop groups that no longer exist. */
  Object.keys(groupEls).forEach(function (name) {
    if (!byName[name]) {
      groupEls[name].root.remove();
      delete groupEls[name];
    }
  });
  /* Drop tiles for devices that vanished. */
  Object.keys(tileById).forEach(function (id) {
    if (!deviceById[id] || !devices.some(function (d) { return d.device === id; })) {
      tileById[id].root.remove();
      delete tileById[id];
    }
  });

  order.forEach(function (name) {
    if (!groupEls[name]) {
      groupEls[name] = buildGroup(name, byName[name]);
      groupsRoot.appendChild(groupEls[name].root);
    }
    byName[name].forEach(function (d) {
      if (!tileById[d.device]) {
        tileById[d.device] = buildTile(d);
        if (counts[d.name] > 1) {
          var idTag = el('span', 'tile-id', ' #' + deviceSuffix(d));
          tileById[d.device].nameEl.parentNode.appendChild(idTag);
        }
        groupEls[name].tilesEl.appendChild(tileById[d.device].root);
      }
      patchTile(d);
    });
  });

  renderUpdatedLine();
  var notice = document.getElementById('notice');
  if (snapshot.lastError && devices.length) {
    notice.hidden = false;
    notice.textContent = 'The last refresh from Govee failed, so these readings may be stale.';
  } else {
    notice.hidden = true;
  }
}

function renderUpdatedLine() {
  var line = document.getElementById('updated-line');
  if (snapshot.setupNeeded) { line.textContent = 'Waiting for the API key'; return; }
  if (!snapshot.updatedAt) { line.textContent = 'Loading…'; return; }
  var secs = Math.max(0, Math.round((Date.now() - new Date(snapshot.updatedAt).getTime()) / 1000));
  if (secs < 5) line.textContent = 'Updated just now';
  else if (secs < 60) line.textContent = 'Updated ' + secs + 's ago';
  else line.textContent = 'Updated ' + Math.floor(secs / 60) + 'm ago';
}

function showNotice(text) {
  var notice = document.getElementById('notice');
  notice.hidden = false;
  notice.textContent = text;
}

/* ------------------------------------------------------------------ */
/* Polling + clock                                                     */
/* ------------------------------------------------------------------ */

function fetchLights() {
  fetch('/api/lights', { cache: 'no-store' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      snapshot = data;
      deviceById = {};
      data.devices.forEach(function (d) { deviceById[d.device] = d; });
      render();
    })
    .catch(function () {
      showNotice('Could not reach the dashboard server. Retrying…');
    });
}

function tickClock() {
  var now = new Date();
  var hh = now.getHours();
  var mm = now.getMinutes();
  var ampm = hh >= 12 ? 'PM' : 'AM';
  var h12 = hh % 12 === 0 ? 12 : hh % 12;
  document.getElementById('clock-time').textContent =
    h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
  document.getElementById('clock-date').textContent =
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  renderUpdatedLine();
}

document.getElementById('all-off').addEventListener('click', function () {
  groupControl(snapshot.devices.slice(), 'off');
});

tickClock();
setInterval(tickClock, 1000);
fetchLights();
setInterval(fetchLights, POLL_MS);
