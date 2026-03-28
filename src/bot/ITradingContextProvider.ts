/**
 * Read-only view of active deployments for reconciliation and routing.
 */
export interface ITradingContextProvider {
  getActiveSymbols(): Array<{
    symbol: string;
    deploymentId: string;
    klineInterval: string;
  }>;
}
