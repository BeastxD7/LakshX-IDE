"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { adjacentPages } from "./nav";

/**
 * Previous / next pager at the foot of each docs page. Derives its two
 * links from the flat nav order + the current pathname, so it stays in sync
 * with the sidebar automatically.
 */
export default function PageNav() {
  const pathname = usePathname();
  const { prev, next } = adjacentPages(pathname);
  if (!prev && !next) return null;

  return (
    <nav className="not-prose mt-14 grid gap-4 border-t border-white/10 pt-8 sm:grid-cols-2">
      {prev ? (
        <Link
          href={prev.href}
          className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-white/25 hover:bg-white/[0.08]"
        >
          <span className="flex items-center gap-1.5 text-xs text-white/45">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
          </span>
          <span className="mt-1 font-medium text-white/90 group-hover:text-white">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.04] p-4 text-right transition hover:border-white/25 hover:bg-white/[0.08]"
        >
          <span className="flex items-center justify-end gap-1.5 text-xs text-white/45">
            Next <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="mt-1 font-medium text-white/90 group-hover:text-white">{next.title}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
