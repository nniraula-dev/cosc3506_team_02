/*
 * Stateful end-to-end verification for the R4 synthetic source fixture.
 *
 * Run only after schema.sql and the R1/R2/R3 seed scripts in a disposable or
 * reset-controlled database.  The script runs v1, v2, a repeat v2, a failed
 * sync, and a v1 reappearance; reset with `npm run reset:r4` afterwards.
 *
 * R4_API_BASE_URL=https://your-backend.example R4_QA_ALLOW_MUTATION=yes \
 *   npm --prefix backend run verify:r4-api
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const baseUrl = (process.env.R4_API_BASE_URL || process.argv[2] || "").replace(/\/$/, "");

if (!baseUrl) throw new Error("Set R4_API_BASE_URL (or pass the API base URL as the first argument).");
if (process.env.R4_QA_ALLOW_MUTATION !== "yes") {
  throw new Error("R4 QA changes controlled synthetic fixture state. Re-run with R4_QA_ALLOW_MUTATION=yes.");
}

const accounts = {
  operator: "r3.staff@algomau.ca",
  faculty: "r3.priya@algomau.ca",
  student: "r3.s01@algomau.ca",
};

function fixture(name) {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "r4_fixture", name), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function expect(path, options, status, label) {
  const result = await api(path, options);
  assert(
    result.status === status,
    `${label}: expected HTTP ${status}, received ${result.status}${result.payload?.error ? ` (${result.payload.error})` : ""}`
  );
  return result.payload;
}

async function signIn(email) {
  const request = await expect("/api/auth/request", { method: "POST", body: { email } }, 200, `request sign-in for ${email}`);
  const result = await expect(
    "/api/auth/verify",
    { method: "POST", body: { email, challenge_code: request.challenge_code } },
    200,
    `verify sign-in for ${email}`
  );
  assert(typeof result.token === "string" && result.token.length > 20, `No usable token for ${email}.`);
  return result.token;
}

function externalById(opportunities, externalId) {
  const record = opportunities.find((item) => item.source_type === "external" && item.submission_id === `external:mitacs-demo:${externalId}`);
  assert(record, `Missing external opportunity ${externalId}.`);
  return record;
}

async function externalOpportunities(token) {
  const records = await expect("/api/opportunities", { token }, 200, "external opportunity discovery");
  return records.filter((item) => item.source_type === "external");
}

async function main() {
  console.log(`R4 API QA starting against ${baseUrl}`);
  console.log("This changes only synthetic R4 fixture state. Reset with R4_QA_ALLOW_RESET=yes npm --prefix backend run reset:r4 afterwards.");

  const health = await expect("/api/health", {}, 200, "backend health");
  assert(health.ok === true, "Backend health did not report ok.");
  const [operator, faculty, student] = await Promise.all([
    signIn(accounts.operator), signIn(accounts.faculty), signIn(accounts.student),
  ]);

  await expect("/api/external-sync", { method: "POST", token: student, body: { fixture: "v1" } }, 403, "student cannot trigger source sync");
  await expect("/api/external-sync/health", { token: student }, 403, "student cannot read source health");

  const v1 = await expect("/api/external-sync", { method: "POST", token: operator, body: { fixture: "v1" } }, 201, "operator runs v1");
  assert(v1.sync.new_count === 4 && v1.sync.malformed_count === 0, "v1 must import four usable external records.");
  const afterV1 = await externalOpportunities();
  assert(afterV1.length === 4, `v1 must expose four external records, received ${afterV1.length}.`);
  const mx1002 = externalById(afterV1, "MX-1002");
  const mx1003 = externalById(afterV1, "MX-1003");
  assert(mx1002.authoritative_url.includes("mitacs.example"), "External authoritative URL was not preserved.");
  await expect(`/api/external-opportunities/${mx1002.id}/interest`, { method: "PUT", token: faculty, body: { interested: true } }, 200, "record local support on changed record");
  await expect(`/api/external-opportunities/${mx1003.id}/interest`, { method: "PUT", token: faculty, body: { interested: true } }, 200, "record local support on disappearing record");
  console.log("✓ v1 imports four externally owned records and faculty can record local support");

  // A bad update that still identifies an existing record must be skipped;
  // it must not make the previous valid record look absent or stale.
  const malformedKnown = fixture("external_source_feed_v1.json");
  malformedKnown.records = malformedKnown.records.map((record) => (
    record.external_id === "MX-1002" ? { ...record, closes: "not-a-date" } : record
  ));
  const malformedKnownResult = await expect(
    "/api/external-sync",
    { method: "POST", token: operator, body: { feed: malformedKnown } },
    201,
    "skip malformed update to an existing record"
  );
  assert(
    malformedKnownResult.sync.unchanged_count === 3
      && malformedKnownResult.sync.not_seen_count === 0
      && malformedKnownResult.sync.malformed_count === 1,
    "A malformed identified update must not stale an existing record."
  );
  const afterMalformedKnown = externalById(await externalOpportunities(faculty), "MX-1002");
  assert(
    afterMalformedKnown.external_status === "active" && afterMalformedKnown.title === mx1002.title,
    "Malformed source content overwrote or staled MX-1002."
  );
  console.log("✓ malformed identified source data is skipped without corrupting last-known content");

  const v2 = await expect("/api/external-sync", { method: "POST", token: operator, body: { fixture: "v2" } }, 201, "operator runs v2");
  assert(v2.sync.new_count === 1 && v2.sync.unchanged_count === 2 && v2.sync.changed_count === 1 && v2.sync.not_seen_count === 1 && v2.sync.malformed_count === 1, "v2 classification counts do not match the supplied fixture.");
  const events = await expect(`/api/external-sync/runs/${v2.sync.id}/events`, { token: operator }, 200, "operator reads v2 classifications");
  const classifications = new Map(events.map((event) => [event.external_id, event.classification]));
  assert(classifications.get("MX-1001") === "unchanged" && classifications.get("MX-1002") === "changed" && classifications.get("MX-1003") === "not-seen" && classifications.get("MX-1005") === "new", "v2 events do not classify supplied fixture records correctly.");
  const afterV2 = await externalOpportunities(faculty);
  const changed = externalById(afterV2, "MX-1002");
  const absent = externalById(afterV2, "MX-1003");
  const untrusted = externalById(afterV2, "MX-1005");
  assert(changed.title.includes("extended") && changed.external_support_count >= 1, "Changed record lost local faculty support.");
  assert(absent.external_status === "not-seen", "Missing record must retain a not-seen state.");
  assert(untrusted.description.includes("<script>") && untrusted.external_source_key === "mitacs-demo", "Untrusted record must remain ordinary external data.");
  await expect(`/api/opportunities/${changed.id}/lifecycle`, {}, 403, "local lifecycle is rejected for external record");
  console.log("✓ v2 classifies new, changed, unchanged, absent, and malformed data without overwriting support");

  const repeat = await expect("/api/external-sync", { method: "POST", token: operator, body: { fixture: "v2" } }, 201, "operator repeats v2");
  assert(repeat.sync.new_count === 0 && repeat.sync.changed_count === 0 && repeat.sync.unchanged_count === 4 && repeat.sync.not_seen_count === 1, "repeat v2 must not create duplicates or spurious changes.");

  // A provider withdrawal is not the same as absence.  The source can send a
  // minimal withdrawal record; its last-known content and local support stay.
  const withdrawalFeed = fixture("external_source_feed_v2.json");
  withdrawalFeed.records = withdrawalFeed.records.map((record) => (
    record.external_id === "MX-1002" ? { external_id: "MX-1002", withdrawn: true } : record
  ));
  const withdrawal = await expect(
    "/api/external-sync",
    { method: "POST", token: operator, body: { feed: withdrawalFeed } },
    201,
    "record explicit provider withdrawal"
  );
  assert(
    withdrawal.sync.changed_count === 1 && withdrawal.sync.not_seen_count === 1 && withdrawal.sync.malformed_count === 1,
    "Explicit withdrawal was not classified while the remaining feed continued."
  );
  const withdrawn = externalById(await externalOpportunities(faculty), "MX-1002");
  assert(
    withdrawn.external_status === "withdrawn" && withdrawn.title.includes("extended") && withdrawn.external_support_count >= 1,
    "Explicit withdrawal did not preserve content and local support."
  );
  const reactivated = await expect("/api/external-sync", { method: "POST", token: operator, body: { fixture: "v2" } }, 201, "reactivate withdrawn record");
  assert(reactivated.sync.changed_count === 1, "A withdrawn record reappearing must be visible as a source-state change.");
  assert(externalById(await externalOpportunities(faculty), "MX-1002").external_status === "active", "Reappearing record remained withdrawn.");
  console.log("✓ explicit withdrawal stays distinct from absence and can reappear safely");

  const beforeFailure = await externalOpportunities(faculty);
  await expect("/api/external-sync", { method: "POST", token: operator, body: { simulate_failure: true } }, 502, "record a simulated source failure");
  await expect(
    "/api/external-sync",
    {
      method: "POST",
      token: operator,
      body: { feed: { source_id: "mitacs-demo", source_name: "Untrusted failed rename", synced_at: "not-a-date", records: [] } },
    },
    502,
    "reject a malformed source response"
  );
  const afterFailure = await externalOpportunities(faculty);
  assert(
    afterFailure.length === beforeFailure.length
      && externalById(afterFailure, "MX-1002").title === externalById(beforeFailure, "MX-1002").title
      && externalById(afterFailure, "MX-1002").external_source_name === externalById(beforeFailure, "MX-1002").external_source_name,
    "Failed sync changed last-known external data or source provenance."
  );
  const failureHealth = await expect("/api/external-sync/health", { token: operator }, 200, "operator observes failed sync health");
  assert(
    failureHealth[0]?.last_failure_reason && failureHealth[0]?.last_successful_run_id,
    "Failed sync did not expose a reason and retain the latest successful health record."
  );
  console.log("✓ repeat sync is idempotent and failure preserves last-known external data");

  await expect("/api/external-sync", { method: "POST", token: operator, body: { fixture: "v1" } }, 201, "operator re-runs v1 to reintroduce MX-1003");
  const reappeared = externalById(await externalOpportunities(faculty), "MX-1003");
  assert(reappeared.external_status === "active" && reappeared.external_support_count >= 1, "Chosen R4-20 support did not survive disappearance and reappearance.");
  console.log("✓ R4-20 local support survives change, disappearance, and reappearance");
  console.log("R4 API QA PASS");
}

main().catch((error) => {
  console.error(`R4 API QA FAIL: ${error.message}`);
  process.exitCode = 1;
});
