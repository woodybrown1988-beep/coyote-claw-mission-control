'use strict';
// Pure validators for the reservations upload — kept out of server.js so they can be unit-tested.
// The whole security posture in three functions: .csv-only, basename-only + allowlisted characters,
// and a resolved-path-is-inside-the-inbox check. A drop can therefore only ever create a plain
// filename inside the inbox directory — no traversal, no arbitrary write.
const path = require('node:path');

function isCsvName(name) { return /\.csv$/i.test(String(name || '').trim()); }

/** basename (drops any dir components) → allowlist [A-Za-z0-9._-] → strip leading dots. */
function sanitizeUploadName(name) {
  const base = path.basename(String(name || '').trim());
  return base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
}

/** True only when `target` resolves to a path strictly inside `dir`. */
function isWithinDir(dir, target) {
  const d = path.resolve(dir) + path.sep;
  return path.resolve(target).startsWith(d);
}

/** Task-file extension allowlist (operator ask 2026-08-13) — must match the writer's
 *  FILE_KINDS in coyote-claw src/life/taskFiles.ts: two gates, one list. */
const TASK_FILE_EXT_RE = /\.(csv|tsv|txt|md|json|xlsx|docx|pdf|png|jpe?g)$/i;
function isAllowedTaskFileName(name) { return TASK_FILE_EXT_RE.test(String(name || '').trim()); }

/** Parse the reservations-ingest CLI stdout for ONE file's outcome (the child is the source of truth,
 *  immune to DB read-back timing). Lines look like:
 *    "  ok          weekly.csv — 3 rows (2026-07-20..2026-07-20)"
 *    "  quarantined junk.csv — not a reservations export — header missing required columns: ..."
 *    "  skipped     weekly.csv — already ingested (same content sha)"  */
function parseIngestOutcome(stdout, fileName) {
  for (const raw of String(stdout || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^(ok|quarantined|skipped|error)\s+(\S+)(?:\s+—\s+(.*))?$/);
    if (!m || m[2] !== fileName) continue;
    const status = m[1];
    const rest = (m[3] || '').trim();
    if (status === 'ok') {
      const rows = (rest.match(/(\d+)\s+rows/) || [])[1];
      const range = rest.match(/\(([^.]+)\.\.([^)]+)\)/);
      return { status, rows: rows != null ? Number(rows) : null, from: range ? range[1] : null, to: range ? range[2] : null, detail: null };
    }
    return { status, rows: null, from: null, to: null, detail: rest || null };
  }
  return { status: null, rows: null, from: null, to: null, detail: null };
}

module.exports = { isCsvName, sanitizeUploadName, isWithinDir, isAllowedTaskFileName, parseIngestOutcome };
