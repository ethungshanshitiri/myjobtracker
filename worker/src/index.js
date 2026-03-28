import { DEPARTMENT_RULES, SOURCES } from "./sources.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, time: new Date().toISOString() });
    }

    if (url.pathname === "/api/ads") {
      const ads = await loadActiveAds(env);
      return json(sortAds(ads));
    }

    if (url.pathname === "/api/scan-now") {
      const result = await runScan(env, true);
      return json(result);
    }

    return new Response("Not found", {
      status: 404,
      headers: CORS_HEADERS,
    });
  },

  async scheduled(_event, env, _ctx) {
    await runScan(env, false);
  },
};

async function runScan(env, forceAllBatches = false) {
  const now = new Date();
  const minute = now.getUTCMinutes();

  const batchCount = 3;
  const currentBatch = minute % batchCount;
  const sourcesToCheck = forceAllBatches
    ? SOURCES
    : SOURCES.filter((source) => source.batch === currentBatch);

  const foundNow = [];
  const newAds = [];
  const previousAds = await loadActiveAds(env);
  const previousIds = new Set(previousAds.map((ad) => ad.id));

  for (const source of sourcesToCheck) {
    try {
      const ads = await parseSourcePage(source);

      for (const ad of ads) {
        foundNow.push(ad);

        if (!previousIds.has(ad.id)) {
          newAds.push(ad);
          await env.ALERTS_KV.put(`seen:${ad.id}`, now.toISOString());
        }
      }
    } catch (error) {
      console.error(`Failed source ${source.id}`, error);
    }
  }

  const freshActiveAds = dedupeAds(foundNow);

  await env.ALERTS_KV.put("activeAds", JSON.stringify(sortAds(freshActiveAds)));
  await env.ALERTS_KV.put("lastScan", now.toISOString());

  const sortedNewAds = sortAds(dedupeAds(newAds));
  if (sortedNewAds.length > 0) {
    await notifyNewAds(sortedNewAds, env);
  }

  return {
    ok: true,
    checkedSources: sourcesToCheck.map((s) => s.id),
    foundCount: freshActiveAds.length,
    newCount: sortedNewAds.length,
    newAds: sortedNewAds,
  };
}

async function loadActiveAds(env) {
  const raw = await env.ALERTS_KV.get("activeAds");
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function parseSourcePage(source) {
  const response = await fetch(source.pageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 IIT-NIT-Faculty-Alert-Starter",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${source.pageUrl}`);
  }

  const html = await response.text();
  const anchors = extractAnchorsWithContext(html, source.pageUrl);

  const ads = [];

  for (const anchor of anchors) {
    const localContext = `${anchor.text} ${anchor.contextText} ${anchor.href}`;
    const role = detectRole(localContext);
    const department = detectDepartment(localContext);

    if (!role || !department) continue;

    const localDateHints = detectDates(localContext);
    const adDate = detectAdDate(localContext) || localDateHints.firstDate || "Not stated";
    const deadline = detectDeadline(localContext) || localDateHints.secondDate || "Not stated";
    const title = cleanText(anchor.text) || `${source.institute} recruitment`;

    if (!isCurrentOpening(`${title} ${localContext}`)) continue;

    const id = makeId(`${source.institute}|${title}|${anchor.href}|${role}|${department}`);

    ads.push({
      id,
      instituteType: source.instituteType,
      institute: source.institute,
      role,
      department,
      adDate,
      deadline,
      url: anchor.href,
      title,
      sourcePage: source.pageUrl,
      firstSeen: new Date().toISOString(),
    });
  }

  return dedupeAds(ads);
}

const EXCLUDE_PATTERNS = [
  /\bshortlisted\b/i,
  /\bshortlist\b/i,
  /\binterview schedule\b/i,
  /\bteaching presentation\b/i,
  /\bscreening test\b/i,
  /\bresult of faculty recruitment\b/i,
  /\bresult\b/i,
  /\bshort term course\b/i,
  /\bworkshop\b/i,
  /\bconference\b/i,
  /\btraining\b/i,
];

function extractAnchorsWithContext(html, baseUrl) {
  const anchors = [];
  const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const rawHref = match[1];
    const text = cleanText(stripTags(match[2]));
    const href = toAbsoluteUrl(rawHref, baseUrl);

    if (!href) continue;
    if (!text && !href.toLowerCase().endsWith(".pdf")) continue;
    if (/^(mailto:|javascript:|tel:)/i.test(href)) continue;

    const contextStart = Math.max(0, match.index - 600);
    const contextEnd = Math.min(html.length, regex.lastIndex + 600);
    const contextText = cleanText(stripTags(html.slice(contextStart, contextEnd)));

    const joined = `${text} ${href} ${contextText}`.toLowerCase();
    const looksRelevant =
      joined.includes("faculty") ||
      joined.includes("assistant professor") ||
      joined.includes("associate professor") ||
      joined.includes("recruit") ||
      href.toLowerCase().endsWith(".pdf");

    if (!looksRelevant) continue;

    anchors.push({ href, text, contextText });
  }

  return anchors;
}

function detectRole(text) {
  const t = text.toLowerCase();
  const hasAssistant = /\bassistant professor\b/.test(t);
  const hasAssociate = /\bassociate professor\b/.test(t);

  if (hasAssistant && hasAssociate) return "Assistant Professor / Associate Professor";
  if (hasAssistant) return "Assistant Professor";
  if (hasAssociate) return "Associate Professor";
  return null;
}

function detectDepartment(text) {
  for (const rule of DEPARTMENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return rule.label;
      }
    }
  }
  return null;
}

function detectDates(text) {
  const matches = [...text.matchAll(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g)]
    .map((m) => normalizeDate(m[1]))
    .filter(Boolean);

  return {
    firstDate: matches[0] || null,
    secondDate: matches[1] || null,
  };
}

function detectAdDate(text) {
  const patterns = [
    /ad(?:vertisement)?\s*date[^\w]{0,5}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i,
    /dated?[^\w]{0,5}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return normalizeDate(m[1]);
  }

  return null;
}

function detectDeadline(text) {
  const patterns = [
    /deadline[^\w]{0,5}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i,
    /last\s+date[^\w]{0,5}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i,
    /closing\s+date[^\w]{0,5}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return normalizeDate(m[1]);
  }

  return null;
}

const CURRENT_OPEN_PATTERNS = [
  /\bapplications?\s+are\s+invited\b/i,
  /\bapply\s+now\b/i,
  /\bapplications?\s+opened\b/i,
  /\bopen\s+now\b/i,
  /\brolling advertisement\b/i,
  /\bactive now\b/i,
  /\bforms?\s+are\s+active now\b/i,
  /\bregular drive is opened\b/i,
];

const CLOSED_OR_POST_AD_PATTERNS = [
  /\bclosed\b/i,
  /\bshortlisted\b/i,
  /\bshortlist\b/i,
  /\binterview schedule\b/i,
  /\bteaching presentation\b/i,
  /\bscreening test\b/i,
  /\bresult of faculty recruitment\b/i,
  /\bresult\b/i,
  /\bselection list\b/i,
];

function isCurrentOpening(text) {
  const t = text.toLowerCase();

  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(t)) return false;
  }

  for (const pattern of CLOSED_OR_POST_AD_PATTERNS) {
    if (pattern.test(t)) return false;
  }

  for (const pattern of CURRENT_OPEN_PATTERNS) {
    if (pattern.test(t)) return true;
  }

  return hasFutureDate(text);
}

function hasFutureDate(text) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (const match of text.matchAll(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g)) {
    const d = parseDateForComparison(match[1]);
    if (d && d >= now) return true;
  }

  return false;
}

function parseDateForComparison(raw) {
  if (!raw) return null;

  const trimmed = raw.trim();

  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const cleaned = trimmed.replace(/\./g, "/").replace(/-/g, "/");
  const parts = cleaned.split("/");

  if (parts.length !== 3) return null;

  let [dd, mm, yyyy] = parts;
  if (yyyy.length === 2) yyyy = `20${yyyy}`;

  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeDate(raw) {
  if (!raw) return null;

  const trimmed = raw.trim();

  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/.test(trimmed)) {
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return trimmed;
    return formatDate(date);
  }

  const cleaned = trimmed.replace(/\./g, "/").replace(/-/g, "/");
  const parts = cleaned.split("/");

  if (parts.length !== 3) return trimmed;

  let [dd, mm, yyyy] = parts;
  if (yyyy.length === 2) yyyy = `20${yyyy}`;

  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (Number.isNaN(date.getTime())) return trimmed;

  return formatDate(date);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function sortAds(ads) {
  return [...ads].sort((a, b) => {
    const da = deadlineSortValue(a.deadline);
    const db = deadlineSortValue(b.deadline);

    if (da !== db) return da - db;
    return (a.institute || "").localeCompare(b.institute || "");
  });
}

function deadlineSortValue(deadline) {
  if (!deadline || deadline === "Not stated") return Number.MAX_SAFE_INTEGER;

  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return Number.MAX_SAFE_INTEGER;

  return date.getTime();
}

async function notifyNewAds(newAds, env) {
  const lines = newAds.map(formatAlertLine);
  const message = lines.join("\n\n");

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await sendTelegram(message, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
  }

  if (env.RESEND_API_KEY && env.ALERT_EMAIL_TO && env.ALERT_EMAIL_FROM) {
    await sendEmail(newAds, env);
  }
}

function formatAlertLine(ad) {
  return `[${ad.instituteType}] ${ad.institute} | ${ad.role} | ${ad.department} | Ad date ${ad.adDate || "Not stated"} | Deadline ${ad.deadline || "Not stated"} | ${ad.url}`;
}

async function sendTelegram(message, botToken, chatId) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram failed: ${response.status} ${text}`);
  }
}

async function sendEmail(newAds, env) {
  const subject = `${newAds.length} new IIT/NIT faculty alert${newAds.length > 1 ? "s" : ""}`;

  const html = `
    <h2>${escapeHtml(subject)}</h2>
    <ul>
      ${newAds.map((ad) => `<li>${escapeHtml(formatAlertLine(ad))}</li>`).join("")}
    </ul>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.ALERT_EMAIL_FROM,
      to: [env.ALERT_EMAIL_TO],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend failed: ${response.status} ${text}`);
  }
}

function dedupeAds(ads) {
  const map = new Map();

  for (const ad of ads) {
    map.set(ad.id, ad);
  }

  return [...map.values()];
}

function makeId(input) {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return `ad_${(hash >>> 0).toString(16)}`;
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}
