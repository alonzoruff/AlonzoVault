#!/usr/bin/env node
'use strict';
/*
 * Runs the whole main suite (tests/run-tests.js) a second time with
 * the hosted-store mode on, against a local fake Upstash. Every server
 * the suite starts gets its own key prefix (from its throwaway
 * DATA_DIR), so the suite's "fresh app" steps still start empty.
 *
 * Usage: node tests/run-tests-store-mode.js
 */
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { startFakeUpstash, FAKE_TOKEN } = require('./fake-upstash');

/* Store mode only lets OWNER_SETUP_EMAIL claim an empty store. The
   suite starts many fresh apps with different first accounts, so
   every email it registers with is allowed here (test-only). */
const SUITE_EMAILS = [...new Set(
  [...fs.readFileSync(path.join(__dirname, 'run-tests.js'), 'utf8')
    .matchAll(/['"]\/api\/register['"],\s*\{\s*email:\s*['"]([^'"]+)['"]/g)]
    .map(m => m[1].toLowerCase()))].join(',');

(async () => {
  const fake = await startFakeUpstash();
  fake.server.unref();
  const realSpawn = childProcess.spawn;
  childProcess.spawn = function (cmd, args, opts) {
    const o = Object.assign({}, opts || {});
    const env = Object.assign({}, o.env || process.env);
    const tag = crypto.createHash('sha256').update(String(env.DATA_DIR || 'default')).digest('hex').slice(0, 12);
    Object.assign(env, {
      UPSTASH_REDIS_REST_URL: fake.url,
      UPSTASH_REDIS_REST_TOKEN: FAKE_TOKEN,
      STORE_PREFIX: 't' + tag,
      SESSION_SECRET: env.SESSION_SECRET || 'test-session-secret-not-real',
      OWNER_SETUP_EMAIL: SUITE_EMAILS,
    });
    o.env = env;
    return realSpawn.call(this, cmd, args, o);
  };
  /* A few steps age saved data by editing db.json while their server
     is stopped. In store mode there is no db.json, so those reads and
     writes go to the fake store under the same server's key prefix. */
  const storeLib = require('../lib/store');
  const tagFor = (dir) => 't' + crypto.createHash('sha256').update(String(dir)).digest('hex').slice(0, 12);
  const isDbFile = (f) => typeof f === 'string' && path.basename(f) === 'db.json';
  const realRead = fs.readFileSync, realWrite = fs.writeFileSync, realExists = fs.existsSync;
  fs.readFileSync = function (f, ...rest) {
    if (!isDbFile(f)) return realRead.call(this, f, ...rest);
    const raw = fake.kv.get(tagFor(path.dirname(f)) + ':db');
    if (raw === undefined) { const e = new Error('ENOENT: no such file ' + f); e.code = 'ENOENT'; throw e; }
    const text = JSON.stringify(storeLib.decode(raw));
    return rest.length && rest[0] ? text : Buffer.from(text);
  };
  fs.writeFileSync = function (f, data, ...rest) {
    if (!isDbFile(f)) return realWrite.call(this, f, data, ...rest);
    const pre = tagFor(path.dirname(f));
    fake.kv.set(pre + ':db', storeLib.encode(JSON.parse(String(data))));
    fake.kv.set(pre + ':ver', String(parseInt(fake.kv.get(pre + ':ver') || '0', 10) + 1));
  };
  fs.existsSync = function (f) {
    if (!isDbFile(f)) return realExists.call(this, f);
    return fake.kv.has(tagFor(path.dirname(f)) + ':db');
  };
  /* Steps that wipe a data folder file by file also wipe its store. */
  const realReaddir = fs.readdirSync, realRm = fs.rmSync, realUnlink = fs.unlinkSync;
  fs.readdirSync = function (dir, ...rest) {
    const out = realReaddir.call(this, dir, ...rest);
    if (!rest.length && fake.kv.has(tagFor(dir) + ':db') && !out.includes('db.json')) out.push('db.json');
    return out;
  };
  const dropStore = (f) => { const pre = tagFor(path.dirname(f)); fake.kv.delete(pre + ':db'); fake.kv.delete(pre + ':ver'); };
  fs.rmSync = function (f, ...rest) {
    if (isDbFile(f)) return dropStore(f);
    if (typeof f === 'string' && fake.kv.has(tagFor(f) + ':db')) dropStore(path.join(f, 'db.json'));
    return realRm.call(this, f, ...rest);
  };
  fs.unlinkSync = function (f, ...rest) {
    if (isDbFile(f)) return dropStore(f);
    return realUnlink.call(this, f, ...rest);
  };
  require('./run-tests.js');
})();
