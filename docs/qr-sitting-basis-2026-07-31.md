# QR vs tableside on a fragmentation-proof basis — analysis + the sitting ruler · 2026-07-31

**Dated frozen snapshot** (canonical-source ruling 2026-07-17): every number below is as-of its stated
window and basis; current numbers come from the DB at read time. **Method:** read-only against
`librarian.db` (`node:sqlite` readOnly); computed by a 5-agent workflow (3 computation legs + 2
independent adversarial verifiers, both returning HOLDS on full recomputation). Windows:
receipts-only 2026-05-01..2026-07-29; anything touching reservations/covers capped 2026-07-22
(the OpenTable feed's single bootstrap ingest ends there).

**Operator insight being tested:** QR tables place multiple orders from multiple phones per sitting;
server tables accumulate one check. Per-receipt ATV therefore structurally understates QR spend per
sitting, contaminating every QR-vs-EAT-IN per-check comparison.

**Verdict: confirmed, with a twist.** The per-order "leak" reverses at sitting grain (QR sittings
out-spend served sittings 1.7×), but a REAL per-cover gap remains: a QR cover spends ~15–24% less
than a served cover. The migration is not cost-free; the £38/order target was the wrong ruler.

---

## 1. What `table_name` actually is (the grain discovery)

The naive reading ("every receipt names a table") is wrong. Three naming regimes, window
2026-05-01..2026-07-29, SALE filter (`cancelled=0 AND type NOT IN ('VOID','CANCEL','RECALL')`),
channel via `sales_channel_map_api`:

| regime | EAT IN | STOREKIT | MON-FRI DEAL | what it is |
|---|---|---|---|---|
| `'27 Bank Street, Table N'` | 0% | 22% | 87% | a real table |
| `'Order N'` | 85% | 78% | — | see below |
| `'Table N.M'` | 15% | — | — | split bills of ONE party (near-simultaneous, ~equal nets); base N = the table |

`'Order N'` means different things per channel — proven, not assumed:
- **STOREKIT `'Order N'` = a daily QR session slot.** Consecutive same-day same-slot order gaps:
  <5 min ×763, 5–15 ×395, 15–30 ×125, 30–60 ×23, **>60 min only 7 in three months** — a slot holds
  exactly one party's session; re-orders land on the same slot. Verifier cross-check: adjacent-N
  sequences are monotonic (dec 0.0%), multi-receipt spans median 9 min.
- **EAT IN `'Order N'` = a per-device order counter** (2–3 devices/day), carrying NO party identity:
  same-slot receipt pairs have same-staff/same-guest-count rates at or below the random baseline at
  every time gap; spans median 106 min. A server tab closes as ONE receipt, so each receipt = one
  sitting (multi-receipt server sittings are the `'Table N.M'` split-bill regime).

**The sitting key used by the board** (validated within 2% of gap-60 clustering):
STOREKIT → `date|table_name` (slot or real table); EAT IN `'Table …'` → `date|base-table`;
EAT IN otherwise → the receipt itself.

## 2. Fragmentation quantified (gap-60 sessionization, 2026-05-01..2026-07-29)

| class | sittings | orders/sitting mean | 1 order | 2 | 3 | 4+ |
|---|---|---|---|---|---|---|
| pure-QR | 1,511 | **1.905** | 61.4% | 18.8% | 8.6% | 11.3% |
| pure-server (EAT IN) | 5,634 | **1.068** | 96.7% | 1.8% | 0.7% | 0.8% |
| deal-involved | 1,202 | 1.554 | 65.3% | 21.8% | 8.7% | 4.2% |

38.6% of QR sittings place 2+ orders; the multi-order tail (583 sittings) averages ~3.35 orders,
median intra-sitting span 10 min (within-meal re-orders, not stitched visits). Server "multi-order"
sittings are split *bills*, not re-orders. Robust to gap 30/90 and across May/Jun/Jul (QR 1.83–1.97).
The verifier's independent rebuild: QR 1.84, server 1.068 — holds. Texture: fragmentation concentrates
in evening slot-regime QR (2.18 orders/sitting) vs daytime real-table QR (1.18).
Multiple-phones proxy unavailable: STOREKIT line `staff_name` is the literal 'Online Order' or NULL.

## 3. The same money on both rulers

| basis | QR | EAT IN | reading |
|---|---|---|---|
| per ORDER (the old board ruler) | £35.24 | £36.92 | QR "behind" — the contaminated comparison |
| per SITTING | **£67.14** | **£39.43** | QR sittings out-spend served sittings **1.70×** |

Understatement factor = 1.905× — exactly the fragmentation rate, as the operator predicted.
Mixed QR+EAT-IN sittings: 0 observed (partly unobservable across the `'Order N'` regime — a stated
lower bound). QR+DEAL sittings: 158 (9.5% of QR-involved); QR contributes ~54% of those sittings'
net — QR is co-primary there, not a topper.

## 4. The honest ruler — spend per cover (window capped 2026-07-22)

Sittings matched to reservations (table + date + time overlap; walk-ins ARE in the OpenTable feed,
so match rates are 96–97%). Match validated decisively: on pure-QR sittings, sitting net agrees with
OpenTable's own POS link (`pos_subtotal_pence`) **to the penny in 95% of cases** — which also proves
`pos_subtotal` is ex-VAT net and the timestamp parse correct. For server sittings the table-resolvable
subset captures only ~half a sitting's spend (the `'Order N'` rounds are invisible), so the server
per-cover uses the reservation's full POS-linked spend, immune to that defect.

| class | n | net per cover (median) | mean |
|---|---|---|---|
| pure-server | 465 | **£18.90** | £19.58 |
| venue (covers_day bound, 83d) | — | £17.97–£18.05 | — |
| pure-QR | 343 | **£16.06** | £16.45 |
| MON-FRI DEAL (separate) | 850 | £15.44 | £16.22 |

- **Server out-spends QR by ~+18% per cover at median.** Party-size confound checked: QR parties are
  smaller (mean 2.39 vs 3.72) AND lower-spending per head — at like-for-like party-2 the gap WIDENS
  to ~+24% (£20.06 vs £16.17). Verifier: holds in every party stratum, every window cut (July-only
  +12.8%), gross/paid rulers, and within both walk-in and booked populations.
- Caveats that bound the claim: the per-cover QR sample is the table-resolvable (mostly daytime)
  QR subset — evening slot-regime QR is per-cover-UNMEASURED (no table/identity link); the
  reservations feed is frozen at 2026-07-22.

## 5. Re-verdict on the "ATV leak"

The board (to 2026-07-30) rendered: QR ATV £35.60 vs the £38 target → "£2.40 short",
impact −£2,102/28d; vs EAT IN ATV £37.21 the per-order gap was £1.61 → £1,410/28d. The frozen
2026-07-07 spec's £12.86/txn gap (5-day scraper basis) had already collapsed to £1.61 on the
per-receipt record, and QR ATV exceeds both frozen baselines — the spec's own re-baseline guardrail
was never executed.

**Ruling of the numbers:**
- Per ORDER: the leak **does not survive** — it is a fragmentation artifact (and reverses per
  sitting: QR £67.14 vs £39.43).
- Per COVER: a **real, smaller-per-head but genuine gap re-emerges**: ~£2.40–£2.90/cover net at
  median (+18%, +24% like-for-like party-2), on the measurable (daytime-table) QR population.
- The £38/order target: **retired** (operator ruling 2026-07-31). A per-sitting re-derivation, if
  wanted, would sit near "hold ≥ ~£67/sitting"; the per-cover framing is the honest successor.

## 6. Which world are we in (the upsell reframe)

**Not the cost-free-migration world.** A QR sitting spends less per COVER than a served sitting even
though it spends more per sitting (QR sittings are longer order-streams from smaller parties). The
opportunity is therefore NOT "raise QR order value to £38" (checkout cross-sell aimed at each £35.60
order mis-targets a sitting already worth £67) — it is **closing the ~£2.40–2.90/cover gap on QR
sittings**: attachment per COVER on the QR menu journey (drinks/desserts surfacing on re-order
screens, where QR guests demonstrably return 2–3 times per sitting), while served-table attachment
is a separate, smaller question. Evening slot-regime QR — the biggest and most fragmented QR
population — is per-cover-unmeasured; wiring StoreKit table/identity capture (or the regular
OpenTable export) is what makes that measurable.

---

*Board change shipped with this doc: Overview verdict line + Revenue Drivers decision-feed alert
re-based to spend per sitting with the ruled caption ("QR orders fragment per sitting — per-order
ATV understates spend; per-cover basis is the honest comparison"); £38 constants removed; control
formulas updated. Full agent outputs retained in the session workflow journal (wf_fa08c915-d22).*
