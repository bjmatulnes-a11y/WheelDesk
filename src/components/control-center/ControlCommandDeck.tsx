"use client";

import type { ControlCenterState, ControlScoreTile } from "../../lib/control-state-engine";
import { colors, cardStyle } from "./styles";

function fmt(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? "N/A" : value.toFixed(2);
}

function tileColor(tile: ControlScoreTile): string {
  if (tile.warning || tile.bias === "warning") return colors.amber;
  if (tile.bias === "bullish") return colors.green;
  if (tile.bias === "bearish") return colors.red;
  if (tile.bias === "pin") return colors.teal;
  if (tile.bias === "two-way") return "#c084fc";
  return colors.text;
}

function scoreBackground(tile: ControlScoreTile): string {
  if (tile.warning || tile.bias === "warning") return "rgba(245, 158, 11, 0.08)";
  if (tile.bias === "bullish") return "rgba(34, 197, 94, 0.08)";
  if (tile.bias === "bearish") return "rgba(251, 113, 133, 0.08)";
  if (tile.bias === "pin") return "rgba(34, 211, 238, 0.08)";
  return "rgba(7, 21, 35, 0.7)";
}

function ScoreTile({ tile }: { tile: ControlScoreTile }) {
  return (
    <div
      style={{
        border: "1px solid #20384d",
        background: scoreBackground(tile),
        borderRadius: 12,
        padding: "0.75rem",
        minHeight: 92,
      }}
    >
      <div style={{ color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {tile.label}
      </div>
      <div style={{ color: tileColor(tile), fontSize: 28, fontWeight: 950, lineHeight: 1.05, marginTop: 8 }}>
        {Math.round(tile.score)}
      </div>
      <div style={{ color: colors.text, fontSize: 12, fontWeight: 800, marginTop: 6 }}>{tile.status}</div>
      {tile.detail ? (
        <div style={{ color: colors.muted, fontSize: 11, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {tile.detail}
        </div>
      ) : null}
    </div>
  );
}

export default function ControlCommandDeck({ state }: { state: ControlCenterState }) {
  return (
    <section style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
      <div
        style={{
          ...cardStyle,
          padding: "1rem",
          display: "grid",
          gridTemplateColumns: "1.15fr 0.85fr 1.4fr",
          gap: "1rem",
          alignItems: "stretch",
        }}
      >
        <div>
          <div style={{ color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Control State
          </div>
          <div style={{ color: colors.text, fontSize: 28, fontWeight: 950, marginTop: 6, letterSpacing: "-0.04em" }}>
            {state.stateLabel}
          </div>
          <div style={{ color: colors.muted, marginTop: 8, lineHeight: 1.4, fontSize: 13 }}>
            Bias: <strong style={{ color: colors.teal }}>{state.bias.toUpperCase()}</strong> · Confidence:{" "}
            <strong style={{ color: colors.green }}>{Math.round(state.confidence)} / 100</strong>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #20384d",
            background: "rgba(7, 21, 35, 0.75)",
            borderRadius: 12,
            padding: "0.85rem",
          }}
        >
          <div style={{ color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Primary Action
          </div>
          <div style={{ color: colors.amber, fontSize: 24, fontWeight: 950, marginTop: 8 }}>
            {state.actionLabel}
          </div>
          {state.warnings.length ? (
            <div style={{ color: colors.amber, fontSize: 12, marginTop: 8 }}>
              {state.warnings[0]}
            </div>
          ) : (
            <div style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
              No critical portfolio warnings detected.
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "0.55rem" }}>
          <MiniLevel label="Support" value={state.keyLevels.support} tone={colors.red} />
          <MiniLevel label="Magnet" value={state.keyLevels.magnet} tone={colors.amber} />
          <MiniLevel label="Resistance" value={state.keyLevels.resistance} tone={colors.green} />
          <MiniLevel label="Bull Unlock" value={state.keyLevels.bullishTrigger} tone={colors.green} />
          <MiniLevel label="Bear Fail" value={state.keyLevels.bearishFailure} tone={colors.red} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.75rem" }}>
        {state.scoreTiles.map((tile) => (
          <ScoreTile key={tile.key} tile={tile} />
        ))}
      </div>

      <div style={{ ...cardStyle, padding: "0.85rem 1rem" }}>
        <div style={{ color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>
          Why this state?
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.15rem", color: colors.muted, lineHeight: 1.45, fontSize: 13 }}>
          {state.explanationBullets.slice(0, 5).map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function MiniLevel({ label, value, tone }: { label: string; value?: number | null; tone: string }) {
  return (
    <div
      style={{
        border: "1px solid #20384d",
        background: "rgba(7, 21, 35, 0.75)",
        borderRadius: 12,
        padding: "0.75rem",
      }}
    >
      <div style={{ color: colors.muted, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: tone, fontWeight: 950, fontSize: 18, marginTop: 8 }}>{fmt(value)}</div>
    </div>
  );
}
