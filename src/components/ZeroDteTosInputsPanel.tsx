"use client";

import { useMemo, useState } from "react";
import type React from "react";
import type { ZeroDteRecommendation } from "../lib/zeroDteOiIntelligence";
import type { ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";

type Props = {
  recommendation: ZeroDteRecommendation;
  tradeSelection?: ZeroDteTradeSelection | null;
  generatedAt?: string | null;
};

type TosInputRow = {
  key: string;
  label: string;
  value: number;
  note: string;
};

export function ZeroDteTosInputsPanel({ recommendation, tradeSelection, generatedAt }: Props) {
  const [copied, setCopied] = useState(false);

  const putSpread = tradeSelection?.creditSpreadBook?.put ?? null;
  const callSpread = tradeSelection?.creditSpreadBook?.call ?? null;

  const rows = useMemo<TosInputRow[]>(() => {
    return [
      {
        key: "WD_OIGravity",
        label: "OI Gravity",
        value: recommendation.spx.gravity ?? 0,
        note: "Primary SPX OI center / battlefield line.",
      },
      {
        key: "WD_PutWall",
        label: "Put Wall",
        value: recommendation.spx.putWall ?? 0,
        note: "Primary SPX downside support wall.",
      },
      {
        key: "WD_CallWall",
        label: "Call Wall",
        value: recommendation.spx.callWall ?? 0,
        note: "Primary SPX upside resistance wall.",
      },
      {
        key: "WD_IFCenter",
        label: "IF Center",
        value: recommendation.suggestedCenter ?? 0,
        note: "WheelDesk suggested iron-fly center.",
      },
      {
        key: "WD_ShortPut",
        label: "Short Put",
        value: putSpread?.shortStrike ?? 0,
        note: "Optimized put credit-spread short strike. Zero means no clean candidate.",
      },
      {
        key: "WD_ShortCall",
        label: "Short Call",
        value: callSpread?.shortStrike ?? 0,
        note: "Optimized call credit-spread short strike. Zero means no clean candidate.",
      },
      {
        key: "WD_DealerPressure",
        label: "Dealer Pressure",
        value: recommendation.dealerPressure ?? 0,
        note: "Regime filter for Compass reactions.",
      },
      {
        key: "WD_PinScore",
        label: "Pin / Confidence",
        value: recommendation.confidenceScore ?? 0,
        note: "Use as the Compass pin/compression score.",
      },
    ];
  }, [callSpread?.shortStrike, putSpread?.shortStrike, recommendation]);

  const thinkScriptBlock = useMemo(() => {
    const header = [
      "# WheelDesk 0DTE TOS Inputs",
      `# Generated: ${generatedAt ? new Date(generatedAt).toLocaleString() : "not available"}`,
      `# SPX: ${fmt(recommendation.spxPrice)} | Exp Move: ±${fmt(recommendation.expectedMove)} | Source: WheelDesk`,
    ].join("\n");

    const inputs = rows
      .map((row) => `input ${row.key} = ${tosNumber(row.value)};`)
      .join("\n");

    return `${header}\n${inputs}`;
  }, [generatedAt, recommendation.expectedMove, recommendation.spxPrice, rows]);

  const quickLine = useMemo(() => {
    return rows.map((row) => `${row.label}: ${fmt(row.value)}`).join(" | ");
  }, [rows]);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const putTrade = formatSpread("PUT", putSpread?.shortStrike ?? null, putSpread?.longStrike ?? null, putSpread?.estimatedCredit ?? null, putSpread?.actualWidth ?? null);
  const callTrade = formatSpread("CALL", callSpread?.shortStrike ?? null, callSpread?.longStrike ?? null, callSpread?.estimatedCredit ?? null, callSpread?.actualWidth ?? null);

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>TOS Compass Inputs</h2>
          <p style={styles.subtitle}>
            Copy this block into the top inputs of your TOS WD Compass study. No hunting across the page.
          </p>
        </div>
        <div style={styles.actions}>
          <button type="button" onClick={() => copyText(thinkScriptBlock)} style={styles.primaryButton}>
            {copied ? "Copied" : "Copy TOS Inputs"}
          </button>
          <button type="button" onClick={() => copyText(quickLine)} style={styles.secondaryButton}>
            Copy Quick Line
          </button>
        </div>
      </div>

      <div style={styles.summaryGrid}>
        <div style={styles.summaryBox}>
          <div style={styles.smallCaps}>Put Spread Candidate</div>
          <div style={styles.tradeText}>{putTrade}</div>
        </div>
        <div style={styles.summaryBox}>
          <div style={styles.smallCaps}>Call Spread Candidate</div>
          <div style={styles.tradeText}>{callTrade}</div>
        </div>
        <div style={styles.summaryBox}>
          <div style={styles.smallCaps}>Iron Fly</div>
          <div style={styles.tradeText}>{fmt(recommendation.lowerWing)} / {fmt(recommendation.suggestedCenter)} / {fmt(recommendation.upperWing)}</div>
        </div>
      </div>

      <div style={styles.inputGrid}>
        {rows.map((row) => (
          <div key={row.key} style={styles.inputTile}>
            <div style={styles.tileTop}>
              <span style={styles.smallCaps}>{row.label}</span>
              <code style={styles.codeKey}>{row.key}</code>
            </div>
            <div style={styles.value}>{fmt(row.value)}</div>
            <div style={styles.note}>{row.note}</div>
          </div>
        ))}
      </div>

      <textarea readOnly value={thinkScriptBlock} style={styles.textarea} />

      <div style={styles.footerNote}>
        Use these on the SPX 1m or 5m chart. WheelDesk calculates the levels; TOS watches live candle/volume reaction at those levels.
      </div>
    </section>
  );
}

function formatSpread(side: "PUT" | "CALL", shortStrike: number | null, longStrike: number | null, credit: number | null, width: number | null) {
  if (!shortStrike || !longStrike) return "No clean candidate";
  const suffix = side === "PUT" ? "P" : "C";
  const creditText = credit != null ? ` | credit ${fmt(credit)}` : "";
  const widthText = width != null ? ` | width ${fmt(width)}` : "";
  return `Sell ${fmt(shortStrike)}${suffix} / Buy ${fmt(longStrike)}${suffix}${creditText}${widthText}`;
}

function tosNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "0.00";
  return Number(value).toFixed(2);
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: "1px solid rgba(34,211,238,0.42)",
    background: "linear-gradient(135deg, rgba(8,24,40,0.98), rgba(7,17,31,0.98))",
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    boxShadow: "0 0 0 1px rgba(34,211,238,0.08), 0 14px 40px rgba(0,0,0,0.25)",
  },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 },
  title: { margin: 0, fontSize: 21, fontWeight: 950, color: "#f8fafc" },
  subtitle: { margin: "6px 0 0", color: "#94a3b8", fontSize: 13, lineHeight: 1.45 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  primaryButton: { background: "#0e7490", color: "white", border: "1px solid #22d3ee", borderRadius: 10, padding: "10px 14px", fontWeight: 900, cursor: "pointer" },
  secondaryButton: { background: "#0f2235", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.45)", borderRadius: 10, padding: "10px 14px", fontWeight: 900, cursor: "pointer" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 12 },
  summaryBox: { border: "1px solid #1e3a5f", background: "#06111f", borderRadius: 14, padding: 12 },
  smallCaps: { color: "#93b5d9", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" },
  tradeText: { marginTop: 6, color: "#e2e8f0", fontSize: 14, fontWeight: 800, lineHeight: 1.35 },
  inputGrid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12 },
  inputTile: { border: "1px solid #1e3a5f", background: "#0b1b2b", borderRadius: 14, padding: 12, minHeight: 118 },
  tileTop: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" },
  codeKey: { color: "#67e8f9", fontSize: 11, background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.22)", padding: "2px 5px", borderRadius: 6 },
  value: { marginTop: 8, color: "#f8fafc", fontSize: 27, fontWeight: 950 },
  note: { marginTop: 6, color: "#94a3b8", fontSize: 12, lineHeight: 1.35 },
  textarea: { width: "100%", minHeight: 164, boxSizing: "border-box", borderRadius: 14, border: "1px solid #1e3a5f", background: "#030712", color: "#dbeafe", padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, lineHeight: 1.45, resize: "vertical" },
  footerNote: { marginTop: 10, color: "#94a3b8", fontSize: 12, lineHeight: 1.4 },
};
