'use strict';
// WHAT THE FLEET KNOWS — the memory surface (operator ask 2026-08-13).
//
// WHY THE PAGE EXISTS. An audit of the report library found that half of it was rediscovery: four
// separate runs each concluded that loyalty KPIs are unmeasurable without a member identifier,
// three re-diagnosed one covers_day outage, three more the reviews outage. The engine now banks
// findings into fleet_memory and injects them into the specialists' prompts — but a memory nobody
// can READ is a memory nobody can correct. This page is where the operator sees what his agents
// are being told, and spots the line that has stopped being true.
//
// SCOPE SPLIT, deliberately. This page shows ORG-WIDE and DEPARTMENT memory. PROJECT-scoped rows
// are counted here but their content lives on the Life OS project page — because naming a project
// means reading life.db, and /claw never touches it (the boundary test is the design speaking).
// So this page shows the shape of project memory and points at where to read it.
//
// READ-ONLY like every /claw page: SELECT via ctx.q, no action affordance of any kind.
const S = require('../../shared.js');

function rows(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Kind → how it reads and how loud it is. A BLOCKER is the most valuable thing in here: it is the
// thing an agent would otherwise spend a whole run rediscovering.
const KINDS = {
  blocker: { label: 'Blocked', mark: '⛔', tone: 'var(--red)', blurb: 'established as not possible yet — the wall the next run would hit' },
  fail: { label: 'Failed', mark: '✕', tone: 'var(--amber)', blurb: 'tried and did not work' },
  win: { label: 'Worked', mark: '✓', tone: 'var(--green)', blurb: 'tried and worked — repeat it' },
  finding: { label: 'Known', mark: '·', tone: 'var(--blue)', blurb: 'settled fact' },
};
const KIND_ORDER = ['blocker', 'fail', 'win', 'finding'];

module.exports = {
  key: 'memory',
  route: '/claw/memory', workspace: 'claw',
  title: 'What the fleet knows',
  sub: 'Findings the agents carry into every job — org-wide and by department · read-only',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = Number.isFinite(Number(ctx && ctx.now)) ? Number(ctx.now) : Date.now();
    if (typeof q !== 'function') return { available: false, now };

    const res = q(
      `SELECT id, scope, kind, headline, detail, department, project_id, task_id,
              source_job_id, source_artifact_id, source_path, created_at, superseded_by
         FROM fleet_memory ORDER BY created_at DESC`,
    );
    // A missing table is the honest pre-deploy state, not an error: the engine creates it.
    if (!res || !res.ok) return { available: false, now };

    const all = rows(res);
    const live = all.filter((r) => r.superseded_by == null);
    const retired = all.length - live.length;

    const counts = { blocker: 0, fail: 0, win: 0, finding: 0 };
    for (const r of live) if (counts[r.kind] !== undefined) counts[r.kind]++;

    // Department groups, in the roster's own order so this page and the engine room agree.
    const byDept = [];
    for (const d of Object.values(S.DEPARTMENTS)) {
      const mine = live.filter((r) => r.scope === 'department' && String(r.department || '').toLowerCase() === d.key);
      if (mine.length) byDept.push({ key: d.key, label: d.label, colour: d.colour, items: sortByKind(mine) });
    }
    // A department name the roster does not know (older rows carry the report's own free-text
    // department, e.g. "Accounting"). Shown under its own heading rather than silently dropped —
    // a memory that exists but is not displayed is exactly the failure this page is fixing.
    const knownKeys = new Set(Object.keys(S.DEPARTMENTS));
    const unmapped = live.filter((r) => r.scope === 'department'
      && !knownKeys.has(String(r.department || '').toLowerCase()));
    const unmappedNames = [...new Set(unmapped.map((r) => String(r.department || 'unnamed')))].sort();

    const orgWide = sortByKind(live.filter((r) => r.scope === 'overall'));
    const projectRows = live.filter((r) => r.scope === 'project');
    const projectIds = new Set(projectRows.map((r) => String(r.project_id || r.task_id || '')).filter(Boolean));

    return {
      available: true, now,
      totals: { live: live.length, retired, counts },
      orgWide,
      byDept,
      unmapped: unmapped.length ? { names: unmappedNames, items: sortByKind(unmapped) } : null,
      project: { rows: projectRows.length, projects: projectIds.size },
    };

    function sortByKind(list) {
      return list.slice().sort((a, b) => {
        const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
        return k !== 0 ? k : num(b.created_at) - num(a.created_at);
      });
    }
  },

  render(section, ctx) {
    const esc = S.escapeHtml;
    const m = section || {};
    const now = m.now || Date.now();
    const stamp = 'live · <b>polling the Librarian</b>';

    if (!m.available) {
      return {
        stamp,
        body: '<div class="r-card r-panel"><div class="r-panel-head"><div>'
          + '<h3 class="r-panel-title">Nothing remembered yet</h3>'
          + '<div class="r-panel-sub">The memory table appears the first time the engine banks a finding.</div>'
          + '</div></div><div style="font-size:13.5px;color:var(--muted);padding:4px 0">'
          + 'Findings land here automatically as reports and briefings complete. Until then the agents are '
          + 'told nothing, which is honest — an empty memory is better than a confident wrong one.</div></div>',
      };
    }

    const t = m.totals;
    const tiles = '<div class="tiles" style="grid-template-columns:repeat(4,minmax(150px,1fr))">'
      + tile(t.counts.blocker > 0 ? 'red' : 'muted', 'Blocked', t.counts.blocker, 'walls the next run would hit')
      + tile('green', 'Worked', t.counts.win, 'proven — repeat it')
      + tile(t.counts.fail > 0 ? 'amber' : 'muted', 'Failed', t.counts.fail, 'tried, did not work')
      + tile('blue', 'Settled facts', t.counts.finding, `${S.fmtInt(t.live)} live${t.retired ? ` · ${S.fmtInt(t.retired)} retired` : ''}`)
      + '</div>';

    function tile(tone, label, value, sub) {
      return `<div class="tile ${tone}"><div class="lab">${esc(label)}</div>`
        + `<div class="val">${esc(S.fmtInt(value))}</div><div class="sub">${esc(sub)}</div></div>`;
    }

    function itemHtml(r) {
      const k = KINDS[r.kind] || KINDS.finding;
      const src = r.source_path
        ? `<span class="mem-src">${esc(r.source_path)}</span>`
        : (r.source_job_id ? `<span class="mem-src">job ${esc(String(r.source_job_id).slice(0, 8))}</span>` : '');
      const detail = r.detail ? `<div class="mem-detail">${esc(trunc(String(r.detail), 220))}</div>` : '';
      return '<div class="mem-row">'
        + `<span class="mem-mark" style="color:${k.tone}" title="${esc(k.blurb)}">${k.mark}</span>`
        + '<div class="mem-body">'
        + `<div class="mem-head">${esc(r.headline)}</div>`
        + detail
        + `<div class="mem-foot">${esc(k.label)} · ${esc(S.agoLabel(now - num(r.created_at)))}${src ? ' · ' : ''}${src}</div>`
        + '</div></div>';
    }
    function trunc(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

    function group(title, colour, items, note) {
      return `<div class="dept-panel" style="border-top-color:${colour};background:${colour}0A;margin-bottom:10px">`
        + `<div class="dept-panel-head" style="color:${colour}">${esc(title)}`
        + `<span class="dept-panel-n">${items.length}</span></div>`
        + (note ? `<div class="mem-note">${esc(note)}</div>` : '')
        + items.map(itemHtml).join('')
        + '</div>';
    }

    const orgBlock = m.orgWide.length
      ? group('Org-wide', '#94A3B8', m.orgWide)
      : '<div class="mem-note" style="margin-bottom:10px">Nothing recorded org-wide yet — every finding so far belongs to a department or a project.</div>';

    const deptBlocks = m.byDept.map((d) => group(d.label, d.colour, d.items)).join('');
    const unmappedBlock = m.unmapped
      ? group(`Unfiled — ${m.unmapped.names.join(' · ')}`, '#94A3B8', m.unmapped.items,
        'These carry a department name the fleet roster does not use. Shown here rather than dropped; they still reach the agents.')
      : '';

    const projectNote = m.project.rows
      ? `<div class="mem-note" style="margin-top:12px">${S.fmtInt(m.project.rows)} finding${m.project.rows === 1 ? '' : 's'} `
        + `belong${m.project.rows === 1 ? 's' : ''} to ${S.fmtInt(m.project.projects)} project${m.project.projects === 1 ? '' : 's'}. `
        + 'Those read on the project itself, in Life OS — naming a project means reading personal data, which this console deliberately cannot do.</div>'
      : '<div class="mem-note" style="margin-top:12px">No project-scoped findings yet. Work dispatched from a Life OS task banks its findings against that project.</div>';

    const explain = '<div class="mem-note" style="margin:2px 0 12px">'
      + 'Every one of these is put in front of the relevant agent before it starts, with an instruction not to '
      + 'rediscover it — and permission to contradict it, because a fact that stopped being true is itself a finding. '
      + 'They hold findings, never measured numbers: current figures always come from the data at read time.'
      + '</div>';

    return {
      stamp,
      body: tiles + explain
        + '<div class="sec-label" style="margin-top:14px">By department<span class="rule"></span></div>'
        + deptBlocks + unmappedBlock
        + '<div class="sec-label" style="margin-top:14px">Everywhere<span class="rule"></span></div>'
        + orgBlock + projectNote,
    };
  },
};
