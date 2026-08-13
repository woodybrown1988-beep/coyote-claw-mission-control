'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-agents', route: '/life/agents', workspace: 'life', title: 'Agent activity',
  sub: 'What worked on your behalf, with what authority — when anything does',

  getSection(_db, ctx) {
    // LIVE, FINALLY (Wave 3, 2026-08-13 audit F3). This page said "No agents are connected
    // yet" while Today showed five agent deliverables awaiting an accept — the empty-state
    // predated the dispatch rung (2026-08-10) and was never re-gated. It now reads the same
    // life.db every other surface reads; the honest empty state remains for the day the
    // numbers really are all zero.
    const now = (ctx && ctx.now) || Date.now();
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true, now };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      const since14 = new Date(now - 14 * 86_400_000).toISOString();
      return {
        now,
        dispatched14: q(`SELECT COUNT(*) c FROM life_task_events WHERE event_type = 'AGENT_DISPATCHED' AND created_at >= ?`, [since14])[0]?.c ?? 0,
        refusedStanding: q(`SELECT COUNT(DISTINCT task_id) c FROM life_task_events WHERE event_type = 'DISPATCH_REFUSED'`)[0]?.c ?? 0,
        openRoutingRecs: q(`SELECT COUNT(*) c FROM life_update_proposals WHERE capability_key = 'agent_dispatch' AND state = 'PROPOSED'`)[0]?.c ?? 0,
        awaitingAccept: q(`SELECT p.id, p.task_id, t.title FROM life_update_proposals p LEFT JOIN life_tasks t ON t.id = p.task_id
                            WHERE p.capability_key = 'agent_delivery' AND p.state = 'PROPOSED' ORDER BY p.created_at`),
        doneViaAgent: q(`SELECT COUNT(*) c FROM life_tasks WHERE status = 'DONE' AND (closure_evidence_uri LIKE 'job:%' OR closure_evidence_uri LIKE 'report:artifact:%')`)[0]?.c ?? 0,
        evidenceLinks: q(`SELECT COUNT(*) c FROM life_source_links WHERE source_type = 'AGENT_RESULT'`)[0]?.c ?? 0,
        recent: q(`SELECT u.raw_text, u.actor_id, u.created_at, u.task_id, t.title FROM life_task_updates u LEFT JOIN life_tasks t ON t.id = u.task_id
                    WHERE u.actor_type = 'AGENT' ORDER BY u.created_at DESC LIMIT 8`),
        filing: {
          armed: q(`SELECT COUNT(*) c FROM life_mail_rules WHERE state = 'ARMED'`)[0]?.c ?? 0,
          applied: q(`SELECT COUNT(*) c FROM life_mail_moves WHERE state = 'APPLIED'`)[0]?.c ?? 0,
          undone: q(`SELECT COUNT(*) c FROM life_mail_moves WHERE state = 'UNDONE'`)[0]?.c ?? 0,
        },
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    // The handoff/authority map (placement ruling 2026-08-05) stays: how work is handed
    // off and where the gates sit — now above LIVE numbers instead of a false empty-state.
    const stage = (name, sub) => `<div style="flex:1;min-width:120px;background:rgba(255,255,255,.04);border:1px solid var(--rline);border-radius:10px;padding:12px"><div style="font-weight:600;font-size:13px">${LIFE.esc(name)}</div><div style="font-size:11.5px;color:var(--rmuted);margin-top:3px;line-height:1.4">${LIFE.esc(sub)}</div></div>`;
    const pipeline = `<div style="display:flex;gap:8px;align-items:stretch;flex-wrap:wrap">
      ${stage('You capture', 'a task, a note, a question')}
      <div style="align-self:center;color:var(--rmuted)">→</div>
      ${stage('The dispatcher classifies', 'twice a day, by shape — data, research, drafting; hands-work refuses')}
      <div style="align-self:center;color:var(--rmuted)">→</div>
      ${stage('A specialist works', 'a scoped job with a fenced brief — never the whole inbox')}
      <div style="align-self:center;color:var(--rmuted)">→</div>
      ${stage('The gate is you', 'the deliverable waits for your accept; send, spend, deploy stay yours forever')}
    </div>`;
    const authority = S.rcc.panel({
      title: 'How work is handed off', sub: 'The path a routed task takes, and where it always stops for you',
      body: pipeline + `<div class="r-note" style="margin-top:12px">The right edge is a permanent boundary: an external message, spend, a credential change, a people or legal action, or an outside-attendee event never passes it without you — no matter how confident the step before it was.</div>`,
    });
    if (s.absent) return { stamp: '', body: wrap(authority + LIFE.absentCard('Agent activity')) };
    const f = s.filing || {};
    const anyActivity = (s.dispatched14 || 0) + (s.awaitingAccept || []).length + (s.refusedStanding || 0)
      + (s.doneViaAgent || 0) + (f.applied || 0) + (s.recent || []).length > 0;
    if (!anyActivity) {
      return { stamp: '', body: wrap(authority + LIFE.emptyCard(
        'Nothing has worked on your behalf yet', 'The rails are live; the numbers are honestly zero',
        'Route a task to AI on its own page and the dispatcher picks it up on the next sweep. Suggestions still wait for your yes — nothing applies itself.',
        '<a class="r-btn" href="/life/trust">See Trust & automation</a>',
      )) };
    }
    const kpis = `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:12px">`
      + S.rcc.kpi({ label: 'Dispatched', value: String(s.dispatched14 || 0), sub: 'last 14 days' })
      + S.rcc.kpi({ label: 'Awaiting your accept', value: String((s.awaitingAccept || []).length), sub: 'deliverables on Today' })
      + S.rcc.kpi({ label: 'Completed via agents', value: String(s.doneViaAgent || 0), sub: 'your accept, their evidence' })
      + S.rcc.kpi({ label: 'Refused by shape', value: String(s.refusedStanding || 0), sub: 'hands-work stays yours' })
      + S.rcc.kpi({ label: 'Filed by armed rules', value: String(f.applied || 0), sub: `${f.undone || 0} put back` })
      + `</div>`;
    const awaitPanel = (s.awaitingAccept || []).length ? S.rcc.panel({
      title: 'Deliverables awaiting your accept', sub: 'The content is on the Today card — accept completes the task with it as evidence',
      headRight: `<span class="r-pill">${s.awaitingAccept.length}</span>`,
      body: s.awaitingAccept.map((r) => `<div class="r-lrow"><div style="font-weight:600">${r.task_id ? link(r.task_id, r.title || 'A task') : 'A task'}</div><a class="r-btn small" href="/life/today#lt-needs">Decide on Today</a></div>`).join(''),
    }) : '';
    const recPanel = (s.recent || []).length ? S.rcc.panel({
      title: 'Recent agent work', sub: 'Append-only — what came home, in the agent’s own words',
      body: s.recent.map((u) => `<div class="r-lrow"><div style="min-width:0"><div style="font-size:12.5px;line-height:1.5">${LIFE.esc(String(u.raw_text || '').length > 220 ? `${String(u.raw_text).slice(0, 219).trimEnd()}…` : String(u.raw_text || ''))}</div>`
        + `<div style="font-size:11.5px;color:var(--rmuted);margin-top:3px">${LIFE.esc(String(u.actor_id || 'agent'))} · ${LIFE.esc(String(u.created_at || '').slice(0, 16).replace('T', ' '))}${u.task_id ? ` · on ${link(u.task_id, u.title || 'a task')}` : ''}</div></div></div>`).join(''),
    }) : '';
    const recsNote = (s.openRoutingRecs || 0)
      ? `<div class="r-note" style="margin-bottom:12px">🧭 ${s.openRoutingRecs} routing suggestion${s.openRoutingRecs === 1 ? '' : 's'} from refused dispatches await you — accepting one re-routes the task in one tap. <a href="/life/today#lt-needs">Decide them in one sitting on Today</a>.</div>`
      : '';
    return { stamp: '', body: wrap(kpis + recsNote + authority + `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));margin-top:12px">${awaitPanel}${recPanel}</div>`) };
  },
};
