/*
 * Release 4: source-owned opportunity synchronisation.
 *
 * The provider feed is intentionally an input, never an instruction stream.
 * This module normalises a small synthetic source into the discovery model,
 * records an auditable sync result, and keeps Algoma-local faculty support in
 * a separate table so source updates can never overwrite it.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const fixtureDirectory = path.join(__dirname, "r4_fixture");
const defaultSource = {
  key: "mitacs-demo",
  name: "Mitacs (synthetic demonstration feed)",
};

const text = (value) => typeof value === "string" ? value.trim() : "";
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function responseError(response, error, fallback = "Unable to complete the external-source operation.") {
  response.status(error.status || 500).json({
    error: error.status ? error.message : fallback,
  });
}

function exactDate(value) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    ? null
    : date;
}

function safeProviderUrl(value) {
  try {
    const url = new URL(text(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normaliseRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { externalId: "", error: "record is not an object" };
  }

  const externalId = text(value.external_id);
  const sourceStatus = text(value.source_status || value.status).toLowerCase();
  const withdrawn = value.withdrawn === true || sourceStatus === "withdrawn";
  // A provider can explicitly withdraw a known record without repeating its
  // whole listing.  That is materially different from a record simply being
  // absent from a successful response.
  if (withdrawn) {
    return externalId
      ? { externalId, withdrawn: true }
      : { externalId, error: "empty external_id for withdrawn record" };
  }
  const title = text(value.title);
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const authoritativeUrl = safeProviderUrl(value.authoritative_url);
  const closes = exactDate(value.closes);
  const areas = Array.isArray(value.areas)
    ? [...new Set(value.areas.map(text).filter(Boolean))]
    : [];
  const reasons = [];

  if (!externalId) reasons.push("empty external_id");
  if (!title) reasons.push("empty title");
  if (!authoritativeUrl) reasons.push("invalid authoritative_url");
  if (!closes) reasons.push("unparseable closes date");
  if (!areas.length) reasons.push("no usable areas");
  if (reasons.length) return { externalId, error: reasons.join("; ") };

  // Preserve the external text as data.  It is deliberately not interpreted,
  // parsed as HTML, or allowed to select a local state transition.
  const content = {
    title,
    description,
    areas,
    authoritative_url: authoritativeUrl,
    closes,
  };
  const contentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");

  return {
    externalId,
    title,
    description,
    areas,
    authoritativeUrl,
    closes,
    content,
    contentHash,
    withdrawn: false,
  };
}

function changedFields(previous, next) {
  const fields = [];
  const previousContent = previous && typeof previous === "object" ? previous : {};
  const comparable = [
    ["title", "title"],
    ["description", "description"],
    ["areas", "areas"],
    ["authoritative_url", "authoritativeUrl"],
    ["closes", "closes"],
  ];
  for (const [stored, key] of comparable) {
    if (JSON.stringify(previousContent[stored] ?? null) !== JSON.stringify(next.content[stored] ?? null)) {
      fields.push(key === "authoritativeUrl" ? "authoritative_url" : stored);
    }
  }
  return fields;
}

function fixtureFeed(name) {
  const fixture = name === "v1"
    ? "external_source_feed_v1.json"
    : name === "v2"
      ? "external_source_feed_v2.json"
      : null;
  if (!fixture) throw badRequest("Choose fixture 'v1' or 'v2', or supply a source feed.");
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, fixture), "utf8"));
}

function normaliseFeed(feed) {
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    throw badRequest("The external source response must be an object.");
  }
  const sourceKey = text(feed.source_id);
  const sourceName = text(feed.source_name);
  const sourceSyncedAt = exactDate(feed.synced_at);
  if (!sourceKey || !sourceName || !sourceSyncedAt || !Array.isArray(feed.records)) {
    throw badRequest("The external source response needs source_id, source_name, synced_at, and records.");
  }
  return { sourceKey, sourceName, sourceSyncedAt, records: feed.records };
}

module.exports = function registerR4Routes(app, { pool, getAuthenticatedUser }) {
  async function requireUser(request, response) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return null;
    }
    return user;
  }

  async function requireOperator(request, response) {
    const user = await requireUser(request, response);
    if (!user) return null;
    if (!user.is_admin) {
      response.status(403).json({ error: "Operator authorization required." });
      return null;
    }
    return user;
  }

  async function verifiedFaculty(client, request, response) {
    const user = await requireUser(request, response);
    if (!user) return null;
    const result = await client.query(
      `SELECT id, fixture_id, display_name
       FROM faculty
       WHERE user_id = $1 AND verified_faculty = TRUE`,
      [user.id]
    );
    if (!result.rows[0]) {
      response.status(403).json({ error: "Verified faculty authorization required." });
      return null;
    }
    return { user, faculty: result.rows[0] };
  }

  async function ensureSource(client, sourceKey, sourceName, { updateDisplayName = true } = {}) {
    const inserted = await client.query(
      `INSERT INTO external_sources (source_key, display_name)
       VALUES ($1, $2)
       ON CONFLICT (source_key) DO NOTHING
       RETURNING id, source_key, display_name`,
      [sourceKey, sourceName]
    );
    if (inserted.rows[0]) return inserted.rows[0];

    const result = updateDisplayName
      ? await client.query(
        `UPDATE external_sources
         SET display_name = $2, updated_at = now()
         WHERE source_key = $1
         RETURNING id, source_key, display_name`,
        [sourceKey, sourceName]
      )
      : await client.query(
        `SELECT id, source_key, display_name
         FROM external_sources WHERE source_key = $1`,
        [sourceKey]
      );
    return result.rows[0];
  }

  async function recordFailure({ sourceKey, sourceName, userId, reason }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // A failed request must not let an untrusted payload rename an existing
      // source in discovery.  Only a completed successful sync may update
      // source-owned display metadata.
      const source = await ensureSource(client, sourceKey, sourceName, { updateDisplayName: false });
      const run = await client.query(
        `INSERT INTO r4_external_sync_runs
          (source_id, status, requested_by_user_id, failure_reason)
         VALUES ($1, 'failed', $2, $3)
         RETURNING id, finished_at`,
        [source.id, userId, reason]
      );
      await client.query(
        `UPDATE external_sources
         SET last_failure_at = $1, last_failure_reason = $2, updated_at = now()
         WHERE id = $3`,
        [run.rows[0].finished_at, reason, source.id]
      );
      await client.query("COMMIT");
      return { source, run: run.rows[0] };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function ensureAreas(client, names) {
    const areaIds = [];
    for (const name of names) {
      const result = await client.query(
        `INSERT INTO research_areas (name)
         VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name]
      );
      areaIds.push(result.rows[0].id);
    }
    return areaIds;
  }

  async function replaceAreas(client, opportunityId, names) {
    const areaIds = await ensureAreas(client, names);
    await client.query(
      "DELETE FROM industry_opportunity_areas WHERE opportunity_id = $1",
      [opportunityId]
    );
    for (const areaId of areaIds) {
      await client.query(
        `INSERT INTO industry_opportunity_areas (opportunity_id, research_area_id)
         VALUES ($1, $2)`,
        [opportunityId, areaId]
      );
    }
  }

  async function recordEvent(client, syncRunId, details) {
    await client.query(
      `INSERT INTO r4_external_sync_events
        (sync_run_id, opportunity_id, external_id, classification, changed_fields, details)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        syncRunId,
        details.opportunityId || null,
        details.externalId || "",
        details.classification,
        JSON.stringify(details.changedFields || []),
        details.message || "",
      ]
    );
  }

  async function externalRowsForSource(client, sourceId) {
    const rows = await client.query(
      `SELECT eo.opportunity_id, eo.external_id, eo.content_hash, eo.source_status,
              eo.last_known_content, eo.authoritative_url,
              o.title, o.description, o.application_deadline
       FROM external_opportunities eo
       JOIN industry_opportunities o ON o.id = eo.opportunity_id
       WHERE eo.source_id = $1
       FOR UPDATE OF eo, o`,
      [sourceId]
    );
    return new Map(rows.rows.map((row) => [row.external_id, row]));
  }

  async function syncFeed({ feed, userId }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const source = await ensureSource(client, feed.sourceKey, feed.sourceName);
      const createdRun = await client.query(
        `INSERT INTO r4_external_sync_runs
          (source_id, status, requested_by_user_id, source_synced_at)
         VALUES ($1, 'successful', $2, $3)
         RETURNING id`,
        [source.id, userId, feed.sourceSyncedAt]
      );
      const syncRunId = createdRun.rows[0].id;
      const existing = await externalRowsForSource(client, source.id);
      const seen = new Set();
      const counts = { new: 0, unchanged: 0, changed: 0, not_seen: 0, malformed: 0 };

      for (const rawRecord of feed.records) {
        const record = normaliseRecord(rawRecord);
        // Mark a known raw ID as handled before deciding whether its content
        // is usable.  Otherwise a malformed update could falsely mark a
        // previous valid record as absent and stale it during the sweep.
        if (record.externalId && seen.has(record.externalId)) {
          counts.malformed += 1;
          await recordEvent(client, syncRunId, {
            externalId: record.externalId,
            classification: "malformed",
            message: "duplicate external_id in one source response",
          });
          continue;
        }
        if (record.externalId) seen.add(record.externalId);
        if (record.error) {
          counts.malformed += 1;
          await recordEvent(client, syncRunId, {
            externalId: record.externalId,
            classification: "malformed",
            message: record.error,
          });
          continue;
        }

        const previous = existing.get(record.externalId);
        if (record.withdrawn) {
          if (!previous) {
            counts.malformed += 1;
            await recordEvent(client, syncRunId, {
              externalId: record.externalId,
              classification: "malformed",
              message: "withdrawn record does not match a previously imported opportunity",
            });
            continue;
          }
          const alreadyWithdrawn = previous.source_status === "withdrawn";
          await client.query(
            `UPDATE external_opportunities
             SET source_status = 'withdrawn', source_synced_at = $1, last_seen_at = now(),
                 last_changed_at = CASE WHEN source_status = 'withdrawn' THEN last_changed_at ELSE now() END,
                 changed_fields = CASE WHEN source_status = 'withdrawn'
                   THEN changed_fields ELSE '["source_status"]'::jsonb END,
                 updated_at = now()
             WHERE opportunity_id = $2`,
            [feed.sourceSyncedAt, previous.opportunity_id]
          );
          counts[alreadyWithdrawn ? "unchanged" : "changed"] += 1;
          await recordEvent(client, syncRunId, {
            opportunityId: previous.opportunity_id,
            externalId: record.externalId,
            classification: alreadyWithdrawn ? "unchanged" : "changed",
            changedFields: alreadyWithdrawn ? [] : ["source_status"],
            message: alreadyWithdrawn
              ? "Provider continues to mark this record withdrawn."
              : "Provider explicitly withdrew this record; last-known content remains available.",
          });
          continue;
        }
        if (!previous) {
          const insertedOpportunity = await client.query(
            `INSERT INTO industry_opportunities
              (submission_id, organisation_name, contact_name, contact_email,
               title, description, capacity, status, source_type,
               application_deadline, lifecycle_state, lifecycle_reason,
               r3_schedule_required)
             VALUES ($1, $2, 'External provider', $3, $4, $5, 'not-sure',
                     'supervised', 'external', $6, 'open', '', FALSE)
             RETURNING id`,
            [
              `external:${source.source_key}:${record.externalId}`,
              source.display_name,
              `${source.source_key.replace(/[^a-z0-9-]/gi, "-")}@external.invalid`,
              record.title,
              record.description,
              record.closes,
            ]
          );
          const opportunityId = insertedOpportunity.rows[0].id;
          await replaceAreas(client, opportunityId, record.areas);
          await client.query(
            `INSERT INTO external_opportunities
              (opportunity_id, source_id, external_id, authoritative_url,
               content_hash, source_status, source_synced_at, last_seen_at,
               last_changed_at, changed_fields, last_known_content)
             VALUES ($1, $2, $3, $4, $5, 'active', $6, now(), now(), '[]'::jsonb, $7::jsonb)`,
            [
              opportunityId,
              source.id,
              record.externalId,
              record.authoritativeUrl,
              record.contentHash,
              feed.sourceSyncedAt,
              JSON.stringify(record.content),
            ]
          );
          counts.new += 1;
          await recordEvent(client, syncRunId, {
            opportunityId,
            externalId: record.externalId,
            classification: "new",
            message: "Imported as an external opportunity.",
          });
          continue;
        }

        if (previous.content_hash === record.contentHash) {
          const reactivated = previous.source_status === "withdrawn";
          await client.query(
            `UPDATE external_opportunities
             SET source_status = 'active', source_synced_at = $1,
                 last_seen_at = now(),
                 last_changed_at = CASE WHEN source_status = 'withdrawn' THEN now() ELSE last_changed_at END,
                 changed_fields = CASE WHEN source_status = 'withdrawn'
                   THEN '["source_status"]'::jsonb ELSE changed_fields END,
                 updated_at = now()
             WHERE opportunity_id = $2`,
            [feed.sourceSyncedAt, previous.opportunity_id]
          );
          counts[reactivated ? "changed" : "unchanged"] += 1;
          await recordEvent(client, syncRunId, {
            opportunityId: previous.opportunity_id,
            externalId: record.externalId,
            classification: reactivated ? "changed" : "unchanged",
            changedFields: reactivated ? ["source_status"] : [],
            message: reactivated
              ? "Previously withdrawn record reappeared in the provider feed."
              : previous.source_status === "not-seen"
              ? "Record reappeared with its last-known source content."
              : "Source content is unchanged.",
          });
          continue;
        }

        const fields = changedFields(previous.last_known_content, record);
        if (previous.source_status === "withdrawn") fields.unshift("source_status");
        await client.query(
          `UPDATE industry_opportunities
           SET organisation_name = $1, title = $2, description = $3,
               application_deadline = $4, updated_at = now()
           WHERE id = $5`,
          [source.display_name, record.title, record.description, record.closes, previous.opportunity_id]
        );
        await replaceAreas(client, previous.opportunity_id, record.areas);
        await client.query(
          `UPDATE external_opportunities
             SET authoritative_url = $1, content_hash = $2, source_status = 'active',
               source_synced_at = $3, last_seen_at = now(), last_changed_at = now(),
               changed_fields = $4::jsonb, last_known_content = $5::jsonb, updated_at = now()
           WHERE opportunity_id = $6`,
          [
            record.authoritativeUrl,
            record.contentHash,
            feed.sourceSyncedAt,
            JSON.stringify(fields),
            JSON.stringify(record.content),
            previous.opportunity_id,
          ]
        );
        counts.changed += 1;
        await recordEvent(client, syncRunId, {
          opportunityId: previous.opportunity_id,
          externalId: record.externalId,
          classification: "changed",
          changedFields: fields,
          message: `Source-controlled fields changed: ${fields.join(", ") || "content"}.`,
        });
      }

      for (const [externalId, previous] of existing) {
        if (seen.has(externalId)) continue;
        await client.query(
          `UPDATE external_opportunities
           SET source_status = 'not-seen', source_synced_at = $1, updated_at = now()
           WHERE opportunity_id = $2`,
          [feed.sourceSyncedAt, previous.opportunity_id]
        );
        counts.not_seen += 1;
        await recordEvent(client, syncRunId, {
          opportunityId: previous.opportunity_id,
          externalId,
          classification: "not-seen",
          message: previous.source_status === "not-seen"
            ? "Still absent from this successful source sync; last-known data remains available."
            : "Absent from this successful source sync; last-known data remains available.",
        });
      }

      const finished = await client.query(
        `UPDATE r4_external_sync_runs
         SET finished_at = now(), new_count = $1, unchanged_count = $2,
             changed_count = $3, not_seen_count = $4, malformed_count = $5
         WHERE id = $6
         RETURNING id, status, source_synced_at, finished_at, new_count,
                   unchanged_count, changed_count, not_seen_count, malformed_count`,
        [counts.new, counts.unchanged, counts.changed, counts.not_seen, counts.malformed, syncRunId]
      );
      await client.query(
        `UPDATE external_sources
         SET last_successful_sync_at = $1, last_successful_source_at = $2, updated_at = now()
         WHERE id = $3`,
        [finished.rows[0].finished_at, feed.sourceSyncedAt, source.id]
      );
      await client.query("COMMIT");
      return { source, run: finished.rows[0], counts };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /* R4-08–R4-14.  Only an operator can run the source adapter. */
  app.post("/api/external-sync", async (request, response) => {
    const operator = await requireOperator(request, response);
    if (!operator) return;

    let rawFeed;
    let fallbackSource = defaultSource;
    try {
      if (request.body?.simulate_failure === true) {
        throw badRequest("Simulated provider failure requested by the evaluator.");
      }
      rawFeed = request.body?.feed || fixtureFeed(request.body?.fixture || "v1");
      if (rawFeed && typeof rawFeed === "object") {
        fallbackSource = {
          key: text(rawFeed.source_id) || defaultSource.key,
          name: text(rawFeed.source_name) || defaultSource.name,
        };
      }
      const feed = normaliseFeed(rawFeed);
      const result = await syncFeed({ feed, userId: operator.id });
      response.status(201).json({
        ok: true,
        source: { key: result.source.source_key, name: result.source.display_name },
        sync: result.run,
      });
    } catch (error) {
      const reason = error.message || "External provider unavailable.";
      try {
        await recordFailure({
          sourceKey: fallbackSource.key,
          sourceName: fallbackSource.name,
          userId: operator.id,
          reason,
        });
      } catch (recordError) {
        console.error("Could not record external sync failure:", recordError.message);
      }
      response.status(error.status === 400 ? 502 : error.status || 500).json({
        error: reason,
        unchanged: true,
      });
    }
  });

  /* R4-14: technical health is an authorized operator surface, never a
     public discovery field. */
  app.get("/api/external-sync/health", async (request, response) => {
    const operator = await requireOperator(request, response);
    if (!operator) return;
    try {
      const sources = await pool.query(
        `SELECT es.source_key, es.display_name, es.last_successful_sync_at,
                es.last_successful_source_at, es.last_failure_at, es.last_failure_reason,
                latest.id AS last_run_id, latest.status AS last_run_status,
                latest.finished_at AS last_run_at, latest.failure_reason,
                successful.id AS last_successful_run_id,
                successful.finished_at AS last_successful_run_at,
                successful.new_count AS last_successful_new_count,
                successful.unchanged_count AS last_successful_unchanged_count,
                successful.changed_count AS last_successful_changed_count,
                successful.not_seen_count AS last_successful_not_seen_count,
                successful.malformed_count AS last_successful_malformed_count
         FROM external_sources es
         LEFT JOIN LATERAL (
           SELECT * FROM r4_external_sync_runs runs
           WHERE runs.source_id = es.id
           ORDER BY runs.finished_at DESC, runs.id DESC
           LIMIT 1
         ) latest ON TRUE
         LEFT JOIN LATERAL (
           SELECT * FROM r4_external_sync_runs runs
           WHERE runs.source_id = es.id AND runs.status = 'successful'
           ORDER BY runs.finished_at DESC, runs.id DESC
           LIMIT 1
         ) successful ON TRUE
         ORDER BY es.display_name`
      );
      response.json(sources.rows);
    } catch (error) {
      responseError(response, error, "Unable to load external-source health.");
    }
  });

  app.get("/api/external-sync/runs", async (request, response) => {
    const operator = await requireOperator(request, response);
    if (!operator) return;
    try {
      const result = await pool.query(
        `SELECT runs.id, source.source_key, source.display_name AS source_name,
                runs.status, runs.source_synced_at, runs.started_at, runs.finished_at,
                runs.new_count, runs.unchanged_count, runs.changed_count,
                runs.not_seen_count, runs.malformed_count, runs.failure_reason
         FROM r4_external_sync_runs runs
         JOIN external_sources source ON source.id = runs.source_id
         ORDER BY runs.finished_at DESC, runs.id DESC
         LIMIT 20`
      );
      response.json(result.rows);
    } catch (error) {
      responseError(response, error, "Unable to load external sync runs.");
    }
  });

  // Per-record classifications make the supplied v1/v2 acceptance fixture
  // inspectable without exposing technical sync logs to students or visitors.
  app.get("/api/external-sync/runs/:runId/events", async (request, response) => {
    const operator = await requireOperator(request, response);
    if (!operator) return;
    try {
      const run = await pool.query(
        `SELECT id FROM r4_external_sync_runs WHERE id = $1`,
        [request.params.runId]
      );
      if (!run.rows[0]) return response.status(404).json({ error: "Sync run not found." });
      const events = await pool.query(
        `SELECT external_id, classification, changed_fields, details, created_at
         FROM r4_external_sync_events
         WHERE sync_run_id = $1
         ORDER BY CASE classification
           WHEN 'new' THEN 1
           WHEN 'unchanged' THEN 2
           WHEN 'changed' THEN 3
           WHEN 'not-seen' THEN 4
           WHEN 'malformed' THEN 5
           ELSE 6
         END, external_id`,
        [request.params.runId]
      );
      response.json(events.rows);
    } catch (error) {
      responseError(response, error, "Unable to load external sync classifications.");
    }
  });

  /* R4-18 through R4-20: local support is not a provider endorsement and is
     deliberately not the R2 supervisor/willingness relation. */
  app.put("/api/external-opportunities/:identifier/interest", async (request, response) => {
    const client = await pool.connect();
    try {
      const identity = await verifiedFaculty(client, request, response);
      if (!identity) return;
      const identifier = text(request.params.identifier);
      const external = await client.query(
        `SELECT eo.opportunity_id
         FROM external_opportunities eo
         JOIN industry_opportunities o ON o.id = eo.opportunity_id
         WHERE o.id::text = $1 OR o.submission_id = $1
         LIMIT 1`,
        [identifier]
      );
      if (!external.rows[0]) {
        return response.status(404).json({ error: "External opportunity not found." });
      }

      const opportunityId = external.rows[0].opportunity_id;
      const interested = request.body?.interested !== false;
      await client.query("BEGIN");
      if (interested) {
        await client.query(
          `INSERT INTO external_faculty_interests (opportunity_id, faculty_id)
           VALUES ($1, $2)
           ON CONFLICT (opportunity_id, faculty_id)
           DO UPDATE SET updated_at = now()`,
          [opportunityId, identity.faculty.id]
        );
      } else {
        await client.query(
          `DELETE FROM external_faculty_interests
           WHERE opportunity_id = $1 AND faculty_id = $2`,
          [opportunityId, identity.faculty.id]
        );
      }
      const count = await client.query(
        "SELECT COUNT(*)::int AS count FROM external_faculty_interests WHERE opportunity_id = $1",
        [opportunityId]
      );
      await client.query("COMMIT");
      response.json({
        opportunity_id: opportunityId,
        interested,
        support_count: count.rows[0].count,
        message: interested
          ? "Your Algoma-local support has been recorded; it does not indicate provider endorsement."
          : "Your Algoma-local support has been removed.",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      responseError(response, error, "Unable to update local faculty support.");
    } finally {
      client.release();
    }
  });
};
