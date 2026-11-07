#!/usr/bin/env node
/*
 * Govee Lights — a tiny wall-dashboard site for AJ's Govee lights.
 *
 * Zero external dependencies: only Node's built-in http, fs, path.
 * Runs anywhere Node 18+ runs:  node server.js   (or: npm start)
 *
 * Environment variables:
 *   PORT              Port to listen on            (default 3000)
 *   GOVEE_API_KEY     Govee personal API key (from the Govee app email).
 *                     If unset, the server still starts and the page shows
 *                     a "setup needed" state instead of lights.
 *   GOVEE_REFRESH_MS  Background state-refresh interval in ms
 *                     (default 30000)
 *
 * SPEED DESIGN — Govee's classic API takes ~5 seconds to read all devices,
 * so the page NEVER waits on it:
 *   - The server keeps a cached snapshot of every device's state.
 *   - A background timer refreshes the snapshot every GOVEE_REFRESH_MS.
 *   - GET /api/lights serves the cache instantly.
 *   - POST /api/control sends the command to Govee right away, applies it
 *     to the cache optimistically, answers from the cache, and re-reads
 *     just that one device in the background to confirm.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGoveeClient } = require('./lib/govee-client');

const PUBLIC_DIR = path.join(__dirname, 'public');
const CMD_NAMES = ['turn', 'brightness', 'colorTem', 'color'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function toBool(v) {
  return v === true || v === 'true';
}

/* Fold Govee's state property list ([{online}, {brightness}, ...]) flat. */
function flattenProperties(stateData) {
  const flat = {};
  const props = (stateData && stateData.properties) || [];
  for (const p of props) {
    if (p && typeof p === 'object') Object.assign(flat, p);
  }
  return flat;
}

/* One device, in the shape the page and /api/lights use. */
function normalizeDevice(listEntry, stateData, previous) {
  const flat = flattenProperties(stateData);
  const prev = previous || {};
  const colorTem = flat.colorTemInKelvin != null ? flat.colorTemInKelvin
    : (flat.colorTem != null ? flat.colorTem : null);
  return {
    device: listEntry.device,
    model: listEntry.model,
    name: listEntry.deviceName || prev.name || 'Light',
    online: flat.online !== undefined ? toBool(flat.online)
      : (prev.online !== undefined ? prev.online : null),
    powerState: flat.powerState || prev.powerState || null,
    brightness: flat.brightness != null ? flat.brightness
      : (prev.brightness != null ? prev.brightness : null),
    color: flat.color || prev.color || null,
    colorTem: colorTem != null ? colorTem : (prev.colorTem != null ? prev.colorTem : null),
  };
}

/* Apply a just-sent command to a cached device (optimistic update). */
function applyCmd(device, cmd) {
  if (!device || !cmd) return device;
  if (cmd.name === 'turn') device.powerState = cmd.value;
  else if (cmd.name === 'brightness') device.brightness = cmd.value;
  else if (cmd.name === 'colorTem') { device.colorTem = cmd.value; device.color = null; }
  else if (cmd.name === 'color') { device.color = cmd.value; device.colorTem = null; }
  return device;
}

function validateControl(body) {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object.';
  if (!body.device || typeof body.device !== 'string') return 'Missing "device".';
  if (!body.model || typeof body.model !== 'string') return 'Missing "model".';
  const cmd = body.cmd;
  if (!cmd || typeof cmd !== 'object' || CMD_NAMES.indexOf(cmd.name) === -1) {
    return 'cmd.name must be one of: ' + CMD_NAMES.join(', ') + '.';
  }
  const v = cmd.value;
  if (cmd.name === 'turn' && v !== 'on' && v !== 'off') return 'turn value must be "on" or "off".';
  if (cmd.name === 'brightness' && (!Number.isInteger(v) || v < 1 || v > 100)) {
    return 'brightness value must be an integer 1-100.';
  }
  if (cmd.name === 'colorTem' && (!Number.isInteger(v) || v < 2000 || v > 9000)) {
    return 'colorTem value must be an integer 2000-9000.';
  }
  if (cmd.name === 'color') {
    if (!v || typeof v !== 'object') return 'color value must be {r, g, b}.';
    for (const k of ['r', 'g', 'b']) {
      if (!Number.isInteger(v[k]) || v[k] < 0 || v[k] > 255) {
        return 'color.' + k + ' must be an integer 0-255.';
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

function createApp(options) {
  const opts = options || {};
  const apiKey = opts.apiKey !== undefined ? opts.apiKey : (process.env.GOVEE_API_KEY || '');
  const refreshMs = opts.refreshMs !== undefined ? opts.refreshMs
    : parseInt(process.env.GOVEE_REFRESH_MS || '30000', 10);
  const client = opts.client || createGoveeClient({ apiKey, fetchImpl: opts.fetchImpl });
  const setupNeeded = !apiKey && !opts.client;

  const cache = {
    updatedAt: null,   // ISO string of the last successful snapshot/control
    devices: [],       // normalized devices, in the API's list order
    lastError: null,   // last background refresh error (string) or null
  };

  let refreshing = false;

  async function refreshOne(deviceId, model) {
    try {
      const state = await client.getState(deviceId, model);
      const idx = cache.devices.findIndex(d => d.device === deviceId);
      if (idx !== -1) {
        cache.devices[idx] = normalizeDevice(
          { device: deviceId, model, deviceName: cache.devices[idx].name }, state, cache.devices[idx]);
        cache.updatedAt = new Date().toISOString();
      }
    } catch (_) { /* background confirm is best effort; cache keeps the optimistic value */ }
  }

  async function refreshAll() {
    if (setupNeeded || refreshing) return;
    refreshing = true;
    try {
      const list = await client.listDevices();
      const previousById = {};
      for (const d of cache.devices) previousById[d.device] = d;
      const devices = await Promise.all(list.map(async (entry) => {
        const prev = previousById[entry.device];
        try {
          const state = await client.getState(entry.device, entry.model);
          return normalizeDevice(entry, state, prev);
        } catch (_) {
          /* One unreadable device must not sink the snapshot: keep its
             last known values if we have them. */
          return normalizeDevice(entry, null, prev);
        }
      }));
      cache.devices = devices;
      cache.updatedAt = new Date().toISOString();
      cache.lastError = null;
    } catch (err) {
      cache.lastError = String((err && err.message) || err);
    } finally {
      refreshing = false;
    }
  }

  function snapshot() {
    return {
      setupNeeded,
      updatedAt: cache.updatedAt,
      refreshMs,
      lastError: cache.lastError,
      devices: cache.devices,
    };
  }

  async function handleControl(req, res) {
    if (setupNeeded) {
      return sendJson(res, 503, { error: 'setup_needed', message: 'GOVEE_API_KEY is not set on the server.' });
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (_) {
      return sendJson(res, 400, { error: 'bad_json' });
    }
    const problem = validateControl(body);
    if (problem) return sendJson(res, 400, { error: 'bad_request', message: problem });

    try {
      await client.control(body.device, body.model, body.cmd);
    } catch (err) {
      return sendJson(res, 502, { error: 'govee_error', message: String((err && err.message) || err) });
    }

    const cached = cache.devices.find(d => d.device === body.device);
    if (cached) {
      applyCmd(cached, body.cmd);
      cache.updatedAt = new Date().toISOString();
    }
    /* Confirm against the real light in the background; the response
       below never waits for it. */
    refreshOne(body.device, body.model);
    return sendJson(res, 200, { device: cached || null, updatedAt: cache.updatedAt });
  }

  function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/api/lights' && req.method === 'GET') {
      return sendJson(res, 200, snapshot());
    }
    if (pathname === '/api/control' && req.method === 'POST') {
      handleControl(req, res).catch(() => sendJson(res, 500, { error: 'server_error' }));
      return;
    }
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, setupNeeded });
    }
    if (pathname.indexOf('/api/') === 0) {
      return sendJson(res, 404, { error: 'not_found' });
    }
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
    return serveStatic(pathname, res);
  }

  function serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, rel);
    if (filePath.indexOf(PUBLIC_DIR) !== 0) return sendJson(res, 404, { error: 'not_found' });
    fs.readFile(filePath, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'not_found' });
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  const server = http.createServer(handler);
  let timer = null;

  return {
    server,
    cache,
    snapshot,
    refreshAll,
    refreshOne,
    setupNeeded,
    startBackground() {
      refreshAll();
      timer = setInterval(refreshAll, refreshMs);
      if (timer.unref) timer.unref();
    },
    stopBackground() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const app = createApp();
  app.server.listen(PORT, () => {
    console.log('Govee Lights listening on port ' + PORT +
      (app.setupNeeded ? ' (setup needed: GOVEE_API_KEY is not set)' : ''));
  });
  app.startBackground();
}

module.exports = { createApp, validateControl, normalizeDevice, applyCmd };
