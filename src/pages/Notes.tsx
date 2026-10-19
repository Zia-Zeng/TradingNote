import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Calendar, Pencil, Trash2, X, Check } from 'lucide-react';
import StatusBar from '../components/mobile-shell/status-bar';
import ExpandableNoteText from '../components/ExpandableNoteText';
import { cn } from '../lib/utils';
import { formatNoteDate, localDate, useDailyNotes } from '../lib/daily-notes';

export default function Notes() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') || '1M';
  const selectedDate = searchParams.get('date') || '';
  const [showCalendar, setShowCalendar] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const { notes, loading, error, reload, update, remove } = useDailyNotes();

  const setFilter = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('filter', value);
    next.delete('date');
    setSearchParams(next);
  };

  const filteredNotes = useMemo(() => {
    const today = new Date(`${localDate()}T00:00:00`);
    const cutoff = new Date(today);
    if (filter === '1W') cutoff.setDate(cutoff.getDate() - 7);
    else if (filter === '1M') cutoff.setMonth(cutoff.getMonth() - 1);
    else if (filter === '3M') cutoff.setMonth(cutoff.getMonth() - 3);
    return notes.filter(note => {
      if (selectedDate) return note.trade_date === selectedDate;
      return filter === 'All' || new Date(`${note.trade_date}T00:00:00`) >= cutoff;
    });
  }, [filter, notes, selectedDate]);

  const setDate = (date: string) => {
    const next = new URLSearchParams(searchParams);
    if (date) next.set('date', date);
    else next.delete('date');
    setSearchParams(next);
  };

  const saveEdit = async (id: string, tradeDate: string) => {
    try {
      await update(id, editingText, tradeDate);
      setEditingId(null);
    } catch { /* The shared hook exposes the request error below. */ }
  };

  const deleteNote = async (id: string) => {
    try { await remove(id); setPendingDelete(null); } catch { /* The shared hook exposes the request error below. */ }
  };

  return (
    <div className="w-full h-screen bg-[#F8F9FA] flex flex-col font-sans text-slate-900 overflow-hidden">
      <div className="bg-white shrink-0 sticky top-0 z-20">
        <StatusBar color="black" floating={false} />
        <div className="flex items-center px-3 pb-2 pt-2 shadow-sm border-b border-slate-100">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 text-slate-700 active:bg-slate-100 rounded-full transition-colors absolute" aria-label="Back">
            <ChevronLeft size={22} />
          </button>
          <div className="flex-1 flex justify-center"><h1 className="text-[16px] font-bold text-[#0B2545] tracking-tight">All Notes</h1></div>
        </div>
      </div>

      <div className="px-4 py-3 bg-white border-b border-slate-100 shadow-sm shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 bg-slate-50 rounded-lg p-1">
            {['1W', '1M', '3M', 'All'].map(value => (
              <button key={value} onClick={() => setFilter(value)} className={cn('px-3 py-1 text-[11px] font-bold rounded-md transition-colors', filter === value && !selectedDate ? 'bg-white text-[#0B2545] shadow-sm' : 'text-slate-500')}>
                {value}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCalendar(value => !value)} aria-label="按日期筛选笔记" aria-expanded={showCalendar} className={cn('p-2 rounded-lg', showCalendar || selectedDate ? 'text-[#EE6C4D] bg-[#EE6C4D]/5' : 'text-slate-400 hover:bg-slate-50')}>
            <Calendar size={16} />
          </button>
        </div>
        {showCalendar && (
          <div className="flex items-center gap-2 mt-2">
            <input lang="en-US" type="date" value={selectedDate} max={localDate()} onChange={event => setDate(event.target.value)} aria-label="Filter notes by date" className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] text-slate-700" />
            {selectedDate && <button onClick={() => setDate('')} className="p-1.5 text-slate-500" aria-label="清除日期筛选"><X size={14} /></button>}
          </div>
        )}
        {selectedDate && <p className="mt-1 text-[10px] text-slate-400">筛选日期：{selectedDate}</p>}
      </div>

      <main className="flex-1 overflow-y-auto px-5 py-6">
        {loading ? <p className="text-center text-[12px] text-slate-400 py-8">正在加载笔记…</p> : error ? (
          <div className="text-center py-8"><p role="alert" className="text-[12px] text-rose-600 mb-2">{error}</p><button onClick={() => void reload()} className="text-[11px] font-bold text-[#0B2545]">重试</button></div>
        ) : filteredNotes.length === 0 ? <p className="text-center text-[12px] text-slate-400 py-8">这个时间范围内还没有笔记。</p> : (
          <div className="relative before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200 space-y-6">
            {filteredNotes.map(note => (
              <div key={note.id} className="relative flex items-start">
                <div className="absolute left-[1px] top-1.5 w-2 h-2 rounded-full bg-white border-2 border-[#EE6C4D] z-10 shadow-sm" />
                <div className="pl-6 flex-1 w-full min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="text-[10px] text-slate-400 font-mono font-bold tracking-wider">{formatNoteDate(note)}</div>
                    <div className="flex gap-1">
                      <button onClick={() => { setEditingId(note.id); setEditingText(note.text); }} aria-label="编辑笔记" className="p-1 text-slate-400 hover:text-[#0B2545]"><Pencil size={12} /></button>
                      <button onClick={() => setPendingDelete(note.id)} aria-label="删除笔记" className="p-1 text-slate-400 hover:text-rose-500"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  {editingId === note.id ? (
                    <div>
                      <textarea autoFocus maxLength={500} value={editingText} onChange={event => setEditingText(event.target.value)} className="w-full min-h-24 bg-white border border-slate-200 rounded-lg p-2 text-[13px] text-[#0B2545] leading-relaxed focus:outline-none focus:border-[#EE6C4D]" />
                      <div className="flex justify-end gap-2 mt-1"><button onClick={() => setEditingId(null)} className="text-slate-400 p-1" aria-label="取消编辑"><X size={15} /></button><button onClick={() => void saveEdit(note.id, note.trade_date)} className="text-emerald-600 p-1" aria-label="保存笔记"><Check size={15} /></button></div>
                    </div>
                  ) : <ExpandableNoteText text={note.text} className="text-[13px] text-[#0B2545] leading-relaxed font-medium" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      {pendingDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-6" role="presentation" onClick={() => setPendingDelete(null)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-note-title" className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-2xl" onClick={event => event.stopPropagation()}>
            <h2 id="delete-note-title" className="text-[14px] font-bold text-[#0B2545]">删除这条笔记？</h2>
            <p className="mt-1 text-[12px] text-slate-500">删除后无法恢复。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPendingDelete(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-600">取消</button>
              <button onClick={() => void deleteNote(pendingDelete)} className="rounded-lg bg-rose-600 px-3 py-2 text-[11px] font-bold text-white">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
