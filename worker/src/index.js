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

  const activeAds = await loadActiveAds(env);
  const batchCount = 3;
  const currentBatch = minute % batchCount;
  const sourcesToCheck = forceAllBatches
    ? SOURCES
    : SOURCES.filter((source) => source.batch === currentBatch);

  const foundNow = [];
  const newAds = [];
  const existingSeen = new Set(activeAds.map((ad) => ad.id));

  for (const source of sourcesToCheck) {
    try {
      const ads = await parseSourcePage(source);

      for (const ad of ads) {
        const seenKey = `seen:${ad.id}`;
        const alreadySeen = await env.ALERTS_KV.get(seenKey);

        foundNow.push(ad);

        if (!alreadySeen && !existingSeen.has(ad.id)) {
          newAds.push(ad);
          await env.ALERTS_KV.put(seenKey, now.toISOString());
        }
      }
    } catch (error) {
      console.error(`Failed source ${source.id}`, error);
    }
  }

  const mergedAds = dedupeAds([...activeAds, ...foundNow]);
  const sortedAds = sortAds(mergedAds);

  await env.ALERTS_KV.put("activeAds", JSON.stringify(sortedAds));
  await env.ALERTS_KV.put("lastScan", now.toISOString());

  const sortedNewAds = sortAds(dedupeAds(newAds));
  if (sortedNewAds.length > 0) {
    await notifyNewAds(sortedNewAds, env);
  }

  return {
    ok: true,
    checkedSources: sourcesToCheck.map((s) => s.id),
    foundCount: foundNow.length,
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
    const localContext = `${anchor.text} ${anchor.contextText} ${anchor.href}`.trim();

    const role = resolveRole(anchor.text, localContext);
    const department = resolveDepartment(anchor.text, localContext);

    if (!role || !department) continue;

    const dateHints = detectDates(localContext);
    const adDate = detectAdDate(localContext) || dateHints.firstDate || "Not stated";
    const deadline = detectDeadline(localContext) || dateHints.secondDate || "Not stated";
    const title = cleanText(anchor.text) || `${source.institute} recruitment`;
    const canonicalUrl = canonicalizeUrl(anchor.href);
    const semanticKey = buildSemanticKey({
      institute: source.institute,
      role,
      department,
      title,
      deadline,
    });

    ads.push({
      id: makeId(`${source.institute}|${canonicalUrl}|${semanticKey}`),
      dedupeUrlKey: `${source.institute}|${canonicalUrl}`,
      dedupeSemanticKey: semanticKey,
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

    const contextStart = Math.max(0, match.index - 500);
    const contextEnd = Math.min(html.length, regex.lastIndex + 500);
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

function resolveRole(anchorText, localContext) {
  const anchorRoles = findRoles(anchorText);
  if (anchorRoles.length === 1) return anchorRoles[0];
  if (anchorRoles.length === 2) return "Assistant Professor / Associate Professor";

  const contextRoles = findRoles(localContext);
  if (contextRoles.length === 1) return contextRoles[0];

  return null;
}

function findRoles(text) {
  const out = [];
  const t = text.toLowerCase();

  if (/\bassistant professor\b/.test(t)) out.push("Assistant Professor");
  if (/\bassociate professor\b/.test(t)) out.push("Associate Professor");

  return [...new Set(out)];
}

function resolveDepartment(anchorText, localContext) {
  const anchorDepartments = findDepartments(anchorText);
  if (anchorDepartments.length === 1) return anchorDepartments[0];
  if (anchorDepartments.length > 1) return null;

  const contextDepartments = findDepartments(localContext);
  if (contextDepartments.length === 1) return contextDepartments[0];

  return null;
}

function findDepartments(text) {
  const hits = [];

  for (const rule of DEPARTMENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        hits.push(rule.label);
        break;
      }
    }
  }

  return [...new Set(hits)];
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
      ${newAds
        .map((ad) => `<li>${escapeHtml(formatAlertLine(ad))}</li>`)
        .join("")}
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
  const byUrl = new Map();
  const bySemantic = new Map();

  for (const ad of ads) {
    const urlKey = ad.dedupeUrlKey || "";
    const semanticKey = ad.dedupeSemanticKey || "";

    let existing = null;

    if (urlKey && byUrl.has(urlKey)) {
      existing = byUrl.get(urlKey);
    } else if (semanticKey && bySemantic.has(semanticKey)) {
      existing = bySemantic.get(semanticKey);
    }

    if (!existing) {
      const copy = { ...ad };
      if (urlKey) byUrl.set(urlKey, copy);
      if (semanticKey) bySemantic.set(semanticKey, copy);
      continue;
    }

    const merged = mergeAd(existing, ad);
    if (urlKey) byUrl.set(urlKey, merged);
    if (semanticKey) bySemantic.set(semanticKey, merged);

    if (existing.dedupeUrlKey) byUrl.set(existing.dedupeUrlKey, merged);
    if (existing.dedupeSemanticKey) bySemantic.set(existing.dedupeSemanticKey, merged);
  }

  return [...new Set(byUrl.values().concat(bySemantic.values()))];
}

function mergeAd(a, b) {
  const betterTitle = pickBetterString(a.title, b.title);
  const betterDate = pickBetterDate(a.adDate, b.adDate);
  const betterDeadline = pickBetterDate(a.deadline, b.deadline);
  const betterUrl = pickBetterUrl(a.url, b.url);

  return {
    ...a,
    ...b,
    title: betterTitle,
    adDate: betterDate,
    deadline: betterDeadline,
    url: betterUrl,
    dedupeUrlKey: a.dedupeUrlKey || b.dedupeUrlKey,
    dedupeSemanticKey: a.dedupeSemanticKey || b.dedupeSemanticKey,
  };
}

function pickBetterString(a, b) {
  const aa = (a || "").trim();
  const bb = (b || "").trim();
  if (!aa) return bb;
  if (!bb) return aa;
  return bb.length > aa.length ? bb : aa;
}

function pickBetterDate(a, b) {
  if (!a || a === "Not stated") return b || "Not stated";
  if (!b || b === "Not stated") return a;
  return a;
}

function pickBetterUrl(a, b) {
  const aa = a || "";
  const bb = b || "";
  if (!aa) return bb;
  if (!bb) return aa;
  const aPdf = aa.toLowerCase().endsWith(".pdf");
  const bPdf = bb.toLowerCase().endsWith(".pdf");
  if (aPdf && !bPdf) return aa;
  if (bPdf && !aPdf) return bb;
  return aa;
}

function canonicalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";

    const keep = [];
    for (const [k, v] of u.searchParams.entries()) {
      const key = k.toLowerCase();
      if (key.startsWith("utm_")) continue;
      if (key === "fbclid") continue;
      if (key === "gclid") continue;
      keep.push([k, v]);
    }

    u.search = "";
    for (const [k, v] of keep) {
      u.searchParams.append(k, v);
    }

    return u.toString();
  } catch {
    return url;
  }
}

function buildSemanticKey({ institute, role, department, title, deadline }) {
  const normalizedTitle = normalizeTitleStem(title);
  const normalizedDeadline = (deadline || "").toLowerCase().trim();
  return `${institute}|${role}|${department}|${normalizedDeadline}|${normalizedTitle}`;
}

function normalizeTitleStem(title) {
  return cleanText(title || "")
    .toLowerCase()
    .replace(/\b(advertisement|advt|recruitment|faculty|positions?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function makeId(input) {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return `ad_${(hash >>> 0).toString(16)}`;
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
