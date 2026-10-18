import { apiRequest } from './api';

export type DailyPnlDay = {
  date: string;
  pnl_by_currency: Record<string, number>;
  complete: boolean;
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

export const PORTFOLIO_SNAPSHOT_CHANGED = 'tradingnote:portfolio-snapshot-changed';

export function notifyPortfolioSnapshotChanged() {
  window.dispatchEvent(new Event(PORTFOLIO_SNAPSHOT_CHANGED));
}

export function getDailyPnl(startDate: string, endDate: string): Promise<DailyPnlResult> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  return apiRequest<DailyPnlResult>(`/api/today/portfolio/pnl?${params.toString()}`);
}
