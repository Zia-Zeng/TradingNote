import { apiRequest } from './api';

export type DailyTradeReview = {
  trade_id: string;
  symbol: string;
  review: string;
};

export type DailyReview = {
  trade_date: string;
  trade_count: number;
  summary: string | null;
  summary_generated_at: string | null;
  trade_reviews: DailyTradeReview[] | null;
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

export function generateDailyReview(date: string): Promise<DailyReview> {
  return getRequiredDailyReview(date);
}

export async function generateDailySummary(date: string): Promise<DailyReview> {
  await apiRequest(`/api/today/reviews/${encodeURIComponent(date)}/summary/generate`, { method: 'POST' });
  return getRequiredDailyReview(date);
}

export async function generateTradeReviews(date: string): Promise<DailyReview> {
  await apiRequest(`/api/today/reviews/${encodeURIComponent(date)}/trades/generate`, { method: 'POST' });
  return getRequiredDailyReview(date);
}
