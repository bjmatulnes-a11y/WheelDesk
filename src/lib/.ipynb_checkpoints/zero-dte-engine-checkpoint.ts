export type ZeroDTERegime = "range" | "breakout" | "danger";

export type ZeroDTEPlan = {
  regime: ZeroDTERegime;
  bias: "bullish" | "bearish" | "neutral";

  pin: number | null;
  support: number | null;
  resistance: number | null;
  magnet: number | null;

  expectedMove: number;

  ironFly: {
    center: number | null;
    width: number;
    reasoning: string[];
  };

  putSpread: {
    short: number | null;
    long: number | null;
    reasoning: string[];
  };

  callSpread: {
    short: number | null;
    long: number | null;
    reasoning: string[];
  };

  notes: string[];
};

function roundTo5(x: number) {
  return Math.round(x / 5) * 5;
}

function distancePct(a?: number | null, b?: number | null) {
  if (!a || !b) return 999;
  return Math.abs(a - b) / b;
}

export function buildZeroDTEPlan(args: {
  spot: number;
  support?: number | null;
  resistance?: number | null;
  magnet?: number | null;
  bias: string;
}): ZeroDTEPlan {
  const { spot, support, resistance, magnet, bias } = args;

  const notes: string[] = [];

  // --- expected move proxy ---
  const expectedMove =
    support && resistance ? Math.abs(resistance - support) * 0.35 : spot * 0.01;

  // --- pin ---
  const pin = magnet ?? (support && resistance ? (support + resistance) / 2 : null);

  // --- regime ---
  let regime: ZeroDTERegime = "range";

  if (support && resistance) {
    if (spot > resistance * 1.01 || spot < support * 0.99) {
      regime = "breakout";
    }

    if (distancePct(spot, support) < 0.01 || distancePct(spot, resistance) < 0.01) {
      regime = "danger";
    }
  }

  // --- iron fly ---
  const ironFly = {
    center: pin ? roundTo5(pin) : null,
    width: Math.max(5, Math.round(expectedMove / 5) * 5),
    reasoning: [] as string[]
  };

  if (regime === "range") {
    ironFly.reasoning.push("Market is in range → iron fly is preferred.");
    ironFly.reasoning.push("Center at OI magnet / pin.");
  } else {
    ironFly.reasoning.push("Avoid iron fly outside range regime.");
  }

  // --- put spread ---
  const putSpread = {
    short: support ? roundTo5(support - expectedMove * 0.25) : null,
    long: support ? roundTo5(support - expectedMove * 0.75) : null,
    reasoning: [] as string[]
  };

  putSpread.reasoning.push("Sell below support.");
  if (regime === "breakout" && spot < support!) {
    putSpread.reasoning.push("Breakdown → avoid put spreads.");
  }

  // --- call spread ---
  const callSpread = {
    short: resistance ? roundTo5(resistance + expectedMove * 0.25) : null,
    long: resistance ? roundTo5(resistance + expectedMove * 0.75) : null,
    reasoning: [] as string[]
  };

  callSpread.reasoning.push("Sell above resistance.");
  if (regime === "breakout" && spot > resistance!) {
    callSpread.reasoning.push("Breakout → avoid call spreads.");
  }

  // --- notes ---
  notes.push(`Spot: ${spot.toFixed(2)}`);
  notes.push(`Expected move: ±${expectedMove.toFixed(2)}`);

  if (regime === "range") notes.push("Range regime → premium selling favorable.");
  if (regime === "breakout") notes.push("Breakout regime → directional risk elevated.");
  if (regime === "danger") notes.push("Danger zone → high gamma / avoid entries.");

  return {
    regime,
    bias: bias as any,
    pin,
    support: support ?? null,
    resistance: resistance ?? null,
    magnet: magnet ?? null,
    expectedMove: expectedMove ?? null,
    ironFly,
    putSpread,
    callSpread,
    notes
  };
}