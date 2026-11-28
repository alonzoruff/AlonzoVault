#!/usr/bin/env node
'use strict';
/*
 * One-time copy of a db.json file into the hosted data store, for the
 * move from Render to Vercel. It writes the file exactly as it is
 * (accounts, logs, roster, everything), reads it back, and checks that
 * every collection has the same number of records.
 *
 * Usage (the store settings come from the environment; never paste
 * them into a chat or a file in the repo):
 *
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
 *     node scripts/copy-to-store.js path/to/db.json
 *
 * By default it refuses to write over a store that already has data.
 * Add --replace to overwrite it on purpose (for example, re-running
 * the final copy after a practice run). Add --check to only compare
 * the file against what the store holds, without writing.
 *
 * STORE_PREFIX must match the app's (default ayg-lab) if it was set.
 */
const fs = require('fs');
const path = require('path');
const storeLib = require('../lib/store');

const DEFAULT_PREFIX = 'ayg-lab';

function counts(data) {
  const out = {};
  for (const k of Object.keys(data || {}).sort()) {
    const v = data[k];
    if (Array.isArray(v)) out[k] = v.length;
    else if (v && typeof v === 'object') out[k] = Object.keys(v).length;
  }
  return out;
}

async function main(argv, env, print) {
  const args = argv.filter(a => !a.startsWith('--'));
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  if (args.length !== 1) {
    print('Usage: node scripts/copy-to-store.js path/to/db.json [--replace] [--check]');
    return 2;
  }
  const cfg = storeLib.configFromEnv(env, DEFAULT_PREFIX);
  if (!cfg) {
    print('The data store settings are not set (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).');
    return 2;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.resolve(args[0]), 'utf8'));
  } catch (err) {
    print('Could not read that file as JSON: ' + err.message);
    return 2;
  }
  if (!data || !Array.isArray(data.users)) {
    print('That file does not look like the app\'s db.json (no users list).');
    return 2;
  }
  const store = storeLib.createUpstash(cfg);
  const before = await store.load();
  const want = counts(data);

  if (!flags.has('--check')) {
    if (before.data && !flags.has('--replace')) {
      print('The store already holds data (' + (before.data.users || []).length + ' accounts). Nothing was written.');
      print('Re-run with --replace to overwrite it on purpose.');
      return 1;
    }
    const v = await store.commit(before.version, data);
    if (v === -1) {
      print('The store changed while copying (is the app running against it?). Nothing was written. Try again.');
      return 1;
    }
    print('Copied into store "' + cfg.prefix + '" (version ' + v + ').');
  }

  const after = await store.load();
  const got = counts(after.data);
  let ok = true;
  print('');
  print('Collection'.padEnd(26) + 'File'.padStart(8) + 'Store'.padStart(8));
  for (const k of Object.keys(Object.assign({}, want, got)).sort()) {
    const a = want[k], b = got[k];
    const same = a === b;
    if (!same) ok = false;
    print(k.padEnd(26) + String(a === undefined ? '-' : a).padStart(8) + String(b === undefined ? '-' : b).padStart(8) + (same ? '' : '   <- different'));
  }
  print('');
  print(ok ? 'All counts match.' : 'Some counts differ. Do not switch over yet.');
  return ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, (m) => console.log(m))
    .then((code) => process.exit(code))
    .catch((err) => { console.error('Copy failed: ' + err.message); process.exit(1); });
}

module.exports = { main, counts };
