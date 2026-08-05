'use strict';
// LIFE OS — TODAY, built to the VISUAL GOLDEN MASTER (pack v1.1.0, png/desktop_full/01_today
// + mobile_key/01_today_mobile) on the shared RCC grammar (S.rcc + S.rcc.lifeCss — emitted
// only by life pages so Coyote byte-identity goldens never move).
//
// OPERATOR AMENDMENTS (2026-08-05) applied here:
//  A1 — fixtures live in the screenshot harness ONLY (scripts/life-visual-*.mjs); this page
//       renders real data or its designed empty state, nothing else.
//  A3 — RESTYLE ONLY: golden-master slots needing capability we don't have are EXCLUDED
//       pending ruling (Start focus / focus mode; capacity guardrails card; quiet-support
//       toggle; execution-route + confidence pills; "System support and current handoff").
//       Their data slots keep the golden's structure without inventing function.
// Backend wiring unchanged: same reads, same allowlisted commands.
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');

function londonDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}
function eyebrowDate(nowMs) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(nowMs)).replace(',', ' ·').toUpperCase();
}
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) =>
  `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

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
        inboxCount: q(`SELECT COUNT(*) c FROM life_tasks WHERE status = 'INBOX'`)[0]?.c ?? 0,
        waitingRows: q(`SELECT w.task_id, w.dependency_label, w.wake_type, w.fallback_at FROM life_waiting_conditions w WHERE w.state = 'ACTIVE' ORDER BY w.fallback_at IS NULL, w.fallback_at LIMIT 12`),
        decidedToday: q(`SELECT COUNT(*) c FROM life_update_proposals WHERE decided_at >= ?`, [`${today}T00:00:00.000Z`])[0]?.c ?? 0,
        doneToday: q(`SELECT COUNT(*) c FROM life_task_events WHERE event_type = 'STATUS_CHANGED' AND to_state = 'DONE' AND created_at >= ?`, [`${today}T00:00:00.000Z`])[0]?.c ?? 0,
        captured24h: q(`SELECT COUNT(*) c FROM life_task_events WHERE event_type = 'CREATED' AND created_at >= ?`, [new Date(now - 86_400_000).toISOString()])[0]?.c ?? 0,
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    const now = s.now || Date.now();
    const head = `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">`
      + `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:14px;flex-wrap:wrap">`
      + `<div><div class="r-eyebrow">${LIFE.esc(eyebrowDate(now))}</div>`
      + `<div class="r-capline" data-lc-fab role="button" tabindex="0" style="min-width:260px">Capture, ask or command…<kbd>⌘K</kbd></div></div>`
      + `<div style="display:flex;gap:8px">__HEADBTNS__</div></div>`;

    if (!s.engine || !s.engine.ok) {
      const body = head.replace('__HEADBTNS__', '')
        + S.rcc.panel({
          title: 'Your day, once it exists', sub: 'Nothing has been captured yet',
          body: `<div style="font-size:13.5px;line-height:1.6;padding:6px 0">Capture the first thing on your mind and Today takes shape from there — a must-win, two supports, and only the decisions that need you.`
            + `<div style="margin-top:12px"><button class="r-btn primary" data-lc-fab>Capture your first task</button></div></div>`,
        }) + `</div>`;
      return { stamp: '', body };
    }

    const t = (id) => (id && s.taskOf[id]) || null;
    const nowIso = new Date(now).toISOString();
    const overdue = (s.waitingRows || []).filter((w) => w.fallback_at && String(w.fallback_at) < nowIso);
    const plan = s.plan;
    const planIsDraft = plan && String(plan.status) === 'PROPOSED';
    const mw = plan ? t(plan.must_win_task_id) : null;
    const sup = plan ? [t(plan.support_task_1_id), t(plan.support_task_2_id)].filter(Boolean) : [];
    const ev = plan ? JSON.parse(String(plan.compilation_evidence_json || '{}')) : {};

    // ── decisions ("Needs you") ──
    const needs = [];
    for (const r of s.approvalRows) {
      needs.push({
        title: link(r.id, r.title),
        sub: 'Parked for your call — open it, then approve, park it waiting, or let it go.',
        actions: `<a class="r-btn small" href="/life/task?id=${encodeURIComponent(r.id)}">Inspect</a> ${cmd('Approve', 'transition', { taskId: r.id, to: 'READY' }, 'small primary')}`,
      });
    }
    for (const p of s.openProposals) {
      const task = t(p.task_id);
      needs.push({
        title: task ? link(task.id, task.title) : 'A task',
        sub: `${String(p.reason).slice(0, 110)} — it suggests ${p.command_type === 'set_waiting' ? 'parking this as waiting' : 'a next step'}.`,
        actions: `${task ? `<a class="r-btn small" href="/life/task?id=${encodeURIComponent(task.id)}">Inspect</a>` : ''} ${cmd('Approve', 'decide', { proposalId: p.id, decision: 'accept' }, 'small primary')} ${cmd('No', 'decide', { proposalId: p.id, decision: 'reject' }, 'small')}`,
      });
    }

    // ── header actions (restyle-only: Replan exists; focus mode awaits ruling) ──
    const headBtns = [
      plan ? cmd('Replan', 'plan_today', {}, '') : cmd('Plan my day', 'plan_today', {}, 'primary'),
      planIsDraft ? cmd('Approve plan', 'approve_plan', { planDate: s.today }, 'primary') : '',
    ].join(' ');

    // ── hero row: brief · must-win · my day ──
    const morning = `${s.captured24h ? `${s.captured24h} captured in the last day. ` : ''}`
      + `${needs.length ? `${needs.length} decision${needs.length === 1 ? '' : 's'} need${needs.length === 1 ? 's' : ''} you. ` : 'Nothing is waiting on a decision. '}`
      + `${overdue.length ? `${overdue.length} waiting item${overdue.length === 1 ? ' has' : 's have'} passed ${overdue.length === 1 ? 'its' : 'their'} follow-up date. ` : ''}`
      + `${s.inboxCount ? `${s.inboxCount} capture${s.inboxCount === 1 ? '' : 's'} to sort in All tasks.` : ''}`;
    const briefTone = (overdue.length || needs.length > 3)
      ? S.rcc.tag(`${needs.length + overdue.length} to clear`, 'warn')
      : S.rcc.tag('No critical risk', 'good');
    const rexCard = S.rcc.panel({
      title: 'Rex — 07:05 owner brief', sub: 'Read-only · the same numbers arrive by Telegram each morning',
      body: `<div class="r-quote">${LIFE.esc(morning.trim() || 'A quiet board. Capture something or enjoy the silence.')}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><a class="r-btn small" href="/life/waiting">View waiting</a><a class="r-btn small" href="/life/review">See weekly drift</a>${briefTone}</div>`,
    });

    let mustCard;
    if (!plan) {
      mustCard = `<div class="r-card r-panel" style="border-color:rgba(255,179,77,.4)"><div class="r-eyebrow hot">Today's must-win</div>
        <div style="font-size:15px;line-height:1.5;padding:4px 0 10px">No plan yet. It builds itself at 06:50 each morning — or build it now and adjust anything you disagree with.</div>
        ${cmd('Plan my day', 'plan_today', {}, 'primary')}</div>`;
    } else if (!mw) {
      mustCard = `<div class="r-card r-panel" style="border-color:rgba(255,179,77,.4)"><div class="r-eyebrow hot">Today's must-win</div>
        <div style="font-size:15px;line-height:1.5;padding:4px 0 10px">Nothing is available to win today — everything is waiting, parked or finished. If that's wrong, capture the thing on your mind.</div>
        <button class="r-btn primary" data-lc-fab>Capture it</button></div>`;
    } else {
      const dod = mw.definition_of_done && String(mw.definition_of_done).trim()
        ? LIFE.esc(mw.definition_of_done)
        : 'Not written yet — open the task and set what “won” looks like.';
      mustCard = `<div class="r-card r-panel" style="border-color:rgba(255,179,77,.4)"><div class="r-eyebrow hot">Today's must-win</div>
        <div style="font-size:19px;font-weight:650;line-height:1.3;margin-bottom:8px">${link(mw.id, mw.title)}</div>
        <div>${S.rcc.tag(mw.status === 'IN_PROGRESS' ? 'in progress' : 'ready', mw.status === 'IN_PROGRESS' ? 'good' : '')} ${S.rcc.tag(mw.domain_key)}</div>
        <div class="r-defbox"><small>Definition of done</small><div style="font-size:13px;line-height:1.45">${dod}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="r-btn primary" href="/life/task?id=${encodeURIComponent(mw.id)}">Open task</a>${planIsDraft ? cmd('Approve plan', 'approve_plan', { planDate: s.today }, '') : ''}</div></div>`;
    }

    const myDay = S.rcc.panel({
      title: 'My day', sub: 'Flexible blocks, not a brittle minute plan',
      body: `<div style="font-size:13.5px;line-height:1.6;padding:6px 0;color:var(--rmuted)">Outlook is not connected, so no fixed commitments show here — and no free time is invented. Today runs on the must-win and the two supports.`
        + `<div style="margin-top:10px"><button class="r-btn small" data-lc-fab>Capture a commitment</button></div></div>`,
    });

    // ── two supporting wins ──
    const supCard = (x) => `<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;background:rgba(255,255,255,.04);border:1px solid var(--rline);border-radius:10px;padding:12px 14px"><div style="display:flex;gap:12px;align-items:center;min-width:0"><div class="r-check"></div><div style="min-width:0"><div style="font-weight:600">${link(x.id, x.title)}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(x.domain_key)}</div></div></div><a class="r-btn small" href="/life/task?id=${encodeURIComponent(x.id)}">Open</a></div>`;
    const supBody = sup.length
      ? `<div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${sup.map(supCard).join('')}</div>`
      : `<div style="color:var(--rmuted);font-size:13px;padding:6px 0">No supporting wins today — the must-win stands alone, and on a thin day that is the right answer.</div>`;
    const supportsBand = S.rcc.panel({ title: 'Two supporting wins', sub: 'Useful, bounded and subordinate to the must-win', body: supBody });

    // ── needs you + waiting quietly ──
    const needsPanel = S.rcc.panel({
      title: `Needs you`, sub: 'Only irreversible calls and genuine owner judgement',
      headRight: needs.length ? `<span class="r-pill">${needs.length}</span>` : '',
      body: needs.length
        ? needs.map((n) => `<div class="r-lrow"><div style="min-width:0"><div style="font-weight:600">${n.title}</div><div style="font-size:12.5px;color:var(--rmuted);margin-top:3px;line-height:1.45">${LIFE.esc(n.sub)}</div></div><div style="display:flex;gap:6px;flex-shrink:0">${n.actions}</div></div>`).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing needs you. That is the design working.</div>`,
    });

    const quiet = (s.waitingRows || []).filter((w) => !overdue.includes(w));
    const wakeLine = (w) => `Waking: ${w.wake_type === 'DATE' ? 'on its follow-up date' : 'when you note an update'}${w.fallback_at ? ` · follow-up ${String(w.fallback_at).slice(0, 10)}` : ''}`;
    const waitingPanel = S.rcc.panel({
      title: 'Waiting quietly', sub: 'Tracked with a wake path — never occupying your attention',
      headRight: s.waitingRows.length ? `<span class="r-pill">${s.waitingRows.length}</span>` : '',
      body: [
        ...overdue.map((w) => { const task = t(w.task_id); return `<div class="r-lrow" style="color:${'#f5c96b'}"><div><div style="font-weight:600">${task ? link(task.id, task.title) : 'A task'}</div><div style="font-size:12px;margin-top:2px">On ${LIFE.esc(w.dependency_label)} — follow-up date passed (${LIFE.esc(String(w.fallback_at).slice(0, 10))}).</div></div>${cmd('Wake it', 'wake', { taskId: w.task_id }, 'small primary')}</div>`; }),
        ...quiet.slice(0, 6).map((w) => { const task = t(w.task_id); return `<div class="r-lrow"><div><div style="font-weight:600">${task ? link(task.id, task.title) : 'A task'}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">On ${LIFE.esc(w.dependency_label)} · ${LIFE.esc(wakeLine(w))}</div></div></div>`; }),
        s.waitingRows.length === 0 ? `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing is waiting on anyone. Park a task on a person or a date and it sits here without costing you attention.</div>` : '',
        s.waitingRows.length > 0 ? `<div class="r-note"><a href="/life/waiting">All waiting items</a></div>` : '',
      ].join(''),
    });

    // ── available now (+ the Inbox triage line — captures stay one click away) ──
    const planPicked = new Set([mw && mw.id, ...sup.map((x) => x.id)].filter(Boolean));
    const availRows = (s.available || []).filter((a) => !planPicked.has(a.id)).slice(0, 5);
    const availPanel = S.rcc.panel({
      title: 'Available now', sub: 'Only work that is executable now — waiting and approval items are excluded',
      headRight: availRows.length ? `<span class="r-pill">${availRows.length}</span>` : '',
      body: (availRows.length
        ? availRows.map((a) => `<div class="r-lrow"><div><div style="font-weight:600">${link(a.id, a.title)}</div><div style="margin-top:4px">${S.rcc.tag(a.domain_key)}</div></div>${cmd('Start', 'transition', { taskId: a.id, to: 'IN_PROGRESS' }, 'small')}</div>`).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing else is ready. Capture something, or wake a waiting item if it is genuinely unblocked.</div>`)
        + (s.inboxCount ? `<div class="r-note">${s.inboxCount} fresh capture${s.inboxCount === 1 ? '' : 's'} to sort — <a href="/life/tasks">triage in All tasks</a>.</div>` : ''),
    });

    const neglected = Array.isArray(ev.neglected_domains) ? ev.neglected_domains : [];
    const handled = S.rcc.panel({
      title: 'Handled quietly', sub: 'What moved without taking your time',
      body: `<div style="font-size:13px;line-height:1.7;padding:4px 0">Finished today: <b>${s.doneToday}</b> · suggestions you decided: <b>${s.decidedToday}</b> · applied without you: <b>0</b> — every suggestion waits for your yes.`
        + (neglected.length ? `<br><span style="color:#f5c96b">Quiet corner: nothing is moving on <b>${neglected.map(LIFE.esc).join(', ')}</b> despite it being a stated aim — worth one captured task?</span>` : '')
        + `</div>`,
    });

    // LAYOUT (operator feedback 2026-08-05: cover the page, kill the dead space): the golden's
    // grammar — hero gives the must-win the widest column; below, TWO wide columns whose card
    // stacks balance (Needs+Available | Waiting+Handled) instead of three narrow ones.
    const body = head.replace('__HEADBTNS__', headBtns)
      + `<div class="lt-hero">${rexCard}${mustCard}${myDay}</div>`
      + `<div style="margin-bottom:12px">${supportsBand}</div>`
      + `<div class="lt-main">`
      + `<div style="display:grid;gap:12px;align-content:start">${needsPanel}${availPanel}</div>`
      + `<div style="display:grid;gap:12px;align-content:start">${waitingPanel}${handled}</div>`
      + `</div>`
      + `<style>
        .lt-hero{display:grid;gap:12px;grid-template-columns:minmax(0,1.05fr) minmax(0,1.4fr) minmax(0,1fr);margin-bottom:12px}
        .lt-main{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
        @media(max-width:1100px){.lt-hero{grid-template-columns:1fr}}
        @media(max-width:900px){.lt-main{grid-template-columns:1fr}}
      </style></div>`;
    return { stamp: '', body };
  },
};
