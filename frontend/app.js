const API = window.API_BASE_URL || "http://localhost:3000";

const statusEl = document.querySelector("#status");
const projectsEl = document.querySelector("#projects");
const facultyEl = document.querySelector("#faculty");
const areaEl = document.querySelector("#area");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function areaTags(areas) {
  return (areas || [])
    .map(area => `<span class="tag">${escapeHtml(area)}</span>`)
    .join("");
}

function inquiryText(preference) {
  if (preference === "listed-projects-only") {
    return "Accepting inquiries about listed projects";
  }

  if (preference === "none") {
    return "Not currently accepting inquiries";
  }

  return "Open to general research inquiries";
}

async function loadProjects() {
  const area = areaEl.value;

  const url = new URL(`${API}/api/projects`);

  if (area) {
    url.searchParams.set("area", area);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Could not load projects");
  }

  const projects = await response.json();

  if (projects.length === 0) {
    projectsEl.innerHTML =
      `<p class="empty">No current projects match this filter.</p>`;
    return;
  }

  projectsEl.innerHTML = projects.map(project => `
    <article class="card">
      <h3>${escapeHtml(project.title)}</h3>

      <p>
        ${escapeHtml(
          project.description || "No project description provided."
        )}
      </p>

      <div class="meta">
        <strong>Faculty:</strong>
        ${escapeHtml(project.faculty_name)}
      </div>

      <div class="meta">
        <strong>Student level:</strong>
        ${escapeHtml(project.student_level)}
      </div>

      <div class="meta">
        <strong>Term:</strong>
        ${escapeHtml(project.term)}
      </div>

      <div>
        ${areaTags(project.areas)}
      </div>

      <div class="preference">
        ${escapeHtml(inquiryText(project.inquiry_preference))}
      </div>

      <p>
        <a href="mailto:${escapeHtml(
          project.faculty_name
        )}">
          Contact faculty
        </a>
      </p>
    </article>
  `).join("");
}

async function loadFaculty() {
  const area = areaEl.value;

  const url = new URL(`${API}/api/faculty`);

  if (area) {
    url.searchParams.set("area", area);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Could not load faculty");
  }

  const faculty = await response.json();

  if (faculty.length === 0) {
    facultyEl.innerHTML =
      `<p class="empty">No faculty match this filter.</p>`;
    return;
  }

  facultyEl.innerHTML = faculty.map(person => `
    <article class="card faculty-card">
      <h3>${escapeHtml(person.display_name)}</h3>

      <p>
        ${escapeHtml(
          person.bio || "Faculty research information available."
        )}
      </p>

      <div>
        ${areaTags(person.areas)}
      </div>

      <div class="preference">
        ${escapeHtml(inquiryText(person.inquiry_preference))}
      </div>
    </article>
  `).join("");
}

async function load() {
  statusEl.textContent = "Loading opportunities...";
  statusEl.className = "";

  try {
    await Promise.all([
      loadProjects(),
      loadFaculty()
    ]);

    statusEl.textContent = "Opportunities loaded.";
  } catch (error) {
    console.error(error);

    statusEl.textContent =
      "Could not load opportunities. Make sure the backend is running.";

    statusEl.className = "error";
  }
}

areaEl.addEventListener("change", load);

load();