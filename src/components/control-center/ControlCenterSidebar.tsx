"use client";

import Link from "next/link";
import { colors } from "./styles";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Scanner", href: "/dashboard/scanner" },
  { label: "Positions", href: "/portfolio" },
  { label: "Wheel", href: "/dashboard/wheel" },
  { label: "Control Center", href: "/control-center", active: true },
  { label: "Validation", href: "/dashboard/validation" }
];

export default function ControlCenterSidebar() {
  return (
    <aside style={{ width: 238, background: "linear-gradient(180deg, #071321, #050b14)", borderRight: `1px solid ${colors.border}`, minHeight: "100vh", padding: "1rem", position: "sticky", top: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.6rem" }}>
        <div style={{ width: 34, height: 34, borderRadius: 99, background: "rgba(34, 211, 238, 0.15)", border: "1px solid rgba(34,211,238,0.45)", display: "grid", placeItems: "center", color: colors.teal, fontWeight: 900 }}>W</div>
        <strong style={{ color: "#f8fafc", fontSize: 22 }}>WheelDesk</strong>
      </div>

      <nav style={{ display: "grid", gap: "0.35rem" }}>
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} style={{
            color: item.active ? colors.teal : "#cbd5e1",
            textDecoration: "none",
            padding: "0.75rem 0.85rem",
            borderRadius: 12,
            background: item.active ? "rgba(34, 211, 238, 0.12)" : "transparent",
            border: item.active ? "1px solid rgba(34, 211, 238, 0.20)" : "1px solid transparent",
            fontWeight: item.active ? 900 : 600
          }}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div style={{ marginTop: "2rem", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "0.85rem", color: colors.muted, fontSize: 12 }}>
        <div style={{ color: colors.green, fontWeight: 900 }}>Market Structure</div>
        <p style={{ marginBottom: 0 }}>Control Center turns OI path, dealer pressure, and position context into a receding-horizon action map.</p>
      </div>
    </aside>
  );
}
