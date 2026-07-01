# Lightspeed K-Series Runbook

## Setup

1. Confirm merchant or partner approval, paid custom API access if required, scopes, and environment.
2. Set all required `LIGHTSPEED_KSERIES_*` environment variables.
3. Use a server-side token store path outside any public web root.
4. Use a local output directory such as `coyote-intel/output/lightspeed-kseries/`.
5. Do not commit generated output files.

## OAuth Authorization

Generate an authorization URL:

```sh
node coyote-intel/src/lightspeed/cli.js auth-url --state operator-generated-state
```

After Lightspeed redirects back with a code, exchange it:

```sh
LIGHTSPEED_KSERIES_ENABLED=true node coyote-intel/src/lightspeed/cli.js exchange-token --code returned-code
```

`LIGHTSPEED_KSERIES_AUTH_URL` and `LIGHTSPEED_KSERIES_TOKEN_URL` must be the exact Lightspeed-issued URLs for the chosen environment.

## Token Refresh

Refresh is automatic when an access token is expired or near expiry. Refresh-token rotation is persisted to `LIGHTSPEED_KSERIES_TOKEN_STORE_PATH`; if that write fails, stop the sync and re-authorize instead of reusing stale refresh tokens.

## Secret Rotation

Disable scheduled runs, rotate the client secret in Lightspeed, update the server environment, remove the old token store, re-run authorization, then re-enable scheduled runs. Never copy token files to frontend or shared locations.

## Monitoring

Monitor command exit status, API HTTP errors, retry counts, limitation artifacts under `limitations/labour`, output record counts, cursor advancement, and reconciliation reports. Treat missing or shrinking sales counts as an incident until explained.

## Retries

Transient HTTP statuses are retried. `Retry-After` is honored. Persistent 401 or 403 failures require token, scope, entitlement, or merchant approval investigation.

## Sales Sync

Run an explicit range:

```sh
LIGHTSPEED_KSERIES_ENABLED=true node coyote-intel/src/lightspeed/cli.js sales-sync --from 2026-06-01T00:00:00.000Z --to 2026-06-08T00:00:00.000Z
```

Run incremental mode by omitting `--from`. The previous cursor minus `LIGHTSPEED_KSERIES_LOOKBACK_DAYS` is reread to catch late corrections.

## Labour Sync

Run:

```sh
LIGHTSPEED_KSERIES_ENABLED=true node coyote-intel/src/lightspeed/cli.js labour-sync --from 2026-06-01T00:00:00.000Z --to 2026-06-08T00:00:00.000Z
```

If `staff-api` is not configured or authorization fails, the connector writes a machine-readable limitation artifact and leaves wage/labour-cost data to the file-drop fallback. Staff shift data does not include wage rate, labour cost, breaks, overtime, or payroll rules.

## Backfill

Run:

```sh
LIGHTSPEED_KSERIES_ENABLED=true node coyote-intel/src/lightspeed/cli.js backfill --from 2024-01-01T00:00:00.000Z --to 2026-01-01T00:00:00.000Z
```

Backfill chunks ranges at 365 days and uses deterministic stable keys to avoid duplicates on rerun. If Lightspeed returns an invalid `from` date with an earliest supported date, the connector stores that date per location in state.

## Reconciliation

Provide normalized API output and at least two recent weekly file drops:

```sh
node coyote-intel/src/lightspeed/cli.js reconcile --api api-normalized.jsonl --drop1 week-1.csv --drop2 week-2.csv --report reconciliation-report.jsonl
```

The report includes counts, totals, missing records, changed records, and material-difference explanations. Full acceptance item 6 cannot be completed in this checkout because no real file-drop samples were supplied.

## Staging And Parallel Mode

Set `LIGHTSPEED_KSERIES_PARALLEL_RUN=true` during side-by-side validation. Route normalized JSONL to the downstream staging consumer once that consumer is identified. This repository does not currently contain a downstream coyote-intel consumer, so production staging consumption remains an operator handoff item.

## Production Cutover

Cutover requires:

- Lightspeed credentials and scopes active in production.
- Staff API entitlement confirmed or fallback source approved.
- Two or more real weekly file drops reconciled.
- One full weekly side-by-side validation cycle completed.
- Agreed count and money parity thresholds met.
- Downstream staging consumer identified and validated.

## Rollback

Set `LIGHTSPEED_KSERIES_ENABLED=false` or remove the flag, stop scheduled connector runs, and resume weekly file-drop consumption. Keep file-drop ingestion available until all parity and downstream checks have passed.
