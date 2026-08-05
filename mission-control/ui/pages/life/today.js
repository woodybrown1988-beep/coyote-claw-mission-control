'use strict';
// LIFE OS — TODAY. The attention surface (pack ADR-009), now LIVE end-to-end: the compiled
// plan (one must-win, two supports, three alternatives), the CAPPED owner decision queue,
// the Inbox landing zone, overdue waiting, and the automation disclosure. Real reads only;
// every action posts an allowlisted command to the sole writer. The librarian handle the
// server passes stays deliberately unused (life.db is the separate personal store).
const LIFE = require('./life-lib.js');

function count(db, sql) {
  const r = LIFE.lifeSelect(db, sql);
  return r.ok && r.rows[0] ? Number(Object.values(r.rows[0])[0]) : null;
}
function londonDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}">${LIFE.esc(title)}</a>`;
const cmdBtn = (label, command, payload) =>
  `<button class="lc-btn" style="min-width:0" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-today', route: '/life/today', workspace: 'life', title: 'Today',
  sub: 'One must-win, two supports, decisions capped — compiled 06:50 London, you approve or adjust',

  getSection(_db, ctx) {
    const now = (ctx && ctx.now) || 0;
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      const today = londonDate(now || Date.now());
      const plan = q('SELECT * FROM life_daily_plans WHERE plan_date = ?', [today])[0] || null;
      const titleOf = {};
      for (const r of q('SELECT id, title, status FROM life_tasks')) titleOf[r.id] = { title: r.title, status: r.status };
      const openProposals = q(`SELECT p.id, p.task_id, p.capability_key, p.command_type, p.reason FROM life_update_proposals p WHERE p.state = 'PROPOSED' ORDER BY p.created_at ASC LIMIT 10`);
      return {
        engine: { ok: true }, today, plan, titleOf, openProposals,
        counts: {
          activeOutcomes: count(o.db, `SELECT COUNT(*) FROM life_outcomes WHERE status = 'ACTIVE'`),
          activeProjects: count(o.db, `SELECT COUNT(*) FROM life_projects WHERE status = 'ACTIVE'`),
          availableNow: count(o.db, `SELECT COUNT(*) FROM v_life_available_work`),
          waiting: count(o.db, `SELECT COUNT(*) FROM life_tasks WHERE status = 'WAITING'`),
          inbox: count(o.db, `SELECT COUNT(*) FROM life_tasks WHERE status = 'INBOX'`),
        },
        inboxRows: q(`SELECT id, title, domain_key, created_at FROM life_tasks WHERE status = 'INBOX' ORDER BY created_at DESC LIMIT 10`),
        approvalRows: q(`SELECT id, title FROM life_tasks WHERE status = 'AWAITING_APPROVAL' ORDER BY updated_at ASC LIMIT 10`),
        overdue: q(`SELECT w.task_id, w.dependency_label, w.fallback_at FROM life_waiting_conditions w WHERE w.state = 'ACTIVE' AND w.fallback_at IS NOT NULL AND w.fallback_at < ? LIMIT 10`, [new Date(now || Date.now()).toISOString()]),
        decidedToday: q(`SELECT COUNT(*) c FROM life_update_proposals WHERE decided_at >= ?`, [`${today}T00:00:00.000Z`])[0]?.c ?? 0,
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-today · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    const c = s.counts || {};
    const name = (id) => (id && s.titleOf[id] ? link(id, s.titleOf[id].title) : '<span style="color:var(--muted,#8aa)">—</span>');

    const tile = (label, v, hint) =>
      `<div class="tile"><div class="tile-label">${LIFE.esc(label)}</div><div class="tile-value">${v == null ? '—' : Number(v)}</div><div class="tile-sub">${LIFE.esc(hint)}</div></div>`;
    const hero = `<div class="tiles" style="grid-template-columns:repeat(5,minmax(120px,1fr))">`
      + tile('Active outcomes', c.activeOutcomes, 'cap 3 — DB-enforced')
      + tile('Active projects', c.activeProjects, 'cap 4 — DB-enforced')
      + tile('Available now', c.availableNow, 'executable, never waiting')
      + tile('Waiting', c.waiting, 'held quietly, wake-gated')
      + tile('Inbox', c.inbox, 'capture landing zone') + `</div>`;

    // THE PLAN — live (A13)
    let planPanel;
    if (s.plan) {
      const p = s.plan;
      const alts = JSON.parse(String(p.alternative_task_ids_json || '[]'));
      const ev = JSON.parse(String(p.compilation_evidence_json || '{}'));
      planPanel = `<div class="panel"><h3>Today's plan — ${LIFE.esc(String(p.status))}</h3>
        <div style="font-size:14px;margin:6px 0"><b>Must-win:</b> ${name(p.must_win_task_id)}</div>
        <div style="font-size:13px;margin:4px 0"><b>Supports:</b> ${name(p.support_task_1_id)} · ${name(p.support_task_2_id)}</div>
        <div style="font-size:13px;margin:4px 0"><b>Alternatives:</b> ${alts.length ? alts.map((id) => name(id)).join(' · ') : '<span style="color:var(--muted,#8aa)">none</span>'}</div>
        ${Array.isArray(ev.neglected_domains) && ev.neglected_domains.length ? `<div style="font-size:12px;color:#f5c96b;margin:6px 0">Neglected active-outcome domain${ev.neglected_domains.length === 1 ? '' : 's'}: ${ev.neglected_domains.map(LIFE.esc).join(', ')} — no available work there today.</div>` : ''}
        <div class="lc-row">${p.status === 'PROPOSED' ? cmdBtn('Approve plan', 'approve_plan', { planDate: s.today }) : ''} ${cmdBtn('Recompile', 'plan_today')}</div>
      </div>`;
    } else {
      planPanel = `<div class="panel"><h3>Today's plan</h3>
        <div style="padding:10px 4px;color:var(--muted,#8aa);font-size:13px">Not compiled yet — the writer compiles at 06:50 London, or now:</div>
        <div class="lc-row">${cmdBtn('Compile now', 'plan_today')}</div></div>`;
    }

    // DECISION QUEUE — live (A7): approval-parked tasks + undecided proposals
    const decisions = [];
    for (const r of s.approvalRows) decisions.push(`<tr><td>task</td><td>${link(r.id, r.title)}</td><td>parked for your call — open it to decide</td></tr>`);
    for (const p of s.openProposals) {
      const t = s.titleOf[p.task_id];
      decisions.push(`<tr><td>proposal</td><td>${t ? link(p.task_id, t.title) : LIFE.esc(p.task_id)}</td><td>${LIFE.esc(p.capability_key)} → ${LIFE.esc(p.command_type)}: ${LIFE.esc(String(p.reason).slice(0, 90))}</td></tr>`);
    }
    const decisionPanel = decisions.length
      ? `<div class="panel"><h3>Needs your decision (${decisions.length})</h3><table class="data"><thead><tr><th></th><th>Item</th><th>What</th></tr></thead><tbody>${decisions.join('')}</tbody></table></div>`
      : `<div class="panel"><h3>Needs your decision</h3><div style="padding:10px 4px;color:var(--muted,#8aa);font-size:13px">Nothing waiting on you. That is the design working, not a gap.</div></div>`;

    // INBOX (A5 landing) — titles link to the drawer
    let inboxPanel;
    const rows = s.inboxRows || [];
    if (rows.length) {
      const tr = rows.map((r) => {
        const ms = Date.parse(r.created_at);
        return `<tr><td>${link(r.id, r.title)}</td><td>${LIFE.esc(r.domain_key)}</td><td><time data-ms="${Number.isFinite(ms) ? ms : 0}">${LIFE.esc(r.created_at)}</time></td>`
          + `<td><button class="lc-cxl" data-lc-cancel="${LIFE.esc(r.id)}" title="Cancel (audited)">✕ cancel</button></td></tr>`;
      }).join('');
      inboxPanel = `<div class="panel"><h3>Inbox (${rows.length}${rows.length === 10 ? '+' : ''})</h3><table class="data"><thead><tr><th>Captured</th><th>Domain</th><th>When</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>`;
    } else {
      inboxPanel = `<div class="panel"><h3>Inbox</h3><div style="padding:10px 4px;color:var(--muted,#8aa);font-size:13px">Empty — capture with ＋ or Ctrl/Cmd+K from any workspace; it lands here immediately.</div></div>`;
    }

    // Overdue waiting — quiet unless real (pack: waiting surfaces only when material)
    const overduePanel = (s.overdue && s.overdue.length)
      ? `<div class="panel"><h3 style="color:#f5c96b">Waiting past fallback (${s.overdue.length})</h3><table class="data"><tbody>${s.overdue.map((w) => {
          const t = s.titleOf[w.task_id];
          return `<tr><td>${t ? link(w.task_id, t.title) : LIFE.esc(w.task_id)}</td><td>on ${LIFE.esc(w.dependency_label)}</td><td>fallback ${LIFE.esc(String(w.fallback_at).slice(0, 10))}</td></tr>`;
        }).join('')}</tbody></table></div>` : '';

    // Disclosure: what the system handled (v1 truth: nothing auto-applies; decisions counted)
    const disclosure = `<div class="panel"><h3>What the system handled</h3><div style="padding:10px 4px;color:var(--muted,#8aa);font-size:13px">`
      + `Auto-applied: 0 (every capability is at RECOMMEND — nothing acts without you). Proposals decided today: ${s.decidedToday ?? 0}. Full ledger on Trust & Automation.</div></div>`;

    return {
      stamp: `life-today · plan=${s.plan ? s.plan.status : 'none'} decisions=${decisions.length}`,
      body: hero + planPanel + decisionPanel + inboxPanel + overduePanel + disclosure,
    };
  },
};
