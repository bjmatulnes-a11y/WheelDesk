import { PrevailingLevels } from "../lib/oi-prevailing-levels";

type Props = {
  levels: PrevailingLevels | null;
  currentPrice: number;
};

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function distancePct(level?: number | null, currentPrice?: number | null): number | null {
  if (level == null || currentPrice == null || !currentPrice) return null;
  return (level - currentPrice) / currentPrice;
}

function activeZone(levels: PrevailingLevels | null, currentPrice: number): string {
  if (!levels || !currentPrice) return "Unknown";

  const support = levels.support?.strike;
  const resistance = levels.resistance?.strike;
  const magnet = levels.magnet?.strike;

  if (support != null && currentPrice < support) return "Below primary support";
  if (resistance != null && currentPrice > resistance) return "Above primary resistance";

  if (magnet != null) {
    const nearMagnet = Math.abs(currentPrice - magnet) / currentPrice <= 0.01;
    if (nearMagnet) return "At OI magnet / pin zone";

    if (support != null && currentPrice >= support && currentPrice < magnet) {
      return "Between support and magnet";
    }

    if (resistance != null && currentPrice > magnet && currentPrice <= resistance) {
      return "Between magnet and resistance";
    }
  }

  if (support != null && resistance != null && currentPrice >= support && currentPrice <= resistance) {
    return "Inside primary range";
  }

  return "Structure unclear";
}

function qualityLabel(levels: PrevailingLevels | null, currentPrice: number): string {
  if (!levels || !levels.quality?.valid) return "Low";

  let score = 0;

  if (levels.supports?.length >= 2) score += 1;
  if (levels.resistances?.length >= 2) score += 1;

  const supportDist = Math.abs(distancePct(levels.support?.strike, currentPrice) ?? 999);
  const resistanceDist = Math.abs(distancePct(levels.resistance?.strike, currentPrice) ?? 999);
  const magnetDist = Math.abs(distancePct(levels.magnet?.strike, currentPrice) ?? 999);

  if (supportDist <= 0.15) score += 1;
  if (resistanceDist <= 0.15) score += 1;
  if (magnetDist <= 0.15) score += 1;

  if (levels.quality.notes.length === 0) score += 1;

  if (score >= 5) return "High";
  if (score >= 3) return "Medium";
  return "Low";
}

function interpretation(levels: PrevailingLevels | null, currentPrice: number): string {
  if (!levels) return "No prevailing structure available.";

  const zone = activeZone(levels, currentPrice);
  const magnetDist = distancePct(levels.magnet?.strike, currentPrice);

  if (zone === "Below primary support") {
    return "Price is below the primary support ladder. Avoid aggressive put selling until price reclaims support.";
  }

  if (zone === "Above primary resistance") {
    return "Price is above primary resistance. Avoid selling calls too close until breakout strength fades.";
  }

  if (zone === "Between support and magnet") {
    return "Price is below the OI magnet but above support. The structure suggests possible recovery pressure, but support must hold.";
  }

  if (zone === "Between magnet and resistance") {
    return "Price is above the OI magnet and below resistance. Upside may continue toward resistance, but the next cap is approaching.";
  }

  if (zone === "At OI magnet / pin zone") {
    return "Price is near the OI magnet. This can favor pin/range behavior unless volume or price breaks the structure.";
  }

  if (magnetDist != null && magnetDist > 0.1) {
    return "The magnet is meaningfully above spot. Treat it as directional context, not a guaranteed target.";
  }

  return "Price is inside the primary structure range. Watch support/resistance reactions for confirmation.";
}

export function StructureQualityCard({ levels, currentPrice }: Props) {
  if (!levels) return null;

  const q = qualityLabel(levels, currentPrice);
  const zone = activeZone(levels, currentPrice);

  const supportDist = distancePct(levels.support?.strike, currentPrice);
  const resistanceDist = distancePct(levels.resistance?.strike, currentPrice);
  const magnetDist = distancePct(levels.magnet?.strike, currentPrice);

  return (
    <section
      style={{
        border: "1px solid #1f2937",
        borderRadius: 8,
        background: "#fff",
        padding: "1rem"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Structure Quality & Active Zone</h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,minmax(0,1fr))",
          gap: "0.75rem",
          marginBottom: "0.75rem"
        }}
      >
        <div>
          <strong>Quality</strong>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{q}</div>
        </div>

        <div>
          <strong>Active Zone</strong>
          <div>{zone}</div>
        </div>

        <div>
          <strong>Spot</strong>
          <div>{fmt(currentPrice)}</div>
        </div>

        <div>
          <strong>Magnet Distance</strong>
          <div>{pct(magnetDist)}</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: "0.75rem",
          marginBottom: "0.75rem"
        }}
      >
        <div>
          <strong>Support Distance</strong>
          <div>{pct(supportDist)}</div>
        </div>

        <div>
          <strong>Resistance Distance</strong>
          <div>{pct(resistanceDist)}</div>
        </div>

        <div>
          <strong>Structure Counts</strong>
          <div>
            {levels.quality.supportCount} support / {levels.quality.resistanceCount} resistance
          </div>
        </div>
      </div>

      <p style={{ marginBottom: 0 }}>
        <strong>Readout:</strong> {interpretation(levels, currentPrice)}
      </p>

      {levels.quality.notes.length > 0 && (
        <div style={{ marginTop: "0.75rem", color: "#92400e", fontSize: 13 }}>
          <strong>Quality Notes</strong>
          <ul style={{ marginBottom: 0 }}>
            {levels.quality.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}