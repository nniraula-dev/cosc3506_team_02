import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

test("R1 schema contains the tables and columns required by authenticated management", () => {
  const schema = read("schema.sql");

  for (const requiredFragment of [
    "CREATE TABLE IF NOT EXISTS auth_challenges",
    "CREATE TABLE IF NOT EXISTS auth_sessions",
    "ADD COLUMN IF NOT EXISTS user_id",
    "ADD COLUMN IF NOT EXISTS prerequisite",
  ]) {
    assert.match(schema, new RegExp(requiredFragment));
  }
});

test("the own-projects route is registered before the dynamic project route", () => {
  const server = read("backend/server.js");
  const mineRoute = server.indexOf('app.get("/api/projects/mine"');
  const dynamicRoute = server.indexOf('app.get("/api/projects/:fixtureId"');

  assert.ok(mineRoute >= 0, "missing /api/projects/mine route");
  assert.ok(dynamicRoute >= 0, "missing dynamic project route");
  assert.ok(mineRoute < dynamicRoute, "dynamic project route captures /mine");
});

test("production frontend configuration uses the deployed HTTPS backend", () => {
  const config = read("frontend/config.js");
  const match = config.match(/window\.API_BASE_URL\s*=\s*"([^"]+)"/);

  assert.ok(match, "API base URL is not configured");
  assert.match(match[1], /^https:\/\//);
  assert.ok(!match[1].endsWith("/"), "API base URL must not have a trailing slash");
});
