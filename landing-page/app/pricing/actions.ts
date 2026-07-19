"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { dodoClient, PRO_PRODUCT_ID } from "../../lib/dodo";

/**
 * The real, public "Upgrade to Pro" action — the pricing page's CTA buttons
 * were hardcoded disabled "Coming soon" placeholders (see components/pricing
 * /UpgradeButton.tsx's doc comment for how this was found: the IDE's own
 * budget-cap upgrade link pointed here and hit a dead end). This is the
 * general-purpose twin of app/admin/actions.ts's createTestCheckoutSession —
 * same Dodo product/metadata convention, but sourced from ANY signed-in
 * visitor's cookie session rather than gated to the admin's own account, and
 * self-service sign-in (not "already logged in via the admin login page").
 *
 * `redirect()` calls are deliberately OUTSIDE any try/catch below — Next.js
 * implements redirect() by throwing a special internal error that must
 * propagate uncaught, or the navigation never happens (a real footgun this
 * file's own admin precedent didn't have to worry about, since it never
 * combined a redirect with a call that can genuinely fail).
 */
export async function startProCheckout(): Promise<{ ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Round-trips through Google OAuth, landing back on /auth/callback,
    // which (now cookie-authenticated) redirects to `next` — back to this
    // same page with `?checkout=pro`, so UpgradeButton's effect re-invokes
    // this action once mounted, this time with a real user.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `https://lakshx.in/auth/callback?next=${encodeURIComponent("/pricing?checkout=pro")}`,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data?.url) return { ok: false, error: "failed to start sign-in" };
    redirect(data.url);
  }

  let checkoutUrl: string;
  try {
    const session = await dodoClient().checkoutSessions.create({
      product_cart: [{ product_id: PRO_PRODUCT_ID, quantity: 1 }],
      customer: {
        email: user.email!,
        name: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? user.email!,
      },
      metadata: { supabase_user_id: user.id },
      return_url: "https://lakshx.in/checkout/success",
    });
    if (!session.checkout_url) return { ok: false, error: "Dodo did not return a checkout URL" };
    checkoutUrl = session.checkout_url;
  } catch (err) {
    console.error("pricing/actions: Dodo checkout session creation failed", err);
    return { ok: false, error: "failed to create checkout session" };
  }

  redirect(checkoutUrl);
}
