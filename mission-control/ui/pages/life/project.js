'use strict';
// LIFE OS — PROJECT DRAWER (operator ask 2026-08-10): click a project anywhere and land
// here — the project's own view with every task that lives in it. Per task: VIEW (open
// the task drawer), EDIT (rename in place), REMOVE from the project (assign_project with
// a null home — the task lives on, standalone), or CANCEL it outright (the system's
// audited delete). Mirrors the task drawer's shape: reached by links, no sidebar slot
// (workspaceOf prefix fallback), every button an allowlisted command the writer
// re-validates — a stale page can be refused loudly but never corrupt.
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;

const STATUS_ORDER = ['IN_PROGRESS', 'AWAITING_APPROVAL', 'BLOCKED', 'READY', 'SCHEDULED', 'BATCH', 'INBOX', 'WAITING'];
const TERMINAL = ['DONE', 'CANCELLED'];

function btnCmd(label, command, payload) {
  const cmd = LIFE.esc(JSON.stringify({ command, payload }));
  return `<button class="r-btn small" data-lc-cmd="${cmd}">${LIFE.esc(label)}</button>`;
}

module.exports = {
  key: 'life-project', route: '/life/project', workspace: 'life', title: 'Project',
  sub: 'One project — its definition of done and every task that lives in it',

  getSection(_db, ctx) {
    const id = ctx && ctx.query && typeof ctx.query.id === 'string' ? ctx.query.id : '';
    if (!id) return { err: 'no project id — open a project from the Projects page' };
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const pj = LIFE.lifeSelect(o.db, 'SELECT * FROM life_projects WHERE id = ?', [id]);
      if (!pj.ok || !pj.rows.length) return { err: `no such project ${id}` };
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        engine: { ok: true },
        project: pj.rows[0],
        tasks: q('SELECT id, title, status, domain_key, due_kind, due_at, execution_mode FROM life_tasks WHERE project_id = ? ORDER BY created_at', [id]),
        waiting: q("SELECT task_id, dependency_label, fallback_at FROM life_waiting_conditions WHERE state = 'ACTIVE' AND task_id IN (SELECT id FROM life_tasks WHERE project_id = ?)", [id]),
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.err) return { stamp: '', body: wrap(LIFE.emptyCard('Project', 'Not found', s.err, '<a class="r-btn" href="/life/projects">All projects</a>')) };
    if (!s.engine || !s.engine.ok) return { stamp: '', body: wrap(LIFE.absentCard('This project')) };
    const p = s.project;
    const pid = String(p.id);
    const living = (s.tasks || []).filter((t) => !TERMINAL.includes(String(t.status)))
      .sort((a, b) => STATUS_ORDER.indexOf(String(a.status)) - STATUS_ORDER.indexOf(String(b.status)));
    const finished = (s.tasks || []).filter((t) => TERMINAL.includes(String(t.status)));
    const waitOf = {};
    for (const w of s.waiting || []) waitOf[w.task_id] = w;

    // ── project header: the same controls Projects offers, plus the way back ──
    const riskTone = { GREEN: 'good', AMBER: 'warn', RED: 'bad' };
    const projectCtl = TERMINAL.includes(String(p.status)) ? '' :
      `<button class="r-btn small" data-lc-rename="${LIFE.esc(JSON.stringify({ kind: 'project', id: pid, title: p.title }))}">Rename…</button>`
      + `<button class="lc-cxl" data-lc-cancel-project="${LIFE.esc(pid)}">✕ cancel project</button>`;
    const head = `<div class="r-card r-panel"><div class="r-eyebrow">${LIFE.esc(String(p.stage || '').toLowerCase())}</div>
      <h3 style="margin-bottom:6px">${LIFE.esc(p.title)}</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 10px">
        ${S.rcc.tag(String(p.status).toLowerCase())}${S.rcc.tag(p.domain_key)}${p.risk_state ? S.rcc.tag('risk ' + String(p.risk_state).toLowerCase(), riskTone[p.risk_state] || '') : ''}${p.due_date ? S.rcc.tag('due ' + String(p.due_date).slice(0, 10)) : ''}
      </div>
      <div class="r-defbox"><small>Definition of done</small><div style="font-size:13px;line-height:1.45">${LIFE.esc(p.definition_of_done || '')}</div></div>
      <div class="lc-row" style="align-items:center"><a class="r-btn small" href="/life/projects">← All projects</a> ${projectCtl}</div></div>`;

    // ── the tasks that live here — each with its four verbs ──
    const taskRow = (t) => {
      const tid = String(t.id);
      const w = waitOf[tid];
      const terminal = TERMINAL.includes(String(t.status));
      const verbs = terminal ? '' :
        `<button class="r-btn small" data-lc-rename="${LIFE.esc(JSON.stringify({ kind: 'task', id: tid, title: t.title }))}">Rename…</button>`
        + ` ${btnCmd('Remove from project', 'assign_project', { taskId: tid, projectId: null })}`
        + ` <button class="lc-cxl" data-lc-cancel="${LIFE.esc(tid)}">✕ cancel</button>`;
      return `<div class="r-lrow"><div style="min-width:0">
          <div style="font-weight:600"><a href="/life/task?id=${encodeURIComponent(tid)}" style="color:inherit">${LIFE.esc(t.title)}</a></div>
          <div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">${S.rcc.tag(String(t.status).toLowerCase().replace('_', ' '), terminal ? '' : (t.status === 'IN_PROGRESS' ? 'good' : ''))}${S.rcc.tag(t.domain_key)}${t.due_at ? S.rcc.tag(`due ${String(t.due_at).slice(0, 10)}${t.due_kind === 'HARD' ? ' · hard' : ''}`) : ''}</div>
          ${w ? `<div style="font-size:12px;color:#f5c96b;margin-top:3px">Waiting on ${LIFE.esc(w.dependency_label)}${w.fallback_at ? ` · follow-up ${LIFE.esc(String(w.fallback_at).slice(0, 10))}` : ''}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end"><a class="r-btn small" href="/life/task?id=${encodeURIComponent(tid)}">Open</a> ${verbs}</div></div>`;
    };
    const tasksPanel = S.rcc.panel({
      title: 'Work in this project', sub: 'Open a task for its full record — or rename, un-home and cancel right here',
      headRight: living.length ? `<span class="r-pill">${living.length}</span>` : '',
      body: living.length
        ? living.map(taskRow).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing lives here yet. Assign tasks from <a href="/life/tasks">All tasks</a> — every row has a project selector — or capture something and home it here.</div>`,
    });
    const finishedPanel = finished.length ? S.rcc.panel({
      title: 'Finished here', sub: 'Done and cancelled work keeps its name and its record',
      headRight: `<span class="r-pill">${finished.length}</span>`,
      body: finished.map(taskRow).join(''),
    }) : '';

    return { stamp: '', body: wrap(head + tasksPanel + finishedPanel) };
  },
};
