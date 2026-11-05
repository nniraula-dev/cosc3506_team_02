# Release Submission

Release: R3
Team: Nitesh Niraula, Sushrit Aryal, Chirag Kaushal
Project Option: Project 2
Deployment: PENDING — deploy and verify the R3 frontend URL
Backend: PENDING — deploy and verify the R3 backend URL
Repository: https://github.com/nniraula-dev/cosc3506_team_02
Release tag: R3-submission (PENDING — create only after final deployed QA)
Commit: PENDING — replace with the full immutable `R3-submission` commit SHA
Adapter: evaluation_adapter.json
Known issues: PENDING — record only verified, release-relevant issues; do not claim “none” until the deployed R3 QA is complete.
Test notes: PENDING — record the actual browser/device, Toronto date/time, accounts/roles, and deployed workflow results.

## Finalization record

Replace every value below from observed release evidence immediately before the
freeze. If a check did not pass, name it accurately under **Known issues**;
never convert an unrun check into a claim.

| Required fact | Final value to record |
| --- | --- |
| Frozen frontend URL | `PENDING_FRONTEND_URL` |
| Frozen backend/API base URL | `PENDING_BACKEND_URL` |
| Immutable tag and full SHA | `R3-submission @ PENDING_40_CHAR_SHA` |
| Database migration / fixture verifier | `PENDING_COMMAND_AND_PASS_TIMESTAMP_TORONTO` |
| Deployed multi-role QA | `PENDING_BROWSER_VIEWPORT_AND_TIMESTAMP_TORONTO` |
| R1/R2 regression result | `PENDING_PASS_OR_SPECIFIC_EXCEPTION` |
| Known issues | `PENDING_NONE_KNOWN_AFTER_QA_OR_PRECISE_LIST` |

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
