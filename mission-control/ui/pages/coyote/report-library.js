'use strict';
// Report Library — the Coyote Report Standard's MC surface (cc spec:
// ops/coyote-report-standard-spec.md). Lists report artifacts newest-first; a
// selected report renders its SELF-CONTAINED branded HTML in an iframe from
// /coyote/report-library/raw?id=N (print from there = the PDF). SELECT-only via
// ctx.q; validation flags (UNCITED etc) are shown LOUD next to the title — a
// flagged report is visible as flagged everywhere it appears.
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }

// Department = the producing specialist's, carried in report frontmatter and stamped onto
// the artifact by the cc pipeline. Legacy rows (pre-column) derive from their tags.
const TAG_DEPT = { finance: 'Finance', marketing: 'Marketing', operations: 'Operations', legal: 'Legal' };
function departmentOf(r) {
  if (r && typeof r.department === 'string' && r.department.trim()) return r.department.trim();
  try {
    for (const t of JSON.parse((r && r.tags_json) || '[]')) {
      const d = TAG_DEPT[String(t).toLowerCase()];
      if (d) return d;
    }
  } catch (e) { /* fall through */ }
  return null;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

module.exports = {
  key: 'report-library', route: '/coyote/report-library', workspace: 'coyote', title: 'Report Library',
  sub: 'Specialist reports · verdict-first, source-cited, gaps explicit — masters live in the vault',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, reports: [], selected: null, departments: [], deptFilter: null, sort: 'newest' };
    // The department column lands via the cc migration; a library deployed ahead of the
    // engine restart must not 500 — probe, then select accordingly.
    const hasDept = rowsOf(q(`SELECT name FROM pragma_table_info('report_artifacts') WHERE name = 'department'`)).length > 0;
    const all = rowsOf(q(
      `SELECT id, job_id, title, tags_json, verdict, problems_json, vault_path, created_at${hasDept ? ', department' : ''}
         FROM report_artifacts ORDER BY created_at DESC, id DESC LIMIT 100`,
    )).map((r) => ({ ...r, department: departmentOf(r) }));
    const departments = [...new Set(all.map((r) => r.department).filter(Boolean))].sort();
    const rawFilter = ctx.query && typeof ctx.query.department === 'string' ? ctx.query.department : null;
    const deptFilter = rawFilter && departments.find((d) => d.toLowerCase() === rawFilter.toLowerCase()) || null;
    const sort = ctx.query && ctx.query.sort === 'department' ? 'department' : 'newest';
    let reports = deptFilter ? all.filter((r) => r.department === deptFilter) : all;
    // Newest-first stays the default; department is the SECONDARY axis (groups A→Z,
    // newest-first within each group).
    if (sort === 'department') {
      reports = [...reports].sort((a, b) =>
        String(a.department || '\uffff').localeCompare(String(b.department || '\uffff'))
        || Number(b.created_at) - Number(a.created_at) || Number(b.id) - Number(a.id));
    }
    const selId = ctx.query && num(ctx.query.id);
    const selected = selId != null ? all.find((r) => num(r.id) === selId) ?? null : null;
    return { now, reports, selected, departments, deptFilter, sort };
  },

  render(section, ctx) {
    const m = section || { reports: [], selected: null };
    const esc = S.escapeHtml;
    const styles = `<style>
      .rl-list{display:flex;flex-direction:column;gap:10px;margin-bottom:18px}
      .rl-item{display:block;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-left:4px solid #C62828;border-radius:8px;padding:12px 16px;text-decoration:none;color:inherit}
      .rl-item:hover{background:rgba(255,255,255,.06)}
      .rl-item.sel{border-color:#C62828;background:rgba(198,40,40,.08)}
      .rl-title{font-weight:600;font-size:15px;margin-bottom:3px}
      .rl-meta{font-size:11px;color:var(--muted,#7a8);font-family:monospace}
      .rl-tag{display:inline-block;border:1px solid #C62828;color:#e57373;border-radius:3px;padding:0 6px;margin-right:5px;font-size:10px;text-transform:uppercase;letter-spacing:.6px}
      .rl-dept{display:inline-block;border:1px solid rgba(255,255,255,.35);color:#e8e8e8;background:rgba(255,255,255,.06);border-radius:3px;padding:0 7px;margin-right:8px;font-size:10px;text-transform:uppercase;letter-spacing:.6px;font-weight:600}
      .rl-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 12px;font-size:12px}
      .rl-bar .lbl{color:var(--muted,#7a8);font-family:monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.12em;margin-right:2px}
      .rl-chip{border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:2px 11px;text-decoration:none;color:var(--text-2,#bbb)}
      .rl-chip:hover{background:rgba(255,255,255,.06)}
      .rl-chip.on{border-color:#C62828;color:#e57373;background:rgba(198,40,40,.10)}
      .rl-flag{display:inline-block;color:var(--amber,#e0b050);border:1px solid var(--amber,#e0b050);border-radius:3px;padding:0 6px;margin-left:6px;font-size:10px}
      .rl-verdict{font-size:13px;color:#cfcfcf;margin-top:6px}
      .rl-frame{width:100%;height:78vh;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#0F0F0F}
      .rl-open{font-size:12px;margin:6px 0 14px}
    </style>`;

    if (!m.reports.length && !(m.departments || []).length) {
      return { stamp: 'no reports yet', body: styles + `<div class="banner muted" style="border-left:3px solid #22D3EE"><b><a href="/coyote/labour?tab=rota-review">Rota Review — weekly FORWARD &amp; HINDSIGHT rota verdicts →</a></b> <span class="ash">labour vs demand on the banded formula ruler; runs persist as dated receipts (kitchen/FOH filterable)</span></div>` + `<div class="banner muted">No reports yet. Specialists (financial planner first) publish here: verdict-first, every claim source-cited, gaps explicit. Masters are committed to the vault under <span class="mono">reports/</span>.</div>` };
    }

    const items = m.reports.map((r) => {
      let tags = []; let problems = [];
      try { tags = JSON.parse(r.tags_json || '[]'); } catch (e) { /* render without */ }
      try { problems = JSON.parse(r.problems_json || '[]'); } catch (e) { /* render without */ }
      const sel = m.selected && num(m.selected.id) === num(r.id);
      const d = new Date(Number(r.created_at)).toISOString().slice(0, 10);
      return `<a class="rl-item${sel ? ' sel' : ''}" href="/coyote/report-library?id=${num(r.id)}">
        <div class="rl-title">${esc(r.title || '(untitled)')}${problems.length ? `<span class="rl-flag" title="${esc(problems.join(' · '))}">⚠ ${problems.length} flag${problems.length === 1 ? '' : 's'}</span>` : ''}</div>
        <div class="rl-meta">${r.department ? `<span class="rl-dept">${esc(r.department)}</span>` : ''}${tags.map((t) => `<span class="rl-tag">${esc(String(t))}</span>`).join('')} ${esc(d)} · job ${esc(String(r.job_id || '').slice(0, 8))}${r.vault_path ? ` · ${esc(r.vault_path)}` : ' · <span class="rl-flag">vault pending</span>'}</div>
        ${r.verdict ? `<div class="rl-verdict">${esc(String(r.verdict).slice(0, 220))}</div>` : ''}
      </a>`;
    }).join('') || '<div class="banner muted">No reports in this department yet.</div>';

    let viewer = '';
    if (m.selected) {
      const raw = `/coyote/report-library/raw?id=${num(m.selected.id)}`;
      let problems = [];
      try { problems = JSON.parse(m.selected.problems_json || '[]'); } catch (e) { /* shown above */ }
      viewer = `${problems.length ? `<div class="banner amber">⚠ Validation flags: ${esc(problems.join(' · '))}</div>` : ''}
        <div class="rl-open"><a href="${raw}" target="_blank">Open standalone ↗</a> (print from there for the PDF)</div>
        <iframe class="rl-frame" src="${raw}" title="${esc(m.selected.title || 'report')}"></iframe>`;
    }

    const href = (dept, sort) => {
      const p = [];
      if (dept) p.push(`department=${encodeURIComponent(dept)}`);
      if (sort === 'department') p.push('sort=department');
      return `/coyote/report-library${p.length ? `?${p.join('&')}` : ''}`;
    };
    const depts = m.departments || [];
    const bar = depts.length ? `<div class="rl-bar">
      <span class="lbl">Department</span>
      <a class="rl-chip${!m.deptFilter ? ' on' : ''}" href="${href(null, m.sort)}">All</a>
      ${depts.map((dd) => `<a class="rl-chip${m.deptFilter === dd ? ' on' : ''}" href="${href(dd, m.sort)}">${esc(dd)}</a>`).join('')}
      <span class="lbl" style="margin-left:14px">Sort</span>
      <a class="rl-chip${m.sort !== 'department' ? ' on' : ''}" href="${href(m.deptFilter, 'newest')}">Newest</a>
      <a class="rl-chip${m.sort === 'department' ? ' on' : ''}" href="${href(m.deptFilter, 'department')}">Department</a>
    </div>` : '';
    return {
      stamp: `${m.reports.length} report${m.reports.length === 1 ? '' : 's'}${m.deptFilter ? ` · ${esc(m.deptFilter)}` : ''}`,
      body: styles + (viewer ? viewer : '') + `<div class="banner muted" style="border-left:3px solid #22D3EE"><b><a href="/coyote/labour?tab=rota-review">Rota Review — weekly FORWARD &amp; HINDSIGHT rota verdicts →</a></b> <span class="ash">labour vs demand on the banded formula ruler; runs persist as dated receipts (kitchen/FOH filterable)</span></div>` + `<div class="sec-label">Reports <span class="mono">(${m.sort === 'department' ? 'by department, newest within' : 'newest first'})</span><span class="rule"></span></div>` + bar + `<div class="rl-list">${items}</div>`,
    };
  },
};
