"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { colors, cardStyle } from "./styles";

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function DarkDropdown({
  label,
  value,
  options,
  emptyLabel = "No options",
  onChange,
  minWidth = 140
}: {
  label: string;
  value: string;
  options: string[];
  emptyLabel?: string;
  onChange: (value: string) => void;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const safeOptions = useMemo(() => Array.from(new Set((options ?? []).filter(Boolean))), [options]);
  const displayValue = value || safeOptions[0] || emptyLabel;

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} style={{ ...cardStyle, padding: "0.55rem 0.75rem", minWidth, position: "relative" }}>
      <div style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          border: "none",
          outline: "none",
          background: "transparent",
          color: colors.text,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          cursor: "pointer",
          fontWeight: 900,
          fontSize: 14,
          padding: 0
        }}
      >
        <span>{displayValue}</span>
        <span style={{ color: colors.teal, fontSize: 13 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 0.35rem)",
            left: 0,
            right: 0,
            zIndex: 60,
            maxHeight: 260,
            overflowY: "auto",
            border: `1px solid ${colors.teal}`,
            borderRadius: 12,
            background: "#081422",
            boxShadow: "0 18px 50px rgba(0, 0, 0, 0.55)",
            padding: 4
          }}
        >
          {safeOptions.length ? safeOptions.map((option) => {
            const active = option === value;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  display: "block",
                  border: "none",
                  borderRadius: 8,
                  background: active ? "rgba(34, 211, 238, 0.22)" : "transparent",
                  color: active ? colors.text : colors.muted,
                  padding: "0.45rem 0.55rem",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: active ? 950 : 750,
                  fontSize: 13
                }}
              >
                {option}
              </button>
            );
          }) : (
            <div style={{ color: colors.muted, padding: "0.45rem 0.55rem", fontSize: 13 }}>{emptyLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function ControlCenterHeader({
  ticker,
  tickers,
  selectedDate,
  dates,
  confidence,
  onTickerChange,
  onDateChange
}: {
  ticker: string;
  tickers: string[];
  selectedDate: string;
  dates: string[];
  confidence?: number | null;
  onTickerChange: (ticker: string) => void;
  onDateChange: (date: string) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const safeTickers = Array.from(new Set((tickers?.length ? tickers : [ticker || "SOFI"]).filter(Boolean))).sort();
  const safeDates = dates ?? [];
  const selectedTicker = ticker || safeTickers[0] || "SOFI";

  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
      <div>
        <h1 style={{ margin: 0, color: colors.text, fontSize: 28, fontWeight: 950 }}>Control Center</h1>
        <div style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>Adaptive Position Control</div>
      </div>

      {!mounted ? (
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }} suppressHydrationWarning>
          <div style={{ ...cardStyle, padding: "0.65rem 0.85rem", minWidth: 140 }}>
            <div style={{ color: colors.muted, fontSize: 11 }}>Symbol</div>
            <div style={{ color: colors.text, fontWeight: 900 }}>Loading...</div>
          </div>
          <div style={{ ...cardStyle, padding: "0.65rem 0.85rem", minWidth: 170 }}>
            <div style={{ color: colors.muted, fontSize: 11 }}>OI Surface</div>
            <div style={{ color: colors.text, fontWeight: 900 }}>Loading...</div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <DarkDropdown
            label="Symbol"
            value={selectedTicker}
            options={safeTickers}
            onChange={onTickerChange}
            minWidth={140}
          />

          <DarkDropdown
            label="OI Surface"
            value={selectedDate}
            options={safeDates}
            emptyLabel="No surface"
            onChange={onDateChange}
            minWidth={170}
          />

          <div style={{ ...cardStyle, padding: "0.75rem 1rem", color: colors.teal, fontWeight: 950, minWidth: 115, textAlign: "center" }}>
            {pct(confidence)} Confidence
          </div>
        </div>
      )}
    </header>
  );
}
