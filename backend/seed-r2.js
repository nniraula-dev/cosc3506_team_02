require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});
const fixtureDir = path.join(__dirname, "r2_fixture");
const intake = JSON.parse(fs.readFileSync(path.join(fixtureDir, "intake_submissions.json"), "utf8"));
const subscriptions = JSON.parse(fs.readFileSync(path.join(fixtureDir, "faculty_subscriptions.json"), "utf8")).subscriptions;
const outcomes = JSON.parse(fs.readFileSync(path.join(fixtureDir, "expected_intake_outcomes.json"), "utf8"));

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const facultyByFixture = new Map((await client.query("SELECT id, fixture_id FROM faculty")).rows.map((row) => [row.fixture_id, row.id]));
    const areaByName = new Map((await client.query("SELECT id, name FROM research_areas")).rows.map((row) => [row.name, row.id]));

    for (const subscription of subscriptions) {
      const facultyId = facultyByFixture.get(subscription.faculty_id);
      if (!facultyId) throw new Error(`Missing R1 faculty fixture ${subscription.faculty_id}`);
      await client.query(
        `INSERT INTO faculty_opportunity_subscriptions (faculty_id, subscribe_all)
         VALUES ($1, $2) ON CONFLICT (faculty_id)
         DO UPDATE SET subscribe_all = EXCLUDED.subscribe_all, updated_at = now()`,
        [facultyId, subscription.mode === "all"]
      );
      await client.query("DELETE FROM faculty_opportunity_subscription_areas WHERE faculty_id = $1", [facultyId]);
      for (const name of subscription.areas) {
        const areaId = areaByName.get(name);
        if (!areaId) throw new Error(`Missing R1 area ${name}`);
        await client.query("INSERT INTO faculty_opportunity_subscription_areas (faculty_id, research_area_id) VALUES ($1, $2)", [facultyId, areaId]);
      }
    }

    await client.query("DELETE FROM industry_opportunities WHERE submission_id = ANY($1::text[])", [outcomes.accepted_submission_ids]);
    for (const item of intake) {
      if (!outcomes.accepted_submission_ids.includes(item.fixture_id)) continue;
      const inserted = await client.query(
        `INSERT INTO industry_opportunities
          (submission_id, organisation_name, contact_name, contact_email, title, description, capacity)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [item.fixture_id, item.organisation, item.contact_name, item.contact_email, item.title, item.description, item.capacity]
      );
      for (const name of item.areas) {
        const areaId = areaByName.get(name);
        if (!areaId) throw new Error(`Missing R1 area ${name}`);
        await client.query("INSERT INTO industry_opportunity_areas (opportunity_id, research_area_id) VALUES ($1, $2)", [inserted.rows[0].id, areaId]);
      }
      const notified = outcomes.notified_faculty_by_submission[item.fixture_id] || [];
      for (const fixtureId of notified) {
        await client.query(
          `INSERT INTO faculty_notifications (faculty_id, opportunity_id, message)
           VALUES ($1, $2, $3)`,
          [facultyByFixture.get(fixtureId), inserted.rows[0].id, `New industry opportunity: ${item.title}`]
        );
      }
    }
    await client.query("COMMIT");
    console.log("R2 FIXTURE SEEDED SUCCESSFULLY");
    console.log(`Accepted: ${outcomes.accepted_submission_ids.join(", ")}`);
    console.log(`Rejected by validation: ${outcomes.rejected_submission_ids.join(", ")}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error("R2 SEED FAILED:", error.message); process.exitCode = 1; });
