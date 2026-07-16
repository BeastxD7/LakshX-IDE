"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const rules = require("../lib/rules.js");

// ---------------------------------------------------------------------------
// Shannon entropy — known values
// ---------------------------------------------------------------------------

test("shannonEntropy: single repeated symbol has zero entropy", () => {
  assert.equal(rules.shannonEntropy("aaaa"), 0);
  assert.equal(rules.shannonEntropy("11111111"), 0);
});

test("shannonEntropy: n distinct symbols, each once, is exactly log2(n)", () => {
  assert.equal(rules.shannonEntropy("abcdefgh"), 3); // 8 distinct chars => log2(8) = 3
  assert.equal(rules.shannonEntropy("ab"), 1); // log2(2) = 1
  assert.equal(rules.shannonEntropy("abcd"), 2); // log2(4) = 2
});

test("shannonEntropy: empty/undefined input is zero, not NaN/throw", () => {
  assert.equal(rules.shannonEntropy(""), 0);
  assert.equal(rules.shannonEntropy(undefined), 0);
});

test("shannonEntropy: mixed-frequency string matches hand-computed value", () => {
  // "aab" => p(a)=2/3, p(b)=1/3 => H = -(2/3*log2(2/3) + 1/3*log2(1/3))
  const expected = -(((2 / 3) * Math.log2(2 / 3)) + ((1 / 3) * Math.log2(1 / 3)));
  assert.ok(Math.abs(rules.shannonEntropy("aab") - expected) < 1e-9);
});

// ---------------------------------------------------------------------------
// Named-pattern rules — realistic positive samples per rule type
// ---------------------------------------------------------------------------

function ruleById(id) {
  return rules.PATTERN_RULES.find((r) => r.id === id);
}

test("aws-access-key-id: detects a real-shaped (AWS docs example) key", () => {
  const rule = ruleById("aws-access-key-id");
  const hits = rule.find("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].value, "AKIAIOSFODNN7EXAMPLE");
});

test("aws-access-key-id: does not fire on lowercase or short look-alikes", () => {
  const rule = ruleById("aws-access-key-id");
  assert.deepEqual(rule.find("akiaiosfodnn7example"), []);
  assert.deepEqual(rule.find("AKIA123"), []);
});

test("aws-secret-access-key: requires an aws/secret context word on the same line", () => {
  const withContext = rules.findAwsSecretKeys("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  assert.equal(withContext.length, 1);
  assert.equal(withContext[0].value, "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  assert.equal(withContext[0].value.length, 40);

  // Same 40-char token with NO context word on the line: not reported by this
  // rule (it may still be caught by the generic entropy heuristic elsewhere,
  // but not as a "confirmed" AWS secret).
  const withoutContext = rules.findAwsSecretKeys("token = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  assert.deepEqual(withoutContext, []);
});

test("aws-secret-access-key: context word alone with no 40-char token does not fire", () => {
  assert.deepEqual(
    rules.findAwsSecretKeys("// this file talks about aws and secret access but has no key here"),
    [],
  );
});

test("github-token: detects each documented prefix", () => {
  const rule = ruleById("github-token");
  const body = "aB3dE6fG9hJ2kL5mN8pQ1rS4tU7vW0xY2zA5cD8x"; // 41 chars, satisfies {36,255}
  for (const prefix of ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]) {
    const hits = rule.find(`GITHUB_TOKEN=${prefix}${body}`);
    assert.equal(hits.length, 1, `expected a hit for ${prefix}`);
    assert.equal(hits[0].value, `${prefix}${body}`);
  }
});

test("github-token: does not fire on an unrelated gh_-prefixed short string", () => {
  const rule = ruleById("github-token");
  assert.deepEqual(rule.find("ghz_notarealtoken"), []);
  assert.deepEqual(rule.find("ghp_tooshort"), []);
});

test("stripe-key: detects sk_live_/pk_live_/rk_live_", () => {
  const rule = ruleById("stripe-key");
  for (const prefix of ["sk_live_", "pk_live_", "rk_live_"]) {
    const hits = rule.find(`STRIPE_KEY=${prefix}4eC39HqLyjWDarjtT1zdp7dc`);
    assert.equal(hits.length, 1, `expected a hit for ${prefix}`);
  }
});

test("stripe-key: test-mode keys (sk_test_) are NOT flagged (out of scope by design)", () => {
  const rule = ruleById("stripe-key");
  assert.deepEqual(rule.find("STRIPE_KEY=sk_test_4eC39HqLyjWDarjtT1zdp7dc"), []);
});

test("private-key-header: detects RSA/EC/OPENSSH/DSA and bare PEM headers", () => {
  const rule = ruleById("private-key-header");
  for (const variant of ["RSA ", "EC ", "OPENSSH ", "DSA ", ""]) {
    const hits = rule.find(`-----BEGIN ${variant}PRIVATE KEY-----\nMIIEow...\n-----END ${variant}PRIVATE KEY-----`);
    assert.equal(hits.length, 1, `expected a hit for "${variant}"`);
  }
});

test("private-key-header: a mention of 'private key' in prose does not fire", () => {
  const rule = ruleById("private-key-header");
  assert.deepEqual(rule.find("Remember to rotate your private key regularly."), []);
});

test("slack-token: detects xoxb/xoxa/xoxp/xoxr/xoxs", () => {
  const rule = ruleById("slack-token");
  for (const prefix of ["xoxb", "xoxa", "xoxp", "xoxr", "xoxs"]) {
    const hits = rule.find(`SLACK_TOKEN=${prefix}-111222333-444555666-abcDEFghiJKLmnoPQR`);
    assert.equal(hits.length, 1, `expected a hit for ${prefix}`);
  }
});

test("db-connection-string: detects postgres/mysql/mongodb(+srv) with embedded creds", () => {
  const rule = ruleById("db-connection-string");
  const cases = [
    "postgres://myuser:hunter2pass@db.example.com:5432/prod",
    "postgresql://myuser:hunter2pass@db.example.com/prod",
    "mysql://root:sup3rSecret@127.0.0.1:3306/app",
    "mongodb://admin:p4ssw0rd@cluster0.example.net:27017/app",
    "mongodb+srv://admin:p4ssw0rd@cluster0.example.net/app",
  ];
  for (const c of cases) {
    const hits = rule.find(`DATABASE_URL=${c}`);
    assert.equal(hits.length, 1, `expected a hit for ${c}`);
  }
});

test("db-connection-string: a connection string with NO embedded credentials does not fire", () => {
  const rule = ruleById("db-connection-string");
  assert.deepEqual(rule.find("DATABASE_URL=postgres://db.example.com:5432/prod"), []);
});

// ---------------------------------------------------------------------------
// Generic high-entropy heuristic — "possible" confidence, secondary signal
// ---------------------------------------------------------------------------

test("findHighEntropyStrings: flags a realistic high-entropy base64-ish blob", () => {
  const text = "const apiToken = \"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\";";
  const hits = rules.findHighEntropyStrings(text, []);
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].entropy >= rules.BASE64_ENTROPY_THRESHOLD);
});

test("findHighEntropyStrings: does NOT flag a normal camelCase identifier (short, not actually high-entropy)", () => {
  const text = "function getUserAuthenticationTokenForSession(userId) { return userId; }";
  assert.deepEqual(rules.findHighEntropyStrings(text, []), []);
});

test("findHighEntropyStrings: does NOT flag a long but low-entropy (repeated-pattern) hex string", () => {
  // 40 hex chars, but just "0123" repeated — well below the hex threshold,
  // demonstrating the heuristic keys on actual randomness, not just length.
  const text = 'const pattern = "0123012301230123012301230123012301230123";';
  assert.deepEqual(rules.findHighEntropyStrings(text, []), []);
});

test("findHighEntropyStrings: does NOT flag short random-looking strings below the length floor", () => {
  assert.deepEqual(rules.findHighEntropyStrings('const x = "aZ3xQ9";', []), []);
});

test("findHighEntropyStrings: respects the `exclude` param so confirmed spans aren't double-reported", () => {
  const text = "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const confirmed = rules.findAwsSecretKeys(text);
  assert.equal(confirmed.length, 1);
  const entropyHits = rules.findHighEntropyStrings(text, confirmed);
  assert.deepEqual(entropyHits, []); // same span already claimed by the confirmed rule
});

test("findHighEntropyStrings: honest known limitation — a genuinely random-looking hex string (e.g. commit-SHA-shaped) DOES trip the heuristic", () => {
  // Documented in README as an intrinsic false-positive source: entropy alone
  // cannot distinguish a real hex secret from a hash digest of public content.
  const text = 'const commit = "d0c0a9b1e5f3c7b2a4d6e8f0123456789abcdef01";';
  const hits = rules.findHighEntropyStrings(text, []);
  assert.ok(hits.length >= 1);
});
