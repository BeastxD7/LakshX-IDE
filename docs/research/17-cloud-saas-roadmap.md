# Cloud/SaaS pivot roadmap — strategic research

Research only. No implementation. Evaluates evolving LakshX from a 100%
client-side, BYOK desktop fork into a Cursor-like product with accounts,
billing, and in-app auto-update.

## Where LakshX actually stands today

Zero LakshX-run backend of any kind — no database, no API, nothing. The
agent is a local child process talking directly, HTTPS, to whatever
provider the user configured. API keys live in `~/.lakshx/providers.json`
plaintext. Distribution is static files (Vercel Blob) with no update
channel and no code signing wired up. This is a much bigger jump than "add
a login screen" — every phase below is honest about the new infrastructure
it requires.

## The load-bearing finding

**Even Cursor's own "BYOK" routes through Cursor's backend** for
server-side prompt assembly — a user's own key only unlocks chat with
standard models, not their differentiated product surface, and their
"Privacy Mode" only stops retention, not transit. **LakshX's current
direct client→provider architecture is already MORE private than Cursor's
BYOK today.** This is a real, currently-true, defensible marketing claim —
and it's a byproduct of not having infrastructure yet, not a deliberate
choice preserved forever. The biggest risk in this whole roadmap: a
managed-key tier is an architectural reversal of that claim if it becomes
the default path or blurs the line with BYOK in marketing. Mitigation:
hybrid model (below), BYOK's *architecture* stays unchanged regardless of
what paid tier exists, never silently conflate the two in messaging.

## Billing — actual 2026 shape (not flat subscriptions)

Cursor, Windsurf, and Replit have all converged on **subscription-as-
credit-wallet + metered consumption + pay-as-you-go overage**, not flat-
unlimited and not pure pay-per-call. Recommended for LakshX: **hybrid**
— BYOK stays free, direct, architecturally unchanged. A separate, optional
paid tier adds a managed-key proxy (credit-wallet billing, same shape as
above) plus genuinely additive cloud features (sync, license, priority
models) — never a tax on existing functionality.

## Auth — recommendation: Supabase Auth + Postgres, not Clerk+separate-DB

Managed provider over custom auth (security liability a small team
shouldn't own). Supabase over Clerk specifically because the product needs
a database anyway for entitlement/subscription state — bundling auth+DB in
one vendor is fewer moving parts than DX-superior-but-auth-only Clerk.
Desktop OAuth: system browser + PKCE, return via the already-registered
`lakshx://` URI scheme, tokens in OS-keychain storage (Electron
`safeStorage`) — the same mechanism that would finally close the long-
flagged plaintext-provider-keys gap, one piece of engineering for two
problems.

## Auto-update — the fork-native path, do this FIRST

LakshX is a VS Code fork, not a generic Electron app — it already ships
VS Code's own native updater, driven by `product.json`'s `updateUrl`
field (currently unset). Bolting on `electron-updater` would fight this
existing client. The fork-native path: stand up a VS-Code-update-protocol
-compatible endpoint (VSCodium's open-source `update-api` is a usable
reference) and point `updateUrl` at it. Needs code signing as a hard
prerequisite (auto-updating an unsigned build just automates the Gatekeeper/
SmartScreen warning) — Apple Developer Program ($99/yr) + notarization,
Windows OV/EV cert ($219-500/yr). No accounts, no billing, no database
needed — genuinely the highest-value, lowest-risk, most self-contained
piece. Should ship alone, first, not bundled with the accounts/billing work.

## "Cloud IDE" scope — recommend the light interpretation for v1

NOT full browser-hosted remote execution (VS Code Remote/Codespaces-style
— a different product/business entirely). Recommended v1: cloud-SYNCED
state, not cloud-RUN compute — chat history/checkpoint metadata synced
across devices via the same backend auth needs anyway, license validation
on launch, the auto-update channel. Nearly free once the auth database
exists. Full hosted-workspace "cloud IDE" is an explicit multi-year,
separate-business-case decision, not something to half-commit to here.

## India-market specifics

Razorpay (RBI PA-CB licensed, native UPI, auto-FIRC) as primary processor
for India — UPI is table stakes for Indian developer trust. Paddle or a
similar Merchant-of-Record layered in once international revenue is
material (Stripe/Razorpay leave LakshX on the hook for cross-border tax
compliance; a MoR absorbs that). Price the credit-wallet tier with an
India-anchored entry point, not a straight USD-to-INR conversion — Zoho/
Freshworks/Postman succeeded on affordability + one-account expansion, not
matching US sticker prices.

## Phased roadmap (sequenced, not concurrent)

0. **Code signing** (prerequisite regardless of everything else) — fixes
   existing Gatekeeper/SmartScreen pain on its own.
1. **In-app auto-update** — VS-Code-native update endpoint. No accounts/
   billing/database. Ships alone.
2. **Minimal backend + auth** — Supabase (Postgres+Auth) as the first-ever
   LakshX-run service, Vercel Functions as the API layer (reuses existing
   Vercel account). System-browser OAuth + PKCE. Bonus: closes the
   plaintext-provider-keys gap using the same secure-storage work.
3. **Light cloud sync** — near-free extension of #2's database. Chat/
   checkpoint metadata sync + license validation. Not hosted execution.
4. **Billing** — hybrid model, sequenced LAST (needs the entitlement data
   model #2/#3 establish). Razorpay primary, MoR added later. This is
   where LakshX takes on its first real financial risk (fronting provider
   costs for the managed tier) — size deliberately, opt-in only, never
   the default path. Do not parallelize with #2/#3.

## Status

Research only, no implementation started. This is a major business/
architecture decision requiring the product owner's explicit direction on
sequencing and scope before any code is written.
