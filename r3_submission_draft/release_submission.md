# Release Submission

Release: R3
Team: Nitesh Niraula, Sushrit Aryal, Chirag Kaushal
Project Option: Project 2
Deployment: https://cosc3506-team-02-1.onrender.com
Backend: https://cosc3506-team-02-1backend.onrender.com
Repository: https://github.com/nniraula-dev/cosc3506_team_02
Release tag: R3-submission
Commit: 9c4f731c0188f62e80cecef6b36321279179f5b9
Adapter: evaluation_adapter.json
Known issues: None known after deployed QA.
Test notes: The official fixture verifier passed against the restored database. Controlled deployed multi-account QA passed for lifecycle renewal/restore, declined/withdrawn match history, independent confirmations, unauthorized-action rejection, outcome confirmation/consent, showcase visibility, and profile-only hiding. Static R1/R2/R3 contract suite passed (18/18) and the production frontend build passed.

## Finalization record

Replace every value below from observed release evidence immediately before the
freeze. If a check did not pass, name it accurately under **Known issues**;
never convert an unrun check into a claim.

| Required fact | Final value to record |
| --- | --- |
| Frozen frontend URL | `https://cosc3506-team-02-1.onrender.com` |
| Frozen backend/API base URL | `https://cosc3506-team-02-1backend.onrender.com` |
| Immutable tag and full SHA | `R3-submission @ 9c4f731c0188f62e80cecef6b36321279179f5b9` |
| Database migration / fixture verifier | `schema:apply`, `seed:r3`, and `verify:r3` passed against the restored Supabase database |
| Deployed multi-role QA | `verify:r3-api` passed against the Render backend; baseline fixture was re-seeded afterward |
| R1/R2 regression result | 18/18 static R1/R2/R3 contract tests passed; production frontend build passed |
| Known issues | None known after deployed QA |

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
