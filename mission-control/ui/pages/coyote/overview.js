'use strict';
// Overview — the cockpit, redesigned per the 2026-07-21 audit: "vital information without
// overload". Layers: (1) ACTION BAND — what needs you; (2) RISING ISSUES; (3) THE WEEK —
// yesterday + last full week as VERDICT tiles; (4) WEEK AHEAD — the board's only forward panel
// (forecast vs rota'd labour per day + the FORWARD rota verdict); (5) VERDICT LINES that link
// out to each number's ONE home (decomposition → Reports, QR ATV → Reports, labour → Labour /
// Rota Review) — the old P2/P3/P4 tables are gone from here (the decomposition table now lives
// in Reports); (6) SYSTEM — alert-only: renders a single green line unless something is red.
// READ-ONLY / navigational; no fabricated numbers; honest freshness everywhere.
const S = require('../../shared.js');
const K = require('../../kpi.js');

// The £38/order QR target is RETIRED (operator ruling 2026-07-31): a QR sitting places several
// orders from several phones, so per-order ATV structurally understates QR spend. The verdict
// line renders spend per SITTING instead; per-cover is the honest comparison once the OpenTable
// covers feed is regular. Evidence + sitting-key derivation: docs/qr-sitting-basis-2026-07-31.md.

function toInt(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function toNum(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function row(res) { return res && res.ok && res.rows && res.rows.length ? res.rows[0] : null; }
function rows(res) { return res && res.ok && res.rows ? res.rows : []; }

/** Compact recipe economics for the cockpit. Recipe eligibility deliberately retains the
 * existing Overview gate; only the sales denominator and its effective period come from the
 * shared canonical, explicitly ex-VAT item feed. */
function buildOverviewRecipeEconomics(q) {
  const recipeLineCount = toInt((row(q(`SELECT COUNT(*) c FROM recipe_lines`)) || {}).c);
  const out = {
    recipeLineCount, from: null, to: null, allNetPence: null, coveredNetPence: null,
    theoreticalCostPence: null, achievedAverageNetPence: null,
    theoreticalPct: null, coveragePct: null,
  };
  if (recipeLineCount <= 0) return out;

  const itemSales = S.readCanonicalItemSales(q);
  if (!itemSales.from || !itemSales.to) return out;

  const recipeRows = rows(q(
    `SELECT p.id, p.lightspeed_sku sku,
            COUNT(rl.sub_item_id) recipe_line_count,
            SUM(CASE WHEN rl.sub_item_id IS NOT NULL
                          AND (si.id IS NULL OR si.pack_cost_pence IS NULL OR si.pack_qty IS NULL)
                     THEN 1 ELSE 0 END) incomplete_line_count,
            SUM(rl.quantity * CAST(si.pack_cost_pence AS REAL) / si.pack_qty) unit_cost_pence
       FROM products p
       LEFT JOIN recipe_lines rl ON rl.product_id = p.id
       LEFT JOIN sub_items si ON si.id = rl.sub_item_id
      GROUP BY p.id, p.lightspeed_sku`))
    .filter((r) => toInt(r.recipe_line_count) > 0 && toInt(r.incomplete_line_count) === 0)
    .sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || ''))
      || String(a.id || '').localeCompare(String(b.id || '')));
  const recipeCosts = new Map();
  for (const recipe of recipeRows) {
    const sku = recipe.sku == null ? '' : String(recipe.sku);
    if (sku && !recipeCosts.has(sku)) recipeCosts.set(sku, toNum(recipe.unit_cost_pence));
  }

  const allNetPence = itemSales.rows.reduce((sum, sale) => sum + sale.net, 0);
  let coveredNetPence = 0;
  let coveredUnits = 0;
  const theoreticalTerms = [];
  for (const sale of itemSales.rows) {
    if (!recipeCosts.has(sale.sku)) continue;
    coveredNetPence += sale.net;
    coveredUnits += sale.units;
    const achieved = sale.units !== 0 ? sale.net / sale.units : null;
    const unitCost = recipeCosts.get(sale.sku);
    if (achieved != null && achieved !== 0 && unitCost != null) {
      theoreticalTerms.push(sale.net * unitCost / achieved);
    }
  }
  const theoreticalCostPence = theoreticalTerms.length
    ? theoreticalTerms.reduce((sum, value) => sum + value, 0) : null;
  return {
    recipeLineCount, from: itemSales.from, to: itemSales.to,
    allNetPence, coveredNetPence, theoreticalCostPence,
    achievedAverageNetPence: coveredUnits !== 0 ? coveredNetPence / coveredUnits : null,
    theoreticalPct: coveredNetPence > 0 && theoreticalCostPence != null
      ? (theoreticalCostPence / coveredNetPence) * 100 : null,
    coveragePct: allNetPence > 0 ? (coveredNetPence / allNetPence) * 100 : null,
  };
}

module.exports = {
  key: 'overview', route: '/coyote/overview', workspace: 'coyote', title: 'Overview', sub: 'The cockpit · what needs you, then the week behind and the week ahead',
  buildOverviewRecipeEconomics,

  getSection(db, ctx) {
    const q = ctx.q;
    const now = ctx.now;
    const d = new Date(now);
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

    // (1a) jobs awaiting YOUR sign-off / plan feedback
    const signoff = toInt((row(q(`SELECT COUNT(*) c FROM jobs WHERE status = 'awaiting_signoff'`)) || {}).c);
    const planfb = toInt((row(q(`SELECT COUNT(*) c FROM jobs WHERE status = 'awaiting_plan_feedback'`)) || {}).c);

    // (1b) review reply queue — manual (copy & post) vs Google (Telegram tap)
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
    const escRows = rows(q(`SELECT issue_code, status, identified_at FROM review_actions WHERE escalate = 1 ORDER BY identified_at DESC`));
    let allergen = 0;
    for (const r of escRows) if (/allergen/i.test(String(r.issue_code || ''))) allergen += 1;
    const needsYou = signoff + planfb + replyTotal + escRows.length;

    // (2) rising issues
    const rising = rows(q(
      `SELECT issue_code, count_current, count_prior FROM issue_trends
        WHERE computed_at = (SELECT MAX(computed_at) FROM issue_trends) AND rising = 1
        ORDER BY count_current DESC`));

    // Compact recipe-cost overview: the complete-recipe gate is unchanged; achieved selling
    // price and coverage use the shared canonical ex-VAT item feed and its actual available span.
    const recipeCost = buildOverviewRecipeEconomics(q);

    // ============ (3) THE WEEK — computed AT READ TIME (canonical-source ruling) ============
    const kpiMaxRow = row(q(`SELECT MAX(business_date) d FROM v_sales_day_all WHERE premises='current'`));
    const kpiMax = kpiMaxRow && kpiMaxRow.d ? String(kpiMaxRow.d) : null;

    // Yesterday (the latest settled day) vs the same weekday LY (−364d keeps weekday alignment).
    let yesterday = null;
    if (kpiMax) {
      const ly = K.shiftDays(kpiMax, -364);
      const one = (dt) => row(q(`SELECT net_sales_pence net, transactions txn, premises FROM v_sales_day_all WHERE business_date = ?`, [dt]));
      const cur = one(kpiMax), prior = one(ly);
      yesterday = {
        date: kpiMax, net: cur ? toInt(cur.net) : null, txn: cur ? toInt(cur.txn) : null,
        lyDate: ly, lyNet: prior ? toInt(prior.net) : null, lyTxn: prior ? toInt(prior.txn) : null,
        comparable: !!(prior && String(prior.premises) === 'current'),
      };
    }

    // Last full week (Mon–Sun) vs same week LY (premises-guarded).
    let week = null;
    if (kpiMax) {
      const w = K.lastFullWeek(kpiMax);
      const ly = { from: K.shiftDays(w.from, -364), to: K.shiftDays(w.to, -364) };
      const agg = (a, b) => row(q(
        `SELECT SUM(net_sales_pence) net, SUM(transactions) txn, COUNT(*) days, SUM(premises = 'current') curdays
           FROM v_sales_day_all WHERE business_date BETWEEN ? AND ?`, [a, b])) || {};
      const cur = agg(w.from, w.to), prior = agg(ly.from, ly.to);
      const comparable = toInt(prior.days) > 0 && toInt(prior.curdays) === toInt(prior.days);
      week = {
        from: w.from, to: w.to, net: toInt(cur.net), txn: toInt(cur.txn), days: toInt(cur.days),
        lyNet: toInt(prior.net), lyTxn: toInt(prior.txn), lyDays: toInt(prior.days), comparable,
      };
    }

    // ============ (4) WEEK AHEAD — forecast vs rota'd labour per day + the FORWARD verdict ============
    // Sources: rota_ahead_budget (RC daily forecast targets) + rota_ahead_shifts (published rota,
    // hourly TRUE per shift; salaried is FIXED and lives in the FORWARD verdict, not per-day rows)
    // + the latest ok FORWARD run in rota_review_runs. Unpublished days say so — never zeros.
    const ahead = { days: [], forward: null, asOf: null };
    {
      const budgets = rows(q(`SELECT DISTINCT business_date d, revenue_target_pence t FROM rota_ahead_budget ORDER BY d LIMIT 8`));
      const shifts = rows(q(
        `SELECT business_date d, SUM(sched_minutes) mins, SUM(sched_cost_true_pence) hourly, COUNT(*) n, MAX(as_of) as_of
           FROM rota_ahead_shifts GROUP BY business_date ORDER BY d LIMIT 8`));
      const byDay = new Map(shifts.map((r) => [String(r.d), r]));
      for (const b of budgets) {
        const s = byDay.get(String(b.d));
        ahead.days.push({
          date: String(b.d), forecast: toInt(b.t) || null,
          rotaMins: s ? toInt(s.mins) : null, rotaHourly: s ? toInt(s.hourly) : null, shifts: s ? toInt(s.n) : 0,
        });
        if (s && s.as_of) ahead.asOf = Math.max(ahead.asOf || 0, toInt(s.as_of));
      }
      const fwd = row(q(`SELECT week_monday, ran_at, report_json FROM rota_review_runs WHERE mode='forward' AND status='ok' ORDER BY id DESC LIMIT 1`));
      if (fwd && fwd.report_json) {
        try {
          const rep = JSON.parse(String(fwd.report_json));
          const unpublished = (rep.gaps || []).some((g) => String(g).includes('PARTIALLY PUBLISHED'));
          ahead.forward = {
            week: String(fwd.week_monday), ranAt: toInt(fwd.ran_at), unpublished,
            verdicts: (rep.verdicts || []).map((v) => ({ dept: v.dept, deltaPence: v.deltaPence })),
          };
        } catch (e) { /* unreadable run — the rota-review page surfaces it */ }
      }
    }

    // ============ (5) VERDICT LINES — one line per demoted table, linking to its ONE home ============
    // (a) decomposition verdict: the CURRENT month's lever (table now lives in Reports)
    let decompNow = null;
    if (kpiMax) {
      const curMonth = kpiMax.slice(0, 7);
      const maxDay = kpiMax.slice(8, 10);
      const lyYm = `${Number(kpiMax.slice(0, 4)) - 1}-${kpiMax.slice(5, 7)}`;
      const monthAgg = (ym, cap) => row(q(
        `SELECT SUM(net_sales_pence) net, SUM(transactions) txn, COUNT(*) days, SUM(premises = 'current') curdays
           FROM v_sales_day_all WHERE substr(business_date, 1, 7) = ? AND substr(business_date, 9, 2) <= ?`, [ym, cap])) || {};
      const a = monthAgg(curMonth, maxDay), b = monthAgg(lyYm, maxDay);
      if (toInt(b.days) > 0 && toInt(a.curdays) === toInt(a.days) && toInt(b.curdays) === toInt(b.days)) {
        const dd = K.decompose(toInt(b.txn), toInt(b.net), toInt(a.txn), toInt(a.net));
        if (dd) decompNow = { month: curMonth, mtdDay: maxDay, delta: dd.delta, lead: dd.lead, lyNet: toInt(b.net) };
      }
    }
    // (b) QR vs EAT IN spend per SITTING, trailing 28 settled days from the PER-RECEIPT record.
    // Sitting keys (derivation: docs/qr-sitting-basis-2026-07-31.md): a STOREKIT table_name is a
    // real table or a daily QR session slot — re-orders land on the same slot, so date+name is one
    // sitting; EAT IN 'Table N.M' rows are split bills of one party (grouped to base table per
    // day); EAT IN 'Order N' is a per-device counter, so each closed tab is one sitting.
    let qr = null;
    if (kpiMax) {
      const from = K.shiftDays(kpiMax, -27);
      const rs = rows(q(
        `SELECT m.channel_label ch, SUM(r.net_without_tax_pence) net, COUNT(*) txn,
                COUNT(DISTINCT CASE
                  WHEN m.channel_label = 'STOREKIT ORDER & PAY' THEN r.business_date || '|' || r.table_name
                  WHEN r.table_name LIKE 'Table %' THEN r.business_date || '|T' || CAST(substr(r.table_name, 7) AS INTEGER)
                  ELSE 'R' || r.receipt_id END) sittings
           FROM sales_receipts_api r JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
          WHERE r.business_date BETWEEN ? AND ? AND m.channel_label IN ('STOREKIT ORDER & PAY', 'EAT IN')
            AND r.cancelled = 0 AND (r.type IS NULL OR r.type NOT IN ('VOID','CANCEL','RECALL'))
          GROUP BY 1`, [from, kpiMax]));
      const sk = rs.find((x) => x.ch === 'STOREKIT ORDER & PAY');
      const eat = rs.find((x) => x.ch === 'EAT IN');
      if (sk && toInt(sk.sittings) > 0) {
        qr = {
          perSit: toInt(sk.net) / toInt(sk.sittings), sittings: toInt(sk.sittings),
          atv: toInt(sk.net) / toInt(sk.txn), txn: toInt(sk.txn),
          eatPerSit: eat && toInt(eat.sittings) > 0 ? toInt(eat.net) / toInt(eat.sittings) : null,
          from, to: kpiMax,
        };
      }
    }
    // (c) labour verdict: last full week, scorecard ruler (the tables live in Labour / Rota Review)
    let labourWeek = null;
    if (kpiMax) {
      const w = K.lastFullWeek(kpiMax);
      const act = row(q(
        `SELECT SUM(ld.act_cost_rc_pence) cost, COUNT(DISTINCT ld.business_date) days
           FROM labour_dept ld JOIN v_sales_day_all s ON s.business_date = ld.business_date
          WHERE ld.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0`, [w.from, w.to])) || {};
      const actNet = row(q(
        `SELECT SUM(net) net FROM (
           SELECT DISTINCT s.business_date, s.net_sales_pence AS net
             FROM v_sales_day_all s JOIN labour_dept ld ON ld.business_date = s.business_date
            WHERE s.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0)`, [w.from, w.to])) || {};
      const bud = row(q(
        `SELECT SUM(b.labour_pct * s.net_sales_pence) pence FROM labour_budget b
           JOIN v_sales_day_all s ON s.business_date = b.business_date
          WHERE b.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0`, [w.from, w.to])) || {};
      const aNet = toInt(actNet.net);
      labourWeek = {
        from: w.from, to: w.to, days: toInt(act.days),
        actPct: aNet > 0 && toInt(act.days) > 0 ? (toInt(act.cost) / aNet) * 100 : null,
        budPct: aNet > 0 ? (Number(bud.pence || 0) / aNet) * 100 : null,
      };
    }

    // (6) system strip — gathered always, RENDERED only when something is off
    const lastIngest = toInt((row(q(`SELECT MAX(fetched_at) f FROM review_snapshot`)) || {}).f);
    const spent = toInt((row(q(`SELECT COALESCE(SUM(cost_pence),0) s FROM spend_log WHERE created_at >= ?`, [monthStart])) || {}).s);
    const ceilRow = row(q(`SELECT value FROM system_state WHERE key = 'monthly_ceiling_pence' LIMIT 1`));
    const ceiling = ceilRow ? toInt(ceilRow.value) : 0;
    const doneToday = toInt((row(q(`SELECT COUNT(*) c FROM jobs WHERE status = 'done' AND updated_at >= ?`, [dayStart])) || {}).c);

    return {
      now, needsYou, signoff, planfb, manualReplies, googleReplies, replyTotal,
      escalations: escRows.length, allergen,
      rising: rising.map((r) => ({ code: r.issue_code, cur: toInt(r.count_current), prior: toInt(r.count_prior) })),
      kpiMax, yesterday, week, ahead, decompNow, qr, labourWeek, recipeCost,
      lastIngest, spent, ceiling, doneToday,
      halt: ctx.halt || { halted: false, source: '' },
    };
  },

  render(section, ctx) {
    const m = section || {};
    const now = m.now || (ctx && ctx.now) || Date.now();
    const esc = S.escapeHtml;
    const parts = [];
    const gbp = (p) => S.fmtGbpPence(Math.round(p));
    const signedGbp = (p) => `${p >= 0 ? '+' : '−'}${gbp(Math.abs(p))}`;
    const pct = (cur, base) => (base > 0 ? `${cur >= base ? '+' : '−'}${Math.abs(((cur - base) / base) * 100).toFixed(1)}%` : '—');
    const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7))]} ${ym.slice(0, 4)}`;
    const dowShort = (iso) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T12:00:00Z`).getUTCDay()];

    const stampFresh = S.freshness(m.lastIngest || 0, now);
    const stamp = `review ingest · ${stampFresh.cls === 'fresh' ? `<b>${stampFresh.label}</b>` : `<span class="${stampFresh.cls}">${stampFresh.label}</span>`}`;

    // ============ (1) ACTION BAND ============
    parts.push(`<div class="sec-label">What needs you<span class="rule"></span></div>`);
    if (!m.needsYou) {
      parts.push(`<div class="banner muted"><span class="sdot green"></span>&nbsp; All clear — nothing is waiting on your tap right now. You'll see a red marker here the moment a job or reply needs you.</div>`);
    } else {
      const tiles = [];
      const signTotal = (m.signoff || 0) + (m.planfb || 0);
      const signSubBits = [];
      if (m.signoff) signSubBits.push(`${S.fmtInt(m.signoff)} build sign-off`);
      if (m.planfb) signSubBits.push(`${S.fmtInt(m.planfb)} plan feedback`);
      tiles.push(`<div class="tile ${signTotal ? 'red' : 'muted'}">
         <div class="lab">Awaiting your sign-off</div><div class="val">${S.fmtInt(signTotal)}</div>
         <div class="sub${signTotal ? ' r' : ''}">${signTotal ? esc(signSubBits.join(' · ')) : 'no jobs held at a gate'}</div>
         <div><a class="tag" href="/claw/engine">Open the engine room →</a></div></div>`);
      const replySub = m.replyTotal
        ? `${S.fmtInt(m.manualReplies)} to copy &amp; post · ${S.fmtInt(m.googleReplies)} Google (tap)` : 'reply queue clear';
      tiles.push(`<div class="tile ${m.replyTotal ? '' : 'muted'}">
         <div class="lab">Review replies</div><div class="val">${S.fmtInt(m.replyTotal || 0)}</div>
         <div class="sub">${replySub}</div><div><a class="tag" href="/coyote/reviews">Go to queue →</a></div></div>`);
      const escSub = m.allergen
        ? `<span class="sub r">⚠ ALLERGEN · ${S.fmtInt(m.allergen)}</span>`
        : (m.escalations ? `${S.fmtInt(m.escalations)} open` : 'none escalated');
      tiles.push(`<div class="tile ${m.escalations ? 'amber' : 'muted'}">
         <div class="lab">Escalations</div><div class="val">${S.fmtInt(m.escalations || 0)}</div>
         <div class="sub${m.allergen ? '' : (m.escalations ? ' a' : '')}">${escSub}</div>
         <div><a class="tag" href="/coyote/issues">Open Issues →</a></div></div>`);
      parts.push(`<div class="tiles">${tiles.join('')}</div>`);
    }

    // ============ (2) RISING ISSUES ============
    if (m.rising && m.rising.length) {
      parts.push(`<div class="sec-label">Rising issues<span class="rule"></span></div>`);
      const chips = m.rising.map((r) => {
        const sharp = (r.prior === 0) || ((r.cur - r.prior) >= r.prior);
        return `<a class="chip ${sharp ? 'amber' : 'cyan'}" href="/coyote/issues">${esc(r.code)} ↑${S.fmtInt(r.cur)} <span class="muted">(was ${S.fmtInt(r.prior)})</span></a>`;
      }).join('');
      parts.push(`<div class="tiles" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${chips}</div>`);
    }

    // ============ (3) THE WEEK — yesterday + last full week, verdict tiles ============
    parts.push(`<div class="sec-label">The week<span class="rule"></span></div>`);
    const t = [];
    if (!m.kpiMax) {
      parts.push(`<div class="banner muted">No sales record yet — the daily ingest fills this in.</div>`);
    } else {
      if (m.yesterday && m.yesterday.net != null) {
        const y = m.yesterday;
        const cmp = y.comparable && y.lyNet != null && y.lyNet > 0;
        t.push(`<div class="tile ${cmp && y.net >= y.lyNet ? 'green' : ''}">
          <div class="lab">${esc(dowShort(y.date))} ${esc(y.date)} (latest settled)</div>
          <div class="val">${gbp(y.net)}</div>
          <div class="sub">${S.fmtInt(y.txn)} txn${cmp ? ` · ${pct(y.net, y.lyNet)} vs ${esc(dowShort(y.lyDate))} LY (${gbp(y.lyNet)})` : ' · no comparable LY day'}</div></div>`);
      }
      if (m.week) {
        const w = m.week;
        t.push(`<div class="tile ${w.comparable && w.net >= w.lyNet ? 'green' : ''}">
          <div class="lab">Last full week ${esc(w.from)} → ${esc(w.to)}</div>
          <div class="val">${gbp(w.net)}</div>
          <div class="sub">${S.fmtInt(w.txn)} txn${w.comparable ? ` · ${pct(w.net, w.lyNet)} net / ${pct(w.txn, w.lyTxn)} txn vs same week LY` : ' · LY not comparable (premises guard)'}</div></div>`);
      }
    }
    const rc = m.recipeCost || { recipeLineCount: 0 };
    const hasRecipes = toInt(rc.recipeLineCount) > 0;
    const fmtRecipePct = (v) => v !== null && v !== undefined && Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—';
    const theoreticalText = fmtRecipePct(rc.theoreticalPct);
    const coverageText = fmtRecipePct(rc.coveragePct);
    const recipePeriod = rc.from && rc.to
      ? ` · available item sales · ${esc(rc.from)} → ${esc(rc.to)}` : '';
    const recipeCopy = hasRecipes
      ? `Theoretical recipe cost ${theoreticalText} of covered ex-VAT sales · recipes cover ${coverageText} of ex-VAT sales · achieved sales and recipe costs are ex-VAT`
      : 'Theoretical cost will appear after recipes are added.';
    const recipeTone = !hasRecipes || (rc.theoreticalPct == null && rc.coveragePct == null)
      ? 'muted' : (rc.coveragePct >= 80 ? 'green' : 'amber');
    t.push(`<div class="tile ${recipeTone}">
      <div class="lab">Recipe costs${recipePeriod}</div><div class="val">${hasRecipes ? theoreticalText : 'No recipes'}</div>
      <div class="sub">${recipeCopy}</div><div><a class="tag" href="/coyote/costs">Open Costs →</a></div></div>`);
    parts.push(`<div class="tiles" style="grid-template-columns:repeat(2,minmax(240px,1fr))">${t.join('')}</div>`);

    // ============ (4) WEEK AHEAD — the forward panel ============
    parts.push(`<div class="sec-label">The week ahead<span class="rule"></span></div>`);
    if (!m.ahead || !m.ahead.days.length) {
      parts.push(`<div class="banner muted">No forward rota/forecast on file yet — the rota-ahead pull (daily 10:00) fills this in. <a href="/coyote/labour?tab=rota-review" style="color:var(--cyan,#22D3EE)">Rota Review →</a></div>`);
    } else {
      let fwdLine = '';
      if (m.ahead.forward) {
        const f = m.ahead.forward;
        const vs = f.verdicts.map((v) => v.deltaPence == null ? `${esc(v.dept)}: no budget`
          : `${esc(v.dept)} ${v.deltaPence > 0 ? `<span style="color:var(--amber,#FBBF24)">${signedGbp(v.deltaPence)} vs formula</span>` : `<span style="color:var(--green,#34D399)">${signedGbp(v.deltaPence)} vs formula</span>`}`).join(' · ');
        fwdLine = `<div class="rp-hint" style="margin:6px 0 10px">FORWARD verdict w/c ${esc(f.week)}: ${vs}${f.unpublished ? ' · <span style="color:var(--amber,#FBBF24)">kitchen rota unpublished — provisional</span>' : ''} · <a href="/coyote/labour?tab=rota-review" style="color:var(--cyan,#22D3EE)">full report →</a></div>`;
      }
      const rowsHtml = m.ahead.days.map((r) => `<tr>
        <td class="mono">${esc(dowShort(r.date))} ${esc(r.date.slice(5))}</td>
        <td class="mono">${r.forecast != null ? gbp(r.forecast) : '—'}</td>
        <td class="mono">${r.shifts > 0 ? `${(toInt(r.rotaMins) / 60).toFixed(1)}h · ${gbp(toInt(r.rotaHourly))}` : '<span class="rp-yoy-na">rota not published</span>'}</td>
      </tr>`).join('');
      parts.push(`${fwdLine}<div class="panel"><div class="panel-body">
        <table class="tbl"><thead><tr><th>day</th><th>forecast net (RC)</th><th>rota'd labour (hourly TRUE £; salaried fixed sits in the verdict)</th></tr></thead><tbody>${rowsHtml}</tbody></table>
        <div class="rp-hint" style="margin-top:6px">Forward bookings: none on file yet (OpenTable inbox) — demand model is history-only until files land.</div>
      </div></div>`);
    }

    // ============ (5) VERDICT LINES — each number's ONE home is a click away ============
    const lines = [];
    if (m.decompNow) {
      const dd = m.decompNow;
      lines.push(`<b>${esc(monthLabel(dd.month))} MTD (day ${esc(String(Number(dd.mtdDay)))})</b>: <span class="${dd.delta >= 0 ? 'rp-yoy-up' : 'rp-yoy-down'}">${signedGbp(dd.delta)} (${pct(dd.lyNet + dd.delta, dd.lyNet)})</span> vs LY — <b>${dd.lead === 'volume' ? 'COVERS-led' : 'SPEND-led'}</b> · <a href="/coyote/reports" style="color:var(--cyan,#22D3EE)">decomposition →</a>`);
    }
    if (m.qr) {
      const vs = m.qr.eatPerSit != null ? ` vs EAT IN ${gbp(m.qr.eatPerSit)}` : '';
      lines.push(`QR <b>${gbp(m.qr.perSit)}</b>/sitting${vs} (28d, ${S.fmtInt(m.qr.sittings)} QR sittings, per-receipt record) — <span style="opacity:.75">QR orders fragment per sitting; per-order ATV (${gbp(m.qr.atv)}) understates spend; per-cover basis is the honest comparison</span> · <a href="/coyote/reports" style="color:var(--cyan,#22D3EE)">channel mix →</a>`);
    }
    if (m.labourWeek && m.labourWeek.actPct != null) {
      const lw = m.labourWeek;
      const over = lw.budPct != null && lw.actPct > lw.budPct;
      lines.push(`Labour last week: <b>${lw.actPct.toFixed(1)}%</b> vs budget ${lw.budPct != null ? lw.budPct.toFixed(1) + '%' : '—'} (scorecard ruler, ${S.fmtInt(lw.days)}d)${over ? ' <span class="rp-yoy-down">over</span>' : ' <span class="rp-yoy-up">within</span>'} · <a href="/coyote/labour" style="color:var(--cyan,#22D3EE)">labour →</a> · <a href="/coyote/labour?tab=rota-review" style="color:var(--cyan,#22D3EE)">rota review →</a>`);
    }
    if (lines.length) {
      parts.push(`<div class="sec-label">Verdicts<span class="rule"></span></div>`);
      parts.push(`<div class="panel"><div class="panel-body" style="font-size:13px;line-height:2">${lines.map((l) => `<div>• ${l}</div>`).join('')}</div></div>`);
    }

    // ============ (6) SYSTEM — alert-only ============
    const sysBad = [];
    if (m.halt && m.halt.halted) sysBad.push(`<b>SYSTEM HALTED</b>${m.halt.source ? ` (${esc(String(m.halt.source))})` : ''}`);
    if (m.ceiling > 0 && m.spent >= m.ceiling) sysBad.push(`metered spend ceiling REACHED (${gbp(m.spent)} of ${gbp(m.ceiling)})`);
    else if (m.ceiling > 0 && m.spent >= m.ceiling * 0.8) sysBad.push(`metered spend at ${Math.round((m.spent / m.ceiling) * 100)}% of ceiling`);
    if (stampFresh.cls !== 'fresh') sysBad.push(`review ingest ${stampFresh.cls === 'stale' ? 'STALE' : 'never ran'}`);
    if (sysBad.length) {
      parts.push(`<div class="sec-label">System<span class="rule"></span></div>`);
      parts.push(`<div class="banner ${m.halt && m.halt.halted ? 'red' : 'amber'}">${sysBad.join(' · ')} · <a href="/claw/engine" style="color:inherit;text-decoration:underline">engine room →</a></div>`);
    } else {
      parts.push(`<div class="rp-hint" style="margin-top:16px"><span class="sdot green"></span>&nbsp; system green · ${S.fmtInt(m.doneToday)} job(s) done today · spend ${gbp(m.spent)} of ${gbp(m.ceiling)} · <a href="/claw/engine" style="color:var(--muted,#7a8)">engine room →</a></div>`);
    }

    return { stamp, body: `<style>.rp-hint{font-size:11px;color:var(--muted,#7a8)}.rp-yoy-up{color:var(--green,#34d399)}.rp-yoy-down{color:var(--red,#f87171)}.rp-yoy-na{color:var(--muted,#7a8);font-style:italic}</style>` + parts.join('\n') };
  },
};
