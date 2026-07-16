import type { Metadata } from "next";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";

export const metadata: Metadata = {
  title: "Code Call Graph",
  description: "A native map of who-calls-what and how modules depend on each other.",
};

export default function CodeGraphPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Code Graph" title="Code Call Graph">
        LakshX can draw two native maps of your codebase — a call graph (who calls what) and a dependency
        graph (how files depend on each other) — so you can navigate structure visually instead of chasing
        references by hand.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Status bar", value: "$(graph) Call Graph" },
          { label: "And", value: "$(type-hierarchy) Dep Graph" },
        ]}
      />

      <h2>Call graph</h2>
      <p>
        Place your cursor on a function or method, then open the call graph — from the{" "}
        <strong>Call Graph</strong> status bar item, or via <strong>LakshX: Show Call Graph</strong>{" "}
        in the
        command palette. It builds an interactive call-hierarchy view of what that function calls and what
        calls it, using the editor&rsquo;s own language intelligence.
      </p>

      <Callout variant="note" title="Put your cursor on a symbol first">
        The call graph starts from wherever your cursor is. If no function is selected, LakshX reminds you:
        &ldquo;open a file and place your cursor on a function/method first.&rdquo;
      </Callout>

      <h2>Dependency graph</h2>
      <p>
        Open <strong>Dep Graph</strong> from the status bar, or run{" "}
        <strong>LakshX: Show Dependency Graph</strong>. LakshX scans the workspace and renders a graph of
        modules, the edges between them, and any dependency <strong>cycles</strong> it finds, plus summary
        stats. Click a node to jump straight to that file.
      </p>

      <h2>When to use it</h2>
      <ul>
        <li>Understanding an unfamiliar codebase before you change it.</li>
        <li>Tracing the blast radius of a refactor — everything that calls the function you&rsquo;re about to touch.</li>
        <li>Finding circular dependencies you want to untangle.</li>
      </ul>

      <Callout variant="tip" title="Recommended on file open">
        LakshX suggests the call-graph view when you open a code file, so the map is one click away when you
        need it.
      </Callout>
    </DocArticle>
  );
}
