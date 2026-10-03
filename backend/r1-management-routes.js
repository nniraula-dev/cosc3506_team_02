/*
 * R1 faculty/project management routes
 */
module.exports = function registerR1ManagementRoutes(app) {
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
      client.release();
      return;
    }

    const faculty = await getOwnedFaculty(user.id);

    if (!faculty) {
      client.release();
      return response.status(404).json({
        error: "No faculty profile is associated with this account.",
      });
    }

    if (!faculty.verified_faculty) {
      client.release();
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
      client.release();
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
      client.release();
      return;
    }

    const faculty = await getOwnedFaculty(user.id);

    if (!faculty || !faculty.verified_faculty) {
      client.release();
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
      client.release();
      return response.status(404).json({
        error: "Project not found.",
      });
    }

    const project = projectResult.rows[0];

    if (project.owner_faculty_id !== faculty.id) {
      client.release();
      return response.status(403).json({
        error: "You do not own this project.",
      });
    }

    const areas = request.body.areas;

    if (!Array.isArray(areas)) {
      client.release();
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
};
