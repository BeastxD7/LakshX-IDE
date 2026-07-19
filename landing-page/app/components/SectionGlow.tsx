/**
 * Rich, large-coverage violet gradient wash used as the background for
 * every section below the hero — the SAME brand accent as the hero itself
 * (Logo.tsx's `#9d7fff`/`#6a48f0` spark gradient, globals.css's
 * `--color-lakshx-violet`/`-active`), just lighter/airier so body text
 * stays readable on a near-white canvas. Deliberately full-bleed and
 * overlapping (not small isolated blurred circles) — the wash should read
 * as one continuous gradient field behind the section, the way the hero's
 * own photo background reads as one continuous image, not a collage of
 * separate spots.
 *
 * Each section that uses this renders it as an absolutely-positioned first
 * child inside a `relative overflow-hidden` wrapper, with real content given
 * `relative z-10` so it always sits above the glow.
 */
export default function SectionGlow({ variant = "a" }: { variant?: "a" | "b" | "c" }) {
  if (variant === "b") {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -right-1/4 -top-1/3 h-[46rem] w-[46rem] rounded-full bg-lakshx-violet-active/45 blur-[110px]" />
        <div className="absolute -left-1/4 -bottom-1/3 h-[50rem] w-[50rem] rounded-full bg-lakshx-violet/35 blur-[120px]" />
        <div className="absolute left-1/3 top-1/4 h-[30rem] w-[30rem] rounded-full bg-[#c8b6ff]/40 blur-[100px]" />
      </div>
    );
  }

  if (variant === "c") {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 -top-1/3 h-[42rem] w-[64rem] -translate-x-1/2 rounded-full bg-lakshx-violet-active/40 blur-[120px]" />
        <div className="absolute -right-1/4 -bottom-1/4 h-[34rem] w-[34rem] rounded-full bg-lakshx-violet/30 blur-[100px]" />
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-1/4 -top-1/4 h-[40rem] w-[40rem] rounded-full bg-lakshx-violet-active/45 blur-[110px]" />
      <div className="absolute -right-1/4 top-1/4 h-[36rem] w-[36rem] rounded-full bg-[#9d7fff]/30 blur-[110px]" />
      <div className="absolute -bottom-1/3 left-1/3 h-[42rem] w-[42rem] rounded-full bg-lakshx-violet/30 blur-[120px]" />
    </div>
  );
}
