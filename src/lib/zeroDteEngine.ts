export type OptionType = "call" | "put";
export type ZeroDteSymbol = "SPX" | "SPY" | "SPY_EQUIV";

export type ZeroDteChainRow = {
  symbol: ZeroDteSymbol | "SPX" | "SPY";
  strike: number;
  optionType: OptionType;
  openInterest?: number | null;
  priorOpenInterest?: number | null;
  oiChange?: number | null;
  volume?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
};

export type ZeroDteInputs = {
  spxPrice: number;
  spyPrice: number;
  spxRows: ZeroDteChainRow[];
  spyRows: ZeroDteChainRow[];
};

export type ZeroDteAnalytics = {
  spxPrice: number;
  spyPrice: number;
  expectedMove: number;
  suggestedCenter: number;
  suggestedWingWidth: number;
  lowerWing: number;
  upperWing: number;
  callWall: number | null;
  putWall: number | null;
  compositePin: number | null;
  dealerPressure: number;
  pinScore: number;
  trendRisk: number;
  spyConfirmation: "confirming" | "conflicting" | "neutral";
  management: string;
  notes: string;
  combinedRows: ZeroDteChainRow[];
};

export function buildZeroDteAnalytics(input: ZeroDteInputs): ZeroDteAnalytics {
  const { spxPrice, spyPrice, spxRows, spyRows } = input;

  const spyAsSpx: ZeroDteChainRow[] =
    spyPrice > 0
      ? spyRows.map((r) => ({
          ...r,
          symbol: "SPY_EQUIV",
          strike: spyToSpxLevel(r.strike, spxPrice, spyPrice),
        }))
      : [];

  const combinedRows = [...spxRows, ...spyAsSpx];

  const callRows = combinedRows.filter((r) => r.optionType === "call");
  const putRows = combinedRows.filter((r) => r.optionType === "put");

  const callWall = strongestStrike(callRows);
  const putWall = strongestStrike(putRows);
  const compositePin = strongestPin(combinedRows);

  const expectedMove = estimateAtmStraddle(spxRows, spxPrice) ?? 0;
  const dealerPressure = estimateDealerPressure(combinedRows, spxPrice);

  const pinScore = estimatePinScore({
    spxPrice,
    callWall,
    putWall,
    compositePin,
    dealerPressure,
    expectedMove,
  });

  const suggestedCenter = roundToFive(
    spxPrice +
      centerAdjustment({
        compositePin,
        dealerPressure,
        spxPrice,
      })
  );

  const suggestedWingWidth = roundToFive(Math.max(expectedMove, 50));
  const lowerWing = suggestedCenter - suggestedWingWidth;
  const upperWing = suggestedCenter + suggestedWingWidth;

  const spyConfirmation = estimateSpyConfirmation({
    spxPrice,
    spxRows,
    spyAsSpx,
  });

  const management = getIronFlyManagement({
    spot: spxPrice,
    center: suggestedCenter,
    wingWidth: suggestedWingWidth,
    expectedMove,
    pinScore,
  });

  return {
    spxPrice,
    spyPrice,
    expectedMove,
    suggestedCenter,
    suggestedWingWidth,
    lowerWing,
    upperWing,
    callWall,
    putWall,
    compositePin,
    dealerPressure,
    pinScore,
    trendRisk: 100 - pinScore,
    spyConfirmation,
    management,
    notes: buildNotes({
      pinScore,
      dealerPressure,
      suggestedCenter,
      lowerWing,
      upperWing,
      callWall,
      putWall,
      compositePin,
      spyConfirmation,
    }),
    combinedRows,
  };
}

export function spyToSpxLevel(
  spyStrike: number,
  spxPrice: number,
  spyPrice: number
) {
  if (!spyPrice) return spyStrike * 10;
  return spyStrike * (spxPrice / spyPrice);
}

function strongestStrike(rows: ZeroDteChainRow[]) {
  if (!rows.length) return null;

  return rows
    .map((r) => ({
      strike: roundToFive(r.strike),
      score:
        safe(r.openInterest) * 1.0 +
        safe(r.volume) * 0.75 +
        Math.abs(safe(r.gamma)) * 100000 +
        Math.abs(safe(r.oiChange)) * 1.25,
    }))
    .sort((a, b) => b.score - a.score)[0]?.strike ?? null;
}

function strongestPin(rows: ZeroDteChainRow[]) {
  const map = new Map<number, number>();

  for (const r of rows) {
    const strike = roundToFive(r.strike);
    const score =
      safe(r.openInterest) * 1.0 +
      safe(r.volume) * 0.75 +
      Math.abs(safe(r.gamma)) * 100000 +
      Math.abs(safe(r.oiChange)) * 1.25;

    map.set(strike, (map.get(strike) ?? 0) + score);
  }

  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function estimateAtmStraddle(rows: ZeroDteChainRow[], spot: number) {
  const atm = roundToFive(spot);

  const call = rows.find(
    (r) => r.optionType === "call" && roundToFive(r.strike) === atm
  );

  const put = rows.find(
    (r) => r.optionType === "put" && roundToFive(r.strike) === atm
  );

  const callMid = getMid(call);
  const putMid = getMid(put);

  if (!callMid || !putMid) return null;

  return callMid + putMid;
}

function estimateDealerPressure(rows: ZeroDteChainRow[], spot: number) {
  let pressure = 0;

  for (const r of rows) {
    const distanceWeight = Math.max(0, 1 - Math.abs(r.strike - spot) / 175);
    const gamma = safe(r.gamma);
    const volume = safe(r.volume);
    const oi = safe(r.openInterest);
    const direction = r.optionType === "call" ? 1 : -1;

    pressure += direction * gamma * (oi + volume * 0.75) * distanceWeight;
  }

  return clamp(Math.round(pressure / 1000), -100, 100);
}

function estimatePinScore(args: {
  spxPrice: number;
  callWall: number | null;
  putWall: number | null;
  compositePin: number | null;
  dealerPressure: number;
  expectedMove: number;
}) {
  const { spxPrice, callWall, putWall, compositePin, dealerPressure, expectedMove } =
    args;

  let score = 50;

  if (compositePin) {
    const pinDistance = Math.abs(compositePin - spxPrice);
    score += Math.max(0, 30 - pinDistance / 2);
  }

  if (callWall && putWall) {
    const insideWalls = spxPrice < callWall && spxPrice > putWall;
    if (insideWalls) score += 15;

    const wallWidth = callWall - putWall;
    if (expectedMove > 0 && wallWidth > expectedMove) score += 10;
  }

  if (Math.abs(dealerPressure) < 25) score += 10;
  if (Math.abs(dealerPressure) > 60) score -= 25;

  return clamp(Math.round(score), 0, 100);
}

function centerAdjustment(args: {
  compositePin: number | null;
  dealerPressure: number;
  spxPrice: number;
}) {
  const { compositePin, dealerPressure, spxPrice } = args;

  let adjustment = 0;

  if (compositePin) {
    adjustment += (compositePin - spxPrice) * 0.35;
  }

  adjustment += dealerPressure * 0.15;

  return clamp(adjustment, -30, 30);
}

function estimateSpyConfirmation(args: {
  spxPrice: number;
  spxRows: ZeroDteChainRow[];
  spyAsSpx: ZeroDteChainRow[];
}) {
  const spxPin = strongestPin(args.spxRows);
  const spyPin = strongestPin(args.spyAsSpx);

  if (!spxPin || !spyPin) return "neutral";

  const distance = Math.abs(spxPin - spyPin);

  if (distance <= 10) return "confirming";
  if (distance >= 30) return "conflicting";

  return "neutral";
}

export function getIronFlyManagement({
  spot,
  center,
  wingWidth,
  expectedMove,
  pinScore,
}: {
  spot: number;
  center: number;
  wingWidth: number;
  expectedMove: number;
  pinScore: number;
}) {
  const distance = Math.abs(spot - center);
  const emUsed = expectedMove ? distance / expectedMove : 0;

  if (distance > wingWidth * 0.6) {
    return "High risk. Spot is approaching the long wing.";
  }

  if (emUsed >= 0.75) {
    return "Defensive action. Consider reducing, rolling, or converting structure.";
  }

  if (emUsed >= 0.5) {
    return "Caution. Price has consumed over 50% of expected move.";
  }

  if (emUsed < 0.35 && pinScore >= 60) {
    return "Hold. Price remains inside favorable pin zone.";
  }

  return "Neutral. Continue monitoring.";
}

function buildNotes(args: {
  pinScore: number;
  dealerPressure: number;
  suggestedCenter: number;
  lowerWing: number;
  upperWing: number;
  callWall: number | null;
  putWall: number | null;
  compositePin: number | null;
  spyConfirmation: string;
}) {
  const notes: string[] = [];

  if (args.pinScore >= 70) {
    notes.push("Pin environment favors an iron fly.");
  } else if (args.pinScore <= 40) {
    notes.push("Trend risk elevated. Size smaller or avoid opening immediately.");
  } else {
    notes.push("Mixed environment. Consider waiting for opening range confirmation.");
  }

  if (args.dealerPressure > 30) notes.push("Dealer pressure leans upward.");
  if (args.dealerPressure < -30) notes.push("Dealer pressure leans downward.");

  if (args.spyConfirmation === "confirming") {
    notes.push("SPY confirms SPX positioning.");
  } else if (args.spyConfirmation === "conflicting") {
    notes.push("SPY conflicts with SPX positioning.");
  }

  notes.push(
    `Suggested IF: ${args.lowerWing} / ${args.suggestedCenter} / ${args.upperWing}.`
  );

  return notes.join(" ");
}

function getMid(row?: ZeroDteChainRow) {
  if (!row) return null;
  if (row.mid && row.mid > 0) return row.mid;
  if (row.bid && row.ask) return (row.bid + row.ask) / 2;
  return null;
}

function roundToFive(n: number) {
  return Math.round(n / 5) * 5;
}

function safe(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}