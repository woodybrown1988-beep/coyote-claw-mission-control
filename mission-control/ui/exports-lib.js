'use strict';
// File-download surface for ~/exports/ (the /coyote/files page + its /coyote/files/download
// endpoint). READ-ONLY, that ONE directory only, no traversal. Pure + socket-free so the
// path-traversal guard is unit-testable (see test/mission-control-files.test.js). The HTTP
// layer (server.js) is gated by Wave-1 auth like everything else — an unauthenticated request
// never reaches here (401 at the gate).

const fs = require('node:fs');
const path = require('node:path');
const { homedir } = require('node:os');

// The one served directory. Overridable for tests via MC_EXPORTS_DIR; defaults to ~/exports.
const EXPORTS_DIR = process.env.MC_EXPORTS_DIR || path.join(homedir(), 'exports');

const CONTENT_TYPES = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
};
function contentTypeFor(name) {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

/** List the REGULAR files directly in `dir` (no recursion), newest-first. lstat (never follows a
 *  symlink) so a symlink is not listed as a file. Read-only; never throws — an unreadable dir → []. */
function listExports(dir = EXPORTS_DIR) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      if (name.startsWith('.')) continue; // dotfiles aren't downloadable (isSafeName rejects them) — don't list them
      const st = fs.lstatSync(path.join(dir, name));
      if (!st.isFile()) continue; // regular files only — skip dirs, symlinks, sockets, dotdirs
      out.push({ name, size: st.size, mtimeMs: st.mtimeMs });
    } catch { /* skip unreadable entry */ }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/** A syntactically-safe download name: a plain filename with NO path components, traversal, absolute
 *  path, dotfile, or NUL. Rejecting here (not silently collapsing) makes a traversal attempt an
 *  explicit refusal. */
function isSafeName(name) {
  if (typeof name !== 'string' || name === '') return false;
  if (/[\x00-\x1f\x7f]/.test(name)) return false; // no control chars (CR/LF/TAB/NUL) — belt-and-braces vs header injection
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  if (path.isAbsolute(name)) return false;
  if (name !== path.basename(name)) return false;
  if (name.startsWith('.')) return false; // no dotfiles (e.g. .env backups)
  return true;
}

/** Resolve a requested name to a real regular file DIRECTLY inside `dir`, or null. Defense-in-depth:
 *  syntactic guard THEN a realpath check (a symlink whose target escapes `dir` fails `dirname === dir`). */
function resolveExportFile(rawName, dir = EXPORTS_DIR) {
  let name;
  try { name = decodeURIComponent(String(rawName)); } catch { return { error: 'bad-name' }; }
  if (!isSafeName(name)) return { error: 'bad-name' };
  let realDir, real;
  try {
    realDir = fs.realpathSync(dir);
    real = fs.realpathSync(path.join(realDir, name));
  } catch { return { error: 'not-found' }; } // absent
  if (path.dirname(real) !== realDir) return { error: 'not-found' }; // escapes the dir (symlink-out)
  let st;
  try { st = fs.statSync(real); } catch { return { error: 'not-found' }; }
  if (!st.isFile()) return { error: 'not-found' };
  return { path: real, name, size: st.size };
}

/** Pure responder for GET /coyote/files/download?name=... . Returns a plain object the socket layer
 *  turns into a response: 400 (traversal / bad name), 404 (absent / escapes dir), or 200 + a filePath
 *  to stream with an attachment disposition. Never returns a path outside `dir`. */
function fileDownloadResponse(rawName, dir = EXPORTS_DIR) {
  const r = resolveExportFile(rawName, dir);
  if (r.error === 'bad-name') return { status: 400, contentType: 'text/plain; charset=utf-8', body: 'invalid filename' };
  if (r.error) return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' };
  const safeHeaderName = r.name.replace(/["\r\n]/g, '_');
  return {
    status: 200,
    contentType: contentTypeFor(r.name),
    disposition: `attachment; filename="${safeHeaderName}"; filename*=UTF-8''${encodeURIComponent(r.name)}`,
    filePath: r.path,
    size: r.size,
  };
}

module.exports = { EXPORTS_DIR, listExports, isSafeName, resolveExportFile, fileDownloadResponse, contentTypeFor };
