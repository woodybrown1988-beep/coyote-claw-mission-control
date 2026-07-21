'use strict';

// Ops-centre design system + app shell — THE shared spec every page renders into. Lifted verbatim from
// design/mission-control-agents-board-opscentre.html (the locked aesthetic) and extended with the
// component classes the other pages need (tiles, data tables, chips, action band, review cards, KPI
// tiles, health rows) in the SAME language. Pure string builders — no DB, no network.
//
// Palette: slate #0A0E16 bg + faint control-grid + cyan radial glow · signature cyan #22D3EE ·
// green #34D399 healthy/working/done · blue #60A5FA queued/info · amber #FBBF24 blocked-on-dept ·
// red #F87171 RESERVED for blocked-on-you/critical. Fonts: Space Grotesk display / Inter body /
// IBM Plex Mono for ALL numbers + technical labels. Glassy depth (border-top highlight), 10-12px round.

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Honest freshness — NEVER claims fresh without a real recent timestamp. Returns {cls, label} where
// cls ∈ fresh|stale|none. `staleMs` defaults to ~1.5× the daily ingest cadence.
function freshness(fetchedAt, now, staleMs) {
  const limit = staleMs || 36 * 60 * 60 * 1000;
  if (!fetchedAt || fetchedAt <= 0) return { cls: 'none', label: 'not yet ingested' };
  const age = now - fetchedAt;
  if (age < 0) return { cls: 'stale', label: 'clock skew' };
  if (age <= limit) return { cls: 'fresh', label: `as of ${fmtTime(fetchedAt)}` };
  return { cls: 'stale', label: `stale · ${agoLabel(age)}` };
}

function fmtTime(ms) {
  // server-side ISO-ish; the page's <time data-ms> client script localises it
  return `<time data-ms="${ms}">${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')}Z</time>`;
}
function agoLabel(ageMs) {
  const m = Math.floor(ageMs / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmtGbpPence(pence) {
  if (pence === null || pence === undefined || !Number.isFinite(Number(pence))) return '—';
  return `£${(Number(pence) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtInt(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-GB');
}

const BRAND_SVG =
  '<svg viewBox="0 0 24 24" fill="none" width="17" height="17"><path d="M12 3 L19 8 L17 19 L7 19 L5 8 Z" stroke="#22D3EE" stroke-width="1.5"/><circle cx="9.5" cy="11" r="1.1" fill="#22D3EE"/><circle cx="14.5" cy="11" r="1.1" fill="#22D3EE"/><path d="M9 15 Q12 17 15 15" stroke="#22D3EE" stroke-width="1.2" fill="none"/></svg>';

// WORKSPACE registry — ONE app, N route-namespaced workspaces. Adding /coyote-aviemore or /capital = one
// more entry here + its page files under ui/pages/<ws>/; no routing-engine change. Each page module also
// declares `workspace` so servePage can resolve the active workspace from the served page.
//   /coyote — BUSINESS ("would a manager look at this?"): Overview, Reports, YoY, Labour, Recipes, Reviews, Issues, Operations.
//   /claw   — ENGINE ROOM (agent machinery): Agents board + Health (job states, spend, gates live inside them).
//             READ-ONLY: shows state; every action is a Telegram tap (a console button would cross the nonce
//             trust boundary — see the read-only test). Badges: red = blocked-on-you, amber = warn.
const WORKSPACES = [
  { key: 'coyote', label: 'Coyote', tag: 'Business', home: '/coyote/overview', groups: [
    { group: 'Command', items: [
      { key: 'overview', label: 'Overview', route: '/coyote/overview', ico: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>' },
    ] },
    { group: 'Departments', items: [
      { key: 'reports', label: 'Reports', route: '/coyote/reports', ico: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7"/><rect x="12" y="7" width="3" height="11"/><rect x="17" y="4" width="3" height="14"/>' },
      { key: 'report-library', label: 'Report Library', route: '/coyote/report-library', ico: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h7"/>' },
      { key: 'labour', label: 'Labour', route: '/coyote/labour', ico: '<circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><path d="M15 20v-1a5 5 0 0 1 7-4.6"/>' },
      { key: 'recipes', label: 'Recipes & Costs', route: '/coyote/recipes', ico: '<path d="M5 3h11l3 3v15H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>' },
      { key: 'reviews', label: 'Reviews', route: '/coyote/reviews', ico: '<path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 21l-4.9 2.1.9-5.5-4-3.9 5.5-.8z"/>' },
      { key: 'issues', label: 'Issues', route: '/coyote/issues', ico: '<path d="M10.3 3.8 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>' },
    ] },
  ] },
  { key: 'claw', label: 'Claw', tag: 'Engine room', home: '/claw/engine', readOnly: true, groups: [
    { group: 'Console', items: [
      { key: 'engine', label: 'Engine', route: '/claw/engine', ico: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="17" r="2.5"/><path d="M12 10v3M9 15l-2 1M15 15l2 1"/>' },
    ] },
  ] },
];

// Resolve the active workspace from the active page key (falls back to the first workspace for '/').
function workspaceOf(activeKey) {
  return WORKSPACES.find((w) => w.groups.some((g) => g.items.some((it) => it.key === activeKey))) || WORKSPACES[0];
}

// The workspace switcher — two chips in the shared shell; the active workspace is highlighted, each links to
// that workspace's home (Coyote is the default daily driver).
function renderSwitch(activeWs) {
  const wrap = 'display:flex;gap:4px;margin:12px 14px 4px;padding:3px;background:rgba(255,255,255,.05);border-radius:9px';
  const chips = WORKSPACES.map((w) => {
    const on = w.key === activeWs.key;
    const st = 'flex:1;text-align:center;padding:6px 4px;border-radius:7px;font-size:12px;font-weight:600;letter-spacing:.02em;text-decoration:none;'
      + (on ? 'background:rgba(34,211,238,.16);color:#CFF6FB' : 'color:var(--muted,#8aa)');
    return `<a href="${w.home}" style="${st}" title="${escapeHtml(w.tag || '')}">${escapeHtml(w.label)}</a>`;
  }).join('');
  const ro = activeWs.readOnly ? '<div style="margin:2px 15px 4px;font-size:10px;color:var(--muted,#7a8)">read-only · actions via Telegram</div>' : '';
  return `<div style="${wrap}">${chips}</div>${ro}`;
}

function renderSidebar(active, badges, foot) {
  const b = badges || {};
  const ws = workspaceOf(active);
  const navHtml = ws.groups.map((sec) => {
    const items = sec.items
      .map((it) => {
        const isActive = it.key === active;
        const badge = b[it.key];
        const badgeHtml = badge && badge.count > 0
          ? `<span class="badge${badge.tone === 'amber' ? ' amber' : badge.tone === 'cyan' ? ' cyan' : ''}">${escapeHtml(String(badge.count))}</span>`
          : '';
        return `<a class="nav-item${isActive ? ' active' : ''}" href="${it.route}"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${it.ico}</svg>${escapeHtml(it.label)}${badgeHtml}</a>`;
      })
      .join('');
    return `<div class="nav-label">${escapeHtml(sec.group)}</div>${items}`;
  }).join('');
  const footHtml = (foot || [])
    .map((line, i) => `<div>${i === 0 ? '<span class="pulse-dot"></span>' : ''}${line}</div>`)
    .join('');
  return `<aside class="sidebar">
    <div class="brand"><div class="brand-mark">${BRAND_SVG}</div><div><div class="brand-name">Coyote Claw</div><div class="brand-sub">Mission Control</div></div></div>
    ${renderSwitch(ws)}
    <nav class="nav">${navHtml}</nav>
    <div class="sidebar-foot">${footHtml}</div>
  </aside>`;
}

// The full page document. `body` is the page's main content (everything below page-head). `stamp` is
// the freshness/source line (right of the title). `clientScript` is optional extra page JS.
function renderShell(opts) {
  const { active, title, sub, stamp, body } = opts;
  const sidebar = renderSidebar(active, opts.badges, opts.foot);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Coyote Claw · Mission Control · ${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/static/brand/claw.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css()}</style></head>
<body><div class="app">${sidebar}
<main class="main">
  <div class="page-head"><div><h1 class="page-title">${escapeHtml(title)}</h1><div class="page-sub">${escapeHtml(sub)}</div></div><div class="stamp">${stamp || ''}</div></div>
  ${body}
</main></div>
<script>${clientScript()}${opts.clientScript || ''}</script>
</body></html>`;
}

// Shared client script: localise <time data-ms>, the action-queue interactions (copy/filter/safe-write
// POST — see reviews/issues pages), and a soft 30s refresh.
function clientScript() {
  return `
  for (const el of document.querySelectorAll('time[data-ms]')) { const ms=Number(el.dataset.ms); if(Number.isFinite(ms)&&ms>0) el.textContent=new Date(ms).toLocaleString(); }
  let aqBusy=false;
  document.addEventListener('click',(e)=>{const t=e.target; if(!t||!t.closest)return;
    if(t.hasAttribute('data-copy')){const card=t.closest('[data-card]'); const body=card&&card.querySelector('[data-draft]'); if(body&&navigator.clipboard){navigator.clipboard.writeText(body.textContent).then(()=>{const p=t.textContent;t.textContent='Copied ✓';setTimeout(()=>{t.textContent=p;},1500);}).catch(()=>{});} return;}
    if(t.hasAttribute('data-filter')){const f=t.getAttribute('data-filter')||''; for(const card of document.querySelectorAll('[data-issues]')){const xs=(card.getAttribute('data-issues')||'').split(' '); card.style.display=(!f||xs.indexOf(f)!==-1)?'':'none';} return;}
    if(t.hasAttribute('data-op')){const wrap=t.closest('[data-review]'); const id=wrap&&wrap.getAttribute('data-review'); if(!id||aqBusy)return; aqBusy=true;t.disabled=true; const p={op:t.getAttribute('data-op'),review_id:id}; if(p.op==='snooze')p.hours=24; fetch('/api/review-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)}).then(r=>r.json()).then(()=>location.reload()).catch(()=>{aqBusy=false;t.disabled=false;}); return;}
    if(t.hasAttribute('data-log-action')){const form=t.closest('[data-log-form]'); if(!form||aqBusy)return; const code=form.querySelector('[name=issue_code]').value; const action=(form.querySelector('[name=action_taken]').value||'').trim(); if(!action){return;} aqBusy=true;t.disabled=true; fetch('/api/review-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'log_action',issue_code:code,action_taken:action,action_date:Date.now()})}).then(r=>r.json()).then(()=>location.reload()).catch(()=>{aqBusy=false;t.disabled=false;}); return;}
    if(t.classList&&t.classList.contains('rc-import-btn')){const box=t.closest('[data-kind]'); const file=box&&box.querySelector('input[type=file]'); const out=box.querySelector('.rc-result'); if(!file||!file.files||!file.files[0]){if(out)out.textContent='choose a CSV first';return;} const kind=box.getAttribute('data-kind'); const rd=new FileReader(); rd.onload=function(){ if(out)out.textContent='importing…'; fetch('/api/recipe-import?kind='+encodeURIComponent(kind),{method:'POST',headers:{'content-type':'text/csv'},body:rd.result}).then(r=>r.json()).then(r=>{ if(r&&r.ok){ if(out)out.textContent='imported '+r.imported+(r.rejected&&r.rejected.length?(' · '+r.rejected.length+' rejected'):''); setTimeout(()=>location.reload(),900);} else { if(out)out.textContent='failed: '+((r&&r.error)||'unknown'); } }).catch(()=>{if(out)out.textContent='network error';}); }; rd.readAsText(file.files[0]); return;}
  });
  // BOM (Recipes & Costs) — gated edits: submit an rc-form to POST /api/recipe-action (the closed allowlist).
  document.addEventListener('submit',(e)=>{const f=e.target; if(!f||!f.classList||!f.classList.contains('rc-form'))return; e.preventDefault(); if(aqBusy)return; const kind=f.getAttribute('data-rc'); const d={}; new FormData(f).forEach((v,k)=>{d[k]=v;}); let body; if(kind==='sub_item'){body={op:'upsert_sub_item',id:d.id,name:d.name,supplier:d.supplier,pack_description:d.pack_description,pack_cost_pence:(d.pack_cost===''||d.pack_cost==null)?null:Math.round(parseFloat(d.pack_cost)*100),pack_qty:(d.pack_qty===''?null:d.pack_qty),unit_of_measure:d.unit_of_measure};}else{body={op:'set_recipe_line',product_id:d.product_id,sub_item_id:d.sub_item_id,quantity:d.quantity};} aqBusy=true; fetch('/api/recipe-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).then(r=>{aqBusy=false; if(r&&r.ok){location.reload();}else{alert('Rejected: '+((r&&r.error)||'unknown'));}}).catch(()=>{aqBusy=false;}); });
  setTimeout(()=>location.reload(),30000);`;
}

function css() {
  return `
  :root{
    --bg:#0A0E16;--panel:#0E141E;--panel-2:#121A26;
    --card:rgba(255,255,255,.025);--card-hover:rgba(255,255,255,.05);
    --border:rgba(125,165,205,.10);--border-strong:rgba(125,165,205,.20);--hl:rgba(255,255,255,.05);
    --text:#E5EDF7;--text-2:#899AB1;--muted:rgba(170,195,225,.34);
    --cyan:#22D3EE;--cyan-dim:rgba(34,211,238,.13);--cyan-glow:rgba(34,211,238,.22);
    --blue:#60A5FA;--green:#34D399;--green-dim:rgba(52,211,153,.13);
    --amber:#FBBF24;--amber-dim:rgba(251,191,36,.12);
    --red:#F87171;--red-dim:rgba(248,113,113,.12);--red-glow:rgba(248,113,113,.2);
    --font-display:'Space Grotesk',sans-serif;--font-body:'Inter',sans-serif;--font-mono:'IBM Plex Mono',monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:14.5px;line-height:1.5;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(rgba(125,165,205,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(125,165,205,.025) 1px,transparent 1px);background-size:38px 38px}
  body::after{content:'';position:fixed;top:-120px;left:160px;width:600px;height:400px;pointer-events:none;z-index:0;background:radial-gradient(ellipse,var(--cyan-glow),transparent 65%);opacity:.5;filter:blur(40px)}
  .app{display:grid;grid-template-columns:228px 1fr;min-height:100vh;position:relative;z-index:1}
  .mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
  /* sidebar */
  .sidebar{background:rgba(12,17,25,.7);backdrop-filter:blur(8px);border-right:1px solid var(--border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
  .brand{padding:21px 20px 17px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:11px}
  .brand-mark{width:33px;height:33px;border:1.5px solid var(--cyan);border-radius:8px;display:grid;place-items:center;flex-shrink:0;background:var(--cyan-dim);box-shadow:0 0 14px var(--cyan-glow)}
  .brand-name{font-family:var(--font-display);font-weight:600;font-size:16.5px;letter-spacing:.01em;line-height:1}
  .brand-sub{font-family:var(--font-mono);font-size:9px;color:var(--muted);letter-spacing:.16em;text-transform:uppercase;margin-top:3px}
  .nav{padding:12px 12px;flex:1}
  .nav-label{font-family:var(--font-mono);font-size:9.5px;font-weight:500;color:var(--muted);letter-spacing:.16em;text-transform:uppercase;padding:14px 10px 7px}
  .nav-item{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:7px;cursor:pointer;color:var(--text-2);font-weight:500;font-size:14px;transition:all .15s ease-out;position:relative;margin-bottom:1px}
  .nav-item:hover{background:rgba(255,255,255,.035);color:var(--text)}
  .nav-item.active{background:var(--cyan-dim);color:#CFF6FB}
  .nav-item.active::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:2.5px;background:var(--cyan);border-radius:0 2px 2px 0;box-shadow:0 0 8px var(--cyan-glow)}
  .nav-item .ico{width:16.5px;height:16.5px;flex-shrink:0;opacity:.8}
  .nav-item .badge{margin-left:auto;font-family:var(--font-mono);font-size:10.5px;font-weight:600;background:var(--red);color:#1a0d0d;border-radius:9px;padding:1px 7px;min-width:19px;text-align:center}
  .nav-item .badge.amber{background:var(--amber);color:#241a05}
  .nav-item .badge.cyan{background:var(--cyan);color:#04222A}
  .sidebar-foot{padding:14px 18px;border-top:1px solid var(--border);font-family:var(--font-mono);font-size:10px;color:var(--muted);line-height:1.8}
  .pulse-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:7px;box-shadow:0 0 7px rgba(52,211,153,.6)}
  /* main + page head */
  .main{padding:24px 28px 50px;overflow-y:auto;max-height:100vh}
  .page-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:12px}
  .page-title{font-family:var(--font-display);font-weight:600;font-size:29px;letter-spacing:-.01em;line-height:1}
  .page-sub{color:var(--muted);font-size:13px;margin-top:6px}
  .stamp{font-family:var(--font-mono);font-size:11px;color:var(--muted)}
  .stamp b{color:var(--green)} .stamp .stale{color:var(--amber)} .stamp .none{color:var(--muted)}
  /* generic panel + section heads + glassy cards */
  .panel{background:var(--card);border:1px solid var(--border);border-top:1px solid var(--hl);border-radius:12px;overflow:hidden;margin-bottom:13px}
  .panel-head{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)}
  .panel-head h2{font-family:var(--font-display);font-weight:600;font-size:14px;letter-spacing:.01em}
  .panel-head .meta{margin-left:auto;font-family:var(--font-mono);font-size:10.5px;color:var(--muted)}
  .panel-body{padding:14px 16px}
  .sec-label{font-family:var(--font-mono);font-size:10.5px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.16em;margin:18px 0 11px;display:flex;align-items:center;gap:14px}
  .sec-label .rule{flex:1;height:1px;background:var(--border)}
  /* tiles (KPIs / stats) */
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:11px;margin-bottom:13px}
  .tile{background:var(--card);border:1px solid var(--border);border-top:1px solid var(--hl);border-radius:11px;padding:14px 15px;display:flex;flex-direction:column;gap:6px;position:relative;overflow:hidden}
  .tile::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2.5px;background:var(--cyan);opacity:.55}
  .tile.green::before{background:var(--green)} .tile.blue::before{background:var(--blue)} .tile.amber::before{background:var(--amber)} .tile.red::before{background:var(--red)} .tile.muted::before{background:#455}
  .tile .lab{font-family:var(--font-mono);font-size:9.5px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2)}
  .tile .val{font-family:var(--font-mono);font-size:25px;font-weight:600;color:var(--text);line-height:1}
  .tile .sub{font-family:var(--font-mono);font-size:10px;color:var(--muted)}
  .tile .sub.g{color:var(--green)} .tile .sub.a{color:var(--amber)} .tile .sub.r{color:var(--red)}
  /* data tables */
  table{width:100%;border-collapse:collapse;font-size:13px}
  thead th{font-family:var(--font-mono);font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);text-align:left;padding:7px 10px;border-bottom:1px solid var(--border)}
  tbody td{padding:9px 10px;border-bottom:1px solid var(--border);color:var(--text-2)}
  tbody tr:last-child td{border-bottom:none}
  .empty-row{color:var(--muted);font-family:var(--font-mono);font-size:11px;padding:14px 10px}
  /* chips + pills + buttons */
  .chip{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-mono);font-size:10.5px;border-radius:999px;padding:2px 9px;cursor:pointer;border:1px solid var(--border)}
  .chip.cyan{color:var(--cyan);background:var(--cyan-dim);border-color:rgba(34,211,238,.25)}
  .chip.amber{color:var(--amber);background:var(--amber-dim);border-color:rgba(251,191,36,.25)}
  .chip.muted{color:var(--muted)}
  .tag{font-family:var(--font-mono);font-size:9.5px;color:var(--text-2);border:1px solid var(--border);border-radius:5px;padding:1px 6px;cursor:pointer}
  .tag:hover{border-color:var(--border-strong);color:var(--text)}
  .btn{font-family:var(--font-display);font-weight:500;font-size:11px;letter-spacing:.01em;padding:6px 13px;border-radius:7px;cursor:pointer;border:1px solid var(--border-strong);background:var(--panel-2);color:var(--text);transition:all .15s}
  .btn:hover{border-color:var(--border-strong);background:var(--card-hover)}
  .chip.green{color:var(--green);background:var(--green-dim);border-color:rgba(52,211,153,.25)}
  /* BOM (Recipes & Costs) editor */
  .ash{color:var(--text-2)}
  .tbl{width:100%;border-collapse:collapse;font-size:12px}
  .tbl th{text-align:left;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-2);padding:6px 10px;border-bottom:1px solid var(--border)}
  .tbl td{padding:6px 10px;border-bottom:1px solid var(--hl)}
  .rc-form{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:11px}
  .rc-form input,.rc-form select{font-family:var(--font-mono);font-size:11.5px;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--panel-2);color:var(--text)}
  .rc-prod{border-top:1px solid var(--hl);padding:9px 0}
  .rc-prod-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px}
  .rc-import{display:flex;gap:9px;align-items:center;margin:6px 0}
  .rc-result{font-family:var(--font-mono);font-size:11px}
  .btn.cyan{background:var(--cyan);color:#04222A;border:none;box-shadow:0 0 14px var(--cyan-glow)}
  .btn.cyan:hover{background:#5EE3F5;transform:translateY(-1px)}
  .btn.green{color:var(--green);border-color:var(--green-dim)}
  .btn:disabled{opacity:.5;cursor:default}
  /* status dot helper */
  .sdot{display:inline-block;width:7px;height:7px;border-radius:50%;vertical-align:middle}
  .sdot.green{background:var(--green);box-shadow:0 0 6px rgba(52,211,153,.6)} .sdot.blue{background:var(--blue)} .sdot.amber{background:var(--amber)} .sdot.red{background:var(--red);box-shadow:0 0 6px var(--red-glow)} .sdot.idle{background:#566}
  /* banners */
  .banner{border-radius:10px;padding:11px 15px;margin-bottom:13px;font-size:13px;border:1px solid var(--border)}
  .banner.red{background:var(--red-dim);border-color:rgba(248,113,113,.3);color:#FCA5A5}
  .banner.amber{background:var(--amber-dim);border-color:rgba(251,191,36,.3);color:#FCD667}
  .banner.muted{color:var(--muted)}
  /* leadership apex + librarian (Agents page) */
  .apex{display:grid;grid-template-columns:1fr 1.4fr;gap:13px;margin-bottom:11px}
  @media(max-width:760px){.apex{grid-template-columns:1fr}}
  .lead-card{background:var(--card);border:1px solid var(--border);border-top:1px solid var(--hl);border-radius:12px;padding:16px 18px;display:flex;gap:14px;align-items:flex-start;position:relative;overflow:hidden;transition:all .2s ease-out}
  .lead-card:hover{transform:translateY(-2px);background:var(--card-hover);border-color:var(--border-strong)}
  .lead-card.cos{box-shadow:inset 0 0 0 1px rgba(34,211,238,.08)}
  .lead-av{width:46px;height:46px;border-radius:11px;display:grid;place-items:center;flex-shrink:0;font-family:var(--font-display);font-weight:600;font-size:16px}
  .lead-av.boss{background:rgba(137,154,177,.12);color:#A9B6C9;border:1px solid rgba(137,154,177,.2)}
  .lead-av.cos{background:var(--cyan-dim);color:#7FE9F5;border:1px solid rgba(34,211,238,.35);box-shadow:0 0 16px var(--cyan-glow)}
  .lead-body{flex:1;min-width:0}
  .lead-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .lead-name{font-family:var(--font-display);font-weight:600;font-size:16.5px;letter-spacing:-.005em}
  .lead-role{font-family:var(--font-mono);font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em}
  .lead-desc{font-size:13px;color:var(--text-2);margin-top:7px;line-height:1.5}
  .lead-desc .muted{color:var(--muted)}
  .cos-btn{font-family:var(--font-display);font-weight:500;font-size:12px;letter-spacing:.01em;padding:8px 15px;border-radius:8px;cursor:pointer;background:var(--cyan);color:#04222A;border:none;margin-top:11px;transition:all .15s;box-shadow:0 0 16px var(--cyan-glow)}
  .cos-btn:hover{background:#5EE3F5;transform:translateY(-1px)}
  .mstat{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;padding:2px 9px;border-radius:9px}
  .mstat .sd{width:6px;height:6px;border-radius:50%}
  .mstat.idle{background:rgba(255,255,255,.04);color:var(--muted)} .mstat.idle .sd{background:#566}
  .mstat.ready{background:var(--green-dim);color:var(--green)} .mstat.ready .sd{background:var(--green);box-shadow:0 0 7px rgba(52,211,153,.7)}
  .librarian{background:linear-gradient(180deg,rgba(96,165,250,.05),rgba(96,165,250,.02));border:1px solid rgba(96,165,250,.2);border-top:1px solid var(--hl);border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .lib-av{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.3);color:#9DC4FB;font-family:var(--font-display);font-weight:600;font-size:14px}
  .lib-text{flex:1;min-width:0}
  .lib-name{font-family:var(--font-display);font-weight:600;font-size:15px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .lib-tag{font-family:var(--font-mono);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}
  .lib-desc{font-size:12.5px;color:var(--text-2);margin-top:3px}
  .lib-stats{display:flex;gap:24px;flex-shrink:0}
  .lib-stat{text-align:right}
  .lib-stat .v{font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--text)}
  .lib-stat .l{font-family:var(--font-mono);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-top:1px}
  .flow-divider{display:flex;align-items:center;gap:14px;margin:20px 0 13px}
  .flow-divider .t{font-family:var(--font-mono);font-size:10.5px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.16em}
  .flow-divider .rule{flex:1;height:1px;background:var(--border)}
  .flow-divider .legend{display:flex;gap:15px;font-family:var(--font-mono);font-size:10px;color:var(--muted);flex-wrap:wrap}
  .flow-divider .legend span{display:inline-flex;align-items:center;gap:5px}
  .flow-divider .legend i{width:7px;height:7px;border-radius:50%;display:inline-block}
  /* kanban */
  .board{display:grid;grid-template-columns:repeat(5,1fr);gap:11px;align-items:start}
  @media(max-width:1100px){.board{grid-template-columns:repeat(2,1fr)}}
  .col{background:rgba(255,255,255,.012);border:1px solid var(--border);border-radius:12px;padding:11px 10px;min-height:160px}
  .col-head{display:flex;align-items:center;justify-content:space-between;padding:3px 6px 11px;border-bottom:1px solid var(--border);margin-bottom:11px}
  .col-name{font-family:var(--font-mono);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.11em;display:flex;align-items:center;gap:8px;color:var(--text-2)}
  .col-name i{width:7px;height:7px;border-radius:50%}
  .col-count{font-family:var(--font-mono);font-size:10.5px;font-weight:600;color:var(--muted);background:rgba(255,255,255,.04);border-radius:8px;padding:1px 7px;min-width:18px;text-align:center}
  .col.idle .col-name i{background:#566}
  .col.queued .col-name i{background:var(--blue);box-shadow:0 0 6px rgba(96,165,250,.5)}
  .col.working .col-name i{background:var(--green);box-shadow:0 0 6px rgba(52,211,153,.5)}
  .col.blocked{background:rgba(248,113,113,.035);border-color:rgba(248,113,113,.2)}
  .col.blocked .col-name i{background:var(--red);box-shadow:0 0 6px var(--red-glow)}
  .col.done .col-name i{background:var(--green);opacity:.45}
  .acard{background:var(--panel-2);border:1px solid var(--border);border-top:1px solid var(--hl);border-radius:10px;padding:11px 12px;margin-bottom:9px;transition:all .17s ease-out;position:relative;overflow:hidden}
  .acard:last-child{margin-bottom:0}
  .acard:hover{transform:translateY(-2px);border-color:var(--border-strong)}
  .acard::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2.5px}
  .acard.w::before{background:var(--green);box-shadow:0 0 10px rgba(52,211,153,.4)}
  .acard.you::before{background:var(--red);box-shadow:0 0 10px var(--red-glow)}
  .acard.dept::before{background:var(--amber)}
  .acard.q::before{background:var(--blue)}
  .acard.i::before{background:#455}
  .acard.d::before{background:var(--green);opacity:.4}
  .acard.faded{opacity:.5}
  .acard-top{display:flex;align-items:center;gap:9px;margin-bottom:7px}
  .acard-av{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;flex-shrink:0;font-family:var(--font-display);font-weight:600;font-size:12px;border:1px solid var(--border)}
  .av-lead{background:rgba(251,191,36,.13);color:#FCD667} .av-coder{background:rgba(96,165,250,.13);color:#9DC4FB}
  .av-rev{background:rgba(34,211,238,.12);color:#7FE9F5} .av-research{background:rgba(137,154,177,.1);color:var(--muted)}
  .av-acct{background:rgba(137,154,177,.07);color:rgba(170,195,225,.3)} .av-boss{background:rgba(137,154,177,.12);color:#A9B6C9} .av-cos{background:var(--cyan-dim);color:#7FE9F5}
  .acard-name{font-family:var(--font-display);font-weight:600;font-size:13.5px;line-height:1.1}
  .acard-role{font-family:var(--font-mono);font-size:8.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
  .acard-task{font-size:12.5px;color:var(--text-2);line-height:1.45;margin-bottom:8px}
  .acard-task .muted{color:var(--muted)} .acard-task b{color:var(--text);font-weight:600}
  .wait-pill{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:7px;margin-bottom:8px;line-height:1.3;font-family:var(--font-mono);font-size:10.5px}
  .wait-pill.you{background:var(--red-dim);color:#FCA5A5} .wait-pill.dept{background:var(--amber-dim);color:#FCD667}
  .wait-pill .ar{opacity:.7;flex-shrink:0}
  .mini-track{display:flex;gap:3px;margin-bottom:8px}
  .mini-seg{flex:1;height:3.5px;border-radius:2px;background:rgba(255,255,255,.07)}
  .mini-seg.done{background:var(--green)} .mini-seg.active{background:var(--amber)}
  .mini-seg.gate{background:var(--red);animation:bl 1.5s infinite;box-shadow:0 0 7px var(--red-glow)}
  @keyframes bl{0%,100%{opacity:1}50%{opacity:.4}}
  .acard-foot{display:flex;align-items:center;gap:7px;justify-content:space-between}
  .acard-btn{font-family:var(--font-display);font-weight:500;font-size:10.5px;letter-spacing:.01em;padding:5px 12px;border-radius:6px;cursor:pointer;border:none;transition:all .15s;background:var(--cyan);color:#04222A;box-shadow:0 0 12px var(--cyan-glow)}
  .acard-btn:hover{background:#5EE3F5;transform:translateY(-1px)}
  .acard-time{font-family:var(--font-mono);font-size:9px;color:var(--muted)}
  /* review action cards (Reviews page, re-skinned) */
  .rcards{display:flex;flex-direction:column;gap:10px}
  .rcard{background:var(--card);border:1px solid var(--border);border-top:1px solid var(--hl);border-left:2.5px solid var(--cyan);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
  .rcard.b-google{border-left-color:var(--blue)} .rcard.b-tripadvisor{border-left-color:var(--green)} .rcard.b-opentable{border-left-color:#F0843E}
  .rcard-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .rbadge{font-family:var(--font-display);font-weight:600;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:5px}
  .rbadge.b-google{background:var(--blue);color:#04121f} .rbadge.b-tripadvisor{background:var(--green);color:#06281d} .rbadge.b-opentable{background:#F0843E;color:#241204}
  .rstars{color:var(--amber);font-size:13px;letter-spacing:.03em}
  .rwho{font-family:var(--font-display);font-weight:600;font-size:13px;color:var(--text)}
  .rdate{margin-left:auto;font-family:var(--font-mono);font-size:10px;color:var(--muted)}
  .rtext{font-size:13px;color:var(--text-2);line-height:1.45}
  .rtags{display:flex;flex-wrap:wrap;gap:4px}
  .rdraft{border:1px solid var(--border);border-radius:7px;background:rgba(52,211,153,.05)}
  .rdraft-lab{font-family:var(--font-display);font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--green);padding:6px 9px 2px}
  .rdraft-body{font-size:13px;color:var(--text-2);padding:0 9px 7px;white-space:pre-wrap;line-height:1.5}
  .rflag{font-family:var(--font-mono);font-size:10.5px;color:var(--amber)}
  .ract{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .ract .state{margin-left:auto;font-family:var(--font-mono);font-size:10px;color:var(--muted)}
  /* loop-closer rate bars (Issues page) */
  .rate-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden;position:relative}
  .rate-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px}
  .rate-bar i.before{background:var(--amber)} .rate-bar i.after{background:var(--green)}
  /* small input (log-action) */
  .field{width:100%;background:var(--panel-2);border:1px solid var(--border);border-radius:7px;color:var(--text);font-family:var(--font-body);font-size:13px;padding:8px 10px}
  .field:focus{outline:none;border-color:var(--cyan)}
  select.field{font-family:var(--font-mono);font-size:12px}
  footer{margin-top:22px;font-family:var(--font-mono);font-size:10px;color:var(--muted)}`;
}

// THE board-wide KPI tile (audit 2026-07-21 design change #3 — Reports' ATV tile is the template).
// One component so every headline number CAN carry its trend: standard tile markup + an optional
// sparkline under the sub. points = [{v}] oldest-first (any numeric scale — pence, %, stars);
// <2 real values renders NO svg (a one-point "trend" is noise, never faked). rulePence draws the
// dashed target line (same convention as the £38 QR rule). Delegates to reporting.svgSparkline —
// pure, tested, gap-aware (null points break the line rather than interpolate).
const REP = require('./reporting.js');
function sparkline(points, opts) {
  return REP.svgSparkline({ points: points || [], ...(opts || {}) });
}
function kpiTile({ tone = '', lab, val, sub = '', points = null, color = '#22D3EE', rulePence = null, width = 150, height = 34 }) {
  const spark = points ? sparkline(points, { color, rulePence, width, height }) : '';
  return `<div class="tile ${tone}"><div class="lab">${lab}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}${spark}</div>`;
}

module.exports = {
  escapeHtml,
  freshness,
  fmtTime,
  agoLabel,
  fmtGbpPence,
  fmtInt,
  kpiTile,
  sparkline,
  renderShell,
  renderSidebar,
  css,
  WORKSPACES,
  workspaceOf,
};
