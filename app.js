const API_BASE = "https://myjobtracker.etlotha.workers.dev";

const cardsEl = document.getElementById("cards");
const summaryEl = document.getElementById("summary");
const searchBox = document.getElementById("searchBox");
const refreshBtn = document.getElementById("refreshBtn");

let allAds = [];

const DEV_SHOW_DUMMY_WHEN_EMPTY = true;
const DEV_DUMMY_ADS = [
  {
    id: "dummy-iitk-ee-2026",
    instituteType: "IIT",
    institute: "IIT Kanpur",
    role: "Assistant Professor / Associate Professor",
    department: "Electrical Engineering, Electronics and Communication Engineering",
    adDate: "28 Mar 2026",
    deadline: "30 Apr 2026",
    url: "https://www.iitk.ac.in/faculty-recruitment",
    title: "Dummy current opening for card preview",
  },
];

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
    const liveAds = Array.isArray(ads) ? ads : [];

    allAds =
      liveAds.length === 0 && DEV_SHOW_DUMMY_WHEN_EMPTY
        ? DEV_DUMMY_ADS
        : liveAds;

    render();
  } catch (error) {
    summaryEl.textContent = "Could not load ads.";
    cardsEl.innerHTML = `
      <p>Check your Worker URL in app.js.</p>
      <pre>${escapeHtml(error.message)}</pre>
    `;
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

  const usingDummy =
    DEV_SHOW_DUMMY_WHEN_EMPTY &&
    allAds.length === DEV_DUMMY_ADS.length &&
    allAds.every((ad) => ad.id.startsWith("dummy-"));

  summaryEl.textContent =
    `${groups.length} institution${groups.length === 1 ? "" : "s"} shown` +
    (usingDummy ? " (DUMMY CARD)" : "");

  if (groups.length === 0) {
    cardsEl.innerHTML = `<p>No current openings.</p>`;
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
        notices: [],
        bestNotice: null,
        bestDeadlineDate: null,
      });
    }

    const group = groups.get(key);
    group.roles.add(ad.role || "Not stated");
    group.departments.add(ad.department || "Not stated");
    group.notices.push(ad);
    group.bestNotice = pickBestNotice(group.bestNotice, ad);
  }

  for (const group of groups.values()) {
    group.bestDeadlineDate = parseDisplayDate(group.bestNotice?.deadline);
  }

  return [...groups.values()];
}

function pickBestNotice(current, candidate) {
  if (!current) return candidate;

  const currentDeadline = parseDisplayDate(current.deadline);
  const candidateDeadline = parseDisplayDate(candidate.deadline);

  const now = startOfToday();

  const currentIsUpcoming = currentDeadline && currentDeadline >= now;
  const candidateIsUpcoming = candidateDeadline && candidateDeadline >= now;

  if (candidateIsUpcoming && !currentIsUpcoming) return candidate;
  if (currentIsUpcoming && !candidateIsUpcoming) return current;

  if (candidateIsUpcoming && currentIsUpcoming) {
    return candidateDeadline < currentDeadline ? candidate : current;
  }

  const currentHasDeadline = !!currentDeadline;
  const candidateHasDeadline = !!candidateDeadline;

  if (candidateHasDeadline && !currentHasDeadline) return candidate;
  if (currentHasDeadline && !candidateHasDeadline) return current;

  if (candidateHasDeadline && currentHasDeadline) {
    return candidateDeadline < currentDeadline ? candidate : current;
  }

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
  const adDate = group.bestNotice?.adDate || "Not stated";
  const link = group.bestNotice?.url || "#";

  return `
    <article class="card">
      <div class="card-top">
        <div class="badge">[${escapeHtml(group.instituteType)}]</div>
        <div class="deadline">Deadline ${escapeHtml(deadline)}</div>
      </div>
      <h3>${escapeHtml(group.institute)}</h3>
      <p><strong>Posted:</strong> ${escapeHtml(adDate)}</p>
      <p><strong>${escapeHtml(roleSummary)}</strong></p>
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
  return groups.sort((a, b) => {
    const ad = a.bestDeadlineDate;
    const bd = b.bestDeadlineDate;

    if (ad && bd) {
      const diff = ad - bd;
      if (diff !== 0) return diff;
      return a.institute.localeCompare(b.institute);
    }

    if (ad && !bd) return -1;
    if (!ad && bd) return 1;

    return a.institute.localeCompare(b.institute);
  });
}

function parseDisplayDate(value) {
  if (!value || value === "Not stated") return null;

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : startOfDay(d);
  }

  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(raw)) {
    const normalized = raw.replace(/[.-]/g, "/");
    let [dd, mm, yyyy] = normalized.split("/");
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function startOfToday() {
  return startOfDay(new Date());
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
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
