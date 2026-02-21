export interface PositionSizeParams {
  capital: number;
  riskPerStock: number;
  price: number;
  riskPercentage: number;
  maxAllocation: number;
}

export function calculateQuantity(params: PositionSizeParams): number {
  const { capital, riskPerStock, price, riskPercentage, maxAllocation } = params;

  if (capital <= 0 || riskPerStock <= 0 || price <= 0) return 0;

  const riskBudget = capital * (riskPercentage / 100);
  const maxByRisk = riskBudget / riskPerStock;

  const maxCapitalForTrade = capital * maxAllocation;
  const maxByAllocation = maxCapitalForTrade / price;

  const maxAffordable = capital / price;

  const quantity = Math.min(maxByRisk, maxByAllocation, maxAffordable);
  return Math.max(0, +(quantity.toFixed(2)) - 0.01);
}
