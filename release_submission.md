Chosen challenge: R4-20 — Interest survives synchronisation

# Release Submission

Release: R4
Team: Nitesh Niraula, Sushrit Aryal, Chirag Kaushal
Project Option: Project 2 — Opportunity Registry and Pathway Platform
Deployment: Pending deployment of this local R4 implementation
Backend: Pending deployment of this local R4 implementation
Repository: https://github.com/nniraula-dev/cosc3506_team_02
Release tag: `R4-submission` — move to the final assessed commit after review
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

Apply `schema.sql`, seed the controlled R1/R2/R3 fixture data, then start the
backend. The designated operator uses the existing passwordless test-mode
account `r3.staff@algomau.ca`; verified faculty can use the R3 faculty fixture
accounts. No passwords, tokens, or credentials are committed.

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

## Local verification completed

- `npm test` passed 29/29 static and regression checks.
- `npm run build` completed successfully.
- Node syntax checks passed for the R2, R3, R4, and server modules.

## Verification still required before submission

- Apply the migration to the controlled database and run v1, v2, repeat-v2,
  failure, and reappearance checks end-to-end.
- Deploy the assessed commit, then replace the pending URLs and move
  `R4-submission` to that immutable commit.
- Record the actual deployed evidence in this document and
  `evaluation_adapter.json`; do not claim the old R3-only deployment as R4.

## Known issues

The repository has no local database configuration in this workspace, so the
database-backed R4 sync was not executed here. The supplied mutation-enabled
QA runner is intended only for a disposable or reset-controlled fixture
database, never shared production data.
