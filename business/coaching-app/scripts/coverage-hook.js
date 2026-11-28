'use strict';
/* Loaded into every Node process by scripts/coverage.js (NODE_OPTIONS
   --require). The test suites stop the app with SIGKILL, which would
   throw away its coverage data. This turns those kills into SIGUSR2;
   the app process then writes its coverage and kills itself. */
const v8 = require('v8');
const cp = require('child_process');
process.on('SIGUSR2', () => {
  try { v8.takeCoverage(); } catch (_) { /* coverage not enabled */ }
  process.kill(process.pid, 'SIGKILL');
});
const origKill = cp.ChildProcess.prototype.kill;
cp.ChildProcess.prototype.kill = function (sig) {
  if (sig === undefined || sig === 'SIGTERM' || sig === 'SIGKILL') sig = 'SIGUSR2';
  return origKill.call(this, sig);
};
