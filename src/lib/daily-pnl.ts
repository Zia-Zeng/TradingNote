import { apiRequest } from './api';

export type DailyPnlDay = {
  date: string;
  pnl_by_currency: Record<string, number>;
  total_pnl_base?: number | null;
  pnl_base_currency?: string;
  fx_conversion_complete?: boolean;
  complete: boolean;
  daily_state?: {
    cash_by_currency: Record<string, number>;
    holdings_market_value_by_currency: Record<string, number>;
    total_assets_by_currency: Record<string, number>;
    realized_pnl_by_currency: Record<string, number>;
    realized_pnl_to_date_by_currency: Record<string, number>;
    unrealized_pnl_by_currency: Record<string, number>;
    holding_pnl_by_currency: Record<string, number>;
    positions: Array<{ symbol: string; code: string; market: string; currency: string; quantity: number; average_cost: number; close: number; market_value: number; unrealized_pnl: number }>;
    total_assets_complete?: boolean;
    complete: boolean;
  };
  reason?: string;
  missing_instruments?: Array<{ code: string; symbol: string; market: string }>;
  snapshot_mismatch?: boolean;
};

export type DailyPnlResult = {
  baseline_date: string | null;
  days: DailyPnlDay[];
  month_summary: {
    pnl_by_currency?: Record<string, number>;
    win_days?: number | null;
    loss_days?: number | null;
    best_day?: number | null;
    complete_days?: number;
  };
  warnings: string[];
  incomplete_dates: string[];
  source?: string;
  currency_policy?: string;
};

export type PortfolioOverview = {
  snapshot_date: string | null;
  as_of: string;
  holdings_market_value_by_currency: Record<string, number>;
  holdings_market_value_estimated?: boolean;
};

export const PORTFOLIO_SNAPSHOT_CHANGED = 'tradingnote:portfolio-snapshot-changed';

export type PortfolioSnapshotChangedDetail = { date?: string };

export function notifyPortfolioSnapshotChanged(date?: string) {
  window.dispatchEvent(new CustomEvent<PortfolioSnapshotChangedDetail>(PORTFOLIO_SNAPSHOT_CHANGED, { detail: { date } }));
}

export function getDailyPnl(startDate: string, endDate: string): Promise<DailyPnlResult> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  return apiRequest<DailyPnlResult>(`/api/today/portfolio/pnl?${params.toString()}`);
}

export function getPortfolioOverview(asOf: string): Promise<PortfolioOverview> {
  return apiRequest<PortfolioOverview>(`/api/today/portfolio/overview?as_of=${encodeURIComponent(asOf)}`);
}
