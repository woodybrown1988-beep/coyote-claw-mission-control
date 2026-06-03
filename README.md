# coyote-claw-mission-control

Local read-only Mission Control dashboard for the Librarian SQLite database.

## Run

```sh
COYOTE_CLAW_DB=/path/to/librarian.db MISSION_CONTROL_PORT=8787 node mission-control/server.js
```

The server binds only to `127.0.0.1`. If `COYOTE_CLAW_DB` is not set, it reads `./data/librarian.db`. The dashboard uses only hardcoded `SELECT` statements and does not render raw job results, raw errors, raw event detail payloads, environment variables, stack traces, database paths, or config contents.

## Test

```sh
npm test
```

## Architecture

The front-door service is deterministic and on-rail.

## Sections

- Job Queue & States: status counts and recent jobs without `result` or `error`.
- Worker Status: explicit worker keys from `system_state` when present, otherwise conservative derived status from active jobs and recent activity.
- Metered Spend: Claude API spend only, from Claude-identifiable `spend_log.cost_pence` rows. Codex is excluded from GBP metered spend.
- Token Tracking + Cost Comparison: reads Codex usage from `job_token_usage` and compares month-to-date volume against the USD 200 flat-rate subscription using `config/api-rates.json`.
- Outcomes: recent `job_events` with sanitized detail summaries. `CORRECTED` events show `detail.note` when present.

Month-to-date calculations use the first day of the current UTC month.

## Codex Token Read Model

The dashboard expects worker code to record Codex token usage in:

```sql
job_token_usage(
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  note TEXT
)
```

`mission-control/schema.sql` contains the table and indexes. This repository does not currently include the Codex worker implementation, so the worker-side parsing and insert path still has to be wired into the repository that owns `CodexEngine`.

## GPT-5.5 Rates

`config/api-rates.json` stores the official GPT-5.5 standard API rates used for the comparison. Rates are considered stale after 90 days; stale or invalid rates are shown as unavailable instead of guessed.
coder-worker production proof 20260602T104846Z
Lead force-update test — 2026-06-02
front-door service is live
