const API_BASE = "https://myjobtracker.etlotha.workers.dev";

const cardsEl = document.getElementById("cards");
const summaryEl = document.getElementById("summary");
const searchBox = document.getElementById("searchBox");
const refreshBtn = document.getElementById("refreshBtn");

let allAds = [];
const DEBUG_MODE = true;

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

  const filtered = allAds.filter((ad) => {
    const haystack = `${ad.institute || ""} ${ad.department || ""} ${ad.role || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  summaryEl.textContent = `${filtered.length} advertisement${filtered.length === 1 ? "" : "s"} shown`;

  if (filtered.length === 0) {
    cardsEl.innerHTML = `<div class="empty">No matching advertisements.</div>`;
    return;
  }

  cardsEl.innerHTML = filtered.map(renderCard).join("");
}

function renderCard(ad) {
  const days = daysLeft(ad.deadline);

  let statusClass = "";
  let statusText = "Days left not available";

  if (days !== null) {
    if (days < 0) {
      statusClass = "danger";
      statusText = "Expired";
    } else if (days === 0) {
      statusClass = "warn";
      statusText = "Deadline today";
    } else if (days <= 7) {
      statusClass = "warn";
      statusText = `${days} day${days === 1 ? "" : "s"} left`;
    } else {
      statusClass = "ok";
      statusText = `${days} day${days === 1 ? "" : "s"} left`;
    }
  }

  return `
    <article class="card">
      <div class="badge">[${escapeHtml(ad.instituteType || "IIT/NIT")}] ${escapeHtml(ad.institute || "Unknown institute")}</div>
      <h3>${escapeHtml(ad.role || "Not stated")}</h3>
      <p>${escapeHtml(ad.department || "Not stated")}</p>
      <p>Ad date ${escapeHtml(ad.adDate || "Not stated")} | Deadline ${escapeHtml(ad.deadline || "Not stated")}</p>
      <p class="${statusClass}">${escapeHtml(statusText)}</p>
      <p><a href="${escapeAttribute(ad.url || "#")}" target="_blank" rel="noopener noreferrer">Open advertisement</a></p>
      ${DEBUG_MODE ? renderDebug(ad) : ""}
    </article>
  `;
}

function renderDebug(ad) {
  return `
    <details class="debug-block">
      <summary>Debug</summary>
      <p><strong>Title</strong> ${escapeHtml(ad.title || "Not stated")}</p>
      <p><strong>ID</strong> ${escapeHtml(ad.id || "Not stated")}</p>
      <p><strong>URL</strong> <a href="${escapeAttribute(ad.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(ad.url || "Not stated")}</a></p>
      <p><strong>Source page</strong> <a href="${escapeAttribute(ad.sourcePage || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(ad.sourcePage || "Not stated")}</a></p>
    </details>
  `;
}

function daysLeft(deadline) {
  if (!deadline || deadline === "Not stated") return null;

  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;

  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  return Math.round((d.getTime() - today.getTime()) / 86400000);
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
