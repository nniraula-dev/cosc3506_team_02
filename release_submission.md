Chosen challenge: R4-20 — Interest survives synchronisation

# Release Submission

Release: R4
Team: Nitesh Niraula, Sushrit Aryal, Chirag Kaushal
Project Option: Project 2 — Opportunity Registry and Pathway Platform
Deployment: https://cosc3506-team-02-1.onrender.com
Backend: https://cosc3506-team-02-1backend.onrender.com
Repository: https://github.com/nniraula-dev/cosc3506_team_02
Release tag: `R4-submission` — final tagged commit on `project2-r1`
Adapter: `evaluation_adapter.json`

## Chosen challenge

R4-20 — Interest survives synchronisation. Faculty support is stored as
Algoma-local data, separate from source-controlled opportunity fields. It is
therefore retained when an opportunity changes, disappears from a successful
sync, and later reappears.

## Implemented scope

- A source-neutral external-source model, with Mitacs as the supplied synthetic
  adapter rather than the model itself.
- Safe normalisation of imported titles, descriptions, URLs, dates, and areas;
  external text is rendered as text and cannot change local state.
- v1/v2 synchronisation with auditable `new`, `unchanged`, `changed`,
  `not-seen`, and `malformed` classifications. A malformed record is skipped
  without failing the remaining run.
- Last-known data for records missing from a successful source feed, with an
  explicit stale/not-seen label rather than deletion.
- A failure-safe path: failed provider responses record operator-visible health
  information without changing external opportunity data or disappearance
  state.
- Provider ownership, source provenance, authoritative handoff links,
  freshness, source change messaging, and Algoma-local faculty support in the
  public/faculty UI.
- Server-side authorization for sync runs and health (operator only) and
  faculty support (verified faculty only). External records cannot be changed
  through local lifecycle, matching, or supervision actions.

## Evaluation setup

For a fresh evaluator-controlled database, apply `schema.sql`, seed the
controlled R1/R2/R3 fixture data, then start the backend. For an existing
R1–R3 deployment, apply the additive `r4_migration.sql` instead of re-running
the historical bootstrap. The designated operator uses the existing
passwordless test-mode account `r3.staff@algomau.ca`; verified faculty can use
the R3 faculty fixture accounts. No passwords, tokens, or credentials are
committed.

The operator UI offers the two supplied feeds. The equivalent API calls are:

```json
POST /api/external-sync
{ "fixture": "v1" }

POST /api/external-sync
{ "fixture": "v2" }

POST /api/external-sync
{ "simulate_failure": true }
```

The last call intentionally returns a failure while retaining every prior
external record and its last successful sync state. Operator health appears at
`GET /api/external-sync/health`; the latest per-record classification list is
available at `GET /api/external-sync/runs/{runId}/events`.

## Verification completed

- `npm test` passed 29/29 static and regression checks.
- `npm run build` completed successfully.
- Node syntax checks passed for the R2, R3, R4, and server modules.
- The additive R4 schema migration was applied to the deployed Supabase
  database in a transaction, then the normal backend start command was
  restored.
- The deployed backend returned HTTP 200 for `/api/health` and public
  `/api/opportunities` after migration.
- A passwordless test-mode operator smoke test returned HTTP 200 for both
  `/api/external-sync/health` and `/api/external-sync/runs`. The source and
  run lists were empty, as no production fixture sync was performed.

## Controlled-fixture boundary

The mutation-enabled v1/v2/repeat/failure/reappearance runner was deliberately
not run against shared production data. It remains available for the teammate's
controlled peer-QA environment and for evaluator fixtures; no live external
opportunity records were seeded merely to produce screenshots or evidence.

## Known issues

No functional issue was observed in the deployed smoke checks. The supplied
mutation-enabled QA runner is intentionally for a disposable or
reset-controlled fixture database, never shared production data.
