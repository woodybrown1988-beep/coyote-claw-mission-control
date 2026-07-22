# Kitchen Safety Centre — Stage 1: connection probe + tokens + gap map

*Probed 2026-07-22. One integrated oversight page (`/coyote/kitchen-safety`), not a multi-tab
module. The Kitchen Safety App stays the data-entry system; this is owner-level oversight,
exceptions, audit-readiness. Records drill BACK into the app, never duplicated here.*

---

## 1. CONNECTION PROBE — what's reachable

**The source is REAL, rich, and written to daily.** Unlike Inventory (LIVE-NOW = 0), this is a
fully wired domain. The gap is not data — it's the *box's connection to it.*

### The two connection paths (they are NOT the same thing)

| Path | State | What it means |
|---|---|---|
| **The box** (where the MC dashboard runs) | ❌ **NO credential** | None of `~/.coyote-claw/*.env` is Supabase/kitchen-safety. The librarian.db has **zero** safety tables (checked all 81). The live dashboard cannot read one byte of this source today. |
| **The connected Supabase integration** (this session) | ✅ reachable | Used to *discover + verify* the schema for an accurate gap map. This is a discovery path, NOT the box being wired. |

**Project:** `coyote-kitchen-safety` · id `xcfhbqlsoytcwuoodksk` · region **eu-west-2** ·
Postgres 17 · ACTIVE_HEALTHY · created 2026-03-23. Single site (`sites` = 1 row: Coyote, with
`local_authority` + `registration_number` populated). RLS enabled on every table.

### Row counts + recency (the live tables, verified)

| Record type | Table | Rows | Last write | State |
|---|---|--:|---|---|
| Opening/closing checks | `checklist_runs` / `checklist_responses` | 117 / **1075** | **2026-07-22 11:05** (today) | LIVE-WITH-DATA |
| Temp readings (cook/hot-hold/reheat/equipment) | `temp_log_entries` | **802** | **2026-07-22 11:07** (today) | LIVE-WITH-DATA |
| Event/audit trail | `audits` | **2241** | **2026-07-22 11:07** (today) | LIVE-WITH-DATA |
| Deliveries | `delivery_logs` | 85 | 2026-07-21 (yesterday) | LIVE-WITH-DATA |
| Allergen matrix | `allergen_menu_items` (+ `allergen_matrices`/versions) | 57 | 2026-05-27 | LIVE-WITH-DATA |
| Training | `training_records` (+ modules/completions) | 57 | 2026-06-18 | LIVE-WITH-DATA |
| House Rules + acks | `house_rules_sections`/versions + `house_rule_acknowledgements` | 5 / **47** | — | LIVE-WITH-DATA |
| HACCP + CCPs | `haccp_plans`/`haccp_documents` + `risk_assessments` | 3 / 4 | — | LIVE-WITH-DATA |
| Equipment (w/ calibration due) | `equipment_units` | 14 | — | LIVE-WITH-DATA |
| Incidents | `incident_reports` | 4 (**1 open, high**) | 2026-06-08 | LIVE-WITH-DATA |
| Corrective actions | `corrective_actions` | 2 (**1 open**) | 2026-04-09 | LIVE-WITH-DATA (thin) |
| Suppliers | `suppliers` | 11 | — | LIVE-WITH-DATA |
| Allergen **incidents** | `allergen_incidents` | **0** | never | EMPTY (clean) |

**Wire-first trap already caught:** the "obvious" table names are the **dead legacy tables** —
`temp_logs` (0), `deliveries` (0), `incidents` (0), `audit_log` (0), `training_certificates` (0).
The live data is in `temp_log_entries` / `delivery_logs` / `incident_reports` / `audits` /
`training_records`. Any wiring must target the live tables, verified by recency above.

### The thresholds live in the app (one-home rule holds)

`app_settings` (category `temperature`) is the canonical home — **read these, never hardcode:**
`fridge_max` 5 · `freezer_max` −18 · `cooking_min` 75 · `reheating_min` 82 · `hot_hold_min` 63 ·
`delivery_max_chilled` 8. Per-unit limits also on `equipment_units.min/max_temp_celsius`, and
`temp_log_entries.status` is **already computed pass/borderline/fail by the app** — the dashboard
surfaces the app's verdict, it does not re-judge readings.

> **Honest calibration finding (surface, don't paper over):** `app_settings` fridge max = **5°C**
> but the fridge `equipment_units` are configured **0–8°C**, and delivery-chilled max = **8°C**.
> Two different chilled limits. Plus "Cooking Area - Fridge #2" is set **−18..8** (a fridge with a
> freezer floor — likely a data error). These render as calibration flags, per the mock's own
> "proposed, calibrate on real data" honesty — not silently reconciled.

### The red-cap has LIVE triggers right now

- **1 open high-severity incident**: *"Freezer Temp front panel not working"* (open since 2026-06-08).
- **1 open corrective action** (high priority, from April).
- 0 open critical checklist breaches · 0 allergen incidents · 0 accident/RIDDOR-class incidents.

So a real-data executive render will exercise the override logic (whether "high" trips the hard cap
vs shows amber is the one rule to pin in Stage 2 — the negative-control test injects a synthetic
`critical` and is independent of live data).

---

## 2. TOKENS — extracted from the mock

Mock `:root` vs the RCC canon (`S.rcc.tokens`): **near-identical, reuse the canon.**
`--bg:#0a0d10` (canon #0b0d10 — 1-shade darker, ignore), `--panel:#14181d`, `--line:#2b323a`,
`--text:#f4f1ea` (warm off-white), `--red:#e44b36`, `--bad:#ef6b68`, `--amber:#f0b64f`,
`--green:#45c486`, `--blue:#67a7ff`, `--purple:#ad8cff`, `--cyan:#5bd1d7`, `--radius:16px`.

Grammar maps entirely onto existing `S.rcc` components: `kpi`/`panel`/`tag`/`pill`/`alert`(→driver
alert bars)/`barrow`/`score-card`(→ new score ring, small addition)/`heatCell`/`formula`/`callout`
(info/warn/bad/good-box)/`checklist`/`process` steps/`driver`. Two genuinely-new grammar bits: the
**score ring** (`.score` circular gauge) and the **allergen matrix bubble chart** — both small,
scoped, RCC-toned. No new colour tokens. Visual reference screenshots:
`docs/kitchen-safety-centre/reference/mock-{full,overview,critical,allergens,hygiene,people,audit,integration}.png`.

---

## 3. GAP MAP — every panel keyed to the probe

Because the box is unwired, **every Supabase-backed panel is NEEDS-KEY today** — the data exists and
is current, the connection isn't made. They become LIVE-NOW the moment the key + sync leg land. A
handful are GENUINELY-GATED: the app does not capture that data as structured events.

### § Overview / Executive
| Panel | State | Backing / note |
|---|---|---|
| Safety control score (35/20/15/10/10/10) **+ RED-CAP override** | NEEDS-KEY | all six inputs are Supabase; **cap logic + negative-control testable now** |
| Required checks · on-time · critical first-pass · correctives open · allergen-safe | NEEDS-KEY | `checklist_*`, `temp_log_entries`, `corrective_actions` (allergen-safe = see §Allergens caveat) |
| 13-week control-performance trend | NEEDS-KEY | `checklist_responses` + `temp_log_entries` history (1877 rows over time) |
| Owner attention queue | NEEDS-KEY | derived; **live triggers exist today** (open incident, open corrective) |
| Control-effectiveness drivers · Kitchen/FOH ownership · score-rules formula | NEEDS-KEY | derived from the above |

### § Critical food-safety controls
| Panel | State | Backing / note |
|---|---|---|
| Per-process table (fridges/freezers/cooking/reheat/hot-hold/deliveries) | NEEDS-KEY | `temp_log_entries.mode` + equipment readings; `status` app-computed; limits from `app_settings` |
| **Cooling process** row | GENUINELY-GATED (verify) | no `cooling` mode in current data (modes seen: cooking/hot_holding/reheating/equipment). `time_started/finished` fields exist → may be capturable; flag as thin until confirmed |
| Deviation heatmap (process × day) | NEEDS-KEY | `temp_log_entries` grouped |
| Corrective-action quality bars | NEEDS-KEY | `corrective_actions` — only 2 rows → renders honestly thin |

### § Allergens
| Panel | State | Backing / note |
|---|---|---|
| Allergen change-control register + **block-from-sale rule** | NEEDS-KEY | `allergen_matrices`/versions + `allergen_menu_items` (57, full 14-allergen coverage). Block rule surfaced as a STATED rule (recipe incomplete / matrix unapproved / info not updated / staff not briefed); cross-checks `recipe_lines` (Calum gate) → honest where recipe coverage thin |
| Matrix coverage + risk controls | NEEDS-KEY | 57/57 items carry allergen data |
| **Allergen order-control chain** (declaration→manager→handoff→prep→check→delivery); "declared orders" KPI | **GENUINELY-GATED** | **no orders table exists** — the app captures the *matrix* + *incidents*, NOT per-customer-order allergen declarations. What IS computable: "0 allergen incidents" (`allergen_incidents`=0). The mock's "76 declared orders / allergen-safe orders 100%" cannot be sourced as-is — render the incident-zero + matrix-coverage truth, mark the per-order chain "not captured by the app" |

### § Hygiene & equipment
| Panel | State | Backing / note |
|---|---|---|
| Cleaning & sanitising | NEEDS-KEY | `checklist_responses` (cleaning items) + `house_rules_sections` 'cleaning' |
| Equipment & premises (calibration overdue) | NEEDS-KEY | `equipment_units.calibration_due_date` (14 units) |
| **Pest control** | GENUINELY-GATED | no pest table; tracked as an *evidence/document line* only (audit view: "Pest contractor report — contract schedule"). Render as evidence-tracked, not metriced |

### § People & incidents
| Panel | State | Backing / note |
|---|---|---|
| Incident & near-miss register | NEEDS-KEY | `incident_reports` (4). "Near-miss" not a current category (seen: equipment_failure/other) → renders honestly sparse |
| **RIDDOR / accident rate per 10k hrs** | NEEDS-KEY + **CROSS-SOURCE** | structure exists (`incident_reports.affected_people_count`/`reported_to_authority`) but **0 accident-class events** → honest-zero. Denominator = labour hours from the **RotaCloud sync already in librarian.db** → computable once Supabase side syncs |
| **Illness / fitness-to-work** | **GENUINELY-GATED** | no dedicated table. May be an opening-checklist item, not structured — render from checklist if present, else mark "not captured as structured data" |
| Training & competency | NEEDS-KEY | `training_records` (57) + `expires_at` → currency/expiry/overdue |

### § Audit readiness
| Panel | State | Backing / note |
|---|---|---|
| Audit-readiness score (records present · house-rules current · actions-in-date · named submissions · edit history · export time) | NEEDS-KEY | `audits` (2241) backs edit-history; **named submissions provable** — every table has `*_by_name_snapshot` (no anonymous records); `house_rules_versions` active |
| Regulatory & audit table (HACCP · calibration · weekly verification · allergen review) | NEEDS-KEY | `haccp_*`, `equipment_units`, `checklist_runs` sign-off, `allergen_matrix_versions` |
| Regulatory table (mock EHO score · traceability-drill timing · pest report) | GENUINELY-GATED | evidence/document lines with no structured metric — render as evidence-present, not scored |
| **Inspector view mirror (read-only)** | NEEDS-KEY | mirror the app's read-only evidence; `audits` backs it. No edit controls surfaced (matches the mock's own rule) |

### § App integration
| Panel | State | Backing / note |
|---|---|---|
| Connection-state / data-source map | **LIVE-NOW** | the one panel that renders from the box today — it documents the wiring, the key unlock, and the per-source→table mapping (this probe) |

---

## 4. HEADLINE (the inverse of Inventory)

- **Inventory** was LIVE-NOW = 0, ~65% process-gated — a year of human adoption to fill.
- **Kitchen Safety is ~80% NEEDS-KEY over a live, current source, ~15% genuinely-gated, ~5% live/cross-source.** The data is being written **today**. The blocker is a single operator action, not a process that doesn't exist yet.

**FIRST UNLOCK (operator-side, names the whole build path):** provide the box a **scoped
read-only** credential for `coyote-kitchen-safety` (project `xcfhbqlsoytcwuoodksk`, eu-west-2).
Recommended = a dedicated **read-only Postgres role** (or the anon key behind an owner-read RLS
policy) — *not* the service-role key. Then Stage 2 builds a **sync leg** (box pulls Supabase →
`ks_*` tables in librarian.db, matching every other live source: Lightspeed/RotaCloud/reviews/QB all
sync-to-box then read local), and the page reads local.

**GENUINELY-GATED (build as honest empty/evidence states, name what's missing):**
per-order allergen-declaration chain (no orders table) · illness/fitness-to-work (no table) ·
pest-control metrics (evidence line only) · cooling-process temp mode (verify) · mock-EHO-score &
traceability-drill timing (evidence, not metric).

**Stage 2 acceptance is provable either way:** the **red-cap negative control** (1000 green + 1 open
critical = RED) is pure logic, testable with no key; and the executive score can render against a
**captured real-data snapshot** (frozen, as-of dated, pulled via this probe) even before the box key
lands — or the honest NEEDS-KEY state if you prefer to gate it on the real connection.

---

**STOP for tap.** Ruling needed on: (a) provide the scoped read-only key now (→ full live build incl.
sync leg) vs build-ahead against a frozen snapshot + NEEDS-KEY states (→ key later); (b) the one rule
question — does an open **high**-severity incident trip the hard red-cap, or only **critical**?
