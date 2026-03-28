const API_BASE = "https://myjobtracker.etlotha.workers.dev";

const cardsEl = document.getElementById("cards");
const summaryEl = document.getElementById("summary");
const searchBox = document.getElementById("searchBox");
const refreshBtn = document.getElementById("refreshBtn");

let allAds = [];

refreshBtn.addEventListener("click", loadAds);
searchBox.addEventListener("input", render);

loadAds();

async function loadAds() {
  summaryEl.textContent = "Loading...";

  try {
    const response = await fetch(`${API_BASE}/api/ads`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const ads = await response.json();
    allAds = Array.isArray(ads) ? ads : [];
    render();
  } catch (error) {
    summaryEl.textContent = "Could not load ads.";
    cardsEl.innerHTML = `<div class="empty">Check your Worker URL in app.js.<br><br>${escapeHtml(error.message)}</div>`;
  }
}

function render() {
  const query = searchBox.value.trim().toLowerCase();

  const filteredAds = allAds.filter((ad) => {
    const haystack =
      `${ad.institute || ""} ${ad.department || ""} ${ad.role || ""} ${ad.title || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  const groups = sortInstituteGroups(groupByInstitute(filteredAds));

  summaryEl.textContent = `${groups.length} institution${groups.length === 1 ? "" : "s"} shown`;

  if (groups.length === 0) {
    cardsEl.innerHTML = `<div class="empty">No current openings.</div>`;
    return;
  }

  cardsEl.innerHTML = groups.map(renderInstituteCard).join("");
}

function groupByInstitute(ads) {
  const groups = new Map();

  for (const ad of ads) {
    const key = `${ad.instituteType || "IIT/NIT"}|${ad.institute || "Unknown institute"}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        instituteType: ad.instituteType || "IIT/NIT",
        institute: ad.institute || "Unknown institute",
        roles: new Set(),
        departments: new Set(),
        bestNotice: null,
      });
    }

    const group = groups.get(key);
    group.roles.add(ad.role || "Not stated");
    group.departments.add(ad.department || "Not stated");
    group.bestNotice = pickBestNotice(group.bestNotice, ad);
  }

  return [...groups.values()];
}

function pickBestNotice(current, candidate) {
  if (!current) return candidate;
  return scoreNotice(candidate) > scoreNotice(current) ? candidate : current;
}

function scoreNotice(ad) {
  let score = 0;
  if (ad.deadline && ad.deadline !== "Not stated") score += 3;
  if (ad.adDate && ad.adDate !== "Not stated") score += 2;
  if ((ad.title || "").length > 20) score += 1;
  return score;
}

function renderInstituteCard(group) {
  const roleSummary = summarizeRoles([...group.roles]);
  const departmentSummary = summarizeDepartments([...group.departments]);
  const deadline = group.bestNotice?.deadline || "Not stated";
  const link = group.bestNotice?.url || "#";

  return `
    <article class="card">
      <div class="badge">[${escapeHtml(group.instituteType)}] ${escapeHtml(group.institute)} | Deadline ${escapeHtml(deadline)}</div>
      <h3>${escapeHtml(roleSummary)}</h3>
      <p>${escapeHtml(departmentSummary)}</p>
      <p><a href="${escapeAttribute(link)}" target="_blank" rel="noopener noreferrer">Open advertisement</a></p>
    </article>
  `;
}

function summarizeRoles(roles) {
  const set = new Set(roles.filter(Boolean));
  const hasAssistant = set.has("Assistant Professor");
  const hasAssociate = set.has("Associate Professor");
  const hasCombined = set.has("Assistant Professor / Associate Professor");

  if (hasCombined || (hasAssistant && hasAssociate)) {
    return "Assistant Professor / Associate Professor";
  }

  return [...set][0] || "Not stated";
}

function summarizeDepartments(departments) {
  const clean = [...new Set(departments.filter((x) => x && x !== "Not stated"))];
  if (clean.length === 0) return "Not stated";
  return clean.join(", ");
}

function sortInstituteGroups(groups) {
  return groups.sort((a, b) => a.institute.localeCompare(b.institute));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(text) {
  return escapeHtml(text);
}
