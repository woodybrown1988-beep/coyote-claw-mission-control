'use strict';
// LIFE OS — TASK DRAWER (matrix A6/A8 surface). One task: header + legal actions, the
// add-update field (record-only honoured), and the evidence timeline — the human note, the
// extracted facts and the AI proposals rendered SEPARATELY (pack ADR-005: provenance is the
// product). Every button posts an allowlisted command; the writer re-validates; refusals
// alert by name. Reached by links (no sidebar slot — workspaceOf prefix fallback).
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;

// The buttons each status legitimately offers (mirrors the engine's transition table — the
// writer re-validates, so a stale page can refuse loudly but never corrupt).
const ACTIONS = {
  // INBOX 'Ready' is the explicit ACCEPTED-STANDALONE disposition (triage ruling
  // 2026-08-10) — audited by name, so the Inbox reaches zero honestly.
  INBOX: [['Accept standalone', 'accept_standalone', null], ['Batch', 'transition', 'BATCH']],
  READY: [['Start', 'transition', 'IN_PROGRESS'], ['Needs my decision', 'transition', 'AWAITING_APPROVAL'], ['Block', 'transition', 'BLOCKED'], ['Batch', 'transition', 'BATCH']],
  SCHEDULED: [['Start', 'transition', 'IN_PROGRESS'], ['Back to ready', 'transition', 'READY']],
  IN_PROGRESS: [['Pause', 'transition', 'READY'], ['Block', 'transition', 'BLOCKED']],
  WAITING: [],
  BLOCKED: [['Unblock', 'transition', 'READY']],
  AWAITING_APPROVAL: [['Approve → ready', 'transition', 'READY'], ['Start now', 'transition', 'IN_PROGRESS']],
  BATCH: [['Ready', 'transition', 'READY'], ['Start', 'transition', 'IN_PROGRESS']],
  DONE: [], CANCELLED: [],
};

// PAID, FROM THE TASK (operator ask 2026-08-21: "how do we get an invoice removed from the
// list", then "play through it like you are using it as a human"). The first cut listed 18 flat
// rows under a 40-line description saying the same thing — the same debt twice, buttons on the
// second copy only, unpriced rows indistinguishable, and a "file by hand" dead end. This is the
// primary surface now: grouped by supplier exactly as the run is written, subtotals, ages, the
// gated total, and every row actionable — a recorded home gets a one-tap button; a row with no
// recorded home gets a picker of REAL folders (half the queue arrives via Xero's relay, where one
// sender serves three suppliers, so history can never name the folder — the owner's pick is the
// resolution, and the writer still refuses a path that names no folder).
// THE WEEKLY BOOKER RUN (operator ask 2026-08-25). Keyed on the ARMED event, exactly like
// invoiceRunBlock above — a task that merely mentions Booker gets nothing, and a renamed task
// keeps its button. The GO runs every leg the box owns; the fetch from booker.co.uk is the one
// leg it cannot, so the panel prints WHICH invoices are still outside rather than a green tick.
function bookerRunBlock(events) {
  const armed = (events || []).find((e) => e.event_type === 'BOOKER_RUN_ARMED');
  if (!armed) return '';
  const runs = (events || []).filter((e) => e.event_type === 'BOOKER_RUN_EXECUTED');
  const last = runs.length ? runs[runs.length - 1] : null;
  let pl = {};
  try { pl = JSON.parse((last && last.payload_json) || '{}'); } catch (_) { pl = {}; }
  const muted = 'font-size:11.5px;color:#9aa3ad';

  const go = `<button class="r-btn" data-lc-cmd="${LIFE.esc(JSON.stringify({ command: 'booker_run', payload: {} }))}">Go &mdash; run the Booker update</button>`;

  let outcome = `<div style="${muted};margin-top:8px">Not run yet this week.</div>`;
  if (last) {
    const when = LIFE.esc(String(last.created_at || '').slice(0, 16).replace('T', ' '));
    const noteLines = String(pl.note || '').split('\n').filter(Boolean);
    // The failure branch is FIRST and loud. A run that crashed and a run that found nothing look
    // identical in a summary line, and only one of them means the week is fine.
    const head = pl.ok === false
      ? `<div style="font-size:12.5px;color:#ef6b68;font-weight:600">Last run FAILED at ${when} &mdash; ${LIFE.esc(String(pl.error || 'no reason recorded'))}</div>`
      : `<div style="font-size:12.5px;color:#9aa3ad">Last run ${when}</div>`;
    // A FAILED run knows NOTHING about what is outstanding, so it must claim nothing. The first
    // version of this line fell through to the happy branch on a crash and rendered "Nothing
    // outstanding - both streams are in" over the top of a stack trace: the single most misleading
    // sentence the panel could produce, and it took a test against emitted output to see it.
    const still = pl.ok === false
      ? `<div style="font-size:12.5px;color:#9aa3ad;margin-top:6px">The run did not finish, so nothing is known about what is outstanding.</div>`
      : pl.needsBrowser
      ? `<div style="font-size:12.5px;color:#f5c96b;margin-top:6px"><b>${Number(pl.missingDirect || 0)}</b> Marketplace invoices are still on Booker&rsquo;s site and not here`
        + (pl.missingDirectValue ? ` &mdash; &pound;${Number(pl.missingDirectValue).toFixed(2)} ex VAT` : '')
        + `. That fetch needs your logged-in Chrome; the box has no route to Booker.</div>`
      : `<div style="font-size:12.5px;color:#7fc99a;margin-top:6px">Nothing outstanding &mdash; both streams are in.</div>`;
    outcome = `${head}${noteLines.length
      ? `<div style="font-size:12.5px;line-height:1.6;margin-top:6px;white-space:pre-wrap">${LIFE.esc(noteLines.join('\n'))}</div>` : ''}${still}`;
  }
  return `<div class="r-card r-panel" style="margin-bottom:10px"><h3>Booker &mdash; the weekly update</h3>
    <div style="font-size:12.5px;line-height:1.55;margin-bottom:8px">Go parses every Booker PDF that has arrived, checks each invoice against the total printed on it, files depot and Marketplace lines separately, and rebuilds the price analysis.</div>
    ${go}${outcome}</div>`;
}

function invoiceRunBlock(events, folders) {
  const armed = (events || []).find((e) => e.event_type === 'INVOICE_RUN_ARMED');
  if (!armed) return '';
  let lines = []; let groupPaid = [];
  try {
    const pj = JSON.parse(armed.payload_json || '{}');
    lines = pj.lines || []; groupPaid = pj.groupPaid || [];
  } catch { return ''; }
  if (!lines.length) return '';
  const gbp = (p) => '\u00a3' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const muted = 'font-size:11.5px;color:#9aa3ad';

  // One group per supplier, exactly as the run text is written: biggest known obligation first,
  // unpriced groups sink to the bottom where the go-and-read work lives.
  const groups = []; const at = new Map();
  for (const l of lines) {
    const k = String(l.supplier || '?').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!at.has(k)) { at.set(k, groups.length); groups.push({ supplier: String(l.supplier || '?'), rows: [] }); }
    groups[at.get(k)].rows.push(l);
  }
  const sumOf = (rs) => rs.every((r) => typeof r.totalPence === 'number' && r.totalPence > 0)
    ? rs.reduce((a, r) => a + r.totalPence, 0) : null;
  groups.sort((a, b) => (sumOf(b.rows) ?? -1) - (sumOf(a.rows) ?? -1));

  // The picker options: real move-target folders from the mirror, minus the action folders an
  // invoice never files to. Rendered once, cloned per row by the browser's own <select>.
  // r-routesel, NOT r-btn: a native select popup ignores the control's colours, and without
  // color-scheme:dark it renders the UA's light list under our light text — white-on-white,
  // invisible. This page's Route and Project dropdowns carry the same class for the same reason
  // (the CSS comment dates the original report 2026-08-10; the picker repeated it 2026-08-21).
  const opts = (folders || [])
    .filter((f) => !/^(00 |01 |02 |08 )|^Deleted Items/.test(String(f.path)))
    .map((f) => `<option value="${LIFE.esc(String(f.path))}">${LIFE.esc(String(f.path))}</option>`).join('');

  const rowHtml = (l) => {
    const age = typeof l.ageDays === 'number'
      ? `<span style="${muted}${l.ageDays >= 14 ? ';color:#f5c96b' : ''}">${l.ageDays}d</span>` : '';
    const what = l.ref
      ? `invoice ${LIFE.esc(String(l.ref))}`
      : `<span style="${muted}">\u201c${LIFE.esc(String(l.subject || '').slice(0, 52))}${String(l.subject || '').length > 52 ? '\u2026' : ''}\u201d</span>`;
    const price = typeof l.totalPence === 'number' && l.totalPence > 0
      ? `<b>${gbp(l.totalPence)}</b>` : `<span style="${muted}">not read</span>`;
    const act = l.onwardPath
      ? btnCmd('Paid \u2014 file it', 'mail_paid', { moveId: String(l.moveId) })
      : (opts
        ? `<span data-lc-payrow style="display:inline-flex;gap:6px;align-items:center">`
          + `<select data-lc-payfolder class="r-routesel" style="max-width:190px"><option value="">where it files\u2026</option>${opts}</select>`
          + `<button class="r-btn small" data-lc-paidto="${LIFE.esc(String(l.moveId))}">Paid \u2014 file it</button></span>`
        : `<span style="${muted}">no folders known \u2014 file by hand</span>`);
    // THE PAYMENT HINT (operator ask 2026-08-21): the bank already shows this exact amount
    // leaving under this supplier's name — say so, in his own shape ("£150 paid on 21/08/2026"),
    // and keep it a SUGGESTION: the Paid tap stays the confirmation. Green like a citation, not
    // like a verdict.
    const ddmm = (d) => `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}`;
    const hint = l.paid && typeof l.paid.amountPence === 'number'
      ? `<div style="font-size:11.5px;color:#9BC17E;padding:0 0 2px 12px">${gbp(l.paid.amountPence)} paid on ${ddmm(l.paid.txnDate)} (${LIFE.esc(String(l.paid.account || 'bank'))}, QuickBooks) \u2014 match${l.ref ? `es invoice ${LIFE.esc(String(l.ref))}` : ''}; confirm with Paid</div>`
      : '';
    return `<div class="lc-row" style="align-items:center;justify-content:space-between;gap:8px;padding:3px 0 3px 12px">`
      + `<div style="font-size:12.5px;display:flex;gap:10px;align-items:baseline">${what} ${price} ${age}</div><div>${act}</div></div>${hint}`;
  };

  const gkey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const body = groups.map((g, i) => {
    const sub = sumOf(g.rows);
    const home = [...new Set(g.rows.map((r) => r.onwardPath).filter(Boolean))];
    // A statement paid as one transfer: the whole group's total left the bank under this name.
    const gp = (groupPaid || []).find((x) => gkey(x.supplier) === gkey(g.supplier));
    const gHint = gp && typeof gp.amountPence === 'number'
      ? `<div style="font-size:11.5px;color:#9BC17E;padding:0 0 2px 12px">${gbp(gp.amountPence)} paid on ${String(gp.txnDate).slice(8, 10)}/${String(gp.txnDate).slice(5, 7)}/${String(gp.txnDate).slice(0, 4)} (${LIFE.esc(String(gp.account || 'bank'))}, QuickBooks) \u2014 matches this group's total; confirm each with Paid</div>`
      : '';
    return `<div style="border-top:1px solid rgba(255,255,255,.08);padding:6px 0">`
      + `<div class="lc-row" style="justify-content:space-between;align-items:baseline">`
      + `<div style="font-size:13px"><b>${i + 1}) ${LIFE.esc(g.supplier)}</b>`
      + (home.length === 1 ? ` <span style="${muted}">\u2192 ${LIFE.esc(home[0])}</span>` : '') + `</div>`
      + `<div style="font-size:12.5px">${sub !== null ? `<b>${gbp(sub)}</b>` : `<span style="${muted}">${g.rows.length === 1 ? 'amount' : 'amounts'} not read</span>`}</div></div>`
      + gHint + g.rows.map(rowHtml).join('') + `</div>`;
  }).join('');

  // THE TOTAL KEEPS ITS GATE. "TOTAL INVOICES TO PAY" only when every invoice is read — a payment
  // total standing over unread debt is the one number that could make him pay the wrong amount.
  const priced = lines.filter((l) => typeof l.totalPence === 'number' && l.totalPence > 0);
  const unread = lines.length - priced.length;
  const sum = priced.reduce((a, l) => a + l.totalPence, 0);
  const total = unread === 0
    ? `<div style="font-size:13.5px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)"><b>TOTAL INVOICES TO PAY = ${gbp(sum)}</b></div>`
    : priced.length === 0
      ? `<div style="${muted};padding-top:8px;border-top:1px solid rgba(255,255,255,.12)">No total: none of these ${lines.length} amounts has been read off its document.</div>`
      : `<div style="font-size:13px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)"><b>TOTAL OF THE ${priced.length} READ = ${gbp(sum)}</b>`
        + `<div style="${muted}">${unread} still unread \u2014 not the payment total until ${unread === 1 ? 'it is' : 'they are'} read.</div></div>`;

  return `<div style="margin:2px 0 12px">`
    + `<div class="lc-row" style="justify-content:space-between;align-items:baseline;margin-bottom:2px">`
    + `<div style="font-size:11px;letter-spacing:.06em;color:#9aa3ad">PAY QUEUE \u00b7 ${lines.length} INVOICE${lines.length === 1 ? '' : 'S'}</div>`
    + `<div style="${muted}">tap Paid when one is paid \u2014 it files to its supplier folder and leaves this list</div></div>`
    + body + total + `</div>`;
}

// THE SITUATION BRIEF (operator ask 2026-08-21: "the AI should give a summary of what the
// situation is, what has been done via the updates, and what the next proposed steps are").
//
// Rendered VISIBLY as the machine's read, never as the owner's own words — it sits in its own
// panel, labelled, dated and model-stamped, so it can never be mistaken for something he wrote or
// something an agent formally reported. The markdown it emits is a fixed, tiny subset (bold
// labels, "- " bullets, "1." steps): rendered by hand rather than by a parser, because a general
// markdown renderer here would be a script-injection surface for text a model produced.
// How long ago, in words. A brief is only trustworthy if you can see WHEN it was read.
function agoWords(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// The newest thing the brief is SUPPOSED to have read. Mirrors briefInputs on the engine side:
// record-only notes are excluded there, so they must not count as "not in this yet" here — that
// would show a pending line that never clears.
function newestBriefInput(s) {
  const stamps = [];
  for (const u of (s.updates || [])) if (Number(u.record_only) !== 1 && u.created_at) stamps.push(String(u.created_at));
  for (const f of (s.files || [])) if (f.created_at) stamps.push(String(f.created_at));
  return stamps.sort().pop() || '';
}

function briefPanel(b, s) {
  if (!b || !String(b.brief_md || '').trim()) return '';
  const md = String(b.brief_md);
  const esc = (x) => LIFE.esc(x);
  const inline = (line) => esc(line).replace(/\*\*(.+?)\*\*/g, '<b style="color:#e9eef4">$1</b>');
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.tag} style="margin:2px 0 6px;padding-left:18px">${list.items.join('')}</${list.tag}>`); list = null; } };
  for (const raw of md.split(/\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const b1 = /^-\s+(.*)$/.exec(line);
    const n1 = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (b1) {
      if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; }
      list.items.push(`<li style="margin:1px 0">${inline(b1[1])}</li>`);
    } else if (n1) {
      if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; }
      list.items.push(`<li style="margin:1px 0">${inline(n1[2])}</li>`);
    } else {
      flush();
      out.push(`<div style="margin:0 0 6px">${inline(line)}</div>`);
    }
  }
  flush();
  // THE STAMP (operator ask 2026-08-26: "i updated the task and the summary isn't updated").
  // It had — on the next sweep, seventeen minutes later. The panel printed generated_at sliced
  // to ten characters, so a brief written before his note and one written after it BOTH read
  // "2026-08-26": the one number that would have answered the question was the one cut off.
  const when = agoWords(b.generated_at);
  const newest = newestBriefInput(s || {});
  const nMs = Date.parse(newest); const gMs = Date.parse(String(b.generated_at || ''));
  const behind = Number.isFinite(nMs) && Number.isFinite(gMs) && nMs > gMs;
  const pending = behind
    ? `<div style="font-size:11.5px;color:#E8B84B;margin-top:8px;padding-top:8px;border-top:1px solid rgba(232,184,75,.25)">`
      + `Your note from ${esc(agoWords(newest))} isn't in this read yet \u2014 it refreshes within a minute or two.</div>`
    : '';
  return `<div class="r-card" style="background:rgba(127,209,220,.05);border:1px solid rgba(127,209,220,.22);border-radius:10px;padding:12px 14px;margin-bottom:12px">`
    + `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px">`
    + `<div style="font-size:11px;letter-spacing:.06em;color:#7FD1DC">WHERE THIS STANDS</div>`
    + `<div style="font-size:11px;color:#9aa3ad" title="${esc(String(b.generated_at || ''))}">read of your notes \u00b7 ${esc(String(b.model || ''))}${when ? ` \u00b7 ${esc(when)}` : ''}</div></div>`
    + `<div style="font-size:13px;line-height:1.55">${out.join('')}</div>${pending}</div>`;
}

function btnCmd(label, command, payload) {
  const cmd = LIFE.esc(JSON.stringify({ command, payload }));
  return `<button class="r-btn small" data-lc-cmd="${cmd}">${LIFE.esc(label)}</button>`;
}

module.exports = {
  key: 'life-task', route: '/life/task', workspace: 'life', title: 'Task',
  sub: 'One task — its actions, its updates in your words, and every change kept on the record',

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
        // Living projects for the assignment select (triage ruling 2026-08-10) — parked
        // ones included ON PURPOSE: assigning into a park is a valid triage outcome.
        projects: q("SELECT id, title, status FROM life_projects WHERE status NOT IN ('CANCELLED','DONE') ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, title"),
        // Owner→agent context (operator ask 2026-08-13): the task's files, for the rail below.
        files: q("SELECT id, filename, kind, bytes, note, created_at FROM life_task_files WHERE task_id = ? AND state = 'ATTACHED' ORDER BY created_at", [id]),
        // THE SITUATION BRIEF (operator ask 2026-08-21): gpt-5.6-sol's read of where this task
        // actually stands. Absent table or no row degrades to no panel, never an error.
        brief: q('SELECT brief_md, model, generated_at, input_digest FROM life_task_briefs WHERE task_id = ?', [id])[0] || null,
        // The picker's folder list (pay-queue rows with no recorded home): REAL move targets
        // from the mirror, read-only. NOT filtered on `enabled` — that flag means MIRRORED (the
        // queue folder itself is enabled=0), and a folder is a perfectly good destination without
        // being synced. An absent table degrades to no picker, never an error.
        mailFolders: q("SELECT path FROM life_mail_folders WHERE move_target = 1 ORDER BY path"),
        // AGENT PRESENCE (operator ask 2026-08-13): the latest dispatch's job id — the live
        // stage comes from librarian.db in render via ctx.q (cross-domain read by reference).
        lastDispatch: (() => {
          const rows = q(`SELECT task_id, payload_json FROM life_task_events WHERE task_id = ? AND event_type = 'AGENT_DISPATCHED' ORDER BY created_at ASC`, [id]);
          const m = LIFE.latestDispatchByTask(rows);
          return m.get(id) || null;
        })(),
      };
    } finally { o.db.close(); }
  },

  render(section, ctx) {
    const s = section || {};
    if (s.err) return { stamp: '', body: wrap(LIFE.emptyCard('Task', 'Not found', s.err, '<a class="r-btn" href="/life/tasks">All tasks</a>')) };
    if (!s.engine || !s.engine.ok) return { stamp: '', body: wrap(LIFE.absentCard('This task')) };
    const t = s.task;
    const id = String(t.id);
    // LIVE JOB STAGE (agent presence): the dispatched job's real state-machine position,
    // read at render time from the business store by id. Stale id / absent table → no chip.
    const liveJob = s.lastDispatch
      ? (LIFE.jobStates((ctx && ctx.q) || null, [s.lastDispatch.jobId]).get(s.lastDispatch.jobId) || null)
      : null;
    // A handoff's specialist job is the one actually working — follow it for the stage.
    let handoffJob = null;
    if (liveJob && liveJob.result) {
      try {
        const jr = JSON.parse(String(liveJob.result));
        if (jr && typeof jr.handoffJob === 'string' && jr.handoffJob) {
          handoffJob = LIFE.jobStates((ctx && ctx.q) || null, [jr.handoffJob]).get(jr.handoffJob) || null;
        }
      } catch (_) { /* result is the job's own record — unreadable means no follow */ }
    }

    // header + actions
    const acts = (ACTIONS[t.status] || []).map(([label, cmd, to]) => btnCmd(label, cmd, to === null ? { taskId: id } : { taskId: id, to })).join(' ');
    const specials = [
      // Rename lives on every LIVING task (WAITING included) — finished work keeps its
      // name, so DONE/CANCELLED never offer it (the writer refuses anyway; no dead buttons).
      !['DONE', 'CANCELLED'].includes(String(t.status))
        ? `<button class="r-btn small" data-lc-rename="${LIFE.esc(JSON.stringify({ kind: 'task', id, title: t.title }))}">Rename…</button>`
          // DUE DATE (2026-08-11): until now nothing could set one outside the bulk importer,
          // so the due-soon safety net on Today could only catch imported work. Finished work
          // keeps the deadline it had, so this sits with Rename on living tasks only.
          + `<button class="r-btn small" data-lc-due="${LIFE.esc(JSON.stringify({ id, dueAt: String(t.due_at || '').slice(0, 10), dueKind: String(t.due_kind || 'NONE') }))}">Due date…</button>` : '',
      ['INBOX', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL', 'BATCH'].includes(String(t.status))
        ? `<button class="r-btn small" data-lc-complete="${LIFE.esc(id)}"${t.recurs ? ` data-lc-recap="${LIFE.esc(JSON.stringify({ cadence: t.recurs, due: String(t.due_at || '').slice(0, 10) }))}"` : ''}>Mark done…</button>`
          // Repeats setter (operator ask 2026-08-18): set daily/weekly/monthly/yearly or
          // "every N days/weeks/months/years"; blank stops the repeat. Living tasks only —
          // the writer refuses flagging a finished record.
          + `<button class="r-btn small" data-lc-setrecur="${LIFE.esc(JSON.stringify({ taskId: id, cadence: t.recurs || '' }))}">Repeats…</button>`
          + `<button class="r-btn small" data-lc-wait="${LIFE.esc(id)}">Park waiting…</button>`
          + `<button class="lc-cxl" data-lc-cancel="${LIFE.esc(id)}">✕ cancel</button>`
        : '',
      String(t.status) === 'WAITING' ? btnCmd('Wake now', 'wake', { taskId: id }) : '',
      ['DONE', 'CANCELLED'].includes(String(t.status)) ? btnCmd('Reopen', 'reopen', { taskId: id }) : '',
      btnCmd('Undo last move', 'undo', { taskId: id }),
    ].join(' ');
    const wait = s.waiting.find((w) => w.state === 'ACTIVE');
    // Contextual confidence (A3): the strongest open proposal's real confidence, in the header.
    const topConf = s.proposals.filter((p) => p.state === 'PROPOSED').sort((a, b) => Number(b.confidence) - Number(a.confidence))[0];
    // Execution route (A3): who does this — a set_route control, SELF the honest default.
    const mode = String(t.execution_mode || 'SELF').toUpperCase();
    const opt = (v, label) => `<option value="${v}"${mode === v ? ' selected' : ''}>${label}</option>`;
    const routeControl = `<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--rmuted)">Route
      <select class="r-routesel lc-route-sel" data-task="${LIFE.esc(id)}">
        ${opt('SELF', 'You do it')}${opt('AI', 'AI drafts / does')}${opt('DELEGATE', 'Delegate')}${opt('HYBRID', 'Hybrid')}
      </select></label>`;
    // The Inbox's decision verb (triage ruling 2026-08-10): assign a project home right
    // here. Parked projects are labelled — assigning into one is choosing "not this
    // quarter's fight" for the task too.
    const pjOpt = (pj) => `<option value="${LIFE.esc(pj.id)}"${t.project_id === pj.id ? ' selected' : ''}>${LIFE.esc(pj.title)}${pj.status === 'ACTIVE' ? '' : ` (${LIFE.esc(String(pj.status).toLowerCase())})`}</option>`;
    const projectControl = ['DONE', 'CANCELLED'].includes(String(t.status)) ? '' : `<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--rmuted)">Project
      <select class="r-routesel lc-assign-sel" data-task="${LIFE.esc(id)}">
        <option value=""${t.project_id ? '' : ' selected'}>— none —</option>
        ${(s.projects || []).map(pjOpt).join('')}
      </select></label>`;
    const focusBtn = ['READY', 'SCHEDULED', 'IN_PROGRESS'].includes(String(t.status))
      ? `<button class="r-btn small primary" data-lc-focus="${LIFE.esc(JSON.stringify({ taskId: id, title: t.title, dod: (t.definition_of_done && String(t.definition_of_done).trim()) || '' }))}">▶ Focus</button>` : '';
    const head = `<div class="r-card r-panel"><h3 style="margin-bottom:6px">${LIFE.esc(t.title)}</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 10px">
        ${S.rcc.tag(String(t.status).toLowerCase().replace('_', ' '))}${S.rcc.route(mode)}${S.rcc.tag(t.domain_key)}${S.rcc.tag(t.visibility === 'OWNER_ONLY' ? 'private' : String(t.visibility).toLowerCase())}${t.recurs ? S.rcc.tag(`repeats · ${String(t.recurs).toLowerCase()}`, 'warn') : ''}
        ${t.project_id ? `<a href="/life/project?id=${encodeURIComponent(String(t.project_id))}" style="text-decoration:none">${S.rcc.tag('project: ' + (((s.projects || []).find((pj) => pj.id === t.project_id) || {}).title || 'unknown'), 'info')}</a>` : ''}
        ${topConf ? S.rcc.conf(topConf.confidence) : ''}
        ${t.due_at && t.due_kind !== 'NONE' ? S.rcc.tag(`${LIFE.duePhrase(t.due_at)}${t.due_kind === 'HARD' ? ' · hard' : ''}`) : ''}
      </div>
      ${wait ? `<div style="font-size:12.5px;color:#f5c96b;margin-bottom:8px">Waiting on <b>${LIFE.esc(wait.dependency_label)}</b>${wait.fallback_at ? ` · follow-up ${LIFE.esc(String(wait.fallback_at).slice(0, 10))}` : ''}</div>` : ''}
      ${/* pre-wrap, or the writer's structure dies here (operator, 2026-08-21): the pay-run task is
            WRITTEN grouped by supplier with one block each and a total line, and this div collapsed
            every newline into a space — eighteen invoices as one solid paragraph. The updates thread
            below has carried pre-wrap since it was built; the description was the one render site
            without it. */''}
      ${briefPanel(s.brief, s)}
      ${(() => {
        // When the interactive pay-queue renders, it IS the list — showing the same 18 invoices
        // twice (a wall of text, then the buttons below it) had the owner reading the inert copy.
        // The written run stays one tap away: it is the contract of what completing files.
        const booker = bookerRunBlock(s.events);
        const run = booker || invoiceRunBlock(s.events, s.mailFolders);
        const desc = t.description ? `<div style="font-size:13px;margin-bottom:10px;white-space:pre-wrap">${LIFE.esc(t.description)}</div>` : '';
        return run
          ? `${run}${desc ? `<details style="margin-bottom:10px"><summary style="font-size:11.5px;color:#9aa3ad;cursor:pointer">The run as written \u2014 the exact list completing this task files</summary>${desc}</details>` : ''}`
          : desc;
      })()}
      <div class="lc-row" style="align-items:center">${focusBtn} ${acts} ${specials} ${routeControl} ${projectControl}</div></div>`;

    // ── THE AGENT RAIL (operator ask 2026-08-13): talk to the agent, hand it files ──
    // Dispatch state derives from the audited events; everything the owner writes or
    // uploads below rides the NEXT dispatch brief (record-only notes excluded, said so).
    const agentEvents = (s.events || []).filter((e) => ['AGENT_DISPATCHED', 'DISPATCH_REFUSED', 'REOPENED'].includes(String(e.event_type)));
    const lastAgentEv = agentEvents[0] || null; // events arrive newest-first
    const everDispatched = agentEvents.some((e) => e.event_type === 'AGENT_DISPATCHED');
    const isAgentRoute = mode === 'AI' || mode === 'HYBRID';
    let agentPanel = '';
    if (isAgentRoute || everDispatched) {
      let stateLine;
      if (!everDispatched && lastAgentEv && lastAgentEv.event_type === 'DISPATCH_REFUSED') {
        let pl = {}; try { pl = JSON.parse(String(lastAgentEv.payload_json || '{}')); } catch (_) { /* renders generic */ }
        stateLine = `The dispatcher looked and refused: ${LIFE.esc(String(pl.reason || 'no confident shape'))}`;
      } else if (!everDispatched) {
        stateLine = mode === 'AI'
          ? 'Routed to AI — the sweep (09:20 / 15:20 London) picks it up with everything on this page.'
          : 'Route it AI and the sweep picks it up with everything on this page.';
      } else if (lastAgentEv && lastAgentEv.event_type === 'REOPENED') {
        // A send-back only means anything on AI-routed work — the sweep's pool IS
        // execution_mode='AI'. Saying "it goes out again" on a HYBRID task was a promise
        // nothing could keep (live 2026-08-13: the tag dictionary sat silent for hours).
        stateLine = mode === 'AI'
          ? 'Sent back — it goes out again on the next sweep with your notes and files.'
          : `Sent back — but this task is routed ${LIFE.esc(mode)}, and the sweep only picks up AI-routed work. `
            + `Set the route to AI (above) and it goes on the next sweep; leave it and this stays yours to do.`;
      } else if (liveJob) {
        // AGENT PRESENCE: the agent by NAME and the job's real state-machine position — a
        // stage strip, never a fabricated %. A handoff shows the specialist actually working.
        const who = handoffJob
          ? `${LIFE.esc(LIFE.AGENT_NAME[s.lastDispatch.jobKind] || s.lastDispatch.jobKind)} → <b>${LIFE.esc(LIFE.AGENT_NAME[String(handoffJob.type)] || String(handoffJob.type))}</b>`
          : `<b>${LIFE.esc(LIFE.AGENT_NAME[s.lastDispatch.jobKind] || s.lastDispatch.jobKind)}</b>`;
        const stageJob = handoffJob || liveJob;
        const planGate = String(stageJob.status) === 'awaiting_plan_feedback'
          ? `<div style="font-size:12.5px;color:#ef6b68;font-weight:600;margin-top:4px">⛔ The Lead’s plan awaits YOUR approval — the gate taps on Telegram; nothing builds until you answer.</div>`
          : '';
        stateLine = `${who} is on this — ${LIFE.stageStrip(String(stageJob.status))}`
          + ` <a class="r-btn small" href="/claw/engine" style="margin-left:8px">See the board</a>${planGate}`;
      } else {
        let pl = {}; try { pl = JSON.parse(String((lastAgentEv || {}).payload_json || '{}')); } catch (_) { /* renders generic */ }
        stateLine = `An agent has been sent (job ${LIFE.esc(String(pl.jobId || '').slice(0, 8))}, ${LIFE.esc(String(pl.jobKind || 'agent'))}) — its answer lands below as an update, and the accept stays yours on Today.`;
      }
      const sendBack = everDispatched && !(lastAgentEv && lastAgentEv.event_type === 'REOPENED')
        ? `<div style="margin-top:8px">${btnCmd('Send back to the agent', 'renew_dispatch', { taskId: id })}
           <span style="font-size:12px;color:${mode === 'AI' ? 'var(--rmuted)' : '#f5c96b'};margin-left:6px">${mode === 'AI'
             ? 'goes again on the next sweep, carrying every note and file below'
             : `the writer will refuse this while the route is ${LIFE.esc(mode)} — the sweep only takes AI-routed work`}</span></div>`
        : '';
      const kb = (b) => `${Math.max(1, Math.round(Number(b) / 1024))} KB`;
      const fileRow = (f) => `<div class="r-lrow"><div style="min-width:0"><div style="font-weight:600">${LIFE.esc(f.filename)} <span style="font-weight:400;font-size:11.5px;color:var(--rmuted)">${LIFE.esc(String(f.kind).toLowerCase())} · ${kb(f.bytes)}</span></div>
        ${f.note ? `<div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(f.note)}</div>` : ''}</div>
        <div style="display:flex;gap:6px;flex-shrink:0"><a class="r-btn small" href="/api/life/task-file?id=${encodeURIComponent(f.id)}">Download</a>${btnCmd('Remove', 'remove_task_file', { taskId: id, fileId: f.id })}</div></div>`;
      const files = (s.files || []);
      agentPanel = `<div class="r-card r-panel"><h3>Working with the agent</h3>
        <div style="font-size:13px;line-height:1.55;margin:4px 0 2px">${stateLine}</div>
        ${sendBack}
        <div style="font-size:12.5px;color:var(--rmuted);margin:10px 0 4px"><b>Talk to it</b> in the update box below — every non-record-only note on this task rides the agent's brief, yours and its own replies, as a conversation.</div>
        <div style="font-size:12.5px;color:var(--rmuted);margin:8px 0 4px"><b>Hand it files</b> — partial work, exports, anything that helps. csv / txt / md / json content is read straight into the brief; xlsx, docx, pdf and images travel as named attachments it knows exist. 15 MB max.</div>
        ${files.length ? files.map(fileRow).join('') : ''}
        <div class="lc-taskfile-box" data-task="${LIFE.esc(id)}" style="margin-top:8px">
          <div class="lc-row" style="align-items:center;gap:8px;flex-wrap:wrap">
            <input type="file" class="lc-input" data-lc-taskfile="${LIFE.esc(id)}" accept=".csv,.tsv,.txt,.md,.json,.xlsx,.docx,.pdf,.png,.jpg,.jpeg" style="max-width:300px">
            <input class="lc-input" data-lc-taskfile-note maxlength="500" placeholder="What is this file? (optional — the agent reads this note)" style="flex:1;min-width:200px">
          </div>
          <div class="lc-taskfile-out r-note" style="min-height:16px"></div>
        </div></div>`;
    }

    // add update (A6): record-only honoured — context the AI must never act on
    const noteForm = `<div class="r-card r-panel"><h3>Add update</h3>
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
        ? `<button class="r-btn small" data-lc-edit="${LIFE.esc(JSON.stringify({ proposalId: p.id, dependencyLabel: cmd.dependencyLabel, wakeType: cmd.wakeType, fallbackAt: cmd.fallbackAt }))}">Edit…</button>` : '';
      // Calendar blocks (Stage W): accept rides the block's OWN verb — the writer places/
      // removes the real Outlook event; a generic decide-accept is refused engine-side.
      const isCalBlock = p.capability_key === 'calendar_block';
      const accept = isCalBlock
        ? btnCmd(p.command_type === 'place_block' ? 'Place block' : 'Remove block', p.command_type, { proposalId: p.id })
        : btnCmd('Accept', 'decide', { proposalId: p.id, decision: 'accept' });
      return `<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:10px;margin:8px 0">
        <div style="font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${LIFE.esc(String(p.capability_key).replace(/_/g, ' '))}</b> suggests <b>${LIFE.esc(p.command_type === 'set_waiting' ? 'parking this waiting' : p.command_type)}</b> ${S.rcc.conf(p.confidence)}</div>
        <div style="font-size:12px;color:var(--muted,#8aa);margin:4px 0">${LIFE.esc(p.reason)}</div>
        <div style="font-size:12px;font-family:monospace;margin:4px 0">${LIFE.esc(JSON.stringify(cmd))}</div>
        <div class="lc-row">
          ${accept}
          ${editable}
          ${btnCmd('Reject', 'decide', { proposalId: p.id, decision: 'reject' })}
        </div></div>`;
    };
    const decidedRow = (p) => `<tr><td>${LIFE.esc(p.capability_key)}</td><td>${LIFE.esc(p.command_type)}</td><td>${LIFE.esc(p.state)}</td><td>${LIFE.esc(p.decided_by || '')}${p.decision_note ? ` — ${LIFE.esc(p.decision_note)}` : ''}</td></tr>`;
    const proposals = `<div class="r-card r-panel"><h3>Proposals${open.length ? ` — ${open.length} need you` : ''}</h3>
      ${open.length ? open.map(propCard).join('') : '<div style="font-size:13px;color:var(--muted,#8aa);padding:6px 0">Nothing proposed and undecided.</div>'}
      ${decided.length ? `<table class="data" style="width:100%"><thead><tr><th>Capability</th><th>Proposed</th><th>Decision</th><th>By</th></tr></thead><tbody>${decided.map(decidedRow).join('')}</tbody></table>` : ''}
    </div>`;

    // facts + timeline: human statements and machine interpretation SEPARATE, always
    const factRows = s.facts.map((f) => `<tr><td>${LIFE.esc(f.fact_type)}</td><td>${LIFE.esc(String(f.value_json))}${f.unit ? ` ${LIFE.esc(f.unit)}` : ''}</td><td>${Number(f.confidence).toFixed(2)}</td></tr>`).join('');
    const facts = s.facts.length ? `<div class="r-card r-panel"><h3>Extracted facts (machine interpretation — the note below stays authoritative)</h3><table class="data" style="width:100%"><thead><tr><th>Fact</th><th>Value</th><th>Confidence</th></tr></thead><tbody>${factRows}</tbody></table></div>` : '';
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
    // Handoff detail (A3 placement ruling 2026-08-05: in the drawer, not a Today footer). Each
    // row records who held the task and what they did — the actor column IS the handoff record.
    const timeline = `<div class="r-card r-panel"><h3>Updates (your words, byte-preserved)</h3>${updates || '<div style="font-size:13px;color:var(--muted,#8aa)">No updates yet.</div>'}</div>
      <div class="r-card r-panel"><h3>Handoffs &amp; history</h3>
        <div style="font-size:12px;color:var(--rmuted);margin:2px 0 8px">Every change on this task, and who held it — you, a service, or (later) an agent. Nothing acts here without leaving a line.</div>
        <table class="data" style="width:100%"><thead><tr><th>When</th><th>What happened</th><th>Change</th><th>Handled by</th></tr></thead><tbody>${evRows}</tbody></table></div>`;

    return { stamp: '', body: wrap(head + agentPanel + noteForm + proposals + facts + timeline) };
  },
};
