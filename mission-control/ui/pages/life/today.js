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
/** A mail proposal about work that does not exist yet has no task to name it, so the row
 *  takes its heading from what the proposal would create. */
function mailTitle(p) {
  let c = {}; try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { /* fall through */ }
  return LIFE.esc(String(c.title || 'From your inbox'));
}

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
      const setting = (k, dflt) => { const r = q('SELECT value FROM life_settings WHERE key = ?', [k]); return r.length ? String(r[0].value) : dflt; };
      return {
        engine: { ok: true }, now, today, plan, taskOf,
        // quiet-support DEFAULT-ON (operator ruling 2026-08-05): absent row = on.
        quiet: setting('quiet_support', 'on') === 'on',
        // SILENT TRUNCATION, found on the first live mail pass (2026-08-11). This was
        // `LIMIT 10` ordered oldest-first. Thirteen agent-dispatch recommendations landed in
        // one second yesterday, took the whole limit, and everything newer simply vanished
        // from the board — four agent deliverables awaiting an accept, two calendar blocks,
        // and every mail proposal. The owner had no way to know: the page rendered a
        // confident, complete-looking queue.
        //
        // A cap the reader cannot see is the defect. The limit is now well above any real
        // queue, and anything beyond it is COUNTED and said out loud.
        openProposals: q(`SELECT id, task_id, capability_key, command_type, command_json, reason, confidence, risk_level FROM life_update_proposals WHERE state = 'PROPOSED' ORDER BY created_at ASC LIMIT 60`),
        openProposalCount: q(`SELECT COUNT(*) c FROM life_update_proposals WHERE state = 'PROPOSED'`)[0]?.c ?? 0,
        // MAIL (Graph Stage C 2026-08-11) — deliberately SEPARATE queries, not extra columns
        // on the one above. MC and the engine deploy on independent taps, so this page can
        // meet a life.db that predates the mail migration; folding source_mail_id into the
        // proposals SELECT would make one missing column blank the ENTIRE decision queue.
        // Split, the worst case is that the mail rail is simply absent for a few minutes.
        mailOf: Object.fromEntries(q(
          `SELECT id, source_mail_id FROM life_update_proposals WHERE state = 'PROPOSED' AND source_mail_id IS NOT NULL`,
        ).map((r) => [r.id, r.source_mail_id])),
        mailById: Object.fromEntries(q(
          `SELECT m.id, m.from_name, m.from_address, m.subject, m.received_at, m.web_link
             FROM life_mail_messages m
            WHERE m.id IN (SELECT source_mail_id FROM life_update_proposals WHERE state = 'PROPOSED' AND source_mail_id IS NOT NULL)`,
        ).map((r) => [r.id, r])),
        mailSync: q('SELECT last_sync_at, last_error, last_triage_at FROM life_mail_sync WHERE id = 1')[0] || null,
        mailBacklog: q('SELECT COUNT(*) c FROM life_mail_messages WHERE classified_at IS NULL')[0]?.c ?? 0,
        approvalRows: q(`SELECT id, title FROM life_tasks WHERE status = 'AWAITING_APPROVAL' ORDER BY updated_at ASC LIMIT 10`),
        available: q(`SELECT id, title, domain_key, execution_mode FROM v_life_available_work ORDER BY calculated_priority DESC, created_at ASC LIMIT 8`),
        // DUE-SOON SAFETY NET (audit 2026-08 G-05): any live task with a deadline inside 72h (or already
        // overdue) surfaces on Today REGARDLESS of what the plan compiled — statutory dues were TARGET
        // (not HARD), so the priority view never lifted them and they were invisible two days out.
        dueSoon: q(`SELECT id, title, due_at, due_kind, execution_mode, status, domain_key FROM life_tasks
                     WHERE status NOT IN ('DONE','CANCELLED') AND due_at IS NOT NULL AND due_at <= ?
                     ORDER BY due_at ASC LIMIT 12`, [new Date(now + 72 * 3_600_000).toISOString()]),
        inboxCount: q(`SELECT COUNT(*) c FROM life_tasks WHERE status = 'INBOX'`)[0]?.c ?? 0,
        waitingRows: q(`SELECT w.task_id, w.dependency_label, w.wake_type, w.fallback_at FROM life_waiting_conditions w WHERE w.state = 'ACTIVE' ORDER BY w.fallback_at IS NULL, w.fallback_at LIMIT 12`),
        activeOutcomes: q(`SELECT DISTINCT domain_key FROM life_outcomes WHERE status = 'ACTIVE'`).map((r) => r.domain_key),
        neglectedFromWork: q(`SELECT DISTINCT domain_key FROM v_life_available_work`).map((r) => r.domain_key),
        decidedToday: q(`SELECT COUNT(*) c FROM life_update_proposals WHERE decided_at >= ?`, [`${today}T00:00:00.000Z`])[0]?.c ?? 0,
        doneToday: q(`SELECT COUNT(*) c FROM life_task_events WHERE event_type = 'STATUS_CHANGED' AND to_state = 'DONE' AND created_at >= ?`, [`${today}T00:00:00.000Z`])[0]?.c ?? 0,
        captured24h: q(`SELECT COUNT(*) c FROM life_task_events WHERE event_type = 'CREATED' AND created_at >= ?`, [new Date(now - 86_400_000).toISOString()])[0]?.c ?? 0,
        // CALENDAR (Graph go 2026-08-10): the engine mirrors Outlook into life-side tables;
        // My Day reads TODAY's mirror rows. Missing table (engine not deployed) → q() gives
        // [] and calSync null → the honest not-connected rail, exactly as before the go.
        calSync: q('SELECT last_sync_at, last_error FROM life_calendar_sync WHERE id = 1')[0] || null,
        calEvents: q('SELECT id, subject, start_at, end_at, is_all_day, show_as, is_protected FROM life_calendar_events WHERE start_at LIKE ? ORDER BY start_at', [`${today}%`]),
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

    // ── decisions ("Needs you"). MATERIAL = owner-authority items that always interrupt
    // (approvals). Suggestions carry their REAL confidence chip; under quiet-support (A3,
    // default-on) low-risk suggestions fold into a quiet line — only material items interrupt. ──
    const material = [];
    const suggestions = [];
    for (const r of s.approvalRows) {
      material.push({
        title: link(r.id, r.title),
        sub: 'Parked for your call — open it, then approve, park it waiting, or let it go.',
        actions: `<a class="r-btn small" href="/life/task?id=${encodeURIComponent(r.id)}">Inspect</a> ${cmd('Approve', 'transition', { taskId: r.id, to: 'READY' }, 'small primary')}`,
      });
    }
    for (const p of s.openProposals) {
      const task = t(p.task_id);
      const conf = S.rcc.conf(p.confidence);
      const highStakes = p.risk_level === 'HIGH' || p.risk_level === 'CRITICAL';
      // Agent deliverables (dispatch rung 2026-08-10) are ALWAYS material — an agent worked
      // and the outcome is yours to tap: Accept completes the task with the deliverable
      // attached as evidence; No keeps it open with the attempt on the record.
      const isAgentDelivery = p.capability_key === 'agent_delivery';
      // Calendar blocks (Graph Stage W 2026-08-10) are ALWAYS material — accepting writes
      // to YOUR Outlook (the dedicated Life OS calendar only), so it interrupts by class.
      // Accept rides the block's OWN verb (the writer places/removes the real event);
      // No is a plain reject and touches nothing in Outlook.
      const isCalendarBlock = p.capability_key === 'calendar_block';
      // MAIL proposals (Graph Stage C 2026-08-11) are SUGGESTIONS by class — they fold under
      // quiet support, because an email is not an interruption. Each one shows WHO it came
      // from and the machine-derived evidence for the match, so the call takes one glance.
      const mailId = (s.mailOf || {})[p.id] || null;
      const isMail = !!mailId;
      let sub, acceptBtn, extraActions = '';
      if (isMail) {
        let c = {}; try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { /* renders generic */ }
        const m = (s.mailById || {})[mailId] || null;
        const who = m ? (m.from_name || m.from_address || 'an email') : 'an email';
        const verb = p.command_type === 'wake' ? 'Wake it'
          : p.command_type === 'add_update' ? 'Add to the task'
            : p.command_type === 'create_project' ? 'Create project' : 'Create task';
        const what = p.command_type === 'wake' ? 'This looks like the reply this task was waiting for. Accept wakes it; No leaves it waiting.'
          : p.command_type === 'add_update' ? 'Accept files this email on the task as evidence. Nothing else moves.'
            : p.command_type === 'create_project' ? `Accept creates the project with this definition of done: “${String(c.definitionOfDone || '').slice(0, 160)}”.`
              : `Accept captures “${String(c.title || 'it')}” into your Inbox. Nothing is sent, and the email is not touched.`;
        // RAW on purpose — needRow escapes n.sub once. Escaping here too would render a
        // vendor's apostrophes as &#39; on the owner's own board.
        sub = `From ${who} — ${String(p.reason).slice(0, 180)}. ${what}`;
        acceptBtn = cmd(verb, 'decide', { proposalId: p.id, decision: 'accept' }, 'small primary');
        // Edit is only meaningful where there is wording to change (a title / a project name).
        if (p.command_type === 'create_task' || p.command_type === 'create_project') {
          extraActions = `<button class="r-btn small" data-lc-mailedit="${LIFE.esc(JSON.stringify({ proposalId: p.id, title: String(c.title || ''), kind: p.command_type }))}">Edit</button>`;
        }
        if (m && m.web_link) {
          extraActions = `<a class="r-btn small" href="${LIFE.esc(m.web_link)}" target="_blank" rel="noopener noreferrer">Read email</a> ${extraActions}`;
        }
      } else if (isCalendarBlock) {
        let c = {}; try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { /* renders generic */ }
        sub = p.command_type === 'place_block'
          ? `Proposed focus block ${String(c.startAt || '').slice(11, 16)}–${String(c.endAt || '').slice(11, 16)} in your Life OS calendar. Accept places it in Outlook; No leaves Outlook untouched.`
          : `The task closed but its focus block still stands in Outlook. Accept removes the block (the task is not touched); No keeps it.`;
        acceptBtn = cmd(p.command_type === 'place_block' ? 'Place block' : 'Remove block', p.command_type, { proposalId: p.id }, 'small primary');
      } else {
        sub = isAgentDelivery
          ? `Agent deliverable awaiting your accept — the work is on the task. Accept completes it with the deliverable attached; No keeps it open.`
          : `${String(p.reason).slice(0, 110)} — it suggests ${p.command_type === 'set_waiting' ? 'parking this as waiting' : 'a next step'}.`;
        acceptBtn = cmd(isAgentDelivery ? 'Accept' : 'Approve', 'decide', { proposalId: p.id, decision: 'accept' }, 'small primary');
      }
      const row = {
        title: task ? link(task.id, task.title) : (isMail ? mailTitle(p) : 'A task'),
        sub,
        conf,
        actions: `${task ? `<a class="r-btn small" href="/life/task?id=${encodeURIComponent(task.id)}">Inspect</a>` : ''}${extraActions ? ` ${extraActions}` : ''} ${acceptBtn} ${cmd('No', 'decide', { proposalId: p.id, decision: 'reject' }, 'small')}`,
      };
      (highStakes || isAgentDelivery || isCalendarBlock ? material : suggestions).push(row);
    }
    // quiet-support on → suggestions fold; off → they sit inline with the material items.
    const needs = s.quiet ? material : [...material, ...suggestions];
    const foldedCount = s.quiet ? suggestions.length : 0;

    // ── header actions: Start focus (A3, opens the protected-block overlay on the must-win),
    // Replan, Approve plan. ──
    const focusBtn = mw
      ? `<button class="r-btn primary" data-lc-focus="${LIFE.esc(JSON.stringify({ taskId: mw.id, title: mw.title, dod: (mw.definition_of_done && String(mw.definition_of_done).trim()) || '' }))}">▶ Start focus</button>`
      : '';
    const headBtns = [
      focusBtn,
      plan ? cmd('Replan', 'plan_today', {}, '') : cmd('Plan my day', 'plan_today', {}, 'primary'),
      planIsDraft ? cmd('Approve plan', 'approve_plan', { planDate: s.today }, '') : '',
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

    // ── My day: REAL commitments from the Outlook mirror (calendar go 2026-08-10), with the
    // staleness caption in every render. No sync yet → the honest not-connected rail. Never
    // a free-time grid: the rail lists what is committed and says nothing about the gaps. ──
    let myDay;
    if (!s.calSync || !s.calSync.last_sync_at) {
      myDay = S.rcc.panel({
        title: 'My day', sub: 'Flexible blocks, not a brittle minute plan',
        body: `<div style="font-size:13.5px;line-height:1.6;padding:6px 0;color:var(--rmuted)">Outlook is not connected, so no fixed commitments show here — and no free time is invented. Today runs on the must-win and the two supports.`
          + `<div style="margin-top:10px"><button class="r-btn small" data-lc-fab>Capture a commitment</button></div></div>`,
      });
    } else {
      const ageMin = Math.max(0, Math.round((now - Date.parse(s.calSync.last_sync_at)) / 60_000));
      const ageText = ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m`;
      const calStale = !!s.calSync.last_error || ageMin > 45;
      const caption = calStale
        ? `<div class="r-note" style="color:#f5c96b">Last matched Outlook ${ageText} ago${s.calSync.last_error ? ' and the latest refresh failed' : ''} — treat this as stale; Outlook is the truth.</div>`
        : `<div class="r-note">Matched to Outlook ${ageText} ago.</div>`;
      const timed = (s.calEvents || []).filter((e) => !e.is_all_day && e.show_as !== 'free');
      const allDay = (s.calEvents || []).filter((e) => e.is_all_day);
      const evLine = (e) => `<div class="r-lrow"><div style="min-width:0;font-size:13px"><span style="font-family:var(--font-mono,monospace);color:#f0a276;font-size:12px;margin-right:8px">${LIFE.esc(String(e.start_at).slice(11, 16))}–${LIFE.esc(String(e.end_at).slice(11, 16))}</span>${LIFE.esc(e.subject || 'Busy')}</div>${e.is_protected ? S.rcc.tag('Focus', 'good') : ''}</div>`;
      myDay = S.rcc.panel({
        title: 'My day', sub: 'Fixed commitments from Outlook — flexible time stays flexible',
        headRight: timed.length ? `<span class="r-pill">${timed.length}</span>` : '',
        body: (allDay.length ? `<div class="r-note">All day: ${allDay.map((e) => LIFE.esc(e.subject || 'Busy')).join(' · ')}</div>` : '')
          + (timed.length
            ? timed.map(evLine).join('')
            : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing fixed in the calendar today — and no free time is invented around that.</div>`)
          + caption
          + `<div style="margin-top:8px"><a class="r-btn small" href="/life/schedule">Full schedule</a></div>`,
      });
    }

    // ── two supporting wins ──
    const supCard = (x) => `<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;background:rgba(255,255,255,.04);border:1px solid var(--rline);border-radius:10px;padding:12px 14px"><div style="display:flex;gap:12px;align-items:center;min-width:0"><div class="r-check"></div><div style="min-width:0"><div style="font-weight:600">${link(x.id, x.title)}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(x.domain_key)}</div></div></div><a class="r-btn small" href="/life/task?id=${encodeURIComponent(x.id)}">Open</a></div>`;
    const supBody = sup.length
      ? `<div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${sup.map(supCard).join('')}</div>`
      : `<div style="color:var(--rmuted);font-size:13px;padding:6px 0">No supporting wins today — the must-win stands alone, and on a thin day that is the right answer.</div>`;
    const supportsBand = S.rcc.panel({ title: 'Two supporting wins', sub: 'Useful, bounded and subordinate to the must-win', body: supBody });

    // ── needs you + waiting quietly ──
    const needRow = (n) => `<div class="r-lrow"><div style="min-width:0"><div style="font-weight:600">${n.title}</div>`
      + `<div style="font-size:12.5px;color:var(--rmuted);margin-top:3px;line-height:1.45">${LIFE.esc(n.sub)}</div>`
      + `${n.conf ? `<div style="margin-top:5px">${n.conf}</div>` : ''}</div>`
      + `<div style="display:flex;gap:6px;flex-shrink:0">${n.actions}</div></div>`;
    // FOLDED, NOT HIDDEN (Graph Stage C 2026-08-11). Quiet support used to fold suggestions
    // into a bare count pointing at All tasks — which worked while every suggestion belonged
    // to a task. A mail proposal about work that does not exist yet has no task and would
    // therefore have had no home at all. So the fold is now a real disclosure: below the
    // material items, closed by default, one click to see them. Nothing interrupts; nothing
    // disappears either.
    const foldLine = foldedCount
      ? `<details class="r-note" style="padding:0"><summary style="cursor:pointer;padding:8px 0">Quiet support is on — ${foldedCount} lower-stakes suggestion${foldedCount === 1 ? '' : 's'} folded so only material calls interrupt you.</summary>`
        + `<div style="margin-top:4px">${suggestions.map(needRow).join('')}</div>`
        + `<div style="padding:6px 0 2px">Turn quiet support off in <a href="/life/settings">Settings</a> to see these inline.</div></details>`
      : '';
    // MAIL FRESHNESS: mail proposals live in this panel, so its honesty caption lives here
    // too. A broken poll means nothing has been read — and therefore nothing proposed, which
    // must never be mistaken for a quiet inbox.
    let mailNote = '';
    if (s.mailSync) {
      const mAge = s.mailSync.last_sync_at ? Math.max(0, Math.round((now - Date.parse(s.mailSync.last_sync_at)) / 60_000)) : null;
      const mText = mAge === null ? 'never' : mAge < 60 ? `${mAge} min ago` : `${Math.floor(mAge / 60)}h ${mAge % 60}m ago`;
      // "Read inbox now" refreshes the MIRROR only. The classification pass rides the
      // 20-minute timer — it spawns an engine per batch and would outrun the relay.
      const readNow = cmd('Read inbox now', 'mail_sync', {}, 'small');
      mailNote = (mAge === null || mAge > 90 || s.mailSync.last_error)
        ? `<div class="r-note" style="color:#f5c96b">Inbox last read ${mText}${s.mailSync.last_error ? ` and the last pass failed (${LIFE.esc(String(s.mailSync.last_error).slice(0, 100))})` : ''} — nothing has been read, so nothing has been suggested from it. Outlook is untouched either way. ${readNow}</div>`
        : `<div class="r-note">Inbox read ${mText}${s.mailBacklog ? ` · ${s.mailBacklog} message${s.mailBacklog === 1 ? '' : 's'} not looked at yet` : ''} — read-only, and only ever suggestions. ${readNow}</div>`;
    }
    // If the queue ever outgrows the render limit, SAY SO. Never let the board look complete
    // while it is holding something back (see the truncation note in getSection).
    const shown = (s.openProposals || []).length;
    const overflow = Math.max(0, (s.openProposalCount || 0) - shown);
    const overflowLine = overflow
      ? `<div class="r-note" style="color:#f5c96b">${overflow} more open suggestion${overflow === 1 ? '' : 's'} beyond what fits here — clear some of these and the rest surface. Nothing is being hidden from you silently.</div>`
      : '';
    const needsPanel = S.rcc.panel({
      title: `Needs you`, sub: 'Only irreversible calls and genuine owner judgement',
      headRight: needs.length ? `<span class="r-pill">${needs.length}</span>` : '',
      body: (needs.length
        ? needs.map(needRow).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing needs you${foldedCount ? ' right now' : '. That is the design working'}.</div>`)
        + foldLine + overflowLine + mailNote,
    });

    // ── CAPACITY GUARDRAILS (A3): per stated-aim domain, protected vs review-due — derived from
    // real signals (active outcomes, available work, overdue follow-ups), never a mock score. ──
    const overdueDomains = new Set(overdue.map((w) => (t(w.task_id) || {}).domain_key).filter(Boolean));
    const workedDomains = new Set(s.neglectedFromWork || []);
    const guardBody = (s.activeOutcomes && s.activeOutcomes.length)
      ? s.activeOutcomes.map((d) => {
          const reviewDue = overdueDomains.has(d) || !workedDomains.has(d);
          const state = reviewDue ? S.rcc.tag('review due', 'warn') : S.rcc.tag('protected', 'good');
          const why = reviewDue
            ? (overdueDomains.has(d) ? 'a follow-up here has slipped' : 'nothing moving on it today')
            : 'work is in scope and progressing';
          return `<div class="r-lrow"><div><div style="font-weight:600;text-transform:capitalize">${LIFE.esc(d)}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">${why}</div></div>${state}</div>`;
        }).join('')
      : `<div style="color:var(--rmuted);font-size:13px;padding:6px 0">No 12-week outcomes set, so there is nothing to protect capacity for yet. <a href="/life/outcomes">Name what matters this quarter</a> and each domain shows here.</div>`;
    const guardrails = S.rcc.panel({
      title: 'Capacity guardrails', sub: 'Your stated aims — protected, or asking for attention',
      body: guardBody,
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

    // ── DUE SOON (G-05): deadlines inside 72h / overdue, shown WHATEVER the plan picked. Sits directly
    // under the hero so a statutory due can never hide below the fold. Rendered only when non-empty. ──
    const dueSoonRows = s.dueSoon || [];
    const dueRow = (d) => {
      const hrs = (Date.parse(d.due_at) - now) / 3_600_000;
      const overdue = hrs < 0;
      const chip = overdue ? S.rcc.tag('overdue', 'bad') : hrs < 24 ? S.rcc.tag('due today', 'bad') : S.rcc.tag(`in ${Math.round(hrs / 24)}d`, 'warn');
      const act = d.status === 'IN_PROGRESS'
        ? `<a class="r-btn small" href="/life/task?id=${encodeURIComponent(d.id)}">Open</a>`
        : cmd('Start', 'transition', { taskId: d.id, to: 'IN_PROGRESS' }, 'small primary');
      return `<div class="r-lrow"${overdue ? ' style="border-left:3px solid var(--rbad);padding-left:9px"' : ''}><div style="min-width:0">`
        + `<div style="font-weight:600">${link(d.id, d.title)}</div>`
        + `<div style="font-size:12px;color:var(--rmuted);margin-top:3px">Due ${LIFE.esc(String(d.due_at).slice(0, 10))} · ${d.due_kind === 'HARD' ? 'hard deadline' : 'target date'}${d.domain_key ? ' · ' + LIFE.esc(d.domain_key) : ''}</div></div>`
        + `<div style="display:flex;gap:6px;align-items:center;flex-shrink:0">${chip}${act}</div></div>`;
    };
    const dueSoonPanel = dueSoonRows.length ? S.rcc.panel({
      title: 'Due soon', sub: 'Deadlines inside 72 hours — shown whatever today’s plan picked',
      headRight: `<span class="r-pill">${dueSoonRows.length}</span>`,
      body: dueSoonRows.map(dueRow).join(''),
    }) : '';

    // LAYOUT (operator feedback 2026-08-05: cover the page, kill the dead space): the golden's
    // grammar — hero gives the must-win the widest column; below, TWO wide columns whose card
    // stacks balance (Needs+Available | Waiting+Handled) instead of three narrow ones.
    const body = head.replace('__HEADBTNS__', headBtns)
      + `<div class="lt-hero">${rexCard}${mustCard}${myDay}</div>`
      + (dueSoonPanel ? `<div style="margin-bottom:12px">${dueSoonPanel}</div>` : '')
      + `<div style="margin-bottom:12px">${supportsBand}</div>`
      + `<div class="lt-main">`
      + `<div style="display:grid;gap:12px;align-content:start">${needsPanel}${availPanel}</div>`
      + `<div style="display:grid;gap:12px;align-content:start">${waitingPanel}${guardrails}${handled}</div>`
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
