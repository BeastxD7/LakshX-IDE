"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import CtaButton from "../../app/components/CtaButton";
import { startProCheckout } from "../../app/pricing/actions";

/**
 * The Pro plan card's real CTA (see app/pricing/actions.ts's doc comment for
 * why this exists — the button here used to be a hardcoded disabled "Coming
 * soon" placeholder that the IDE's own budget-cap upgrade link pointed
 * straight into). `startProCheckout()` either redirects the whole page away
 * (to Google sign-in, or straight to Dodo checkout) or resolves with
 * `{ok:false, error}` for a genuine failure — never both, so no try/catch is
 * needed here: a redirect unmounts this component before its promise would
 * otherwise resolve.
 *
 * `?checkout=pro` on this page (see actions.ts: the post-sign-in `next`
 * target) means "the visitor just finished signing in specifically to
 * upgrade" — re-invoke the action once mounted so they land on Dodo checkout
 * without a second click.
 */
function UpgradeButtonInner() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();

  const go = () => {
    setError(null);
    startTransition(async () => {
      const result = await startProCheckout();
      if (!result.ok) setError(result.error);
    });
  };

  useEffect(() => {
    if (params.get("checkout") === "pro") go();
    // Intentionally run once on mount only — re-running on every params
    // change would re-trigger checkout if the visitor navigates away and
    // back with the query string still attached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-8 w-full">
      <CtaButton variant="accent" size="lg" disabled={pending} onClick={go} className="w-full">
        {pending ? "Redirecting…" : "Upgrade to Pro"}
      </CtaButton>
      {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * `useSearchParams()` requires a Suspense boundary in the App Router (it
 * opts the subtree out of static rendering) — contained here so the pricing
 * page itself (a plain server component) doesn't need to know about it.
 */
export function UpgradeButton() {
  return (
    <Suspense fallback={<div className="mt-8 h-[52px] w-full animate-pulse rounded-full bg-ink-navy/[0.06]" />}>
      <UpgradeButtonInner />
    </Suspense>
  );
}
