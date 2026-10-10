import React, { useEffect, useState } from 'react';
import { Sparkles, Plus, X, Eye, PenLine } from 'lucide-react';
import { cn } from '../lib/utils';

type WatchKind = 'Macro' | 'Technical' | 'Risk';

interface WatchItem {
  id: string;
  kind: WatchKind;
  symbol: string;
  title: string;
  body: string;
  watchLabel: string;
  watchValue: string;
}

interface AttentionNote {
  id: string;
  text: string;
  createdAt: string;
}

const KIND_STYLE: Record<WatchKind, { bar: string; chip: string }> = {
  Macro: { bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  Technical: { bar: 'bg-[#134074]', chip: 'bg-[#134074]/10 text-[#134074] border-[#134074]/20' },
  Risk: { bar: 'bg-rose-400', chip: 'bg-rose-50 text-rose-600 border-rose-200' },
};

const AI_WATCHLIST: WatchItem[] = [
  {
    id: 'oil',
    kind: 'Macro',
    symbol: 'JEREH',
    title: 'Track crude oil overnight',
    body: 'Today’s JEREH exit followed weakness across oil & gas as Brent slid intraday. If you revisit the name, see whether crude stabilises first. Your own note says the short-term logic broke.',
    watchLabel: 'Brent',
    watchValue: '82.40 · −1.8%',
  },
  {
    id: 'etf',
    kind: 'Technical',
    symbol: 'BIG DATA ETF',
    title: 'Wait for a close above 1.100',
    body: 'You hold 4,000 units from 0.950; price is 1.050. Your plan only adds on a break of 1.10. A daily close above it on rising volume would confirm the move; an intraday spike would not.',
    watchLabel: 'Confirm',
    watchValue: 'Close > 1.100',
  },
  {
    id: 'btc',
    kind: 'Risk',
    symbol: 'BITCOIN',
    title: 'BTC is at its 10% cap and falling',
    body: 'BTC dropped 2.4% today with the position already at its 10% limit. 62,000 is the nearest daily support. Your rules exclude averaging down, so plan what you will do if that level gives way.',
    watchLabel: 'Support',
    watchValue: '62,000',
  },
];

const STORAGE_KEY = 'm-tradingnote-attention-notes';
const NOTE_MAX = 140;

const SEED_NOTES: AttentionNote[] = [
  {
    id: 'seed-1',
    text: 'Don’t chase ZIJIN back above 27 this week. Wait for a pullback toward 25.80.',
    createdAt: '2026-07-14T15:20:00',
  },
];

const loadNotes = (): AttentionNote[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : SEED_NOTES;
};

const formatNoteTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export default function Attention() {
  const [notes, setNotes] = useState<AttentionNote[]>(loadNotes);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  const addNote = () => {
    const text = draft.trim();
    if (!text) return;
    setNotes(prev => [{ id: `${Date.now()}`, text, createdAt: new Date().toISOString() }, ...prev]);
    setDraft('');
  };

  const removeNote = (id: string) => setNotes(prev => prev.filter(n => n.id !== id));

  return (
    <div className="pt-1">
      <div className="flex justify-between items-center mb-2 px-1">
        <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight">Attention</h2>
        <span className="text-[10px] font-bold text-slate-500 font-mono">Jul 14 · after close</span>
      </div>

      <div className="bg-white/90 backdrop-blur-md rounded-xl p-2.5 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 text-[11px] font-bold text-[#0B2545]">
            <Sparkles size={11} className="text-[#EE6C4D]" />
            AI watchlist
          </div>
          <span className="text-[8px] text-slate-400 font-medium">From today’s trades and your holdings</span>
        </div>

        <ul className="flex flex-col gap-1.5">
          {AI_WATCHLIST.map(item => {
            const style = KIND_STYLE[item.kind];
            return (
              <li key={item.id} className="relative bg-slate-50/70 border border-slate-100 rounded-lg pl-2.5 pr-2 py-2 overflow-hidden">
                <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]', style.bar)} />
                <div className="flex items-center gap-1 mb-1">
                  <span className={cn('text-[8px] font-bold px-1 py-0.5 rounded border leading-none', style.chip)}>{item.kind}</span>
                  <span className="text-[9px] font-bold text-slate-500 font-mono truncate">{item.symbol}</span>
                </div>
                <div className="text-[11px] font-bold text-[#0B2545] leading-snug mb-0.5">{item.title}</div>
                <p className="text-[10px] text-slate-600 leading-relaxed mb-1.5">{item.body}</p>
                <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded px-1.5 py-0.5">
                  <Eye size={9} className="text-slate-400" />
                  <span className="text-[8px] uppercase tracking-wide text-slate-400 font-bold">{item.watchLabel}</span>
                  <span className="text-[9px] font-bold font-mono text-[#0B2545]">{item.watchValue}</span>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-2.5 pt-2.5 border-t border-slate-100">
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="attention-note" className="flex items-center gap-1 text-[11px] font-bold text-[#0B2545]">
              <PenLine size={11} className="text-[#EE6C4D]" />
              My notes
            </label>
            <span className="text-[8px] text-slate-400 font-mono">{draft.length}/{NOTE_MAX}</span>
          </div>

          <form
            onSubmit={e => { e.preventDefault(); addNote(); }}
            className="flex gap-1.5 mb-2"
          >
            <input
              id="attention-note"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              maxLength={NOTE_MAX}
              placeholder="What do you want to keep an eye on?"
              className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] text-[#0B2545] placeholder:text-slate-400 focus:outline-none focus:border-[#EE6C4D] focus:ring-1 focus:ring-[#EE6C4D]/50"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="shrink-0 bg-[#0B2545] text-white rounded-lg px-2.5 text-[10px] font-bold flex items-center gap-0.5 active:bg-[#134074] disabled:bg-slate-200 disabled:text-slate-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#EE6C4D]"
            >
              <Plus size={11} /> Add
            </button>
          </form>

          {notes.length === 0 ? (
            <div className="text-[10px] text-slate-400 text-center py-2.5 border border-dashed border-slate-200 rounded-lg">
              Add a level, event or rule you want to remember for the next session.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {notes.map(note => (
                <li key={note.id} className="flex items-start gap-1.5 bg-[#EE6C4D]/5 border border-[#EE6C4D]/15 rounded-lg px-2 py-1.5">
                  <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-[#EE6C4D] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-[#0B2545] leading-relaxed break-words">{note.text}</div>
                    <div className="text-[8px] text-slate-400 font-mono mt-0.5">{formatNoteTime(note.createdAt)}</div>
                  </div>
                  <button
                    onClick={() => removeNote(note.id)}
                    aria-label={`Delete note: ${note.text}`}
                    className="shrink-0 p-0.5 text-slate-400 hover:text-rose-500 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0B2545]"
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-2.5 pt-2 border-t border-slate-100 text-[8px] text-slate-400 leading-relaxed">
          AI observations are based on your holdings, notes and public market data. For reference only, not investment advice.
        </p>
      </div>
    </div>
  );
}
