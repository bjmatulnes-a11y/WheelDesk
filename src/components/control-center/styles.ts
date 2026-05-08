import type { CSSProperties } from "react";

export const colors = {
  bg: "#06111d",
  panel: "#0b1624",
  panel2: "#0f1d2d",
  border: "rgba(148, 163, 184, 0.20)",
  text: "#e5eefb",
  muted: "#94a3b8",
  teal: "#22d3ee",
  green: "#34d399",
  red: "#fb7185",
  amber: "#f59e0b",
  violet: "#c084fc",
  blue: "#60a5fa"
};

export const cardStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  background: "linear-gradient(180deg, rgba(15, 29, 45, 0.96), rgba(9, 18, 30, 0.96))",
  borderRadius: 16,
  boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
  color: colors.text
};
