# Costs & Supplier Centre — Stage 1 gap map

*2026-07-22 · against the operator mock (`reference/Cost and Supplier Mock Module.html`; seven subtab screenshots `reference/mock-*.png`). Every "probe, don't assume" item was probed live this session — results inline.*

## Design-system verdict (Stage 1A)
The mock's `:root` is the **RCC canon** with the familiar generation-noise greys (bg `#0a0c0f` vs canon `#0b0d10`, panel2/line one hex off — **not adopted**, one canon) and `--orange:#ff8b55` appearing for the **second time** in the mock family (still 1-hex from the canon's own gradient stop `#ff8a5b`; the rejection holds — one orange family — but the recurrence is noted for the operator: say the word and it becomes a token). `--cyan` is already a token (Reservations). **No new components needed** — the grammar maps onto the existing set (kpi/panel/alert/barrow/meterRow/heatCell/mbar/waterfall/formula/driver/stackCol/emptyState + the P4 slider pattern for the cost scenario).

## THE PROBE RESULTS (the map's foundations)

1. **QB Bills / AP is effectively DEAD**: `qb_bills` holds **8 rows, all Apr–Oct 2022**; open AP = 2 bills £49.60. The venue pays suppliers **direct from the bank** — there is no bills ledger. ⇒ The brief's "bills/AP for Cash Commitments, 13-week cash-out from bill due dates" premise is corrected: **AP ageing = designed empty-state** ("QB Bills not in use — 8 rows since 2022"), and the 13-week cash-out derives from **recurring bank-outflow patterns + contractual lines** instead (below).
2. **The REAL supplier-spend wire is `qb_bank_txns` purchases by counterparty** (8-year depth): last 90d — Booker £64,059 (52 txns — the main food supplier), HMRC £22,342, Workman £21,354 (the rent agent), British Gas £15,319, Highland Council £11,926, John M Munro £11,199. Supplier scorecard/concentration panels draw from THIS.
3. **Processor fees — the Reconciliation unlock RESOLVES PARTIALLY**: the journal's "Bank charges (207)" carries £2,131 (Apr) / £1,778 (Mar) — card-fee-scale — then collapses to £38/£24/£15 (May–Jul). Reading: the processor moved to **net settlement** (fees deducted at source, invisible in the ledger). ⇒ Historical fees renderable; **current fees still need the processor statement** — the named unlock stands, now with the evidence.
4. **K-Series inventory/POs: UNVERIFIABLE — scope-gated.** All four candidate endpoints (`/o/op/1/inventory/items`, `/o/op/1/purchase-orders`, `/f/finance/v1/inventory`, `/o/op/data/items`) return **403** on the financial-api token — the same operations-scope wall as account-profiles (grant already requested with Lightspeed). Whether the venue uses these features cannot be determined from the box until that grant lands. ⇒ The Suppliers tab draws **QB-only** for now; the probe re-runs the day the scope arrives.
5. **QB journal depth**: 55,822 lines, 2018-11 → 2026-07 — the fixed/semi-fixed actuals + trend wires are strong. Rent renders via "Rent (205)" + the "Rent + SC Clearing Account" (quarterly-billed via Workman — the panel must aggregate both, basis captioned).

## Panel-by-panel (seven tabs)

### Executive
| Panel | Status / disposition |
|---|---|
| KPI strip (prime cost %, COGS %, labour %, contribution) | **PARTIAL** — labour % IMPORTS from the Labour Centre (summary figure + pointer, never duplicated); COGS % at QB category grain NOW; **prime cost = the one-home NEW fact living HERE** (COGS% + labour% on one basis, captioned); theoretical columns recipe-gated |
| 13-week cost and contribution trend | **NOW** (QB monthly interpolated to weeks is dishonest — render MONTHLY with the grain stated, or weekly where bank-txn grain supports it; disposition: monthly, stated) |
| Owner attention queue | **NOW** — real findings: supplier spend spikes (bank-txn deltas), fee-collapse anomaly, rent-step reminder, recipe-gate carrot |
| Profitability bridge | **PARTIAL** — revenue (RCC import/pointer) → COGS (QB) → labour (import) → overheads (QB) → contribution; theoretical overlay recipe-gated |
| Cost mix | **NOW** — QB category shares |
| Core control ratios | **PARTIAL** — same import discipline; **break-even + site contribution live HERE** (one home) |

### Cost Forecast
| Panel | Status |
|---|---|
| Interactive cost scenario (P4 slider pattern) | **NOW** — QB actuals base + the revenue projection import; client-only what-if |
| Scenario decision rule cards | canon text |
| 13-week cost outlook | **PARTIAL** — recurring-pattern outflows (bank-txn recurrence) + **the contractual rent step £60k → £65k from 2026-10-28 (lease canon) enters as a hard line, encoded not inferred** |
| Forward cost risks | **NOW** — energy trend, rates schedule, the rent step, fee-visibility gap |

### COGS & Inventory
| Panel | Status |
|---|---|
| Actual vs theoretical by category | **RECIPE-GATED** (theoretical side) — actual side NOW at QB category grain; the mock's split renders actual-only + the gate |
| COGS variance bridge | **RECIPE-GATED** — designed empty-state, the Calum/top-20/59.5% unlock line |
| Ingredient price watch | **INVOICE-LINE-GATED** (below) — empty-state naming the invoice-line build |
| Stock and waste control | **BLOCKED** — no stock counts in any wire (K-Series scope-gated; no QB inventory) — empty-state |
| Other variable cost control | **NOW** — QB categories (packaging, cleaning, etc.) |

### Recipe Margins — **the module's heart, ALL RECIPE-GATED**
Every panel (menu margin erosion watch, product economics matrix, the cost build, recipe data quality) = designed empty-state, the ONE unlock line: **"recipe costing: top-20 = 59.5% coverage, one session"** → `/coyote/recipes`. The recipe-data-quality panel CAN show the live coverage figures from the recipes worklist wires (real, small) — disposition: render the coverage numbers, gate the rest.

### Suppliers & Purchasing
| Panel | Status |
|---|---|
| Supplier scorecard + spend concentration | **NOW** — `qb_bank_txns` purchases by counterparty (8yr; Booker-led) — spend, share, trend per supplier |
| **Purchase price variance** | **INVOICE-LINE-GATED** — see the named build below |
| Invoice control queue | **EMPTY-STATE** — no bills ledger (probe 1) |
| Supplier dependency × performance matrix | **PARTIAL** — spend axis real; performance axis needs delivery/quality data that no wire holds — frame + the honest statement |
| Commercial opportunity register | canon-text + operator-entered future (not built in Stage 2 without a write-path ruling) |

### Fixed & Semi-Fixed
All four panels **NOW** from the QB journal (8yr): monthly overheads by account, cost behaviour map (fixed/semi classification captioned as a presentation judgment), trend + budget control, **renewal & commitment calendar seeded with the encoded rent step 2026-10-28**.

### Cash Commitments
| Panel | Status |
|---|---|
| 13-week cash commitment calendar | **PARTIAL** — recurring bank-outflow patterns (rent/rates/energy DDs from `qb_bank_txns` recurrence) + contractual lines; NOT bill due dates (no bills ledger — stated) |
| Accounts payable ageing | **EMPTY-STATE** — "QB Bills not in use (8 rows since 2022)" |
| P&L cost versus cash paid | **NOW** — journal vs bank-txn timing, month grain |
| Upcoming large commitments | **NOW** — rent step, rates schedule, recurring large DDs |
| Working-capital controls | **PARTIAL** — what the wires honestly support (cash-out cadence); debtor side n/a (cash business) |

## THE NAMED FUTURE BUILD — supplier invoice-line ingest
**The structural gap the mock itself names**: QB category totals cannot show *beef £7.21 → £7.84/usable-kg*. Purchase-price variance, ingredient price watch, and unit-price trends need **invoice-LINE data** (unit prices, pack sizes, yields → canonical ingredients, normalised units). Scoped as its own build, candidate routes sized:
1. **K-Series purchase/inventory endpoints** — *currently unverifiable* (403, operations scope); re-probe the day the grant lands. If the venue uses them: the cleanest route.
2. **Invoice-document ingest** — supplier invoices (Booker portal exports/PDFs → email-ingest like reviews/OpenTable) parsed to lines, mapped to the canonical `sub_items` ingredients (the recipes store is the natural home — pack_cost/pack_qty already model it). Booker alone = 52 invoices/90d; one supplier covers most COGS £.
Until it exists, both dependent panels are empty-states naming THIS build.

**STOP — awaiting the operator tap: the Stage-2 phase split + the orange-token question + (queued unlocks: the operations-scope grant chase, the processor statement source, and whether to commission the invoice-line ingest build).**
