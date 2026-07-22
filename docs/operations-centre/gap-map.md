# Operations Centre — Stage 1: tokens + panel map + overlap audit

*Probed 2026-07-22. The brief asked me to test one hypothesis: is this a mission-control-of-modules
(an executive index that re-renders the other centres' verdicts), or a genuinely new data domain?
**The evidence inverts the framing.** The mock is overwhelmingly a NEW service-execution domain;
only a thin sliver is a re-render, and that sliver already exists as Rex's brief + the Decision Feed.*

---

## 1. What the mock actually is

Title: **"Operations & Service Command Centre — Throughput, service speed, order quality and shift
execution."** 7 tabs, ~40 panels. Status pills claim *"Lightspeed K synced · OpenTable synced"*; the
footer "Recommended data architecture" names 8 sources. The subject matter is **service execution** —
how fast the kitchen cooks, how table flow moves, how takeaway is fulfilled, where orders fail and how
they're recovered, live station load, and per-shift scoring. This is not an index of other centres'
numbers; it is a new operational-timing dataset the other centres do not hold.

The mission-control-of-modules layer the brief describes is **real but small**: it's essentially ONE
panel (the Executive tab's Owner attention queue) plus the *import rows* of Core safeguards.

## 2. The blocking finding — the sources DON'T exist on the box

Every service-execution panel draws on four sources. I checked the box (81 tables): **none are wired.**

| Source the mock needs | Feeds | On the box? |
|---|---|---|
| **Lightspeed KDS** (production-centre prep times, ticket completion, slowest products) | all Kitchen + Live-station + prep panels | ❌ NONE — the LS pull is **aggregate sales only** (no per-receipt lines, let alone KDS timing) |
| **OpenTable events** (arrival/seat/turn timestamps, waitlist, occupancy) | all FOH-flow + seating + turn-time panels | ❌ NONE — OpenTable is **export-gated** (Reservations Centre established this; inbox-zero) |
| **LivePepper / StoreKit** (order received→ready→collected events, channel failures) | all Takeaway panels | ❌ NONE — not wired at all |
| **Per-order defect / recovery capture** (defect category, station, root cause, recovery £) | all Quality & Recovery panels + shift scoring | ❌ NONE — no such capture system exists (LS voids/refunds are aggregate, not per-order structured) |

The mock's pills ("Lightspeed K synced / OpenTable synced") are **mock fiction** — on the real box,
the two headline sources for this module are exactly the two that are NOT connected.

The *import* sources the executive layer would re-render DO exist: **Revenue** (`sales_*`), **Labour**
(`labour_day/_dept`), **Reviews** (`review_*`), **Kitchen Safety** (`ks_*`, live since today).

## 3. Tokens

Mock `:root` vs RCC canon (`S.rcc.tokens`): **near-identical, reuse the canon.** `--bg:#090c0f`
(canon #0b0d10), `--panel:#14181d`, `--line:#2a323a`, `--red:#e44b36`, `--green:#45c486`,
`--amber:#efb64f`, `--blue:#67a7ff`, `--purple:#ad8cff`, `--cyan:#5bd1d7`. One recurring non-canon
token: **`--orange:#ff8b55`** (appears in bars/microbars) — the same orange still parked pending your
ruling to make it a canon token. Grammar maps onto existing `S.rcc` components + 3 new bits (the
live-queue ticket rows, the station-load bars, the demand-stress slider). Visual reference:
`docs/operations-centre/reference/mock-{executive,live,kitchen,foh,takeaway,quality,scorecards}.png`.

---

## 4. PANEL MAP — SOURCE + NEW?/RE-RENDER? per panel

Legend: **RE-RENDER** = surfaces a signal another centre / Rex / the Decision Feed already computes
(one-home read, no recompute). **NEW-GATED** = data no centre holds, needs an un-wired source.

### Executive tab (the index layer — the only place any re-render lives)
| Panel | SOURCE | Verdict |
|---|---|---|
| KPI: Shift quality score / median prep / P90 / order accuracy | KDS + defect capture | **NEW-GATED** (KDS, defect) |
| KPI: On-time seating / takeaway promise | OpenTable + LivePepper | **NEW-GATED** |
| 13-week operational trend | shift-score history (composite) | **NEW-GATED** |
| **Owner attention queue** (5 ranked actions) | cross-centre exceptions | **RE-RENDER** — overlaps Rex's 07:05 brief AND the RCC Decision Feed (see §5) |
| Department scorecards (Kitchen/FOH/Takeaway) | KDS + OpenTable + LivePepper | **NEW-GATED** (imports safety/labour/reviews only for a few rows) |
| Weekly service outcomes | KDS + POS order profiles | **NEW-GATED** |
| **Core safeguards** — safety exceptions / labour vs budget / review score | Kitchen Safety, Labour, Reviews centres | **RE-RENDER** (import, one-home) |
| Core safeguards — menu availability / cash discrepancy / handover | Inventory (gated) / QB (partial) / new | mixed: **GATED** + partial import |

### Live Shift tab — **100% NEW-GATED** (and real-time, not batch)
Open kitchen tickets · current median age · orders/15m · demand stress test (interactive) · oldest
active tickets · live station load (Grill 118%…) · live FOH flow → **Lightspeed KDS live feed +
OpenTable live + POS open-orders.** None wired; and this is a *streaming* surface, a harder build than
the nightly-batch centres.

### Kitchen Throughput tab — **100% NEW-GATED** → Lightspeed KDS
Products prepared · median/P90 prep · late-ticket rate · tickets/kitchen-hour · prep-time distribution
· slowest products (KDS stats) · demand heatmap · kitchen decision ratios.

### FOH & Table Flow tab — **100% NEW-GATED** → OpenTable events
On-time seating · booking delay · table turn · waitlist accuracy/conversion · turn-time by party size ·
FOH service funnel · seating-delay diagnosis · FOH decision ratios.

### Takeaway tab — **100% NEW-GATED** → LivePepper / StoreKit
Takeaway orders · promise accuracy · order-to-ready · packing accuracy · pickup dwell · order timeline
· channel performance · packing-defect Pareto · takeaway controls.

### Quality & Recovery tab — **100% NEW-GATED** → per-order defect capture (+ LS voids/refunds)
Order defect / remake / refund rate · recovery discounts · repeat-failure · failure Pareto · recovery
economics · impact×recurrence matrix · required defect record. (The mock itself says generic reasons
"are not sufficient" — this needs a capture system that doesn't exist.)

### Shift Scorecards tab — **NEW-GATED (composite)**
Best/weakest shift · shift scorecard table · proposed weighting · management action register. Can't
score a shift without the KDS/OpenTable/defect data above; the hard-override rule (safety/allergen caps
the shift red) is a **RE-RENDER** of the Kitchen Safety red-cap.

---

## 5. OVERLAP AUDIT (the blocking check) — Rex brief / Decision Feed / existing surfaces

The one genuinely-re-renderable panel is the **Owner attention queue** ("what needs me today"). It is
**already rendered twice**:
- **Rex's 07:05 brief** pulls the top cross-centre exceptions each morning (the same "what needs me
  today" list). A dashboard attention queue is a second rendering of Rex's output.
- **The RCC Executive Decision Feed** (Revenue Centre) already surfaces ranked revenue/ops exceptions.
- **Overview's WEEK-AHEAD panel** already carries the forward-looking cross-centre view.

So even the re-render sliver is **not new information** — it's a *fourth* home for signals the operator
already sees in Rex, the Decision Feed and Overview. Per the one-home rule, adding a fourth is a
regression unless it explicitly **supersedes** one of them.

## 6. HEADLINE — genuinely-new vs re-presentation

- **~90% GENUINELY NEW + GATED** (6½ of 7 tabs): a whole service-execution data domain gated on **four
  un-wired sources** — Lightspeed KDS, OpenTable events, LivePepper/StoreKit, and a per-order
  defect-capture system. None computable today; two of the four (KDS, OpenTable) are long-standing
  standing-tier gates.
- **~10% RE-RENDER** (the attention queue + a few import rows), and that sliver **already exists** as
  Rex's brief + the Decision Feed + Overview.

**This is the opposite of the brief's hypothesis.** It is not mostly a re-presentation of existing
signals — it's mostly a new domain we cannot source, wrapped around a thin index that duplicates three
surfaces we already have.

## 7. Recommendation → STOP for tap

Three honest dispositions:

- **A — DEFER (recommended).** Don't build now. Name the real unlocks: (1) Lightspeed KDS/production
  feed, (2) OpenTable event export, (3) LivePepper/StoreKit order-event API, (4) a per-order
  defect/recovery capture. Each is a substantial integration; the module lights up only as they land.
  Building today = an all-mock-numbers scaffold worse than Inventory (Inventory had ONE gate; this has
  four external integrations + a capture system).
- **B — thin index only.** Build *just* the Executive attention queue as a real one-home aggregation of
  the six centres' current verdicts — but ONLY if it **replaces** Rex's brief-in-the-dashboard or the
  Decision Feed, not adds a fourth copy. Needs a one-home ruling from you first.
- **C — build-ahead scaffold** (Inventory Option-A style) across all 7 tabs, every panel a designed
  gate-state naming its source. High surface, low value while 4 sources are dark; only worth it if you
  want the target visible.

**No build, no tokens committed, until you rule A / B / C.** My read: A, with the four source unlocks
added to the standing tiers — and if you want a single "what needs me today" surface, that's a Rex /
Overview enhancement, not a new centre.
