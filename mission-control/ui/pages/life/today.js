'use strict';
// LIFE OS — TODAY (owner surface). Information architecture from the pack mock v1.3.0
// (must-win hero + supports + Needs you + Available now + quiet waiting); visual language
// from the live Revenue Command Centre component set (S.rcc — the operator extended the
// RCC canon to Life OS surfaces, ruling 2026-08-05). No separate design system, no
// engineering vocabulary: this page speaks owner, the audit trail speaks engineer.
// Backend wiring unchanged: same read-only life.db queries, same allowlisted commands.
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');

function londonDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}
function friendlyDate(nowMs) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(nowMs));
}
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}">${LIFE.esc(title)}</a>`;
const cmdBtn = (label, command, payload, primary) =>
  `<button class="lc-btn${primary ? '' : ' lc-ghost'}" style="min-width:0" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-today', route: '/life/today', workspace: 'life', title: 'Today',
  sub: 'One must-win, two supporting wins, and only the decisions that require you',

  getSection(_db, ctx) {
    const now = (ctx && ctx.now) || Date.now();
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason }, now };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      const today = londonDate(now);
      const plan = q('SELECT * FROM life_daily_plans WHERE plan_date = ?', [today])[0] || null;
      const taskOf = {};
      for (const r of q('SELECT id, title, status, domain_key, definition_of_done FROM life_tasks')) taskOf[r.id] = r;
      return {
        engine: { ok: true }, now, today, plan, taskOf,
        openProposals: q(`SELECT id, task_id, capability_key, command_type, reason FROM life_update_proposals WHERE state = 'PROPOSED' ORDER BY created_at ASC LIMIT 10`),
        approvalRows: q(`SELECT id, title FROM life_tasks WHERE status = 'AWAITING_APPROVAL' ORDER BY updated_at ASC LIMIT 10`),
        available: q(`SELECT id, title, domain_key FROM v_life_available_work ORDER BY calculated_priority DESC, created_at ASC LIMIT 8`),
        inboxRows: q(`SELECT id, title, domain_key, created_at FROM life_tasks WHERE status = 'INBOX' ORDER BY created_at DESC LIMIT 10`),
        waitingRows: q(`SELECT w.task_id, w.dependency_label, w.fallback_at FROM life_waiting_conditions w WHERE w.state = 'ACTIVE' ORDER BY w.fallback_at IS NULL, w.fallback_at LIMIT 20`),
        decidedToday: q(`SELECT COUNT(*) c FROM life_update_proposals WHERE decided_at >= ?`, [`${today}T00:00:00.000Z`])[0]?.c ?? 0,
        doneToday: q(`SELECT COUNT(*) c FROM life_task_events WHERE event_type = 'STATUS_CHANGED' AND to_state = 'DONE' AND created_at >= ?`, [`${today}T00:00:00.000Z`])[0]?.c ?? 0,
        captured24h: q(`SELECT COUNT(*) c FROM life_task_events WHERE event_type = 'CREATED' AND created_at >= ?`, [new Date(now - 86_400_000).toISOString()])[0]?.c ?? 0,
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    const stamp = friendlyDate(s.now || Date.now());
    if (!s.engine || !s.engine.ok) {
      const body = `<style>${S.rcc.css()}</style><div class="rcc">`
        + S.rcc.emptyState({
          title: 'Your day, once it exists',
          blocker: 'Nothing has been captured yet — there is no plan to build.',
          unlock: 'capture your first task with the ＋ button or Ctrl/Cmd+K; Today takes shape from there',
        }) + `</div>`;
      return { stamp, body };
    }
    const t = (id) => (id && s.taskOf[id]) || null;
    const nowIso = new Date(s.now || Date.now()).toISOString();
    const overdue = (s.waitingRows || []).filter((w) => w.fallback_at && String(w.fallback_at) < nowIso);
    const quiet = (s.waitingRows || []).length - overdue.length;

    // ── decisions: approval-parked tasks + open suggestions (capped view, mock "Needs you") ──
    const needs = [];
    for (const r of s.approvalRows) {
      needs.push(`<div class="r-alert"><div class="r-bar"></div><div><h4>${link(r.id, r.title)}</h4>`
        + `<p>Parked for your call — open it, then approve, park it waiting, or let it go.</p></div>`
        + `<div class="r-impact">${cmdBtn('To ready', 'transition', { taskId: r.id, to: 'READY' })}</div></div>`);
    }
    for (const p of s.openProposals) {
      const task = t(p.task_id);
      const what = p.command_type === 'set_waiting' ? 'park this waiting' : 'a suggestion';
      needs.push(`<div class="r-alert"><div class="r-bar"></div><div><h4>${task ? link(task.id, task.title) : 'a task'}</h4>`
        + `<p>${LIFE.esc(String(p.reason).slice(0, 110))} — it suggests ${LIFE.esc(what)}.</p></div>`
        + `<div class="r-impact">${cmdBtn('Accept', 'decide', { proposalId: p.id, decision: 'accept' }, true)} ${cmdBtn('No', 'decide', { proposalId: p.id, decision: 'reject' })}</div></div>`);
    }

    // ── the morning line (what Rex sends at 07:05, same numbers) ──
    const morning = `${s.captured24h} captured in the last day · `
      + `${s.inboxRows.length ? `${s.inboxRows.length} in your Inbox` : 'Inbox clear'} · `
      + `${needs.length ? `${needs.length} decision${needs.length === 1 ? '' : 's'} need you` : 'no decisions waiting'}`
      + `${overdue.length ? ` · ${overdue.length} waiting item${overdue.length === 1 ? ' is' : 's are'} past their follow-up date` : ''}.`;

    // ── hero: must-win + supports + my day ──
    const plan = s.plan;
    const planIsDraft = plan && String(plan.status) === 'PROPOSED';
    const mw = plan ? t(plan.must_win_task_id) : null;
    const sup = plan ? [t(plan.support_task_1_id), t(plan.support_task_2_id)].filter(Boolean) : [];
    const alts = plan ? JSON.parse(String(plan.alternative_task_ids_json || '[]')).map(t).filter(Boolean) : [];
    const ev = plan ? JSON.parse(String(plan.compilation_evidence_json || '{}')) : {};

    let mustWinBody;
    if (!plan) {
      mustWinBody = `<div class="r-empty"><b>No plan yet today.</b><br>It builds itself at 06:50 each morning — or build it now and adjust anything you disagree with.`
        + `<div class="r-unlock" style="margin-top:10px">${cmdBtn('Plan my day', 'plan_today', {}, true)}</div></div>`;
    } else if (!mw) {
      mustWinBody = `<div class="r-empty"><b>Nothing available to win today.</b><br>Everything is waiting, parked or done. If that's wrong, capture the thing on your mind.`
        + `<div class="r-unlock" style="margin-top:10px">${cmdBtn('Rebuild the plan', 'plan_today')}</div></div>`;
    } else {
      const dod = mw.definition_of_done && String(mw.definition_of_done).trim()
        ? LIFE.esc(mw.definition_of_done)
        : '<span style="opacity:.7">No definition of done yet — open the task and write what “won” looks like.</span>';
      mustWinBody = `
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;margin-bottom:6px">Today's must-win</div>
        <div style="font-size:20px;font-weight:600;line-height:1.3;margin-bottom:8px">${link(mw.id, mw.title)}</div>
        <div style="margin-bottom:10px">${S.rcc.tag(mw.domain_key)} ${S.rcc.tag(mw.status === 'IN_PROGRESS' ? 'in progress' : 'ready', mw.status === 'IN_PROGRESS' ? 'good' : '')}</div>
        <div style="font-size:12px;opacity:.85;margin-bottom:12px"><b>Done means:</b> ${dod}</div>
        <div class="lc-row"><a class="lc-btn" style="min-width:0;display:inline-flex;align-items:center;text-decoration:none" href="/life/task?id=${encodeURIComponent(mw.id)}">Open task</a>
        ${planIsDraft ? cmdBtn('Approve plan', 'approve_plan', { planDate: s.today }, true) : ''} ${cmdBtn('Replan', 'plan_today')}</div>`;
    }

    const supportsBody = sup.length
      ? sup.map((x) => `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)"><div style="font-weight:600">${link(x.id, x.title)}</div><div style="margin-top:5px">${S.rcc.tag(x.domain_key)}</div></div>`).join('')
      : `<div class="r-empty"><b>No supporting wins today.</b><br>The must-win stands alone — that can be the right answer on a thin day.</div>`;

    const myDay = `<div class="r-empty"><b>No calendar connected.</b><br>Fixed commitments will appear here when a calendar is linked. `
      + `Today runs on the must-win and the two supports${overdue.length ? ' — and the follow-ups below' : ''}.</div>`;

    const hero = `<div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));margin-bottom:14px">
      ${S.rcc.panel({ title: 'This morning', sub: 'The same line Rex sends at 07:05', body: `<div style="font-size:13px;line-height:1.5;padding:4px 0">${LIFE.esc(morning)}</div><div class="lc-row" style="margin-top:8px"><a class="lc-btn lc-ghost" style="min-width:0;text-decoration:none" href="/life/waiting">Waiting</a><a class="lc-btn lc-ghost" style="min-width:0;text-decoration:none" href="/life/review">Weekly review</a></div>` })}
      <div class="r-card r-panel" style="border-color:rgba(34,211,238,.35)">${mustWinBody}</div>
      ${S.rcc.panel({ title: 'My day', sub: 'Flexible blocks, not a brittle minute plan', body: myDay })}
    </div>`;

    const supports = S.rcc.panel({
      title: 'Two supporting wins', sub: 'Useful, bounded, and subordinate to the must-win',
      body: supportsBody,
    });

    const needsPanel = S.rcc.panel({
      title: `Needs you${needs.length ? ` (${needs.length})` : ''}`,
      sub: 'Only genuine owner judgement — everything else keeps moving without you',
      body: needs.length ? needs.join('')
        : `<div class="r-empty"><b>Nothing needs you.</b><br>That is the design working. Enjoy it.</div>`,
    });

    const planPicked = new Set([mw && mw.id, ...sup.map((x) => x.id)].filter(Boolean));
    const availRows = (s.available || []).filter((a) => !planPicked.has(a.id)).slice(0, 5);
    const availPanel = S.rcc.panel({
      title: 'Available now', sub: 'Executable this minute — waiting and parked work is excluded',
      body: availRows.length
        ? availRows.map((a) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)"><div>${link(a.id, a.title)} <span style="margin-left:6px">${S.rcc.tag(a.domain_key)}</span></div>${cmdBtn('Start', 'transition', { taskId: a.id, to: 'IN_PROGRESS' })}</div>`).join('')
        : `<div class="r-empty"><b>Nothing else is ready.</b><br>Capture something, or wake a waiting item if it's actually unblocked.</div>`,
    });

    const inboxPanel = S.rcc.panel({
      title: `Inbox${s.inboxRows.length ? ` (${s.inboxRows.length})` : ''}`,
      sub: 'Everything you capture lands here — decide what each one becomes',
      body: s.inboxRows.length
        ? s.inboxRows.map((r) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)"><div>${link(r.id, r.title)} <span style="margin-left:6px">${S.rcc.tag(r.domain_key)}</span></div><div class="lc-row" style="margin:0">${cmdBtn('Make ready', 'transition', { taskId: r.id, to: 'READY' })}<button class="lc-cxl" data-lc-cancel="${LIFE.esc(r.id)}">✕</button></div></div>`).join('')
        : `<div class="r-empty"><b>Inbox zero.</b><br>Capture is one keystroke away — Ctrl/Cmd+K anywhere, or the ＋ button.</div>`,
    });

    const waitingPanel = S.rcc.panel({
      title: 'Waiting, quietly', sub: overdue.length ? 'Some follow-up dates have passed — chase or re-park them' : 'Held with a wake path — none of it occupies your attention',
      body: [
        ...overdue.map((w) => {
          const task = t(w.task_id);
          return `<div class="r-alert bad"><div class="r-bar"></div><div><h4>${task ? link(task.id, task.title) : 'a task'}</h4><p>Waiting on ${LIFE.esc(w.dependency_label)} — the follow-up date (${LIFE.esc(String(w.fallback_at).slice(0, 10))}) has passed.</p></div><div class="r-impact">${cmdBtn('Wake it', 'wake', { taskId: w.task_id }, true)}</div></div>`;
        }),
        quiet > 0 ? `<div class="r-note">${quiet} more item${quiet === 1 ? '' : 's'} waiting with a follow-up date — <a href="/life/waiting">see them</a>.</div>` : '',
        (!overdue.length && quiet === 0) ? `<div class="r-empty"><b>Nothing is waiting on anyone.</b><br>When you park a task on a person or a date, it sits here without costing you attention.</div>` : '',
      ].join(''),
    });

    const neglected = Array.isArray(ev.neglected_domains) ? ev.neglected_domains : [];
    const handled = S.rcc.panel({
      title: 'Handled quietly', sub: 'What moved without taking your time',
      body: `<div style="font-size:13px;line-height:1.6;padding:4px 0">`
        + `Finished today: <b>${s.doneToday}</b> · suggestions you decided: <b>${s.decidedToday}</b> · applied without you: <b>0</b> — nothing acts on your behalf yet; every suggestion waits for your yes.`
        + (neglected.length ? `<br><span style="color:#f5c96b">Quiet corner: nothing is moving on <b>${neglected.map(LIFE.esc).join(', ')}</b> despite it being a stated aim — worth one captured task?</span>` : '')
        + `</div>`,
    });

    const body = `<style>${S.rcc.css()}</style><div class="rcc">
      ${hero}
      <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <div style="display:grid;gap:14px;align-content:start">${needsPanel}${supports}</div>
        <div style="display:grid;gap:14px;align-content:start">${availPanel}${inboxPanel}</div>
        <div style="display:grid;gap:14px;align-content:start">${waitingPanel}${handled}</div>
      </div>
    </div>`;
    return { stamp, body };
  },
};
