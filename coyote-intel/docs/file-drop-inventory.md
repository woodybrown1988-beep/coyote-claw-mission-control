# Current File-Drop Inventory

## Inspection Scope

The approved hard path rules allowed inspection of `README.md`, `package.json`, `config/api-rates.json`, `mission-control/schema.sql`, `mission-control/server.js`, files under `mission-control/ui/`, and tests under `test/`. A shallow file listing also showed there is no existing `coyote-intel/` directory in this fresh checkout before this implementation.

## Actual Findings

No weekly file-drop directory, sample file-drop inputs, downstream coyote-intel ingestion jobs, validation-rule files, or business-rule files were present in the supplied tree.

No existing coyote-intel ingestion path was found in the working tree before creating this integration. The only existing application is a local Mission Control dashboard for a SQLite database, and it is not a coyote-intel downstream consumer.

## Missing Production Inputs

The following facts are required before production cutover:

- Weekly file-drop file formats.
- Weekly file-drop schemas.
- Two or more recent sample files.
- Delivery cadence and naming convention.
- Downstream consumers and staging destinations.
- Validation rules.
- Business rules for sales, refunds, discounts, taxes, tips, voids, staff, and labour.
- Required historical/backfill windows.
- Accepted parity thresholds and materiality rules.

## Operator Handoff Checklist

- Provide at least two recent weekly sales file drops.
- Provide any labour, wage, payroll, break, overtime, or scheduling file drops that remain authoritative.
- Provide schema documentation or representative headers for every file.
- Identify the downstream job or table that currently consumes weekly drops.
- Identify all required validation checks and rejection rules.
- Identify business-day, week, timezone, refund, modification-date, and late-correction rules.
- Identify required historical backfill start and end dates per business location.
- Set count and money parity thresholds for parallel-run signoff.
- Confirm whether `staff-api` is approved for this client and whether any approved non-Lightspeed wage/labour-cost source exists.

## Correction Evidence Status

The correction requests actual weekly drop schemas, sample files, downstream jobs, validation rules, and business rules. Those artifacts were not present in this checkout, so this document cannot honestly provide production schemas or business-rule evidence. The reconciliation implementation accepts operator-provided files at runtime, but the real two-drop validation remains blocked until samples are supplied.
