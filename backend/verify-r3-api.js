/*
 * Stateful deployed-API QA for the official R3 fixture.
 *
 * Run only after `npm run seed:r3` against a disposable/controlled fixture
 * reset.  It deliberately creates match proposals and an outcome on O-303,
 * then leaves those R3-only changes visible for inspection.  Reset immediately
 * afterwards with `npm run seed:r3`.
 *
 * Example:
 * R3_API_BASE_URL=https://your-backend.example R3_QA_ALLOW_MUTATION=yes \
 *   npm --prefix backend run verify:r3-api
 */
const baseUrl = (process.env.R3_API_BASE_URL || process.argv[2] || "").replace(/\/$/, "");

if (!baseUrl) {
  throw new Error("Set R3_API_BASE_URL (or pass the API base URL as the first argument).");
}
if (process.env.R3_QA_ALLOW_MUTATION !== "yes") {
  throw new Error("This QA creates controlled R3 fixture records. Re-run with R3_QA_ALLOW_MUTATION=yes.");
}

const accounts = {
  faculty: "r3.priya@algomau.ca",
  facultyAlex: "r3.alex@algomau.ca",
  facultyJordan: "r3.jordan@algomau.ca",
  s01: "r3.s01@algomau.ca",
  s05: "r3.s05@algomau.ca",
  s08: "r3.s08@algomau.ca",
  s11: "r3.s11@algomau.ca",
};

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
  const request = await expect(
    "/api/auth/request",
    { method: "POST", body: { email } },
    200,
    `request test-mode sign-in for ${email}`
  );
  assert(request.test_mode === true && /^\d{6}$/.test(String(request.challenge_code || "")), `No usable test-mode code for ${email}.`);
  const verified = await expect(
    "/api/auth/verify",
    { method: "POST", body: { email, challenge_code: request.challenge_code } },
    200,
    `verify test-mode sign-in for ${email}`
  );
  assert(typeof verified.token === "string" && verified.token.length > 20, `No session token returned for ${email}.`);
  return verified.token;
}

function matchId(match) {
  const identifier = match.fixture_id || match.id;
  assert(identifier !== undefined && identifier !== null, "The API did not return a match identifier.");
  return encodeURIComponent(identifier);
}

function includesOutcome(outcomes, summary) {
  return outcomes.some((outcome) => outcome.summary === summary);
}

async function main() {
  console.log(`R3 API QA starting against ${baseUrl}`);
  console.log("This test mutates only the controlled O-303 R3 fixture path. Reset with npm run seed:r3 after it finishes.");

  const health = await expect("/api/health", {}, 200, "backend health");
  assert(health.ok === true && health.database === "reachable", "Backend health did not confirm a reachable database.");

  const [faculty, facultyAlex, facultyJordan, s01, s05, s08, s11] = await Promise.all([
    signIn(accounts.faculty),
    signIn(accounts.facultyAlex),
    signIn(accounts.facultyJordan),
    signIn(accounts.s01),
    signIn(accounts.s05),
    signIn(accounts.s08),
    signIn(accounts.s11),
  ]);

  const initialLifecycle = await expect("/api/opportunities/O-303/lifecycle", {}, 200, "initial O-303 lifecycle");
  assert(initialLifecycle.lifecycle_state === "open", `O-303 must start open, not ${initialLifecycle.lifecycle_state}. Seed the R3 fixture first.`);

  const initialShowcase = await expect("/api/showcase", {}, 200, "initial showcase");
  const initialIds = new Set(initialShowcase.map((outcome) => outcome.fixture_id));
  assert(initialIds.has("R-501"), "R-501 should be publicly showcase-eligible in the fresh fixture.");
  assert(!initialIds.has("R-502") && !initialIds.has("R-503"), "R-502/R-503 must remain off the public showcase in the fresh fixture.");
  console.log("✓ fixture baseline: O-303 open; only eligible supplied outcome is public");

  const expiredBeforeRenewal = await expect("/api/opportunities/O-302/lifecycle", {}, 200, "O-302 before renewal");
  assert(expiredBeforeRenewal.lifecycle_state === "expired", "O-302 must begin expired in the fresh fixture.");
  const renewedExpired = await expect(
    "/api/opportunities/O-302/renew",
    { method: "POST", token: facultyAlex, body: { target_term: "2027W", deadline: "2026-12-20" } },
    201,
    "renew expired O-302"
  );
  assert(renewedExpired.opportunity_id === expiredBeforeRenewal.opportunity_id, "Renewal must retain O-302's opportunity identity.");
  const completedBeforeRenewal = await expect("/api/opportunities/O-306/lifecycle", {}, 200, "O-306 before renewal");
  assert(completedBeforeRenewal.lifecycle_state === "completed", "O-306 must begin completed in the fresh fixture.");
  const renewedCompleted = await expect(
    "/api/opportunities/O-306/renew",
    { method: "POST", token: facultyJordan, body: { target_term: "2027W", deadline: "2026-12-20" } },
    201,
    "renew completed O-306"
  );
  assert(renewedCompleted.opportunity_id === completedBeforeRenewal.opportunity_id, "Renewal must retain O-306's opportunity identity.");
  const afterRenewalDiscovery = await expect("/api/opportunities", {}, 200, "discovery after renewal");
  assert(afterRenewalDiscovery.some((item) => item.submission_id === "O-302"), "Renewed O-302 must re-enter ordinary discovery.");
  assert(afterRenewalDiscovery.some((item) => item.submission_id === "O-306"), "Renewed O-306 must re-enter ordinary discovery despite its old confirmed match.");
  const showcaseAfterRenewal = await expect("/api/showcase", {}, 200, "showcase after renewal");
  assert(showcaseAfterRenewal.some((outcome) => outcome.fixture_id === "R-501"), "Renewing O-306 must retain its earlier outcome in the showcase.");
  const withdrawnBeforeRestore = await expect("/api/opportunities/O-305/lifecycle", {}, 200, "O-305 before restore");
  const restored = await expect(
    "/api/opportunities/O-305/lifecycle",
    { method: "PATCH", token: faculty, body: { lifecycle_state: "open", reason: "Controlled QA restoration check" } },
    200,
    "restore mistakenly withdrawn O-305"
  );
  assert(restored.lifecycle_state === "open", "An authorized restore must return O-305 to active availability.");
  const withdrawnAfterRestore = await expect("/api/opportunities/O-305/lifecycle", {}, 200, "O-305 after restore");
  assert(withdrawnAfterRestore.opportunity_id === withdrawnBeforeRestore.opportunity_id, "Restoring O-305 must not recreate a new opportunity.");
  console.log("✓ renewals preserve identity/outcomes and restore preserves the original record");

  const declinedProposal = await expect(
    "/api/opportunities/O-303/matches",
    { method: "POST", token: faculty, body: { student_ids: ["S08"] } },
    201,
    "create decline scenario"
  );
  const declined = await expect(
    `/api/matches/${matchId(declinedProposal)}/decline`,
    { method: "POST", token: s08, body: {} },
    200,
    "decline invited proposal"
  );
  assert(declined.state === "declined", "A declined proposal must remain a declined record.");
  await expect(
    `/api/matches/${matchId(declinedProposal)}/withdraw`,
    { method: "POST", token: faculty, body: {} },
    400,
    "preserve declined proposal instead of overwriting it as withdrawn"
  );
  const afterDecline = await expect(`/api/matches/${matchId(declinedProposal)}`, { token: faculty }, 200, "read declined proposal as faculty");
  assert(afterDecline.state === "declined", "Declining must not delete the match record.");

  const withdrawnProposal = await expect(
    "/api/opportunities/O-303/matches",
    { method: "POST", token: faculty, body: { student_ids: ["S11"] } },
    201,
    "create withdrawal scenario"
  );
  const withdrawn = await expect(
    `/api/matches/${matchId(withdrawnProposal)}/withdraw`,
    { method: "POST", token: faculty, body: {} },
    200,
    "withdraw unconfirmed proposal"
  );
  assert(withdrawn.state === "withdrawn", "A withdrawn proposal must remain a withdrawn record.");
  const afterWithdraw = await expect(`/api/matches/${matchId(withdrawnProposal)}`, { token: faculty }, 200, "read withdrawn proposal as faculty");
  assert(afterWithdraw.state === "withdrawn", "Withdrawing must not delete the match record.");
  const stillOpen = await expect("/api/opportunities/O-303/lifecycle", {}, 200, "O-303 after decline/withdraw");
  assert(stillOpen.lifecycle_state === "open", "A declined or withdrawn proposal must not delete or close O-303.");
  console.log("✓ decline and withdrawal remain visible records without deleting the opportunity");

  const proposed = await expect(
    "/api/opportunities/O-303/matches",
    { method: "POST", token: faculty, body: { student_ids: ["S01", "S05"] } },
    201,
    "create two-student mutual-match scenario"
  );
  const proposedId = matchId(proposed);
  assert(proposed.state === "proposed", "A faculty proposal must start proposed, not confirmed.");

  await expect(
    `/api/matches/${proposedId}/confirm`,
    { method: "POST", token: s08, body: {} },
    403,
    "reject uninvolved student confirmation"
  );
  const partlyConfirmed = await expect(
    `/api/matches/${proposedId}/confirm`,
    { method: "POST", token: s01, body: {} },
    200,
    "first student confirmation"
  );
  assert(partlyConfirmed.state === "partly-confirmed", "The first of two student confirmations must remain partly confirmed.");
  const afterFirstConfirmation = await expect("/api/opportunities/O-303/lifecycle", {}, 200, "O-303 after first confirmation");
  assert(afterFirstConfirmation.lifecycle_state === "open", "O-303 must not be matched until every invited student confirms.");

  const confirmed = await expect(
    `/api/matches/${proposedId}/confirm`,
    { method: "POST", token: s05, body: {} },
    200,
    "second student confirmation"
  );
  assert(confirmed.state === "confirmed", "The second confirmation must fully confirm the match.");
  assert(confirmed.students.every((student) => student.response_state === "confirmed"), "Every invited student must be recorded as confirmed.");
  const matchedLifecycle = await expect("/api/opportunities/O-303/lifecycle", {}, 200, "O-303 after two confirmations");
  assert(matchedLifecycle.lifecycle_state === "matched", "O-303 must transition to matched only after both confirmations.");
  console.log("✓ mutual confirmation: unauthorized attempt rejected; first confirmation partial; second confirmation matched");

  const summary = `R3 controlled QA outcome ${new Date().toISOString()}`;
  const createdOutcome = await expect(
    "/api/opportunities/O-303/outcomes",
    {
      method: "POST",
      token: s01,
      body: {
        summary,
        completed_on: "2026-11-06",
        links: { repository: "https://github.com/example/r3-controlled-qa" },
      },
    },
    201,
    "record participant outcome"
  );
  const outcomeId = encodeURIComponent(createdOutcome.id);
  const privateShowcase = await expect("/api/showcase", {}, 200, "showcase before faculty confirmation");
  assert(!includesOutcome(privateShowcase, summary), "An unconfirmed outcome must not be public.");
  const participantOutcomes = await expect("/api/outcomes/mine", { token: s01 }, 200, "participant outcome view");
  assert(includesOutcome(participantOutcomes, summary), "The newly recorded outcome must remain visible to its participant.");

  await expect(
    `/api/outcomes/${outcomeId}/faculty-confirm`,
    { method: "POST", token: faculty, body: {} },
    200,
    "faculty outcome confirmation"
  );
  await expect(
    `/api/outcomes/${outcomeId}/consent`,
    { method: "PATCH", token: s01, body: { public_consent: true } },
    200,
    "first student public consent"
  );
  await expect(
    `/api/outcomes/${outcomeId}/consent`,
    { method: "PATCH", token: s05, body: { public_consent: true } },
    200,
    "second student public consent"
  );
  await expect(
    `/api/outcomes/${outcomeId}/consent`,
    { method: "PATCH", token: faculty, body: { public_consent: true } },
    200,
    "faculty public consent"
  );
  const publicShowcase = await expect("/api/showcase", {}, 200, "showcase after confirmation and consent");
  assert(includesOutcome(publicShowcase, summary), "A confirmed, fully consented outcome must appear on the public showcase.");
  const studentProfile = await expect("/api/students/S01/outcomes", {}, 200, "student public profile");
  const facultyProfile = await expect("/api/faculty/F-PRIYA/outcomes", {}, 200, "faculty public profile");
  assert(includesOutcome(studentProfile, summary), "The consented outcome must appear on S01's public profile before S01 hides it.");
  assert(includesOutcome(facultyProfile, summary), "The consented outcome must appear on the faculty public profile.");

  await expect(
    `/api/outcomes/${outcomeId}/profile-visibility`,
    { method: "PATCH", token: s01, body: { profile_visible: false } },
    200,
    "hide outcome from S01 profile"
  );
  const hiddenStudentProfile = await expect("/api/students/S01/outcomes", {}, 200, "student profile after hide");
  const retainedFacultyProfile = await expect("/api/faculty/F-PRIYA/outcomes", {}, 200, "faculty profile after student hide");
  const retainedShowcase = await expect("/api/showcase", {}, 200, "showcase after student profile hide");
  assert(!includesOutcome(hiddenStudentProfile, summary), "S01's hidden outcome must leave only S01's profile.");
  assert(includesOutcome(retainedFacultyProfile, summary), "Hiding a student-profile outcome must not remove it from the faculty profile.");
  assert(includesOutcome(retainedShowcase, summary), "Hiding a student-profile outcome must not remove it from the showcase.");
  console.log("✓ outcome privacy: participant-private until confirmation/consent; public surface and profile-only hide verified");

  console.log("R3 API QA PASSED.");
  console.log("IMPORTANT: reset the controlled fixture now with: npm --prefix backend run seed:r3");
}

main().catch((error) => {
  console.error("R3 API QA FAILED:", error.message);
  console.error("Reset the controlled fixture with: npm --prefix backend run seed:r3");
  process.exitCode = 1;
});
