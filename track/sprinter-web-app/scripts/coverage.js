'use strict';
/* Test coverage with Node's own built-in V8 coverage; no packages.
   Usage (from the app folder):
     node scripts/coverage.js            run every test file, print a table
     node scripts/coverage.js --missed   also list the code blocks no test reaches
   "lines" counts lines with code that ran at least once; "branches"
   counts the if/else arms, loops and other inner blocks V8 tracks.
   Test files and these scripts are left out of the numbers. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileURLToPath } = require('url');

const appDir = path.resolve(__dirname, '..');
const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-'));
const hook = path.join(__dirname, 'coverage-hook.js');
const showMissed = process.argv.includes('--missed');

let failedSuites = 0;
for (const f of fs.readdirSync(path.join(appDir, 'tests')).sort()) {
  if (!f.endsWith('.js') || f === 'harness.js') continue;
  const r = spawnSync(process.execPath, [path.join('tests', f)], {
    cwd: appDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { NODE_V8_COVERAGE: covDir, NODE_OPTIONS: '--require ' + hook }),
  });
  const last = (r.stdout || '').trim().split('\n').pop();
  console.log((r.status === 0 ? 'ok   ' : 'FAIL ') + f.padEnd(28) + last);
  if (r.status !== 0) failedSuites++;
}

const files = new Map(); // abs path -> {src, counts:Float64Array, fns: Map(key->count)}
for (const f of fs.readdirSync(covDir)) {
  if (!f.endsWith('.json')) continue;
  const data = JSON.parse(fs.readFileSync(path.join(covDir, f), 'utf8'));
  for (const s of data.result) {
    if (!s.url.startsWith('file://')) continue;
    const p = fileURLToPath(s.url);
    const rel = path.relative(appDir, p);
    if (rel.startsWith('..') || rel.startsWith('tests' + path.sep) || rel.startsWith('scripts' + path.sep)) continue;
    let e = files.get(p);
    if (!e) { const src = fs.readFileSync(p, 'utf8'); e = { src, counts: new Float64Array(src.length), fns: new Map(), blocks: new Set() }; files.set(p, e); }
    const ranges = [];
    for (const fn of s.functions) {
      const r0 = fn.ranges[0];
      if (fn.functionName !== '' || r0.startOffset !== 0) {
        const key = r0.startOffset + ':' + r0.endOffset;
        e.fns.set(key, (e.fns.get(key) || 0) + r0.count);
      }
      fn.ranges.forEach((r, i) => { ranges.push(r); if (i > 0) e.blocks.add(r.startOffset + ':' + r.endOffset); });
    }
    ranges.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
    const tmp = new Float64Array(e.src.length);
    for (const r of ranges) tmp.fill(r.count, r.startOffset, Math.min(r.endOffset, e.src.length));
    for (let i = 0; i < tmp.length; i++) e.counts[i] += tmp[i];
  }
}
console.log('');
const out = {};
for (const [p, e] of files) {
  const lines = e.src.split('\n');
  let off = 0, code = 0, hit = 0; const miss = [];
  let inBlock = false;
  lines.forEach((ln, i) => {
    const t = ln.trim();
    let isCode = t.length > 0;
    if (inBlock) { isCode = false; if (t.includes('*/')) inBlock = false; }
    else if (t.startsWith('//')) isCode = false;
    else if (t.startsWith('/*')) { isCode = false; if (!t.includes('*/')) inBlock = true; }
    if (isCode && /^[)}\];,]+$/.test(t)) isCode = false; // closing punctuation only
    if (isCode) {
      code++;
      let any = false;
      for (let j = off; j < off + ln.length; j++) { if (ln[j - off] !== ' ' && e.counts[j] > 0) { any = true; break; } }
      if (any) hit++; else miss.push(i + 1);
    }
    off += ln.length + 1;
  });
  let bHit = 0; for (const k of e.blocks) if (e.counts[+k.split(':')[0]] > 0) bHit++;
  const fnTotal = e.fns.size; let fnHit = 0; for (const c of e.fns.values()) if (c > 0) fnHit++;
  const lineOf = (o) => { let n = 1; for (let i = 0; i < o; i++) if (e.src.charCodeAt(i) === 10) n++; return n; };
  const missedBlocks = []; for (const k of e.blocks) { const [a, b] = k.split(':').map(Number); if (!(e.counts[a] > 0)) missedBlocks.push([lineOf(a), lineOf(b), e.src.slice(a, Math.min(b, a + 70)).replace(/\s+/g, ' ')]); }
  missedBlocks.sort((x, y) => x[0] - y[0]);
  out[path.relative(appDir, p)] = { missedBlocks, lines: code, linesHit: hit, fns: fnTotal, fnsHit: fnHit, blocks: e.blocks.size, blocksHit: bHit };
}
const pct = (h, t) => (t ? (100 * h / t).toFixed(1) + '%' : '-') + ` (${h}/${t})`;
let L = 0, LH = 0, F = 0, FH = 0, B = 0, BH = 0;
for (const [k, v] of Object.entries(out).sort()) {
  L += v.lines; LH += v.linesHit; F += v.fns; FH += v.fnsHit; B += v.blocks; BH += v.blocksHit;
  console.log(k.padEnd(28), 'lines', pct(v.linesHit, v.lines), ' functions', pct(v.fnsHit, v.fns), ' branches', pct(v.blocksHit, v.blocks));
}
console.log('ALL'.padEnd(28), 'lines', pct(LH, L), ' functions', pct(FH, F), ' branches', pct(BH, B));
if (showMissed) {
  for (const [k, v] of Object.entries(out).sort()) {
    if (!v.missedBlocks.length) continue;
    console.log('\n' + k + ': ' + v.missedBlocks.length + ' blocks never run');
    for (const [a, b, snip] of v.missedBlocks) console.log('  ' + (a === b ? String(a) : a + '-' + b).padEnd(12) + snip);
  }
}
fs.rmSync(covDir, { recursive: true, force: true });
if (failedSuites) { console.error('\n' + failedSuites + ' test file(s) failed'); process.exit(1); }
