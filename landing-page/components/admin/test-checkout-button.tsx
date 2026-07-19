"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTestCheckoutSession } from "../../app/admin/actions";

/**
 * Test-mode-only: creates a real Dodo Checkout Session tied to the admin's
 * own account and navigates the browser straight to it — the only way to
 * exercise the full checkout -> webhook -> user_subscription flow before a
 * real "Upgrade" button exists on the marketing site.
 */
export function TestCheckoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const checkoutUrl = await createTestCheckoutSession();
            window.location.href = checkoutUrl;
          } catch (err) {
            setError(err instanceof Error ? err.message : "failed to create checkout session");
            setLoading(false);
          }
        }}
      >
        <FlaskConical className="size-3.5" />
        {loading ? "Creating…" : "Create test checkout"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
