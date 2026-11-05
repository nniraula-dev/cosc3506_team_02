/* Apply the idempotent Project 2 schema to the configured PostgreSQL database.
 *
 * This is deliberately an explicit release operation rather than server-start
 * behavior: the deployed web process never performs an unexpected migration.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
    await client.query("BEGIN");
    await client.query(schema);
    await client.query("COMMIT");
    console.log("SCHEMA APPLY PASSED.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("SCHEMA APPLY FAILED:", error.message);
  process.exitCode = 1;
});
