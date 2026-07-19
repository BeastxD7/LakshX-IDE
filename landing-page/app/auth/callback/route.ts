import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { supabaseAdmin } from "../../../lib/supabase/admin";

export const runtime = "nodejs";

/**
 * PKCE code-exchange landing point for the admin web login (see
 * app/admin/login/actions.ts). Logs both outcomes to auth_events via the
 * service-role admin client — NOT the SSR client above, which after a
 * successful exchange is authenticated AS the signed-in user and therefore
 * cannot call a service-role-only function (record_auth_event, like every
 * other write function in schema.sql, revokes execute from `authenticated`).
 *
 * On failure there is no user_id yet (the exchange failing IS "we don't know
 * who this is" — the session, and with it the identity, never got created),
 * so failures are logged with a null user_id rather than dropped: this keeps
 * failure volume visible on the admin dashboard even though individual
 * failures can't be attributed to a person.
 *
 * Also now the landing point for the public /pricing "Upgrade" button (see
 * app/pricing/actions.ts) — this route itself was never admin-specific,
 * only the UI that used to be its sole caller was. `next` is untrusted
 * input (an attacker can request any `next` value on the sign-in URL they
 * get a victim to click); `safeNext()` below rejects anything that isn't a
 * same-origin relative path so this can't be turned into an open redirect
 * (`new URL("https://evil.example", req.url)` would otherwise happily
 * redirect off-site after a real, successful sign-in).
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/admin";
  return next;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const admin = supabaseAdmin();

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { error: logErr } = await admin.rpc("record_auth_event", { p_user_id: data.user?.id ?? null, p_success: true });
      if (logErr) console.error("auth/callback: record_auth_event (success) failed", logErr);
      return NextResponse.redirect(new URL(next, req.url));
    }
    const { error: logErr } = await admin.rpc("record_auth_event", { p_user_id: null, p_success: false });
    if (logErr) console.error("auth/callback: record_auth_event (failure) failed", logErr);
  }

  return NextResponse.redirect(new URL("/admin/login", req.url));
}
