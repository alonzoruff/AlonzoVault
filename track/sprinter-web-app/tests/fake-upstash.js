'use strict';
/*
 * A tiny stand-in for Upstash Redis's REST address, for tests only.
 * It answers the few commands lib/store.js sends (GET, SET, MGET,
 * INCR, EXPIRE, and the one EVAL save script) from an in-memory map.
 * No real Upstash account, address or token is involved: the token
 * below is a made-up placeholder.
 */
const http = require('http');

const FAKE_TOKEN = 'test-token-not-real';

function startFakeUpstash() {
  return new Promise((resolve) => {
    const kv = new Map();
    const fake = { kv, calls: [], port: 0, server: null, failNext: 0 };
    const getv = (k) => (kv.has(k) ? kv.get(k) : null);
    fake.server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const send = (status, obj) => {
          const body = JSON.stringify(obj);
          res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
          res.end(body);
        };
        if (req.headers.authorization !== 'Bearer ' + FAKE_TOKEN) return send(401, { error: 'Unauthorized' });
        if (fake.failNext > 0) { fake.failNext--; return send(500, { error: 'fake outage' }); }
        let args;
        try { args = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return send(400, { error: 'bad body' }); }
        const cmd = String(args[0] || '').toUpperCase();
        fake.calls.push(cmd);
        switch (cmd) {
          case 'GET': return send(200, { result: getv(args[1]) });
          case 'SET': kv.set(args[1], String(args[2])); return send(200, { result: 'OK' });
          case 'MGET': return send(200, { result: args.slice(1).map(getv) });
          case 'INCR': {
            const n = parseInt(getv(args[1]) || '0', 10) + 1;
            kv.set(args[1], String(n));
            return send(200, { result: n });
          }
          case 'EXPIRE': return send(200, { result: kv.has(args[1]) ? 1 : 0 });
          case 'EVAL': {
            /* Only the store's save script: [EVAL, script, 2, dataKey, verKey, expected, value] */
            const [, , , dataKey, verKey, expected, value] = args;
            const cur = getv(verKey) || '0';
            if (cur !== expected) return send(200, { result: -1 });
            kv.set(dataKey, value);
            const n = parseInt(cur, 10) + 1;
            kv.set(verKey, String(n));
            return send(200, { result: n });
          }
          default: return send(400, { error: 'ERR unknown command ' + cmd });
        }
      });
    });
    fake.server.listen(0, '127.0.0.1', () => {
      fake.port = fake.server.address().port;
      fake.url = 'http://127.0.0.1:' + fake.port;
      resolve(fake);
    });
  });
}

module.exports = { startFakeUpstash, FAKE_TOKEN };
