"use client";

import { useState } from "react";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";

type ManageBillingButtonProps = {
  disabled?: boolean;
};

export default function ManageBillingButton({ disabled }: ManageBillingButtonProps) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function openPortal() {
    setBusy(true);
    setStatus("Opening billing portal…");

    try {
      const supabase = getSupabaseAuthClient();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Please log in again before managing billing.");

      const response = await fetch("/api/billing/create-portal-session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Could not open billing portal.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open billing portal.");
      setBusy(false);
    }
  }

  return (
    <div className="wd-checkout-action">
      <button type="button" onClick={openPortal} disabled={disabled || busy} className="wd-auth-secondary">
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {status ? <small>{status}</small> : null}
    </div>
  );
}
