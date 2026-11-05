## Project 2 — Release 3 Product Result

**Deployment:** https://cosc3506-team-02-1.onrender.com
**Backend:** https://cosc3506-team-02-1backend.onrender.com
**Repository:** https://github.com/nniraula-dev/cosc3506_team_02
**Frozen version:** `R3-submission` @ `fadf88146c4d82f8c3659f5ab752f4d6fce1affc`

This release adds mutual faculty–student match proposals, independent student
confirmation/decline, opportunity lifecycle management, renewal/history,
participant outcomes, faculty confirmation, consent-controlled showcase display,
and student profile-only outcome visibility. A confirmed match records an
intention to work together only; it is not course registration, credit,
eligibility, or official university approval.

Official R3 fixture data is tracked in `backend/r3_fixture/` and evaluated
against the fixed simulated date **2026-11-06**. The release package contains
`release_submission.md` and `evaluation_adapter.json`; account details are
provided only through the approved private course channel.

**Known issue:** Supabase was restoring from a paused state at package
preparation, so live database verification and deployed multi-account QA must
be rerun after restoration. Static contract verification passed 18/18 and the
production frontend build passed.

**Evidence completed before freeze:** static R1/R2/R3 contract verification
(18/18) and production frontend build. The included fixture verifier and
controlled deployed QA runner cover the lifecycle, privacy, and multi-account
scenarios once the database is online.

**Evaluator route:** See `EVALUATOR_GUIDE.md` in the same frozen repository
commit for a short public smoke path and the private-role scenarios. It contains
no credentials. The full evidence record is `r3_qa_evidence_checklist.md`.

---

The two required files are attached alongside this online text. The release
records the live-verification limitation transparently rather than claiming an
unrun database test.
