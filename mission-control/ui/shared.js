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
    // Reports order (operator ruling 2026-07-22): Revenue, Labour, Costs, Reservations, Operations,
    // Inventory, Customer Growth, Kitchen Safety, Report Library. The standalone "Rota Review" nav item
    // was RETIRED in the same ruling — its full report (FORWARD/HINDSIGHT verdicts + per-daypart items +
    // run history) now lives as the Labour Centre's "Rota Review" tab; /coyote/rota-review 308-redirects
    // to /coyote/labour?tab=rota-review. The cadence timers still write to rota_review_runs, which that
    // tab reads.
    { group: 'Reports', items: [
      { key: 'revenue', label: 'Revenue', route: '/coyote/revenue', ico: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7"/><rect x="12" y="7" width="3" height="11"/><rect x="17" y="4" width="3" height="14"/>' },
      { key: 'labour', label: 'Labour', route: '/coyote/labour', ico: '<circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><path d="M15 20v-1a5 5 0 0 1 7-4.6"/>' },
      { key: 'costs', label: 'Costs', route: '/coyote/costs', ico: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
      { key: 'reservations', label: 'Reservations', route: '/coyote/reservations', ico: '<path d="M12 2a4 4 0 0 1 4 4c0 2.5-4 7-4 7s-4-4.5-4-7a4 4 0 0 1 4-4z"/><path d="M4 21h16M6 17h12"/>' },
      { key: 'operations', label: 'Operations', route: '/coyote/operations', ico: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>' },
      { key: 'inventory', label: 'Inventory', route: '/coyote/inventory', ico: '<path d="M20 7 12 3 4 7v10l8 4 8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>' },
      { key: 'customer-growth', label: 'Customer Growth', route: '/coyote/customer-growth', ico: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><path d="M16 3.5a3 3 0 0 1 0 5.8M18 20v-1a5 5 0 0 0-3-4.6"/>' },
      { key: 'kitchen-safety', label: 'Kitchen Safety', route: '/coyote/kitchen-safety', ico: '<path d="M12 2a3 3 0 0 1 3 3c0 1-.4 1.7-1 2.3V9h2a2 2 0 0 1 2 2v3a6 6 0 0 1-12 0v-3a2 2 0 0 1 2-2h2V7.3c-.6-.6-1-1.3-1-2.3a3 3 0 0 1 3-3z"/><path d="M6 21h12"/>' },
      { key: 'report-library', label: 'Report Library', route: '/coyote/report-library', ico: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h7"/>' },
      { key: 'files', label: 'Files', route: '/coyote/files', ico: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>' },
    ] },
    { group: 'Departments', items: [
      { key: 'recipes', label: 'Recipes & Costs', route: '/coyote/recipes', ico: '<path d="M5 3h11l3 3v15H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>' },
      { key: 'reviews', label: 'Reviews', route: '/coyote/reviews', ico: '<path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 21l-4.9 2.1.9-5.5-4-3.9 5.5-.8z"/>' },
      { key: 'issues', label: 'Issues', route: '/coyote/issues', ico: '<path d="M10.3 3.8 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>' },
    ] },
  ] },
  // readOnly stays TRUE: every board except Chat is read-only; Chat is the ONE sanctioned write
  // (a transport row — ruling mc-chat-approved). The sidebar note now names that carve-out.
  { key: 'claw', label: 'Claw', tag: 'Engine room', home: '/claw/engine', readOnly: true, groups: [
    { group: 'Console', items: [
      { key: 'engine', label: 'Engine', route: '/claw/engine', ico: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="17" r="2.5"/><path d="M12 10v3M9 15l-2 1M15 15l2 1"/>' },
      { key: 'chat', label: 'Chat', route: '/claw/chat', ico: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    ] },
  ] },
  // LIFE OS — the third workspace (pack v2.0.0; Phase-0 tap 2026-08-05). The readOnly flag
  // FLIPPED with the sole-writer command path (this PR + engine coyote-life-writer, operator
  // ruling 2026-08-05): writes flow ONLY as authenticated POST /api/life/* relayed over the
  // writer's Unix socket — MC still holds ZERO life.db write handles (test-pinned). Reads
  // stay on ui/pages/life/life-lib.js (read-only handle; the ONE file allowed to touch
  // life.db). v1 scope = Phases 0-3: Schedule/Agents/Settings (Graph-era surfaces) are
  // deliberately absent — a separate go/no-go adds them, not this registry.
  { key: 'life', label: 'Life OS', tag: 'Owner', home: '/life/today',
    groups: [
    { group: 'Focus', items: [
      { key: 'life-today', label: 'Today', route: '/life/today', ico: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>' },
      { key: 'life-waiting', label: 'Waiting for', route: '/life/waiting', ico: '<path d="M6 2h12M6 22h12M8 2v4l4 4 4-4V2M8 22v-4l4-4 4 4v4"/>' },
    ] },
    { group: 'Plan', items: [
      { key: 'life-outcomes', label: '12-week outcomes', route: '/life/outcomes', ico: '<path d="M4 22V3"/><path d="M4 4h13l-2.5 4L17 12H4"/>' },
      { key: 'life-projects', label: 'Projects', route: '/life/projects', ico: '<path d="M12 2 2 7l10 5 10-5z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/>' },
      { key: 'life-tasks', label: 'All tasks', route: '/life/tasks', ico: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M3.5 5.5 5 7l2.5-2.5M3.5 11.5 5 13l2.5-2.5M3.5 17.5 5 19l2.5-2.5"/>' },
      { key: 'life-schedule', label: 'Schedule', route: '/life/schedule', ico: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/>' },
    ] },
    { group: 'Review', items: [
      { key: 'life-review', label: 'Weekly review', route: '/life/review', ico: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/><path d="m9 15 2 2 4-4"/>' },
      { key: 'life-quarterly', label: 'Quarterly evolution', route: '/life/quarterly', ico: '<path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 5v7h7"/>' },
    ] },
    { group: 'System', items: [
      { key: 'life-trust', label: 'Trust & automation', route: '/life/trust', ico: '<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><path d="m8.5 11.5 2.5 2.5 4.5-4.5"/>' },
      { key: 'life-agents', label: 'Agent activity', route: '/life/agents', ico: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="17" r="2.5"/><path d="M12 10v3M9 15l-2 1M15 15l2 1"/>' },
      { key: 'life-settings', label: 'Settings', route: '/life/settings', ico: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>' },
    ] },
  ] },
];

// Resolve the active workspace from the active page key (falls back to the first workspace for '/').
function workspaceOf(activeKey) {
  return WORKSPACES.find((w) => w.groups.some((g) => g.items.some((it) => it.key === activeKey)))
    // Prefix fallback: routes that live in a workspace without a sidebar slot (the Life OS
    // task drawer, key 'life-task') still render their own workspace's shell.
    || WORKSPACES.find((w) => typeof activeKey === 'string' && activeKey.startsWith(`${w.key}-`))
    || WORKSPACES[0];
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
  // Per-workspace read-only note: claw keeps its original line verbatim (the default); a
  // workspace may carry its own `roNote` (Life OS explains its gated-writes posture).
  const ro = activeWs.readOnly ? `<div style="margin:2px 15px 4px;font-size:10px;color:var(--muted,#7a8)">${activeWs.roNote || 'read-only · actions via Telegram · chat = the front door'}</div>` : '';
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
<button class="lc-fab" data-lc-fab title="Capture a task (Ctrl/Cmd+K)" aria-label="Capture a task">＋</button>
<div class="lc-overlay" data-lc-overlay>
  <div class="lc-card" role="dialog" aria-modal="true" aria-label="Capture a task">
    <form class="lc-form">
      <input class="lc-input" type="text" maxlength="500" placeholder="Capture a task — Enter files it to your Inbox" autocomplete="off" enterkeyhint="done">
      <div class="lc-row">
        <select class="lc-domain" aria-label="Domain">
          <option value="general">general</option><option value="business">business</option>
          <option value="health">health</option><option value="family">family</option>
          <option value="admin">admin</option><option value="venture">venture</option>
        </select>
        <button type="submit" class="lc-btn">Capture</button>
        <button type="button" class="lc-btn lc-ghost" data-lc-close>Close</button>
      </div>
      <div class="lc-result" data-lc-result></div>
      <div class="lc-hint">Life OS → Inbox · OWNER_ONLY · via the gated command path — a failed capture says so, nothing queues silently</div>
    </form>
  </div>
</div>
<div class="lc-focus-overlay" data-lc-focus-overlay>
  <div class="lc-focus-card rcc" role="dialog" aria-modal="true" aria-label="Protected focus block">
    <div class="r-eyebrow hot">Protected focus block</div>
    <div style="font-size:22px;font-weight:650;line-height:1.25;margin:2px 0 8px" data-focus-title></div>
    <div style="font-size:13px;color:var(--rmuted,#9ea7b2);line-height:1.5;margin-bottom:10px">Messages stay closed. Work only on this until the definition of done below is met, or you exit.</div>
    <div class="r-defbox"><small>Definition of done</small><div style="font-size:13px;line-height:1.45" data-focus-dod></div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="r-btn" data-focus-exit>Exit focus</button>
      <button class="r-btn primary" data-focus-complete>Complete block</button>
    </div>
  </div>
</div>
<script>${clientScript()}${opts.clientScript || ''}</script>
</body></html>`;
}

// ============================================================================
// INPUT PROTECTION + OWNER-LANGUAGE REFUSALS (first-real-use defects, 2026-08-08)
//
// Defect 1 — the 30s shell refresh must never eat typing. TRUE = a field is in use:
// focused, or holding text/choices that differ from what the server rendered (defaultValue
// / defaultSelected / defaultChecked are the server-rendered baseline, so prefilled forms
// never wedge the refresh). Exported for behaviour tests AND serialized into the shell
// client script FROM THIS DEFINITION via toString() — one source, the test pins the bytes.
function formInUse(doc) {
  var ae = doc.activeElement;
  if (ae) {
    var at = String(ae.tagName || '').toUpperCase();
    if (at === 'INPUT' || at === 'TEXTAREA' || at === 'SELECT') return true;
  }
  var els = doc.querySelectorAll('input,textarea,select');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') {
      if (String(el.value || '') !== String(el.defaultValue || '')) return true;
    } else if (tag === 'SELECT') {
      var def = -1;
      for (var j = 0; j < el.options.length; j++) { if (el.options[j].defaultSelected) { def = j; break; } }
      if (def === -1 && el.options.length) def = 0;
      if (el.selectedIndex !== def) return true;
    } else {
      var ty = String(el.type || 'text').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio') {
        if (Boolean(el.checked) !== Boolean(el.defaultChecked)) return true;
      } else if (ty !== 'hidden' && ty !== 'button' && ty !== 'submit' && ty !== 'reset' && ty !== 'file' && ty !== 'range' && ty !== 'color') {
        if (String(el.value || '') !== String(el.defaultValue || '')) return true;
      }
    }
  }
  return false;
}

// MANUAL RECURRENCE (operator GO 2026-08-10): the next-occurrence date for a recurring
// obligation, advanced from its current due date by its cadence label. Month arithmetic
// clamps the day (31 Jan + 1 month = end of Feb) — statutory dates anchor to the
// calendar. Exported for tests AND serialized into the shell client from THIS definition
// (the formInUse pattern: one source, byte-pinned). Unknown labels default to one month —
// the prompt shows the date for editing, so a default is a suggestion, never a silent act.
function advanceCadence(cadence, fromDate) {
  var c = String(cadence || '').toLowerCase();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fromDate || ''));
  var y, mo, d;
  if (m) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; } else { var t = new Date(); y = t.getFullYear(); mo = t.getMonth(); d = t.getDate(); }
  function months(n) {
    var tm = mo + n, ty = y + Math.floor(tm / 12); tm = ((tm % 12) + 12) % 12;
    var last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tm, Math.min(d, last)));
  }
  function days(n) { return new Date(Date.UTC(y, mo, d + n)); }
  var wk = /every\s*(\d+)\s*week/.exec(c);
  var out;
  if (wk) out = days(7 * Number(wk[1]));
  else if (/fortnight/.test(c)) out = days(14);
  else if (/quarter/.test(c)) out = months(3);
  else if (/six[\s-]*month|6[\s-]*month/.test(c)) out = months(6);
  else if (/annual|year/.test(c)) out = months(12);
  else if (/month/.test(c)) out = months(1);
  else if (/week/.test(c)) out = days(7);
  else if (/daily|\bday\b/.test(c)) out = days(1);
  else out = months(1);
  return out.toISOString().slice(0, 10);
}

// Defect 2 — the writer speaks command vocabulary by design ('create_project:
// definitionOfDone required' is engineering truth); the OWNER surface translates before
// rendering. ONE table, two consumers: exported for the tripwire tests AND serialized
// verbatim into the shell client script (a test pins the serialization, so the shipped
// copy can never drift from the tested copy). Keys are lowercase fragments of the
// writer/trigger message, first match wins — order specific before generic. Values are
// the designed owner sentences: no command names, no field names, ever.
const LIFE_REFUSAL_COPY = [
  ['definitionofdone required', 'Every project needs a definition of done — how will you know it is finished?'],
  ['proofdefinition required', 'Every outcome needs its proof of completion — what evidence will exist when it is done?'],
  ['maximum three active outcomes', 'Three active outcomes is the ceiling — finish or park one to open the slot.'],
  ['maximum four active projects', 'Four active projects is the ceiling — finish or park one to open the slot.'],
  ['title too long', 'That name is too long — keep it under 200 characters.'],
  ['title required', 'Give it a name first.'],
  ['text too long', 'That update is too long — keep it under 4,000 characters.'],
  ['text required', 'Write the update first — plain words are enough.'],
  ['dependencylabel required', 'Say who or what you are waiting on.'],
  ['fallbackat required', 'A follow-up date is needed — waiting work must never rot silently.'],
  ['wake condition', 'Parking work as waiting needs who it waits on and a follow-up date.'],
  ['pick a living one', 'That project was cancelled — pick a living one.'],
  ['does not take new tasks', 'That project is finished — completed work does not take new tasks.'],
  ['only inbox work needs accepting', 'Already decided — only Inbox work needs accepting.'],
  ['recurring obligation', 'This one repeats — give it its next date, or decline it so the drop is on the record.'],
  ['nothing to recapture', 'That task does not repeat — complete it plainly.'],
  ['in the import inbox', 'That file is not in the import inbox — drop it into ~/life-os-imports and try again.'],
  ['over the 5 mb cap', 'That file is too big — keep imports under 5 MB.'],
  ['could not read', 'That file could not be read — is it a real .csv or .xlsx export?'],
  ['halt engaged', 'Everything is paused right now — nothing was changed. Try again once things resume.'],
  ['no such task', 'That task is not here any more — the page may be out of date; it refreshes itself shortly.'],
  ['no such project', 'That project is not here any more — the page may be out of date; it refreshes itself shortly.'],
  ['keeps its name', 'Finished work keeps its name — it is part of the record now.'],
  ['project is done', 'A finished project stays finished — completed work is not erased.'],
  ['task is done', 'Finished work stays finished — reopen it from its page if it truly is not done.'],
  ['not finished', 'Only finished work can be reopened.'],
  ['too long', 'That text is over the length limit — trim it and try again.'],
];
const LIFE_REFUSAL_FALLBACK = 'That did not go through — nothing was changed. Adjust and try again.';
function ownerRefusalCopy(raw) {
  const s = String(raw == null ? '' : raw).toLowerCase();
  const hit = LIFE_REFUSAL_COPY.find(([k]) => s.includes(k));
  return hit ? hit[1] : LIFE_REFUSAL_FALLBACK;
}
// The client-side twin: same table (serialized), same first-match-wins walk. The raw
// writer message still goes to console.warn at the call sites — engineering truth stays
// available to a debugger, it just never renders as owner copy.
function ownerRefusalCopyClient() {
  return `function(raw){var M=${JSON.stringify(LIFE_REFUSAL_COPY)};raw=String(raw==null?'':raw).toLowerCase();for(var i=0;i<M.length;i++){if(raw.indexOf(M[i][0])!==-1)return M[i][1];}return ${JSON.stringify(LIFE_REFUSAL_FALLBACK)};}`;
}

// Shared client script: localise <time data-ms>, the action-queue interactions (copy/filter/safe-write
// POST — see reviews/issues pages), and a soft 30s refresh.
function clientScript() {
  return `
  for (const el of document.querySelectorAll('time[data-ms]')) { const ms=Number(el.dataset.ms); if(Number.isFinite(ms)&&ms>0) el.textContent=new Date(ms).toLocaleString(); }
  // INPUT PROTECTION (defect 1, 2026-08-08): the 30s refresh WAITS while any field is in
  // use, and in-form fields keep a per-tab draft so F5 or navigation mid-type loses
  // nothing. PRIVACY CALL: drafts live ONLY in this tab's sessionStorage — this browser,
  // this tab, erased when the tab closes; typed-but-unsaved text is never written to
  // life.db or any server store. A successful submit clears the draft; a refusal keeps
  // it (the owner is still editing).
  window.__lcFormBusy=(${formInUse.toString()});
  window.__lcNextDate=(${advanceCadence.toString()});
  window.__lcOwnerCopy=(${ownerRefusalCopyClient()});
  window.__lcNet='Connection lost — nothing was changed. Try again in a moment.';
  window.__lcSay=function(near,msg,ok){try{var host=near&&near.closest?(near.closest('form')||near.closest('.r-card')||near.closest('.lc-focus-card')||near.closest('.lc-card')||near.parentNode):null;if(!host)return;var el=host.querySelector('[data-lc-msg]');if(!el){el=document.createElement('div');el.setAttribute('data-lc-msg','');host.appendChild(el);}el.className='lc-result '+(ok?'lc-ok':'lc-err');el.textContent=msg;}catch(_){}};
  window.__lcRefuse=function(near,raw){if(window.console&&console.warn)console.warn('life write refused:',raw);window.__lcSay(near,window.__lcOwnerCopy(raw));};
  (function(){
    function base(el){var t=String(el.tagName||'').toUpperCase();if(t==='SELECT'){for(var j=0;j<el.options.length;j++){if(el.options[j].defaultSelected)return el.options[j].value;}return el.options.length?el.options[0].value:'';}return String(el.defaultValue||'');}
    function draftable(el){if(!el||!el.tagName||!el.closest||!el.closest('form'))return false;var t=el.tagName.toUpperCase();if(t==='TEXTAREA'||t==='SELECT')return true;if(t!=='INPUT')return false;var ty=String(el.type||'text').toLowerCase();return ['text','search','email','url','tel','number','date'].indexOf(ty)!==-1;}
    function keyOf(el){var f=el.closest('form');var fk=f.getAttribute('data-kind')||f.getAttribute('data-task')||f.className||'form';return 'lcDraft:'+location.pathname+':'+fk+':'+(el.name||el.id||el.className||'field');}
    window.__lcDraftClear=function(scope){try{var els=scope&&scope.querySelectorAll?scope.querySelectorAll('input,textarea,select'):[];for(var i=0;i<els.length;i++){if(draftable(els[i]))sessionStorage.removeItem(keyOf(els[i]));}}catch(_){}};
    function save(e){var el=e.target;if(!draftable(el))return;try{var k=keyOf(el);var v=String(el.value||'');if(v===base(el))sessionStorage.removeItem(k);else sessionStorage.setItem(k,v);}catch(_){}}
    document.addEventListener('input',save,true);
    document.addEventListener('change',save,true);
    try{
      var els=document.querySelectorAll('input,textarea,select');
      for(var i=0;i<els.length;i++){var el=els[i];if(!draftable(el))continue;var k=keyOf(el);var d=sessionStorage.getItem(k);if(d===null)continue;
        if(d===base(el)){sessionStorage.removeItem(k);continue;}
        if(String(el.value||'')!==base(el))continue;
        el.value=d;try{el.dispatchEvent(new Event('input',{bubbles:true}));}catch(_){}}
    }catch(_){}
  })();
  let aqBusy=false;
  document.addEventListener('click',(e)=>{const t=e.target; if(!t||!t.closest)return;
    if(t.hasAttribute('data-copy')){const card=t.closest('[data-card]'); const body=card&&card.querySelector('[data-draft]'); if(body&&navigator.clipboard){navigator.clipboard.writeText(body.textContent).then(()=>{const p=t.textContent;t.textContent='Copied ✓';setTimeout(()=>{t.textContent=p;},1500);}).catch(()=>{});} return;}
    if(t.hasAttribute('data-filter')){const f=t.getAttribute('data-filter')||''; for(const card of document.querySelectorAll('[data-issues]')){const xs=(card.getAttribute('data-issues')||'').split(' '); card.style.display=(!f||xs.indexOf(f)!==-1)?'':'none';} return;}
    if(t.hasAttribute('data-op')){const wrap=t.closest('[data-review]'); const id=wrap&&wrap.getAttribute('data-review'); if(!id||aqBusy)return; aqBusy=true;t.disabled=true; const p={op:t.getAttribute('data-op'),review_id:id}; if(p.op==='snooze')p.hours=24; fetch('/api/review-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)}).then(r=>r.json()).then(()=>location.reload()).catch(()=>{aqBusy=false;t.disabled=false;}); return;}
    if(t.hasAttribute('data-log-action')){const form=t.closest('[data-log-form]'); if(!form||aqBusy)return; const code=form.querySelector('[name=issue_code]').value; const action=(form.querySelector('[name=action_taken]').value||'').trim(); if(!action){return;} aqBusy=true;t.disabled=true; fetch('/api/review-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'log_action',issue_code:code,action_taken:action,action_date:Date.now()})}).then(r=>r.json()).then(()=>location.reload()).catch(()=>{aqBusy=false;t.disabled=false;}); return;}
    if(t.classList&&t.classList.contains('rc-import-btn')){const box=t.closest('[data-kind]'); const file=box&&box.querySelector('input[type=file]'); const out=box.querySelector('.rc-result'); if(!file||!file.files||!file.files[0]){if(out)out.textContent='choose a CSV first';return;} const kind=box.getAttribute('data-kind'); const rd=new FileReader(); rd.onload=function(){ if(out)out.textContent='importing…'; fetch('/api/recipe-import?kind='+encodeURIComponent(kind),{method:'POST',headers:{'content-type':'text/csv'},body:rd.result}).then(r=>r.json()).then(r=>{ if(r&&r.ok){ if(out)out.textContent='imported '+r.imported+(r.rejected&&r.rejected.length?(' · '+r.rejected.length+' rejected'):''); setTimeout(()=>location.reload(),900);} else { if(out)out.textContent='failed: '+((r&&r.error)||'unknown'); } }).catch(()=>{if(out)out.textContent='network error';}); }; rd.readAsText(file.files[0]); return;}
  });
  // BOM (Recipes & Costs) — gated edits: submit an rc-form to POST /api/recipe-action (the closed allowlist).
  document.addEventListener('submit',(e)=>{const f=e.target; if(!f||!f.classList||!f.classList.contains('rc-form'))return; e.preventDefault(); if(aqBusy)return; const kind=f.getAttribute('data-rc'); const d={}; new FormData(f).forEach((v,k)=>{d[k]=v;}); let body; if(kind==='sub_item'){body={op:'upsert_sub_item',id:d.id,name:d.name,supplier:d.supplier,pack_description:d.pack_description,pack_cost_pence:(d.pack_cost===''||d.pack_cost==null)?null:Math.round(parseFloat(d.pack_cost)*100),pack_qty:(d.pack_qty===''?null:d.pack_qty),unit_of_measure:d.unit_of_measure};}else{body={op:'set_recipe_line',product_id:d.product_id,sub_item_id:d.sub_item_id,quantity:d.quantity};} aqBusy=true; fetch('/api/recipe-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).then(r=>{aqBusy=false; if(r&&r.ok){location.reload();}else{window.__lcSay(f,'Rejected: '+((r&&r.error)||'unknown'));}}).catch(()=>{aqBusy=false;window.__lcSay(f,window.__lcNet);}); });
  (function(){
    function ru(file){var out=document.querySelector('[data-res-result]');if(!file)return;
      if(!/\\.csv$/i.test(file.name)){if(out)out.innerHTML='<span class="res-bad">only .csv files are accepted</span>';return;}
      if(file.size>26214400){if(out)out.innerHTML='<span class="res-bad">file too large (max 25 MB)</span>';return;}
      if(out)out.innerHTML='<span class="res-busy">uploading & ingesting '+file.name+'…</span>';
      fetch('/api/reservations-upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':'text/csv'},body:file}).then(function(r){return r.json();}).then(function(r){
        if(!r||!r.ok){if(out)out.innerHTML='<span class="res-bad">refused: '+((r&&r.error)||'unknown')+'</span>';return;}
        var range=r.date_from?(' ('+r.date_from+'..'+r.date_to+')'):'';var cov=(r.covers!=null)?(' · '+r.covers+' covers'):'';var m;
        if(r.duplicate){m='<span class="res-ok">already ingested — no-op</span> · '+(r.rows_written||0)+' rows'+range;}
        else if(r.queued){m='<span class="res-ok">saved to inbox</span> · '+(r.message||'');}
        else if(r.status==='ok'){m='<span class="res-ok">ingested ✓</span> '+(r.rows_written||0)+' rows'+range+cov;}
        else if(r.status==='quarantined'){m='<span class="res-bad">quarantined</span> — '+(r.detail||'malformed');}
        else{m='<span class="res-busy">'+(r.status||'processing')+'</span> '+(r.message||'');}
        if(out)out.innerHTML=m; if(r.status==='ok'||r.duplicate){setTimeout(function(){location.reload();},1500);}
      }).catch(function(){if(out)out.innerHTML='<span class="res-bad">network error</span>';});}
    document.addEventListener('click',function(e){var t=e.target;if(t&&t.closest&&t.closest('[data-res-browse]')){e.preventDefault();var f=document.querySelector('.res-file');if(f)f.click();}});
    document.addEventListener('change',function(e){var t=e.target;if(t&&t.classList&&t.classList.contains('res-file')&&t.files&&t.files[0])ru(t.files[0]);});
    ['dragover','dragenter'].forEach(function(ev){document.addEventListener(ev,function(e){var dz=e.target&&e.target.closest&&e.target.closest('[data-res-dropzone]');if(dz){e.preventDefault();dz.classList.add('res-over');}});});
    document.addEventListener('dragleave',function(e){var dz=e.target&&e.target.closest&&e.target.closest('[data-res-dropzone]');if(dz)dz.classList.remove('res-over');});
    document.addEventListener('drop',function(e){var dz=e.target&&e.target.closest&&e.target.closest('[data-res-dropzone]');if(dz){e.preventDefault();dz.classList.remove('res-over');var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)ru(f);}});
  })();
  // Soft refresh (defect-1 fix 2026-08-08): re-arms and re-checks every 30s; reloads ONLY
  // when no overlay is open, no field is in use (focused or holding unsaved text —
  // window.__lcFormBusy above, test-pinned) and nothing has pinned the page open
  // (__lcHoldRefresh: an import preview/report the operator is still reading).
  if(!document.querySelector('[data-chat-page]')) (function(){var arm=function(){setTimeout(function(){if(window.__lcOpen||window.__lcHoldRefresh||window.__lcFormBusy(document)){arm();return;}location.reload();},30000);};arm();})();
  // LIFE OS global capture (A5): the FAB or Ctrl/Cmd+K opens; Enter files to the Inbox via the
  // gated command path. The idempotency key is generated per attempt-series (getRandomValues —
  // available on the http tailnet where crypto.randomUUID is not), so a retried submit can
  // never double-create; the key renews only after a success.
  (function(){
    var ov=document.querySelector('[data-lc-overlay]'); if(!ov) return;
    var inp=ov.querySelector('.lc-input'); var dom=ov.querySelector('.lc-domain');
    var out=ov.querySelector('[data-lc-result]'); var busy=false; var key=null;
    function hex(){var a=new Uint8Array(16);crypto.getRandomValues(a);var o='';for(var i=0;i<a.length;i++){o+=('0'+a[i].toString(16)).slice(-2);}return o;}
    function open(){ov.classList.add('lc-open');window.__lcOpen=true;out.className='lc-result';out.textContent='';setTimeout(function(){inp.focus();},50);}
    function close(){ov.classList.remove('lc-open');window.__lcOpen=false;}
    // PAGE-CONTEXT FAB (operator report 2026-08-10: "+ on Projects made a task"): a page may
    // mark ONE element [data-fab-target="label"] as what the floating + means HERE (Projects →
    // the add-project form; a project drawer → its add-task form). The + then scrolls/focuses
    // that element and takes the marker's label as its tooltip. Inline "Capture…" buttons and
    // Ctrl/Cmd+K still mean capture-a-task everywhere; no marker = + captures, unchanged.
    var fabTarget=document.querySelector('[data-fab-target]');
    var fabBtn=document.querySelector('.lc-fab');
    if(fabTarget&&fabBtn){var fl=fabTarget.getAttribute('data-fab-target')||'Add';fabBtn.title=fl;fabBtn.setAttribute('aria-label',fl);}
    document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
      if(t.closest('.lc-fab')&&fabTarget){e.preventDefault();
        fabTarget.scrollIntoView({behavior:'smooth',block:'center'});
        var fi=fabTarget.querySelector('input,textarea');if(fi)setTimeout(function(){fi.focus({preventScroll:true});},250);
        return;}
      if(t.closest('[data-lc-fab]')){e.preventDefault();open();return;}
      if(t===ov){close();return;}
      if(t.closest('[data-lc-close]')){e.preventDefault();close();return;}
      var cx=t.closest('[data-lc-cancel]');
      if(cx){e.preventDefault();if(busy)return;busy=true;cx.disabled=true;
        fetch('/api/life/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:cx.getAttribute('data-lc-cancel'),idempotencyKey:hex()})})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok){location.reload();}else{busy=false;cx.disabled=false;window.__lcRefuse(cx,r&&r.error);}})
        .catch(function(){busy=false;cx.disabled=false;window.__lcSay(cx,window.__lcNet);});
        return;}
    });
    document.addEventListener('keydown',function(e){
      if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){e.preventDefault();open();return;}
      if(e.key==='Escape'&&ov.classList.contains('lc-open')){close();}
    });
    ov.querySelector('.lc-form').addEventListener('submit',function(e){
      e.preventDefault(); if(busy)return;
      var title=(inp.value||'').trim();
      if(!title){out.className='lc-result lc-err';out.textContent='Give it a name first.';return;}
      if(!key)key=hex();
      busy=true;out.className='lc-result lc-busy';out.textContent='capturing…';
      fetch('/api/life/capture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:title,domainKey:dom.value,idempotencyKey:key})})
      .then(function(r){return r.json();}).then(function(r){busy=false;
        if(r&&r.ok){key=null;inp.value='';window.__lcDraftClear(e.target);out.className='lc-result lc-ok';
          out.innerHTML='captured ✓ — in your Inbox · <a href="/life/today">open Today</a>';
          if(location.pathname==='/life/today'){setTimeout(function(){location.reload();},700);}
        } else {if(window.console&&console.warn)console.warn('life write refused:',r&&r.error);out.className='lc-result lc-err';out.textContent=window.__lcOwnerCopy(r&&r.error);}
      }).catch(function(){busy=false;out.className='lc-result lc-err';out.textContent='Connection lost — NOT captured. Safe to try again: a retry can never create a duplicate.';});
    });
    // PLANNER ACTIONS (A6-A13): any [data-lc-cmd] button carries its full command as JSON;
    // the handler adds a fresh idempotency key, posts to the allowlisted relay, reloads on
    // success and ALERTS the writer's named error on refusal — nothing silent either way.
    document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
      var b=t.closest('[data-lc-cmd]');
      if(b){e.preventDefault();if(busy)return;busy=true;b.disabled=true;
        var cmd;try{cmd=JSON.parse(b.getAttribute('data-lc-cmd'));}catch(_){busy=false;b.disabled=false;return;}
        cmd.idempotencyKey=hex();
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(cmd)})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok){location.reload();}else{busy=false;b.disabled=false;window.__lcRefuse(b,r&&r.error);}})
        .catch(function(){busy=false;b.disabled=false;window.__lcSay(b,window.__lcNet);});
        return;}
      // MAIL PROPOSAL EDIT (Graph Stage C 2026-08-11): the owner rewords what a mail
      // proposal would create before accepting it. The edit is MERGED engine-side over the
      // original command, so the message the proposal came from stays attached to it.
      var me=t.closest('[data-lc-mailedit]');
      if(me){e.preventDefault();if(busy)return;
        var mi;try{mi=JSON.parse(me.getAttribute('data-lc-mailedit'));}catch(_){return;}
        var lbl=mi.kind==='create_project'?'Project name':'Task title';
        var nt=prompt(lbl+' — edit it, then OK accepts with your wording:',mi.title||'');
        if(nt===null)return;
        nt=nt.trim();
        if(!nt){window.__lcSay(me,'A name is needed — nothing was accepted.');return;}
        busy=true;me.disabled=true;
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'decide',idempotencyKey:hex(),payload:{proposalId:mi.proposalId,decision:'edit',editedCommand:{title:nt}}})})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok){location.reload();}else{busy=false;me.disabled=false;window.__lcRefuse(me,r&&r.error);}})
        .catch(function(){busy=false;me.disabled=false;window.__lcSay(me,window.__lcNet);});
        return;}
      var dn=t.closest('[data-lc-complete]');
      if(dn){e.preventDefault();if(busy)return;
        var ev=prompt('Closure evidence (what proves it done?) — optional for low-risk tasks:','');
        if(ev===null)return;
        var pay={taskId:dn.getAttribute('data-lc-complete')};if(ev.trim())pay.evidenceNote=ev.trim();
        // RECURRING OBLIGATION (operator GO 2026-08-10): the completion flow offers the
        // next occurrence prefilled — OK keeps it alive; dismissing is allowed but goes
        // through one named confirm and lands as an AUDITED decline, never an accident.
        var rc=dn.getAttribute('data-lc-recap');
        if(rc){var ri2;try{ri2=JSON.parse(rc);}catch(_){ri2={};}
          var nx=window.__lcNextDate(ri2.cadence,ri2.due);
          var ans=prompt('Recurring obligation ('+(ri2.cadence||'repeats')+'). OK captures the next one on this date — edit if needed:',nx);
          if(ans===null){
            if(!confirm('Decline the recapture? This obligation will NOT come back — the drop goes on the record.'))return;
            pay.declineRecapture=true;
          } else {
            ans=ans.trim();
            if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(ans)){window.__lcSay(dn,'Use a date like 2026-09-01 — nothing was completed.');return;}
            pay.recapture={nextDate:ans};
          }
        }
        busy=true;dn.disabled=true;
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'complete',idempotencyKey:hex(),payload:pay})})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok){location.reload();}else{busy=false;dn.disabled=false;window.__lcRefuse(dn,r&&r.error);}})
        .catch(function(){busy=false;dn.disabled=false;window.__lcSay(dn,window.__lcNet);});
        return;}
      var wt=t.closest('[data-lc-wait]');
      if(wt){e.preventDefault();if(busy)return;
        var dep=prompt('Waiting on (who/what):','');if(dep===null||!dep.trim())return;
        // WAKE TYPE (Graph Stage C 2026-08-11): waiting on an EMAIL REPLY is the commonest
        // kind of waiting, and now that the inbox is mirrored the triage rail can actually
        // propose the wake when the reply lands. Recording it as HUMAN_UPDATE would make the
        // record lie about what the task is waiting for — so the owner is asked, once.
        var byEmail=confirm('Are you waiting on an EMAIL REPLY?\\n\\nOK — the inbox is watched and a matching reply will offer to wake this task.\\nCancel — you will wake it yourself.');
        var fb2=prompt('Fallback date (YYYY-MM-DD) — required:','');if(fb2===null)return;
        if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(fb2)){window.__lcSay(wt,'A follow-up date like 2026-09-01 is needed — waiting work must never rot silently.');return;}
        busy=true;wt.disabled=true;
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'set_waiting',idempotencyKey:hex(),payload:{taskId:wt.getAttribute('data-lc-wait'),dependencyLabel:dep.trim(),wakeType:byEmail?'EMAIL_REPLY':'HUMAN_UPDATE',fallbackAt:fb2+'T09:00:00.000Z'}})})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok){location.reload();}else{busy=false;wt.disabled=false;window.__lcRefuse(wt,r&&r.error);}})
        .catch(function(){busy=false;wt.disabled=false;window.__lcSay(wt,window.__lcNet);});
        return;}
      // RENAME (operator ask 2026-08-08): one control edits a task's or project's name in
      // place — prompt prefilled with the current name, writer re-validates, refusals
      // render inline in owner language like every other path.
      var rn=t.closest('[data-lc-rename]');
      if(rn){e.preventDefault();if(busy)return;
        var ri;try{ri=JSON.parse(rn.getAttribute('data-lc-rename'));}catch(_){return;}
        var nt=prompt('New name:',ri.title||'');if(nt===null)return;nt=nt.trim();
        if(!nt){window.__lcSay(rn,'Give it a name first.');return;}
        busy=true;rn.disabled=true;
        var rc=ri.kind==='project'
          ?{command:'rename_project',idempotencyKey:hex(),payload:{projectId:ri.id,title:nt}}
          :{command:'rename_task',idempotencyKey:hex(),payload:{taskId:ri.id,title:nt}};
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(rc)})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok){location.reload();}else{busy=false;rn.disabled=false;window.__lcRefuse(rn,r&&r.error);}})
        .catch(function(){busy=false;rn.disabled=false;window.__lcSay(rn,window.__lcNet);});
        return;}
      // DELETE a project = cancel_project (mirrors task cancel): one confirm names what
      // happens to its tasks, then the gated command path. DONE projects refuse by name.
      var cp=t.closest('[data-lc-cancel-project]');
      if(cp){e.preventDefault();if(busy)return;
        if(!confirm('Cancel this project? Its tasks stay in All tasks — cancel any of those separately.'))return;
        busy=true;cp.disabled=true;
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'cancel_project',idempotencyKey:hex(),payload:{projectId:cp.getAttribute('data-lc-cancel-project')}})})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok){location.reload();}else{busy=false;cp.disabled=false;window.__lcRefuse(cp,r&&r.error);}})
        .catch(function(){busy=false;cp.disabled=false;window.__lcSay(cp,window.__lcNet);});
        return;}
      var ed=t.closest('[data-lc-edit]');
      if(ed){e.preventDefault();if(busy)return;
        var info;try{info=JSON.parse(ed.getAttribute('data-lc-edit'));}catch(_){return;}
        var label=prompt('Waiting on (dependency label):',info.dependencyLabel||'');if(label===null)return;
        var fb=prompt('Fallback date (YYYY-MM-DD) — required:',(info.fallbackAt||'').slice(0,10));if(fb===null)return;
        if(!fb){window.__lcSay(ed,'A follow-up date is needed — waiting work must never rot silently.');return;}
        busy=true;ed.disabled=true;
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
          command:'decide',idempotencyKey:hex(),
          payload:{proposalId:info.proposalId,decision:'edit',editedCommand:{dependencyLabel:label,wakeType:info.wakeType||'HUMAN_UPDATE',fallbackAt:fb}}})})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok){location.reload();}else{busy=false;ed.disabled=false;window.__lcRefuse(ed,r&&r.error);}})
        .catch(function(){busy=false;ed.disabled=false;window.__lcSay(ed,window.__lcNet);});
        return;}
    });
    // Add-outcome / add-project forms (golden Add actions): named inputs → the create command.
    document.addEventListener('submit',function(e){var f=e.target;
      if(!f||!f.classList||!f.classList.contains('lc-create-form'))return;
      e.preventDefault();if(busy)return;
      var kind=f.getAttribute('data-kind');var d={};new FormData(f).forEach(function(v,k){d[k]=v;});
      // TASK INTO A PROJECT (operator ask 2026-08-10): from a project's own page, a new task
      // lands HOMED, not in the Inbox — capture, then assign_project on the returned id (the
      // writer moves a homed Inbox task to READY itself; both legs idempotent on one key).
      // If homing fails after capture, the truth is told: the task exists, in the Inbox.
      if(kind==='project-task'){
        var pjId=f.getAttribute('data-project');
        var pjTitle=(d.title||'').trim();
        if(!pjTitle){window.__lcSay(f,'Give it a name first.');return;}
        busy=true;
        var ck=hex();
        fetch('/api/life/capture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:pjTitle,domainKey:(d.domain||'general'),idempotencyKey:ck})})
        .then(function(r){return r.json();}).then(function(r){
          if(!(r&&r.ok&&r.result&&r.result.id)){busy=false;window.__lcRefuse(f,r&&r.error);return;}
          fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'assign_project',idempotencyKey:ck.slice(0,24)+':home',payload:{taskId:r.result.id,projectId:pjId}})})
          .then(function(r2){return r2.json();}).then(function(r2){busy=false;
            if(r2&&r2.ok){window.__lcDraftClear(f);location.reload();}
            else{window.__lcSay(f,'Captured, but homing it here failed — the task is in your Inbox. '+((r2&&r2.error)||''));}})
          .catch(function(){busy=false;window.__lcSay(f,'Captured, but homing it here failed — the task is in your Inbox.');});
        })
        .catch(function(){busy=false;window.__lcSay(f,'Connection lost — nothing was created. Try again in a moment.');});
        return;}
      var payload,command;
      if(kind==='outcome'){command='create_outcome';payload={title:(d.title||'').trim(),proofDefinition:(d.proof||'').trim(),domainKey:(d.domain||'general'),activate:true};}
      else{command='create_project';payload={title:(d.title||'').trim(),definitionOfDone:(d.dod||'').trim(),domainKey:(d.domain||'general')};if(d.parked)payload.parked=true;}
      if(!payload.title){window.__lcSay(f,'Give it a name first.');return;}
      busy=true;
      fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:command,idempotencyKey:hex(),payload:payload})})
      .then(function(r){return r.json();}).then(function(r){busy=false;if(r&&r.ok){window.__lcDraftClear(f);location.reload();}else{window.__lcRefuse(f,r&&r.error);}})
      .catch(function(){busy=false;window.__lcSay(f,'Connection lost — nothing was created. Try again in a moment.');});
    });
    // Add-note form (task drawer): textarea + record-only checkbox → the note command.
    document.addEventListener('submit',function(e){var f=e.target;
      if(!f||!f.classList||!f.classList.contains('lc-note-form'))return;
      e.preventDefault();if(busy)return;
      var txt=(f.querySelector('[name=text]').value||'').trim();
      if(!txt){window.__lcSay(f,'Write the update first — plain words are enough.');return;}
      busy=true;
      fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        command:'note',idempotencyKey:hex(),
        payload:{taskId:f.getAttribute('data-task'),text:txt,recordOnly:!!(f.querySelector('[name=record_only]')||{}).checked}})})
      .then(function(r){return r.json();}).then(function(r){busy=false;if(r&&r.ok){window.__lcDraftClear(f);location.reload();}else{window.__lcRefuse(f,r&&r.error);}})
      .catch(function(){busy=false;window.__lcSay(f,'Connection lost — the update was not saved. Try again in a moment.');});
    });
    // A3: execution-route control — a [data-lc-route] <select> posts set_route on change.
    document.addEventListener('change',function(e){var el=e.target;
      if(!el||!el.classList||!el.classList.contains('lc-route-sel'))return;
      if(busy)return;busy=true;
      fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        command:'set_route',idempotencyKey:hex(),payload:{taskId:el.getAttribute('data-task'),mode:el.value}})})
      .then(function(r){return r.json();}).then(function(r){busy=false;if(r&&r.ok){location.reload();}else{window.__lcRefuse(el,r&&r.error);}})
      .catch(function(){busy=false;window.__lcSay(el,window.__lcNet);});
    });
    // TASK → PROJECT ASSIGNMENT (triage ruling 2026-08-10): .lc-assign-sel posts
    // assign_project on change ('' clears). The bulk button is SUGAR over per-task audited
    // commands — every visible row gets its own command, key and events; the writer knows
    // nothing of "bulk".
    document.addEventListener('change',function(e){var el=e.target;
      if(!el||!el.classList||!el.classList.contains('lc-assign-sel'))return;
      if(busy)return;busy=true;
      fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        command:'assign_project',idempotencyKey:hex(),payload:{taskId:el.getAttribute('data-task'),projectId:el.value||null}})})
      .then(function(r){return r.json();}).then(function(r){busy=false;if(r&&r.ok){location.reload();}else{window.__lcRefuse(el,r&&r.error);}})
      .catch(function(){busy=false;window.__lcSay(el,window.__lcNet);});
    });
    document.addEventListener('click',function(e){var t2=e.target;if(!t2||!t2.closest)return;
      var bk=t2.closest('[data-lc-assign-bulk]');
      if(!bk)return;e.preventDefault();if(busy)return;
      var sel=document.querySelector('[data-assign-bulk-sel]');
      var pid=sel?sel.value:'';
      if(!pid){window.__lcSay(bk,'Pick the project first — the bulk button assigns every visible row to it.');return;}
      var pname=sel.options[sel.selectedIndex].textContent;
      var rows=[];var all=document.querySelectorAll('[data-task-row][data-task-id]');
      for(var i=0;i<all.length;i++){if(all[i].style.display!=='none')rows.push(all[i].getAttribute('data-task-id'));}
      if(!rows.length){window.__lcSay(bk,'No visible rows — clear or change the filter.');return;}
      if(!confirm('Assign '+rows.length+' visible task'+(rows.length===1?'':'s')+' to '+pname+'? Each gets its own record.'))return;
      busy=true;bk.disabled=true;
      var done2=0,failed=0;
      (function next(idx){
        if(idx>=rows.length){busy=false;window.__lcHoldRefresh=false;location.reload();return;}
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
          command:'assign_project',idempotencyKey:hex(),payload:{taskId:rows[idx],projectId:pid}})})
        .then(function(r){return r.json();}).then(function(r){if(r&&r.ok)done2++;else{failed++;if(window.console)console.warn('bulk assign refused:',r&&r.error);}
          window.__lcHoldRefresh=true;window.__lcSay(bk,'Assigning… '+(done2+failed)+' of '+rows.length+(failed?(' ('+failed+' refused)'):''),!failed);
          next(idx+1);})
        .catch(function(){failed++;next(idx+1);});
      })(0);
      return;
    });
    // A3: quiet-support toggle in Settings — a [data-lc-quiet] control posts set_setting.
    document.addEventListener('click',function(e){var el=e.target&&e.target.closest&&e.target.closest('[data-lc-quiet]');
      if(!el)return;e.preventDefault();if(busy)return;busy=true;
      var next=el.getAttribute('data-lc-quiet')==='on'?'off':'on';
      fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        command:'set_setting',idempotencyKey:hex(),payload:{key:'quiet_support',value:next}})})
      .then(function(r){return r.json();}).then(function(r){busy=false;if(r&&r.ok){location.reload();}else{window.__lcRefuse(el,r&&r.error);}})
      .catch(function(){busy=false;window.__lcSay(el,window.__lcNet);});
    });
    // BULK IMPORT (operator brief 2026-08-08): Preview → per-row rulings → Commit, all on
    // the gated relay; the writer re-parses the file and re-validates, preview writes
    // NOTHING. Every file-derived string renders via textContent — an imported title can
    // never inject markup. __lcHoldRefresh pins the page while a preview/report is up.
    function iEl(tag,style,text){var el=document.createElement(tag);if(style)el.setAttribute('style',style);if(text!=null)el.textContent=text;return el;}
    function impPost(payload,onOk,anchor){busy=true;
      fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json();}).then(function(r){busy=false;if(r&&r.ok){onOk(r.result);}else{window.__lcRefuse(anchor,r&&r.error);}})
      .catch(function(){busy=false;window.__lcSay(anchor,window.__lcNet);});}
    function impPreviewRender(file,plan){
      var out=document.querySelector('[data-import-out]');if(!out)return;
      window.__lcHoldRefresh=true;window.__impPlan=plan;out.textContent='';
      var box=iEl('div','border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:12px;');
      box.appendChild(iEl('div','font-weight:650;font-size:14px;margin-bottom:6px','Preview — '+file+' (nothing is created yet)'));
      var pj=plan.project;
      var full=plan.capacity&&plan.capacity.activeProjects>=plan.capacity.ceiling;
      var pjLine=pj?(pj.title+(pj.existingId?' — existing, tasks attach to it':(pj.requestedStatus==='PARKED'?' — new, will land PARKED (your ruling in the file — real, just not this quarter\\u2019s fight)':(full?' — new, will land PARKED (four active is the ceiling; activate it later by parking another)':' — new, will be created ACTIVE')))):'none in this file — tasks land in your Inbox (you can name one at commit)';
      box.appendChild(iEl('div','font-size:13px;margin-bottom:2px','Project: '+pjLine));
      box.appendChild(iEl('div','font-size:12px;color:var(--rmuted,#9ea7b2);margin-bottom:8px','Active projects now: '+(plan.capacity?plan.capacity.activeProjects+' of '+plan.capacity.ceiling:'—')));
      var create=[],rec=[],done=[];
      for(var i=0;i<plan.tasks.length;i++){var t=plan.tasks[i];if(t.alreadyImported)done.push(t);else if(t.recurring)rec.push(t);else create.push(t);}
      function rowLine(t,extra){var d=iEl('div','padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px');
        d.appendChild(iEl('span',null,t.title));
        var meta=' — '+(t.owner||'no owner')+' → '+t.route+(t.vendor?(' · waits on '+t.vendor+' (follow-up in 14 days)'):'')+(t.unmappedOwner?' · owner not recognized, defaults to you':'')+(t.cadence&&!t.recurring?(' · '+t.cadence):'')+(t.priority?(' · '+t.priority):'');
        d.appendChild(iEl('span','color:var(--rmuted,#9ea7b2)',meta));
        if(extra)d.appendChild(extra);
        return d;}
      if(create.length){box.appendChild(iEl('div','font-weight:600;font-size:13px;margin:8px 0 2px','Will be created — '+create.length));
        for(var c=0;c<create.length;c++)box.appendChild(rowLine(create[c]));}
      if(rec.length){box.appendChild(iEl('div','font-weight:600;font-size:13px;margin:12px 0 2px','Recurring — not supported yet ('+rec.length+'): rule each one'));
        box.appendChild(iEl('div','font-size:12px;color:var(--rmuted,#9ea7b2);margin-bottom:4px','A cadence is never flattened into a pile of one-offs. Skip keeps it where it lives today; once creates a single task with a surface date; timer means it is really an agent/Rex job — reported, nothing created.'));
        for(var rj=0;rj<rec.length;rj++){(function(t){
          var wrap2=iEl('div','display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0');
          wrap2.setAttribute('data-imp-rec',t.source);
          var sel=document.createElement('select');sel.className='imp-disp r-routesel';
          [['skip','Skip — stays where it is'],['once','Create once, surface on a date'],['agent','Really a timer/agent job — report only']].forEach(function(o2){var op=document.createElement('option');op.value=o2[0];op.textContent=o2[1];sel.appendChild(op);});
          var dt=document.createElement('input');dt.type='date';dt.className='imp-date r-routesel';
          var line=rowLine(t);line.style.borderBottom='none';line.style.flex='1 1 260px';line.appendChild(iEl('span','color:#f5c96b',' · '+t.cadence));
          wrap2.appendChild(line);wrap2.appendChild(sel);wrap2.appendChild(dt);
          box.appendChild(wrap2);})(rec[rj]);}}
      if(done.length)box.appendChild(iEl('div','font-size:12px;color:var(--rmuted,#9ea7b2);margin-top:10px','Already imported (untouched on re-import): '+done.length));
      if(plan.refusals&&plan.refusals.length){box.appendChild(iEl('div','font-weight:600;font-size:13px;margin:10px 0 2px;color:#f4a09f','Refused — '+plan.refusals.length));
        for(var rf=0;rf<plan.refusals.length;rf++)box.appendChild(iEl('div','font-size:12.5px;color:#f4a09f',plan.refusals[rf].title+' — '+plan.refusals[rf].reason));}
      if(plan.ignoredSheets&&plan.ignoredSheets.length)box.appendChild(iEl('div','font-size:12px;color:var(--rmuted,#9ea7b2);margin-top:6px','Sheets without the import columns (ignored): '+plan.ignoredSheets.join(', ')));
      var bar=iEl('div','display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap');
      var dom2=document.createElement('select');dom2.className='r-routesel';dom2.setAttribute('data-import-domain','');
      ['business','general','health','family','admin','venture'].forEach(function(dk){var op=document.createElement('option');op.value=dk;op.textContent=dk;dom2.appendChild(op);});
      var lab=iEl('label','font-size:12px;color:var(--rmuted,#9ea7b2)','Domain: ');lab.appendChild(dom2);
      var go=document.createElement('button');go.className='r-btn primary';go.setAttribute('data-import-commit',file);go.textContent='Commit import';
      var cxl=document.createElement('button');cxl.className='r-btn';cxl.setAttribute('data-import-close','');cxl.textContent='Close preview';
      bar.appendChild(lab);bar.appendChild(go);bar.appendChild(cxl);box.appendChild(bar);
      out.appendChild(box);}
    function impReportRender(file,rep){
      var out=document.querySelector('[data-import-out]');if(!out)return;out.textContent='';
      var box=iEl('div','border:1px solid rgba(69,196,134,.4);border-radius:10px;padding:12px;');
      box.appendChild(iEl('div','font-weight:650;font-size:14px;margin-bottom:6px','Imported — '+file));
      if(rep.project)box.appendChild(iEl('div','font-size:13px','Project: '+rep.project.title+' — '+(rep.project.outcome==='existing'?'existing, tasks attached':(rep.project.status==='PARKED'?'created PARKED (four active is the ceiling)':'created ACTIVE'))));
      box.appendChild(iEl('div','font-size:13px;margin-top:4px','Created: '+rep.created+' · already there: '+rep.existing+' · parked waiting on a vendor: '+rep.waiting));
      if(rep.agentCadence&&rep.agentCadence.length){box.appendChild(iEl('div','font-weight:600;font-size:13px;margin-top:8px','Timer/agent jobs — reported only, nothing created:'));
        for(var i=0;i<rep.agentCadence.length;i++)box.appendChild(iEl('div','font-size:12.5px;color:var(--rmuted,#9ea7b2)',rep.agentCadence[i].title+' ('+rep.agentCadence[i].cadence+') — commission as a timer when ready'));}
      if(rep.skipped&&rep.skipped.length){box.appendChild(iEl('div','font-weight:600;font-size:13px;margin-top:8px','Left out:'));
        for(var s3=0;s3<rep.skipped.length;s3++)box.appendChild(iEl('div','font-size:12.5px;color:var(--rmuted,#9ea7b2)',rep.skipped[s3].title+' — '+rep.skipped[s3].why));}
      if(rep.refused&&rep.refused.length){box.appendChild(iEl('div','font-weight:600;font-size:13px;margin-top:8px;color:#f4a09f','Refused:'));
        for(var s4=0;s4<rep.refused.length;s4++)box.appendChild(iEl('div','font-size:12.5px;color:#f4a09f',rep.refused[s4].title+' — '+rep.refused[s4].reason));}
      box.appendChild(iEl('div','font-size:12px;color:var(--rmuted,#9ea7b2);margin-top:8px','Each imported task carries its provenance on its own record. This summary lives here until you leave the page.'));
      var done=document.createElement('button');done.className='r-btn primary';done.setAttribute('data-import-close','');done.textContent='Done — refresh the page';done.setAttribute('style','margin-top:10px');
      box.appendChild(done);out.appendChild(box);}
    document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
      var ib=t.closest('[data-lc-import]');
      if(ib){e.preventDefault();if(busy)return;ib.disabled=true;
        impPost({command:'import_preview',idempotencyKey:hex(),payload:{fileName:ib.getAttribute('data-lc-import')}},
          function(plan){ib.disabled=false;impPreviewRender(ib.getAttribute('data-lc-import'),plan);},ib);
        return;}
      var cb2=t.closest('[data-import-commit]');
      if(cb2){e.preventDefault();if(busy)return;
        var file=cb2.getAttribute('data-import-commit');
        var payload={fileName:file};
        var dom3=document.querySelector('[data-import-domain]');if(dom3)payload.domainKey=dom3.value;
        var pjPrev=window.__impPlan&&window.__impPlan.project;
        if(!pjPrev){var ti=prompt('Attach these to a project? Name it (blank = no project):','');if(ti===null)return;ti=ti.trim();
          if(ti){var dd=prompt('Its definition of done — how will you know it is finished?','');if(dd===null)return;dd=(dd||'').trim();
            if(!dd){window.__lcSay(cb2,'Every project needs a definition of done — how will you know it is finished?');return;}
            payload.project={title:ti,definitionOfDone:dd};}}
        var disp=[];var recs=document.querySelectorAll('[data-imp-rec]');
        for(var i2=0;i2<recs.length;i2++){var bx=recs[i2];var sel2=bx.querySelector('.imp-disp');if(!sel2)continue;
          var d4={source:bx.getAttribute('data-imp-rec'),choice:sel2.value};
          if(sel2.value==='once'){var dt2=bx.querySelector('.imp-date');if(dt2&&dt2.value)d4.wakeDate=dt2.value;}
          disp.push(d4);}
        if(disp.length)payload.dispositions=disp;
        cb2.disabled=true;
        impPost({command:'import_batch',idempotencyKey:hex(),payload:payload},
          function(rep){impReportRender(file,rep);},cb2);
        return;}
      if(t.closest('[data-import-close]')){e.preventDefault();window.__lcHoldRefresh=false;location.reload();return;}
    });
    // A3: FOCUS MODE — a protected deep-work overlay. [data-lc-focus] carries {taskId,title,dod}.
    // Client-only until Complete, which posts the existing complete command. Esc / backdrop exits.
    var fo=document.querySelector('[data-lc-focus-overlay]');
    function openFocus(info){if(!fo)return;
      fo.querySelector('[data-focus-title]').textContent=info.title||'Focus';
      fo.querySelector('[data-focus-dod]').textContent=info.dod||'No definition of done yet — decide what “won” looks like.';
      var cb=fo.querySelector('[data-focus-complete]');cb.setAttribute('data-task',info.taskId||'');
      fo.classList.add('open');window.__lcOpen=true;}
    function closeFocus(){if(fo){fo.classList.remove('open');window.__lcOpen=false;}}
    document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
      var f=t.closest('[data-lc-focus]');
      if(f){e.preventDefault();try{openFocus(JSON.parse(f.getAttribute('data-lc-focus')));}catch(_){}return;}
      if(t.closest('[data-focus-exit]')||t===fo){e.preventDefault();closeFocus();return;}
      var fc=t.closest('[data-focus-complete]');
      if(fc){e.preventDefault();if(busy)return;var id=fc.getAttribute('data-task');if(!id){closeFocus();return;}busy=true;
        fetch('/api/life/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'complete',idempotencyKey:hex(),payload:{taskId:id}})})
        .then(function(r){return r.json();}).then(function(r){busy=false;if(r&&r.ok){location.reload();}else{window.__lcRefuse(fc,r&&r.error);}})
        .catch(function(){busy=false;window.__lcSay(fc,window.__lcNet);});return;}
    });
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&fo&&fo.classList.contains('open'))closeFocus();});
  })();`;
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
  footer{margin-top:22px;font-family:var(--font-mono);font-size:10px;color:var(--muted)}
/* LIFE OS global capture (A5) — every workspace, desktop + mobile */
.lc-fab{position:fixed;right:18px;bottom:18px;width:52px;height:52px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(34,211,238,.18);color:#CFF6FB;font-size:26px;line-height:1;cursor:pointer;z-index:60;box-shadow:0 4px 18px rgba(0,0,0,.45)}
.lc-fab:hover{background:rgba(34,211,238,.3)}
.lc-overlay{display:none;position:fixed;inset:0;background:rgba(2,8,14,.62);z-index:70;align-items:flex-start;justify-content:center;padding:10vh 16px 0}
.lc-overlay.lc-open{display:flex}
.lc-card{width:100%;max-width:560px;background:var(--panel,#0d1722);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
/* Focus mode overlay base (A3) — always-emitted shell CSS so a hidden overlay never flashes
   unstyled on a Coyote/Claw page; the inner r-* treatment renders on life pages that emit lifeCss. */
.lc-focus-overlay{display:none;position:fixed;inset:0;background:rgba(2,6,10,.8);z-index:80;align-items:center;justify-content:center;padding:16px}
.lc-focus-overlay.open{display:flex}
.lc-focus-card{width:100%;max-width:560px;background:#14181d;border:1px solid #2a3139;border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.lc-input{width:100%;box-sizing:border-box;font-size:17px;padding:12px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit}
.lc-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.lc-domain{min-height:44px;padding:0 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;font-size:14px;color-scheme:dark}
/* Native select POPUPS ignore the control's colours: without color-scheme:dark the option
   list renders on the UA's light background with our inherited light text — white-on-white,
   and the hover highlight erases it entirely (operator report 2026-08-10). The option rules
   are the explicit fallback for engines that style options directly. */
.lc-domain option{background:#14181d;color:#e9eef4}
.lc-domain option:checked{background:#26374a;color:#fff}
.lc-btn{min-height:44px;min-width:96px;padding:0 18px;border-radius:8px;border:1px solid rgba(34,211,238,.5);background:rgba(34,211,238,.16);color:#CFF6FB;font-size:14px;font-weight:600;cursor:pointer}
.lc-ghost{border-color:rgba(255,255,255,.2);background:transparent;color:var(--muted,#8aa)}
.lc-result{margin-top:10px;font-size:13px;min-height:18px}
.lc-result a{color:#CFF6FB}
.lc-ok{color:#7de3a0}.lc-err{color:#ff9b8a}.lc-busy{color:var(--muted,#8aa)}
.lc-hint{margin-top:8px;font-size:11px;color:var(--muted,#7a8)}
.lc-cxl{min-height:32px;padding:2px 10px;border-radius:6px;border:1px solid rgba(255,155,138,.4);background:transparent;color:#ff9b8a;font-size:12px;cursor:pointer}

/* PHONE SHELL (Life OS mobile acceptance, 2026-08-05 — shared, benefits every workspace):
   below 760px the sidebar becomes a compact top strip and nav items flow as a wrap row.
   Placed at the sheet's END so these override the desktop base rules at equal specificity. */
@media(max-width:760px){
  .app{grid-template-columns:1fr}
  .sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--border)}
  .brand{padding:10px 14px}
  .nav{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px;align-items:center}
  .nav-label{display:none}
  .nav-item{margin:0;flex:0 0 auto;padding:8px 10px;font-size:13px}
  .sidebar .foot,.sidebar .sfoot,.sidebar .side-foot{display:none}
}
`;
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

// ============================================================================
// RCC — the Revenue Command Centre design system (Stage 1A, operator mock
// docs/revenue-command-centre/reference/Revenue mock tab.html, extracted
// 2026-07-21 DIRECTLY from the mock's CSS — every token value is the mock's
// own). SCOPE RULE: this canon applied to the REVENUE surface only until the operator
// EXTENDED it (ruling 2026-08-05): Life OS owner surfaces adopt the same component set —
// one visual language, no per-workspace design system. Every
// selector lives under the .rcc root class and the CSS is emitted only by
// pages that call S.rcc.css(). ONE component set, no per-page forks.
const RCC_TOKENS = {
  bg: '#0b0d10', panel: '#14181d', panel2: '#191e24', line: '#2a3139',
  text: '#f3f0e8', muted: '#9ea7b2',
  accent: '#e44b36', accent2: '#ffb34d',
  good: '#45c486', warn: '#f0b64f', bad: '#ef6b68',
  blue: '#67a7ff', purple: '#ad8cff',
  y2024: '#56616e', y2025: '#67a7ff', y2026: '#e44b36',
  radius: '16px', shadow: '0 10px 30px rgba(0,0,0,.24)',
  heat: ['#17242b', '#18333a', '#244c4f', '#6b4c2d', '#8a3d31', '#b44736'], // l1..l6
  // Reservations mock extension (Stage 1, 2026-07-21): ONE new token — everything else in its
  // :root is the RCC canon verbatim (its text/muted hexes differ by a hair; generation noise,
  // NOT adopted — one canon). cyan = the walk-in series / secondary-metric colour.
  cyan: '#5bd1d7',
};

function rccCss() {
  const T = RCC_TOKENS;
  return `
  .rcc{--rbg:${T.bg};--rpanel:${T.panel};--rpanel2:${T.panel2};--rline:${T.line};--rtext:${T.text};--rmuted:${T.muted};--raccent:${T.accent};--raccent2:${T.accent2};--rgood:${T.good};--rwarn:${T.warn};--rbad:${T.bad};--rblue:${T.blue};--rpurple:${T.purple};--rradius:${T.radius};--rshadow:${T.shadow};color:var(--rtext)}
  .rcc .r-card{background:linear-gradient(180deg,var(--rpanel) 0%,#12161a 100%);border:1px solid var(--rline);border-radius:var(--rradius);box-shadow:var(--rshadow)}
  .rcc .r-kpi{padding:16px;min-height:135px;position:relative;overflow:hidden}
  .rcc .r-kpi-label{color:#a5aeb7;font-size:11px;text-transform:uppercase;letter-spacing:.085em;font-weight:800}
  .rcc .r-kpi-value{font-size:26px;font-weight:850;letter-spacing:-.7px;margin-top:10px}
  .rcc .r-kpi-sub{margin-top:7px;color:#abb3bc;font-size:12px}
  .rcc .r-delta{font-weight:800;margin-right:5px}
  .rcc .r-up{color:var(--rgood)} .rcc .r-down{color:var(--rbad)} .rcc .r-flat{color:var(--rwarn)}
  .rcc .r-microbar{height:5px;background:#252c33;border-radius:999px;margin-top:13px;overflow:hidden}
  .rcc .r-microbar span{display:block;height:100%;background:linear-gradient(90deg,var(--raccent),#ff8a5b);border-radius:999px}
  .rcc .r-panel{padding:17px;min-width:0}
  .rcc .r-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px}
  .rcc .r-panel-title{font-size:14px;font-weight:850;margin:0}
  .rcc .r-panel-sub{color:var(--rmuted);font-size:11px;margin-top:4px}
  .rcc .r-pill{border:1px solid var(--rline);background:#11151a;color:#c9d0d8;border-radius:999px;padding:8px 11px;font-size:12px;white-space:nowrap;display:inline-block}
  .rcc .r-pill.good{border-color:#24583f;color:#9de3bc;background:#10251b}
  .rcc .r-pill .r-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--rgood);margin-right:6px}
  .rcc .r-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--rline);background:#11151a;border-radius:14px;padding:10px;margin-bottom:14px}
  .rcc .r-control{padding:8px 11px;border:1px solid #303740;border-radius:10px;background:#171c22;color:#e5e9ee;font-size:12px;min-width:132px}
  .rcc .r-control strong{display:block;color:#8d96a0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}
  .rcc .r-tag{display:inline-block;padding:5px 7px;border-radius:7px;font-size:10px;font-weight:800;background:#20272e;color:#c5ccd4;border:1px solid #303941}
  .rcc .r-tag.good{color:#8ee1b4;background:#10251b;border-color:#24583f}
  .rcc .r-tag.warn{color:#f3c76f;background:#2b2111;border-color:#5c4822}
  .rcc .r-tag.bad{color:#f4a09f;background:#2a1718;border-color:#5d2e30}
  .rcc .r-tag.info{color:#c4b7ff;background:#201a35;border-color:#4b3d78}
  .rcc .r-alert{display:grid;grid-template-columns:9px 1fr auto;gap:10px;align-items:start;padding:11px;border:1px solid #2b3239;border-radius:12px;background:#12161a}
  .rcc .r-alert .r-bar{width:5px;height:100%;min-height:40px;border-radius:99px;background:var(--rwarn)}
  .rcc .r-alert.good .r-bar{background:var(--rgood)} .rcc .r-alert.bad .r-bar{background:var(--rbad)}
  .rcc .r-alert h4{margin:0 0 3px;font-size:12px}
  .rcc .r-alert p{margin:0;color:#98a2ac;font-size:11px;line-height:1.45}
  .rcc .r-impact{font-size:11px;font-weight:800;white-space:nowrap;color:#f2c66f}
  .rcc .r-barrow{display:grid;grid-template-columns:116px 1fr 70px;gap:10px;align-items:center}
  .rcc .r-barrow .r-label{color:#c9d0d6;font-size:12px}
  .rcc .r-track{height:12px;background:#252c33;border-radius:999px;overflow:hidden;display:flex}
  .rcc .r-seg{height:100%}
  .rcc .r-value{text-align:right;font-weight:750;font-size:12px}
  .rcc table{width:100%;border-collapse:collapse}
  .rcc th{text-align:left;color:#89939e;font-size:10px;text-transform:uppercase;letter-spacing:.07em;padding:10px;border-bottom:1px solid var(--rline);white-space:nowrap}
  .rcc td{padding:11px 10px;border-bottom:1px solid #222930;color:#d5dbe1;font-size:12px;white-space:nowrap}
  .rcc tr:last-child td{border-bottom:0}
  .rcc .r-num{text-align:right}
  .rcc .r-cell{height:28px;border-radius:6px;background:#1c2329;border:1px solid #273039;position:relative}
  ${T.heat.map((c, i) => `.rcc .r-l${i + 1}{background:${c}}`).join(' ')}
  .rcc .r-cell:hover:after{content:attr(data-tip);position:absolute;z-index:5;bottom:34px;left:50%;transform:translateX(-50%);background:#080a0c;border:1px solid #39434d;border-radius:8px;color:#fff;padding:6px 8px;font-size:10px;white-space:nowrap;box-shadow:0 10px 24px rgba(0,0,0,.4)}
  .rcc .r-formula{background:#0d1115;border:1px solid #2d363f;border-radius:12px;padding:12px;color:#cbd2d9;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.7}
  .rcc .r-callout{background:#191f25;border:1px solid #313943;border-radius:12px;padding:11px}
  .rcc .r-callout strong{font-size:17px}
  .rcc .r-note{border-left:3px solid var(--raccent2);padding:9px 11px;background:#191711;color:#b8b0a4;font-size:11px;line-height:1.5;border-radius:0 9px 9px 0}
  .rcc .r-mbar{border-radius:4px 4px 1px 1px;position:relative;min-height:3px}
  .rcc .r-mbar.y2024{background:${T.y2024}} .rcc .r-mbar.y2025{background:${T.y2025}} .rcc .r-mbar.y2026{background:${T.y2026}}
  .rcc .r-mbar.forecast{background:repeating-linear-gradient(135deg,${T.y2026} 0,${T.y2026} 4px,#702c25 4px,#702c25 8px);border:1px dashed #ff9f8f}
  .rcc .r-driver{border:1px solid #2c343c;border-radius:12px;background:#12161a;padding:12px}
  .rcc .r-driver small{display:block;color:#8d97a2;text-transform:uppercase;letter-spacing:.07em;font-size:9px;font-weight:800}
  .rcc .r-driver strong{display:block;margin-top:7px;font-size:18px}
  .rcc .r-driver p{margin:4px 0 0;color:#8e98a2;font-size:10px}
  .rcc .r-empty{border:1px dashed #3a434d;border-radius:12px;padding:16px;color:#9aa4ae;font-size:12px;line-height:1.55;background:#101419}
  .rcc .r-empty b{color:#c9d0d8}
  .rcc .r-empty .r-unlock{margin-top:8px;color:#f2c66f;font-size:11px;font-weight:700}
  .rcc .r-stackcol{display:flex;flex-direction:column-reverse;width:100%;max-width:26px;margin:0 auto;border-radius:4px 4px 1px 1px;overflow:hidden;min-height:3px}
  .rcc .r-meter-row{display:grid;grid-template-columns:130px 1fr 64px;gap:10px;align-items:center;font-size:12px}
  .rcc .r-meter-row .r-track{height:10px}
  .rcc .r-stars{color:${T.accent2};letter-spacing:1px}`;
}

// The RCC component set — mirrors the mock's grammar 1:1. Callers pass PRE-ESCAPED or trusted
// strings for labels (matching the existing tile idiom); free-text goes through escapeHtml here.
const rcc = {
  tokens: RCC_TOKENS,
  css: rccCss,
  /** KPI tile: label / big value / delta line / micro-bar. delta: {dir:'up'|'down'|'flat', text}. */
  kpi({ label, value, delta, sub, barPct }) {
    const d = delta ? `<span class="r-delta r-${delta.dir || 'flat'}">${escapeHtml(delta.text)}</span>` : '';
    const bar = barPct != null ? `<div class="r-microbar"><span style="width:${Math.max(0, Math.min(100, barPct))}%"></span></div>` : '';
    return `<div class="r-card r-kpi"><div class="r-kpi-label">${escapeHtml(label)}</div><div class="r-kpi-value">${escapeHtml(value)}</div><div class="r-kpi-sub">${d}${sub ? escapeHtml(sub) : ''}</div>${bar}</div>`;
  },
  /** Panel shell: title / sub / optional right-side head content / body html. */
  panel({ title, sub, headRight, body }) {
    return `<div class="r-card r-panel"><div class="r-panel-head"><div><h3 class="r-panel-title">${escapeHtml(title)}</h3>${sub ? `<div class="r-panel-sub">${escapeHtml(sub)}</div>` : ''}</div>${headRight || ''}</div>${body || ''}</div>`;
  },
  /** Status chip: tone ∈ good|warn|bad|info|(neutral). */
  tag(text, tone) { return `<span class="r-tag${tone ? ' ' + tone : ''}">${escapeHtml(text)}</span>`; },
  /** Header status pill (sources loaded / completeness / reconciled). */
  pill(text, good) { return `<span class="r-pill${good ? ' good' : ''}">${good ? '<span class="r-dot"></span>' : ''}${escapeHtml(text)}</span>`; },
  /** Filter-pill control (period / comparison / location / view). */
  control(label, value) { return `<div class="r-control"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`; },
  /** Decision-feed card: finding + £ value + one-line action. tone ∈ good|bad|(warn default). */
  alert({ title, text, impact, tone }) {
    return `<div class="r-alert${tone ? ' ' + tone : ''}"><div class="r-bar"></div><div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(text)}</p></div><div class="r-impact">${impact ? escapeHtml(impact) : ''}</div></div>`;
  },
  /** Horizontal bar row: label / segments [{pct,color}] / right value. */
  barrow({ label, segs, value }) {
    const body = (segs || []).map((g) => `<div class="r-seg" style="width:${Math.max(0, Math.min(100, g.pct))}%;background:${g.color}"></div>`).join('');
    return `<div class="r-barrow"><div class="r-label">${escapeHtml(label)}</div><div class="r-track">${body}</div><div class="r-value">${escapeHtml(value)}</div></div>`;
  },
  /** Heatmap cell: level 1..6 (the mock's l1..l6 ramp) + tooltip. level null = no-data cell. */
  heatCell(level, tip) {
    const l = level != null ? ` r-l${Math.max(1, Math.min(6, level))}` : '';
    return `<div class="r-cell${l}"${tip ? ` data-tip="${escapeHtml(tip)}"` : ''}></div>`;
  },
  /** Clustered monthly bar (2024 grey / 2025 blue / 2026 orange / forecast hatched). hPct 0-100. */
  mbar(year, hPct, tip, isForecast) {
    const cls = isForecast ? 'forecast' : `y${year}`;
    return `<div class="r-mbar ${cls}" style="height:${Math.max(1, Math.min(100, hPct))}%"${tip ? ` data-tip="${escapeHtml(tip)}"` : ''}></div>`;
  },
  /** Control-formulas card body (verbatim canonical rulings, monospace). */
  formula(lines) { return `<div class="r-formula">${(lines || []).map((l) => escapeHtml(l)).join('<br>')}</div>`; },
  /** Annotated design-decision / basis callout. */
  callout(html) { return `<div class="r-callout">${html}</div>`; },
  note(text) { return `<div class="r-note">${escapeHtml(text)}</div>`; },
  driver({ label, value, sub }) { return `<div class="r-driver"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><p>${sub ? escapeHtml(sub) : ''}</p></div>`; },
  /** Stacked column (the Reservations 13-week walk-in vs reserved grammar): segs bottom-up
   *  [{pct,color}], height % of the tallest column. */
  stackCol(hPct, segs, tip) {
    const body = (segs || []).map((g) => `<div style="height:${Math.max(0, Math.min(100, g.pct))}%;background:${g.color}"></div>`).join('');
    return `<div class="r-stackcol" style="height:${Math.max(1, Math.min(100, hPct))}%"${tip ? ` data-tip="${escapeHtml(tip)}"` : ''}>${body}</div>`;
  },
  /** Horizontal labelled meter row (the sentiment-theme / funnel grammar): label · track · value. */
  meterRow({ label, pct, color, value }) {
    return `<div class="r-meter-row"><div class="r-label">${escapeHtml(label)}</div><div class="r-track"><div class="r-seg" style="width:${Math.max(0, Math.min(100, pct))}%;background:${color || RCC_TOKENS.accent}"></div></div><div class="r-value">${escapeHtml(value)}</div></div>`;
  },
  /** Star rating (Reviews & Recovery): filled/empty out of 5, value beside. */
  stars(rating) {
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    const full = Math.round(r);
    return `<span class="r-stars" title="${escapeHtml(r.toFixed(2))} / 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
  },
  /** DESIGNED EMPTY-STATE (honest-gaps rule): the mock's own layout, honest content — names the
   *  blocker + the unlock action. NEVER renders a mock number. */
  emptyState({ title, blocker, unlock }) {
    return `<div class="r-empty"><b>${escapeHtml(title)}</b> — not wired.<br>${escapeHtml(blocker)}${unlock ? `<div class="r-unlock">Unlock: ${escapeHtml(unlock)}</div>` : ''}</div>`;
  },
  /** LIFE OS additions to the RCC grammar (visual golden masters v1.1.0, operator amendments
   *  2026-08-05). EMITTED ONLY BY LIFE PAGES — deliberately NOT folded into rccCss(): eight
   *  Coyote pages embed rcc.css() in their BODIES, so extending it would move their
   *  byte-identity golden masters. One shared definition, zero per-page forks. */
  lifeCss() {
    return `
.rcc .r-eyebrow{font-family:var(--font-mono,monospace);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${RCC_TOKENS.accent2};margin-bottom:6px}
.rcc .r-eyebrow.hot{color:${RCC_TOKENS.accent}}
.rcc .r-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:7px 16px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:var(--rtext);font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:all .15s}
.rcc .r-btn:hover{background:rgba(255,255,255,.1)}
.rcc .r-btn.primary{background:${RCC_TOKENS.accent};border-color:${RCC_TOKENS.accent};color:#fff}
.rcc .r-btn.primary:hover{filter:brightness(1.1)}
.rcc .r-btn.small{min-height:30px;padding:4px 12px;font-size:12px;border-radius:7px}
.rcc .r-quote{font-size:14.5px;line-height:1.55;font-style:italic;color:var(--rtext);border-left:3px solid ${RCC_TOKENS.accent2};padding:2px 0 2px 12px;margin:10px 0}
.rcc .r-defbox{background:rgba(255,255,255,.045);border:1px solid var(--rline);border-radius:10px;padding:10px 12px;margin:12px 0}
.rcc .r-defbox small{display:block;font-family:var(--font-mono,monospace);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--rmuted);margin-bottom:4px}
.rcc .r-lrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 2px;border-bottom:1px solid rgba(255,255,255,.06)}
.rcc .r-lrow:last-child{border-bottom:0}
.rcc .r-check{width:20px;height:20px;border-radius:50%;border:2px solid ${RCC_TOKENS.good};flex:0 0 20px}
.rcc .r-capline{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.04);border:1px solid var(--rline);border-radius:10px;padding:9px 13px;font-size:13px;color:var(--rmuted);cursor:pointer}
.rcc .r-capline kbd{font-family:var(--font-mono,monospace);font-size:10px;border:1px solid var(--rline);border-radius:5px;padding:1px 6px;margin-left:auto}
/* A3 closures (operator ruling 2026-08-05): execution route, contextual confidence, focus
   mode, quiet-support toggle. modePill colour map is the golden's own (SELF orange / AI blue
   / DELEGATE green / HYBRID purple). */
.rcc .r-route{display:inline-flex;align-items:center;font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 9px;border-radius:20px;border:1px solid}
.rcc .r-route.SELF{color:#ffc08a;border-color:rgba(255,155,77,.5);background:rgba(255,155,77,.12)}
.rcc .r-route.AI{color:#8ec2ff;border-color:rgba(103,167,255,.5);background:rgba(103,167,255,.12)}
.rcc .r-route.DELEGATE{color:#7de3a0;border-color:rgba(69,196,134,.5);background:rgba(69,196,134,.12)}
.rcc .r-route.HYBRID{color:#c3a6ff;border-color:rgba(173,140,255,.5);background:rgba(173,140,255,.12)}
.rcc .r-conf{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:var(--rmuted)}
.rcc .r-conf .dot{width:7px;height:7px;border-radius:50%;background:var(--rmuted)}
.rcc .r-conf.high .dot{background:${RCC_TOKENS.good}}.rcc .r-conf.high{color:#9fe3bd}
.rcc .r-conf.med .dot{background:${RCC_TOKENS.warn}}.rcc .r-conf.med{color:#f0cf8f}
.rcc .r-routesel{background:rgba(255,255,255,.05);border:1px solid var(--rline);border-radius:8px;color:var(--rtext);font-size:12px;padding:5px 8px;min-height:32px;color-scheme:dark}
.rcc .r-routesel option{background:#14181d;color:var(--rtext)}
.rcc .r-routesel option:checked{background:#26374a;color:#fff}
.rcc .r-toggle{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;user-select:none}
.rcc .r-toggle .sw{width:40px;height:22px;border-radius:22px;background:rgba(255,255,255,.14);position:relative;transition:background .15s;flex:0 0 40px}
.rcc .r-toggle .sw::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}
.rcc .r-toggle.on .sw{background:${RCC_TOKENS.good}}.rcc .r-toggle.on .sw::after{left:20px}
@media(max-width:760px){.rcc .r-lrow{flex-wrap:wrap}}
`;
  },
  /** Execution-route pill (A3). mode ∈ SELF|AI|DELEGATE|HYBRID. */
  route(mode) {
    const m = String(mode || 'SELF').toUpperCase();
    const label = { SELF: 'You', AI: 'AI', DELEGATE: 'Delegate', HYBRID: 'Hybrid' }[m] || 'You';
    return `<span class="r-route ${escapeHtml(m)}">${escapeHtml(label)}</span>`;
  },
  /** Contextual confidence chip (A3, ADR-007: shown only where a REAL confidence exists;
   *  never a global trust score). value is 0..1; returns '' for missing/non-numeric. */
  conf(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '';
    const pct = Math.round(v * 100);
    const band = pct >= 80 ? 'high' : pct >= 60 ? 'med' : 'low';
    const word = pct >= 80 ? 'high' : pct >= 60 ? 'medium' : 'low';
    return `<span class="r-conf ${band}" title="how likely this reading is correct — never permission to act on its own"><span class="dot"></span>${pct}% · ${word}</span>`;
  },
};

module.exports = {
  escapeHtml,
  freshness,
  fmtTime,
  agoLabel,
  fmtGbpPence,
  fmtInt,
  kpiTile,
  sparkline,
  rcc,
  renderShell,
  renderSidebar,
  css,
  WORKSPACES,
  workspaceOf,
  formInUse,
  advanceCadence,
  ownerRefusalCopy,
  LIFE_REFUSAL_COPY,
  LIFE_REFUSAL_FALLBACK,
};
