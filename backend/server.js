require("dotenv").config();

const crypto = require("crypto");
const cors = require("cors");
const express = require("express");
const { Pool } = require("pg");
const registerR1ManagementRoutes = require("./r1-management-routes");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const app = express();

app.use(cors());
app.use(express.json());

const isLocalDatabase = process.env.DATABASE_URL.includes("localhost");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});

const ALGOMA_DOMAIN = "algomau.ca";
const CHALLENGE_MINUTES = 10;
const SESSION_HOURS = 8;

/*
 * Authentication
 *
 * R1 test-mode authentication:
 * - Only @algomau.ca addresses are accepted.
 * - Challenge expires after 10 minutes.
 * - Challenge can only be used once.
 * - Successful verification creates a server-side session.
 *
 * In test mode the challenge code is returned by the API so
 * evaluators can test without external email delivery.
 */

function isAlgomaEmail(email) {
  if (typeof email !== "string") return false;

  const normalized = email.trim().toLowerCase();

  return (
    normalized.endsWith(`@${ALGOMA_DOMAIN}`) &&
    normalized.length > ALGOMA_DOMAIN.length + 1
  );
}

function createChallengeCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function getAuthenticatedUser(request) {
  const authorization = request.get("authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return null;
  }

  const result = await pool.query(
    `
    SELECT
      u.id,
      u.email,
      u.is_verified_faculty,
      u.is_admin
    FROM auth_sessions s
    JOIN users u
      ON u.id = s.user_id
    WHERE s.token = $1
      AND s.expires_at > now()
    `,
    [token]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

async function isAuthenticated(request) {
  const user = await getAuthenticatedUser(request);
  return user !== null;
}

/*
 * Authentication: request challenge
 */
app.post("/api/auth/request", async (request, response, next) => {
  try {
    const email =
      typeof request.body.email === "string"
        ? request.body.email.trim().toLowerCase()
        : "";

    if (!isAlgomaEmail(email)) {
      return response.status(400).json({
        error: "Use an approved Algoma University email address.",
      });
    }

    const challengeCode = createChallengeCode();

    await pool.query(
      `
      UPDATE auth_challenges
      SET used_at = now()
      WHERE email = $1
        AND used_at IS NULL
        AND expires_at > now()
      `,
      [email]
    );

    await pool.query(
      `
      INSERT INTO auth_challenges
        (email, challenge_code, expires_at)
      VALUES
        ($1, $2, now() + ($3 * INTERVAL '1 minute'))
      `,
      [email, challengeCode, CHALLENGE_MINUTES]
    );

    /*
     * Instructor-approved test mode can use the returned code when
     * external email delivery is unavailable.
     */
    response.json({
      ok: true,
      message: "Challenge created.",
      expires_in_minutes: CHALLENGE_MINUTES,
      test_mode: true,
      challenge_code: challengeCode,
    });
  } catch (error) {
    next(error);
  }
});

/*
 * Authentication: verify challenge
 */
app.post("/api/auth/verify", async (request, response, next) => {
  const client = await pool.connect();

  try {
    const email =
      typeof request.body.email === "string"
        ? request.body.email.trim().toLowerCase()
        : "";

    const code =
      typeof request.body.challenge_code === "string"
        ? request.body.challenge_code.trim()
        : "";

    if (!isAlgomaEmail(email)) {
      return response.status(400).json({
        error: "Use an approved Algoma University email address.",
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return response.status(400).json({
        error: "Challenge code must be 6 digits.",
      });
    }

    await client.query("BEGIN");

    const challengeResult = await client.query(
      `
      SELECT
        id,
        email,
        challenge_code,
        expires_at
      FROM auth_challenges
      WHERE email = $1
        AND challenge_code = $2
        AND used_at IS NULL
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [email, code]
    );

    if (challengeResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return response.status(401).json({
        error: "Invalid, expired, or already-used challenge.",
      });
    }

    const challenge = challengeResult.rows[0];

    await client.query(
      `
      UPDATE auth_challenges
      SET used_at = now()
      WHERE id = $1
      `,
      [challenge.id]
    );

    const userResult = await client.query(
      `
      SELECT
        id,
        email,
        is_verified_faculty,
        is_admin
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    let user;

    if (userResult.rows.length === 0) {
      const insertResult = await client.query(
        `
        INSERT INTO users
          (email, is_verified_faculty, is_admin)
        VALUES
          ($1, false, false)
        RETURNING
          id,
          email,
          is_verified_faculty,
          is_admin
        `,
        [email]
      );

      user = insertResult.rows[0];
    } else {
      user = userResult.rows[0];
    }

    const sessionToken = createSessionToken();

    await client.query(
      `
      INSERT INTO auth_sessions
        (user_id, token, expires_at)
      VALUES
        ($1, $2, now() + ($3 * INTERVAL '1 hour'))
      `,
      [user.id, sessionToken, SESSION_HOURS]
    );

    await client.query("COMMIT");

    response.json({
      ok: true,
      token: sessionToken,
      expires_in_hours: SESSION_HOURS,
      user: {
        id: user.id,
        email: user.email,
        is_verified_faculty: user.is_verified_faculty,
        is_admin: user.is_admin,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

/*
 * Current authenticated user
 */
app.get("/api/me", async (request, response, next) => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return response.status(401).json({
        error: "Authentication required.",
      });
    }

    const facultyResult = await pool.query(
      `
      SELECT
        fixture_id,
        display_name,
        public_profile,
        verified_faculty,
        inquiry_preference,
        bio
      FROM faculty
      WHERE user_id = $1
      `,
      [user.id]
    );

    response.json({
      user,
      faculty: facultyResult.rows[0] || null,
    });
  } catch (error) {
    next(error);
  }
});

/*
 * Health
 */
app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");

    response.json({
      ok: true,
      database: "reachable",
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    response.status(503).json({
      ok: false,
      error: "database unavailable",
    });
  }
});

/*
 * Faculty discovery
 *
 * Public:
 *   Only verified faculty who chose public profile.
 *
 * Authenticated:
 *   Verified faculty profiles including authenticated-only profiles.
 *
 * Optional filter:
 *   ?area=Artificial%20Intelligence
 */
app.get("/api/faculty", async (request, response, next) => {
  try {
    const authenticated = await isAuthenticated(request);
    const area = request.query.area;

    const conditions = [
      "f.verified_faculty = TRUE",
    ];

    const values = [];

    if (!authenticated) {
      conditions.push("f.public_profile = TRUE");
    }

    if (area) {
      values.push(area);

      conditions.push(`
        EXISTS (
          SELECT 1
          FROM faculty_research_areas fra_filter
          JOIN research_areas ra_filter
            ON ra_filter.id = fra_filter.research_area_id
          WHERE fra_filter.faculty_id = f.id
            AND ra_filter.name = $${values.length}
        )
      `);
    }

    const result = await pool.query(
      `
      SELECT
        f.fixture_id,
        f.display_name,
        f.bio,
        f.inquiry_preference,
        f.public_profile,
        COALESCE(
          ARRAY_AGG(DISTINCT ra.name)
          FILTER (WHERE ra.name IS NOT NULL),
          '{}'
        ) AS areas
      FROM faculty f
      LEFT JOIN faculty_research_areas fra
        ON fra.faculty_id = f.id
      LEFT JOIN research_areas ra
        ON ra.id = fra.research_area_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY
        f.id,
        f.fixture_id,
        f.display_name,
        f.bio,
        f.inquiry_preference,
        f.public_profile
      ORDER BY f.display_name
      `,
      values
    );

    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

/*
 * Single faculty profile
 */
app.get("/api/faculty/:fixtureId", async (request, response, next) => {
  try {
    const authenticated = await isAuthenticated(request);

    const result = await pool.query(
      `
      SELECT
        f.fixture_id,
        f.display_name,
        f.bio,
        f.inquiry_preference,
        f.public_profile,
        COALESCE(
          ARRAY_AGG(DISTINCT ra.name)
          FILTER (WHERE ra.name IS NOT NULL),
          '{}'
        ) AS areas
      FROM faculty f
      LEFT JOIN faculty_research_areas fra
        ON fra.faculty_id = f.id
      LEFT JOIN research_areas ra
        ON ra.id = fra.research_area_id
      WHERE f.fixture_id = $1
        AND f.verified_faculty = TRUE
        AND ($2 = TRUE OR f.public_profile = TRUE)
      GROUP BY
        f.id,
        f.fixture_id,
        f.display_name,
        f.bio,
        f.inquiry_preference,
        f.public_profile
      `,
      [request.params.fixtureId, authenticated]
    );

    if (result.rows.length === 0) {
      return response.status(404).json({
        error: "Faculty profile not found",
      });
    }

    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

/*
 * Project discovery
 */
app.get("/api/projects", async (request, response, next) => {
  try {
    const authenticated = await isAuthenticated(request);

    const conditions = [
      "p.status = 'published'",
      "f.verified_faculty = TRUE",
    ];

    const values = [];

    if (!authenticated) {
      conditions.push("f.public_profile = TRUE");
    }

    if (request.query.area) {
      values.push(request.query.area);

      conditions.push(`
        EXISTS (
          SELECT 1
          FROM project_research_areas pra_filter
          JOIN research_areas ra_filter
            ON ra_filter.id = pra_filter.research_area_id
          WHERE pra_filter.project_id = p.id
            AND ra_filter.name = $${values.length}
        )
      `);
    }

    if (request.query.student_level) {
      values.push(request.query.student_level);
      conditions.push(`p.student_level = $${values.length}`);
    }

    if (request.query.term) {
      values.push(request.query.term);
      conditions.push(`p.term = $${values.length}`);
    }

    const result = await pool.query(
      `
      SELECT
        p.fixture_id,
        p.title,
        p.description,
        p.student_level,
        p.term,
        p.status,
        f.fixture_id AS faculty_fixture_id,
        f.display_name AS faculty_name,
        f.inquiry_preference,
        COALESCE(
          ARRAY_AGG(DISTINCT ra.name)
          FILTER (WHERE ra.name IS NOT NULL),
          '{}'
        ) AS areas
      FROM projects p
      JOIN faculty f
        ON f.id = p.owner_faculty_id
      LEFT JOIN project_research_areas pra
        ON pra.project_id = p.id
      LEFT JOIN research_areas ra
        ON ra.id = pra.research_area_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY
        p.id,
        p.fixture_id,
        p.title,
        p.description,
        p.student_level,
        p.term,
        p.status,
        f.fixture_id,
        f.display_name,
        f.inquiry_preference
      ORDER BY p.title
      `,
      values
    );

    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

/*
 * Single project
 */
app.get("/api/projects/:fixtureId", async (request, response, next) => {
  try {
    const authenticated = await isAuthenticated(request);

    const result = await pool.query(
      `
      SELECT
        p.fixture_id,
        p.title,
        p.description,
        p.student_level,
        p.term,
        p.status,
       f.fixture_id AS faculty_fixture_id,
f.display_name AS faculty_name,
u.email AS faculty_email,
f.bio AS faculty_bio,
f.inquiry_preference,
        f.public_profile,
        COALESCE(
          ARRAY_AGG(DISTINCT ra.name)
          FILTER (WHERE ra.name IS NOT NULL),
          '{}'
        ) AS areas
      FROM projects p
     JOIN faculty f
  ON f.id = p.owner_faculty_id
LEFT JOIN users u
  ON u.id = f.user_id
LEFT JOIN project_research_areas pra
        ON pra.project_id = p.id
      LEFT JOIN research_areas ra
        ON ra.id = pra.research_area_id
      WHERE p.fixture_id = $1
        AND p.status = 'published'
        AND f.verified_faculty = TRUE
        AND ($2 = TRUE OR f.public_profile = TRUE)
      GROUP BY
        p.id,
        p.fixture_id,
        p.title,
        p.description,
        p.student_level,
        p.term,
        p.status,
        f.fixture_id,
        f.display_name,
        u.email,

        f.bio,
        f.inquiry_preference,
        f.public_profile
      `,
      [request.params.fixtureId, authenticated]
    );

    if (result.rows.length === 0) {
      return response.status(404).json({
        error: "Project not found",
      });
    }

    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

/*
 * R1 faculty/project management routes
 */

async function requireR1User(request, response) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    response.status(401).json({
      error: "Authentication required.",
    });
    return null;
  }

  return user;
}

async function getOwnedFaculty(userId) {
  const result = await pool.query(
    `
    SELECT
      id,
      fixture_id,
      display_name,
      bio,
      public_profile,
      verified_faculty,
      inquiry_preference,
      external_links
    FROM faculty
    WHERE user_id = $1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

/*
 * Faculty owner: update profile
 */
app.patch("/api/faculty/me", async (request, response) => {
  try {
    const user = await requireR1User(request, response);
    if (!user) return;

    const faculty = await getOwnedFaculty(user.id);

    if (!faculty) {
      return response.status(404).json({
        error: "No faculty profile is associated with this account.",
      });
    }

    if (!faculty.verified_faculty) {
      return response.status(403).json({
        error: "Faculty verification is required before managing a profile.",
      });
    }

    const {
      display_name,
      bio,
      public_profile,
      inquiry_preference,
      external_links,
    } = request.body;

    if (
      inquiry_preference !== undefined &&
      !["general", "listed-projects-only", "none"].includes(
        inquiry_preference
      )
    ) {
      return response.status(400).json({
        error: "Invalid inquiry preference.",
      });
    }

    const result = await pool.query(
      `
      UPDATE faculty
      SET
        display_name = COALESCE($1, display_name),
        bio = COALESCE($2, bio),
        public_profile = COALESCE($3, public_profile),
        inquiry_preference = COALESCE($4, inquiry_preference),
        external_links = COALESCE($5, external_links),
        updated_at = now()
      WHERE id = $6
      RETURNING
        fixture_id,
        display_name,
        bio,
        public_profile,
        verified_faculty,
        inquiry_preference,
        external_links
      `,
      [
        display_name ?? null,
        bio ?? null,
        public_profile ?? null,
        inquiry_preference ?? null,
        external_links ?? null,
        faculty.id,
      ]
    );

    response.json(result.rows[0]);
  } catch (error) {
    console.error("Faculty update error:", error.message);
    response.status(500).json({
      error: "Unable to update faculty profile.",
    });
  }
});

/*
 * Faculty owner: create project draft
 */
app.post("/api/projects", async (request, response) => {
  const client = await pool.connect();

  try {
    const user = await requireR1User(request, response);
    if (!user) {
      return;
    }

    const faculty = await getOwnedFaculty(user.id);

    if (!faculty) {
      return response.status(404).json({
        error: "No faculty profile is associated with this account.",
      });
    }

    if (!faculty.verified_faculty) {
      return response.status(403).json({
        error: "Verified faculty is required to create projects.",
      });
    }

    const {
      title,
      description = "",
      student_level,
      term,
      prerequisite = "",
      areas = [],
    } = request.body;

    if (!title || !student_level || !term) {
      client.release();
      return response.status(400).json({
        error: "title, student_level, and term are required.",
      });
    }

    if (!Array.isArray(areas)) {
      return response.status(400).json({
        error: "areas must be an array.",
      });
    }

    await client.query("BEGIN");

    const fixtureId = `R1-${crypto.randomBytes(6).toString("hex")}`;

    const projectResult = await client.query(
      `
      INSERT INTO projects
        (
          fixture_id,
          owner_faculty_id,
          title,
          description,
          student_level,
          term,
          prerequisite,
          status
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'draft')
      RETURNING
        id,
        fixture_id,
        title,
        description,
        student_level,
        term,
        prerequisite,
        status
      `,
      [
        fixtureId,
        faculty.id,
        title,
        description,
        student_level,
        term,
        prerequisite,
      ]
    );

    const project = projectResult.rows[0];

    for (const area of areas) {
      const areaResult = await client.query(
        `
        SELECT id
        FROM research_areas
        WHERE name = $1
        `,
        [area]
      );

      if (areaResult.rows.length === 0) {
        throw new Error(`Unknown research area: ${area}`);
      }

      await client.query(
        `
        INSERT INTO project_research_areas
          (project_id, research_area_id)
        VALUES
          ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [project.id, areaResult.rows[0].id]
      );
    }

    await client.query("COMMIT");

    response.status(201).json(project);
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Project creation error:", error.message);

    response.status(500).json({
      error: error.message,
    });
  } finally {
    client.release();
  }
});

/*
 * Faculty owner: update project
 */
app.patch("/api/projects/:fixtureId/manage", async (request, response) => {
  try {
    const user = await requireR1User(request, response);
    if (!user) return;

    const faculty = await getOwnedFaculty(user.id);

    if (!faculty || !faculty.verified_faculty) {
      return response.status(403).json({
        error: "Verified faculty ownership is required.",
      });
    }

    const projectResult = await pool.query(
      `
      SELECT
        id,
        owner_faculty_id,
        status
      FROM projects
      WHERE fixture_id = $1
      `,
      [request.params.fixtureId]
    );

    if (projectResult.rows.length === 0) {
      return response.status(404).json({
        error: "Project not found.",
      });
    }

    const project = projectResult.rows[0];

    if (project.owner_faculty_id !== faculty.id) {
      return response.status(403).json({
        error: "You do not own this project.",
      });
    }

    const {
      title,
      description,
      student_level,
      term,
      prerequisite,
      status,
    } = request.body;

    if (
      status !== undefined &&
      !["draft", "published", "withdrawn", "closed"].includes(status)
    ) {
      return response.status(400).json({
        error: "Invalid project status.",
      });
    }

    const result = await pool.query(
      `
      UPDATE projects
      SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        student_level = COALESCE($3, student_level),
        term = COALESCE($4, term),
        prerequisite = COALESCE($5, prerequisite),
        status = COALESCE($6, status),
        updated_at = now()
      WHERE id = $7
      RETURNING
        fixture_id,
        title,
        description,
        student_level,
        term,
        prerequisite,
        status
      `,
      [
        title ?? null,
        description ?? null,
        student_level ?? null,
        term ?? null,
        prerequisite ?? null,
        status ?? null,
        project.id,
      ]
    );

    response.json(result.rows[0]);
  } catch (error) {
    console.error("Project update error:", error.message);

    response.status(500).json({
      error: "Unable to update project.",
    });
  }
});

/*
 * Faculty owner: update project research areas
 */
app.put("/api/projects/:fixtureId/manage/areas", async (request, response) => {
  const client = await pool.connect();

  try {
    const user = await requireR1User(request, response);
    if (!user) {
      return;
    }

    const faculty = await getOwnedFaculty(user.id);

    if (!faculty || !faculty.verified_faculty) {
      return response.status(403).json({
        error: "Verified faculty ownership is required.",
      });
    }

    const projectResult = await client.query(
      `
      SELECT id, owner_faculty_id
      FROM projects
      WHERE fixture_id = $1
      `,
      [request.params.fixtureId]
    );

    if (projectResult.rows.length === 0) {
      return response.status(404).json({
        error: "Project not found.",
      });
    }

    const project = projectResult.rows[0];

    if (project.owner_faculty_id !== faculty.id) {
      return response.status(403).json({
        error: "You do not own this project.",
      });
    }

    const areas = request.body.areas;

    if (!Array.isArray(areas)) {
      return response.status(400).json({
        error: "areas must be an array.",
      });
    }

    await client.query("BEGIN");

    await client.query(
      `
      DELETE FROM project_research_areas
      WHERE project_id = $1
      `,
      [project.id]
    );

    for (const area of areas) {
      const areaResult = await client.query(
        `
        SELECT id
        FROM research_areas
        WHERE name = $1
        `,
        [area]
      );

      if (areaResult.rows.length === 0) {
        throw new Error(`Unknown research area: ${area}`);
      }

      await client.query(
        `
        INSERT INTO project_research_areas
          (project_id, research_area_id)
        VALUES
          ($1, $2)
        `,
        [project.id, areaResult.rows[0].id]
      );
    }

    await client.query("COMMIT");

    response.json({
      ok: true,
      areas,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Project area update error:", error.message);

    response.status(500).json({
      error: error.message,
    });
  } finally {
    client.release();
  }
});

/*
 * Faculty owner: list own projects, including drafts
 */
app.get("/api/projects/mine", async (request, response) => {
  try {
    const user = await requireR1User(request, response);
    if (!user) return;

    const faculty = await getOwnedFaculty(user.id);

    if (!faculty) {
      return response.status(404).json({
        error: "No faculty profile is associated with this account.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        p.fixture_id,
        p.title,
        p.description,
        p.student_level,
        p.term,
        p.prerequisite,
        p.status,
        COALESCE(
          ARRAY_AGG(DISTINCT ra.name)
          FILTER (WHERE ra.name IS NOT NULL),
          '{}'
        ) AS areas
      FROM projects p
      LEFT JOIN project_research_areas pra
        ON pra.project_id = p.id
      LEFT JOIN research_areas ra
        ON ra.id = pra.research_area_id
      WHERE p.owner_faculty_id = $1
      GROUP BY
        p.id,
        p.fixture_id,
        p.title,
        p.description,
        p.student_level,
        p.term,
        p.prerequisite,
        p.status
      ORDER BY p.updated_at DESC
      `,
      [faculty.id]
    );

    response.json(result.rows);
  } catch (error) {
    console.error("My projects error:", error.message);

    response.status(500).json({
      error: "Unable to load your projects.",
    });
  }
});

/*
 * Staff/admin: verify faculty
 */
app.patch("/api/staff/faculty/:fixtureId/verify", async (request, response) => {
  try {
    const user = await requireR1User(request, response);
    if (!user) return;

    if (!user.is_admin) {
      return response.status(403).json({
        error: "Staff/admin authorization required.",
      });
    }

    const result = await pool.query(
      `
      UPDATE faculty
      SET
        verified_faculty = TRUE,
        updated_at = now()
      WHERE fixture_id = $1
      RETURNING
        fixture_id,
        display_name,
        verified_faculty
      `,
      [request.params.fixtureId]
    );

    if (result.rows.length === 0) {
      return response.status(404).json({
        error: "Faculty profile not found.",
      });
    }

    await pool.query(
      `
      UPDATE users
      SET is_verified_faculty = TRUE
      WHERE id = (
        SELECT user_id
        FROM faculty
        WHERE fixture_id = $1
      )
      `,
      [request.params.fixtureId]
    );

    response.json(result.rows[0]);
  } catch (error) {
    console.error("Faculty verification error:", error.message);

    response.status(500).json({
      error: "Unable to verify faculty.",
    });
  }
});

/*
 * Contact information
 *
 * Uses the university email associated with the faculty account.
 */
app.get("/api/faculty/:fixtureId/contact", async (request, response) => {
  try {
    const authenticated = await isAuthenticated(request);

    const result = await pool.query(
      `
      SELECT
        f.fixture_id,
        f.display_name,
        u.email,
        f.inquiry_preference
      FROM faculty f
      LEFT JOIN users u
        ON u.id = f.user_id
      WHERE f.fixture_id = $1
        AND f.verified_faculty = TRUE
        AND ($2 = TRUE OR f.public_profile = TRUE)
      `,
      [request.params.fixtureId, authenticated]
    );

    if (result.rows.length === 0) {
      return response.status(404).json({
        error: "Faculty contact not found.",
      });
    }

    response.json(result.rows[0]);
  } catch (error) {
    console.error("Faculty contact error:", error.message);

    response.status(500).json({
      error: "Unable to load faculty contact.",
    });
  }
});


/*
 * Error handler
 */
app.use((error, _request, response, _next) => {
  console.error("Unexpected API error:", error.message);

  response.status(500).json({
    error: "Unexpected server error",
  });
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
registerR1ManagementRoutes(app, pool);