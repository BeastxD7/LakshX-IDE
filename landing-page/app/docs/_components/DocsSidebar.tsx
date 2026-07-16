"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "./nav";

/**
 * The grouped left-hand navigation. Shared by the persistent desktop rail
 * and the mobile drawer. `onNavigate` lets the drawer close itself on tap.
 */
export default function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-7 pb-16 text-sm">
      {DOCS_NAV.map((group) => (
        <div key={group.label}>
          <p className="mb-2.5 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/35">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.pages.map((page) => {
              const active = pathname === page.href;
              return (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between rounded-lg px-3 py-1.5 transition ${
                      active
                        ? "bg-lakshx-violet/20 font-medium text-white ring-1 ring-inset ring-lakshx-violet/40"
                        : "text-white/60 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span>{page.title}</span>
                    {page.badge && (
                      <span className="rounded-full border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/50">
                        {page.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
