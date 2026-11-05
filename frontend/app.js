const API = window.API_BASE_URL || "http://localhost:3000";
const tokenKey = "opportunity-registry-token";
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const token = () => sessionStorage.getItem(tokenKey);
const headers = () => token() ? { Authorization: `Bearer ${token()}` } : {};
const checkedAreas = (form) => [...form.querySelectorAll('input[name="areas"]:checked')].map((input) => input.value);

let activeProfile = null;

function show(element, value, error = false) {
  if (!element) return;
  element.textContent = value;
  element.className = error ? "error" : "success";
}

function titleCase(value) {
  return String(value || "unknown").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statePill(value) {
  const state = String(value || "unknown");
  return `<span class="state state-${escapeHtml(state)}">${escapeHtml(titleCase(state))}</span>`;
}

function tags(items) {
  return (items || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
}

function inquiryText(value) {
  return ({
    "listed-projects-only": "Accepting inquiries about listed projects",
    none: "Not currently accepting inquiries",
  })[value] || "Open to general research inquiries";
}

function dateText(value) {
  return value ? escapeHtml(String(value).slice(0, 10)) : "Not set";
}

function safeLinks(links) {
  if (!links || typeof links !== "object") return "";
  return Object.entries(links).flatMap(([label, value]) => {
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol)) return [];
      return [`<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(titleCase(label))}</a>`];
    } catch {
      return [];
    }
  }).join(" · ");
}

function people(items) {
  return (items || []).map((person) => escapeHtml(person.display_name)).join(", ") || "Not publicly listed";
}

function publicProfileHash(kind, fixtureId) {
  return `#profile/${encodeURIComponent(kind)}/${encodeURIComponent(fixtureId)}`;
}

function publicProfileLink(person, kind) {
  const name = escapeHtml(person?.display_name || "Public profile");
  if (!person?.fixture_id || person.public_profile !== true) return name;
  return `<a href="${escapeHtml(publicProfileHash(kind, person.fixture_id))}">${name}</a>`;
}

function peopleWithProfileLinks(items, kind) {
  return (items || []).map((person) => publicProfileLink(person, kind)).join(", ") || "Not publicly listed";
}

function profileFromHash() {
  const match = /^#profile\/(faculty|student)\/([^/]+)$/.exec(window.location.hash);
  if (!match) return null;
  try {
    return { kind: match[1], fixtureId: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

function profileNameFromOutcomes(outcomes, profile) {
  const peopleForRole = profile.kind === "faculty" ? "faculty" : "students";
  for (const outcome of outcomes) {
    const person = (outcome[peopleForRole] || []).find((item) => item.fixture_id === profile.fixtureId);
    if (person?.display_name) return person.display_name;
  }
  return profile.kind === "faculty" ? "Faculty member" : "Student";
}

async function loadPublicProfile(shouldFocus = false) {
  const profile = profileFromHash();
  const section = $("#public-profile");
  if (!profile) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  $("#public-profile-heading").textContent = "Loading public completed-work profile…";
  $("#public-profile-copy").textContent = "Only faculty-confirmed outcomes that meet every participant's consent setting are shown.";
  $("#public-profile-outcomes").innerHTML = "";
  try {
    const path = profile.kind === "faculty"
      ? `/api/faculty/${encodeURIComponent(profile.fixtureId)}/outcomes`
      : `/api/students/${encodeURIComponent(profile.fixtureId)}/outcomes`;
    const outcomes = await request(path);
    const name = profileNameFromOutcomes(outcomes, profile);
    $("#public-profile-heading").textContent = `${name}'s completed-work profile`;
    $("#public-profile-copy").textContent = "Only faculty-confirmed outcomes for which all participants allow public display are listed.";
    $("#public-profile-outcomes").innerHTML = outcomes.length
      ? outcomes.map(showcaseCard).join("")
      : '<p class="empty">No public completed-work outcomes are available for this profile yet.</p>';
  } catch {
    $("#public-profile-heading").textContent = "Public completed-work profile";
    $("#public-profile-copy").textContent = "This profile is private or unavailable.";
    $("#public-profile-outcomes").innerHTML = "";
  }
  if (shouldFocus) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#public-profile-heading").focus();
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function jsonOptions(body) {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function projectCard(project) {
  return `<article class="card"><p class="eyebrow">Faculty project</p><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.description || "No project description provided.")}</p><p class="meta"><strong>Faculty:</strong> ${escapeHtml(project.faculty_name)}</p><p class="meta">${escapeHtml(project.student_level)} · ${escapeHtml(project.term)}</p><div>${tags(project.areas)}</div><p class="preference">${escapeHtml(inquiryText(project.inquiry_preference))}</p></article>`;
}

function opportunityCard(item) {
  const supervisors = (item.supervisors || [])
    .filter((person) => person.public_profile || token())
    .map((person) => publicProfileLink(person, "faculty"))
    .join(", ") || "Faculty supervisor available";
  const schedule = [item.target_term && `Target term: ${escapeHtml(item.target_term)}`, item.application_deadline && `Apply by ${dateText(item.application_deadline)}`].filter(Boolean).join(" · ");
  return `<article class="card industry-card"><p class="eyebrow">Industry opportunity</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="meta"><strong>Organisation:</strong> ${escapeHtml(item.organisation_name)}</p><p class="meta"><strong>Capacity:</strong> ${escapeHtml(String(item.capacity || "").replaceAll("-", " "))}</p><p class="meta"><strong>Faculty support:</strong> ${supervisors}</p>${schedule ? `<p class="meta"><strong>${schedule}</strong></p>` : ""}<p class="meta">${statePill("open")} Currently available for a new match</p><div>${tags(item.areas)}</div></article>`;
}

function showcaseCard(outcome) {
  const links = safeLinks(outcome.links);
  return `<article class="card showcase-card"><p class="eyebrow">Completed work</p><h3>${escapeHtml(outcome.opportunity_title)}</h3><p>${escapeHtml(outcome.summary)}</p><p class="meta"><strong>Completed:</strong> ${dateText(outcome.completed_on)}</p><p class="meta"><strong>Faculty:</strong> ${peopleWithProfileLinks(outcome.faculty, "faculty")}</p><p class="meta"><strong>Students:</strong> ${peopleWithProfileLinks(outcome.students, "student")}</p>${links ? `<p class="meta"><strong>Links:</strong> ${links}</p>` : ""}</article>`;
}

async function loadShowcase() {
  try {
    const outcomes = await request("/api/showcase");
    $("#showcase").innerHTML = outcomes.length
      ? outcomes.map(showcaseCard).join("")
      : '<p class="empty">No completed work is publicly displayable yet.</p>';
  } catch {
    $("#showcase").innerHTML = '<p class="empty">The completed-work showcase is temporarily unavailable.</p>';
  }
}

async function loadDiscovery() {
  const area = $("#area").value;
  const query = area ? `?area=${encodeURIComponent(area)}` : "";
  try {
    const [projects, faculty, opportunities] = await Promise.all([
      request(`/api/projects${query}`),
      request(`/api/faculty${query}`),
      request(`/api/opportunities${query}`),
    ]);
    $("#projects").innerHTML = projects.length
      ? projects.map(projectCard).join("")
      : '<p class="empty">No faculty projects match this filter.</p>';
    $("#opportunities").innerHTML = opportunities.length
      ? opportunities.map(opportunityCard).join("")
      : '<p class="empty">No currently available supervised opportunities match this filter.</p>';
    $("#faculty").innerHTML = faculty.length
      ? faculty.map((person) => `<article class="card faculty-card"><h3>${publicProfileLink(person, "faculty")}</h3><p>${escapeHtml(person.bio || "Faculty research information available.")}</p><div>${tags(person.areas)}</div><p class="preference">${escapeHtml(inquiryText(person.inquiry_preference))}</p></article>`).join("")
      : '<p class="empty">No faculty match this filter.</p>';
    show($("#status"), "Opportunities loaded.");
  } catch {
    show($("#status"), "Could not load opportunities. Please try again shortly.", true);
  }
  await loadShowcase();
}

async function refreshAfterMutation() {
  await Promise.allSettled([loadDiscovery(), loadAuthenticatedWorkspace()]);
}

function opportunityIdentifier(item) {
  return item.submission_id || item.fixture_id || item.id;
}

async function lifecycleFor(item) {
  try {
    return await request(`/api/opportunities/${encodeURIComponent(opportunityIdentifier(item))}/lifecycle`);
  } catch {
    return {
      lifecycle_state: "unknown",
      reason: "Lifecycle details are unavailable.",
      target_term: "",
      deadline: "",
    };
  }
}

function studentList(match) {
  return `<ul class="list-reset">${(match.students || []).map((student) => `<li><strong>${escapeHtml(student.display_name)}</strong> — ${statePill(student.response_state || "pending")}</li>`).join("")}</ul>`;
}

function studentMatchCard(match, student) {
  const myResponse = (match.students || []).find((item) => item.fixture_id && item.fixture_id === student?.fixture_id);
  const canRespond = myResponse?.response_state === "pending" && ["proposed", "partly-confirmed"].includes(match.state);
  const id = match.fixture_id || match.id;
  return `<article class="card match-card"><p class="eyebrow">Match invitation</p><h3>${escapeHtml(match.opportunity_title)}</h3><p>${statePill(match.state)}</p><p class="meta"><strong>Faculty:</strong> ${escapeHtml(match.faculty_name)}</p><p class="meta"><strong>Responses so far:</strong></p>${studentList(match)}${canRespond ? `<div class="actions"><button type="button" data-student-match-action="confirm" data-match-id="${escapeHtml(id)}">Confirm my interest</button><button type="button" class="secondary" data-student-match-action="decline" data-match-id="${escapeHtml(id)}">Decline</button></div>` : ""}</article>`;
}

function outcomeCard(outcome, role) {
  const id = outcome.fixture_id || outcome.id;
  const confirmed = Boolean(outcome.faculty_confirmed_by);
  const links = safeLinks(outcome.links);
  const controls = role === "student"
    ? `<div class="actions"><button type="button" data-student-consent="${escapeHtml(id)}">Allow public display</button><button type="button" class="secondary" data-student-profile-hide="${escapeHtml(id)}">Hide from my profile</button><button type="button" class="secondary" data-student-profile-show="${escapeHtml(id)}">Show on my profile</button></div>`
    : `<div class="actions"><button type="button" data-faculty-consent="${escapeHtml(id)}">Allow public display</button>${confirmed ? "" : `<button type="button" class="warn" data-faculty-confirm="${escapeHtml(id)}">Confirm outcome</button>`}</div>`;
  return `<article class="card"><p class="eyebrow">Outcome</p><h3>${escapeHtml(outcome.opportunity_title)}</h3><p>${escapeHtml(outcome.summary)}</p><p class="meta"><strong>Completed:</strong> ${dateText(outcome.completed_on)} · ${confirmed ? statePill("confirmed") : statePill("awaiting-faculty-confirmation")}</p>${links ? `<p class="meta"><strong>Links:</strong> ${links}</p>` : ""}${controls}</article>`;
}

function facultyMatchCard(match) {
  const id = match.fixture_id || match.id;
  const canWithdraw = ["proposed", "partly-confirmed"].includes(match.state);
  return `<article class="card match-card"><p class="eyebrow">Match record</p><p>${statePill(match.state)}</p><p class="meta"><strong>Students:</strong></p>${studentList(match)}<div class="actions">${canWithdraw ? `<button type="button" class="secondary" data-withdraw-match="${escapeHtml(id)}">Withdraw proposal</button>` : ""}<button type="button" class="secondary" data-partner-agreement="${escapeHtml(id)}">Record partner agreement in principle</button></div></article>`;
}

function facultyOpportunityCard(item, lifecycle, matches) {
  const identifier = opportunityIdentifier(item);
  const matching = matches.filter((match) => String(match.opportunity_id) === String(item.id) || match.opportunity_fixture_id === identifier);
  const lifecycleState = lifecycle.lifecycle_state || "unknown";
  const canPropose = lifecycleState === "open";
  const canSchedule = lifecycleState === "open";
  const canRenew = ["expired", "completed"].includes(lifecycleState);
  const lifecycleChoices = ["expired", "withdrawn"].includes(lifecycleState)
    ? '<option value="open">Open / restore</option><option value="archived">Archived</option>'
    : lifecycleState === "matched"
      ? '<option value="completed">Completed</option><option value="archived">Archived</option>'
      : '<option value="withdrawn">Withdrawn</option><option value="completed">Completed</option><option value="archived">Archived</option>';
  return `<article class="card"><p class="eyebrow">${item.status === "supervised" ? "Student-visible intake" : "Awaiting faculty supervisor"}</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="meta"><strong>Partner:</strong> ${escapeHtml(item.organisation_name)} · ${escapeHtml(item.contact_name)} · ${escapeHtml(item.contact_email)}</p><p class="meta"><strong>Capacity:</strong> ${escapeHtml(String(item.capacity || "").replaceAll("-", " "))} · <strong>Faculty interest:</strong> ${escapeHtml(item.willingness_count)}</p><p class="meta"><strong>Engagement:</strong> ${escapeHtml(String(item.engagement_state || "").replaceAll("-", " "))}${item.engagement_faculty_name ? ` — ${escapeHtml(item.engagement_faculty_name)}` : ""}</p><div>${tags(item.areas)}</div><section class="notice"><p><strong>Lifecycle:</strong> ${statePill(lifecycleState)} ${lifecycle.target_term ? `· ${escapeHtml(lifecycle.target_term)}` : ""} ${lifecycle.deadline ? `· deadline ${dateText(lifecycle.deadline)}` : ""}</p><p class="meta">${escapeHtml(lifecycle.reason || "No lifecycle note has been recorded.")}</p></section><div class="actions"><button type="button" data-willing="${escapeHtml(item.id)}">I can supervise</button><button type="button" data-withdraw="${escapeHtml(item.id)}" class="secondary">Withdraw willingness</button><select data-engagement="${escapeHtml(item.id)}" aria-label="Partner engagement for ${escapeHtml(item.title)}"><option value="not-contacted">Not contacted</option><option value="discussion-underway">Discussion underway</option><option value="partner-confirmed">Partner confirmed</option><option value="no-longer-pursuing">No longer pursuing</option></select></div>${canSchedule ? `<form class="fields" data-schedule-form="${escapeHtml(identifier)}"><div><label>Target term<input name="target_term" value="${escapeHtml(lifecycle.target_term || "")}" placeholder="2027W" required></label></div><div><label>Application deadline<input name="deadline" type="date" value="${escapeHtml(String(lifecycle.deadline || "").slice(0, 10))}" required></label></div><div class="wide"><p class="meta">After you add yourself as a supervisor, set the current term and application deadline before proposing a match.</p><button type="submit">Save term and deadline</button></div></form>` : ""}<form class="stack" data-lifecycle-form="${escapeHtml(identifier)}"><label>Lifecycle change<select name="lifecycle_state">${lifecycleChoices}</select></label><label>Reason (optional)<input name="reason"></label><button type="submit" class="secondary">Update lifecycle</button></form>${canRenew ? `<form class="fields" data-renew-form="${escapeHtml(identifier)}"><div><label>Renewal term<input name="target_term" placeholder="2027W" required></label></div><div><label>New deadline<input name="deadline" type="date" required></label></div><div class="wide"><button type="submit">Renew for a later term</button></div></form>` : ""}${canPropose ? `<form class="stack" data-propose-match="${escapeHtml(identifier)}"><label>Invite students (student references or Algoma emails, comma-separated)<input name="students" required></label><label><input name="partner_agreed_in_principle" type="checkbox"> I record that the industry partner has agreed in principle</label><button type="submit">Propose match</button></form>` : ""}${matching.length ? `<section><h3>Match records</h3><div class="stack">${matching.map(facultyMatchCard).join("")}</div></section>` : ""}</article>`;
}

async function loadAuthenticatedWorkspace() {
  if (!token()) {
    $("#student-workspace").hidden = true;
    $("#faculty-workspace").hidden = true;
    activeProfile = null;
    return;
  }
  try {
    activeProfile = await request("/api/me");
    if (activeProfile.faculty?.verified_faculty) {
      $("#student-workspace").hidden = true;
      await facultyWorkspace(activeProfile);
    } else {
      $("#faculty-workspace").hidden = true;
      await studentWorkspace(activeProfile);
    }
  } catch (error) {
    $("#student-workspace").hidden = true;
    $("#faculty-workspace").hidden = true;
    show($("#auth-result"), error.message, true);
  }
}

async function studentWorkspace(profile) {
  const student = profile.student;
  $("#student-workspace").hidden = false;
  $("#student-name").textContent = student?.display_name || profile.user.email;
  $("#student-display-name").value = student?.display_name || profile.user.email.split("@")[0];
  $("#student-fixture-id").value = student?.fixture_id || "";
  $("#student-public-profile").checked = Boolean(student?.public_profile);
  $("#student-public-profile-link").innerHTML = student?.fixture_id && student?.public_profile
    ? `Your consent-controlled public outcomes: ${publicProfileLink(student, "student")}.`
    : "Turn on the public-profile option above to publish a separate outcome profile when your outcome choices allow it.";

  if (!student) {
    $("#student-matches").innerHTML = '<p class="empty">Save a student profile to view invitations and outcomes.</p>';
    $("#student-outcomes").innerHTML = "";
    fillOutcomeChoices([]);
    return;
  }

  try {
    const [matches, outcomes] = await Promise.all([request("/api/student/matches"), request("/api/outcomes/mine")]);
    $("#student-matches").innerHTML = matches.length
      ? matches.map((match) => studentMatchCard(match, student)).join("")
      : '<p class="empty">No match invitations yet.</p>';
    $("#student-outcomes").innerHTML = outcomes.length
      ? outcomes.map((outcome) => outcomeCard(outcome, "student")).join("")
      : '<p class="empty">No outcomes recorded for you yet.</p>';
    fillOutcomeChoices(matches);
    bindStudentDynamicControls();
  } catch (error) {
    $("#student-matches").innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function fillOutcomeChoices(matches) {
  const select = $("#outcome-opportunity");
  const confirmed = (matches || []).filter((match) => match.state === "confirmed");
  const choices = [...new Map(confirmed.map((match) => [match.opportunity_fixture_id || match.opportunity_id, match])).values()];
  select.innerHTML = choices.length
    ? choices.map((match) => `<option value="${escapeHtml(match.opportunity_fixture_id || match.opportunity_id)}">${escapeHtml(match.opportunity_title)}</option>`).join("")
    : '<option value="">No confirmed match available</option>';
  const submit = $("#student-outcome-form button[type='submit']");
  submit.disabled = choices.length === 0;
}

function bindStudentDynamicControls() {
  $("#student-matches").querySelectorAll("[data-student-match-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const action = button.dataset.studentMatchAction;
        await request(`/api/matches/${encodeURIComponent(button.dataset.matchId)}/${action}`, {
          method: "POST",
          ...jsonOptions({}),
        });
        show($("#student-match-result"), action === "confirm" ? "Your confirmation was recorded." : "You declined this proposal.");
        await refreshAfterMutation();
      } catch (error) {
        show($("#student-match-result"), error.message, true);
      }
    });
  });
  $("#student-outcomes").querySelectorAll("[data-student-consent]").forEach((button) => {
    button.addEventListener("click", () => updateStudentOutcome(button.dataset.studentConsent, { public_consent: true }, "You allowed public display when the other conditions are met."));
  });
  $("#student-outcomes").querySelectorAll("[data-student-profile-hide]").forEach((button) => {
    button.addEventListener("click", () => updateStudentProfileVisibility(button.dataset.studentProfileHide, false));
  });
  $("#student-outcomes").querySelectorAll("[data-student-profile-show]").forEach((button) => {
    button.addEventListener("click", () => updateStudentProfileVisibility(button.dataset.studentProfileShow, true));
  });
}

async function updateStudentOutcome(id, body, message) {
  try {
    await request(`/api/outcomes/${encodeURIComponent(id)}/consent`, { method: "PATCH", ...jsonOptions(body) });
    show($("#student-outcome-result"), message);
    await refreshAfterMutation();
  } catch (error) {
    show($("#student-outcome-result"), error.message, true);
  }
}

async function updateStudentProfileVisibility(id, profileVisible) {
  try {
    await request(`/api/outcomes/${encodeURIComponent(id)}/profile-visibility`, {
      method: "PATCH",
      ...jsonOptions({ profile_visible: profileVisible }),
    });
    show($("#student-outcome-result"), profileVisible ? "This outcome can appear on your profile." : "This outcome is hidden from your profile only.");
    await refreshAfterMutation();
  } catch (error) {
    show($("#student-outcome-result"), error.message, true);
  }
}

async function facultyWorkspace(profile) {
  try {
    const [opportunities, subscriptions, notifications, matches, outcomes] = await Promise.all([
      request("/api/faculty/opportunities"),
      request("/api/faculty/me/subscriptions"),
      request("/api/faculty/me/notifications"),
      request("/api/matches/mine"),
      request("/api/outcomes/mine"),
    ]);
    const lifecycle = await Promise.all(opportunities.map(lifecycleFor));
    $("#faculty-workspace").hidden = false;
    $("#faculty-name").textContent = profile.faculty?.display_name || profile.user.email;
    $("#faculty-public-profile-link").innerHTML = profile.faculty?.fixture_id && profile.faculty?.public_profile
      ? `Your consent-controlled public outcomes: ${publicProfileLink(profile.faculty, "faculty")}.`
      : "Your public outcome profile remains unavailable until your faculty profile is public.";
    $("#subscribe-all").checked = subscriptions.subscribe_all;
    $("#subscription-form").querySelectorAll('input[name="areas"]').forEach((input) => {
      input.checked = subscriptions.areas.includes(input.value);
    });
    $("#notifications").innerHTML = notifications.length
      ? notifications.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")
      : "<li>No matching intake notifications yet.</li>";
    $("#faculty-opportunities").innerHTML = opportunities.length
      ? opportunities.map((item, index) => facultyOpportunityCard(item, lifecycle[index], matches)).join("")
      : '<p class="empty">No industry opportunities have been submitted.</p>';
    $("#faculty-outcomes").innerHTML = outcomes.length
      ? outcomes.map((outcome) => outcomeCard(outcome, "faculty")).join("")
      : '<p class="empty">No outcomes involving you yet.</p>';
    bindFacultyDynamicControls();
  } catch (error) {
    show($("#auth-result"), error.message, true);
  }
}

function bindFacultyDynamicControls() {
  $("#faculty-opportunities").querySelectorAll("[data-willing]").forEach((button) => {
    button.addEventListener("click", () => willingness(button.dataset.willing, true));
  });
  $("#faculty-opportunities").querySelectorAll("[data-withdraw]").forEach((button) => {
    button.addEventListener("click", () => willingness(button.dataset.withdraw, false));
  });
  $("#faculty-opportunities").querySelectorAll("[data-engagement]").forEach((select) => {
    select.addEventListener("change", () => engagement(select.dataset.engagement, select.value));
  });
  $("#faculty-opportunities").querySelectorAll("[data-propose-match]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const students = String(data.get("students") || "").split(",").map((value) => value.trim()).filter(Boolean);
      try {
        await request(`/api/opportunities/${encodeURIComponent(form.dataset.proposeMatch)}/matches`, {
          method: "POST",
          ...jsonOptions({
            student_ids: students,
            partner_agreed_in_principle: data.get("partner_agreed_in_principle") === "on",
          }),
        });
        show($("#faculty-r3-result"), "Match proposed. Each invited student must respond before it becomes confirmed.");
        await refreshAfterMutation();
      } catch (error) {
        show($("#faculty-r3-result"), error.message, true);
      }
    });
  });
  $("#faculty-opportunities").querySelectorAll("[data-lifecycle-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await request(`/api/opportunities/${encodeURIComponent(form.dataset.lifecycleForm)}/lifecycle`, {
          method: "PATCH",
          ...jsonOptions({ lifecycle_state: data.get("lifecycle_state"), reason: data.get("reason") }),
        });
        show($("#faculty-r3-result"), "Lifecycle state updated.");
        await refreshAfterMutation();
      } catch (error) {
        show($("#faculty-r3-result"), error.message, true);
      }
    });
  });
  $("#faculty-opportunities").querySelectorAll("[data-schedule-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await request(`/api/opportunities/${encodeURIComponent(form.dataset.scheduleForm)}/schedule`, {
          method: "PATCH",
          ...jsonOptions({ target_term: data.get("target_term"), deadline: data.get("deadline") }),
        });
        show($("#faculty-r3-result"), "Term and application deadline saved for the active opportunity.");
        await refreshAfterMutation();
      } catch (error) {
        show($("#faculty-r3-result"), error.message, true);
      }
    });
  });
  $("#faculty-opportunities").querySelectorAll("[data-renew-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await request(`/api/opportunities/${encodeURIComponent(form.dataset.renewForm)}/renew`, {
          method: "POST",
          ...jsonOptions({ target_term: data.get("target_term"), deadline: data.get("deadline") }),
        });
        show($("#faculty-r3-result"), "Opportunity renewed while preserving its original identity and history.");
        await refreshAfterMutation();
      } catch (error) {
        show($("#faculty-r3-result"), error.message, true);
      }
    });
  });
  $("#faculty-opportunities").querySelectorAll("[data-withdraw-match]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await request(`/api/matches/${encodeURIComponent(button.dataset.withdrawMatch)}/withdraw`, { method: "POST", ...jsonOptions({}) });
        show($("#faculty-r3-result"), "Match proposal withdrawn; its record is retained.");
        await refreshAfterMutation();
      } catch (error) {
        show($("#faculty-r3-result"), error.message, true);
      }
    });
  });
  $("#faculty-opportunities").querySelectorAll("[data-partner-agreement]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await request(`/api/matches/${encodeURIComponent(button.dataset.partnerAgreement)}/partner-agreement`, {
          method: "PATCH",
          ...jsonOptions({ agreed_in_principle: true }),
        });
        show($("#faculty-r3-result"), "Partner agreement in principle was recorded as your faculty statement.");
        await refreshAfterMutation();
      } catch (error) {
        show($("#faculty-r3-result"), error.message, true);
      }
    });
  });
  $("#faculty-outcomes").querySelectorAll("[data-faculty-confirm]").forEach((button) => {
    button.addEventListener("click", () => confirmFacultyOutcome(button.dataset.facultyConfirm));
  });
  $("#faculty-outcomes").querySelectorAll("[data-faculty-consent]").forEach((button) => {
    button.addEventListener("click", () => facultyOutcomeConsent(button.dataset.facultyConsent));
  });
}

async function willingness(id, willing) {
  try {
    await request(`/api/opportunities/${encodeURIComponent(id)}/willingness`, { method: "PUT", ...jsonOptions({ willing }) });
    await refreshAfterMutation();
  } catch (error) {
    show($("#faculty-r3-result"), error.message, true);
  }
}

async function engagement(id, engagementState) {
  try {
    await request(`/api/opportunities/${encodeURIComponent(id)}/engagement`, {
      method: "PUT",
      ...jsonOptions({ engagement_state: engagementState }),
    });
    await loadAuthenticatedWorkspace();
  } catch (error) {
    show($("#faculty-r3-result"), error.message, true);
  }
}

async function confirmFacultyOutcome(id) {
  try {
    await request(`/api/outcomes/${encodeURIComponent(id)}/faculty-confirm`, { method: "POST", ...jsonOptions({}) });
    show($("#faculty-r3-result"), "Outcome confirmed. It becomes public only if every consent condition also permits it.");
    await refreshAfterMutation();
  } catch (error) {
    show($("#faculty-r3-result"), error.message, true);
  }
}

async function facultyOutcomeConsent(id) {
  try {
    await request(`/api/outcomes/${encodeURIComponent(id)}/consent`, { method: "PATCH", ...jsonOptions({ public_consent: true }) });
    show($("#faculty-r3-result"), "Your public-display consent was recorded.");
    await refreshAfterMutation();
  } catch (error) {
    show($("#faculty-r3-result"), error.message, true);
  }
}

$("#area").addEventListener("change", loadDiscovery);

$("#availability-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const identifier = new FormData(event.currentTarget).get("identifier");
  try {
    const lifecycle = await request(`/api/opportunities/${encodeURIComponent(identifier)}/lifecycle`);
    show($("#availability-result"), `${lifecycle.title}: ${titleCase(lifecycle.lifecycle_state)}. ${lifecycle.reason || "No reason recorded."}`);
  } catch (error) {
    show($("#availability-result"), error.message, true);
  }
});

$("#intake-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  data.areas = checkedAreas(form);
  try {
    await request("/api/intake", { method: "POST", ...jsonOptions(data) });
    form.reset();
    show($("#intake-result"), "Thanks — your opportunity is awaiting faculty supervisor support.");
  } catch (error) {
    show($("#intake-result"), error.message, true);
  }
});

$("#auth-request").addEventListener("click", async () => {
  try {
    const result = await request("/api/auth/request", {
      method: "POST",
      ...jsonOptions({ email: $("#auth-email").value }),
    });
    $("#auth-code").value = result.challenge_code || "";
    show($("#auth-result"), "A short-lived sign-in code was created. Test mode shows it here.");
  } catch (error) {
    show($("#auth-result"), error.message, true);
  }
});

$("#auth-verify").addEventListener("click", async () => {
  try {
    const result = await request("/api/auth/verify", {
      method: "POST",
      ...jsonOptions({ email: $("#auth-email").value, challenge_code: $("#auth-code").value }),
    });
    sessionStorage.setItem(tokenKey, result.token);
    show($("#auth-result"), "Signed in.");
    await refreshAfterMutation();
  } catch (error) {
    show($("#auth-result"), error.message, true);
  }
});

$("#student-profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await request("/api/student/me", {
      method: "PUT",
      ...jsonOptions({
        display_name: data.get("display_name"),
        fixture_id: data.get("fixture_id"),
        public_profile: data.get("public_profile") === "on",
      }),
    });
    show($("#student-profile-result"), "Student profile saved.");
    await loadAuthenticatedWorkspace();
  } catch (error) {
    show($("#student-profile-result"), error.message, true);
  }
});

$("#student-outcome-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const links = {};
  if (String(data.get("repository") || "").trim()) links.repository = data.get("repository");
  if (String(data.get("demo") || "").trim()) links.demo = data.get("demo");
  try {
    await request(`/api/opportunities/${encodeURIComponent(data.get("opportunity"))}/outcomes`, {
      method: "POST",
      ...jsonOptions({
        summary: data.get("summary"),
        completed_on: data.get("completed_on"),
        links,
      }),
    });
    event.currentTarget.reset();
    show($("#student-outcome-result"), "Outcome recorded for participants. It is not public until the faculty and consent conditions are satisfied.");
    await refreshAfterMutation();
  } catch (error) {
    show($("#student-outcome-result"), error.message, true);
  }
});

$("#subscription-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await request("/api/faculty/me/subscriptions", {
      method: "PUT",
      ...jsonOptions({
        subscribe_all: $("#subscribe-all").checked,
        areas: checkedAreas(event.currentTarget),
      }),
    });
    show($("#subscription-result"), "Subscriptions saved for future opportunities.");
  } catch (error) {
    show($("#subscription-result"), error.message, true);
  }
});

window.addEventListener("hashchange", () => { loadPublicProfile(true); });
loadDiscovery();
loadAuthenticatedWorkspace();
loadPublicProfile();
