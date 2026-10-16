const API = window.API_BASE_URL || "http://localhost:3000";
const tokenKey = "opportunity-registry-token";
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const token = () => sessionStorage.getItem(tokenKey);
const headers = () => token() ? { Authorization: `Bearer ${token()}` } : {};
const tags = (items) => (items || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
const checkedAreas = (form) => [...form.querySelectorAll('input[name="areas"]:checked')].map((input) => input.value);

function show(element, value, error = false) { element.textContent = value; element.className = error ? "error" : "success"; }
function inquiryText(value) { return ({ "listed-projects-only": "Accepting inquiries about listed projects", none: "Not currently accepting inquiries" })[value] || "Open to general research inquiries"; }
async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function projectCard(project) {
  return `<article class="card"><p class="eyebrow">Faculty project</p><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.description || "No project description provided.")}</p><p class="meta"><strong>Faculty:</strong> ${escapeHtml(project.faculty_name)}</p><p class="meta">${escapeHtml(project.student_level)} · ${escapeHtml(project.term)}</p><div>${tags(project.areas)}</div><p class="preference">${escapeHtml(inquiryText(project.inquiry_preference))}</p></article>`;
}
function opportunityCard(item) {
  const supervisors = (item.supervisors || []).filter((person) => person.public_profile || token()).map((person) => escapeHtml(person.display_name)).join(", ") || "Faculty supervisor available";
  return `<article class="card industry-card"><p class="eyebrow">Industry opportunity</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="meta"><strong>Organisation:</strong> ${escapeHtml(item.organisation_name)}</p><p class="meta"><strong>Capacity:</strong> ${escapeHtml(item.capacity.replaceAll("-", " "))}</p><p class="meta"><strong>Faculty support:</strong> ${supervisors}</p><div>${tags(item.areas)}</div></article>`;
}

async function loadDiscovery() {
  const area = $("#area").value;
  const query = area ? `?area=${encodeURIComponent(area)}` : "";
  try {
    const [projects, faculty, opportunities] = await Promise.all([request(`/api/projects${query}`), request(`/api/faculty${query}`), request(`/api/opportunities${query}`)]);
    $("#projects").innerHTML = projects.length ? projects.map(projectCard).join("") : '<p class="empty">No faculty projects match this filter.</p>';
    $("#opportunities").innerHTML = opportunities.length ? opportunities.map(opportunityCard).join("") : '<p class="empty">No supervised industry opportunities match this filter.</p>';
    $("#faculty").innerHTML = faculty.length ? faculty.map((person) => `<article class="card faculty-card"><h3>${escapeHtml(person.display_name)}</h3><p>${escapeHtml(person.bio || "Faculty research information available.")}</p><div>${tags(person.areas)}</div><p class="preference">${escapeHtml(inquiryText(person.inquiry_preference))}</p></article>`).join("") : '<p class="empty">No faculty match this filter.</p>';
    show($("#status"), "Opportunities loaded.");
  } catch { show($("#status"), "Could not load opportunities. Please try again shortly.", true); }
}

$("#area").addEventListener("change", loadDiscovery);
$("#intake-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); data.areas = checkedAreas(form);
  try { await request("/api/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); form.reset(); show($("#intake-result"), "Thanks — your opportunity is awaiting faculty supervisor support."); }
  catch (error) { show($("#intake-result"), error.message, true); }
});

async function facultyWorkspace() {
  if (!token()) return;
  try {
    const [profile, opportunities, subscriptions, notifications] = await Promise.all([request("/api/me"), request("/api/faculty/opportunities"), request("/api/faculty/me/subscriptions"), request("/api/faculty/me/notifications")]);
    $("#faculty-workspace").hidden = false;
    $("#faculty-name").textContent = profile.faculty?.display_name || profile.user.email;
    $("#subscribe-all").checked = subscriptions.subscribe_all;
    $("#subscription-form").querySelectorAll('input[name="areas"]').forEach((input) => { input.checked = subscriptions.areas.includes(input.value); });
    $("#notifications").innerHTML = notifications.length ? notifications.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("") : "<li>No matching intake notifications yet.</li>";
    $("#faculty-opportunities").innerHTML = opportunities.map((item) => `<article class="card"><p class="eyebrow">${item.status === "supervised" ? "Student visible" : "Awaiting faculty supervisor"}</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="meta"><strong>Partner:</strong> ${escapeHtml(item.organisation_name)} · ${escapeHtml(item.contact_name)} · ${escapeHtml(item.contact_email)}</p><p class="meta"><strong>Capacity:</strong> ${escapeHtml(item.capacity.replaceAll("-", " "))} · <strong>Faculty interest:</strong> ${item.willingness_count}</p><p class="meta"><strong>Engagement:</strong> ${escapeHtml(item.engagement_state.replaceAll("-", " "))}${item.engagement_faculty_name ? ` — ${escapeHtml(item.engagement_faculty_name)}` : ""}</p><div>${tags(item.areas)}</div><div class="actions"><button type="button" data-willing="${item.id}">I can supervise</button><button type="button" data-withdraw="${item.id}" class="secondary">Withdraw willingness</button><select data-engagement="${item.id}" aria-label="Partner engagement"><option value="not-contacted">Not contacted</option><option value="discussion-underway">Discussion underway</option><option value="partner-confirmed">Partner confirmed</option><option value="no-longer-pursuing">No longer pursuing</option></select></div></article>`).join("") || '<p class="empty">No industry opportunities have been submitted.</p>';
    $("#faculty-opportunities").querySelectorAll("[data-willing]").forEach((button) => button.addEventListener("click", () => willingness(button.dataset.willing, true)));
    $("#faculty-opportunities").querySelectorAll("[data-withdraw]").forEach((button) => button.addEventListener("click", () => willingness(button.dataset.withdraw, false)));
    $("#faculty-opportunities").querySelectorAll("[data-engagement]").forEach((select) => select.addEventListener("change", () => engagement(select.dataset.engagement, select.value)));
  } catch (error) { show($("#auth-result"), error.message, true); }
}
async function willingness(id, willing) { try { await request(`/api/opportunities/${id}/willingness`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ willing }) }); await facultyWorkspace(); await loadDiscovery(); } catch (error) { show($("#auth-result"), error.message, true); } }
async function engagement(id, engagement_state) { try { await request(`/api/opportunities/${id}/engagement`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engagement_state }) }); await facultyWorkspace(); } catch (error) { show($("#auth-result"), error.message, true); } }
$("#auth-request").addEventListener("click", async () => { try { const result = await request("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("#auth-email").value }) }); $("#auth-code").value = result.challenge_code || ""; show($("#auth-result"), "A short-lived sign-in code was created. Test mode shows it here."); } catch (error) { show($("#auth-result"), error.message, true); } });
$("#auth-verify").addEventListener("click", async () => { try { const result = await request("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("#auth-email").value, challenge_code: $("#auth-code").value }) }); sessionStorage.setItem(tokenKey, result.token); show($("#auth-result"), "Signed in."); await facultyWorkspace(); await loadDiscovery(); } catch (error) { show($("#auth-result"), error.message, true); } });
$("#subscription-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await request("/api/faculty/me/subscriptions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscribe_all: $("#subscribe-all").checked, areas: checkedAreas(event.currentTarget) }) }); show($("#subscription-result"), "Subscriptions saved for future opportunities."); } catch (error) { show($("#subscription-result"), error.message, true); } });
loadDiscovery(); facultyWorkspace();
