/**
 * Soft blurred pink/green gradient blobs used as the background accent for
 * every white-canvas section below the hero. Deliberately a different color
 * language from the hero's purple/violet (see Hero.tsx) — this is the
 * "content" palette, the hero stays the "brand" palette.
 *
 * Each section that uses this renders it as an absolutely-positioned first
 * child inside a `relative overflow-hidden` wrapper, with real content given
 * `relative z-10` so it always sits above the glow.
 */
export default function SectionGlow({ variant = "a" }: { variant?: "a" | "b" | "c" }) {
  if (variant === "b") {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute right-[-10%] top-[-15%] h-[26rem] w-[26rem] rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute left-[-12%] bottom-[-20%] h-[28rem] w-[28rem] rounded-full bg-pink-200/45 blur-3xl" />
      </div>
    );
  }

  if (variant === "c") {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-25%] h-[30rem] w-[40rem] -translate-x-1/2 rounded-full bg-pink-100/50 blur-3xl" />
        <div className="absolute right-[-8%] bottom-[-10%] h-[20rem] w-[20rem] rounded-full bg-emerald-100/50 blur-3xl" />
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute left-[-8%] top-[-10%] h-[24rem] w-[24rem] rounded-full bg-pink-200/40 blur-3xl" />
      <div className="absolute right-[-10%] top-[20%] h-[22rem] w-[22rem] rounded-full bg-emerald-200/35 blur-3xl" />
      <div className="absolute bottom-[-15%] left-1/3 h-[26rem] w-[26rem] rounded-full bg-emerald-100/40 blur-3xl" />
    </div>
  );
}
