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

  getSection(_db, ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      // SILENT TRUNCATION, the All-tasks instance (Wave 3, 2026-08-13 audit F1). The old
      // LIMIT 100 hid 45 of 143 READY tasks behind a confident-looking page, and the filter
      // box searched only the fetched DOM — a search could report nothing for a task that
      // exists. Same defect class Today fixed on 2026-08-11; the fix is the same shape:
      // true counts said out loud, a show-all path, and a filter that queries the DATABASE.
      const query = (ctx && ctx.query) || {};
      const qStr = String(query.q || '').trim().slice(0, 120);
      const showAll = String(query.all || '') === '1';
      const like = `%${qStr.replaceAll('%', '').replaceAll('_', '')}%`; // a filter, not a query language
      const openSel = `SELECT id, title, status, domain_key, execution_mode, due_kind, due_at, project_id FROM life_tasks WHERE status NOT IN ('DONE','CANCELLED')`;
      return {
        open: qStr
          ? q(`${openSel} AND (title LIKE ? OR description LIKE ?) ORDER BY updated_at DESC LIMIT 400`, [like, like])
          : q(`${openSel} ORDER BY updated_at DESC LIMIT ${showAll ? 2000 : 100}`),
        counts: q(`SELECT status, COUNT(*) n FROM life_tasks WHERE status NOT IN ('DONE','CANCELLED') GROUP BY status`),
        finishedCount: q(`SELECT COUNT(*) c FROM life_tasks WHERE status IN ('DONE','CANCELLED')`)[0]?.c ?? 0,
        q: qStr, showAll,
        waitingOf: q(`SELECT task_id, dependency_label, fallback_at FROM life_waiting_conditions WHERE state = 'ACTIVE'`),
        // AGENT PRESENCE (operator ask 2026-08-13): latest dispatch per task; live stage
        // resolves in render via ctx.q (business store, by id — cross-domain read by reference).
        // THE RANKING THE DATABASE ALREADY DOES (audit 2026-08-28). v_life_available_work scores
        // every task — importance x10, consequence x7, a time-weighted urgency curve, +15 for an
        // outcome link, -3 for a quick win — and this page ordered by updated_at and rendered 165
        // "Ready" tasks at identical weight. The arithmetic was being thrown away at the last step.
        // Five: enough to be a plan for the next hour, few enough to be read in one glance.
        topRanked: q(`SELECT id, title, domain_key, due_at, due_kind, execution_mode, calculated_priority
                        FROM v_life_available_work ORDER BY calculated_priority DESC, updated_at DESC LIMIT 5`),
        availableCount: q('SELECT COUNT(*) c FROM v_life_available_work')[0]?.c ?? 0,
        dispatchEvents: q(`SELECT task_id, event_type, payload_json FROM life_task_events WHERE event_type IN ('AGENT_DISPATCHED','REOPENED') ORDER BY created_at ASC`),
        // real per-task confidence: the strongest open proposal on that task (never a fabricated score).
        confOf: q(`SELECT task_id, MAX(confidence) conf FROM life_update_proposals WHERE state = 'PROPOSED' GROUP BY task_id`),
        finished: q(`SELECT id, title, status FROM life_tasks WHERE status IN ('DONE','CANCELLED') ORDER BY updated_at DESC LIMIT 12`),
        importFiles: listImportInbox(),
        projects: q("SELECT id, title, status FROM life_projects WHERE status NOT IN ('CANCELLED','DONE') ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, title"),
      };
    } finally { o.db.close(); }
  },

  render(section, ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('All tasks')) };
    // Agent presence chips: task → latest job → live status (in-flight only; a delivered
    // job's presence is the proposal already on the row's confidence chip).
    const dispatchOf = LIFE.dispatchStateByTask(s.dispatchEvents || []);
    const jobsById = LIFE.jobStates((ctx && ctx.q) || null, [...dispatchOf.values()].map((d) => d.jobId));
    const presenceOf = (taskId) => {
      const d = dispatchOf.get(taskId);
      if (!d) return '';
      const j = jobsById.get(d.jobId);
      if (!j || !LIFE.IN_FLIGHT_STATUSES.includes(String(j.status))) return '';
      return ` · ${LIFE.agentChip(d.jobKind, String(j.status))}`;
    };
    // The agent is stuck until you speak → light-red row + the reason, right here.
    const needsYouOf = (taskId) => LIFE.agentNeedsYou(dispatchOf.get(taskId), jobsById.get((dispatchOf.get(taskId) || {}).jobId));
    // The search is a FORM, not a DOM filter: it queries every open task in the database
    // (title + description), so "no results" finally means what it says. The old oninput
    // filter searched only the 100 fetched rows — a lie by omission on 145 open tasks.
    const totalOpen = (s.counts || []).reduce((a, c) => a + Number(c.n || 0), 0);
    const head = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div class="r-capline" data-lc-fab role="button" tabindex="0" style="flex:1;min-width:240px">Capture, ask or command…<kbd>⌘K</kbd></div>
      <form method="get" action="/life/tasks" class="lc-search-form" style="display:flex;gap:6px;align-items:center;margin:0">
        <input class="lc-input" name="q" value="${LIFE.esc(s.q || '')}" placeholder="Search every open task…" style="max-width:240px">
        ${s.showAll ? '<input type="hidden" name="all" value="1">' : ''}
        <button class="r-btn small" type="submit">Search</button>
        ${s.q ? `<a class="r-btn small" href="/life/tasks${s.showAll ? '?all=1' : ''}">Clear</a>` : ''}
      </form>
      <select class="r-routesel" data-assign-bulk-sel style="max-width:170px"><option value="">— bulk: pick a project —</option>${(s.projects || []).map((pj) => `<option value="${LIFE.esc(pj.id)}">${LIFE.esc(pj.title)}${pj.status === 'ACTIVE' ? '' : ` (${LIFE.esc(String(pj.status).toLowerCase())})`}</option>`).join('')}</select>
      <button class="r-btn small" data-lc-assign-bulk title="Assign every VISIBLE row — each task gets its own audited record">Assign visible…</button></div>`
      + (s.q
        ? `<div class="r-note" style="margin-bottom:10px">${s.open.length} of ${totalOpen} open task${totalOpen === 1 ? '' : 's'} match “${LIFE.esc(s.q)}” — searched every open task, title and description.</div>`
        : (!s.showAll && totalOpen > s.open.length
          ? `<div class="r-note" style="color:#f5c96b;margin-bottom:10px">Showing the ${s.open.length} most recently touched of <b>${totalOpen}</b> open tasks — <a href="/life/tasks?all=1">show all ${totalOpen}</a>.</div>`
          : ''));
    const wake = (id) => s.waitingOf.find((w) => w.task_id === id);
    const confOf = (id) => { const r = (s.confOf || []).find((c) => c.task_id === id); return r ? Number(r.conf) : null; };
    const pjSel = (t) => `<select class="r-routesel lc-assign-sel" data-task="${LIFE.esc(t.id)}" title="Project home — parked = not this quarter's fight" style="max-width:170px">
      <option value=""${t.project_id ? '' : ' selected'}>— no project —</option>
      ${(s.projects || []).map((pj) => `<option value="${LIFE.esc(pj.id)}"${t.project_id === pj.id ? ' selected' : ''}>${LIFE.esc(pj.title)}${pj.status === 'ACTIVE' ? '' : ` (${LIFE.esc(String(pj.status).toLowerCase())})`}</option>`).join('')}
    </select>`;
    const row = (t) => {
      const w = wake(t.id);
      const c = confOf(t.id);
      const nu = needsYouOf(t.id);
      return `<div class="r-lrow" data-task-row data-task-id="${LIFE.esc(t.id)}"${nu ? ` data-needs-you="1" style="${LIFE.NEEDS_YOU_ROW_STYLE}"` : ''}><div style="min-width:0"><div style="font-weight:600">${link(t.id, t.title)}</div>
        ${LIFE.needsYouChip(nu)}
        <div style="font-size:12px;color:var(--rmuted);margin-top:3px">${LIFE.esc(t.domain_key)}${t.due_at && t.due_kind !== 'NONE' ? ` · <span class="lt-due lt-due-${LIFE.dueSeverity(t.due_at)}">${LIFE.esc(LIFE.duePhrase(t.due_at))}</span>${t.due_kind === 'HARD' ? ' (hard)' : ''}` : ''}${w ? ` · waiting on ${LIFE.esc(w.dependency_label)}${w.fallback_at ? ` · follow-up ${LIFE.esc(String(w.fallback_at).slice(0, 10))}` : ''}` : ''}${presenceOf(t.id)}</div></div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">${pjSel(t)}${S.rcc.route(t.execution_mode)}${c != null ? S.rcc.conf(c) : ''}<a class="r-btn small" href="/life/task?id=${encodeURIComponent(t.id)}">Open</a><button class="r-btn small" title="Rename" aria-label="Rename" data-lc-rename="${LIFE.esc(JSON.stringify({ kind: 'task', id: t.id, title: t.title }))}">✎</button><button class="lc-cxl" title="Cancel — reopenable from its page" aria-label="Cancel" data-lc-cancel="${LIFE.esc(t.id)}">✕</button></div></div>`;
    };
    let body = head;

    // ── NEXT FIVE (audit 2026-08-28) ─────────────────────────────────────────────────────
    // The list below groups by STATE, which is the right way to answer "where is everything".
    // It is the wrong way to answer "what now" — and 165 tasks sat in Ready at identical weight
    // while the database was already ranking them. This panel spends the score: five tasks, the
    // severity readable as form before it is read as words, and each one saying WHY it ranks
    // there so the order can be argued with rather than merely obeyed.
    // Hidden when searching (a search is its own question) and when the board is nearly empty.
    if (!s.q && Array.isArray(s.topRanked) && s.topRanked.length >= 3) {
      const rank = (t) => {
        const sev = t.due_at && t.due_kind !== 'NONE' ? LIFE.dueSeverity(t.due_at) : 'none';
        const bits = [];
        const due = t.due_at && t.due_kind !== 'NONE' ? LIFE.duePhrase(t.due_at) : '';
        if (due) bits.push(`<span class="lt-due lt-due-${sev}">${LIFE.esc(due)}</span>`);
        if (t.due_kind === 'HARD') bits.push('hard date');
        if (t.execution_mode) bits.push(LIFE.esc(String(t.execution_mode).toLowerCase()));
        bits.push(LIFE.esc(String(t.domain_key || '')));
        return `<div class="r-lrow lt-rank" data-task-row>`
          + `<div class="lt-rail lt-rail-${sev}"></div>`
          + `<div style="min-width:0;flex:1">${link(t.id, t.title)}`
          + `<div style="font-size:12px;color:var(--rmuted);margin-top:3px">${bits.filter(Boolean).join(' · ')}</div></div>`
          + `</div>`;
      };
      const rest = Math.max(0, Number(s.availableCount || 0) - s.topRanked.length);
      body += S.rcc.panel({
        title: 'Next five',
        sub: 'Ranked by what the deadline, the consequence and the outcome link add up to',
        headRight: `<span class="r-pill">${s.topRanked.length}</span>`,
        body: s.topRanked.map(rank).join('')
          + (rest ? `<div class="r-note">${rest} further task${rest === 1 ? '' : 's'} rank below these — the full board is grouped by state underneath.</div>` : ''),
      });
    }
    let shown = 0;
    // True per-state totals from COUNT, not from the fetched page: a pill that quietly
    // meant "of the rows we happened to fetch" is the defect this page had (audit F1).
    const totalFor = (states) => (s.counts || []).filter((c) => states.includes(c.status)).reduce((a, c) => a + Number(c.n || 0), 0);
    for (const [label, states] of SECTIONS) {
      const rows = s.open.filter((t) => states.includes(t.status));
      const total = totalFor(states);
      if (!rows.length && (s.q || !total)) continue; // searching: only sections with matches
      shown += rows.length;
      const pill = rows.length === total || s.q ? `${rows.length}` : `${rows.length} of ${total}`;
      body += S.rcc.panel({
        title: `${label}`, headRight: `<span class="r-pill">${pill}</span>`,
        body: (rows.length ? rows.map(row).join('') : '')
          + (!s.q && total > rows.length
            ? `<div class="r-note" style="color:#f5c96b">${total - rows.length} more ${label.split(' — ')[0].toLowerCase()} task${total - rows.length === 1 ? '' : 's'} not shown — <a href="/life/tasks?all=1">show all</a>.</div>`
            : ''),
      });
    }
    if (!shown && !totalFor(SECTIONS.flatMap(([, st]) => st))) {
      body += LIFE.emptyCard('Inbox', 'Nothing open', 'Nothing is open right now. Capture is one keystroke away, from any page.', '<button class="r-btn primary" data-lc-fab>Capture a task</button>');
    }
    if (s.finished.length) {
      const finMore = Math.max(0, (s.finishedCount || 0) - s.finished.length);
      body += S.rcc.panel({
        title: 'Recently finished', headRight: `<span class="r-pill">${s.finished.length}${finMore ? ` of ${s.finishedCount}` : ''}</span>`,
        body: s.finished.map((t) => `<div class="r-lrow" data-task-row><div>${link(t.id, t.title)} <span style="margin-left:6px">${S.rcc.tag(t.status.toLowerCase())}</span></div></div>`).join('')
          + (finMore ? `<div class="r-note">${finMore} older finished task${finMore === 1 ? '' : 's'} stay on their own pages — every one is reachable from its project or a search.</div>` : ''),
      });
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
