import { type ControlSignalSummary } from "../../lib/control-signal-engine";
import { colors, cardStyle } from "./styles";

function signalTone(signal?: ControlSignalSummary | null): string {
  if (!signal || signal.signalType === "NO_EDGE") return colors.muted;
  if (signal.signalType === "TOP_RISK" || signal.signalType === "SELL_BREAKDOWN") return colors.red;
  if (signal.signalType === "BOTTOM_RISK" || signal.signalType === "BUY_BREAKOUT") return colors.green;
  if (signal.signalType === "PIN_CONFLUENCE") return colors.amber;
  return colors.muted;
}

function strengthLabel(score: number) {
  if (score >= 82) return "Strong";
  if (score >= 70) return "Active";
  if (score >= 58) return "Watch";
  return "No Edge";
}

export default function ControlSignalCard({ signal }: { signal: ControlSignalSummary | null }) {
  if (!signal || signal.signalType === "NO_EDGE") {
    return (
      <section style={{ ...cardStyle, padding: "1rem" }}>
        <div style={{ color: colors.teal, fontWeight: 900, fontSize: 16 }}>Control Signals</div>
        <p style={{ color: colors.muted, marginBottom: 0 }}>No stacked top/bottom/breakout signal is active.</p>
      </section>
    );
  }

  const tone = signalTone(signal);
  const borderColor = (colors as any).border ?? "rgba(148, 163, 184, 0.18)";
  const activeFactors = signal.factors.filter((factor) => factor.active);

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: colors.teal, fontWeight: 900, fontSize: 16 }}>Control Signals</div>
          <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Gated stacked confluence</div>
        </div>
        <div style={{ color: tone, border: `1px solid ${tone}`, borderRadius: 10, padding: "0.3rem 0.55rem", fontWeight: 900, fontSize: 13 }}>
          {signal.shortLabel}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.75rem", alignItems: "center", marginTop: "0.85rem" }}>
        <div>
          <div style={{ color: tone, fontSize: 18, fontWeight: 950 }}>{signal.label}</div>
          <div style={{ color: colors.muted, fontSize: 12 }}>{strengthLabel(signal.score)} · {signal.bias.toUpperCase()} bias</div>
        </div>
        <div style={{ color: tone, fontSize: 28, fontWeight: 950 }}>{signal.score}<span style={{ color: colors.muted, fontSize: 14 }}>/100</span></div>
      </div>

      <div style={{ height: 8, borderRadius: 999, background: "rgba(148, 163, 184, 0.14)", overflow: "hidden", marginTop: "0.65rem" }}>
        <div style={{ width: `${Math.min(100, Math.max(0, signal.score))}%`, height: "100%", background: tone }} />
      </div>

      <div style={{ marginTop: "0.85rem", padding: "0.7rem", border: `1px solid ${borderColor}`, borderRadius: 12, background: "rgba(15, 23, 42, 0.42)" }}>
        <div style={{ color: colors.text, fontWeight: 900, fontSize: 12 }}>Action Read</div>
        <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{signal.action}</div>
        <div style={{ color: colors.amber, fontSize: 12, marginTop: 6 }}>Invalidates on: {signal.invalidation}</div>
      </div>

      <div style={{ marginTop: "0.85rem" }}>
        <div style={{ color: colors.text, fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Confluence Stack</div>
        <div style={{ display: "grid", gap: 6 }}>
          {signal.factors.slice(0, 8).map((factor, index) => (
            <div key={`${factor.label}-${index}`} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto", alignItems: "center", gap: 8, color: factor.active ? colors.text : colors.muted, fontSize: 12 }}>
              <span style={{ color: factor.active ? tone : colors.muted }}>{factor.active ? "●" : "○"}</span>
              <span>{factor.label}</span>
              <span style={{ color: factor.active ? tone : colors.muted, fontWeight: 900 }}>{factor.points}/{factor.maxPoints}</span>
            </div>
          ))}
        </div>
      </div>

      {activeFactors.length ? (
        <div style={{ color: colors.green, fontSize: 12, marginTop: "0.75rem" }}>{activeFactors.length} factors aligned.</div>
      ) : null}
    </section>
  );
}
