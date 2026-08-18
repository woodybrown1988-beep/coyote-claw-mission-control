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
/** A slice that SAYS it sliced. Hard `.slice(n)` rendered mid-word word-salad on ~13 live
 *  cards ("suggest re-") — the audit's most visible polish defect (Wave 3, 2026-08-13). */
function snip(v, n) {
  const s = String(v == null ? '' : v);
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}
// DEADLINE-AWARE FOLD OVERRIDE (Wave 3, 2026-08-13 audit). The quiet-fold was class-based
// only, and an engineer's next-morning 8–9am access request sat folded as "low stakes" — one
// closed <details> from being missed. Content carrying a live time commitment inside ~48h
// never folds, whatever its risk class. The match is deliberately broad (the COST of a false
// unfold is one extra card; the cost of a false fold is a missed visit).
const TIME_HINT_RE = /\b(today|tonight|tomorrow|this (morning|afternoon|evening))\b|\b\d{1,2}[:.]\d{2}\s*(am|pm)?\s*[–—-]\s*\d{1,2}\b|\b\d{1,2}\s*(am|pm)\s*[–—-]\s*\d{1,2}\b/i;
function timeCritical(p, nowMs) {
  const text = `${String(p.reason || '')} ${String(p.command_json || '')}`;
  if (TIME_HINT_RE.test(text)) return true;
  // ISO dates count only when FUTURE-inside-48h: a date in the past is almost always
  // provenance ("from GasSafe, 2026-08-11" — when the email arrived), and unfolding on
  // provenance would unfold half the mail rail. A real past-due commitment reaches Today
  // through the due-soon safety net; this override is for content-borne upcoming times.
  for (const d of text.match(/\d{4}-\d{2}-\d{2}/g) || []) {
    const ms = Date.parse(`${d}T12:00:00Z`);
    if (Number.isFinite(ms) && ms > nowMs && ms < nowMs + 48 * 3_600_000) return true;
  }
  return false;
}
/** Friendly group names for the batch-decide screen (falls back to the raw key). */
const CAP_LABEL = {
  agent_dispatch: 'Routing suggestions', agent_delivery: 'Agent deliverables',
  mail_capture: 'From your inbox — new tasks', mail_update: 'From your inbox — task updates',
  mail_wake: 'From your inbox — wake a waiting task', mail_project: 'From your inbox — projects',
  mail_reply_draft: 'Drafted replies', calendar_block: 'Calendar blocks',
};

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
      // FUTURE blocks per task (the-plan-follows-the-calendar, 2026-08-18): a PROPOSED plan
      // re-picks when its work gets scheduled ahead — but an APPROVED plan stands, so the
      // must-win card says the truth instead: "already scheduled Thu 07:00".
      const futureBlockOf = {};
      for (const b of q(`SELECT task_id, start_at FROM life_calendar_blocks
                          WHERE state IN ('PLACED','MOVED') AND task_id IS NOT NULL AND substr(start_at,1,10) > ?
                          ORDER BY start_at`, [today])) {
        if (!futureBlockOf[b.task_id]) futureBlockOf[b.task_id] = String(b.start_at);
      }
      const setting = (k, dflt) => { const r = q('SELECT value FROM life_settings WHERE key = ?', [k]); return r.length ? String(r[0].value) : dflt; };
      return {
        engine: { ok: true }, now, today, plan, taskOf, futureBlockOf,
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
        // SEPARATE again, for the same reason as mailOf: folder_name arrives with the
        // multi-folder migration, and MC must not blank the mail rail if it deploys first.
        // (This exact mistake was made and caught here — folding it into the query above
        // blanked every mail row against a pre-migration DB.)
        mailFolderOf: Object.fromEntries(q('SELECT id, folder_name FROM life_mail_messages WHERE folder_name <> \'\'')
          .map((r) => [r.id, r.folder_name])),
        // FILING (Stage C-move 2026-08-11) — separate queries again, for the reason learned
        // twice already: these tables arrive with the engine's migration and MC may deploy
        // first. A table that is not there yet costs the filing rail, never the board.
        mailFiling: {
          shadow: q("SELECT COUNT(*) c FROM life_mail_moves WHERE state = 'SHADOW'")[0]?.c ?? 0,
          moved: q("SELECT COUNT(*) c FROM life_mail_moves WHERE state = 'APPLIED'")[0]?.c ?? 0,
          undone: q("SELECT COUNT(*) c FROM life_mail_moves WHERE state = 'UNDONE'")[0]?.c ?? 0,
          rulesProposed: q("SELECT COUNT(*) c FROM life_mail_rules WHERE state = 'PROPOSED'")[0]?.c ?? 0,
          rulesShadow: q("SELECT COUNT(*) c FROM life_mail_rules WHERE state = 'SHADOW'")[0]?.c ?? 0,
          rulesArmed: q("SELECT COUNT(*) c FROM life_mail_rules WHERE state = 'ARMED'")[0]?.c ?? 0,
        },
        // REPLY DRAFTS (2026-08-11) — its own query for the third time and the same reason:
        // the drafts table arrives with the engine's migration, and MC may deploy first. A
        // missing table costs the draft body on a proposal, never the decision queue.
        draftOf: Object.fromEntries(q(
          `SELECT id, task_id, proposal_id, voice, needs_judgement, judgement_reason, replying_to, commits_to, body,
                  outlook_draft_id, seam_id, filed_move_id
             FROM life_mail_drafts WHERE state = 'PROPOSED' AND proposal_id IS NOT NULL`,
        ).map((r) => [r.proposal_id, r])),
        // outlook_gone_at is read SEPARATELY, and the comment four lines above says why: a
        // column folded into the SELECT above would make ONE missing column blank the entire
        // draft rail on a life.db that predates the migration. Split, the worst case is that
        // the "this draft has vanished" note is absent for a few minutes. I folded it in first
        // and the fixture caught it — which is the whole reason that rule is written down.
        goneAt: Object.fromEntries(q(
          `SELECT proposal_id, outlook_gone_at FROM life_mail_drafts
            WHERE state = 'PROPOSED' AND proposal_id IS NOT NULL AND outlook_gone_at IS NOT NULL`,
        ).map((r) => [r.proposal_id, r.outlook_gone_at])),
        // APPROVED drafts stay reachable for the rest of the day. Accepting a proposal removes
        // it from the queue — which for every other shape is correct, but here the row IS the
        // deliverable: tap accept before copying and the words are simply gone. Cheap to keep,
        // and the alternative is an owner retyping an email the system already wrote.
        draftsApproved: q(
          `SELECT id, body, approved_at, mail_id FROM life_mail_drafts
            WHERE state = 'APPROVED' AND approved_at >= ? ORDER BY approved_at DESC LIMIT 6`,
          [new Date(now - 86_400_000).toISOString()],
        ),
        draftsApprovedCount: q(
          `SELECT COUNT(*) c FROM life_mail_drafts WHERE state = 'APPROVED' AND approved_at >= ?`,
          [new Date(now - 86_400_000).toISOString()],
        )[0]?.c ?? 0,
        mailSync: q('SELECT last_sync_at, last_error, last_triage_at FROM life_mail_sync WHERE id = 1')[0] || null,
        mailBacklog: q('SELECT COUNT(*) c FROM life_mail_messages WHERE classified_at IS NULL')[0]?.c ?? 0,
        approvalRows: q(`SELECT id, title FROM life_tasks WHERE status = 'AWAITING_APPROVAL' ORDER BY updated_at ASC LIMIT 10`),
        available: q(`SELECT id, title, domain_key, execution_mode FROM v_life_available_work ORDER BY calculated_priority DESC, created_at ASC LIMIT 8`),
        // The "Available now 5" pill understated by 111 (audit F7): the COUNT is said too.
        availableCount: q(`SELECT COUNT(*) c FROM v_life_available_work`)[0]?.c ?? 0,
        // DUE-SOON SAFETY NET (audit 2026-08 G-05): any live task with a deadline inside 72h (or already
        // overdue) surfaces on Today REGARDLESS of what the plan compiled — statutory dues were TARGET
        // (not HARD), so the priority view never lifted them and they were invisible two days out.
        dueSoon: q(`SELECT id, title, due_at, due_kind, execution_mode, status, domain_key FROM life_tasks
                     WHERE status NOT IN ('DONE','CANCELLED') AND due_at IS NOT NULL AND due_at <= ?
                     ORDER BY due_at ASC LIMIT 12`, [new Date(now + 72 * 3_600_000).toISOString()]),
        inboxCount: q(`SELECT COUNT(*) c FROM life_tasks WHERE status = 'INBOX'`)[0]?.c ?? 0,
        // AGENTS WAITING ON YOU (operator ask 2026-08-13): dispatch + send-back events; the
        // live job state resolves in render from the business store (by id).
        dispatchEvents: q(`SELECT task_id, event_type, payload_json FROM life_task_events WHERE event_type IN ('AGENT_DISPATCHED','REOPENED') ORDER BY created_at ASC`),
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

  render(section, ctx) {
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
    // AGENTS WAITING ON YOU: a task whose agent cannot proceed without your words. Its own
    // panel, high on the page — the whole point of the ask was not having to open a task
    // to discover someone is stuck. Terminal tasks are excluded (nothing to unblock).
    const dispatchOf = LIFE.dispatchStateByTask(s.dispatchEvents || []);
    const jobsById = LIFE.jobStates((ctx && ctx.q) || null, [...dispatchOf.values()].map((d) => d.jobId));
    const stuck = [];
    for (const [taskId, d] of dispatchOf) {
      const task = t(taskId);
      if (!task || ['DONE', 'CANCELLED'].includes(String(task.status))) continue;
      const nu = LIFE.agentNeedsYou(d, jobsById.get(d.jobId));
      if (nu) stuck.push({ task, nu });
    }
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
      let sub, acceptBtn, extraActions = '', extra = '';
      if (isMail) {
        let c = {}; try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { /* renders generic */ }
        const m = (s.mailById || {})[mailId] || null;
        const who = m ? (m.from_name || m.from_address || 'an email') : 'an email';
        // WHERE it was read from. Only shown when it is not the Inbox, because that is the
        // interesting case: the folder you moved it into is the one you were acting on.
        const foldName = (s.mailFolderOf || {})[mailId];
        const where = foldName && foldName !== 'Inbox' ? ` (${String(foldName)})` : '';
        const verb = p.command_type === 'draft_reply' ? "I'll use this"
          : p.command_type === 'wake' ? 'Wake it'
            : p.command_type === 'add_update' ? 'Add to the task'
              : p.command_type === 'create_project' ? 'Create project' : 'Create task';
        const what = p.command_type === 'draft_reply'
          ? 'Nothing has been sent and nothing here can send — the draft waits in Outlook until you send it.'
          : p.command_type === 'wake' ? 'This looks like the reply this task was waiting for. Accept wakes it; No leaves it waiting.'
          : p.command_type === 'add_update' ? 'Accept files this email on the task as evidence. Nothing else moves.'
            : p.command_type === 'create_project' ? `Accept creates the project with this definition of done: “${snip(c.definitionOfDone, 160)}”.`
              : `Accept captures “${String(c.title || 'it')}” into your Inbox. Nothing is sent, and the email is not touched.`;
        // RAW on purpose — needRow escapes n.sub once. Escaping here too would render a
        // vendor's apostrophes as &#39; on the owner's own board.
        sub = `From ${who}${where} — ${snip(p.reason, 180)}. ${what}`;
        acceptBtn = cmd(verb, 'decide', { proposalId: p.id, decision: 'accept' }, 'small primary');
        // A DRAFTED REPLY shows the words themselves. Everything about this block is built so
        // the one thing that can go wrong here — copying it without reading it — is as hard
        // as a screen can make it: what it replies to and what it commits us to are stated
        // ABOVE the text, the judgement flag is a banner and not a badge, and the copy button
        // sits under the draft so the reading happens on the way to it.
        const dr = (s.draftOf || {})[p.id] || null;
        if (dr) {
          const flag = dr.needs_judgement
            ? `<div class="r-note" style="color:#f5c96b;font-weight:600">⚠ NEEDS YOUR JUDGEMENT — ${LIFE.esc(String(dr.judgement_reason || 'money, legal, staff or a dispute'))}. Read every line of this one.</div>`
            : '';
          const to = String(c.to || (m && m.from_address) || '');
          // WHERE IT IS. Since the reply loop went in, the draft is not a thing to copy — it is
          // already sitting in his Outlook, in the thread. The board's job changed from "here
          // are some words" to "here is what I did, undo it if I was wrong", so it says which
          // and offers the undo. If the Outlook draft could NOT be made, the words are all
          // there is, and it says that too rather than implying a draft that is not there.
          const inOutlook = !!dr.outlook_draft_id;
          // whereNote was gated on outlook_draft_id ALONE, so a draft the reconcile pass had
          // already found GONE still rendered "Drafted in your Outlook — read it there",
          // directly under the note saying it is no longer there. Two statements, one screen,
          // one of them false.
          const gone = !!(s.goneAt || {})[p.id];
          const whereNote = gone
            ? ''
            : inOutlook
            ? `<div class="r-note">✍️ Drafted in your Outlook${dr.filed_move_id
              ? ' · the email was filed to <b>Emails to Respond</b>'
              : ' · the email was <b>left in your Inbox</b>'} — read it there and send it yourself.</div>`
            : `<div class="r-note" style="color:#f5c96b">Not in Outlook — the draft could not be created there, so these words are all there is. Copy them across.</div>`;
          extraActions = `<button class="r-btn small" data-lc-draftcopy="${LIFE.esc(String(dr.body || ''))}">Copy the reply</button>`
            + ` <button class="r-btn small" data-lc-draftedit="${LIFE.esc(JSON.stringify({ proposalId: p.id, body: String(dr.body || '') }))}">Edit</button>`
            + ` <button class="r-btn small" data-lc-replied="${LIFE.esc(String(dr.id || ''))}" aria-expanded="false">I&#39;ve replied myself</button>`
            + (inOutlook && dr.seam_id
              ? ` ${cmd('Undo the draft', 'undo_draft', { seamId: String(dr.seam_id) }, 'small')}`
              : '');
          // THE DRAFT HAS VANISHED FROM OUTLOOK and this system did not remove it. He sent it
          // or he binned it, and Sent Items is a refused folder so there is no way to tell
          // which. That is the one moment the system genuinely knows something changed — so it
          // asks, rather than leaving a card that invites him to read words that are not there.
          const goneNote = (s.goneAt || {})[p.id]
            ? `<div class="r-note" style="border-left:3px solid #f5c96b;padding-left:8px;margin:8px 0">`
              + `<b>This draft is no longer in your Outlook.</b> You either sent it or binned it — this system cannot see which, because it never reads your Sent Items. If you sent it, say so and the email stops being treated as awaiting a reply.`
              + `</div>`
            : '';
          // THE FORM, inline and hidden until asked for. Two questions, and the note is the one
          // worth typing properly — which is why this is a form and not a modal prompt chain.
          // The task select only exists when there IS a task; with none, the handler sends
          // 'none' because there is nothing for the planner to be told.
          const repliedForm = `<form class="lc-replied-form" data-draft="${LIFE.esc(String(dr.id || ''))}" style="display:none;margin:8px 0;padding:10px;border-left:3px solid #f5c96b;background:rgba(255,179,77,.05)">`
            // The note box is offered ONLY where there is a task to hang it on. Asking for
            // words and then discarding them is worse than not asking; with no task the form
            // says so instead of taking dictation it will bin.
            + (dr.task_id
              ? `<div style="font-size:12.5px;color:var(--rmuted);margin-bottom:6px">This system never reads your Sent Items, so it can’t see what you sent — tell it as much or as little as you like. Leave it blank and the record just says you replied.</div>`
                + `<textarea name="note" maxlength="2000" rows="3" class="lc-input" style="resize:vertical;width:100%" placeholder="What did you tell them? (optional)"></textarea>`
              : `<div style="font-size:12.5px;color:var(--rmuted);margin-bottom:6px">This system never reads your Sent Items, so it can’t see what you sent — and there is no task on this correspondence to remember it against, so it won’t ask you to type it out.</div>`)
            + (dr.task_id
              ? `<div class="lc-row" style="align-items:center;margin-top:6px"><label style="font-size:12px;color:var(--rmuted)">And the task on this: `
                + `<select name="outcome" class="lc-input" style="margin-left:6px">`
                + `<option value="waiting">still waiting — it’s on them now</option>`
                + `<option value="wake">wake it — it’s mine again</option>`
                + `<option value="complete">done — that was the whole task</option>`
                + `</select></label></div>`
              : `<div class="r-note" style="margin-top:6px">No task is attached to this correspondence, so nothing on the board changes.</div>`)
            + `<div class="lc-row" style="margin-top:8px"><button type="submit" class="r-btn small primary">Yes — I replied, close this off</button></div>`
            + `<div style="font-size:11.5px;color:var(--rmuted);margin-top:6px">This deletes the draft from your Outlook and stops the email being treated as awaiting a reply.</div>`
            + `</form>`;
          extra = `${flag}${goneNote}${whereNote}${repliedForm}`
            + `<div class="r-note">To ${LIFE.esc(to)} · ${dr.voice === 'BRAND' ? 'brand voice' : 'plain professional'}</div>`
            + `<div class="r-note"><b>Replying to:</b> ${LIFE.esc(String(dr.replying_to || ''))}</div>`
            + `<div class="r-note"><b>Commits us to:</b> ${LIFE.esc(String(dr.commits_to || ''))}</div>`
            + `<pre class="lc-draft" style="white-space:pre-wrap;margin:8px 0;padding:10px;border-left:3px solid #4a5568;background:rgba(255,255,255,.04);font:13px/1.5 ui-monospace,Menlo,monospace">${LIFE.esc(String(dr.body || ''))}</pre>`;
        }
        // Edit is only meaningful where there is wording to change (a title / a project name).
        if (p.command_type === 'create_task' || p.command_type === 'create_project') {
          extraActions = `<button class="r-btn small" data-lc-mailedit="${LIFE.esc(JSON.stringify({ proposalId: p.id, title: String(c.title || ''), kind: p.command_type }))}">Edit</button>`;
        }
        if (m && m.web_link) {
          extraActions = `<a class="r-btn small" href="${LIFE.esc(m.web_link)}" target="_blank" rel="noopener noreferrer">Read email</a> ${extraActions}`;
        }
      } else if (isCalendarBlock) {
        let c = {}; try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { /* renders generic */ }
        const span = `${String(c.startAt || '').slice(11, 16)}–${String(c.endAt || '').slice(11, 16)}`;
        // FOUR verbs now, not two. Continuous replan (2026-08-11) added move and swap, and a
        // two-way branch labelled every one of them "Remove block" over the sentence "the
        // task closed" — a swap proposal read as a removal of a task that is very much open,
        // while the button underneath dispatched something else entirely. Each verb says
        // what it would actually do, and the REASON carries the rest: the engine writes a
        // full sentence naming the clash or both priorities, and it is shown, not replaced.
        const VERB = {
          place_block: {
            label: 'Place block',
            sub: `Proposed focus block ${span} in your Life OS calendar. Accept places it in Outlook; No leaves Outlook untouched.`,
          },
          remove_block: {
            label: 'Remove block',
            sub: `${String(p.reason)} Accept removes the block (the task is not touched); No keeps it.`,
          },
          move_block: {
            label: 'Move block',
            sub: `${String(p.reason)} Accept moves it to ${span}; No leaves it where it is.`,
          },
          swap_block: {
            label: 'Swap the slot',
            sub: `${String(p.reason)} Accept frees that block and gives the slot to the other task; No changes nothing.`,
          },
        }[p.command_type] || { label: 'Apply', sub: String(p.reason) };
        sub = VERB.sub;
        acceptBtn = cmd(VERB.label, p.command_type, { proposalId: p.id }, 'small primary');
        // A slot that has already passed gets the truth instead of a button that can only
        // be refused (live failure 2026-08-18). The writer's sweep retires the card within
        // a minute; until then: mark the work done if it happened, or dismiss.
        const localNowT = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))}T${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(now))}`;
        if (String(c.endAt || '') !== '' && String(c.endAt) <= localNowT) {
          sub = `This slot passed before it was decided — it retires itself shortly and a fresh time gets offered at the next plan run. If the work actually happened, mark it done.`;
          acceptBtn = (p.command_type === 'place_block' && typeof c.taskId === 'string' && c.taskId)
            ? cmd('I did this — mark done', 'complete', { taskId: c.taskId }, 'small primary')
            : '';
        }
      } else {
        // THE DELIVERABLE ON THE CARD (Wave 3, audit stall-1 friction): agent deliverables
        // were the only material card class with no inline content — the reader had to
        // round-trip through Inspect while reply drafts showed their words right here (and
        // got decided). The evidenceNote IS the deliverable summary the agent filed; a
        // proposal without one (older rows) keeps the open-the-task wording instead of
        // pointing at content that is not there.
        let deliverableNote = '';
        if (isAgentDelivery) {
          let c = {}; try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { /* renders without */ }
          deliverableNote = String(c.evidenceNote || '').trim();
          if (deliverableNote) {
            extra = `<pre class="lc-draft" style="white-space:pre-wrap;margin:8px 0;padding:10px;border-left:3px solid #4a5568;background:rgba(255,255,255,.04);font:12.5px/1.5 ui-monospace,Menlo,monospace">${LIFE.esc(snip(deliverableNote, 700))}</pre>`;
          }
        }
        sub = isAgentDelivery
          ? (deliverableNote
            ? `Agent deliverable awaiting your accept — the content is below. Accept completes the task with it attached as evidence; No keeps the task open.`
            : `Agent deliverable awaiting your accept — the work is on the task. Accept completes it with the deliverable attached; No keeps it open.`)
          : `${snip(p.reason, 110)} — it suggests ${p.command_type === 'set_waiting' ? 'parking this as waiting' : p.command_type === 'set_route' ? 'the routing change below' : 'a next step'}.`;
        acceptBtn = cmd(isAgentDelivery ? 'Accept' : 'Approve', 'decide', { proposalId: p.id, decision: 'accept' }, 'small primary');
      }
      const row = {
        title: task ? link(task.id, task.title) : (isMail ? mailTitle(p) : 'A task'),
        sub,
        extra,
        conf,
        actions: `${task ? `<a class="r-btn small" href="/life/task?id=${encodeURIComponent(task.id)}">Inspect</a>` : ''}${extraActions ? ` ${extraActions}` : ''} ${acceptBtn} ${cmd('No', 'decide', { proposalId: p.id, decision: 'reject' }, 'small')}`,
      };
      // A drafted reply that NEEDS YOUR JUDGEMENT is material by definition — money, legal,
      // staff or a dispute is exactly the class of thing quiet support must never fold away.
      const judgementDraft = !!((s.draftOf || {})[p.id] || {}).needs_judgement;
      // DEADLINE-AWARE OVERRIDE: content carrying a live time commitment inside ~48h never
      // folds, whatever its risk class (the engineer-visit case, audit F6).
      const urgent = timeCritical(p, now);
      if (urgent) {
        row.extra = `<div style="margin-top:4px">${S.rcc.tag('time-critical', 'warn')}</div>${row.extra || ''}`;
      }
      (highStakes || isAgentDelivery || isCalendarBlock || judgementDraft || urgent ? material : suggestions).push(row);
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
      // ONE THUMB-FLICK TO THE QUEUE (Wave 3, audit F8): on a phone the decision queue — the
      // tap-first workflow's whole point — landed 3–4 screens deep. The chip jumps straight
      // to it from the top on every viewport.
      needs.length ? `<a class="r-btn small" href="#lt-needs">▼ ${needs.length} decision${needs.length === 1 ? '' : 's'}</a>` : '',
    ].join(' ');

    // ── hero row: brief · must-win · my day ──
    const morning = `${s.captured24h ? `${s.captured24h} captured in the last day. ` : ''}`
      + `${stuck.length ? `${stuck.length} agent${stuck.length === 1 ? '' : 's'} ${stuck.length === 1 ? 'is' : 'are'} stuck waiting on you. ` : ''}`
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
      // A must-win the owner has ALREADY scheduled onto a future day says so and offers
      // Replan (an approved plan is his — never silently re-picked; a PROPOSED plan would
      // have re-picked itself the moment the block landed).
      const fb = (s.futureBlockOf || {})[mw.id];
      const fbLine = fb
        ? `<div style="font-size:12.5px;color:#f5c96b;margin:6px 0 2px">Already scheduled — ${LIFE.esc(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${String(fb).slice(0, 10)}T12:00:00Z`)))} at ${LIFE.esc(String(fb).slice(11, 16))}. Replan to pick a fresh must-win for today.</div>`
        : '';
      mustCard = `<div class="r-card r-panel" style="border-color:rgba(255,179,77,.4)"><div class="r-eyebrow hot">Today's must-win</div>
        <div style="font-size:19px;font-weight:650;line-height:1.3;margin-bottom:8px">${link(mw.id, mw.title)}</div>
        <div>${S.rcc.tag(mw.status === 'IN_PROGRESS' ? 'in progress' : 'ready', mw.status === 'IN_PROGRESS' ? 'good' : '')} ${S.rcc.tag(mw.domain_key)}</div>${fbLine}
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
    // n.extra is pre-escaped MARKUP (the drafted-reply block builds it with LIFE.esc on every
    // interpolated value). n.sub is plain text and is escaped here, once — escaping it twice
    // is how a vendor's apostrophes end up as &#39; on the owner's own board.
    const needRow = (n) => `<div class="r-lrow"><div style="min-width:0"><div style="font-weight:600">${n.title}</div>`
      + `<div style="font-size:12.5px;color:var(--rmuted);margin-top:3px;line-height:1.45">${LIFE.esc(n.sub)}</div>`
      + `${n.extra || ''}`
      + `${n.conf ? `<div style="margin-top:5px">${n.conf}</div>` : ''}</div>`
      + `<div style="display:flex;gap:6px;flex-shrink:0;align-self:flex-start">${n.actions}</div></div>`;
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
      // "Nothing has been read" is only TRUE when nothing was read. A pass that reached the
      // mailbox and lost one folder — or completed every folder but could not list them all
      // (mailbox fingerprint work, engine 2026-08-11) — read most of it, and saying otherwise
      // sends the owner hunting a healthy sync. Loud is right; wrong is not.
      const stale = mAge === null || mAge > 90;
      const err = s.mailSync.last_error ? LIFE.esc(String(s.mailSync.last_error).slice(0, 140)) : '';
      mailNote = stale
        ? `<div class="r-note" style="color:#f5c96b">Inbox last read ${mText}${err ? ` and the last pass failed (${err})` : ''} — nothing has been read, so nothing has been suggested from it. Outlook is untouched either way. ${readNow}</div>`
        : err
          ? `<div class="r-note" style="color:#f5c96b">Inbox read ${mText}, but that pass hit a problem (${err}) — part of the mailbox may not have been read, so treat the absence of a suggestion as unknown rather than clear. Outlook is untouched either way. ${readNow}</div>`
          : `<div class="r-note">Inbox read ${mText}${s.mailBacklog ? ` · ${s.mailBacklog} message${s.mailBacklog === 1 ? '' : 's'} not looked at yet` : ''} — read-only, and only ever suggestions. ${readNow}</div>`;
    }
    // APPROVED-BUT-STILL-UNSENT. Accepting a drafted reply means "these are the words I'm
    // using" — it cannot mean "sent", because nothing here can send and the system has no way
    // to observe whether he actually sent it. So the honest caption is the one that says both:
    // you approved it, it is still on you, and here it is again to copy.
    let approvedNote = '';
    const appr = s.draftsApproved || [];
    if (appr.length) {
      // NO SILENT TRUNCATION — the same rule as the decision queue, in the same file that
      // already learned it once. Six are kept; if there were more, say so.
      const apprTotal = s.draftsApprovedCount || appr.length;
      const apprMore = Math.max(0, apprTotal - appr.length);
      approvedNote = `<details class="r-note" style="padding:0"><summary style="cursor:pointer;padding:8px 0">`
        + `${apprTotal} repl${apprTotal === 1 ? 'y you approved' : 'ies you approved'} today — still yours to send. `
        + `Nothing here has left the building.${apprMore ? ` (The ${appr.length} most recent are shown; ${apprMore} older ${apprMore === 1 ? 'is' : 'are'} in \`msgraph drafts\`.)` : ''}</summary>`
        + appr.map((d) => `<div style="margin:6px 0 12px">`
          + `<pre class="lc-draft" style="white-space:pre-wrap;margin:0 0 6px;padding:10px;border-left:3px solid #4a5568;background:rgba(255,255,255,.04);font:13px/1.5 ui-monospace,Menlo,monospace">${LIFE.esc(String(d.body || ''))}</pre>`
          + `<button class="r-btn small" data-lc-draftcopy="${LIFE.esc(String(d.body || ''))}">Copy the reply</button></div>`).join('')
        + `</details>`;
    }
    // If the queue ever outgrows the render limit, SAY SO. Never let the board look complete
    // while it is holding something back (see the truncation note in getSection).
    const shown = (s.openProposals || []).length;
    const overflow = Math.max(0, (s.openProposalCount || 0) - shown);
    const overflowLine = overflow
      ? `<div class="r-note" style="color:#f5c96b">${overflow} more open suggestion${overflow === 1 ? '' : 's'} beyond what fits here — clear some of these and the rest surface. Nothing is being hidden from you silently.</div>`
      : '';
    // FILING RAIL. While rules rehearse, the honest headline is what it WOULD have done —
    // that number is the whole point of the shadow period, and it must be impossible to miss.
    const f = s.mailFiling || {};
    let filingNote = '';
    if ((f.shadow || f.moved || f.rulesProposed || f.rulesShadow || f.rulesArmed)) {
      const bits = [];
      if (f.rulesShadow) bits.push(`<b>${f.shadow}</b> message${f.shadow === 1 ? '' : 's'} would have been filed by ${f.rulesShadow} rule${f.rulesShadow === 1 ? '' : 's'} still rehearsing — nothing has moved`);
      if (f.rulesArmed) bits.push(`${f.moved} filed by ${f.rulesArmed} armed rule${f.rulesArmed === 1 ? '' : 's'}`);
      if (f.undone) bits.push(`${f.undone} put back`);
      if (f.rulesProposed) bits.push(`<b>${f.rulesProposed}</b> filing rule${f.rulesProposed === 1 ? '' : 's'} proposed, awaiting you`);
      filingNote = `<div class="r-note">🗂️ ${bits.join(' · ')}. Nothing is ever filed while it still has an undecided proposal here.</div>`;
    }
    const needsPanel = `<div id="lt-needs">` + S.rcc.panel({
      title: `Needs you`, sub: 'Only irreversible calls and genuine owner judgement',
      headRight: needs.length ? `<span class="r-pill">${needs.length}</span>` : '',
      body: (needs.length
        ? needs.map(needRow).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing needs you${foldedCount ? ' right now' : '. That is the design working'}.</div>`)
        + foldLine + overflowLine + approvedNote + mailNote + filingNote,
    }) + `</div>`;

    // ── BATCH DECIDE (Wave 3, 2026-08-13 audit — the decision-throughput screen). The audit's
    // one number: proposals arrive 4.4× faster than they get decided, because each decide was
    // a find-the-card-and-tap. This screen lists EVERY open proposal grouped by capability
    // with a checkbox each; one submit posts one ordinary `decide` per ticked row — each tick
    // is still an individual HUMAN selection and `decideProposal` is untouched. Accept
    // deliberately NEVER rides a calendar block (its accept IS the Outlook placement, own
    // verb) or a drafted reply (its accept means "I read these words") from here — those
    // tick-boxes carry data-acceptok="0" and batch-accept skips them out loud. Reject is a
    // plain decide for every class. ──
    let batchPanel = '';
    if ((s.openProposalCount || 0) >= 4) {
      const groups = new Map();
      for (const p of s.openProposals || []) {
        const g = groups.get(p.capability_key) || [];
        g.push(p); groups.set(p.capability_key, g);
      }
      const groupHtml = [...groups.entries()].map(([cap, rows]) => {
        const rowsHtml = rows.map((p) => {
          const task = t(p.task_id);
          let c = {}; try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { /* label falls back */ }
          const label = task ? task.title : String(c.title || CAP_LABEL[cap] || cap.replace(/_/g, ' '));
          const acceptOk = cap !== 'calendar_block' && cap !== 'mail_reply_draft';
          return `<label class="r-lrow" style="cursor:pointer"><div style="min-width:0;display:flex;gap:9px;align-items:flex-start">`
            + `<input type="checkbox" class="lc-batch-ck" data-proposal="${LIFE.esc(p.id)}" data-acceptok="${acceptOk ? '1' : '0'}" style="margin-top:3px">`
            + `<div style="min-width:0"><div style="font-weight:600">${LIFE.esc(label)}</div>`
            + `<div style="font-size:12px;color:var(--rmuted);margin-top:2px;line-height:1.4">${LIFE.esc(snip(p.reason, 140))}${acceptOk ? '' : ' · <i>accept on its own card — reject works from here</i>'}</div></div></div>`
            + `<div style="flex-shrink:0">${S.rcc.conf(p.confidence)}</div></label>`;
        }).join('');
        return `<div class="r-eyebrow" style="margin-top:10px">${LIFE.esc(CAP_LABEL[cap] || cap.replace(/_/g, ' '))} · ${rows.length}</div>${rowsHtml}`;
      }).join('');
      batchPanel = S.rcc.panel({
        title: 'Batch decide', sub: 'Tick what you’ve read, then one submit — every tick is still your individual yes or no',
        headRight: `<span class="r-pill">${s.openProposalCount}</span>`,
        body: `<div class="lc-batch">`
          + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px"><button class="r-btn small" data-lc-batch-all>Tick everything</button></div>`
          + groupHtml
          + `<div style="margin-top:10px"><input class="lc-input" name="batchnote" maxlength="500" placeholder="Optional note — lands on every ticked decision (why you said no teaches the proposer)" style="width:100%"></div>`
          + `<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">`
          + `<button class="r-btn small primary" data-lc-batch="accept">Accept ticked</button>`
          + `<button class="r-btn small" data-lc-batch="reject">Reject ticked</button>`
          + `</div><div class="lc-batch-out r-note" style="min-height:18px"></div></div>`,
      });
    }

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
    // "Available now 5" against 116 executable rows was the one dishonest pill on a page
    // whose other arithmetic is impeccable (audit F7) — the remainder is now said out loud.
    const availMore = Math.max(0, (s.availableCount || 0) - availRows.length);
    const availPanel = S.rcc.panel({
      title: 'Available now', sub: 'The top of the executable list — waiting and approval items are excluded',
      headRight: availRows.length ? `<span class="r-pill">${availRows.length}${availMore ? ` of ${s.availableCount}` : ''}</span>` : '',
      body: (availRows.length
        ? availRows.map((a) => `<div class="r-lrow"><div><div style="font-weight:600">${link(a.id, a.title)}</div><div style="margin-top:4px">${S.rcc.tag(a.domain_key)}</div></div>${cmd('Start', 'transition', { taskId: a.id, to: 'IN_PROGRESS' }, 'small')}</div>`).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing else is ready. Capture something, or wake a waiting item if it is genuinely unblocked.</div>`)
        + (availMore ? `<div class="r-note">${availMore} more executable now — <a href="/life/tasks">the full list is in All tasks</a>.</div>` : '')
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
    // ── AGENTS WAITING ON YOU ── rendered only when real; each row says WHO, WHY, and
    // offers the one move that unblocks it (open the task and talk / send it back).
    const stuckPanel = stuck.length ? S.rcc.panel({
      title: 'Agents waiting on you', sub: 'They cannot go on until you say something — a reply is usually one line',
      headRight: `<span class="r-pill">${stuck.length}</span>`,
      body: stuck.map(({ task, nu }) => `<div class="r-lrow" style="${LIFE.NEEDS_YOU_ROW_STYLE}">`
        + `<div style="min-width:0"><div style="font-weight:600">${link(task.id, task.title)}</div>`
        + `<div style="font-size:12.5px;color:var(--rbad,#ef6b68);font-weight:600;margin-top:3px">🗣 ${LIFE.esc(nu.who)} — ${LIFE.esc(nu.reason)}</div></div>`
        + `<a class="r-btn small primary" href="/life/task?id=${encodeURIComponent(task.id)}">Talk to it</a></div>`).join(''),
    }) : '';

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
      + (stuckPanel ? `<div style="margin-bottom:12px">${stuckPanel}</div>` : '')
      + (dueSoonPanel ? `<div style="margin-bottom:12px">${dueSoonPanel}</div>` : '')
      + `<div style="margin-bottom:12px">${supportsBand}</div>`
      + `<div class="lt-main">`
      + `<div style="display:grid;gap:12px;align-content:start">${needsPanel}${batchPanel}${availPanel}</div>`
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
