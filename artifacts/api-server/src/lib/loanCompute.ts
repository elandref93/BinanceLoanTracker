import {
  type BinanceClient,
  createMultiplexBinanceClient,
  createRealBinanceClient,
} from "./binance";

// Shared Binance client construction + LTV aggregation, used by both the
// header-driven /api/loans route and the scheduled (credential-driven) job so
// the two never diverge.

export interface PlainBinanceAccount {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
}

export function buildBinanceClient(
  accounts: PlainBinanceAccount[],
): BinanceClient {
  return createMultiplexBinanceClient(
    accounts.map((a) => ({
      account: { id: a.id, name: a.name },
      client: createRealBinanceClient(
        { id: a.id, name: a.name },
        { apiKey: a.apiKey, apiSecret: a.apiSecret },
      ),
    })),
  );
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export type Loans = Awaited<ReturnType<BinanceClient["listLoans"]>>;

export interface LoanSummary {
  asOf: string;
  aggregateLtv: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  loans: Loans;
}

export async function computeLoanSummary(
  client: BinanceClient,
  accountId?: string,
): Promise<LoanSummary> {
  const loans = await client.listLoans(accountId);
  const totalDebtUsd = loans.reduce((s, l) => s + l.debtUsd, 0);
  const totalCollateralUsd = loans.reduce(
    (s, l) => s + l.collateral.valueUsd,
    0,
  );
  const aggregateLtv =
    totalCollateralUsd > 0 ? (totalDebtUsd / totalCollateralUsd) * 100 : 0;
  return {
    asOf: new Date().toISOString(),
    aggregateLtv: round(aggregateLtv, 2),
    totalDebtUsd: round(totalDebtUsd, 2),
    totalCollateralUsd: round(totalCollateralUsd, 2),
    loans,
  };
}
