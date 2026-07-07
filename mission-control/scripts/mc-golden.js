'use strict';
// GOLDEN-MASTER WITH DATA — proves every tab renders byte-identical (modulo the workspace-prefix
// rewrite on internal nav links) across the /coyote + /claw restructure. Renders each page against a
// FROZEN SNAPSHOT of the live librarian.db (real data, not empty shells), so a route move that breaks
// a data binding renders differently and FAILS the assert.
//
//   node scripts/mc-golden.js capture   # pre-move: render each page → test/golden/<key>.html
//   node scripts/mc-golden.js assert    # post-move: render each page, compare to the golden
//
// Box-local gate: needs GOLDEN_DB (the snapshot) + the goldens (both gitignored). The harness itself
// is committed so the proof is reproducible on the box.
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('node:sqlite');

const MODE = process.argv[2];
if (MODE !== 'capture' && MODE !== 'assert') { console.error('usage: mc-golden.js capture|assert'); process.exit(2); }
const ROOT = path.join(__dirname, '..');                 // mission-control/
const DB = process.env.GOLDEN_DB || path.join(ROOT, '.golden', 'snapshot.db');
const GOLDEN_DIR = process.env.GOLDEN_DIR || path.join(ROOT, '.golden');
const NOW = 1783500000000;                               // FIXED so capture==assert are deterministic

const DATA = require('../ui/data.js');

// Discover page modules under ui/pages (flat pre-move, coyote/+claw/ subdirs post-move).
function findPages(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findPages(p));
    else if (e.name.endsWith('.js')) {
      const m = require(p);
      if (m && typeof m.getSection === 'function' && typeof m.render === 'function' && m.key) out.push(m);
    }
  }
  return out;
}

// Normalise internal route references so the ONLY tolerated diff is the workspace prefix: any attribute
// value starting /coyote/ or /claw/ (href on links, action on the period-nav forms, etc.) → stripped to /.
function norm(html) { return String(html).replace(/="\/(coyote|claw)\//g, '="/'); }

function renderPage(page, db) {
  const ctx = { q: (sql, params) => DATA.safeSelect(db, sql, params), now: NOW, halt: { halted: false }, query: {} };
  const section = page.getSection(db, ctx);
  const out = page.render(section, ctx) || { stamp: '', body: '' };
  return `<!--stamp:${out.stamp || ''}-->\n${out.body || ''}`;
}

if (!fs.existsSync(DB)) { console.error(`snapshot DB not found at ${DB} — cp the live librarian.db there first`); process.exit(3); }
const db = new sqlite.DatabaseSync(DB, { readOnly: true });
const UI_PAGES = path.join(ROOT, 'ui', 'pages');
const pages = findPages(UI_PAGES).sort((a, b) => a.key.localeCompare(b.key));
if (!pages.length) { console.error('no page modules found under ui/pages'); process.exit(4); }

fs.mkdirSync(GOLDEN_DIR, { recursive: true });
let fail = 0, ok = 0;
for (const page of pages) {
  const html = renderPage(page, db);
  const gPath = path.join(GOLDEN_DIR, `${page.key}.html`);
  if (MODE === 'capture') {
    fs.writeFileSync(gPath, html);
    console.log(`captured ${page.key.padEnd(12)} route=${(page.route || '?').padEnd(24)} ${html.length}b`);
  } else {
    if (!fs.existsSync(gPath)) { console.error(`MISSING golden for ${page.key} (${gPath})`); fail++; continue; }
    const golden = fs.readFileSync(gPath, 'utf8');
    if (norm(golden) === norm(html)) { ok++; console.log(`✓ ${page.key.padEnd(12)} identical (${html.length}b) route=${page.route}`); }
    else {
      fail++;
      // find first divergence for a useful message
      const a = norm(golden), b = norm(html);
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      console.error(`✗ ${page.key} DIFFERS at offset ${i}: golden…${JSON.stringify(a.slice(i, i + 80))} vs post…${JSON.stringify(b.slice(i, i + 80))}`);
    }
  }
}
db.close();
if (MODE === 'assert') { console.log(`\n${ok}/${ok + fail} pages byte-identical (modulo workspace prefix)`); process.exit(fail ? 1 : 0); }
console.log(`\ncaptured ${pages.length} goldens → ${GOLDEN_DIR}`);
