# Revenue Command Centre — Stage 1B panel-by-panel gap map

*2026-07-21 · against the operator mock (`reference/Revenue mock tab.html`, screenshots `reference/mock-*.png`).*
*Every "verify" item in the brief was probed against the live DB this session; the probe results are stated inline.*
*Statuses: **NOW** = computable from a named source today · **PARTIAL** = named part missing · **BLOCKED** = named blocker; ships as the designed empty-state (the mock's own layout, honest content, unlock action named).*

## Executive

| Panel | Status | Source / blocker |
|---|---|---|
| KPI · Net revenue (ex-VAT) | **NOW** | `sales_day` / `v_sales_day_all` (per-receipt truth, API-era) |
| KPI · Gross sales | **NOW** | `sales_day.gross_sales_pence` |
| KPI · Covers | **BLOCKED** | OpenTable not flowing; POS `pos_guest_count` is NOT covers (canon `coyote-covers-from-opentable-not-pos`). Empty-state: "unlock = OpenTable email-ingest wire" |
| KPI · Average spend / cover | **BLOCKED** | needs covers (above) |
| KPI · Average transaction (ATV) | **NOW** | net ÷ transactions, `sales_by_channel` basis (canonical ruling; £38 target line exists) |
| KPI · Revenue quality score | **PARTIAL** | composite needs an operator-ruled definition; leakage inputs exist at day grain only (below). Ships as empty-state until ruled |
| 8-week net revenue trend (actual vs target vs LY) | **NOW** | actual `sales_day`; target = the banded formula's revenue basis (rota-review spec); LY `sales_day_history` via −364d weekday twin; premises guard applies |
| Decision feed | **NOW** | REAL findings only: rota-review verdicts (`rota_review_runs` £ deltas), reconcile findings (`sales_reconciliation`), ATV-gap vs £38, attachment signal (line grain). Each carries its computed £; nothing invented |
| Revenue by service channel (donut) | **NOW** | `sales_by_channel` (API-era window — coverage boundary 2026-06-30 enforced by the boxquery guard; same rule renders here as a caption) |
| Revenue by daypart | **NOW** | `sales_receipt_lines_api.time_of_sale_ms`, dayparts per the rota-review ruling (PREP<12/LUNCH/TROUGH/DINNER/LATE); ONLINE no-true-hour exclusion rendered honestly |
| Revenue quality panel | **PARTIAL** | discounts: day grain ONLY (probe: `sales_day.discounts_pence` real — e.g. £29.85 on 07-16 — but receipt/line `discount_pence` is 0 across all July: the field is stored, never populated by the wire). Voids/refunds: no VOID/REFUND receipt types in July (2 CANCELs) — the class renders when they occur. Processor fees: BLOCKED (below) |

## Revenue Drivers

| Panel | Status | Source / blocker |
|---|---|---|
| KPI · Revenue / trading hour | **NOW** | line grain hourly ÷ trading hours |
| KPI · Sales / labour hour (SPLH) | **NOW** | the labour cross-ruler intersection (existing discipline) |
| KPI · Peak revenue hour | **NOW** | `sales_hourly` / line grain |
| KPI · Covers / transaction | **BLOCKED** | covers (OpenTable) |
| KPI · Drink attachment % | **NOW** — *verified this session* | line grain shares `receipt_id` (July: 2,515 receipts; 797 with drink-class lines). Caveat: `accounting_group` on lines is numeric codes → needs the accounting-groups dict join for the drink/side classes |
| KPI · Side attachment % | **NOW** | same mechanism |
| Hourly revenue heatmap | **NOW** | `time_of_sale_ms`; ONLINE no-true-hour ruling: excluded cells rendered as no-data, stated in the panel sub |
| Capacity and demand conversion | **BLOCKED** | covers / seat-use / wait-lost = OpenTable not flowing. Empty-state carries the mock's table layout with the blocker + unlock |
| Daily trading scorecard | **NOW** | net (`sales_day`) / YoY (`sales_day_history`, premises guard) / labour hrs + SPLH (rota-review joins) / discounts at day grain |

## Menu Growth

| Panel | Status | Source / blocker |
|---|---|---|
| KPI strip (products, weekly £ at risk, movers, dogs) | **PARTIAL** | units/mix/trend: NOW from line grain. £-at-risk + dogs need CONTRIBUTION → blocked by `recipe_lines = 0` (verified: still 0 — the Calum gate) |
| Menu engineering portfolio (bubble matrix) | **BLOCKED** | contribution axis needs recipe costs. Empty-state = the mock's quadrant layout + "costing the top-20 unlocks this tab — 59.5% of net sales covered in one afternoon" (the recipes worklist carrot, live number) |
| Same-period decline watch | **NOW** | line-grain product trend, same-period windows |
| Canonical product performance table | **PARTIAL** | units / net / mix% / trend: NOW (line grain). Contribution + margin-class columns render as per-column empty-states naming the Calum gate |

## Reconciliation

| Panel | Status | Source / blocker |
|---|---|---|
| KPI · Expected tenders | **NOW** | `sales_payments_api` (tender totals by method) |
| KPI · Processed / banked | **PARTIAL** | bank side: `qb_bank_txns` holds POSTED deposits (QuickBooks Phase-0 rule: match on POSTED, "For Review" not exposed). The MATCH build is new work; both sides exist |
| KPI · Gross variance | **PARTIAL** | computable once the match lands |
| KPI · Processor fees | **BLOCKED** — *verified this session* | `sales_payments_api` columns: `net_with_tax_pence`, `tip_pence`, `surcharge_pence` — **no fee field exists in the POS record**. Fees are a processor-statement/QB fact. Empty-state names it |
| KPI · Refunds | **PARTIAL** | refund receipt types are real but rare (none in July); renders when present, zero-state honest |
| KPI · Unresolved exceptions | **NOW** | existing findings classes |
| Tender-to-bank table | **PARTIAL** | tenders NOW; bank rows from `qb_bank_txns` (POSTED); match status = the new build |
| Control formulas card | **NOW** | verbatim canonical rulings (ATV basis, day-net basis, single-writer pointers) — text, no computation |
| Gross-to-net bridge | **PARTIAL** | day grain NOW (gross, discounts, refunds, service, net from `sales_day`); per-receipt attribution not populated by the wire (probe above) |
| Exception ledger | **NOW** + build | fed by existing findings classes; owner/status columns are new fields (small schema addition, cc side) |

## Revenue Forecast

| Panel | Status | Source / blocker |
|---|---|---|
| KPI strip (YTD, YoY, full-year forecast, adjusted, carry-forward, vs 2025) | **NOW** | the ruled P1 projection engine + `v_sales_month` / history |
| Monthly clustered columns 2024/2025/2026 + hatched forecast | **NOW** | `v_sales_month` + history + projection; hatched bars = forecast months (mock's `.forecast-bar` grammar, ported) |
| Forecast engine card (auto rule) | **NOW** | the RULED method stands: seasonality-aware headline + simple grey sanity line + projection-basis caption |
| Management override slider | **build** | NEW: an explicit logged operator assumption — default 0%, every non-zero override journaled with a reason field (write path = a narrow gated op, same discipline as review-action) |
| Monthly planning table | **NOW** + wire | projection per month; "labour-feed input" linkage = the rota-review formula's forecast basis (already reads projections — the wire is a pointer, not a copy, per single-writer) |
| Forecast governance card | **NOW** | canon text (comparable calendar, revenue basis, known-event overrides = the journaled overrides, labour handoff) |

## Cross-cutting rules restated
- **No mock numbers ever render.** Every computed figure carries its source caption per the canon; every blocked panel is the designed empty-state naming blocker + unlock.
- **One home per fact**: panels absorbed into the RCC (the current Reports long-range section, decomposition, QR/ATV lines) are REMOVED from their old homes in the same PR that lands them here.
- **Coverage honesty**: channel/daypart/product panels state the API-era boundary (2026-06-30) exactly as the boxquery guard now enforces it; product HISTORY comes from `sales_receipt_lines_api` (2023-07 →).
- **Golden proof per phase**: non-revenue pages byte-identical; the operator's eye is the visual gate (side-by-side vs `reference/mock-*.png`).

## Unlock actions (the operator-facing list)
1. **Covers family** (Executive covers/spend-per-cover, Drivers capacity table): wire the OpenTable email export → covers store.
2. **Contribution family** (Menu Growth portfolio + contribution columns, £-at-risk): Calum's recipe costs — top-20 = 59.5 % of net sales covered.
3. **Processor fees** (Reconciliation): decide the source — QB fee lines or processor statement ingest.
4. **Revenue quality score** (Executive): rule the composite's definition.
