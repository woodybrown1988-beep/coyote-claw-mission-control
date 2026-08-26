'use strict';
// TESTS WRITE TO DISK, NOT TO RAM (operator ruling 2026-08-26, after the third outage of this shape).
//
// /tmp on this box is a 7.5 GB tmpfs — it IS memory — shared by every Claude session running here.
// This suite creates temp SQLite fixtures through os.tmpdir() at 132 call sites. When another
// session left 5.7 GB of week-old scratch behind, a suite run filled the remainder and the shell
// itself died with "Disk quota exceeded". The failures that produces look exactly like code —
// SQLite `disk I/O error`, whole test files red — and clear up on a smaller re-run, which is the
// most expensive kind of false signal.
//
// os.tmpdir() reads TMPDIR at call time on Linux, so setting it once here — before any test file
// loads — redirects every call site at real disk. TEST-ONLY: wired into the `test` script, never
// into the server.
const { mkdirSync, readdirSync, rmSync, statSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const STALE_MS = 6 * 60 * 60 * 1000;   // debris from a KILLED run; a live run is never this old

function testTmpdir(env = process.env, now = Date.now()) {
  // An explicit TMPDIR is the caller's decision — CI, a container, a human debugging. This is a
  // default, not a policy.
  if (env.TMPDIR) return env.TMPDIR;
  const cache = env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache');
  const dir = join(cache, 'coyote-mc', 'test-tmp');
  try { mkdirSync(dir, { recursive: true }); } catch { return null; }
  env.TMPDIR = dir;
  // Moving off tmpfs must not just relocate the hoarding onto disk: a killed suite never cleans
  // up after itself, which is exactly how the RAM disk filled in the first place.
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      try { if (now - statSync(p).mtimeMs > STALE_MS) rmSync(p, { recursive: true, force: true }); }
      catch { /* in use or already gone — not ours to worry about */ }
    }
  } catch { /* an unreadable dir is not a test failure */ }
  return dir;
}

testTmpdir();
module.exports = { testTmpdir };
