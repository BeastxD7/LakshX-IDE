"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
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
  TTLCache,
  checkVulnerabilities,
} = require("../lib/vuln-check.js");

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------
test("buildEcosystemQuery: includes version when given, omits when not", () => {
  assert.deepEqual(buildEcosystemQuery("lodash", "4.17.15"), {
    package: { name: "lodash", ecosystem: "npm" },
    version: "4.17.15",
  });
  assert.deepEqual(buildEcosystemQuery("lodash"), { package: { name: "lodash", ecosystem: "npm" } });
});

test("dedupeDeps: dedupes by (name, version), preserves first-seen order", () => {
  const deps = [
    { name: "react", version: "18.2.0" },
    { name: "lodash", version: "4.17.15" },
    { name: "react", version: "18.2.0" },
    { name: "react", version: "17.0.0" },
  ];
  const out = dedupeDeps(deps);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((d) => depKey(d.name, d.version)), ["react@18.2.0", "lodash@4.17.15", "react@17.0.0"]);
});

test("dedupeDeps: skips malformed entries", () => {
  assert.deepEqual(dedupeDeps([null, {}, { name: "" }, { name: "ok" }]), [{ name: "ok", version: undefined }]);
});

test("buildBatchRequestBody: builds one query per unique dep, npm ecosystem", () => {
  const body = buildBatchRequestBody([{ name: "lodash", version: "4.17.15" }, { name: "left-pad" }]);
  assert.deepEqual(body, {
    queries: [
      { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.15" },
      { package: { name: "left-pad", ecosystem: "npm" } },
    ],
  });
});

// ---------------------------------------------------------------------------
// Batch response parsing (shapes taken from a real /v1/querybatch response)
// ---------------------------------------------------------------------------
test("parseBatchResponse: maps hits back to deps in query order", () => {
  const deps = [{ name: "lodash", version: "4.17.15" }, { name: "minimist", version: "0.0.8" }, { name: "react", version: "18.2.0" }];
  const batchJson = {
    results: [
      { vulns: [{ id: "GHSA-29mw-wpgm-hmr9", modified: "x" }, { id: "GHSA-35jh-r3h4-6jhm", modified: "x" }] },
      { vulns: [{ id: "GHSA-vh95-rmgr-6w4m", modified: "x" }] },
      {}, // no hits — OSV omits the `vulns` key entirely, not `vulns: []`
    ],
  };
  const parsed = parseBatchResponse(deps, batchJson);
  assert.deepEqual(parsed[0].vulnIds, ["GHSA-29mw-wpgm-hmr9", "GHSA-35jh-r3h4-6jhm"]);
  assert.deepEqual(parsed[1].vulnIds, ["GHSA-vh95-rmgr-6w4m"]);
  assert.deepEqual(parsed[2].vulnIds, []);
});

test("parseBatchResponse: tolerates a missing/malformed results array", () => {
  const deps = [{ name: "left-pad" }];
  assert.deepEqual(parseBatchResponse(deps, {}), [{ name: "left-pad", version: undefined, vulnIds: [] }]);
  assert.deepEqual(parseBatchResponse(deps, null), [{ name: "left-pad", version: undefined, vulnIds: [] }]);
});

// ---------------------------------------------------------------------------
// Version-spec cleanup
// ---------------------------------------------------------------------------
test("cleanVersionSpec: reduces exact/caret/tilde/comparator specs to a concrete version", () => {
  assert.equal(cleanVersionSpec("4.17.15"), "4.17.15");
  assert.equal(cleanVersionSpec("^4.17.15"), "4.17.15");
  assert.equal(cleanVersionSpec("~1.2.3"), "1.2.3");
  assert.equal(cleanVersionSpec(">=2.0.0"), "2.0.0");
  assert.equal(cleanVersionSpec(" ^1.0.0-beta.1 "), "1.0.0-beta.1");
});

test("cleanVersionSpec: returns undefined for ranges/non-semver specs it can't reduce", () => {
  assert.equal(cleanVersionSpec("*"), undefined);
  assert.equal(cleanVersionSpec("latest"), undefined);
  assert.equal(cleanVersionSpec("workspace:*"), undefined);
  assert.equal(cleanVersionSpec("git+https://github.com/x/y.git"), undefined);
  assert.equal(cleanVersionSpec(""), undefined);
  assert.equal(cleanVersionSpec(undefined), undefined);
});

// ---------------------------------------------------------------------------
// Vuln detail normalization (shape taken from a real GET /v1/vulns/{id})
// ---------------------------------------------------------------------------
const REAL_MINIMIST_VULN = {
  id: "GHSA-vh95-rmgr-6w4m",
  summary: "Prototype Pollution in minimist",
  details: "Affected versions of `minimist` are vulnerable to prototype pollution...",
  aliases: ["CVE-2020-7598"],
  database_specific: { severity: "MODERATE" },
  references: [
    { type: "ADVISORY", url: "https://nvd.nist.gov/vuln/detail/CVE-2020-7598" },
    { type: "WEB", url: "https://github.com/minimistjs/minimist/commit/abc" },
  ],
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L" }],
};

test("extractSeverity: reads database_specific.severity (GHSA convention), uppercases", () => {
  assert.equal(extractSeverity(REAL_MINIMIST_VULN), "MODERATE");
  assert.equal(extractSeverity({ database_specific: { severity: "high" } }), "HIGH");
});

test("extractSeverity: UNKNOWN when no usable severity label is present", () => {
  assert.equal(extractSeverity({}), "UNKNOWN");
  assert.equal(extractSeverity({ severity: [{ type: "CVSS_V3", score: "CVSS:3.1/..." }] }), "UNKNOWN");
});

test("pickAdvisoryUrl: prefers an ADVISORY reference, falls back to any url, then osv.dev", () => {
  assert.equal(pickAdvisoryUrl(REAL_MINIMIST_VULN), "https://nvd.nist.gov/vuln/detail/CVE-2020-7598");
  assert.equal(pickAdvisoryUrl({ id: "X", references: [{ type: "WEB", url: "https://example.com" }] }), "https://example.com");
  assert.equal(pickAdvisoryUrl({ id: "GHSA-xxx" }), "https://osv.dev/vulnerability/GHSA-xxx");
});

test("normalizeVulnDetail: extracts id/summary/severity/url/aliases from a real vuln object", () => {
  const n = normalizeVulnDetail(REAL_MINIMIST_VULN);
  assert.equal(n.id, "GHSA-vh95-rmgr-6w4m");
  assert.equal(n.summary, "Prototype Pollution in minimist");
  assert.equal(n.severity, "MODERATE");
  assert.equal(n.url, "https://nvd.nist.gov/vuln/detail/CVE-2020-7598");
  assert.deepEqual(n.aliases, ["CVE-2020-7598"]);
});

test("normalizeVulnDetail: falls back to first line of details when summary missing", () => {
  const n = normalizeVulnDetail({ id: "X", details: "Line one.\nLine two." });
  assert.equal(n.summary, "Line one.");
});

test("normalizeVulnDetail: null-safe", () => {
  assert.equal(normalizeVulnDetail(null), null);
});

test("worstSeverity: picks the highest-ranked severity across a list", () => {
  assert.equal(worstSeverity([{ severity: "LOW" }, { severity: "CRITICAL" }, { severity: "MODERATE" }]), "CRITICAL");
  assert.equal(worstSeverity([]), "UNKNOWN");
  assert.equal(worstSeverity([{ severity: "UNKNOWN" }, { severity: "LOW" }]), "LOW");
});

// ---------------------------------------------------------------------------
// TTLCache — pure, injectable clock (no real timers)
// ---------------------------------------------------------------------------
test("TTLCache: get/set round-trips before expiry", () => {
  let now = 1000;
  const cache = new TTLCache({ ttlMs: 500, now: () => now });
  cache.set("a", { vulns: [] });
  assert.deepEqual(cache.get("a"), { vulns: [] });
  now += 499;
  assert.deepEqual(cache.get("a"), { vulns: [] });
});

test("TTLCache: entries expire and are evicted on read after ttlMs", () => {
  let now = 1000;
  const cache = new TTLCache({ ttlMs: 500, now: () => now });
  cache.set("a", { vulns: [] });
  now += 500; // exactly at expiry boundary — expiresAt <= now() counts as expired
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.has("a"), false);
});

test("TTLCache: toJSON/fromJSON round-trips live entries, drops nothing prematurely", () => {
  let now = 1000;
  const cache = new TTLCache({ ttlMs: 500, now: () => now });
  cache.set("a", { vulns: ["x"] });
  const snapshot = cache.toJSON();
  const restored = TTLCache.fromJSON(snapshot, { ttlMs: 500, now: () => now });
  assert.deepEqual(restored.get("a"), { vulns: ["x"] });
});

test("TTLCache: fromJSON ignores malformed entries instead of throwing", () => {
  const restored = TTLCache.fromJSON({ a: "not-an-entry", b: { value: 1, expiresAt: Date.now() + 10000 } });
  assert.equal(restored.get("a"), undefined);
  assert.deepEqual(restored.get("b"), 1);
});

// ---------------------------------------------------------------------------
// checkVulnerabilities orchestration — mocked fetchImpl, no real network.
// ---------------------------------------------------------------------------
function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test("checkVulnerabilities: batches the query, hydrates only hit ids, returns normalized details", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/querybatch")) {
      const body = JSON.parse(init.body);
      assert.equal(body.queries.length, 2);
      return jsonResponse({
        results: [{ vulns: [{ id: "GHSA-1" }] }, {}],
      });
    }
    if (url.includes("/vulns/GHSA-1")) {
      return jsonResponse({ id: "GHSA-1", summary: "bad news", database_specific: { severity: "HIGH" } });
    }
    throw new Error("unexpected fetch: " + url);
  };

  const result = await checkVulnerabilities(
    [{ name: "vuln-pkg", version: "1.0.0" }, { name: "safe-pkg", version: "2.0.0" }],
    { fetchImpl },
  );

  assert.equal(result.get("vuln-pkg@1.0.0").vulns.length, 1);
  assert.equal(result.get("vuln-pkg@1.0.0").vulns[0].id, "GHSA-1");
  assert.equal(result.get("vuln-pkg@1.0.0").vulns[0].severity, "HIGH");
  assert.equal(result.get("safe-pkg@2.0.0").vulns.length, 0);
  // exactly one querybatch call + one detail hydration call (no per-package /v1/query fan-out)
  assert.equal(calls.filter((u) => u.endsWith("/querybatch")).length, 1);
  assert.equal(calls.filter((u) => u.includes("/vulns/")).length, 1);
});

test("checkVulnerabilities: reuses the cache and skips the network on a repeat lookup", async () => {
  let batchCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/querybatch")) {
      batchCalls++;
      return jsonResponse({ results: [{ vulns: [{ id: "GHSA-1" }] }] });
    }
    return jsonResponse({ id: "GHSA-1", summary: "s", database_specific: { severity: "LOW" } });
  };
  const cache = new TTLCache({ ttlMs: 60000 });
  const deps = [{ name: "vuln-pkg", version: "1.0.0" }];

  const first = await checkVulnerabilities(deps, { fetchImpl, cache });
  assert.equal(first.get("vuln-pkg@1.0.0").vulns[0].id, "GHSA-1");
  assert.equal(batchCalls, 1);

  const second = await checkVulnerabilities(deps, { fetchImpl, cache });
  assert.equal(second.get("vuln-pkg@1.0.0").vulns[0].id, "GHSA-1");
  assert.equal(batchCalls, 1); // no new network call — served from cache
});

test("checkVulnerabilities: querybatch failure is handled gracefully, never throws", async () => {
  const logs = [];
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await checkVulnerabilities([{ name: "x", version: "1.0.0" }], {
    fetchImpl,
    log: (msg) => logs.push(msg),
  });
  assert.equal(result.get("x@1.0.0").vulns.length, 0);
  assert.ok(logs.some((l) => l.includes("network down")));
});

test("checkVulnerabilities: a non-ok HTTP status on querybatch is also handled gracefully", async () => {
  const fetchImpl = async () => jsonResponse({}, false, 500);
  const result = await checkVulnerabilities([{ name: "x" }], { fetchImpl });
  assert.equal(result.get("x@").vulns.length, 0);
});

test("checkVulnerabilities: a failed individual vuln-detail fetch is skipped, not fatal", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/querybatch")) return jsonResponse({ results: [{ vulns: [{ id: "GHSA-1" }, { id: "GHSA-2" }] }] });
    if (url.includes("GHSA-1")) throw new Error("boom");
    if (url.includes("GHSA-2")) return jsonResponse({ id: "GHSA-2", summary: "ok one" });
    throw new Error("unexpected");
  };
  const result = await checkVulnerabilities([{ name: "x", version: "1.0.0" }], { fetchImpl });
  const vulns = result.get("x@1.0.0").vulns;
  assert.equal(vulns.length, 1);
  assert.equal(vulns[0].id, "GHSA-2");
});

test("checkVulnerabilities: empty dep list short-circuits without calling fetchImpl", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return jsonResponse({});
  };
  const result = await checkVulnerabilities([], { fetchImpl });
  assert.equal(result.size, 0);
  assert.equal(called, false);
});

test("checkVulnerabilities: throws a clear error if fetchImpl is missing (programmer error, not a runtime skip)", async () => {
  await assert.rejects(() => checkVulnerabilities([{ name: "x" }], {}), /fetchImpl/);
});
