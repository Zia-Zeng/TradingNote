import { apiRequest } from './api';

export type DailyTradeReview = {
  trade_id: string;
  symbol: string;
  title?: string;
  review: string;
  evidence_refs: string[];
  analysis_depth?: 'notes_based' | 'facts_only' | null;
  follow_up_question?: string | null;
};

export type DailyTradeReviewStats = {
  trade_count: number;
  motive_count: number;
  plan_count: number;
  trade_note_count: number;
  daily_note_count: number;
  asset_note_count?: number;
};

export type DailyTradeReviewEvidence = {
  ref_id: string;
  label: string;
  excerpt: string;
};

export type DailySummaryFacts = {
  portfolio_status?: 'complete' | 'partial' | 'unavailable';
  portfolio_scope?: 'full_account' | 'recorded_positions';
  baseline_date?: string | null;
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
    status?: 'complete' | 'no_session' | 'unavailable';
    source?: string | null;
  }>;
  industry_performance?: Array<{
    index_code: string;
    name: string;
    related_symbols: string[];
    classification_as_of: string;
    date: string;
    change_pct: number | null;
    status: 'complete' | 'no_session' | 'unavailable';
    source: string;
    source_url: string;
  }>;
  market_sector_performance?: Array<{ index_code: string; name: string; date: string; change_pct: number | null; status: 'complete' | 'no_session' | 'unavailable'; source?: string }>;
  industry_status?: 'complete' | 'unavailable';
  market_news?: DailyMarketNews[];
  market_news_warning?: string | null;
};

export type DailySummaryBrief = {
  report_type: 'market_portfolio_daily_brief';
  review_date: string;
  overall_status: 'partial' | 'unavailable';
  market: { text: string; indices: Array<{ name: string; change_pct: number; date: string; source?: string | null }>; sectors: Array<{ name: string; change_pct: number; related_holdings: string[]; date: string; source?: string | null }>; leaders?: Array<{ name: string; change_pct: number }>; laggards?: Array<{ name: string; change_pct: number }> };
  narrative?: { market_narrative: string; portfolio_narrative: string; insight: string };
  portfolio: { status: 'calculated' | 'unavailable'; scope: 'imported_portfolio'; amounts: Array<{ currency: string; amount: number }>; daily_return_pct: null; text: string };
  winners: Array<{ name: string; code?: string | null; currency: string; amount: number; status: 'calculated' }>;
  losers: Array<{ name: string; code?: string | null; currency: string; amount: number; status: 'calculated' }>;
  caveats: string[];
};

export type DailyMarketNews = {
  title: string;
  url: string;
  published_date: string | null;
  source: string;
  score?: number | null;
  snippet: string;
};

export type DailyReview = {
  trade_date: string;
  trade_count: number;
  trade_review_mode: 'execution_review' | 'fact_based_review' | 'plan_tracking' | 'empty';
  trade_review_observations: string[];
  summary: string | null;
  summary_brief?: DailySummaryBrief | null;
  summary_source?: 'ai' | 'facts' | null;
  summary_version?: number | null;
  summary_facts: DailySummaryFacts | null;
  summary_generated_at: string | null;
  trade_reviews: DailyTradeReview[] | null;
  trade_review_overview: string | null;
  trade_review_focus: string[];
  trade_review_questions?: string[] | null;
  trade_review_stats: DailyTradeReviewStats | null;
  trade_review_evidence: DailyTradeReviewEvidence[];
  trade_review_trace?: Record<string, unknown> | null;
  trade_reviews_generated_at: string | null;
};

export const DAILY_REVIEW_INPUTS_CHANGED = 'tradingnote:daily-review-inputs-changed';

export function notifyDailyReviewInputsChanged(date: string, kind: 'trade' | 'note' = 'trade') {
  window.dispatchEvent(new CustomEvent(DAILY_REVIEW_INPUTS_CHANGED, { detail: { date, kind } }));
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
