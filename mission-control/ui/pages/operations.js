'use strict';
// Operations page — restaurant KPIs (ops-centre skin). Contract: { key, route, title, sub, getSection, render }.
// getSection: SELECT-only via ctx.q. render returns { stamp, body }. Requires ONLY ../shared.js — NO writes,
// NO network, NO LLM. kpi_snapshot is EMPTY until the box-side coyote-intel ingest is wired, so the PRIMARY
// path is a calm "KPI feed not yet wired" state — every tile shows '—', never a fabricated number.
const S = require('../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function firstRow(res) { const r = rowsOf(res); return r.length ? r[0] : null; }
// NULL/undefined → null (Number(null)===0 would fabricate a real 0, e.g. a "0% labour" that was never reported).
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

module.exports = {
  key: "operations", route: "/operations", title: "Operations", sub: "Restaurant KPIs · covers, revenue, labour, channel",

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    // Latest snapshot set = newest fetched_at row. SELECT-only; if the table is missing, q returns ok:false
    // and we fall through to the not-yet-wired state (never a crash, never a fabricated row).
    let kpi = null;
    if (typeof q === 'function') {
      kpi = firstRow(q(
        `SELECT period, covers, revenue_pence, labour_pct, atv_pence, channel_split, source, as_of, fetched_at
           FROM kpi_snapshot ORDER BY fetched_at DESC LIMIT 1`));
    }
    return {
      now: (ctx && ctx.now) || Date.now(),
      kpi,
      halt: (ctx && ctx.halt) || { halted: false, source: '' },
    };
  },

  render(section, ctx) {
    const m = section || {};
    const now = m.now || (ctx && ctx.now) || Date.now();
    const esc = S.escapeHtml;
    const k = m.kpi;
    const wired = !!k;

    // ---- stamp: source · coyote-intel + honest freshness (or 'not yet wired') ----
    const freshAt = k ? (num(k.as_of) || num(k.fetched_at) || 0) : 0;
    let stamp;
    if (!wired) {
      stamp = `source · <span class="mono">coyote-intel</span> · <span class="none">not yet wired</span>`;
    } else {
      const f = S.freshness(freshAt, now);
      const inner = f.cls === 'fresh' ? `<b>${f.label}</b>` : `<span class="${f.cls}">${f.label}</span>`;
      stamp = `source · <span class="mono">coyote-intel</span> · ${inner}`;
    }

    const parts = [];

    if (!wired) {
      // ===== PRIMARY PATH — KPI feed not yet wired (empty / no fabricated numbers) =====
      parts.push(
        `<div class="banner muted">KPI feed not yet wired — covers, revenue, labour % and ATV appear here once the box-side <span class="mono">coyote-intel</span> ingest is connected. Until then the board stays SELECT-only and shows no numbers: every tile reads <span class="mono">—</span> rather than an estimate or a placeholder that looks real.</div>`);
      parts.push(`<div class="sec-label">Today's numbers<span class="rule"></span></div>`);
      parts.push(`<div class="tiles">${emptyTiles()}</div>`);
      parts.push(`<div class="sec-label">Channel split<span class="rule"></span></div>`);
      parts.push(
        `<div class="panel"><div class="panel-body"><div class="empty-row">No channel split yet — the first <span class="mono">coyote-intel</span> snapshot will populate it.</div></div></div>`);
      return { stamp, body: parts.join('\n') };
    }

    // ===== POPULATED PATH =====
    const f = S.freshness(freshAt, now);
    const fsub = f.cls === 'fresh' ? f.label : `<span class="${f.cls === 'stale' ? 'a' : ''}">${f.label}</span>`;
    const period = k.period ? esc(String(k.period)) : '';

    const labourN = num(k.labour_pct);
    const labour = labourN == null ? '—' : `${Number.isInteger(labourN) ? labourN : labourN.toFixed(1)}%`;
    const labourHot = labourN != null && labourN > 35; // labour over ~35% of revenue = watch

    parts.push(
      `<div class="sec-label">Today's numbers${period ? ' · <span class="mono">' + period + '</span>' : ''}<span class="rule"></span></div>`);
    const tiles = [
      `<div class="tile blue"><div class="lab">Covers</div><div class="val">${S.fmtInt(k.covers)}</div><div class="sub">${fsub}</div></div>`,
      `<div class="tile green"><div class="lab">Revenue</div><div class="val">${S.fmtGbpPence(k.revenue_pence)}</div><div class="sub">${fsub}</div></div>`,
      `<div class="tile ${labourHot ? 'amber' : ''}"><div class="lab">Labour</div><div class="val">${labour}</div><div class="sub${labourHot ? ' a' : ''}">${labourHot ? 'above 35% target' : fsub}</div></div>`,
      `<div class="tile"><div class="lab">ATV</div><div class="val">${S.fmtGbpPence(k.atv_pence)}</div><div class="sub">${fsub}</div></div>`,
    ];
    parts.push(`<div class="tiles">${tiles.join('')}</div>`);

    // ---- channel split (parsed from channel_split JSON) as a small table + bars ----
    parts.push(`<div class="sec-label">Channel split<span class="rule"></span></div>`);
    parts.push(channelSplitPanel(k.channel_split, k.source, esc));

    return { stamp, body: parts.join('\n') };
  },
};

// Four muted '—' tiles for the not-yet-wired state. Marker text 'not yet wired' kept honest, no numbers.
function emptyTiles() {
  return ['Covers', 'Revenue', 'Labour', 'ATV']
    .map((l) => `<div class="tile muted"><div class="lab">${l}</div><div class="val">—</div><div class="sub">not yet wired</div></div>`)
    .join('');
}

// Parse channel_split (JSON object name->number) defensively → a share table with cyan share bars.
// Anything non-numeric / unparseable degrades to a graceful empty row, never a thrown error.
function channelSplitPanel(raw, source, esc) {
  let obj = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) obj = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) obj = p; } catch (_) { obj = null; }
  }
  const entries = [];
  if (obj) {
    for (const key of Object.keys(obj)) {
      const v = Number(obj[key]);
      if (Number.isFinite(v) && v >= 0) entries.push([key, v]);
    }
  }
  if (!entries.length) {
    return `<div class="panel"><div class="panel-body"><div class="empty-row">Channel split not provided in this snapshot.</div></div></div>`;
  }
  const total = entries.reduce((a, e) => a + e[1], 0) || 1;
  entries.sort((a, b) => b[1] - a[1]);
  const rows = entries.map((e) => {
    const share = (e[1] / total) * 100;
    const pct = share >= 10 ? share.toFixed(0) : share.toFixed(1);
    return `<tr>
        <td class="mono">${esc(prettyChannel(e[0]))}</td>
        <td style="width:58%"><div class="rate-bar"><i style="width:${share.toFixed(1)}%;background:var(--cyan)"></i></div></td>
        <td class="mono" style="text-align:right;color:var(--text)">${pct}%</td>
      </tr>`;
  }).join('');
  const srcMeta = source ? `<span class="meta">${esc(String(source))}</span>` : '';
  return `<div class="panel">
    <div class="panel-head"><h2>By channel</h2>${srcMeta}</div>
    <div class="panel-body"><table>
      <thead><tr><th>Channel</th><th>Share of total</th><th style="text-align:right">Share</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function prettyChannel(name) {
  return String(name).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
