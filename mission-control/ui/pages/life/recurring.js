'use strict';
// LIFE OS — RECURRING OBLIGATIONS (operator ask 2026-08-11). The standing-obligation picture
// on ONE page: everything that comes round again, whether a planner task carries it or a
// future timer will.
//
// This is a VIEW. It runs no recurrence engine, computes no next date, and writes nothing —
// the cadence label and the date both already live on the task, and advancing them is the
// recapture-on-complete rule that the writer enforces. Nothing here duplicates that.
//
// THREE HONESTY RULES, each of which cost something to learn:
//
//  1. THE DATE COLUMN IS NOT "DUE". For the three annual filings the stored date is the WAKE
//     date the operator ruled at import, not the statutory deadline — annual accounts surface
//     1 Oct and are due 31 Oct. A column headed "Due" would publish three wrong statutory
//     dates on the owner's own board. It is headed "Surfaces", and the real deadline is
//     rendered beside it, read from where it actually lives: the task's own description.
//
//  2. "LAST COMPLETED" IS BLANK ON EVERY ROW, AND THAT IS THE TRUTH. Completing a recurring
//     obligation creates a NEW task for the next occurrence, so a live row's own completion
//     is always empty. The history is a chain of tasks linked by source_ref, walked here.
//     Until an obligation has been round once inside Life OS there is nothing to show, and
//     an em-dash would read as missing data rather than as a first time through.
//
//  3. THE REGISTER HOLDS 14 AND THE PLANNER CARRIES 13. The fourteenth was already overdue
//     at import, so it landed as a plain urgent task with no cadence flag and no date — real
//     work, invisible to every recurrence query. It is NAMED here rather than quietly
//     excluded, because a register that silently drops the one that went wrong is worse than
//     no register.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');

const OWNER = 'woody';
const SOON_DAYS = 14; // the horizon Rex speaks at — the two surfaces agree by construction

function londonDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const pretty = (day) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' })
  .format(new Date(`${day}T12:00:00Z`));

/** The obligations register on disk. It is the ONE home for the cadences no task carries —
 *  section (b) — so this page reads it rather than keeping a second copy that could drift
 *  from it. Absent file = an honest gate-state, never an invented table. */
function registerPath() {
  return process.env.COYOTE_OBLIGATIONS_MD || path.join(os.homedir(), 'coyote-claw', 'ops', 'recurring-obligations.md');
}

/** Parse the pipe-table rows of one `## <letter>) ...` section. Deliberately dumb: if the
 *  register's shape changes, this returns nothing and the page says so, rather than
 *  half-reading it into a table that looks complete. */
function readRegisterSection(letter) {
  let raw;
  try { raw = fs.readFileSync(registerPath(), 'utf8'); } catch (_) { return null; }
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${letter})`));
  if (start < 0) return null;
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('## ')) break;
    if (!l.startsWith('|')) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length || /^-+$/.test(cells[0].replace(/[^-]/g, '-')) && cells[0].includes('-') && !cells[0].replace(/-/g, '')) continue;
    if (/^(Obligation)$/i.test(cells[0])) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

/** The statutory deadline the task states in its own words, where it differs from the date
 *  the planner wakes on. Read, never computed — the description is where it lives. */
function statedDeadline(description) {
  const m = /\bDue\s+([0-9]{1,2}\s+[A-Za-z]{3,9}(?:\s+[0-9]{4})?)/.exec(String(description || ''));
  return m ? m[1] : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Is a stated deadline ("31 Oct", "5 Apr 2027") the same calendar day as the wake date?
 *  Returns null when the stated text can't be read as a date — in which case it is SHOWN,
 *  because failing to parse it is not evidence that it agrees. */
function sameDay(stated, isoDay) {
  const m = /^([0-9]{1,2})\s+([A-Za-z]{3,9})(?:\s+([0-9]{4}))?$/.exec(String(stated).trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const day = Number(m[1]);
  const year = m[3] ? Number(m[3]) : Number(isoDay.slice(0, 4)); // bare "31 Oct" means the wake year
  return year === Number(isoDay.slice(0, 4)) && month === Number(isoDay.slice(5, 7)) - 1 && day === Number(isoDay.slice(8, 10));
}

module.exports = {
  key: 'life-recurring', route: '/life/recurring', workspace: 'life', title: 'Recurring obligations',
  sub: 'Everything that comes round again — what the planner carries, and what still waits on a machine',

  getSection(_db, ctx) {
    const now = (ctx && ctx.now) || Date.now();
    const o = LIFE.openLifeReadonly();
    const pending = readRegisterSection('b');
    if (!o.ok) return { absent: true, reason: o.reason, now, pending };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : null; };

      // The live register. Each obligation is walked back through its own recapture chain —
      // successor.source_ref = 'recapture:' || predecessor.id — to find when it was last
      // actually completed, and how many times it has come round here before.
      const rows = q(
        `WITH RECURSIVE chain(root_id, id, depth) AS (
           SELECT t.id, t.id, 0 FROM life_tasks t
            WHERE t.owner_id = ? AND t.recurs IS NOT NULL AND t.status NOT IN ('DONE','CANCELLED')
           UNION ALL
           SELECT c.root_id, substr(cur.source_ref, 11), c.depth + 1
             FROM chain c JOIN life_tasks cur ON cur.id = c.id
            WHERE cur.source_type = 'SYSTEM' AND cur.source_ref LIKE 'recapture:%' AND c.depth < 50)
         SELECT t.id, t.title, t.recurs AS cadence, substr(t.due_at, 1, 10) AS next_due,
                t.owner_id, t.description, t.status,
                (SELECT COUNT(*) - 1 FROM chain c WHERE c.root_id = t.id) AS prior,
                (SELECT MAX(p.completed_at) FROM life_tasks p JOIN chain c ON c.id = p.id AND c.root_id = t.id
                  WHERE p.completed_at IS NOT NULL) AS last_completed,
                (SELECT MAX(e.created_at) FROM life_task_events e
                  WHERE e.task_id = t.id AND e.event_type = 'RECURRENCE_SET') AS flagged_at
           FROM life_tasks t
          WHERE t.owner_id = ? AND t.recurs IS NOT NULL AND t.status NOT IN ('DONE','CANCELLED')
          ORDER BY (t.due_at IS NULL), t.due_at ASC`, [OWNER, OWNER]);

      // Obligations DROPPED by an explicit decline — a completion that chose not to capture
      // the next occurrence. They leave the register entirely, so they are counted back in
      // here; a register that loses one silently is not a register.
      const declined = q(
        `SELECT e.created_at, t.title FROM life_task_events e JOIN life_tasks t ON t.id = e.task_id
          WHERE e.owner_id = ? AND e.event_type = 'RECAPTURE_DECLINED' ORDER BY e.created_at DESC LIMIT 20`, [OWNER]);
      // The cap ships with its total, always — a list that stops at 20 and shows "20" is
      // indistinguishable from a list that genuinely holds 20.
      const declinedTotal = q(
        `SELECT COUNT(*) c FROM life_task_events WHERE owner_id = ? AND event_type = 'RECAPTURE_DECLINED'`, [OWNER]);

      return {
        now, today: londonDate(now), rows, declined, pending, registerFound: !!pending,
        declinedTotal: (declinedTotal && declinedTotal.length) ? declinedTotal[0].c : (declined || []).length,
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('Recurring obligations')) };
    if (s.rows === null) {
      return {
        stamp: '',
        body: wrap(LIFE.emptyCard(
          'Recurring obligations', 'Nothing is flagged as recurring yet',
          'Nothing on the board is marked as coming round again. Flag a task with its cadence on its own page and it appears here, sorted by what is next.',
          '<a class="r-btn" href="/life/tasks">Go to your tasks</a>',
        )),
      };
    }

    const rows = s.rows || [];
    const today = s.today;
    const withDays = rows.map((r) => ({ ...r, days: r.next_due ? daysBetween(today, r.next_due) : null }));
    const overdue = withDays.filter((r) => r.days !== null && r.days < 0);
    const soon = withDays.filter((r) => r.days !== null && r.days >= 0 && r.days <= SOON_DAYS);

    const tiles = `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:12px">`
      + S.rcc.kpi({ label: 'In the planner', value: String(rows.length), sub: 'flagged with a cadence' })
      + S.rcc.kpi({ label: 'Overdue', value: String(overdue.length), sub: overdue.length ? 'past their date' : 'nothing has slipped' })
      + S.rcc.kpi({ label: 'Inside 14 days', value: String(soon.length), sub: 'the horizon Rex speaks at' })
      + S.rcc.kpi({ label: 'Pending automation', value: (s.pending && s.pending.length) ? String(s.pending.length) : '—', sub: (s.pending && s.pending.length) ? 'no timer or panel yet' : 'register not read' })
      + `</div>`;

    // ── section 1: the planner's own obligations ────────────────────────────
    const row = (r) => {
      const late = r.days !== null && r.days < 0;
      const near = r.days !== null && r.days >= 0 && r.days <= SOON_DAYS;
      const when = r.days === null ? 'no date set'
        : late ? `${-r.days} day${r.days === -1 ? '' : 's'} overdue`
          : r.days === 0 ? 'today' : r.days === 1 ? 'tomorrow' : `in ${r.days} days`;
      const stated = statedDeadline(r.description);
      // The stated deadline is shown ONLY where it differs from the date the planner wakes
      // on — otherwise it is noise, and repeating a date twice invites the reader to think
      // they are two different facts. Compared as DATES, not as substrings: testing whether
      // the stated day-number appears anywhere in the rendered wake date matched against the
      // year as well, so "surfaces 20 Mar 2027, due 5 Apr 2027" showed nothing at all — the
      // deadline vanished from the page for roughly one pair in five.
      const differs = stated && r.next_due && sameDay(stated, r.next_due) === false;
      const history = r.last_completed
        ? `Last done ${pretty(String(r.last_completed).slice(0, 10))}${r.prior > 1 ? ` · ${r.prior} times here` : ''}`
        : r.flagged_at
          ? `First time through Life OS — flagged ${pretty(String(r.flagged_at).slice(0, 10))}`
          : 'First time through Life OS';
      const colour = late ? '#f2777a' : near ? '#f5c96b' : 'var(--rmuted)';
      return `<div class="r-lrow"${late ? ' style="border-left:3px solid #f2777a;padding-left:9px"' : ''}>`
        + `<div style="min-width:0;flex:1">`
        + `<div style="font-weight:600"><a href="/life/task?id=${LIFE.esc(r.id)}" style="color:inherit">${LIFE.esc(r.title)}</a></div>`
        + `<div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(history)}`
        + (differs ? ` · <span style="color:#f5c96b">stated deadline ${LIFE.esc(stated)}</span>` : '')
        + `</div></div>`
        + `<div style="flex-shrink:0;text-align:right;min-width:180px">`
        + `<div style="font-size:12.5px;font-weight:600;color:${colour}">${LIFE.esc(r.next_due ? pretty(r.next_due) : '—')}</div>`
        + `<div style="font-size:11.5px;color:${colour}">${LIFE.esc(when)}</div></div>`
        + `<div style="flex-shrink:0;width:110px;text-align:right">${S.rcc.tag(String(r.cadence || '—'), 'info')}</div>`
        + `<div style="flex-shrink:0;width:70px;text-align:right;font-size:11.5px;color:var(--rmuted)">${LIFE.esc(r.owner_id)}</div>`
        + `</div>`;
    };

    const header = `<div class="r-lrow" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--rmuted);font-weight:700">`
      + `<div style="flex:1">Obligation · last completed</div>`
      + `<div style="width:180px;text-align:right">Surfaces</div>`
      + `<div style="width:110px;text-align:right">Cadence</div>`
      + `<div style="width:70px;text-align:right">Owner</div></div>`;

    // Overdue first regardless of how far past — then everything else by date.
    const ordered = [...overdue, ...withDays.filter((r) => !overdue.includes(r))];

    const plannerPanel = S.rcc.panel({
      title: 'In the planner', sub: 'Flagged with a cadence, carrying a date, and yours to complete',
      headRight: `<span class="r-pill">${rows.length}</span>`,
      body: header + (ordered.length ? ordered.map(row).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing is flagged as recurring yet.</div>`)
        + `<div class="r-note" style="margin-top:10px;font-size:12px"><b>Surfaces</b> is the date this reaches your board — for the annual filings that is the wake date you set, deliberately earlier than the statutory deadline, which is shown beside it where the two differ. Completing one asks you for the next date; that is what keeps this list true.</div>`,
    });

    // ── the fourteenth ──────────────────────────────────────────────────────
    // Only comparable when the planner is actually carrying the register. With nothing
    // flagged at all, "14 obligations are on the board as ordinary work" would be a
    // fabricated claim about tasks this page has not looked at — the empty state above
    // already tells the true story.
    // The register and the planner are RECONCILED, not subtracted. Comparing two counts
    // narrated a specific cause ("they were already overdue when imported") about rows it
    // had never looked at — and worse, flagging any unrelated task with a cadence made the
    // numbers match and the whole warning disappear while the real unflagged obligation was
    // still missing. Titles are matched instead, loosely, because the register's wording and
    // the task's drift ("+" vs "and", em-dash vs hyphen, parentheticals that moved into the
    // description). A row that cannot be matched is NAMED, and the matching is described so
    // the owner can see how the claim was arrived at.
    const registerA = rows.length ? readRegisterSectionSafe('a') : null;
    const unmatched = registerA
      ? registerA.filter((c) => !rows.some((r) => titlesAgree(c[0], r.title))).map((c) => c[0])
      : [];
    const gapNote = unmatched.length
      ? `<div class="r-card r-panel" style="margin-bottom:12px;border-color:rgba(242,119,122,.45)">`
        + `<div style="font-weight:650;margin-bottom:4px">${unmatched.length === 1 ? 'One obligation on the register isn’t' : `${unmatched.length} obligations on the register aren’t`} in the list below.</div>`
        + `<div style="font-size:12.5px;color:var(--rmuted)">`
        + unmatched.map((t) => `<div style="margin:3px 0">· ${LIFE.esc(t)}</div>`).join('')
        + `<div style="margin-top:6px">${unmatched.length === 1 ? 'It is' : 'They are'} real work either way — ${unmatched.length === 1 ? 'it is' : 'they are'} just not carrying a cadence and a date, so nothing here can tell you when ${unmatched.length === 1 ? 'it is' : 'they are'} next due. Set both on the task and ${unmatched.length === 1 ? 'it joins' : 'they join'} this list. (Matched by title, so a renamed obligation can show up here too.)</div>`
        + `</div></div>`
      : '';

    // ── section 2: pending automation ───────────────────────────────────────
    const pendingRows = s.pending || [];
    const pendingPanel = S.rcc.panel({
      title: 'Pending automation — not tasks',
      sub: 'Real standing cadences whose natural owner is a timer or a panel that does not exist yet',
      headRight: pendingRows.length ? `<span class="r-pill">${pendingRows.length}</span>` : '',
      body: pendingRows.length
        ? `<div class="r-note" style="margin-bottom:8px;font-size:12px">These are <b>not</b> on your task list and nothing here is waiting on you today. Each one is a rhythm the business needs that no machine has been given yet — they sit in public so the gap ages where you can see it, and each becomes a build decision of its own.</div>`
          + `<div class="r-lrow" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--rmuted);font-weight:700"><div style="flex:1">Obligation</div><div style="width:200px;text-align:right">Cadence</div><div style="width:180px;text-align:right">Source</div></div>`
          + pendingRows.map((c) => `<div class="r-lrow"><div style="flex:1;min-width:0;font-size:12.5px">${LIFE.esc(c[0])}</div>`
            + `<div style="width:200px;text-align:right;font-size:12px;color:var(--rmuted)">${LIFE.esc(c[1] || '')}</div>`
            + `<div style="width:180px;text-align:right;font-size:11.5px;color:var(--rmuted)">${LIFE.esc(c[2] || '')}</div></div>`).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">The obligations register couldn’t be read, so this half of the picture isn’t shown rather than guessed at. Nothing is wrong with the list above.</div>`,
    });

    // ── dropped by decline ──────────────────────────────────────────────────
    const dropped = s.declined || [];
    const droppedTotal = s.declinedTotal || dropped.length;
    const droppedPanel = dropped.length ? S.rcc.panel({
      title: 'Dropped on purpose', sub: 'Completed without capturing a next one — off the register until you put it back',
      headRight: `<span class="r-pill">${droppedTotal}</span>`,
      body: dropped.map((d) => `<div class="r-lrow"><div style="flex:1;font-size:12.5px">${LIFE.esc(d.title)}</div>`
        + `<div style="font-size:11.5px;color:var(--rmuted)">${LIFE.esc(pretty(String(d.created_at).slice(0, 10)))}</div></div>`).join('')
        + (droppedTotal > dropped.length
          ? `<div class="r-note" style="margin-top:8px;font-size:12px">Showing the ${dropped.length} most recent of ${droppedTotal}.</div>` : ''),
    }) : '';

    const head = `<div style="margin-bottom:14px">`
      + `<div class="r-eyebrow">EVERYTHING THAT COMES ROUND AGAIN</div>`
      + `<div style="font-size:13.5px;color:var(--rmuted)">One page for the whole standing picture: what the planner is carrying, and what is still waiting on a machine. Nothing here schedules anything — the dates come from the tasks themselves.</div></div>`;

    return { stamp: '', body: wrap(head + tiles + gapNote + plannerPanel + `<div style="height:12px"></div>` + pendingPanel + (droppedPanel ? `<div style="height:12px"></div>${droppedPanel}` : '')) };
  },
};

/** Section (a) of the register, read only to COUNT it against the planner — never to render
 *  dates from it. The task rows above are the single source of every date on this page. */
function readRegisterSectionSafe(letter) {
  try { return readRegisterSection(letter); } catch (_) { return null; }
}

/** Loose title agreement between the register's wording and the task's. The two drift in
 *  ways that are cosmetic but total: "+" for "and", em-dash for hyphen, and a parenthetical
 *  in the register that lives in the task's description instead. So: strip the parenthetical,
 *  normalise the connective, reduce to a word set, and require most of the smaller set to
 *  overlap.
 *
 *  Overlap is measured across ALL words, not just long ones. Counting only words over three
 *  characters left "New gas contract" with the single word "contract" to match on — which
 *  both failed to match its own task AND came within one word of matching "New electricity
 *  contract", the very obligation this card exists to report. Short words are what
 *  distinguishes these titles from each other. */
function titlesAgree(a, b) {
  const words = (t) => new Set(String(t).toLowerCase()
    .replace(/\(.*?\)/g, ' ')     // the register's parenthetical lives in the description
    .replace(/\+/g, ' and ')       // "HSBC + Pleo" is "HSBC and Pleo"
    .split(/[^a-z0-9]+/).filter(Boolean));
  const wa = words(a); const wb = words(b);
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  // Jaccard, so a long title cannot swallow a short one on a couple of common words:
  // "Annual accounts + pay corporation tax" must NOT match "Corporation accounts filing".
  return shared / (wa.size + wb.size - shared) >= 0.6;
}
