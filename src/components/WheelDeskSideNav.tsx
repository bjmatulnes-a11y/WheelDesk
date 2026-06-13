"use client";

import Link from "next/link";
import AuthStatusPill from "./auth/AuthStatusPill";

type NavKey = "dashboard" | "watchlist" | "scanner" | "positions" | "wheel" | "control-center" | "validation" | "zero-dte" | "news";

type NavItem = {
  href: string;
  label: string;
  key: Exclude<NavKey, "scanner">;
};

type WheelDeskSideNavProps = {
  active: NavKey;
};

const navItems: NavItem[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "watchlist", href: "/watchlist", label: "Full Watchlist" },
  { key: "control-center", href: "/control-center", label: "Control Center" },
  { key: "wheel", href: "/dashboard/wheel", label: "Wheel" },
  { key: "validation", href: "/dashboard/validation", label: "Validation" },
  { key: "zero-dte", href: "/zero-dte", label: "0DTE Command" },
  { key: "news", href: "/news", label: "News Pulse" },
  { key: "positions", href: "/portfolio", label: "Portfolio" },

];

export function WheelDeskSideNav({ active }: WheelDeskSideNavProps) {
  const activeKey = active === "scanner" ? "watchlist" : active;

  return (
    <aside className="wheeldesk-side-nav" style={styles.sidebar}>
      <div style={styles.brandRow}>
        <div style={styles.brandMark}>W</div>
        <div style={styles.brandText}>WheelDesk</div>
      </div>

      <nav className="wheeldesk-nav" style={styles.nav}>
        {navItems.map((item) => {
          const isActive = item.key === activeKey;

          return (
            <Link
              key={item.key}
              href={item.href}
              style={{
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : null),
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="wheeldesk-side-account" style={styles.accountRow}>
        <AuthStatusPill />
      </div>

      <div className="wheeldesk-side-info" style={styles.infoCard}>
        <div style={styles.infoTitle}>Market Structure</div>
        <div style={styles.infoText}>
          Dashboard manages your central ticker slots. Full Watchlist is the deeper triage view after the Dashboard morning read.
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
    display: "block",
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
