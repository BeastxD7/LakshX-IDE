import type { ReactNode } from "react";
import PageNav from "./PageNav";

/**
 * The article shell every docs page renders inside. The fixed
 * `id="docs-article"` is what the right-hand TOC scans for headings, and the
 * prev/next pager is appended automatically from the nav order.
 */
export default function DocArticle({ children }: { children: ReactNode }) {
  return (
    <article id="docs-article" className="docs-prose mx-auto max-w-3xl">
      {children}
      <PageNav />
    </article>
  );
}
