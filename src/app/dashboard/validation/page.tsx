"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { yahooProvider } from "../../../lib/yahoo-provider";
import {
  migrateLegacyStorageToV2,
  readOptionSurfaceSnapshots,
  readCandles,
  saveCandles,
  clearCandles,
  getSavedCandleStats,
  saveEdgeProofSummaries,
  type EdgeProofSummary,
  type CandleRecord,
  type OptionSurfaceSnapshot,
  normalizeTicker,
  dateKey,
} from "../../../lib/wheeldesk-storage";
import {
  buildEdgeValidationRecords,
  buildEdgeProofSummaries,
  normalizeValidationCandles,
  summarizeEdgeValidation,
  type BucketProof,
  type EdgeValidationHorizon,
  type EdgeValidationRecord,
  type EdgeValidationSummary,
} from "../../../lib/edge-validation-engine";

function getTickers(snapshots: OptionSurfaceSnapshot[]): string[] {
  return Array.from(
    new Set(
      snapshots
        .map((snapshot) => normalizeTicker(snapshot.ticker))
        .filter(Boolean),
    ),
  ).sort();
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(digits);
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function rateText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function gradeLabel(grade: string): string {
  const map: Record<string, string> = {
    none: "No proof",
    early: "Early",
    developing: "Developing",
    tested: "Tested",
    proven: "Proven",
    institutional: "Institutional",
  };
  return map[grade] ?? grade;
}

function confidenceLabel(confidence: string): string {
  const map: Record<string, string> = {
    none: "None",
    very_low: "Very low",
    low: "Low",
    medium: "Medium",
    high: "High",
    strong: "Strong",
  };
  return map[confidence] ?? confidence;
}

function scoreColor(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "#6b7280";
  if (score >= 70) return "#15803d";
  if (score >= 55) return "#92400e";
  return "#b91c1c";
}

function bucketColor(bucket: string): string {
  if (bucket.includes("Best CSP")) return "#dcfce7";
  if (bucket.includes("covered-call")) return "#fef3c7";
  if (bucket.includes("Compression")) return "#ffedd5";
  if (bucket.includes("trap") || bucket.includes("avoid")) return "#fee2e2";
  if (bucket.includes("Conflict")) return "#ede9fe";
  return "#f8fafc";
}

function outcomeColor(value: boolean | null | undefined): string {
  if (value === true) return "#dcfce7";
  if (value === false) return "#fee2e2";
  return "#f3f4f6";
}

function Card({
  title,
  children,
  border = "#d1d5db",
}: {
  title: string;
  children: ReactNode;
  border?: string;
}) {
  return (
    <section
      style={{
        border: `1px solid ${border}`,
        borderRadius: 8,
        background: "#fff",
        padding: "1rem",
      }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "0.7rem",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "#4b5563" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900 }}>{value}</div>
      {note ? (
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}

function ProofRateCard({
  label,
  value,
  note,
  samples,
}: {
  label: string;
  value: number | null;
  note: string;
  samples?: number;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "0.75rem",
        background: "#f8fafc",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 900,
          color: scoreColor(value == null ? null : value * 100),
        }}
      >
        {rateText(value)}
      </div>
      <div style={{ fontSize: 12, color: "#4b5563" }}>{note}</div>
      {typeof samples === "number" ? (
        <div
          style={{
            fontSize: 12,
            color: samples === 0 ? "#92400e" : "#6b7280",
            marginTop: 4,
          }}
        >
          {samples === 0
            ? "No matured samples for this metric yet."
            : `Sample size: ${samples} matured setup${samples === 1 ? "" : "s"}`}
        </div>
      ) : null}
    </div>
  );
}

function ScannerLabelProof({
  bucketProof,
  proofSummaries,
}: {
  bucketProof: BucketProof[];
  proofSummaries: EdgeProofSummary[];
}) {
  const proofByLabel = new Map(
    proofSummaries.map((item) => [item.label, item]),
  );

  return (
    <Card title="Scanner Label Proof">
      <p style={{ marginTop: 0, color: "#4b5563" }}>
        This validates actual scanner labels from the shared edge engine. The
        raw rate shows observed follow-through. The adjusted rate is
        conservative and starts labels near neutral until sample size matures.
      </p>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
            <th style={{ padding: 6 }}>Label</th>
            <th style={{ padding: 6 }}>Total</th>
            <th style={{ padding: 6 }}>Evaluated</th>
            <th style={{ padding: 6 }}>Validated</th>
            <th style={{ padding: 6 }}>Observed</th>
            <th style={{ padding: 6 }}>Adjusted</th>
            <th style={{ padding: 6 }}>Proof Grade</th>
            <th style={{ padding: 6 }}>Primary Outcome</th>
          </tr>
        </thead>
        <tbody>
          {bucketProof.map((bucket) => {
            const proof = proofByLabel.get(bucket.bucket);
            return (
              <tr
                key={bucket.bucket}
                style={{ borderBottom: "1px solid #f3f4f6" }}
              >
                <td style={{ padding: 6 }}>
                  <span
                    style={{
                      display: "inline-block",
                      border: "1px solid #d1d5db",
                      borderRadius: 999,
                      padding: "0.2rem 0.55rem",
                      background: bucketColor(bucket.bucket),
                      fontWeight: 800,
                    }}
                  >
                    {bucket.bucket}
                  </span>
                </td>
                <td style={{ padding: 6 }}>{bucket.total}</td>
                <td style={{ padding: 6 }}>{bucket.evaluated}</td>
                <td style={{ padding: 6 }}>{bucket.validated}</td>
                <td style={{ padding: 6, fontWeight: 900 }}>
                  {rateText(bucket.validationRate)}
                </td>
                <td
                  style={{
                    padding: 6,
                    fontWeight: 900,
                    color: scoreColor(
                      proof?.adjustedRate == null
                        ? null
                        : proof.adjustedRate * 100,
                    ),
                  }}
                >
                  {rateText(proof?.adjustedRate)}
                </td>
                <td style={{ padding: 6 }}>
                  <strong>{gradeLabel(proof?.proofGrade ?? "none")}</strong>
                  <br />
                  <span style={{ color: "#6b7280" }}>
                    {confidenceLabel(proof?.confidence ?? "none")}
                  </span>
                </td>
                <td style={{ padding: 6, color: "#4b5563" }}>
                  {proof?.primaryOutcome ?? "N/A"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function ProofModeExplainer({
  records,
  horizon,
}: {
  records: EdgeValidationRecord[];
  horizon: EdgeValidationHorizon;
}) {
  const outcomes = records
    .map((record) =>
      record.horizons.find((item) => item.horizonDays === horizon),
    )
    .filter((outcome): outcome is NonNullable<typeof outcome> =>
      Boolean(outcome),
    );
  const strict = outcomes.filter(
    (outcome) => outcome.evaluated && !outcome.isPartialHorizon,
  ).length;
  const provisional = outcomes.filter(
    (outcome) => outcome.evaluated && outcome.isPartialHorizon,
  ).length;
  const waiting = Math.max(0, records.length - strict - provisional);

  return (
    <Card title="What This Page Is Doing" border="#2563eb">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: "1rem",
          alignItems: "start",
        }}
      >
        <div>
          <p style={{ marginTop: 0 }}>
            This page is not a same-day signal page. It is the{" "}
            <strong>proof journal</strong>. It takes saved OI surfaces from
            <code> wheeldesk_storage_v2 </code>, rebuilds the exact scanner edge
            that existed on that snapshot date, and then checks what price did
            afterward.
          </p>
          <p style={{ marginBottom: 0 }}>
            A surface saved today cannot be proven today. Weekend/non-trading
            saves are collapsed into the prior completed market session;
            weekday/intraday saves remain on their actual date and wait for the
            next completed candle. Until future candles exist, the setup is a
            logged record waiting to mature.
          </p>
        </div>
        <div
          style={{
            border: "1px solid #dbeafe",
            borderRadius: 8,
            background: "#eff6ff",
            padding: "0.75rem",
          }}
        >
          <strong>Proof lifecycle</strong>
          <ol style={{ marginBottom: 0, paddingLeft: "1.25rem" }}>
            <li>Save daily OI surface.</li>
            <li>
              WheelDesk stores the label, zones, walls, and pressure-map rails.
            </li>
            <li>Wait for the selected proof horizon.</li>
            <li>Validation scores whether the setup behaved as expected.</li>
          </ol>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: "0.75rem",
          marginTop: "0.75rem",
        }}
      >
        <Metric
          label="Strict / Matured"
          value={strict}
          note="Full selected horizon exists."
        />
        <Metric
          label="Provisional"
          value={provisional}
          note="Some future candles exist, but not the full horizon."
        />
        <Metric
          label="Waiting"
          value={waiting}
          note="No future candles yet. This is normal for recent snapshots."
        />
      </div>
    </Card>
  );
}

function LiveEdgeJournal({
  records,
  horizon,
}: {
  records: EdgeValidationRecord[];
  horizon: EdgeValidationHorizon;
}) {
  return (
    <Card title="Live Edge Journal">
      <p style={{ marginTop: 0, color: "#4b5563" }}>
        These are the saved setups currently waiting for proof. This is the
        audit trail that will become historical validation after future candles
        arrive.
      </p>
      {records.length === 0 ? (
        <p style={{ color: "#6b7280", marginBottom: 0 }}>
          No saved edge records for this ticker.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr
                style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}
              >
                <th style={{ padding: 6 }}>Market Session</th>
                <th style={{ padding: 6 }}>Saved Surface Dates</th>
                <th style={{ padding: 6 }}>Status</th>
                <th style={{ padding: 6 }}>Label</th>
                <th style={{ padding: 6 }}>Edge</th>
                <th style={{ padding: 6 }}>CSP Zone</th>
                <th style={{ padding: 6 }}>CC Zone</th>
                <th style={{ padding: 6 }}>Support / Resistance</th>
                <th style={{ padding: 6 }}>Outcome so far</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const outcome = record.horizons.find(
                  (item) => item.horizonDays === horizon,
                );
                const status = !outcome?.evaluated
                  ? "Waiting"
                  : outcome.isPartialHorizon
                    ? "Provisional"
                    : "Strict";
                const statusBg =
                  status === "Strict"
                    ? "#dcfce7"
                    : status === "Provisional"
                      ? "#fef3c7"
                      : "#f3f4f6";
                return (
                  <tr
                    key={record.id}
                    style={{ borderBottom: "1px solid #f3f4f6" }}
                  >
                    <td style={{ padding: 6, fontWeight: 800 }}>
                      {record.marketSessionDate ?? record.snapshotDate}
                    </td>
                    <td style={{ padding: 6, color: "#4b5563" }}>
                      {record.sourceSnapshotDates?.join(", ") ??
                        record.snapshotDate}
                    </td>
                    <td style={{ padding: 6 }}>
                      <span
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: 999,
                          padding: "0.15rem 0.5rem",
                          background: statusBg,
                          fontWeight: 800,
                        }}
                      >
                        {status}
                      </span>
                    </td>
                    <td style={{ padding: 6 }}>{record.edge.actionBucket}</td>
                    <td
                      style={{
                        padding: 6,
                        fontWeight: 900,
                        color: scoreColor(record.edge.edgeScore),
                      }}
                    >
                      {record.edge.edgeScore.toFixed(0)}
                    </td>
                    <td style={{ padding: 6, fontWeight: 800 }}>
                      {fmt(record.edge.executableCspCeiling)}
                    </td>
                    <td style={{ padding: 6, fontWeight: 800 }}>
                      {fmt(record.edge.executableCoveredCallFloor)}
                    </td>
                    <td style={{ padding: 6 }}>
                      {fmt(record.edge.support)} / {fmt(record.edge.resistance)}
                    </td>
                    <td style={{ padding: 6, color: "#4b5563" }}>
                      {outcome?.outcomeLabel ?? "No future candles yet"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ProofScoreSummary({
  proofSummaries,
}: {
  proofSummaries: EdgeProofSummary[];
}) {
  const all = proofSummaries.find((item) => item.label === "ALL");
  const best = proofSummaries
    .filter((item) => item.label !== "ALL" && item.evaluated > 0)
    .sort((a, b) => (b.adjustedRate ?? -1) - (a.adjustedRate ?? -1))[0];

  return (
    <Card title="Confidence-Adjusted Proof Score" border="#16a34a">
      <p style={{ marginTop: 0, color: "#4b5563" }}>
        Raw hit rates are exciting but noisy. The adjusted score uses a neutral
        prior so one win does not pretend to be 90–100% proof.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,minmax(0,1fr))",
          gap: "0.75rem",
        }}
      >
        <Metric
          label="Overall Observed"
          value={rateText(all?.rawRate)}
          note={`${all?.validated ?? 0} / ${all?.evaluated ?? 0} matured setups`}
        />
        <Metric
          label="Overall Adjusted"
          value={rateText(all?.adjustedRate)}
          note={`${gradeLabel(all?.proofGrade ?? "none")} proof · ${confidenceLabel(all?.confidence ?? "none")} confidence`}
        />
        <Metric
          label="Best Label So Far"
          value={best?.label ?? "N/A"}
          note={
            best
              ? `${rateText(best.adjustedRate)} adjusted · ${best.evaluated} sample${best.evaluated === 1 ? "" : "s"}`
              : "No matured label samples yet."
          }
        />
        <Metric
          label="Proof Status"
          value={gradeLabel(all?.proofGrade ?? "none")}
          note="Use as proof quality, not a promise for the next trade."
        />
      </div>
    </Card>
  );
}

function EdgeProofSummary({ summary }: { summary: EdgeValidationSummary }) {
  const hasMaturedProof = summary.evaluatedRecords > 0;

  return (
    <Card title="Matured Edge Proof" border="#7c3aed">
      <p style={{ marginTop: 0, color: "#4b5563" }}>
        This section only scores setups that have enough future candles for the
        selected proof horizon. If everything is recent, this section should say
        waiting instead of pretending there is proof.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5,minmax(0,1fr))",
          gap: "0.75rem",
        }}
      >
        <Metric label="Saved Records" value={summary.totalRecords} />
        <Metric label="Matured / Scored" value={summary.evaluatedRecords} />
        {!hasMaturedProof ? (
          <div
            style={{
              gridColumn: "span 2",
              border: "1px solid #fed7aa",
              borderRadius: 8,
              background: "#fff7ed",
              padding: "0.75rem",
            }}
          >
            <strong>No matured proof yet.</strong>
            <p style={{ marginBottom: 0 }}>
              This is not broken. The saved surfaces are live setups waiting for
              future candles. Once the selected horizon has elapsed, the proof
              rates below will populate.
            </p>
          </div>
        ) : null}
      </div>
      {hasMaturedProof ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5,minmax(0,1fr))",
            gap: "0.75rem",
            marginTop: "0.75rem",
          }}
        >
          <ProofRateCard
            label="CSP Zone Held"
            value={summary.cspZoneHoldRate}
            samples={summary.cspZoneHoldSamples}
            note="Suggested CSP ceiling stayed below realized lows."
          />
          <ProofRateCard
            label="CC Zone Held"
            value={summary.coveredCallZoneHoldRate}
            samples={summary.coveredCallZoneHoldSamples}
            note="Suggested covered-call floor stayed above realized highs."
          />
          <ProofRateCard
            label="Compression Coil Expansion"
            value={summary.compressionExpansionRate}
            samples={summary.compressionExpansionSamples}
            note="Only matured records labeled Compression coil count here. N/A means there are no matured compression-coil samples yet."
          />
          <ProofRateCard
            label="Compression Coil Range Held"
            value={summary.compressionRangeHoldRate}
            samples={summary.compressionRangeHoldSamples}
            note="Only matured records labeled Compression coil count here. This measures whether the active range held."
          />
          <ProofRateCard
            label="CC Trap Breach"
            value={summary.coveredCallTrapBreachRate}
            samples={summary.coveredCallTrapBreachSamples}
            note="Covered-call traps saw resistance/unlock pressure."
          />
          <ProofRateCard
            label="CSP Trap Failure"
            value={summary.cspTrapFailureRate}
            samples={summary.cspTrapFailureSamples}
            note="CSP traps saw support/failure pressure."
          />
          <ProofRateCard
            label="Bullish Migration Follow-Through"
            value={summary.bullishWallMigrationFollowThroughRate}
            samples={summary.bullishWallMigrationFollowThroughSamples}
            note="Bullish wall migration followed through up or unlocked."
          />
          <ProofRateCard
            label="Bearish Migration Follow-Through"
            value={summary.bearishWallMigrationFollowThroughRate}
            samples={summary.bearishWallMigrationFollowThroughSamples}
            note="Bearish wall migration followed through down or failed support."
          />
          <ProofRateCard
            label="Low-Edge Wait Validation"
            value={summary.lowEdgeWaitValidationRate}
            samples={summary.lowEdgeWaitValidationSamples}
            note="Low-edge labels avoided chop / range-bound setups."
          />
        </div>
      ) : null}
    </Card>
  );
}

function ValidationRecordsTable({
  records,
  horizon,
}: {
  records: EdgeValidationRecord[];
  horizon: EdgeValidationHorizon;
}) {
  return (
    <Card title="Edge Validation Records">
      {records.length === 0 ? (
        <p style={{ color: "#6b7280", marginBottom: 0 }}>
          No edge validation records yet.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              minWidth: 1500,
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr
                style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}
              >
                <th style={{ padding: 6 }}>Market Session</th>
                <th style={{ padding: 6 }}>Saved Surface Dates</th>
                <th style={{ padding: 6 }}>Label</th>
                <th style={{ padding: 6 }}>Edge</th>
                <th style={{ padding: 6 }}>Regime</th>
                <th style={{ padding: 6 }}>Support</th>
                <th style={{ padding: 6 }}>Resistance</th>
                <th style={{ padding: 6 }}>Magnet</th>
                <th style={{ padding: 6 }}>CSP Zone</th>
                <th style={{ padding: 6 }}>CC Zone</th>
                <th style={{ padding: 6 }}>Wall Migration</th>
                <th style={{ padding: 6 }}>Outcome</th>
                <th style={{ padding: 6 }}>Validated</th>
                <th style={{ padding: 6 }}>Close Ret</th>
                <th style={{ padding: 6 }}>Max Up</th>
                <th style={{ padding: 6 }}>Max Down</th>
                <th style={{ padding: 6 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const outcome = record.horizons.find(
                  (item) => item.horizonDays === horizon,
                );
                return (
                  <tr
                    key={record.id}
                    style={{ borderBottom: "1px solid #f3f4f6" }}
                  >
                    <td style={{ padding: 6 }}>
                      {record.marketSessionDate ?? record.snapshotDate}
                    </td>
                    <td style={{ padding: 6, color: "#4b5563" }}>
                      {record.sourceSnapshotDates?.join(", ") ??
                        record.snapshotDate}
                    </td>
                    <td style={{ padding: 6 }}>
                      <span
                        style={{
                          background: bucketColor(record.edge.actionBucket),
                          border: "1px solid #d1d5db",
                          borderRadius: 999,
                          padding: "0.15rem 0.45rem",
                          fontWeight: 800,
                        }}
                      >
                        {record.edge.actionBucket}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: 6,
                        fontWeight: 900,
                        color: scoreColor(record.edge.edgeScore),
                      }}
                    >
                      {record.edge.edgeScore.toFixed(0)}
                    </td>
                    <td style={{ padding: 6 }}>{record.edge.regime}</td>
                    <td style={{ padding: 6 }}>{fmt(record.edge.support)}</td>
                    <td style={{ padding: 6 }}>
                      {fmt(record.edge.resistance)}
                    </td>
                    <td style={{ padding: 6 }}>{fmt(record.edge.magnet)}</td>
                    <td style={{ padding: 6, fontWeight: 800 }}>
                      {fmt(record.edge.executableCspCeiling)}
                    </td>
                    <td style={{ padding: 6, fontWeight: 800 }}>
                      {fmt(record.edge.executableCoveredCallFloor)}
                    </td>
                    <td style={{ padding: 6 }}>
                      {record.wallMigration?.label ?? "N/A"}
                    </td>
                    <td style={{ padding: 6 }}>
                      {outcome?.outcomeLabel ?? "N/A"}
                    </td>
                    <td style={{ padding: 6 }}>
                      <span
                        style={{
                          display: "inline-block",
                          borderRadius: 999,
                          padding: "0.15rem 0.5rem",
                          background: outcomeColor(outcome?.labelValidated),
                        }}
                      >
                        {outcome?.labelValidated == null
                          ? "N/A"
                          : outcome.labelValidated
                            ? "YES"
                            : "NO"}
                      </span>
                    </td>
                    <td style={{ padding: 6 }}>
                      {pct(outcome?.closeReturnPct)}
                    </td>
                    <td style={{ padding: 6 }}>{pct(outcome?.maxUpsidePct)}</td>
                    <td style={{ padding: 6 }}>
                      {pct(outcome?.maxDownsidePct)}
                    </td>
                    <td style={{ padding: 6, color: "#4b5563" }}>
                      {outcome?.notes.join(" ") ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ValidationReadinessCard({
  records,
  horizon,
  totalSurfaces,
}: {
  records: EdgeValidationRecord[];
  horizon: EdgeValidationHorizon;
  totalSurfaces: number;
}) {
  const outcomes = records
    .map((record) =>
      record.horizons.find((item) => item.horizonDays === horizon),
    )
    .filter((outcome): outcome is NonNullable<typeof outcome> =>
      Boolean(outcome),
    );
  const evaluated = outcomes.filter((outcome) => outcome.evaluated).length;
  const provisional = outcomes.filter(
    (outcome) => outcome.evaluated && outcome.isPartialHorizon,
  ).length;
  const notReady = outcomes.length - evaluated;

  return (
    <Card title="Validation Readiness">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5,minmax(0,1fr))",
          gap: "0.75rem",
        }}
      >
        <Metric label="Unique Market Sessions" value={records.length} />
        <Metric label="Saved Surfaces" value={totalSurfaces} />
        <Metric
          label="Evaluated / Provisional"
          value={`${evaluated} / ${provisional}`}
        />
        <Metric label="Waiting for Future Candles" value={notReady} />
        <Metric
          label="Proof Horizon"
          value={`${horizon} trading day${horizon === 1 ? "" : "s"}`}
        />
      </div>
      {records.length > 0 && evaluated === 0 ? (
        <p style={{ color: "#92400e", fontWeight: 700 }}>
          These unique market sessions do not yet have future candles after
          their proof-start date. Weekend saves are collapsed into the prior
          completed trading session; weekday/intraday saves wait for the next
          completed candle.
        </p>
      ) : (
        <p style={{ color: "#4b5563" }}>
          A record becomes strict only when the full proof horizon has elapsed.
          If at least one future candle exists, the page now shows a provisional
          result instead of hiding the record as N/A.
        </p>
      )}
    </Card>
  );
}

function DefinitionCard() {
  return (
    <Card title="What This Page Proves">
      <p>
        This page validates the <strong>actual WheelDesk edge labels</strong>,
        not the old daily-structure-only snapshot.
      </p>
      <ul>
        <li>
          <strong>Scanner labels:</strong> Best CSP setup, covered-call setup,
          compression coil, trap/avoid, conflict/wait, low-edge/wait.
        </li>
        <li>
          <strong>Trade zones:</strong> whether snapped CSP and covered-call
          zones stayed outside realized price action.
        </li>
        <li>
          <strong>Trap labels:</strong> whether covered-call traps saw upside
          pressure or CSP traps saw support failure.
        </li>
        <li>
          <strong>Wall migration:</strong> whether migrating walls followed
          through in the implied direction.
        </li>
        <li>
          <strong>No lookahead:</strong> each edge summary is built using
          candles only through the snapshot date. Future candles are used only
          for validation.
        </li>
      </ul>
    </Card>
  );
}

export default function ValidationPage() {
  const [mounted, setMounted] = useState(false);
  const [surfaceSnapshots, setSurfaceSnapshots] = useState<
    OptionSurfaceSnapshot[]
  >([]);
  const [ticker, setTicker] = useState("");
  const [candleRange, setCandleRange] = useState("1y");
  const [horizon, setHorizon] = useState<EdgeValidationHorizon>(5);
  const [candleStatus, setCandleStatus] = useState("No candles loaded.");
  const [candles, setCandles] = useState<CandleRecord[]>([]);
  const [refreshStatus, setRefreshStatus] = useState("Ready.");
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setMounted(true);
    migrateLegacyStorageToV2();
    const loaded = readOptionSurfaceSnapshots();
    setSurfaceSnapshots(loaded);
    const loadedTickers = getTickers(loaded);
    setTicker((current) => current || loadedTickers[0] || "");
  }, []);

  const tickers = useMemo(
    () => getTickers(surfaceSnapshots),
    [surfaceSnapshots],
  );

  function reloadSurfaces() {
    migrateLegacyStorageToV2();
    const loaded = readOptionSurfaceSnapshots();
    setSurfaceSnapshots(loaded);
    const loadedTickers = getTickers(loaded);
    setTicker((current) => current || loadedTickers[0] || "");
    setRefreshStatus(
      `Reloaded ${loaded.length} saved OI surfaces from wheeldesk_storage_v2.`,
    );
  }

  function clearTickerCandleCache() {
    if (!ticker) return;

    clearCandles(ticker);
    setCandles([]);
    setCandleStatus(`Cleared saved validation candles for ${ticker}.`);
    setRefreshStatus(
      `Cleared saved candles for ${ticker} from wheeldesk_storage_v2.`,
    );
  }

  function clearAllValidationCandleCache() {
    const before = getSavedCandleStats();

    clearCandles();
    setCandles([]);
    setCandleStatus("Cleared all saved validation candles.");
    setRefreshStatus(
      `Cleared ${before.candleCount} saved candles across ${before.tickerCount} tickers from wheeldesk_storage_v2.`,
    );
  }

  async function refreshTickerCandles(targetTicker = ticker) {
    const normalizedTicker = normalizeTicker(targetTicker);
    if (!normalizedTicker) return;

    setIsRefreshing(true);
    setRefreshStatus(`Refreshing Yahoo candles for ${normalizedTicker}...`);

    try {
      const raw = await yahooProvider.getCandles(
        normalizedTicker,
        candleRange,
        "1d",
      );
      const normalized = normalizeValidationCandles(raw);
      saveCandles(normalizedTicker, normalized);

      if (normalizeTicker(ticker) === normalizedTicker) {
        setCandles(normalized);
        setCandleStatus(
          `Loaded ${normalized.length} Yahoo candles for ${normalizedTicker} and saved them to wheeldesk_storage_v2.`,
        );
      }

      setRefreshStatus(
        `Refreshed ${normalized.length} candles for ${normalizedTicker}.`,
      );
    } catch (err) {
      setRefreshStatus(
        err instanceof Error
          ? err.message
          : `Failed to refresh candles for ${normalizedTicker}.`,
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function refreshAllTickerCandles() {
    const targets = tickers.length ? tickers : getTickers(surfaceSnapshots);
    if (!targets.length) {
      setRefreshStatus("No tickers with saved OI surfaces were found.");
      return;
    }

    setIsRefreshing(true);
    let ok = 0;
    let failed = 0;

    for (const target of targets) {
      setRefreshStatus(
        `Refreshing ${target} (${ok + failed + 1}/${targets.length})...`,
      );
      try {
        const raw = await yahooProvider.getCandles(target, candleRange, "1d");
        const normalized = normalizeValidationCandles(raw);
        saveCandles(target, normalized);
        if (normalizeTicker(ticker) === normalizeTicker(target))
          setCandles(normalized);
        ok += 1;
      } catch {
        failed += 1;
      }
    }

    setIsRefreshing(false);
    setRefreshStatus(
      `Finished candle refresh. Success: ${ok}. Failed: ${failed}.`,
    );
  }

  useEffect(() => {
    if (!ticker) return;

    const cached = readCandles(ticker);
    if (cached.length) {
      setCandles(cached);
      setCandleStatus(
        `Loaded ${cached.length} saved candles for ${ticker}. Refreshing Yahoo candles...`,
      );
    } else {
      setCandles([]);
      setCandleStatus(`Loading Yahoo candles for ${ticker}...`);
    }

    yahooProvider
      .getCandles(ticker, candleRange, "1d")
      .then((raw) => {
        const normalized = normalizeValidationCandles(raw);
        setCandles(normalized);
        saveCandles(ticker, normalized);
        setCandleStatus(
          `Loaded ${normalized.length} Yahoo candles for ${ticker} and saved them to wheeldesk_storage_v2.`,
        );
      })
      .catch((err) => {
        const cachedAfterError = readCandles(ticker);
        if (cachedAfterError.length) {
          setCandles(cachedAfterError);
          setCandleStatus(
            `Yahoo candle refresh failed. Using ${cachedAfterError.length} saved candles for ${ticker}.`,
          );
        } else {
          setCandles([]);
          setCandleStatus(
            err instanceof Error
              ? err.message
              : "Failed to load Yahoo candles.",
          );
        }
      });
  }, [ticker, candleRange]);

  const selectedSnapshots = useMemo(() => {
    return surfaceSnapshots
      .filter(
        (snapshot) =>
          normalizeTicker(snapshot.ticker) === normalizeTicker(ticker),
      )
      .sort((a, b) =>
        dateKey(a.snapshotDate).localeCompare(dateKey(b.snapshotDate)),
      );
  }, [surfaceSnapshots, ticker]);

  const records = useMemo(() => {
    if (!ticker) return [];
    return buildEdgeValidationRecords({
      ticker,
      surfaces: selectedSnapshots,
      candles,
      horizons: [1, 3, 5, 10],
    });
  }, [ticker, selectedSnapshots, candles]);

  const summary = useMemo(
    () => summarizeEdgeValidation(records, horizon),
    [records, horizon],
  );
  const proofSummaries = useMemo(
    () => buildEdgeProofSummaries(records, horizon, ticker),
    [records, horizon, ticker],
  );

  useEffect(() => {
    if (!mounted) return;
    saveEdgeProofSummaries(proofSummaries);
  }, [mounted, proofSummaries]);

  if (!mounted) {
    return (
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "1rem" }}>
        <h1>Validation — WheelDesk Edge Proof</h1>
        <p>Loading validation storage...</p>
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: 1400,
        margin: "0 auto",
        padding: "1rem",
        display: "grid",
        gap: "1rem",
      }}
    >
      <div>
        <h1 style={{ marginBottom: 4 }}>Validation — WheelDesk Edge Proof</h1>
        <p style={{ marginTop: 0, color: "#4b5563" }}>
          Forward-validates saved WheelDesk setups. Recent snapshots are a live
          journal first; they become proof only after future trading candles
          exist.
        </p>
      </div>

      <Card title="Controls">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6,minmax(0,1fr))",
            gap: "0.75rem",
            alignItems: "end",
          }}
        >
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Ticker</span>
            <select
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              style={{
                padding: "0.45rem",
                border: "1px solid #9ca3af",
                borderRadius: 4,
              }}
            >
              {tickers.length === 0 ? (
                <option value="">No surface snapshots found</option>
              ) : (
                tickers.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))
              )}
            </select>
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Candle Range</span>
            <select
              value={candleRange}
              onChange={(e) => setCandleRange(e.target.value)}
              style={{
                padding: "0.45rem",
                border: "1px solid #9ca3af",
                borderRadius: 4,
              }}
            >
              <option value="1mo">1mo</option>
              <option value="3mo">3mo</option>
              <option value="6mo">6mo</option>
              <option value="1y">1y</option>
              <option value="2y">2y</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Proof Horizon</span>
            <select
              value={horizon}
              onChange={(e) =>
                setHorizon(Number(e.target.value) as EdgeValidationHorizon)
              }
              style={{
                padding: "0.45rem",
                border: "1px solid #9ca3af",
                borderRadius: 4,
              }}
            >
              <option value={1}>1 trading day</option>
              <option value={3}>3 trading days</option>
              <option value={5}>5 trading days</option>
              <option value={10}>10 trading days</option>
            </select>
          </label>

          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Refresh</span>
            <button
              type="button"
              onClick={reloadSurfaces}
              disabled={isRefreshing}
              style={{
                padding: "0.45rem",
                border: "1px solid #9ca3af",
                borderRadius: 4,
                background: "#fff",
              }}
            >
              Reload surfaces
            </button>
            <button
              type="button"
              onClick={() => refreshTickerCandles()}
              disabled={isRefreshing || !ticker}
              style={{
                padding: "0.45rem",
                border: "1px solid #9ca3af",
                borderRadius: 4,
                background: "#fff",
              }}
            >
              Refresh ticker candles
            </button>
            <button
              type="button"
              onClick={clearTickerCandleCache}
              disabled={isRefreshing || !ticker}
              style={{
                padding: "0.45rem",
                border: "1px solid #f59e0b",
                borderRadius: 4,
                background: "#fffbeb",
                color: "#92400e",
              }}
            >
              Clear ticker candles
            </button>
            <button
              type="button"
              onClick={clearAllValidationCandleCache}
              disabled={isRefreshing}
              style={{
                padding: "0.45rem",
                border: "1px solid #dc2626",
                borderRadius: 4,
                background: "#fef2f2",
                color: "#991b1b",
              }}
            >
              Clear all validation candles
            </button>
          </div>

          <Metric label="All Surfaces" value={surfaceSnapshots.length} />
          <Metric
            label={`${ticker || "Ticker"} Surfaces`}
            value={selectedSnapshots.length}
          />
          <Metric label="Candles" value={candles.length} />
        </div>
        <p style={{ marginBottom: 0, color: "#4b5563" }}>{candleStatus}</p>
        <p
          style={{
            marginTop: 4,
            marginBottom: 0,
            color: isRefreshing ? "#92400e" : "#15803d",
          }}
        >
          {refreshStatus}
        </p>
      </Card>

      <ProofModeExplainer records={records} horizon={horizon} />
      <ValidationReadinessCard
        records={records}
        horizon={horizon}
        totalSurfaces={selectedSnapshots.length}
      />
      <LiveEdgeJournal records={records} horizon={horizon} />
      <ProofScoreSummary proofSummaries={proofSummaries} />
      <EdgeProofSummary summary={summary} />
      <ScannerLabelProof
        bucketProof={summary.bucketProof}
        proofSummaries={proofSummaries}
      />
      <ValidationRecordsTable records={records} horizon={horizon} />
      <DefinitionCard />
    </main>
  );
}
