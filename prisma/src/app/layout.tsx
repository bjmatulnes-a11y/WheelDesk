import Link from "next/link";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Inter, sans-serif", background: "#fafafa" }}>
        <header style={{ borderBottom: "1px solid #e5e7eb", background: "#fff" }}>
          <nav style={{ maxWidth: 1100, margin: "0 auto", padding: "0.9rem 1rem", display: "flex", gap: "1rem" }}>
            <strong style={{ marginRight: "1rem" }}>WheelDesk</strong>
            <Link href="/home">Home</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/portfolio">Portfolio</Link>
            <Link href="/dashboard/wheel">Wheel Workspace</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
