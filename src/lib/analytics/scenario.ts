export type ScenarioInput = {
  spot: number;
  strike: number;
  premium: number;
  shares: number;
  movePct: number;
};

export function coveredCallScenarioPnl(input: ScenarioInput): number {
  const futurePrice = input.spot * (1 + input.movePct);
  const effectiveExit = Math.min(futurePrice, input.strike);
  const stockPnL = (effectiveExit - input.spot) * input.shares;
  const optionPnL = input.premium * input.shares;
  return stockPnL + optionPnL;
}
