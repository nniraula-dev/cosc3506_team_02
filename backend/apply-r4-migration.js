/*
 * Apply the additive Release 4 schema migration to the configured database.
 *
 * This is deliberately separate from the historical full-schema bootstrap:
 * it only adds the R4 external-source tables and broadens the source-type
 * constraint, so it is safe for an existing R1–R3 deployment.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const migration = fs.readFileSync(
      path.join(__dirname, "..", "r4_migration.sql"),
      "utf8"
    );

    await client.query("BEGIN");
    await client.query(migration);
    await client.query("COMMIT");
    console.log("R4 MIGRATION APPLIED.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("R4 MIGRATION FAILED:", error.message);
  process.exitCode = 1;
});
