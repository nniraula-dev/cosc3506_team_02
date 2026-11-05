## Project 2 — Release 3 Product Result

**Deployment:** https://cosc3506-team-02-1.onrender.com
**Backend:** https://cosc3506-team-02-1backend.onrender.com
**Repository:** https://github.com/nniraula-dev/cosc3506_team_02
**Frozen version:** `R3-submission` @ `9c4f731c0188f62e80cecef6b36321279179f5b9`

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

**Known issues:** None known after deployed QA.

**Evidence completed before freeze:** schema migration, official fixture seed,
and lifecycle/privacy verifier passed against Supabase; controlled deployed
multi-role QA passed against Render; static R1/R2/R3 contract verification
(18/18) and production frontend build also passed. The controlled fixture was
re-seeded to its official baseline after the stateful QA run.

**Evaluator route:** See `EVALUATOR_GUIDE.md` in the same frozen repository
commit for a short public smoke path and the private-role scenarios. It contains
no credentials. The full evidence record is `r3_qa_evidence_checklist.md`.

---

The two required files are attached alongside this online text.
