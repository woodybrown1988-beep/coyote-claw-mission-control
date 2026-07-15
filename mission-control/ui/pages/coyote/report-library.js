'use strict';
// Report Library — the Coyote Report Standard's MC surface (cc spec:
// ops/coyote-report-standard-spec.md). Lists report artifacts newest-first; a
// selected report renders its SELF-CONTAINED branded HTML in an iframe from
// /coyote/report-library/raw?id=N (print from there = the PDF). SELECT-only via
// ctx.q; validation flags (UNCITED etc) are shown LOUD next to the title — a
// flagged report is visible as flagged everywhere it appears.
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

module.exports = {
  key: 'report-library', route: '/coyote/report-library', workspace: 'coyote', title: 'Report Library',
  sub: 'Specialist reports · verdict-first, source-cited, gaps explicit — masters live in the vault',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, reports: [], selected: null };
    const reports = rowsOf(q(
      `SELECT id, job_id, title, tags_json, verdict, problems_json, vault_path, created_at
         FROM report_artifacts ORDER BY created_at DESC, id DESC LIMIT 100`,
    ));
    const selId = ctx.query && num(ctx.query.id);
    const selected = selId != null ? reports.find((r) => num(r.id) === selId) ?? null : null;
    return { now, reports, selected };
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
      .rl-flag{display:inline-block;color:var(--amber,#e0b050);border:1px solid var(--amber,#e0b050);border-radius:3px;padding:0 6px;margin-left:6px;font-size:10px}
      .rl-verdict{font-size:13px;color:#cfcfcf;margin-top:6px}
      .rl-frame{width:100%;height:78vh;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#0F0F0F}
      .rl-open{font-size:12px;margin:6px 0 14px}
    </style>`;

    if (!m.reports.length) {
      return { stamp: 'no reports yet', body: `${styles}<div class="banner muted">No reports yet. Specialists (financial planner first) publish here: verdict-first, every claim source-cited, gaps explicit. Masters are committed to the vault under <span class="mono">reports/</span>.</div>` };
    }

    const items = m.reports.map((r) => {
      let tags = []; let problems = [];
      try { tags = JSON.parse(r.tags_json || '[]'); } catch (e) { /* render without */ }
      try { problems = JSON.parse(r.problems_json || '[]'); } catch (e) { /* render without */ }
      const sel = m.selected && num(m.selected.id) === num(r.id);
      const d = new Date(Number(r.created_at)).toISOString().slice(0, 10);
      return `<a class="rl-item${sel ? ' sel' : ''}" href="/coyote/report-library?id=${num(r.id)}">
        <div class="rl-title">${esc(r.title || '(untitled)')}${problems.length ? `<span class="rl-flag" title="${esc(problems.join(' · '))}">⚠ ${problems.length} flag${problems.length === 1 ? '' : 's'}</span>` : ''}</div>
        <div class="rl-meta">${tags.map((t) => `<span class="rl-tag">${esc(String(t))}</span>`).join('')} ${esc(d)} · job ${esc(String(r.job_id || '').slice(0, 8))}${r.vault_path ? ` · ${esc(r.vault_path)}` : ' · <span class="rl-flag">vault pending</span>'}</div>
        ${r.verdict ? `<div class="rl-verdict">${esc(String(r.verdict).slice(0, 220))}</div>` : ''}
      </a>`;
    }).join('');

    let viewer = '';
    if (m.selected) {
      const raw = `/coyote/report-library/raw?id=${num(m.selected.id)}`;
      let problems = [];
      try { problems = JSON.parse(m.selected.problems_json || '[]'); } catch (e) { /* shown above */ }
      viewer = `${problems.length ? `<div class="banner amber">⚠ Validation flags: ${esc(problems.join(' · '))}</div>` : ''}
        <div class="rl-open"><a href="${raw}" target="_blank">Open standalone ↗</a> (print from there for the PDF)</div>
        <iframe class="rl-frame" src="${raw}" title="${esc(m.selected.title || 'report')}"></iframe>`;
    }

    return {
      stamp: `${m.reports.length} report${m.reports.length === 1 ? '' : 's'}`,
      body: styles + (viewer ? viewer : '') + `<div class="sec-label">Reports <span class="mono">(newest first)</span><span class="rule"></span></div><div class="rl-list">${items}</div>`,
    };
  },
};
