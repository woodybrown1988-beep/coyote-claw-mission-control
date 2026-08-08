'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');

// BULK IMPORT inbox (operator brief 2026-08-08): the drop pattern is the reservations
// inbox's — a file in ~/life-os-imports appears here; Preview shows exactly what would be
// created (mappings, refusals, recurring rows split out for per-row rulings); NOTHING
// commits without the operator's tap on the preview. Listing only — reads no file content.
function listImportInbox() {
  const dir = process.env.COYOTE_LIFE_IMPORT_DIR || path.join(os.homedir(), 'life-os-imports');
  try {
    return fs.readdirSync(dir)
      .filter((f) => /\.(csv|xlsx)$/i.test(f))
      .map((f) => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 20);
  } catch (_) { return []; }
}
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

const SECTIONS = [
  ['Inbox — decide what these become', ['INBOX']],
  ['In motion', ['IN_PROGRESS']],
  ['Ready', ['READY', 'SCHEDULED']],
  ['Needs your decision', ['AWAITING_APPROVAL']],
  ['Blocked', ['BLOCKED']],
  ['Batched small work', ['BATCH']],
  ['Waiting', ['WAITING']],
];

module.exports = {
  key: 'life-tasks', route: '/life/tasks', workspace: 'life', title: 'All tasks',
  sub: 'Everything, by state — open any task for its history, updates and actions',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        open: q(`SELECT id, title, status, domain_key, execution_mode, due_kind, due_at FROM life_tasks WHERE status NOT IN ('DONE','CANCELLED') ORDER BY updated_at DESC LIMIT 100`),
        waitingOf: q(`SELECT task_id, dependency_label, fallback_at FROM life_waiting_conditions WHERE state = 'ACTIVE'`),
        // real per-task confidence: the strongest open proposal on that task (never a fabricated score).
        confOf: q(`SELECT task_id, MAX(confidence) conf FROM life_update_proposals WHERE state = 'PROPOSED' GROUP BY task_id`),
        finished: q(`SELECT id, title, status FROM life_tasks WHERE status IN ('DONE','CANCELLED') ORDER BY updated_at DESC LIMIT 12`),
        importFiles: listImportInbox(),
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('All tasks')) };
    const head = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div class="r-capline" data-lc-fab role="button" tabindex="0" style="flex:1;min-width:240px">Capture, ask or command…<kbd>⌘K</kbd></div>
      <input class="lc-input" id="lt-filter" placeholder="Filter by words…" style="max-width:260px" oninput="(function(v){for(const r of document.querySelectorAll('[data-task-row]')){r.style.display=r.textContent.toLowerCase().includes(v)?'':'none';}})(this.value.toLowerCase())"></div>`;
    const wake = (id) => s.waitingOf.find((w) => w.task_id === id);
    const confOf = (id) => { const r = (s.confOf || []).find((c) => c.task_id === id); return r ? Number(r.conf) : null; };
    const row = (t) => {
      const w = wake(t.id);
      const c = confOf(t.id);
      return `<div class="r-lrow" data-task-row><div style="min-width:0"><div style="font-weight:600">${link(t.id, t.title)}</div>
        <div style="font-size:12px;color:var(--rmuted);margin-top:3px">${LIFE.esc(t.domain_key)}${t.due_at ? ` · due ${LIFE.esc(String(t.due_at).slice(0, 10))}${t.due_kind === 'HARD' ? ' (hard)' : ''}` : ''}${w ? ` · waiting on ${LIFE.esc(w.dependency_label)}${w.fallback_at ? ` · follow-up ${LIFE.esc(String(w.fallback_at).slice(0, 10))}` : ''}` : ''}</div></div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">${S.rcc.route(t.execution_mode)}${c != null ? S.rcc.conf(c) : ''}<a class="r-btn small" href="/life/task?id=${encodeURIComponent(t.id)}">Open</a><button class="r-btn small" title="Rename" aria-label="Rename" data-lc-rename="${LIFE.esc(JSON.stringify({ kind: 'task', id: t.id, title: t.title }))}">✎</button><button class="lc-cxl" title="Cancel — reopenable from its page" aria-label="Cancel" data-lc-cancel="${LIFE.esc(t.id)}">✕</button></div></div>`;
    };
    let body = head;
    let shown = 0;
    for (const [label, states] of SECTIONS) {
      const rows = s.open.filter((t) => states.includes(t.status));
      if (!rows.length) continue;
      shown += rows.length;
      body += S.rcc.panel({ title: `${label}`, headRight: `<span class="r-pill">${rows.length}</span>`, body: rows.map(row).join('') });
    }
    if (!shown) {
      body += LIFE.emptyCard('Inbox', 'Nothing open', 'Nothing is open right now. Capture is one keystroke away, from any page.', '<button class="r-btn primary" data-lc-fab>Capture a task</button>');
    }
    if (s.finished.length) {
      body += S.rcc.panel({ title: 'Recently finished', body: s.finished.map((t) => `<div class="r-lrow" data-task-row><div>${link(t.id, t.title)} <span style="margin-left:6px">${S.rcc.tag(t.status.toLowerCase())}</span></div></div>`).join('') });
    }
    const files = s.importFiles || [];
    const fileRow = (f) => `<div class="r-lrow"><div style="min-width:0"><div style="font-weight:600">${LIFE.esc(f.name)}</div>
      <div style="font-size:12px;color:var(--rmuted);margin-top:3px">${Math.max(1, Math.round(f.size / 1024))} KB · ${S.fmtTime(f.mtime)}</div></div>
      <div style="flex-shrink:0"><button class="r-btn small primary" data-lc-import="${LIFE.esc(f.name)}">Preview…</button></div></div>`;
    body += S.rcc.panel({
      title: 'Import', sub: 'Preview first — nothing is created until you commit the preview',
      body: (files.length
        ? files.map(fileRow).join('')
        : '<div style="font-size:13px;color:var(--rmuted);padding:6px 0">The import inbox is empty. Drop a .csv or .xlsx export into <span style="font-family:var(--font-mono,monospace)">~/life-os-imports</span> and it appears here.</div>')
        + '<div data-import-out style="margin-top:10px"></div>',
    });
    return { stamp: '', body: wrap(body) };
  },
};
