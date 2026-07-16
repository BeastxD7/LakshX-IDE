import type { ReactNode } from "react";

/**
 * Standard header block at the top of every docs page: an eyebrow (the nav
 * group), the page title in the display/heading font, and a lead paragraph.
 */
export default function DocHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="not-prose mb-8 border-b border-white/10 pb-8">
      {eyebrow && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-lakshx-violet-active">{eyebrow}</p>
      )}
      <h1 className="font-heading text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
      {children && <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">{children}</p>}
    </header>
  );
}

/**
 * "How to open it" chip row — the fast answer to "where do I find this?".
 * Renders labelled access points (status bar icon, command palette entry,
 * slash command, panel, etc.) as small glass chips.
 */
export function AccessRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="not-prose my-6 flex flex-wrap gap-2.5">
      {items.map((it) => (
        <span
          key={it.label + it.value}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-sm backdrop-blur-md"
        >
          <span className="text-white/45">{it.label}</span>
          <span className="font-mono text-[0.82rem] text-white/90">{it.value}</span>
        </span>
      ))}
    </div>
  );
}
