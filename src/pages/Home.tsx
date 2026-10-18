import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Plus, X, Sparkles, Edit3, ChevronLeft, ChevronRight, Search, RefreshCw
} from 'lucide-react';
import { cn } from '../lib/utils';
import TradesModule from '../components/TradesModule';
import { formatNoteDate, localDate, useDailyNotes } from '../lib/daily-notes';
import ExpandableNoteText from '../components/ExpandableNoteText';
import HoldingsSnapshotModule from '../components/HoldingsSnapshotModule';
import { DAILY_REVIEW_INPUTS_CHANGED, generateDailySummary, generateTradeReviews, getDailyReview, type DailyReview } from '../lib/daily-review';
import { getDailyPnl, PORTFOLIO_SNAPSHOT_CHANGED, type DailyPnlResult } from '../lib/daily-pnl';

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

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const onboardParam = searchParams.get('onboard');
  const navigate = useNavigate();
  const dateParam = searchParams.get('date');
  const parsedDateParam = dateParam ? new Date(`${dateParam}T00:00:00`) : null;
  const selectedDate = parsedDateParam && localDate(parsedDateParam) === dateParam ? dateParam! : localDate();

  const [onboardingStep, setOnboardingStep] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${selectedDate.slice(0, 7)}-01T00:00:00`));
  const [showCalendarFilter, setShowCalendarFilter] = useState(false);
  const [dailyReview, setDailyReview] = useState<DailyReview | null>(null);
  const [summaryStale, setSummaryStale] = useState(false);
  const [tradeReviewsStale, setTradeReviewsStale] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [tradeReviewsGenerating, setTradeReviewsGenerating] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [portfolioPnl, setPortfolioPnl] = useState<DailyPnlResult | null>(null);
  const [portfolioPnlLoading, setPortfolioPnlLoading] = useState(true);
  const [portfolioPnlError, setPortfolioPnlError] = useState('');

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
    const next = new URLSearchParams(searchParams);
    next.set('date', date);
    setSearchParams(next);
  };

  const selectedDateLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });

  useEffect(() => {
    setCalendarMonth(new Date(`${selectedDate.slice(0, 7)}-01T00:00:00`));
  }, [selectedDate]);

  useEffect(() => {
    let active = true;
    setReviewLoading(true);
    setDailyReview(null);
    setSummaryStale(false);
    setTradeReviewsStale(false);
    setReviewError('');
    getDailyReview(selectedDate)
      .then(result => { if (active) setDailyReview(result); })
      .catch(error => { if (active) setReviewError(error instanceof Error ? error.message : 'Unable to load this day\'s AI review.'); })
      .finally(() => { if (active) setReviewLoading(false); });
    return () => { active = false; };
  }, [selectedDate]);

  useEffect(() => {
    const handleInputsChanged = (event: Event) => {
      const changedDate = (event as CustomEvent<{ date: string }>).detail?.date;
      if (changedDate === selectedDate) {
        setSummaryStale(true);
        setTradeReviewsStale(true);
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
      setSummaryStale(false);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Daily summary generation failed. Please retry.');
    } finally {
      setSummaryGenerating(false);
    }
  };

  const handleGenerateTradeReviews = async () => {
    setTradeReviewsGenerating(true);
    setReviewError('');
    try {
      setDailyReview(await generateTradeReviews(selectedDate));
      setTradeReviewsStale(false);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Trade review generation failed. Please retry.');
    } finally {
      setTradeReviewsGenerating(false);
    }
  };

  const showTradeReviews = () => document.getElementById('daily-trade-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
    const loadPnl = () => {
      setPortfolioPnlLoading(true);
      setPortfolioPnlError('');
      const lastDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
      const endDate = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
      void getDailyPnl(`${monthKey}-01`, endDate)
        .then(result => { if (active) setPortfolioPnl(result); })
        .catch(error => { if (active) setPortfolioPnlError(error instanceof Error ? error.message : 'Unable to calculate daily P&L.'); })
        .finally(() => { if (active) setPortfolioPnlLoading(false); });
    };
    loadPnl();
    window.addEventListener(DAILY_REVIEW_INPUTS_CHANGED, loadPnl);
    window.addEventListener(PORTFOLIO_SNAPSHOT_CHANGED, loadPnl);
    return () => {
      active = false;
      window.removeEventListener(DAILY_REVIEW_INPUTS_CHANGED, loadPnl);
      window.removeEventListener(PORTFOLIO_SNAPSHOT_CHANGED, loadPnl);
    };
  }, [monthKey]);

  const pnlByDate = new Map((portfolioPnl?.days || []).map(item => [item.date, item]));
  const monthPnlEntries = Object.entries(portfolioPnl?.month_summary?.pnl_by_currency || {});
  const monthPnlLabel = monthPnlEntries.length
    ? monthPnlEntries.map(([currency, value]) => formatPnl(value, currency)).join(' · ')
    : '—';
  const pnlStatus = portfolioPnlLoading
    ? 'Calculating daily P&L…'
    : portfolioPnlError
      ? portfolioPnlError
      : [
          ...(portfolioPnl?.warnings || []).slice(0, 2),
          ...(portfolioPnl?.incomplete_dates?.length ? [`P&L is hidden for ${portfolioPnl.incomplete_dates.length} day(s) with incomplete prices.`] : []),
        ].join(' ')
          || 'Based on uploaded positions and trades only. Original currencies are kept.';

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
          <HoldingsSnapshotModule asOf={selectedDate} dayPnl={pnlByDate.get(selectedDate)} pnlLoading={portfolioPnlLoading} />

          {onboardingStep === 1 && (
            <div className="absolute top-full left-0 right-0 mt-4 bg-white rounded-xl p-3.5 shadow-xl animate-in fade-in slide-in-from-top-2 z-[102] pointer-events-auto text-left">
              <div className="absolute -top-2 left-8 w-4 h-4 bg-white rotate-45 rounded-sm"></div>
              <div className="relative z-10 text-[#0B2545] text-[12px] font-medium leading-relaxed mb-3">
                Import a dated holdings snapshot to see total assets, daily results, and market values here.
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
        <div className="pt-2 pb-1 relative z-10">
          <div className="bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative z-10 overflow-hidden">
            <div className="flex justify-between items-center mb-2 ml-1">
              <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight">Trading Calendar</h2>
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
                <span className="text-[9px] text-slate-400">{portfolioPnlLoading ? 'Calculating…' : portfolioPnl?.baseline_date ? `Since ${portfolioPnl.baseline_date}` : 'Snapshot required'}</span>
              </div>
            )}
            
            <div className="grid grid-cols-3 gap-2 mb-2 ml-1">
              <div>
                <div className="text-slate-400 text-[8px] mb-0.5 uppercase tracking-wider">Month PnL</div>
                <div title={monthPnlLabel} className={cn("max-w-full truncate font-bold text-[9px] font-mono", monthPnlEntries.some(([, value]) => value > 0) && !monthPnlEntries.some(([, value]) => value < 0) ? 'text-emerald-600' : monthPnlEntries.some(([, value]) => value < 0) && !monthPnlEntries.some(([, value]) => value > 0) ? 'text-rose-600' : 'text-[#0B2545]')}>{monthPnlLabel}</div>
              </div>
              <div>
                <div className="text-slate-400 text-[8px] mb-0.5 uppercase tracking-wider">Win / Loss Days</div>
                <div className="text-slate-500 font-bold text-[10px] font-mono">{portfolioPnl?.month_summary?.win_days ?? '—'} / {portfolioPnl?.month_summary?.loss_days ?? '—'}</div>
              </div>
              <div>
                <div className="text-slate-400 text-[8px] mb-0.5 uppercase tracking-wider">Best Day</div>
                <div className="text-slate-500 font-bold text-[10px] font-mono">{portfolioPnl?.month_summary?.best_day != null && monthPnlEntries.length === 1 ? formatPnl(portfolioPnl.month_summary.best_day, monthPnlEntries[0][0], true) : '—'}</div>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-0.5 text-center">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-[7px] font-bold text-slate-400 py-0.5">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 ml-1">
              {calendarCells.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} className="h-9" />;
                const dayKey = `${monthKey}-${String(day).padStart(2, '0')}`;
                const isSelected = dayKey === selectedDate;
                const dayPnl = pnlByDate.get(dayKey);
                const pnlEntries = dayPnl?.complete ? Object.entries(dayPnl.pnl_by_currency) : [];
                const pnlLabel = pnlEntries.length > 1
                  ? pnlEntries.slice(0, 2).map(([currency, value]) => `${currency} ${value > 0 ? '+' : ''}${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`).join(' ')
                  : pnlEntries.length === 1 ? formatPnl(pnlEntries[0][1], pnlEntries[0][0], true) : dayPnl && !dayPnl.complete ? '—' : '';
                const pnlColor = pnlEntries.length === 1 && pnlEntries[0][1] > 0
                  ? (isSelected ? 'text-emerald-200' : 'text-emerald-600')
                  : pnlEntries.length === 1 && pnlEntries[0][1] < 0
                    ? (isSelected ? 'text-rose-200' : 'text-rose-600')
                    : (isSelected ? 'text-white/70' : 'text-slate-400');
                return (
                  <button
                    key={day}
                    onClick={() => selectDate(dayKey)}
                    className={cn(
                      "h-9 min-w-0 rounded-md px-0.5 flex flex-col items-center justify-center gap-0.5 leading-none transition-colors",
                      "bg-slate-50 text-slate-500",
                      isSelected && "!bg-[#0B2545] !text-white ring-1 ring-[#EE6C4D] shadow-sm cursor-pointer active:scale-95"
                    )}
                  >
                    <span className="text-[8px] font-bold">{day}</span>
                    {pnlLabel && <span title={dayPnl?.complete ? pnlEntries.map(([currency, value]) => formatPnl(value, currency)).join(' · ') : 'P&L unavailable: closing-price history is incomplete'} className={cn("max-w-full truncate text-[6px] font-semibold font-mono", pnlColor)}>{pnlLabel}</span>}
                  </button>
                );
              })}
            </div>
            <div className={cn("mt-2 pl-1 text-[9px] leading-relaxed", portfolioPnlError ? 'text-rose-600' : 'text-slate-400')}>{pnlStatus}</div>
          </div>
        </div>

        {/* Compact daily AI review summary */}
        <div id="attention-module" className="pt-1.5 pb-1 relative z-10">
          <div className="bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#EE6C4D]/5 rounded-full blur-xl pointer-events-none"></div>
            
            <div className="flex items-center justify-between gap-2 mb-2 relative z-10">
              <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#EE6C4D]" /> Daily Summary
              </h2>
              <button
                onClick={() => void handleGenerateSummary()}
                disabled={reviewLoading || summaryGenerating}
                className="bg-[#0B2545] hover:bg-[#134074] active:scale-95 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-60"
              >
                {summaryGenerating ? <RefreshCw size={11} className="animate-spin" /> : dailyReview?.summary ? <RefreshCw size={11} /> : <Sparkles size={11} />}
                {summaryGenerating ? 'Analyzing…' : dailyReview?.summary ? 'Regenerate' : 'Generate'}
              </button>
            </div>
            
            <div className="bg-[#0B2545]/[0.03] p-2.5 rounded-lg border border-[#0B2545]/10 relative z-10">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">{selectedDateLabel}</div>
              {reviewLoading ? <p className="text-[11px] text-slate-400">Loading saved review…</p> : dailyReview?.summary ? (
                <>
                  <p className="line-clamp-2 text-[11px] font-semibold leading-relaxed text-[#134074]">{dailyReview.summary}</p>
                  {summaryStale && <p className="mt-1 text-[9px] font-medium text-amber-700">Trades or notes changed. Regenerate this summary.</p>}
                  {(dailyReview.trade_reviews?.length ?? 0) > 0 && <button onClick={showTradeReviews} className="mt-1.5 text-[10px] font-bold text-[#EE6C4D]">View trade review ↓</button>}
                </>
              ) : <p className="text-[11px] text-slate-400">Generate an evidence-based review of this day’s execution.</p>}
              {reviewError && <p role="alert" className="mt-1.5 text-[10px] text-rose-600">{reviewError}</p>}
            </div>
          </div>
        </div>

        {/* Trades Module (Migrated from Daily Review) */}
        <TradesModule isCard={true} tradeDate={selectedDate} />

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

        {dailyReview && (dailyReview.trade_count > 0 || (dailyReview.trade_reviews?.length ?? 0) > 0) && (
          <div id="daily-trade-review" className="scroll-mt-20 pt-1.5 pb-1 relative z-10">
            <div className="bg-white/90 rounded-xl border border-white p-3 shadow-[0_4px_12px_rgba(11,37,69,0.03)]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-[#0B2545]"><Sparkles size={13} className="text-[#EE6C4D]" /> Trade Review</h2>
                <span className="text-[9px] font-mono text-slate-400">{selectedDateLabel}</span>
              </div>
              {dailyReview.trade_reviews?.length ? <div className="space-y-2">
                {dailyReview.trade_reviews.map(item => (
                  <div key={item.trade_id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    <div className="mb-1 text-[11px] font-bold text-[#0B2545]">{item.symbol}</div>
                    <p className="text-[11px] leading-relaxed text-slate-600">{item.review}</p>
                  </div>
                ))}
              </div> : <p className="mb-2 text-[10px] text-slate-500">No trade review generated for this day yet.</p>}
              <div className="flex items-center justify-between gap-2">
                {tradeReviewsStale && <p className="text-[9px] font-medium text-amber-700">Trades or notes changed. Regenerate this review.</p>}
                <button onClick={() => void handleGenerateTradeReviews()} disabled={tradeReviewsGenerating} className="ml-auto rounded-lg bg-[#0B2545] px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-60">
                  {tradeReviewsGenerating ? 'Analyzing…' : dailyReview.trade_reviews?.length ? 'Regenerate' : 'Generate trade review'}
                </button>
              </div>
              {dailyReview.trade_reviews_generated_at && <p className="mt-2 text-right text-[9px] text-slate-400">Generated {new Date(dailyReview.trade_reviews_generated_at).toLocaleString('en-US')}</p>}
            </div>
          </div>
        )}

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
