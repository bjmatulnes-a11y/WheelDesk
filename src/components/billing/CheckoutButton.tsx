"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";
import type { WheelDeskPlanId } from "../../lib/billing/plans";

type CheckoutButtonProps = {
  planId: WheelDeskPlanId;
  label: string;
};

export default function CheckoutButton({ planId, label }: CheckoutButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function startCheckout() {
    setBusy(true);
    setStatus("Preparing secure checkout…");

    try {
      const supabase = getSupabaseAuthClient();
      const { data, error } = await supabase.auth.getSession();

      if (error) throw error;

      const accessToken = data.session?.access_token;

      if (!accessToken) {
        const next = encodeURIComponent(`/pricing?plan=${planId}`);
        router.push(`/signup?plan=${planId}&next=${next}`);
        return;
      }

      const response = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ plan: planId }),
      });

      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Could not start checkout.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start checkout.");
      setBusy(false);
    }
  }

  return (
    <div className="wd-checkout-action">
      <button type="button" onClick={startCheckout} disabled={busy} className="wd-auth-primary wd-checkout-button">
        {busy ? "Opening Stripe…" : label}
      </button>
      {status ? <small>{status}</small> : null}
    </div>
  );
}
