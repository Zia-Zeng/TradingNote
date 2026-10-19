import { apiRequest } from './api';

export type DailyTradeReview = {
  trade_id: string;
  symbol: string;
  review: string;
  evidence_refs: string[];
};

export type DailyTradeReviewStats = {
  trade_count: number;
  motive_count: number;
  plan_count: number;
  trade_note_count: number;
  daily_note_count: number;
};

export type DailyTradeReviewEvidence = {
  ref_id: string;
  label: string;
  excerpt: string;
};

export type DailySummaryFacts = {
  portfolio_result: {
    date?: string;
    pnl_by_currency?: Record<string, number>;
    attribution?: Array<{
      symbol: string;
      code: string;
      market: string;
      currency: string;
      pnl: number;
      change_pct: number | null;
    }>;
    complete?: boolean;
  } | null;
  portfolio_warnings: string[];
  market_benchmarks: Array<{
    market: string;
    name: string;
    date: string;
    change_pct: number | null;
  }>;
};

export type DailyReview = {
  trade_date: string;
  trade_count: number;
  summary: string | null;
  summary_facts: DailySummaryFacts | null;
  summary_generated_at: string | null;
  trade_reviews: DailyTradeReview[] | null;
  trade_review_overview: string | null;
  trade_review_focus: string[];
  trade_review_stats: DailyTradeReviewStats | null;
  trade_review_evidence: DailyTradeReviewEvidence[];
  trade_reviews_generated_at: string | null;
};

export const DAILY_REVIEW_INPUTS_CHANGED = 'tradingnote:daily-review-inputs-changed';

export function notifyDailyReviewInputsChanged(date: string) {
  window.dispatchEvent(new CustomEvent(DAILY_REVIEW_INPUTS_CHANGED, { detail: { date } }));
}

export function getDailyReview(date: string): Promise<DailyReview | null> {
  return apiRequest<DailyReview | null>(`/api/today/reviews/${encodeURIComponent(date)}`);
}

async function getRequiredDailyReview(date: string): Promise<DailyReview> {
  const review = await getDailyReview(date);
  if (!review) throw new Error('The generated review could not be loaded. Please refresh and try again.');
  return review;
}

export async function generateDailySummary(date: string): Promise<DailyReview> {
  await apiRequest(`/api/today/reviews/${encodeURIComponent(date)}/summary/generate`, { method: 'POST' });
  return getRequiredDailyReview(date);
}

export async function generateTradeReviews(date: string): Promise<DailyReview> {
  await apiRequest(`/api/today/reviews/${encodeURIComponent(date)}/trades/generate`, { method: 'POST' });
  return getRequiredDailyReview(date);
}
