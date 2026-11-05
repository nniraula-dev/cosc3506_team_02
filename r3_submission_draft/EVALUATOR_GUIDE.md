# Project 2 — Release 3 evaluator guide

This guide is a short route through the R3 release. It becomes authoritative
only after the release facts below have replaced their placeholders and the
`R3-submission` tag exists at the stated SHA.

| Release fact | Verified value |
| --- | --- |
| Frontend | `<VERIFY: deployed frontend URL>` |
| API base | `<VERIFY: deployed backend URL>` |
| Frozen version | `R3-submission @ <VERIFY: 40-character commit SHA>` |
| Fixture verification | `<VERIFY: verify:r3 pass timestamp, America/Toronto>` |
| Deployed QA | `<VERIFY: browser, viewport, date/time, and result>` |

Do not use a value marked `<VERIFY: ...>` as evidence. Replace it with an
observed result or remove this guide from the final handoff.

## Safe setup

1. Open the frozen frontend URL above. Do not use production records for
   state-changing QA; use the team-controlled R3 fixture environment.
2. The fixture must be seeded after the R3 schema is applied. Its clock is
   fixed to **2026-11-06**, so expiry is not based on the evaluator's wall
   clock.
3. Private test accounts are provided only through the instructor-approved
   course channel. This guide intentionally contains no passwords, one-time
   codes, tokens, database connection strings, or partner contact details.
4. Stateful exercises should use a reset fixture copy. Reseeding is a team
   maintenance action, not an evaluator requirement; it changes fixture data.

## Two-minute public smoke path

1. As a logged-out visitor, browse the ordinary opportunity discovery view.
   With the official R3 fixture evaluated on 2026-11-06, only **O-303** should
   be available for new interest. O-301, O-302, O-304, O-305, O-306, and O-307
   must not appear as available new-match opportunities.
2. Use the availability/lifecycle lookup for a known reference such as
   **O-301** or **O-302**. It should provide a plain lifecycle explanation
   without participant names, proposal decisions, partner contacts, or private
   notes.
3. Open the public outcome showcase. The baseline fixture permits **R-501**
   only. **R-502** remains participant-private awaiting faculty confirmation;
   **R-503** remains private because its faculty profile is not public.
4. If linked profile controls are shown, open an outcome's faculty/student
   profile surface. It must show only public, consented, faculty-confirmed
   outcomes. A private student profile should receive the same safe absence as
   any other non-public profile.

## Private-role scenario path

Use a fresh/reset fixture for changes and capture the request/response or a
short screen recording per scenario in `r3_qa_evidence_checklist.md`.

| Scenario | Role(s) | Expected result |
| --- | --- | --- |
| Confirm mutual proposal | Invited students S01 and S05 | Each can answer only their own invitation. The proposal is fully confirmed only after both have confirmed; no faculty self-confirmation is possible. |
| Observe partial proposal | Invited S08, S11 | M-402 is partly confirmed: S08 confirmed, S11 still pending. It is not a completed match. |
| Preserve a decline / withdrawal | Invited student; proposing verified faculty | A decline and a faculty withdrawal remain visible as distinct records to authorized participants; neither destroys the historical opportunity/match. |
| Record partner agreement | Managing verified faculty | The agreement is recorded by faculty for an industry opportunity. It is not a partner login and does not expose partner contact information. |
| Manage lifecycle | Managing verified faculty or staff | Withdraw, archive, complete, or restore where valid; the response preserves the opportunity identifier and provides a non-confidential lifecycle explanation. |
| Renew a prior run | Managing verified faculty or staff | Renew an expired/completed opportunity with a new target term and deadline. The opportunity identity and earlier outcome history remain intact while a new current run is created. |
| Record and confirm an outcome | Confirmed-match participant; participating verified faculty | An eligible participant records an outcome; participating faculty confirms it; each participant controls consent; a student separately controls profile-only visibility. |

## Baseline fixture expectations

The verifier should report the following before exploratory QA begins:

| Fixture evidence | Expected baseline |
| --- | --- |
| Lifecycle states | O-301 matched; O-302 expired; O-303 open; O-304 expired; O-305 withdrawn; O-306 completed; O-307 archived. |
| Match states | M-401 and M-404 confirmed; M-402 partly confirmed; M-403 declined. |
| Public outcomes | R-501 eligible; R-502 and R-503 participant-only. |
| Important expiry rule | O-301 is past deadline but remains matched because every named student confirmed. O-302 is expired because its match was only partly confirmed. |

## Evidence and support boundary

- Record deployed evidence and known issues in `release_submission.md` and
  `evaluation_adapter.json`; those two files are the required Moodle uploads.
- The compact Moodle summary is `moodle_online_text_draft.md` after its facts
  are finalized.
- The team QA record is `r3_qa_evidence_checklist.md`. It distinguishes
  observed passes from planned scenarios and should be kept with the tagged
  release.
- A successful R3 check does not remove the need to verify R1/R2 discovery,
  consent, publication/intake gate, partner-contact confidentiality,
  willingness/engagement, and private subscription behavior.
