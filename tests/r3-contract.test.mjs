import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

test("R3 schema keeps lifecycle, mutual confirmation, and outcomes as distinct records", () => {
  const schema = read("schema.sql");
  for (const table of [
    "student_profiles",
    "opportunity_runs",
    "match_proposals",
    "match_participants",
    "opportunity_outcomes",
    "outcome_participants",
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /'open', 'expired', 'withdrawn', 'matched', 'completed', 'archived'/);
  assert.match(schema, /evaluation_date DATE NOT NULL/);
  assert.match(schema, /expiry_exception BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(schema, /r3_schedule_required BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(schema, /partner_agreed_in_principle/);
  assert.match(schema, /public_consent BOOLEAN NOT NULL DEFAULT FALSE/);
});

test("R3 routes enforce mutual match actions and consent-gated showcase surfaces", () => {
  const routes = read("backend/r3-routes.js");
  for (const endpoint of [
    'app.post("/api/opportunities/:identifier/matches"',
    'app.post("/api/matches/:identifier/confirm"',
    'app.post("/api/matches/:identifier/decline"',
    'app.post("/api/matches/:identifier/withdraw"',
    'app.patch("/api/opportunities/:identifier/lifecycle"',
    'app.patch("/api/opportunities/:identifier/schedule"',
    'app.post("/api/opportunities/:identifier/renew"',
    'app.post("/api/opportunities/:identifier/outcomes"',
    'app.post("/api/outcomes/:identifier/faculty-confirm"',
    'app.get("/api/showcase"',
  ]) assert.ok(routes.includes(endpoint), `missing ${endpoint}`);
  assert.match(routes, /You were not invited to this match/);
  assert.match(routes, /All invited students confirmed/);
  assert.match(routes, /Set the target term and authoritative application deadline before proposing a match/);
  assert.match(routes, /blocked\.public_consent = FALSE/);
  assert.match(routes, /blocked_faculty\.public_profile = FALSE/);
});

test("R3 keeps a match proposed until every named student responds independently", () => {
  const routes = read("backend/r3-routes.js");

  // Confirmation is deliberately a student-only action: faculty may propose,
  // but cannot turn their own proposal into a confirmed match.
  assert.match(routes, /if \(!\(await studentForUser\(client, user\.id\)\)\)/);
  assert.match(routes, /Only an invited student can respond to a match/);
  assert.match(routes, /You were not invited to this match/);

  // A declined participant wins over partial confirmation, and an opportunity
  // changes to matched only after the count says every participant confirmed.
  assert.match(routes, /COUNT\(\*\)::int AS total/);
  assert.match(routes, /if \(summary\.declined > 0\) nextState = "declined"/);
  assert.match(routes, /else if \(summary\.confirmed === summary\.total\) nextState = "confirmed"/);
  assert.match(routes, /if \(nextState === "confirmed"\)[\s\S]*?"matched"/);
  assert.match(routes, /Only a proposed or partly confirmed match can be withdrawn/);
});

test("R3 lifecycle expiry, restoration, and renewal remain auditable", () => {
  const routes = read("backend/r3-routes.js");

  // Expiry is evaluated against the configured simulation date, applies only
  // to an actively available record, and is protected by a confirmed match.
  assert.match(routes, /SELECT evaluation_date FROM r3_evaluation_settings/);
  assert.match(routes, /opportunity\.lifecycle_state !== "open" \|\| opportunity\.expiry_exception \|\| !deadline/);
  assert.match(routes, /String\(deadline\) < String\(nowForEvaluation\) && !confirmed/);

  // Restoring an expired/withdrawn record leaves a trace and cannot reopen an
  // opportunity that still has a confirmed match. Renewal creates a new run
  // while retaining the original opportunity identity and past runs.
  assert.match(routes, /Only an expired or withdrawn opportunity can be restored to active availability/);
  assert.match(routes, /A confirmed match must be completed or otherwise resolved before reopening this opportunity/);
  assert.match(routes, /INSERT INTO opportunity_lifecycle_events/);
  assert.match(routes, /UPDATE opportunity_runs SET is_current = FALSE/);
  assert.match(routes, /INSERT INTO opportunity_runs/);
  assert.match(routes, /Only an expired or completed opportunity can be renewed/);
  assert.match(routes, /Renewed for a later term while retaining its original opportunity history/);
  assert.match(routes, /A Center-configured date is authoritative immediately/);
  assert.match(routes, /\(\{ opportunity, run \} = await refreshExpiry\(client, opportunity\)\)/);
});

test("R3 public outcome surfaces require confirmation, consent, and the correct profile scope", () => {
  const routes = read("backend/r3-routes.js");

  // Showcase data needs a faculty confirmation and excludes an outcome when
  // any participant withholds consent or a participating faculty profile is
  // non-public. Profile visibility is then scoped to a student's own page.
  assert.match(routes, /WHERE oo\.faculty_confirmed_by IS NOT NULL/);
  assert.match(routes, /NOT EXISTS \([\s\S]*?blocked\.public_consent = FALSE/);
  assert.match(routes, /blocked_faculty\.public_profile = FALSE/);
  assert.match(routes, /app\.get\("\/api\/faculty\/:fixtureId\/outcomes"/);
  assert.match(routes, /app\.get\("\/api\/students\/:fixtureId\/outcomes"/);
  assert.match(routes, /!profile\.rows\[0\] \|\| !profile\.rows\[0\]\.public_profile/);
  assert.match(routes, /wanted\.profile_visible = TRUE/);
  assert.match(routes, /Only an outcome participant can set consent/);
  assert.match(routes, /Only a participating student can set their profile visibility/);
});

test("ordinary R2 opportunity discovery excludes non-open R3 lifecycle records", () => {
  const routes = read("backend/r2-routes.js");
  assert.match(routes, /o\.lifecycle_state = 'open'/);
  assert.match(routes, /r3_evaluation_settings/);
  assert.match(routes, /confirmed_match\.state = 'confirmed'/);
  assert.match(routes, /confirmed_match\.run_id = \(\s*SELECT current_run\.id/);
  assert.match(routes, /current_run\.is_current = TRUE/);
  assert.match(routes, /o\.r3_schedule_required = FALSE/);
  assert.match(routes, /r3_schedule_required\)\s*VALUES[\s\S]*?TRUE/);
});

test("R3 hides unsupervised lifecycle data and blocks unscheduled matches server-side", () => {
  const routes = read("backend/r3-routes.js");
  assert.match(routes, /opportunity\.status !== "supervised"/);
  assert.match(routes, /throw notFound\("Opportunity not found\."\)/);
  assert.match(routes, /!run\?\.target_term \|\| !run\?\.application_deadline/);
});

test("renewal keeps prior confirmed matches and their outcomes out of the new run", () => {
  const routes = read("backend/r3-routes.js");

  // Outcome authorization is scoped to the current match run, and the outcome
  // keeps that matched run—not a later renewal—as its historical parent.
  assert.match(routes, /SELECT mp\.id, mp\.run_id, mp\.faculty_id/);
  assert.match(routes, /mp\.run_id = \$3::integer/);
  assert.match(routes, /\[opportunity\.id, user\.id, run\?\.id \|\| null\]/);
  assert.match(routes, /\[opportunity\.id, match\.run_id, summary, completedOn/);
});

test("official R3 fixture encodes expected expiry, match, and showcase outcomes", () => {
  const fixture = JSON.parse(read("backend/r3_fixture/lifecycle_fixture.json"));
  const expected = JSON.parse(read("backend/r3_fixture/expected_lifecycle_results.json"));
  assert.equal(fixture.evaluation_date, "2026-11-06");
  assert.deepEqual(expected.expired_opportunity_ids, ["O-302", "O-304"]);
  assert.deepEqual(expected.fully_confirmed_match_ids, ["M-401", "M-404"]);
  assert.deepEqual(expected.showcase_eligible_outcome_ids, ["R-501"]);
  assert.equal(fixture.matches.find((item) => item.fixture_id === "M-402").confirmed_by.length, 1);
  assert.match(read("backend/seed-r3.js"), /evaluation_date = EXCLUDED\.evaluation_date/);
  assert.match(read("backend/verify-r3-fixture.js"), /showcase eligible outcomes/);
  assert.match(read("backend/verify-r3-fixture.js"), /ordinary discovery after fixture evaluation/);
});

test("official fixture covers the R3 boundary cases rather than only happy paths", () => {
  const fixture = JSON.parse(read("backend/r3_fixture/lifecycle_fixture.json"));
  const expected = JSON.parse(read("backend/r3_fixture/expected_lifecycle_results.json"));
  const opportunityById = new Map(fixture.opportunities.map((item) => [item.fixture_id, item]));
  const matchById = new Map(fixture.matches.map((item) => [item.fixture_id, item]));
  const outcomeById = new Map(fixture.outcomes.map((item) => [item.fixture_id, item]));

  // The fixed evaluation date—not today's date—must make a partially
  // confirmed match expire, while a fully confirmed one remains matched.
  assert.ok(opportunityById.get("O-302").deadline < fixture.evaluation_date);
  assert.ok(opportunityById.get("O-301").deadline < fixture.evaluation_date);
  assert.equal(matchById.get("M-401").confirmed_by.length, matchById.get("M-401").students.length);
  assert.equal(matchById.get("M-402").confirmed_by.length, 1);
  assert.ok(matchById.get("M-402").confirmed_by.length < matchById.get("M-402").students.length);
  assert.deepEqual(expected.expired_opportunity_ids, ["O-302", "O-304"]);
  assert.match(expected.past_deadline_but_not_expired["O-301"], /fully confirmed/i);

  // Explicit withdrawal, completion, and archive remain distinct lifecycle
  // records rather than being collapsed into expired. The outcome fixture also
  // proves both privacy gates: no faculty confirmation and a non-public faculty.
  assert.equal(opportunityById.get("O-305").state, "withdrawn");
  assert.equal(opportunityById.get("O-306").state, "completed");
  assert.equal(opportunityById.get("O-307").state, "archived");
  assert.equal(outcomeById.get("R-501").faculty_confirmed, true);
  assert.equal(outcomeById.get("R-502").faculty_confirmed, false);
  assert.equal(outcomeById.get("R-503").faculty, "F-MEI");
  assert.deepEqual(expected.participants_only_outcome_ids, ["R-502", "R-503"]);
});

test("the deployed R3 QA runner is explicit about controlled mutations and reset", () => {
  const runner = read("backend/verify-r3-api.js");
  assert.match(runner, /R3_QA_ALLOW_MUTATION/);
  assert.match(runner, /npm --prefix backend run seed:r3/);
  assert.match(runner, /unauthorized attempt rejected/);
  assert.match(runner, /renewals preserve identity\/outcomes/);
});
