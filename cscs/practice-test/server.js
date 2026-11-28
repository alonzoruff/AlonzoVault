'use strict';
/*
 * CSCS practice test: a tiny static server. Node 18+, no dependencies.
 *
 *   node server.js        then open http://localhost:3100
 *   PORT=4000 node server.js
 *
 * It serves the page in public/, the two shared files in lib/, and
 * questions.txt. The question file is read fresh on every request, so new
 * questions show up on the next page load without a restart.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

/* The only files this server will ever send. Nothing else in the repo is reachable. */
const ROUTES = {
  '/': 'public/index.html',
  '/index.html': 'public/index.html',
  '/app.js': 'public/app.js',
  '/styles.css': 'public/styles.css',
  '/lib/questions.js': 'lib/questions.js',
  '/lib/quiz.js': 'lib/quiz.js',
  '/questions.txt': 'questions.txt'
};

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); return res.end(); }
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  const rel = ROUTES[url.pathname];
  if (!rel) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
  fs.readFile(path.join(ROOT, rel), (err, body) => {
    if (err) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Could not read ' + rel); }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(rel)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
      'x-robots-tag': 'noindex'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

function start(port, host) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(port, host, () => resolve(srv));
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3100;
  start(port).then(() => console.log('CSCS practice test running at http://localhost:' + port));
}

module.exports = { start, handler, ROUTES };
