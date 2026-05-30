"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { colors, cardStyle } from "./styles";
import type { OIFieldForecastResult } from "../../lib/oi-field-engine-v2";
import {
  buildOIFieldForecastCapturePayload,
  wheelHorizon,
} from "../../lib/oi-forecast-capture-payload";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";

type CaptureSession = "premarket" | "midday" | "close" | "manual";

type CaptureResult = {
  id?: string;
  symbol?: string;
  snapshot_date?: string;
  expiration?: string | null;
  generated_at?: string;
};

type Props = {
  ticker: string;
  spot: number;
  snapshotDate?: string | null;
  expiration?: string | null;
  dte?: number | null;
  surfaceSnapshotId?: string | null;
  forecast: OIFieldForecastResult | null;
  classicPath?: any | null;
  chainPath?: any | null;
  forecastOverlayMaxDte?: number | null;
  ivSurface?: any | null;
  selectedSurface?: any | null;
  selectedChainSurface?: any | null;
  source?: string;
  defaultCaptureSession?: CaptureSession;
  compact?: boolean;
  onCaptured?: (forecast: CaptureResult | null) => void;
};

function fmt(value: unknown, digits = 2): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "N/A";
}

function shortId(value?: string): string {
  if (!value) return "N/A";
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

async function authHeader(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  try {
    const { data } = await getSupabaseAuthClient().auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // The API can still save anonymous/system captures, but signed-in captures attach user_id.
  }

  return headers;
}

export default function OIFieldCaptureCard({
  ticker,
  spot,
  snapshotDate,
  expiration,
  dte,
  surfaceSnapshotId,
  forecast,
  classicPath,
  chainPath,
  forecastOverlayMaxDte,
  ivSurface,
  selectedSurface,
  selectedChainSurface,
  source = "control_center",
  defaultCaptureSession = "manual",
  compact = false,
  onCaptured,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null);
  const [captureSession, setCaptureSession] = useState<CaptureSession>(
    defaultCaptureSession,
  );

  const payload = useMemo(
    () =>
      buildOIFieldForecastCapturePayload({
        ticker,
        spot,
        snapshotDate,
        expiration,
        dte,
        surfaceSnapshotId,
        forecast,
        classicPath,
        chainPath,
        forecastOverlayMaxDte,
        ivSurface,
        selectedSurface,
        selectedChainSurface,
        source,
        inputs: { captureSession },
      }),
    [
      ticker,
      spot,
      snapshotDate,
      expiration,
      dte,
      surfaceSnapshotId,
      forecast,
      classicPath,
      chainPath,
      forecastOverlayMaxDte,
      ivSurface,
      selectedSurface,
      selectedChainSurface,
      source,
      captureSession,
    ],
  );

  const wheel = wheelHorizon(forecast);
  const canCapture = Boolean(
    payload?.symbol && payload?.spot && forecast?.horizons?.length,
  );

  async function captureForecast() {
    if (!payload || saving) return;

    setSaving(true);
    setMessage("Capturing OI Field forecast receipt...");

    try {
      const response = await fetch("/api/forecasts/oi-field", {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({
          ...payload,
          captureSession,
          captureKind: source === "forecast_harvest" ? "scheduled" : "manual",
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.error ?? `Forecast capture failed: ${response.status}`,
        );
      }

      setLastCapture(result.forecast ?? null);
      setMessage(
        `Captured ${payload.symbol} forecast for ${payload.snapshotDate ?? "latest"}.`,
      );
      onCaptured?.(result.forecast ?? null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not capture OI Field forecast.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      style={{
        ...cardStyle,
        padding: compact ? "0.75rem" : "1rem",
        display: "grid",
        gap: compact ? "0.6rem" : "0.85rem",
        borderColor: "rgba(34, 211, 238, 0.24)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.75rem",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              color: colors.teal,
              fontSize: 11,
              fontWeight: 950,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            OI Forecast Receipt
          </div>
          <h3
            style={{
              color: colors.text,
              margin: "0.25rem 0 0",
              fontSize: compact ? 16 : 20,
            }}
          >
            Capture OI Field v2 Forecast
          </h3>
          <p
            style={{ color: colors.muted, margin: "0.35rem 0 0", fontSize: 12 }}
          >
            Saves a frozen forecast receipt: classic OI path overlay,
            selected-chain field map, and baseline-only NN training inputs.
            Future candles validate this receipt without recalculating it.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <select
            value={captureSession}
            onChange={(event) =>
              setCaptureSession(event.target.value as CaptureSession)
            }
            style={{
              border: "1px solid rgba(148, 163, 184, 0.24)",
              background: "rgba(15, 23, 42, 0.88)",
              color: colors.text,
              borderRadius: 999,
              padding: "0.55rem 0.7rem",
              fontSize: 12,
              fontWeight: 900,
            }}
            title="Capture session label. Keep scheduled training captures consistent; manual is for testing/debugging."
          >
            <option value="premarket">Premarket</option>
            <option value="midday">Midday</option>
            <option value="close">Close</option>
            <option value="manual">Manual</option>
          </select>

          <button
            type="button"
            onClick={captureForecast}
            disabled={!canCapture || saving}
            style={{
              border: `1px solid ${canCapture ? colors.teal : "rgba(148, 163, 184, 0.18)"}`,
              background: canCapture
                ? "rgba(34, 211, 238, 0.14)"
                : "rgba(15, 23, 42, 0.5)",
              color: canCapture ? colors.teal : colors.muted,
              borderRadius: 999,
              padding: "0.58rem 0.82rem",
              fontSize: 12,
              fontWeight: 950,
              cursor: canCapture && !saving ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
            }}
          >
            {saving ? "Capturing..." : "Capture Forecast"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "0.65rem",
        }}
      >
        <div style={miniBoxStyle}>
          <span>Symbol</span>
          <strong>{payload?.symbol ?? ticker ?? "N/A"}</strong>
        </div>
        <div style={miniBoxStyle}>
          <span>Snapshot</span>
          <strong>{payload?.snapshotDate ?? snapshotDate ?? "N/A"}</strong>
        </div>
        <div style={miniBoxStyle}>
          <span>Session</span>
          <strong>{captureSession}</strong>
        </div>
        <div style={miniBoxStyle}>
          <span>Expiration</span>
          <strong>{payload?.expiration ?? expiration ?? "N/A"}</strong>
        </div>
        <div style={miniBoxStyle}>
          <span>30D Base</span>
          <strong>{fmt(wheel?.baseTarget)}</strong>
        </div>
        <div style={miniBoxStyle}>
          <span>Field Range</span>
          <strong>
            {fmt(wheel?.lowerBand)}–{fmt(wheel?.upperBand)}
          </strong>
        </div>
        <div style={miniBoxStyle}>
          <span>Confidence</span>
          <strong>{forecast?.confidenceScore ?? "N/A"}</strong>
        </div>
      </div>

      <div
        style={{
          color:
            message.includes("failed") || message.includes("Could")
              ? colors.red
              : colors.muted,
          fontSize: 12,
        }}
      >
        {message ||
          (canCapture
            ? "Ready to capture this forecast snapshot."
            : "Load a valid surface, expiration, candles, and OI Field forecast first.")}
        {lastCapture ? (
          <span style={{ color: colors.teal, marginLeft: 8 }}>
            Receipt {shortId(lastCapture.id)} ·{" "}
            {lastCapture.generated_at
              ? new Date(lastCapture.generated_at).toLocaleString()
              : "saved"}
          </span>
        ) : null}
      </div>
    </section>
  );
}

const miniBoxStyle: CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.18)",
  background: "rgba(3, 12, 22, 0.72)",
  borderRadius: 14,
  padding: "0.62rem 0.72rem",
  display: "grid",
  gap: 3,
  color: colors.muted,
  fontSize: 11,
};
