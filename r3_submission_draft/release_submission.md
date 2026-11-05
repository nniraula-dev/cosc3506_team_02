# Release Submission

Release: R3
Team: Nitesh Niraula, Sushrit Aryal, Chirag Kaushal
Project Option: Project 2
Deployment: https://cosc3506-team-02-1.onrender.com
Backend: https://cosc3506-team-02-1backend.onrender.com
Repository: https://github.com/nniraula-dev/cosc3506_team_02
Release tag: R3-submission
Commit: fadf88146c4d82f8c3659f5ab752f4d6fce1affc
Adapter: evaluation_adapter.json
Known issues: At package preparation, Supabase was restoring from a paused state; therefore live database and multi-account deployment QA remains pending. The deployed API may temporarily return `database unavailable` until restoration completes.
Test notes: Static R1/R2/R3 contract suite passed (18/18) and the production frontend build passed on 2026-11-04 (Toronto). The R3 fixture verifier and deployed multi-account runner are included but intentionally await database restoration.

## Finalization record

Replace every value below from observed release evidence immediately before the
freeze. If a check did not pass, name it accurately under **Known issues**;
never convert an unrun check into a claim.

| Required fact | Final value to record |
| --- | --- |
| Frozen frontend URL | `https://cosc3506-team-02-1.onrender.com` |
| Frozen backend/API base URL | `https://cosc3506-team-02-1backend.onrender.com` |
| Immutable tag and full SHA | `R3-submission @ fadf88146c4d82f8c3659f5ab752f4d6fce1affc` |
| Database migration / fixture verifier | Pending: Supabase restoration in progress at package preparation |
| Deployed multi-role QA | Pending: run `npm --prefix backend run verify:r3-api` only after restoration |
| R1/R2 regression result | 18/18 static R1/R2/R3 contract tests passed; production frontend build passed |
| Known issues | Live database verification deferred while Supabase restores from pause |

The evaluator guide and QA evidence checklist are repository aids, not extra
claims of completion. They should agree with this table and the frozen tag.

## Test accounts

Provide the following through the approved private course channel only. Do not
commit passwords, tokens, or database credentials.

- verified faculty fixture account linked to a Project 2 faculty profile;
- two distinct student fixture accounts invited to the same match;
- an uninvolved student account for negative authorization checks;
- staff/admin account for lifecycle restoration checks.

The R3 fixture seeder creates named fixture identities including faculty,
students such as `S01`/`S05`, and staff. Record the actual approved account
details and the passwordless test-mode setup privately before submission.

## Release-specific evidence

- R3 lifecycle schema, match proposals, independent student confirmation,
  outcomes, consent, and profile/showcase surfaces are defined in `schema.sql`
  and `backend/r3-routes.js`.
- The official R3 fixture is tracked in `backend/r3_fixture/`. Its evaluation
  clock is fixed at `2026-11-06`; `npm --prefix backend run seed:r3` records
  that clock in the database, while `npm --prefix backend run verify:r3`
  performs read-only fixture verification.
- Before freezing, replace this draft with observed evidence for: O-302/O-304
  expired; O-301 and O-306 not expired because of confirmed matches; distinct
  Expired, Withdrawn, Matched, Completed, and Archived states; renewal and
  restore without recreating the opportunity; public R-501-like showcase data;
  and an outcome awaiting faculty confirmation.
- Confirm deployed R1/R2 regression behavior: faculty/project discovery,
  consent-driven visibility, intake/publication gate, partner-contact
  confidentiality, willingness/engagement, and private subscriptions.
- Record the exact fixture load order and actual deployment test evidence here
  after it is complete. This draft is not submission evidence yet.
