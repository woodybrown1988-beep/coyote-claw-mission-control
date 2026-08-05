'use strict';
// /coyote/files download surface — the traversal guard + listing + auth gating.
// NEGATIVE CONTROLS (the security contract): a path-traversal attempt is refused; a file outside
// ~/exports is unreachable (incl. via a symlink); an unauthenticated request is 401 (the path is
// non-public, so the Wave-1 gate rejects it). The guard lives in ui/exports-lib.js and is pure, so
// it is tested without sockets — same pattern as reportRawResponse.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const EX = require('../mission-control/ui/exports-lib.js');
const AUTH = require('../mission-control/ui/auth.js');

function tmpExports() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-exports-'));
  return dir;
}

test('listExports: regular files only, newest-first, with size — no dirs/dotfiles/symlinks', () => {
  const dir = tmpExports();
  fs.writeFileSync(path.join(dir, 'a.xlsx'), 'AAAA');            // 4 bytes
  fs.writeFileSync(path.join(dir, 'b.csv'), 'BB');              // 2 bytes
  fs.mkdirSync(path.join(dir, 'sub'));                          // dir — excluded
  fs.writeFileSync(path.join(dir, '.hidden'), 'x');            // dotfile — excluded
  // make b.csv newest
  const now = Date.now();
  fs.utimesSync(path.join(dir, 'a.xlsx'), new Date(now - 10000), new Date(now - 10000));
  fs.utimesSync(path.join(dir, 'b.csv'), new Date(now), new Date(now));
  const outsider = path.join(os.tmpdir(), 'mc-outsider-' + process.pid + '.txt');
  fs.writeFileSync(outsider, 'SECRET');
  fs.symlinkSync(outsider, path.join(dir, 'link.txt'));        // symlink — excluded from listing

  const files = EX.listExports(dir);
  const names = files.map((f) => f.name);
  assert.deepEqual(names, ['b.csv', 'a.xlsx'], 'newest-first, only the 2 regular files');
  assert.equal(files.find((f) => f.name === 'a.xlsx').size, 4);
  assert.ok(!names.includes('sub') && !names.includes('.hidden') && !names.includes('link.txt'));
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outsider, { force: true });
});

test('fileDownloadResponse: a real file → 200 + attachment disposition + a path inside the dir', () => {
  const dir = tmpExports();
  fs.writeFileSync(path.join(dir, 'catalogue.xlsx'), 'ZIPBYTES');
  const r = EX.fileDownloadResponse('catalogue.xlsx', dir);
  assert.equal(r.status, 200);
  assert.match(r.contentType, /spreadsheetml\.sheet/);
  assert.match(r.disposition, /attachment; filename="catalogue\.xlsx"/);
  assert.equal(path.dirname(fs.realpathSync(r.filePath)), fs.realpathSync(dir), 'served path is inside ~/exports');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('NEGATIVE CONTROL: path-traversal attempts are REFUSED (400), never served', () => {
  const dir = tmpExports();
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'ok');
  for (const bad of [
    '../../etc/passwd',
    '..%2F..%2Fetc%2Fpasswd',       // url-encoded traversal
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/etc/passwd',                   // absolute
    '..\\..\\windows\\system32',     // backslash
    'sub/../ok.txt',                 // path component
    '.hidden',                       // dotfile
    'inj\r\nSet-Cookie: pwned',      // CR/LF — header-injection shaped
    'tab\there.txt',                 // control char (TAB)
    '',                              // empty
  ]) {
    const r = EX.fileDownloadResponse(bad, dir);
    assert.equal(r.status, 400, `refused: ${JSON.stringify(bad)}`);
    assert.ok(!('filePath' in r), 'no file path leaked on a refused name');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('NEGATIVE CONTROL: a file OUTSIDE ~/exports is unreachable — direct + via a symlink → not served', () => {
  const dir = tmpExports();
  const outsider = path.join(os.tmpdir(), 'mc-secret-' + process.pid + '.txt');
  fs.writeFileSync(outsider, 'TOP SECRET');
  fs.symlinkSync(outsider, path.join(dir, 'escape.txt'));      // symlink whose target escapes the dir
  const viaSymlink = EX.fileDownloadResponse('escape.txt', dir);
  assert.equal(viaSymlink.status, 404, 'a symlink pointing outside ~/exports is not served');
  assert.ok(!('filePath' in viaSymlink));
  // a symlink to a real system file, same result
  const sysLink = path.join(dir, 'hosts');
  try { fs.symlinkSync('/etc/hostname', sysLink); } catch (_) { /* platform */ }
  if (fs.existsSync(sysLink)) assert.equal(EX.fileDownloadResponse('hosts', dir).status, 404);
  // an absent name → 404
  assert.equal(EX.fileDownloadResponse('nope.xlsx', dir).status, 404);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outsider, { force: true });
});

test('NEGATIVE CONTROL: the download + page paths are NON-public → the auth gate 401s an unauthenticated request', () => {
  // isPublicPath === false means handleRequest returns 401/redirect before the handler runs.
  assert.equal(AUTH.isPublicPath('/coyote/files/download', false), false, 'download endpoint is auth-gated');
  assert.equal(AUTH.isPublicPath('/coyote/files/download', true), false);
  assert.equal(AUTH.isPublicPath('/coyote/files', true), false, 'the page is auth-gated');
  // sanity: the known public paths still are (guards against a broken gate)
  assert.equal(AUTH.isPublicPath('/login', true), true);
  assert.equal(AUTH.isPublicPath('/healthz', false), true);
});

test('wiring: server exports the responder; the page + nav tab are registered', () => {
  const server = require('../mission-control/server.js');
  assert.equal(typeof server.fileDownloadResponse, 'function', 'server re-exports fileDownloadResponse');
  const files = require('../mission-control/ui/pages/coyote/files.js');
  assert.equal(files.route, '/coyote/files');
  assert.equal(files.workspace, 'coyote');
  const shared = fs.readFileSync(path.join(__dirname, '../mission-control/ui/shared.js'), 'utf8');
  assert.match(shared, /key: 'files', label: 'Files', route: '\/coyote\/files'/, 'nav registry has the Files tab');
});
