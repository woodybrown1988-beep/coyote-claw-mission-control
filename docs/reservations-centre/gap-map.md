# Reservations Centre — Stage 1 gap map

*2026-07-21 · against the operator mock (`reference/Reservations Mock Module.html`; six subtab screenshots `reference/mock-*.png`).*

## THE HONESTY CONSTRAINT, PLAINLY

**The primary data source for a reservations module is the OpenTable weekly export, and the inbox
(`~/coyote-claw/data/opentable-inbox/`) has received ZERO files to date** (verified this session).
Until that feed starts, every booking/cover/occupancy/identity panel ships as its designed
empty-state naming this ONE blocker: **"OpenTable weekly export — no files received yet; unlock =
start the emailed export to the inbox"**. Nothing is inferred where the mock's fact needs
reservations truth. Notably, the mock's own **Data readiness** panel is the honest-state pattern —
it renders REAL statuses.

Canon reminder (`coyote-covers-from-opentable-not-pos`): POS "covers"/guest-count is NOT covers,
and the per-receipt record carries **no reservation flag and no guest identity** — walk-in vs
booked **cannot** be inferred from POS data; the mock's walk-in/reserved stacked columns are
OpenTable-gated, not inferable.

## Computable NOW (no OpenTable needed)

| Panel (tab) | Source |
|---|---|
| **Reviews & Recovery — most of the tab**: platform rating KPIs, monthly rating trend, review counts | `review_corpus` / `review_snapshot` (the wired reviews dept) |
| Sentiment themes (horizontal meters) | `review_issues` codes — the taxonomy IS the theme list; real counts |
| Reputation management actions table | `review_actions` (the measurement loop: action, before/after rates, status) |
| Local review index / response rate | `review_corpus.has_reply` + platform splits |
| Dine-in demand **mix by channel/daypart** (as £ + transactions, NOT covers) | per-receipt record (EAT IN channel, ruled dayparts) — an honest VARIANT of the mock's covers-based mix, labelled 'transactions, not covers' |
| Average guest **spend per transaction** (not per cover) | day-net ÷ transactions canon — labelled honestly; per-cover unlocks with OpenTable |
| Data readiness panel | REAL statuses: per-receipt record Ready · reviews dept Ready · OpenTable inbox **0 files** · guest identity Not started |
| Recommended data architecture cards | text/canon |

## OpenTable-gated (the single blocker; designed empty-states)

| Panel (tab) | Needs |
|---|---|
| Executive: seated covers, reserved-cover share, booked-vs-seated, no-show/late-cancel rate, repeat-guest share, 13-week walk-in/reserved stack, on-books + pickup, owner attention items that price no-shows | reservation + cover + status records |
| Demand & Forecast: 8-week demand forecast, forecast assumptions, pickup curve, forward occupancy by daypart, 14-day management booking view | on-books history |
| Booking Behaviour: source performance, funnel, lead-time distribution, party-size mix, new-vs-returning, no-show diagnosis | booking-level records |
| Capacity & Flow: occupancy heatmap, capacity leakage, table-turn performance, guest-flow signals | covers + seating + timestamps |
| Customer Intelligence: entire tab (best customers, value×frequency matrix, lapse rules) | guest identity (OpenTable + the identity-map decision) |
| Reviews & Recovery: service recovery queue per guest, review-to-return measurement | review↔guest identity linking |

## Design-system verdict (Stage 1A)
The mock's `:root` is the **RCC canon verbatim** with ONE addition — `--cyan:#5bd1d7` — now a token.
(Its text/muted hexes differ by a hair from the RCC's; generation noise, NOT adopted — one canon.)
New shared grammar extended into `S.rcc` (never forked): `stackCol` (walk-in/reserved stacked
columns), `meterRow` (sentiment/funnel meters), `stars` (rating rows). Existing components cover
the rest (kpi/panel/tag/pill/alert/heatCell/driver/emptyState).

## Stage 2 proposal (for the tap)
- **R1**: Reviews & Recovery tab — mostly REAL today (the reviews dept), plus the honest Data-readiness panel.
- **R2**: Executive + the OpenTable-gated tabs as designed gate-states (the mock's layouts, one named blocker) with the two honest POS variants (mix-by-transactions, spend-per-transaction) where the mock's panel has a defensible non-covers analogue.
- **Everything else unlocks the week the OpenTable export starts landing.**

**STOP — awaiting the operator tap on this map + the Stage-2 split.**
