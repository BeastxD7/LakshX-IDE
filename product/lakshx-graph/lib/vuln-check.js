// LakshX Graph — vulnerability lookup, pure/vscode-free.
//
// Mirrors the design of lib/depgraph.js: all correctness-critical logic (OSV
// request building, response parsing, severity extraction, TTL caching, and
// the batch-then-hydrate orchestration) lives here with zero `vscode` import,
// so it's directly coverable by `node --test` with a mocked `fetchImpl` — no
// real network needed for the test suite. extension.js is the only side that
// touches vscode (editors, diagnostics, decorations, globalState) and the real
// `fetch`.
//
// APPROACH: OSV's POST /v1/querybatch is cheap but deliberately minimal — it
// returns only {id, modified} per hit, no summary/severity/description. So we
// batch-query the WHOLE dependency list first (one request narrows down which
// packages actually have hits), then hydrate full details via GET
// /v1/vulns/{id} for ONLY the ids that hit, capped at a small concurrency so a
// large dependency list can't fan out into dozens of simultaneous requests.
"use strict";

const OSV_QUERY_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL = (id) => `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`;
const ECOSYSTEM = "npm";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h, per the roadmap pitch
const DEFAULT_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

function depKey(name, version) {
  return name + "@" + (version || "");
}

/** Build one OSV query object for a package (+ optional pinned version). */
function buildEcosystemQuery(name, version) {
  const q = { package: { name, ecosystem: ECOSYSTEM } };
  if (version) q.version = version;
  return q;
}

/** Dedupe a dep list by (name, version), preserving first-seen order. */
function dedupeDeps(deps) {
  const seen = new Map();
  for (const d of deps || []) {
    if (!d || !d.name) continue;
    const key = depKey(d.name, d.version);
    if (!seen.has(key)) seen.set(key, { name: d.name, version: d.version || undefined });
  }
  return [...seen.values()];
}

/** Build the full POST body for /v1/querybatch from a dep list. */
function buildBatchRequestBody(deps) {
  const unique = dedupeDeps(deps);
  return { queries: unique.map((d) => buildEcosystemQuery(d.name, d.version)) };
}

/**
 * Parse a /v1/querybatch response back into per-dep vuln-id lists. OSV
 * guarantees `results[i]` corresponds to `queries[i]`, and a no-hit result is
 * `{}` (no `vulns` key at all) rather than `{vulns:[]}`.
 */
function parseBatchResponse(deps, batchJson) {
  const unique = dedupeDeps(deps);
  const results = (batchJson && Array.isArray(batchJson.results)) ? batchJson.results : [];
  return unique.map((d, i) => {
    const r = results[i] || {};
    const vulnIds = Array.isArray(r.vulns) ? r.vulns.map((v) => v.id).filter(Boolean) : [];
    return { name: d.name, version: d.version, vulnIds };
  });
}

// ---------------------------------------------------------------------------
// Version-spec cleanup (best-effort; queries stay name-only when unsure)
// ---------------------------------------------------------------------------

/**
 * Best-effort extraction of a concrete semver from a package.json range spec
 * ("^4.17.15", "~1.2.3", "1.2.3", ">=2.0.0"). Returns undefined for ranges we
 * can't reduce to one version ("*", "latest", "workspace:*", git/url specs) —
 * callers should treat "undefined version" as "query all known versions" and
 * label results as imprecise, NOT silently assume the caret floor is what's
 * actually installed (a `^4.17.15` may have resolved to a patched 4.17.21).
 */
function cleanVersionSpec(spec) {
  if (!spec || typeof spec !== "string") return undefined;
  const m = /^[\s~^><=]*([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.]+)?)\s*$/.exec(spec.trim());
  return m ? m[1] : undefined;
}

// ---------------------------------------------------------------------------
// Vuln detail normalization
// ---------------------------------------------------------------------------

/** Best-effort severity label. GHSA advisories carry it as a plain string in
 * database_specific.severity (LOW/MODERATE/HIGH/CRITICAL); the OSV-native
 * `severity[]` array is usually a raw CVSS vector string, not a precomputed
 * label, so we don't attempt to score it — "UNKNOWN" is an honest fallback. */
function extractSeverity(vuln) {
  const ds = vuln && vuln.database_specific;
  if (ds && typeof ds.severity === "string" && ds.severity.trim()) {
    return ds.severity.trim().toUpperCase();
  }
  return "UNKNOWN";
}

function pickAdvisoryUrl(vuln) {
  const refs = (vuln && Array.isArray(vuln.references)) ? vuln.references : [];
  const advisory = refs.find((r) => r && r.type === "ADVISORY" && r.url);
  if (advisory) return advisory.url;
  const anyWeb = refs.find((r) => r && r.url);
  if (anyWeb) return anyWeb.url;
  return vuln && vuln.id ? `https://osv.dev/vulnerability/${vuln.id}` : undefined;
}

/** Normalize a full OSV vuln object (from GET /v1/vulns/{id}) into the shape
 * the UI needs: {id, summary, severity, url, aliases}. */
function normalizeVulnDetail(vuln) {
  if (!vuln) return null;
  const id = vuln.id || "UNKNOWN";
  const firstDetailLine = typeof vuln.details === "string" ? vuln.details.split("\n")[0].trim() : "";
  const summary = (vuln.summary && vuln.summary.trim()) || firstDetailLine || "Known vulnerability";
  return {
    id,
    summary,
    severity: extractSeverity(vuln),
    url: pickAdvisoryUrl(vuln),
    aliases: Array.isArray(vuln.aliases) ? vuln.aliases : [],
  };
}

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

/** Worst (highest-ranked) severity among a list of normalized vulns. */
function worstSeverity(vulns) {
  let worst = "UNKNOWN";
  for (const v of vulns || []) {
    if ((SEVERITY_RANK[v.severity] || 0) > (SEVERITY_RANK[worst] || 0)) worst = v.severity;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// TTL cache — pure, injectable clock so tests don't need real timers/vscode.
// ---------------------------------------------------------------------------

class TTLCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new Map(); // key -> { value, expiresAt }
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  set(key, value) {
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Plain-object snapshot suitable for JSON.stringify / globalState.update. */
  toJSON() {
    const out = {};
    for (const [k, e] of this.map) out[k] = e;
    return out;
  }

  /** Rehydrate from a globalState-loaded plain object. Expired entries are
   * dropped lazily on first `get`, so no need to filter here. */
  static fromJSON(obj, opts) {
    const c = new TTLCache(opts);
    if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        const e = obj[k];
        if (e && typeof e.expiresAt === "number") c.map.set(k, e);
      }
    }
    return c;
  }
}

// ---------------------------------------------------------------------------
// Orchestration: batch-query → hydrate hits → cache
// ---------------------------------------------------------------------------

/**
 * Look up vulnerabilities for a list of {name, version?} deps.
 * @param {Array<{name:string, version?:string}>} deps
 * @param {object} opts
 * @param {Function} opts.fetchImpl  fetch-compatible function (injectable for tests)
 * @param {TTLCache} [opts.cache]    optional cache; hits are read from and written to it
 * @param {number} [opts.concurrency=5]  max simultaneous /v1/vulns/{id} requests
 * @param {Function} [opts.log]     called with a string on recoverable failures
 * @returns {Promise<Map<string, {name, version, vulns: Array, imprecise?: boolean}>>}
 *          keyed by depKey(name, version)
 */
async function checkVulnerabilities(deps, opts = {}) {
  const { fetchImpl, cache, concurrency = DEFAULT_CONCURRENCY, log = () => {} } = opts;
  const unique = dedupeDeps(deps);
  const outMap = new Map();
  if (unique.length === 0) return outMap;
  if (typeof fetchImpl !== "function") throw new TypeError("checkVulnerabilities: opts.fetchImpl is required");

  const toQuery = [];
  for (const d of unique) {
    const key = depKey(d.name, d.version);
    const cached = cache ? cache.get(key) : undefined;
    if (cached !== undefined) outMap.set(key, cached);
    else toQuery.push(d);
  }
  if (toQuery.length === 0) return outMap;

  let batchJson = null;
  try {
    const res = await fetchImpl(OSV_QUERY_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBatchRequestBody(toQuery)),
    });
    if (!res || !res.ok) throw new Error(`HTTP ${res && res.status}`);
    batchJson = await res.json();
  } catch (err) {
    log(`OSV querybatch failed: ${(err && err.message) || err}`);
    // Fail silently/gracefully: report "no known vulns" for this round rather
    // than throwing, and do NOT cache the failure (so the next scan retries).
    for (const d of toQuery) {
      outMap.set(depKey(d.name, d.version), { name: d.name, version: d.version, vulns: [] });
    }
    return outMap;
  }

  const batchResults = parseBatchResponse(toQuery, batchJson);
  const allIds = [...new Set(batchResults.flatMap((r) => r.vulnIds))];
  const idToDetail = new Map();

  if (allIds.length > 0) {
    let idx = 0;
    const workerCount = Math.max(1, Math.min(concurrency, allIds.length));
    const worker = async () => {
      while (idx < allIds.length) {
        const id = allIds[idx++];
        try {
          const res = await fetchImpl(OSV_VULN_URL(id));
          if (res && res.ok) {
            const json = await res.json();
            const detail = normalizeVulnDetail(json);
            if (detail) idToDetail.set(id, detail);
          } else {
            log(`OSV vuln detail HTTP ${res && res.status} for ${id}`);
          }
        } catch (err) {
          log(`OSV vuln detail fetch failed for ${id}: ${(err && err.message) || err}`);
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  for (const r of batchResults) {
    const key = depKey(r.name, r.version);
    const vulns = r.vulnIds.map((id) => idToDetail.get(id)).filter(Boolean);
    const entry = { name: r.name, version: r.version, vulns };
    outMap.set(key, entry);
    if (cache) cache.set(key, entry);
  }

  return outMap;
}

module.exports = {
  OSV_QUERY_BATCH_URL,
  OSV_VULN_URL,
  ECOSYSTEM,
  DEFAULT_TTL_MS,
  DEFAULT_CONCURRENCY,
  depKey,
  buildEcosystemQuery,
  dedupeDeps,
  buildBatchRequestBody,
  parseBatchResponse,
  cleanVersionSpec,
  extractSeverity,
  pickAdvisoryUrl,
  normalizeVulnDetail,
  worstSeverity,
  SEVERITY_RANK,
  TTLCache,
  checkVulnerabilities,
};
