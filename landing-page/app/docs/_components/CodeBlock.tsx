"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Code block for the docs. Matches the download modal's code style (dark
 * translucent panel, mono, copy button) but adds a lightweight, dependency-
 * free highlighter tuned for the kinds of snippets these docs actually show:
 * slash commands, shell one-liners, and small JS/JSON schema blocks.
 *
 * We deliberately do NOT pull in Shiki here — every snippet in the docs is
 * short, and a hand-rolled token pass keeps the production build fast and
 * free of a CDN/theme dependency while still coloring to the violet palette.
 */

type Lang = "bash" | "text" | "js" | "json";

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "true", "false", "null", "type", "enum", "import", "from", "export", "new", "await", "async",
]);

/** Split one line into colored spans. Order matters: comments first. */
function tokenizeLine(line: string, lang: Lang, keyPrefix: string): ReactNode[] {
  // Whole-line comment styles.
  const trimmed = line.trimStart();
  if ((lang === "bash" || lang === "text") && trimmed.startsWith("#")) {
    return [<span key={keyPrefix} className="text-white/40">{line}</span>];
  }
  if ((lang === "js" || lang === "json") && trimmed.startsWith("//")) {
    return [<span key={keyPrefix} className="text-white/40">{line}</span>];
  }

  // Master token regex, evaluated left to right.
  const re =
    /(\/[a-zA-Z][\w-]*)|(\$[A-Za-z_][\w]*|\$\d+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(#.*$)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w-]*)/g;

  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(<span key={`${keyPrefix}-t${i++}`}>{line.slice(last, m.index)}</span>);
    const [full, slash, dollar, str, hashComment, num, word] = m;
    if (slash) {
      out.push(<span key={`${keyPrefix}-t${i++}`} className="font-medium text-[#c8b6ff]">{full}</span>);
    } else if (dollar) {
      out.push(<span key={`${keyPrefix}-t${i++}`} className="text-[#f0b866]">{full}</span>);
    } else if (str) {
      out.push(<span key={`${keyPrefix}-t${i++}`} className="text-[#8ee6a8]">{full}</span>);
    } else if (hashComment) {
      out.push(<span key={`${keyPrefix}-t${i++}`} className="text-white/40">{full}</span>);
    } else if (num) {
      out.push(<span key={`${keyPrefix}-t${i++}`} className="text-[#f0b866]">{full}</span>);
    } else if (word) {
      if (KEYWORDS.has(word)) {
        out.push(<span key={`${keyPrefix}-t${i++}`} className="text-[#c8b6ff]">{full}</span>);
      } else {
        out.push(<span key={`${keyPrefix}-t${i++}`}>{full}</span>);
      }
    }
    last = m.index + full.length;
  }
  if (last < line.length) out.push(<span key={`${keyPrefix}-t${i++}`}>{line.slice(last)}</span>);
  return out;
}

export default function CodeBlock({
  children,
  lang = "bash",
  title,
}: {
  children: string;
  lang?: Lang;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const code = children.replace(/\n$/, "");
  const lines = code.split("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — text is still selectable */
    }
  }

  return (
    <div className="not-prose group my-5 overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-xs text-white/45">{title ?? lang}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="docs-scrollbar overflow-x-auto px-4 py-3.5 text-sm leading-relaxed">
        <code className="font-mono text-white/85">
          {lines.map((line, idx) => (
            <span key={idx} className="block min-h-[1.4em]">
              {tokenizeLine(line, lang, `l${idx}`)}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
