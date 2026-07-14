# Research: Editor Foundation Decision (July 2026)

## Executive summary

Five commercially significant AI IDEs (Cursor, Windsurf, Trae, Kiro, Google Antigravity) all chose the **code-oss fork** route; none chose Theia, Tauri, or Zed. The fork route is proven for speed-to-market (Cursor: ~1 year, <10 people, founding→ship) but carries a permanent upstream-merge tax, active hostility from Microsoft (marketplace ToS + binary kill-switches in Pylance/C++/Remote-SSH since April 2025), and an Electron performance ceiling (~15–25ms keystroke latency, GB-class memory) that no fork escapes. The only existence proof of the native route is Zed: **~5 years, ~$42M, ~20 engineers including the Atom/Tree-sitter creators, 1M+ lines of Rust to reach 1.0 (April 2026)** — and its editor core is GPL-3.0, so a proprietary Zed fork is legally impossible.

**Recommendation: a disciplined thin fork of code-oss (Strategy A), architected extension-first so divergence stays minimal — unless "world's fastest" is genuinely the product wedge, in which case fork Zed and run an open-core business (Strategy C), because "fastest" is physically unreachable on Electron.**

## Landscape: what everyone chose and what happened (2024–2026)

| Product | Foundation | Outcome as of mid-2026 |
|---|---|---|
| **Cursor** (Anysphere, 2022) | code-oss fork | $100M ARR (Jan 2025) → $1B+ (Nov 2025) → $3B+ (May 2026); $29.3B Series D; reported ~$60B SpaceX acquisition June 2026 (provisional, single-cycle reporting) |
| **Windsurf** (Codeium) | code-oss fork | Dismembered July 2025: Google paid $2.4B license + hired founders; Cognition bought the rest. Renamed **Devin Desktop** June 2026 |
| **Trae** (ByteDance) | code-oss fork | 6M+ users despite July 2025 telemetry scandal (~500 tracking calls/7min post-opt-out; pre-2.0.2 used 5.7GB RAM vs 0.9GB stock VS Code) |
| **Kiro** (AWS) | code-oss fork | GA ~March 2026 with heavy issue backlog |
| **Firebase Studio** (Google) | code-oss in browser | Being sunset: full shutdown March 2027 |
| **Antigravity** (Google) | VS Code fork (ex-Windsurf lineage) | Relaunched May 2026 as agent-first platform |
| **Fleet** (JetBrains) | Custom (Kotlin) | **Dead** — downloads ended Dec 2025. JetBrains' lesson: rebuilding an IDE "did not create enough value" |
| **Void, PearAI** | code-oss forks | Void paused early 2026; PearAI niche |
| **Zed** | Rust + GPUI from scratch | 1.0 April 2026 after ~5 years; $42M raised; parallel agents, ACP protocol |

**Two erosion forces on the fork rationale**: (1) stock VS Code now has agent mode + MCP for everyone, open-sourced Copilot Chat (MIT), unified "Agent Sessions" multi-agent view; (2) Zed's **Agent Client Protocol (ACP)** — Apache-licensed, adopted by JetBrains and Devin Desktop, adapters for Claude Code/Codex/Gemini — decouples the agent runtime from the editor entirely. What still requires a fork: editor-internal rendering (always-on inline diff decorations, custom chrome, shadow workspaces, atomic multi-file edit UX) — extensions cannot do these.

## Strategy A — code-oss fork

- MIT-licensed; rebrand + closed-source modification + commercial sale allowed. NOT included: VS Code brand, MS service endpoints, Visual Studio Marketplace, MS proprietary extensions.
- **Maintenance burden (measured)**: Cursor rebases every 3–6 months, sits 2–5 minor versions behind; runs a dedicated upstream-merge team described as "a tax." Cofounder Sualeh Asif: "starting from scratch would have taken a massive effort just to build a stable editor. Our value proposition was not building a stable editor."
- **Microsoft restrictions (hardened 2025)**: Marketplace ToS excludes forks categorically. April 2025: C/C++ extension technically enforces environment check that hard-errors in forks; Pylance, Remote-SSH, Live Share, C# DevKit similarly restricted. Cursor ships its own replacements.
- **Open VSX** is the forks' registry: ~10–12k extensions vs ~100k+ MS marketplace (most popular non-MS extensions present), 300M monthly downloads, funded by AWS + Cursor; 1.0.0 shipped June 2026.
- **Performance ceiling**: ~15–25ms keystroke latency typical, >50ms under load; 0.9GB baseline RAM (Cursor forum reports 7–22GB pathologies); 2–4s cold start. MS's WebGPU renderer still experimental and buggy 18+ months in.
- **Build-time**: MVP fork in 3–6 months for 3–5 engineers. Ongoing: 1–3 FTE permanently on upstream merges.

## Strategy B — Eclipse Theia

- Independent TypeScript platform implementing the VS Code extension API; Eclipse Foundation. No rebase treadmill; EPL-2.0 (product code stays proprietary); Theia AI framework GA March 2025.
- Chat/Language-Model APIs stubbed (you build your own AI UX anyway). Adopters are all tool vendors (Arduino IDE 2, TI, STMicro, Samsung) — **no consumer AI IDE precedent**.
- Same Electron ceiling as A. UI is VS Code-like but not pixel-identical. Build-time: 2–4 months to branded MVP; ongoing <1 FTE — cheapest credible path.

## Strategy C — Native Rust: fork Zed or build on GPUI

- **Zed's cost basis**: ~5 years, ~$42M, ~20 engineers, 1M+ lines of Rust. Custom rope/SumTree engine with CRDTs, GPUI framework, LSP client, DAP debugger (8 months, ~1,000 commits, 25k LOC for that one feature), SSH remoting, WASM extensions. Terminal wraps `alacritty_terminal`.
- **Licensing — pivotal**: editor core **GPL-3.0**, collab server AGPL-3.0, **GPUI Apache-2.0**. A commercial Zed fork must ship the whole editor GPL — moat must live in backend services/models/cloud (which is where Cursor's moat lives anyway). No commercial Zed fork exists yet. GPUI-from-parts proprietary build: 2–4 years.
- Zed fork → differentiated GPL product: **6–12 months** (inherit 1.0-quality editor + agent infra + ACP). Merge treadmill against Zed's fast tree replaces Microsoft's.
- Lapce (hobby-paced, 0.4.x after 8 years) and Helix (terminal-only, no merged plugin system) are not viable foundations.

## Strategy D — Web stack from scratch (Monaco/CodeMirror 6 + Electron/Tauri)

- Monaco: no extension host, no built-in LSP client, ~5–6MB bundles, no mobile. CodeMirror 6: modular, mobile-first, chosen by Replit/Chrome DevTools/Sourcegraph.
- Either way you rebuild the entire workbench: file tree, docking, terminal, LSP lifecycle, DAP + debug UI, search, settings, git UI, extension system. 12–24 months to credible IDE.
- **Tauri disqualified for an IDE**: three OS webviews (WebView2/WKWebView/WebKitGTK) with unpinnable versions; Figma rejected it for this; Verso/Servo escape hatch archived/stalled. No notable IDE ships on Tauri.

## Performance reality check

- Pavel Fatin (Typometer): GVim 1.4ms, IntelliJ zero-latency 4.3ms, Sublime 12.6ms, Atom (Electron) 60.4ms avg.
- VS Code: ~15–25ms typical, >50ms under load; 300–500MB baseline; 2–4s cold start. Zed: vendor claims <10ms / <1s / ~600MB large projects.
- Native sits in the 1–15ms band; Electron in 15–100ms. The gap is real but the market hasn't priced it — Cursor reached $3B+ ARR on the slow foundation.
- Running Typometer across VS Code/Cursor/Zed ourselves is a half-day, high-signal task.

## Comparison matrix

| | A. code-oss fork | B. Theia | C. Zed fork / GPUI | D. From scratch |
|---|---|---|---|---|
| Time to MVP | 3–6 mo | 2–4 mo | 6–12 mo / 2–4 yr | 12–24 mo |
| Maintenance | 1–3 FTE merge tax forever | <1 FTE | Merge treadmill vs Zed | Own 100% |
| Perf ceiling | Electron ~15–25ms | Same as A | Native ~2–10ms | Electron: as A |
| Ecosystem | Open VSX (~10–12% of MS catalog) | Same, broad API compat | Zed extensions (no UI panels) | None |
| License risk | MIT clean; MS hostility | EPL-2.0 cleanest | **GPL-3.0 editor** | MIT clean |
| Precedent | Cursor $3B ARR | No consumer hit | Zed itself; no fork yet | Replit (browser) |

## Key sources

Pragmatic Engineer on Cursor · Cursor forum base-version-lag thread · The Register on MS C/C++ block · Marketplace ToU · Open VSX growth (GlobeNewswire) · zed.dev/blog/zed-1-0 · zed.dev/blog/zed-is-now-open-source · zed.dev/blog/debugger · blog.replit.com/codemirror · sourcegraph.com Monaco→CM migration · gethopp.app Tauri-vs-Electron · JetBrains Fleet shutdown blog · pavelfatin.com/typing-with-pleasure · zed.dev/acp

*Confidence notes: version-lag figures, license events, funding rounds are multi-source and firm. SpaceX/Cursor acquisition and some 2026 timeline items rest on fewer sources — verify before quoting externally. Zed-vs-VS-Code latency numbers are vendor-published or enthusiast-measured; ordering robust, magnitudes not.*
