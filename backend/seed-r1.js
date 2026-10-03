require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const fixturePath = path.join(__dirname, "r1_fixture.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Clear previous R1 fixture data so the script is repeatable.
    await client.query("DELETE FROM project_research_areas");
    await client.query("DELETE FROM projects");
    await client.query("DELETE FROM faculty_research_areas");
    await client.query("DELETE FROM faculty");
    await client.query("DELETE FROM research_areas");

    // -------------------------
    // Research areas
    // -------------------------
    const areaIds = {};

    for (const areaName of fixture.research_areas) {
      const result = await client.query(
        `INSERT INTO research_areas (name)
         VALUES ($1)
         RETURNING id`,
        [areaName]
      );

      areaIds[areaName] = result.rows[0].id;
    }

    // -------------------------
    // Faculty
    // -------------------------
    const facultyIds = {};

    for (const faculty of fixture.faculty) {
      const result = await client.query(
        `INSERT INTO faculty (
          fixture_id,
          display_name,
          public_profile,
          verified_faculty,
          inquiry_preference,
          bio,
          external_links
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
        [
          faculty.fixture_id,
          faculty.display_name,
          faculty.public_profile,
          faculty.verified_faculty,
          faculty.inquiry_preference,
          faculty.bio || "",
          faculty.external_links || [],
        ]
      );

      facultyIds[faculty.fixture_id] = result.rows[0].id;

      // Faculty ↔ research areas
      for (const areaName of faculty.areas || []) {
        await client.query(
          `INSERT INTO faculty_research_areas
            (faculty_id, research_area_id)
           VALUES ($1, $2)`,
          [facultyIds[faculty.fixture_id], areaIds[areaName]]
        );
      }
    }

    // -------------------------
    // Projects
    // -------------------------
    for (const project of fixture.projects) {
      const ownerId = facultyIds[project.owner];

      if (!ownerId) {
        throw new Error(
          `Could not find faculty owner for project ${project.fixture_id}: ${project.owner}`
        );
      }

      const result = await client.query(
        `INSERT INTO projects (
          fixture_id,
          owner_faculty_id,
          title,
          description,
          student_level,
          term,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
        [
          project.fixture_id,
          ownerId,
          project.title,
          project.description || "",
          project.student_level,
          project.term,
          project.status,
        ]
      );

      const projectId = result.rows[0].id;

      // Project ↔ research areas
      for (const areaName of project.areas || []) {
        await client.query(
          `INSERT INTO project_research_areas
            (project_id, research_area_id)
           VALUES ($1, $2)`,
          [projectId, areaIds[areaName]]
        );
      }
    }

    // -------------------------
    // Pending/unverified test user
    // -------------------------
    await client.query(
      `INSERT INTO users (
        email,
        is_verified_faculty,
        is_admin
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (email)
      DO UPDATE SET
        is_verified_faculty = EXCLUDED.is_verified_faculty,
        is_admin = EXCLUDED.is_admin`,
      [
        "taylor.pending@algomau.ca",
        false,
        false,
      ]
    );

    await client.query("COMMIT");

    console.log("R1 FIXTURE SEEDED SUCCESSFULLY");
    console.log(`Fixture version: ${fixture.fixture_version}`);
    console.log(`Research areas: ${fixture.research_areas.length}`);
    console.log(`Faculty: ${fixture.faculty.length}`);
    console.log(`Projects: ${fixture.projects.length}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("R1 SEED FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();