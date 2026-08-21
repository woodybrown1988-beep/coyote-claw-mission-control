'use strict';
// Issues page — the issues layer of the Reviews department. Renders, top to bottom:
//   (a) RISING THEMES   — issue_trends latest set (computed_at = MAX), tiles colour-coded by trend
//   (b) FREQUENCY       — all-time COUNT(*) per issue_code from review_issues + a sample evidence_quote
//   (c) ESCALATIONS     — review_actions WHERE escalate=1; ALLERGEN_HANDLING = a prominent red top alert
//   (d) LOOP-CLOSER     — actions with a before/after issue rate, shown as before(amber)/after(green) bars
//   (e) LOG-AN-ACTION   — the one safe write: a data-log-form the SHARED client script POSTs (op:log_action)
// Contract: { key, route, title, sub, getSection(db,ctx), render(section,ctx) }. SELECT-only via ctx.q;
// render returns { stamp, body }. NO writes, NO network, NO LLM — requires only ../shared.js.
const S = require('../../shared.js');

const ALLERGEN = 'ALLERGEN_HANDLING';

function rows(res) {
  return res && res.ok && Array.isArray(res.rows) ? res.rows : [];
}
function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function firstLine(text) {
  if (text === null || text === undefined) return '';
  const s = String(text).replace(/\r/g, '');
  const nl = s.indexOf('\n');
  return (nl === -1 ? s : s.slice(0, nl)).trim();
}

function getSection(db, ctx) {
  const q = (sql, params) => ctx.q(sql, params);

  // (a) latest issue_trends set + its freshness stamp source
  const computedAtRow = rows(q(`SELECT MAX(computed_at) AS m FROM issue_trends`))[0];
  const computedAt = computedAtRow ? num(computedAtRow.m) || 0 : 0;
  const rising = rows(
    q(`SELECT issue_code, count_current, count_prior, rising FROM issue_trends
       WHERE computed_at = (SELECT MAX(computed_at) FROM issue_trends)
       ORDER BY rising DESC, count_current DESC`)
  ).map((r) => {
    const cur = num(r.count_current) || 0;
    const prior = num(r.count_prior) || 0;
    return { code: String(r.issue_code || ''), cur, prior, delta: cur - prior, rising: Number(r.rising) === 1 };
  });

  // INPUT-COVERAGE GUARD (2026-08-19, data-wiring audit). count_current falls to 0 when the venue
  // genuinely stopped getting a complaint AND when the review feed simply stops arriving — and the
  // tiles below turn a fall into a GREEN "easing". With Google and TripAdvisor dead since ~2026-07-06
  // that painted 16 fabricated zeros as complaints solved, under a timestamp that looked fresh
  // because the TREND JOB kept running on an empty input.
  //
  // A count is only a measurement if something was measured. Compare reviews landing in the current
  // 30-day window against the prior one: if the input has collapsed, the counts describe the feed,
  // not the restaurant, and the tiles must say so instead of going green.
  const nowMs = (ctx && ctx.now) || Date.now();
  const dayIso = (msBack) => new Date(nowMs - msBack).toISOString().slice(0, 10);
  const cov = rows(q(
    `SELECT
       (SELECT COUNT(*) FROM review_corpus WHERE reviewed_date >= ?) cur,
       (SELECT COUNT(*) FROM review_corpus WHERE reviewed_date >= ? AND reviewed_date < ?) prior`,
    [dayIso(30 * 86400000), dayIso(60 * 86400000), dayIso(30 * 86400000)]))[0] || {};
  const covCur = num(cov.cur);
  const covPrior = num(cov.prior);
  // Unknown coverage is NOT treated as fine — if the corpus cannot be read, the tiles gate too.
  const inputCollapsed = covCur == null || covPrior == null
    ? true
    : (covPrior > 0 && covCur < covPrior * 0.5);
  const coverage = { cur: covCur, prior: covPrior, collapsed: inputCollapsed };

  // (b) all-time frequency + a real sample quote per code (MAX = a deterministic, real row value)
  const frequency = rows(
    q(`SELECT issue_code, COUNT(*) AS n, MAX(evidence_quote) AS sample, MAX(confidence) AS conf
       FROM review_issues GROUP BY issue_code ORDER BY n DESC, issue_code ASC`)
  ).map((r) => ({
    code: String(r.issue_code || ''),
    n: num(r.n) || 0,
    sample: r.sample == null ? '' : String(r.sample),
    conf: num(r.conf),
  }));

  // (c) escalations — escalate=1; allergen is pulled out as the safety top-alert
  const escAll = rows(
    q(`SELECT id, issue_code, status, evidence_summary, auto FROM review_actions
       WHERE escalate = 1 ORDER BY auto DESC, id DESC`)
  ).map((r) => ({
    id: num(r.id),
    code: String(r.issue_code || ''),
    status: String(r.status || ''),
    summary: firstLine(r.evidence_summary),
    auto: Number(r.auto) === 1,
  }));
  const allergen = escAll.filter((e) => e.code === ALLERGEN);
  const escOthers = escAll.filter((e) => e.code !== ALLERGEN);

  // (d) loop-closer — actions with a measured before/after rate
  const loops = rows(
    q(`SELECT id, issue_code, action_taken, action_date, status, issue_rate_before, issue_rate_after
       FROM review_actions
       WHERE action_taken IS NOT NULL AND TRIM(action_taken) <> ''
         AND issue_rate_before IS NOT NULL AND issue_rate_after IS NOT NULL
       ORDER BY action_date DESC, id DESC`)
  ).map((r) => {
    const before = num(r.issue_rate_before);
    const after = num(r.issue_rate_after);
    // Normalise to a 0-100 scale within the row: fractions (<=1) are scaled ×100, percentages kept.
    const scale = (before != null && before > 1) || (after != null && after > 1) ? 1 : 100;
    const bp = before == null ? null : Math.max(0, Math.min(100, before * scale));
    const ap = after == null ? null : Math.max(0, Math.min(100, after * scale));
    const dropped = bp != null && ap != null ? ap < bp - 1e-9 : null;
    return {
      id: num(r.id),
      code: String(r.issue_code || ''),
      action: String(r.action_taken || ''),
      actionDate: num(r.action_date),
      status: String(r.status || ''),
      bp,
      ap,
      dropped,
    };
  });

  // (e) distinct codes for the log-action select — union of every code the operator might log against,
  //     gathered in JS so a single missing table can't blank the form.
  const codeSet = new Set();
  for (const r of frequency) if (r.code) codeSet.add(r.code);
  for (const r of rising) if (r.code) codeSet.add(r.code);
  for (const e of escAll) if (e.code) codeSet.add(e.code);
  for (const l of loops) if (l.code) codeSet.add(l.code);
  const codes = Array.from(codeSet).sort();

  const empty = rising.length === 0 && frequency.length === 0 && escAll.length === 0 && loops.length === 0;

  const coverageNote = S.coverageSentence(S.reviewCoverage(q, ctx.now || Date.now()));
  return { ok: true, computedAt, rising, coverage, coverageNote, frequency, allergen, escOthers, loops, codes, empty };
}

// ---- render helpers ------------------------------------------------------
function stampHtml(computedAt, now) {
  const f = S.freshness(computedAt, now);
  const inner = f.cls === 'fresh' ? `<b>${f.label}</b>` : `<span class="${f.cls}">${f.label}</span>`;
  return `issue trends · ${inner}`;
}

function fmtPct(p) {
  if (p == null) return '—';
  const v = Number(p);
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

// The blind-window guard was RIGHT; its REMEDY was a hard-coded guess that outlived the fault. It
// told the operator to re-consent an OAuth he had already re-consented, while the actual silence
// was a different feed. A remedy that names a cause must derive it — see data.js reviewCoverage.
function risingTiles(rising, coverage, coverageNote) {
  if (!rising.length) {
    return '<div class="banner muted">No trend window computed yet — rising themes appear once issue_trends is populated.</div>';
  }
  // A fall is only "easing" if something was actually measured this window. When the review feed
  // has collapsed, every zero is the feed's silence, not the kitchen's improvement — so the tiles
  // stay neutral and say why, rather than turning green on an absence.
  const blind = !!(coverage && coverage.collapsed);
  const tiles = rising.map((r) => {
    const isAllergen = r.code === ALLERGEN;
    const up = r.rising || r.delta > 0;
    let cls = 'muted';
    let subCls = '';
    let arrow = '→';
    let word = 'flat';
    if (up) {
      cls = isAllergen ? 'red' : 'amber';
      subCls = isAllergen ? 'r' : 'a';
      arrow = '▲';
      word = isAllergen ? 'rising · safety' : 'rising';
    } else if (r.delta < 0) {
      if (blind) { cls = 'muted'; subCls = ''; arrow = '·'; word = 'no input — not easing'; }
      else { cls = 'green'; subCls = 'g'; arrow = '▼'; word = 'easing'; }
    }
    const deltaTxt = r.delta === 0 ? '±0' : `${r.delta > 0 ? '+' : ''}${r.delta}`;
    return `<div class="tile ${cls}">
      <div class="lab">${S.escapeHtml(r.code)}</div>
      <div class="val">${S.fmtInt(r.cur)}</div>
      <div class="sub${subCls ? ' ' + subCls : ''}">prior ${S.fmtInt(r.prior)} · ${arrow} ${word} (${S.escapeHtml(deltaTxt)})</div>
    </div>`;
  }).join('');
  const note = blind
    ? `<div class="banner amber">Review input has collapsed in this window${coverage && coverage.cur != null && coverage.prior != null ? ` — ${S.fmtInt(coverage.cur)} reviews landed against ${S.fmtInt(coverage.prior)} in the prior 30 days` : ''}. A count of zero here means nothing arrived to count, not that a complaint stopped, so falls are NOT shown as easing. ${coverageNote ? S.escapeHtml(coverageNote) + ' ' : ''}Restore the feed before reading these as a trend.</div>`
    : '';
  return `${note}<div class="tiles">${tiles}</div>`;
}

function frequencyTable(frequency) {
  const head = `<thead><tr><th>Issue</th><th>All-time</th><th>Sample evidence</th></tr></thead>`;
  if (!frequency.length) {
    return `<table>${head}<tbody><tr><td colspan="3" class="empty-row">No issues extracted from reviews yet.</td></tr></tbody></table>`;
  }
  const body = frequency.map((r) => {
    const sample = r.sample ? `&ldquo;${S.escapeHtml(r.sample)}&rdquo;` : '<span class="empty-row" style="padding:0">no quote captured</span>';
    const conf = r.conf == null ? '' : ` <span class="tag">conf ${S.escapeHtml(r.conf <= 1 ? Math.round(r.conf * 100) + '%' : String(r.conf))}</span>`;
    return `<tr>
      <td><span class="chip ${r.code === ALLERGEN ? 'amber' : 'muted'}">${S.escapeHtml(r.code)}</span>${conf}</td>
      <td class="mono">${S.fmtInt(r.n)}</td>
      <td>${sample}</td>
    </tr>`;
  }).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function allergenAlert(allergen) {
  if (!allergen.length) return '';
  const items = allergen.map((e) => {
    const ev = e.summary ? ` — ${S.escapeHtml(e.summary)}` : '';
    const src = e.auto ? 'auto-flagged' : 'flagged';
    return `<div style="margin-top:4px"><span class="mono">${src} · ${S.escapeHtml(e.status || 'open')}</span>${ev}</div>`;
  }).join('');
  return `<div class="banner red">
    <b>⚠ ALLERGEN HANDLING — SAFETY ESCALATION</b> · ${allergen.length} open. Triage before anything else; this cannot wait on the normal loop.
    ${items}
  </div>`;
}

function escalationList(escOthers) {
  if (!escOthers.length) {
    return '<div class="banner muted">No further escalations open.</div>';
  }
  return escOthers.map((e) => {
    const ev = e.summary ? ` · ${S.escapeHtml(e.summary)}` : '';
    const src = e.auto ? 'auto' : 'manual';
    return `<div class="banner amber">
      <span class="mono"><span class="sdot amber"></span> ${S.escapeHtml(e.code)} · ${S.escapeHtml(e.status || 'open')} · ${src}</span>${ev}
    </div>`;
  }).join('');
}

function loopCloser(loops) {
  if (!loops.length) {
    return '<div class="banner muted">No closed loops yet — log an action below, then it shows here once a before/after rate is measured.</div>';
  }
  const cards = loops.map((l) => {
    const hasRates = l.bp != null && l.ap != null;
    const flag = l.dropped === false
      ? '<span class="chip amber" style="cursor:default">rate didn&#39;t drop</span>'
      : l.dropped === true
        ? '<span class="chip cyan" style="cursor:default">rate fell ✓</span>'
        : '';
    const bars = hasRates
      ? `<div class="mono" style="font-size:10.5px;color:var(--muted);margin:8px 0 3px">before · ${fmtPct(l.bp)}</div>
         <div class="rate-bar"><i class="before" style="width:${l.bp}%"></i></div>
         <div class="mono" style="font-size:10.5px;color:var(--muted);margin:7px 0 3px">after · ${fmtPct(l.ap)}</div>
         <div class="rate-bar"><i class="after" style="width:${l.ap}%"></i></div>`
      : '<div class="banner muted">rate not yet re-measured</div>';
    const when = l.actionDate ? `acted ${S.agoLabel(Math.max(0, Date.now() - l.actionDate))}` : 'undated';
    return `<div class="panel" style="margin-bottom:10px"><div class="panel-body">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:4px">
        <span class="chip ${l.code === ALLERGEN ? 'amber' : 'muted'}">${S.escapeHtml(l.code)}</span>
        ${flag}
        <span class="mono" style="margin-left:auto;font-size:10px;color:var(--muted)">${S.escapeHtml(when)} · ${S.escapeHtml(l.status || '—')}</span>
      </div>
      <div style="font-size:12.5px;color:var(--text-2);line-height:1.45">${S.escapeHtml(l.action)}</div>
      ${bars}
    </div></div>`;
  }).join('');
  const caveat = '<div class="banner muted" style="margin-top:0">Rates are over each action&#39;s review window; sample sizes are small — read these directionally, not as significance.</div>';
  return cards + caveat;
}

function logForm(codes) {
  if (!codes.length) return '';
  const opts = codes.map((c) => `<option value="${S.escapeHtml(c)}">${S.escapeHtml(c)}</option>`).join('');
  return `<div class="panel"><div class="panel-head"><h2>Log an action</h2><span class="meta">closes the loop · op:log_action</span></div>
    <div class="panel-body">
      <div data-log-form style="display:grid;grid-template-columns:minmax(180px,1fr) 2fr auto;gap:9px;align-items:center">
        <select name="issue_code" class="field">${opts}</select>
        <input name="action_taken" class="field" placeholder="what you changed (e.g. retrained kitchen on allergen labelling)">
        <button class="btn cyan" type="button" data-log-action>Log action</button>
      </div>
      <div class="mono" style="font-size:10px;color:var(--muted);margin-top:9px">Records an operator action against the issue so the loop-closer can measure the before/after rate. Read-only board · the single safe write.</div>
    </div></div>`;
}

function render(section, ctx) {
  const now = (ctx && ctx.now) || Date.now();
  const s = section || {};
  const stamp = stampHtml(s.computedAt || 0, now);

  if (s.empty) {
    const body = `<div class="banner muted">No issues extracted yet — the issues layer runs after reviews are ingested and tagged. Themes, trends, escalations and the loop-closer appear here once that pipeline has run.</div>`;
    return { stamp, body };
  }

  const allergen = allergenAlert(s.allergen || []);

  const body = `
    ${allergen}
    <div class="sec-label">Rising themes<span class="rule"></span><span class="mono" style="text-transform:none;letter-spacing:0">30-day window vs prior 30</span></div>
    ${risingTiles(s.rising || [], s.coverage, s.coverageNote)}

    <div class="sec-label">Frequency · all-time<span class="rule"></span></div>
    <div class="panel"><div class="panel-head"><h2>Extracted issues</h2><span class="meta">count + sample evidence</span></div>
      <div class="panel-body" style="padding-top:4px">${frequencyTable(s.frequency || [])}</div>
    </div>

    <div class="sec-label">Escalations<span class="rule"></span></div>
    ${escalationList(s.escOthers || [])}

    <div class="sec-label">Loop-closer · did the action move the rate?<span class="rule"></span></div>
    ${loopCloser(s.loops || [])}

    <div class="sec-label">Act<span class="rule"></span></div>
    ${logForm(s.codes || [])}
  `;
  return { stamp, body };
}

module.exports = {
  key: 'issues',
  route: '/coyote/issues', workspace: 'coyote',
  title: 'Issues',
  sub: 'Recurring themes · trends, the loop-closer, escalations',
  getSection,
  render,
};
