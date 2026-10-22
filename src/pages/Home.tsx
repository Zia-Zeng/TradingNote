import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Plus, X, Sparkles, Edit3, ChevronLeft, ChevronRight, Search, RefreshCw, BotMessageSquare
} from 'lucide-react';
import { cn } from '../lib/utils';
import TradesModule from '../components/TradesModule';
import { formatNoteDate, localDate, useDailyNotes } from '../lib/daily-notes';
import ExpandableNoteText from '../components/ExpandableNoteText';
import HoldingsSnapshotModule from '../components/HoldingsSnapshotModule';
import { DAILY_REVIEW_INPUTS_CHANGED, generateDailySummary, generateTradeReviews, getDailyReview, type DailyReview } from '../lib/daily-review';
import { getDailyPnl, PORTFOLIO_SNAPSHOT_CHANGED, type DailyPnlResult, type PortfolioSnapshotChangedDetail } from '../lib/daily-pnl';

const formatPnl = (value: number, currency: string, compact = false) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
      notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 2,
      signDisplay: 'always',
    }).format(value);
  } catch {
    return `${value > 0 ? '+' : ''}${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: compact ? 1 : 2 })}`;
  }
};

type MarketContributionGroup = {
  market: string;
  market_name: string;
  currency: string;
  winners: Array<{ name: string; code?: string | null; amount: number }>;
  losers: Array<{ name: string; code?: string | null; amount: number }>;
};

function getMarketContributions(review: DailyReview): MarketContributionGroup[] {
  const fromBrief = review.summary_brief?.contributions_by_market;
  if (fromBrief?.length) return fromBrief;

  // Older backend summaries saved exact per-security attribution in facts but
  // did not expose market groups. Recover those rows so mixed-currency days
  // still show the instruments instead of silently dropping all attribution.
  const attribution = review.summary_facts?.portfolio_result?.attribution || [];
  const amounts = review.summary_brief?.portfolio.amounts || [];
  const marketNames: Record<string, string> = { CN: 'A股', HK: '港股', US: '美股', CRYPTO: '加密资产' };
  const groups: MarketContributionGroup[] = [];
  for (const total of amounts) {
    const currencyRows = attribution.filter(row => row.currency === total.currency && Number.isFinite(row.pnl));
    if (!currencyRows.length) continue;
    const roundedTotal = Math.round(total.amount * 100) / 100;
    const roundedAttribution = currencyRows.reduce((sum, row) => sum + Math.round(row.pnl * 100) / 100, 0);
    if (Math.abs(roundedAttribution - roundedTotal) > 0.05) continue;
    const marketKeys = [...new Set(currencyRows.map(row => (row.market || 'OTHER').toUpperCase()))];
    for (const market of marketKeys) {
      const rows = currencyRows.filter(row => (row.market || 'OTHER').toUpperCase() === market).map(row => ({
        name: row.symbol || row.code || '未知证券', code: row.code,
        amount: Math.round(row.pnl * 100) / 100,
      }));
      const winners = rows.filter(row => row.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 3);
      const losers = rows.filter(row => row.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 3);
      if (winners.length || losers.length) groups.push({ market, market_name: marketNames[market] || market, currency: total.currency, winners, losers });
    }
  }
  return groups;
}

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const onboardParam = searchParams.get('onboard');
  const navigate = useNavigate();
  const dateParam = searchParams.get('date');
  const parsedDateParam = dateParam ? new Date(`${dateParam}T00:00:00`) : null;
  const selectedDate = parsedDateParam && localDate(parsedDateParam) === dateParam ? dateParam! : localDate();
  const todayDate = localDate();
  const todayMonthKey = todayDate.slice(0, 7);

  const [onboardingStep, setOnboardingStep] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${selectedDate.slice(0, 7)}-01T00:00:00`));
  const [showCalendarFilter, setShowCalendarFilter] = useState(false);
  const [dailyReview, setDailyReview] = useState<DailyReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [tradeReviewsGenerating, setTradeReviewsGenerating] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [portfolioPnl, setPortfolioPnl] = useState<DailyPnlResult | null>(null);
  const [portfolioPnlLoading, setPortfolioPnlLoading] = useState(true);
  const [portfolioPnlError, setPortfolioPnlError] = useState('');
  const [overviewPnl, setOverviewPnl] = useState<DailyPnlResult | null>(null);
  const [overviewPnlLoading, setOverviewPnlLoading] = useState(true);
  const [overviewPnlError, setOverviewPnlError] = useState('');
  const [tradeReviewError, setTradeReviewError] = useState('');
  const pnlRequestRef = useRef(0);
  const marketContributions = dailyReview ? getMarketContributions(dailyReview) : [];

  const { notes: attentionNotes, error: notesError, add: addNote, remove: removeNote } = useDailyNotes(selectedDate);
  const [newAttentionNote, setNewAttentionNote] = useState('');

  const handleAddAttentionNote = async () => {
    if (newAttentionNote.trim()) {
      try {
        await addNote(newAttentionNote);
      setNewAttentionNote('');
      } catch {
        // The shared note hook exposes request errors for inline feedback.
      }
    }
  };

  const handleDeleteAttentionNote = async (id: string) => {
    try { await removeNote(id); } catch { /* surfaced by the next reload or request */ }
  };

  const selectDate = (date: string) => {
    if (date === selectedDate) {
      setReviewLoading(true);
      setReviewError('');
      getDailyReview(date)
        .then(setDailyReview)
        .catch(error => setReviewError(error instanceof Error ? error.message : 'Unable to load this day\'s AI review.'))
        .finally(() => setReviewLoading(false));
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('date', date);
    setSearchParams(next);
  };

  const backToToday = () => {
    const today = localDate();
    setCalendarMonth(new Date(`${today.slice(0, 7)}-01T00:00:00`));
    selectDate(today);
  };

  const selectedDateLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });

  const openDailyAgent = () => {
    const prompt = `请结合 ${selectedDate} 的交易笔记、当日日记、标的笔记和历史关联记录，陪我做一次本日复盘。综合交易理由、笔记里的后续安排与实际执行，判断哪些决策合理、哪些值得商榷，以及有哪些结论值得继续验证。请引用具体记录；没有证据的地方明确说明，不要给买卖建议。`;
    navigate(`/agent?ref=daily-${selectedDate}&prompt=${encodeURIComponent(prompt)}`);
  };

  useEffect(() => {
    setCalendarMonth(new Date(`${selectedDate.slice(0, 7)}-01T00:00:00`));
  }, [selectedDate]);

  useEffect(() => {
    let active = true;
    setReviewLoading(true);
    setDailyReview(null);
    setTradeReviewError('');
    setReviewError('');
    getDailyReview(selectedDate)
      .then(result => { if (active) setDailyReview(result); })
      .catch(error => {
        if (active) {
          const message = error instanceof Error ? error.message : 'Unable to load this day\'s review.';
          setReviewError(message);
          setTradeReviewError(message);
        }
      })
      .finally(() => { if (active) setReviewLoading(false); });
    return () => { active = false; };
  }, [selectedDate]);

  useEffect(() => {
    const handleInputsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ date: string; kind?: 'trade' | 'note' }>).detail;
      const changedDate = detail?.date;
      if (changedDate === selectedDate) {
        void getDailyReview(selectedDate)
          .then(setDailyReview)
          .catch(error => setTradeReviewError(error instanceof Error ? error.message : 'Unable to refresh trade records.'));
      }
    };
    window.addEventListener(DAILY_REVIEW_INPUTS_CHANGED, handleInputsChanged);
    return () => window.removeEventListener(DAILY_REVIEW_INPUTS_CHANGED, handleInputsChanged);
  }, [selectedDate]);

  const handleGenerateSummary = async () => {
    setSummaryGenerating(true);
    setReviewError('');
    try {
      setDailyReview(await generateDailySummary(selectedDate));
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Daily summary generation failed. Please retry.');
    } finally {
      setSummaryGenerating(false);
    }
  };

  const handleGenerateTradeReviews = async () => {
    setTradeReviewsGenerating(true);
    setTradeReviewError('');
    try {
      setDailyReview(await generateTradeReviews(selectedDate));
    } catch (error) {
      setTradeReviewError(error instanceof Error ? error.message : 'Trade review generation failed. Please retry.');
    } finally {
      setTradeReviewsGenerating(false);
    }
  };

  const handleReloadTradeReview = async () => {
    setReviewLoading(true);
    setTradeReviewError('');
    try {
      setDailyReview(await getDailyReview(selectedDate));
    } catch (error) {
      setTradeReviewError(error instanceof Error ? error.message : 'Unable to load this day\'s review.');
    } finally {
      setReviewLoading(false);
    }
  };

  const tradeReviewEvidence = new Map((dailyReview?.trade_review_evidence || []).map(item => [item.ref_id, item]));
  const formatBriefAmount = (amount: number, currency: string) => `${amount > 0 ? '+' : ''}${currency} ${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    if (onboardParam === '1') setOnboardingStep(1);
    else if (onboardParam === '2') setOnboardingStep(2);
    else if (onboardParam === 'done') {
      setOnboardingStep(0);
      localStorage.setItem('m-tradingnote-onboarded', 'true');
    }
    else {
      const hasCompleted = localStorage.getItem('m-tradingnote-onboarded');
      if (!hasCompleted) {
        setOnboardingStep(1);
      } else {
        setOnboardingStep(0);
      }
    }
  }, [onboardParam]);

  const handleFinishOnboarding = () => {
    setOnboardingStep(0);
    localStorage.setItem('m-tradingnote-onboarded', 'true');
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('onboard', 'done');
      return next;
    });
  };

  const monthKey = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = calendarMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const calendarDaysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarCells: Array<number | null> = [
    ...Array.from({ length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay() }, () => null),
    ...Array.from({ length: calendarDaysInMonth }, (_, index) => index + 1)
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  useEffect(() => {
    let active = true;
    let pnlReloadTimer: number | undefined;
    const today = localDate();
    const currentMonth = today.slice(0, 7);
    const loadOverviewPnl = (requestId: number) => {
      setOverviewPnlLoading(true);
      setOverviewPnlError('');
      void getDailyPnl(`${currentMonth}-01`, today)
        .then(result => { if (active && requestId === pnlRequestRef.current) setOverviewPnl(result); })
        .catch(error => { if (active && requestId === pnlRequestRef.current) setOverviewPnlError(error instanceof Error ? error.message : 'Unable to calculate portfolio P&L.'); })
        .finally(() => { if (active && requestId === pnlRequestRef.current) setOverviewPnlLoading(false); });
    };
    const loadPnl = () => {
      const requestId = ++pnlRequestRef.current;
      setPortfolioPnlLoading(true);
      setPortfolioPnlError('');
      const lastDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
      const endDate = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
      const calendarEnd = endDate > today ? today : endDate;
      if (`${monthKey}-01` > today) {
        setPortfolioPnl({ baseline_date: null, days: [], month_summary: {}, warnings: [], incomplete_dates: [] });
        setPortfolioPnlLoading(false);
      } else {
        void getDailyPnl(`${monthKey}-01`, calendarEnd)
          .then(result => {
            if (active && requestId === pnlRequestRef.current) {
              setPortfolioPnl(result);
              if (monthKey === currentMonth) {
                setOverviewPnl(result);
                setOverviewPnlError('');
                setOverviewPnlLoading(false);
              }
            }
          })
          .catch(error => { if (active && requestId === pnlRequestRef.current) setPortfolioPnlError(error instanceof Error ? error.message : 'Unable to calculate daily P&L.'); })
          .finally(() => { if (active && requestId === pnlRequestRef.current) setPortfolioPnlLoading(false); });
      }
      if (monthKey !== currentMonth) loadOverviewPnl(requestId);
    };
    const handleSnapshotChanged = (event: Event) => {
      const snapshotDate = (event as CustomEvent<PortfolioSnapshotChangedDetail>).detail?.date;
      const snapshotMonth = snapshotDate?.slice(0, 7);
      if (snapshotMonth && snapshotMonth !== monthKey) {
        const [year, month] = snapshotMonth.split('-').map(Number);
        setCalendarMonth(new Date(year, month - 1, 1));
        return;
      }
      loadPnl();
    };
    const schedulePnlReload = () => {
      window.clearTimeout(pnlReloadTimer);
      pnlReloadTimer = window.setTimeout(loadPnl, 120);
    };
    loadPnl();
    window.addEventListener(DAILY_REVIEW_INPUTS_CHANGED, schedulePnlReload);
    window.addEventListener(PORTFOLIO_SNAPSHOT_CHANGED, handleSnapshotChanged);
    return () => {
      active = false;
      window.clearTimeout(pnlReloadTimer);
      window.removeEventListener(DAILY_REVIEW_INPUTS_CHANGED, schedulePnlReload);
      window.removeEventListener(PORTFOLIO_SNAPSHOT_CHANGED, handleSnapshotChanged);
    };
  }, [monthKey, todayDate, todayMonthKey]);

  const pnlByDate = new Map((portfolioPnl?.days || []).map(item => [item.date, item]));

  return (
    <div className="w-full min-h-full pb-[80px] bg-[#F8F9FA]">
      {/* Top Header */}
      <div className="bg-white px-3 pt-[54px] pb-2 shadow-[0_2px_10px_rgba(0,0,0,0.02)] relative z-20 sticky top-0 border-b border-slate-100">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#0B2545] flex items-center justify-center text-white font-bold text-[12px] shadow-sm">
              M
            </div>
            <span className="font-bold text-[16px] text-[#0B2545] tracking-wide">M-TradingNote</span>
          </div>
        </div>
      </div>

      <div className={cn("px-2.5 py-2.5 space-y-2.5 relative", onboardingStep === 1 ? "" : "z-0")}>
        
        {/* Portfolio overview from stored holdings and trade records */}
        <div className={cn(
          "relative transition-all duration-300",
          onboardingStep === 1 ? "z-[101] ring-4 ring-white/60 shadow-2xl scale-[1.02]" : "z-10"
        )}>
          <HoldingsSnapshotModule pnl={overviewPnl} loading={overviewPnlLoading} error={overviewPnlError} />

          {onboardingStep === 1 && (
            <div className="absolute top-full left-0 right-0 mt-4 bg-white rounded-xl p-3.5 shadow-xl animate-in fade-in slide-in-from-top-2 z-[102] pointer-events-auto text-left">
              <div className="absolute -top-2 left-8 w-4 h-4 bg-white rotate-45 rounded-sm"></div>
              <div className="relative z-10 text-[#0B2545] text-[12px] font-medium leading-relaxed mb-3">
                Choose a security and import its complete trade history to build the position and P&amp;L view.
              </div>
              <div className="flex justify-end">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleFinishOnboarding(); }} 
                  className="bg-[#EE6C4D] text-white px-4 py-1.5 rounded-lg text-[11px] font-bold active:bg-[#F57C00] transition-colors shadow-sm"
                >
                  Got it!
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Trading Calendar */}
        <div className="relative z-10">
          <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-[0_4px_16px_rgba(11,37,69,0.05)] relative z-10 overflow-hidden">
            <div className="flex justify-between items-center gap-2 mb-1.5 ml-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <h2 className="shrink-0 text-[14px] font-bold text-[#0B2545] tracking-tight">Trading Calendar</h2>
                <button type="button" onClick={backToToday} className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[8px] font-bold text-[#0B2545] hover:border-[#EE6C4D] hover:text-[#EE6C4D]">Back to today</button>
              </div>
              <div className="flex items-center gap-1.5 bg-slate-50/80 backdrop-blur-sm border border-slate-100/80 rounded-lg px-2 py-1 shadow-sm">
                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} aria-label="Previous month" className="text-slate-400 hover:text-slate-600 active:scale-95 transition-transform">
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[10px] font-bold text-slate-500 font-mono tracking-wider min-w-[50px] text-center">{monthLabel}</span>
                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} aria-label="Next month" className="text-slate-400 hover:text-slate-600 active:scale-95 transition-transform">
                  <ChevronRight size={12} />
                </button>
                <div className="w-px h-3 bg-slate-200 mx-0.5"></div>
                <button onClick={() => setShowCalendarFilter(open => !open)} aria-label="Calendar filters" aria-expanded={showCalendarFilter} className={cn("transition-transform active:scale-95", showCalendarFilter ? "text-[#EE6C4D]" : "text-slate-400 hover:text-slate-600")}>
                  <Search size={12} />
                </button>
              </div>
            </div>

            {showCalendarFilter && (
              <div className="flex items-center justify-between gap-2 mb-2 px-1">
                <input
                  aria-label="Filter calendar by month"
                  type="month"
                  value={monthKey}
                  onChange={event => {
                    const [year, month] = event.target.value.split('-').map(Number);
                    if (year && month) setCalendarMonth(new Date(year, month - 1, 1));
                  }}
                  className="min-w-0 bg-white border border-slate-200 rounded-md px-1.5 py-1 text-[9px] text-slate-600"
                />
                <span title={portfolioPnlError || undefined} className="text-[9px] text-slate-400">{portfolioPnlError ? 'P&L unavailable' : portfolioPnlLoading ? 'Calculating…' : portfolioPnl?.baseline_date ? `Since ${portfolioPnl.baseline_date}` : 'Snapshot required'}</span>
              </div>
            )}
            
            <div className="grid grid-cols-7 gap-0.5 mb-0.5 text-center">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-[7px] font-bold text-slate-400 py-0.5">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 ml-1">
              {calendarCells.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} className="h-11" />;
                const dayKey = `${monthKey}-${String(day).padStart(2, '0')}`;
                const isSelected = dayKey === selectedDate;
                const dayPnl = pnlByDate.get(dayKey);
                const pnlEntries = dayPnl ? Object.entries(dayPnl.pnl_by_currency) : [];
                const pnlLines = pnlEntries.length > 1
                  ? pnlEntries.slice(0, 2).map(([currency, value]) => `${currency} ${value > 0 ? '+' : ''}${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`)
                  : pnlEntries.length === 1 ? [formatPnl(pnlEntries[0][1], pnlEntries[0][0], true)] : [];
                const pnlValue = pnlLines.join('\n') || (dayPnl && !dayPnl.complete ? '—' : '');
                const pnlLabel = pnlValue && dayPnl && !dayPnl.complete ? `~${pnlValue}` : pnlValue;
                const pnlColor = pnlEntries.length === 1 && pnlEntries[0][1] > 0
                  ? (isSelected ? 'text-emerald-200' : 'text-emerald-600')
                  : pnlEntries.length === 1 && pnlEntries[0][1] < 0
                    ? (isSelected ? 'text-rose-200' : 'text-rose-600')
                    : (isSelected ? 'text-white/70' : 'text-slate-400');
                const pnlTotal = pnlEntries.reduce((sum, [, value]) => sum + value, 0);
                const pnlCellTone = dayPnl?.complete && pnlTotal > 0
                  ? isSelected ? '!bg-emerald-600 !text-white' : 'bg-emerald-100 text-emerald-800'
                  : dayPnl?.complete && pnlTotal < 0
                    ? isSelected ? '!bg-rose-600 !text-white' : 'bg-rose-100 text-rose-700'
                    : isSelected ? '!bg-[#0B2545] !text-white' : 'bg-slate-50 text-slate-500';
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDate(dayKey)}
                    className={cn(
                      "h-11 min-w-0 cursor-pointer rounded-lg px-0.5 flex flex-col items-center justify-center gap-1 leading-none transition-colors active:scale-95",
                      pnlCellTone,
                      isSelected && "ring-1 ring-[#EE6C4D] shadow-sm"
                    )}
                  >
                    <span className="text-[11px] font-bold">{day}</span>
                    {pnlLabel && <span title={dayPnl?.complete
                      ? pnlEntries.map(([currency, value]) => formatPnl(value, currency)).join(' · ')
                      : dayPnl?.reason === 'snapshot_anchor'
                        ? 'Snapshot date: same-day P&L cannot be derived from an end-of-day snapshot.'
                        : `${dayPnl?.snapshot_mismatch ? 'Partial P&L; trade ledger does not reconcile with snapshot' : 'Partial P&L; missing close'}: ${(dayPnl?.missing_instruments || []).map(item => `${item.symbol} (${item.code})`).join(', ') || 'price history incomplete'}`}
                      className={cn("max-w-full text-[7px] leading-[8px] font-semibold font-mono", pnlEntries.length > 1 && "flex flex-col gap-px")}>{pnlEntries.length > 1
                        ? pnlLines.map((line, lineIndex) => {
                          const value = pnlEntries[lineIndex][1];
                          const lineColor = value > 0 ? isSelected ? 'text-emerald-200' : 'text-emerald-600' : value < 0 ? isSelected ? 'text-rose-200' : 'text-rose-600' : pnlColor;
                          return <span key={pnlEntries[lineIndex][0]} className={cn("max-w-full truncate", lineColor)}>{dayPnl && !dayPnl.complete ? '~' : ''}{line}</span>;
                        })
                        : <span className={cn("max-w-full truncate", pnlColor)}>{pnlLabel}</span>}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Compact daily AI review summary */}
        <div id="attention-module" className="relative z-10">
          <div className="bg-white/90 backdrop-blur-md rounded-xl p-2.5 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#EE6C4D]/5 rounded-full blur-xl pointer-events-none"></div>
            
            <div className="flex items-center justify-between gap-2 mb-1.5 relative z-10">
              <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#EE6C4D]" /> 市场与组合日评
              </h2>
              <button
                onClick={() => void handleGenerateSummary()}
                disabled={reviewLoading || summaryGenerating}
                className="bg-[#0B2545] hover:bg-[#134074] active:scale-95 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-60"
              >
                {summaryGenerating ? <RefreshCw size={11} className="animate-spin" /> : dailyReview?.summary ? <RefreshCw size={11} /> : <Sparkles size={11} />}
                {summaryGenerating ? '生成中…' : dailyReview?.summary_brief ? '重新生成' : '生成日评'}
              </button>
            </div>
            
            <div className="bg-[#0B2545]/[0.03] p-2 rounded-lg border border-[#0B2545]/10 relative z-10">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">{selectedDateLabel}</div>
              {reviewLoading ? <p className="text-[11px] text-slate-400">正在加载日评…</p> : dailyReview?.summary_brief ? (
                <>
                  <div className="space-y-2.5">
                    <section>
                      <h3 className="mb-0.5 text-[11px] font-bold text-[#0B2545]">市场表现</h3>
                      {dailyReview.summary_brief.market.text && <p className="text-[11px] leading-relaxed text-[#134074]">{dailyReview.summary_brief.market.text}</p>}
                      {dailyReview.summary_brief.market.sectors.length > 0 && (
                        <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-slate-600">
                          <p className="font-semibold">持仓关联行业</p>
                          {dailyReview.summary_brief.market.sectors.map(sector => (
                            <p key={`${sector.name}-${sector.date}`}>
                              {sector.name} {sector.change_pct > 0 ? '+' : ''}{sector.change_pct.toFixed(2)}%
                            </p>
                          ))}
                        </div>
                      )}
                      {((dailyReview.summary_brief.market.leaders?.length ?? 0) > 0 || (dailyReview.summary_brief.market.laggards?.length ?? 0) > 0) && (
                        <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-slate-600">
                          {!!dailyReview.summary_brief.market.leaders?.length && <p>板块偏强：{dailyReview.summary_brief.market.leaders.map(item => `${item.name} ${item.change_pct > 0 ? '+' : ''}${item.change_pct.toFixed(2)}%`).join('、')}</p>}
                          {!!dailyReview.summary_brief.market.laggards?.length && <p>板块偏弱：{dailyReview.summary_brief.market.laggards.map(item => `${item.name} ${item.change_pct > 0 ? '+' : ''}${item.change_pct.toFixed(2)}%`).join('、')}</p>}
                        </div>
                      )}
                      {dailyReview.summary_brief.market.breadth?.status === 'complete' && (
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                          A股前一交易日（{dailyReview.summary_brief.market.breadth.date}）：上涨 {dailyReview.summary_brief.market.breadth.up} 只、下跌 {dailyReview.summary_brief.market.breadth.down} 只{dailyReview.summary_brief.market.breadth.flat != null ? `、平盘 ${dailyReview.summary_brief.market.breadth.flat} 只` : ''}
                          {dailyReview.summary_brief.market.breadth.url && <> · <a href={dailyReview.summary_brief.market.breadth.url} target="_blank" rel="noreferrer" className="text-[#134074] underline">{dailyReview.summary_brief.market.breadth.source || '来源'}</a></>}
                        </p>
                      )}
                      {dailyReview.summary_brief.market.commodities?.map(item => (
                        <p key={item.code} className="mt-1 text-[11px] leading-relaxed text-slate-600">
                          {item.name} {item.currency}/{item.unit} {item.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({item.change_pct > 0 ? '+' : ''}{item.change_pct.toFixed(2)}%)
                        </p>
                      ))}
                    </section>
                    <section>
                      <h3 className="mb-0.5 text-[11px] font-bold text-[#0B2545]">组合表现</h3>
                      {dailyReview.summary_brief.portfolio.amounts.length > 0 && (
                        <p className="text-[13px] font-bold text-[#0B2545]">
                          {dailyReview.summary_brief.portfolio.amounts.map(item => formatBriefAmount(item.amount, item.currency)).join(' ｜ ')}
                        </p>
                      )}
                    </section>
                    {(marketContributions.length > 0 || dailyReview.summary_brief.winners.length > 0 || dailyReview.summary_brief.losers.length > 0) && (
                      <section>
                        <h3 className="mb-0.5 text-[11px] font-bold text-[#0B2545]">分市场标的盈亏贡献</h3>
                        {marketContributions.length ? marketContributions.map(group => (
                          <div key={`${group.market}-${group.currency}`} className="text-[11px] leading-relaxed">
                            <p className="font-semibold text-slate-700">{group.market_name}（{group.currency}）</p>
                            {group.winners.length > 0 && <p className="text-emerald-700">正贡献：{group.winners.map(item => `${item.name} ${formatBriefAmount(item.amount, group.currency)}`).join('、')}</p>}
                            {group.losers.length > 0 && <p className="text-rose-700">负贡献：{group.losers.map(item => `${item.name} ${formatBriefAmount(item.amount, group.currency)}`).join('、')}</p>}
                          </div>
                        )) : <>
                          {dailyReview.summary_brief.winners.length > 0 && <p className="text-[11px] leading-relaxed text-emerald-700">正贡献：{dailyReview.summary_brief.winners.map(item => `${item.name} ${formatBriefAmount(item.amount, item.currency)}`).join('、')}</p>}
                          {dailyReview.summary_brief.losers.length > 0 && <p className="text-[11px] leading-relaxed text-rose-700">负贡献：{dailyReview.summary_brief.losers.map(item => `${item.name} ${formatBriefAmount(item.amount, item.currency)}`).join('、')}</p>}
                        </>}
                      </section>
                    )}
                  </div>
                  {dailyReview.summary_brief.narrative?.insight && <p className="mt-2 text-[11px] leading-relaxed text-[#134074]">{dailyReview.summary_brief.narrative.insight}</p>}
                </>
              ) : <p className="text-[11px] text-slate-400">{dailyReview?.summary ? '已有旧版摘要。请重新生成结构化日评。' : '生成该日的市场与持仓日评。'}</p>}
              {reviewError && <p role="alert" className="mt-1.5 text-[10px] text-rose-600">{reviewError}</p>}
            </div>
          </div>
        </div>

        {/* Trades Module (Migrated from Daily Review) */}
        <div id="daily-trades" className="scroll-mt-20">
          <TradesModule isCard={true} tradeDate={selectedDate} view="day" />
        </div>

        {/* My Notes Module */}
        <div id="notes-module" className="pt-1.5 pb-1 relative z-10">
          <div className="bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative overflow-hidden">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-[13px] font-bold text-[#0B2545] flex items-center gap-1.5">
                <Edit3 size={14} className="text-[#EE6C4D]" /> My notes
              </div>
            </div>
            
            <div className="flex gap-2 mb-3">
              <textarea
                value={newAttentionNote}
                maxLength={500}
                onChange={(e) => setNewAttentionNote(e.target.value.slice(0, 500))}
                placeholder="What do you want to keep an eye on?"
                className="flex-1 min-h-9 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-[#EE6C4D] placeholder:text-slate-400 text-[#0B2545] shadow-sm transition-colors min-w-0 resize-y"
              />
              <button 
                onClick={handleAddAttentionNote}
                disabled={!newAttentionNote.trim()}
                className={cn(
                  "px-3 py-1.5 font-bold text-[12px] rounded-lg transition-colors flex items-center gap-1 shrink-0 shadow-sm",
                  newAttentionNote.trim() ? "bg-[#0B2545] text-white active:bg-[#134074]" : "bg-[#E2E8F0] text-[#64748B]"
                )}
              >
                <Plus size={12} /> Add
              </button>
            </div>

            <div className="space-y-2 mb-3">
              {attentionNotes.map(note => (
                <div key={note.id} className="bg-[#EE6C4D]/5 border border-[#EE6C4D]/20 rounded-xl p-2.5 relative group">
                  <button 
                    onClick={() => handleDeleteAttentionNote(note.id)}
                    className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X size={12} />
                  </button>
                  <div className="flex items-start gap-1.5 pr-6">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] shrink-0 mt-1.5"></div>
                    <ExpandableNoteText text={note.text} className="text-[12px] text-[#0B2545] leading-relaxed font-medium" />
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-1.5 ml-3">
                    {formatNoteDate(note)}
                  </div>
                </div>
              ))}
            </div>
            {notesError && <p role="alert" className="text-[10px] text-rose-600 mb-2">{notesError}</p>}
            
            <button 
              onClick={() => navigate('/notes')}
              className="w-full py-2 mt-1 text-[11px] font-bold text-slate-500 hover:text-[#0B2545] transition-colors flex items-center justify-center gap-1 border-t border-slate-100/60"
            >
              View All Notes <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {
          <div id="daily-trade-review" className="scroll-mt-20 pt-1.5 pb-1 relative z-10">
            <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-[0_4px_16px_rgba(11,37,69,0.05)]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-[#0B2545]"><Sparkles size={13} className="text-[#EE6C4D]" /> Trade Review</h2>
                <span className="text-[9px] font-mono text-slate-400">{selectedDateLabel}</span>
              </div>
              {reviewLoading ? <p className="mb-2 text-[10px] text-slate-400">Loading trade review…</p> : !dailyReview ? <p className="mb-2 text-[10px] leading-relaxed text-amber-700">Trade data is pending sync. The review mode cannot be determined yet.</p> : dailyReview.trade_review_mode === 'empty' && !dailyReview.trade_reviews_generated_at ? <p className="mb-2 text-[10px] leading-relaxed text-slate-500">No trades or relevant notes today. Generate a no-trade review to record this day's status.</p> : null}
              {(dailyReview?.trade_count ?? 0) > 0 && dailyReview?.trade_review_stats && (
                <p className="mb-2 text-[9px] text-slate-400">{dailyReview.trade_review_stats.trade_count} trade(s) reviewed · Earlier trades and relevant notes included when available</p>
              )}
              {dailyReview?.trade_review_overview && (dailyReview.trade_review_mode !== 'empty' || dailyReview.trade_reviews_generated_at) && (
                <div className="mb-2.5 rounded-lg border border-[#0B2545]/10 bg-[#0B2545]/[0.03] p-2.5">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Daily trade assessment</div>
                  <p className="text-[11px] font-medium leading-relaxed text-[#134074]">{dailyReview.trade_review_overview}</p>
                </div>
              )}
              {dailyReview?.trade_review_observations?.length ? <div className="mb-2.5 space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-2.5">{dailyReview.trade_review_observations.map((item, index) => <p key={index} className="text-[11px] leading-relaxed text-slate-600">{item}</p>)}</div> : null}
              {dailyReview?.trade_reviews?.length ? <div className="space-y-2">
                {dailyReview.trade_reviews.map(item => (
                  <div key={item.trade_id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    <div className="mb-1 text-[11px] font-bold text-[#0B2545]">{item.symbol}{item.title ? <span className="font-semibold"> · {item.title}</span> : null}</div>
                    <p className="text-[11px] leading-relaxed text-slate-600">{item.review}</p>
                    {item.follow_up_question && <p className="mt-1.5 text-[10px] font-medium text-[#134074]">To complete the review: {item.follow_up_question}</p>}
                    {item.evidence_refs?.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-slate-200/70 pt-1.5">
                        {item.evidence_refs.map(refId => {
                          const evidence = tradeReviewEvidence.get(refId);
                          return evidence ? (
                            <details key={refId} className="text-[9px] text-slate-500">
                              <summary className="cursor-pointer font-semibold text-[#EE6C4D]">Source · {evidence.label}</summary>
                              <p className="mt-1 rounded bg-white p-1.5 leading-relaxed text-slate-500">{evidence.excerpt}</p>
                            </details>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div> : dailyReview && dailyReview.trade_review_mode !== 'empty' && !dailyReview.trade_review_overview && <p className="mb-2 text-[10px] text-slate-500">No review generated for this day yet.</p>}
              {dailyReview?.trade_review_questions?.length ? <div className="mt-2.5 rounded-lg border border-amber-100 bg-amber-50/70 p-2.5">
                <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-amber-800">Questions to confirm</div>
                {dailyReview.trade_review_questions.slice(0, 2).map((question, index) => <p key={index} className="text-[10px] leading-relaxed text-slate-700">{question}</p>)}
              </div> : null}
              <div className="flex items-center justify-between gap-2">
                {tradeReviewError && <p role="alert" className="text-[9px] text-rose-600">{tradeReviewError}</p>}
                {!dailyReview ? tradeReviewError ? (
                  <button type="button" onClick={() => void handleReloadTradeReview()} disabled={reviewLoading} className="ml-auto rounded-lg bg-[#0B2545] px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-60">
                    {reviewLoading ? 'Loading…' : 'Retry loading'}
                  </button>
                ) : null : dailyReview.trade_review_mode === 'empty' ? (
                  <button type="button" onClick={() => void handleGenerateTradeReviews()} disabled={reviewLoading || tradeReviewsGenerating} className="ml-auto rounded-lg bg-[#0B2545] px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-60">
                    {tradeReviewsGenerating ? 'Analyzing…' : dailyReview.trade_reviews_generated_at ? 'Regenerate' : 'Generate trade review'}
                  </button>
                ) : (
                  <button type="button" onClick={() => void handleGenerateTradeReviews()} disabled={reviewLoading || tradeReviewsGenerating} className="ml-auto rounded-lg bg-[#0B2545] px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-60">
                    {tradeReviewsGenerating ? 'Analyzing…' : dailyReview?.trade_reviews_generated_at ? 'Regenerate' : dailyReview?.trade_review_mode === 'note_tracking' ? 'Review notes' : 'Generate trade review'}
                  </button>
                )}
              </div>
              {dailyReview?.trade_review_mode !== 'empty' && dailyReview?.trade_reviews_generated_at && <p className="mt-2 text-right text-[9px] text-slate-400">Generated {new Date(dailyReview.trade_reviews_generated_at).toLocaleString('en-US')}</p>}
            </div>
          </div>
        }

      </div>

      <div className="fixed bottom-6 right-4 z-40">
        <button
          onClick={openDailyAgent}
          aria-label={`Discuss ${selectedDate} with M-Agent`}
          title="Discuss this day with M-Agent"
          className="flex items-center gap-2 rounded-full bg-[#0B2545] px-3.5 py-3 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        >
          <BotMessageSquare size={18} />
          <span className="text-[11px] font-bold">Ask M-Agent</span>
        </button>
      </div>

      {onboardingStep > 0 && (
        <div className="fixed inset-0 z-[100]">
          <div 
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity"
            onClick={() => {
              if (onboardingStep === 1) handleFinishOnboarding();
            }}
          />
        </div>
      )}
    </div>
  );
}
