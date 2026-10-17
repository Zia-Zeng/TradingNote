import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  ArrowUpRight, Plus, X, Sparkles, Edit3, ChevronLeft, ChevronRight, Search, RefreshCw
} from 'lucide-react';
import { cn } from '../lib/utils';
import TradesModule from '../components/TradesModule';

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const onboardParam = searchParams.get('onboard');
  const navigate = useNavigate();

  const [onboardingStep, setOnboardingStep] = useState(0);
  const [trackingGenerated, setTrackingGenerated] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date(2026, 6, 1));
  const [showCalendarFilter, setShowCalendarFilter] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState<'all' | 'profit' | 'loss'>('all');

  const [attentionNotes, setAttentionNotes] = useState([
    { id: 2, text: "Watch for tech stocks rotation into small caps.", time: "Today, 09:30" }
  ]);
  const [newAttentionNote, setNewAttentionNote] = useState('');

  const handleAddAttentionNote = () => {
    if (newAttentionNote.trim()) {
      const newId = Date.now();
      const timeStr = `Today, ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
      setAttentionNotes([{ id: newId, text: newAttentionNote, time: timeStr }, ...attentionNotes]);
      setNewAttentionNote('');
    }
  };

  const handleDeleteAttentionNote = (id: string | number) => {
    setAttentionNotes(attentionNotes.filter(n => n.id !== id));
  };

  useEffect(() => {
    const noteParam = searchParams.get('note');
    if (noteParam === 'added') {
      setAttentionNotes([
        { id: 3, text: "Don't chase ZIJIN back above 27 this week. Wait for a pullback toward 25.80.", time: "Today, 10:15" },
        { id: 2, text: "Watch for tech stocks rotation into small caps.", time: "Today, 09:30" }
      ]);
      setTimeout(() => {
        document.getElementById('notes-module')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } else if (noteParam === 'deleted') {
      setAttentionNotes([]);
      setTimeout(() => {
        document.getElementById('notes-module')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [searchParams]);

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
  const julyPnlByDay: Record<number, { pnl: string; value: number }> = {
    1: { pnl: '+1.2k', value: 1200 }, 2: { pnl: '-860', value: -860 }, 3: { pnl: '+2.1k', value: 2100 },
    6: { pnl: '-2.5k', value: -2500 }, 7: { pnl: '+620', value: 620 }, 8: { pnl: '+1.8k', value: 1800 },
    9: { pnl: '-1.3k', value: -1300 }, 10: { pnl: '+3.0k', value: 3000 }, 13: { pnl: '-410', value: -410 }, 14: { pnl: '+3.3k', value: 3330 }
  };
  const calendarDaysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarCells: Array<number | null> = [
    ...Array.from({ length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay() }, () => null),
    ...Array.from({ length: calendarDaysInMonth }, (_, index) => index + 1)
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

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
        
        {/* Asset Summary Card */}
        <div className={cn(
          "bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white relative transition-all duration-300",
          onboardingStep === 1 ? "z-[101] ring-4 ring-white/60 shadow-2xl scale-[1.02]" : "z-10 shadow-[0_4px_12px_rgba(11,37,69,0.03)]"
        )}>
          <div className="text-slate-500 text-[9px] font-medium mb-0.5 uppercase tracking-wider">Total Assets (CNY)</div>
          <div className="text-[26px] font-bold text-[#0B2545] font-mono tracking-tight flex items-baseline gap-1 mb-2">
            <span className="text-[16px] font-sans font-medium text-slate-400">¥</span>258,210.50
          </div>
          
          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5">
            <div>
              <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Positions</div>
              <div className="text-[#0B2545] font-bold text-[11px] flex items-center gap-0.5 font-mono">
                152,300 <span className="text-slate-400 font-normal ml-0.5 font-sans text-[9px]">(59%)</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Total PnL</div>
              <div className="text-emerald-500 font-bold text-[11px] flex items-center gap-0.5 font-mono">
                <ArrowUpRight size={10} strokeWidth={2.5} /> 46,200 <span className="text-emerald-500/70 font-normal ml-0.5 font-sans text-[9px]">(26%)</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Today PnL</div>
              <div className="text-emerald-500 font-bold text-[11px] flex items-center gap-0.5 font-mono">
                <ArrowUpRight size={10} strokeWidth={2.5} /> 3,330 <span className="text-emerald-500/70 font-normal ml-0.5 font-sans text-[9px]">(1.2%)</span>
              </div>
            </div>
          </div>

          {onboardingStep === 1 && (
            <div className="absolute top-full left-0 right-0 mt-4 bg-white rounded-xl p-3.5 shadow-xl animate-in fade-in slide-in-from-top-2 z-[102] pointer-events-auto text-left">
              <div className="absolute -top-2 left-8 w-4 h-4 bg-white rotate-45 rounded-sm"></div>
              <div className="relative z-10 text-[#0B2545] text-[12px] font-medium leading-relaxed mb-3">
                Your asset details and trade logs have been <span className="text-[#EE6C4D] font-bold">automatically imported</span> from your Future Assets brokerage account. Updates <span className="text-[#EE6C4D] font-bold">sync daily</span> after market close.
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
                <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
                  {(['all', 'profit', 'loss'] as const).map(filter => (
                    <button key={filter} onClick={() => setCalendarFilter(filter)} className={cn("px-2 py-1 rounded text-[8px] font-bold capitalize", calendarFilter === filter ? "bg-white text-[#0B2545] shadow-sm" : "text-slate-400")}>{filter}</button>
                  ))}
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-3 gap-2 mb-2 ml-1">
              <div>
                <div className="text-slate-400 text-[8px] mb-0.5 uppercase tracking-wider">Month PnL</div>
                <div className="text-emerald-500 font-bold text-[10px] font-mono">{monthKey === '2026-07' ? '+7,010' : '—'}</div>
              </div>
              <div>
                <div className="text-slate-400 text-[8px] mb-0.5 uppercase tracking-wider">Win / Loss Days</div>
                <div className="text-[#0B2545] font-bold text-[10px] font-mono flex gap-1"><span className="text-emerald-500">{monthKey === '2026-07' ? '6' : '0'}</span>/<span className="text-rose-500">{monthKey === '2026-07' ? '4' : '0'}</span></div>
              </div>
              <div>
                <div className="text-slate-400 text-[8px] mb-0.5 uppercase tracking-wider">Best Day</div>
                <div className="text-[#0B2545] font-bold text-[10px] flex items-center gap-1 font-mono">{monthKey === '2026-07' ? <>Jul 14 <span className="text-emerald-500 text-[9px]">+3.3k</span></> : '—'}</div>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-0.5 text-center">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-[7px] font-bold text-slate-400 py-0.5">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 ml-1">
              {calendarCells.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} className="h-7" />;
                const pnl = monthKey === '2026-07' ? julyPnlByDay[day] : undefined;
                const filteredOut = pnl ? (calendarFilter === 'profit' ? pnl.value < 0 : calendarFilter === 'loss' ? pnl.value > 0 : false) : false;
                const isJul14 = monthKey === '2026-07' && day === 14;
                const tone = pnl ? (pnl.value >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700') : 'bg-slate-50 text-slate-400';
                return (
                  <button
                    key={day}
                    disabled={filteredOut || !isJul14}
                    onClick={() => navigate('/daily/2026-07-14')}
                    className={cn(
                      "h-7 min-w-0 rounded-md px-0.5 flex flex-col items-center justify-center leading-none transition-colors",
                      tone,
                      filteredOut && "opacity-25",
                      isJul14 && "!bg-emerald-500 !text-white ring-1 ring-[#EE6C4D] shadow-sm cursor-pointer active:scale-95"
                    )}
                  >
                    <span className="text-[8px] font-bold">{day}</span>
                    {pnl && <span className="text-[6px] font-bold font-mono mt-0.5">{pnl.pnl}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* AI Tracking Summary */}
        <div id="attention-module" className="pt-1.5 pb-1 relative z-10">
          <div className="bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#EE6C4D]/5 rounded-full blur-xl pointer-events-none"></div>
            
            <div className="flex items-center justify-between mb-3 relative z-10">
              <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#EE6C4D]" /> AI Tracking
              </h2>
              <button
                onClick={() => setTrackingGenerated(true)}
                className="bg-[#0B2545] hover:bg-[#134074] active:scale-95 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-all shadow-sm"
              >
                {trackingGenerated ? <RefreshCw size={11} /> : <Sparkles size={11} />}
                {trackingGenerated ? 'Regenerate' : 'Generate'}
              </button>
            </div>
            
            <div className="bg-[#0B2545]/[0.03] p-2.5 rounded-lg border border-[#0B2545]/10 relative z-10">
              {trackingGenerated ? (
                <div className="space-y-2 text-[11px] text-slate-700 font-medium leading-relaxed">
                  <p className="font-bold text-[#134074]">Today’s execution was disciplined, with gains supported by planned exits and timely risk control.</p>
                  <ul className="space-y-1.5">
                    <li className="flex items-start gap-1.5"><span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0 mt-1.5" /><span><strong className="text-[#0B2545]">ZIJIN MINING:</strong> Sold near the target; execution followed the plan.</span></li>
                    <li className="flex items-start gap-1.5"><span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0 mt-1.5" /><span><strong className="text-[#0B2545]">ZIJIN INTL:</strong> Exited at the planned stop; discipline held.</span></li>
                    <li className="flex items-start gap-1.5"><span className="w-1 h-1 rounded-full bg-amber-500 shrink-0 mt-1.5" /><span><strong className="text-[#0B2545]">JEREH:</strong> Exit came after the planned stop. Set stop orders at entry next time.</span></li>
                  </ul>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 font-medium text-center py-2">Tap Generate for today’s tracking summary.</p>
              )}
            </div>
          </div>
        </div>

        {/* Trades Module (Migrated from Daily Review) */}
        <TradesModule isCard={true} />

        {/* My Notes Module */}
        <div id="notes-module" className="pt-1.5 pb-1 relative z-10">
          <div className="bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative overflow-hidden">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-[13px] font-bold text-[#0B2545] flex items-center gap-1.5">
                <Edit3 size={14} className="text-[#EE6C4D]" /> My notes
              </div>
              <div className="text-[10px] text-slate-400 font-mono font-medium">{newAttentionNote.length}/140</div>
            </div>
            
            <div className="flex gap-2 mb-3">
              <input 
                type="text"
                value={newAttentionNote}
                onChange={(e) => setNewAttentionNote(e.target.value.slice(0, 140))}
                placeholder="What do you want to keep an eye on?"
                className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-[#EE6C4D] placeholder:text-slate-400 text-[#0B2545] shadow-sm transition-colors min-w-0"
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
                    <p className="text-[12px] text-[#0B2545] leading-relaxed font-medium">
                      {note.text}
                    </p>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-1.5 ml-3">
                    {note.time}
                  </div>
                </div>
              ))}
            </div>
            
            <button 
              onClick={() => navigate('/notes')}
              className="w-full py-2 mt-1 text-[11px] font-bold text-slate-500 hover:text-[#0B2545] transition-colors flex items-center justify-center gap-1 border-t border-slate-100/60"
            >
              View All Notes <ChevronRight size={12} />
            </button>
          </div>
        </div>

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
