import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  ArrowUpRight, Plus, X, Sparkles, Bell, Edit3, ChevronLeft, ChevronRight, Search
} from 'lucide-react';
import { cn } from '../lib/utils';
import TradesModule from '../components/TradesModule';

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const onboardParam = searchParams.get('onboard');
  const navigate = useNavigate();

  const [onboardingStep, setOnboardingStep] = useState(0);

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
            <div className="flex justify-between items-center mb-3 ml-1">
              <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight">Trading Calendar</h2>
              <div className="flex items-center gap-1.5 bg-slate-50/80 backdrop-blur-sm border border-slate-100/80 rounded-lg px-2 py-1 shadow-sm">
                <button className="text-slate-400 hover:text-slate-600 active:scale-95 transition-transform">
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[11px] font-bold text-slate-500 font-mono tracking-wider min-w-[50px] text-center">Jul 2026</span>
                <button className="text-slate-400 hover:text-slate-600 active:scale-95 transition-transform">
                  <ChevronRight size={12} />
                </button>
                <div className="w-px h-3 bg-slate-200 mx-0.5"></div>
                <button className="text-slate-400 hover:text-slate-600 active:scale-95 transition-transform">
                  <Search size={12} />
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-2 mb-3 ml-1">
              <div>
                <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Month PnL</div>
                <div className="text-emerald-500 font-bold text-[12px] font-mono">+7,010</div>
              </div>
              <div>
                <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Win / Loss Days</div>
                <div className="text-[#0B2545] font-bold text-[12px] font-mono flex gap-1"><span className="text-emerald-500">6</span>/<span className="text-rose-500">4</span></div>
              </div>
              <div>
                <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Best Day</div>
                <div className="text-[#0B2545] font-bold text-[12px] flex items-center gap-1 font-mono">Jul 14 <span className="text-emerald-500 text-[10px]">+3.3k</span></div>
              </div>
            </div>

            {/* Grid Map omitted for brevity, keeping structure intact */}
            <div className="grid grid-cols-7 gap-1.5 mb-4 ml-1">
              <div />
              <div />
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-emerald-100 text-emerald-700">
                <span className="text-[9px] font-bold opacity-60">1</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">+1.2k</span>
              </div>
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-rose-200 text-rose-800">
                <span className="text-[9px] font-bold opacity-60">2</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">-860</span>
              </div>
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-emerald-300 text-emerald-900">
                <span className="text-[9px] font-bold opacity-60">3</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">+2.1k</span>
              </div>
              <div className="h-10 flex flex-col items-center justify-center border border-slate-50 rounded-lg relative">
                <span className="text-[8px] font-bold text-slate-300 absolute top-1 left-1">4</span>
                <span className="text-[7px] font-bold text-slate-200 mt-2 uppercase tracking-wider">Closed</span>
              </div>
              <div className="h-10 flex flex-col items-center justify-center border border-slate-50 rounded-lg relative">
                <span className="text-[8px] font-bold text-slate-300 absolute top-1 left-1">5</span>
                <span className="text-[7px] font-bold text-slate-200 mt-2 uppercase tracking-wider">Closed</span>
              </div>

              {/* Week 2 */}
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-rose-300 text-rose-900">
                <span className="text-[9px] font-bold opacity-80">6</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">-2.5k</span>
              </div>
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-emerald-50 text-emerald-600">
                <span className="text-[9px] font-bold opacity-60">7</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">+620</span>
              </div>
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-emerald-200 text-emerald-800">
                <span className="text-[9px] font-bold opacity-60">8</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">+1.8k</span>
              </div>
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-rose-300 text-rose-900">
                <span className="text-[9px] font-bold opacity-60">9</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">-1.3k</span>
              </div>
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-emerald-500 text-white">
                <span className="text-[9px] font-bold opacity-80">10</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">+3.0k</span>
              </div>
              <div className="h-10 flex flex-col items-center justify-center border border-slate-50 rounded-lg relative">
                <span className="text-[8px] font-bold text-slate-300 absolute top-1 left-1">11</span>
                <span className="text-[7px] font-bold text-slate-200 mt-2 uppercase tracking-wider">Closed</span>
              </div>
              <div className="h-10 flex flex-col items-center justify-center border border-slate-50 rounded-lg relative">
                <span className="text-[8px] font-bold text-slate-300 absolute top-1 left-1">12</span>
                <span className="text-[7px] font-bold text-slate-200 mt-2 uppercase tracking-wider">Closed</span>
              </div>

              {/* Week 3 */}
              <div className="h-10 rounded-lg p-1 flex flex-col justify-between bg-rose-100 text-rose-700">
                <span className="text-[9px] font-bold opacity-60">13</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">-410</span>
              </div>
              <div 
                onClick={() => navigate('/daily/2026-07-14')}
                className="h-10 rounded-lg p-1 flex flex-col justify-between bg-emerald-500 text-white ring-2 ring-offset-1 ring-[#EE6C4D] shadow-sm cursor-pointer active:scale-95 transition-transform"
              >
                <span className="text-[9px] font-bold opacity-80">14</span>
                <span className="text-[9px] font-bold text-center -mt-1 font-mono tracking-tighter">+3.3k</span>
              </div>
              
              {/* Empty Days */}
              {Array.from({ length: 17 }).map((_, i) => (
                <div key={i+15} className="h-10 rounded-lg bg-slate-50/50 flex items-start justify-start p-1.5">
                  <span className="text-[8px] font-bold text-slate-300">{i+15}</span>
                </div>
              ))}
            </div>
            
            <div className="flex items-center justify-between ml-1">
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-bold text-slate-400 mr-1">Loss</span>
                {['bg-rose-400', 'bg-rose-300', 'bg-rose-200', 'bg-rose-100', 'bg-slate-100', 'bg-emerald-50', 'bg-emerald-100', 'bg-emerald-300', 'bg-emerald-500'].map((c, i) => (
                  <div key={i} className={cn("w-2.5 h-2.5 rounded-[2px]", c)}></div>
                ))}
                <span className="text-[9px] font-bold text-slate-400 ml-1">Profit</span>
              </div>
              <div className="text-[9px] font-bold text-slate-400">Tap a day to review trades</div>
            </div>
          </div>
        </div>

        {/* Attention Module (AI Only) */}
        <div id="attention-module" className="pt-1.5 pb-1 relative z-10">
          <div className="bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#EE6C4D]/5 rounded-full blur-xl pointer-events-none"></div>
            
            <div className="flex items-center justify-between mb-3 relative z-10">
              <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight flex items-center gap-1.5">
                <Bell size={14} className="text-[#EE6C4D]" /> Attention
              </h2>
            </div>
            
            <div className="bg-[#0B2545]/[0.03] p-2.5 rounded-lg border border-[#0B2545]/10 relative z-10">
              <div className="text-[10px] font-bold text-[#0B2545] mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                <Sparkles size={12} className="text-[#EE6C4D]" /> AI Insights
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-700 font-medium leading-relaxed pl-1.5">
                <li className="flex items-start gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-[#EE6C4D] shrink-0 mt-1.5"></div>
                  <span>Monitor price levels for technical confirmation on <span className="font-bold text-[#0B2545]">ZIJIN MINING</span>.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-[#EE6C4D] shrink-0 mt-1.5"></div>
                  <span>Track WTI crude oil volatility ahead of the weekend.</span>
                </li>
              </ul>
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