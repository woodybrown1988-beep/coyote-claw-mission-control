# Lightspeed K-Series API Research

## Source Authority And URL Status

This repository build has no network access. The approved research facts below are therefore limited to the supplied findings and retain their bracket citations exactly. The official/current authorities named in the findings are the Lightspeed Restaurant K-Series Developer Documentation/API Portal, Bump.sh API Reference, changelog, and partner Developer Portal; the API reference is `Lightspeed Restaurant K Series API`, version `1.0.0`, last update Jun 29, 2026 [1][2][17].

Supplied concrete URLs are limited to API base URLs:

- Trial API base URL: `https://api.trial.lsk.lightspeed.app` [2][3]
- Production API base URL: `https://api.lsk.lightspeed.app` [2][3]

The correction request asks for official source URLs. Exact documentation, Bump.sh, changelog, and partner portal page URLs were not supplied in the prompt, and the spec also says not to invent URLs not supplied. Operators must attach the exact official page URLs before production signoff.

## Authentication And Tokens

Lightspeed K-Series custom API authentication uses OAuth2 Authorization Code Grant only [3]. Token refresh uses the client ID and client secret with HTTP Basic auth [3]. Access tokens last 25 minutes [3][5]. Refresh tokens last 40 days when `offline_access` is granted, or 30 minutes without `offline_access`; every refresh rotates the refresh token [3][5].

Required scopes for this integration are `financial-api`, `items`, `staff-api`, and `offline_access`; scope minimization is required [4]. `staff-api` exists, but custom integration docs currently list Financial and Items endpoints, so Staff access requires explicit approval and scope enablement [4][6].

All tokens must be stored server-side only, never in frontend code. Refresh should be automated, expiry handling should use dynamic expiry fields from token responses, and logs/errors must avoid token leakage [4][5].

## Commercial And Provisioning Gate

Custom API use requires partner/approved merchant access, may require a paid add-on for custom API access, allows one client per business, forbids credential resale or sharing, and provisioning or updates can take up to 48 hours [1][6].

## Financial Sales Endpoints

Closed sales are available at `GET /f/v2/business-location/{businessLocationId}/sales`, filtered by `timeClosed` [9]. The range maximum is 365 days, `pageSize` maximum is 100, pagination uses `nextPageToken`, and include options are supported [9].

Business-day sales are available at `GET /f/v2/business-location/{businessLocationId}/sales-daily`; the response returns the same sales shape plus `nextStartOfDayAsIso8601` and `dataComplete` [10].

Business and location lookup is available at `GET /f/data/businesses`, returning IDs, currency, country, and timezone [11]. That timezone must be used for business-day reconciliation slicing [11].

V1 may be better for original-business-date reconciliation because V2 records back-office modifications on the actual created/performed date [8]. This is a reconciliation caveat, not a reason to prefer V1 for the initial API-backed pull.

Backfill must not assume retention. It must discover and store the earliest supported date per location from invalid `from` date errors [9].

## Items

Items are available at `GET /items/v1/items`; `amount` is capped at 1000 and `itemIds` is capped at 200 [16].

## Staff And Labour

Staff shifts are available at `GET /staff/v1/businessLocations/{businessLocationId}/shift` with shift UUID, `staffId`, declared cash tips, `dateInUTC`, events, and `CLOCK_IN`/`CLOCK_OUT`; when duplicate event types exist, the newest event wins [12].

Staff users are exposed through POS and BACK_OFFICE endpoints, and staff detail exposes identity, active state, created/modified timestamps, groups, roles, and report access; BACK_OFFICE includes email [13][14][15].

The official retrieved Staff API docs do not expose wage rate, labour cost, breaks, overtime, or payroll rules. The existing wage/labour-cost file drop must remain the source for those values unless Lightspeed grants or documents another source [12][13][14][15].

The correction request asks to record confirmed Staff API labour support or an approved fallback source. Confirmed support in the supplied research is limited to Staff shift and user identity data; no approved wage/labour-cost fallback source exists in this checkout.

## Rate Limits And Polling

No published numeric rate limits were found. Documented hard limits are sales range 365 days, V2 `pageSize` 100, V1 `pageSize` 1000, Items `amount` 1000, and `itemIds` 200 [8][9][16].

No webhooks or RTN are available for custom integrations; polling on demand or at regular intervals such as hourly is the official cadence hint [6].

## Security And PII

Tokens belong only in server-side secret storage and local state files with restricted filesystem permissions. PII exposure risks include `consumer` include payloads and staff emails/roles [4][5][9][13][14]. The connector must redact access tokens, refresh tokens, client secrets, Basic auth, and Bearer auth from errors and logs.
