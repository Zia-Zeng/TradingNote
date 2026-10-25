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
    snapshot_mismatch?: boolean;
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
  market_commodities?: Array<{ market: string; name: string; code: string; date: string; close: number | null; change_pct: number | null; source: string | null; status: string }>;
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
  market_breadth?: { status: string; date?: string; up?: number; down?: number; flat?: number | null; source?: string; title?: string; url?: string };
  industry_status?: 'complete' | 'unavailable';
  market_news?: DailyMarketNews[];
  market_news_warning?: string | null;
};

export type DailySummaryBrief = {
  report_type: 'market_portfolio_daily_brief';
  review_date: string;
  overall_status: 'partial' | 'unavailable';
  market: { text: string; indices: Array<{ name: string; change_pct: number; date: string; source?: string | null }>; sectors: Array<{ name: string; change_pct: number; related_holdings: string[]; date: string; source?: string | null }>; commodities?: Array<{ name: string; code: string; close: number; change_pct: number; currency: string; unit: string; date: string; source?: string | null }>; leaders?: Array<{ name: string; change_pct: number }>; laggards?: Array<{ name: string; change_pct: number }>; breadth?: { status: string; date?: string; up?: number; down?: number; flat?: number | null; source?: string; title?: string; url?: string } | null };
  narrative?: { insight?: string; market_narrative?: string; portfolio_narrative?: string };
  portfolio: { status: 'calculated' | 'unavailable' | 'market_closed'; scope: 'imported_portfolio'; amounts: Array<{ currency: string; amount: number }>; daily_return_pct: null; text: string };
  winners: Array<{ name: string; code?: string | null; currency: string; amount: number; status: 'calculated' }>;
  losers: Array<{ name: string; code?: string | null; currency: string; amount: number; status: 'calculated' }>;
  contributions_by_market?: Array<{ market: string; market_name: string; currency: string; winners: Array<{ name: string; code?: string | null; amount: number }>; losers: Array<{ name: string; code?: string | null; amount: number }> }>;
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
  trade_review_mode: 'execution_review' | 'fact_based_review' | 'note_tracking' | 'empty';
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

const MARKET_LABELS: Record<string, string> = {
  '上证指数': 'Shanghai Composite', '上证综指': 'Shanghai Composite',
  '深证成指': 'Shenzhen Component', '创业板指': 'ChiNext', '沪深300': 'CSI 300',
  '恒生指数': 'Hang Seng Index', '标普500': 'S&P 500', '比特币': 'Bitcoin',
  '黄金期货': 'Gold futures', '黄金现货': 'Gold spot',
  '能源': 'Energy', '原材料': 'Materials', '工业': 'Industrials',
  '可选消费': 'Consumer Discretionary', '必需消费': 'Consumer Staples',
  '医疗保健': 'Health Care', '金融': 'Financials', '房地产': 'Real Estate',
  '信息技术': 'Information Technology', '通信服务': 'Communication Services', '公用事业': 'Utilities',
  'A股': 'A-shares', '港股': 'Hong Kong stocks', '美股': 'U.S. stocks', '加密资产': 'Crypto',
};

export function englishMarketLabel(value: string, market?: string): string {
  if (market) return ({ CN: 'A-shares', HK: 'Hong Kong stocks', US: 'U.S. stocks', CRYPTO: 'Crypto' } as Record<string, string>)[market.toUpperCase()] || value;
  return MARKET_LABELS[value] || value;
}

export function dailyMarketText(brief: DailySummaryBrief, facts?: DailySummaryFacts | null): string {
  const indices = [...(brief.market.indices || [])];
  for (const item of facts?.market_benchmarks || []) {
    if (item.status !== 'complete' || item.date !== brief.review_date || item.change_pct == null || !Number.isFinite(item.change_pct)) continue;
    const name = englishMarketLabel(item.name);
    if (!indices.some(existing => englishMarketLabel(existing.name) === name)) {
      indices.push({ name, change_pct: item.change_pct, date: item.date, source: item.source });
    }
  }
  if (indices.length) {
    return `${indices.map(item => `${englishMarketLabel(item.name)} ${item.change_pct > 0 ? '+' : ''}${item.change_pct.toFixed(2)}%`).join(', ')}.`;
  }
  let text = brief.market.text || '';
  for (const [source, label] of Object.entries(MARKET_LABELS)) text = text.split(source).join(label);
  return text.replace(/、/g, ', ').replace(/。$/, '.');
}

export function dailyPortfolioAmounts(review: DailyReview): Array<{ currency: string; amount: number }> {
  const savedAmounts = review.summary_brief?.portfolio?.amounts || [];
  if (savedAmounts.length) return savedAmounts;
  const result = review.summary_facts?.portfolio_result;
  if (!result || result.snapshot_mismatch || !result.pnl_by_currency) return [];
  return Object.entries(result.pnl_by_currency)
    .map(([currency, amount]) => ({ currency, amount }))
    .filter(item => Number.isFinite(item.amount));
}

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
