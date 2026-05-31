"use client";

import { type OIChangeItem, type OIChangeRead } from "../../lib/oi-change-read-engine";
import { colors, cardStyle } from "./styles";

type Props = {
  read: OIChangeRead | null;
};

function fmtDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value).toLocaleString()}`;
}

function fmtMoney(value: number): string {
  if (!Number.isFinite(value)) return "N/A";
  return value < 20 ? value.toFixed(2).replace(/\.00$/, "") : value.toFixed(2).replace(/\.00$/, "");
}

function ChangeList({ title, items, tone }: { title: string; items: OIChangeItem[]; tone: string }) {
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        background: "rgba(15, 23, 42, 0.42)",
        borderRadius: 12,
        padding: "0.7rem",
        minHeight: 112,
      }}
    >
      <div style={{ color: tone, fontSize: 11, fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title}
      </div>
      {!items.length ? (
        <div style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>No material ranked change.</div>
      ) : (
        <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
          {items.slice(0, 3).map((item) => (
            <div key={`${item.side}-${item.direction}-${item.expiration}-${item.strike}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
              <span style={{ color: colors.text }}>
                {fmtMoney(item.strike)} <span style={{ color: colors.muted }}>/{item.expiration.slice(5)}</span>
              </span>
              <span style={{ color: item.delta > 0 ? colors.green : colors.red, fontWeight: 950 }}>
                {fmtDelta(item.delta)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionRow({ label, value, tone = colors.text }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ color: tone, fontSize: 11, fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ color: colors.muted, fontSize: 12, lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

export default function OIWhatChangedCard({ read }: Props) {
  const statusColor = read?.ok ? colors.teal : colors.amber;

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: colors.teal }}>What Changed ΔOI</h3>
          <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            Prior surface vs current surface · lean read for the next wheel decision.
          </div>
        </div>
        <div style={{ color: colors.muted, fontSize: 12, textAlign: "right" }}>
          Scope <strong style={{ color: colors.text }}>{read?.scopeLabel ?? "N/A"}</strong>
          {read?.priorSnapshotDate ? (
            <>
              <br />
              {read.priorSnapshotDate} → {read.currentSnapshotDate}
            </>
          ) : null}
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${colors.border}`,
          background: "rgba(8, 17, 29, 0.68)",
          borderRadius: 14,
          padding: "0.85rem",
          marginTop: "0.9rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: statusColor, fontSize: 12, fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {read?.ok ? "Positioning read" : "Waiting for prior snapshot"}
            </div>
            <div style={{ color: colors.text, fontSize: 18, fontWeight: 950, marginTop: 4 }}>
              {read?.headline ?? "No ΔOI read available"}
            </div>
          </div>
          <div style={{ color: colors.muted, fontSize: 11, minWidth: 150, textAlign: "right" }}>
            Chains compared: <strong style={{ color: colors.text }}>{read?.comparedChainCount ?? 0}</strong>
            <br />
            Max DTE: <strong style={{ color: colors.text }}>{read?.maxDte ?? 30}</strong>
          </div>
        </div>
        <p style={{ color: colors.muted, fontSize: 12, lineHeight: 1.55, margin: "0.7rem 0 0" }}>
          {read?.summary ?? "Save a second OI surface for this ticker to enable day-over-day positioning change."}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
          gap: "0.75rem",
          marginTop: "0.85rem",
        }}
      >
        <ChangeList title="Call builds" items={read?.topCallIncreases ?? []} tone={colors.green} />
        <ChangeList title="Call thins" items={read?.topCallDecreases ?? []} tone={colors.red} />
        <ChangeList title="Put builds" items={read?.topPutIncreases ?? []} tone={colors.green} />
        <ChangeList title="Put thins" items={read?.topPutDecreases ?? []} tone={colors.red} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
          gap: "0.9rem",
          marginTop: "0.95rem",
          borderTop: `1px solid ${colors.border}`,
          paddingTop: "0.9rem",
        }}
      >
        <DecisionRow label="Forecast impact" value={read?.forecastImpact ?? "No ΔOI adjustment available."} tone={colors.amber} />
        <DecisionRow label="CSP use" value={read?.tradeUse.csp ?? "No prior-surface confirmation available."} tone={colors.green} />
        <DecisionRow label="Covered call use" value={read?.tradeUse.coveredCall ?? "No prior-surface confirmation available."} tone={colors.teal} />
        <DecisionRow label="Long call use" value={read?.tradeUse.longCall ?? "No prior-surface confirmation available."} tone={colors.violet} />
      </div>

      {read?.notes?.length ? (
        <div style={{ marginTop: "0.85rem", color: colors.muted, fontSize: 11, lineHeight: 1.5 }}>
          {read.notes.map((note) => (
            <div key={note}>• {note}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
