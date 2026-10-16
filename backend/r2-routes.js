/* Release 2 industry intake, supervision, coordination, and notifications. */
module.exports = function registerR2Routes(app, { pool, getAuthenticatedUser }) {
  const capacityValues = new Set(["one-team-only", "multiple-teams", "not-sure"]);
  const engagementValues = new Set([
    "not-contacted",
    "discussion-underway",
    "partner-confirmed",
    "no-longer-pursuing",
  ]);

  const text = (value) => typeof value === "string" ? value.trim() : "";
  const emailIsValid = (value) => /^\S+@\S+\.\S+$/.test(value);

  async function verifiedFaculty(request, response) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return null;
    }
    const result = await pool.query(
      `SELECT id, fixture_id, display_name, public_profile
       FROM faculty WHERE user_id = $1 AND verified_faculty = TRUE`,
      [user.id]
    );
    if (!result.rows[0]) {
      response.status(403).json({ error: "Verified faculty authorization required." });
      return null;
    }
    return result.rows[0];
  }

  async function areasFor(client, areas) {
    if (!Array.isArray(areas) || areas.length === 0 || !areas.every((area) => text(area))) {
      const error = new Error("Choose at least one research/project area.");
      error.status = 400;
      throw error;
    }
    const result = await client.query(
      "SELECT id, name FROM research_areas WHERE name = ANY($1::text[])",
      [areas.map(text)]
    );
    if (result.rows.length !== new Set(areas.map(text)).size) {
      const error = new Error("One or more selected areas are not recognized.");
      error.status = 400;
      throw error;
    }
    return result.rows;
  }

  async function recordNotifications(client, opportunityId, title, areaIds) {
    const subscribers = await client.query(
      `SELECT DISTINCT s.faculty_id
       FROM faculty_opportunity_subscriptions s
       JOIN faculty f ON f.id = s.faculty_id AND f.verified_faculty = TRUE
       LEFT JOIN faculty_opportunity_subscription_areas sa ON sa.faculty_id = s.faculty_id
       WHERE s.subscribe_all = TRUE OR sa.research_area_id = ANY($1::int[])`,
      [areaIds]
    );
    for (const subscriber of subscribers.rows) {
      await client.query(
        `INSERT INTO faculty_notifications (faculty_id, opportunity_id, message)
         VALUES ($1, $2, $3) ON CONFLICT (faculty_id, opportunity_id) DO NOTHING`,
        [subscriber.faculty_id, opportunityId, `New industry opportunity: ${title}`]
      );
    }
  }

  function visibleOpportunityQuery(includePrivate) {
    const visibility = includePrivate
      ? "o.status = 'supervised'"
      : `o.status = 'supervised' AND EXISTS (
          SELECT 1 FROM industry_opportunity_supervisors public_ios
          JOIN faculty public_f ON public_f.id = public_ios.faculty_id
          WHERE public_ios.opportunity_id = o.id AND public_f.public_profile = TRUE
        )`;
    return `
      SELECT o.id, o.submission_id, o.organisation_name, o.title, o.description,
        o.capacity, o.status, o.created_at,
        COALESCE(array_agg(DISTINCT ra.name) FILTER (WHERE ra.name IS NOT NULL), '{}') AS areas,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'fixture_id', f.fixture_id, 'display_name', f.display_name,
          'public_profile', f.public_profile
        )) FILTER (WHERE f.id IS NOT NULL), '[]') AS supervisors
      FROM industry_opportunities o
      JOIN industry_opportunity_supervisors ios ON ios.opportunity_id = o.id
      JOIN faculty f ON f.id = ios.faculty_id AND f.verified_faculty = TRUE
      LEFT JOIN industry_opportunity_areas oa ON oa.opportunity_id = o.id
      LEFT JOIN research_areas ra ON ra.id = oa.research_area_id
      WHERE ${visibility}
      GROUP BY o.id
    `;
  }

  /* R2-01 through R2-06: public, accountless intake. */
  app.post("/api/intake", async (request, response) => {
    const client = await pool.connect();
    try {
      const organisationName = text(request.body.organisation_name);
      const contactName = text(request.body.contact_name);
      const contactEmail = text(request.body.contact_email).toLowerCase();
      const title = text(request.body.title);
      const description = text(request.body.description);
      const capacity = request.body.capacity === "one-team"
        ? "one-team-only"
        : request.body.capacity || "not-sure";
      const submissionId = text(request.body.submission_id) || null;

      if (!organisationName || !contactEmail || !title) {
        return response.status(400).json({ error: "Organisation, contact email, and title are required." });
      }
      if (!emailIsValid(contactEmail)) {
        return response.status(400).json({ error: "Provide a valid contact email." });
      }
      if (!capacityValues.has(capacity)) {
        return response.status(400).json({ error: "Choose a valid capacity indication." });
      }

      await client.query("BEGIN");
      const areas = await areasFor(client, request.body.areas);
      const inserted = await client.query(
        `INSERT INTO industry_opportunities
          (submission_id, organisation_name, contact_name, contact_email, title, description, capacity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, submission_id, title, status, capacity, created_at`,
        [submissionId, organisationName, contactName, contactEmail, title, description, capacity]
      );
      const opportunity = inserted.rows[0];
      for (const area of areas) {
        await client.query(
          `INSERT INTO industry_opportunity_areas (opportunity_id, research_area_id)
           VALUES ($1, $2)`, [opportunity.id, area.id]
        );
      }
      await recordNotifications(client, opportunity.id, title, areas.map((area) => area.id));
      await client.query("COMMIT");
      response.status(201).json({
        submission_id: opportunity.submission_id,
        title: opportunity.title,
        status: "awaiting-supervisor",
        message: "Thank you. Your opportunity is awaiting faculty supervisor support.",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error.code === "23505") return response.status(409).json({ error: "This submission identifier already exists." });
      response.status(error.status || 500).json({ error: error.status ? error.message : "Unable to submit the opportunity." });
    } finally {
      client.release();
    }
  });

  /* Student/public discovery intentionally excludes partner and coordination data. */
  app.get("/api/opportunities", async (request, response, next) => {
    try {
      const authenticated = Boolean(await getAuthenticatedUser(request));
      const values = [];
      let sql = `SELECT * FROM (${visibleOpportunityQuery(authenticated)}) visible`;
      if (request.query.area) {
        values.push(request.query.area);
        sql += " WHERE $1 = ANY(areas)";
      }
      sql += " ORDER BY created_at DESC";
      const result = await pool.query(sql, values);
      response.json(result.rows);
    } catch (error) { next(error); }
  });

  app.get("/api/opportunities/:id", async (request, response, next) => {
    try {
      const authenticated = Boolean(await getAuthenticatedUser(request));
      const result = await pool.query(
        `SELECT * FROM (${visibleOpportunityQuery(authenticated)}) visible WHERE id = $1`,
        [request.params.id]
      );
      if (!result.rows[0]) return response.status(404).json({ error: "Opportunity not found." });
      response.json(result.rows[0]);
    } catch (error) { next(error); }
  });

  /* Faculty-only queue includes the private partner contact and coordination state. */
  app.get("/api/faculty/opportunities", async (request, response) => {
    try {
      await verifiedFaculty(request, response);
      if (response.headersSent) return;
      const result = await pool.query(
        `SELECT o.id, o.submission_id, o.organisation_name, o.contact_name, o.contact_email,
          o.title, o.description, o.capacity, o.status, o.engagement_state,
          lead.fixture_id AS engagement_faculty_fixture_id,
          lead.display_name AS engagement_faculty_name,
          COUNT(DISTINCT ios.faculty_id)::int AS willingness_count,
          COALESCE(array_agg(DISTINCT ra.name) FILTER (WHERE ra.name IS NOT NULL), '{}') AS areas
         FROM industry_opportunities o
         LEFT JOIN faculty lead ON lead.id = o.engagement_faculty_id
         LEFT JOIN industry_opportunity_supervisors ios ON ios.opportunity_id = o.id
         LEFT JOIN industry_opportunity_areas oa ON oa.opportunity_id = o.id
         LEFT JOIN research_areas ra ON ra.id = oa.research_area_id
         GROUP BY o.id, lead.fixture_id, lead.display_name
         ORDER BY o.created_at DESC`
      );
      response.json(result.rows);
    } catch (error) { response.status(500).json({ error: "Unable to load faculty opportunities." }); }
  });

  app.put("/api/opportunities/:id/willingness", async (request, response) => {
    const client = await pool.connect();
    try {
      const faculty = await verifiedFaculty(request, response);
      if (!faculty) return;
      const willing = request.body.willing !== false;
      await client.query("BEGIN");
      const opportunity = await client.query("SELECT id FROM industry_opportunities WHERE id = $1 FOR UPDATE", [request.params.id]);
      if (!opportunity.rows[0]) {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: "Opportunity not found." });
      }
      if (willing) {
        await client.query(
          `INSERT INTO industry_opportunity_supervisors (opportunity_id, faculty_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`, [request.params.id, faculty.id]
        );
      } else {
        await client.query(
          "DELETE FROM industry_opportunity_supervisors WHERE opportunity_id = $1 AND faculty_id = $2",
          [request.params.id, faculty.id]
        );
      }
      const count = await client.query(
        "SELECT COUNT(*)::int AS count FROM industry_opportunity_supervisors WHERE opportunity_id = $1",
        [request.params.id]
      );
      const status = count.rows[0].count > 0 ? "supervised" : "awaiting-supervisor";
      await client.query("UPDATE industry_opportunities SET status = $1, updated_at = now() WHERE id = $2", [status, request.params.id]);
      await client.query("COMMIT");
      response.json({ status, willingness_count: count.rows[0].count });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      response.status(500).json({ error: "Unable to update willingness." });
    } finally { client.release(); }
  });

  app.put("/api/opportunities/:id/engagement", async (request, response) => {
    try {
      const faculty = await verifiedFaculty(request, response);
      if (!faculty) return;
      const state = request.body.engagement_state;
      if (!engagementValues.has(state)) return response.status(400).json({ error: "Invalid engagement state." });
      const result = await pool.query(
        `UPDATE industry_opportunities
         SET engagement_state = $1, engagement_faculty_id = $2, updated_at = now()
         WHERE id = $3 RETURNING engagement_state`,
        [state, faculty.id, request.params.id]
      );
      if (!result.rows[0]) return response.status(404).json({ error: "Opportunity not found." });
      response.json({ engagement_state: state, engagement_faculty: faculty.display_name });
    } catch (error) { response.status(500).json({ error: "Unable to update engagement." }); }
  });

  app.get("/api/faculty/me/subscriptions", async (request, response) => {
    try {
      const faculty = await verifiedFaculty(request, response);
      if (!faculty) return;
      const result = await pool.query(
        `SELECT COALESCE(s.subscribe_all, FALSE) AS subscribe_all,
          COALESCE(array_agg(ra.name) FILTER (WHERE ra.name IS NOT NULL), '{}') AS areas
         FROM faculty f
         LEFT JOIN faculty_opportunity_subscriptions s ON s.faculty_id = f.id
         LEFT JOIN faculty_opportunity_subscription_areas sa ON sa.faculty_id = f.id
         LEFT JOIN research_areas ra ON ra.id = sa.research_area_id
         WHERE f.id = $1 GROUP BY f.id, s.subscribe_all`, [faculty.id]
      );
      response.json(result.rows[0] || { subscribe_all: false, areas: [] });
    } catch (error) { response.status(500).json({ error: "Unable to load subscriptions." }); }
  });

  app.put("/api/faculty/me/subscriptions", async (request, response) => {
    const client = await pool.connect();
    try {
      const faculty = await verifiedFaculty(request, response);
      if (!faculty) return;
      const subscribeAll = request.body.subscribe_all === true;
      const areas = request.body.areas || [];
      if (!Array.isArray(areas)) return response.status(400).json({ error: "areas must be an array." });
      await client.query("BEGIN");
      const areaRows = areas.length ? await areasFor(client, areas) : [];
      await client.query(
        `INSERT INTO faculty_opportunity_subscriptions (faculty_id, subscribe_all)
         VALUES ($1, $2) ON CONFLICT (faculty_id)
         DO UPDATE SET subscribe_all = EXCLUDED.subscribe_all, updated_at = now()`, [faculty.id, subscribeAll]
      );
      await client.query("DELETE FROM faculty_opportunity_subscription_areas WHERE faculty_id = $1", [faculty.id]);
      for (const area of areaRows) await client.query(
        "INSERT INTO faculty_opportunity_subscription_areas (faculty_id, research_area_id) VALUES ($1, $2)",
        [faculty.id, area.id]
      );
      await client.query("COMMIT");
      response.json({ subscribe_all: subscribeAll, areas: areaRows.map((area) => area.name) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      response.status(error.status || 500).json({ error: error.status ? error.message : "Unable to save subscriptions." });
    } finally { client.release(); }
  });

  app.get("/api/faculty/me/notifications", async (request, response) => {
    try {
      const faculty = await verifiedFaculty(request, response);
      if (!faculty) return;
      const result = await pool.query(
        `SELECT n.id, n.message, n.created_at, n.read_at, o.id AS opportunity_id, o.title
         FROM faculty_notifications n JOIN industry_opportunities o ON o.id = n.opportunity_id
         WHERE n.faculty_id = $1 ORDER BY n.created_at DESC`, [faculty.id]
      );
      response.json(result.rows);
    } catch (error) { response.status(500).json({ error: "Unable to load notifications." }); }
  });
};
