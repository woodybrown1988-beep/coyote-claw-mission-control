# Inventory Centre — Stage 1: probe results + readiness verdict

*2026-07-22 · the blocking probe against the live K-Series API, then the four-way panel verdict.
No tokens extracted, no panels scoped — per the operator ruling, the probe decides whether this
module has a live source before anything is designed.*

## THE PROBE (empirical, live)

**Health control first (proves the token/client are fine, so every failure below is real):**
`GET /f/v2/business-location/{bl}/sales-daily?date=2026-07-20` → **200 LIVE with data.** The
financial-api token works; anything that fails is a genuine capability gap, not a plumbing bug.

**Namespace finding:** K-Series inventory lives in the **operations API** (`/o/op/…`), not the
finance API. Probing the finance namespaces (`/f/v2/business-location/…`, `/f/finance/…`) for
inventory resources returns a gateway-routing 403 (those resources don't exist there). Probing the
**operations namespace** (`/o/op/data/…`) returns the *genuine* scope-denial body
(`{"type":"about:blank","title":"Forbidden","detail":"Access denied"}`) — the **same wall** as
`account-profiles`, whose operations-scope grant has been requested from Lightspeed and is pending.

| Inventory capability the mock assumes | Probe result | State |
|---|---|---|
| Stock items + quantities + value (`/o/op/data/inventory`, `/o/op/data/stock-items`) | genuine 403 `Access denied` | **403-NO-SCOPE** |
| Stock counts (`/o/op/data/stock-counts`) | genuine 403 `Access denied` | **403-NO-SCOPE** |
| Stock movements (purchases/production/sales/waste/transfers) | genuine 403 `Access denied` | **403-NO-SCOPE** |
| Par / reorder levels | genuine 403 `Access denied` | **403-NO-SCOPE** |
| Purchase orders (`/o/op/data/purchase-orders`) | genuine 403 `Access denied` | **403-NO-SCOPE** |
| Supplier links + cost prices (`/o/op/data/suppliers`) | genuine 403 `Access denied` | **403-NO-SCOPE** |
| Wastage records (`/o/op/data/wastage`) | genuine 403 `Access denied` | **403-NO-SCOPE** |
| Batch/production recipes + yields | genuine 403 `Access denied` | **403-NO-SCOPE** |
| Stock locations | genuine 403 `Access denied` | **403-NO-SCOPE** |

**Not one inventory capability returned LIVE or LIVE-BUT-EMPTY.** The entire inventory API is
**403-NO-SCOPE on the token we hold today** — we cannot even reach it to learn whether the venue
maintains stock in Lightspeed.

**And the deeper signal (from the Costs probe, 2026-07-21):** `qb_bills` is dead (8 rows since
2022), the venue pays suppliers **direct from the bank** with no PO ledger, and there is no
purchase-order discipline anywhere in the record. That is exactly the profile of a venue that does
**not** run Lightspeed inventory. So the strong prior is that even after the scope grant lands, the
inventory endpoints would return **LIVE-BUT-EMPTY** — the process that fills them isn't happening.

**Doubly blocked, stated plainly:** (1) scope-blocked from the API today; (2) even unblocked, the
maintaining process almost certainly doesn't exist. No dashboard fixes either.

## THE READINESS VERDICT (four-way, all 8 mock tabs)

Every mock panel maps to one of four states. Counting the ~34 distinct panels across
Executive / Forecast & Availability / Counts & Variance / Kitchen / FOH & Bar / Purchasing /
Waste & Production / Data Quality & Plan:

| State | What it means | Panels | Examples |
|---|---|---|---|
| **1 · LIVE NOW** | real inventory data flows today | **0** | — *nothing*. No physical-stock source is reachable. |
| **2 · RECIPE-GATED** | unlocks with `recipe_lines` (the Calum gate) — but **double-gated**: theoretical usage still needs the physical/actual side to compare against | ~8 | usage variance, actual-vs-theoretical gap, expected mix cost, recipe-led closing target, usable stock (recipe basis), the interactive requirement forecast |
| **3 · INVOICE-GATED** | needs the invoice-line ingest already named as future work in Costs | ~4 | current item cost, cost basis, stock value at cost, unit-cost history |
| **4 · PROCESS-GATED** | needs a **daily human workflow that isn't happening** — the operations-scope grant AND the venue actively counting/logging/PO-ing in Lightspeed | **~22** | last full count, count accuracy/completion, par compliance, items below par, recorded waste + waste-by-reason, stockout events, dead/slow stock, stock turns, stock days, open POs, delivery shorts, batch/production posting, availability risk, stock value by ownership |

**~65% of the module is PROCESS-GATED; 0% is LIVE NOW.** The remaining third is recipe- or
invoice-gated on builds already queued — and even those can't render without the physical side the
process-gated 65% would supply.

## LAUNCH-DAY REALITY (if built now)

**It would be almost entirely empty.** Not "wired, warming up" — *unfed*. The mock's own Data
Quality tab frames its Weeks 1–6 as a rollout, and that is the honest truth: those weeks are a
**process the business would have to adopt** (count discipline, waste logging, PO entry, batch
posting), not a toggle a dashboard flips. On day one every KPI reads "—", every table is an
empty-state, and the single honest panel is a readiness/adoption tracker.

This is categorically different from the four centres already built:
- **Revenue / Labour** were data-rich from day one (per-receipt + RotaCloud).
- **Reservations** needed ONE feed (OpenTable) to start filling.
- **Costs** was QB-ledger-rich with named gates.
- **Inventory has nothing today** — and its unlock is a *business process*, not a wire.

## THE DECISION FOR THE TAP

The brief is explicit: no build, no tokens, until you rule. Two honest paths:

- **A · Build-ahead-as-a-target.** Build the shell + all panels as designed empty-states that name
  the exact adoption step each needs ("last count: never — run a stock count in Lightspeed"), so the
  module becomes the *scaffold that pulls the process into being* — the operator sees precisely what
  starting to count would light up. Highest honesty cost: it will look empty for weeks/months and
  could read as broken if not framed as an adoption tracker.
- **B · Defer until the process starts.** Do nothing here until (1) the operations-scope grant lands
  AND (2) the venue begins maintaining inventory in Lightspeed (or a counting workflow exists). The
  module is scoped and ready to build the day there's a source; building sooner produces a wall of
  empty panels.

**Recommendation: B, with a thin exception** — the two things that AREN'T process-gated could ship
as a one-panel "inventory readiness" surface under an existing tab (not a whole centre): a live
**readiness tracker** (scope-grant status + "0 counts / 0 POs / 0 waste events on record") and the
**adoption checklist** (the mock's Weeks 1–6 as the plan). That gives you the visible next-step
without a seven-tab shell of dashes. But this is your call — build-ahead has real merit as a target
if you intend to drive the process.

**STOP — awaiting the operator ruling: A (build-ahead as a target), B (defer), or the thin
readiness-surface exception. No tokens, no panels, no shell until then.**
