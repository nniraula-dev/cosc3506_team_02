import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

test("R4 schema distinguishes source-owned fields, local support, and sync history", () => {
  const schema = read("schema.sql");
  for (const table of [
    "external_sources",
    "external_opportunities",
    "external_faculty_interests",
    "r4_external_sync_runs",
    "r4_external_sync_events",
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /'industry', 'faculty', 'external'/);
  assert.match(schema, /source_status IN \('active', 'not-seen', 'withdrawn'\)/);
  assert.match(schema, /UNIQUE \(source_id, external_id\)/);
  assert.match(schema, /last_successful_sync_at/);
  assert.match(schema, /last_failure_reason/);
});

test("R4 adapter is role-gated, repeatable, and retains last-known content", () => {
  const routes = read("backend/r4-routes.js");
  for (const endpoint of [
    'app.post("/api/external-sync"',
    'app.get("/api/external-sync/health"',
    'app.get("/api/external-sync/runs"',
    'app.get("/api/external-sync/runs/:runId/events"',
    'app.put("/api/external-opportunities/:identifier/interest"',
  ]) assert.ok(routes.includes(endpoint), `missing ${endpoint}`);
  assert.match(routes, /Operator authorization required/);
  assert.match(routes, /Verified faculty authorization required/);
  assert.match(routes, /classification: "malformed"/);
  assert.match(routes, /source_status = 'not-seen'/);
  assert.match(routes, /last-known data remains available/);
  assert.match(routes, /sourceStatus === "withdrawn"/);
  assert.match(routes, /Provider explicitly withdrew this record/);
  assert.match(routes, /if \(record\.externalId\) seen\.add\(record\.externalId\)/);
  assert.match(routes, /updateDisplayName: false/);
  assert.doesNotMatch(routes, /OR eo\.external_id = \$1/);
  assert.match(routes, /ON CONFLICT \(opportunity_id, faculty_id\)/);
  assert.match(routes, /simulate_failure/);
  assert.match(routes, /unchanged: true/);
});

test("R4 fixture exposes the required v1-to-v2 source changes and untrusted content", () => {
  const v1 = JSON.parse(read("backend/r4_fixture/external_source_feed_v1.json"));
  const v2 = JSON.parse(read("backend/r4_fixture/external_source_feed_v2.json"));
  const expected = JSON.parse(read("backend/r4_fixture/expected_sync_results.json"));
  assert.equal(v1.records.length, 4);
  assert.equal(v2.records.length, 5);
  assert.deepEqual(expected.new_external_ids, ["MX-1005"]);
  assert.deepEqual(expected.changed_external_ids, ["MX-1002"]);
  assert.deepEqual(expected.not_seen_external_ids, ["MX-1003"]);
  assert.match(v2.records.find((record) => record.external_id === "MX-1005").description, /<script>/);
});

test("R4 discovery keeps external records outside local lifecycle and supervisor rules", () => {
  const r2Routes = read("backend/r2-routes.js");
  const r3Routes = read("backend/r3-routes.js");
  assert.match(r2Routes, /UNION ALL/);
  assert.match(r2Routes, /JOIN external_opportunities external/);
  assert.match(r2Routes, /external_support_count/);
  assert.match(r2Routes, /COUNT\(DISTINCT interest\.faculty_id\)::int AS external_support_count/);
  assert.match(r2Routes, /External opportunities use separate Algoma-local support/);
  assert.match(r3Routes, /External opportunities are source-controlled and cannot use local lifecycle or match actions/);
});

test("R4 frontend labels source ownership and safely renders provider content", () => {
  const app = read("frontend/app.js");
  const page = read("frontend/index.html");
  assert.match(app, /function safeExternalLink/);
  assert.match(app, /escapeHtml\(item\.description\)/);
  assert.match(app, /External opportunity ·/);
  assert.match(app, /Algoma provides this discovery copy/);
  assert.match(app, /Provider withdrew this listing/);
  assert.match(app, /Last successful source sync/);
  assert.match(app, /data-external-interest/);
  assert.match(app, /\/api\/external-sync\/health/);
  assert.match(page, /id="operator-workspace"/);
  assert.match(page, /id="external-faculty-opportunities"/);
});
