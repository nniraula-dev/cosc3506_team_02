# R3 Submission Pack — Draft

These are working drafts based on the official Moodle templates downloaded on
November 4, 2026. They are deliberately separate from the current root-level
R2 evidence until the R3 deployment, QA, immutable tag, and commit SHA have
been verified.

## Pack contents

- `release_submission.md` — Moodle's required release-evidence document.
- `evaluation_adapter.json` — Moodle's required evaluator route/scenario map.
- `moodle_online_text_draft.md` — concise text for Moodle's **Online text**
  field; replace every `PENDING` value before pasting it.
- `EVALUATOR_GUIDE.md` — a short, safe route through the deployed release for
  the marker or peer tester.
- `r3_qa_evidence_checklist.md` — the team's pre-freeze evidence record. It is
  deliberately not an assertion that the checks have passed.
- `peer_qa_report_r3_template.json` — a separate template for the peer-review
  assignment, not this Product Result submission.

Treat `PENDING` and `<VERIFY: ...>` as release blockers, not as text that may
remain in a final upload. Record only observed deployment facts; do not put
credentials, challenge codes, tokens, database URLs, or partner contact data
in any of these files.

## Product Result Moodle submission

The **Release 3 Product Result** assignment accepts Online text plus up to
eight files. Prepare and upload these two completed files:

1. `release_submission.md` — use the draft in this folder only after replacing
   every `PENDING` value with verified R3 evidence.
2. `evaluation_adapter.json` — use the mapped draft in this folder only after
   its deployment URL and routes match the frozen, deployed R3 version.

Put a concise release summary in Moodle **Online text** using
`moodle_online_text_draft.md`. The marker is told to read that text first. Do
not upload passwords, database credentials, challenge codes, or long-lived
tokens. The R3 fixture JSON is tracked in the repository; it is not a required
Moodle Product Result upload.

Clicking **Save changes** leaves a draft. Clicking **Submit assignment** is the
release freeze and counts for the entire team. Do not submit until the deployed
workflow, database migration, fixture setup, evidence files, and
`R3-submission` tag are all verified.

## Peer QA is a separate deliverable

`peer_qa_report_r3_template.json` is for reviewing the assigned peer team's
R3 release, not for the Product Result upload. After peer QA, save the completed
report as `peer_qa_report.json` only where the peer-QA instructions require it.

## Current blockers before this pack can become final

- R3 schema and fixture must be applied to the correct Supabase database.
- The deployed frontend/backend must be verified against the R3 workflow.
- The team must complete multi-account QA: faculty, two students on one match,
  staff/admin, ordinary student, and logged-out visitor.
- The frozen commit must be pushed and tagged `R3-submission`; record its full
  SHA in the release document and Online text.

## Finalization order

1. Run `npm --prefix backend run schema:apply` against the intended release
   database, then seed the controlled fixture.
2. Run `npm --prefix backend run verify:r3`; preserve its timestamp and result
   in the QA checklist.
3. Deploy the exact candidate commit without freezing it yet.
4. Against a controlled fixture reset, run the deployed API QA with
   `R3_API_BASE_URL=<backend-url> R3_QA_ALLOW_MUTATION=yes npm --prefix backend run verify:r3-api`,
   then immediately rerun `npm --prefix backend run seed:r3` and `verify:r3`.
5. Complete the remaining browser,
   multi-account checklist (including R1/R2 regression and narrow-screen/keyboard checks).
6. Update the two required artifacts and the Online-text draft with only the
   verified URL, API URL, commit SHA, test evidence, and known issues.
7. Commit those evidence updates, push the immutable commit, and create/push
   the `R3-submission` tag at that exact commit.
8. Reopen the deployed URLs once after tagging, compare the tag SHA to the
   evidence, and make the Moodle upload a **draft** if a team review is still
   needed. Final Moodle submission freezes the release.

The existing root `release_submission.md` and `evaluation_adapter.json` are
R2 evidence and should remain intact until the R3 freeze is actually ready.
