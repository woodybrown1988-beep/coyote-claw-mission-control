# Planflow Mission Control

Local-first planning app for fast capture, realistic daily planning, focus execution, and short review loops.

## Run

```sh
MISSION_CONTROL_PORT=8787 node mission-control/server.js
```

The server binds only to `127.0.0.1` and serves a single-page app at `/`. Planner data is stored in browser localStorage for the MVP.

## Sections

- Inbox: fast natural-language capture plus optional task fields.
- Today: guided daily planning, capacity, overdue triage, calendar blocks, routines, and Now mode.
- Plan: weekly drag scheduling, capacity by day, blocked work, and project next actions.
- Review: daily shutdown and weekly Plan Quality Engine suggestions.
