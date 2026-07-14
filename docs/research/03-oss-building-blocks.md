# Research: Open-Source Building Blocks Inventory (July 2026)

Effort = integration effort into a new IDE (Low/Med/High).

## 1. Editor cores

| Component | Gives you | License | Maturity / risk | Effort |
|---|---|---|---|---|
| **Monaco** | VS Code's editor as web component: diff editor, IntelliSense UI | MIT | Very mature; ~2–5MB gzip; mediocre touch | Low |
| **CodeMirror 6** | Modular web editor ~300KB core, best touch/a11y, Lezer + LSP integrations | MIT | Very mature | Med |
| **GPUI (Zed)** | GPU-accelerated Rust UI framework, usable standalone | **Apache-2.0** | Pre-1.0, breaking changes; de facto widget lib: longbridge/gpui-component | High |
| **Zed editor crates** | Zed's buffer/editor (231 crates, ~1.3M LoC) | **GPL-3.0** | License contamination for proprietary apps | Very High |
| **Lexical** | Rich-text framework — for chat/compose panes, NOT code | MIT | Mature | Low (chat UI) |
| **ropey** | Rust rope text buffer (Helix lineage); xi-rope archived/dead | MIT | Stable | Low |
| **tree-sitter** | Incremental parsing; v0.26 June 2026 | MIT | Very mature; grammar quality varies | Low–Med |

## 2. Language intelligence

| Component | Gives you | License | Risk | Effort |
|---|---|---|---|---|
| vscode-languageclient / vscode-jsonrpc | Reference LSP client (TS) | MIT | Battle-tested | Low |
| monaco-languageclient (TypeFox) | LSP for Monaco in browser; v10.7 Feb 2026 | MIT | Active; API churned at v10 | Med |
| Rust LSP: lsp-types + async-lsp | Types solid; full client = build yourself (tower-lsp stagnant) | MIT/Apache | — | Med–High |
| **mason-registry** | ~1,800 packages: LSP/DAP servers, linters, formatters with install specs per platform — best open catalog | Apache-2.0 | Very active | Med (reimplement installer) |
| SCIP + indexers (Sourcegraph) | Precise cross-repo nav (protobuf, replaces LSIF); scip-typescript/python/java/clang; rust-analyzer emits natively | Apache-2.0 | Production-grade | Med |
| **stack-graphs (GitHub)** | — | — | **Archived Sept 2025 — dead, do not adopt** | — |
| **ast-grep** | Structural search/lint/rewrite; CLI + Rust lib + napi + MCP server | MIT | Very active; excellent agent tool | Low |
| Glean (Meta) | Fact DB for code | BSD | Haskell stack, heavy ops; overkill | Very High |

## 3. Terminal

| Component | Gives you | License | Effort |
|---|---|---|---|
| **xterm.js** | Web terminal (VS Code's); WebGL renderer | MIT | Low |
| **alacritty_terminal** crate | Headless VT emulation for Rust (what Zed uses) | Apache-2.0 | Med |
| Warp open bits (May 2026) | AI-native terminal client (~56k stars); warpui crates MIT | Client **AGPL-3.0** — study, don't embed | High |
| **node-pty** | PTY for Node/Electron (ConPTY on Windows), MS-maintained | MIT | Low |
| **portable-pty** (wezterm) | Cross-platform PTY for Rust | MIT | Low |

## 4. Git / VCS

| Component | Gives you | License | Notes |
|---|---|---|---|
| libgit2 / git2-rs | Full git ops | GPL-2.0 **with linking exception** (usable) | Perf lags CLI on huge repos |
| **gitoxide (gix)** | Pure-Rust git; used by Zed, cargo | MIT/Apache-2.0 | Read paths production-grade; **push/merge/rebase incomplete** — pair with git CLI |
| isomorphic-git | Pure-JS git | MIT | Minimally maintained; slow on large repos |
| **git CLI subprocess** | What VS Code/Cursor/most agents actually do | GPL-2 unlinked, no contamination | Zero risk |
| Diff: Monaco diff editor / diff2html / jsdiff / similar (Rust) / git-delta | Rendering + computing | MIT | All mature |
| Conflict UI | No good standalone lib; VS Code's 3-way merge editor is MIT — extract/port | MIT | Med–High |

## 5. Sandboxing / exec for agents

| Component | Gives you | License | Notes |
|---|---|---|---|
| macOS Seatbelt (sandbox-exec/SBPL) | Default-deny FS+network per process; used by Codex CLI, Gemini CLI, Anthropic srt | OS built-in | Apple-deprecated since 2016 but what everyone ships |
| Landlock + seccomp (Linux) | Unprivileged FS/network LSM (Codex Linux backend) | Kernel API | Kernels ≥5.13 |
| bubblewrap | Namespace sandbox (Flatpak, srt Linux) | LGPL-2.0+ | Very mature |
| **Anthropic sandbox-runtime (srt)** | Ready-made cross-platform (Seatbelt + bubblewrap) agent sandbox | **Apache-2.0** | Purpose-built for this — Low effort |
| Docker/OCI | Packaging | Apache-2.0 | Shared-kernel isolation considered insufficient alone in 2026 |
| gVisor | User-space kernel | Apache-2.0 | Syscall overhead; Linux-only |
| Firecracker | MicroVMs ~125ms boot | Apache-2.0 | Linux/KVM only |
| **E2B** | Hosted + self-hostable Firecracker sandbox SDK | Apache-2.0 | Low effort via SDK |
| microsandbox / libkrun | Self-hosted microVMs <200ms boot | Apache-2.0 | Younger |
| Apple Containerization | VM-per-container on macOS, 1.0 June 2026 | Apache-2.0 | macOS 26+ only; forward-looking |
| **WebContainers (StackBlitz)** | Node in browser | **Proprietary — paid commercial license required** | Dealbreaker |

## 6. Extension ecosystems

- **Open VSX** (EPL-2.0 registry): 1.0.0 June 2026; 10k+ extensions (~10% of MS catalog but most popular non-MS present); 50M+ req/day; Managed Registry with AWS/Google/Cursor. **Mandatory for forks** (MS Marketplace ToS). Vet extensions — 2026 malware incidents (Secure Annex).
- **Missing from Open VSX**: Pylance, C/C++, C#/DevKit, Remote-SSH, Live Share → ship alternatives (BasedPyright, clangd) — same gap Cursor lives with.
- **Zed extension model**: Rust→wasm32-wasip1 in Wasmtime against versioned WIT API — reference architecture for sandboxed plugins. **Extism** (BSD-3): fastest path to custom WASM plugin system.

## 7. App shells

- **Electron**: still correct for an IDE in 2026 — single Chromium target, Monaco/xterm.js/node-pty first-class, electron-updater battle-tested. Cost: 100+MB, RAM. MIT.
- **Tauri v2**: tiny binaries, but three webviews = rendering inconsistency (worst for a code editor), WebKitGTK lag, younger updater. 2026 consensus: default Tauri for new apps *except* IDE-class heavy web UIs.

## 8. Search / index

| Component | Gives you | License | Notes |
|---|---|---|---|
| **ripgrep grep/ignore crates** | Search core as Rust lib | MIT/UNLICENSE | Every fast IDE search is this |
| tantivy | Lucene-class full-text in Rust | MIT | Mature; Datadog stewardship watch |
| **LanceDB** | Embedded "SQLite of vector DBs": in-process, 4MB idle RAM | Apache-2.0 | Best fit for local-first IDE index |
| sqlite-vec | Vectors in SQLite | MIT/Apache | **Stalled — maintainer unavailable**; avoid |
| Qdrant | ANN server | Apache-2.0 | ~400MB constant RAM — too heavy bundled |
| **ONNX Runtime + fastembed(-rs)** | Local CPU embeddings (BGE, reranking), ~5x HF throughput | MIT / Apache-2.0 | Standard local stack |

## 9. Whole products: fork or study

| Project | Status mid-2026 | License | Verdict |
|---|---|---|---|
| **VSCodium** | Alive, tracking upstream | MIT | The de-Microsofting build recipe — starting point |
| **Eclipse Theia** | Most active year ever; Theia AI GA | EPL-2.0 | Only serious non-fork VS Code-compatible platform |
| **Zed** | Alive, well-funded, 1.0 | GPL-3.0 app / Apache GPUI | Perf reference; GPL blocks embedding |
| **Continue** | **Acquired by Cursor; repo read-only** | Apache-2.0 | Fork-able corpse, no upstream |
| **Cline** | Alive, ~58k stars, OSS agent leader | Apache-2.0 | Best open reference: agent loop, approvals, MCP, checkpoints |
| Roo Code | **Dead May 2026** (Kilo Code is the fork) | Apache-2.0 | — |
| Void | **Paused since ~Aug 2025** | Apache-2.0 | Frozen reference of Cursor-style fork; don't build on |
| PearAI | Alive but tiny | Apache-2.0 | Low signal |
| Melty | Dead | Apache-2.0 | Skip |

## Adopt-these shortlist

1. **tree-sitter + ast-grep** — highlighting, structural nav, best agent codemod tool.
2. **Open VSX** — mandatory; add extension vetting.
3. **ripgrep** crates or subprocess.
4. **LanceDB + fastembed/ort** for local embeddings. Avoid sqlite-vec, Qdrant.
5. **Sandboxing tiered**: Anthropic srt (Seatbelt/bubblewrap) inner loop; E2B/microsandbox for untrusted/remote; watch Apple Containerization. Hard-avoid WebContainers.
6. **node-pty + xterm.js** (Electron path) / portable-pty + alacritty_terminal (native path).
7. **git CLI as source of truth + gitoxide for hot read paths**; extract VS Code's MIT merge editor.
8. **mason-registry** as data source for one-click LSP/DAP/formatter installs.
9. **SCIP + Sourcegraph indexers** for precise nav feeding agent context.
10. **Study, don't embed**: Zed (GPL), Warp (AGPL); **Cline (Apache-2.0)** as fork-able agent loop reference; Theia if platform-not-fork.

**Key risk flags:** Continue frozen (Cursor-owned); Roo/Void/Melty dead — the OSS AI-IDE graveyard says the differentiator is the agent+model layer, not the shell. License tripwires: Zed app crates GPL-3.0, Warp client AGPL-3.0, WebContainers proprietary, libgit2 fine (linking exception).
