# Lightspeed K-Series Integration Design

## Auth Flow

The connector uses OAuth2 Authorization Code Grant. `auth-url` builds the authorization URL from operator-provided `LIGHTSPEED_KSERIES_AUTH_URL`; token exchange and refresh use `LIGHTSPEED_KSERIES_TOKEN_URL` and HTTP Basic auth with `LIGHTSPEED_KSERIES_CLIENT_ID` and `LIGHTSPEED_KSERIES_CLIENT_SECRET`. Exact auth/token URLs must match the Lightspeed-issued environment and are intentionally not guessed.

## Secrets Storage

All secrets come from environment variables. Tokens are stored only in the server-side JSON file named by `LIGHTSPEED_KSERIES_TOKEN_STORE_PATH`. Logs and errors redact access tokens, refresh tokens, client secrets, Basic auth, and Bearer auth.

## Environment Variables

Required:

- `LIGHTSPEED_KSERIES_ENV`: `trial` or `production`.
- `LIGHTSPEED_KSERIES_CLIENT_ID`
- `LIGHTSPEED_KSERIES_CLIENT_SECRET`
- `LIGHTSPEED_KSERIES_REDIRECT_URI`
- `LIGHTSPEED_KSERIES_SCOPES`
- `LIGHTSPEED_KSERIES_TOKEN_STORE_PATH`
- `LIGHTSPEED_KSERIES_STATE_STORE_PATH`
- `LIGHTSPEED_KSERIES_OUTPUT_DIR`
- `LIGHTSPEED_KSERIES_LOCATION_IDS`
- `LIGHTSPEED_KSERIES_LOOKBACK_DAYS`

Flags:

- `LIGHTSPEED_KSERIES_ENABLED`: fail-closed gate for API-calling commands.
- `LIGHTSPEED_KSERIES_PARALLEL_RUN`: marks outputs as staging/parallel-run candidates for reconciliation and downstream validation.

Optional:

- `LIGHTSPEED_KSERIES_AUTH_URL`
- `LIGHTSPEED_KSERIES_TOKEN_URL`
- `LIGHTSPEED_KSERIES_SALES_PAGE_SIZE`
- `LIGHTSPEED_KSERIES_STAFF_PAGE_SIZE`
- `LIGHTSPEED_KSERIES_RETRY_COUNT`

Base API URLs are `https://api.trial.lsk.lightspeed.app` for trial and `https://api.lsk.lightspeed.app` for production.

## Sync Cadence

The intended cadence is hourly polling plus on-demand runs. Sales sync uses a recent lookback reread to catch late corrections. Reconciliation should run after each weekly file drop and during parallel-run validation.

## Incremental Cursor Strategy

`state-store.js` persists per-location sales and labour cursors in JSON. Sales incremental mode starts at the previous cursor minus `LIGHTSPEED_KSERIES_LOOKBACK_DAYS`, then advances the cursor to the requested `to` timestamp after each location completes. Backfill runs do not advance the incremental cursor.

## Retry And Rate-Limit Behavior

`client.js` retries transient HTTP statuses 408, 429, 500, 502, 503, and 504. If `Retry-After` is present, it is respected. V2 sales `pageSize` is capped at 100. Staff shift `size` is capped at 1000. Sales date ranges are chunked at 365 days.

## Normalized Contracts

Sales output is JSONL validated against `coyote-intel/schemas/normalized-sales.schema.json`. It includes the stable sales, line, payment, tax, discount, staff, device, refund, and raw hash fields listed in the approved spec.

Labour output is JSONL validated against `coyote-intel/schemas/normalized-labour.schema.json`. It includes Staff shift and Staff identity fields only. It intentionally excludes wage rate, labour cost, breaks, overtime, and payroll-derived values.

Contract changes are not finalized. Because file-drop schemas are unavailable, the initial normalized contract is provisional and must be mapped to the real file-drop contract before production cutover.

## Feature Flag And Parallel Run

When `LIGHTSPEED_KSERIES_ENABLED` is not truthy, API-calling CLI commands fail closed. `reconcile` remains available because it only reads local files.

When `LIGHTSPEED_KSERIES_PARALLEL_RUN` is truthy, operators should route generated normalized JSONL to staging consumers and reconciliation. This checkout contains no actual coyote-intel downstream consumer, so a real downstream staging consumer remains blocked until that consumer is identified.

## Reconciliation Strategy

`reconcile.js` accepts normalized API output plus at least two operator-provided recent weekly file drops in JSONL, JSON, or CSV. Reports include counts by location and business day/week, totals for gross/net/tax/discount/payment/tip, missing-in-API records, missing-in-file-drop records, changed records by stable key, and material-difference explanations.

Business-day slicing uses the business-location timezone when provided. A configurable lookback window remains required because no official reconciliation lookback window was found. V1 financial endpoints may be needed if original-business-date reconciliation differs from V2 modification-date behavior.

## Backfill Strategy

Backfill chunks requested history into windows no larger than 365 days. Normalized output uses deterministic stable keys and JSONL upsert to avoid duplicates when a period is rerun. If an invalid `from` date error reveals an earliest supported date, that date is stored per location in state.

The required production historical period is not known from this checkout and must be supplied by operators.

## Cutover And Rollback

Cutover is blocked until at least one full weekly side-by-side validation cycle passes with agreed thresholds. Rollback is immediate: set `LIGHTSPEED_KSERIES_ENABLED` to a falsey value and keep consuming weekly file drops. Labour wage/cost data must remain on file-drop fallback unless an approved source is later supplied.

## Correction Evidence Status

The correction asks to settle the contract, include a real two-week reconciliation report, include tested backfill evidence for the required historical period, and wire a real downstream staging consumer. The implementation provides the contract, report generator, and idempotency tests, but production evidence remains blocked by missing file drops, missing required historical window, missing downstream consumer identity, and missing parity thresholds.
