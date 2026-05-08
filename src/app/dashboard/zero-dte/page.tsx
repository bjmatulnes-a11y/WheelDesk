"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createZeroDTESpread,
  defaultZeroDTEInternals,
  defaultZeroDTEProfile,
  ZeroDTEInternals,
  ZeroDTEPressureInputs,
  ZeroDTEProfile,
  ZeroDTESide,
  ZeroDTESpread,
  ZeroDTEStrategyType
} from "../../../lib/zero-dte-profile";
import { evaluateZeroDTEPortfolio, ZeroDTESpreadReport } from "../../../lib/zero-dte-manager";

const STORAGE_KEY = "wheelDesk.zeroDTE.state.v1";

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return `$${value.toFixed(0)}`;
}

function money2(value: number): string {
  return `$${value.toFixed(2)}`;
}

function statusColor(status: string): string {
  if (status === "urgent") return "#991b1b";
  if (status === "defend") return "#b91c1c";
  if (status === "pressure") return "#c2410c";
  if (status === "watch") return "#92400e";
  return "#15803d";
}

function actionLabel(action: string): string {
  return action.replaceAll("_", " ").toUpperCase();
}

type SavedState = {
  profile: ZeroDTEProfile;
  spot: number;
  priorSpot: number;
  internals: ZeroDTEInternals;
  spreads: ZeroDTESpread[];
};

function loadState(): SavedState {
  if (typeof window === "undefined") {
    return {
      profile: defaultZeroDTEProfile,
      spot: 0,
      priorSpot: 0,
      internals: defaultZeroDTEInternals,
      spreads: []
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("missing");

    const parsed = JSON.parse(raw) as SavedState;

    return {
      profile: { ...defaultZeroDTEProfile, ...parsed.profile },
      spot: parsed.spot ?? 0,
      priorSpot: parsed.priorSpot ?? 0,
      internals: { ...defaultZeroDTEInternals, ...parsed.internals },
      spreads: parsed.spreads ?? []
    };
  } catch {
    return {
      profile: defaultZeroDTEProfile,
      spot: 0,
      priorSpot: 0,
      internals: defaultZeroDTEInternals,
      spreads: []
    };
  }
}

function saveState(state: SavedState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function Card({
  title,
  children,
  border = "#d1d5db"
}: {
  title: string;
  children: React.ReactNode;
  border?: string;
}) {
  return (
    <section style={{ border: `1px solid ${border}`, borderRadius: 8, background: "#fff", padding: "1rem" }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "number",
  step = "any"
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: "0.35rem", border: "1px solid #9ca3af", borderRadius: 4 }}
      />
    </label>
  );
}

function ProfilePanel({
  profile,
  setProfile,
  spot,
  setSpot,
  priorSpot,
  setPriorSpot
}: {
  profile: ZeroDTEProfile;
  setProfile: (p: ZeroDTEProfile) => void;
  spot: number;
  setSpot: (n: number) => void;
  priorSpot: number;
  setPriorSpot: (n: number) => void;
}) {
  return (
    <Card title="0DTE Profile / TOS Mirror">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.75rem" }}>
        <Field label="Ticker" type="text" value={profile.ticker} onChange={(v) => setProfile({ ...profile, ticker: v.toUpperCase() })} />
        <Field label="Expiration" type="date" value={profile.expiration} onChange={(v) => setProfile({ ...profile, expiration: v })} />
        <Field label="Spot" value={spot} onChange={(v) => setSpot(num(v))} />
        <Field label="Prior Spot" value={priorSpot} onChange={(v) => setPriorSpot(num(v))} />
        <Field label="Cash Available" value={profile.cashAvailable} onChange={(v) => setProfile({ ...profile, cashAvailable: num(v) })} />
        <Field label="Max Total Risk" value={profile.maxTotalRisk} onChange={(v) => setProfile({ ...profile, maxTotalRisk: num(v) })} />

        <Field label="Max Daily Loss" value={profile.maxDailyLoss} onChange={(v) => setProfile({ ...profile, maxDailyLoss: num(v) })} />
        <Field label="Max Risk / Trade" value={profile.maxRiskPerTrade} onChange={(v) => setProfile({ ...profile, maxRiskPerTrade: num(v) })} />
        <Field label="Default Width" value={profile.defaultWidth} onChange={(v) => setProfile({ ...profile, defaultWidth: num(v) })} />
        <Field label="Max Contracts" value={profile.maxContracts} onChange={(v) => setProfile({ ...profile, maxContracts: num(v) })} />
        <Field label="3x Trigger" value={profile.shortLegTriggerMultiple} onChange={(v) => setProfile({ ...profile, shortLegTriggerMultiple: num(v) })} />

        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Rules</span>
          <label>
            <input
              type="checkbox"
              checked={profile.allowShortLegOnlyClose}
              onChange={(e) => setProfile({ ...profile, allowShortLegOnlyClose: e.target.checked })}
            />{" "}
            close short only
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
        <label>
          <input
            type="checkbox"
            checked={profile.allowLongLegRunner}
            onChange={(e) => setProfile({ ...profile, allowLongLegRunner: e.target.checked })}
          />{" "}
          allow long-leg runner
        </label>

        <label>
          <input
            type="checkbox"
            checked={profile.allowRecenter}
            onChange={(e) => setProfile({ ...profile, allowRecenter: e.target.checked })}
          />{" "}
          allow recenter / reduce width
        </label>

        <label>
          <input
            type="checkbox"
            checked={profile.allowHedge}
            onChange={(e) => setProfile({ ...profile, allowHedge: e.target.checked })}
          />{" "}
          allow hedge
        </label>
      </div>
    </Card>
  );
}

function InternalsPanel({
  internals,
  setInternals
}: {
  internals: ZeroDTEInternals;
  setInternals: (i: ZeroDTEInternals) => void;
}) {
  return (
    <Card title="Market Internals Multiplier">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "0.75rem" }}>
        <Field label="ADD" value={internals.add} onChange={(v) => setInternals({ ...internals, add: num(v) })} />
        <Field label="TICK" value={internals.tick} onChange={(v) => setInternals({ ...internals, tick: num(v) })} />
        <Field label="VIX % Change" value={internals.vixChangePct} onChange={(v) => setInternals({ ...internals, vixChangePct: num(v) })} />
        <Field label="Top 10 Breadth 0-1" value={internals.top10Breadth} onChange={(v) => setInternals({ ...internals, top10Breadth: num(v) })} />
        <Field label="UVOL/DVOL" value={internals.uvolDvolRatio} onChange={(v) => setInternals({ ...internals, uvolDvolRatio: num(v) })} />
      </div>

      <p style={{ marginBottom: 0, color: "#4b5563", fontSize: 13 }}>
        Internals do not replace strike pressure. They multiply it. Bearish internals amplify put-side risk; bullish internals amplify call-side risk.
      </p>
    </Card>
  );
}

function NewSpreadForm({
  profile,
  onAdd
}: {
  profile: ZeroDTEProfile;
  onAdd: (spread: ZeroDTESpread) => void;
}) {
  const [side, setSide] = useState<ZeroDTESide>("put");
  const [strategyType, setStrategyType] = useState<ZeroDTEStrategyType>("put_credit_spread");
  const [shortStrike, setShortStrike] = useState("6200");
  const [longStrike, setLongStrike] = useState("6180");
  const [quantity, setQuantity] = useState("1");
  const [entryCredit, setEntryCredit] = useState("2.00");
  const [currentShortMark, setCurrentShortMark] = useState("2.00");
  const [entryDelta, setEntryDelta] = useState("10");

  return (
    <Card title="Add / Mirror TOS Spread">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8,minmax(0,1fr))", gap: "0.75rem", alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Side</span>
          <select
            value={side}
            onChange={(e) => {
              const next = e.target.value as ZeroDTESide;
              setSide(next);
              setStrategyType(next === "put" ? "put_credit_spread" : "call_credit_spread");
            }}
            style={{ padding: "0.35rem" }}
          >
            <option value="put">Put</option>
            <option value="call">Call</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Type</span>
          <select
            value={strategyType}
            onChange={(e) => setStrategyType(e.target.value as ZeroDTEStrategyType)}
            style={{ padding: "0.35rem" }}
          >
            <option value="put_credit_spread">Put Credit Spread</option>
            <option value="call_credit_spread">Call Credit Spread</option>
            <option value="iron_condor">Iron Condor Leg</option>
            <option value="iron_fly">Iron Fly Leg</option>
            <option value="hedge">Hedge</option>
          </select>
        </label>

        <Field label="Short" value={shortStrike} onChange={setShortStrike} />
        <Field label="Long" value={longStrike} onChange={setLongStrike} />
        <Field label="Qty" value={quantity} onChange={setQuantity} />
        <Field label="Entry Credit" value={entryCredit} onChange={setEntryCredit} />
        <Field label="Short Mark" value={currentShortMark} onChange={setCurrentShortMark} />
        <Field label="Entry Δ" value={entryDelta} onChange={setEntryDelta} />

        <button
          style={{ gridColumn: "1 / -1", padding: "0.5rem", fontWeight: 700 }}
          onClick={() => {
            onAdd(
              createZeroDTESpread({
                ticker: profile.ticker,
                expiration: profile.expiration,
                strategyType,
                side,
                shortStrike: num(shortStrike),
                longStrike: num(longStrike),
                quantity: Math.max(1, Math.floor(num(quantity))),
                entryCredit: num(entryCredit),
                currentShortMark: num(currentShortMark),
                entryShortDelta: num(entryDelta)
              })
            );
          }}
        >
          Add Spread
        </button>
      </div>
    </Card>
  );
}

function PortfolioRiskBar({ report }: { report: ReturnType<typeof evaluateZeroDTEPortfolio> }) {
  return (
    <Card title="0DTE Risk Guardrails" border={report.overLeverage === "high" ? "#b91c1c" : report.overLeverage === "moderate" ? "#c2410c" : "#15803d"}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "0.75rem" }}>
        <div>
          <strong>Gross Width Risk</strong>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{money(report.totalGrossWidthRisk)}</div>
        </div>

        <div>
          <strong>Max Risk</strong>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{money(report.totalMaxRisk)}</div>
        </div>

        <div>
          <strong>Credit Received</strong>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{money(report.totalCreditReceived)}</div>
        </div>

        <div>
          <strong>Risk Usage</strong>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{(report.riskUtilizationPct * 100).toFixed(0)}%</div>
        </div>

        <div>
          <strong>Overleverage</strong>
          <div style={{ fontSize: 20, fontWeight: 800, color: report.overLeverage === "high" ? "#b91c1c" : "#111827" }}>
            {report.overLeverage.toUpperCase()}
          </div>
        </div>
      </div>

      {report.portfolioWarnings.length > 0 && (
        <ul style={{ color: "#b91c1c", fontWeight: 600 }}>
          {report.portfolioWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function updatePressureInput(
  spread: ZeroDTESpread,
  patch: Partial<ZeroDTEPressureInputs>
): ZeroDTESpread {
  return {
    ...spread,
    pressureInputs: {
      sideVolumeNearStrike: 0,
      totalSideVolumeWindow: 0,
      sideOiAtStrike: 0,
      sideVolumeAcceleration: 1,
      skewScoreRaw: 0,
      priceVelocityRaw: 0,
      ...(spread.pressureInputs ?? {}),
      ...patch
    }
  };
}

function SpreadReportCard({
  report,
  onUpdate,
  onDelete
}: {
  report: ZeroDTESpreadReport;
  onUpdate: (spread: ZeroDTESpread) => void;
  onDelete: (id: string) => void;
}) {
  const spread = report.spread;
  const p = spread.pressureInputs ?? {
    sideVolumeNearStrike: 0,
    totalSideVolumeWindow: 0,
    sideOiAtStrike: 0,
    sideVolumeAcceleration: 1,
    skewScoreRaw: 0,
    priceVelocityRaw: 0
  };

  return (
    <section
      style={{
        border: `2px solid ${statusColor(report.status)}`,
        borderRadius: 8,
        background: "#fff",
        padding: "1rem",
        display: "grid",
        gap: "0.75rem"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
        <div>
          <h3 style={{ margin: 0 }}>
            {spread.side.toUpperCase()} {spread.shortStrike}/{spread.longStrike}
          </h3>
          <div style={{ color: "#4b5563" }}>
            {spread.strategyType.replaceAll("_", " ")} · Qty {spread.quantity} · Width {spread.width}
          </div>
        </div>

        <button onClick={() => onDelete(spread.id)}>Delete</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.75rem" }}>
        <div>
          <strong>Status</strong>
          <div style={{ fontSize: 20, fontWeight: 800, color: statusColor(report.status) }}>
            {report.status.toUpperCase()}
          </div>
        </div>

        <div>
          <strong>Action</strong>
          <div>{actionLabel(report.action)}</div>
        </div>

        <div>
          <strong>Attack Score</strong>
          <div>{report.adjustedAttackScore.toFixed(0)} / 100</div>
        </div>

        <div>
          <strong>Short Mark</strong>
          <div>{money2(spread.currentShortMark)}</div>
        </div>

        <div>
          <strong>3x Trigger</strong>
          <div>{money2(report.shortLegTrigger)}</div>
        </div>

        <div>
          <strong>Mark Multiple</strong>
          <div>{report.shortMarkMultiple.toFixed(2)}x</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "0.75rem" }}>
        <Field
          label="Current Short Mark"
          value={spread.currentShortMark}
          onChange={(v) => onUpdate({ ...spread, currentShortMark: num(v) })}
        />
        <Field
          label="Vol Near Strike"
          value={p.sideVolumeNearStrike}
          onChange={(v) => onUpdate(updatePressureInput(spread, { sideVolumeNearStrike: num(v) }))}
        />
        <Field
          label="Total Side Vol Window"
          value={p.totalSideVolumeWindow}
          onChange={(v) => onUpdate(updatePressureInput(spread, { totalSideVolumeWindow: num(v) }))}
        />
        <Field
          label="OI At Strike"
          value={p.sideOiAtStrike}
          onChange={(v) => onUpdate(updatePressureInput(spread, { sideOiAtStrike: num(v) }))}
        />
        <Field
          label="Vol Accel x"
          value={p.sideVolumeAcceleration}
          onChange={(v) => onUpdate(updatePressureInput(spread, { sideVolumeAcceleration: num(v) }))}
        />
        <Field
          label="Price Velocity Pts"
          value={p.priceVelocityRaw}
          onChange={(v) => onUpdate(updatePressureInput(spread, { priceVelocityRaw: num(v) }))}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "0.75rem" }}>
        <div>
          <strong>Max Risk</strong>
          <div>{money(report.maxRisk)}</div>
        </div>
        <div>
          <strong>Breakeven</strong>
          <div>{report.breakeven.toFixed(2)}</div>
        </div>
        <div>
          <strong>Distance</strong>
          <div>{report.distanceToShort.toFixed(1)} pts</div>
        </div>
        <div>
          <strong>Internals Mult.</strong>
          <div>{report.internalsMultiplier.toFixed(2)}x</div>
        </div>
        <div>
          <strong>Weak Side</strong>
          <div>{report.weakSide.toUpperCase()}</div>
        </div>
      </div>

      {report.riskWarnings.length > 0 && (
        <div style={{ color: "#b91c1c" }}>
          <strong>Risk Warnings</strong>
          <ul>
            {report.riskWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <details open>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Why</summary>
        <ul>
          {report.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      <details open>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Management Plan</summary>
        <ul>
          {report.managementPlan.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      <details>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Expiration Theoretical</summary>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: 6 }}>Underlying</th>
              <th style={{ padding: 6 }}>Expiration P/L</th>
            </tr>
          </thead>
          <tbody>
            {report.expirationSlices.map((s) => (
              <tr key={s.price} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: 6 }}>{s.price.toFixed(2)}</td>
                <td style={{ padding: 6, color: s.pnl < 0 ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
                  {money(s.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export default function ZeroDTEPage() {
  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<ZeroDTEProfile>(defaultZeroDTEProfile);
  const [spot, setSpot] = useState(0);
  const [priorSpot, setPriorSpot] = useState(0);
  const [internals, setInternals] = useState<ZeroDTEInternals>(defaultZeroDTEInternals);
  const [spreads, setSpreads] = useState<ZeroDTESpread[]>([]);

  useEffect(() => {
    const state = loadState();
    setProfile(state.profile);
    setSpot(state.spot);
    setPriorSpot(state.priorSpot);
    setInternals(state.internals);
    setSpreads(state.spreads);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    saveState({ profile, spot, priorSpot, internals, spreads });
  }, [mounted, profile, spot, priorSpot, internals, spreads]);

  const report = useMemo(() => {
    return evaluateZeroDTEPortfolio({
      spreads,
      profile,
      spot,
      internals
    });
  }, [spreads, profile, spot, internals]);

  const updateSpread = (updated: ZeroDTESpread) => {
    setSpreads((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const deleteSpread = (id: string) => {
    setSpreads((prev) => prev.filter((s) => s.id !== id));
  };

  if (!mounted) return null;

  return (
    <main style={{ maxWidth: 1300, margin: "0 auto", padding: "1rem", display: "grid", gap: "1rem" }}>
      <h1 style={{ marginBottom: 0 }}>SPX 0DTE Workspace</h1>

      <p style={{ marginTop: 0, color: "#4b5563" }}>
        TOS remains the execution platform. This page mirrors the position and enforces sizing, 3x short-leg triggers,
        strike pressure, internals, and adjustment discipline.
      </p>

      <ProfilePanel
        profile={profile}
        setProfile={setProfile}
        spot={spot}
        setSpot={setSpot}
        priorSpot={priorSpot}
        setPriorSpot={setPriorSpot}
      />

      <InternalsPanel internals={internals} setInternals={setInternals} />

      <PortfolioRiskBar report={report} />

      <NewSpreadForm
        profile={profile}
        onAdd={(spread) => setSpreads((prev) => [spread, ...prev])}
      />

      <div style={{ display: "grid", gap: "1rem" }}>
        {report.reports.length === 0 ? (
          <Card title="Open 0DTE Spreads">
            <p style={{ marginBottom: 0, color: "#6b7280" }}>
              Add a TOS spread above to begin monitoring short-leg trigger, strike attack score, and adjustment guidance.
            </p>
          </Card>
        ) : (
          report.reports.map((r) => (
            <SpreadReportCard
              key={r.spread.id}
              report={r}
              onUpdate={updateSpread}
              onDelete={deleteSpread}
            />
          ))
        )}
      </div>
    </main>
  );
}