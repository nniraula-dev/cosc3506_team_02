/* Read-only verification for the published Project 2 Release 2 fixture bundle. */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const fixtureDir = path.join(__dirname, "r2_fixture");
const intake = JSON.parse(fs.readFileSync(path.join(fixtureDir, "intake_submissions.json"), "utf8"));
const outcomes = JSON.parse(fs.readFileSync(path.join(fixtureDir, "expected_intake_outcomes.json"), "utf8"));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const expectedById = new Map(intake.map((item) => [item.fixture_id, item]));
  const accepted = outcomes.accepted_submission_ids;
  const client = await pool.connect();
  try {
    const opportunities = await client.query(
      `SELECT o.id, o.submission_id, o.capacity, o.status,
              array_agg(ra.name ORDER BY ra.name) FILTER (WHERE ra.name IS NOT NULL) AS areas
       FROM industry_opportunities o
       LEFT JOIN industry_opportunity_areas oa ON oa.opportunity_id = o.id
       LEFT JOIN research_areas ra ON ra.id = oa.research_area_id
       WHERE o.submission_id = ANY($1::text[])
       GROUP BY o.id
       ORDER BY o.submission_id`,
      [accepted]
    );
    assert(opportunities.rows.length === accepted.length, "Accepted fixture submissions are missing or duplicated.");
    for (const row of opportunities.rows) {
      const source = expectedById.get(row.submission_id);
      assert(source, `Unexpected fixture submission ${row.submission_id}.`);
      assert(row.status === "awaiting-supervisor", `${row.submission_id} must remain pending.`);
      assert(row.capacity === source.capacity, `${row.submission_id} has the wrong capacity.`);
      assert(JSON.stringify(row.areas) === JSON.stringify([...source.areas].sort()), `${row.submission_id} has the wrong areas.`);
    }

    const rejected = await client.query(
      "SELECT submission_id FROM industry_opportunities WHERE submission_id = ANY($1::text[])",
      [outcomes.rejected_submission_ids]
    );
    assert(rejected.rows.length === 0, "Rejected fixture submission S-204 was stored.");

    const notifications = await client.query(
      `SELECT o.submission_id, array_agg(f.fixture_id ORDER BY f.fixture_id) AS faculty_ids
       FROM faculty_notifications n
       JOIN industry_opportunities o ON o.id = n.opportunity_id
       JOIN faculty f ON f.id = n.faculty_id
       WHERE o.submission_id = ANY($1::text[])
       GROUP BY o.submission_id
       ORDER BY o.submission_id`,
      [accepted]
    );
    const notificationMap = new Map(notifications.rows.map((row) => [row.submission_id, row.faculty_ids]));
    for (const submissionId of accepted) {
      const actual = notificationMap.get(submissionId) || [];
      const expected = [...(outcomes.notified_faculty_by_submission[submissionId] || [])].sort();
      assert(JSON.stringify(actual) === JSON.stringify(expected), `${submissionId} notification recipients differ from the official fixture.`);
    }

    const neverNotified = await client.query(
      `SELECT DISTINCT f.fixture_id
       FROM faculty_notifications n
       JOIN industry_opportunities o ON o.id = n.opportunity_id
       JOIN faculty f ON f.id = n.faculty_id
       WHERE o.submission_id = ANY($1::text[]) AND f.fixture_id = ANY($2::text[])`,
      [accepted, outcomes.never_notified_faculty_ids]
    );
    assert(neverNotified.rows.length === 0, "A faculty member marked never-notified received an R2 fixture notification.");

    console.log(`R2 FIXTURE VERIFICATION PASSED: ${accepted.join(", ")}; ${outcomes.rejected_submission_ids.join(", ")} rejected.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("R2 FIXTURE VERIFICATION FAILED:", error.message);
  process.exitCode = 1;
});
