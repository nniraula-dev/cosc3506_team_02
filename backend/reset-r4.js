/* Reset only synthetic R4 external-source rows in a disposable QA database.
 *
 * This is intentionally guarded: it deletes R4 fixture state so v1/v2 can be
 * evaluated from a known baseline.  It must never be used against shared
 * production data.
 */
require("dotenv").config();

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (process.env.R4_QA_ALLOW_RESET !== "yes") {
  throw new Error("R4 reset deletes synthetic external fixture data. Re-run with R4_QA_ALLOW_RESET=yes in a disposable database.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM r4_external_sync_runs
       WHERE source_id IN (SELECT id FROM external_sources WHERE source_key = 'mitacs-demo')`
    );
    await client.query(
      `DELETE FROM external_opportunities
       WHERE source_id IN (SELECT id FROM external_sources WHERE source_key = 'mitacs-demo')`
    );
    const opportunities = await client.query(
      "DELETE FROM industry_opportunities WHERE submission_id LIKE 'external:mitacs-demo:%'"
    );
    await client.query("DELETE FROM external_sources WHERE source_key = 'mitacs-demo'");
    await client.query("COMMIT");
    console.log(`R4 synthetic fixture reset complete (${opportunities.rowCount} external opportunities removed).`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
