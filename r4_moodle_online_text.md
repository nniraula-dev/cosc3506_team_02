## Project 2 — Release 4 Product Result

**Chosen challenge:** R4-20 — Interest survives synchronisation
**Repository:** https://github.com/nniraula-dev/cosc3506_team_02
**Assessed tag:** `R4-submission` — final tagged commit on `project2-r1`
**Deployment:** https://cosc3506-team-02-1.onrender.com
**Backend:** https://cosc3506-team-02-1backend.onrender.com

### What changed

Release 4 adds a source-neutral external-opportunity layer using the supplied
synthetic Mitacs feed. External records are clearly labelled as provider-owned,
offer a safe authoritative handoff link, and do not claim that Algoma controls
eligibility, applications, or outcomes.

The operator can run supplied v1 and v2 feeds. The adapter records per-record
new, unchanged, changed, not-seen, and malformed classifications; malformed
records are skipped without stopping the remaining feed. A record missing from
a successful sync retains its last-known content and is visibly marked stale,
not deleted. A deliberately failed sync leaves all external opportunity data
and disappearance state unchanged while making the failure reason visible to
the operator.

Faculty can record Algoma-local support for an external opportunity. This is
not provider endorsement or selection. For the chosen R4-20 challenge, that
support persists when a source record changes, disappears, and reappears.

### Evaluator instructions

1. For a fresh evaluator database, apply `schema.sql`, seed the controlled
   R1/R2/R3 fixture data, and start the backend in a disposable or
   reset-controlled environment. For an existing R1–R3 database, use the
   additive `r4_migration.sql`.
2. Sign in with the approved staff/operator fixture account and use
   **External-source operations** to run Mitacs fixture v1, then v2.
3. To simulate a provider failure, use **Simulate provider failure**. Confirm
   that the operator sees the failure reason while discovery still shows
   last-known data.
4. Sign in as verified faculty, record support on MX-1002 before v2, and check
   it remains after MX-1002 changes. For R4-20, record support on MX-1003,
   run v2 (it disappears), then v1 (it reappears), and confirm support remains.
5. As a public visitor or student, verify source labels, freshness, stale
   messaging, provider handoff, and that MX-1005's text is displayed as text
   rather than executed markup.

### Verification status

The local automated suite passed **29/29** checks and the frontend production
build completed. The additive R4 migration has been applied to the deployed
database; deployed `/api/health`, public `/api/opportunities`, and authenticated
operator R4 health/run endpoints all returned HTTP 200. The mutation-enabled
fixture sync sequence was intentionally left for the teammate's controlled
peer-QA environment rather than seeding shared production data.

Attached: `release_submission.md` and `evaluation_adapter.json`.
