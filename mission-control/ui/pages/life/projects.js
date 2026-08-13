'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-projects', route: '/life/projects', workspace: 'life', title: 'Projects',
  sub: 'Four active at most — each with a definition of done and a next executable action',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        projects: q(`SELECT id, title, domain_key, stage, status, risk_state, definition_of_done, due_date FROM life_projects ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PARKED' THEN 1 WHEN 'WAITING' THEN 1 ELSE 2 END, created_at LIMIT 20`),
        nexts: q(`SELECT project_id, id, title FROM v_life_available_work WHERE project_id IS NOT NULL ORDER BY calculated_priority DESC`),
        // REAL progress (operator ask 2026-08-13): tasks done over tasks that exist — the
        // one percentage this page can say honestly, always shown WITH its fraction.
        counts: q(`SELECT project_id, SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) done,
                          SUM(CASE WHEN status NOT IN ('DONE','CANCELLED') THEN 1 ELSE 0 END) live
                     FROM life_tasks WHERE project_id IS NOT NULL GROUP BY project_id`),
        taskProject: q(`SELECT id, project_id FROM life_tasks WHERE project_id IS NOT NULL AND status NOT IN ('DONE','CANCELLED')`),
        dispatchEvents: q(`SELECT task_id, event_type, payload_json FROM life_task_events WHERE event_type IN ('AGENT_DISPATCHED','REOPENED') ORDER BY created_at ASC`),
      };
    } finally { o.db.close(); }
  },

  render(section, ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('Projects')) };
    const active = s.projects.filter((p) => p.status === 'ACTIVE');
    const rest = s.projects.filter((p) => p.status !== 'ACTIVE');
    const riskTone = { GREEN: 'good', AMBER: 'warn', RED: 'bad' };
    // Agent presence per project: this project's tasks → their latest jobs → in-flight ones,
    // named. Live status from the business store by id; degrades to no chip.
    const dispatchOf = LIFE.dispatchStateByTask(s.dispatchEvents || []);
    const jobsById = LIFE.jobStates((ctx && ctx.q) || null, [...dispatchOf.values()].map((d) => d.jobId));
    // A project whose agent is stuck says so on the CARD — the owner should never have to
    // open a project to find out someone is waiting on him.
    const stuckIn = (projectId) => (s.taskProject || []).filter((t) => t.project_id === projectId)
      .map((t) => LIFE.agentNeedsYou(dispatchOf.get(t.id), jobsById.get((dispatchOf.get(t.id) || {}).jobId)))
      .filter(Boolean);
    const agentsOn = (projectId) => {
      const names = [];
      for (const t of s.taskProject || []) {
        if (t.project_id !== projectId) continue;
        const d = dispatchOf.get(t.id);
        if (!d) continue;
        const j = jobsById.get(d.jobId);
        if (j && LIFE.IN_FLIGHT_STATUSES.includes(String(j.status))) names.push(LIFE.AGENT_NAME[d.jobKind] || d.jobKind);
      }
      return names;
    };
    const progressBar = (p) => {
      const c = (s.counts || []).find((r) => r.project_id === p.id);
      const done = c ? Number(c.done) : 0;
      const total = done + (c ? Number(c.live) : 0);
      if (!total) return '';
      const pct = Math.round((done / total) * 100);
      const working = agentsOn(p.id);
      return `<div style="margin:8px 0 2px">
        <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--rmuted)"><span>${done} of ${total} tasks done</span><span>${pct}%</span></div>
        <div style="height:5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--rgood,#45c486)"></div></div>
        ${working.length ? `<div style="font-size:11.5px;color:var(--rmuted);margin-top:4px">🤖 working now: ${working.map((n) => LIFE.esc(n)).join(', ')}</div>` : ''}
      </div>`;
    };
    const card = (p) => {
      const next = s.nexts.find((n) => n.project_id === p.id);
      const stuck = stuckIn(p.id);
      const stuckLine = stuck.length
        ? `<div style="font-size:12px;color:var(--rbad,#ef6b68);font-weight:600;margin:6px 0 0">🗣 ${stuck.length} task${stuck.length === 1 ? '' : 's'} waiting on you to talk to the agent</div>`
        : '';
      return `<div class="r-card r-panel"${stuck.length ? ' style="border-color:rgba(239,107,104,.45)"' : ''}><div class="r-eyebrow">${LIFE.esc(p.stage.toLowerCase())}</div>
        <div style="font-size:16px;font-weight:650;line-height:1.3;margin-bottom:8px"><a href="/life/project?id=${encodeURIComponent(p.id)}" style="color:inherit">${LIFE.esc(p.title)}</a></div>
        <div>${S.rcc.tag(p.domain_key)} ${S.rcc.tag('risk ' + p.risk_state.toLowerCase(), riskTone[p.risk_state] || '')} ${p.due_date ? S.rcc.tag('due ' + String(p.due_date).slice(0, 10)) : ''}</div>
        ${stuckLine}
        ${progressBar(p)}
        <div class="r-defbox"><small>Definition of done</small><div style="font-size:13px;line-height:1.45">${LIFE.esc(p.definition_of_done)}</div></div>
        <div style="font-size:12.5px;color:var(--rmuted)">${next ? `Next: ${link(next.id, next.title)}` : '<span style="color:#f5c96b">No executable next action — a stalled project until one exists.</span>'}</div>
        <div class="lc-row" style="margin-top:10px">${ctl(p)}</div></div>`;
    };
    // Rename / cancel — on every LIVING project (finished work keeps its name and is
    // never erased; the writer refuses those by name, so terminal rows offer nothing).
    // Park / Activate (operator ask 2026-08-10): the four-slot cap is managed HERE — park
    // an active project, activate a parked one; the writer names the fifth-slot refusal.
    const swap = (p) => (p.status === 'ACTIVE' ? cmd('Park', 'park_project', { projectId: p.id }, 'small')
      : ['PARKED', 'WAITING'].includes(String(p.status)) ? cmd('Activate', 'activate_project', { projectId: p.id }, 'small') : '');
    const ctl = (p) => (['DONE', 'CANCELLED'].includes(String(p.status)) ? '' :
      `<button class="r-btn small" data-lc-rename="${LIFE.esc(JSON.stringify({ kind: 'project', id: p.id, title: p.title }))}">Rename…</button>`
      + swap(p)
      + `<button class="lc-cxl" data-lc-cancel-project="${LIFE.esc(p.id)}">✕ cancel</button>`);
    const openSlot = `<div class="r-card r-panel" style="border-style:dashed;display:flex;flex-direction:column;justify-content:center;text-align:center;color:var(--rmuted)"><div style="font-size:13.5px;line-height:1.6;padding:8px 4px">An open project slot.<br>Four at most, by design.</div></div>`;
    const slots = [...active.map(card)];
    while (slots.length < 4) slots.push(openSlot);
    // data-fab-target: on THIS page the floating + means "Add a project" (operator report
    // 2026-08-10 — it opened the task capture). The form is ALWAYS here (second report
    // same day: full slots left no way to add at all): at four active the new project
    // lands PARKED — named on the form, echoed by the writer — never a dead end.
    const atCap = active.length >= 4;
    const form = `<div class="r-card r-panel" data-fab-target="Add a project"><h3 class="r-panel-title" style="margin-bottom:8px">Add a project</h3>
      <form class="lc-create-form" data-kind="project" style="display:grid;gap:8px">
        ${atCap ? '<input type="hidden" name="parked" value="1">' : ''}
        <input class="lc-input" name="title" maxlength="200" placeholder="The project, plainly named">
        <input class="lc-input" name="dod" maxlength="500" placeholder="Definition of done — how will you know it is finished?">
        <div style="display:flex;gap:8px;align-items:center"><select class="lc-domain" name="domain"><option value="general">general</option><option value="business">business</option><option value="health">health</option><option value="family">family</option><option value="admin">admin</option><option value="venture">venture</option></select>
        <button type="submit" class="r-btn primary">${atCap ? 'Add project (parked)' : 'Add project'}</button></div>
        ${atCap ? '<div class="r-note">Four active is the cap, by design — this one lands parked below. Park or finish an active project, then Activate it into the freed slot.</div>' : ''}
      </form></div>`;
    const restRows = rest.length ? S.rcc.panel({ title: 'Waiting, parked and finished', body: rest.map((p) => `<div class="r-lrow"><div><div style="font-weight:600"><a href="/life/project?id=${encodeURIComponent(p.id)}" style="color:inherit">${LIFE.esc(p.title)}</a></div><div style="margin-top:3px">${S.rcc.tag(p.status.toLowerCase())} ${S.rcc.tag(p.domain_key)}</div></div><div style="display:flex;gap:8px;align-items:center;flex-shrink:0">${ctl(p)}</div></div>`).join('') }) : '';
    return { stamp: '', body: wrap(`<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-bottom:12px">${slots.join('')}</div>${form}${restRows}`) };
  },
};
