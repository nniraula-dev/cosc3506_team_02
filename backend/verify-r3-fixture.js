/* Read-only verification of the official Project 2 Release 3 lifecycle fixture. */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const fixtureDir = path.join(__dirname, "r3_fixture");
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, "lifecycle_fixture.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, "expected_lifecycle_results.json"), "utf8"));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expectedValue, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expectedValue), `${label}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)}`);
}

async function main() {
  const client = await pool.connect();
  try {
    const opportunityFixtureIds = fixture.opportunities.map((item) => item.fixture_id);
    const opportunities = await client.query(
      `SELECT o.submission_id AS fixture_id, r.target_term, r.application_deadline::date::text AS deadline,
              r.lifecycle_state, r.is_current
         FROM industry_opportunities o
         JOIN opportunity_runs r ON r.opportunity_id = o.id
        WHERE o.submission_id = ANY($1::text[])
          AND r.is_current = TRUE
        ORDER BY o.submission_id`,
      [opportunityFixtureIds]
    );
    assert(opportunities.rows.length === opportunityFixtureIds.length, "R3 fixture opportunities or current runs are missing.");
    const stateByFixtureId = new Map(opportunities.rows.map((row) => [row.fixture_id, row.lifecycle_state]));
    const expectedStates = {
      "O-301": "matched",
      "O-302": "expired",
      "O-303": "open",
      "O-304": "expired",
      "O-305": "withdrawn",
      "O-306": "completed",
      "O-307": "archived",
    };
    for (const [fixtureId, lifecycleState] of Object.entries(expectedStates)) {
      assert(stateByFixtureId.get(fixtureId) === lifecycleState, `${fixtureId} must be ${lifecycleState}.`);
    }
    for (const row of opportunities.rows) {
      const source = fixture.opportunities.find((item) => item.fixture_id === row.fixture_id);
      assert(row.target_term === source.term, `${row.fixture_id} has the wrong target term.`);
      assert(row.deadline === source.deadline, `${row.fixture_id} has the wrong deadline.`);
    }

    const matches = await client.query(
      `SELECT m.fixture_id, m.state,
              array_agg(mp.response_state ORDER BY sp.fixture_id) AS responses
         FROM match_proposals m
         JOIN match_participants mp ON mp.match_id = m.id
         JOIN student_profiles sp ON sp.user_id = mp.student_user_id
        WHERE m.fixture_id = ANY($1::text[])
        GROUP BY m.fixture_id, m.state
        ORDER BY m.fixture_id`,
      [fixture.matches.map((item) => item.fixture_id)]
    );
    assert(matches.rows.length === fixture.matches.length, "R3 fixture matches are missing.");
    const matchByFixtureId = new Map(matches.rows.map((row) => [row.fixture_id, row]));
    assert(matchByFixtureId.get("M-401").state === "confirmed", "M-401 must be confirmed.");
    equal(matchByFixtureId.get("M-401").responses, ["confirmed", "confirmed"], "M-401 responses");
    assert(matchByFixtureId.get("M-402").state === "partly-confirmed", "M-402 must be partly confirmed until every student confirms.");
    equal(matchByFixtureId.get("M-402").responses, ["confirmed", "pending"], "M-402 responses");
    assert(matchByFixtureId.get("M-403").state === "declined", "M-403 must be declined.");
    assert(matchByFixtureId.get("M-404").state === "confirmed", "M-404 must be confirmed.");

    const outcomes = await client.query(
      `SELECT oo.fixture_id, oo.faculty_confirmed_by,
              f.public_profile AS faculty_public_profile
         FROM opportunity_outcomes oo
         JOIN outcome_participants op
           ON op.outcome_id = oo.id AND op.participant_kind = 'faculty'
         JOIN faculty f ON f.id = op.faculty_id
        WHERE oo.fixture_id = ANY($1::text[])
        ORDER BY oo.fixture_id`,
      [fixture.outcomes.map((item) => item.fixture_id)]
    );
    assert(outcomes.rows.length === fixture.outcomes.length, "R3 fixture outcomes are missing.");
    const outcomeByFixtureId = new Map(outcomes.rows.map((row) => [row.fixture_id, row]));
    assert(outcomeByFixtureId.get("R-501").faculty_confirmed_by, "R-501 must have faculty confirmation.");
    assert(!outcomeByFixtureId.get("R-502").faculty_confirmed_by, "R-502 must await faculty confirmation.");
    assert(outcomeByFixtureId.get("R-503").faculty_confirmed_by, "R-503 must have faculty confirmation.");
    assert(outcomeByFixtureId.get("R-503").faculty_public_profile === false, "R-503 faculty must not permit public profile display.");

    const consent = await client.query(
      `SELECT oo.fixture_id,
              bool_and(op.public_consent) AS all_participants_consented,
              bool_and(
                CASE
                  WHEN op.participant_kind = 'faculty' THEN f.public_profile
                  ELSE TRUE
                END
              ) AS every_participating_faculty_is_public
         FROM opportunity_outcomes oo
         JOIN outcome_participants op ON op.outcome_id = oo.id
         LEFT JOIN faculty f ON f.id = op.faculty_id
        WHERE oo.fixture_id = ANY($1::text[])
        GROUP BY oo.fixture_id
        ORDER BY oo.fixture_id`,
      [fixture.outcomes.map((item) => item.fixture_id)]
    );
    const consentByFixtureId = new Map(consent.rows.map((row) => [row.fixture_id, row]));
    assert(consentByFixtureId.get("R-501").all_participants_consented, "R-501 participants must all permit public display.");
    assert(consentByFixtureId.get("R-503").all_participants_consented, "R-503 proves that consent alone is not enough for showcase eligibility.");
    assert(consentByFixtureId.get("R-503").every_participating_faculty_is_public === false, "R-503 must retain its non-public-faculty privacy condition.");

    // Mirror the public showcase predicate rather than merely trusting the
    // persisted fixture flags. This verifies that R-501 is the only public
    // outcome once confirmation, every consent, and public faculty eligibility
    // are applied together.
    const showcase = await client.query(
      `SELECT oo.fixture_id
         FROM opportunity_outcomes oo
        WHERE oo.fixture_id = ANY($1::text[])
          AND oo.faculty_confirmed_by IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM outcome_participants blocked
              LEFT JOIN faculty blocked_faculty ON blocked_faculty.id = blocked.faculty_id
             WHERE blocked.outcome_id = oo.id
               AND (
                 blocked.public_consent = FALSE
                 OR (blocked.participant_kind = 'faculty' AND blocked_faculty.public_profile = FALSE)
               )
          )
        ORDER BY oo.fixture_id`,
      [fixture.outcomes.map((item) => item.fixture_id)]
    );
    equal(showcase.rows.map((row) => row.fixture_id), expected.showcase_eligible_outcome_ids, "showcase eligible outcomes");

    // Mirror ordinary R3 discovery as a fixture-level proof that only O-303
    // remains available at the published simulated clock. Historical matches
    // must not block a later renewal, but current-run matches must.
    const discovery = await client.query(
      `SELECT o.submission_id AS fixture_id
         FROM industry_opportunities o
        WHERE o.submission_id = ANY($1::text[])
          AND o.status = 'supervised'
          AND o.lifecycle_state = 'open'
          AND (
            o.r3_schedule_required = FALSE
            OR (o.target_term IS NOT NULL AND o.application_deadline IS NOT NULL)
          )
          AND NOT EXISTS (
            SELECT 1
              FROM match_proposals confirmed_match
             WHERE confirmed_match.opportunity_id = o.id
               AND confirmed_match.state = 'confirmed'
               AND (
                 confirmed_match.run_id = (
                   SELECT current_run.id
                     FROM opportunity_runs current_run
                    WHERE current_run.opportunity_id = o.id
                      AND current_run.is_current = TRUE
                 )
                 OR (
                   confirmed_match.run_id IS NULL
                   AND NOT EXISTS (
                     SELECT 1
                       FROM opportunity_runs current_run
                      WHERE current_run.opportunity_id = o.id
                        AND current_run.is_current = TRUE
                   )
                 )
               )
          )
          AND (
            o.expiry_exception = TRUE
            OR o.application_deadline IS NULL
            OR o.application_deadline >= (
              SELECT evaluation_date FROM r3_evaluation_settings WHERE singleton = TRUE
            )
          )
        ORDER BY o.submission_id`,
      [opportunityFixtureIds]
    );
    equal(discovery.rows.map((row) => row.fixture_id), expected.still_open_opportunity_ids, "ordinary discovery after fixture evaluation");

    console.log(`R3 FIXTURE VERIFICATION PASSED (${fixture.fixture_version}; evaluated at ${expected.evaluated_at}).`);
    console.log(`Expired: ${expected.expired_opportunity_ids.join(", ")}; discovery: ${expected.still_open_opportunity_ids.join(", ")}; showcase eligible: ${expected.showcase_eligible_outcome_ids.join(", ")}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("R3 FIXTURE VERIFICATION FAILED:", error.message);
  process.exitCode = 1;
});
