import type { ReactNode } from "react";
import { Info, Lightbulb, TriangleAlert, Sparkles } from "lucide-react";

/**
 * Glass callout card, in the same translucent-white-on-dark language as the
 * hero badge pill and the download modal. Used for notes, tips, and warnings
 * inside the docs prose.
 */

type Variant = "note" | "tip" | "warning" | "royal";

const CONFIG: Record<Variant, { icon: typeof Info; ring: string; iconColor: string; label: string }> = {
  note: { icon: Info, ring: "border-white/15", iconColor: "text-[#c8b6ff]", label: "Note" },
  tip: { icon: Lightbulb, ring: "border-[#8ee6a8]/25", iconColor: "text-[#8ee6a8]", label: "Tip" },
  warning: { icon: TriangleAlert, ring: "border-[#f0b866]/30", iconColor: "text-[#f0b866]", label: "Heads up" },
  royal: { icon: Sparkles, ring: "border-lakshx-violet/40", iconColor: "text-lakshx-violet-active", label: "Royal mode" },
};

export default function Callout({
  variant = "note",
  title,
  children,
}: {
  variant?: Variant;
  title?: string;
  children: ReactNode;
}) {
  const { icon: Icon, ring, iconColor, label } = CONFIG[variant];
  return (
    <div className={`not-prose my-6 flex gap-3.5 rounded-xl border ${ring} bg-white/[0.06] p-4 backdrop-blur-md`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} aria-hidden="true" />
      <div className="min-w-0 text-sm leading-relaxed text-white/75">
        <p className={`mb-1 font-semibold ${iconColor}`}>{title ?? label}</p>
        <div className="space-y-2 [&_a]:text-lakshx-violet-active [&_a]:underline [&_a]:decoration-white/30 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-[#e6ddff]">
          {children}
        </div>
      </div>
    </div>
  );
}
