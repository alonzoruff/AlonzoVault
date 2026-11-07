'use strict';
/*
 * Minimal client for Govee's classic developer API.
 *
 *   Base:  https://developer-api.govee.com
 *   Auth:  header  Govee-API-Key: <key>
 *   GET    /v1/devices
 *   GET    /v1/devices/state?device=..&model=..
 *   PUT    /v1/devices/control   body {device, model, cmd:{name, value}}
 *
 * The API key is passed in by the caller (from process.env on the server).
 * It is never logged here. fetchImpl is injectable so tests can stub the
 * network layer without a real key.
 */

const DEFAULT_BASE_URL = 'https://developer-api.govee.com';

function createGoveeClient(options) {
  const opts = options || {};
  const apiKey = opts.apiKey || '';
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');

  if (typeof doFetch !== 'function') {
    throw new Error('No fetch implementation available (Node 18+ required).');
  }

  async function request(method, requestPath, body) {
    const init = {
      method,
      headers: {
        'Govee-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await doFetch(baseUrl + requestPath, init);
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON body */ }
    if (!res.ok) {
      const msg = data && data.message ? data.message : 'HTTP ' + res.status;
      const err = new Error('Govee API error: ' + msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    /* [{device, model, deviceName, controllable, retrievable, supportCmds}] */
    async listDevices() {
      const data = await request('GET', '/v1/devices');
      return (data && data.data && data.data.devices) || [];
    },

    /* Raw state payload: {device, model, properties:[{online}, {powerState}, ...]} */
    async getState(device, model) {
      const q = '?device=' + encodeURIComponent(device) + '&model=' + encodeURIComponent(model);
      const data = await request('GET', '/v1/devices/state' + q);
      return (data && data.data) || {};
    },

    /* cmd: {name: 'turn'|'brightness'|'colorTem'|'color', value} */
    async control(device, model, cmd) {
      return request('PUT', '/v1/devices/control', { device, model, cmd });
    },
  };
}

module.exports = { createGoveeClient, DEFAULT_BASE_URL };
