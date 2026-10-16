# Release Submission

Release: R2
Team: Nitesh Niraula, Sushrit Aryal, Chirag Kaushal
Project Option: Project 2
Deployment: https://cosc3506-team-02-1.onrender.com
Repository: https://github.com/nniraula-dev/cosc3506_team_02
Release tag: R2-submission
Commit: The immutable commit identified by the `R2-submission` Git tag. The full SHA is available from `git rev-list -n 1 R2-submission` after freeze.
Adapter: evaluation_adapter.json
Known issues: The R2 source fixture bundle was not present in the repository or supplied templates at implementation time, so S-201 through S-206 have not yet been imported or verified against their exact published outcomes. The implementation accepts non-identical duplicate partner submissions and does not deduplicate by organisation/title.
Test notes: The deployed backend must have the configured Supabase DATABASE_URL. Local verification used the real Supabase database and the instructor-approved passwordless test mode.

## Test accounts

Provide linked verified-faculty, unverified-faculty, and staff/admin fixture account details through the approved private course channel. The ordinary sign-in flow accepts only `@algomau.ca` addresses and returns a short-lived one-time code in instructor-approved test mode. No password, token, or database credential is committed here.

## Release-specific evidence

- R2 tables are created by `schema.sql`: industry intake, areas, supervisors, private subscriptions, and in-product notifications.
- Valid accountless intake starts in `awaiting-supervisor`; required fields are validated before insert.
- Verified faculty can see partner contact details, record non-exclusive willingness, record engagement, and alter private subscriptions. First willingness changes the opportunity to `supervised`; last withdrawal returns it to pending.
- Public discovery exposes only supervised opportunities and omits partner contact/engagement fields. Faculty-created R1 projects and faculty discovery remain available.
- Notifications are delivered as a private in-product list and do not gate browsing.
- Local end-to-end checks passed for validation, private access, first/second supervisor, engagement, both withdrawal transitions, unverified-user denial, and public field redaction.
- `evaluation_adapter.json` maps the deployed R2 interfaces and required test setup.
