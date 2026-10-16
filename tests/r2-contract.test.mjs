import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

test("R2 schema persists intake, supervision, subscriptions, and notifications", () => {
  const schema = read("schema.sql");
  for (const table of [
    "industry_opportunities",
    "industry_opportunity_supervisors",
    "faculty_opportunity_subscriptions",
    "faculty_notifications",
  ]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(schema, /CHECK \(status IN \('awaiting-supervisor', 'supervised'\)\)/);
});

test("R2 server exposes public intake and protected coordination endpoints", () => {
  const routes = read("backend/r2-routes.js");
  for (const endpoint of [
    'app.post("/api/intake"',
    'app.get("/api/opportunities"',
    'app.get("/api/faculty/opportunities"',
    'app.put("/api/opportunities/:id/willingness"',
    'app.put("/api/opportunities/:id/engagement"',
    'app.put("/api/faculty/me/subscriptions"',
  ]) assert.ok(routes.includes(endpoint), `missing ${endpoint}`);
  assert.match(routes, /Verified faculty authorization required/);
  assert.match(routes, /DELETE FROM industry_opportunity_supervisors/);
});

test("public UI escapes untrusted opportunity text and identifies the source", () => {
  const app = read("frontend/app.js");
  assert.match(app, /replaceAll\("<", "&lt;"\)/);
  assert.match(app, /Industry opportunity/);
  assert.ok(!app.includes("innerHTML = item.description"));
});

test("official R2 fixture is tracked with expected capacities and duplicate partner submissions", () => {
  const intake = JSON.parse(read("backend/r2_fixture/intake_submissions.json"));
  const outcomes = JSON.parse(read("backend/r2_fixture/expected_intake_outcomes.json"));
  assert.deepEqual(outcomes.accepted_submission_ids, ["S-201", "S-202", "S-203", "S-205", "S-206"]);
  assert.deepEqual(outcomes.rejected_submission_ids, ["S-204"]);
  assert.equal(intake.find((item) => item.fixture_id === "S-201").capacity, "one-team-only");
  assert.equal(intake.filter((item) => item.organisation === "Northwind Robotics").length, 2);
});
