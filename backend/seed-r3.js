/* Seed the published Project 2 Release 3 lifecycle fixture.
 *
 * Run schema.sql, seed-r1.js and seed-r2.js before this script.  The R3
 * records intentionally use their official fixture identifiers (O-xxx,
 * M-xxx, R-xxx), so rerunning this script replaces only R3 fixture data.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const fixtureDir = path.join(__dirname, "r3_fixture");
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "lifecycle_fixture.json"), "utf8")
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const facultyAccountEmails = {
  "F-ALEX": "r3.alex@algomau.ca",
  "F-PRIYA": "r3.priya@algomau.ca",
  "F-JORDAN": "r3.jordan@algomau.ca",
  "F-MEI": "r3.mei@algomau.ca",
};

const studentFixtureIds = [...new Set([
  ...fixture.matches.flatMap((match) => match.students),
  ...fixture.outcomes.flatMap((outcome) => outcome.students),
])];

const expectedLifecycleStates = {
  "O-301": "matched",
  "O-302": "expired",
  "O-303": "open",
  "O-304": "expired",
  "O-305": "withdrawn",
  "O-306": "completed",
  "O-307": "archived",
};

const lifecycleReasons = {
  "O-302": "deadline 2026-10-20 passed with only a partly confirmed match",
  "O-304": "deadline 2026-09-30 passed and its only match was declined",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertR3Schema(client) {
  const result = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])`,
    [[
      "student_profiles",
      "opportunity_runs",
      "match_proposals",
      "match_participants",
      "opportunity_outcomes",
      "outcome_participants",
    ]]
  );
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = [
    "student_profiles",
    "opportunity_runs",
    "match_proposals",
    "match_participants",
    "opportunity_outcomes",
    "outcome_participants",
  ].filter((name) => !present.has(name));
  assert(missing.length === 0, `R3 schema is missing: ${missing.join(", ")}. Run schema.sql first.`);
}

async function getFacultyIds(client) {
  const result = await client.query(
    "SELECT id, fixture_id FROM faculty WHERE fixture_id = ANY($1::text[])",
    [Object.keys(facultyAccountEmails)]
  );
  const ids = new Map(result.rows.map((row) => [row.fixture_id, row.id]));
  for (const fixtureId of Object.keys(facultyAccountEmails)) {
    assert(ids.has(fixtureId), `Missing R1 faculty fixture ${fixtureId}. Run seed-r1.js first.`);
  }
  return ids;
}

async function seedStaffAndFacultyAccounts(client) {
  await client.query(
    `INSERT INTO users (email, is_verified_faculty, is_admin)
     VALUES ('r3.staff@algomau.ca', FALSE, TRUE)
     ON CONFLICT (email) DO UPDATE SET is_admin = TRUE
     RETURNING id`
  );

  // These are convenient local fixture accounts. Existing faculty links are
  // intentionally preserved, because real course accounts may already be linked.
  for (const [fixtureId, email] of Object.entries(facultyAccountEmails)) {
    const user = await client.query(
      `INSERT INTO users (email, is_verified_faculty, is_admin)
       VALUES ($1, TRUE, FALSE)
       ON CONFLICT (email)
       DO UPDATE SET is_verified_faculty = TRUE
       RETURNING id`,
      [email]
    );
    await client.query(
      `UPDATE faculty
          SET user_id = COALESCE(user_id, $1)
        WHERE fixture_id = $2`,
      [user.rows[0].id, fixtureId]
    );
  }
}

async function seedStudents(client) {
  const userIds = new Map();
  for (const fixtureId of studentFixtureIds) {
    const email = `r3.${fixtureId.toLowerCase()}@algomau.ca`;
    const user = await client.query(
      `INSERT INTO users (email, is_verified_faculty, is_admin)
       VALUES ($1, FALSE, FALSE)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [email]
    );
    const userId = user.rows[0].id;
    await client.query(
      `INSERT INTO student_profiles (user_id, fixture_id, display_name, public_profile)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (fixture_id)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     display_name = EXCLUDED.display_name,
                     public_profile = EXCLUDED.public_profile`,
      [userId, fixtureId, `R3 Student ${fixtureId}`]
    );
    userIds.set(fixtureId, userId);
  }
  return userIds;
}

async function clearR3Fixture(client) {
  const opportunityIds = fixture.opportunities.map((item) => item.fixture_id);
  // The R3 foreign keys cascade from an opportunity to its runs, matches, and
  // outcomes. This removes only official fixture records and leaves R1/R2 data.
  await client.query(
    "DELETE FROM industry_opportunities WHERE submission_id = ANY($1::text[])",
    [opportunityIds]
  );
}

async function seedOpportunities(client, facultyIds) {
  const opportunityIds = new Map();
  const runIds = new Map();

  for (const item of fixture.opportunities) {
    const ownerId = facultyIds.get(item.owner);
    const organisation = item.source === "industry" ? "R3 fixture partner" : "Faculty opportunity";
    const contactName = item.source === "industry" ? "R3 fixture contact" : "Faculty owner";
    const lifecycleState = expectedLifecycleStates[item.fixture_id];
    const lifecycleReason = lifecycleReasons[item.fixture_id] || "";
    const partnerAgreed = item.source === "industry";
    const inserted = await client.query(
      `INSERT INTO industry_opportunities
        (submission_id, organisation_name, contact_name, contact_email,
         title, description, capacity, status, source_type, target_term,
         application_deadline, lifecycle_state, lifecycle_reason,
         partner_agreed_in_principle)
       VALUES ($1, $2, $3, $4, $5, $6, 'one-team-only', 'supervised',
               $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        item.fixture_id,
        organisation,
        contactName,
        "r3-fixture@example.invalid",
        item.title,
        `Official R3 lifecycle fixture (${item.source}).`,
        item.source,
        item.term,
        item.deadline,
        lifecycleState,
        lifecycleReason,
        partnerAgreed,
      ]
    );
    const opportunityId = inserted.rows[0].id;
    opportunityIds.set(item.fixture_id, opportunityId);

    await client.query(
      `INSERT INTO industry_opportunity_supervisors (opportunity_id, faculty_id)
       VALUES ($1, $2)
       ON CONFLICT (opportunity_id, faculty_id) DO NOTHING`,
      [opportunityId, ownerId]
    );

    const run = await client.query(
      `INSERT INTO opportunity_runs
        (opportunity_id, run_number, target_term, application_deadline,
         lifecycle_state, lifecycle_reason, is_current)
       VALUES ($1, 1, $2, $3, $4, $5, TRUE)
       RETURNING id`,
      [opportunityId, item.term, item.deadline, lifecycleState, lifecycleReason]
    );
    runIds.set(item.fixture_id, run.rows[0].id);

    if (lifecycleState !== "open") {
      await client.query(
        `INSERT INTO opportunity_lifecycle_events
          (opportunity_id, run_id, from_state, to_state, reason)
         VALUES ($1, $2, 'open', $3, $4)`,
        [opportunityId, run.rows[0].id, lifecycleState, lifecycleReason]
      );
    }
  }

  return { opportunityIds, runIds };
}

async function seedMatches(client, facultyIds, studentUserIds, opportunityIds, runIds) {
  const matchIds = new Map();

  for (const match of fixture.matches) {
    const confirmedCount = match.confirmed_by.length;
    const derivedState = match.state === "declined"
      ? "declined"
      : confirmedCount === match.students.length
        ? "confirmed"
        : confirmedCount > 0
          ? "partly-confirmed"
          : "proposed";
    const proposal = await client.query(
      `INSERT INTO match_proposals
        (fixture_id, opportunity_id, run_id, faculty_id, state, partner_agreed_in_principle)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        match.fixture_id,
        opportunityIds.get(match.opportunity),
        runIds.get(match.opportunity),
        facultyIds.get(match.proposed_by),
        derivedState,
        fixture.opportunities.find((item) => item.fixture_id === match.opportunity).source === "industry",
      ]
    );
    const matchId = proposal.rows[0].id;
    matchIds.set(match.fixture_id, matchId);

    for (const studentFixtureId of match.students) {
      let responseState = "pending";
      if (match.confirmed_by.includes(studentFixtureId)) responseState = "confirmed";
      if (match.state === "declined") responseState = "declined";
      await client.query(
        `INSERT INTO match_participants (match_id, student_user_id, response_state)
         VALUES ($1, $2, $3)`,
        [matchId, studentUserIds.get(studentFixtureId), responseState]
      );
    }
  }

  return matchIds;
}

async function seedOutcomes(client, facultyIds, studentUserIds, opportunityIds, runIds) {
  for (const outcome of fixture.outcomes) {
    const facultyId = facultyIds.get(outcome.faculty);
    const inserted = await client.query(
      `INSERT INTO opportunity_outcomes
        (fixture_id, opportunity_id, run_id, summary, completed_on, links,
         created_by_user_id, faculty_confirmed_by, faculty_confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8,
               CASE WHEN $8 IS NULL THEN NULL ELSE now() END)
       RETURNING id`,
      [
        outcome.fixture_id,
        opportunityIds.get(outcome.opportunity),
        runIds.get(outcome.opportunity),
        outcome.summary,
        outcome.completed,
        JSON.stringify(outcome.links),
        studentUserIds.get(outcome.students[0]),
        outcome.faculty_confirmed ? facultyId : null,
      ]
    );
    const outcomeId = inserted.rows[0].id;

    await client.query(
      `INSERT INTO outcome_participants
        (outcome_id, participant_kind, faculty_id, student_user_id, public_consent, profile_visible)
       VALUES ($1, 'faculty', $2, NULL, TRUE, TRUE)`,
      [outcomeId, facultyId]
    );
    for (const studentFixtureId of outcome.students) {
      await client.query(
        `INSERT INTO outcome_participants
          (outcome_id, participant_kind, faculty_id, student_user_id, public_consent, profile_visible)
         VALUES ($1, 'student', NULL, $2, TRUE, TRUE)`,
        [outcomeId, studentUserIds.get(studentFixtureId)]
      );
    }
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertR3Schema(client);
    // The R3 fixture is evaluated against its published simulated clock, not
    // the day this seed command happens to run.
    await client.query(
      `INSERT INTO r3_evaluation_settings (singleton, evaluation_date, updated_at)
       VALUES (TRUE, $1, now())
       ON CONFLICT (singleton) DO UPDATE SET
         evaluation_date = EXCLUDED.evaluation_date,
         updated_at = now()`,
      [fixture.evaluation_date]
    );
    const facultyIds = await getFacultyIds(client);
    await seedStaffAndFacultyAccounts(client);
    const studentUserIds = await seedStudents(client);
    await clearR3Fixture(client);
    const { opportunityIds, runIds } = await seedOpportunities(client, facultyIds);
    await seedMatches(client, facultyIds, studentUserIds, opportunityIds, runIds);
    await seedOutcomes(client, facultyIds, studentUserIds, opportunityIds, runIds);
    await client.query("COMMIT");
    console.log(`R3 FIXTURE SEEDED SUCCESSFULLY (${fixture.fixture_version}).`);
    console.log(`Evaluation date: ${fixture.evaluation_date}`);
    console.log(`Opportunities: ${fixture.opportunities.map((item) => item.fixture_id).join(", ")}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("R3 SEED FAILED:", error.message);
  process.exitCode = 1;
});
