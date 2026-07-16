import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";

export const metadata: Metadata = {
  title: "Database Visualization",
  description: "ER diagrams for MongoDB, PostgreSQL, MySQL, and SQLite in the LakshX DB panel.",
};

export default function DatabasesPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Databases" title="Database Visualization">
        Connect a database and LakshX draws it — tables, collections, and the relationships between them —
        as an ER diagram, right inside the IDE. It works across four engines.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Status bar", value: "$(database) DB" },
          { label: "Command", value: "LakshX: Show Database Panel" },
        ]}
      />

      <h2>Supported engines</h2>
      <ul>
        <li><strong>PostgreSQL</strong>, <strong>MySQL</strong>, <strong>SQLite</strong> — relational schemas with real foreign keys, drawn as solid relationship edges.</li>
        <li><strong>MongoDB</strong> — collections with relationships inferred from your documents.</li>
      </ul>

      <h2>Opening the panel</h2>
      <p>Two ways in:</p>
      <ul>
        <li>Click <strong>DB</strong> in the status bar (the database icon).</li>
        <li>Run <strong>LakshX: Show Database Panel</strong> from the command palette.</li>
      </ul>

      <h2>Connecting</h2>
      <ul>
        <li><strong>SQLite</strong> — pick the database file with an open dialog; it opens read-only.</li>
        <li><strong>PostgreSQL / MySQL / MongoDB</strong> — paste a connection string into a masked input, validated against the engine&rsquo;s scheme.</li>
      </ul>
      <p>
        Credentials are stored in the IDE&rsquo;s per-extension secret storage — never in a file in your
        repo. To switch databases, use <strong>Change Connection…</strong> in the panel, or run{" "}
        <strong>LakshX: Forget Database Credentials</strong> to clear them.
      </p>

      <h2>Reading the diagram</h2>
      <p>
        The panel renders your schema as an entity-relationship diagram, so you can see structure and joins
        at a glance instead of piecing them together from migration files. LakshX also suggests opening the
        DB panel when you open a database-related file.
      </p>

      <Callout variant="tip" title="Let the agent read the data too">
        Visualization shows you the shape of the database. If you want the coding agent to read actual rows
        while it works, turn on <Link href="/docs/db-query">db_query</Link> — a separate, read-only,
        opt-in feature.
      </Callout>
    </DocArticle>
  );
}
