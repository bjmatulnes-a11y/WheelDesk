import { type IVSurfaceSummary } from "../../lib/iv-surface-engine";
import { colors, cardStyle } from "./styles";

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function movePct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function labelize(value?: string | null): string {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function toneForRegime(regime?: string | null): string {
  if (regime === "event-loaded") return colors.red;
  if (regime === "elevated") return colors.amber;
  if (regime === "compressed") return colors.teal;
  return colors.green;
}

function toneForSkew(skew?: string | null): string {
  if (skew === "bearish") return colors.red;
  if (skew === "bullish") return colors.green;
  if (skew === "neutral") return colors.teal;
  return colors.muted;
}

function volPts(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)} vol pts`;
}

function opacityForIv(iv: number | null): number {
  if (iv == null) return 0.08;
  return Math.max(0.16, Math.min(0.8, iv / 0.58));
}

function TinyMetric({ label, value, tone = colors.text }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{
      border: "1px solid rgba(148, 163, 184, 0.16)",
      borderRadius: 10,
      padding: "0.5rem 0.55rem",
      background: "rgba(15, 23, 42, 0.42)",
      minWidth: 0
    }}>
      <div style={{ color: colors.muted, fontSize: 9.5, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ color: tone, fontSize: 14, fontWeight: 950, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

export default function IVSurfaceCard({ summary }: { summary: IVSurfaceSummary | null }) {
  if (!summary) {
    return (
      <section style={{ ...cardStyle, padding: "0.85rem" }}>
        <h3 style={{ margin: 0, color: colors.teal, fontSize: 15 }}>IV Surface / Vol Regime</h3>
        <p style={{ margin: "0.4rem 0 0", color: colors.muted, fontSize: 12 }}>No IV surface available for this saved option surface.</p>
      </section>
    );
  }

  const h = summary.horizonDays ?? 14;
  const em = summary.expectedMove;
  const regimeTone = toneForRegime(summary.volRegime);
  const skewTone = toneForSkew(summary.skewBias);
  const matchedRow = summary.heatmap?.reduce((best, row) => {
    if (!best) return row;
    return Math.abs(row.dte - h) < Math.abs(best.dte - h) ? row : best;
  }, null as any);

  const bandWidth = em ? Math.max(2, em.upperOneSigma - em.lowerOneSigma) : 0;
  const rangeText = em ? `${money(em.lowerOneSigma)}–${money(em.upperOneSigma)}` : "N/A";
  const moveText = em ? `±${money(em.oneSigma)} / ${movePct(em.expectedMovePct)}` : "N/A";

  return (
    <section style={{ ...cardStyle, padding: "0.8rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.65rem" }}>
        <div>
          <div style={{ color: colors.teal, fontWeight: 950, fontSize: 15 }}>IV Surface / Vol Regime</div>
          <div style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>Matched to {h}D OI depth</div>
        </div>
        <div style={{ color: regimeTone, fontWeight: 950, fontSize: 12, textAlign: "right" }}>{labelize(summary.volRegime)}</div>
      </div>

      <div style={{ marginTop: "0.7rem", border: "1px solid rgba(34, 211, 238, 0.26)", borderRadius: 12, background: "rgba(34, 211, 238, 0.055)", padding: "0.65rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "baseline" }}>
          <div>
            <div style={{ color: colors.muted, fontSize: 10 }}>14D IV range on chart</div>
            <div style={{ color: colors.text, fontSize: 17, fontWeight: 950, marginTop: 2 }}>{rangeText}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: colors.muted, fontSize: 10 }}>1σ move</div>
            <div style={{ color: colors.teal, fontSize: 16, fontWeight: 950, marginTop: 2 }}>{moveText}</div>
          </div>
        </div>
        <div style={{ marginTop: "0.55rem", height: 7, borderRadius: 999, background: "rgba(148, 163, 184, 0.16)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: "100%", background: "linear-gradient(90deg, rgba(34,211,238,0.15), rgba(34,211,238,0.75), rgba(34,211,238,0.15))" }} />
        </div>
        <div style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>Band width: {money(bandWidth)} pts</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.5rem", marginTop: "0.65rem" }}>
        <TinyMetric label={`${h}D ATM IV`} value={pct(summary.atmIv)} />
        <TinyMetric label={`Skew @ ${h}D`} value={labelize(summary.skewBias)} tone={skewTone} />
        <TinyMetric label="Upper wing IV" value={pct(summary.callWingIv)} tone={colors.green} />
        <TinyMetric label="Lower wing IV" value={pct(summary.putWingIv)} tone={colors.red} />
      </div>

      <div style={{ marginTop: "0.55rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        <TinyMetric label="Term spread" value={volPts(summary.frontBackSpread)} tone={summary.frontBackSpread && summary.frontBackSpread > 0.02 ? colors.amber : colors.muted} />
        <TinyMetric label="Model effect" value={summary.confidenceAdjustment >= 0 ? `+${summary.confidenceAdjustment}` : String(summary.confidenceAdjustment)} tone={summary.confidenceAdjustment >= 0 ? colors.green : colors.amber} />
      </div>

      <div style={{ marginTop: "0.65rem", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: 10, padding: "0.55rem", background: "rgba(2, 6, 23, 0.22)" }}>
        <div style={{ color: colors.text, fontSize: 11, fontWeight: 900, marginBottom: 3 }}>Chart Translation</div>
        <div style={{ color: colors.muted, fontSize: 10.5, lineHeight: 1.38 }}>
          Cyan band = <b style={{ color: colors.teal }}>{h}D priced move</b>. OI targets inside the band are normal-range moves; targets outside require an above-expected move.
        </div>
      </div>

      {summary.heatmap?.length ? (
        <details style={{ marginTop: "0.55rem" }}>
          <summary style={{ cursor: "pointer", color: colors.teal, fontSize: 11.5, fontWeight: 900 }}>
            Show IV surface grid {matchedRow ? `(${matchedRow.dte}D matched)` : ""}
          </summary>
          <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "45px repeat(5, minmax(34px, 1fr))", gap: 4, alignItems: "center", minWidth: 250 }}>
              <div />
              {summary.heatmap[0]?.cells.map((cell) => (
                <div key={cell.label} style={{ color: colors.muted, fontSize: 9, textAlign: "center" }}>{cell.label}</div>
              ))}
              {summary.heatmap.slice(0, 6).map((row) => {
                const isMatched = matchedRow?.expiration === row.expiration;
                return (
                  <div key={row.expiration} style={{ display: "contents" }}>
                    <div style={{ color: isMatched ? colors.teal : colors.muted, fontSize: 9.5, fontWeight: isMatched ? 950 : 700 }}>{row.dte}D{isMatched ? " •" : ""}</div>
                    {row.cells.map((cell) => (
                      <div
                        key={`${row.expiration}-${cell.label}`}
                        title={`${row.expiration} ${cell.label}: ${pct(cell.iv)}`}
                        style={{
                          height: 18,
                          borderRadius: 5,
                          border: `1px solid rgba(34, 211, 238, ${isMatched ? 0.9 : opacityForIv(cell.iv)})`,
                          background: `rgba(34, 211, 238, ${isMatched ? 0.24 : opacityForIv(cell.iv) * 0.26})`,
                          color: colors.text,
                          fontSize: 8.5,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: isMatched ? 900 : 700
                        }}
                      >
                        {cell.iv == null ? "—" : `${(cell.iv * 100).toFixed(0)}`}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}
