'use strict';
// Overview page — the 4-layer cockpit (ops-centre skin). Contract: { key, route, title, sub, getSection(db,ctx), render(section,ctx) }.
// getSection: SELECT-only via ctx.q. render: returns { stamp, body } using ../shared.js helpers.
// Layers: (1) ACTION BAND — what needs you, (2) RISING-ISSUES STRIP, (3) KPI TILES, (4) SYSTEM STRIP.
// READ-ONLY / navigational only: the overview links to the page that owns each safe write — it never
// renders a write control itself (no data-op, no log-form). No fabricated numbers; honest freshness.
const S = require('../../shared.js');
const K = require('../../kpi.js');

// The £38 QR checkpoint is a standing DECISION (docs/qr-upsell-spec.md:87 in coyote-claw) —
// a target, not a measured value, so it may live here per the canonical-source ruling.
const QR_TARGET_PENCE = 3800;

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function row(res) {
  return res && res.ok && res.rows && res.rows.length ? res.rows[0] : null;
}
function rows(res) {
  return res && res.ok && res.rows ? res.rows : [];
}

module.exports = {
  key: "overview", route: "/coyote/overview", workspace: "coyote", title: "Overview", sub: "The cockpit · what needs you, at a glance",

  getSection(db, ctx) {
    const q = ctx.q;
    const now = ctx.now;
    const d = new Date(now);
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

    // (1a) jobs awaiting YOUR sign-off / plan feedback
    const signoff = toInt((row(q(
      `SELECT COUNT(*) c FROM jobs WHERE status = 'awaiting_signoff'`)) || {}).c);
    const planfb = toInt((row(q(
      `SELECT COUNT(*) c FROM jobs WHERE status = 'awaiting_plan_feedback'`)) || {}).c);

    // (1b) review reply queue — split manual (TA/OT, copy & post on-board) vs Google (Telegram tap, off-board)
    const draftRows = rows(q(
      `SELECT platform, COUNT(*) c FROM review_drafts
        WHERE draft_status NOT IN ('responded','skipped','posted')
          AND (snoozed_until IS NULL OR snoozed_until < ?)
        GROUP BY platform`, [ctx.now]));
    let manualReplies = 0, googleReplies = 0;
    for (const r of draftRows) {
      const c = toInt(r.c);
      if (String(r.platform).toLowerCase() === 'google') googleReplies += c;
      else manualReplies += c;
    }
    const replyTotal = manualReplies + googleReplies;

    // (1c) escalations — ALLERGEN prominent
    const escRows = rows(q(
      `SELECT issue_code, status, identified_at FROM review_actions
        WHERE escalate = 1 ORDER BY identified_at DESC`));
    let allergen = 0;
    for (const r of escRows) if (/allergen/i.test(String(r.issue_code || ''))) allergen += 1;

    const needsYou = signoff + planfb + replyTotal + escRows.length;

    // (2) rising issues — latest computed set, rising only
    const rising = rows(q(
      `SELECT issue_code, count_current, count_prior FROM issue_trends
        WHERE computed_at = (SELECT MAX(computed_at) FROM issue_trends) AND rising = 1
        ORDER BY count_current DESC`));

    // ============ (3) BUSINESS KPI FEED — computed AT READ TIME from librarian.db ============
    // Canonical-source ruling (coyote-claw CLAUDE.md "Canonical sources"): operational numbers live
    // in the DB only; every value below is derived fresh per request — no stored copies, no
    // snapshot table. Counts are TRANSACTIONS (guest checks — the trustworthy series;
    // pos_guest_count is a POS artifact, NOT real covers, and is never rendered as covers).
    const kpiMaxRow = row(q(`SELECT MAX(business_date) d FROM v_sales_day_all WHERE premises='current'`));
    const kpiMax = kpiMaxRow && kpiMaxRow.d ? String(kpiMaxRow.d) : null;

    // ---- P1: last full week (Mon–Sun) vs same week LY. −364d keeps weekday alignment. ----
    let week = null;
    if (kpiMax) {
      const w = K.lastFullWeek(kpiMax);
      const ly = { from: K.shiftDays(w.from, -364), to: K.shiftDays(w.to, -364) };
      const agg = (a, b) => row(q(
        `SELECT SUM(net_sales_pence) net, SUM(transactions) txn, COUNT(*) days,
                SUM(premises = 'current') curdays
           FROM v_sales_day_all WHERE business_date BETWEEN ? AND ?`, [a, b])) || {};
      const cur = agg(w.from, w.to), prior = agg(ly.from, ly.to);
      // Premises guard: no raw YoY across the 2023-04-01 move (the two-ruler CLAUDE.md rule).
      const comparable = toInt(prior.days) > 0 && toInt(prior.curdays) === toInt(prior.days);
      week = {
        from: w.from, to: w.to, lyFrom: ly.from, lyTo: ly.to,
        net: toInt(cur.net), txn: toInt(cur.txn), days: toInt(cur.days),
        lyNet: toInt(prior.net), lyTxn: toInt(prior.txn), lyDays: toInt(prior.days),
        comparable,
      };
    }

    // ---- P2: monthly decomposition, current year vs LY. The diagnostic core:
    //   ΔR = (C1−C0)·A0 [volume effect] + (A1−A0)·C1 [spend effect] — exact identity.
    // Current month compared MTD (days 1..maxDay both years); incomplete/pre-move months carry a
    // reason and never a fabricated split.
    const decomp = [];
    if (kpiMax) {
      const yr = kpiMax.slice(0, 4);
      const lyYr = String(Number(yr) - 1);
      const curMonth = kpiMax.slice(0, 7);
      const maxDay = kpiMax.slice(8, 10);
      const monthAgg = (ym, dayCap) => row(q(
        `SELECT SUM(net_sales_pence) net, SUM(transactions) txn, COUNT(*) days,
                SUM(premises = 'current') curdays
           FROM v_sales_day_all
          WHERE substr(business_date, 1, 7) = ? AND substr(business_date, 9, 2) <= ?`,
        [ym, dayCap])) || {};
      const calDays = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
      for (let m = 1; m <= 12; m++) {
        const ym = `${yr}-${String(m).padStart(2, '0')}`;
        if (ym > curMonth) break;
        const partial = ym === curMonth;
        const cap = partial ? maxDay : '31';
        const lyYm = `${lyYr}-${String(m).padStart(2, '0')}`;
        const a = monthAgg(ym, cap), b = monthAgg(lyYm, cap);
        let reason = null;
        if (toInt(b.days) === 0) reason = 'no prior-year record';
        else if (toInt(a.curdays) !== toInt(a.days) || toInt(b.curdays) !== toInt(b.days)) reason = 'premises break — no raw YoY';
        else if (!partial && (toInt(a.days) < calDays(ym) || toInt(b.days) < calDays(lyYm))) reason = `incomplete record (${toInt(a.days)}/${calDays(ym)} vs ${toInt(b.days)}/${calDays(lyYm)} days)`;
        const d = reason === null ? K.decompose(toInt(b.txn), toInt(b.net), toInt(a.txn), toInt(a.net)) : null;
        decomp.push({
          month: ym, partial, mtdDay: partial ? maxDay : null,
          net: toInt(a.net), txn: toInt(a.txn), lyNet: toInt(b.net), lyTxn: toInt(b.txn),
          d, reason: reason !== null ? reason : (d === null ? 'zero transactions — no split' : null),
        });
      }
    }

    // ---- P3: ATV by channel, weekly. Channel data exists only from the sales_by_channel floor
    // (2026-06-30 onward — the ranged backfill carried day totals only). Days with day-totals-only
    // are counted as "no channel split", never rendered as zeros. ----
    const channels = { weeks: [], floor: null };
    const chFloorRow = row(q(`SELECT MIN(business_date) d FROM sales_by_channel`));
    if (chFloorRow && chFloorRow.d) {
      channels.floor = String(chFloorRow.d);
      const chRows = rows(q(
        `SELECT business_date, profile_name, SUM(net_sales_pence) net, SUM(transactions) txn
           FROM sales_by_channel GROUP BY business_date, profile_name`));
      const dayRows = rows(q(
        `SELECT business_date FROM v_sales_day_all WHERE business_date >= ? AND net_sales_pence > 0`,
        [channels.floor]));
      const wk = new Map(); // monday → { ch: Map(name→{net,txn}), chDays: Set, salesDays: Set }
      const bucket = (mon) => {
        if (!wk.has(mon)) wk.set(mon, { ch: new Map(), chDays: new Set(), salesDays: new Set() });
        return wk.get(mon);
      };
      for (const r of chRows) {
        const b = bucket(K.weekMonday(String(r.business_date)));
        const key = String(r.profile_name);
        const cur = b.ch.get(key) || { net: 0, txn: 0 };
        cur.net += toInt(r.net); cur.txn += toInt(r.txn);
        b.ch.set(key, cur);
        b.chDays.add(String(r.business_date));
      }
      for (const r of dayRows) bucket(K.weekMonday(String(r.business_date))).salesDays.add(String(r.business_date));
      for (const mon of [...wk.keys()].sort()) {
        const b = wk.get(mon);
        const atv = (name) => { const c = b.ch.get(name); return c && c.txn > 0 ? c.net / c.txn : null; };
        const eat = b.ch.get('EAT IN') || { net: 0, txn: 0 };
        const deal = b.ch.get('MON-FRI DEAL') || { net: 0, txn: 0 };
        channels.weeks.push({
          monday: mon,
          eatIn: atv('EAT IN'), deal: atv('MON-FRI DEAL'),
          server: (eat.txn + deal.txn) > 0 ? (eat.net + deal.net) / (eat.txn + deal.txn) : null,
          qr: atv('STOREKIT ORDER & PAY'), online: atv('ONLINE ORDER'), takeaway: atv('Take-Away'),
          chDays: b.chDays.size, salesDays: b.salesDays.size,
          noSplit: Math.max(0, b.salesDays.size - b.chDays.size),
        });
      }
    }

    // ---- P4: labour % weekly vs the DB-CANONICAL monthly budgets — the scorecard's ruler
    // (labour_budget × same-day net; pre-burden act_cost_rc_pence over cross-ruler intersection
    // days — the same ruler as /coyote/labour, NOT the vault policy numbers: two-ruler rule per
    // CLAUDE.md). Weeks with no labour rows render "awaiting rota backfill" — never interpolated. ----
    const labourWeeks = [];
    if (kpiMax) {
      const w0 = K.lastFullWeek(kpiMax);
      for (let i = 7; i >= 0; i--) {
        const from = K.shiftDays(w0.from, -7 * i), to = K.shiftDays(w0.to, -7 * i);
        const act = row(q(
          `SELECT SUM(ld.act_cost_rc_pence) cost, COUNT(DISTINCT ld.business_date) days
             FROM labour_dept ld JOIN v_sales_day_all s ON s.business_date = ld.business_date
            WHERE ld.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0`, [from, to])) || {};
        const actNet = row(q(
          `SELECT SUM(net) net FROM (
             SELECT DISTINCT s.business_date, s.net_sales_pence AS net
               FROM v_sales_day_all s JOIN labour_dept ld ON ld.business_date = s.business_date
              WHERE s.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0)`, [from, to])) || {};
        const bud = row(q(
          `SELECT SUM(b.labour_pct * s.net_sales_pence) pence FROM labour_budget b
             JOIN v_sales_day_all s ON s.business_date = b.business_date
            WHERE b.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0`, [from, to])) || {};
        const budNet = row(q(
          `SELECT SUM(net) net FROM (
             SELECT DISTINCT s.business_date, s.net_sales_pence AS net
               FROM v_sales_day_all s JOIN labour_budget b ON b.business_date = s.business_date
              WHERE s.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0)`, [from, to])) || {};
        const actCost = toInt(act.cost), aNet = toInt(actNet.net), bNet = toInt(budNet.net);
        labourWeeks.push({
          from, to, labourDays: toInt(act.days),
          actPct: aNet > 0 && toInt(act.days) > 0 ? (actCost / aNet) * 100 : null,
          budPct: bNet > 0 ? (Number(bud.pence || 0) / bNet) * 100 : null,
        });
      }
    }

    // (4) system strip
    const lastIngest = toInt((row(q(`SELECT MAX(fetched_at) f FROM review_snapshot`)) || {}).f);
    const spent = toInt((row(q(
      `SELECT COALESCE(SUM(cost_pence),0) s FROM spend_log WHERE created_at >= ?`, [monthStart])) || {}).s);
    const ceilRow = row(q(`SELECT value FROM system_state WHERE key = 'monthly_ceiling_pence' LIMIT 1`));
    const ceiling = ceilRow ? toInt(ceilRow.value) : 0;
    const doneToday = toInt((row(q(
      `SELECT COUNT(*) c FROM jobs WHERE status = 'done' AND updated_at >= ?`, [dayStart])) || {}).c);

    return {
      now,
      needsYou,
      signoff, planfb,
      manualReplies, googleReplies, replyTotal,
      escalations: escRows.length, allergen,
      rising: rising.map((r) => ({
        code: r.issue_code,
        cur: toInt(r.count_current),
        prior: toInt(r.count_prior),
      })),
      kpiMax, week, decomp, channels, labourWeeks,
      lastIngest,
      spent, ceiling,
      doneToday,
      halt: ctx.halt || { halted: false, source: '' },
    };
  },

  render(section, ctx) {
    const m = section || {};
    const now = m.now || (ctx && ctx.now) || Date.now();
    const esc = S.escapeHtml;
    const parts = [];

    // ---- stamp: freshness of the latest review_snapshot ----
    const stampFresh = S.freshness(m.lastIngest || 0, now);
    let stampInner;
    if (stampFresh.cls === 'fresh') stampInner = `<b>${stampFresh.label}</b>`;
    else if (stampFresh.cls === 'stale') stampInner = `<span class="stale">${stampFresh.label}</span>`;
    else stampInner = `<span class="none">${stampFresh.label}</span>`;
    const stamp = `review ingest · ${stampInner}`;

    // ============ (1) ACTION BAND ============
    parts.push(`<div class="sec-label">What needs you<span class="rule"></span></div>`);
    if (!m.needsYou) {
      parts.push(
        `<div class="banner muted"><span class="sdot green"></span>&nbsp; All clear — nothing is waiting on your tap right now. The fleet runs itself; you'll see a red marker here the moment a job or reply needs you.</div>`);
    } else {
      const tiles = [];

      // (a) sign-off
      const signTotal = (m.signoff || 0) + (m.planfb || 0);
      const signSubBits = [];
      if (m.signoff) signSubBits.push(`${S.fmtInt(m.signoff)} build sign-off`);
      if (m.planfb) signSubBits.push(`${S.fmtInt(m.planfb)} plan feedback`);
      tiles.push(
        `<div class="tile ${signTotal ? 'red' : 'muted'}">
           <div class="lab">Awaiting your sign-off</div>
           <div class="val">${S.fmtInt(signTotal)}</div>
           <div class="sub${signTotal ? ' r' : ''}">${signTotal ? esc(signSubBits.join(' · ')) : 'no jobs held at a gate'}</div>
           <div><a class="tag" href="/claw/agents">Open Agents →</a></div>
         </div>`);

      // (b) review reply queue
      const replySub = m.replyTotal
        ? `${S.fmtInt(m.manualReplies)} to copy &amp; post · ${S.fmtInt(m.googleReplies)} Google (tap)`
        : 'reply queue clear';
      tiles.push(
        `<div class="tile ${m.replyTotal ? '' : 'muted'}">
           <div class="lab">Review replies</div>
           <div class="val">${S.fmtInt(m.replyTotal || 0)}</div>
           <div class="sub">${replySub}</div>
           <div><a class="tag" href="/coyote/reviews">Go to queue →</a></div>
         </div>`);

      // (c) escalations — ALLERGEN prominent
      const escSub = m.allergen
        ? `<span class="sub r">⚠ ALLERGEN · ${S.fmtInt(m.allergen)}</span>`
        : (m.escalations ? `${S.fmtInt(m.escalations)} open` : 'none escalated');
      tiles.push(
        `<div class="tile ${m.escalations ? 'amber' : 'muted'}">
           <div class="lab">Escalations</div>
           <div class="val">${S.fmtInt(m.escalations || 0)}</div>
           <div class="sub${m.allergen ? '' : (m.escalations ? ' a' : '')}">${escSub}</div>
           <div><a class="tag" href="/coyote/issues">Open Issues →</a></div>
         </div>`);

      parts.push(`<div class="tiles">${tiles.join('')}</div>`);
    }

    // ============ (2) RISING-ISSUES STRIP ============
    parts.push(`<div class="sec-label">Rising issues<span class="rule"></span></div>`);
    if (m.rising && m.rising.length) {
      const chips = m.rising.map((r) => {
        const sharp = (r.prior === 0) || ((r.cur - r.prior) >= r.prior);
        const tone = sharp ? 'amber' : 'cyan';
        return `<a class="chip ${tone}" href="/coyote/issues">${esc(r.code)} ↑${S.fmtInt(r.cur)} <span class="muted">(was ${S.fmtInt(r.prior)})</span></a>`;
      }).join('');
      parts.push(`<div class="tiles" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${chips}</div>`);
    } else {
      parts.push(`<div class="banner muted">No rising issues in the latest trend window.</div>`);
    }

    // ============ (3) BUSINESS KPI FEED — four panels, all computed at read time ============
    const gbp = (p) => S.fmtGbpPence(Math.round(p));
    const gbpK = (p) => `£${(p / 100000).toFixed(1)}k`;
    const pct1 = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
    const atvF = (p) => (p === null || p === undefined ? '<span class="muted">no split</span>' : `£${(p / 100).toFixed(2)}`);
    parts.push(`<style>
      .kpi-tbl{width:100%;border-collapse:collapse;font-size:12px}
      .kpi-tbl th{text-align:right;color:#7d8aa5;font-weight:600;padding:4px 8px;border-bottom:1px solid #1e2a3f}
      .kpi-tbl th:first-child,.kpi-tbl td:first-child{text-align:left}
      .kpi-tbl td{text-align:right;padding:4px 8px;border-bottom:1px solid #141d2e;font-variant-numeric:tabular-nums}
      .kpi-pos{color:#34d399}.kpi-neg{color:#f87171}.kpi-dim{color:#7d8aa5}
      .kpi-panel{background:#0d1524;border:1px solid #1e2a3f;border-radius:10px;padding:12px;margin:8px 0}
      .kpi-panel .plab{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7d8aa5;margin-bottom:8px}
      .kpi-verdict{font-size:13px;padding:10px 12px;border-radius:8px;background:#101c30;border:1px solid #223252;margin:8px 0}
    </style>`);
    parts.push(`<div class="sec-label">Business — computed live from librarian.db (no stored copies)<span class="rule"></span></div>`);

    // ---- P1: headline strip ----
    const wv = m.week;
    if (wv && wv.days > 0) {
      const atv = wv.txn > 0 ? wv.net / wv.txn : null;
      const lyAtv = wv.lyTxn > 0 ? wv.lyNet / wv.lyTxn : null;
      const dNet = wv.comparable ? K.pctDelta(wv.net, wv.lyNet) : null;
      const dTxn = wv.comparable ? K.pctDelta(wv.txn, wv.lyTxn) : null;
      const dAtv = wv.comparable && atv !== null && lyAtv !== null ? K.pctDelta(atv, lyAtv) : null;
      const dcls = (v) => (v === null ? 'kpi-dim' : v < 0 ? 'kpi-neg' : 'kpi-pos');
      const lySub = wv.comparable
        ? `vs ${esc(wv.lyFrom)}…${esc(wv.lyTo)} LY`
        : 'LY window not comparable (premises rule)';
      const wtiles = [
        `<div class="tile green"><div class="lab">Net (ex-VAT) · wk ${esc(wv.from)}…${esc(wv.to)}</div><div class="val">${gbp(wv.net)}</div><div class="sub"><span class="${dcls(dNet)}">${pct1(dNet)}</span> ${lySub}</div></div>`,
        `<div class="tile blue"><div class="lab">Transactions (checks)</div><div class="val">${S.fmtInt(wv.txn)}</div><div class="sub"><span class="${dcls(dTxn)}">${pct1(dTxn)}</span> ${wv.comparable ? `LY ${S.fmtInt(wv.lyTxn)}` : 'no LY comparison'}</div></div>`,
        `<div class="tile"><div class="lab">Blended ATV /txn</div><div class="val">${atv === null ? '—' : atvF(atv)}</div><div class="sub"><span class="${dcls(dAtv)}">${pct1(dAtv)}</span> ${lyAtv !== null && wv.comparable ? `LY ${atvF(lyAtv)}` : ''}</div></div>`,
      ];
      parts.push(`<div class="tiles">${wtiles.join('')}</div>`);
      if (wv.days < 7) parts.push(`<div class="banner muted">Only ${wv.days}/7 days of the week have a sales record — deltas reflect the recorded days.</div>`);
    } else {
      parts.push(`<div class="banner muted">No sales record yet — the headline strip lights up with the first ingested day.</div>`);
    }

    // ---- P2: the decomposition — which lever is leaking ----
    parts.push(`<div class="kpi-panel"><div class="plab">Revenue delta decomposition — volume (fewer checks) vs spend (lower £/head) · monthly vs LY</div>`);
    const dm = (m.decomp || []).filter(Boolean);
    if (dm.length) {
      // verdict line for the CURRENT month (the last row)
      const curRow = dm[dm.length - 1];
      if (curRow && curRow.d) {
        const d = curRow.d;
        const pc = K.pctDelta(curRow.net, curRow.lyNet);
        parts.push(`<div class="kpi-verdict"><b>${esc(curRow.month)}${curRow.partial ? ` MTD (to day ${esc(String(Number(curRow.mtdDay)))})` : ''}: ${pct1(pc)} — ${d.lead === 'volume' ? 'COVERS-led' : 'SPEND-led'}.</b> Volume effect ${d.volume < 0 ? '−' : '+'}${gbp(Math.abs(d.volume))}, spend effect ${d.spend < 0 ? '−' : '+'}${gbp(Math.abs(d.spend))} (sum = actual delta ${d.delta < 0 ? '−' : '+'}${gbp(Math.abs(d.delta))}${d.checkOk ? ' ✓' : ' ✗ CHECK FAILED'}).</div>`);
      }
      // bars: shared scale across months
      const scale = Math.max(1, ...dm.filter((r) => r.d).map((r) => Math.max(Math.abs(r.d.volume), Math.abs(r.d.spend))));
      const W = 300, C = W / 2;
      const bar = (v, y, color) => {
        const len = Math.min(C - 2, Math.abs(v) / scale * (C - 2));
        const x = v < 0 ? C - len : C;
        return `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(1, len).toFixed(1)}" height="7" rx="1.5" fill="${color}"/>`;
      };
      const rowsHtml = dm.map((r) => {
        const label = `${esc(r.month)}${r.partial ? ' <span class="kpi-dim">MTD</span>' : ''}`;
        if (!r.d) return `<tr><td>${label}</td><td colspan="4" class="kpi-dim" style="text-align:left">${esc(r.reason || 'not comparable')}</td></tr>`;
        const d = r.d;
        const svg = `<svg width="${W}" height="18" style="vertical-align:middle"><line x1="${C}" y1="0" x2="${C}" y2="18" stroke="#223252" stroke-width="1"/>${bar(d.volume, 1, '#60a5fa')}${bar(d.spend, 10, '#f59e0b')}</svg>`;
        const cls = (v) => (v < 0 ? 'kpi-neg' : 'kpi-pos');
        return `<tr><td>${label}</td><td style="text-align:center">${svg}</td>` +
          `<td class="${cls(d.volume)}">${d.volume < 0 ? '−' : '+'}${gbpK(Math.abs(d.volume))}</td>` +
          `<td class="${cls(d.spend)}">${d.spend < 0 ? '−' : '+'}${gbpK(Math.abs(d.spend))}</td>` +
          `<td class="${cls(d.delta)}">${d.delta < 0 ? '−' : '+'}${gbpK(Math.abs(d.delta))}${d.checkOk ? '' : ' ✗'}</td></tr>`;
      }).join('');
      parts.push(`<table class="kpi-tbl"><thead><tr><th>month</th><th style="text-align:center"><span style="color:#60a5fa">■</span> volume · <span style="color:#f59e0b">■</span> spend</th><th>volume fx</th><th>spend fx</th><th>Δ net</th></tr></thead><tbody>${rowsHtml}</tbody></table>`);
      parts.push(`<div class="kpi-dim" style="font-size:11px;margin-top:6px">volume fx = Δchecks × LY ATV · spend fx = ΔATV × current checks — the two sum exactly to Δ net (identity; ✗ would flag a computation fault). Counts are transactions, not covers.</div>`);
    } else {
      parts.push(`<div class="banner muted">No monthly record yet.</div>`);
    }
    parts.push(`</div>`);

    // ---- P3: ATV by channel, weekly ----
    parts.push(`<div class="kpi-panel"><div class="plab">ATV by channel · weekly /txn — QR tracked against the £38 checkpoint (decision, qr-upsell-spec:87)</div>`);
    const cw = (m.channels && m.channels.weeks) || [];
    if (cw.length) {
      const qrCell = (v) => {
        if (v === null || v === undefined) return '<span class="muted">no split</span>';
        const ok = v >= QR_TARGET_PENCE;
        return `<span class="${ok ? 'kpi-pos' : 'kpi-neg'}">£${(v / 100).toFixed(2)}</span>`;
      };
      const rowsHtml = cw.map((r) => {
        const gap = r.eatIn !== null && r.qr !== null ? r.eatIn - r.qr : null;
        return `<tr><td>wk ${esc(r.monday)}</td><td>${atvF(r.eatIn)}</td><td>${atvF(r.deal)}</td><td>${atvF(r.server)}</td>` +
          `<td>${qrCell(r.qr)}</td><td>${atvF(r.online)}</td><td>${atvF(r.takeaway)}</td>` +
          `<td class="${gap !== null && gap > 1000 ? 'kpi-neg' : 'kpi-dim'}">${gap === null ? '—' : `£${(gap / 100).toFixed(2)}`}</td>` +
          `<td class="kpi-dim">${r.noSplit ? `${r.noSplit}d no channel split` : `${r.chDays}/${r.salesDays}d`}</td></tr>`;
      }).join('');
      parts.push(`<table class="kpi-tbl"><thead><tr><th>week</th><th>EAT IN</th><th>MON-FRI DEAL</th><th>server blend</th><th>QR (vs £38)</th><th>online</th><th>takeaway</th><th>EAT-IN−QR gap</th><th>coverage</th></tr></thead><tbody>${rowsHtml}</tbody></table>`);
      parts.push(`<div class="kpi-dim" style="font-size:11px;margin-top:6px">Channel data exists from ${esc(m.channels.floor || '')} (day-totals-only days say "no channel split", never zeros). server blend = EAT IN + MON-FRI DEAL. The EAT-IN−QR gap is the signal this panel tracks.</div>`);
    } else {
      parts.push(`<div class="banner muted">No channel-split data yet — sales_by_channel is empty. Day totals exist; channel ATV appears when the split lands.</div>`);
    }
    parts.push(`</div>`);

    // ---- P4: labour % weekly vs DB-canonical budgets ----
    parts.push(`<div class="kpi-panel"><div class="plab">Labour % · weekly vs RotaCloud monthly budgets — the scorecard ruler (pre-burden), not the vault policy</div>`);
    const lw = m.labourWeeks || [];
    if (lw.length) {
      const rowsHtml = lw.map((r) => {
        if (r.labourDays === 0) return `<tr><td>wk ${esc(r.from)}</td><td colspan="3" class="kpi-dim" style="text-align:left">awaiting rota backfill — no labour record this week</td></tr>`;
        const over = r.actPct !== null && r.budPct !== null && r.actPct > r.budPct;
        return `<tr><td>wk ${esc(r.from)}${r.labourDays < 7 ? ` <span class="kpi-dim">(${r.labourDays}/7d)</span>` : ''}</td>` +
          `<td class="${over ? 'kpi-neg' : 'kpi-pos'}">${r.actPct === null ? '—' : r.actPct.toFixed(1) + '%'}</td>` +
          `<td class="kpi-dim">${r.budPct === null ? 'no budget set' : r.budPct.toFixed(1) + '%'}</td>` +
          `<td class="${over ? 'kpi-neg' : 'kpi-dim'}">${r.actPct !== null && r.budPct !== null ? (r.actPct - r.budPct >= 0 ? '+' : '') + (r.actPct - r.budPct).toFixed(1) + 'pp' : '—'}</td></tr>`;
      }).join('');
      parts.push(`<table class="kpi-tbl"><thead><tr><th>week</th><th>actual %</th><th>budget %</th><th>Δ</th></tr></thead><tbody>${rowsHtml}</tbody></table>`);
      parts.push(`<div class="kpi-dim" style="font-size:11px;margin-top:6px">Actual = pre-burden RC cost ÷ same-day net over days with BOTH records (the /coyote/labour ruler). Budget = Σ(day budget % × day net). Missing weeks are stated, never interpolated.</div>`);
    } else {
      parts.push(`<div class="banner muted">No labour weeks computable yet.</div>`);
    }
    parts.push(`</div>`);

    // ============ (4) SYSTEM STRIP ============
    parts.push(`<div class="sec-label">System<span class="rule"></span></div>`);
    const stiles = [];

    // ingest freshness
    const ing = S.freshness(m.lastIngest || 0, now);
    const ingTone = ing.cls === 'fresh' ? 'green' : (ing.cls === 'stale' ? 'amber' : 'muted');
    const ingVal = ing.cls === 'fresh' ? 'LIVE' : (ing.cls === 'stale' ? 'STALE' : '—');
    stiles.push(
      `<div class="tile ${ingTone}"><div class="lab">Review ingest</div><div class="val">${ingVal}</div><div class="sub${ing.cls === 'stale' ? ' a' : ''}">${ing.label}</div></div>`);

    // spend this month vs ceiling
    const spent = m.spent || 0;
    const ceiling = m.ceiling || 0;
    let spendTone = 'green', spendCls = ' g';
    if (ceiling > 0 && spent >= ceiling) { spendTone = 'red'; spendCls = ' r'; }
    else if (ceiling > 0 && spent >= ceiling * 0.8) { spendTone = 'amber'; spendCls = ' a'; }
    const ceilSub = ceiling > 0 ? `of ${S.fmtGbpPence(ceiling)} ceiling` : 'no ceiling set';
    stiles.push(
      `<div class="tile ${spendTone}"><div class="lab">Spend this month</div><div class="val">${S.fmtGbpPence(spent)}</div><div class="sub${ceiling > 0 ? spendCls : ''}">${ceilSub}</div></div>`);

    // jobs done today
    stiles.push(
      `<div class="tile blue"><div class="lab">Jobs done today</div><div class="val">${S.fmtInt(m.doneToday || 0)}</div><div class="sub">since 00:00 UTC</div></div>`);

    // halt state
    const halted = !!(m.halt && m.halt.halted);
    const haltSrc = m.halt && m.halt.source ? esc(String(m.halt.source)) : '';
    stiles.push(
      `<div class="tile ${halted ? 'red' : 'green'}"><div class="lab">System state</div><div class="val">${halted ? 'HALTED' : 'LIVE'}</div><div class="sub${halted ? ' r' : ' g'}">${halted ? ('halt · ' + (haltSrc || 'operator')) : 'claims + poller running'}</div></div>`);

    parts.push(`<div class="tiles">${stiles.join('')}</div>`);

    return { stamp, body: parts.join('\n') };
  },
};
