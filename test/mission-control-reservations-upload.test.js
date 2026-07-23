'use strict';
// Reservations file-upload (browser drop → inbox → immediate ingest → inline result). The pure
// security/parse helpers are unit-tested here; the full endpoint is proven end-to-end by the live
// acceptance run in the PR (real CSV inline, junk quarantined w/ reason, double-drop no-op, non-csv
// + oversized refused). Also pins: the page renders the drop zone + the Recent-ingests table, and
// the server registers the route.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const UP = require('../mission-control/ui/upload.js');
const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/reservations.js');

test('security: .csv-only, basename+allowlist sanitise, inbox-only path (no traversal, no injection)', () => {
  assert.equal(UP.isCsvName('weekly.csv'), true);
  assert.equal(UP.isCsvName('evil.txt'), false);
  assert.equal(UP.isCsvName('nodotcsv'), false);
  assert.equal(UP.sanitizeUploadName('../../etc/passwd.csv'), 'passwd.csv', 'traversal stripped to basename');
  assert.equal(UP.sanitizeUploadName('a b;rm -rf.csv'), 'a_b_rm_-rf.csv', 'shell chars neutralised');
  assert.equal(UP.sanitizeUploadName('...hidden.csv'), 'hidden.csv', 'leading dots stripped');
  const inbox = '/home/x/opentable-inbox';
  assert.equal(UP.isWithinDir(inbox, path.join(inbox, 'w.csv')), true);
  assert.equal(UP.isWithinDir(inbox, path.join(inbox, '..', '..', 'evil.csv')), false, 'traversal rejected');
  assert.equal(UP.isWithinDir(inbox, '/etc/passwd'), false);
});

test('parseIngestOutcome: the child stdout is the source of truth (ok / quarantined / skipped / miss)', () => {
  const ok = UP.parseIngestOutcome('drive: not connected\n  ok          weekly.csv — 3 rows (2026-07-20..2026-07-21)\n', 'weekly.csv');
  assert.deepEqual(ok, { status: 'ok', rows: 3, from: '2026-07-20', to: '2026-07-21', detail: null });
  const q = UP.parseIngestOutcome('  quarantined junk.csv — not a reservations export — header missing required columns: visit_date\n', 'junk.csv');
  assert.equal(q.status, 'quarantined'); assert.match(q.detail, /missing required columns/);
  const sk = UP.parseIngestOutcome('  skipped     weekly.csv — already ingested (same content sha)\n', 'weekly.csv');
  assert.equal(sk.status, 'skipped'); assert.match(sk.detail, /already ingested/);
  assert.equal(UP.parseIngestOutcome('  ok  other.csv — 1 rows (a..b)', 'weekly.csv').status, null, 'a different file → no match');
});

test('server registers the upload route + the .csv/inbox constraints are in the handler', () => {
  const srv = fs.readFileSync(path.join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /'\/api\/reservations-upload'/, 'route registered');
  assert.match(srv, /handleReservationsUpload/);
  assert.match(srv, /MAX_UPLOAD_BYTES\s*=\s*25 \* 1024 \* 1024/, '25 MB cap');
  assert.match(srv, /OPENTABLE_INBOX/, 'writes only into the inbox');
  assert.match(srv, /content-length.*MAX_UPLOAD_BYTES|MAX_UPLOAD_BYTES[\s\S]{0,80}413/, 'early oversized 413');
});

test('the Reservations Executive tab renders the Data-drop zone + a live Recent-ingests table', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE reservations_ingest_runs (file_sha TEXT PRIMARY KEY, file_name TEXT, source TEXT, status TEXT, rows_written INTEGER, date_from TEXT, date_to TEXT, detail TEXT, ingested_at INTEGER);
    CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, total_covers INTEGER);
    INSERT INTO reservations_ingest_runs VALUES ('s1','weekly.csv','inbox','ok',312,'2024-05-01','2026-07-20','ok',1784900000000);
    INSERT INTO reservations_ingest_runs VALUES ('s2','junk.csv','inbox','quarantined',NULL,NULL,NULL,'not a reservations export',1784900100000);
    INSERT INTO covers_day VALUES ('2026-07-20', 812);
  `);
  const ctx = { q: (s, p) => DATA.safeSelect(db, s, p), now: Date.parse('2026-07-23T09:00:00Z'), query: { tab: 'executive' } };
  const body = page.render(page.getSection(db, ctx), ctx).body;
  // the drop zone hooks the shared.js delegated uploader binds to
  assert.match(body, /data-res-dropzone/); assert.match(body, /data-res-browse/); assert.match(body, /data-res-result/);
  assert.match(body, /Data drop/); assert.match(body, /\.csv · 25 MB max/);
  // the Recent-ingests table shows the real ledger rows + statuses + covers coverage
  assert.match(body, /Recent ingests/);
  assert.match(body, /weekly\.csv/); assert.match(body, /junk\.csv/);
  assert.match(body, /812 covers/, 'covers coverage from covers_day');
  assert.match(body, /312/, 'rows written surfaced');
});

test('drop-zone JS is in the shared global script; the CSS is page-scoped (keeps other pages clean)', () => {
  const shared = fs.readFileSync(path.join(__dirname, '../mission-control/ui/shared.js'), 'utf8');
  assert.match(shared, /data-res-dropzone/, 'drop handler present in clientScript');
  assert.match(shared, /reservations-upload/, 'POSTs to the upload endpoint');
  assert.doesNotMatch(shared, /\.res-dz\{/, 'drop-zone CSS is NOT in the shared rccCss (page-scoped instead)');
  const resPage = fs.readFileSync(path.join(__dirname, '../mission-control/ui/pages/coyote/reservations.js'), 'utf8');
  assert.match(resPage, /\.res-dz\{/, 'drop-zone CSS lives on the reservations page');
});
