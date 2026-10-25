import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { 
  BotMessageSquare, Send, User, 
  ChevronLeft, BarChart2, BookOpen,
  History, Sparkles, AlertTriangle, Info, FileText, Activity, MessageSquare, LineChart, Target,
  Settings, Play, ArrowLeft, CheckCircle2, Search, X, Loader2, MessageSquarePlus
} from 'lucide-react';
import { 
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Scatter, ReferenceLine,
  PieChart, Pie, Cell, Tooltip
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { readLocalResult, saveLocalResult } from '../lib/saved-results';
import { apiRequest } from '../lib/api';
import { dailyMarketText, dailyPortfolioAmounts, englishMarketLabel, generateDailySummary, generateTradeReviews, getDailyReview, type DailyReview } from '../lib/daily-review';

type ConversationSummary = {
  conversation_id: string;
  title: string;
  updated_at: string;
  message_count: number;
};

type ConversationHistory = {
  conversation_id: string;
  title: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; created_at: string }>;
};

type AgentTradeContext = {
  id?: string;
  symbol: string;
  type: 'Buy' | 'Sell';
  price: number;
  qty: number;
  amount?: string | number;
  note?: string;
  note_tags?: string[];
};

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: React.ReactNode;
}

type InsightsAsset = { symbol: string; code: string | null; market_value?: number | null; share_pct?: number | null; pnl?: number | null; return_pct?: number | null };
type ClosedTradeEvidence = {
  closed_trades: number | string;
  trades_involved: number | string;
  average_holding_days: number | string | null;
  win_rate_pct?: number | null;
  win_rate?: string;
  total_closed_pnl_by_currency?: Record<string, number> | null;
  total_closed_pnl?: string;
};
type BehaviorInsights = {
  conversation_id?: string;
  summary: string;
  style_label?: string;
  style_profile?: { transaction_pace: string; holding_period: string; asset_selection: string; positioning_method: string; trading_type?: string; main_issues: string };
  trading_characteristics?: Array<{ title: string; evidence: string; significance: string }>;
  closed_trade_evidence?: ClosedTradeEvidence;
  profit_structure: { basis: string; commentary: string; charts: Array<{ currency: string; allocation: InsightsAsset[]; returns: InsightsAsset[] }> };
  suggestion: string;
  period_start: string;
  period_end: string;
  holdings_as_of: string | null;
};

const TODAY_PRESET_QUESTION = 'How did my trading go today?';
const REVIEW_PRESET_QUESTION = 'Review my trades in JDF';
const REVIEW_ACTION_QUESTION = 'Review my recent trades';
const INSIGHTS_PRESET_QUESTION = 'Analyze my recent trading patterns';
const DRAFT_PRESET_QUESTION = 'Help me draft a solid investment plan based on my recent holdings.';
const INSIGHTS_MESSAGE_PREFIX = 'BEHAVIOR_INSIGHTS_JSON:';

function dailyReviewAnswer(review: DailyReview): string {
  const sections = [`Daily Trading Review · ${review.trade_date}`];
  const brief = review.summary_brief;
  if (brief) {
    sections.push('Market Performance', dailyMarketText(brief, review.summary_facts));
    if (brief.market.sectors.length) sections.push(...brief.market.sectors.map(item => `${englishMarketLabel(item.name)} ${item.change_pct > 0 ? '+' : ''}${item.change_pct.toFixed(2)}%`));
    if (brief.market.leaders?.length) sections.push(`Leading sectors: ${brief.market.leaders.map(item => `${englishMarketLabel(item.name)} ${item.change_pct > 0 ? '+' : ''}${item.change_pct.toFixed(2)}%`).join(', ')}`);
    if (brief.market.laggards?.length) sections.push(`Lagging sectors: ${brief.market.laggards.map(item => `${englishMarketLabel(item.name)} ${item.change_pct > 0 ? '+' : ''}${item.change_pct.toFixed(2)}%`).join(', ')}`);
    if (brief.market.breadth?.status === 'complete') sections.push(`A-share breadth on ${brief.market.breadth.date}: ${brief.market.breadth.up} advancers, ${brief.market.breadth.down} decliners${brief.market.breadth.flat != null ? `, ${brief.market.breadth.flat} unchanged` : ''}${brief.market.breadth.url ? ` Source: ${brief.market.breadth.url}` : ''}`);
    if (brief.market.commodities?.length) sections.push(...brief.market.commodities.map(item => `${englishMarketLabel(item.name)} ${item.currency}/${item.unit === '盎司' ? 'oz' : item.unit} ${item.close.toFixed(2)} (${item.change_pct > 0 ? '+' : ''}${item.change_pct.toFixed(2)}%)`));
    const portfolioAmounts = dailyPortfolioAmounts(review);
    sections.push('Portfolio Performance', portfolioAmounts.length
      ? portfolioAmounts.map(item => `${item.currency} ${item.amount > 0 ? '+' : ''}${item.amount.toFixed(2)}`).join(' | ')
      : brief.portfolio.status === 'market_closed' ? brief.portfolio.text : 'Verified portfolio P&L is unavailable for this date.');
    if (brief.narrative?.insight) sections.push(brief.narrative.insight);
    if (brief.contributions_by_market?.length) {
      for (const group of brief.contributions_by_market) {
        if (group.winners.length) sections.push(`${englishMarketLabel(group.market_name, group.market)} positive contributors: ${group.winners.map(row => `${row.name} ${group.currency} ${row.amount.toFixed(2)}`).join(', ')}`);
        if (group.losers.length) sections.push(`${englishMarketLabel(group.market_name, group.market)} negative contributors: ${group.losers.map(row => `${row.name} ${group.currency} ${row.amount.toFixed(2)}`).join(', ')}`);
      }
    } else {
      if (brief.winners.length) sections.push(`Positive contributors: ${brief.winners.map(row => `${row.name} ${row.currency} ${row.amount.toFixed(2)}`).join(', ')}`);
      if (brief.losers.length) sections.push(`Negative contributors: ${brief.losers.map(row => `${row.name} ${row.currency} ${row.amount.toFixed(2)}`).join(', ')}`);
    }
    if (brief.caveats.length) sections.push(`Notes: ${brief.caveats.join('; ')}`);
  } else if (review.summary) {
    sections.push('Market & Portfolio Review', review.summary);
  } else {
    sections.push('No market and portfolio review is available yet.');
  }

  sections.push('Trade Review');
  if (review.trade_review_stats) {
    sections.push(`Review inputs: ${review.trade_review_stats.trade_count} trades, ${review.trade_review_stats.trade_note_count} trade notes, and ${review.trade_review_stats.daily_note_count} daily journal entries.`);
  }
  if (review.trade_review_overview) sections.push(review.trade_review_overview);
  if (review.trade_reviews?.length) {
    sections.push(...review.trade_reviews.map(item => `${item.symbol}${item.title ? ` · ${item.title}` : ''}\n${item.review}${item.follow_up_question ? `\nFollow-up: ${item.follow_up_question}` : ''}`));
  }
  if (review.trade_review_observations.length) sections.push(...review.trade_review_observations);
  if (review.trade_review_questions?.length) sections.push(`Questions: ${review.trade_review_questions.slice(0, 2).join('; ')}`);
  if (!review.trade_review_overview && !review.trade_reviews?.length && !review.trade_review_observations.length) {
    sections.push(review.trade_count ? 'No Trade Review is available for this date yet.' : 'No trades were recorded today.');
  }
  return sections.filter(Boolean).join('\n\n');
}

function parseSavedInsights(content: string): BehaviorInsights | null {
  if (!content.startsWith(INSIGHTS_MESSAGE_PREFIX)) return null;
  try {
    const data = JSON.parse(content.slice(INSIGHTS_MESSAGE_PREFIX.length)) as BehaviorInsights;
    return typeof data.summary === 'string' && typeof data.suggestion === 'string'
      && Array.isArray(data.profit_structure?.charts)
      ? data : null;
  } catch {
    return null;
  }
}

const insightColor = (pnl: number | null | undefined) => pnl == null ? '#94a3b8' : pnl > 0 ? '#10b981' : pnl < 0 ? '#ef4444' : '#94a3b8';
const insightAllocationColor = (index: number, total: number) => `hsl(211, 65%, ${(24 + index * 45 / Math.max(total - 1, 1)).toFixed(1)}%)`;
const evidenceNumber = (value: number | string | null | undefined) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = value?.match(/^\s*([+-]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
};
const evidenceInteger = (value: number | null) => value == null ? '-' : value.toLocaleString('en-US', { maximumFractionDigits: 0 });
const evidenceDecimal = (value: number | null) => value == null ? '-' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function InsightsResult({ data }: { data: BehaviorInsights }) {
  const closed = data.closed_trade_evidence;
  const closedTrades = typeof closed?.closed_trades === 'string' && closed.closed_trades.startsWith('No recorded full exits')
    ? 0 : evidenceNumber(closed?.closed_trades);
  const involved = typeof closed?.trades_involved === 'string'
    ? evidenceNumber(closed.trades_involved.match(/;\s*(\d+)\s+trades belong/)?.[1])
    : evidenceNumber(closed?.trades_involved);
  const winRate = evidenceNumber(closed?.win_rate_pct ?? closed?.win_rate);
  const legacyPnl = closed?.total_closed_pnl?.split(';').map(part => part.trim().match(/^([A-Z]{3})\s+([+-]?\d[\d,]*(?:\.\d+)?)/)).filter((match): match is RegExpMatchArray => Boolean(match)) || [];
  const pnlByCurrency = closed?.total_closed_pnl_by_currency
    ? Object.entries(closed.total_closed_pnl_by_currency)
    : legacyPnl.map(match => [match[1], Number(match[2].replace(/,/g, ''))] as [string, number]);
  const evidence: Array<[string, string, string]> = [
    ['All', 'Closed Trades', evidenceInteger(closedTrades)],
    ['All', 'Trades Involved', evidenceInteger(involved)],
    ['All', 'Avg Holding Days', evidenceDecimal(evidenceNumber(closed?.average_holding_days))],
    ['All', 'Win Rate', winRate == null ? '-' : `${evidenceDecimal(winRate)}%`],
    ...(pnlByCurrency.length
      ? pnlByCurrency.map(([currency, amount]): [string, string, string] => [currency, 'Total Closed P&L', evidenceDecimal(amount)])
      : [['All', 'Total Closed P&L', '-'] as [string, string, string]]),
  ];
  const profile = data.style_profile && [
    ['Transaction Pace', data.style_profile.transaction_pace],
    ['Holding Period', data.style_profile.holding_period],
    ['Asset Selection', data.style_profile.asset_selection],
    ['Positioning Method', data.style_profile.positioning_method],
    ...(data.style_profile.trading_type ? [['Trading Type', data.style_profile.trading_type]] : []),
    ['Main Issues', data.style_profile.main_issues],
  ];
  return <div className="w-[280px] max-w-full space-y-3">
    <p className="text-[12px] leading-relaxed text-[#0B2545]">Based on your account and trading records from {data.period_start} to {data.period_end}:</p>
    <div className="bg-white/90 backdrop-blur-md p-3 rounded-xl border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)] relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-[#EE6C4D]" />
      <div className="flex items-center gap-1.5 mb-1.5"><Sparkles size={12} className="text-[#EE6C4D]" /><span className="text-[10px] font-bold text-[#EE6C4D] uppercase tracking-wider">Summary</span></div>
      {data.style_label && <p className="text-[11px] font-bold text-[#0B2545] mb-1">{data.style_label}</p>}
      <p className="text-[11px] text-slate-700 font-medium leading-relaxed">{data.summary}</p>
    </div>
    {profile && <div className="rounded-xl border border-slate-100 bg-white/80 p-3">
      <div className="mb-2 flex items-center gap-1.5"><Activity size={12} className="text-[#0B2545]" /><span className="text-[10px] font-bold uppercase tracking-wider text-[#0B2545]">Style Profile</span></div>
      <div className="space-y-1.5">{profile.map(([label, value]) => <div key={label} className="text-[10px] leading-relaxed"><span className="font-bold text-[#0B2545]">{label}: </span><span className="text-slate-600">{value}</span></div>)}</div>
    </div>}
    <div className="bg-slate-50/80 backdrop-blur-md rounded-xl border border-slate-100 shadow-[0_4px_12px_rgba(11,37,69,0.02)] overflow-hidden">
      <div className="p-2.5 border-b border-slate-100 bg-white/50"><div className="flex items-center gap-1.5"><BookOpen size={12} className="text-[#0B2545]" /><span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Key Evidence</span></div></div>
      <div className="p-2.5"><table className="w-full text-left text-[10px]"><thead><tr className="text-slate-400"><th className="w-[18%] pb-2 font-medium uppercase tracking-wide">Scope</th><th className="w-[52%] pb-2 font-medium uppercase tracking-wide">Metric</th><th className="pb-2 text-right font-medium uppercase tracking-wide">Value</th></tr></thead><tbody className="text-slate-600 align-top">{evidence.map(([scope, metric, value], index) => <tr key={`${metric}-${scope}-${index}`} className="border-t border-slate-100/60"><td className="py-1.5 pr-2 text-slate-500">{scope}</td><td className="py-1.5 pr-2 font-bold text-[#0B2545]">{metric}</td><td className="py-1.5 text-right tabular-nums">{value}</td></tr>)}</tbody></table></div>
    </div>
    <div className="bg-white/80 backdrop-blur-md p-3 rounded-xl border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)]">
      <div className="flex items-center gap-1.5 mb-3"><BarChart2 size={12} className="text-[#0B2545]" /><span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Profit Structure</span></div>
      {data.profit_structure.charts.length === 0 && <p className="text-[10px] text-slate-500">No current holdings snapshot is available for charts.</p>}
      {data.profit_structure.charts.map(chart => {
        const returns = chart.returns.filter(item => item.pnl != null);
        const pieData = chart.allocation.filter(item => item.market_value != null && item.market_value > 0);
        const maxAbsolutePnl = Math.max(0, ...returns.map(item => Math.abs(item.pnl!)));
        return <div key={chart.currency} className="mb-3">
          <p className="text-[10px] font-bold text-[#0B2545] mb-1">{chart.currency} holdings{data.holdings_as_of ? ` · ${data.holdings_as_of}` : ''}</p>
          <div className="grid grid-cols-2 gap-2 items-start">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold text-slate-500">Allocation</p>
              {pieData.length > 0 ? <>
                <div className="h-24"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="market_value" nameKey="symbol" cx="50%" cy="50%" innerRadius={17} outerRadius={40} stroke="#fff" strokeWidth={1}>{pieData.map((item, index) => <Cell key={item.code || item.symbol} fill={insightAllocationColor(index, pieData.length)} />)}</Pie><Tooltip formatter={(value: number) => `${chart.currency} ${value.toLocaleString('en-US')}`} /></PieChart></ResponsiveContainer></div>
                <div className="space-y-1">{chart.allocation.map(item => {
                  const index = pieData.findIndex(value => value.code === item.code && value.symbol === item.symbol);
                  return <div key={item.code || item.symbol} className="flex items-start gap-1 text-[9px] text-slate-600"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: index >= 0 ? insightAllocationColor(index, pieData.length) : '#94a3b8' }} /><span className="min-w-0 flex-1 break-words">{item.symbol}</span><span className="font-mono shrink-0">{item.share_pct == null ? '—' : `${item.share_pct.toFixed(1)}%`}</span></div>;
                })}</div>
              </> : <p className="mt-2 text-[9px] text-slate-500">Market values are unavailable.</p>}
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold text-slate-500">Holding P/L</p>
              {returns.length > 0 ? <div className="mt-2 space-y-2.5">{returns.map(item => <div key={item.code || item.symbol} className="min-w-0">
                <p className="truncate text-[9px] font-medium text-[#0B2545]" title={item.symbol}>{item.symbol}</p>
                <div className="mt-1 h-2.5 w-full overflow-hidden rounded-r bg-slate-100" role="img" aria-label={`${item.symbol}: ${item.pnl! >= 0 ? 'gain' : 'loss'} ${chart.currency} ${Math.abs(item.pnl!).toLocaleString('en-US')}`}><div className="h-full rounded-r" style={{ width: maxAbsolutePnl > 0 ? `${Math.abs(item.pnl!) / maxAbsolutePnl * 100}%` : '0%', backgroundColor: insightColor(item.pnl) }} /></div>
                <p className="mt-0.5 text-[9px] font-mono leading-tight" style={{ color: insightColor(item.pnl) }}>{item.pnl! >= 0 ? '+' : ''}{chart.currency} {item.pnl!.toLocaleString('en-US')}<br />{item.return_pct == null ? 'Return unavailable' : `${item.return_pct >= 0 ? '+' : ''}${item.return_pct.toFixed(1)}%`}</p>
              </div>)}</div> : <p className="mt-2 text-[9px] text-slate-500">Average cost or market value is unavailable.</p>}
            </div>
          </div>
        </div>;
      })}
      <div className="bg-[#0B2545]/5 p-2 rounded-lg border border-[#0B2545]/10"><span className="text-[10px] font-bold text-[#0B2545] block mb-0.5">Profit Summary:</span><p className="text-[10px] text-slate-600 leading-relaxed font-medium">{data.profit_structure.commentary}</p><p className="text-[9px] text-slate-500 mt-1">Holding P/L{data.holdings_as_of ? ` as of ${data.holdings_as_of}` : ''} versus average cost; allocation excludes cash.</p></div>
    </div>
    {data.trading_characteristics && data.trading_characteristics.length > 0 && <div className="rounded-xl border border-slate-100 bg-white/80 p-3">
      <div className="mb-2 flex items-center gap-1.5"><Target size={12} className="text-[#0B2545]" /><span className="text-[10px] font-bold uppercase tracking-wider text-[#0B2545]">Trading Characteristics</span></div>
      <div className="space-y-2.5">{data.trading_characteristics.map((item, index) => <div key={`${item.title}-${index}`} className="text-[10px] leading-relaxed">
        <p className="font-bold text-[#0B2545]">{index + 1}. {item.title}</p>
        <p className="text-slate-600">{item.evidence}</p>
        <p className="font-bold text-[#0B2545]">{item.significance}</p>
      </div>)}</div>
    </div>}
    <div className="bg-[#0B2545] p-3 rounded-xl border border-[#0B2545] shadow-lg relative overflow-hidden"><div className="absolute -right-6 -top-6 w-24 h-24 bg-white/5 rounded-full blur-2xl pointer-events-none" /><div className="flex items-center gap-1.5 mb-1.5 relative z-10"><User size={12} className="text-[#EE6C4D]" /><span className="text-[10px] font-bold text-white uppercase tracking-wider">Suggestion</span></div><p className="text-[11px] text-slate-300 leading-relaxed font-medium relative z-10">{data.suggestion}</p></div>
  </div>;
}

function AgentInline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-bold text-[#0B2545]">{part.slice(2, -2)}</strong>;
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    return link
      ? <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#EE6C4D] underline break-all">{link[1]}</a>
      : part;
  })}</>;
}

const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
const tableRow = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|');
const tableDivider = (line: string) => tableRow(line) && tableCells(line).every(cell => /^:?-{3,}:?$/.test(cell));
const hiddenMarketBackgroundLabel = (value: string) => /^(source\s*\/\s*as\s*of|frequency\s*\/\s*adjustment|data continuity note)(?:\s*:|\s*$)/i
  .test(value.replace(/\*\*/g, '').replace(/^[-*]\s*/, '').trim());
const formatMarketBackground = (value: string) => value.replace(/\*{0,2}Not applicable;\s*no exit recorded\*{0,2}/gi, '-');
const MARKET_INDICATORS = ['Starting Close', 'Lowest Close', 'Highest Close', 'Ending Close', 'Period Return', 'Entry Day Change', 'Exit Day Change'] as const;
const marketIndicatorName = (value: string): typeof MARKET_INDICATORS[number] | null => {
  const label = value.replace(/[\*_`]/g, '').trim().toLowerCase();
  if (/^(starting clos|range start clos)/.test(label)) return 'Starting Close';
  if (/^lowest clos/.test(label)) return 'Lowest Close';
  if (/^highest clos/.test(label)) return 'Highest Close';
  if (/^ending clos/.test(label)) return 'Ending Close';
  if (/^(period return|price change over (?:the |supplied )?period)/.test(label)) return 'Period Return';
  if (/^(entry day change|first entry day change|price change on position-opening date)/.test(label)) return 'Entry Day Change';
  if (/^(exit day change|price change on final exit date)/.test(label)) return 'Exit Day Change';
  return null;
};
const marketChangeColor = (value: string) => {
  const match = value.replace(/[−–]/g, '-').match(/([+-]?)\s*(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const change = Number(`${match[1]}${match[2]}`);
  return change > 0 ? 'text-emerald-700' : change < 0 ? 'text-rose-700' : null;
};

function suggestionNote(text: string): string | null {
  const heading = /^#{1,3}\s*Suggestion\s*$/im.exec(text);
  if (!heading) return null;
  const following = text.slice(heading.index + heading[0].length);
  const nextHeading = /^#{1,3}\s*\S/m.exec(following);
  const section = (nextHeading ? following.slice(0, nextHeading.index) : following).trim();
  if (!section) return null;

  const lines = section.split(/\r?\n/).map(line => line.trim());
  const headerIndex = lines.findIndex((line, index) => tableRow(line) && index + 1 < lines.length && tableDivider(lines[index + 1]));
  if (headerIndex < 0) return `Review Trades · Suggestions\n\n${section.replace(/\*\*/g, '')}`;

  const headers = tableCells(lines[headerIndex]).map(header => header.toLowerCase());
  const scenarioIndex = headers.findIndex(header => header.includes('scenario'));
  const signalIndex = headers.findIndex(header => header.startsWith('signal'));
  const planIndex = headers.findIndex(header => header.includes('response plan'));
  if (scenarioIndex < 0 || signalIndex < 0 || planIndex < 0) return `Review Trades · Suggestions\n\n${section.replace(/\*\*/g, '')}`;
  const entries = lines.slice(headerIndex + 2).filter(tableRow).map(line => {
    const row = tableCells(line);
    const title = `Future scenario: ${row[scenarioIndex] || 'Scenario'}`;
    const signal = `Signal: ${row[signalIndex] || 'Not specified'}`;
    const plan = `Response plan: ${row[planIndex] || 'Not specified'}`;
    return [title, signal, plan].join('\n');
  });
  const introduction = lines.slice(0, headerIndex).filter(Boolean).join(' ').replace(/\*\*/g, '');
  return ['Review Trades · Suggestions', introduction, ...entries].filter(Boolean).join('\n\n');
}

const reviewAssetKey = (value: string) => value.normalize('NFKC').trim().toUpperCase()
  .replace(/\.(SH|SZ|BJ)$/, '').replace(/[\s._-]+/g, '');

function ReviewNotesButton({ note, asset }: { note: string; asset: string }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [savedRoute, setSavedRoute] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addToNotes = async () => {
    if (saving || savedRoute) return;
    setSaving(true);
    setError(null);
    try {
      if (note.length > 2000) throw new Error('The combined suggestion exceeds the 2,000-character note limit.');
      const trades = await apiRequest<Array<{ symbol: string; code?: string | null }>>('/api/trades');
      const query = reviewAssetKey(asset);
      const exact = trades.find(trade => [trade.symbol, trade.code].some(value => value && reviewAssetKey(value) === query));
      const partial = trades.find(trade => [trade.symbol, trade.code].some(value => value && query.length >= 3 && (reviewAssetKey(value).includes(query) || query.includes(reviewAssetKey(value)))));
      const trade = exact || partial;
      if (!trade) throw new Error('No saved trades match this asset. Check the asset name or code.');
      const code = trade.code?.trim();
      const assetKey = code ? `code:${code}` : `symbol:${trade.symbol.trim().toUpperCase()}`;
      const queryString = new URLSearchParams({ asset_key: assetKey });
      const existing = await apiRequest<Array<{ content: string; source: string }>>(`/api/asset-notes?${queryString}`);
      if (!existing.some(item => item.content === note && item.source === 'ai_review')) {
        await apiRequest('/api/asset-notes', {
          method: 'POST',
          body: JSON.stringify({ asset_key: assetKey, content: note, source: 'ai_review' }),
        });
      }
      setSavedRoute(code || trade.symbol.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the suggestion. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col items-center gap-2 border-t border-slate-100 pt-3 text-center">
      <button onClick={() => void addToNotes()} disabled={saving || Boolean(savedRoute)} className="rounded-lg bg-[#0B2545] px-4 py-2 text-[11px] font-bold text-white shadow-sm disabled:bg-emerald-50 disabled:text-emerald-700">
        {saving ? 'Saving…' : savedRoute ? 'Added to My notes' : 'Add to my notes'}
      </button>
      {savedRoute && <button onClick={() => navigate(`/detail/${encodeURIComponent(savedRoute)}?scroll=notes-section`)} className="text-[10px] font-semibold text-[#EE6C4D] underline">View in Tracking</button>}
      {error && <p role="alert" className="text-[10px] text-rose-600">{error}</p>}
    </div>
  );
}

function AgentMarkdown({ text, reviewAsset }: { text: string; reviewAsset?: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  const isReviewReply = Boolean(reviewAsset && /^#{1,3}\s+Overview\s*$/im.test(text));
  let activeSection: { name: string; items: React.ReactNode[] } | null = null;
  let index = 0;
  let highlightConclusion = false;
  let section = '';

  const addBlock = (block: React.ReactNode) => {
    if (activeSection) activeSection.items.push(block);
    else blocks.push(block);
  };
  const finishSection = () => {
    if (!activeSection) return;
    const current = activeSection;
    const conclusion = current.name === 'conclusion';
    blocks.push(
      <section key={`section-${blocks.length}`} className={cn(
        'mb-3 rounded-xl border px-3 py-3 shadow-sm',
        conclusion ? 'border-slate-100 border-l-4 border-l-[#EE6C4D]' : 'border-slate-200',
      )}>
        {current.items}
      </section>
    );
    activeSection = null;
  };

  const cells = tableCells;
  const isTableRow = tableRow;
  const isTableDivider = tableDivider;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^#{1,3}\s*(\S.*)$/);
    if (heading) {
      section = heading[1].trim().toLowerCase().replace(/\s+/g, ' ');
      if (section === 'marketing background') section = 'market background';
      if (section === 'your traiding action') section = 'your trading action';
      finishSection();
      highlightConclusion = !isReviewReply && section === 'conclusion';
      if (isReviewReply && ['conclusion', 'overview', 'market background', 'your trading action', 'detail', 'suggestion'].includes(section)) {
        activeSection = { name: section, items: [] };
        const icon = section === 'conclusion' ? <Sparkles size={15} />
          : section === 'overview' ? <BarChart2 size={14} />
            : section === 'market background' ? <LineChart size={14} />
              : section === 'your trading action' ? <Activity size={14} />
                : section === 'detail' ? <FileText size={14} /> : <Target size={14} />;
        addBlock(<h3 key={`h-${index}`} className={cn(
          'mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em]',
          section === 'conclusion' ? 'text-[#EE6C4D]' : 'text-[#0B2545]',
        )}>{icon}{heading[1]}</h3>);
      } else {
        blocks.push(<h3 key={`h-${index}`} className="mt-3 mb-1 text-[12px] font-bold text-[#0B2545]">{heading[1]}</h3>);
      }
      index += 1;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = section === 'market background' ? ['Indicator', 'Value'] : cells(line);
      const actionColumn = headers.findIndex(header => header.toLowerCase() === 'action');
      const displayHeaders = headers.map(header => header.toLowerCase() === 'signal to watch' ? 'Signal' : header);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && isTableRow(lines[index].trim())) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      const marketValues = new Map<string, string>();
      if (section === 'market background') rows.forEach(row => {
        const indicator = marketIndicatorName(row[0] || '');
        if (indicator && !marketValues.has(indicator)) marketValues.set(indicator, formatMarketBackground(row[1] || '-'));
      });
      const visibleRows = section === 'market background'
        ? MARKET_INDICATORS.map(indicator => [indicator, marketValues.get(indicator) || '-'])
        : rows;
      addBlock(
        <div key={`t-${index}`} className="my-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className={cn('min-w-full text-left text-[10px]', section === 'suggestion' ? 'w-full table-fixed' : 'w-max')}>
            <thead className="bg-slate-50 text-slate-600"><tr>{displayHeaders.map((header, cellIndex) => <th key={cellIndex} className={cn('px-2 py-1.5 font-bold', section === 'overview' && /^(date|fill price|amount)$/i.test(header) && 'whitespace-nowrap', section === 'suggestion' && 'whitespace-normal break-words')}>{header}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">{visibleRows.map((row, rowIndex) => {
              const action = actionColumn >= 0 ? (row[actionColumn] || '').trim().toLowerCase() : '';
              const actionColor = ['buy', 'b', '买入'].includes(action)
                ? 'text-emerald-700'
                : ['sell', 's', '卖出'].includes(action)
                  ? 'text-rose-700'
                  : 'text-slate-700';
              return <tr key={rowIndex}>{headers.map((header, cellIndex) => {
                const normalizedHeader = header.toLowerCase();
                const color = normalizedHeader === 'action' || normalizedHeader.includes('price') || normalizedHeader.includes('amount') ? actionColor : 'text-slate-700';
                const value = row[cellIndex] || '—';
                const changeColor = section === 'market background' && cellIndex > 0 && ['Period Return', 'Entry Day Change', 'Exit Day Change'].includes(row[0] || '')
                  ? marketChangeColor(value) : null;
                return <td key={cellIndex} className={cn('px-2 py-1.5 align-top', changeColor || color, section === 'overview' && /^(date|fill price|amount)$/i.test(header) && 'whitespace-nowrap', section === 'suggestion' && 'whitespace-normal break-words', section === 'suggestion' && normalizedHeader.includes('scenario') && 'font-bold text-[#0B2545]')}>{section === 'market background' ? formatMarketBackground(value) : value}</td>;
              })}</tr>;
            })}</tbody>
          </table>
        </div>
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s*\S/.test(lines[index].trim()) && !isTableRow(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    const paragraphText = (section === 'market background'
      ? paragraph.filter(line => !hiddenMarketBackgroundLabel(line)).map(formatMarketBackground)
      : paragraph).join(' ');
    if (!paragraphText) continue;
    const detailDate = section === 'detail' ? paragraphText.match(/^(?:[-*]\s*)?(?:\*\*)?(\d{4}-\d{2}-\d{2}):?(?:\*\*)?:?\s*(.*)$/) : null;
    if (detailDate) {
      addBlock(
        <div key={`p-${index}`} className="mb-2.5 border-b border-slate-100 pb-2.5 last:border-b-0">
          <div className="text-[11px] font-bold text-[#0B2545]">{detailDate[1]}:</div>
          <p className="mt-1 text-[11px] leading-relaxed whitespace-pre-wrap"><AgentInline text={detailDate[2]} /></p>
        </div>
      );
    } else if (highlightConclusion) {
      addBlock(
        <div key={`p-${index}`} className="my-2 rounded-lg border border-[#EE6C4D]/25 border-l-4 border-l-[#EE6C4D] bg-[#EE6C4D]/10 px-3 py-2.5 shadow-sm">
          <p className="text-[11px] font-medium leading-relaxed text-[#0B2545]"><AgentInline text={paragraphText} /></p>
        </div>
      );
      highlightConclusion = false;
    } else {
      addBlock(<p key={`p-${index}`} className={cn('mb-1.5 whitespace-pre-wrap', activeSection?.name === 'conclusion' ? 'text-[12px] leading-[1.65] text-slate-700' : 'text-[11px] leading-relaxed')}><AgentInline text={paragraphText} /></p>);
    }
  }
  finishSection();

  const note = isReviewReply ? suggestionNote(text) : null;
  return <div className="w-[280px] max-w-full text-slate-700">{blocks}{note && reviewAsset && <ReviewNotesButton note={note} asset={reviewAsset} />}</div>;
}

type TickerCandidate = { code: string; name: string; market: string };

type BacktestResult = {
  strategy: string;
  ticker: string;
  start_date: string;
  end_date: string;
  as_of: string;
  months: number;
  cached: boolean;
  stats: { return_pct: number; max_drawdown_pct: number; closed_trades: number; winning_trades: number; win_rate_pct: number | null };
  chart: Array<{ date: string; return_pct: number }>;
  chart_error: string | null;
  trades: Array<{ date: string; time: string; side: 'buy' | 'sell'; price: number; quantity: number }>;
};

const savedBacktestKey = 'tradingnote:backtest-tasks';

function readSavedBacktestTasks(): any[] {
  const stored = readLocalResult<any[]>(savedBacktestKey) || [];
  return stored.filter(task => task?.result?.stats && typeof task.result.stats.return_pct === 'number')
    .map(task => ({
      id: task.id, strategy: task.strategy, ticker: task.ticker, savedAt: task.savedAt,
      result: { months: task.result.months || 36, stats: task.result.stats },
    }));
}

const inFlightBacktests = new Map<string, Promise<BacktestResult>>();

function runBacktest(strategy: string, ticker: string, months: number): Promise<BacktestResult> {
  const key = `${strategy}:${ticker}:${months}`;
  let request = inFlightBacktests.get(key);
  if (!request) {
    request = apiRequest<BacktestResult>('/api/backtest/run', { method: 'POST', body: JSON.stringify({ strategy, ticker, months }) });
    inFlightBacktests.set(key, request);
    void request.finally(() => { if (inFlightBacktests.get(key) === request) inFlightBacktests.delete(key); }).catch(() => {});
  }
  return request;
}

const STRATEGIES = [
  { id: 'sma', name: 'SMA Crossover', logic: 'Catch trend change via moving average crossing', buyDesc: 'SMA20 crosses above SMA50', sellDesc: 'SMA20 crosses below SMA50' },
  { id: 'rsi', name: 'RSI Bounce', logic: 'Trade overbought / oversold momentum', buyDesc: 'RSI(14) < 30 then rebounds above 30', sellDesc: 'RSI(14) > 70 then falls below 70' },
  { id: 'macd', name: 'MACD Divergence', logic: 'Spot weakening price momentum', buyDesc: 'Bullish divergence + MACD crosses signal', sellDesc: 'Bearish divergence + MACD crosses signal' },
  { id: 'bollinger', name: 'Bollinger Band Breakout', logic: 'Low volatility squeeze precedes big move', buyDesc: 'Band squeeze + price closes above upper band', sellDesc: 'Price closes below lower band' },
  { id: 'volume', name: 'Volume Confirmed Breakout', logic: 'Volume confirms valid breakout', buyDesc: 'Price breaks resistance, vol ≥ 1.5x avg', sellDesc: 'Price breaks support, volume spikes' }
];

const BACKTEST_PERIODS = [
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
  { months: 36, label: '3 years' },
];

const BuyMarker = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload || payload.buyReturn === undefined) return null;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect x={-8} y={-20} width={16} height={12} fill="#10b981" rx={2} />
      <text x={0} y={-14} fill="white" fontSize={8} textAnchor="middle" dominantBaseline="central" fontWeight="bold">B</text>
      <path d="M -3 -8 L 0 -5 L 3 -8 Z" fill="#10b981" />
    </g>
  )
}

const SellMarker = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload || payload.sellReturn === undefined) return null;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect x={-8} y={8} width={16} height={12} fill="#ef4444" rx={2} />
      <text x={0} y={14} fill="white" fontSize={8} textAnchor="middle" dominantBaseline="central" fontWeight="bold">S</text>
      <path d="M -3 8 L 0 5 L 3 8 Z" fill="#ef4444" />
    </g>
  )
}

const Thinking = () => (
  <div className="flex items-center gap-1.5 p-1 h-[20px]">
    <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] animate-bounce" style={{ animationDelay: '0ms' }} />
    <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] animate-bounce" style={{ animationDelay: '150ms' }} />
    <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] animate-bounce" style={{ animationDelay: '300ms' }} />
  </div>
);

export default function Agent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tradeId = searchParams.get('trade');
  const action = searchParams.get('action');
  const step = searchParams.get('step');
  const tab = searchParams.get('tab') || 'chat';
  const backtestStep = searchParams.get('bt_step');
  const backtestStrategy = searchParams.get('strategy') || '';
  const backtestTicker = searchParams.get('ticker') || '';
  const requestedMonths = Number(searchParams.get('months'));
  const backtestMonths = BACKTEST_PERIODS.some(period => period.months === requestedMonths) ? requestedMonths : 36;
  const reference = searchParams.get('ref');
  const isAssetReference = Boolean(reference?.startsWith('detail-'));
  const isDailyReference = Boolean(reference && /^daily-\d{4}-\d{2}-\d{2}$/.test(reference));
  const draftAsset = searchParams.get('asset') || 'ZIJIN MINING';
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [insightsAttempt, setInsightsAttempt] = useState(0);
  const [savedTracking, setSavedTracking] = useState(false);
  const [savedPlan, setSavedPlan] = useState(false);
  const [savedTask, setSavedTask] = useState(false);
  const [savedTasks, setSavedTasks] = useState<any[]>(readSavedBacktestTasks);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [tickerLookup, setTickerLookup] = useState<{ query: string; candidates: TickerCandidate[]; failed?: boolean } | null>(null);
  const [tickerLookupLoading, setTickerLookupLoading] = useState(false);
  const tickerLookupRequestRef = useRef(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingConversation, setLoadingConversation] = useState<string | null>(null);
  const chatSessionRef = useRef(0);
  const chatRequestRef = useRef<{ session: number; input: string; body: string | null } | null>(null);
  const chatInFlightRef = useRef<number | null>(null);
  const skipNextRouteSyncRef = useRef(false);
  
  const navigate = useNavigate();
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const keepAtBottomRef = useRef(true);

  useEffect(() => {
    const tasks = readSavedBacktestTasks();
    saveLocalResult(savedBacktestKey, tasks);
    setSavedTasks(tasks);
  }, []);

  useEffect(() => {
    if (tab !== 'backtest' || backtestStep !== '3' || !backtestStrategy || !backtestTicker) return;
    let active = true;
    setBacktestResult(null);
    setBacktestError(null);
    setBacktestLoading(true);
    void runBacktest(backtestStrategy, backtestTicker, backtestMonths).then(result => {
      if (active) setBacktestResult(result);
    }).catch(error => {
      if (active) setBacktestError(error instanceof Error ? error.message : 'Backtest failed. Please retry.');
    }).finally(() => {
      if (active) setBacktestLoading(false);
    });
    return () => { active = false; };
  }, [tab, backtestStep, backtestStrategy, backtestTicker, backtestMonths]);

  useEffect(() => {
    if (tab !== 'backtest' || backtestStep !== '1') {
      tickerLookupRequestRef.current += 1;
      setTickerLookup(null);
      setTickerLookupLoading(false);
    }
  }, [tab, backtestStep]);

  useEffect(() => {
    keepAtBottomRef.current = true;
  }, [tab, backtestStep, backtestStrategy, backtestTicker, backtestMonths, searchParams.get('task_detail')]);

  useEffect(() => {
    // Preserve the session for internal review routing and history restoration.
    if (skipNextRouteSyncRef.current) return;
    chatSessionRef.current += 1;
    chatRequestRef.current = null;
    chatInFlightRef.current = null;
    setConversationId(null);
    setSendError(null);
    setIsSending(false);
  }, [searchParams]);

  useEffect(() => {
    if (skipNextRouteSyncRef.current) {
      skipNextRouteSyncRef.current = false;
      return;
    }
    if (tab === 'backtest') {
      const btStep = searchParams.get('bt_step');
      const strat = searchParams.get('strategy');
      const tick = searchParams.get('ticker');
      const showDetail = searchParams.get('task_detail');

      const msgs: Message[] = [];
      
      const presetMsg = (
        <div className="w-[260px] max-w-full">
          <p className="mb-2 text-[12px] leading-relaxed">Select one of the five strategies to backtest:</p>
          <div className="space-y-2">
            {STRATEGIES.map(s => (
              <div 
                key={s.id}
                onClick={() => setSearchParams({ tab: 'backtest', bt_step: '1', strategy: s.id })}
                className="p-2.5 rounded-xl border border-slate-200 bg-white active:bg-slate-50 cursor-pointer shadow-sm relative overflow-hidden"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#EE6C4D] opacity-0 transition-opacity" />
                <div className="font-bold text-[12px] text-[#0B2545]">{s.name}</div>
                <div className="text-[10px] text-slate-500 mt-1">{s.logic}</div>
              </div>
            ))}
          </div>
        </div>
      );

      msgs.push({ id: 'bt_0', role: 'agent', content: presetMsg });

      if (btStep || showDetail) {
        const selectedStrat = STRATEGIES.find(s => s.id === strat);
        msgs.push({ id: 'bt_u1', role: 'user', content: `Let's test ${selectedStrat?.name || 'the strategy'}` });
        msgs.push({ id: 'bt_a1', role: 'agent', content: "Great! Enter an A-share code, a US ticker, or a stock name in Chinese or English (e.g., 601899, AAPL, or 京东方)." });
      }

      if (btStep === '1' && tickerLookup) {
        msgs.push({ id: 'bt_u2', role: 'user', content: tickerLookup.query });
        const lookupMsg = tickerLookupLoading ? (
          <p className="text-[12px] leading-relaxed">Looking up "{tickerLookup.query}"…</p>
        ) : tickerLookup.candidates.length > 0 ? (
          <div className="w-[260px] max-w-full">
            <p className="mb-2 text-[12px] leading-relaxed">I found these matches. Tap one to backtest it:</p>
            <div className="space-y-1.5">
              {tickerLookup.candidates.map(candidate => (
                <button
                  key={candidate.code}
                  type="button"
                  onClick={() => {
                    tickerLookupRequestRef.current += 1;
                    setTickerLookup(null);
                    setTickerLookupLoading(false);
                    setSearchParams({ tab: 'backtest', bt_step: '2', strategy: strat || 'sma', ticker: candidate.code, name: candidate.name });
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-sm active:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold text-[#0B2545]">{candidate.name}</span>
                    <span className="block text-[10px] text-slate-500">{candidate.market === 'CN' ? 'A-share' : candidate.market === 'US' ? 'US stock' : candidate.market}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-bold text-[#EE6C4D]">{candidate.code}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p role="alert" className="text-[12px] leading-relaxed text-rose-700">
            {tickerLookup.failed
              ? 'Could not look up that name. Please try again, or enter a code such as 601899 or AAPL.'
              : `No A-share or US stock matched "${tickerLookup.query}". Try the full name, or enter a code such as 601899 or AAPL.`}
          </p>
        );
        msgs.push({ id: 'bt_a2', role: 'agent', content: lookupMsg });
      }

      if (btStep === '2' || btStep === '3' || showDetail) {
        const tickerName = searchParams.get('name');
        msgs.push({ id: 'bt_u2', role: 'user', content: tickerName ? `${tickerName} (${tick})` : (tick || '') });

        const configMsg = (
          <div className="w-[240px] max-w-full">
            <p className="mb-2 text-[12px] leading-relaxed">I've formulated your backtest configuration:</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 shadow-inner">
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Strategy</div>
              <div className="text-[12px] font-bold text-[#0B2545] mb-2.5">{STRATEGIES.find(s => s.id === strat)?.name}</div>
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Target Ticker</div>
              <div className="text-[12px] font-bold text-[#0B2545]">
                {tickerName && <span className="mr-1.5">{tickerName}</span>}
                <span className="font-mono uppercase">{tick}</span>
              </div>
            </div>
            {btStep === '2' ? (
              <div className="mb-2">
                <div className="mb-1.5 text-[10px] font-bold text-slate-500">Backtest period</div>
                <div className="grid grid-cols-3 gap-1">
                  {BACKTEST_PERIODS.map(period => (
                    <button key={period.months} type="button" onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.set('months', String(period.months));
                      setSearchParams(next);
                    }} className={cn('rounded-md border px-1 py-1.5 text-[10px] font-bold', backtestMonths === period.months ? 'border-[#0B2545] bg-[#0B2545] text-white' : 'border-slate-200 bg-white text-slate-600')}>
                      {period.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[9px] text-slate-500">Shorter periods use fewer daily bars; market data retrieval may still take time.</p>
              </div>
            ) : (
              <div className="mb-2 flex items-center justify-between text-[10px] text-slate-500">
                <span>Period: {BACKTEST_PERIODS.find(period => period.months === backtestMonths)?.label}</span>
                <button type="button" className="font-bold text-[#0B2545] underline" onClick={() => setSearchParams({ tab: 'backtest', bt_step: '2', strategy: strat || 'sma', ticker: tick || '', months: String(backtestMonths) })}>Change</button>
              </div>
            )}
            {btStep === '2' && (
              <button 
                onClick={() => setSearchParams({ tab: 'backtest', bt_step: '3', strategy: strat || 'sma', ticker: tick || '', months: String(backtestMonths) })}
                className="w-full bg-[#0B2545] text-white py-2 rounded-lg text-[12px] font-bold active:bg-[#134074] shadow-sm flex items-center justify-center gap-1.5"
              >
                <Play size={12} fill="currentColor" /> Run Test
              </button>
            )}
          </div>
        );
        msgs.push({ id: 'bt_a2', role: 'agent', content: configMsg });
      }

      if (btStep === '3' || showDetail) {
        const taskKey = `${strat}-${tick}-${backtestMonths}`;
        const existingTasks = readSavedBacktestTasks();
        setSavedTask(existingTasks.some(task => task.id === taskKey));
        if (backtestLoading) {
          msgs.push({ id: 'bt_a3', role: 'agent', content: <div className="flex items-center gap-2 text-[12px]"><Loader2 size={14} className="animate-spin" />Running the backtest. This may take a few minutes…</div> });
        } else if (backtestError) {
          msgs.push({ id: 'bt_a3', role: 'agent', content: <p role="alert" className="text-[12px] text-rose-700">{backtestError}</p> });
        } else if (backtestResult) {
          const stats = backtestResult.stats;
          const resultMsg = (
            <div className="w-[240px] max-w-full">
              <p className="mb-2 text-[12px] leading-relaxed">Backtest completed{backtestResult.cached ? ' · cached result' : ''} · {backtestResult.start_date} to {backtestResult.as_of}</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="bg-emerald-50 border border-emerald-100 p-2.5 rounded-lg shadow-sm">
                  <div className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider mb-0.5">Win Rate</div>
                  <div className="text-[14px] font-bold font-mono text-emerald-700">{stats.win_rate_pct === null ? '—' : `${stats.win_rate_pct}%`}</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 p-2.5 rounded-lg shadow-sm">
                  <div className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider mb-0.5">Return</div>
                  <div className="text-[14px] font-bold font-mono text-emerald-700">{stats.return_pct > 0 ? '+' : ''}{stats.return_pct}%</div>
                </div>
              </div>
              <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
                Win rate: {stats.closed_trades === 0 ? 'no closed trades' : `${stats.winning_trades}/${stats.closed_trades} profitable trades`}. Return: change since the period start.
              </p>
              <p className="mb-2 text-[10px] text-slate-500">Max drawdown −{stats.max_drawdown_pct}%</p>
              <button
                onClick={() => {
                  const tasks = readSavedBacktestTasks();
                  const nextTasks = [{ id: taskKey, strategy: STRATEGIES.find(s => s.id === strat)?.name, ticker: backtestResult.ticker, result: { months: backtestMonths, stats }, savedAt: new Date().toISOString() }, ...tasks.filter(task => task.id !== taskKey)];
                  saveLocalResult(savedBacktestKey, nextTasks);
                  setSavedTasks(nextTasks);
                  setSavedTask(true);
                }}
                className="w-full mb-2 bg-emerald-50 border border-emerald-200 text-emerald-800 py-2 rounded-lg text-[11px] font-bold active:bg-emerald-100"
              >{savedTask ? 'Saved to Tasks' : 'Save to Tasks'}</button>
              {!showDetail && (
                <button onClick={() => setSearchParams({ tab: 'backtest', bt_step: '3', task_detail: '1', strategy: strat || 'sma', ticker: tick || '', months: String(backtestMonths) })}
                  className="w-full bg-white border border-slate-200 text-[#0B2545] py-2 rounded-lg text-[11px] font-bold active:bg-slate-50 shadow-sm">
                  View Full Chart
                </button>
              )}
            </div>
          );
          msgs.push({ id: 'bt_a3', role: 'agent', content: resultMsg });
        }
      }

      if (showDetail && backtestResult) {
        msgs.push({ id: 'bt_u3', role: 'user', content: "Show me the full chart" });
        const fills = new Map(backtestResult.trades.map(trade => [trade.date, trade]));
        const chartData = backtestResult.chart.map(point => {
          const fill = fills.get(point.date);
          return { ...point, buyReturn: fill?.side === 'buy' ? point.return_pct : undefined, sellReturn: fill?.side === 'sell' ? point.return_pct : undefined };
        });
        const chartMsg = (
          <div className="w-[310px] max-w-full">
            <div className="flex items-center gap-1.5 mb-2">
              <LineChart size={14} className="text-[#EE6C4D]" />
              <span className="text-[12px] font-bold text-[#0B2545]">Strategy Return & Trades</span>
            </div>
            <div className="h-[180px] w-full min-w-0 mt-2 bg-white rounded-lg pt-2 pb-1 border border-slate-100 shadow-sm">
              {chartData.length ? <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorReturnBacktest" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0B2545" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#0B2545" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 500}} dy={10} minTickGap={15} />
                  <YAxis width={48} domain={['auto', 'auto']} tickFormatter={value => `${Number(value).toFixed(1)}%`} axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 500, fontFamily: 'monospace'}} dx={-2} orientation="right" />
                  <Area type="monotone" dataKey="return_pct" stroke="#0B2545" strokeWidth={2} fillOpacity={1} fill="url(#colorReturnBacktest)" />
                  <Scatter dataKey="buyReturn" shape={<BuyMarker />} />
                  <Scatter dataKey="sellReturn" shape={<SellMarker />} />
                </ComposedChart>
              </ResponsiveContainer> : <p className="p-4 text-[11px] text-slate-500">{backtestResult.chart_error || 'Return chart is unavailable.'}</p>}
            </div>
            <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
              Return starts at 0%. B/S mark filled trades.
            </p>
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {backtestResult.trades.length === 0 ? <p className="text-[10px] text-slate-500">No filled trades in this period.</p> : backtestResult.trades.map((trade, index) => (
                <div key={`${trade.time}-${index}`} className="flex justify-between text-[10px] border-b border-slate-100 py-1">
                  <span>{trade.date} · <b className={trade.side === 'buy' ? 'text-emerald-700' : 'text-rose-700'}>{trade.side.toUpperCase()}</b></span>
                  <span className="font-mono">{backtestResult.ticker[0] >= 'A' && backtestResult.ticker[0] <= 'Z' ? `$${trade.price.toFixed(2)}` : `¥${trade.price.toFixed(2)} × ${trade.quantity}`}</span>
                </div>
              ))}
            </div>
          </div>
        );
        msgs.push({ id: 'bt_a4', role: 'agent', content: chartMsg });
      }

      setMessages(msgs);
    } else {
      // Chat Tab logic
      if (tradeId === '1') {
        setMessages([
          { id: '1', role: 'agent', content: <p>Hi! I am M-Agent. What would you like to know?</p> },
          { id: '2', role: 'user', content: 'How did I execute the ZIJIN MINING trade?' },
          {
            id: '3',
            role: 'agent',
            content: (
              <div>
                <p className="mb-2 leading-relaxed">Deep dive into <span className="font-bold text-[#0B2545]">ZIJIN MINING (Sold Jul 14)</span>:</p>
                
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 mb-2.5 space-y-2">
                  <div className="text-[11px] text-slate-600 leading-relaxed">
                    <span className="font-bold text-[#0B2545] block mb-0.5">📌 Your Trade Note:</span>
                    You wrote <span className="text-[#EE6C4D] font-bold">'Right-side breakout; take profit in tranches at target'</span>.
                  </div>
                  <div className="text-[11px] text-slate-600 leading-relaxed border-t border-slate-200 pt-2">
                    <span className="font-bold text-[#0B2545] block mb-0.5">📊 Market & Execution:</span>
                    Metals saw inflows. Exiting early during market volatility was <span className="text-emerald-600 font-bold">decisive and logical!</span>
                  </div>
                </div>

                <div className="bg-[#EE6C4D]/5 p-2.5 rounded-xl border border-[#EE6C4D]/20 mb-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <BookOpen size={12} className="text-[#EE6C4D]" />
                    <span className="text-[11px] font-bold text-[#0B2545]">Based on your notes</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                    You felt regretful after selling. <strong className="text-[#0B2545]">Consider re-entering with a tiny tracking position (5%) on a 5-day MA bounce to prevent FOMO.</strong>
                  </p>
                </div>

                <button 
                  onClick={() => navigate('/detail/1')}
                  className="w-full bg-white border border-slate-200 text-[#0B2545] py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 active:bg-slate-50 shadow-sm transition-colors"
                >
                  Back to Details <ChevronLeft className="rotate-180" size={12} />
                </button>
              </div>
            )
          }
        ]);
      } else if (tradeId === '2') {
        setMessages([
          { id: '1', role: 'agent', content: <p>Hi! I am M-Agent. What would you like to know?</p> },
          { id: '2', role: 'user', content: 'Help me review the JEREH trade.' },
          {
            id: '3',
            role: 'agent',
            content: (
              <div>
                <p className="mb-2 leading-relaxed">Deep dive into <span className="font-bold text-[#0B2545]">JEREH (Sold Jul 14)</span>:</p>
                
                <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200 mb-2.5 space-y-2">
                  <div className="text-[11px] text-slate-700 leading-relaxed">
                    <span className="font-bold text-rose-700 block mb-0.5">📌 Plan vs Execution:</span>
                    Planned <span className="text-rose-600 font-bold">'Strict hold if above 145'</span>, exited at 140. Classic case of <strong className="text-rose-600">'holding a losing position'</strong>, causing 3.4% extra loss.
                  </div>
                </div>

                <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 mb-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <BarChart2 size={12} className="text-emerald-600" />
                    <span className="text-[11px] font-bold text-[#0B2545]">Improvement</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                    Win rate on "emotional following" is &lt;20%. <strong className="text-[#0B2545]">Next time, set a strict conditional stop-loss order in your broker app.</strong>
                  </p>
                </div>

                <button 
                  onClick={() => navigate('/detail/2')}
                  className="w-full bg-white border border-slate-200 text-[#0B2545] py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 active:bg-slate-50 shadow-sm transition-colors"
                >
                  Back to Details <ChevronLeft className="rotate-180" size={12} />
                </button>
              </div>
            )
          }
        ]);
      } else if (action === 'draft') {
        const msgs: Message[] = [];
        msgs.push({ id: 'd1_u', role: 'user', content: DRAFT_PRESET_QUESTION });

        if (!step) {
          msgs.push({ id: 'd1_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'draft', step: '1', tab: 'chat', asset: draftAsset }, { replace: true }), 1500);
          return () => clearTimeout(t);
        }

        const step1AgentActive = (
          <div>
            <p className="mb-2 text-[12px] leading-relaxed">I can help you build a solid trading plan. <strong>Which asset</strong> would you like to focus on?</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSearchParams({ action: 'draft', step: '2_think', tab: 'chat', asset: 'ZIJIN MINING' })} className="px-2.5 py-1.5 bg-[#EE6C4D]/10 text-[#EE6C4D] border border-[#EE6C4D]/20 rounded-lg text-[11px] font-bold active:bg-[#EE6C4D]/20 transition-colors shadow-sm">ZIJIN MINING</button>
              <button onClick={() => setSearchParams({ action: 'draft', step: '2_think', tab: 'chat', asset: 'BIG DATA ETF' })} className="px-2.5 py-1.5 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold active:bg-slate-50 transition-colors shadow-sm">BIG DATA ETF</button>
            </div>
          </div>
        );

        const step1AgentDisabled = (
          <div>
            <p className="mb-2 text-[12px] leading-relaxed">I can help you build a solid trading plan. <strong>Which asset</strong> would you like to focus on?</p>
            <div className="flex flex-wrap gap-2 opacity-60 pointer-events-none">
              <button className="px-2.5 py-1.5 bg-[#EE6C4D] text-white border border-[#EE6C4D] rounded-lg text-[11px] font-bold shadow-sm">ZIJIN MINING</button>
            </div>
          </div>
        );

        if (step === '1') {
          msgs.push({ id: 'd1_a', role: 'agent', content: step1AgentActive });
          setMessages(msgs);
          return;
        }

        msgs.push({ id: 'd1_a', role: 'agent', content: step1AgentDisabled });
        msgs.push({ id: 'd2_u', role: 'user', content: draftAsset });

        if (step === '2_think') {
          msgs.push({ id: 'd2_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'draft', step: '2', tab: 'chat', asset: draftAsset }, { replace: true }), 1500);
          return () => clearTimeout(t);
        }

        const step2AgentActive = (
          <div>
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-sm mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-[#0B2545]" />
                <span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Analysis</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed font-medium">{draftAsset} is consolidating near support, with sector flows remaining steady.</p>
            </div>
            <p className="mb-2 text-[12px] leading-relaxed">To tailor the plan, what is your <strong>preferred holding period</strong>?</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSearchParams({ action: 'draft', step: '3_think', tab: 'chat', asset: draftAsset })} className="px-2.5 py-1.5 bg-[#EE6C4D]/10 text-[#EE6C4D] border border-[#EE6C4D]/20 rounded-lg text-[11px] font-bold active:bg-[#EE6C4D]/20 transition-colors shadow-sm">Short-term Swing</button>
              <button onClick={() => setSearchParams({ action: 'draft', step: '3_think', tab: 'chat', asset: draftAsset })} className="px-2.5 py-1.5 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold active:bg-slate-50 transition-colors shadow-sm">Medium-term Trend</button>
            </div>
          </div>
        );

        const step2AgentDisabled = (
          <div>
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-sm mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-[#0B2545]" />
                <span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Analysis</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed font-medium">ZIJIN MINING is currently in a consolidation phase near the 20-day MA. Metals sector shows steady inflow.</p>
            </div>
            <p className="mb-2 text-[12px] leading-relaxed">To tailor the plan, what is your <strong>preferred holding period</strong>?</p>
            <div className="flex flex-wrap gap-2 opacity-60 pointer-events-none">
              <button className="px-2.5 py-1.5 bg-[#EE6C4D] text-white border border-[#EE6C4D] rounded-lg text-[11px] font-bold shadow-sm">Short-term Swing</button>
            </div>
          </div>
        );

        if (step === '2') {
          msgs.push({ id: 'd2_a', role: 'agent', content: step2AgentActive });
          setMessages(msgs);
          return;
        }

        msgs.push({ id: 'd2_a', role: 'agent', content: step2AgentDisabled });
        msgs.push({ id: 'd3_u', role: 'user', content: 'Short-term Swing' });

        if (step === '3_think') {
          msgs.push({ id: 'd3_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'draft', step: '3', tab: 'chat', asset: draftAsset }, { replace: true }), 2000);
          return () => clearTimeout(t);
        }

        const planTarget = draftAsset === 'BIG DATA ETF' ? { detailId: '4', tradeId: '1' } : { detailId: '1', tradeId: '2' };
        const timelineStorageKey = `tradingnote:timeline:${planTarget.detailId}`;
        const storedPlanRecord = (readLocalResult<any[]>(timelineStorageKey) || []).find(record => record.id === planTarget.tradeId);
        setSavedPlan(Boolean(storedPlanRecord?.aiPlan) || Boolean(readLocalResult(`tradingnote:plan:${draftAsset}`)));
        const step3AgentActive = (
          <div className="w-[240px] max-w-full">
            <p className="mb-3 text-[12px] leading-relaxed">Here is your customized <strong>Trading Discipline Plan</strong> for <span className="text-[#0B2545] font-bold">{draftAsset}</span>:</p>
            
            <div className="space-y-2.5">
              <div className="bg-white/80 backdrop-blur-md p-3 rounded-xl border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)]">
                <div className="text-[9px] text-slate-500 font-bold mb-1 uppercase tracking-wider">Entry Zone</div>
                <div className="text-[14px] font-bold text-[#0B2545] font-mono mb-1">{draftAsset === 'ZIJIN MINING' ? '25.80 - 26.00' : '0.98 - 1.00'}</div>
                <p className="text-[11px] text-slate-600 font-medium leading-relaxed">Wait for a pullback to the 5-day MA. Do not chase if it opens above 26.50.</p>
              </div>
              
              <div className="flex gap-2.5">
                <div className="flex-1 bg-rose-50/80 backdrop-blur-md p-3 rounded-xl border border-rose-100 shadow-[0_4px_12px_rgba(244,63,94,0.06)]">
                  <div className="text-[9px] text-rose-500 font-bold mb-1 uppercase tracking-wider">Hard Stop</div>
                  <div className="text-[14px] font-bold text-rose-700 font-mono mb-1">{draftAsset === 'ZIJIN MINING' ? '24.80' : '0.92'}</div>
                  <p className="text-[10px] text-rose-700/80 font-medium leading-tight">Close immediately on daily close below 24.80.</p>
                </div>
                <div className="flex-1 bg-emerald-50/80 backdrop-blur-md p-3 rounded-xl border border-emerald-100 shadow-[0_4px_12px_rgba(16,185,129,0.06)]">
                  <div className="text-[9px] text-emerald-600 font-bold mb-1 uppercase tracking-wider">Target</div>
                  <div className="text-[14px] font-bold text-emerald-700 font-mono mb-1">{draftAsset === 'ZIJIN MINING' ? '27.50' : '1.15'}</div>
                  <p className="text-[10px] text-emerald-700/80 font-medium leading-tight">Take 50% profit at target, trail the rest.</p>
                </div>
              </div>

              <div className="bg-[#0B2545] p-3 rounded-xl border border-[#0B2545] shadow-lg relative overflow-hidden mt-2">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/5 rounded-full blur-2xl pointer-events-none"></div>
                <div className="flex items-center gap-1.5 mb-2 relative z-10">
                  <AlertTriangle size={14} className="text-[#EE6C4D]" />
                  <span className="text-[11px] font-bold text-white uppercase tracking-wider">Behavioral Rule</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed font-medium relative z-10">
                  Based on your history, you tend to exit short-term trades early. <strong className="text-white">Set a conditional stop-loss and do not watch intraday ticks.</strong> Let the plan execute.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                const plan = { asset: draftAsset, entryZone: draftAsset === 'ZIJIN MINING' ? '25.80 - 26.00' : '0.98 - 1.00', stopLoss: draftAsset === 'ZIJIN MINING' ? '24.80' : '0.92', target: draftAsset === 'ZIJIN MINING' ? '27.50' : '1.15', rule: 'Set a conditional stop-loss at entry and avoid reacting to intraday noise.', savedAt: new Date().toISOString() };
                const key = `tradingnote:timeline:${planTarget.detailId}`;
                const records = readLocalResult<any[]>(key) || [];
                const currentRecord = records.find(record => record.id === planTarget.tradeId) || { id: planTarget.tradeId, type: 'Trade' };
                const updatedRecord = { ...currentRecord, aiPlan: plan };
                delete updatedRecord.plan;
                saveLocalResult(key, [...records.filter(record => record.id !== planTarget.tradeId), updatedRecord]);
                setSavedPlan(true);
              }}
              className="w-full mt-3 bg-[#0B2545] text-white py-2 rounded-lg text-[11px] font-bold active:bg-[#134074]"
            >{savedPlan ? 'Plan Saved to Trade' : 'Save Plan to Latest Trade'}</button>
          </div>
        );

        if (step === '3') {
          msgs.push({ id: 'd3_a', role: 'agent', content: step3AgentActive });
          setMessages(msgs);
        }
      } else if (action === 'review') {
        if (step !== 'followup') {
          setMessages([
            { id: 'r1_u', role: 'user', content: REVIEW_ACTION_QUESTION },
            { id: 'r1_a', role: 'agent', content: <Thinking /> },
          ]);
          const timer = setTimeout(() => setMessages(previous => previous.map(message => message.id === 'r1_a'
            ? { ...message, content: <p className="text-[12px] leading-relaxed">Let's review your recent trades. Which asset would you like to analyze?</p> }
            : message)), 2000);
          return () => clearTimeout(timer);
        }
      } else if (action === 'insights') {
        // The dedicated effect below requests the account-backed analysis.
        return;
      } else if (isDailyReference || isAssetReference) {
        setMessages([]);
        setInput(searchParams.get('prompt') || (isAssetReference ? 'How did I execute these trades?' : 'Review this day with my saved trades and notes.'));
      } else {
        setMessages([]); // default state / landing for chat
      }
    }
  }, [tradeId, action, step, tab, reference, searchParams, setSearchParams, backtestResult, backtestLoading, backtestError, backtestMonths, savedTask, tickerLookup, tickerLookupLoading]);

  useEffect(() => {
    if (action !== 'insights' || tab !== 'chat') return;
    let active = true;
    const controller = new AbortController();
    setMessages([
      { id: 'i1_u', role: 'user', content: INSIGHTS_PRESET_QUESTION },
      { id: 'i1_a', role: 'agent', content: <Thinking /> },
    ]);
    // Defer the request so React Strict Mode's development cleanup can cancel it.
    const timer = window.setTimeout(() => {
      void apiRequest<BehaviorInsights>('/api/agent/insights', { method: 'POST', signal: controller.signal })
        .then(data => {
          if (active) {
            if (data.conversation_id) setConversationId(data.conversation_id);
            setMessages(previous => previous.map(message => message.id === 'i1_a'
              ? { ...message, content: <InsightsResult data={data} /> } : message));
          }
        })
        .catch(error => {
          if (!active) return;
          const detail = error instanceof Error ? error.message : 'Behavior Insights failed. Please try again.';
          setMessages(previous => previous.map(message => message.id === 'i1_a' ? { ...message, content: <div className="space-y-2 text-[11px]"><p role="alert" className="text-rose-600">{detail}</p><button className="font-bold text-[#EE6C4D] underline" onClick={() => setInsightsAttempt(value => value + 1)}>Retry analysis</button></div> } : message));
        });
    }, 0);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [action, tab, insightsAttempt]);

  useEffect(() => {
    if (!keepAtBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      const scroller = chatScrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  const sendChatMessage = async (currentInput: string) => {
    if (chatInFlightRef.current !== null) return;
    const userMsgId = `u_${Date.now()}`;
    const pendingId = `${userMsgId}_pending`;
    const session = chatSessionRef.current;
    chatInFlightRef.current = session;
    let request = chatRequestRef.current;
    if (!request || request.session !== session || request.input !== currentInput) {
      request = { session, input: currentInput, body: null };
      chatRequestRef.current = request;
    }

    setSendError(null);
    setIsSending(true);
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: currentInput },
      { id: pendingId, role: 'agent', content: <Thinking /> }
    ]);

    try {
      if (request.body === null) {
        let trade_context: AgentTradeContext | null = null;
        if (tradeId) {
          try {
            const storedTrade = await apiRequest<AgentTradeContext>(`/api/trades/${encodeURIComponent(tradeId)}`);
            if (storedTrade && (storedTrade.type === 'Buy' || storedTrade.type === 'Sell')) {
              trade_context = {
                id: storedTrade.id,
                symbol: storedTrade.symbol,
                type: storedTrade.type,
                price: Number(storedTrade.price),
                qty: Number(storedTrade.qty),
                amount: storedTrade.amount,
                note: storedTrade.note,
                note_tags: storedTrade.note_tags,
              };
            }
          } catch {
            // A detail-page reference may not correspond to a persisted trade card.
          }
        }
        if (session !== chatSessionRef.current) return;

        // Retries must reuse the entire body, including the original conversation_id.
        request.body = JSON.stringify({
          client_msg_id: crypto.randomUUID(),
          message: currentInput,
          conversation_id: conversationId,
          action: action ?? null,
          trade_id: tradeId ?? null,
          step: step ?? null,
          reference: reference ?? null,
          asset: action === 'review'
            ? (searchParams.get('asset') || (step === 'awaiting_asset' ? currentInput : null))
            : action === 'draft' || isAssetReference ? draftAsset : null,
          symbol: searchParams.get('symbol'),
          pnl: searchParams.get('pnl'),
          trade_context,
        });
      }
      if (session !== chatSessionRef.current) return;
      const data = await apiRequest<{ conversation_id: string; reply: string }>('/api/agent/chat', {
        method: 'POST',
        body: request.body,
      }).catch(error => {
        if (error instanceof Error && error.message.startsWith('Unable to connect to the backend')) {
          throw new Error("Unable to connect to the Agent backend. Check that it is running, then try again.");
        }
        throw error;
      });
      if (!data || typeof data.reply !== 'string') {
        throw new Error('Agent backend returned an unexpected response. Please try again.');
      }
      if (session !== chatSessionRef.current) return;
      if (chatRequestRef.current === request) chatRequestRef.current = null;

      if (typeof data.conversation_id === 'string') {
        setConversationId(data.conversation_id);
      }
      setMessages(prev => prev.map(m =>
        m.id === pendingId
          ? { id: `a_${Date.now()}`, role: 'agent', content: <AgentMarkdown text={data.reply} reviewAsset={action === 'review' ? (searchParams.get('asset') || currentInput) : undefined} /> }
          : m
      ));
    } catch (err) {
      if (session !== chatSessionRef.current) return;
      setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== pendingId));
      setInput(prev => prev || currentInput);
      setSendError(err instanceof Error ? err.message : 'Failed to send message. Please try again.');
    } finally {
      if (session === chatSessionRef.current && chatInFlightRef.current === session) {
        chatInFlightRef.current = null;
        setIsSending(false);
      }
    }
  };

  const runLandingPrompt = async (kind: 'today' | 'review' | 'insights') => {
    if (chatInFlightRef.current !== null) return;
    const prompt = kind === 'today' ? TODAY_PRESET_QUESTION : kind === 'review' ? REVIEW_PRESET_QUESTION : INSIGHTS_PRESET_QUESTION;
    const session = ++chatSessionRef.current;
    chatRequestRef.current = null;
    chatInFlightRef.current = session;
    keepAtBottomRef.current = true;
    setConversationId(null);
    setSendError(null);
    setIsSending(true);
    setInput('');
    setMessages([
      { id: `preset_${session}_u`, role: 'user', content: prompt },
      { id: `preset_${session}_pending`, role: 'agent', content: <Thinking /> },
    ]);
    try {
      let answer: React.ReactNode;
      let conversation_id: string | undefined;
      if (kind === 'today') {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
        let review = await getDailyReview(today);
        if (!review) throw new Error('Today\'s review data is temporarily unavailable.');
        if (!review.summary_brief && !review.summary) review = await generateDailySummary(today);
        if (!review.trade_review_overview && !review.trade_reviews?.length && !review.trade_review_observations.length) {
          review = await generateTradeReviews(today);
        }
        answer = <AgentMarkdown text={dailyReviewAnswer(review)} />;
      } else if (kind === 'review') {
        const data = await apiRequest<{ conversation_id: string; reply: string }>('/api/agent/chat', {
          method: 'POST',
          body: JSON.stringify({ message: prompt, action: 'review', asset: 'JDF' }),
        });
        conversation_id = data.conversation_id;
        answer = <AgentMarkdown text={data.reply} reviewAsset="JDF" />;
      } else {
        const data = await apiRequest<BehaviorInsights>('/api/agent/insights', { method: 'POST' });
        conversation_id = data.conversation_id;
        answer = <InsightsResult data={data} />;
      }
      if (session !== chatSessionRef.current) return;
      if (conversation_id) setConversationId(conversation_id);
      setMessages([{ id: `preset_${session}_u`, role: 'user', content: prompt }, { id: `preset_${session}_a`, role: 'agent', content: answer }]);
    } catch (error) {
      if (session !== chatSessionRef.current) return;
      const detail = error instanceof Error ? error.message : 'Request failed. Please try again later.';
      setMessages([{ id: `preset_${session}_u`, role: 'user', content: prompt }, { id: `preset_${session}_error`, role: 'agent', content: <p role="alert" className="text-rose-600">{detail}</p> }]);
    } finally {
      if (session === chatSessionRef.current && chatInFlightRef.current === session) {
        chatInFlightRef.current = null;
        setIsSending(false);
      }
    }
  };

  const handleNewChat = () => {
    chatSessionRef.current += 1;
    chatRequestRef.current = null;
    chatInFlightRef.current = null;
    setMessages([]);
    setInput('');
    setConversationId(null);
    setSendError(null);
    setIsSending(false);
    setSearchParams({ tab: 'chat' });
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const items = await apiRequest<ConversationSummary[]>('/api/agent/conversations?limit=50');
      setHistoryItems(items);
    } catch (error) {
      setHistoryError('Could not load conversation history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreConversation = async (id: string) => {
    setLoadingConversation(id);
    setHistoryError(null);
    try {
      const history = await apiRequest<ConversationHistory>(`/api/agent/conversations/${encodeURIComponent(id)}`);
      chatSessionRef.current += 1;
      chatRequestRef.current = null;
      chatInFlightRef.current = null;
      setIsSending(false);
      setInput('');
      setConversationId(history.conversation_id);
      keepAtBottomRef.current = true;
      const reviewedAsset = history.messages.find(message => message.role === 'user')?.content;
      const restoredMessages: Message[] = history.messages.map((message, index) => {
        const savedInsights = message.role === 'assistant' ? parseSavedInsights(message.content) : null;
        return {
          id: `${history.conversation_id}_${index}`,
          role: message.role === 'assistant' ? 'agent' : 'user',
          content: message.role === 'assistant'
            ? savedInsights ? <InsightsResult data={savedInsights} /> : <AgentMarkdown text={message.content} reviewAsset={reviewedAsset} />
            : message.content,
        };
      });
      const presetQuestion = history.title === REVIEW_PRESET_QUESTION ? REVIEW_PRESET_QUESTION : history.title === DRAFT_PRESET_QUESTION ? DRAFT_PRESET_QUESTION : null;
      if (presetQuestion && history.messages[0]?.content !== presetQuestion) {
        restoredMessages.unshift({ id: `${history.conversation_id}_preset`, role: 'user', content: presetQuestion });
      }
      setMessages(restoredMessages);
      setSendError(null);
      setHistoryOpen(false);
      const cleanChatParams = new URLSearchParams({ tab: 'chat' });
      if (searchParams.toString() !== cleanChatParams.toString()) {
        skipNextRouteSyncRef.current = true;
        setSearchParams(cleanChatParams);
      }
    } catch (error) {
      setHistoryError('Could not open this conversation. Please try again.');
    } finally {
      setLoadingConversation(null);
    }
  };

  const handleSend = () => {
    if (!input.trim() || isSending || chatInFlightRef.current !== null) return;
    keepAtBottomRef.current = true;
    
    const currentInput = input.trim();
    setInput('');
    if (inputRef.current) inputRef.current.style.height = '36px';
    const isDailyReview = reference === 'daily-2026-07-14' && currentInput.toLowerCase().includes('review');
    const isAssetTracking = isAssetReference && currentInput.length > 0;
    if (isDailyReview) setSavedTracking(Boolean(readLocalResult('tradingnote:tracking:2026-07-14')));
    if (isAssetTracking) setSavedTracking(Boolean(readLocalResult(`tradingnote:asset-tracking:${tradeId}`)));

    if (tab === 'chat') {
      if (action === 'review' && step === 'awaiting_asset') {
        skipNextRouteSyncRef.current = true;
        setSearchParams({ action: 'review', step: 'followup', tab: 'chat', asset: currentInput });
      }
      void sendChatMessage(currentInput);
      return;
    }

    if (tab === 'backtest') {
      const btStep = searchParams.get('bt_step');
      if (btStep === '1') {
        if (/^(?:\d{6}(?:\.(?:SH|SZ|BJ))?|[A-Z][A-Z0-9.-]{0,15})$/i.test(currentInput)) {
          setBacktestError(null);
          setTickerLookup(null);
          setSearchParams({ tab: 'backtest', bt_step: '2', strategy: searchParams.get('strategy') || 'sma', ticker: currentInput.toUpperCase() });
          return;
        }
        const request = ++tickerLookupRequestRef.current;
        setBacktestError(null);
        setTickerLookup({ query: currentInput, candidates: [] });
        setTickerLookupLoading(true);
        const query = new URLSearchParams({ q: currentInput });
        void apiRequest<{ candidates: TickerCandidate[] }>(`/api/backtest/resolve?${query.toString()}`)
          .then(result => {
            if (tickerLookupRequestRef.current !== request) return;
            setTickerLookup({ query: currentInput, candidates: result.candidates || [] });
          })
          .catch(() => {
            if (tickerLookupRequestRef.current !== request) return;
            setTickerLookup({ query: currentInput, candidates: [], failed: true });
          })
          .finally(() => {
            if (tickerLookupRequestRef.current === request) setTickerLookupLoading(false);
          });
        return;
      }
    }
    
    // Normal Chat response
    setMessages(prev => [
      ...prev,
      { id: Date.now().toString(), role: 'user', content: currentInput }
    ]);
    
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'agent',
          content: (
            <div>
              <p className="text-[12px] leading-relaxed">
                {isAssetTracking ? (
                  <>
                    <p className="font-bold text-[#0B2545] mb-1.5">{searchParams.get('symbol') || 'Trade'} Execution Review</p>
                    <p>P&amp;L: {searchParams.get('pnl') || 'The position result is reflected in the trade record.'} The key question is whether the exit matched the planned risk and target.</p>
                    <p className="mt-1.5">Process: Review the entry thesis, stop placement, and exit timing together. Lesson: define the invalidation level before entry and use a conditional order to reduce hesitation.</p>
                  </>
                ) : isDailyReview ? (
                  <>
                    <p className="font-bold text-[#0B2545] mb-1.5">Jul 14 Trade Review</p>
                    <p>Realized P&amp;L was ¥3,330 (+1.31%). Two of three exits broadly followed the plan. JEREH was sold below its ¥145 stop, adding about ¥500 in avoidable loss.</p>
                    <p className="mt-1.5">ZIJIN MINING was sold near its ¥27 target, while ZIJIN INTL exited at its ¥94 stop. Next time, place stop orders at entry to reduce hesitation.</p>
                  </>
                ) : (
                  <>Got your question: "<span className="italic">{currentInput}</span>". Based on your data, you tend to "exit too early" when in profit. Suggestion: For the next "breakout" trade, try splitting your take-profit into two tranches (50% / 50%) to let profits run.</>
                )}
              </p>
              {isDailyReview && (
                <button
                  onClick={() => {
                    saveLocalResult('tradingnote:tracking:2026-07-14', {
                      date: '2026-07-14', title: 'M-Agent Daily Review',
                      body: 'Realized P&L was ¥3,330 (+1.31%). Two of three exits broadly followed the plan. JEREH was sold below its ¥145 stop, adding about ¥500 in avoidable loss. ZIJIN MINING was sold near its ¥27 target, while ZIJIN INTL exited at its ¥94 stop. Next time, place stop orders at entry to reduce hesitation.',
                      savedAt: new Date().toISOString()
                    });
                    setSavedTracking(true);
                  }}
                  className="mt-3 w-full bg-[#0B2545] text-white py-2 rounded-lg text-[11px] font-bold active:bg-[#134074]"
                >{savedTracking ? 'Tracking Saved' : 'Save Tracking'}</button>
              )}
              {isAssetTracking && (
                <button
                  onClick={() => {
                    saveLocalResult(`tradingnote:asset-tracking:${tradeId}`, {
                      asset: searchParams.get('symbol') || 'Trade',
                      overallSummary: 'The trade outcome should be judged by both its P&L and the quality of execution against the original plan.',
                      pnlResult: searchParams.get('pnl') || 'See the trade record for realized P&L.',
                      processResult: 'Review the entry thesis, stop placement, and exit timing together.',
                      lessonsLearned: 'Define the invalidation level before entry and use a conditional order to reduce hesitation.',
                      savedAt: new Date().toISOString()
                    });
                    setSavedTracking(true);
                  }}
                  className="mt-3 w-full bg-[#0B2545] text-white py-2 rounded-lg text-[11px] font-bold active:bg-[#134074]"
                >{savedTracking ? 'Tracking Saved' : 'Save Tracking'}</button>
              )}
            </div>
          )
        }
      ]);
    }, 1000);
  };

  const handleAction = (act: string) => {
    if (act === 'review' || act === 'insights' || act === 'draft') {
      chatSessionRef.current += 1;
      chatRequestRef.current = null;
      chatInFlightRef.current = null;
      setIsSending(false);
      setConversationId(null);
    }
    if (act === 'review') {
      setSearchParams({ action: act, step: 'awaiting_asset', tab: 'chat' });
      return;
    }
    if (act === 'insights') setInsightsAttempt(value => value + 1);
    setSearchParams({ action: act, tab: 'chat' });
  };

  const setTab = (newTab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', newTab);
      return next;
    });
  };

  const isLanding = messages.length === 0 && !tradeId && !action;

  return (
    <div className="w-full h-full min-h-0 bg-[#F8F9FA] font-sans text-slate-900 flex flex-col relative overflow-hidden">
      {/* Header */}
      <div className="bg-white px-3 pt-[54px] pb-3 shadow-sm shrink-0 z-20 relative border-b border-slate-100 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {!isLanding && tab === 'chat' && (
              <button onClick={() => { setSearchParams({ tab: 'chat' }); }} className="p-1 -ml-1 text-slate-700 active:bg-slate-100 rounded-full transition-colors shrink-0">
                <ChevronLeft size={20} />
              </button>
            )}
            <div className="w-7 h-7 rounded-full bg-[#0B2545] flex items-center justify-center shadow-sm shrink-0">
              <BotMessageSquare size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-[14px] font-bold tracking-tight text-[#0B2545]">M-Agent Coach</h1>
              <div className="text-[9px] text-emerald-500 font-bold flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Online
              </div>
            </div>
          </div>
          
          {tab === 'backtest' ? (
            <button 
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set('show_tasks', '1');
                setSearchParams(next);
              }}
              className="flex items-center gap-1 text-[#0B2545] text-[10px] font-bold px-2 py-1.5 bg-slate-100 rounded-lg active:bg-slate-200 transition-colors relative"
            >
              <Target size={12} /> Tasks
              {searchParams.get('bt_step') === '3' && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border border-white"></span>}
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleNewChat}
                className="flex items-center gap-1 text-[#0B2545] text-[10px] font-bold px-2 py-1.5 bg-slate-100 rounded-lg active:bg-slate-200 transition-colors"
              >
                <MessageSquarePlus size={12} /> New Chat
              </button>
              <button onClick={() => void openHistory()} className="flex items-center gap-1 text-[#0B2545] text-[10px] font-bold px-2 py-1.5 bg-slate-100 rounded-lg active:bg-slate-200 transition-colors">
                <History size={12} /> History
              </button>
            </div>
          )}
        </div>

        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 w-full">
          <button
            onClick={() => setTab('chat')}
            className={cn(
              "flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all flex items-center justify-center gap-1",
              tab === 'chat' 
                ? "bg-[#0B2545] text-white shadow-sm" 
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <MessageSquare size={14} /> Chat
          </button>
          <button
            onClick={() => setTab('backtest')}
            className={cn(
              "flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all flex items-center justify-center gap-1",
              tab === 'backtest' 
                ? "bg-[#0B2545] text-white shadow-sm" 
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <LineChart size={14} /> Backtest
          </button>
        </div>
      </div>

      {isLanding && tab === 'chat' ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y flex flex-col px-4 pt-8 pb-8 items-center relative">
          
          <div className="text-center mb-8 w-full">
            <h2 className="text-[20px] font-bold text-[#0B2545] leading-snug tracking-tight mb-2">
              Being smart is important,<br/>but discipline matters more.
            </h2>
            <p className="text-[11px] text-slate-500 font-medium">I remember everything you didn't notice.</p>
          </div>

          <div className="w-full mb-8">
            <div className="text-[11px] font-bold text-slate-500 mb-3 ml-1 uppercase tracking-wider">Everyone is asking</div>
            <div className="space-y-2.5">
              {[
                { text: TODAY_PRESET_QUESTION, kind: 'today' as const },
                { text: REVIEW_PRESET_QUESTION, kind: 'review' as const },
                { text: INSIGHTS_PRESET_QUESTION, kind: 'insights' as const },
              ].map((item, idx) => (
                <button 
                  key={idx}
                  onClick={() => void runLandingPrompt(item.kind)}
                  className="w-full bg-white p-3.5 rounded-xl shadow-sm border border-slate-100 text-left active:bg-slate-50 transition-transform active:scale-[0.99]"
                >
                  <span className="text-[12px] font-bold text-[#0B2545]">{item.text}</span>
                </button>
              ))}
            </div>
          </div>

        </div>
      ) : (
        /* Chat Area (Used by both Chat and Backtest flows) */
        <div ref={chatScrollRef} onScroll={event => {
          const scroller = event.currentTarget;
          keepAtBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
        }} className={cn('flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-3 space-y-5', tab === 'backtest' ? 'pb-[110px]' : 'pb-6')}>
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn("flex gap-2 max-w-[85%]", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                
                <div className="shrink-0 mt-0.5">
                  {msg.role === 'agent' ? (
                    <div className="w-6 h-6 rounded-full bg-[#0B2545] flex items-center justify-center shadow-sm">
                      <BotMessageSquare size={12} className="text-white" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center border border-white">
                      <User size={12} className="text-slate-600" />
                    </div>
                  )}
                </div>
                
                <div className={cn(
                  "p-2.5 text-[12px] shadow-sm font-medium whitespace-pre-wrap break-words",
                  msg.role === 'user' 
                    ? "bg-[#0B2545] text-white rounded-[16px] rounded-tr-[4px]" 
                    : "bg-white border border-slate-200 text-slate-800 rounded-[16px] rounded-tl-[4px]"
                )}>
                  {msg.content}
                </div>
              </div>
            </div>
          ))}
          <div className="h-4" />
        </div>
      )}

      {historyOpen && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#0B2545]/35 backdrop-blur-[1px]">
          <section className="mx-auto flex h-[82%] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-[14px] font-bold text-[#0B2545]">Conversation History</h2>
                <p className="mt-0.5 text-[10px] text-slate-400">Select a conversation to view and continue.</p>
              </div>
              <button onClick={() => setHistoryOpen(false)} aria-label="Close conversation history" className="rounded-full bg-slate-100 p-2 text-slate-500"><X size={14} /></button>
            </div>
            {historyError && <div role="alert" className="mx-3 mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-700">{historyError}<button onClick={() => void openHistory()} className="ml-2 font-bold underline">Retry</button></div>}
            <div className="flex-1 overflow-y-auto p-3">
              {historyLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[11px] text-slate-400"><Loader2 size={14} className="animate-spin" />Loading conversations...</div>
              ) : historyItems.length === 0 && !historyError ? (
                <div className="py-10 text-center text-[11px] text-slate-400">No saved conversations yet.</div>
              ) : historyItems.map(item => (
                <button key={item.conversation_id} onClick={() => void restoreConversation(item.conversation_id)} disabled={Boolean(loadingConversation)} className="mb-2 w-full rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-[#EE6C4D]/50 disabled:opacity-60">
                  <div className="flex items-start justify-between gap-3">
                    <span className="line-clamp-2 text-[12px] font-bold text-[#0B2545]">{item.title || 'New conversation'}</span>
                    {loadingConversation === item.conversation_id && <Loader2 size={13} className="shrink-0 animate-spin text-[#EE6C4D]" />}
                  </div>
                <div className="mt-1.5 flex justify-between text-[9px] text-slate-400"><span>{item.message_count} {item.message_count === 1 ? 'message' : 'messages'}</span><span>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.updated_at))}</span></div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Fixed Bottom Area (Chat Input for both flows) */}
      {(tab === 'chat' || (tab === 'backtest' && backtestStep === '1')) && (
        <div className="shrink-0 w-full bg-white/95 backdrop-blur-xl border-t border-slate-100 z-10 px-3 pt-2 pb-[100px] shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">

          {/* Quick Actions (Chat only) */}
          {tab === 'chat' && (
            <div className="flex overflow-x-auto no-scrollbar gap-2 mb-2 w-full snap-x">
              <button 
                onClick={() => handleAction('review')}
                className="flex-shrink-0 snap-center bg-white border border-slate-200 text-[#0B2545] px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 active:bg-slate-50 transition-colors shadow-sm"
              >
                <History size={14} className="text-[#EE6C4D] shrink-0" /> 
                <span>Review Trades</span>
              </button>
              <button 
                onClick={() => handleAction('insights')}
                className="flex-shrink-0 snap-center bg-white border border-slate-200 text-[#0B2545] px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 active:bg-slate-50 transition-colors shadow-sm"
              >
                <Activity size={14} className="text-[#EE6C4D] shrink-0" /> 
                <span>Behavior Insights</span>
              </button>
            </div>
          )}

          {tab === 'chat' && sendError && (
            <div role="alert" className="flex items-start gap-1.5 mb-2 px-2.5 py-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] font-medium text-rose-700 leading-snug">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span className="flex-1">{sendError}</span>
              <button onClick={() => setSendError(null)} aria-label="Dismiss error" className="shrink-0 text-rose-400 active:text-rose-600">
                <X size={12} />
              </button>
            </div>
          )}
          {tab === 'backtest' && backtestStep === '1' && backtestError && (
            <p role="alert" className="mb-2 px-2.5 text-[11px] text-rose-700">{backtestError}</p>
          )}

          <div className="flex items-end gap-2 bg-slate-50 rounded-xl p-1.5 border border-slate-200 focus-within:border-[#0B2545] transition-colors shadow-inner">
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              {tab === 'chat' && (isDailyReference || isAssetReference) && (
                <div className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#EE6C4D]/10 border border-[#EE6C4D]/20 text-[9px] font-bold text-[#0B2545]">
                  <BookOpen size={10} className="text-[#EE6C4D]" /> {isAssetReference ? `${searchParams.get('symbol') || 'Asset'} · P&L ${searchParams.get('pnl') || '--'}` : `Today · ${reference?.slice(6)}`}
                </div>
              )}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  if (chatRequestRef.current && e.target.value.trim() !== chatRequestRef.current.input) {
                    chatRequestRef.current = null;
                  }
                  setInput(e.target.value);
                  e.currentTarget.style.height = '36px';
                  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={tab === 'backtest' && searchParams.get('bt_step') === '1'
                  ? "Ticker or name (601899, AAPL, or 京东方)..."
                  : action === 'review' && step === 'awaiting_asset'
                    ? "e.g. Zijin Mining or 601899"
                    : "Ask a master what they are buying..."}
                className="flex-1 min-w-0 w-full max-h-[160px] min-h-[36px] overflow-y-auto bg-transparent resize-none text-[13px] font-medium text-[#0B2545] p-2 focus:outline-none placeholder:text-slate-400"
                rows={1}
              />
            </div>
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              aria-label={isSending ? 'Sending' : 'Send'}
              className="p-2.5 bg-[#EE6C4D] text-white rounded-lg disabled:bg-slate-300 disabled:text-white transition-colors shrink-0 shadow-sm active:scale-95 mb-0.5 mr-0.5"
            >
              {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      )}

      {/* Tasks Overlay */}
      <AnimatePresence>
        {searchParams.get('show_tasks') === '1' && (
          <motion.div 
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute inset-0 bg-[#F8F9FA] z-50 flex flex-col"
          >
            <div className="bg-white px-3 pt-[54px] pb-3 shadow-sm border-b border-slate-100 flex items-center gap-2 relative">
              <button 
                onClick={() => {
                  const p = new URLSearchParams(searchParams);
                  p.delete('show_tasks');
                  setSearchParams(p);
                }} 
                className="p-1.5 -ml-1.5 text-slate-700 active:bg-slate-100 rounded-full"
              >
                <X size={20} />
              </button>
              <h2 className="text-[16px] font-bold text-[#0B2545]">Backtest Tasks</h2>
            </div>
            <div className="p-3 space-y-3 flex-1 overflow-y-auto">
              {savedTasks.map(task => (
                <div key={task.id} className="bg-white p-3 rounded-xl border border-emerald-200 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[13px] font-bold text-[#0B2545]">{task.strategy}</div>
                    <div className="text-[9px] bg-emerald-50 border border-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase">Saved</div>
                  </div>
                  <div className="text-[11px] text-slate-500">Target: <span className="font-bold text-[#0B2545] uppercase">{task.ticker}</span> · {BACKTEST_PERIODS.find(period => period.months === (task.result.months || 36))?.label}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] text-slate-500">
                    <span>Win rate <b className="text-emerald-700">{task.result.stats.win_rate_pct === null ? '—' : `${task.result.stats.win_rate_pct}%`}</b></span>
                    <span>Return <b className="text-emerald-700">{task.result.stats.return_pct}%</b></span>
                  </div>
                </div>
              ))}
              {searchParams.get('bt_step') === '3' && backtestResult && (
                <div 
                  onClick={() => setSearchParams({ tab: 'backtest', bt_step: '3', strategy: searchParams.get('strategy') || 'sma', ticker: searchParams.get('ticker') || '', months: String(backtestMonths), task_detail: '1' })}
                  className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm active:scale-[0.99] transition-transform cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></div>
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[14px] font-bold text-[#0B2545]">{STRATEGIES.find(s => s.id === searchParams.get('strategy'))?.name}</div>
                    <div className="text-[10px] bg-emerald-50 border border-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Completed</div>
                  </div>
                  <div className="text-[12px] text-slate-500 font-medium mb-1">Target: <span className="font-bold text-[#0B2545] uppercase">{searchParams.get('ticker')}</span></div>
                  <div className="text-[10px] text-slate-400 font-mono">Run at {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
