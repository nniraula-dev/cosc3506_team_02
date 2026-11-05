/*
 * Release 3: mutual matches, lifecycle, and consent-controlled outcomes.
 *
 * R3 deliberately builds on the R2 opportunity/publication boundary.  The
 * lifecycle is stored separately from R2's `status`, so a supervised intake
 * remains supervised while it is expired, matched, completed, or archived.
 */
module.exports = function registerR3Routes(app, { pool, getAuthenticatedUser }) {
  const lifecycleStates = new Set([
    "open", "expired", "withdrawn", "matched", "completed", "archived",
  ]);
  const manuallySettableStates = new Set(["open", "withdrawn", "completed", "archived"]);
  const matchStates = new Set([
    "proposed", "partly-confirmed", "confirmed", "declined", "withdrawn",
  ]);
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
  const forbidden = (message) => Object.assign(new Error(message), { status: 403 });
  const notFound = (message) => Object.assign(new Error(message), { status: 404 });

  function responseError(response, error, fallback) {
    response.status(error.status || 500).json({
      error: error.status ? error.message : fallback,
    });
  }

  async function requireUser(request, response) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return null;
    }
    return user;
  }

  async function facultyForUser(client, userId) {
    const result = await client.query(
      `SELECT id, fixture_id, display_name, public_profile, verified_faculty
       FROM faculty
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  async function requireVerifiedFaculty(client, request, response) {
    const user = await requireUser(request, response);
    if (!user) return null;
    const faculty = await facultyForUser(client, user.id);
    if (!faculty || !faculty.verified_faculty) {
      response.status(403).json({ error: "Verified faculty authorization required." });
      return null;
    }
    return { user, faculty };
  }

  // R3 explicitly permits staff to restore/renew lifecycle records.  Staff is
  // not required to have a faculty profile, while proposal and outcome actions
  // remain faculty-only through requireVerifiedFaculty above.
  async function requireFacultyOrStaff(client, request, response) {
    const user = await requireUser(request, response);
    if (!user) return null;
    const faculty = await facultyForUser(client, user.id);
    if (!user.is_admin && (!faculty || !faculty.verified_faculty)) {
      response.status(403).json({ error: "Verified faculty or staff authorization required." });
      return null;
    }
    return { user, faculty };
  }

  async function studentForUser(client, userId) {
    const result = await client.query(
      `SELECT sp.id, sp.fixture_id, sp.display_name, sp.public_profile, sp.user_id
       FROM student_profiles sp
       WHERE sp.user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  async function currentRun(client, opportunityId, lock = false) {
    const result = await client.query(
      `SELECT id, opportunity_id, run_number, target_term, application_deadline,
              lifecycle_state, lifecycle_reason, is_current
       FROM opportunity_runs
       WHERE opportunity_id = $1 AND is_current = TRUE
       ${lock ? "FOR UPDATE" : ""}`,
      [opportunityId]
    );
    return result.rows[0] || null;
  }

  async function findOpportunity(client, identifier, lock = false) {
    const value = text(identifier);
    const result = await client.query(
      `SELECT o.id, o.submission_id, o.title, o.description, o.status,
              o.source_type, o.target_term, o.application_deadline,
              o.lifecycle_state, o.lifecycle_reason, o.expiry_exception,
              o.partner_agreed_in_principle
       FROM industry_opportunities o
       WHERE o.id::text = $1 OR o.submission_id = $1
       ${lock ? "FOR UPDATE" : ""}`,
      [value]
    );
    if (!result.rows[0]) throw notFound("Opportunity not found.");
    return result.rows[0];
  }

  async function findMatch(client, identifier, lock = false) {
    const value = text(identifier);
    const result = await client.query(
      `SELECT mp.id, mp.fixture_id, mp.opportunity_id, mp.run_id, mp.faculty_id,
              mp.state, mp.partner_agreed_in_principle
       FROM match_proposals mp
       WHERE mp.id::text = $1 OR mp.fixture_id = $1
       ${lock ? "FOR UPDATE" : ""}`,
      [value]
    );
    if (!result.rows[0]) throw notFound("Match proposal not found.");
    return result.rows[0];
  }

  async function evaluationDate(client) {
    const result = await client.query(
      "SELECT evaluation_date FROM r3_evaluation_settings WHERE singleton = TRUE"
    );
    if (!result.rows[0]) return "2026-11-06";
    return result.rows[0].evaluation_date;
  }

  async function hasConfirmedMatch(client, opportunityId, runId = null) {
    const result = await client.query(
      `SELECT 1
       FROM match_proposals
       WHERE opportunity_id = $1
         AND state = 'confirmed'
         AND ($2::integer IS NULL OR run_id = $2)
       LIMIT 1`,
      [opportunityId, runId]
    );
    return Boolean(result.rows[0]);
  }

  async function recordLifecycle(client, opportunity, run, nextState, reason, changedByUserId = null) {
    if (!lifecycleStates.has(nextState)) throw badRequest("Unknown lifecycle state.");
    const previous = opportunity.lifecycle_state;
    // R3-13 permits a faculty/staff correction to reopen a mistakenly expired
    // or withdrawn record without inventing a duplicate.  Keep that explicit
    // correction auditable rather than silently changing the Centre deadline.
    const expiryException = nextState === "open" && ["expired", "withdrawn"].includes(previous);
    await client.query(
      `UPDATE industry_opportunities
       SET lifecycle_state = $1, lifecycle_reason = $2, expiry_exception = $3, updated_at = now()
       WHERE id = $4`,
      [nextState, reason || "", expiryException, opportunity.id]
    );
    if (run) {
      await client.query(
        `UPDATE opportunity_runs
         SET lifecycle_state = $1, lifecycle_reason = $2, updated_at = now()
         WHERE id = $3`,
        [nextState, reason || "", run.id]
      );
    }
    await client.query(
      `INSERT INTO opportunity_lifecycle_events
        (opportunity_id, run_id, from_state, to_state, reason, changed_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [opportunity.id, run?.id || null, previous || null, nextState, reason || "", changedByUserId]
    );
    opportunity.lifecycle_state = nextState;
    opportunity.lifecycle_reason = reason || "";
    opportunity.expiry_exception = expiryException;
    return opportunity;
  }

  async function refreshExpiry(client, opportunity) {
    const run = await currentRun(client, opportunity.id, true);
    const deadline = run?.application_deadline || opportunity.application_deadline;
    if (opportunity.lifecycle_state !== "open" || opportunity.expiry_exception || !deadline) {
      return { opportunity, run };
    }

    const nowForEvaluation = await evaluationDate(client);
    const confirmed = await hasConfirmedMatch(client, opportunity.id, run?.id || null);
    if (String(deadline) < String(nowForEvaluation) && !confirmed) {
      await recordLifecycle(
        client,
        opportunity,
        run,
        "expired",
        `Deadline ${deadline} passed on the configured R3 evaluation date ${nowForEvaluation} without a fully confirmed match.`
      );
    }
    return { opportunity, run };
  }

  async function canManageOpportunity(client, user, faculty, opportunityId) {
    if (user.is_admin) return true;
    if (!faculty || !faculty.verified_faculty) return false;
    const supervisor = await client.query(
      `SELECT 1 FROM industry_opportunity_supervisors
       WHERE opportunity_id = $1 AND faculty_id = $2`,
      [opportunityId, faculty.id]
    );
    return Boolean(supervisor.rows[0]);
  }

  async function matchDetail(client, matchId) {
    const result = await client.query(
      `SELECT mp.id, mp.fixture_id, mp.state, mp.partner_agreed_in_principle,
              mp.created_at, mp.updated_at,
              o.id AS opportunity_id, o.submission_id AS opportunity_fixture_id,
              o.title AS opportunity_title, o.lifecycle_state,
              f.fixture_id AS faculty_fixture_id, f.display_name AS faculty_name,
              COALESCE(
                json_agg(
                  json_build_object(
                    'fixture_id', sp.fixture_id,
                    'display_name', sp.display_name,
                    'response_state', mpa.response_state,
                    'responded_at', mpa.responded_at
                  ) ORDER BY sp.display_name
                ) FILTER (WHERE sp.id IS NOT NULL),
                '[]'::json
              ) AS students
       FROM match_proposals mp
       JOIN industry_opportunities o ON o.id = mp.opportunity_id
       JOIN faculty f ON f.id = mp.faculty_id
       LEFT JOIN match_participants mpa ON mpa.match_id = mp.id
       LEFT JOIN student_profiles sp ON sp.user_id = mpa.student_user_id
       WHERE mp.id = $1
       GROUP BY mp.id, o.id, f.id`,
      [matchId]
    );
    return result.rows[0] || null;
  }

  async function assertMatchParticipantOrFaculty(client, match, user) {
    if (user.is_admin) return;
    const allowed = await client.query(
      `SELECT 1
       FROM match_proposals mp
       LEFT JOIN faculty f ON f.id = mp.faculty_id
       LEFT JOIN match_participants p ON p.match_id = mp.id
       WHERE mp.id = $1 AND (f.user_id = $2 OR p.student_user_id = $2)
       LIMIT 1`,
      [match.id, user.id]
    );
    if (!allowed.rows[0]) throw forbidden("This match is visible only to its participants.");
  }

  async function studentsForIdentifiers(client, identifiers) {
    const values = Array.isArray(identifiers)
      ? [...new Set(identifiers.map(text).filter(Boolean))]
      : [];
    if (!values.length) throw badRequest("Choose at least one identified student.");
    const result = await client.query(
      `SELECT sp.user_id, sp.fixture_id, sp.display_name
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.fixture_id = ANY($1::text[]) OR u.email = ANY($1::text[])`,
      [values]
    );
    if (result.rows.length !== values.length) {
      throw badRequest("Every invited student must have an identified student profile.");
    }
    return result.rows;
  }

  function validLinks(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const approved = {};
    for (const key of ["demo", "repository", "repo", "poster", "video", "image"]) {
      const link = text(value[key]);
      if (!link) continue;
      try {
        const url = new URL(link);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
        approved[key] = url.toString();
      } catch {
        throw badRequest(`Outcome link '${key}' must be an http(s) URL.`);
      }
    }
    return approved;
  }

  async function isOutcomeParticipant(client, outcomeId, userId) {
    const result = await client.query(
      `SELECT op.id, op.participant_kind, op.faculty_id, op.student_user_id
       FROM outcome_participants op
       LEFT JOIN faculty f ON f.id = op.faculty_id
       WHERE op.outcome_id = $1
         AND (op.student_user_id = $2 OR f.user_id = $2)
       LIMIT 1`,
      [outcomeId, userId]
    );
    return result.rows[0] || null;
  }

  /* R3-08 through R3-13: plain, non-confidential lifecycle state for a
     bookmarked or direct-linked opportunity. */
  app.get("/api/opportunities/:identifier/lifecycle", async (request, response) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let opportunity = await findOpportunity(client, request.params.identifier, true);
      if (opportunity.status !== "supervised") {
        const user = await getAuthenticatedUser(request);
        const faculty = user ? await facultyForUser(client, user.id) : null;
        if (!user || !(await canManageOpportunity(client, user, faculty, opportunity.id))) {
          throw notFound("Opportunity not found.");
        }
      }
      const { run } = await refreshExpiry(client, opportunity);
      await client.query("COMMIT");
      response.json({
        opportunity_id: opportunity.id,
        fixture_id: opportunity.submission_id,
        title: opportunity.title,
        lifecycle_state: opportunity.lifecycle_state,
        reason: opportunity.lifecycle_reason,
        expiry_exception: opportunity.expiry_exception,
        target_term: run?.target_term || opportunity.target_term,
        deadline: run?.application_deadline || opportunity.application_deadline,
        available_for_new_matches: opportunity.lifecycle_state === "open",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to load opportunity lifecycle.");
    } finally { client.release(); }
  });

  /* R3-01 and R3-07: verified faculty proposes, but does not confirm, a match. */
  app.post("/api/opportunities/:identifier/matches", async (request, response) => {
    const client = await pool.connect();
    try {
      const actor = await requireVerifiedFaculty(client, request, response);
      if (!actor) return;
      await client.query("BEGIN");
      const opportunity = await findOpportunity(client, request.params.identifier, true);
      const { run } = await refreshExpiry(client, opportunity);
      if (!(await canManageOpportunity(client, actor.user, actor.faculty, opportunity.id))) {
        throw forbidden("Only a supervising verified faculty member can propose this match.");
      }
      if (opportunity.lifecycle_state !== "open") {
        throw badRequest("A new match can only be proposed for an active opportunity.");
      }
      if (!run?.target_term || !run?.application_deadline) {
        throw badRequest("Set the target term and authoritative application deadline before proposing a match.");
      }
      const students = await studentsForIdentifiers(
        client,
        request.body.student_ids || request.body.students
      );
      const partnerAgreed = request.body.partner_agreed_in_principle === true;
      const inserted = await client.query(
        `INSERT INTO match_proposals
          (opportunity_id, run_id, faculty_id, state, partner_agreed_in_principle)
         VALUES ($1, $2, $3, 'proposed', $4)
         RETURNING id`,
        [opportunity.id, run?.id || null, actor.faculty.id, partnerAgreed]
      );
      for (const student of students) {
        await client.query(
          `INSERT INTO match_participants (match_id, student_user_id)
           VALUES ($1, $2)`,
          [inserted.rows[0].id, student.user_id]
        );
      }
      if (opportunity.source_type === "industry" && partnerAgreed) {
        await client.query(
          `UPDATE industry_opportunities
           SET partner_agreed_in_principle = TRUE, updated_at = now()
           WHERE id = $1`,
          [opportunity.id]
        );
      }
      await client.query("COMMIT");
      response.status(201).json({
        ...(await matchDetail(client, inserted.rows[0].id)),
        message: "Match proposed. Each invited student must confirm before it becomes a confirmed intention to work together.",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to propose match.");
    } finally { client.release(); }
  });

  app.get("/api/matches/mine", async (request, response) => {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      const result = await client.query(
        `SELECT DISTINCT mp.id
         FROM match_proposals mp
         LEFT JOIN faculty f ON f.id = mp.faculty_id
         LEFT JOIN match_participants p ON p.match_id = mp.id
         WHERE f.user_id = $1 OR p.student_user_id = $1
         ORDER BY mp.id DESC`,
        [user.id]
      );
      response.json(await Promise.all(result.rows.map((row) => matchDetail(client, row.id))));
    } catch (error) { responseError(response, error, "Unable to load matches."); }
    finally { client.release(); }
  });

  app.get("/api/student/matches", async (request, response) => {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      if (!(await studentForUser(client, user.id))) throw forbidden("A student profile is required to view match invitations.");
      const result = await client.query(
        `SELECT DISTINCT mp.id
         FROM match_proposals mp
         JOIN match_participants p ON p.match_id = mp.id
         WHERE p.student_user_id = $1
         ORDER BY mp.id DESC`,
        [user.id]
      );
      response.json(await Promise.all(result.rows.map((row) => matchDetail(client, row.id))));
    } catch (error) { responseError(response, error, "Unable to load student matches."); }
    finally { client.release(); }
  });

  app.get("/api/matches/:identifier", async (request, response) => {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      const match = await findMatch(client, request.params.identifier);
      await assertMatchParticipantOrFaculty(client, match, user);
      response.json(await matchDetail(client, match.id));
    } catch (error) { responseError(response, error, "Unable to load match."); }
    finally { client.release(); }
  });

  async function respondToMatch(request, response, responseState) {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      if (!(await studentForUser(client, user.id))) throw forbidden("Only an invited student can respond to a match.");
      await client.query("BEGIN");
      const match = await findMatch(client, request.params.identifier, true);
      const opportunity = await findOpportunity(client, match.opportunity_id, true);
      const { run } = await refreshExpiry(client, opportunity);
      if (!["proposed", "partly-confirmed"].includes(match.state)) {
        throw badRequest("This match is no longer awaiting student confirmation.");
      }
      if (opportunity.lifecycle_state === "expired") {
        throw badRequest("This proposal expired before it was fully confirmed.");
      }
      const participant = await client.query(
        `SELECT response_state FROM match_participants
         WHERE match_id = $1 AND student_user_id = $2 FOR UPDATE`,
        [match.id, user.id]
      );
      if (!participant.rows[0]) throw forbidden("You were not invited to this match.");
      if (participant.rows[0].response_state !== "pending") {
        throw badRequest("You have already responded to this match.");
      }
      await client.query(
        `UPDATE match_participants
         SET response_state = $1, responded_at = now()
         WHERE match_id = $2 AND student_user_id = $3`,
        [responseState, match.id, user.id]
      );
      const counts = await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE response_state = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE response_state = 'declined')::int AS declined
         FROM match_participants WHERE match_id = $1`,
        [match.id]
      );
      const summary = counts.rows[0];
      let nextState = "partly-confirmed";
      if (summary.declined > 0) nextState = "declined";
      else if (summary.confirmed === summary.total) nextState = "confirmed";
      await client.query(
        `UPDATE match_proposals SET state = $1, updated_at = now() WHERE id = $2`,
        [nextState, match.id]
      );
      if (nextState === "confirmed") {
        await recordLifecycle(
          client,
          opportunity,
          run,
          "matched",
          "All invited students confirmed their intention to work together.",
          user.id
        );
      }
      await client.query("COMMIT");
      response.json(await matchDetail(client, match.id));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to record match response.");
    } finally { client.release(); }
  }

  app.post("/api/matches/:identifier/confirm", (request, response) =>
    respondToMatch(request, response, "confirmed")
  );
  app.post("/api/matches/:identifier/decline", (request, response) =>
    respondToMatch(request, response, "declined")
  );

  /* R3-04: a faculty member can withdraw an unconfirmed proposal without
     deleting the opportunity or the match record. */
  app.post("/api/matches/:identifier/withdraw", async (request, response) => {
    const client = await pool.connect();
    try {
      const actor = await requireVerifiedFaculty(client, request, response);
      if (!actor) return;
      await client.query("BEGIN");
      const match = await findMatch(client, request.params.identifier, true);
      if (match.faculty_id !== actor.faculty.id && !actor.user.is_admin) {
        throw forbidden("Only the proposing faculty member or staff can withdraw this proposal.");
      }
      if (!['proposed', 'partly-confirmed'].includes(match.state)) {
        throw badRequest("Only a proposed or partly confirmed match can be withdrawn; a declined, confirmed, or withdrawn record is retained as-is.");
      }
      await client.query(
        `UPDATE match_proposals SET state = 'withdrawn', updated_at = now() WHERE id = $1`,
        [match.id]
      );
      await client.query("COMMIT");
      response.json(await matchDetail(client, match.id));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to withdraw match proposal.");
    } finally { client.release(); }
  });

  app.patch("/api/matches/:identifier/partner-agreement", async (request, response) => {
    const client = await pool.connect();
    try {
      const actor = await requireVerifiedFaculty(client, request, response);
      if (!actor) return;
      const match = await findMatch(client, request.params.identifier);
      if (match.faculty_id !== actor.faculty.id && !actor.user.is_admin) {
        throw forbidden("Only the participating faculty member or staff can record partner agreement.");
      }
      const agreed = request.body.agreed_in_principle === true;
      await client.query(
        `UPDATE match_proposals
         SET partner_agreed_in_principle = $1, updated_at = now()
         WHERE id = $2`,
        [agreed, match.id]
      );
      if (agreed) await client.query(
        `UPDATE industry_opportunities
         SET partner_agreed_in_principle = TRUE, updated_at = now()
         WHERE id = $1`,
        [match.opportunity_id]
      );
      response.json(await matchDetail(client, match.id));
    } catch (error) { responseError(response, error, "Unable to record partner agreement."); }
    finally { client.release(); }
  });

  /* R3-11 through R3-13: lifecycle is reversible by a faculty manager/staff;
     'matched' itself remains derived from mutual confirmation. */
  app.patch("/api/opportunities/:identifier/lifecycle", async (request, response) => {
    const client = await pool.connect();
    try {
      const actor = await requireFacultyOrStaff(client, request, response);
      if (!actor) return;
      const requestedState = text(request.body.lifecycle_state);
      if (!manuallySettableStates.has(requestedState)) {
        throw badRequest("Use open, withdrawn, completed, or archived for a manual lifecycle change.");
      }
      await client.query("BEGIN");
      const opportunity = await findOpportunity(client, request.params.identifier, true);
      const run = await currentRun(client, opportunity.id, true);
      if (!(await canManageOpportunity(client, actor.user, actor.faculty, opportunity.id))) {
        throw forbidden("Only an opportunity faculty manager or staff can change this lifecycle state.");
      }
      if (requestedState === "open" && !["expired", "withdrawn"].includes(opportunity.lifecycle_state)) {
        throw badRequest("Only an expired or withdrawn opportunity can be restored to active availability.");
      }
      if (requestedState === "open" && await hasConfirmedMatch(client, opportunity.id, run?.id || null)) {
        throw badRequest("A confirmed match must be completed or otherwise resolved before reopening this opportunity.");
      }
      const reason = text(request.body.reason) || (
        requestedState === "open"
          ? "Restored to active availability by faculty or staff."
          : `Changed to ${requestedState} by faculty or staff.`
      );
      await recordLifecycle(client, opportunity, run, requestedState, reason, actor.user.id);
      await client.query("COMMIT");
      response.json({
        fixture_id: opportunity.submission_id,
        lifecycle_state: opportunity.lifecycle_state,
        reason: opportunity.lifecycle_reason,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to update opportunity lifecycle.");
    } finally { client.release(); }
  });

  /* A newly supervised intake has no public deadline by default.  A faculty
     manager records its first term/run here before proposing students.  Once
     an opportunity has expired or has a confirmed match, use the explicit
     renewal flow below so prior terms and outcomes remain auditable. */
  app.patch("/api/opportunities/:identifier/schedule", async (request, response) => {
    const client = await pool.connect();
    try {
      const actor = await requireFacultyOrStaff(client, request, response);
      if (!actor) return;
      const targetTerm = text(request.body.target_term);
      const deadline = text(request.body.deadline);
      if (!targetTerm || targetTerm.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
        throw badRequest("A target term and a deadline in YYYY-MM-DD format are required.");
      }

      await client.query("BEGIN");
      let opportunity = await findOpportunity(client, request.params.identifier, true);
      let run = await currentRun(client, opportunity.id, true);
      if (!(await canManageOpportunity(client, actor.user, actor.faculty, opportunity.id))) {
        throw forbidden("Only an opportunity faculty manager or staff can set its term and deadline.");
      }

      // Do not turn an already-expired listing into a quiet edit.  It must use
      // the separately recorded renewal path so its original deadline remains
      // part of the lifecycle history.
      ({ opportunity, run } = await refreshExpiry(client, opportunity));
      if (opportunity.lifecycle_state !== "open") {
        throw badRequest("Only an active opportunity can have its current term and deadline edited. Renew an expired or completed opportunity instead.");
      }
      if (await hasConfirmedMatch(client, opportunity.id, run?.id || null)) {
        throw badRequest("A confirmed match locks this run. Complete or renew the opportunity instead.");
      }

      if (run) {
        await client.query(
          `UPDATE opportunity_runs
           SET target_term = $1, application_deadline = $2, updated_at = now()
           WHERE id = $3`,
          [targetTerm, deadline, run.id]
        );
      } else {
        const created = await client.query(
          `INSERT INTO opportunity_runs
            (opportunity_id, run_number, target_term, application_deadline, lifecycle_state, lifecycle_reason)
           VALUES ($1, 1, $2, $3, 'open', 'Initial term and application deadline configured by faculty or staff.')
           RETURNING id, run_number`,
          [opportunity.id, targetTerm, deadline]
        );
        run = { id: created.rows[0].id, run_number: created.rows[0].run_number };
      }
      await client.query(
        `UPDATE industry_opportunities
         SET target_term = $1, application_deadline = $2, expiry_exception = FALSE, updated_at = now()
         WHERE id = $3`,
        [targetTerm, deadline, opportunity.id]
      );
      await client.query(
        `INSERT INTO opportunity_lifecycle_events
          (opportunity_id, run_id, from_state, to_state, reason, changed_by_user_id)
         VALUES ($1, $2, 'open', 'open', 'Current term and application deadline configured by faculty or staff.', $3)`,
        [opportunity.id, run.id, actor.user.id]
      );
      // A Center-configured date is authoritative immediately.  If someone
      // records a date that is already before the fixture's simulated clock,
      // leave an auditable expiry rather than briefly showing a stale open
      // record until a later discovery request happens to refresh it.
      opportunity.target_term = targetTerm;
      opportunity.application_deadline = deadline;
      ({ opportunity, run } = await refreshExpiry(client, opportunity));
      await client.query("COMMIT");
      response.json({
        fixture_id: opportunity.submission_id,
        opportunity_id: opportunity.id,
        run_number: run.run_number,
        lifecycle_state: opportunity.lifecycle_state,
        target_term: targetTerm,
        deadline,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to configure opportunity term and deadline.");
    } finally { client.release(); }
  });

  app.post("/api/opportunities/:identifier/renew", async (request, response) => {
    const client = await pool.connect();
    try {
      const actor = await requireFacultyOrStaff(client, request, response);
      if (!actor) return;
      const targetTerm = text(request.body.target_term);
      const deadline = text(request.body.deadline);
      if (!targetTerm || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
        throw badRequest("A target_term and a deadline in YYYY-MM-DD format are required.");
      }
      await client.query("BEGIN");
      const opportunity = await findOpportunity(client, request.params.identifier, true);
      const previousRun = await currentRun(client, opportunity.id, true);
      if (!(await canManageOpportunity(client, actor.user, actor.faculty, opportunity.id))) {
        throw forbidden("Only an opportunity faculty manager or staff can renew this opportunity.");
      }
      if (!["expired", "completed"].includes(opportunity.lifecycle_state)) {
        throw badRequest("Only an expired or completed opportunity can be renewed.");
      }
      if (previousRun) {
        await client.query(
          `UPDATE opportunity_runs SET is_current = FALSE, updated_at = now() WHERE id = $1`,
          [previousRun.id]
        );
      }
      const nextNumber = (previousRun?.run_number || 0) + 1;
      const created = await client.query(
        `INSERT INTO opportunity_runs
          (opportunity_id, run_number, target_term, application_deadline, lifecycle_state, lifecycle_reason)
         VALUES ($1, $2, $3, $4, 'open', 'Renewed for a later term while retaining its original opportunity history.')
         RETURNING id, run_number`,
        [opportunity.id, nextNumber, targetTerm, deadline]
      );
      await client.query(
        `UPDATE industry_opportunities
         SET target_term = $1, application_deadline = $2,
             lifecycle_state = 'open',
             expiry_exception = FALSE,
             lifecycle_reason = 'Renewed for a later term while retaining its original opportunity history.',
             updated_at = now()
         WHERE id = $3`,
        [targetTerm, deadline, opportunity.id]
      );
      await client.query(
        `INSERT INTO opportunity_lifecycle_events
          (opportunity_id, run_id, from_state, to_state, reason, changed_by_user_id)
         VALUES ($1, $2, $3, 'open', 'Renewed for a later term; the original opportunity id and prior-run outcomes are retained.', $4)`,
        [opportunity.id, created.rows[0].id, opportunity.lifecycle_state, actor.user.id]
      );
      await client.query("COMMIT");
      response.status(201).json({
        fixture_id: opportunity.submission_id,
        opportunity_id: opportunity.id,
        run_number: created.rows[0].run_number,
        lifecycle_state: "open",
        target_term: targetTerm,
        deadline,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to renew opportunity.");
    } finally { client.release(); }
  });

  /* Student profile endpoints.  An authenticated non-faculty user can create
     their own profile through the existing passwordless account, never another
     student's profile. */
  app.put("/api/student/me", async (request, response) => {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      const displayName = text(request.body.display_name) || user.email.split("@")[0];
      const fixtureId = text(request.body.fixture_id) || null;
      const publicProfile = request.body.public_profile === true;
      const result = await client.query(
        `INSERT INTO student_profiles (user_id, fixture_id, display_name, public_profile)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           public_profile = EXCLUDED.public_profile,
           fixture_id = COALESCE(student_profiles.fixture_id, EXCLUDED.fixture_id),
           updated_at = now()
         RETURNING fixture_id, display_name, public_profile`,
        [user.id, fixtureId, displayName, publicProfile]
      );
      response.json(result.rows[0]);
    } catch (error) { responseError(response, error, "Unable to save student profile."); }
    finally { client.release(); }
  });

  function publicShowcaseQuery(extraWhere = "", extraValues = []) {
    return {
      values: extraValues,
      sql: `SELECT oo.id, oo.fixture_id, oo.summary, oo.completed_on, oo.links,
                    io.submission_id AS opportunity_fixture_id, io.title AS opportunity_title,
                    COALESCE(json_agg(DISTINCT jsonb_build_object(
                      'fixture_id', f.fixture_id, 'display_name', f.display_name,
                      'public_profile', f.public_profile
                    )) FILTER (WHERE op.participant_kind = 'faculty'), '[]'::json) AS faculty,
                    COALESCE(json_agg(DISTINCT jsonb_build_object(
                      'fixture_id', sp.fixture_id, 'display_name', sp.display_name,
                      'public_profile', sp.public_profile
                    )) FILTER (WHERE op.participant_kind = 'student'), '[]'::json) AS students
             FROM opportunity_outcomes oo
             JOIN industry_opportunities io ON io.id = oo.opportunity_id
             JOIN outcome_participants op ON op.outcome_id = oo.id
             LEFT JOIN faculty f ON f.id = op.faculty_id
             LEFT JOIN student_profiles sp ON sp.user_id = op.student_user_id
             WHERE oo.faculty_confirmed_by IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM outcome_participants blocked
                 LEFT JOIN faculty blocked_faculty ON blocked_faculty.id = blocked.faculty_id
                 WHERE blocked.outcome_id = oo.id
                   AND (
                     blocked.public_consent = FALSE
                     OR (blocked.participant_kind = 'faculty' AND blocked_faculty.public_profile = FALSE)
                   )
               )
               ${extraWhere}
             GROUP BY oo.id, io.id
             ORDER BY oo.completed_on DESC, oo.id DESC`,
    };
  }

  app.get("/api/showcase", async (_request, response) => {
    try {
      const query = publicShowcaseQuery();
      const result = await pool.query(query.sql, query.values);
      response.json(result.rows);
    } catch (error) { responseError(response, error, "Unable to load showcase."); }
  });

  app.get("/api/faculty/:fixtureId/outcomes", async (request, response) => {
    try {
      const query = publicShowcaseQuery(
        `AND EXISTS (
          SELECT 1 FROM outcome_participants wanted
          JOIN faculty wanted_faculty ON wanted_faculty.id = wanted.faculty_id
          WHERE wanted.outcome_id = oo.id AND wanted_faculty.fixture_id = $1
        )`,
        [request.params.fixtureId]
      );
      const result = await pool.query(query.sql, query.values);
      response.json(result.rows);
    } catch (error) { responseError(response, error, "Unable to load faculty outcomes."); }
  });

  app.get("/api/students/:fixtureId/outcomes", async (request, response) => {
    try {
      const profile = await pool.query(
        "SELECT user_id, public_profile FROM student_profiles WHERE fixture_id = $1",
        [request.params.fixtureId]
      );
      if (!profile.rows[0] || !profile.rows[0].public_profile) {
        return response.status(404).json({ error: "Student profile not found." });
      }
      const query = publicShowcaseQuery(
        `AND EXISTS (
          SELECT 1 FROM outcome_participants wanted
          JOIN student_profiles wanted_student ON wanted_student.user_id = wanted.student_user_id
          WHERE wanted.outcome_id = oo.id
            AND wanted_student.fixture_id = $1
            AND wanted.profile_visible = TRUE
        )`,
        [request.params.fixtureId]
      );
      const result = await pool.query(query.sql, query.values);
      response.json(result.rows);
    } catch (error) { responseError(response, error, "Unable to load student outcomes."); }
  });

  app.get("/api/outcomes/mine", async (request, response) => {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      const result = await client.query(
        `SELECT DISTINCT oo.id, oo.fixture_id, oo.summary, oo.completed_on, oo.links,
                oo.faculty_confirmed_by, io.submission_id AS opportunity_fixture_id,
                io.title AS opportunity_title
         FROM opportunity_outcomes oo
         JOIN industry_opportunities io ON io.id = oo.opportunity_id
         JOIN outcome_participants op ON op.outcome_id = oo.id
         LEFT JOIN faculty f ON f.id = op.faculty_id
         WHERE op.student_user_id = $1 OR f.user_id = $1
         ORDER BY oo.completed_on DESC, oo.id DESC`,
        [user.id]
      );
      response.json(result.rows);
    } catch (error) { responseError(response, error, "Unable to load your outcomes."); }
    finally { client.release(); }
  });

  /* R3-14: an outcome automatically receives the people from the confirmed
     match.  Callers cannot add unrelated people through the request payload. */
  app.post("/api/opportunities/:identifier/outcomes", async (request, response) => {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      const summary = text(request.body.summary);
      const completedOn = text(request.body.completed_on);
      if (!summary || summary.length > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(completedOn)) {
        throw badRequest("Provide a concise summary and completion date in YYYY-MM-DD format.");
      }
      const links = validLinks(request.body.links);
      await client.query("BEGIN");
      const opportunity = await findOpportunity(client, request.params.identifier, true);
      const run = await currentRun(client, opportunity.id, true);
      const membership = await client.query(
        `SELECT mp.id, mp.run_id, mp.faculty_id
         FROM match_proposals mp
         LEFT JOIN faculty f ON f.id = mp.faculty_id
         LEFT JOIN match_participants p ON p.match_id = mp.id
         WHERE mp.opportunity_id = $1 AND mp.state = 'confirmed'
           AND (f.user_id = $2 OR p.student_user_id = $2)
           AND (
             mp.run_id = $3::integer
             OR ($3::integer IS NULL AND mp.run_id IS NULL)
           )
         ORDER BY mp.id DESC LIMIT 1`,
        [opportunity.id, user.id, run?.id || null]
      );
      if (!membership.rows[0]) throw forbidden("Only a participant in a confirmed match can record this outcome.");
      const match = membership.rows[0];
      const inserted = await client.query(
        `INSERT INTO opportunity_outcomes
          (opportunity_id, run_id, summary, completed_on, links, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id`,
        [opportunity.id, match.run_id, summary, completedOn, JSON.stringify(links), user.id]
      );
      await client.query(
        `INSERT INTO outcome_participants
          (outcome_id, participant_kind, faculty_id, public_consent)
         VALUES ($1, 'faculty', $2, FALSE)`,
        [inserted.rows[0].id, match.faculty_id]
      );
      const students = await client.query(
        `SELECT student_user_id FROM match_participants
         WHERE match_id = $1 AND response_state = 'confirmed'`,
        [match.id]
      );
      for (const student of students.rows) {
        await client.query(
          `INSERT INTO outcome_participants
            (outcome_id, participant_kind, student_user_id, public_consent)
           VALUES ($1, 'student', $2, FALSE)`,
          [inserted.rows[0].id, student.student_user_id]
        );
      }
      if (opportunity.lifecycle_state === "matched") {
        await recordLifecycle(client, opportunity, run, "completed", "Work outcome recorded; awaiting participant choices and faculty confirmation.", user.id);
      }
      await client.query("COMMIT");
      response.status(201).json({
        id: inserted.rows[0].id,
        summary,
        completed_on: completedOn,
        faculty_confirmed: false,
        message: "Outcome recorded for participants. It is not public until participating faculty confirms it and all consent conditions permit display.",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to record outcome.");
    } finally { client.release(); }
  });

  app.post("/api/outcomes/:identifier/faculty-confirm", async (request, response) => {
    const client = await pool.connect();
    try {
      const actor = await requireVerifiedFaculty(client, request, response);
      if (!actor) return;
      const outcome = await client.query(
        `SELECT id FROM opportunity_outcomes WHERE id::text = $1 OR fixture_id = $1 FOR UPDATE`,
        [text(request.params.identifier)]
      );
      if (!outcome.rows[0]) throw notFound("Outcome not found.");
      const participation = await client.query(
        `SELECT 1 FROM outcome_participants
         WHERE outcome_id = $1 AND participant_kind = 'faculty' AND faculty_id = $2`,
        [outcome.rows[0].id, actor.faculty.id]
      );
      if (!participation.rows[0]) throw forbidden("Only a participating verified faculty member can confirm this outcome.");
      await client.query(
        `UPDATE opportunity_outcomes
         SET faculty_confirmed_by = $1, faculty_confirmed_at = now(), updated_at = now()
         WHERE id = $2`,
        [actor.faculty.id, outcome.rows[0].id]
      );
      response.json({ id: outcome.rows[0].id, faculty_confirmed: true });
    } catch (error) { responseError(response, error, "Unable to confirm outcome."); }
    finally { client.release(); }
  });

  app.patch("/api/outcomes/:identifier/consent", async (request, response) => {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      const outcome = await client.query(
        "SELECT id FROM opportunity_outcomes WHERE id::text = $1 OR fixture_id = $1",
        [text(request.params.identifier)]
      );
      if (!outcome.rows[0]) throw notFound("Outcome not found.");
      const participant = await isOutcomeParticipant(client, outcome.rows[0].id, user.id);
      if (!participant) throw forbidden("Only an outcome participant can set consent.");
      await client.query(
        "UPDATE outcome_participants SET public_consent = $1 WHERE id = $2",
        [request.body.public_consent === true, participant.id]
      );
      response.json({ public_consent: request.body.public_consent === true });
    } catch (error) { responseError(response, error, "Unable to update outcome consent."); }
    finally { client.release(); }
  });

  /* R3-18: only a student controls their own profile appearance.  This does
     not remove a consented result from faculty profile or showcase surfaces. */
  app.patch("/api/outcomes/:identifier/profile-visibility", async (request, response) => {
    const client = await pool.connect();
    try {
      const user = await requireUser(request, response);
      if (!user) return;
      const outcome = await client.query(
        "SELECT id FROM opportunity_outcomes WHERE id::text = $1 OR fixture_id = $1",
        [text(request.params.identifier)]
      );
      if (!outcome.rows[0]) throw notFound("Outcome not found.");
      const participant = await isOutcomeParticipant(client, outcome.rows[0].id, user.id);
      if (!participant || participant.participant_kind !== "student") {
        throw forbidden("Only a participating student can set their profile visibility.");
      }
      const visible = request.body.profile_visible !== false;
      await client.query(
        "UPDATE outcome_participants SET profile_visible = $1 WHERE id = $2",
        [visible, participant.id]
      );
      response.json({ profile_visible: visible });
    } catch (error) { responseError(response, error, "Unable to update profile visibility."); }
    finally { client.release(); }
  });
};
