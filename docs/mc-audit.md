# Mission Control — Consolidated Audit

**Date:** 2026-07-07 · **Method:** Playwright full-page capture of the live dashboard (`127.0.0.1:8787`), every tab, audited against the research-established standard. Screenshots in [`docs/mc-audit/`](./mc-audit/). **This is an audit only — nothing is built from it yet.**

## The standard (7 criteria)
1. **Exception-first** — surface what needs attention; on-track is muted.
2. **Hero number top-left** — the one number that matters, big, first.
3. **Bullet graphs, not gauges** — linear target-vs-actual, no dials.
4. **Sparkline per number** — trend context beside every KPI.
5. **Colour for outliers only** — colour = breach/attention; on-track neutral.
6. **~6–7 core numbers** — focused, not a data-dump.
7. **"Are we winning in 5 seconds?"** — glanceable.

**Reference tab = Labour.** It already meets the bar and is the template the others should reach: hero £893.59 top-left *with a comparison* (79.8h→80.3h, "+0.5h vs rota"), neutral tiles with amber reserved for drift/WTR/no-show, horizontal bullet-style bars (clock-drift, staffing-shape), a blended-cost sparkline, and exception-first sections (WTR guard, parity, no-show). Measure the rest against this.

## Scorecard

| Tab | Exception-first | Hero top-left | Bullet≠gauge | Sparkline/№ | Colour=outlier | ~6–7 nums | Winning in 5s |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Labour** (ref) | ✅ | ✅ | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| **Overview** | ✅ | 🟡 | n/a | ❌ | ✅ | ✅ | ❌ |
| **Reports** | ❌ | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Issues** | ✅ | 🟡 | n/a | ❌ | ✅ | 🟡 | ✅ |
| **Reviews** | 🟡 | ✅ | ❌ | ❌ | 🟡 | ✅ | 🟡 |
| **Agents** | ✅ | 🟡 | n/a | ❌ | 🟡 | ✅ | 🟡 |
| **Recipes** | ❌ | ❌ | n/a | n/a | 🟡 | ❌ | ❌ |

✅ pass · 🟡 partial · ❌ fail · n/a = criterion doesn't apply to a queue/editor surface.

---

## Per-tab findings (fixes ranked within each tab by value)

### Reports — *the daily flash; biggest gap between value and current state*
**Passes:** hero (NET SALES £6,622.46) is top-left; honest empty states ("not wired" for covers/spend-per-cover, correctly refusing to fake covers off POS guest-count); period nav (Day/Week/Month/Year) works.
**Fails (ranked):**
1. **No comparison on the hero** — net sales shows a bare number, no "vs same-weekday-last-week / vs forecast". Can't tell if £6,622 is good. *(This is item-1's core.)*
2. **Data-dump, not exception-first** — 6 tiles + ~6 stacked tables + a full hourly table. Everything shown flat; nothing muted, nothing elevated. Fails the ~6–7 rule badly.
3. **Colour is decorative** — every real tile wears the same green accent underline → colour carries no signal (violates colour-for-outliers).
4. **No sparklines** — the green underline is a static bar, not a trend.
5. **No bullet graphs** — labour-vs-forecast/target comparisons sit in tables, not linear bullet bars.
6. **QR/EAT-IN ATV gap invisible** — the channel split is a table; the £12.86 QR↔EAT-IN ATV gap (the whole upsell story) needs a two-channel small-multiple on a **shared y-axis** to land.
→ **Highest fix-value tab.** Item-1 presentation pass addresses 1–6. *(Build note: the same-weekday comparison renders "no reference yet" until the sales backfill lands — only 5 contiguous days exist today, so no prior same-weekday exists to compare against. Layout can be built now; the numbers populate post-backfill. Forecast stays "not wired" until forecast v1.)*

### Overview — *the cockpit; answers "what needs you" but not "are we winning"*
**Passes:** exception-first framing ("WHAT NEEDS YOU": sign-off 1 / review replies 79 / escalations 1); rising-issue chips with deltas; colour disciplined (amber rising, red plan-feedback, green LIVE, rest muted); ~7 numbers.
**Fails (ranked):**
1. **"TODAY'S NUMBERS" shows "KPI feed not yet wired"** — net sales, labour %, ATV, covers are blank, waiting on a `coyote-intel` feed. **But that data now exists** in `sales_day` + `labour_day` (Reports and Labour render it). The cockpit can't answer "are we winning in 5s" purely because the hero business numbers aren't wired to the tables that already hold them. *(Covers correctly stays "not wired" — OpenTable dependency.)*
2. **Hero top-left is an ops number** ("Awaiting sign-off 1"), not a business hero — acceptable given the tab's "what needs you" purpose, but pairing it with a live net-sales-vs-normal tile would make it a true cockpit.
3. **No sparklines** on any number.
→ **High fix-value, low effort:** wire the three real numbers (net / labour % / ATV) from the existing tables. Natural companion to the Reports pass.

### Recipes & Costs — *the machine's fuel gauge, presented as a phone book*
**Passes:** the BOM editor exists and is gated/safe-write.
**Fails (ranked):**
1. **Flat, undifferentiated 396-row list** (32,777px tall) with no prioritisation. The human has no way to see *which* recipes matter — the uncosted, high-sales-volume SKUs that unlock the most margin should sort to the top.
2. **No coverage hero** — needs "X of 396 costed · covering Y% of revenue" so progress toward the margin unlock is visible.
3. **Not glanceable** — you can't tell how close the venue is to true-margin reporting.
→ **High fix-value because recipes are a data-grain unlock** (see standing finding). Rank uncosted SKUs by sales volume × price; add the coverage hero. Turns a chore into a targeted "cost these 20 and you cover 80% of revenue" worklist.

### Issues — *strong exception-first tab*
**Passes:** red allergen **SAFETY ESCALATION** banner pinned top (unmissable); issue tiles ranked by count; zero-count categories muted; colour disciplined (red safety, amber rising, grey zero); answers "winning in 5s".
**Fails:** ~14 tiles including many zeros add scan-noise (collapse/hide zero categories); no per-category trend sparkline (the "↑3 was 0" delta lives on Overview, not here).
→ Low-medium fix-value; already good.

### Reviews — *good hero, no trend*
**Passes:** rating tiles top (4.80 / 4.45 / 3.90 + count); hero top-left is a rating; ~4 numbers.
**Fails:** no rating-**trend** sparkline (is 4.80 up or down?); feed is chronological, not needs-reply-first (the 79-to-reply exception lives on Overview, not surfaced here); platform badge colour is decorative.
→ Medium fix-value: add rating-trend sparklines + a needs-reply-first sort.

### Agents — *fit-for-purpose ops board*
**Passes:** exception-first (BLOCKED column, escalations/give-ups surfaced per the give-up convention); job-count strip; semantic status colour.
**Fails:** no throughput sparkline; hero could be an explicit "N need you" rather than a raw count strip.
→ Low fix-value (it's a process monitor, not a business KPI surface). Standard applies weakly.

---

## Ranked fix backlog (by value)

| # | Fix | Value | Data-gated? |
|---|---|---|---|
| 1 | **Reports presentation pass** — hero comparison, bullet graphs, sparklines, exception colour, QR/EAT-IN ATV small-multiple (shared y-axis) | ⭐⭐⭐ | Layout now; comparison values need backfill |
| 2 | **Overview: wire net / labour % / ATV** from existing tables | ⭐⭐⭐ | No — data already present |
| 3 | **Recipes: prioritise uncosted-by-volume + coverage hero** | ⭐⭐⭐ | No — feeds the margin unlock |
| 4 | **Exception-first brief / drift alerts** (Tier 1.5): trailing-4-week same-weekday bands per metric; surface only >2σ breaches | ⭐⭐ | Yes — needs backfilled history |
| 5 | **Product-mix-by-channel ingest** — fold into the sales ranged-window pull | ⭐⭐ | Yes — is itself the data-grain fix |
| 6 | Reviews: rating-trend sparklines + needs-reply-first sort | ⭐ | No |
| 7 | Issues: collapse zero tiles + per-category sparklines | ⭐ | No |
| 8 | Agents: throughput sparkline + "N need you" hero | ▫ | No |

---

## STANDING FINDING — MC's ceiling is now DATA GRAIN, not tile count

The tabs already have good bones. **Labour proves the standard is reachable with the current stack** — no framework, no new deps, pure `node:http` + `node:sqlite`. The presentation gaps above are real but bounded: they're a styling pass away from parity.

The *binding* constraint on further insight is **data grain**, and it reduces to two gaps:
1. **Per-receipt line items** — unlocks basket composition, attachment rates, product-mix-by-channel (the QR upsell question). Today the sales data is aggregate-only: `sales_by_product` has no channel dimension, `sales_by_channel` has no product dimension, and there is no line-item table to cross them. No amount of new tiles recovers a number the grain doesn't contain.
2. **Recipes / COGS** — unlocks true prime cost and per-channel margin (the MON-FRI-DEAL margin question). The BOM tables are empty; `ls_costs` is partial/unreliable.

**Every high-value unanswered question traces to one of these two, not to a missing surface.** Adding tiles on top of aggregate-only data just re-renders the same ceiling in a new shape.

**Rule for future MC work: feed the machine before adding surfaces.** Ingest line items and populate recipes first; the surfaces to display them are cheap once the grain exists. Fixes 3 and 5 above are the two that *raise the ceiling*; the rest *reach the existing ceiling more cleanly*.

---

## Sequence (confirmed)

**Audit-first, gated on your read** — nothing built yet. On your greenlight, in order:
1. **Reports presentation pass** — can start now (layout has no data dependency; comparison values fill in after backfill). *Not started — awaiting your go.*
2. **Exception-first brief / drift alerts** — after the sales backfill (needs trailing same-weekday history for the bands).
3. **Product-mix-by-channel ingest** — folded into the sales ranged-window pull (the data-grain fix that also unblocks QR category decomposition + per-channel margin).
