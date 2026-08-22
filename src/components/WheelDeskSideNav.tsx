"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthStatusPill from "./auth/AuthStatusPill";
import { getSupabaseAuthClient } from "../lib/auth/supabase-auth-client";
import { hasPlanAccess } from "../lib/billing/subscription-access";

type NavKey = "dashboard" | "watchlist" | "scanner" | "positions" | "wheel" | "control-center" | "validation" | "zero-dte" | "news";

type NavItem = {
  href: string;
  label: string;
  key: Exclude<NavKey, "scanner">;
  commandOnly?: boolean;
};

type WheelDeskSideNavProps = {
  active: NavKey;
};

const navItems: NavItem[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "zero-dte", href: "/zero-dte/chart", label: "0DTE Command", commandOnly: true },
  { key: "watchlist", href: "/watchlist", label: "Watchlist" },
  { key: "control-center", href: "/control-center", label: "Control Center" },
  { key: "positions", href: "/portfolio", label: "Portfolio" },
  { key: "wheel", href: "/dashboard/wheel", label: "Wheel" },
  { key: "validation", href: "/dashboard/validation", label: "Validation" },
  { key: "news", href: "/news", label: "News" },
];

export function WheelDeskSideNav({ active }: WheelDeskSideNavProps) {
  const activeKey = active === "scanner" ? "watchlist" : active;
  const [commandAccess, setCommandAccess] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseAuthClient();

    async function loadCommandAccess() {
      if (process.env.NEXT_PUBLIC_BILLING_ENABLED !== "true") {
        if (mounted) setCommandAccess(true);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (mounted) setCommandAccess(false);
        return;
      }

      const { data: subscriptions } = await supabase
        .from("subscriptions")
        .select("plan,status,current_period_end")
        .eq("user_id", data.session.user.id)
        .in("status", ["active", "trialing"])
        .order("current_period_end", { ascending: false, nullsFirst: false })
        .limit(1);

      if (!mounted) return;
      const subscription = subscriptions?.[0] ?? null;
      setCommandAccess(
        Boolean(subscription && hasPlanAccess(subscription.plan, subscription.status, "research")),
      );
    }

    void loadCommandAccess();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <aside className="wheeldesk-side-nav" style={styles.sidebar}>
      <div style={styles.brandRow}>
        <div style={styles.brandMark}>W</div>
        <div style={styles.brandText}>WheelDesk</div>
      </div>

      <nav className="wheeldesk-nav" style={styles.nav}>
        {navItems.map((item) => {
          const isActive = item.key === activeKey;
          const isLocked = item.commandOnly && commandAccess === false;

          return (
            <Link
              key={item.key}
              href={isLocked ? "/pricing?upgrade=research" : item.href}
              style={{
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : null),
              }}
            >
              <span>{item.label}</span>
              {isLocked ? <span style={styles.lockBadge}>Upgrade</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="wheeldesk-side-account" style={styles.accountRow}>
        <AuthStatusPill />
      </div>

      <div className="wheeldesk-side-info" style={styles.infoCard}>
        <div style={styles.infoTitle}>WheelDesk</div>
        <div style={styles.infoText}>
          Dashboard is the desk overview. Open Command, Watchlist, Control Center or Portfolio when a market or position needs deeper work.
        </div>
      </div>
    </aside>
  );
}

export const SIDENAV_WIDTH = 244;

const styles: Record<string, any> = {
  sidebar: {
    width: SIDENAV_WIDTH,
    minHeight: "100vh",
    background: "linear-gradient(180deg, #071523 0%, #06101b 100%)",
    borderRight: "1px solid #1d3448",
    color: "#e5f2ff",
    padding: "16px 14px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 26,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },

  brandMark: {
    width: 31,
    height: 31,
    borderRadius: 999,
    border: "1px solid #22d3ee",
    background: "#0b3a46",
    color: "#67e8f9",
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 14,
    boxShadow: "0 0 18px rgba(34, 211, 238, 0.12)",
  },

  brandText: {
    fontSize: 20,
    lineHeight: "22px",
    fontWeight: 900,
    letterSpacing: "-0.04em",
    color: "#f8fbff",
    textShadow: "0 1px 0 rgba(0,0,0,0.35)",
  },

  nav: {
    display: "grid",
    gap: 14,
  },

  navItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    color: "#d6e3f0",
    textDecoration: "none",
    fontWeight: 800,
    fontSize: 15,
    padding: "11px 12px",
    borderRadius: 9,
    border: "1px solid transparent",
  },

  navItemActive: {
    color: "#3df2ff",
    background: "#0b3947",
    borderColor: "#155e75",
    boxShadow: "inset 0 0 0 1px rgba(34, 211, 238, 0.08)",
  },

  lockBadge: {
    color: "#8ea8bd",
    border: "1px solid #294155",
    background: "#0a1825",
    borderRadius: 999,
    padding: "2px 6px",
    fontSize: 9,
    lineHeight: 1.2,
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },

  accountRow: {
    marginTop: "auto",
  },

  infoCard: {
    marginTop: 0,
    border: "1px solid #22384c",
    background: "rgba(10, 25, 41, 0.8)",
    borderRadius: 11,
    padding: "15px 14px",
  },

  infoTitle: {
    color: "#3dff9a",
    fontWeight: 900,
    fontSize: 13,
    marginBottom: 11,
  },

  infoText: {
    color: "#b8cce0",
    fontSize: 12,
    lineHeight: 1.3,
  },
};
