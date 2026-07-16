import type { Metadata } from "next";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";
import CodeBlock from "../_components/CodeBlock";

export const metadata: Metadata = {
  title: "Building from Source",
  description: "Produce native LakshX installers with the OS-Build scripts.",
};

export default function BuildingPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Building from Source" title="Building from Source">
        Prefer to build LakshX yourself? A single entry-point script detects your OS and produces a native
        installer — a <code>.dmg</code>, <code>.exe</code>, or <code>.deb</code> — so you get the same
        artifact the downloads page serves, built on your own machine.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Entry point", value: "./build.sh" },
          { label: "Scripts", value: "OS-Build/" },
        ]}
      />

      <h2>One command</h2>
      <p>
        From the repo root, run <code>build.sh</code>. It detects your platform and dispatches to the right
        per-OS script:
      </p>
      <CodeBlock lang="bash">{`./build.sh          # build the installer for this OS
./build.sh --check  # preflight only: check tools + print the plan
./build.sh --help   # usage`}</CodeBlock>

      <h2>What you get</h2>
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Output</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>macOS</td><td><code>LakshX-macOS-&lt;arch&gt;.dmg</code> (drag-to-Applications installer)</td></tr>
          <tr><td>Windows</td><td><code>LakshX-Windows-&lt;arch&gt;.exe</code> (setup installer)</td></tr>
          <tr><td>Linux</td><td><code>LakshX-Linux-&lt;arch&gt;.deb</code></td></tr>
        </tbody>
      </table>

      <h2>The OS-Build scripts</h2>
      <p>
        The <code>OS-Build/</code> directory holds the per-platform build logic that <code>build.sh</code>{" "}
        calls into:
      </p>
      <ul>
        <li><code>build-macos.sh</code>, <code>build-windows.ps1</code>, <code>build-linux.sh</code> — the native packaging steps for each OS.</li>
        <li><code>lib-preflight.sh</code> — shared checks for required tools before a build starts.</li>
        <li><code>README.md</code> — details and prerequisites.</li>
      </ul>

      <Callout variant="tip" title="Check before you build">
        Run <code>./build.sh --check</code> first. It runs the preflight and prints the exact command
        sequence it would execute, so you can confirm your toolchain is ready before committing to a full
        build.
      </Callout>

      <Callout variant="note" title="Cross-compiling">
        Each script builds for the OS it runs on. To produce all three installers you build on each
        platform (or in CI). Extra arguments pass through to the underlying build, and{" "}
        <code>VSCODE_ARCH</code> / <code>VSCODE_QUALITY</code> are honored if set.
      </Callout>
    </DocArticle>
  );
}
