'use strict';
// Files — a small download surface for ~/exports/. Lists the regular files there (name, size,
// date) newest-first; each name links to /coyote/files/download?name=... which streams the file
// as an attachment. READ-ONLY, that directory ONLY (the server-side guard in ui/exports-lib.js
// refuses traversal + anything outside ~/exports), behind the same Wave-1 auth as every page.
const S = require('../../shared.js');
const { listExports } = require('../../exports-lib.js');

const esc = S.escapeHtml;

function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
function fmtDate(ms) {
  const d = new Date(Number(ms) || 0);
  if (!Number.isFinite(d.getTime())) return '';
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}

module.exports = {
  key: 'files', route: '/coyote/files', workspace: 'coyote', title: 'Files',
  sub: 'Downloadable exports from ~/exports — click a name to download in the browser',

  getSection(_db, ctx) {
    // Filesystem-backed (not the DB): the report/catalogue exports land in ~/exports as files.
    return { files: listExports(), now: (ctx && ctx.now) || Date.now() };
  },

  render(section, _ctx) {
    const files = (section && Array.isArray(section.files) ? section.files : []);
    const styles = `<style>
      .fl-tbl{width:100%;border-collapse:collapse;font-size:13px}
      .fl-tbl th,.fl-tbl td{padding:9px 12px;border-bottom:1px solid rgba(148,163,184,.15);text-align:left}
      .fl-tbl th{font-weight:600;color:#94A3B8;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
      .fl-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;color:#CBD5E1;white-space:nowrap}
      .fl-tbl td.dt{color:#94A3B8;white-space:nowrap}
      .fl-tbl a{color:#22D3EE;text-decoration:none}
      .fl-tbl a:hover{text-decoration:underline}
      .fl-tbl tr:hover td{background:rgba(148,163,184,.05)}
    </style>`;
    if (!files.length) {
      return { stamp: 'empty', body: styles + '<div class="banner muted">No files in <span class="mono">~/exports</span> yet. Exports (catalogues, reports) land here and appear for download automatically.</div>' };
    }
    const rows = files.map((f) => {
      const href = `/coyote/files/download?name=${encodeURIComponent(f.name)}`;
      return `<tr><td><a href="${esc(href)}" download>${esc(f.name)}</a></td><td class="num">${esc(humanSize(f.size))}</td><td class="dt">${esc(fmtDate(f.mtimeMs))}</td></tr>`;
    }).join('');
    const body = styles
      + `<div class="banner muted" style="border-left:3px solid #22D3EE">Files in <span class="mono">~/exports</span>, newest first. Read-only; downloads stream through your authenticated browser session — no scp needed.</div>`
      + `<div class="sec-label">Exports <span class="mono">(${files.length})</span><span class="rule"></span></div>`
      + `<table class="fl-tbl"><thead><tr><th>File</th><th style="text-align:right">Size</th><th>Modified</th></tr></thead><tbody>${rows}</tbody></table>`;
    return { stamp: `${files.length} file${files.length === 1 ? '' : 's'}`, body };
  },
};
