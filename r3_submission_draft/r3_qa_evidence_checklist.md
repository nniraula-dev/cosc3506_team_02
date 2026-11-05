# Release 3 QA evidence checklist

Use this checklist during release verification. Empty boxes mean **not yet
verified**. Link each checked item to a short, non-sensitive artifact (for
example, a timestamped request/response, screenshot, or test log) and record
any deviation as a known issue. Do not attach passwords, tokens, codes,
database URLs, partner contacts, or private student information.

## Release identity and environment

- [ ] Candidate commit is recorded: `<VERIFY: full SHA>`.
- [ ] Candidate branch and pushed tag are recorded: `<VERIFY: R3-submission @ SHA>`.
- [ ] Deployed frontend is recorded: `<VERIFY: HTTPS URL>`.
- [ ] Deployed API is recorded: `<VERIFY: HTTPS URL>`.
- [ ] Database migration is recorded: `<VERIFY: migration command/version and Toronto timestamp>`.
- [ ] Controlled R3 fixture seed is recorded: `<VERIFY: seed command and Toronto timestamp>`.
- [ ] Read-only `npm --prefix backend run verify:r3` passes: `<VERIFY: output/timestamp>`.
- [ ] Test browser, operating system, viewport(s), and tester roles are recorded:
  `<VERIFY: e.g., Chrome version / 390px and desktop viewport / private test identities>`.

## Official fixture baseline (simulated date: 2026-11-06)

- [ ] O-301 is **matched**, not expired, although its deadline is 2026-10-15.
- [ ] O-302 is **expired** because 2026-10-20 passed with M-402 only partly
  confirmed.
- [ ] O-303 is **open** for a new match (2027W; deadline 2026-12-15).
- [ ] O-304 is **expired** after its declined match and 2026-09-30 deadline.
- [ ] O-305 is **withdrawn**, distinct from expired.
- [ ] O-306 is **completed**, distinct from expired.
- [ ] O-307 is **archived**, distinct from expired.
- [ ] M-401 has two separate confirmed student responses.
- [ ] M-402 is partly confirmed: S08 confirmed and S11 pending.
- [ ] M-403 is declined and M-404 is confirmed.
- [ ] R-501 alone appears in the public showcase baseline.
- [ ] R-502 remains participant-only until faculty confirmation.
- [ ] R-503 remains participant-only because the associated faculty profile is
  not public.

Evidence reference: `<VERIFY: verifier output / browser evidence location>`

## Mutual match, decision history, and industry agreement

- [ ] Verified faculty can propose a match using a named, eligible opportunity
  and student list.
- [ ] Faculty cannot self-confirm a proposal on behalf of a student.
- [ ] Each invited student sees only their own invitation and can confirm or
  decline independently.
- [ ] A proposal is **partly confirmed** after one of two named students
  confirms, and **confirmed** only after all named students confirm.
- [ ] An uninvolved student receives an authorization failure when attempting a
  match action or lookup outside their role.
- [ ] Student decline is retained as a distinct historical state.
- [ ] Faculty withdrawal is retained as a distinct historical state.
- [ ] Faculty can record agreement-in-principle for an industry opportunity;
  the public surface exposes neither partner contacts nor a partner login.

Evidence reference: `<VERIFY: unique scenario IDs / timestamped artifacts>`

## Lifecycle, deadline, renewal, and restore

- [ ] New availability uses lifecycle state plus target term and deadline,
  rather than treating the R2 publication status as availability.
- [ ] Ordinary discovery excludes expired, withdrawn, matched, completed, and
  archived opportunities while preserving a safe availability explanation for
  a bookmarked/reference lookup.
- [ ] A matched opportunity does not expire merely because its calendar
  deadline passed.
- [ ] Managing faculty/staff can change permitted lifecycle states and a reason
  is recorded.
- [ ] A mistakenly expired or withdrawn opportunity can be restored without
  creating a replacement record; its original identifier/history remains.
- [ ] Only eligible expired/completed opportunities renew; renewal creates a
  later-term run while retaining identity and earlier outcomes.
- [ ] Invalid state changes and invalid renewal inputs receive a safe 4xx
  response rather than a silent success.

Evidence reference: `<VERIFY: fixture-safe or reset scenario evidence>`

## Outcomes, consent, public surfaces, and privacy

- [ ] Only a confirmed-match participant can record an outcome.
- [ ] The recorded outcome starts participant-private until participating
  verified faculty confirms it.
- [ ] Only a participating verified faculty member can faculty-confirm an
  outcome.
- [ ] Each participant can control their own public consent only.
- [ ] Every required participant's consent and public faculty eligibility are
  required before a result reaches the public showcase.
- [ ] A student can independently hide/show an outcome on their own profile;
  that preference does not rewrite faculty/profile/showcase consent rules.
- [ ] Public faculty/student outcome pages expose only eligible public data;
  non-public pages return an ordinary safe absence, not confidential detail.
- [ ] Logged-out public users cannot discover private proposals, invitations,
  outcomes, partner contacts, or staff-only lifecycle detail.

Evidence reference: `<VERIFY: public + authorized + unauthorized artifacts>`

## R1/R2 regression and quality bar

- [ ] R1 faculty/project discovery still works under the existing access and
  consent constraints.
- [ ] R2 intake/publication gate, verified faculty controls, partner-contact
  confidentiality, willingness/engagement, and private subscriptions still
  work as before.
- [ ] Keyboard-only pass: logical tab order, visible focus, no trapped dialog,
  and usable form/button labels in R3 controls.
- [ ] Narrow viewport pass (at least 390 CSS px): public discovery, sign-in,
  availability lookup, student controls, and faculty controls remain usable.
- [ ] Deployed error handling is legible and preserves a safe response for
  expired/unauthorized/missing records.
- [ ] No browser console error or failed static asset is observed on the public
  smoke path.

Evidence reference: `<VERIFY: responsive/keyboard/regression evidence>`

## Freeze and Moodle handoff

- [ ] `release_submission.md` has no `PENDING`, `<VERIFY: ...>`, or placeholder
  values and names only observed known issues.
- [ ] `evaluation_adapter.json` validates as JSON and its URLs/routes match the
  deployed frozen version.
- [ ] `moodle_online_text_draft.md` has no `PENDING` placeholders.
- [ ] Evidence documents were committed, pushed, and the `R3-submission` tag
  points to their exact SHA.
- [ ] A team member independently compared tag SHA, deployed URL, and Moodle
  attachments before release freeze.
- [ ] Moodle upload contains only the two required Product Result artifacts
  plus concise Online text; peer-QA material is kept separate.
- [ ] **Human release decision recorded:** `<VERIFY: reviewer and Toronto timestamp>`.

## Known issues / deviations

| ID | Severity | Observed behavior | Reproduction | Decision / owner |
| --- | --- | --- | --- | --- |
| `<VERIFY>` | `<VERIFY>` | `<VERIFY>` | `<VERIFY>` | `<VERIFY>` |
