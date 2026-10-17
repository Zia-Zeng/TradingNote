import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Sparkles, Edit3, X, Plus, BotMessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';
import TradesModule from '../components/TradesModule';
import { readLocalResult, SAVED_RESULTS_EVENT } from '../lib/saved-results';

type SavedTracking = { title: string; body: string; savedAt: string };

export default function DailyDetail() {
  const navigate = useNavigate();
  const { date } = useParams();
  const [reviewVersion, setReviewVersion] = useState(0);
  const [savedTracking, setSavedTracking] = useState<SavedTracking | null>(null);

  const [attentionNotes, setAttentionNotes] = useState([
    { id: 1, text: "Focus on sector rotation into defensive stocks before weekend.", time: "Jul 14, 15:20" }
  ]);
  const [newAttentionNote, setNewAttentionNote] = useState('');

  useEffect(() => {
    const el = document.getElementById('daily-scroll-container');
    if (el) el.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const key = `tradingnote:tracking:${date || '2026-07-14'}`;
    const sync = () => setSavedTracking(readLocalResult<SavedTracking>(key));
    sync();
    window.addEventListener(SAVED_RESULTS_EVENT, sync);
    return () => window.removeEventListener(SAVED_RESULTS_EVENT, sync);
  }, [date]);

  const handleAddAttentionNote = () => {
    if (newAttentionNote.trim()) {
      setAttentionNotes([{ id: Date.now(), text: newAttentionNote, time: "Jul 14, 16:00" }, ...attentionNotes]);
      setNewAttentionNote('');
    }
  };

  return (
    <div className="w-full h-full bg-[#F8F9FA] flex flex-col font-sans text-slate-900 overflow-hidden">
      <div className="bg-white shrink-0">
        <div className="flex items-center px-3 pb-2 pt-2 shadow-sm border-b border-slate-100">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 text-slate-700 active:bg-slate-100 rounded-full transition-colors absolute">
            <ChevronLeft size={22} />
          </button>
          <div className="flex-1 flex flex-col items-center justify-center">
            <h1 className="text-[16px] font-bold text-[#0B2545] tracking-tight">Jul 14, 2026</h1>
            <span className="text-[11px] text-slate-400 font-medium">Tuesday • 3 trades</span>
          </div>
        </div>
      </div>

      <main id="daily-scroll-container" className="flex-1 overflow-y-auto pb-6">
        {/* Top PNL Card */}
        <div className="bg-white px-4 py-4 mb-2 shadow-sm">
          <div className="flex justify-between items-end mb-4">
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-1">Day PnL (CNY)</div>
              <div className="text-[32px] font-bold text-emerald-500 font-mono leading-none tracking-tighter">
                +3,330.00
              </div>
            </div>
            <div className="bg-emerald-500 text-white px-2 py-1 rounded-md text-[13px] font-bold font-mono">
              +1.31%
            </div>
          </div>
          
          <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 border border-slate-100">
            <div>
              <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Start of Day</div>
              <div className="text-[#0B2545] font-bold font-mono text-[13px]">¥ 254,880.50</div>
            </div>
            <div className="text-slate-300 font-mono">→</div>
            <div className="text-right">
              <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">End of Day</div>
              <div className="text-[#0B2545] font-bold font-mono text-[13px]">¥ 258,210.50</div>
            </div>
          </div>
        </div>

        {/* Trades Module replaces old hardcoded timeline */}
        <TradesModule isCard={false} />

        {/* My Notes Module */}
        <div className="bg-white px-4 py-5 shadow-sm border-t border-slate-100 mb-2 relative">
          <div className="flex justify-between items-center mb-4">
            <div className="text-[14px] font-bold text-[#0B2545] flex items-center gap-1.5">
              <Edit3 size={16} className="text-[#EE6C4D]" /> My notes
            </div>
            <div className="text-[10px] text-slate-400 font-mono font-medium">{newAttentionNote.length}/140</div>
          </div>
          
          <div className="flex gap-2 mb-4">
            <input 
              type="text"
              value={newAttentionNote}
              onChange={(e) => setNewAttentionNote(e.target.value.slice(0, 140))}
              placeholder="What did you learn today?"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-[#EE6C4D] placeholder:text-slate-400 text-[#0B2545] shadow-sm transition-colors min-w-0"
            />
            <button 
              onClick={handleAddAttentionNote}
              disabled={!newAttentionNote.trim()}
              className={cn(
                "px-4 py-2 font-bold text-[12px] rounded-lg transition-colors flex items-center gap-1 shrink-0 shadow-sm",
                newAttentionNote.trim() ? "bg-[#0B2545] text-white active:bg-[#134074]" : "bg-[#E2E8F0] text-[#64748B]"
              )}
            >
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="space-y-2 relative pb-8">
            {attentionNotes.map(note => (
              <div key={note.id} className="bg-[#EE6C4D]/5 border border-[#EE6C4D]/20 rounded-xl p-3 relative group">
                <button 
                  onClick={() => setAttentionNotes(attentionNotes.filter(n => n.id !== note.id))}
                  className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X size={14} />
                </button>
                <div className="flex items-start gap-2 pr-6">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] shrink-0 mt-1.5"></div>
                  <p className="text-[12px] text-[#0B2545] leading-relaxed font-medium">
                    {note.text}
                  </p>
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-2 ml-3.5">
                  {note.time}
                </div>
              </div>
            ))}

          </div>
        </div>

        {/* AI TradingNote */}
        <div className="bg-white px-4 pt-5 pb-6 mb-2 shadow-sm">
          <div className="flex justify-between items-center mb-1">
            <h2 className="text-[16px] font-bold text-[#0B2545] flex items-center gap-1.5">
              <Sparkles size={16} className="text-[#EE6C4D]" /> AI TradingNote
            </h2>
            <button
              onClick={() => setReviewVersion(version => version + 1)}
              className="bg-[#0B2545] text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 active:scale-95 transition-transform"
            >
              <Sparkles size={11} /> {reviewVersion === 0 ? 'Generate' : 'Regenerate'}
            </button>
          </div>

          {savedTracking && (
            <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-[11px] font-bold text-emerald-800">{savedTracking.title}</div>
                <div className="text-[9px] text-emerald-700 font-bold uppercase">Saved from M-Agent</div>
              </div>
              <p className="text-[12px] text-slate-700 leading-relaxed">{savedTracking.body}</p>
            </div>
          )}

          <p className="text-[13px] font-bold text-[#134074] leading-relaxed mb-6">
            {reviewVersion % 2 === 0
              ? "Most of today's gain came before your exits: ZIJIN MINING rose 3.2% into your sale and BIG DATA ETF added 1.5%. Two of the three sells followed plan; JEREH came late."
              : "Two exits followed the plan and protected gains. JEREH was the exception: waiting past the ¥145 stop added avoidable downside. Set stops when entering each trade."}
          </p>

          <div className="space-y-5">
            {/* Notes List */}
            <div>
              <div className="flex justify-between items-end mb-1.5">
                <div className="font-bold text-[#0B2545] text-[12px] flex items-center gap-1.5">
                  ZIJIN MINING <span className="text-[10px] text-slate-400 font-mono font-medium">10:00</span>
                </div>
                <div className="text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded text-[10px] font-bold">{reviewVersion % 2 === 0 ? 'Price ran on' : 'Near target'}</div>
              </div>
              <p className="text-[12px] text-slate-600 leading-relaxed font-medium">
                {reviewVersion % 2 === 0
                  ? 'ZIJIN closed at 26.95, 0.5% above your fill, so it may feel like you sold too soon. You still exited within 0.7% of your 27 target. That is the plan working, not a mistake.'
                  : 'The close was 0.5% above your fill, but your exit was within 0.7% of the ¥27 target. The planned exit still made sense.'}
              </p>
            </div>
            <div>
              <div className="flex justify-between items-end mb-1.5">
                <div className="font-bold text-[#0B2545] text-[12px] flex items-center gap-1.5">
                  ZIJIN INTL <span className="text-[10px] text-slate-400 font-mono font-medium">11:10</span>
                </div>
                <div className="text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded text-[10px] font-bold">{reviewVersion % 2 === 0 ? 'Thesis held' : 'Stop respected'}</div>
              </div>
              <p className="text-[12px] text-slate-600 leading-relaxed font-medium">
                {reviewVersion % 2 === 0
                  ? 'You sold exactly at the stop you set on Jul 8, and the stock fell another 1.5%. Discipline paid.'
                  : 'The ¥94 stop was respected and the stock fell another 1.5%. The exit limited further downside.'}
              </p>
            </div>
            <div>
              <div className="flex justify-between items-end mb-1.5">
                <div className="font-bold text-[#0B2545] text-[12px] flex items-center gap-1.5">
                  JEREH <span className="text-[10px] text-slate-400 font-mono font-medium">14:30</span>
                </div>
                <div className="text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded text-[10px] font-bold">{reviewVersion % 2 === 0 ? 'Late vs plan' : 'Stop missed'}</div>
              </div>
              <p className="text-[12px] text-slate-600 leading-relaxed font-medium">
                {reviewVersion % 2 === 0
                  ? "JEREH kept falling (-0.8%) after you sold, so exiting was right. But the plan's stop was 145; waiting cost about ¥500 more than the plan allowed."
                  : 'Price fell another 0.8% after the exit. The recovery was uncertain, but waiting below the ¥145 stop added about ¥500 in losses.'}
              </p>
            </div>
          </div>

          <div className="mt-6 bg-[#EE6C4D]/5 border border-[#EE6C4D]/20 rounded-xl p-4">
            <h3 className="text-[13px] font-bold text-[#EE6C4D] flex items-center gap-1.5 mb-2">
              <Sparkles size={14} /> Next session
            </h3>
            <p className="text-[12px] text-[#0B2545] font-medium leading-relaxed">
              {reviewVersion % 2 === 0
                ? "Place stops as orders at entry, so an exit like JEREH's doesn't wait on a decision you'd rather not make."
                : 'Set a hard stop when you enter. This keeps a broken setup from turning into a discretionary exit.'}
            </p>
          </div>
        </div>
      </main>

      {/* Floating Agent Entry */}
      <div className="fixed bottom-6 right-4 z-40">
        <button 
          onClick={() => navigate('/agent?ref=daily-2026-07-14&prompt=Review%20today%27s%20trades')}
          className="bg-[#0B2545] text-white p-2.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center relative"
        >
          <BotMessageSquare size={18} />
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EE6C4D] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F57C00]"></span>
          </span>
        </button>
      </div>
    </div>
  );
}
