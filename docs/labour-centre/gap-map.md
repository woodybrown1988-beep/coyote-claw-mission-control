# Labour Centre — Stage 1 gap map

*2026-07-21 · against the operator mock (`reference/Labour Module Mock Designs/Labour mock tab.html`; six subtab screenshots `reference/mock-*.png`).*

## DATA CONTEXT, STATED PLAINLY
**Labour is the opposite of Reservations: the RICHEST wired domain.** Available now: the
rota-review engine (FORWARD/HINDSIGHT verdicts, ruled dayparts, OVER/UNDER/MIX items), the
canonical TRUE ruler + banded formula (K 14.3% / F 8.1% variable, 30% High-band anchor) +
live RC-screen translation, settled shifts + attendance (`labour_shifts` incl. clock variance),
`rota_ahead_budget`/`rota_ahead_shifts` future rotas, SPLH with the p90 ceiling ruling, the
15.9% burden model, salaried day-grain apportionment, per-role locked rates + parity checks,
and labour × demand joins at line grain. **Most mock panels are COMPUTABLE TODAY.**

The three honest gaps:
1. **June rota hole** — the labour backfill is blocked on the Leon Mackay RotaCloud fix
   (operator queue); trends crossing June state the hole, never bridge it.
2. **Covers-based productivity** (covers/labour-hour, service pace per cover) — OpenTable, same
   single blocker as the Reservations module.
3. **Per-employee performance framing — EXCLUDED BY RULING**, not empty-state (below).

## Design-system verdict (Stage 1A)
The mock's `:root` values are the **RCC canon verbatim** under abbreviated names, with ONE new
value: `--o:#ff8b55` (secondary orange) — a near-collision with the canon's existing microbar
gradient stop `#ff8a5b`; **not adopted as a new token** (the canon's stop is reused; one orange
family). The text/muted variants are the same generation noise as the Reservations mock — not
adopted. **No new components needed**: the mock's grammar maps onto the existing set (heatCell →
coverage grids, barrow/meterRow → role mix + variance bridge, kpi/driver/alert/formula/stackCol →
everything else, the P4 slider pattern → the interactive forecast). Zero forks, zero extensions —
the canon holds as-is.

## Panel-by-panel (six tabs)

### Executive
| Panel | Status / disposition |
|---|---|
| KPI strip (labour %, £/week, SPLH, OT, variance) | **NOW** — labour_day TRUE cost ÷ net, banded-formula deltas |
| 13-week labour control trend | **NOW** (labour_day + net weekly; June hole stated). ONE-HOME: absorbs the labour page's 8-week hero spark |
| Owner attention queue | **NOW** — the rota-review verdict items (OVER/UNDER/MIX), WTR flags, rate-parity findings, £-valued |
| Labour variance bridge | **NOW** — scheduled→actual by driver (hours × rate × mix, from labour_dept + shifts) |
| Department control | **NOW** — labour_dept vs the formula budgets |
| Core productivity | **PARTIAL** — SPLH now; covers-based measures OpenTable-gated |
| Daily control strip | **NOW**. ONE-HOME: overlaps the RCC Drivers daily scorecard's labour columns → this panel is the LABOUR home; the Drivers scorecard keeps net/YoY and POINTERS here for labour detail |

### Labour Forecast
| Panel | Status |
|---|---|
| Interactive weekly forecast | **NOW** — the banded formula on the revenue projection (the P4 slider pattern; overrides journal like forecast_overrides if ruled) |
| Five-band target curve | **NOW** — the ruled bands rendered as the derived view of the formula |
| Eight-week outlook | **NOW** — rota_ahead where published + formula-on-projection beyond |
| Forward management view | **NOW** — rota_ahead_shifts per dept/daypart |
| Band calibration + guardrails cards | **NOW** — canon text (formula, anchors, p90 ceiling rule) |

### Rota vs Actual
| Panel | Status |
|---|---|
| Daily hours scheduled vs actual | **NOW** — labour_day/labour_dept |
| "Where the extra hours came from" | **NOW** — labour_shifts variance decomposition (early-in/late-out/unrota'd, aggregate) |
| Daily labour reconciliation | **NOW** — scheduled vs actual vs paid, £ + hours |
| Department schedule accuracy | **NOW** |
| Cost-definition reconciliation | **NOW** — the RC-screen vs TRUE-ruler translation table (live rates, never cached — the ruling) |

### Kitchen / Front of House (mirror tabs)
| Panel | Status |
|---|---|
| Day performance | **NOW** — labour_dept + formula budget per dept |
| Role mix | **NOW** — labour_shifts role grain (senior-share vs the MIX threshold — the ruled >40% class) |
| Demand vs staffing | **NOW** — line-grain demand curve × labour_hourly (ONLINE no-true-hour exclusion applies) |
| Decision ratios | **PARTIAL** — SPLH-family now; covers-per-FOH-hour OpenTable-gated |

### Coverage & People
| Panel | Status / disposition |
|---|---|
| Combined coverage vs required staffing (heatmap) | **NOW** — labour_hourly staffing vs the demand curve; "required" = the formula/daypart derivation, basis captioned |
| KPI strip (OT hours, late clock-ins, sick cover, no-shows, pay variance, salary cover) | **NOW as AGGREGATES** — labour_shifts variance + attendance counts, dept grain |
| **People exception queue** | **EXCLUDED-BY-RULING** — the mock names individuals with repeated behavioural events (late clock-ins, no-shows per person). The surveillance boundary ruling: people appear as rota-STRUCTURAL facts only; no per-employee scoring/monitoring queues. The COMPLIANT substance already ruled in: WTR flags (regulatory), rate parity (payroll correctness), unmapped-shift names (data hygiene) — these render; a person-keyed behaviour queue does not. Flagged for the operator: overrule or confirm |
| People and compliance ratios | **NOW** — aggregate ratios + the WTR/parity classes |
| Labour accounting rules card | **NOW** — canon verbatim (burden 15.9%, salaried/365, locked rates, TRUE vs RC-screen) |
| Recommended data architecture | text |

## ONE-HOME dispositions (the big ones, for the tap)
1. **The existing /coyote/labour page**: this centre ABSORBS its panels across Stage 2 (hero →
   Executive trend; scorecard ruler → Rota vs Actual; staffing shape → Coverage heatmap; WTR +
   parity → Coverage & People; intraday → Executive daily strip). Endgame: /coyote/labour 308s →
   /coyote/labour-centre... **or the centre TAKES the /coyote/labour route** (cleaner). Operator
   picks at the tap.
2. **The rota-review report page** (/coyote/rota-review): STAYS as the run-receipt record (history
   + full verdict text); the centre's Owner-attention + forecast panels render the LATEST verdicts
   and POINTER to it. No duplication of the receipts.
3. **RCC Drivers daily scorecard**: keeps net/YoY/discount; its labour-hours/SPLH columns remain
   (cross-domain context is legitimate) but the labour DETAIL home is this centre's daily strip.

**STOP — awaiting the operator tap (alongside the Reservations Stage-2 taps): the Stage-2 phase
split, the /coyote/labour route decision, and the People-queue ruling.**
