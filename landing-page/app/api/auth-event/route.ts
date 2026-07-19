import { NextRequest } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase/admin";

export const runtime = "nodejs";

const VALID_EVENT_TYPES = new Set(["ide_login", "ide_refresh"]);

/**
 * Cloud mirror of the IDE's OWN login/refresh events — previously only the
 * admin web login (app/auth/callback/route.ts) ever reached auth_events,
 * leaving the IDE's session lifecycle (product/lakshx-chat/extension.js's
 * URI-handler login and scheduleLakshxRefresh()'s background refresh) with
 * zero server-side visibility. That gap is exactly what made a real session-
 * expiry report impossible to diagnose after the fact.
 *
 * Auth follows the same bearer-token pattern as /api/feedback,
 * /api/agent-incident, etc. — with one deliberate exception: a FAILED
 * refresh is the most diagnostically important event to capture, but by
 * definition it may mean neither the access token nor the refresh token is
 * fully healthy anymore. We still attempt auth.getUser() with whatever
 * access token the extension currently holds (it may be stale but not yet
 * expired, or may have been refreshed moments earlier for an unrelated
 * reason) — if that also fails, this call 401s and the event silently isn't
 * recorded. That's an accepted gap, not a bug: building a parallel
 * unauthenticated-but-attributable logging path just for this one case would
 * be disproportionate — this already matches every other piece of telemetry
 * in this codebase, which is fire-and-forget and never guaranteed to land.
 *
 * Body: { success: boolean, eventType: "ide_login" | "ide_refresh" }.
 */
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "server misconfigured — missing SUPABASE_* env vars" }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "missing bearer token" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return Response.json({ error: "invalid or expired session" }, { status: 401 });
  }
  const userId = userData.user.id;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const eventType = typeof body.eventType === "string" ? body.eventType : "";
  if (!VALID_EVENT_TYPES.has(eventType)) {
    return Response.json({ error: "eventType must be one of: ide_login, ide_refresh" }, { status: 400 });
  }
  const success = body.success === true;

  const { error: insertErr } = await admin.rpc("record_auth_event", {
    p_user_id: userId,
    p_success: success,
    p_event_type: eventType,
  });

  if (insertErr) {
    console.error("auth-event: record_auth_event failed", insertErr);
    return Response.json({ error: "failed to record auth event" }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
