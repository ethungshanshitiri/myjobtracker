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

  const filteredAds = allAds
    .filter(isRelevantOpening)
    .filter((ad) => {
      const haystack =
        `${ad.institute || ""} ${ad.department || ""} ${ad.role || ""} ${ad.title || ""}`.toLowerCase();
      return haystack.includes(query);
    });

  const groups = sortInstituteGroups(groupByInstitute(filteredAds));

  summaryEl.textContent = `${groups.length} institution${groups.length === 1 ? "" : "s"} shown`;

  if (groups.length === 0) {
    cardsEl.innerHTML = `<div class="empty">No matching openings.</div>`;
    return;
  }

  cardsEl.innerHTML = groups.map(renderInstituteCard).join("");
}

function isRelevantOpening(ad) {
  const text = `${ad.title || ""} ${ad.role || ""} ${ad.department || ""}`.toLowerCase();

  const excludePatterns = [
    /\bshortlisted\b/,
    /\bshortlist\b/,
    /\binterview schedule\b/,
    /\bteaching presentation\b/,
    /\bscreening test\b/,
    /\bsyllabus\b/,
    /\bconstitution\b/,
    /\bjrf\b/,
    /\bshort term course\b/,
    /\bworkshop\b/,
    /\bconference\b/,
    /\btraining\b/,
    /\bresult\b/
  ];

  for (const pattern of excludePatterns) {
    if (pattern.test(text)) return false;
  }

  const hasTargetRole =
    /\bassistant professor\b/.test(text) ||
    /\bassociate professor\b/.test(text);

  return hasTargetRole;
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
        notices: []
      });
    }

    const group = groups.get(key);
    group.roles.add(ad.role || "Not stated");
    group.departments.add(ad.department || "Not stated");
    group.notices.push(ad);
  }

  for (const group of groups.values()) {
    group.notices = dedupeNotices(group.notices).sort(compareNotices);
  }

  return [...groups.values()];
}

function dedupeNotices(notices) {
  const map = new Map();

  for (const ad of notices) {
    const urlKey = normalizeUrlForDisplay(ad.url || "");
    const titleKey = normalizeText(ad.title || "");
    const key = `${urlKey}|${titleKey}`;

    if (!map.has(key)) {
      map.set(key, ad);
      continue;
    }

    const existing = map.get(key);
    map.set(key, preferBetterNotice(existing, ad));
  }

  return [...map.values()];
}

function preferBetterNotice(a, b) {
  const aScore = scoreNotice(a);
  const bScore = scoreNotice(b);
  return bScore > aScore ? b : a;
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

  return `
    <article class="card">
      <div class="badge">[${escapeHtml(group.instituteType)}] ${escapeHtml(group.institute)}</div>
      <h3>${escapeHtml(roleSummary)}</h3>
      <p>${escapeHtml(departmentSummary)}</p>
      <details>
        <summary>${group.notices.length} opening${group.notices.length === 1 ? "" : "s"}</summary>
        ${group.notices.map(renderNoticeLine).join("")}
      </details>
    </article>
  `;
}

function renderNoticeLine(ad) {
  const adDate = ad.adDate || "Not stated";
  const deadline = ad.deadline || "Not stated";

  return `
    <div class="debug-block">
      <p><strong>${escapeHtml(ad.title || "Untitled opening")}</strong></p>
      <p>${escapeHtml(ad.role || "Not stated")} | ${escapeHtml(ad.department || "Not stated")}</p>
      <p>Ad date ${escapeHtml(adDate)} | Deadline ${escapeHtml(deadline)}</p>
      <p><a href="${escapeAttribute(ad.url || "#")}" target="_blank" rel="noopener noreferrer">Open notice</a></p>
    </div>
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

function compareNotices(a, b) {
  return normalizeText(a.title || "").localeCompare(normalizeText(b.title || ""));
}

function normalizeUrlForDisplay(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function normalizeText(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
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
