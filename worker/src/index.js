import { DEPARTMENT_RULES, SOURCES } from "./sources.js";
import { resolvePDFJS } from "pdfjs-serverless";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const USER_AGENT = "Mozilla/5.0 IIT-NIT-Faculty-Tracker/2.0";
const MAX_CHILD_PAGES_PER_SOURCE = 4;
const MAX_PDFS_PER_SOURCE = 4;
const MAX_PDF_PAGES = 6;
const MAX_ANCHORS_PER_PAGE = 120;
const MAX_EVIDENCE_ITEMS_PER_SOURCE = 80;
const ACTIVE_WITHOUT_DEADLINE_DAYS = 21;
const BATCH_COUNT = 12;

const ROLE_RULES = [
  {
    label: "Assistant Professor",
    patterns: [
      /\bassistant professor\b/i,
      /\bassistant\s+prof\.\b/i,
      /\bap\b/i,
    ],
  },
  {
    label: "Associate Professor",
    patterns: [
      /\bassociate professor\b/i,
      /\bassociate\s+prof\.\b/i,
    ],
  },
];

const RECRUITMENT_KEYWORDS = [
  "faculty",
  "recruitment",
  "advertisement",
  "advt",
  "notification",
  "vacancy",
  "vacancies",
  "apply",
  "application",
  "applications",
  "professor",
  "rolling",
  "special recruitment",
  "special drive",
  "teaching positions",
  "faculty position",
  "faculty positions",
];

const GENERIC_PATH_TOKENS = new Set([
  "jobs",
  "job",
  "career",
  "careers",
  "recruitment",
  "faculty",
  "position",
  "positions",
  "advt",
  "advertisement",
  "notification",
  "pdf",
  "html",
  "php",
  "asp",
  "aspx",
  "index",
  "uploads",
  "sites",
  "files",
  "content",
  "home",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        time: new Date().toISOString(),
        version: "grouped-parser-v2",
      });
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
  const nowIso = now.toISOString();
  const currentBatch = Math.floor(now.getTime() / (30 * 60 * 1000)) % BATCH_COUNT;

  const sourcesToCheck = forceAllBatches
    ? SOURCES
    : SOURCES.filter((source) => (source.batch ?? 0) === currentBatch);

  const index = await loadBundleIndex(env);
  const bundleMap = await loadBundleMap(env, index.ids || []);

  const newlySeen = [];
  const touchedIds = new Set();
  const perSourceSummary = [];

  for (const source of sourcesToCheck) {
    try {
      const bundles = await scanSourceToBundles(source);

      const sourceTouched = [];
      for (const bundle of bundles) {
        const existing = bundleMap.get(bundle.id);
        const merged = mergeBundle(existing, bundle, nowIso);

        bundleMap.set(merged.id, merged);
        touchedIds.add(merged.id);
        sourceTouched.push(merged.id);

        if (!existing) {
          newlySeen.push(merged);
        }
      }

      perSourceSummary.push({
        sourceId: source.id,
        institute: source.institute,
        discoveredBundles: sourceTouched.length,
      });
    } catch (error) {
      console.error(`Failed source ${source.id}`, error);
      perSourceSummary.push({
        sourceId: source.id,
        institute: source.institute,
        discoveredBundles: 0,
        error: String(error?.message || error),
      });
    }
  }

  const activeBundleIds = [];
  const inactiveBundleIds = [];

  for (const [bundleId, bundle] of bundleMap.entries()) {
    const active = isBundleActive(bundle, now);
    const nextBundle = {
      ...bundle,
      status: active ? "active" : "inactive",
    };
    bundleMap.set(bundleId, nextBundle);

    if (active) {
      activeBundleIds.push(bundleId);
    } else {
      inactiveBundleIds.push(bundleId);
    }
  }

  const nextIndexIds = [...new Set([...index.ids, ...bundleMap.keys()])];
  await saveBundleIndex(env, { ids: nextIndexIds, updatedAt: nowIso });

  const writes = [];
  for (const [bundleId, bundle] of bundleMap.entries()) {
    writes.push(env.ALERTS_KV.put(bundleKey(bundleId), JSON.stringify(bundle)));
  }
  writes.push(env.ALERTS_KV.put("lastScan", nowIso));
  await Promise.all(writes);

  const newActiveAds = sortAds(newlySeen.filter((b) => isBundleActive(b, now)).map(toApiAd));

  if (newActiveAds.length > 0) {
    await notifyNewAds(newActiveAds, env);
  }

  return {
    ok: true,
    checkedSources: sourcesToCheck.map((s) => s.id),
    checkedCount: sourcesToCheck.length,
    activeCount: activeBundleIds.length,
    inactiveCount: inactiveBundleIds.length,
    newCount: newActiveAds.length,
    newAds: newActiveAds,
    touchedBundles: touchedIds.size,
    currentBatch: forceAllBatches ? "all" : currentBatch,
    sources: perSourceSummary,
  };
}

async function loadActiveAds(env) {
  const index = await loadBundleIndex(env);
  if (!Array.isArray(index.ids) || index.ids.length === 0) {
    return [];
  }

  const bundleMap = await loadBundleMap(env, index.ids);
  const now = new Date();

  const ads = [];
  for (const bundle of bundleMap.values()) {
    if (isBundleActive(bundle, now)) {
      ads.push(toApiAd(bundle));
    }
  }

  return sortAds(dedupeAds(ads));
}

async function loadBundleIndex(env) {
  const raw = await env.ALERTS_KV.get("bundleIndex");
  if (!raw) {
    return { ids: [], updatedAt: null };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      ids: Array.isArray(parsed.ids) ? parsed.ids : [],
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return { ids: [], updatedAt: null };
  }
}

async function saveBundleIndex(env, payload) {
  await env.ALERTS_KV.put("bundleIndex", JSON.stringify(payload));
}

async function loadBundleMap(env, ids) {
  const map = new Map();
  for (const id of ids) {
    const raw = await env.ALERTS_KV.get(bundleKey(id));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      map.set(id, parsed);
    } catch {
      // ignore bad record
    }
  }
  return map;
}

function bundleKey(id) {
  return `bundle:${id}`;
}

async function scanSourceToBundles(source) {
  const rootHtml = await fetchText(source.pageUrl);
  const rootPage = extractHtmlPage(rootHtml, source.pageUrl, {
    sourceId: source.id,
    institute: source.institute,
    instituteType: source.instituteType,
    pageKind: "root",
  });

  const rootRelevantAnchors = rootPage.anchors
    .filter((a) => isRelevantLinkCandidate(a))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ANCHORS_PER_PAGE);

  const selectedChildAnchors = rootRelevantAnchors
    .filter((a) => !a.isPdf && a.score >= 2)
    .slice(0, MAX_CHILD_PAGES_PER_SOURCE);

  const selectedPdfAnchors = rootRelevantAnchors
    .filter((a) => a.isPdf)
    .slice(0, MAX_PDFS_PER_SOURCE);

  const evidenceItems = [];

  evidenceItems.push(
    makeEvidenceItem({
      kind: "page-summary",
      url: source.pageUrl,
      parentUrl: null,
      title: rootPage.title || `${source.institute} jobs`,
      text: compactText(`${rootPage.title || ""} ${rootPage.pageText.slice(0, 2500)}`),
      source,
      score: pageLevelRecruitmentScore(rootPage.pageText),
    })
  );

  for (const anchor of rootRelevantAnchors) {
    evidenceItems.push(
      makeEvidenceItem({
        kind: "anchor",
        url: anchor.url,
        parentUrl: source.pageUrl,
        title: anchor.text || anchor.title || "",
        text: compactText(
          [
            anchor.heading,
            anchor.text,
            anchor.title,
            anchor.context,
            anchor.url,
          ]
            .filter(Boolean)
            .join(" ")
        ),
        source,
        score: anchor.score,
      })
    );
  }

  for (const anchor of selectedChildAnchors) {
    try {
      const childHtml = await fetchText(anchor.url);
      const childPage = extractHtmlPage(childHtml, anchor.url, {
        sourceId: source.id,
        institute: source.institute,
        instituteType: source.instituteType,
        pageKind: "child",
      });

      evidenceItems.push(
        makeEvidenceItem({
          kind: "child-page",
          url: anchor.url,
          parentUrl: source.pageUrl,
          title: childPage.title || anchor.text || "",
          text: compactText(
            [
              childPage.title,
              anchor.heading,
              anchor.text,
              childPage.pageText.slice(0, 3500),
            ]
              .filter(Boolean)
              .join(" ")
          ),
          source,
          score: Math.max(anchor.score, pageLevelRecruitmentScore(childPage.pageText)),
        })
      );

      const childRelevantAnchors = childPage.anchors
        .filter((a) => isRelevantLinkCandidate(a))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      for (const childAnchor of childRelevantAnchors) {
        evidenceItems.push(
          makeEvidenceItem({
            kind: childAnchor.isPdf ? "pdf-link" : "child-anchor",
            url: childAnchor.url,
            parentUrl: anchor.url,
            title: childAnchor.text || childAnchor.title || "",
            text: compactText(
              [
                childAnchor.heading,
                childAnchor.text,
                childAnchor.title,
                childAnchor.context,
                childAnchor.url,
              ]
                .filter(Boolean)
                .join(" ")
            ),
            source,
            score: childAnchor.score,
          })
        );
      }

      const extraPdfs = childRelevantAnchors
        .filter((a) => a.isPdf)
        .slice(0, Math.max(0, MAX_PDFS_PER_SOURCE - selectedPdfAnchors.length));

      for (const pdfAnchor of extraPdfs) {
        try {
          const pdfText = await extractPdfText(pdfAnchor.url, MAX_PDF_PAGES);
          evidenceItems.push(
            makeEvidenceItem({
              kind: "pdf",
              url: pdfAnchor.url,
              parentUrl: anchor.url,
              title: pdfAnchor.text || pdfAnchor.title || fileNameFromUrl(pdfAnchor.url),
              text: compactText(
                [
                  pdfAnchor.heading,
                  pdfAnchor.text,
                  pdfAnchor.title,
                  pdfText,
                ]
                  .filter(Boolean)
                  .join(" ")
              ),
              source,
              score: Math.max(3, pdfAnchor.score + 1),
            })
          );
        } catch (error) {
          console.error(`Failed PDF ${pdfAnchor.url}`, error);
        }
      }
    } catch (error) {
      console.error(`Failed child page ${anchor.url}`, error);
    }
  }

  for (const anchor of selectedPdfAnchors) {
    try {
      const pdfText = await extractPdfText(anchor.url, MAX_PDF_PAGES);
      evidenceItems.push(
        makeEvidenceItem({
          kind: "pdf",
          url: anchor.url,
          parentUrl: source.pageUrl,
          title: anchor.text || anchor.title || fileNameFromUrl(anchor.url),
          text: compactText(
            [
              anchor.heading,
              anchor.text,
              anchor.title,
              anchor.context,
              pdfText,
            ]
              .filter(Boolean)
              .join(" ")
          ),
          source,
          score: Math.max(3, anchor.score + 1),
        })
      );
    } catch (error) {
      console.error(`Failed PDF ${anchor.url}`, error);
    }
  }

  const compactEvidence = evidenceItems
    .filter((item) => item.score >= 1)
    .slice(0, MAX_EVIDENCE_ITEMS_PER_SOURCE);

  const clusters = clusterEvidence(compactEvidence, source);
  const bundles = [];

  for (const cluster of clusters) {
    const bundle = buildBundleFromCluster(cluster, source);
    if (bundle) {
      bundles.push(bundle);
    }
  }

  return dedupeBundles(bundles);
}

function extractHtmlPage(html, pageUrl, meta = {}) {
  const cleanedHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");

  const titleMatch = cleanedHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = compactText(titleMatch ? decodeHtml(titleMatch[1]) : "");

  const anchors = [];
  const anchorRegex = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(cleanedHtml)) !== null) {
    const rawHref = match[2];
    const absoluteUrl = safeUrl(rawHref, pageUrl);
    if (!absoluteUrl) continue;

    const attrs = `${match[1] || ""} ${match[3] || ""}`;
    const text = compactText(stripTags(match[4] || ""));
    const titleAttr = compactText(extractAttr(attrs, "title"));
    const snippet = cleanedHtml.slice(Math.max(0, match.index - 600), Math.min(cleanedHtml.length, match.index + 1200));
    const context = compactText(stripTags(snippet));
    const heading = nearestHeadingText(cleanedHtml, match.index);

    const anchor = {
      url: absoluteUrl,
      text,
      title: titleAttr,
      context,
      heading,
      isPdf: /\.pdf(\?|#|$)/i.test(absoluteUrl),
      score: linkScore({ url: absoluteUrl, text, title: titleAttr, context, heading }),
    };

    anchors.push(anchor);
  }

  const pageText = compactText(stripTags(cleanedHtml));

  return {
    ...meta,
    url: pageUrl,
    title: pageTitle,
    pageText,
    anchors,
  };
}

function nearestHeadingText(html, index) {
  const window = html.slice(Math.max(0, index - 1500), index);
  const matches = [...window.matchAll(/<(h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/\1>/gi)];
  if (matches.length === 0) return "";
  const last = matches[matches.length - 1];
  return compactText(stripTags(last[2] || ""));
}

function makeEvidenceItem({ kind, url, parentUrl, title, text, source, score }) {
  const mergedText = compactText([title, text, url].filter(Boolean).join(" "));
  return {
    kind,
    url,
    parentUrl,
    title: compactText(title || ""),
    text: mergedText,
    sourceId: source.id,
    institute: source.institute,
    instituteType: source.instituteType,
    score: Math.max(0, score || 0),
    adNumber: extractAdvertisementNumber(mergedText),
    year: extractLikelyYear(mergedText, url),
    roles: extractRoles(mergedText),
    departments: extractDepartments(mergedText),
    fingerprint: computeEvidenceFingerprint(mergedText, url),
  };
}

function isRelevantLinkCandidate(anchor) {
  const full = compactText(
    [anchor.heading, anchor.text, anchor.title, anchor.context, anchor.url].filter(Boolean).join(" ")
  ).toLowerCase();

  if (!full) return false;
  if (/\b(staff nurse|non[-\s]?teaching|administrative|tender|quotation|result|syllabus|exam|student)\b/i.test(full)) {
    return false;
  }

  const hasRecruitmentSignal =
    RECRUITMENT_KEYWORDS.some((kw) => full.includes(kw)) ||
    ROLE_RULES.some((r) => r.patterns.some((p) => p.test(full)));

  return hasRecruitmentSignal || /\.pdf(\?|#|$)/i.test(anchor.url);
}

function pageLevelRecruitmentScore(text) {
  const t = (text || "").toLowerCase();
  let score = 0;
  if (t.includes("faculty")) score += 1;
  if (t.includes("recruitment")) score += 2;
  if (t.includes("assistant professor")) score += 2;
  if (t.includes("associate professor")) score += 2;
  if (t.includes("deadline")) score += 1;
  if (t.includes("last date")) score += 1;
  return score;
}

function linkScore({ url, text, title, context, heading }) {
  const full = compactText([heading, text, title, context, url].filter(Boolean).join(" ")).toLowerCase();
  let score = 0;

  if (/\.pdf(\?|#|$)/i.test(url)) score += 2;
  if (full.includes("faculty")) score += 2;
  if (full.includes("recruitment")) score += 2;
  if (full.includes("advertisement")) score += 2;
  if (full.includes("notification")) score += 1;
  if (full.includes("vacancy")) score += 1;
  if (full.includes("apply")) score += 1;
  if (full.includes("assistant professor")) score += 3;
  if (full.includes("associate professor")) score += 3;
  if (full.includes("rolling")) score += 1;
  if (full.includes("special recruitment")) score += 2;
  if (full.includes("special drive")) score += 2;
  if (extractLikelyYear(full, url)) score += 1;

  if (/\b(staff nurse|non[-\s]?teaching|administrative|tender|quotation|result|student)\b/i.test(full)) {
    score -= 4;
  }

  return score;
}

function clusterEvidence(evidenceItems, source) {
  const groups = new Map();

  for (const item of evidenceItems) {
    const key = computeClusterKey(item, source);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  const clusters = [...groups.entries()]
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => b.score - a.score),
    }))
    .filter((cluster) => cluster.items.length > 0)
    .sort((a, b) => clusterScore(b) - clusterScore(a));

  return clusters;
}

function clusterScore(cluster) {
  return cluster.items.reduce((sum, item) => sum + item.score, 0) + cluster.items.length;
}

function computeClusterKey(item, source) {
  const base = compactText([item.title, item.text].filter(Boolean).join(" ")).toLowerCase();

  const adNo = item.adNumber ? `adno-${item.adNumber}` : "";
  const year = item.year ? `y-${item.year}` : "";

  let phrase = "";
  if (/\bspecial recruitment drive\b/i.test(base)) phrase = "special-recruitment-drive";
  else if (/\bspecial recruitment\b/i.test(base)) phrase = "special-recruitment";
  else if (/\brolling advertisement\b/i.test(base)) phrase = "rolling-advertisement";
  else if (/\bfaculty recruitment\b/i.test(base)) phrase = "faculty-recruitment";
  else if (/\bfaculty positions?\b/i.test(base)) phrase = "faculty-position";
  else if (/\bassistant professor\b/i.test(base) && /\bassociate professor\b/i.test(base)) phrase = "ap-plus-assoc";
  else if (/\bassistant professor\b/i.test(base)) phrase = "assistant-professor";
  else if (/\bassociate professor\b/i.test(base)) phrase = "associate-professor";

  const stem = pathStem(item.url);
  const roleStem = item.roles.map((r) => r.toLowerCase().replace(/\s+/g, "-")).sort().join("-");
  const deptStem = item.departments.map((d) => d.toLowerCase().replace(/\s+/g, "-")).sort().join("-").slice(0, 60);

  const rawKey = [
    source.institute.toLowerCase().replace(/\s+/g, "-"),
    adNo,
    year,
    phrase,
    roleStem,
    deptStem,
    stem,
  ]
    .filter(Boolean)
    .join("|");

  return rawKey || `${source.id}|fallback`;
}

function pathStem(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .toLowerCase()
      .split("/")
      .flatMap((p) => p.split(/[_\-\.]+/))
      .filter(Boolean)
      .filter((p) => !GENERIC_PATH_TOKENS.has(p))
      .filter((p) => !/^\d+$/.test(p));

    return parts.slice(0, 5).join("-");
  } catch {
    return "";
  }
}

function buildBundleFromCluster(cluster, source) {
  const mergedText = compactText(cluster.items.map((i) => i.text).join(" "));
  const roles = extractRoles(mergedText);
  const departments = extractDepartments(mergedText);

  if (roles.length === 0 || departments.length === 0) {
    return null;
  }

  const deadline = extractDeadline(mergedText);
  const adDate = extractAdDate(mergedText);
  const adNumber = extractAdvertisementNumber(mergedText);

  const canonical = chooseCanonicalItem(cluster.items);
  const title = chooseBundleTitle(cluster.items, roles, departments, source);
  const bundleId = stableId(
    [
      source.institute,
      adNumber || "",
      adDate || "",
      deadline || "",
      roles.slice().sort().join("|"),
      departments.slice().sort().join("|"),
      pathStem(canonical.url || ""),
      extractLikelyYear(mergedText, canonical.url || "") || "",
    ].join("||")
  );

  const urlList = [...new Set(cluster.items.map((i) => i.url).filter(Boolean))];
  const summary = compactText(
    [
      title,
      adNumber ? `Advt ${adNumber}` : "",
      adDate ? `Ad date ${adDate}` : "",
      deadline ? `Deadline ${deadline}` : "",
    ]
      .filter(Boolean)
      .join(" ")
  );

  const bundle = {
    id: bundleId,
    institute: source.institute,
    instituteType: source.instituteType,
    sourceId: source.id,
    sourceUrl: source.pageUrl,
    url: canonical.url || source.pageUrl,
    canonicalUrl: canonical.url || source.pageUrl,
    evidenceUrls: urlList,
    evidenceKinds: [...new Set(cluster.items.map((i) => i.kind))],
    evidenceCount: cluster.items.length,
    title,
    role: roles.join(" / "),
    department: departments.join(" / "),
    roles,
    departments,
    adDate: adDate || null,
    deadline: deadline || null,
    adNumber: adNumber || null,
    year: extractLikelyYear(mergedText, canonical.url || "") || null,
    summary,
    textSample: mergedText.slice(0, 4000),
    clusterKey: cluster.key,
    score: clusterScore(cluster),
    status: "active",
  };

  return bundle;
}

function chooseCanonicalItem(items) {
  const sorted = [...items].sort((a, b) => {
    const kindRank = kindPriority(b.kind) - kindPriority(a.kind);
    if (kindRank !== 0) return kindRank;
    return b.score - a.score;
  });
  return sorted[0] || items[0];
}

function kindPriority(kind) {
  if (kind === "pdf") return 5;
  if (kind === "child-page") return 4;
  if (kind === "pdf-link") return 3;
  if (kind === "anchor") return 2;
  return 1;
}

function chooseBundleTitle(items, roles, departments, source) {
  const best = chooseCanonicalItem(items);
  const bestTitle = compactText(best?.title || "");

  if (bestTitle && bestTitle.length >= 8) {
    return bestTitle;
  }

  if (roles.length > 0 && departments.length > 0) {
    return `${roles.join(" / ")} in ${departments.join(" / ")} at ${source.institute}`;
  }

  return `Faculty advertisement at ${source.institute}`;
}

function mergeBundle(existing, incoming, nowIso) {
  if (!existing) {
    return {
      ...incoming,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      status: "active",
    };
  }

  const richer = incoming.textSample && incoming.textSample.length > (existing.textSample || "").length ? incoming : existing;
  const canonicalUrl =
    incoming.url && /\.pdf(\?|#|$)/i.test(incoming.url) ? incoming.url : existing.canonicalUrl || incoming.url;

  return {
    ...richer,
    firstSeenAt: existing.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    url: canonicalUrl || incoming.url || existing.url,
    canonicalUrl: canonicalUrl || incoming.canonicalUrl || existing.canonicalUrl,
    evidenceUrls: [...new Set([...(existing.evidenceUrls || []), ...(incoming.evidenceUrls || [])])],
    evidenceKinds: [...new Set([...(existing.evidenceKinds || []), ...(incoming.evidenceKinds || [])])],
    evidenceCount: Math.max(existing.evidenceCount || 0, incoming.evidenceCount || 0),
    score: Math.max(existing.score || 0, incoming.score || 0),
    adDate: incoming.adDate || existing.adDate || null,
    deadline: incoming.deadline || existing.deadline || null,
    adNumber: incoming.adNumber || existing.adNumber || null,
    role: incoming.role || existing.role,
    department: incoming.department || existing.department,
    roles: mergeStringArrays(existing.roles, incoming.roles),
    departments: mergeStringArrays(existing.departments, incoming.departments),
    summary: incoming.summary || existing.summary,
    textSample:
      (incoming.textSample || "").length >= (existing.textSample || "").length
        ? incoming.textSample
        : existing.textSample,
    status: "active",
  };
}

function mergeStringArrays(a = [], b = []) {
  return [...new Set([...(a || []), ...(b || [])])];
}

function isBundleActive(bundle, now = new Date()) {
  if (!bundle) return false;

  const deadlineDate = parseDateForComparison(bundle.deadline);
  if (deadlineDate) {
    const grace = new Date(deadlineDate);
    grace.setDate(grace.getDate() + 1);
    return grace >= now;
  }

  const lastSeen = parseDateForComparison(bundle.lastSeenAt);
  if (!lastSeen) return true;

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - ACTIVE_WITHOUT_DEADLINE_DAYS);

  return lastSeen >= cutoff;
}

function toApiAd(bundle) {
  return {
    id: bundle.id,
    instituteType: bundle.instituteType,
    institute: bundle.institute,
    role: bundle.role || "Not stated",
    department: bundle.department || "Not stated",
    adDate: bundle.adDate || "Not stated",
    deadline: bundle.deadline || "Not stated",
    url: bundle.url || bundle.sourceUrl,
    title: bundle.title || "",
    sourceUrl: bundle.sourceUrl || "",
    adNumber: bundle.adNumber || "",
    evidenceCount: bundle.evidenceCount || 0,
  };
}

function dedupeBundles(bundles) {
  const map = new Map();

  for (const bundle of bundles) {
    const semanticKey = [
      bundle.institute,
      bundle.adNumber || "",
      bundle.adDate || "",
      bundle.deadline || "",
      (bundle.roles || []).slice().sort().join("|"),
      (bundle.departments || []).slice().sort().join("|"),
    ].join("||");

    const existing = map.get(semanticKey);
    if (!existing || (bundle.textSample || "").length > (existing.textSample || "").length) {
      map.set(semanticKey, bundle);
    }
  }

  return [...map.values()];
}

function dedupeAds(ads) {
  const map = new Map();
  for (const ad of ads) {
    const key = [
      ad.institute || "",
      ad.role || "",
      ad.department || "",
      ad.adDate || "",
      ad.deadline || "",
    ].join("||");
    if (!map.has(key)) {
      map.set(key, ad);
    }
  }
  return [...map.values()];
}

function sortAds(ads) {
  return [...ads].sort((a, b) => {
    const da = parseDateForComparison(a.deadline) || parseDateForComparison(a.adDate) || new Date(0);
    const db = parseDateForComparison(b.deadline) || parseDateForComparison(b.adDate) || new Date(0);
    return db - da;
  });
}

function extractRoles(text) {
  const matches = [];
  for (const rule of ROLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      matches.push(rule.label);
    }
  }
  return matches;
}

function extractDepartments(text) {
  const matches = [];
  for (const rule of DEPARTMENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      matches.push(rule.label);
    }
  }
  return matches;
}

function extractAdvertisementNumber(text) {
  const patterns = [
    /\b(?:advt\.?|advertisement|advt\s*no\.?|advertisement\s*no\.?)\s*[:\-]?\s*([A-Za-z0-9\/.\-]+)\b/i,
    /\bno\.?\s*[:\-]?\s*([A-Za-z0-9\/.\-]{4,})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

function extractAdDate(text) {
  const patterns = [
    /\b(?:date of publication|published on|publication date|date of advertisement|advertisement date|date)\s*[:\-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})\b/i,
    /\bdated\s*[:\-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return normalizeDate(match[1]);
    }
  }

  const allDates = extractAllCandidateDates(text);
  return allDates.length > 0 ? allDates[0] : null;
}

function extractDeadline(text) {
  const patterns = [
    /\b(?:last date(?: for .*?)?|closing date|closing on|deadline|last\s+date\s+for\s+submission|last date of receipt of application(?:s)?|last date to apply|apply by)\s*[:\-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})\b/i,
    /\b(?:applications? .*? accepted .*? till)\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return normalizeDate(match[1]);
    }
  }

  const futureDates = extractAllCandidateDates(text)
    .map((d) => ({ raw: d, date: parseDateForComparison(d) }))
    .filter((x) => x.date)
    .sort((a, b) => a.date - b.date);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nextFuture = futureDates.find((x) => x.date >= today);
  return nextFuture ? normalizeDate(nextFuture.raw) : null;
}

function extractAllCandidateDates(text) {
  const matches = [];
  const regex = /\b([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})\b/g;
  for (const match of text.matchAll(regex)) {
    const normalized = normalizeDate(match[1]);
    if (normalized) matches.push(normalized);
  }
  return [...new Set(matches)];
}

function extractLikelyYear(text, url = "") {
  const merged = `${text} ${url}`;
  const years = [...merged.matchAll(/\b(20[2-4][0-9])\b/g)].map((m) => m[1]);
  if (years.length === 0) return null;
  const counts = new Map();
  for (const y of years) counts.set(y, (counts.get(y) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function normalizeDate(raw) {
  if (!raw) return null;
  const date = parseDateForComparison(raw);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function parseDateForComparison(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

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

async function extractPdfText(url, maxPages = MAX_PDF_PAGES) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`PDF fetch failed ${response.status} for ${url}`);
  }

  const data = await response.arrayBuffer();
  const pdfjs = await resolvePDFJS();
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;

  const pages = Math.min(pdf.numPages, maxPages);
  let combined = "";

  for (let i = 1; i <= pages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str || "").join(" ");
    combined += ` ${pageText}`;
  }

  return compactText(combined);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}`);
  }

  return await response.text();
}

async function notifyNewAds(newAds, env) {
  if (!env.ALERT_WEBHOOK_URL) return;

  try {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: `New IIT/NIT faculty ads ${newAds.length}`,
        count: newAds.length,
        ads: newAds,
      }),
    });
  } catch (error) {
    console.error("Notification failed", error);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function safeUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function stripTags(input) {
  return decodeHtml(String(input || "").replace(/<[^>]+>/g, " "));
}

function decodeHtml(input) {
  return String(input || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function compactText(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function extractAttr(attrs, name) {
  const regex = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = attrs.match(regex);
  return match ? decodeHtml(match[1]) : "";
}

function fileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last || url;
  } catch {
    return url;
  }
}

function computeEvidenceFingerprint(text, url) {
  return stableId(`${pathStem(url)}||${compactText(text).slice(0, 500)}`);
}

function stableId(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}
