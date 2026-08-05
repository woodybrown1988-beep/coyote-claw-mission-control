'use strict';
// LIFE OS — TASK DRAWER (matrix A6/A8 surface). One task: header + legal actions, the
// add-update field (record-only honoured), and the evidence timeline — the human note, the
// extracted facts and the AI proposals rendered SEPARATELY (pack ADR-005: provenance is the
// product). Every button posts an allowlisted command; the writer re-validates; refusals
// alert by name. Reached by links (no sidebar slot — workspaceOf prefix fallback).
const LIFE = require('./life-lib.js');

// The buttons each status legitimately offers (mirrors the engine's transition table — the
// writer re-validates, so a stale page can refuse loudly but never corrupt).
const ACTIONS = {
  INBOX: [['Ready', 'transition', 'READY'], ['Batch', 'transition', 'BATCH']],
  READY: [['Start', 'transition', 'IN_PROGRESS'], ['Needs my decision', 'transition', 'AWAITING_APPROVAL'], ['Block', 'transition', 'BLOCKED'], ['Batch', 'transition', 'BATCH']],
  SCHEDULED: [['Start', 'transition', 'IN_PROGRESS'], ['Back to ready', 'transition', 'READY']],
  IN_PROGRESS: [['Pause', 'transition', 'READY'], ['Block', 'transition', 'BLOCKED']],
  WAITING: [],
  BLOCKED: [['Unblock', 'transition', 'READY']],
  AWAITING_APPROVAL: [['Approve → ready', 'transition', 'READY'], ['Start now', 'transition', 'IN_PROGRESS']],
  BATCH: [['Ready', 'transition', 'READY'], ['Start', 'transition', 'IN_PROGRESS']],
  DONE: [], CANCELLED: [],
};

function btnCmd(label, command, payload) {
  const cmd = LIFE.esc(JSON.stringify({ command, payload }));
  return `<button class="lc-btn" style="min-width:0" data-lc-cmd="${cmd}">${LIFE.esc(label)}</button>`;
}

module.exports = {
  key: 'life-task', route: '/life/task', workspace: 'life', title: 'Task',
  sub: 'One task — actions, evidence timeline, proposals · every change audited via the sole writer',

  getSection(_db, ctx) {
    const id = ctx && ctx.query && typeof ctx.query.id === 'string' ? ctx.query.id : '';
    if (!id) return { err: 'no task id — open a task from Today, Tasks or Waiting' };
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const task = LIFE.lifeSelect(o.db, 'SELECT * FROM life_tasks WHERE id = ?', [id]);
      if (!task.ok || !task.rows.length) return { err: `no such task ${id}` };
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        engine: { ok: true },
        task: task.rows[0],
        events: q('SELECT event_type, actor_type, actor_id, from_state, to_state, payload_json, created_at FROM life_task_events WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50', [id]),
        updates: q('SELECT id, raw_text, record_only, actor_type, created_at FROM life_task_updates WHERE task_id = ? ORDER BY created_at DESC LIMIT 20', [id]),
        facts: q('SELECT fact_type, value_json, unit, confidence, created_at FROM life_update_facts WHERE task_id = ? ORDER BY created_at DESC LIMIT 30', [id]),
        proposals: q('SELECT id, capability_key, command_type, command_json, reason, confidence, state, decided_by, decision_note FROM life_update_proposals WHERE task_id = ? ORDER BY created_at DESC LIMIT 20', [id]),
        waiting: q("SELECT dependency_label, wake_type, fallback_at, state FROM life_waiting_conditions WHERE task_id = ? ORDER BY created_at DESC LIMIT 5", [id]),
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.err) return { stamp: 'life-task', body: `<div class="panel"><h3>Task</h3><div style="padding:14px 4px;color:var(--muted,#8aa)">${LIFE.esc(s.err)}</div></div>` };
    if (!s.engine || !s.engine.ok) return { stamp: 'life-task · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    const t = s.task;
    const id = String(t.id);

    // header + actions
    const acts = (ACTIONS[t.status] || []).map(([label, cmd, to]) => btnCmd(label, cmd, { taskId: id, to })).join(' ');
    const specials = [
      ['INBOX', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL', 'BATCH'].includes(String(t.status))
        ? `<button class="lc-btn" style="min-width:0" data-lc-complete="${LIFE.esc(id)}">Mark done…</button>`
          + `<button class="lc-btn" style="min-width:0" data-lc-wait="${LIFE.esc(id)}">Park waiting…</button>`
          + `<button class="lc-cxl" data-lc-cancel="${LIFE.esc(id)}">✕ cancel</button>`
        : '',
      String(t.status) === 'WAITING' ? btnCmd('Wake now', 'wake', { taskId: id }) : '',
      ['DONE', 'CANCELLED'].includes(String(t.status)) ? btnCmd('Reopen', 'reopen', { taskId: id }) : '',
      btnCmd('Undo last move', 'undo', { taskId: id }),
    ].join(' ');
    const wait = s.waiting.find((w) => w.state === 'ACTIVE');
    const head = `<div class="panel"><h3>${LIFE.esc(t.title)}</h3>
      <div style="font-size:13px;color:var(--muted,#8aa);margin:4px 0 10px">
        ${LIFE.esc(t.status)} · ${LIFE.esc(t.domain_key)} · ${LIFE.esc(t.visibility)} · risk ${LIFE.esc(t.risk_level)}
        ${t.due_at ? ` · due ${LIFE.esc(String(t.due_at))} (${LIFE.esc(String(t.due_kind))})` : ''}
        ${wait ? ` · waiting on <b>${LIFE.esc(wait.dependency_label)}</b> (fallback ${LIFE.esc(wait.fallback_at || 'none')})` : ''}
      </div>
      ${t.description ? `<div style="font-size:13px;margin-bottom:10px">${LIFE.esc(t.description)}</div>` : ''}
      <div class="lc-row">${acts} ${specials}</div></div>`;

    // add update (A6): record-only honoured — context the AI must never act on
    const noteForm = `<div class="panel"><h3>Add update</h3>
      <form class="lc-note-form" data-task="${LIFE.esc(id)}">
        <textarea name="text" maxlength="4000" rows="3" class="lc-input" style="resize:vertical" placeholder="What happened? Plain words — facts and proposals extract deterministically; you decide each one."></textarea>
        <div class="lc-row" style="align-items:center">
          <label style="font-size:12px;color:var(--muted,#8aa)"><input type="checkbox" name="record_only"> record only — do not act</label>
          <button type="submit" class="lc-btn">Save update</button>
        </div>
      </form></div>`;

    // proposals — the owner's decisions (A6)
    const open = s.proposals.filter((p) => p.state === 'PROPOSED');
    const decided = s.proposals.filter((p) => p.state !== 'PROPOSED');
    const propCard = (p) => {
      const cmd = JSON.parse(String(p.command_json || '{}'));
      const editable = p.command_type === 'set_waiting'
        ? `<button class="lc-btn lc-ghost" style="min-width:0" data-lc-edit="${LIFE.esc(JSON.stringify({ proposalId: p.id, dependencyLabel: cmd.dependencyLabel, wakeType: cmd.wakeType, fallbackAt: cmd.fallbackAt }))}">Edit…</button>` : '';
      return `<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:10px;margin:8px 0">
        <div style="font-size:13px"><b>${LIFE.esc(p.capability_key)}</b> proposes <b>${LIFE.esc(p.command_type)}</b> · confidence ${Number(p.confidence).toFixed(2)}</div>
        <div style="font-size:12px;color:var(--muted,#8aa);margin:4px 0">${LIFE.esc(p.reason)}</div>
        <div style="font-size:12px;font-family:monospace;margin:4px 0">${LIFE.esc(JSON.stringify(cmd))}</div>
        <div class="lc-row">
          ${btnCmd('Accept', 'decide', { proposalId: p.id, decision: 'accept' })}
          ${editable}
          ${btnCmd('Reject', 'decide', { proposalId: p.id, decision: 'reject' })}
        </div></div>`;
    };
    const decidedRow = (p) => `<tr><td>${LIFE.esc(p.capability_key)}</td><td>${LIFE.esc(p.command_type)}</td><td>${LIFE.esc(p.state)}</td><td>${LIFE.esc(p.decided_by || '')}${p.decision_note ? ` — ${LIFE.esc(p.decision_note)}` : ''}</td></tr>`;
    const proposals = `<div class="panel"><h3>Proposals${open.length ? ` — ${open.length} need you` : ''}</h3>
      ${open.length ? open.map(propCard).join('') : '<div style="font-size:13px;color:var(--muted,#8aa);padding:6px 0">Nothing proposed and undecided.</div>'}
      ${decided.length ? `<table class="data"><thead><tr><th>Capability</th><th>Proposed</th><th>Decision</th><th>By</th></tr></thead><tbody>${decided.map(decidedRow).join('')}</tbody></table>` : ''}
    </div>`;

    // facts + timeline: human statements and machine interpretation SEPARATE, always
    const factRows = s.facts.map((f) => `<tr><td>${LIFE.esc(f.fact_type)}</td><td>${LIFE.esc(String(f.value_json))}${f.unit ? ` ${LIFE.esc(f.unit)}` : ''}</td><td>${Number(f.confidence).toFixed(2)}</td></tr>`).join('');
    const facts = s.facts.length ? `<div class="panel"><h3>Extracted facts (machine interpretation — the note below stays authoritative)</h3><table class="data"><thead><tr><th>Fact</th><th>Value</th><th>Confidence</th></tr></thead><tbody>${factRows}</tbody></table></div>` : '';
    const updates = s.updates.map((u) => {
      const ms = Date.parse(String(u.created_at));
      return `<div style="border-left:3px solid rgba(34,211,238,.4);padding:6px 10px;margin:8px 0">
        <div style="font-size:11px;color:var(--muted,#8aa)"><time data-ms="${Number.isFinite(ms) ? ms : 0}">${LIFE.esc(String(u.created_at))}</time>${Number(u.record_only) ? ' · record-only (never acted on)' : ''}</div>
        <div style="font-size:13px;white-space:pre-wrap">${LIFE.esc(String(u.raw_text))}</div></div>`;
    }).join('');
    const evRows = s.events.map((ev) => {
      const ms = Date.parse(String(ev.created_at));
      return `<tr><td><time data-ms="${Number.isFinite(ms) ? ms : 0}">${LIFE.esc(String(ev.created_at))}</time></td><td>${LIFE.esc(ev.event_type)}</td><td>${LIFE.esc(ev.from_state || '')}${ev.to_state ? ` → ${LIFE.esc(ev.to_state)}` : ''}</td><td>${LIFE.esc(ev.actor_type)}:${LIFE.esc(ev.actor_id)}</td></tr>`;
    }).join('');
    const timeline = `<div class="panel"><h3>Updates (your words, byte-preserved)</h3>${updates || '<div style="font-size:13px;color:var(--muted,#8aa)">No updates yet.</div>'}</div>
      <div class="panel"><h3>Audit trail</h3><table class="data"><thead><tr><th>When</th><th>Event</th><th>Change</th><th>Actor</th></tr></thead><tbody>${evRows}</tbody></table></div>`;

    return { stamp: `life-task · ${t.status}`, body: head + noteForm + proposals + facts + timeline };
  },
};
