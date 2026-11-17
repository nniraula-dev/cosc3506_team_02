# Release Submission

Release: R4
Team: Nitesh Niraula, Sushrit Aryal, Chirag Kaushal
Project Option: Project 2 — Opportunity Registry and Pathway Platform
Deployment: https://cosc3506-team-02-1.onrender.com
Backend: https://cosc3506-team-02-1backend.onrender.com
Repository: https://github.com/nniraula-dev/cosc3506_team_02
Release tag: `R4-submission`
Commit: `fa34d0e821c1488a5170e09e54ab7e6f385ace94`
Adapter: `evaluation_adapter.json`

## Scope record

On 2026-11-16 (Toronto), Moodle's Project 2 requirements book exposed R1
through R3 but did not expose a Project 2 R4 requirements chapter or R4 fixture
bundle. This release therefore addresses documented peer-QA repairs on the
frozen R3 codebase rather than claiming undisclosed R4 requirements.

## Evidence observed before release

- The local automated suite passed **24/24** checks.
- `npm --prefix frontend run build` completed successfully.
- After the Supabase project was resumed, the deployed backend health endpoint
  returned `200 {"ok":true,"database":"reachable"}`.
- The R4 code was published to `main` at the commit above; Render is configured
  to deploy both services from `main`.

## R4 peer-QA repair record

- A student cannot confirm a match from an earlier opportunity run after that
  opportunity has been renewed.
- Renewed opportunity deadlines cannot precede the configured evaluation date,
  and outcome completion dates cannot be in that evaluation date's future.
- Partner agreement is restricted to industry opportunities; faculty-source
  opportunities are identified consistently in the faculty and public UI.
- Completed-outcome availability explanations refresh after faculty confirmation
  and participant consent changes.
- Sign-out clears the current and legacy browser session locations.
- Public discovery exposes the existing safe faculty-contact action.

## Known issues and verification limits

- Moodle's Project 2 R4 requirements and fixture bundle were not visible at
  release preparation time; this is documented above rather than inferred.
- The mutation-enabled deployed QA runner was not run against production because
  it creates and changes controlled fixture data. The adapter identifies the
  scenarios for a controlled evaluator run.
- The frontend's final Render build should be observed at the deployment URL
  before the Moodle submission is frozen. This file will be updated with that
  observation once Render completes the build.

## Test accounts

Use instructor-approved passwordless test-mode accounts only. Provide the
linked verified-faculty, invited-student, uninvolved-student, and staff/admin
fixture identities through the approved private course channel. No passwords,
tokens, challenge codes, or database credentials are committed here.
