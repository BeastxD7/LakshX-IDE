# Research: Agent Intelligence / Orchestration Layer (July 2026)

## 1. The most important finding: scaffolding vs model

- **mini-SWE-agent** (~100 lines of Python, bash-only, no tool-calling schema) scores **>74% on SWE-bench Verified** — matching far more complex frameworks. Harness complexity does NOT buy quality; **the model + the verification environment do**. Differentiation budget goes to context engineering, verification loops, and orchestration — not exotic tool schemas.
- SWE-bench Verified is saturating (Fable 5 ~95.0%, Opus 4.8 88.6%, GPT-5.5 88.7%) and audits found ~20% of "solved" cases semantically wrong — differentiate on **SWE-bench Pro** (Opus 4.8 leads at 69.2%) and real end-product quality.

## 2. Reference architectures

- **Claude Code / Claude Agent SDK**: single-loop gather-context → act → verify; agentic grep search; subagents for context isolation; hooks (PreToolUse/PostToolUse/Stop) for deterministic quality gates; skills (SKILL.md) for procedural knowledge; MCP; auto-compaction. **Caveat: source-available but proprietary license** — fine to embed, can't fork.
- **OpenAI Codex**: four surfaces sharing one config; cloud tasks in no-internet microVMs; AGENTS.md (32 KiB cap).
- **Cursor**: in-house **Composer** MoE model, RL-trained in real agentic environments, ~250 tok/s, 4x faster; Rust orchestrator ("Anyrun") launches agents in Firecracker VMs; Turbopuffer vectors; Merkle-tree incremental indexing.
- **Windsurf Cascade (Cognition)**: **SWE-grep** RL-trained retrieval models at >2,800 tok/s (Cerebras), 8 parallel tool calls/turn; context retrieval drops from 20+s to <1s.
- **OpenHands**: event-sourced state with **deterministic replay**, immutable agent config, typed tools + MCP, native sandboxing, multi-LLM routing. MIT.
- **Cline** (Apache-2.0, 5M+ installs): surviving open VS Code agent. **Roo Code shut down May 2026**; Kilo Code is the fork. **Continue.dev acquired by Cursor 2026 — repo read-only.**
- **Aider**: tree-sitter **repo map** — symbol def/ref graph, PageRank with conversation-aware boosts, binary-search fill of token budget.

## 3. Architecture patterns ranked by evidence of quality outcomes

**Tier 1 — strong, replicated evidence:**
1. **Verification loop as the core of the agent**: typecheck → lint → targeted tests → full suite, fail fast, feed errors back. "80% of loop engineering is the verification loop."
2. **Deterministic hooks/quality gates outside the model** — the harness, not the prompt, enforces quality.
3. **Minimal, composable tool surface over a real shell + file tools** (mini-SWE-agent evidence).
4. **Context isolation via subagents returning condensed summaries** — Anthropic: +90.2% over single-agent on internal evals; token usage explains ~80% of performance variance; ~15x token cost, reserve for decomposable tasks.

**Tier 2 — good evidence, situational:**
5. Planner–executor split / plan mode (read-only planning before edits).
6. Generator–critic dyads: separate fresh-context critic audits builder output before human review.
7. Sandboxed execution per task (Firecracker: <100ms cold boot, 5–30ms snapshot-restore; gVisor lighter tier).
8. Checkpointing + rollback via shadow git repos; one worktree per agent for parallel isolation.

**Tier 3 — emerging:**
9. RL-specialized auxiliary models (SWE-grep retrieval, Composer speed) — latency wins clear, quality parity vendor-claimed.
10. Persistent code knowledge graphs — big token wins on structural queries, but index-freshness costs.

## 4. Context engineering

- **Agentic grep won the primary-retrieval war**: Anthropic removed vector search from Claude Code May 2025 ("outperformed everything. By a lot"). Amazon Science (Feb 2026): keyword agentic search reaches >90% of RAG performance with no vector DB.
- **But hybrid is the frontier**: Cursor reports semantic search adds **+12.5% agent accuracy on large codebases**. Cursor's indexing: syntax-aware chunking → embeddings, Merkle-tree diffing for incremental re-index, content-hash-keyed cache, no plaintext server-side.
- **Structural retrieval is cheap and local**: Aider-style tree-sitter repo map + PageRank; LSP for def/ref precision; ast-grep for structural search. Beat both grep and embeddings for "who calls this."
- **Context window management**: compaction at ~60–75% threshold; just-in-time retrieval; structured note-taking to external memory; subagents as context firewalls.

## 5. Reusable OSS components

| Component | Gives you | License |
|---|---|---|
| Claude Agent SDK | Full Claude Code loop, subagents, hooks, MCP, compaction | Proprietary/source-available (embed OK, no fork) |
| OpenHands SDK | Event-sourced state, deterministic replay, sandboxed runtime, multi-LLM | MIT |
| Cline | VS Code agent UX, subagents, BYOK provider layer | Apache-2.0 |
| Codex CLI | Rust agent loop + sandbox policies | Apache-2.0 |
| MCP ecosystem | Serena (LSP-backed symbol tools, MIT), Playwright MCP, Chrome DevTools MCP | MIT/Apache |
| tree-sitter / ast-grep / SCIP | Parsing, structural search, cross-repo symbol indexing | MIT / MIT / Apache-2.0 |
| Firecracker / gVisor / E2B / Daytona | MicroVM & sandbox tiers | Apache-2.0 |
| Zeta (Zed) | Open next-edit-prediction model; Zeta2 +30% acceptance via LSP context | Apache-2.0 (open weights) |
| ACP + claude-agent-acp | Editor↔agent protocol + Claude adapter | Apache-2.0 |

## 6. Model layer (July 2026)

- **Frontier**: Claude Fable 5 ($10/$50 per MTok, 95.0% Verified); Claude Opus 4.8 ($5/$25, 69.2% SWE-bench Pro — best repo-scale, 1M context); GPT-5.5 ($5/$30); GPT-5.6 family.
- **Volume**: Claude Sonnet 4.6 ($3/$15, 1M ctx); Gemini 3.1 Flash-Lite ($0.40/M out) for cheap subtasks. Cost spread $50 vs <$1 per task — **model routing is first-class architecture**.
- **Fast-apply**: Morph (7B, 10,500 tok/s, 98% accuracy) and Relace Apply 3 merge lazy frontier edits into files. Both vendors admit fast-apply may be obsoleted within ~6 months — treat as swappable module.
- **Tab/next-edit**: Zeta (open, Zed) vs Cursor Tab (proprietary); Zeta2.1: 3x fewer tokens, −50ms.
- **Local models**: viable for tab-completion and retrieval tiers, not frontier agentic work.

## 7. IDE ↔ agent runtime integration

- **ACP (Agent Client Protocol)**: JSON-RPC 2.0 over stdio, created by Zed (Aug 2025), co-developed with JetBrains, shared registry Jan 2026; ~50 agents (Claude Code, Gemini CLI, Goose, OpenCode…); editors: Zed, JetBrains, Neovim, Emacs.
- Pattern proven by Zed: agent runs as independent process; editor owns UI, diff review, permissioning.
- Embed-SDK vs own-loop: embedding Claude Agent SDK = battle-tested loop immediately but Anthropic ToS lock-in. Own loop (Cline/OpenHands style) = model freedom at cost of rebuilding context management.

## 8. Recommended agent-layer architecture

1. **Own thin loop** (mini-SWE-agent shows it's small), gather→act→verify, on **OpenHands SDK event-sourced state + deterministic replay** (MIT). Simultaneously **ship ACP client** so Claude Code/Codex/Gemini plug in as alternative runtimes.
2. **Layered agentic-first retrieval**: (a) ripgrep + file tools primary; (b) tree-sitter symbol graph + PageRank repo map; (c) **native LSP bridge — the IDE's unfair advantage: real-time diagnostics, go-to-def, references fed into the loop**; (d) optional embeddings with Merkle incremental indexing for very large repos only.
3. **Quality gates as harness code, not prompts**: hook system; per-project "verify" contract (typecheck→lint→tests, fastest first); agent cannot declare done until gates pass; separate fresh-context **critic pass** on the final diff; Playwright/Chrome-DevTools MCP for UI changes.
4. **Execution safety**: local = OS sandbox + shadow-git checkpoints; parallel = git worktrees; cloud = Firecracker microVMs (E2B/Daytona), snapshot-restore.
5. **Orchestration**: single agent default; orchestrator + parallel subagents only for decomposable work; compaction at ~60–70%; structured memory notes; AGENTS.md conventions + skills system.
6. **Model routing**: Opus-class default brain, Fable-class escalation for hard tasks + critic, Sonnet/Flash tier for subagents, fast-apply behind a deletable abstraction, Zeta-based open tab model day one.

## Key sources

anthropic.com/engineering/effective-context-engineering-for-ai-agents · anthropic.com/engineering/multi-agent-research-system · code.claude.com/docs/en/agent-sdk/overview · github.com/SWE-agent/mini-swe-agent · cursor.com/blog/composer · cursor.com/blog/secure-codebase-indexing · cognition.com/blog/swe-grep · arxiv.org/html/2511.03690v2 (OpenHands SDK) · aider.chat repomap · zed.dev/acp · jetbrains.com/acp · github.com/agentclientprotocol/claude-agent-acp · zed.dev/blog/edit-prediction · morphllm.com/fast-apply-model · relace.ai/blog/relace-apply-3 · github.com/oraios/serena · developers.openai.com/codex/cloud · benchlm.ai/benchmarks/sweVerified · vadim.blog/claude-code-no-indexing · arxiv.org/html/2605.15184v1
