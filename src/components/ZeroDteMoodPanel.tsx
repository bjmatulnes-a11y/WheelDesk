"use client";

import type { ZeroDteMoodRead } from "../lib/zeroDteMoodEngine";

export function ZeroDteMoodPanel({ mood }: { mood: ZeroDteMoodRead | null | undefined }) {
  if (!mood) return null;
  const leadership = mood.leadership;
  const breadth = mood.breadth;
  const activeComponents = mood.components.filter((component) => component.available);

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Layer 6D.4 · SPX Mood + Leadership</div>
          <h2 style={styles.title}>Closed-Minute SPX Mood Engine</h2>
          <div style={styles.muted}>
            Daily session-frozen leadership weights, Schwab constituent returns, Schwab-native S&P breadth, EMA smoothing, and divergence.
          </div>
        </div>
        <div style={{ ...styles.badge, color: moodTone(mood.moodPercent) }}>
          {mood.moodPercent == null ? "—" : `${mood.moodPercent.toFixed(1)}%`}
        </div>
      </div>

      <div style={styles.metrics}>
        <Metric label="Bias" value={mood.tradeBias.replaceAll("-", " ")} />
        <Metric label="Calculation" value={mood.calculationMode.replaceAll("_", " ")} />
        <Metric label="Coverage" value={mood.coverage.status} />
        <Metric label="Confidence" value={`${mood.confidence}%`} />
        <Metric label="Divergence" value={divergenceLabel(mood.internalDivergence)} tone={mood.internalDivergence === "NONE" ? undefined : "#fde047"} />
        <Metric label="Source" value={mood.source.replaceAll("-", " ")} />
      </div>

      <div style={styles.twoColumns}>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Leadership Basket</div>
          {leadership ? (
            <>
              <div style={styles.statGrid}>
                <SmallStat label="Weight source" value={leadership.weightSource.replaceAll("_", " ")} />
                <SmallStat label="As of" value={leadership.asOfDate ?? "—"} />
                <SmallStat label="Selected" value={`${leadership.availableCount}/${leadership.selectedCount}`} />
                <SmallStat label="Quote coverage" value={`${leadership.quoteCoveragePct.toFixed(0)}%`} />
                <SmallStat label="Leader return" value={percent(leadership.weightedReturnPct)} />
                <SmallStat label="Pull vs SPX" value={percent(leadership.pullVsIndexPct)} />
              </div>
              <div style={styles.rows}>
                {leadership.constituents.slice(0, 12).map((item) => (
                  <div key={`${item.symbol}-${item.rank}`} style={styles.row}>
                    <strong>{item.symbol}</strong>
                    <span>{item.weightPct.toFixed(2)}%</span>
                    <span style={{ color: signedTone(item.percentChange) }}>
                      {percent(item.percentChange)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={styles.muted}>Leadership basket is unavailable.</div>
          )}
        </div>

        <div style={styles.panel}>
          <div style={styles.panelTitle}>Breadth + Mood Components</div>
          <div style={styles.statGrid}>
            <SmallStat label="Breadth source" value={breadth?.source.replaceAll("_", " ") ?? "UNAVAILABLE"} />
            <SmallStat
              label="Universe quotes"
              value={
                breadth?.quotedCount != null && breadth?.universeCount != null
                  ? `${breadth.quotedCount}/${breadth.universeCount}`
                  : "—"
              }
            />
            <SmallStat
              label="Quote coverage"
              value={breadth?.quoteCoveragePct == null ? "—" : `${breadth.quoteCoveragePct.toFixed(0)}%`}
            />
            <SmallStat label="TICK proxy" value={number(breadth?.tick)} />
            <SmallStat
              label="TICK coverage"
              value={breadth?.tickCoveragePct == null ? "—" : `${breadth.tickCoveragePct.toFixed(0)}%`}
            />
            <SmallStat label="UVOL/DVOL" value={number(breadth?.uvolDvolRatio, 2)} />
            <SmallStat label="A-D" value={number(breadth?.advanceDecline)} />
            <SmallStat
              label="Adv / Dec"
              value={
                breadth?.advances != null && breadth?.declines != null
                  ? `${breadth.advances} / ${breadth.declines}`
                  : "—"
              }
            />
            <SmallStat
              label="Volume coverage"
              value={breadth?.volumeCoveragePct == null ? "—" : `${breadth.volumeCoveragePct.toFixed(0)}%`}
            />
          </div>
          <div style={styles.componentGrid}>
            {activeComponents.map((component) => (
              <div key={component.name} style={styles.component}>
                <span>{component.name}</span>
                <strong style={{ color: signedTone(component.contribution) }}>
                  {component.contribution == null ? "—" : component.contribution.toFixed(2)}
                </strong>
              </div>
            ))}
          </div>
          <div style={styles.note}>
            {mood.calculationMode === "FAST_OPEN"
              ? "Fast-open mode uses SPX change, leadership pull, the Schwab S&P TICK proxy, UVOL/DVOL, and advance-decline. Normal mode begins after five completed one-minute samples."
              : "Normal mode includes component trends and the WheelDesk market-stage adaptation. Mood is smoothed with EMA-3. The Schwab TICK value is a constituent one-minute direction proxy, not the proprietary $TIKSP feed."}
          </div>
        </div>
      </div>

      {[...(mood.information ?? []), ...(leadership?.warnings ?? []), ...(breadth?.warnings ?? [])].length ? (
        <div style={styles.info}>
          {[...(mood.information ?? []), ...(leadership?.warnings ?? []), ...(breadth?.warnings ?? [])]
            .filter((value, index, array) => array.indexOf(value) === index)
            .map((line) => <div key={line}>• {line}</div>)}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div style={styles.metric}><span>{label}</span><strong style={{ color: tone ?? "#f8fafc" }}>{value}</strong></div>;
}
function SmallStat({ label, value }: { label: string; value: string }) {
  return <div style={styles.smallStat}><span>{label}</span><strong>{value}</strong></div>;
}
function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function number(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}
function signedTone(value: number | null | undefined) {
  if (value == null || Math.abs(value) < 0.0001) return "#94a3b8";
  return value > 0 ? "#34d399" : "#fb7185";
}
function moodTone(value: number | null | undefined) {
  if (value == null) return "#94a3b8";
  if (value >= 40) return "#34d399";
  if (value <= -40) return "#fb7185";
  return "#fde047";
}
function divergenceLabel(value: ZeroDteMoodRead["internalDivergence"]) {
  if (value === "PRICE_UP_MOOD_DOWN") return "PRICE ↑ / MOOD ↓";
  if (value === "PRICE_DOWN_MOOD_UP") return "PRICE ↓ / MOOD ↑";
  return "NONE";
}

const styles: Record<string, React.CSSProperties> = {
  card: { marginTop: 16, border: "1px solid #17324a", borderRadius: 16, padding: 16, background: "#06131f", color: "#f8fafc" },
  header: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  eyebrow: { color: "#22d3ee", fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: "4px 0", fontSize: 20 },
  muted: { color: "#8da4b8", fontSize: 11 },
  badge: { border: "1px solid currentColor", borderRadius: 999, padding: "8px 14px", fontSize: 22, fontWeight: 900 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8, marginTop: 14 },
  metric: { border: "1px solid #17324a", borderRadius: 10, padding: 10, display: "grid", gap: 4, color: "#7890a5", fontSize: 9, textTransform: "uppercase" },
  twoColumns: { display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 12, marginTop: 12 },
  panel: { border: "1px solid #17324a", borderRadius: 12, padding: 12, minWidth: 0 },
  panelTitle: { fontWeight: 900, marginBottom: 9 },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 7 },
  smallStat: { border: "1px solid #132a3d", borderRadius: 8, padding: 8, display: "grid", gap: 3, color: "#7890a5", fontSize: 9 },
  rows: { display: "grid", gap: 2, marginTop: 9 },
  row: { display: "grid", gridTemplateColumns: "1fr 72px 72px", gap: 8, borderTop: "1px solid #132a3d", padding: "5px 2px", fontSize: 10 },
  componentGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 5, marginTop: 9 },
  component: { display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid #132a3d", paddingTop: 5, color: "#8da4b8", fontSize: 10 },
  note: { marginTop: 10, color: "#8da4b8", fontSize: 10, lineHeight: 1.5 },
  info: { marginTop: 10, border: "1px solid #23445e", borderRadius: 10, padding: 10, color: "#9db3c5", fontSize: 10, lineHeight: 1.55 },
};
