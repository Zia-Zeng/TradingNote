import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Edit3, Calendar, Search, Filter } from 'lucide-react';
import StatusBar from '../components/mobile-shell/status-bar';
import { cn } from '../lib/utils';

export default function Notes() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') || '1M';

  const setFilter = (f: string) => {
    setSearchParams({ filter: f });
  };

  const allNotes = [
    { id: 1, text: "Watch for tech stocks rotation into small caps.", time: "Today, 09:30" },
    { id: 2, text: "Focus on sector rotation into defensive stocks before weekend.", time: "Jul 14, 15:20" },
    { id: 3, text: "Don't chase ZIJIN back above 27 this week. Wait for a pullback toward 25.80.", time: "Jul 10, 11:15" },
    { id: 4, text: "Crypto market shows high volatility. Tighten stops on BTC.", time: "Jul 05, 08:45" },
    { id: 5, text: "Market sentiment is extremely bullish, time to trim positions.", time: "Jun 28, 14:00" },
    { id: 6, text: "Earnings season starting, keep cash ready for opportunities.", time: "Jun 15, 10:20" },
  ];

  const filteredNotes = allNotes.filter(note => {
    if (filter === 'All') return true;
    if (filter === '1W') return note.id <= 2;
    if (filter === '1M') return note.id <= 5;
    if (filter === '3M') return true;
    return true;
  });

  return (
    <div className="w-full h-screen bg-[#F8F9FA] flex flex-col font-sans text-slate-900 overflow-hidden">
      <div className="bg-white shrink-0 sticky top-0 z-20">
        <StatusBar color="black" floating={false} />
        <div className="flex items-center px-3 pb-2 pt-2 shadow-sm border-b border-slate-100">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 text-slate-700 active:bg-slate-100 rounded-full transition-colors absolute">
            <ChevronLeft size={22} />
          </button>
          <div className="flex-1 flex justify-center">
            <h1 className="text-[16px] font-bold text-[#0B2545] tracking-tight">All Notes</h1>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 bg-white border-b border-slate-100 shadow-sm shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1">
          {['1W', '1M', '3M', 'All'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn("px-3 py-1 text-[11px] font-bold rounded-md transition-colors", filter === f ? "bg-white text-[#0B2545] shadow-sm" : "text-slate-500")}
            >
              {f}
            </button>
          ))}
        </div>
        <button className="text-slate-400 p-1">
          <Calendar size={16} />
        </button>
      </div>

      <main className="flex-1 overflow-y-auto px-5 py-6">
        <div className="relative before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200 space-y-6">
          {filteredNotes.map(note => (
            <div key={note.id} className="relative flex items-start">
              <div className="absolute left-[1px] top-1.5 w-2 h-2 rounded-full bg-white border-2 border-[#EE6C4D] z-10 shadow-sm"></div>
              <div className="pl-6 flex-1 w-full">
                <div className="text-[10px] text-slate-400 font-mono font-bold tracking-wider mb-1.5">{note.time}</div>
                <p className="text-[13px] text-[#0B2545] leading-relaxed font-medium">
                  {note.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}