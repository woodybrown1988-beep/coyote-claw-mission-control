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
  //
  // TWO CORRECTIONS (2026-08-21), both found by adversarially reviewing the google-feed fix:
  //
  //  (1) IT COUNTED ROWS, NOT TEXT. Only reviews WITH TEXT can produce an issue tag — that is what
  //      the extractor consumes. A window can hold plenty of rows and almost no text, and the
  //      counts would look healthy while the thing that generates tags had stopped.
  //  (2) IT AGGREGATED ACROSS PLATFORMS, so one platform's recovery hides another's collapse. Live
  //      today: OpenTable's text-bearing input fell 23 -> 3 and TripAdvisor's 11 -> 4, both far past
  //      this guard's own 50% rule — while Google went 12 -> 23 and carried the total to 46 -> 30,
  //      a 35% fall that does not trip it. The fix that restored Google is what masks the other two.
  //
  // THE CLASS: a guard evaluated on a SUM cannot see a change that one term conceals in another. If
  // the thing being protected is composed of independent sources, the guard belongs at source grain.
  // Window volumes, per platform AND per delivery route — see data.js reviewInputWindows. The
  // per-route split is what lets the banner say whether a fall is guests writing less or our own
  // pipeline dropping reviews, instead of asserting one and being wrong.
  const win = S.reviewInputWindows(q, nowMs);
  const covCur = win.cur;
  const covPrior = win.prior;
  // REPORTABLE, not just COLLAPSED. data.js deliberately separates the two: `collapsed` is what
  // GATES the trend tiles, `reportable` adds any route failure a sibling makes diagnosable even
  // where the platform total held up. Reading only `collapsed` here meant the pipeline verdict —
  // the ONE verdict the operator can act on — was computed on every request and shown on none.
  //
  // The model was right and the page threw the answer away. A test on the model passed throughout,
  // which is why it survived: the render is where the operator meets it, so the render is where it
  // has to be asserted.
  const asRow = (p) => ({ platform: p.platform, cur: p.cur, prior: p.prior, verdict: p.verdict });
  // TWO DIFFERENT QUESTIONS, AND CONFLATING THEM IS HOW THIS WENT WRONG TWICE.
  //   gatingPlatforms  — is the input too thin to read the tiles at all?  (genuine collapse only)
  //   reportedPlatforms — is there anything worth SAYING?                 (that, plus route failures)
  // A broken delivery route is worth naming even when the totals held up, but it must not silence
  // tiles that are perfectly readable. Reading only `collapsed` hid the actionable verdict; reading
  // only `reportable` gagged the tiles. They are separate because they answer separate questions.
  const gatingPlatforms = win.collapsed.map(asRow);
  // Unknown coverage is NOT treated as fine — if the corpus cannot be read, the tiles gate too.
  const inputCollapsed = !win.present
    ? true
    : (covPrior > 0 && covCur < covPrior * 0.5) || gatingPlatforms.length > 0;
  // SENTENCES TRAVEL WITH THEIR TAILS (2026-08-21, round-two audit). The first fix joined every
  // reportable sentence into one string and dropped it into the collapse banner, whose closing line
  // is derived from the GATING platforms — so a non-gating pipeline fault could put "Nothing in our
  // delivery to fix. Restore the route named above" into ONE banner: the exact self-contradiction
  // the closing-line fix existed to kill, rebuilt from its own parts. A sentence may only share a
  // banner with a tail that belongs to its platform's verdict, so the two sets are kept apart:
  //   gatingNote  — sentences for platforms that gated the tiles; the blind banner + its tail
  //   routeNotes  — sentences for non-gating route faults; their own banner, no borrowed tail
  const dropRows = S.inputDropVerdicts(win);
  // GROUPED BY VERDICT, EVEN AMONG THE GATING (round-three audit). Separating gating from
  // non-gating killed the contradiction across that boundary — and it reappeared INSIDE it the
  // moment two platforms gated with different verdicts: one joined string, one union-derived tail,
  // and the banner read "Nothing in our delivery to fix. ... Restore the route named above" again.
  // The rule was never "gating vs not"; it is that A SENTENCE MAY ONLY SHARE A BANNER WITH A TAIL
  // THAT MATCHES ITS OWN VERDICT — so the grouping has to be by verdict all the way down, each
  // group closing itself. Pipeline first: it is the only group the operator can act on tonight.
  const VERDICT_ORDER = { pipeline: 0, unknown: 1, platform: 2 };
  const gatingGroups = [];
  for (const r of dropRows.filter((x) => x.gating)) {
    const v = r.verdict || 'unknown';
    let g = gatingGroups.find((x) => x.verdict === v);
    if (!g) { g = { verdict: v, sentences: [] }; gatingGroups.push(g); }
    g.sentences.push(r.sentence);
  }
  gatingGroups.sort((a, b) => (VERDICT_ORDER[a.verdict] ?? 1) - (VERDICT_ORDER[b.verdict] ?? 1));
  const routeNotes = dropRows.filter((r) => !r.gating).map((r) => r.sentence);
  const coverage = { cur: covCur, prior: covPrior, collapsed: inputCollapsed, collapsedPlatforms: gatingPlatforms, gatingGroups, routeNotes };

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
// A FALL IS ONLY NEWS IF THE SAMPLE COULD HAVE SHOWN IT (2026-08-21).
//
// The tiles turned green on any negative delta. With 30 classified reviews this window against 46
// last, four codes went green on a CURRENT COUNT OF ZERO — and under no change at all, seeing zero
// was likely: ORDER_ACCURACY p=13%, FOOD_TEMP p=26%, PAYMENT_CASH p=26%, CLEANLINESS p=52%. The
// board was calling a coin flip an improvement, in the one place the operator looks to decide
// whether something he changed worked.
//
// THE CLASS: a count rendered as a DIRECTION needs the sample behind it to be capable of carrying
// one. This asks the only question that matters — if nothing had changed, how often would we see a
// number this low anyway? — and stays neutral when the answer is "often".
//
// Exact binomial tail: P(X <= cur) where X ~ B(curBase, priorCount/priorBase). Computed
// iteratively so it stays exact for the sizes involved and never overflows on a factorial.
function noChangeTailProb(cur, prior, curBase, priorBase) {
  if (!(priorBase > 0) || !(curBase > 0) || !(prior > 0)) return 1; // nothing to test against
  const p = Math.min(1, prior / priorBase);
  if (!(p > 0)) return 1;
  let term = Math.pow(1 - p, curBase); // P(X = 0)
  if (!Number.isFinite(term)) return 1;
  let acc = term;
  for (let k = 1; k <= cur && k <= curBase; k++) {
    term *= ((curBase - k + 1) / k) * (p / (1 - p));
    acc += term;
  }
  return Math.min(1, acc);
}
// Above this, a fall is not distinguishable from noise and must not be rendered as easing.
const NOISE_P = 0.10;

function risingTiles(rising, coverage, coverageNote) {
  // A fall is only "easing" if something was actually measured this window. When the review feed
  // has collapsed, every zero is the feed's silence, not the kitchen's improvement — so the tiles
  // stay neutral and say why, rather than turning green on an absence.
  const blind = !!(coverage && coverage.collapsed);
  // The denominators the counts are drawn from — reviews WITH TEXT, the only ones that can be tagged.
  const curBase = (coverage && coverage.cur) || 0;
  const priorBase = (coverage && coverage.prior) || 0;

  // BANNERS ARE BUILT BEFORE THE TILES DECIDE WHETHER TO EXIST (round-three audit). They used to
  // be composed after the tile loop, below an early return for an empty issue_trends — so on a
  // fresh trend table a live "delivery fault in our pipeline ... Restore it." was computed in
  // getSection and then never rendered: the round-one render gap, wearing its third outfit. What a
  // banner says has nothing to do with whether there are tiles to gate.
  const TAILS = {
    pipeline: ' Restore the route named above before reading these as a trend.',
    platform: ' Read these again once the written reviews return.',
    unknown: ' Establish the cause before reading these as a trend.',
  };
  // One banner PER VERDICT GROUP, each closing itself — a sentence may only share a banner with a
  // tail that matches its own verdict, and that rule holds among the gating exactly as it does
  // across the gating boundary. Separate divs also make the old contradiction a non-text-run: the
  // pinned regexes cannot match across </div>.
  const gatingBanners = ((coverage && coverage.gatingGroups) || [])
    .map((g) => `<div class="banner amber">${S.escapeHtml(g.sentences.join(' '))}${S.escapeHtml(TAILS[g.verdict] ?? TAILS.unknown)}</div>`)
    .join('');
  const routeNotes = (coverage && coverage.routeNotes) || [];
  const routeOnly = routeNotes.length
    ? `<div class="banner amber">${routeNotes.map((n) => S.escapeHtml(n)).join(' ')}</div>`
    : '';
  const note = blind
    ? `<div class="banner amber">Reviews WITH TEXT have collapsed in this window — ${S.fmtInt(curBase)} against ${S.fmtInt(priorBase)} in the prior 30 days. Only a review with text can produce a tag, so a count of zero here means nothing arrived to count, not that a complaint stopped: falls are NOT shown as easing.</div>`
    : '';
  // ALWAYS rendered (round-three audit): this was gated on !blind since #200, on the theory that
  // the collapse banner carried it — which stopped being true the moment the banner became
  // derived. A 43-day-silent feed's warning was dropped whenever an UNRELATED collapse fired:
  // a signal gated behind someone else's alarm.
  const covNote = coverageNote
    ? `<div class="banner amber">${S.escapeHtml(coverageNote)}</div>`
    : '';
  const banners = `${note}${gatingBanners}${routeOnly}${covNote}`;

  if (!rising.length) {
    return `${banners}<div class="banner muted">No trend window computed yet — rising themes appear once issue_trends is populated.</div>`;
  }
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
      const tail = noChangeTailProb(r.cur, r.prior, curBase, priorBase);
      if (blind) { cls = 'muted'; subCls = ''; arrow = '·'; word = 'no input — not easing'; }
      else if (tail > NOISE_P) { cls = 'muted'; subCls = ''; arrow = '·'; word = `down, but within normal variation (${Math.round(tail * 100)}% likely anyway)`; }
      else { cls = 'green'; subCls = 'g'; arrow = '▼'; word = 'easing'; }
    }
    const deltaTxt = r.delta === 0 ? '±0' : `${r.delta > 0 ? '+' : ''}${r.delta}`;
    return `<div class="tile ${cls}">
      <div class="lab">${S.escapeHtml(r.code)}</div>
      <div class="val">${S.fmtInt(r.cur)}</div>
      <div class="sub${subCls ? ' ' + subCls : ''}">prior ${S.fmtInt(r.prior)} · ${arrow} ${word} (${S.escapeHtml(deltaTxt)})</div>
    </div>`;
  }).join('');
  // The denominator travels with the numbers, always — this is what makes a fall readable.
  const base = `<div class="r-mini-note">Counts are over reviews WITH TEXT: ${S.fmtInt(curBase)} classified this window vs ${S.fmtInt(priorBase)} in the prior 30 days. A fall is only marked easing when it is unlikely (&lt;${Math.round(NOISE_P * 100)}%) to happen by chance at this sample size.</div>`;
  return `${banners}<div class="tiles">${tiles}</div>${base}`;
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
