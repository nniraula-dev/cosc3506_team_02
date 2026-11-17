## Project 2 — Release 4 Product Result

**Deployment:** https://cosc3506-team-02-1.onrender.com
**Backend:** https://cosc3506-team-02-1backend.onrender.com
**Repository:** https://github.com/nniraula-dev/cosc3506_team_02
**Frozen code release:** `R4-submission` @ `fa34d0e821c1488a5170e09e54ab7e6f385ace94`

This R4 release packages verified repairs to documented peer-QA findings on the
Project 2 R3 codebase: old-run confirmation protection, evaluation-date
validation, faculty/industry source separation, refreshed completed-outcome
availability explanations, reliable sign-out, and the public faculty-contact
action.

### Scope transparency

At submission preparation time, Moodle's Project 2 requirements book exposed
R1 through R3, but no visible R4 requirements chapter or R4 fixture bundle.
This release therefore documents and delivers the verified peer-QA repairs; it
does not claim a feature scope that was not published to the team.

### Evidence and limitations

The local automated suite passed **24/24** checks and the frontend production
build passed. After Supabase resumed, the deployed backend health check returned
`200 {"ok":true,"database":"reachable"}`. Render deployed the R4 branch
merge `ff3db4d06a803b0cc027aedf11fe53c1986205a8` live; the public page showed
the new `Supervised opportunities` heading and Sign out control, while the
public opportunities API returned `source_type: "faculty"` for `O-305`. The
mutation-enabled deployed QA runner was not run against production because it
changes controlled fixture data. The attached adapter identifies the exact
controlled evaluation scenarios.

### AI-use disclosure

Codex was used to help examine peer-QA feedback, implement and test repairs,
restore and verify deployment readiness, and draft this release documentation.
The team remains responsible for the submitted work and its accuracy.

Attached: `release_submission.md` and `evaluation_adapter.json`.
