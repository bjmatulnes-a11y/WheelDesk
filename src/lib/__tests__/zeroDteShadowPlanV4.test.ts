import { describe, expect, it } from "vitest";
import { exactLegGeometry } from "../zeroDteShadowRepository";
import { evaluateZeroDteShadowExit } from "../zeroDteShadowTrade";

describe("PLAN shadow-trade isolation", () => {
  it("does not consider different strikes the same plan geometry", () => {
    const plan = [
      { optionType: "call", action: "sell", strike: 7750 },
      { optionType: "call", action: "buy", strike: 7760 },
    ];
    const same = [
      { optionType: "call", action: "buy", strike: 7760 },
      { optionType: "call", action: "sell", strike: 7750 },
    ];
    const different = [
      { optionType: "call", action: "sell", strike: 7745 },
      { optionType: "call", action: "buy", strike: 7755 },
    ];
    expect(exactLegGeometry(plan, same)).toBe(true);
    expect(exactLegGeometry(plan, different)).toBe(false);
  });

  it("keeps the legacy 3x short-leg stop for EXECUTION trades", () => {
    const trade = {
      source: "EXECUTION",
      state: "open",
      entrySellableCredit: 1,
      currentBuybackDebit: 1.5,
      currentShortLegMultiple: 3.1,
      maxFavorableExcursionDollars: 0,
      planTakeProfitPct: null,
      strategy: "call-credit-spread",
      legs: [],
    } as any;
    const exit = evaluateZeroDteShadowExit(trade);
    expect(exit.shouldExit).toBe(true);
    expect(exit.reason).toBe("SHORT_LEG_3X_STOP");
  });

  it("uses the 2x package price stop for PLAN trades", () => {
    const trade = {
      source: "PLAN",
      state: "open",
      entrySellableCredit: 1,
      currentBuybackDebit: 2.05,
      currentShortLegMultiple: 1.2,
      maxFavorableExcursionDollars: 0,
      planTakeProfitPct: 0.5,
      planStopCreditMultiple: 2,
      planGuardPrice: null,
      strategy: "call-credit-spread",
      legs: [],
    } as any;
    const exit = evaluateZeroDteShadowExit(trade);
    expect(exit.shouldExit).toBe(true);
    expect(exit.reason).toBe("PRICE_STOP");
  });
});
