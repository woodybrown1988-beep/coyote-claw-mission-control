# Customer Growth Centre — Stage 1: tokens + panel map + four-way source verdict

*Probed 2026-07-22. The brief asked for a four-way verdict per panel because customer/marketing data
is scattered. The honest finding: this is the **least-sourced centre yet**. The genuine LIVE slice is
~10% (reputation/reviews, itself degraded); ~15% is NEEDS-INTEGRATION (nameable external APIs); and
~75% is **NO-SOURCE — a business-model gap, not a wiring gap**: the venue captures no customer
identity at all, so CRM / loyalty / RFM / LTV / retention-by-customer / email have no data and cannot
without the business first ADOPTING identity capture.*

---

## 1. What the mock assumes vs what exists

Title: **"Customer Growth Command Centre."** 8 tabs: Executive · Inverness Demand · Acquisition ·
Retention & Loyalty · Campaign Profitability · Partnerships · Content & Advocacy · CRM & Consent.
Keyword scan: CRM ×9, loyalty ×9, RFM, LTV, Instagram/Facebook/TikTok/social, email/newsletter,
followers. It is a full marketing-and-CRM stack. This business has **none of that stack wired**, and
most of it **isn't captured anywhere**.

### The live source probe (box)
| Source | State | Detail |
|---|---|---|
| **Reviews corpus** | ✅ LIVE | 534 reviews: OpenTable 219, Google 211, TripAdvisor 104. Ratings, sub-ratings, reply flags, tags. Home = the **Reviews page** (`/coyote/reviews`) + the coyote-reviews app. |
| **Reply drafts (brand-voice)** | ✅ LIVE but backlogged | 79 drafts in `draft` status, unposted; reply rate near-zero (Google 2 replied). |
| **Review INGESTION** | ⚠️ **WIRED-DEGRADED** | Google OAuth dead — latest Google review **2026-07-06**, last ingest attempt 2026-07-21. *Operator item: OAuth re-auth.* |
| **Issue / sentiment EXTRACTOR** | ⚠️ **WIRED-DEGRADED** | Anthropic credit dead — issue tags **stale since 2026-07-05** (183 tags, 16 codes, then nothing). *Operator item: Anthropic credit.* |
| **Channel mix** | ✅ LIVE (aggregate) | `sales_by_channel` gives channel SHARE (EAT IN / QR / takeaway). But it is per-transaction aggregate — **no customer identity**, so no repeat-visit-by-customer. |
| Social (IG/FB/TikTok) | ❌ NO API | `tripadvisor.env` exists (feeds the corpus); NO Meta/TikTok API. 13.5k FB followers historical = no live source. |
| CRM / loyalty / email list | ❌ NONE | no customer table, no loyalty scheme, no email/SMS list (only `processed_emails` = the reviews-Gmail ingest tracker, not a customer list). |
| OpenTable covers/diners | ❌ un-wired | same export gate as the Reservations Centre (only OpenTable *reviews* are in the corpus). |

---

## 2. Tokens

Mock `:root` vs RCC canon: **near-identical, reuse canon.** `--bg:#0b0e11` (canon #0b0d10),
`--panel:#14191e`, `--line:#2b333b`, `--red:#e44b36`, `--green:#45c486`, `--amber:#f0b64f`,
`--blue:#67a7ff`, `--purple:#ad8cff`, `--cyan:#5bd1d7`. Recurring non-canon: **`--orange:#ff8c55`**
(≈ the Operations mock's #ff8b55) — the same orange still parked pending a canon ruling. Grammar
(kpi/panel/alert/funnel/donut/drivers/research boxes) maps onto `S.rcc` + a donut + research-box
grid. Visual reference: `docs/customer-growth-centre/reference/mock-{executive,market,acquisition,retention,campaigns,partners,content,crm}.png`.

---

## 3. PANEL MAP — SOURCE + four-way verdict

Verdicts: **LIVE** · **WIRED-DEGRADED** (name the operator item) · **NEEDS-INTEGRATION** (external
source exists, not connected — named + sized) · **NO-SOURCE** (data not captured at all; needs a
business decision to start capturing, not a wiring job).

### Executive
| Panel / KPI | SOURCE | Verdict |
|---|---|---|
| Incremental growth contribution · Blended new-customer cost | ad-spend attribution | **NEEDS-INTEGRATION** (ad platforms) + **NO-SOURCE** (attribution needs identity) |
| New identified customers · Local second-visit rate · owned-identity rate · attribution coverage | customer identity | **NO-SOURCE** — nothing identifies a customer across visits |
| Visitor advocacy rate | reviews + referral tracking | split: review count **LIVE-DEGRADED**; referral/share **NO-SOURCE** |
| Direct customer share | `sales_by_channel` | **LIVE** (channel share) — but the "direct customer" framing needs identity |
| 13-week customer-growth trend | identity over time | **NO-SOURCE** |
| Owner attention queue | cross-signal | **RE-RENDER/one-home** — points to Rex / Reviews / Revenue, don't recompute |
| Two customer growth engines (funnels) · Customer revenue mix (by geography) | identity + customer origin | **NO-SOURCE** (no customer geography captured) |
| North-star ratios | identity + spend | **NO-SOURCE** + **NEEDS-INTEGRATION** |

### Inverness Demand (market)
Research boxes (overnight visitors, long-haul share, stay length…) + growth thesis + **destination
demand calendar** + demand-to-action. → **NEEDS-INTEGRATION** (external Inverness tourism / cruise
data — a data feed or manual research, not a wired source). The demand calendar overlaps the
**Revenue Centre's** forecast-gated demand calendar (one-home: build it there, not twice).

### Acquisition
Google profile interactions · non-brand search clicks · site-action conversion · organic share ·
digital discovery funnel · search opportunity · channel economics. → **NEEDS-INTEGRATION**: Google
Business Profile Insights API + Google Search Console (both ride the **same dead Google OAuth** — one
re-auth unlocks reviews AND profile insights) + GA4 website analytics. New-customer conversion =
**NO-SOURCE** (identity).

### Retention & Loyalty
Known local customers · 60/90-day return · loyalty penetration · at-risk value · reward cost ·
retention cohorts · **RFM portfolio** · lifecycle automation · loyalty-programme health · visitor
after-value. → **NO-SOURCE across the board.** There is no customer database and no loyalty scheme;
RFM/cohorts/LTV have zero data and cannot exist until the business adopts identity capture.

### Campaign Profitability
Growth spend · attributed net revenue · incremental contribution · contribution return · budget
scenario · budget architecture · campaign scorecard. → **NEEDS-INTEGRATION** (Google Ads + Meta Ads
spend/attribution) + **NO-SOURCE** (per-customer attribution). No campaign spend is tracked today
(marketing appears only as an aggregate cost line in QB/Costs, un-attributed).

### Partnerships
Active partners · partner-referred covers · partner net revenue/contribution · tracked share · trade
pipeline · partner league · operating standard. → **NO-SOURCE** (no partner-tracking system;
partner-referred covers needs attribution + OpenTable). Operating standard = real text (a standard is
not data).

### Content & Advocacy
Usable assets · tracked content actions · UGC mentions · UGC rights · review-driven discovery ·
content economics · advocacy loop · creative fatigue. → **NEEDS-INTEGRATION** (social listening / UGC
via Meta/TikTok APIs) + **NO-SOURCE** (content-asset tracking) + a thin **LIVE-DEGRADED** slice
(review-driven discovery ← the reviews corpus).

### CRM & Consent — *the honest anchor*
Unified customer profiles · cross-channel match · email/SMS reachable · suppression · **unknown
customer revenue** · identity/contactability waterfall · data-quality register · permitted-contact
logic · customer-360 source roles · recommended growth data architecture. → **NO-SOURCE, and that is
the truth worth surfacing:** unified profiles = 0, email/SMS reachable = 0, **unknown customer revenue
≈ 100%**. This tab, rendered honestly, is the one genuinely useful thing here — it states plainly that
the venue is entirely anonymous-transaction and names what adopting identity capture would unlock
(exactly like Inventory's adoption plan).

---

## 4. NEEDS-INTEGRATION — named + sized (external sources that DO exist)

| Integration | Unlocks | Size |
|---|---|---|
| **Google OAuth re-auth** (the standing item) | review ingestion **and** Acquisition's GBP Insights + Search Console | small — a re-auth, not a new build; one credential unlocks two tabs' worth |
| **Anthropic credit** (the standing item) | the issue/sentiment extractor → tags, themes, review-driven discovery | small — top up the credit; the extractor code is live |
| Meta Graph API (IG/FB) + TikTok API | social reach, UGC/content, some Content & Advocacy | medium each — new OAuth apps + ingest legs |
| Google Ads + Meta Ads APIs | Campaign Profitability spend + attributed revenue | medium — but attribution still blocked by NO-SOURCE identity |
| GA4 / website analytics | Acquisition site-action funnel | small-medium |
| OpenTable export | covers / repeat diners (shared with Reservations) | medium — same gate as Reservations |

## 5. NO-SOURCE — the business-model gap (distinct from the above)

Everything in Retention, Partnerships, most of Executive, and all of CRM & Consent needs **customer
identity that is never captured**: no loyalty scheme, no CRM, no booking-identity, Lightspeed
aggregate-only (no per-receipt customer). You cannot integrate a source that does not exist — the
business would first have to **decide to capture identity** (a loyalty app / CRM / booking-with-login).
This is a strategic decision, not an engineering task, and it gates ~75% of the mock.

## 6. Headline + recommendation → STOP for tap

- **~10% LIVE** (reputation/reviews + channel share) — and one-home to the **Reviews page**, plus
  WIRED-DEGRADED by the two dead review engines.
- **~15% NEEDS-INTEGRATION** — mostly the two standing items (Google OAuth, Anthropic credit) which
  are cheap and unlock the most, then social/ads/GA4/OpenTable.
- **~75% NO-SOURCE** — a customer-identity/CRM/loyalty capability the business does not have and has
  not decided to build.

**Dispositions:**
- **A — DEFER + fix the two cheap unlocks (recommended).** The highest-value action isn't a new
  centre — it's re-authing Google (revives ingestion + unlocks GBP acquisition data) and topping up
  Anthropic credit (revives the extractor). Those two already-standing items light up the only LIVE
  slice. No new module needed to get that value.
- **B — thin "Reputation & Reach" surface only.** Build just the LIVE reviews/reputation slice — but
  it largely duplicates the **Reviews page**, so only if it *supersedes* or extends it (one-home
  ruling needed), and it renders stale-since-a-date until the two unlocks land.
- **C — full build-ahead scaffold** across all 8 tabs, every panel tagged LIVE / DEGRADED /
  NEEDS-INTEGRATION / NO-SOURCE, with CRM & Consent as the honest anchor (0 profiles, ~100% unknown
  revenue) + the identity-capture adoption decision named. Highest surface; ~75% would be NO-SOURCE
  states that can only move if you decide to capture customer identity.

No build, no tokens committed, until you rule A / B / C. My read: **A** — this centre's real payload
is two credentials you already owe the operator queue, not a seventh… eighth Reports module.
